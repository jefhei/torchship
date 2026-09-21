/**
 * M3-T4 — first-person locomotion math (BUILD_PLAN M3-T4: "first-person rig +
 * under-burn gravity (down = toward drive; port PlanWalker movement pattern)").
 *
 * This module is the pure half of the rig: keyboard state → planar movement
 * input → world-space heading, plus the constants the walkthrough is tuned
 * with. No three.js, no React — everything here unit-tests headlessly, exactly
 * like the math it was ported from (PlanWalker `src/viewport/controls/move.ts`,
 * PRD §7 "reuse: the PlanWalker movement/collision rig pattern ports directly").
 *
 * WHAT PORTS AND WHAT DOES NOT. PlanWalker walks a plan in 2D: its world is
 * the XZ plane, so "plan space" and "walk space" need a transform between them.
 * Torchship already speaks world meters, and its walking plane is the deck
 * plate — an XZ plane like PlanWalker's, one per deck (src/types/units.ts: deck
 * floors lie in XZ, nose is +Y, the thrust axis is Y). So the locomotion math
 * ports VERBATIM in shape: held keys → `MoveInput` → a yaw-relative unit vector
 * in the walking plane (`{ x, z }`), sprint/crouch as speed + camera-height
 * modifiers, and a frame-delta clamp so a tab switch cannot teleport the walker.
 * What PlanWalker has no concept of is the vertical axis: gravity, floors that
 * are not at y = 0, and falling between decks. That half is torchship's own
 * (src/player/gravity.ts, hull.ts, walker.ts).
 *
 * Conventions this module shares with the geometry layer (src/types/geometry.ts):
 *  - meters everywhere; yaw is the camera's `rotation.y` in radians;
 *  - yaw 0 faces −z (three.js default), positive yaw turns left;
 *  - walking is PLANAR — yaw picks the heading, pitch never does (you walk
 *    along the deck plate, not into it), and +Y is nose-ward, so "up the ship"
 *    is climbing toward the bridge under burn.
 *
 * Locomotion modifiers (ported): held Shift sprints (faster), held Ctrl crouches
 * (slower + lower eyes + shorter body). Crouch wins when both are held. A crouch
 * lowers the eyes and the collision band — it never widens the footprint, which
 * is what keeps the 0.4 m center corridor of a standard 0.9 m door walkable
 * (PLAYER_RADIUS_M below).
 */

import type { Vec3 } from '../types'

/**
 * Eye height of the walkthrough camera above the deck plate (m) — PRD §6.1,
 * "first-person controls at 1.6 m eye height".
 */
export const EYE_HEIGHT_M = 1.6

/** Eye height while crouching (m) — ported from the PlanWalker rig. */
export const CROUCH_EYE_HEIGHT_M = 1.0

/**
 * Comfortable walking speed (m/s) — ported. A cramped corvette is a short
 * walk: 2.2 m/s crosses a 5-deck ship in ~20 s, which is the pace the scripted
 * review walks (M5-T2) are tuned against.
 */
export const WALK_SPEED_M_S = 2.2

/** Sprint speed while Shift is held (m/s) — a brisk jog, ported. */
export const SPRINT_SPEED_M_S = 4.2

/** Crouch speed while Ctrl is held (m/s) — a careful creep, ported. */
export const CROUCH_SPEED_M_S = 1.1

/**
 * Frame-delta clamp (s), ported. Browsers deliver huge deltas after a tab
 * switch or a jank spike; without the clamp the walker would step across a
 * bulkhead (and through the gravity integration) in one frame. At
 * SPRINT_SPEED_M_S the worst step is 4.2 × 0.05 = 0.21 m and the worst fall
 * step is 20 × 0.05 = 1.0 m — both inside the reach of the collision and
 * landing solvers (src/player/collide.ts, walker.ts).
 */
export const MAX_FRAME_DELTA_S = 0.05

/**
 * Capsule footprint radius of the walker (m) — ported from PlanWalker
 * (`PLAYER_RADIUS`), unchanged because the constraint that fixed it is the
 * same: a standard 0.9 m door must leave a walkable corridor, and
 * 0.9 − 2 × 0.25 = 0.4 m of centre travel is what the kit's doorways are
 * authored for (src/types/units.ts STANDARD_DOOR_SIZE).
 */
export const PLAYER_RADIUS_M = 0.25

/**
 * Collision band above the feet while standing (m): the body the walls are
 * tested against. 1.8 m clears every doorway head (2.0 m) and stays under the
 * 3.0 m deck clear height, so a bulkhead blocks and a ceiling does not.
 */
export const BODY_HEIGHT_M = 1.8

/** Collision band above the feet while crouching (m) — a hunched walker. */
export const CROUCH_BODY_HEIGHT_M = 1.2

/**
 * Step-up height (m): kit lower than this is walked OVER (deck-plate cable
 * runs, hatch sills, bunk toes) instead of blocking, and the ground solver
 * raises the walker onto it (src/player/walker.ts). Deliberately below the
 * lowest thing that must block — the 0.45 m mess-table seat and the 0.75 m
 * table top — and above the kit's floor clutter.
 */
export const STEP_HEIGHT_M = 0.25

/** KeyboardEvent.code values that move forward (W). */
export const MOVE_FORWARD_CODES: ReadonlySet<string> = new Set(['KeyW'])
/** KeyboardEvent.code values that move backward (S). */
export const MOVE_BACK_CODES: ReadonlySet<string> = new Set(['KeyS'])
/** KeyboardEvent.code values that strafe left (A). */
export const MOVE_LEFT_CODES: ReadonlySet<string> = new Set(['KeyA'])
/** KeyboardEvent.code values that strafe right (D). */
export const MOVE_RIGHT_CODES: ReadonlySet<string> = new Set(['KeyD'])

/** KeyboardEvent.code values that sprint (Shift, either side). */
export const SPRINT_KEY_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
])

/** KeyboardEvent.code values that crouch (Ctrl, either side). */
export const CROUCH_KEY_CODES: ReadonlySet<string> = new Set([
  'ControlLeft',
  'ControlRight',
])

/** Every code the rig tracks as a movement key (for filtering events). */
export const MOVEMENT_KEY_CODES: ReadonlySet<string> = new Set([
  ...MOVE_FORWARD_CODES,
  ...MOVE_BACK_CODES,
  ...MOVE_LEFT_CODES,
  ...MOVE_RIGHT_CODES,
])

/** Movement keys plus the sprint/crouch modifiers (the full tracked set). */
export const LOCOMOTION_KEY_CODES: ReadonlySet<string> = new Set([
  ...MOVEMENT_KEY_CODES,
  ...SPRINT_KEY_CODES,
  ...CROUCH_KEY_CODES,
])

/**
 * Planar movement input derived from held keys. `forward` is +1 while moving
 * toward the camera heading (W) and −1 away (S); `strafe` is +1 to the camera's
 * right (D) and −1 to its left (A). Opposing keys cancel (W+S → 0) regardless
 * of order, so the caller never sees a contradiction.
 */
export interface MoveInput {
  forward: -1 | 0 | 1
  strafe: -1 | 0 | 1
}

/** Full locomotion state for a frame: planar input plus its modifiers. */
export interface MoveState {
  input: MoveInput
  /** Shift held (any side). */
  sprint: boolean
  /** Ctrl held (any side). */
  crouch: boolean
}

/** True when the code is a tracked movement key (WASD only). */
export function isMovementKey(code: string): boolean {
  return MOVEMENT_KEY_CODES.has(code)
}

/** True when the code is a tracked movement or modifier key. */
export function isLocomotionKey(code: string): boolean {
  return LOCOMOTION_KEY_CODES.has(code)
}

/** Map held key codes to planar movement input (W/S/A/D only). */
export function keysToMoveInput(keys: ReadonlySet<string>): MoveInput {
  let forwardKeys = false
  let backKeys = false
  let leftKeys = false
  let rightKeys = false
  for (const code of keys) {
    if (MOVE_FORWARD_CODES.has(code)) {
      forwardKeys = true
    } else if (MOVE_BACK_CODES.has(code)) {
      backKeys = true
    } else if (MOVE_LEFT_CODES.has(code)) {
      leftKeys = true
    } else if (MOVE_RIGHT_CODES.has(code)) {
      rightKeys = true
    }
  }
  const forward: -1 | 0 | 1 = forwardKeys === backKeys ? 0 : forwardKeys ? 1 : -1
  const strafe: -1 | 0 | 1 = leftKeys === rightKeys ? 0 : leftKeys ? -1 : 1
  return { forward, strafe }
}

/**
 * Derive the full locomotion state (movement input + sprint/crouch modifiers)
 * from the held-key set. Modifiers never move the walker by themselves — they
 * only decorate the movement input.
 */
export function keysToMoveState(keys: ReadonlySet<string>): MoveState {
  let sprint = false
  let crouch = false
  for (const code of keys) {
    if (SPRINT_KEY_CODES.has(code)) {
      sprint = true
    } else if (CROUCH_KEY_CODES.has(code)) {
      crouch = true
    }
  }
  return { input: keysToMoveInput(keys), sprint, crouch }
}

/**
 * Planar speed for a locomotion state: crouch beats sprint (you cannot run
 * while hunched), both beat the base walk speed. `base` lets callers override
 * the walk speed (tests, custom rigs).
 */
export function locomotionSpeed(
  sprint: boolean,
  crouch: boolean,
  base = WALK_SPEED_M_S,
): number {
  if (crouch) {
    return CROUCH_SPEED_M_S
  }
  return sprint ? SPRINT_SPEED_M_S : base
}

/**
 * Camera eye height above the deck plate for a locomotion state: crouched eyes
 * are lower, standing eyes use the base height (PRD §6.1's 1.6 m).
 */
export function eyeHeightFor(crouch: boolean, base = EYE_HEIGHT_M): number {
  return crouch ? CROUCH_EYE_HEIGHT_M : base
}

/** Collision band height above the feet for a locomotion state (m). */
export function bodyHeightFor(crouch: boolean, base = BODY_HEIGHT_M): number {
  return crouch ? CROUCH_BODY_HEIGHT_M : base
}

/**
 * World-space planar direction for a movement input at a camera yaw
 * (`rotation.y`, radians). Yaw 0 faces −z; positive yaw turns left (the
 * standard three.js convention). The result is a unit vector in the walking
 * plane whenever any key is active — diagonal movement is not faster than
 * cardinal movement — and `{ 0, 0 }` when no key is held. Signed zeros are
 * normalized so callers get clean +0s.
 */
export function moveInputToWorldVector(
  input: MoveInput,
  yaw: number,
): { x: number; z: number } {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // Camera heading at yaw: (−sin, 0, −cos); right: (cos, 0, −sin).
  let x = input.forward * -sin + input.strafe * cos
  let z = input.forward * -cos + input.strafe * -sin
  const length = Math.hypot(x, z)
  if (length > 0) {
    x /= length
    z /= length
  }
  if (x === 0) {
    x = 0
  }
  if (z === 0) {
    z = 0
  }
  return { x, z }
}

/**
 * Clamp a frame delta so movement and gravity stay bounded after stalls.
 * Non-finite or negative deltas collapse to 0; oversized deltas clamp to `max`
 * (MAX_FRAME_DELTA_S by default).
 */
export function clampFrameDelta(delta: number, max = MAX_FRAME_DELTA_S): number {
  if (!Number.isFinite(delta) || delta <= 0) {
    return 0
  }
  return Math.min(delta, max)
}

/** The camera position (eye) for a walker standing with its feet at `feet`. */
export function eyePosition(feet: Vec3, crouch: boolean): Vec3 {
  return [feet[0], feet[1] + eyeHeightFor(crouch), feet[2]]
}
