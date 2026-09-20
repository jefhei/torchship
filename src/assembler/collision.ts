/**
 * M3-T3 — per-deck collision hulls (BUILD_PLAN M3-T3: "collision hulls per
 * deck (from module collision hints)") and the PRD §8 bullet-4 measurement:
 *
 *   "**[auto]** Collision hull matches visible geometry within `[10 cm]` per
 *   deck."
 *
 * The hull is assembled, never authored (BUILD_PLAN rule 8). It is, in deck
 * order:
 *
 *  1. the modules' OWN collision hints (M1-T2 `KitModule.collisionHint`,
 *     authored in M2 as one box per `solid` part — a coarse per-assembly box
 *     would seal the doorway the assembly is cut around), placed in world
 *     space through the module instance's origin + quarter-turn yaw; then
 *  2. the GENERATED seam geometry that must block a walker: M3-T2's blanking
 *     plugs (a blanked socket nothing else seals is filled by a plug; without
 *     its box the walker would step through the filled doorway). M3-T2 marks
 *     exactly these `SeamPlan.solid === true` — the same predicate
 *     `seamSolidParts` reads — while a join's sleeve is the wall annulus,
 *     already covered by the wall parts' own boxes, and a hatch leaf is
 *     interactive geometry whose collision belongs to the M3-T5 state machine,
 *     so neither contributes a static box.
 *
 * Three measurements, one verdict (`collisionProblems`, `collisionTally`):
 *
 *  1. COMPLETENESS — one box per solid part of every module instance (rooms +
 *     the synthesized shaft band) and per generated solid seam part; a hint
 *     that under- or over-declares is a finding, never silently repaired.
 *  2. MATCH (§8 bullet 4) — every hull box against the world bounds of the
 *     visible geometry it stands for, in BOTH directions: `uncoveredM` (the
 *     geometry pokes out of the box — a walker could clip through the wall)
 *     and `excessM` (the box reaches past the geometry — an invisible wall).
 *     `max(uncovered, excess)` is the number the 10 cm cap is measured on.
 *  3. PASSAGE — no hull box may stand in a door-socket join's pass-through:
 *     the opening the two sockets share, extruded along the join normal from
 *     one `PASSAGE_REACH_M` before the near wall plane to one past the far
 *     one (the reach a generated seal may occupy, M3-T2's `SEAM_BITE_M`). A
 *     box may TOUCH the volume (a pier's face lies exactly on the opening
 *     edge) but not enter it beyond the kit's ±0.5 mm socket-authoring
 *     budget, or the deck's rooms are walled off from each other.
 *
 * Measured on the four canonical fixtures (see collision.test.ts): every deck
 * of every ship is complete, every deviation is 0.0 mm and every pass-through
 * is clear — the hull is derived from the same geometry it describes, so
 * bullet 4 passes on the QA rig too (its declared defects are alignment, run
 * and seam problems, not hull mismatches; the rig's odd decks move their kit
 * and their hull boxes together).
 */

import { MM } from '../types'
import type { Aabb3, ModuleSource } from '../types'
import { partBounds } from '../kit/parts'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import { worldSolidPartsOf } from './place'
import { joinLabel } from './joins'
import { SEAM_BITE_M, horizontalAxisOf, openingRectOf, rectIntersect } from './seams'
import type {
  DeckAssembly,
  DeckJoin,
  PlacedModule,
  PlacedPart,
  SeamPlan,
  ShipAssembly,
} from './types'

/**
 * PRD §8 bullet 4 cap: half of one player radius — the hull may differ from
 * the visible geometry it stands for by at most **10 cm**, per deck.
 */
export const COLLISION_MATCH_TOLERANCE_M = 0.1

/**
 * How far a pass-through reaches past each wall plane, meters: the reach a
 * generated seal may occupy (M3-T2's `SEAM_BITE_M`), so the volume spans both
 * doorways either side of the seam rather than being a zero-thickness plane.
 */
export const PASSAGE_REACH_M = SEAM_BITE_M

/**
 * Touching the pass-through is legal (a wall pier's face lies exactly on the
 * opening edge); entering it is not. The slack is the kit's socket-authoring
 * budget (±0.5 mm) — the same number every M0-T2 channel allows.
 */
const PASSAGE_EPS_M = SEAM_TOLERANCES.maxSocketAuthoringErrorMm * MM

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Meters → mm at 0.001 mm resolution for report strings. `x / MM` is float-
 * noisy (a decimal-summed 25 mm can render as `24.999999999999996`), so the
 * conversion is rounded ONCE here rather than per call site — the repo's mm
 * convention (src/validation/sockets.ts `toMm`).
 */
function mm(meters: number): number {
  return Math.round((meters / MM) * 1000) / 1000
}

/**
 * Deviations below a nanometre are the float noise of the two independent
 * bounds paths (`transformAabb` on the module's hint vs `partBounds` on the
 * placed part) rather than a hull mismatch: they are snapped to 0. That is
 * three orders under the report's 0.001 mm resolution and eight under the §8
 * cap, so no verdict can turn on it — but it keeps a "0.0 mm" report row
 * Object.is-clean for consumers (M3-T4/T5, M4) that compare it.
 */
const DEVIATION_EPS_M = 1e-9

/** Where one hull box came from. */
export type HullBoxOrigin = 'module' | 'seam'

/** One box of a deck's collision hull, with the geometry it must stand for. */
export interface HullBox {
  /** The world box the walker collides with, meters. */
  box: Aabb3
  /**
   * The solid visible geometry the box stands for. Absent = the hint declares
   * a box that nothing draws (an invisible wall — reported, never repaired).
   */
  part?: PlacedPart
  /** Which module instance authored it (a plug keeps its socket's owner). */
  source: ModuleSource
  /** 'module' = a module's own solid part; 'seam' = a generated plug. */
  origin: HullBoxOrigin
  /** Position of `part` within its origin's list (module solid parts / plan parts). */
  partIndex: number
  /** Id of the seam plan a generated box came from (absent for module boxes). */
  planId?: string
}

/** The two-way difference between a hull box and the geometry it stands for. */
export interface HullDeviation {
  /** How far the geometry pokes OUT of the box, meters (a clippable wall). */
  uncoveredM: number
  /** How far the box reaches BEYOND the geometry, meters (an invisible wall). */
  excessM: number
  /** `max(uncovered, excess)` — the number the §8 cap is measured on. */
  deviationM: number
}

/** A pass-through the walker uses at one door-socket join. */
export interface Passage {
  join: DeckJoin
  /** The shared opening, extruded along the join normal across both wall planes. */
  box: Aabb3
}

/** A hull box standing in a pass-through (the walker cannot get through). */
export interface PassageIntrusion {
  join: DeckJoin
  entry: HullBox
  /** How far the box reaches into the passage, meters. */
  depthM: number
}

/** Per-deck collision tallies for a report line. */
export interface DeckCollisionTally {
  deckIndex: number
  deckId: string
  /** Boxes from the modules' own hints (one per solid part). */
  moduleBoxes: number
  /** Boxes from generated solid seam parts (M3-T2's plugs). */
  seamBoxes: number
  boxes: number
  /** Joins whose pass-through the deck's hull must leave clear. */
  joins: number
  /** Largest hull-vs-geometry deviation on the deck, meters (§8 bullet 4). */
  maxDeviationM: number
  /** Largest intrusion of a hull box into a pass-through, meters. */
  maxIntrusionM: number
}

/** Ship-wide collision tallies (the per-deck rows plus their maxima). */
export interface CollisionTally {
  decks: DeckCollisionTally[]
  boxes: number
  moduleBoxes: number
  seamBoxes: number
  joins: number
  maxDeviationM: number
  maxIntrusionM: number
}

/** Human label for one hull box, e.g. `head#0 solid part 3`. */
export function hullLabel(entry: HullBox): string {
  const owner =
    entry.source.moduleIndex === -1
      ? `${entry.source.moduleId} band`
      : `${entry.source.moduleId}#${entry.source.moduleIndex}`
  return entry.origin === 'module'
    ? `${owner} solid part ${entry.partIndex}`
    : `generated plug ${entry.planId ?? '?'} (${owner})`
}

/**
 * The deck's hull, box by box, with the geometry each box stands for: the
 * modules' own hints placed (one box per solid part, in module order — rooms
 * then the synthesized shaft band), then the generated solid seam parts.
 */
export function deckHull(
  modules: readonly PlacedModule[],
  seams: readonly SeamPlan[],
): HullBox[] {
  const hull: HullBox[] = []
  for (const owner of modules) {
    const parts = worldSolidPartsOf(
      owner.module,
      owner.origin,
      owner.rotation,
      owner.source,
    )
    owner.boxes.forEach((box, index) => {
      hull.push({
        box,
        part: parts[index],
        source: owner.source,
        origin: 'module',
        partIndex: index,
      })
    })
  }
  for (const plan of seams) {
    if (plan.solid !== true) continue
    plan.parts.forEach((part, partIndex) => {
      hull.push({
        box: partBounds(part.part),
        part,
        source: part.source,
        origin: 'seam',
        partIndex,
        planId: plan.id,
      })
    })
  }
  return hull
}

/** The deck hull as the plain box list the scene graph's `CollisionHull` carries. */
export function deckHullBoxes(
  modules: readonly PlacedModule[],
  seams: readonly SeamPlan[],
): Aabb3[] {
  return deckHull(modules, seams).map((entry) => entry.box)
}

/** The visible geometry a module's own hint boxes must account for, in order. */
export function solidPartsOfModule(owner: PlacedModule): PlacedPart[] {
  return worldSolidPartsOf(owner.module, owner.origin, owner.rotation, owner.source)
}

/**
 * How far a hull box is from the visible geometry it stands for, both ways
 * (see `HullDeviation`). Exact for an unchanged box; the §8 cap is 0.1 m.
 */
export function hullDeviation(box: Aabb3, geometry: Aabb3): HullDeviation {
  let uncoveredM = 0
  let excessM = 0
  for (let axis = 0; axis < 3; axis++) {
    // The geometry pokes out of the box on either side (uncovered)…
    uncoveredM = Math.max(
      uncoveredM,
      box.min[axis] - geometry.min[axis],
      geometry.max[axis] - box.max[axis],
    )
    // …or the box reaches past the geometry on either side (excess).
    excessM = Math.max(
      excessM,
      geometry.min[axis] - box.min[axis],
      box.max[axis] - geometry.max[axis],
    )
  }
  uncoveredM = n0(uncoveredM < DEVIATION_EPS_M ? 0 : uncoveredM)
  excessM = n0(excessM < DEVIATION_EPS_M ? 0 : excessM)
  return {
    uncoveredM,
    excessM,
    deviationM: n0(Math.max(uncoveredM, excessM)),
  }
}

/**
 * How deeply two boxes interpenetrate, meters — the shallowest of the three
 * per-axis overlaps, so a positive number means real volumetric overlap
 * (touching faces give 0, separated boxes give a negative number).
 */
export function overlapDepth(a: Aabb3, b: Aabb3): number {
  let depth = Infinity
  for (let axis = 0; axis < 3; axis++) {
    depth = Math.min(
      depth,
      Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]),
    )
  }
  return depth
}

/** The pass-through one join opens, or undefined when its openings do not meet. */
export function passageAt(join: DeckJoin): Passage | undefined {
  const opening = rectIntersect(openingRectOf(join.a), openingRectOf(join.b))
  if (opening === undefined) return undefined
  // Every mating wall is vertical and axis-aligned (quarter-turn yaws keep
  // facings axial), so the plane's horizontal axis and the normal are the two
  // horizontal world axes, in some order.
  const horizontal = horizontalAxisOf(join.a.facing)
  const normal = horizontal === 0 ? 2 : 0
  const planes = [join.a.center[normal], join.b.center[normal]]
  const min: [number, number, number] = [0, 0, 0]
  const max: [number, number, number] = [0, 0, 0]
  min[horizontal] = n0(opening.uLo)
  max[horizontal] = n0(opening.uHi)
  min[1] = n0(opening.vLo)
  max[1] = n0(opening.vHi)
  min[normal] = n0(Math.min(...planes) - PASSAGE_REACH_M)
  max[normal] = n0(Math.max(...planes) + PASSAGE_REACH_M)
  return { join, box: { min, max } }
}

/** Every pass-through a deck's joins open (joins whose openings meet). */
export function passagesOf(joins: readonly DeckJoin[]): Passage[] {
  return joins
    .map(passageAt)
    .filter((passage): passage is Passage => passage !== undefined)
}

/** Hull boxes standing in a deck's pass-throughs (the walker is walled in). */
export function passageIntrusions(
  joins: readonly DeckJoin[],
  hull: readonly HullBox[],
): PassageIntrusion[] {
  const intrusions: PassageIntrusion[] = []
  for (const passage of passagesOf(joins)) {
    for (const entry of hull) {
      const depthM = overlapDepth(entry.box, passage.box)
      if (depthM > PASSAGE_EPS_M) {
        intrusions.push({ join: passage.join, entry, depthM })
      }
    }
  }
  return intrusions
}

/** The deck's own collision verdict: completeness, match, and passage. */
export function deckCollisionProblems(deck: DeckAssembly): string[] {
  const problems: string[] = []
  const where = `deck ${deck.deckIndex} ("${deck.deckId}")`
  const hull = deckHull(deck.modules, deck.seams)

  for (const owner of deck.modules) {
    const solid = solidPartsOfModule(owner)
    if (owner.boxes.length !== solid.length) {
      problems.push(
        `${where}: module "${owner.source.moduleId}"#${owner.source.moduleIndex} declares ` +
          `${owner.boxes.length} collision box(es) for ${solid.length} solid part(s) — the hull ` +
          `coordinates with the geometry it must cover`,
      )
    }
  }

  for (const entry of hull) {
    if (entry.part === undefined) {
      problems.push(
        `${where}: ${hullLabel(entry)} has no visible geometry — the hull's box ` +
          `coordinates with the kit's parts, not a phantom wall`,
      )
      continue
    }
    const deviation = hullDeviation(entry.box, partBounds(entry.part.part))
    if (deviation.deviationM > COLLISION_MATCH_TOLERANCE_M) {
      problems.push(
        `${where}: ${hullLabel(entry)} is ${mm(deviation.deviationM).toFixed(1)} mm off its ` +
          `visible geometry (uncovered ${mm(deviation.uncoveredM).toFixed(1)} mm / excess ` +
          `${mm(deviation.excessM).toFixed(1)} mm); the §8 cap is ≤ ` +
          `${mm(COLLISION_MATCH_TOLERANCE_M)} mm per deck`,
      )
    }
  }

  for (const intrusion of passageIntrusions(deck.joins, hull)) {
    problems.push(
      `${where}: ${hullLabel(intrusion.entry)} stands ` +
        `${mm(intrusion.depthM).toFixed(1)} mm inside the pass-through of ` +
        `${joinLabel(intrusion.join)} — the walker cannot pass`,
    )
  }

  return problems
}

/**
 * §8 bullet 4 problems as the ASSEMBLED ship sees them: every deck's hull must
 * be complete (one box per solid part, plus a box per generated plug), match
 * the visible geometry within 10 cm, and leave every join's pass-through clear.
 */
export function collisionProblems(ship: ShipAssembly): string[] {
  return ship.decks.flatMap((deck) => deckCollisionProblems(deck))
}

/** Per-deck collision tallies (boxes, joins, largest deviation + intrusion). */
export function deckCollisionTally(deck: DeckAssembly): DeckCollisionTally {
  const hull = deckHull(deck.modules, deck.seams)
  let maxDeviationM = 0
  for (const entry of hull) {
    if (entry.part === undefined) continue
    maxDeviationM = Math.max(
      maxDeviationM,
      hullDeviation(entry.box, partBounds(entry.part.part)).deviationM,
    )
  }
  const intrusions = passageIntrusions(deck.joins, hull)
  return {
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    moduleBoxes: hull.filter((entry) => entry.origin === 'module').length,
    seamBoxes: hull.filter((entry) => entry.origin === 'seam').length,
    boxes: hull.length,
    joins: deck.joins.length,
    maxDeviationM: n0(maxDeviationM),
    maxIntrusionM: n0(
      intrusions.reduce((max, intrusion) => Math.max(max, intrusion.depthM), 0),
    ),
  }
}

/** Ship-wide collision tallies: the per-deck rows plus their maxima. */
export function collisionTally(ship: ShipAssembly): CollisionTally {
  const decks = ship.decks.map(deckCollisionTally)
  return {
    decks,
    boxes: decks.reduce((sum, deck) => sum + deck.boxes, 0),
    moduleBoxes: decks.reduce((sum, deck) => sum + deck.moduleBoxes, 0),
    seamBoxes: decks.reduce((sum, deck) => sum + deck.seamBoxes, 0),
    joins: decks.reduce((sum, deck) => sum + deck.joins, 0),
    maxDeviationM: n0(
      decks.reduce((max, deck) => Math.max(max, deck.maxDeviationM), 0),
    ),
    maxIntrusionM: n0(
      decks.reduce((max, deck) => Math.max(max, deck.maxIntrusionM), 0),
    ),
  }
}
