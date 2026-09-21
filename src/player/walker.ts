/**
 * M3-T4 — the walker: the frame step that integrates the ported PlanWalker
 * locomotion (src/player/move.ts), under-burn gravity (gravity.ts) and the
 * deck hull (collide.ts, hull.ts) into one deterministic 3D update.
 *
 * `stepWalker(state, command, world)` is the whole task as one pure function —
 * the rig (WalkRig.tsx) only reads keys, calls it, and writes the camera:
 *
 *  1. HEAL      a walker who is inside kit (a spawn in a wall, a frame that
 *               clipped) is pushed out along the cheapest exit — never left to
 *               be dragged through geometry;
 *  2. MOVE      the held keys → planar heading (yaw-relative) → a step of
 *               `locomotionSpeed × dt` meters, resolved against the hull boxes
 *               that stand in the body band, so walls block and doorways pass;
 *  3. STEP UP   kit at or below the step height never blocked the move, so the
 *               ground solver simply raises the walker onto it;
 *  4. FALL      gravity integrates along the thrust axis (down = toward the
 *               drive, −Y, 1 g) and the ground solver lands the walker on the
 *               highest supporting surface under their footprint — the deck
 *               plate normally, the deck below when they step over the spine's
 *               crawl opening and drop. A fall that would leave the ship is
 *               arrested at the deepest deck's floor ("bottom of the spine
 *               run") and reported rather than letting the camera escape.
 *
 * The world it walks (`WalkerWorld`) is derived, never authored: the deck list
 * from the assembly's deck nodes, and the collision hull from
 * `DeckNode.collision.boxes` — the same M3-T3 boxes the §8 bullet-4 invariant
 * measures (±10 cm of the visible geometry), so nothing the walker collides
 * with is a second opinion about where the ship's surfaces are.
 *
 * Every deck's boxes live in ONE hull list: the walker is in 3D, and the body
 * band is what decides whether another deck's kit is in the way. That is what
 * makes a fall down the spine land on the deck below rather than pass through
 * it.
 *
 * Pure and three-agnostic, so the whole frame step unit-tests headlessly
 * against the canonical fixtures.
 */

import type { Aabb3, ShipIdentity, Vec3 } from '../types'
import type { ShipAssembly } from '../assembler'
import { depenetrate, resolveHorizontalMove } from './collide'
import { GRAVITY_M_S2, clampFallSpeed } from './gravity'
import { blockingBoxes, shapeFor, supportHeightAt, type WalkerShape } from './hull'
import {
  clampFrameDelta,
  eyeHeightFor,
  locomotionSpeed,
  moveInputToWorldVector,
  type MoveInput,
} from './move'

/**
 * Distance within which a grounded walker is held to a lower support instead of
 * being thrown into the air (m): walking down a hatch sill or a plate lip stays
 * a step, not a fall. It must swallow the kit's tallest walkable floor clutter
 * — a deck-plate cable run is 0.06 m tall (M2-T1 `deckPlateParts`) — so crossing
 * one is a step down rather than a 6 cm hop. Anything deeper is a real drop and
 * goes to gravity.
 */
export const GROUND_SNAP_M = 0.08

/** One deck the walker can stand on, in nose → aft order. */
export interface DeckLevel {
  deckIndex: number
  deckId: string
  /** Human deck label from the spec ('Crew deck — galley & bunks'). */
  label: string
  /** World Y of the deck floor, meters. */
  floorY: number
}

/**
 * Everything the frame step needs to know about the ship: its identity, its
 * deck floors, and one hull list of every deck's collision boxes (world meters).
 */
export interface WalkerWorld {
  ship: ShipIdentity
  /** Decks nose → aft (index 0 = head deck, highest Y). */
  decks: DeckLevel[]
  /** Every deck's hull boxes, one list (see the module doc). */
  hull: Aabb3[]
  /**
   * The deepest deck's floor, meters — the bottom of the spine run. A fall that
   * would pass it is arrested there (reported as `arrested`).
   */
  bottomFloorY: number
}

/** The walker's kinematic state. Everything else is derived per frame. */
export interface WalkerState {
  /** Position of the walker's FEET, world meters. The eye is `eyeHeightFor` above. */
  feet: Vec3
  /**
   * Speed along the thrust axis, m/s: negative = toward the drive (down under
   * burn), positive = nose-ward. Non-zero only while airborne.
   */
  verticalSpeedMps: number
  /** True while a supporting surface is under the walker's footprint. */
  grounded: boolean
}

/** One frame's command: the locomotion state plus the frame delta. */
export interface WalkerCommand {
  input: MoveInput
  sprint: boolean
  crouch: boolean
  /** Camera yaw (rotation.y, radians) — picks the planar heading. */
  yaw: number
  /** Raw frame delta in seconds (clamped inside). */
  dt: number
}

/** One frame's outcome: the next state plus everything a HUD or test reads. */
export interface WalkerStep {
  state: WalkerState
  /** Camera eye height used this frame (standing 1.6 m / crouched 1.0 m). */
  eyeHeightM: number
  crouched: boolean
  /** Deck the walker is standing over/on (nearest floor at or below the feet). */
  deckIndex: number
  deckId: string
  deckLabel: string
  /** Horizontal distance actually travelled this frame, meters. */
  movedM: number
  /** True when hull geometry cut the horizontal step short (a contact). */
  blocked: boolean
  /** True on the frame the walker touches down after being airborne. */
  landed: boolean
  /** Impact speed of that landing, m/s (0 otherwise). */
  impactMps: number
  /** True while airborne (no support under the footprint). */
  airborne: boolean
  /** True when the fall was arrested at the bottom of the spine run. */
  arrested: boolean
  /** Boxes the walker had to be pushed out of at the start of the frame. */
  depenetrations: number
}

/**
 * The walkable world derived from an assembled ship: deck floors from the deck
 * nodes, one hull list of every deck's collision boxes (M3-T3). Throws on an
 * assembly with no decks — a walker needs a floor.
 */
export function walkerWorldOf(assembly: ShipAssembly): WalkerWorld {
  const decks: DeckLevel[] = assembly.decks.map((deck) => ({
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    label: deck.label,
    floorY: deck.floorY,
  }))
  const hull = assembly.graph.decks.flatMap((node) => node.collision.boxes)
  return {
    ship: assembly.graph.ship,
    decks,
    hull,
    bottomFloorY: decks[decks.length - 1].floorY,
  }
}

/**
 * The deck whose floor is the highest at or below `y` — the deck a walker at
 * that height is standing on (or falling toward). Decks descend with their
 * index (src/types/units.ts), so this is the FIRST deck whose floor is at or
 * below `y`; above the head deck's floor it is deck 0, below the deepest deck's
 * floor it is the deepest deck.
 */
export function deckIndexAtY(world: WalkerWorld, y: number): number {
  for (const deck of world.decks) {
    if (deck.floorY <= y) {
      return deck.deckIndex
    }
  }
  return world.decks[world.decks.length - 1].deckIndex
}

/** The deck level at `y` (see `deckIndexAtY`). */
export function deckLevelAtY(world: WalkerWorld, y: number): DeckLevel {
  return world.decks[deckIndexAtY(world, y)]
}

/** A walker standing (or dropped) at `feet`, at rest, not yet grounded. */
export function spawnWalker(feet: Vec3): WalkerState {
  return { feet: [feet[0], feet[1], feet[2]], verticalSpeedMps: 0, grounded: false }
}

/**
 * Advance the walker one frame. See the module doc for the four stages; the
 * state returned is a fresh object, so callers can keep the previous frame for
 * interpolation (M5-T2's scripted walks record the sequence).
 */
export function stepWalker(
  state: WalkerState,
  command: WalkerCommand,
  world: WalkerWorld,
  shapeOverride?: WalkerShape,
): WalkerStep {
  const shape = shapeOverride ?? shapeFor(command.crouch)
  const dt = clampFrameDelta(command.dt)
  const eyeHeightM = eyeHeightFor(command.crouch)

  let x = state.feet[0]
  let z = state.feet[2]
  let feetY = state.feet[1]

  // Stage 1 + 2: heal any penetration, then move through the deck plane.
  const blockers = blockingBoxes(world.hull, feetY, shape)
  const healed = depenetrate(x, z, blockers, shape.radius)
  x = healed.x
  z = healed.z

  let movedM = 0
  let blocked = false
  if (dt > 0) {
    const direction = moveInputToWorldVector(command.input, command.yaw)
    if (direction.x !== 0 || direction.z !== 0) {
      const step = locomotionSpeed(command.sprint, command.crouch) * dt
      const resolved = resolveHorizontalMove(
        { x, z },
        { x: direction.x * step, z: direction.z * step },
        blockers,
        shape.radius,
      )
      movedM = resolved.travelledM
      blocked = resolved.blocked
      x = resolved.x
      z = resolved.z
    }
  }

  // Stages 3 + 4: gravity along the thrust axis, landed by the ground solver.
  let verticalSpeedMps = state.verticalSpeedMps
  let grounded = state.grounded
  let landed = false
  let arrested = false
  let impactMps = 0

  if (dt > 0) {
    verticalSpeedMps = clampFallSpeed(verticalSpeedMps - GRAVITY_M_S2 * dt)
    const nextY = feetY + verticalSpeedMps * dt
    const descending = verticalSpeedMps <= 0
    // A step-up is realised here: kit within the step height was not a blocker,
    // so the highest surface under the footprint at or below feet + step is the
    // surface the walker ends up on.
    const support = supportHeightAt(
      world.hull,
      x,
      z,
      shape.radius,
      feetY + shape.stepHeight,
    )
    const supported = support > Number.NEGATIVE_INFINITY

    if (supported && nextY <= support) {
      landed = !state.grounded && descending
      impactMps = descending ? -verticalSpeedMps : 0
      feetY = support
      verticalSpeedMps = 0
      grounded = true
    } else if (
      state.grounded &&
      descending &&
      supported &&
      feetY - support <= GROUND_SNAP_M
    ) {
      // Walking down a lip: stay glued to the surface instead of hopping.
      feetY = support
      verticalSpeedMps = 0
      grounded = true
    } else if (nextY <= world.bottomFloorY) {
      // The bottom of the spine run: the deepest deck has no plate under the
      // crawl opening, and a walker must not leave the ship (PRD §8 [review]:
      // no camera escape). Arrest the fall and report it — the ladder machine
      // (M3-T5) is what climbs out of here.
      landed = !state.grounded && descending
      impactMps = descending ? -verticalSpeedMps : 0
      feetY = world.bottomFloorY
      verticalSpeedMps = 0
      grounded = true
      arrested = true
    } else {
      feetY = nextY
      grounded = false
    }
  }

  const deck = deckLevelAtY(world, feetY)
  return {
    state: { feet: [x, feetY, z], verticalSpeedMps, grounded },
    eyeHeightM,
    crouched: command.crouch,
    deckIndex: deck.deckIndex,
    deckId: deck.deckId,
    deckLabel: deck.label,
    movedM,
    blocked,
    landed,
    impactMps,
    airborne: !grounded,
    arrested,
    depenetrations: healed.fixes,
  }
}
