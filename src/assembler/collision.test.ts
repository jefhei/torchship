/**
 * M3-T3 — collision hull tests (BUILD_PLAN M3-T3 "Collision hulls per deck
 * (from module collision hints)" + PRD §8 bullet 4: "**[auto]** Collision hull
 * matches visible geometry within `[10 cm]` per deck").
 *
 * The claims pinned here, in order:
 *  - COMPOSITION: the deck hull is the modules' OWN hints placed, in module
 *    order (rooms then the synthesized shaft band), plus one box per generated
 *    solid seam part — the blanking plugs M3-T2 emits for the sockets nothing
 *    else seals (`seamSolidParts` reads the same predicate). The node's
 *    `collision.boxes` IS that list, in that order;
 *  - PAIRING: every module hint box is paired with the placed solid part it
 *    stands for, and the deviation measured between them is 0.000 mm on every
 *    deck of every canonical fixture (the hint is authored as the part's own
 *    bounds, so the hull can only drift if a placement frame breaks);
 *  - THE MEASUREMENT: `hullDeviation` is two-way — `uncoveredM` (the geometry
 *    pokes out: a clippable wall) and `excessM` (the box reaches past it: an
 *    invisible wall) — and a 200 mm drift trips the 10 cm cap, while the
 *    canonical kit stays clean (the check is not fixture-shaped);
 *  - PASS-THROUGH: every join opens one passage volume and every canonical
 *    fixture leaves all of them clear of hull boxes; a hull box standing in a
 *    doorway (a hatch leaf marked solid, the exact hazard the M2 authoring
 *    rule avoids) is caught with its measured depth;
 *  - THE RIG: the QA rig's hull is clean too — its declared defects are
 *    alignment, run and seam problems, not hull mismatches (its kit and its
 *    hull boxes move together);
 *  - THE GATE: `assemblyProblems` surfaces the same verdict, and the §8
 *    bullet-4 invariant check (src/invariants/checks.ts) reads exactly it.
 */

import { describe, expect, it } from 'vitest'
import { MM, deckFloorYFor } from '../types'
import type { Aabb3, DeckSpec, ShipSpec, Vec3 } from '../types'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_SPEC,
  atSpine,
} from '../fixtures'
import type { RoomModuleId } from '../fixtures'
import { AUTHORED_MODULES } from '../kit/modules/registry'
import type { AuthoredModule } from '../kit/modules/types'
import { assemblyParts, moduleSolidParts } from '../kit/modules/types'
import { partBounds, partsBounds } from '../kit/parts'
import {
  COLLISION_MATCH_TOLERANCE_M,
  PASSAGE_REACH_M,
  assembleShip,
  assemblyProblems,
  collisionProblems,
  collisionTally,
  deckCollisionTally,
  deckHull,
  deckHullBoxes,
  hullDeviation,
  overlapDepth,
  passageIntrusions,
  passagesOf,
  seamSolidParts,
} from './index'

/* ---------- helpers ------------------------------------------------ */

/** A synthetic deck: one room module of the given type at its spine pose. */
function deckOf(id: string, moduleId: RoomModuleId, index: number): DeckSpec {
  return {
    id,
    label: `${id} deck`,
    yPosition: deckFloorYFor(index),
    modules: [atSpine(moduleId)],
  }
}

/** A synthetic three-deck ship: head → crew (galley) → engineering. */
const MINI_SPEC: ShipSpec = {
  classId: 'hound',
  name: 'Mini',
  registry: 'MINI-3',
  seed: 0,
  decks: [
    deckOf('d0', 'head', 0),
    deckOf('d1', 'galley', 1),
    deckOf('d2', 'engineering', 2),
  ],
}

/** The authored kit with ONE manifest mutated (the failure-injection hook). */
function kitWith(
  moduleId: string,
  mutate: (module: AuthoredModule) => AuthoredModule,
): AuthoredModule[] {
  return AUTHORED_MODULES.map((module) =>
    module.manifest.id === moduleId ? mutate(module) : module,
  )
}

/** The head's first hint box grown 0.2 m in +x — a hull that outruns its part. */
function kitWithDriftedHeadHint(): AuthoredModule[] {
  return kitWith('head', (module) => ({
    ...module,
    manifest: {
      ...module.manifest,
      collisionHint: {
        boxes: module.manifest.collisionHint.boxes.map((box, index) =>
          index === 0
            ? {
                min: box.min,
                max: [box.max[0] + 0.2, box.max[1], box.max[2]] as Vec3,
              }
            : box,
        ),
      },
    },
  }))
}

/**
 * The head's collision hint with the socket hatch's OWN bounds appended: the
 * box the M2 "one box per SOLID part" rule forbids (a hatch leaf is not solid)
 * and the exact hazard the pass-through check exists for — a box standing in
 * the doorway the spine join opens.
 */
function kitWithHeadDoorwayBox(): AuthoredModule[] {
  return kitWith('head', (module) => {
    const hatch = module.assemblies.find((assembly) => assembly.id === 'hatch-spine')
    const extra = hatch === undefined ? [] : [partsBounds(assemblyParts(hatch))]
    return {
      ...module,
      manifest: {
        ...module.manifest,
        collisionHint: {
          boxes: [...module.manifest.collisionHint.boxes, ...extra],
        },
      },
    }
  })
}

/** A world box from two corners (test convenience). */
function box(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Aabb3 {
  return { min: [...min] as Vec3, max: [...max] as Vec3 }
}

/* ---------- composition -------------------------------------------- */

describe('the deck hull (M3-T3)', () => {
  it('is the modules\u2019 own hints placed, then the generated plugs', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      for (const deck of ship.decks) {
        const hull = deckHull(deck.modules, deck.seams)
        const moduleEntries = hull.filter((entry) => entry.origin === 'module')
        const seamEntries = hull.filter((entry) => entry.origin === 'seam')

        // The module half is every placed hint, in module order (rooms then band).
        expect(moduleEntries.map((entry) => entry.box)).toEqual(
          deck.modules.flatMap((owner) => owner.boxes),
        )
        expect(moduleEntries.map((entry) => entry.source.moduleId)).toEqual(
          deck.modules.flatMap((owner) => owner.boxes.map(() => owner.source.moduleId)),
        )
        // The generated half is exactly the solid seam parts (M3-T2's predicate).
        expect(seamEntries.map((entry) => entry.part)).toEqual(seamSolidParts(deck))
        expect(
          seamEntries.every((entry) =>
            entry.planId?.startsWith(`deck-${deck.deckIndex}-seam-`),
          ),
        ).toBe(true)
        // The node carries that hull, box for box, in that order.
        expect(deckHullBoxes(deck.modules, deck.seams)).toEqual(
          deck.node.collision.boxes,
        )
        expect(hull.map((entry) => entry.box)).toEqual(deck.node.collision.boxes)
      }
    }
  })

  it('pairs every module hint box with the placed solid part it stands for', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      for (const deck of ship.decks) {
        const hull = deckHull(deck.modules, deck.seams)
        for (const owner of deck.modules) {
          const entries = hull.filter(
            (entry) =>
              entry.origin === 'module' &&
              entry.source.moduleId === owner.source.moduleId &&
              entry.source.moduleIndex === owner.source.moduleIndex,
          )
          expect(entries).toHaveLength(moduleSolidParts(owner.module).length)
          entries.forEach((entry, index) => {
            expect(entry.part).toBeDefined()
            expect(entry.partIndex).toBe(index)
            // The box is the part's own world bounds: measured deviation 0.000 mm.
            const deviation = hullDeviation(entry.box, partBounds(entry.part!.part))
            expect(deviation.uncoveredM).toBe(0)
            expect(deviation.excessM).toBe(0)
            expect(deviation.deviationM).toBe(0)
          })
        }
      }
    }
  })

  it('boxes the plugs M3-T2 generated through the wall of each blanked doorway', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const deck of ship.decks) {
      const plugPlans = deck.seams.filter((plan) => plan.sealedBy === 'plug')
      // Every deck's band presents three faces no room lands on.
      expect(plugPlans).toHaveLength(3)
      const hull = deckHull(deck.modules, deck.seams)
      for (const plan of plugPlans) {
        expect(plan.solid).toBe(true)
        const entry = hull.find((candidate) => candidate.planId === plan.id)
        expect(entry).toBeDefined()
        const entryBox = entry!.box
        const horizontal = plan.opening.horizontal
        const normal = horizontal === 0 ? 2 : 0
        const plane = plan.doors[0].center[normal]
        // The plug blocks the whole opening…
        expect(entryBox.min[horizontal]).toBeLessThanOrEqual(plan.opening.uLo)
        expect(entryBox.max[horizontal]).toBeGreaterThanOrEqual(plan.opening.uHi)
        expect(entryBox.min[1]).toBeLessThanOrEqual(plan.opening.vLo)
        expect(entryBox.max[1]).toBeGreaterThanOrEqual(plan.opening.vHi)
        // …through the wall it sits in (both faces, plus the M3-T2 bite).
        expect(entryBox.min[normal]).toBeLessThan(plane)
        expect(entryBox.max[normal]).toBeGreaterThan(plane)
      }
    }
  })

  it('counts one box per solid part + plug, deck by deck (Patrol measured)', () => {
    const tally = collisionTally(assembleShip(PATROL_SPEC))
    expect(tally.decks.map((deck) => deck.moduleBoxes)).toEqual([65, 82, 67, 79, 130])
    expect(tally.decks.map((deck) => deck.seamBoxes)).toEqual([3, 3, 3, 3, 3])
    expect(tally.decks.map((deck) => deck.boxes)).toEqual([68, 85, 70, 82, 133])
    expect(tally.boxes).toBe(438)
    expect(tally.moduleBoxes).toBe(423)
    expect(tally.seamBoxes).toBe(15)
    expect(tally.joins).toBe(5)
    // The other two real ships, for scale.
    expect(collisionTally(assembleShip(LONG_HAUL_SPEC)).boxes).toBe(571)
    expect(collisionTally(assembleShip(SCIENCE_SPEC)).boxes).toBe(375)
  })
})

/* ---------- the §8 bullet-4 measurement ----------------------------- */

describe('the §8 bullet-4 measurement', () => {
  it('is two-way: uncovered (clippable wall) and excess (invisible wall)', () => {
    const hullBox = box([0, 0, 0], [1, 1, 1])
    expect(hullDeviation(hullBox, hullBox)).toEqual({
      uncoveredM: 0,
      excessM: 0,
      deviationM: 0,
    })
    // Geometry 0.2 m wider than its box: the walker would clip through it.
    const wider = hullDeviation(hullBox, box([0, 0, 0], [1.2, 1, 1]))
    expect(wider.uncoveredM).toBeCloseTo(0.2, 9)
    expect(wider.excessM).toBe(0)
    expect(wider.deviationM).toBeCloseTo(0.2, 9)
    // A box 50 mm larger than its geometry: an invisible wall.
    const larger = hullDeviation(hullBox, box([0.05, 0, 0], [1, 1, 1]))
    expect(larger.uncoveredM).toBe(0)
    expect(larger.excessM).toBeCloseTo(0.05, 9)
    expect(larger.deviationM).toBeCloseTo(0.05, 9)
    // Both directions are measured on every axis, not just X.
    expect(hullDeviation(hullBox, box([0, 0, 0], [1, 1, 1.3])).uncoveredM).toBeCloseTo(
      0.3,
      9,
    )
  })

  it('measures real interpenetration, not touching or separation', () => {
    const a = box([0, 0, 0], [1, 1, 1])
    expect(overlapDepth(a, a)).toBeCloseTo(1, 9)
    expect(overlapDepth(box([1, 0, 0], [2, 1, 1]), a)).toBe(0)
    expect(overlapDepth(box([1.5, 0, 0], [2, 1, 1]), a)).toBeCloseTo(-0.5, 9)
  })

  it('reports 0.0 mm deviation and no problems on every fixture deck', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      expect(collisionProblems(ship)).toEqual([])
      const tally = collisionTally(ship)
      expect(tally.maxDeviationM).toBe(0)
      expect(tally.maxIntrusionM).toBe(0)
      for (const deck of ship.decks) {
        expect(deckCollisionTally(deck).maxDeviationM).toBe(0)
      }
    }
  })

  it('fails a kit whose hint box drifts 200 mm off the geometry it stands for', () => {
    const broken = assembleShip(MINI_SPEC, {
      modules: kitWithDriftedHeadHint(),
      requireValidSpec: false,
    })
    const report = collisionProblems(broken).join('\n')
    expect(report).toMatch(
      /head#0 solid part 0 is 200\.0 mm off its visible geometry \(uncovered 0\.0 mm \/ excess 200\.0 mm\)/,
    )
    expect(report).toMatch(/the §8 cap is ≤ 100 mm per deck/)
    expect(report).toContain('deck 0 ("d0")')
    // …while the canonical kit on the same spec is clean: not a tautology.
    expect(
      collisionProblems(assembleShip(MINI_SPEC, { requireValidSpec: false })),
    ).toEqual([])
  })

  it('reports a hint that over-declares a box nothing draws', () => {
    const extra: Aabb3 = box([0, 1, 0], [0.5, 1.5, 0.5])
    const broken = assembleShip(MINI_SPEC, {
      modules: kitWith('head', (module) => ({
        ...module,
        manifest: {
          ...module.manifest,
          collisionHint: {
            boxes: [...module.manifest.collisionHint.boxes, extra],
          },
        },
      })),
      requireValidSpec: false,
    })
    const report = collisionProblems(broken).join('\n')
    expect(report).toMatch(/declares 38 collision box\(es\) for 37 solid part\(s\)/)
    expect(report).toMatch(/head#0 solid part 37 has no visible geometry/)
    expect(report).toMatch(/phantom wall/)
  })

  it('keeps the §8 cap a 10 cm constant', () => {
    expect(COLLISION_MATCH_TOLERANCE_M).toBe(0.1)
    expect(COLLISION_MATCH_TOLERANCE_M / MM).toBe(100)
  })
})

/* ---------- pass-through clearance ---------------------------------- */

describe('pass-through clearance', () => {
  it('opens one volume per join and leaves them all clear', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, {
        requireValidSpec: fixture.expectValid,
      })
      for (const deck of ship.decks) {
        const hull = deckHull(deck.modules, deck.seams)
        expect(passagesOf(deck.joins)).toHaveLength(deck.joins.length)
        expect(passageIntrusions(deck.joins, hull)).toEqual([])
      }
    }
  })

  it('spans the shared opening across both wall planes (Patrol deck 0)', () => {
    const deck = assembleShip(PATROL_SPEC).decks[0]
    const passages = passagesOf(deck.joins)
    expect(passages).toHaveLength(1)
    const passage = passages[0]
    expect(passage.join.kind).toBe('spine')
    // The standard 0.9 × 2.0 doorway, sill on the deck floor, centred on the shaft.
    expect(passage.box.min[0]).toBeCloseTo(-0.45, 9)
    expect(passage.box.max[0]).toBeCloseTo(0.45, 9)
    expect(passage.box.min[1]).toBeCloseTo(deck.floorY, 9)
    expect(passage.box.max[1]).toBeCloseTo(deck.floorY + 2.0, 9)
    // Both wall faces meet at the shaft face (z = 0.7), plus the seal's reach.
    expect(passage.box.min[2]).toBeCloseTo(0.7 - PASSAGE_REACH_M, 9)
    expect(passage.box.max[2]).toBeCloseTo(0.7 + PASSAGE_REACH_M, 9)
    expect(PASSAGE_REACH_M).toBe(0.03)
  })

  it('catches a hull box standing in a doorway (the hatch\u2019s own bounds)', () => {
    const ship = assembleShip(PATROL_SPEC, {
      modules: kitWithHeadDoorwayBox(),
      requireValidSpec: false,
    })
    const deck = ship.decks[0]
    const intrusions = passageIntrusions(deck.joins, deckHull(deck.modules, deck.seams))
    expect(intrusions).toHaveLength(1)
    // The leaf (frame included) is 75 mm thick, centred on the socket plane:
    // it swallows the whole 60 mm reach of the pass-through volume.
    expect(intrusions[0].depthM).toBeCloseTo(0.06, 3)
    const report = collisionProblems(ship).join('\n')
    expect(report).toMatch(
      /head#0 solid part 37 stands 60\.0 mm inside the pass-through of spine band "\+z" ↔ head#0 "spine-door"/,
    )
    expect(report).toMatch(/the walker cannot pass/)
    // The phantom box draws nothing, and the hint over-declares by one.
    expect(report).toMatch(/head#0 solid part 37 has no visible geometry/)
    expect(report).toMatch(/declares 38 collision box\(es\) for 37 solid part\(s\)/)
    // The canonical head — no box in the doorway — passes: not a tautology.
    expect(collisionProblems(assembleShip(PATROL_SPEC))).toEqual([])
  })

  it('reports a hint that leaves a solid part unhulled (completeness)', () => {
    const broken = assembleShip(MINI_SPEC, {
      modules: kitWith('head', (module) => ({
        ...module,
        manifest: {
          ...module.manifest,
          collisionHint: {
            boxes: module.manifest.collisionHint.boxes.slice(0, -1),
          },
        },
      })),
      requireValidSpec: false,
    })
    const problems = collisionProblems(broken)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(
      /declares 36 collision box\(es\) for 37 solid part\(s\) — the hull coordinates with the geometry it must cover/,
    )
  })
})

/* ---------- the gate + the rig -------------------------------------- */

describe('the collision verdict surface', () => {
  it('is what the assembly gate surfaces (M3-T3 rule 7 + rule 11)', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      expect(collisionProblems(ship)).toEqual([])
      expect(assemblyProblems(ship)).toEqual([])
    }
    const broken = assembleShip(MINI_SPEC, {
      modules: kitWithDriftedHeadHint(),
      requireValidSpec: false,
    })
    expect(assemblyProblems(broken).join('\n')).toMatch(
      /head#0 solid part 0 is 200\.0 mm off its visible geometry/,
    )
  })

  it('passes bullet 4 on the QA rig: its defects are elsewhere', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    expect(collisionProblems(rig)).toEqual([])
    const tally = collisionTally(rig)
    expect(tally.maxDeviationM).toBe(0)
    expect(tally.maxIntrusionM).toBe(0)
    // The rig's DECLARED defects are still visible in the assembly view…
    const report = assemblyProblems(rig).join('\n')
    expect(report).toMatch(/open seam of 10\.0 mm/)
    expect(report).toMatch(/spine join is off by normal 10\.0/)
    expect(report).toMatch(/the shaft run steps 50\.0 mm between/)
    // …and every deck of it hulls cleanly (the kit and its hull move together).
    expect(tally.decks.every((deck) => deck.maxDeviationM === 0)).toBe(true)
  })
})
