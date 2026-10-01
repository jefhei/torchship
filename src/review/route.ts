/**
 * M5-T2 — the route planner: a walkable grid over one deck's floor and a
 * shortest-path search across it, so a scripted walk's route is DERIVED from
 * the ship's own collision hull rather than hand-authored.
 *
 * A scripted review walk must be repeatable on every canonical ship, and the
 * ships differ (the galley is the same kit module, but the wear pass, the seam
 * plugs and the shaft band's place in the deck all shift the free floor). A
 * hand-drawn coffee-run path would therefore be a path for ONE ship. So the
 * recorder plans routes the way the walker itself moves:
 *
 *  - the grid is one deck's floor at a fixed cell pitch (REVIEW_CELL_M);
 *  - a cell is WALKABLE when a walker capsule at its centre (a) clears every
 *    hull box that stands in the body band at that deck's floor — the SAME
 *    `blockingBoxes` filter and the SAME M3-T3 hull the M3-T4 solver uses, plus
 *    every shut hatch leaf the M3-T5 machine adds — by CLEARANCE_MARGIN_M, and
 *    (b) is supported by the deck plate (the same `supportHeightAt` rule the
 *    ground solver uses, so a cell over the spine's crawl opening is not a
 *    place to stand);
 *  - the search is breadth-first over 4-connectivity, which is shortest in cell
 *    count and deterministic. Four-connectivity is not just simpler than eight:
 *    two walkable cells a cell-pitch apart cannot have a blocked segment
 *    between them (any box close enough to block the midpoint would have to be
 *    nearer than a capsule radius to one of the centres), so a BFS path is a
 *    path the walker can actually follow one leg at a time.
 *
 * Pure and three-agnostic: geometry in, a list of world points out. This is the
 * M3-T1 "mating geometry is generated, never freehand" rule applied to walking.
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { partBounds } from '../kit/parts'
import { hatchBlockerBoxes } from '../player/hatch'
import {
  blockingBoxes,
  distanceToBoxXZ,
  supportHeightAt,
  type WalkerShape,
} from '../player/hull'
import { FLOOR_EPS_M } from '../player/ladder'
import { CLEARANCE_MARGIN_M } from './types'

/** The route grid's cell pitch, meters. Fine enough for a 0.9 m doorway, cheap enough to search. */
export const REVIEW_CELL_M = 0.1

/** How many cells a start/target may snap across to find a walkable cell. */
export const ROUTE_SNAP_CELLS = 4

/** One grid square of a deck's floor. */
export interface GridCell {
  col: number
  row: number
}

/** A world point in the deck plane (meters). */
export interface GridPoint {
  x: number
  z: number
}

/**
 * A deck's walkable grid: the floor's XZ bounds, the cell pitch, and a
 * row-major walkability mask. Row 0 is the lowest world Z, column 0 the lowest
 * world X, so the mask is in the same orientation as the ship's own axes.
 */
export interface DeckRouteGrid {
  deckIndex: number
  /** World Y of the deck floor (all cells were tested at this height). */
  floorY: number
  cellM: number
  /** World XZ of cell (0, 0)'s centre. */
  originX: number
  originZ: number
  cols: number
  rows: number
  /** Row-major mask: `walkable[row * cols + col]`. */
  walkable: readonly boolean[]
}

/** A planned route (or the reason one could not be planned). */
export interface RoutePlan {
  /** The route, origin cell first and target cell last, or null. */
  path: GridPoint[] | null
  /** Why no route exists (null when `path` is set). */
  reason: string | null
}

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/** The world XZ centre of a grid cell. */
export function cellCenter(grid: DeckRouteGrid, cell: GridCell): GridPoint {
  return {
    x: n0(grid.originX + cell.col * grid.cellM),
    z: n0(grid.originZ + cell.row * grid.cellM),
  }
}

/** True when a cell coordinate is inside the grid. */
function inBounds(grid: DeckRouteGrid, col: number, row: number): boolean {
  return col >= 0 && col < grid.cols && row >= 0 && row < grid.rows
}

/** True when a cell is walkable (bounds + mask). */
function isWalkable(grid: DeckRouteGrid, col: number, row: number): boolean {
  return inBounds(grid, col, row) && grid.walkable[row * grid.cols + col]
}

/**
 * The walkable grid of one deck of an assembled ship. Returns null when the
 * ship has no such deck, the deck seats no geometry, or the deck's floor is not
 * a finite height — every case an honest "there is nothing to walk here".
 */
export function deckRouteGrid(
  ship: ShipAssembly,
  world: NavigationWorld,
  deckIndex: number,
  shape: WalkerShape,
): DeckRouteGrid | null {
  const deck = ship.decks.find((candidate) => candidate.deckIndex === deckIndex)
  if (deck === undefined || !Number.isFinite(deck.floorY)) {
    return null
  }

  // The deck's own footprint: the union of its module instances' placed parts.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let parts = 0
  for (const owner of deck.modules) {
    for (const placed of owner.parts) {
      const box = partBounds(placed.part)
      minX = Math.min(minX, box.min[0])
      maxX = Math.max(maxX, box.max[0])
      minZ = Math.min(minZ, box.min[2])
      maxZ = Math.max(maxZ, box.max[2])
      parts += 1
    }
  }
  if (parts === 0) {
    return null
  }

  const cellM = REVIEW_CELL_M
  const pad = 2 * cellM
  const loX = minX - pad
  const loZ = minZ - pad
  const cols = Math.max(1, Math.ceil((maxX + pad - loX) / cellM))
  const rows = Math.max(1, Math.ceil((maxZ + pad - loZ) / cellM))
  const originX = loX + cellM / 2
  const originZ = loZ + cellM / 2

  // The same hull the navigation machine hands the walker each frame: every
  // deck's M3-T3 boxes plus every SHUT hatch leaf (the walk state).
  const hull = [...world.walker.hull, ...hatchBlockerBoxes(world.hatches, {})]
  const blockers = blockingBoxes(hull, deck.floorY, shape)

  const walkable = new Array<boolean>(cols * rows).fill(false)
  for (let row = 0; row < rows; row++) {
    const z = originZ + row * cellM
    for (let col = 0; col < cols; col++) {
      const x = originX + col * cellM
      let clear = true
      for (const box of blockers) {
        if (distanceToBoxXZ(x, z, box) < shape.radius + CLEARANCE_MARGIN_M) {
          clear = false
          break
        }
      }
      if (!clear) {
        continue
      }
      const support = supportHeightAt(
        hull,
        x,
        z,
        shape.radius,
        deck.floorY + shape.stepHeight,
      )
      walkable[row * cols + col] =
        Number.isFinite(support) &&
        support >= deck.floorY - FLOOR_EPS_M &&
        support <= deck.floorY + shape.stepHeight + FLOOR_EPS_M
    }
  }

  return {
    deckIndex,
    floorY: deck.floorY,
    cellM,
    originX: n0(originX),
    originZ: n0(originZ),
    cols,
    rows,
    walkable,
  }
}

/**
 * The walkable cell nearest (x, z), searching outward in Chebyshev rings so the
 * returned cell is the closest walkable one in a deterministic order. Returns
 * null when nothing walkable lies within `maxRadiusCells`.
 */
export function nearestWalkable(
  grid: DeckRouteGrid,
  x: number,
  z: number,
  maxRadiusCells = ROUTE_SNAP_CELLS,
): GridCell | null {
  const col0 = Math.round((x - grid.originX) / grid.cellM)
  const row0 = Math.round((z - grid.originZ) / grid.cellM)
  if (isWalkable(grid, col0, row0)) {
    return { col: col0, row: row0 }
  }
  for (let radius = 1; radius <= maxRadiusCells; radius++) {
    for (let dRow = -radius; dRow <= radius; dRow++) {
      for (let dCol = -radius; dCol <= radius; dCol++) {
        if (Math.max(Math.abs(dCol), Math.abs(dRow)) !== radius) {
          continue
        }
        if (isWalkable(grid, col0 + dCol, row0 + dRow)) {
          return { col: col0 + dCol, row: row0 + dRow }
        }
      }
    }
  }
  return null
}

/** The grid's four axis-aligned neighbours, in a fixed order for determinism. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Plan a route between two world points on one deck: snap each end to the
 * nearest walkable cell, breadth-first search across walkable cells, and return
 * the world-space cell centres from origin to target. Returns a reason instead
 * of a path when an end has no walkable cell nearby or the two are disconnected.
 */
export function planRoute(
  grid: DeckRouteGrid,
  from: GridPoint,
  to: GridPoint,
  maxSnapCells = ROUTE_SNAP_CELLS,
): RoutePlan {
  const start = nearestWalkable(grid, from.x, from.z, maxSnapCells)
  if (start === null) {
    return {
      path: null,
      reason: `the walker at (${from.x.toFixed(3)}, ${from.z.toFixed(3)}) is not on a walkable cell of deck ${grid.deckIndex}`,
    }
  }
  const goal = nearestWalkable(grid, to.x, to.z, maxSnapCells)
  if (goal === null) {
    return {
      path: null,
      reason: `the target (${to.x.toFixed(3)}, ${to.z.toFixed(3)}) has no walkable cell within ${maxSnapCells} cells on deck ${grid.deckIndex}`,
    }
  }

  const cols = grid.cols
  const startIndex = start.row * cols + start.col
  const goalIndex = goal.row * cols + goal.col
  const total = grid.cols * grid.rows
  const dist = new Int32Array(total).fill(-1)
  const prev = new Int32Array(total).fill(-1)
  const queue: number[] = [startIndex]
  dist[startIndex] = 0
  let head = 0
  let found = startIndex === goalIndex
  while (head < queue.length && !found) {
    const index = queue[head]
    head += 1
    const col = index % cols
    const row = (index - col) / cols
    for (const [dCol, dRow] of STEPS) {
      const nCol = col + dCol
      const nRow = row + dRow
      if (!isWalkable(grid, nCol, nRow)) {
        continue
      }
      const nIndex = nRow * cols + nCol
      if (dist[nIndex] !== -1) {
        continue
      }
      dist[nIndex] = dist[index] + 1
      prev[nIndex] = index
      if (nIndex === goalIndex) {
        found = true
        break
      }
      queue.push(nIndex)
    }
  }
  if (!found) {
    return {
      path: null,
      reason: `no walkable route exists from (${from.x.toFixed(3)}, ${from.z.toFixed(3)}) to (${to.x.toFixed(3)}, ${to.z.toFixed(3)}) on deck ${grid.deckIndex}`,
    }
  }

  const cells: GridCell[] = []
  for (let index = goalIndex; index !== -1; index = prev[index]) {
    const col = index % cols
    cells.push({ col, row: (index - col) / cols })
    if (index === startIndex) {
      break
    }
  }
  cells.reverse()
  return { path: cells.map((cell) => cellCenter(grid, cell)), reason: null }
}
