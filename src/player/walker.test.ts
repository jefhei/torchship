import { describe, expect, it } from 'vitest'
import { COLLISION_MATCH_TOLERANCE_M, assembleShip } from '../assembler'
import { LONG_HAUL_SPEC, PATROL_SPEC, SCIENCE_SPEC } from '../fixtures'
import { DECK_PITCH_M, MM } from '../types'
import type { Aabb3 } from '../types'
import { impactSpeedMps } from './gravity'
import {
  blockingBoxes,
  distanceToBoxXZ,
  hullBounds,
  shapeFor,
  supportHeightAt,
} from './hull'
import { EYE_HEIGHT_M, STEP_HEIGHT_M, WALK_SPEED_M_S } from './move'
import {
  deckIndexAtY,
  deckLevelAtY,
  spawnWalker,
  stepWalker,
  walkerWorldOf,
  type WalkerCommand,
  type WalkerState,
  type WalkerWorld,
} from './walker'

const DT = 0.05

const assembly = assembleShip(PATROL_SPEC)
const patrol = walkerWorldOf(assembly)
const crewDeck = assembly.decks[1]
const galley = crewDeck.modules.find((owner) => !owner.band)
if (galley === undefined) {
  throw new Error('walker.test: the crew deck has no room module')
}
const GALLEY_FEET = galley.origin
const CREW_FLOOR_Y = crewDeck.floorY
const GALLEY_HALF_X = 2.1
const PLAYER_RADIUS = shapeFor(false).radius
const DEEPEST_DECK = patrol.decks[patrol.decks.length - 1]

/** A command with the keys held as given; everything else neutral. */
function command(overrides: Partial<WalkerCommand> = {}): WalkerCommand {
  return {
    input: { forward: 0, strafe: 0 },
    sprint: false,
    crouch: false,
    yaw: 0,
    dt: DT,
    ...overrides,
  }
}

/** Hold a command for `frames` frames, returning the final state. */
function run(
  state: WalkerState,
  cmd: WalkerCommand,
  frames: number,
  world: WalkerWorld = patrol,
): WalkerState {
  let current = state
  for (let i = 0; i < frames; i++) {
    current = stepWalker(current, cmd, world).state
  }
  return current
}

/** The walker's footprint must never overlap a hull box in its body band. */
function expectNoClip(
  world: WalkerWorld,
  feet: readonly [number, number, number],
): void {
  const blockers = blockingBoxes(world.hull, feet[1], shapeFor(false))
  let worst = Number.POSITIVE_INFINITY
  let worstBox: Aabb3 | null = null
  for (const box of blockers) {
    const distance = distanceToBoxXZ(feet[0], feet[2], box)
    if (distance < worst) {
      worst = distance
      worstBox = box
    }
  }
  expect(
    worst,
    `walker at ${feet.join(', ')} is ${(worst / MM).toFixed(2)} mm inside ${JSON.stringify(worstBox)}`,
  ).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9)
}

describe('the walkable world (M3-T4)', () => {
  it('derives deck floors and one hull list from the assembled ship', () => {
    expect(patrol.decks.map((deck) => deck.deckId)).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
    expect(patrol.decks.map((deck) => deck.floorY)).toEqual([
      0,
      -DECK_PITCH_M,
      -2 * DECK_PITCH_M,
      -3 * DECK_PITCH_M,
      -4 * DECK_PITCH_M,
    ])
    expect(patrol.decks[1].label).toBe('Crew deck — galley & bunks')
    expect(patrol.ship.name).toBe('Firebrand')
    // One hull of every deck's collision boxes — nothing re-derived per deck.
    const boxes = assembly.graph.decks.reduce(
      (total, deck) => total + deck.collision.boxes.length,
      0,
    )
    expect(patrol.hull).toHaveLength(boxes)
    expect(patrol.bottomFloorY).toBe(-4 * DECK_PITCH_M)
  })

  it('finds the deck a height belongs to', () => {
    expect(deckIndexAtY(patrol, 0)).toBe(0)
    expect(deckIndexAtY(patrol, 2.9)).toBe(0)
    // Just below the head deck's floor: falling toward the crew deck.
    expect(deckIndexAtY(patrol, -0.1)).toBe(1)
    expect(deckIndexAtY(patrol, -DECK_PITCH_M)).toBe(1)
    expect(deckIndexAtY(patrol, -DECK_PITCH_M - 1)).toBe(2)
    expect(deckIndexAtY(patrol, -12.8)).toBe(4)
    // Below the deepest floor the walker still belongs to the deepest deck.
    expect(deckIndexAtY(patrol, -99)).toBe(4)
    expect(deckLevelAtY(patrol, -6.4).deckId).toBe('ops')
  })

  it('walks the hull M3-T3 measured against the visible geometry (§8 bullet 4)', () => {
    // The rig consumes `DeckNode.collision.boxes`; that hull — not the rig — is
    // what the ±10 cm geometry-match invariant pins, so state the dependency.
    expect(COLLISION_MATCH_TOLERANCE_M).toBe(0.1)
    expect(patrol.hull.length).toBeGreaterThan(0)
  })
})

describe('standing under burn (M3-T4 gravity + ground solving)', () => {
  it('settles a spawned walker onto the crew deck plate and keeps them there', () => {
    const state = spawnWalker(GALLEY_FEET)
    expect(state.grounded).toBe(false)
    const first = stepWalker(state, command(), patrol)
    expect(first.state.grounded).toBe(true)
    expect(first.deckIndex).toBe(1)
    expect(first.airborne).toBe(false)
    expect(first.state.feet[1]).toBeGreaterThanOrEqual(CREW_FLOOR_Y - 1e-9)
    // Kit clutter on the deck plate (cable runs, 0.06 m) is within the step.
    expect(first.state.feet[1]).toBeLessThanOrEqual(CREW_FLOOR_Y + STEP_HEIGHT_M)

    const settled = run(first.state, command(), 120)
    expect(settled.grounded).toBe(true)
    expect(settled.feet[0]).toBe(GALLEY_FEET[0])
    expect(settled.feet[2]).toBe(GALLEY_FEET[2])
    expect(settled.feet[1]).toBe(first.state.feet[1])
  })

  it('lands a dropped walker on the deck plate, not through it', () => {
    let state = spawnWalker([GALLEY_FEET[0], CREW_FLOOR_Y + 2, GALLEY_FEET[2]])
    let landed: ReturnType<typeof stepWalker> | null = null
    for (let i = 0; i < 200 && landed === null; i++) {
      const step = stepWalker(state, command(), patrol)
      state = step.state
      if (step.landed) {
        landed = step
      }
    }
    expect(landed).not.toBeNull()
    expect(landed!.deckIndex).toBe(1)
    expect(state.grounded).toBe(true)
    expect(Math.abs(state.feet[1] - CREW_FLOOR_Y)).toBeLessThanOrEqual(STEP_HEIGHT_M)
    // Free-fall speed for the 2 m drop, to within one frame's integration
    // resolution (a 0.05 s frame can overshoot the contact speed by g·dt).
    const relative = Math.abs(landed!.impactMps - impactSpeedMps(2)) / impactSpeedMps(2)
    expect(relative).toBeLessThan(0.1)
    expectNoClip(patrol, state.feet)
  })

  it('falls under the same 1 g wherever in the ship it is dropped (uniform field)', () => {
    const drop = (deckIndex: number): number => {
      const deck = assembly.decks[deckIndex]
      const room = deck.modules.find((owner) => !owner.band)
      if (room === undefined) throw new Error('no room')
      let state = spawnWalker([room.origin[0], deck.floorY + 1, room.origin[2]])
      for (let i = 0; i < 200; i++) {
        const step = stepWalker(state, command(), patrol)
        state = step.state
        if (step.landed) {
          return step.impactMps
        }
      }
      throw new Error(`the walker never landed on deck ${deckIndex}`)
    }
    const head = drop(0)
    const engineering = drop(3)
    // Identical profiles: the field has no positional term (no spin gravity).
    expect(engineering).toBeCloseTo(head, 9)
    expect(head).toBeGreaterThan(0)
    const relative = Math.abs(head - impactSpeedMps(1)) / impactSpeedMps(1)
    expect(relative).toBeLessThan(0.1)
  })

  it('arrests a fall that would leave the ship, rather than letting the camera escape', () => {
    // The safety net behind PRD §8 [review] ("no camera escape"): a walker with
    // no support anywhere and nothing below is caught at the deepest deck's
    // floor and reported. Patrol's geometry never exercises it (a walker over
    // the deepest deck's crawl opening is pushed clear of the ladder first and
    // lands on the plate frame — see the crawl-opening block below), so the
    // branch is pinned here against a hull with no boxes at all.
    const empty: WalkerWorld = {
      ship: patrol.ship,
      decks: patrol.decks,
      hull: [],
      bottomFloorY: DEEPEST_DECK.floorY,
    }
    const start = spawnWalker([0, DEEPEST_DECK.floorY + 1, 0])
    let state = start
    let arrested: ReturnType<typeof stepWalker> | null = null
    for (let i = 0; i < 200 && arrested === null; i++) {
      const step = stepWalker(state, command(), empty)
      state = step.state
      if (step.arrested) {
        arrested = step
      }
    }
    expect(arrested).not.toBeNull()
    expect(arrested!.impactMps).toBeCloseTo(impactSpeedMps(1), 1)
    expect(state.grounded).toBe(true)
    expect(state.feet[1]).toBe(DEEPEST_DECK.floorY)
    expect(arrested!.deckIndex).toBe(DEEPEST_DECK.deckIndex)
  })

  it('does not fall while idle, and a stalled frame delta cannot move it', () => {
    const settled = run(spawnWalker(GALLEY_FEET), command(), 3)
    const still = stepWalker(settled, command({ dt: 0 }), patrol)
    expect(still.state.feet).toEqual(settled.feet)
    expect(still.movedM).toBe(0)
    // A 30 s frame (a tab switch) is clamped by clampFrameDelta, not applied.
    const stalled = stepWalker(settled, command({ dt: 30 }), patrol)
    expect(stalled.state.grounded).toBe(true)
    expect(stalled.state.feet[1]).toBe(settled.feet[1])
    expect(stalled.movedM).toBe(0)
  })
})

describe('walking (ported PlanWalker locomotion, in 3D)', () => {
  it('walks the crew deck at the ported speed while holding W', () => {
    const settled = run(spawnWalker(GALLEY_FEET), command(), 3)
    const stepped = stepWalker(
      settled,
      command({ input: { forward: 1, strafe: 0 } }),
      patrol,
    )
    expect(stepped.movedM).toBeCloseTo(WALK_SPEED_M_S * DT, 9)
    // Yaw 0 faces −z, so W walks aft-ward along the deck plate.
    expect(stepped.state.feet[2]).toBeCloseTo(GALLEY_FEET[2] - WALK_SPEED_M_S * DT, 9)
    expect(stepped.state.feet[0]).toBeCloseTo(GALLEY_FEET[0], 9)
    expect(stepped.crouched).toBe(false)
    expect(stepped.eyeHeightM).toBe(EYE_HEIGHT_M)
  })

  it('is stopped by the blanked spine doorway and its M3-T2 plug', () => {
    // Standing in the trunk beside the ladder (z = 0.35, clear of the rails)
    // and walking into the +x face: that face is unjoined on the crew deck, so
    // M3-T2 seals it with a solid plug whose wall plane is at x = 0.57 — the
    // walker's centre stops exactly one capsule radius short of it.
    const shaftFeet: [number, number, number] = [0, CREW_FLOOR_Y, 0.35]
    const settled = run(spawnWalker(shaftFeet), command(), 3)
    expect(settled.feet[2]).toBe(0.35)
    const cmd = command({ input: { forward: 1, strafe: 0 }, yaw: -Math.PI / 2 })
    let state = settled
    let blocked = false
    for (let i = 0; i < 40; i++) {
      const step = stepWalker(state, cmd, patrol)
      state = step.state
      blocked = blocked || step.blocked
      expectNoClip(patrol, state.feet)
    }
    expect(blocked).toBe(true)
    expect(state.feet[0]).toBeCloseTo(0.57 - PLAYER_RADIUS, 6)
    expect(state.grounded).toBe(true)
  })

  it('is pushed off the ladder when spawned inside it (the mid-line is solid)', () => {
    // The ladder's rails and rungs occupy the trunk's mid-line, so a walker
    // placed exactly there is healed sideways rather than left inside the kit.
    const step = stepWalker(spawnWalker([0, CREW_FLOOR_Y, 0]), command(), patrol)
    expect(step.depenetrations).toBeGreaterThan(0)
    expect(Math.abs(step.state.feet[2])).toBeGreaterThan(0.2)
    expect(step.state.grounded).toBe(true)
    expectNoClip(patrol, step.state.feet)
  })

  it('stays inside the crew deck walking any direction, without clipping (containment)', () => {
    // The room-scale claim behind PRD §8's [review] "no clipping, no camera
    // escape": from the galley's centre, every heading stays inside the deck's
    // hull envelope and clear of every hull box, on the crew deck. Headings
    // that reach the spine door end in the trunk (still the crew deck).
    const envelope = hullBounds(assembly.graph.decks[1].collision.boxes)
    expect(envelope).toBeDefined()
    for (let i = 0; i < 8; i++) {
      const yaw = (i / 8) * 2 * Math.PI
      let state = run(spawnWalker(GALLEY_FEET), command(), 3)
      let blocked = false
      for (let frame = 0; frame < 80; frame++) {
        const step = stepWalker(
          state,
          command({ input: { forward: 1, strafe: 0 }, yaw }),
          patrol,
        )
        state = step.state
        blocked = blocked || step.blocked
        expectNoClip(patrol, state.feet)
        expect(state.feet[0]).toBeGreaterThanOrEqual(envelope!.min[0] - 1e-9)
        expect(state.feet[0]).toBeLessThanOrEqual(envelope!.max[0] + 1e-9)
        expect(state.feet[2]).toBeGreaterThanOrEqual(envelope!.min[2] - 1e-9)
        expect(state.feet[2]).toBeLessThanOrEqual(envelope!.max[2] + 1e-9)
      }
      expect(blocked).toBe(true)
      expect(state.grounded).toBe(true)
      // Never past the galley's own outer walls either (bulkhead thickness
      // included): 2.1 m half-width and 0.7/5.7 m in z on the crew deck.
      expect(Math.abs(state.feet[0] - GALLEY_FEET[0])).toBeLessThanOrEqual(
        GALLEY_HALF_X,
      )
      expect(state.feet[2]).toBeLessThanOrEqual(GALLEY_FEET[2] + 2.5)
      expect(state.feet[2]).toBeGreaterThanOrEqual(0.25)
    }
  })

  it('walks through the spine doorway into the shaft, up to the ladder', () => {
    const settled = run(spawnWalker(GALLEY_FEET), command(), 3)
    const state = run(settled, command({ input: { forward: 1, strafe: 0 } }), 60)
    // The galley's spine door is at z = 0.7 (the module's face) and the shaft's
    // free space is z ∈ [−0.6, 0.6]: the walker crosses the doorway and the
    // 1.2 m trunk, then stops against the LADDER, whose rails and rungs rise
    // through the shaft's mid-plane on the x = 0 axis (M2-T6). A 0.45 m rung
    // box leaves 0.405 m of free lane either side — less than the capsule — so
    // the shaft is a ladder room, not a pass-through: crossing it is the M3-T5
    // ladder machine's job, not this rig's.
    const rungHalfDepth = 0.018
    expect(state.feet[2]).toBeGreaterThanOrEqual(rungHalfDepth + PLAYER_RADIUS - 1e-9)
    expect(state.feet[2]).toBeLessThanOrEqual(rungHalfDepth + PLAYER_RADIUS + 1e-9)
    expect(Math.abs(state.feet[0])).toBeLessThan(0.05)
    expect(state.grounded).toBe(true)
    expectNoClip(patrol, state.feet)
    // The shaft is part of the crew deck (bands are not decks of their own).
    expect(stepWalker(state, command({ dt: 0 }), patrol).deckIndex).toBe(1)
  })

  it('crouches slower, with a lower eye (ported modifiers)', () => {
    const settled = run(spawnWalker(GALLEY_FEET), command(), 3)
    const walk = run(settled, command({ input: { forward: 1, strafe: 0 } }), 20)
    const crouch = run(
      settled,
      command({ input: { forward: 1, strafe: 0 }, crouch: true }),
      20,
    )
    const walkedM = Math.hypot(
      walk.feet[0] - settled.feet[0],
      walk.feet[2] - settled.feet[2],
    )
    const crouchedM = Math.hypot(
      crouch.feet[0] - settled.feet[0],
      crouch.feet[2] - settled.feet[2],
    )
    expect(crouchedM).toBeLessThan(walkedM)
    const step = stepWalker(settled, command({ crouch: true }), patrol)
    expect(step.crouched).toBe(true)
    expect(step.eyeHeightM).toBe(1.0)
  })

  it('sprints faster than it walks', () => {
    const settled = run(spawnWalker(GALLEY_FEET), command(), 3)
    const walked = stepWalker(
      settled,
      command({ input: { forward: 1, strafe: 0 } }),
      patrol,
    )
    const sprinted = stepWalker(
      settled,
      command({ input: { forward: 1, strafe: 0 }, sprint: true }),
      patrol,
    )
    expect(sprinted.movedM).toBeGreaterThan(walked.movedM)
  })

  it('is deterministic: the same state and commands give the same walker', () => {
    const a = run(
      spawnWalker(GALLEY_FEET),
      command({ input: { forward: 1, strafe: 1 } }),
      50,
    )
    const b = run(
      spawnWalker(GALLEY_FEET),
      command({ input: { forward: 1, strafe: 1 } }),
      50,
    )
    expect(a).toEqual(b)
  })

  it('never clips a bulkhead or leaves the crew deck walking any direction', () => {
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * 2 * Math.PI
      let state = run(spawnWalker(GALLEY_FEET), command(), 3)
      for (let frame = 0; frame < 120; frame++) {
        state = stepWalker(
          state,
          command({ input: { forward: 1, strafe: 0 }, yaw }),
          patrol,
        ).state
        expectNoClip(patrol, state.feet)
        expect(deckIndexAtY(patrol, state.feet[1])).toBe(1)
      }
    }
  })
})

describe('the crawl opening and the walker (measured on Patrol)', () => {
  it('supports the walker over every deck’s shaft but the deepest deck’s axis', () => {
    // Measured fact this task pins: the 0.7 m crawl opening (M2-T6) is smaller
    // than the walker's footprint plus the flush ladder rails that cross it, so
    // a 0.25 m capsule is supported on the shaft axis of every deck that has a
    // band below it. Only the deepest deck — no band below, nothing under the
    // opening — is unsupported, and the arrest plane covers it. Moving the
    // walker DOWN the shaft is therefore the M3-T5 ladder machine's job: a plain
    // fall through the run is unreachable for this capsule.
    for (const deck of patrol.decks) {
      const support = supportHeightAt(
        patrol.hull,
        0,
        0,
        PLAYER_RADIUS,
        deck.floorY + STEP_HEIGHT_M,
      )
      if (deck.deckIndex === DEEPEST_DECK.deckIndex) {
        expect(support).toBe(Number.NEGATIVE_INFINITY)
      } else {
        expect(support).toBeCloseTo(deck.floorY, 9)
      }
    }
  })

  it('pushes a walker off the deepest deck’s ladder and stands them on the plate frame', () => {
    // Same spot, one frame: the hull has no support under the axis, but the
    // ladder's solid rails/rungs occupy it, so the heal pass moves the walker
    // clear — onto the deck plate frame where a surface exists. Falling out of
    // the ship therefore needs a walker to be inside the trunk with the ladder
    // behind them, which Patrol's geometry does not offer.
    const start = spawnWalker([0, DEEPEST_DECK.floorY, 0])
    const step = stepWalker(start, command(), patrol)
    expect(step.depenetrations).toBeGreaterThan(0)
    expect(step.arrested).toBe(false)
    expect(step.state.grounded).toBe(true)
    expect(step.state.feet[1]).toBe(DEEPEST_DECK.floorY)
    expect(Math.hypot(step.state.feet[0], step.state.feet[2])).toBeGreaterThan(0.2)
    expectNoClip(patrol, step.state.feet)
  })

  it('spawns every canonical ship on a supported, inside spot on its crew deck', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const world = walkerWorldOf(assembleShip(spec))
      const crew = assembleShip(spec).decks[1]
      const room = crew.modules.find((owner) => !owner.band)
      if (room === undefined) throw new Error(`${spec.name}: no crew-deck room`)
      let state = spawnWalker(room.origin)
      for (let frame = 0; frame < 5; frame++) {
        state = stepWalker(state, command(), world).state
      }
      expect(state.grounded).toBe(true)
      expect(state.feet[1]).toBeGreaterThanOrEqual(crew.floorY - 1e-9)
      expect(state.feet[1]).toBeLessThanOrEqual(crew.floorY + STEP_HEIGHT_M)
      expectNoClip(world, state.feet)
    }
  })
})
