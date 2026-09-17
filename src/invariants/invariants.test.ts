/**
 * M0-T6 — [auto] invariant harness tests (PRD §8) against the fixtures.
 *
 * Pins (BUILD_PLAN M0-T6 gate "invariant test harness runs"):
 *  - the registry declares exactly the six §8 [auto] invariants in §8
 *    order, with tolerances pinned to the M0-T2 measured constants
 *    (SEAM_TOLERANCES — no drift allowed) and an owner milestone per
 *    bullet;
 *  - the spec-level analysis measures the M0-T2 channels (lateral /
 *    vertical / normal-gap deviations at the spine door) exactly, incl.
 *    the stress rig's declared defect magnitudes (10 / 25 / 200 mm) and
 *    the 50 mm off-grid deck floor;
 *  - the live checks PASS on the three real ships and FAIL the stress rig
 *    at the declared decks: hatch-alignment (socket-resolved, LIVE at
 *    M1-T3), spine-connectivity and spawn-inside spec facet (live since
 *    M0-T6), room-lit (live at M2-T7 over the authored kit's light sockets);
 *  - stub invariants (seams-watertight, collision-match) are declared
 *    targets: the harness reports them 'deferred' with their owning
 *    milestone — the input they need (assembled geometry, collision hulls)
 *    does not exist until M3-T2 / M3-T3 land;
 *  - the harness runs over all four fixtures without throwing and returns
 *    attributable runs (fixture × invariant).
 *
 * Synthetic mini-specs prove the checks are real logic, not fixture-shaped
 * tautologies: a broken two-deck spec fails where its canonical twin passes.
 */

import { describe, expect, it } from 'vitest'
import {
  AUTO_INVARIANTS,
  INVARIANT_IDS,
  LIVE_CHECKS,
  checkHatchAlignment,
  checkRoomLit,
  checkSpineConnectivity,
  checkSpawnInsideSpec,
  deckGridErrorMm,
  deckHosts,
  deckSeatSummary,
  findDeckHosting,
  getAutoInvariant,
  isSeatedWithinHatch,
  liveInvariants,
  moduleSeatProblems,
  roomLightTally,
  roomLitProblems,
  runsForInvariant,
  runInvariant,
  runInvariantById,
  runInvariantHarness,
  runInvariantHarnessAll,
  spineSeatDeviationMm,
  stubInvariants,
} from '../invariants'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_SPEC,
  atSpine,
  expectValidFixtures,
  getShipFixture,
  spineAttachOffsetZ,
} from '../fixtures'
import type { RoomModuleId } from '../fixtures'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import { deckFloorYFor } from '../types'
import type { DeckSpec, KitManifest, ModuleRef, ShipSpec } from '../types'
import { AUTHORED_KIT } from '../kit/modules/registry'

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

/** A synthetic ship whose decks are room-per-deck on the canonical grid. */
function miniSpec(roomPerDeck: RoomModuleId[]): ShipSpec {
  return {
    classId: 'hound',
    name: 'Mini',
    registry: 'MINI-1',
    seed: 0,
    decks: roomPerDeck.map((moduleId, i) => deckOf(`d${i}`, moduleId, i)),
  }
}

/** The canonical mini-ship the synthetic tests start from (head→crew→engineering). */
const CANONICAL_THREE = miniSpec(['head', 'galley', 'engineering'])

/** Expected run-status rows: [seams, hatch, spine, collision, spawn, lit]. */
const REAL_SHIP_ROW = ['deferred', 'pass', 'pass', 'deferred', 'pass', 'pass'] as const

/* ---------- registry ----------------------------------------------- */

describe('invariant registry (PRD §8 [auto])', () => {
  it('declares the six §8 [auto] invariants in §8 order, one per bullet', () => {
    expect(AUTO_INVARIANTS).toHaveLength(6)
    expect(AUTO_INVARIANTS.map((x) => x.id)).toEqual([...INVARIANT_IDS])
    expect(AUTO_INVARIANTS.map((x) => x.bullet)).toEqual([1, 2, 3, 4, 5, 6])
    // One §8 bullet per invariant, exactly.
    expect(new Set(AUTO_INVARIANTS.map((x) => x.bullet)).size).toBe(6)
  })

  it('pins the seam/hatch tolerances to the M0-T2 measured constants', () => {
    const byId = (id: string) => getAutoInvariant(id as never)
    expect(byId('seams-watertight').limit).toEqual({
      value: SEAM_TOLERANCES.watertightGapMm,
      unit: 'mm',
      relation: '<',
    })
    expect(byId('hatch-alignment').limit).toEqual({
      value: SEAM_TOLERANCES.hatchAlignMm,
      unit: 'mm',
      relation: '<=',
    })
    expect(byId('collision-match').limit).toEqual({
      value: 0.1,
      unit: 'm',
      relation: '<=',
    })
    expect(byId('room-lit').limit).toEqual({ value: 1, unit: 'count', relation: '>=' })
    // §8 watertight is strictly-under; hatch may touch the cap (mirrors
    // withinWatertight / withinHatchAlign in the spike tolerances).
    expect(SEAM_TOLERANCES.watertightGapMm).toBe(2)
    expect(SEAM_TOLERANCES.hatchAlignMm).toBe(5)
  })

  it('marks the four checks with real bodies live and the other two as stubs', () => {
    expect(liveInvariants().map((x) => x.id)).toEqual([
      'hatch-alignment',
      'spine-connectivity',
      'spawn-inside',
      'room-lit',
    ])
    expect(stubInvariants().map((x) => x.id)).toEqual([
      'seams-watertight',
      'collision-match',
    ])
  })

  it('assigns each invariant the milestone that owns its real check', () => {
    const ownerOf = (id: string) => getAutoInvariant(id as never).owner
    expect(ownerOf('seams-watertight')).toBe('M3-T2') // assembler geometry test
    expect(ownerOf('hatch-alignment')).toBe('M1-T3') // spec validator (kit sockets)
    expect(ownerOf('spine-connectivity')).toBe('M1-T3') // socket-resolved graph refines M0-T6 live check
    expect(ownerOf('collision-match')).toBe('M3-T3')
    expect(ownerOf('spawn-inside')).toBe('M3-T6')
    expect(ownerOf('room-lit')).toBe('M2-T7')
  })

  it('gives every invariant a title, requirement, and stub-target detail', () => {
    for (const inv of AUTO_INVARIANTS) {
      expect(inv.title.length).toBeGreaterThan(0)
      expect(inv.requirement.length).toBeGreaterThan(0)
    }
    for (const stub of stubInvariants()) {
      expect(stub.needs?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('wires a live check for every live invariant and none for stubs', () => {
    const liveIds = new Set(liveInvariants().map((x) => x.id))
    const checkIds = new Set(Object.keys(LIVE_CHECKS))
    expect(checkIds).toEqual(liveIds)
    expect(getAutoInvariant).toThrow(/no PRD/)
  })

  it('getAutoInvariant finds each id and throws on unknown ids', () => {
    for (const id of INVARIANT_IDS) {
      expect(getAutoInvariant(id).id).toBe(id)
    }
    expect(() => getAutoInvariant('spineless' as never)).toThrow(/no PRD/)
  })
})

/* ---------- spec analysis ------------------------------------------ */

describe('spec-level seat analysis (M0-T2 channels)', () => {
  it('measures canonical atSpine refs at 0.000 mm on every channel', () => {
    for (const f of expectValidFixtures()) {
      for (const deck of f.spec.decks) {
        for (const ref of deck.modules) {
          const dev = spineSeatDeviationMm(ref)
          expect(dev).not.toBeNull()
          expect(dev!.lateralMm).toBe(0)
          expect(dev!.verticalMm).toBe(0)
          expect(dev!.faceGapMm).toBe(0)
        }
      }
    }
  })

  it('measures the stress rig defect magnitudes exactly (10 / 25 / 200 mm)', () => {
    const rig1 = STRESS_SPEC.decks[1].modules[0] // 10 mm proud of the spine face
    const dev1 = spineSeatDeviationMm(rig1)!
    expect(dev1.faceGapMm).toBe(10)
    expect(dev1.faceGapSignedMm).toBeGreaterThan(0)

    const rig2 = STRESS_SPEC.decks[2].modules[0] // 25 mm lateral
    expect(spineSeatDeviationMm(rig2)!.lateralMm).toBe(25)

    const rig4 = STRESS_SPEC.decks[4].modules[0] // 0.2 m floor-pin drift
    expect(spineSeatDeviationMm(rig4)!.verticalMm).toBe(200)
  })

  it('does not attribute rotated or non-room refs (M1-T3 resolver territory)', () => {
    const rotated: ModuleRef = { moduleId: 'galley', rotation: 1, offset: [0, 0, 0] }
    expect(spineSeatDeviationMm(rotated)).toBeNull()
    expect(
      spineSeatDeviationMm({ moduleId: 'spine', rotation: 0, offset: [0, 0, 0] }),
    ).toBeNull()
  })

  it('seats within the 5 mm hatch cap and rejects beyond it', () => {
    const zero = spineSeatDeviationMm(atSpine('galley'))!
    expect(isSeatedWithinHatch(zero)).toBe(true)
    // The hatch cap is inclusive (≤ 5 mm) — measured relation from M0-T2.
    expect(
      isSeatedWithinHatch({
        lateralMm: 5,
        verticalMm: 0,
        faceGapMm: 0,
        faceGapSignedMm: 0,
      }),
    ).toBe(true)
    expect(
      isSeatedWithinHatch({
        lateralMm: 0,
        verticalMm: 0,
        faceGapMm: 5.001,
        faceGapSignedMm: 5.001,
      }),
    ).toBe(false)
  })

  it('reports per-module seat problems only when a channel exceeds the cap', () => {
    expect(moduleSeatProblems(atSpine('galley'))).toEqual([])
    const rig2 = STRESS_SPEC.decks[2].modules[0]
    expect(moduleSeatProblems(rig2).join(' ')).toMatch(
      /25\.0 mm off the spine socket center laterally/,
    )
    const rig1 = STRESS_SPEC.decks[1].modules[0]
    expect(moduleSeatProblems(rig1).join(' ')).toMatch(
      /10\.0 mm proud of the spine \+z face/,
    )
    expect(
      moduleSeatProblems({ moduleId: 'ops', rotation: 2, offset: [0, 0, 0] })[0],
    ).toMatch(/rotation 2/)
  })

  it('seats every real-ship deck and flags the failing stress decks', () => {
    for (const f of expectValidFixtures()) {
      f.spec.decks.forEach((deck, i) => {
        const s = deckSeatSummary(deck, i)
        expect(s.seated).toBe(true)
        expect(s.problems).toEqual([])
      })
    }
    const failing = [1, 2, 4] // rig-1 (10 mm gap), rig-2 (25 mm lateral), rig-4 (0.2 m drift)
    STRESS_SPEC.decks.forEach((deck, i) => {
      expect(deckSeatSummary(deck, i).seated).toBe(!failing.includes(i))
    })
  })

  it('measures deck-grid errors: 0 on canonical floors, 50 mm on rig-4', () => {
    PATROL_SPEC.decks.forEach((deck, i) => {
      expect(deckGridErrorMm(deck, i)).toBe(0)
    })
    expect(deckGridErrorMm(STRESS_SPEC.decks[4], 4)).toBe(50)
  })

  it('finds decks hosting a module type', () => {
    expect(deckHosts(PATROL_SPEC.decks[0], 'head')).toBe(true)
    expect(deckHosts(PATROL_SPEC.decks[1], 'galley')).toBe(true)
    expect(findDeckHosting(PATROL_SPEC, 'engineering')).toBe(3)
    expect(findDeckHosting(PATROL_SPEC, 'head')).toBe(0)
    expect(findDeckHosting(PATROL_SPEC, 'galley')).toBe(1)
    expect(findDeckHosting(PATROL_SPEC, 'storage')).toBe(4)
    expect(findDeckHosting(PATROL_SPEC, 'ops')).toBe(2)
    expect(findDeckHosting(PATROL_SPEC, 'spine' as never)).toBe(-1)
  })
})

/* ---------- live checks over the canonical fixtures ----------------- */

describe('live checks on the canonical fixtures', () => {
  it('spine-connectivity passes on the three real ships', () => {
    const result = checkSpineConnectivity(PATROL_SPEC)
    expect(result.status).toBe('pass')
    expect(result.detail).toMatch(/continuous across all 5 decks/)
    expect(result.detail).toContain('crew (deck 1) → head (deck 0)')
    expect(result.detail).toContain('engineering (deck 3)')
    expect(checkSpineConnectivity(LONG_HAUL_SPEC).status).toBe('pass')
    expect(checkSpineConnectivity(SCIENCE_SPEC).status).toBe('pass')
  })

  it('spine-connectivity fails the stress rig at the declared defect decks', () => {
    const result = checkSpineConnectivity(STRESS_SPEC)
    expect(result.status).toBe('fail')
    // rig-1: 10 mm door-face gap; rig-2: 25 mm lateral; rig-4: 200 mm drift
    // + the 50 mm off-grid floor stepping the run.
    expect(result.detail).toContain('rig-1')
    expect(result.detail).toMatch(/10\.0 mm proud/)
    expect(result.detail).toContain('rig-2')
    expect(result.detail).toMatch(/25\.0 mm off the spine socket center/)
    expect(result.detail).toContain('rig-4')
    expect(result.detail).toMatch(/200\.0 mm off the standard 1\.0 m height/)
    expect(result.detail).toMatch(/50\.0 mm off the canonical grid/)
  })

  it('hatch-alignment (socket-resolved) passes the real ships', () => {
    for (const f of expectValidFixtures()) {
      const result = checkHatchAlignment(f.spec)
      expect(result.status).toBe('pass')
      expect(result.detail).toMatch(
        /room spine-doors land on their deck spine-band sockets/,
      )
      expect(result.detail).toMatch(/side socket/)
      expect(result.detail).toMatch(/blanked/)
    }
    // Patrol: 5 rooms → 5 spine doors landed; 4 side sockets legally blanked.
    expect(checkHatchAlignment(PATROL_SPEC).detail).toMatch(/all 5 room spine-doors/)
    expect(checkHatchAlignment(PATROL_SPEC).detail).toMatch(/4 side sockets unjoined/)
  })

  it('hatch-alignment fails the stress rig at every defect deck', () => {
    const result = checkHatchAlignment(STRESS_SPEC)
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('rig-1') // 10 mm proud (open seam)
    expect(result.detail).toContain('rig-2') // 25 mm lateral
    expect(result.detail).toContain('rig-3') // 200 mm high-hatch step pair
    expect(result.detail).toMatch(/200\.0 mm vertically \(door-center step\)/)
    expect(result.detail).toContain('rig-4') // 200 mm floor-pin drift
    // The control deck is never the problem.
    expect(result.detail).not.toContain('rig-0')
  })

  it('spawn-inside (spec facet) passes on the real ships', () => {
    for (const f of expectValidFixtures()) {
      const result = checkSpawnInsideSpec(f.spec)
      expect(result.status).toBe('pass')
      expect(result.detail).toMatch(/hosts a galley seated on the spine band/)
    }
  })

  it('spawn-inside fails the stress rig (no galley crew deck at index 1)', () => {
    const result = checkSpawnInsideSpec(STRESS_SPEC)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(
      /crew\/spawn deck \(index 1, "rig-1"\) does not host a galley/,
    )
  })
})

/* ---------- synthetic ships: the checks are real logic -------------- */

describe('live checks on synthetic mini-specs (not fixture-shaped)', () => {
  it('passes a canonical head+galley+engineering ship', () => {
    const result = checkSpineConnectivity(CANONICAL_THREE)
    expect(result.status).toBe('pass')
    expect(result.detail).toMatch(/continuous across all 3 decks/)
    expect(result.detail).toContain('engineering (deck 2)')
    expect(checkSpawnInsideSpec(CANONICAL_THREE).status).toBe('pass')
    expect(checkHatchAlignment(CANONICAL_THREE).status).toBe('pass')
  })

  it('hatch-alignment fails when a spine door is pushed off its band socket', () => {
    const pushed: ShipSpec = {
      ...CANONICAL_THREE,
      decks: [
        CANONICAL_THREE.decks[0],
        {
          ...CANONICAL_THREE.decks[1],
          modules: [
            {
              moduleId: 'galley',
              rotation: 0,
              offset: [25e-3, 0, spineAttachOffsetZ('galley')],
            },
          ],
        },
        CANONICAL_THREE.decks[2],
      ],
    }
    const result = checkHatchAlignment(pushed)
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('galley#0')
    expect(result.detail).toMatch(/25\.0 mm off the spine socket center laterally/)
  })

  it('fails when the crew-deck galley is pushed 25 mm laterally off the spine', () => {
    const broken: ShipSpec = {
      ...CANONICAL_THREE,
      decks: [
        CANONICAL_THREE.decks[0],
        {
          ...CANONICAL_THREE.decks[1],
          modules: [
            {
              moduleId: 'galley',
              rotation: 0,
              offset: [25e-3, 0, spineAttachOffsetZ('galley')],
            },
          ],
        },
        CANONICAL_THREE.decks[2],
      ],
    }
    const spine = checkSpineConnectivity(broken)
    expect(spine.status).toBe('fail')
    expect(spine.detail).toContain('galley spine-door center is 25.0 mm off')
    const spawn = checkSpawnInsideSpec(broken)
    expect(spawn.status).toBe('fail')
    expect(spawn.detail).toMatch(/spawn deck galley is not seated at the spine foot/)
  })

  it('fails when deck 0 does not host the head (no head endpoint)', () => {
    const headless = miniSpec(['galley', 'galley'])
    const result = checkSpineConnectivity(headless)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/deck 0 \(d0\) does not host the head module/)
  })

  it('fails when the crew deck at index 1 is missing entirely', () => {
    const single = miniSpec(['head'])
    const spine = checkSpineConnectivity(single)
    expect(spine.status).toBe('fail')
    expect(spine.detail).toMatch(/no crew deck at index 1/)
    const spawn = checkSpawnInsideSpec(single)
    expect(spawn.status).toBe('fail')
    expect(spawn.detail).toContain('the crew/spawn deck (index 1')
  })

  it('fails when no deck hosts engineering (no engineering endpoint)', () => {
    const noEng = miniSpec(['head', 'galley', 'ops'])
    const result = checkSpineConnectivity(noEng)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/no deck hosts an engineering module/)
  })

  it('fails when a deck floor steps off the canonical grid', () => {
    const offGrid: ShipSpec = {
      ...CANONICAL_THREE,
      decks: [
        CANONICAL_THREE.decks[0],
        { ...CANONICAL_THREE.decks[1], yPosition: deckFloorYFor(1) + 50e-3 },
        CANONICAL_THREE.decks[2],
      ],
    }
    const result = checkSpineConnectivity(offGrid)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/50\.0 mm off the canonical grid/)
  })
})

/* ---------- room-lit (live at M2-T7) -------------------------------- */

describe('room-lit live check (PRD §8 bullet 6, live at M2-T7)', () => {
  it('passes on all four fixtures: every module instance carries a fixture', () => {
    for (const fixture of SHIP_FIXTURES) {
      const result = checkRoomLit(fixture.spec)
      expect(result.status).toBe('pass')
      expect(result.detail).toMatch(/no spec-dark rooms/)
      expect(result.detail).toContain('authored kit (M2-T7)')
    }
  })

  it('counts instances as spec refs plus the implicit per-deck shaft band', () => {
    const tally = roomLightTally(PATROL_SPEC)
    const refs = PATROL_SPEC.decks.reduce((n, deck) => n + deck.modules.length, 0)
    expect(tally.roomInstances).toBe(refs)
    expect(tally.bands).toBe(PATROL_SPEC.decks.length)
    // The shaft bands carry their own panel lights, so the total exceeds the refs.
    expect(tally.fixtures).toBeGreaterThan(tally.roomInstances)
    expect(checkRoomLit(PATROL_SPEC).detail).toContain(`${refs} room instances`)
  })

  it('fails a spec whose module type the authored kit does not know', () => {
    const unknown: ShipSpec = {
      ...CANONICAL_THREE,
      decks: [
        CANONICAL_THREE.decks[0],
        {
          ...CANONICAL_THREE.decks[1],
          modules: [{ moduleId: 'cargo', rotation: 0, offset: [0, 0, 0] }],
        },
        CANONICAL_THREE.decks[2],
      ],
    }
    const result = checkRoomLit(unknown)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/module "cargo" is not in the kit/)
  })

  it('fails a spec with no module instances at all', () => {
    const empty: ShipSpec = {
      ...CANONICAL_THREE,
      decks: [{ ...CANONICAL_THREE.decks[0], modules: [] }],
    }
    const result = checkRoomLit(empty)
    expect(result.status).toBe('fail')
    expect(result.detail).toMatch(/no module instances/)
  })

  it('fails a dark module and a dark shaft band (kit injected)', () => {
    const dark = (id: string): KitManifest => ({
      modules: AUTHORED_KIT.modules.map((module) =>
        module.id === id ? { ...module, lightSockets: [] } : module,
      ),
    })
    expect(roomLitProblems(CANONICAL_THREE, dark('galley')).join('; ')).toMatch(
      /module "galley" has no light socket/,
    )
    expect(roomLitProblems(CANONICAL_THREE, dark('spine')).join('; ')).toMatch(
      /shaft band \("spine"\) has no light socket/,
    )
    // The canonical kit lights the same spec cleanly — the check is not tautological.
    expect(roomLitProblems(CANONICAL_THREE, AUTHORED_KIT)).toEqual([])
  })
})

/* ---------- harness over the fixtures -------------------------------- */

describe('invariant harness', () => {
  it('returns six attributable runs per fixture, in §8 order, no throws', () => {
    for (const fixture of SHIP_FIXTURES) {
      const runs = runInvariantHarness(fixture)
      expect(runs).toHaveLength(6)
      expect(runs.map((r) => r.invariantId)).toEqual([...INVARIANT_IDS])
      for (const run of runs) {
        expect(run.fixtureId).toBe(fixture.id)
        expect(['pass', 'fail', 'deferred']).toContain(run.status)
        expect(run.detail.length).toBeGreaterThan(0)
      }
    }
  })

  it('real ships: seams/collision deferred; hatch+spine+spawn+lit pass', () => {
    for (const fixture of expectValidFixtures()) {
      const runs = runInvariantHarness(fixture)
      expect(runs.map((r) => r.status)).toEqual([...REAL_SHIP_ROW])
    }
  })

  it('stress rig: hatch/spine/spawn fail; seams/collision deferred, lit passes', () => {
    const runs = runInvariantHarness(getShipFixture('stress'))
    expect(runs.map((r) => r.status)).toEqual([
      'deferred', // seams-watertight — the 10 mm open seam is M3-T2's assembled check
      'fail', // hatch-alignment — socket-resolved (M1-T3): rig-1/2/3/4 all fail
      'fail', // spine-connectivity — live spec-level run continuity
      'deferred',
      'fail', // spawn-inside — no crew deck at index 1
      'pass', // room-lit — live at M2-T7; the rig's defects are geometry, not lighting
    ])
  })

  it('deferred runs name the owning milestone and the missing input', () => {
    const owners: Record<string, string> = {
      'seams-watertight': 'M3-T2',
      'collision-match': 'M3-T3',
    }
    for (const [invariantId, owner] of Object.entries(owners)) {
      for (const fixture of SHIP_FIXTURES) {
        const run = runInvariant(getAutoInvariant(invariantId as never), fixture)
        expect(run.status).toBe('deferred')
        expect(run.detail).toContain(owner)
        expect(run.detail).toMatch(/declared target/)
      }
    }
  })

  it('the full harness is 24 runs; per-invariant columns split valid/invalid', () => {
    expect(runInvariantHarnessAll()).toHaveLength(24)
    const hatchRuns = runsForInvariant('hatch-alignment')
    expect(hatchRuns).toHaveLength(4)
    expect(hatchRuns.filter((r) => r.status === 'pass')).toHaveLength(3)
    expect(hatchRuns.filter((r) => r.status === 'fail')).toHaveLength(1)
    const spineRuns = runsForInvariant('spine-connectivity')
    expect(spineRuns).toHaveLength(4)
    expect(spineRuns.filter((r) => r.status === 'pass')).toHaveLength(3)
    expect(spineRuns.filter((r) => r.status === 'fail')).toHaveLength(1)
    expect(runInvariantById('hatch-alignment', 'patrol').status).toBe('pass')
    expect(runInvariantById('hatch-alignment', 'stress').status).toBe('fail')
    expect(runInvariantById('spine-connectivity', 'stress').status).toBe('fail')
    expect(runInvariantById('spawn-inside', 'patrol').status).toBe('pass')
  })

  it('fixture registry order and spec identity are untouched by the harness', () => {
    expect(SHIP_FIXTURES.map((f) => f.id)).toEqual([
      'patrol',
      'long-haul',
      'science',
      'stress',
    ])
    expect(SHIP_FIXTURES[0].spec).toBe(PATROL_SPEC)
    expect(SHIP_FIXTURES[1].spec).toBe(LONG_HAUL_SPEC)
    expect(SHIP_FIXTURES[2].spec).toBe(SCIENCE_SPEC)
    expect(SHIP_FIXTURES[3].spec).toBe(STRESS_SPEC)
  })
})
