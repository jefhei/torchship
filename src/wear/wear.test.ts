/**
 * M4-T4 — the worn-detail pass over the canonical ships.
 *
 * BUILD_PLAN M4-T4: "worn-detail pass: clutter, paint patches, cable routing
 * variation by seed" (PRD §6 seed control; PRD §10 rung 4 drops prop density).
 * Four things are pinned here, in the order the pass is built:
 *
 *  - the **seeded RNG** is machine-stable (same seed → same ship, different seed
 *    → different ship) and the mount/door/zone geometry the pass decorates is
 *    DERIVED (M4-T4 is not allowed to freehand a surface — BUILD_PLAN rule 8);
 *  - the **generator** honours the density rung as a ceiling, seeds every
 *    decision from the spec's seed plus the deck/module identity, never touches
 *    the shaft band, never draws the reserved `coffee-accent` slot, and keeps
 *    every floor prop under the M3-T4 walk-over step;
 *  - the **gate** (`wearProblems`, wired into `assemblyProblems` as rule 13)
 *    fires on a doctored plan for every rule it claims, and is empty on all
 *    four canonical ships — the QA rig included (its defects are spec geometry,
 *    not the wear pass);
 *  - the **ledger** (`wearReport`) measures the pass against the same ship
 *    assembled at density 'off', so the draw-call cost is a measurement.
 */

import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS } from '../types'
import type { Aabb3, MaterialSlot, Vec3 } from '../types'
import { partBounds } from '../kit/parts'
import { moduleBounds, moduleParts } from '../kit/modules/types'
import { AUTHORED_MODULES, getAuthoredModule } from '../kit/modules/registry'
import { SHIP_FIXTURES, getShipFixture } from '../fixtures'
import { assembleShip, assemblyProblems, collisionTally } from '../assembler'
import type { DeckAssembly, ShipAssembly, WearPlan } from '../assembler'
import { placedPartsOf } from '../assembler/assemble'
import { deckHull, wearSolidParts } from '../assembler/collision'
import { boxContains, transformAabb } from '../assembler/place'
import { STEP_HEIGHT_M } from '../player/move'
import {
  CABLE_CLAMPS_PER_DROP,
  CABLE_LIGHT_KINDS,
  CLUTTER_VARIANTS,
  DEFAULT_WEAR_DENSITY,
  PAINT_PATCH_VARIANTS,
  WEAR_CALLS_PER_DECK_MAX,
  WEAR_CONTACT_EPS_M,
  WEAR_DENSITY_LEVELS,
  WEAR_DENSITY_ORDER,
  WEAR_FACETS,
  WEAR_FLOOR_HEIGHT_MAX_M,
  WEAR_REPORT_FACETS,
  boxGap,
  boxUnion,
  chance,
  clamp,
  doorZoneBox,
  floorMountPartOf,
  intBetween,
  isWearDensity,
  moduleDoorZones,
  mulberry32,
  n0,
  overlapsAny,
  overlapsAnyBox,
  pick,
  planToMountGap,
  placedDoorZones,
  range,
  seedFor,
  spanAxisOf,
  vecByAxis,
  wallMountsOf,
  wearDrawCallDelta,
  wearPartsOf,
  wearPlanCount,
  wearPlansForDeck,
  wearPlansForModule,
  wearProblems,
  wearReport,
} from './index'

/* ---------- fixtures + helpers -------------------------------------- */

function shipOf(fixtureId: (typeof SHIP_FIXTURES)[number]['id']): ShipAssembly {
  const fixture = getShipFixture(fixtureId)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

const PATROL = shipOf('patrol')

/** Every canonical ship, assembled the way the app loads it. */
const ALL_SHIPS = SHIP_FIXTURES.map((fixture) => ({
  id: fixture.id,
  ship: shipOf(fixture.id),
}))

/** The findings that match a rule's wording — the gate's report surface. */
function matchingProblems(ship: ShipAssembly, pattern: RegExp): string[] {
  return wearProblems(ship).filter((problem) => pattern.test(problem))
}

/** Replace one deck's first wear plan with `patch(plan)` (a doctored ship). */
function replaceFirstPlan(
  ship: ShipAssembly,
  deckIndex: number,
  patch: (plan: WearPlan, deck: DeckAssembly) => WearPlan,
): ShipAssembly {
  const deck = ship.decks[deckIndex]
  return {
    ...ship,
    decks: ship.decks.map((candidate, index) =>
      index === deckIndex
        ? {
            ...candidate,
            wear: candidate.wear.map((plan, planIndex) =>
              planIndex === 0 ? patch(plan, deck) : plan,
            ),
          }
        : candidate,
    ),
  }
}

/** Replace one deck's FIRST wear plan matching `pick(plan)` (a doctored ship). */
function replaceFirstMatchingPlan(
  ship: ShipAssembly,
  deckIndex: number,
  pick: (plan: WearPlan, deck: DeckAssembly) => boolean,
  patch: (plan: WearPlan, deck: DeckAssembly) => WearPlan,
): ShipAssembly {
  const deck = ship.decks[deckIndex]
  let done = false
  return {
    ...ship,
    decks: ship.decks.map((candidate, index) => {
      if (index !== deckIndex) return candidate
      return {
        ...candidate,
        wear: candidate.wear.map((plan) => {
          if (done || !pick(plan, deck)) return plan
          done = true
          return patch(plan, deck)
        }),
      }
    }),
  }
}

/** A copy of a plan with every part pushed `delta` meters (world space). */
function shifted(plan: WearPlan, delta: Vec3): WearPlan {
  return {
    ...plan,
    parts: plan.parts.map((entry) => ({
      ...entry,
      part: {
        ...entry.part,
        position: [
          entry.part.position[0] + delta[0],
          entry.part.position[1] + delta[1],
          entry.part.position[2] + delta[2],
        ] as Vec3,
      },
    })),
  }
}

/** A copy of a plan whose parts all draw `slot` (an unknown / reserved slot). */
function reslotted(plan: WearPlan, slot: string): WearPlan {
  return {
    ...plan,
    parts: plan.parts.map((entry) => ({
      ...entry,
      materialSlot: slot as MaterialSlot,
    })),
  }
}

/** The world box of the module instance a plan decorates. */
function ownerBoundsOf(deck: DeckAssembly, plan: WearPlan): Aabb3 {
  const owner = deck.modules.find(
    (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
  )
  if (owner === undefined) throw new Error('no owner')
  return transformAabb(moduleBounds(owner.module), owner.origin, owner.rotation)
}

/* ---------- the seeded PRNG ----------------------------------------- */

describe('the seeded detail stream (M4-T4)', () => {
  it('mulberry32 is seed-stable and stays in [0, 1)', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    const c = mulberry32(1235)
    const first = [a(), a(), a(), a(), a()]
    expect([b(), b(), b(), b(), b()]).toEqual(first)
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true)
    expect([c(), c(), c(), c(), c()]).not.toEqual(first)
  })

  it('seedFor is a pure function of the base seed and its keys', () => {
    expect(seedFor(1, 'deck', 0, 'paint')).toBe(seedFor(1, 'deck', 0, 'paint'))
    expect(seedFor(1, 'deck', 0, 'paint')).not.toBe(seedFor(1, 'deck', 1, 'paint'))
    expect(seedFor(1, 'deck', 0, 'paint')).not.toBe(seedFor(1, 'deck', 0, 'cable'))
    expect(seedFor(1, 'a')).not.toBe(seedFor(2, 'a'))
    // Every stream is a 32-bit unsigned integer.
    for (const value of [seedFor(0, 'x'), seedFor(4294967295, 'y', 7)]) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(2 ** 32)
    }
  })

  it('range / intBetween / pick / chance / clamp / n0 behave as authored', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 500; i++) {
      const value = range(rng, -2, 3)
      expect(value).toBeGreaterThanOrEqual(-2)
      expect(value).toBeLessThan(3)
    }
    const hits = new Set<number>()
    for (let i = 0; i < 400; i++) {
      const value = intBetween(mulberry32(i), 0, 3)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(3)
      hits.add(value)
    }
    expect([...hits].sort()).toEqual([0, 1, 2, 3])
    expect(intBetween(mulberry32(1), 2, 1)).toBe(2)

    const items = ['a', 'b', 'c'] as const
    expect(items).toContain(pick(mulberry32(3), items))
    expect(() => pick(mulberry32(3), [])).toThrow(/no items/)
    expect(chance(() => 0.5, 0)).toBe(false)
    expect(chance(() => 0, 1)).toBe(true)
    expect(chance(() => 0, 0.5)).toBe(true)
    expect(chance(() => 0.75, 0.5)).toBe(false)
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(n0(-0)).toBe(0)
    expect(Object.is(n0(-0), 0)).toBe(true)
    expect(n0(3)).toBe(3)
  })

  it('vecByAxis builds a canonical vector by axis key (no signed zeros)', () => {
    expect(vecByAxis({ 0: 1, 2: -2 })).toEqual([1, 0, -2])
    expect(Object.is(vecByAxis({ 0: -0 })[0], 0)).toBe(true)
  })
})

/* ---------- the authored vocabulary ---------------------------------- */

describe('the authored worn-detail vocabulary (M4-T4)', () => {
  it('names the three PRD §6 facets in report order', () => {
    expect(WEAR_FACETS).toEqual(['paint', 'cable', 'clutter'])
    expect(WEAR_REPORT_FACETS).toEqual(WEAR_FACETS)
  })

  it('carries one quota triple per PRD §10 rung, densest first', () => {
    expect(WEAR_DENSITY_ORDER).toEqual(['full', 'reduced', 'off'])
    for (const rung of WEAR_DENSITY_ORDER) {
      expect(isWearDensity(rung)).toBe(true)
    }
    expect(isWearDensity('dense')).toBe(false)
    expect(DEFAULT_WEAR_DENSITY).toBe('full')
    expect(WEAR_DENSITY_LEVELS.off).toEqual({ paint: 0, cable: 0, clutter: 0 })
    const total = (rung: { paint: number; cable: number; clutter: number }) =>
      rung.paint + rung.cable + rung.clutter
    expect(total(WEAR_DENSITY_LEVELS.reduced)).toBeLessThan(
      total(WEAR_DENSITY_LEVELS.full),
    )
    for (const facet of WEAR_FACETS) {
      expect(WEAR_DENSITY_LEVELS.reduced[facet]).toBeLessThanOrEqual(
        WEAR_DENSITY_LEVELS.full[facet],
      )
    }
  })

  it('draws only authored §4 slots, and never the reserved warm accent', () => {
    const variants = [...PAINT_PATCH_VARIANTS, ...CLUTTER_VARIANTS]
    expect(variants.length).toBeGreaterThan(0)
    expect(new Set(variants.map((variant) => variant.id)).size).toBe(variants.length)
    for (const variant of variants) {
      expect(MATERIAL_SLOTS).toContain(variant.materialSlot)
      expect(variant.materialSlot).not.toBe('coffee-accent')
    }
    // The cable drop is wiring, not glass: panel fixtures only, conduit metal.
    expect(CABLE_LIGHT_KINDS).toEqual(['panel'])
  })

  it('keeps floor clutter under the M3-T4 walk-over step (pinned, not copied)', () => {
    expect(STEP_HEIGHT_M).toBe(0.25)
    expect(WEAR_FLOOR_HEIGHT_MAX_M).toBeLessThan(STEP_HEIGHT_M)
    // The tallest authored floor variant must fit under the cap too.
    for (const variant of CLUTTER_VARIANTS) {
      const height = variant.kind === 'box' ? variant.size[1] : variant.length
      expect(height).toBeLessThanOrEqual(WEAR_FLOOR_HEIGHT_MAX_M)
    }
  })

  it('keeps the cable mould count at one per drop (the frame-budget decision)', () => {
    expect(CABLE_CLAMPS_PER_DROP).toBe(1)
    expect(WEAR_CALLS_PER_DECK_MAX).toBe(8)
  })
})

/* ---------- the surfaces the pass decorates -------------------------- */

describe('the mount vocabulary is derived, never freehand (M4-T4)', () => {
  it('reads a module’s wall panels off its own bulkhead boxes', () => {
    const galley = getAuthoredModule('galley')
    const parts = moduleParts(galley)
    const mounts = wallMountsOf(galley)
    expect(mounts.length).toBeGreaterThan(0)
    for (const mount of mounts) {
      const part = parts[mount.partIndex]
      expect(part.materialSlot).toBe('bulkhead')
      const box = partBounds(part)
      // The recorded face is the panel's own inner face, and the inward
      // direction points at the module centre (M1-T2 authoring frame).
      const face =
        mount.inward === 1 ? box.max[mount.normalAxis] : box.min[mount.normalAxis]
      expect(mount.faceCoord).toBe(face)
      expect(Math.sign(mount.faceCoord)).toBe(-mount.inward)
      expect(mount.uHi).toBeGreaterThan(mount.uLo)
      expect(mount.vHi).toBeGreaterThan(mount.vLo)
    }
  })

  it('skips panels straddling the module centre and the shaft band’s wall cuts', () => {
    for (const module of AUTHORED_MODULES) {
      for (const mount of wallMountsOf(module)) {
        const box = partBounds(moduleParts(module)[mount.partIndex])
        const centre = (box.min[mount.normalAxis] + box.max[mount.normalAxis]) / 2
        expect(centre).not.toBe(0)
      }
    }
    // The band’s walls are cut into piers / a lintel around four doorways, so
    // nothing in it is a mountable panel (and the pass skips it anyway).
    expect(wallMountsOf(getAuthoredModule('spine'))).toEqual([])
  })

  it('names the deck plate a prop rests on (the widest deckplate with a top at y = 0)', () => {
    for (const module of AUTHORED_MODULES) {
      const index = floorMountPartOf(module)
      expect(index).toBeDefined()
      const box = partBounds(moduleParts(module)[index!])
      expect(box.max[1]).toBeCloseTo(0, 9)
      const area = (box.max[0] - box.min[0]) * (box.max[2] - box.min[2])
      for (const [i, part] of moduleParts(module).entries()) {
        if (part.materialSlot !== 'deckplate') continue
        const other = partBounds(part)
        if (Math.abs(other.max[1]) > 1e-9) continue
        const otherArea = (other.max[0] - other.min[0]) * (other.max[2] - other.min[2])
        expect(otherArea).toBeLessThanOrEqual(area)
        expect(i).toBeDefined()
      }
    }
  })

  it('derives a door keep-clear zone from the socket, extruded into the room', () => {
    const backWall = doorZoneBox(
      { center: [0, 1, -2.5], facing: '-z', width: 0.9, height: 2 },
      0.6,
      0.5,
    )
    // The opening grown laterally and vertically…
    expect(backWall.min[0]).toBeCloseTo(-0.45 - 0.5, 9)
    expect(backWall.max[0]).toBeCloseTo(0.45 + 0.5, 9)
    expect(backWall.min[1]).toBeCloseTo(1 - 1 - 0.5, 9)
    expect(backWall.max[1]).toBeCloseTo(1 + 1 + 0.5, 9)
    // …extruded from the socket plane INTO the room (−z socket → +z reach).
    expect(backWall.min[2]).toBeLessThan(-2.5)
    expect(backWall.max[2]).toBeCloseTo(-2.5 + 0.6, 9)

    const sideWall = doorZoneBox(
      { center: [2.25, 1.2, 0.6], facing: '+x', width: 0.8, height: 1.6 },
      0.6,
      0.5,
    )
    // Lateral extent is the opening grown (0.6 ± 0.4 ± 0.5)…
    expect(sideWall.min[2]).toBeCloseTo(0.6 - 0.4 - 0.5, 9)
    expect(sideWall.max[2]).toBeCloseTo(0.6 + 0.4 + 0.5, 9)
    // …the vertical extent is the opening grown (raised door: it starts below
    // the floor line, which is exactly why the zone is not clamped there)…
    expect(sideWall.min[1]).toBeCloseTo(1.2 - 0.8 - 0.5, 9)
    expect(sideWall.max[1]).toBeCloseTo(1.2 + 0.8 + 0.5, 9)
    // …and the normal extent runs from the socket plane 0.05 m outside it to
    // `reach` meters INTO the room (−x for a +x door).
    expect(sideWall.min[0]).toBeCloseTo(2.25 - 0.6, 9)
    expect(sideWall.max[0]).toBeCloseTo(2.25 + 0.05, 9)
  })

  it('zone helpers measure overlap, gaps and unions in meters', () => {
    const zone = doorZoneBox(
      { center: [0, 1, 0], facing: '+z', width: 1, height: 2 },
      1,
      0.2,
    )
    // In front of a +z door the room is on the −z side, so the zone reaches
    // 1 m in that direction — a box there is inside it.
    expect(zone.min[2]).toBeCloseTo(-1, 9)
    expect(zone.max[2]).toBeCloseTo(0.05, 9)
    const inside: Aabb3 = { min: [0, 1, -0.4], max: [0.2, 1.2, -0.2] }
    const outside: Aabb3 = { min: [9, 9, 9], max: [9.5, 9.5, 9.5] }
    expect(overlapsAny(inside, [zone], 0)).toBe(true)
    expect(overlapsAny(outside, [zone], 0)).toBe(false)
    expect(overlapsAnyBox(inside, [zone], 0)).toBe(true)
    expect(boxGap(outside, zone)).toBeGreaterThan(0)
    const touching: Aabb3 = { min: [-0.2, 0, 0.8], max: [0.2, 1, 1] }
    expect(boxGap(touching, { min: [-0.2, 0, 1], max: [0.2, 1, 2] })).toBeCloseTo(0, 12)
    expect(boxUnion(inside, outside)).toEqual({
      min: [0, 1, -0.4],
      max: [9.5, 9.5, 9.5],
    })
    // A box in the closed doorway but on the far side of the wall is clear.
    expect(overlapsAny({ min: [0, 1, 0.2], max: [0.2, 1.2, 0.4] }, [zone], 0)).toBe(
      false,
    )
    expect(spanAxisOf(0)).toBe(2)
    expect(spanAxisOf(2)).toBe(0)
  })

  it('builds one zone per door socket, module-local and placed', () => {
    const galley = getAuthoredModule('galley')
    const local = moduleDoorZones(galley, 0.6, 0.5)
    expect(local).toHaveLength(galley.manifest.doorSockets.length)
    const owner = PATROL.decks[1].modules.find(
      (candidate) => candidate.source.moduleId === 'galley',
    )
    expect(owner).toBeDefined()
    const placed = placedDoorZones(owner!.doors, 0.6, 0.5)
    expect(placed).toHaveLength(owner!.doors.length)
    expect(placed.every((zone) => zone.max[1] > zone.min[1])).toBe(true)
  })
})

/* ---------- the generated plans ------------------------------------- */

describe('the worn-detail generator (M4-T4)', () => {
  it('is seed-stable: the same spec always yields the same ship', () => {
    const spec = getShipFixture('patrol').spec
    const a = assembleShip(spec)
    const b = assembleShip(spec)
    expect(b.decks.map((deck) => deck.wear)).toEqual(a.decks.map((deck) => deck.wear))
  })

  it('varies with the spec’s seed (PRD §6 seed control)', () => {
    const spec = getShipFixture('patrol').spec
    const plans = (seed: number) =>
      assembleShip({ ...spec, seed }).decks.flatMap((deck) =>
        deck.wear.map(
          (plan) => `${plan.id}:${plan.variant}:${JSON.stringify(plan.parts)}`,
        ),
      )
    const first = plans(1)
    const second = plans(2)
    expect(first).not.toEqual(second)
    // Same seed, same output — the sort order is the spec's own.
    expect(plans(1)).toEqual(first)
  })

  it('honours the density rung as a ceiling (and off is the pre-pass ship)', () => {
    const spec = getShipFixture('patrol').spec
    const counts = (density: 'full' | 'reduced' | 'off') =>
      assembleShip(spec, { wearDensity: density }).decks.map((deck) => deck.wear.length)
    expect(counts('off')).toEqual([0, 0, 0, 0, 0])
    expect(counts('full')).toEqual([5, 6, 6, 6, 6])
    expect(counts('reduced')).toEqual([2, 3, 3, 3, 3])
  })

  it('never decorates the shaft band (it is structure, not a room)', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear) {
          const owner = deck.modules.find(
            (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
          )
          expect(owner).toBeDefined()
          expect(owner!.band).toBe(false)
        }
      }
    }
  })

  it('respects the per-module quota of its rung, facet by facet', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const owner of deck.modules.filter((candidate) => !candidate.band)) {
          const mine = deck.wear.filter(
            (plan) => plan.source.moduleIndex === owner.source.moduleIndex,
          )
          for (const facet of WEAR_FACETS) {
            expect(
              mine.filter((plan) => plan.facet === facet).length,
              `${deck.deckId} ${owner.source.moduleId} ${facet}`,
            ).toBeLessThanOrEqual(WEAR_DENSITY_LEVELS.full[facet])
          }
        }
      }
    }
  })

  it('places every plan on a real surface of the instance it decorates', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear) {
          const owner = deck.modules.find(
            (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
          )!
          expect(owner.parts[plan.mount.partIndex]).toBeDefined()
          if (plan.mount.kind === 'floor') {
            expect(plan.mount.backPartIndex).toBeDefined()
            expect(owner.parts[plan.mount.backPartIndex!]).toBeDefined()
          }
          // Mounted, never floating: the plan's geometry touches its mount.
          const gap = planToMountGap(
            plan.parts.map((entry) => entry.part),
            partBounds(owner.parts[plan.mount.partIndex].part),
          )
          expect(gap).toBeLessThanOrEqual(WEAR_CONTACT_EPS_M)
        }
      }
    }
  })

  it('keeps every generated part inside the module it decorates, and solid', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear) {
          expect(plan.solid).toBe(true)
          const bounds = ownerBoundsOf(deck, plan)
          const relaxed: Aabb3 = {
            min: [bounds.min[0] - 0.05, bounds.min[1] - 0.2, bounds.min[2] - 0.05],
            max: [bounds.max[0] + 0.05, bounds.max[1] + 0.05, bounds.max[2] + 0.05],
          }
          for (const entry of plan.parts) {
            expect(boxContains(relaxed, partBounds(entry.part), 0.05)).toBe(true)
          }
        }
      }
    }
  })

  it('never shades the galley’s warm accent and draws only kit slots', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear) {
          for (const entry of plan.parts) {
            expect(MATERIAL_SLOTS).toContain(entry.materialSlot)
            expect(entry.materialSlot).not.toBe('coffee-accent')
          }
          if (plan.facet === 'cable') {
            for (const entry of plan.parts) {
              expect(['conduit', 'bulkhead']).toContain(entry.materialSlot)
            }
          }
        }
      }
    }
  })

  it('stows every floor prop under the walker’s step, and on the deck plate', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear.filter(
          (candidate) => candidate.mount.kind === 'floor',
        )) {
          for (const entry of plan.parts) {
            const box = partBounds(entry.part)
            const height = box.max[1] - box.min[1]
            // The gate's own float tolerance…
            expect(height).toBeLessThanOrEqual(WEAR_FLOOR_HEIGHT_MAX_M + 1e-9)
            // …and the design bound it exists to protect (M3-T4).
            expect(height).toBeLessThan(STEP_HEIGHT_M)
            // Resting on the plate it declares as its mount: its base is flush
            // with that plate's top face (on the QA rig the deck's DECLARED
            // floor is deliberately off by 0.2 m — the rig's floor-pin defect —
            // so the mount, not the spec, is the surface a prop stands on).
            const owner = deck.modules.find(
              (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
            )!
            const plate = partBounds(owner.parts[plan.mount.partIndex].part)
            expect(box.min[1]).toBeCloseTo(plate.max[1], 9)
          }
        }
      }
    }
  })

  it('names an authored variant for every plan', () => {
    const authored = new Set([
      ...PAINT_PATCH_VARIANTS.map((variant) => variant.id),
      ...CLUTTER_VARIANTS.map((variant) => variant.id),
      'cable-drop',
    ])
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        for (const plan of deck.wear) {
          expect(authored).toContain(plan.variant)
          expect(plan.id).toMatch(
            new RegExp(
              `^deck-${deck.deckIndex}-wear-${plan.source.moduleIndex}-${plan.facet}-\\d+$`,
            ),
          )
        }
      }
    }
  })

  it('re-derives a deck’s plans from the deck alone (deck identity in the seed)', () => {
    const deck = PATROL.decks[1]
    const seed = PATROL.spec.seed
    const again = wearPlansForDeck(
      deck.modules,
      deck.deckIndex,
      deck.deckId,
      seed,
      'full',
    )
    expect(again).toEqual(deck.wear)
    const module = deck.modules.find((candidate) => !candidate.band)!
    const mine = wearPlansForModule(module, deck.deckIndex, deck.deckId, seed, 'full')
    expect(
      deck.wear.filter((plan) => plan.source.moduleIndex === module.source.moduleIndex),
    ).toEqual(mine)
    expect(wearPlanCount(deck)).toBe(deck.wear.length)
  })

  it('folds the same plan for the same module on a different deck index', () => {
    // The stream includes the deck index, so a repeated module type on another
    // deck is not a carbon copy of the first one.
    const spec = getShipFixture('long-haul').spec
    const ship = assembleShip(spec)
    const cargoA = ship.decks[4].wear.map((plan) => JSON.stringify(plan.parts))
    const cargoB = ship.decks[5].wear.map((plan) => JSON.stringify(plan.parts))
    expect(cargoA.length).toBeGreaterThan(0)
    expect(cargoA).not.toEqual(cargoB)
  })

  it('is part of the deck’s geometry partition and the hull (M3-T1 / M3-T3 cross-pin)', () => {
    for (const { ship } of ALL_SHIPS) {
      for (const deck of ship.decks) {
        const wear = wearPartsOf(deck)
        expect(wear.length).toBe(
          deck.wear.reduce((sum, plan) => sum + plan.parts.length, 0),
        )
        const placed = placedPartsOf(deck)
        for (const entry of wear) expect(placed).toContain(entry)
        const hullWear = deckHull(deck.modules, deck.seams, deck.wear).filter(
          (entry) => entry.origin === 'wear',
        )
        expect(hullWear.map((entry) => entry.part)).toEqual(wearSolidParts(deck))
        expect(deck.node.collision.boxes).toContainEqual(hullWear[0].box)
      }
    }
  })
})

/* ---------- the gate: positive -------------------------------------- */

describe('the wear gate is clean on every canonical ship (M4-T4)', () => {
  it('reports no problems on the three real ships or the QA rig', () => {
    for (const { id, ship } of ALL_SHIPS) {
      expect(wearProblems(ship), id).toEqual([])
    }
  })

  it('keeps the pass inside its per-deck draw-call budget (measured)', () => {
    for (const { id, ship } of ALL_SHIPS) {
      const delta = wearDrawCallDelta(ship)
      for (const row of delta.rows) {
        expect(row.addedCalls, `${id} ${row.deckId}`).toBeLessThanOrEqual(
          WEAR_CALLS_PER_DECK_MAX,
        )
        expect(row.addedCalls).toBe(row.calls - row.callsWithoutWear)
      }
      expect(delta.addedCalls).toBe(delta.withWear - delta.withoutWear)
    }
  })

  it('rides the assembler gate (rule 13) instead of shadowing it', () => {
    for (const { ship } of ALL_SHIPS) {
      const wear = wearProblems(ship)
      for (const problem of wear) expect(assemblyProblems(ship)).toContain(problem)
    }
  })
})

/* ---------- the gate: every rule fires on a doctored plan ------------ */

describe('the wear gate measures the emitted geometry (M4-T4)', () => {
  it('catches a duplicated plan id', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan, deck) => ({
      ...plan,
      id: deck.wear[1].id,
    }))
    expect(matchingProblems(doctored, /wear plan id is duplicated/)).toHaveLength(1)
  })

  it('catches an unknown facet, an unnamed variant and an empty plan', () => {
    expect(
      matchingProblems(
        replaceFirstPlan(PATROL, 1, (plan) => ({ ...plan, facet: 'rust' as never })),
        /unknown facet "rust"/,
      ),
    ).toHaveLength(1)
    expect(
      matchingProblems(
        replaceFirstPlan(PATROL, 1, (plan) => ({ ...plan, variant: '  ' })),
        /no authored variant named/,
      ),
    ).toHaveLength(1)
    expect(
      matchingProblems(
        replaceFirstPlan(PATROL, 1, (plan) => ({ ...plan, parts: [] })),
        /generated no parts/,
      ),
    ).toHaveLength(1)
  })

  it('catches a plan that names a module instance the deck does not host', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan) => ({
      ...plan,
      source: { ...plan.source, moduleId: 'warp-core', moduleIndex: 9 },
    }))
    expect(
      matchingProblems(
        doctored,
        /names module "warp-core"#9, which is not on this deck/,
      ),
    ).toHaveLength(1)
  })

  it('catches an unknown §4 slot and the reserved warm accent', () => {
    expect(
      matchingProblems(
        replaceFirstPlan(PATROL, 1, (plan) => reslotted(plan, 'unobtainium')),
        /part draws unknown §4 slot "unobtainium"/,
      ),
    ).toHaveLength(1)
    expect(
      matchingProblems(
        replaceFirstPlan(PATROL, 1, (plan) => reslotted(plan, 'coffee-accent')),
        /draws the coffee-accent slot — PRD §4 reserves the warm accent/,
      ),
    ).toHaveLength(1)
  })

  it('catches a degenerate part box', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan) => ({
      ...plan,
      parts: plan.parts.map((entry) =>
        entry.part.kind === 'box'
          ? { ...entry, part: { ...entry.part, size: [-0.2, 0.2, 0.2] as Vec3 } }
          : entry,
      ),
    }))
    expect(matchingProblems(doctored, /part has a degenerate box/)).toHaveLength(1)
  })

  it('catches floating detail and the wall it should have been mounted on', () => {
    // 0.5 m along every axis: the normal axis alone is enough to break the
    // flush contact a wall detail is required to keep.
    const doctored = replaceFirstPlan(PATROL, 1, (plan) =>
      shifted(plan, [0.5, 0.5, 0.5]),
    )
    expect(
      matchingProblems(
        doctored,
        /stands 500\.0 mm off the wall panel it is mounted on \(part \d+\)/,
      ),
    ).toHaveLength(1)
    // A plan whose declared mount index is not a part of the instance.
    const badIndex = replaceFirstPlan(PATROL, 1, (plan) => ({
      ...plan,
      mount: { ...plan.mount, partIndex: 9999 },
    }))
    expect(
      matchingProblems(badIndex, /mount part 9999 is not a part of "galley"#0/),
    ).toHaveLength(1)
  })

  it('catches detail standing in the room that is not marked solid', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan) => ({ ...plan, solid: false }))
    expect(
      matchingProblems(doctored, /is not solid but stands in the room's interior/),
    ).toHaveLength(1)
  })

  it('catches a part that reaches outside the module it decorates', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan) => shifted(plan, [20, 0, 0]))
    expect(
      matchingProblems(
        doctored,
        /reaches outside the world bounds of module "galley"#0/,
      ),
    ).toHaveLength(1)
  })

  it('catches geometry overlapping something it is not mounted on', () => {
    // A plan’s part dropped on top of the module’s own kit geometry (never on
    // the panel it declares as its mount, which is allowed to touch).
    const doctored = replaceFirstPlan(PATROL, 1, (plan, deck) => {
      const owner = deck.modules.find(
        (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
      )!
      const obstacle = owner.parts.find(
        (entry, index) =>
          entry.materialSlot === 'bulkhead' &&
          index !== plan.mount.partIndex &&
          index !== plan.mount.backPartIndex,
      )!
      const box = partBounds(obstacle.part)
      const centre: Vec3 = [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      ]
      return {
        ...plan,
        parts: plan.parts.map((entry) => ({
          ...entry,
          part: { ...entry.part, position: centre },
        })),
      }
    })
    expect(
      matchingProblems(doctored, /part overlaps .*kit geometry by .* mm/),
    ).toHaveLength(1)
  })

  it('catches detail standing in a doorway’s keep-clear zone', () => {
    const doctored = replaceFirstPlan(PATROL, 1, (plan, deck) => {
      const owner = deck.modules.find(
        (candidate) => candidate.source.moduleIndex === plan.source.moduleIndex,
      )!
      const door = owner.doors[0]
      return {
        ...plan,
        parts: plan.parts.map((entry) => ({
          ...entry,
          part: {
            ...entry.part,
            position: [door.center[0], door.center[1], door.center[2]] as Vec3,
          },
        })),
      }
    })
    expect(
      matchingProblems(doctored, /stands in a door's keep-clear zone/),
    ).toHaveLength(1)
  })

  it('catches a floor prop over the walk-over cap', () => {
    const grown = replaceFirstMatchingPlan(
      PATROL,
      1,
      (plan) => plan.mount.kind === 'floor' && plan.parts[0].part.kind === 'box',
      (plan) => ({
        ...plan,
        parts: plan.parts.map((entry) =>
          entry.part.kind === 'box'
            ? { ...entry, part: { ...entry.part, size: [0.3, 0.6, 0.3] as Vec3 } }
            : entry,
        ),
      }),
    )
    expect(
      matchingProblems(
        grown,
        /600\.0 mm tall — floor clutter must stay under the 220\.0 mm walk-over cap/,
      ),
    ).toHaveLength(1)
    // The canonical ship's own floor props are all under it (positive control).
    expect(matchingProblems(PATROL, /walk-over cap/)).toEqual([])
  })

  it('catches a per-deck budget overrun, measured against the pass-off ship', () => {
    const cost = wearDrawCallDelta(PATROL)
    const doctored = {
      ...cost,
      rows: cost.rows.map((row, index) =>
        index === 0 ? { ...row, addedCalls: WEAR_CALLS_PER_DECK_MAX + 1 } : row,
      ),
    }
    expect(wearProblems(PATROL, doctored)).toEqual([
      `deck 0 ("head") pays ${WEAR_CALLS_PER_DECK_MAX + 1} draw call(s) for its worn detail — ` +
        `over the ${WEAR_CALLS_PER_DECK_MAX}-call per-deck budget (drop the density rung, PRD §10)`,
    ])
  })

  it('never throws on a broken ship — findings are data', () => {
    const deck = PATROL.decks[0]
    const hostile: ShipAssembly = {
      ...PATROL,
      decks: PATROL.decks.map((candidate) =>
        candidate === deck
          ? { ...candidate, wear: [{ ...deck.wear[0], parts: [], solid: false }] }
          : candidate,
      ),
    }
    expect(() => wearProblems(hostile)).not.toThrow()
    expect(wearProblems(hostile).length).toBeGreaterThan(0)
  })
})

/* ---------- the ledger --------------------------------------------- */

describe('the worn-detail report measures the pass (M4-T4)', () => {
  it('pins Patrol’s measured plan / part / cost ledger', () => {
    const report = wearReport(PATROL)
    expect(report.ship).toBe('Firebrand')
    expect(report.seed).toBe(PATROL.spec.seed)
    expect(report.density).toBe('full')
    expect(report.quota).toEqual(WEAR_DENSITY_LEVELS.full)
    expect(report.plans).toBe(29)
    expect(report.parts).toBe(36)
    expect(report.byFacet).toEqual({ paint: 10, cable: 4, clutter: 15 })
    expect(report.variants).toEqual([
      'cable-coil',
      'cable-drop',
      'repaint',
      'spares-crate',
      'strap-bundle',
      'tool-case',
      'touchup',
      'warning',
    ])
    expect(report.withWear).toBe(186)
    expect(report.withoutWear).toBe(179)
    expect(report.addedCalls).toBe(7)
    expect(report.ceiling).toBe(250)
    expect(report.headroom).toBe(64)
    expect(report.problems).toEqual([])
    expect(report.decks.map((row) => [row.deckId, row.addedCalls])).toEqual([
      ['head', 2],
      ['crew', 1],
      ['ops', 0],
      ['engineering', 2],
      ['aft', 2],
    ])
    expect(report.detail).toBe(
      'Firebrand (seed 1, density "full"): 29 worn-detail plan(s) / 36 part(s) over 5 ' +
        'deck(s) (10 paint + 4 cable + 15 clutter); the pass costs 7 draw call(s) (186 ' +
        'with it, 179 without) against the 250-call ceiling, headroom 64',
    )
  })

  it('is the pre-M4-T4 ship at density off (the baseline the cost is measured on)', () => {
    const bare = assembleShip(getShipFixture('patrol').spec, { wearDensity: 'off' })
    const report = wearReport(bare)
    expect(report.density).toBe('off')
    expect(report.plans).toBe(0)
    expect(report.parts).toBe(0)
    expect(report.byFacet).toEqual({ paint: 0, cable: 0, clutter: 0 })
    expect(report.variants).toEqual([])
    expect(report.addedCalls).toBe(0)
    expect(report.withWear).toBe(report.withoutWear)
    expect(report.problems).toEqual([])
    // The same ship with the pass off is exactly what wearDrawCallDelta uses.
    expect(report.withWear).toBe(wearDrawCallDelta(PATROL).withoutWear)
    expect(collisionTally(bare).wearBoxes).toBe(0)
  })

  it('reports the same per-deck rows the collision tally and draw calls see', () => {
    const report = wearReport(PATROL)
    const tally = collisionTally(PATROL)
    expect(report.decks.map((row) => row.deckId)).toEqual(
      tally.decks.map((row) => row.deckId),
    )
    for (const row of report.decks) {
      const deck = PATROL.decks[row.deckIndex]
      expect(row.plans).toBe(deck.wear.length)
      expect(row.parts).toBe(wearPartsOf(deck).length)
      expect(row.callsWithoutWear).toBeLessThanOrEqual(row.calls)
    }
    // Every wear hull box IS the geometry it stands for: zero drift to report.
    for (const deck of PATROL.decks) {
      for (const entry of deckHull(deck.modules, deck.seams, deck.wear).filter(
        (row) => row.origin === 'wear',
      )) {
        expect(entry.box).toEqual(partBounds(entry.part!.part))
      }
    }
  })
})
