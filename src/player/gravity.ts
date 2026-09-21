/**
 * M3-T4 — the under-burn gravity model (PRD §6.1: "**under-burn gravity
 * model** — constant 1 g, 'down' = toward the drive, floors perpendicular to
 * the thrust axis"; §6.2 keeps zero-G float mode explicitly OUT of the MVP, so
 * this model has exactly one state and no toggle).
 *
 * The whole model is four statements, and each one is a number or a direction
 * this module exports rather than a behaviour re-derived at a call site:
 *
 *  1. the field is UNIFORM — 1 g, everywhere in the ship, at every deck. There
 *     is no radial or position-dependent term (no spin gravity: PRD §4 lists
 *     "no spin-gravity ring" as an anti-goal), so a walker's acceleration does
 *     not depend on where in the ship they stand;
 *  2. "down" is the −Y direction: the thrust axis (src/types/geometry.ts) points
 *     nose-ward (+Y), the fusion torch pushes the ship that way, and
 *     acceleration pushes everything inside the other way — toward the drive,
 *     i.e. aft. `GRAVITY_DIRECTION` is that constant unit vector, ship-fixed;
 *  3. decks are perpendicular to it: every deck floor is an XZ plane at
 *     `deckFloorYFor(deckIndex)` (src/types/units.ts), so a walker's weight has
 *     no component along the floor and walking never fights gravity. Climbing
 *     nose-ward — engineering → ops → crew → bridge — is climbing "up" the
 *     ship, which is the feel PRD §8's deck-order invariant asks for;
 *  4. it is free-fall-integrated, not a lerp toward the floor: a walker whose
 *     support disappears (stepping over the spine's crawl opening, M2-T6) FALLS
 *     one deck pitch and lands at `sqrt(2·g·pitch)` ≈ 7.9 m/s after ≈ 0.81 s.
 *     `fallTimeForS` / `impactSpeedMps` are the closed forms of exactly those
 *     numbers, used by the tests to pin the integration against physics rather
 *     than against itself.
 *
 * The terminal-speed clamp exists so a fall down the full spine run (4 × 3.2 m
 * on Patrol) stays inside the per-frame reach of the landing solver: at
 * MAX_FRAME_DELTA_S a 20 m/s fall steps 1.0 m, and the highest supporting
 * surface under the walker's footprint is found whatever the depth
 * (src/player/hull.ts), so no floor can be tunnelled through.
 */

import type { Vec3 } from '../types'

/**
 * Standard gravity (m/s²) — one g, the acceleration under burn. Ships in the
 * torchship setting coast at 1 g (PRD §4: "under burn, 'down' is toward the
 * drive"), so this is the only gravity magnitude the MVP has.
 */
export const GRAVITY_M_S2 = 9.80665

/**
 * The ship-fixed "down" direction: toward the drive, i.e. −Y (aft). Constant —
 * the field is uniform, so this vector never varies with position.
 */
export const GRAVITY_DIRECTION: Vec3 = [0, -1, 0]

/**
 * Terminal speed of a falling walker (m/s). A crew-deck-to-hold fall down the
 * spine run is 4 × 3.2 = 12.8 m (≈ 15.8 m/s, 1.62 s) on Patrol; 20 m/s keeps
 * the clamp out of the way of every fall the canonical ships can produce while
 * still bounding a pathological one.
 */
export const TERMINAL_SPEED_M_S = 20

/** The acceleration vector under burn, m/s²: uniform, ship-fixed, down. */
export function gravityAcceleration(): Vec3 {
  return [
    GRAVITY_DIRECTION[0] * GRAVITY_M_S2,
    GRAVITY_DIRECTION[1] * GRAVITY_M_S2,
    GRAVITY_DIRECTION[2] * GRAVITY_M_S2,
  ]
}

/**
 * Integrate a free-fall speed along the thrust axis (m/s, negative = descending
 * toward the drive) over `dt` seconds, clamped at TERMINAL_SPEED_M_S. The
 * caller passes the frame delta through `clampFrameDelta` first
 * (src/player/move.ts) — this function assumes a bounded step.
 */
export function integrateFallSpeed(fallSpeedMps: number, dt: number): number {
  return clampFallSpeed(fallSpeedMps - GRAVITY_M_S2 * dt)
}

/** Clamp a speed along the thrust axis to ±TERMINAL_SPEED_M_S (magnitude). */
export function clampFallSpeed(fallSpeedMps: number): number {
  if (!Number.isFinite(fallSpeedMps)) {
    return 0
  }
  if (fallSpeedMps < -TERMINAL_SPEED_M_S) {
    return -TERMINAL_SPEED_M_S
  }
  return fallSpeedMps > TERMINAL_SPEED_M_S ? TERMINAL_SPEED_M_S : fallSpeedMps
}

/**
 * Time to fall `dropM` meters from rest under burn (s): sqrt(2·d/g). The
 * flagship number: one deck pitch (3.2 m) → 0.8079 s.
 */
export function fallTimeForS(dropM: number): number {
  const drop = Math.abs(dropM)
  return Math.sqrt((2 * drop) / GRAVITY_M_S2)
}

/**
 * Speed at the end of a `dropM` meter fall from rest (m/s): sqrt(2·g·d). One
 * deck pitch → 7.9207 m/s.
 */
export function impactSpeedMps(dropM: number): number {
  const drop = Math.abs(dropM)
  return Math.sqrt(2 * GRAVITY_M_S2 * drop)
}

/** A fall's closed-form profile: how long, and how hard it lands. */
export interface FallProfile {
  dropM: number
  timeS: number
  impactMps: number
}

/** The closed-form fall profile for a drop of `dropM` meters (see the docs). */
export function fallProfileFor(dropM: number): FallProfile {
  const drop = Math.abs(dropM)
  return { dropM: drop, timeS: fallTimeForS(drop), impactMps: impactSpeedMps(drop) }
}
