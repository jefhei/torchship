import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import { STANDING_SHAPE } from '../player/hull'
import { navigationWorldOf } from '../player/nav'
import { planCoffeeRun } from './path'
import {
  REVIEW_CELL_M,
  cellCenter,
  deckRouteGrid,
  nearestWalkable,
  planRoute,
  type DeckRouteGrid,
} from './route'

const patrol = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(patrol)
const grid = deckRouteGrid(patrol, world, 1, STANDING_SHAPE) as DeckRouteGrid
const coffee = planCoffeeRun(patrol, world).script!
const spawn = coffee.waypoints[0].point
const stand = coffee.waypoints[1].point

/** The cell a world point rounds into (test-local, so the test does not trust the map's own helpers). */
function cellOf(target: DeckRouteGrid, x: number, z: number) {
  return {
    col: Math.round((x - target.originX) / target.cellM),
    row: Math.round((z - target.originZ) / target.cellM),
  }
}

/** True when the cell a world point rounds into is walkable (false off-grid). */
function walkableAt(target: DeckRouteGrid, x: number, z: number): boolean {
  const cell = cellOf(target, x, z)
  if (
    cell.col < 0 ||
    cell.col >= target.cols ||
    cell.row < 0 ||
    cell.row >= target.rows
  ) {
    return false
  }
  return target.walkable[cell.row * target.cols + cell.col]
}

describe('M5-T2 route grid', () => {
  it('builds a walkable grid over the crew deck floor', () => {
    expect(grid).not.toBeNull()
    expect(grid.deckIndex).toBe(1)
    expect(grid.floorY).toBe(-3.2)
    expect(grid.cellM).toBe(REVIEW_CELL_M)
    // The deck footprint (galley 4.2 m wide + the shaft column) at a 0.1 m pitch.
    expect(grid.cols).toBeGreaterThan(40)
    expect(grid.cols).toBeLessThan(50)
    expect(grid.rows).toBeGreaterThan(60)
    expect(grid.rows).toBeLessThan(75)
    expect(grid.walkable).toHaveLength(grid.cols * grid.rows)
    expect(grid.walkable.some((cell) => cell)).toBe(true)
    expect(grid.walkable.some((cell) => !cell)).toBe(true)
  })

  it('marks the spawn and the coffee station stand walkable, kit and walls not', () => {
    expect(walkableAt(grid, spawn[0], spawn[2])).toBe(true)
    expect(walkableAt(grid, stand[0], stand[2])).toBe(true)
    // Centre of the shaft column: the crawl opening and the ladder occupy it.
    expect(walkableAt(grid, 0, 0)).toBe(false)
    // Inside the galley's port bulkhead (centre plane x = −2.05).
    expect(walkableAt(grid, -2.05, 2.0)).toBe(false)
    // Beyond the deck's own footprint is outside the grid entirely.
    expect(walkableAt(grid, 0, 100)).toBe(false)
  })

  it('centres a cell on the world point that rounds into it', () => {
    const cell = cellOf(grid, spawn[0], spawn[2])
    const centre = cellCenter(grid, cell)
    expect(Math.hypot(centre.x - spawn[0], centre.z - spawn[2])).toBeLessThanOrEqual(
      grid.cellM,
    )
    expect(centre.x).toBeCloseTo(grid.originX + cell.col * grid.cellM, 12)
    expect(centre.z).toBeCloseTo(grid.originZ + cell.row * grid.cellM, 12)
  })

  it('returns null for a deck the ship does not have', () => {
    expect(deckRouteGrid(patrol, world, 9, STANDING_SHAPE)).toBeNull()
  })
})

describe('M5-T2 route planning', () => {
  it('plans a walkable path from the spawn to the coffee station', () => {
    const plan = planRoute(
      grid,
      { x: spawn[0], z: spawn[2] },
      { x: stand[0], z: stand[2] },
    )
    expect(plan.reason).toBeNull()
    const path = plan.path!
    expect(path.length).toBeGreaterThan(1)

    // Both ends land on (or within a cell of) the asked-for points.
    const first = path[0]
    const last = path[path.length - 1]
    expect(Math.hypot(first.x - spawn[0], first.z - spawn[2])).toBeLessThanOrEqual(
      REVIEW_CELL_M,
    )
    expect(Math.hypot(last.x - stand[0], last.z - stand[2])).toBeLessThanOrEqual(
      REVIEW_CELL_M,
    )

    // Every node is walkable, and consecutive nodes are one 4-connected cell apart.
    for (const node of path) {
      expect(walkableAt(grid, node.x, node.z)).toBe(true)
    }
    for (let index = 1; index < path.length; index++) {
      const distance =
        Math.abs(path[index].x - path[index - 1].x) +
        Math.abs(path[index].z - path[index - 1].z)
      expect(distance).toBeCloseTo(grid.cellM, 9)
    }
  })

  it('is deterministic', () => {
    const a = planRoute(
      grid,
      { x: spawn[0], z: spawn[2] },
      { x: stand[0], z: stand[2] },
    )
    const b = planRoute(
      grid,
      { x: spawn[0], z: spawn[2] },
      { x: stand[0], z: stand[2] },
    )
    expect(a).toEqual(b)
  })

  it('reports a reason instead of a path for a target off the deck', () => {
    const plan = planRoute(grid, { x: spawn[0], z: spawn[2] }, { x: 50, z: 50 })
    expect(plan.path).toBeNull()
    expect(plan.reason).toContain('no walkable cell')
  })

  it('nearestWalkable searches outward in rings and honours the snap radius', () => {
    // A synthetic 3×3 grid with only its centre walkable, so the ring search is
    // tested on its own terms rather than through a deck's clutter.
    const tiny: DeckRouteGrid = {
      deckIndex: 1,
      floorY: 0,
      cellM: 1,
      originX: 0,
      originZ: 0,
      cols: 3,
      rows: 3,
      walkable: [false, false, false, false, true, false, false, false, false],
    }
    expect(nearestWalkable(tiny, 1, 1)).toEqual({ col: 1, row: 1 })
    expect(nearestWalkable(tiny, 0, 0)).toEqual({ col: 1, row: 1 })
    expect(nearestWalkable(tiny, 0, 0, 0)).toBeNull()
    // The real crew deck: the open floor beside the spawn is walkable.
    const snapped = nearestWalkable(grid, spawn[0], spawn[2])
    expect(snapped).not.toBeNull()
    const centre = cellCenter(grid, snapped!)
    expect(walkableAt(grid, centre.x, centre.z)).toBe(true)
  })
})
