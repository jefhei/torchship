import { describe, expect, it } from 'vitest'
import { DECK_PITCH_M } from '../types'
import {
  GRAVITY_DIRECTION,
  GRAVITY_M_S2,
  TERMINAL_SPEED_M_S,
  clampFallSpeed,
  fallProfileFor,
  fallTimeForS,
  gravityAcceleration,
  impactSpeedMps,
  integrateFallSpeed,
} from './gravity'

/**
 * Integrate a fall from rest the way the walker does (gravity first, then the
 * position step) at a fixed timestep, landing at `dropM`. Returns the elapsed
 * time and the impact speed, so the closed forms can be checked against the
 * integration rather than against themselves.
 */
function simulateFall(
  dropM: number,
  dt = 0.0005,
): { timeS: number; impactMps: number } {
  let y = 0
  let speed = 0
  let time = 0
  while (y > -dropM) {
    speed = integrateFallSpeed(speed, dt)
    y += speed * dt
    time += dt
    if (time > 60) {
      throw new Error('simulateFall: fall never landed')
    }
  }
  return { timeS: time, impactMps: -speed }
}

describe('under-burn gravity model (M3-T4)', () => {
  it('is a uniform 1 g field, ship-fixed, pointing at the drive', () => {
    expect(GRAVITY_M_S2).toBe(9.80665)
    // "down" = toward the drive = −Y (the thrust axis points nose-ward at +Y).
    expect(GRAVITY_DIRECTION).toEqual([0, -1, 0])
    expect(gravityAcceleration()).toEqual([0, -GRAVITY_M_S2, 0])
  })

  it('does not depend on where in the ship the walker is (no spin gravity)', () => {
    // The field takes no arguments: PRD §4 rules out a radial field, so the
    // acceleration vector is the same constant at every deck.
    expect(gravityAcceleration()).toEqual(gravityAcceleration())
  })

  it('integrates free fall along the thrust axis, clamped at terminal speed', () => {
    expect(integrateFallSpeed(0, 0.1)).toBeCloseTo(-0.980665, 6)
    expect(integrateFallSpeed(0, 0.05)).toBeCloseTo(-0.4903325, 6)
    expect(integrateFallSpeed(-1, 0)).toBe(-1)
    // Terminal clamp: 5 s of burn from rest would be −49 m/s, clamped to −20.
    let speed = 0
    for (let i = 0; i < 100; i++) {
      speed = integrateFallSpeed(speed, 0.05)
    }
    expect(speed).toBe(-TERMINAL_SPEED_M_S)
  })

  it('clamps non-finite speeds to rest and bounds the magnitude', () => {
    expect(clampFallSpeed(Number.NaN)).toBe(0)
    expect(clampFallSpeed(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(clampFallSpeed(-25)).toBe(-TERMINAL_SPEED_M_S)
    expect(clampFallSpeed(25)).toBe(TERMINAL_SPEED_M_S)
    expect(clampFallSpeed(-3.5)).toBe(-3.5)
  })

  it('matches the closed-form fall profile for the deck pitch', () => {
    // One deck pitch (3.2 m) under 1 g: 0.808 s, 7.92 m/s — the flagship
    // numbers of a fall from one deck to the one below.
    expect(fallTimeForS(DECK_PITCH_M)).toBeCloseTo(0.807848, 6)
    expect(impactSpeedMps(DECK_PITCH_M)).toBeCloseTo(7.922282, 6)
    expect(fallProfileFor(DECK_PITCH_M)).toEqual({
      dropM: DECK_PITCH_M,
      timeS: fallTimeForS(DECK_PITCH_M),
      impactMps: impactSpeedMps(DECK_PITCH_M),
    })
  })

  it('agrees with the integrated fall (time and impact) for one and four pitches', () => {
    for (const dropM of [DECK_PITCH_M, 4 * DECK_PITCH_M]) {
      const simulated = simulateFall(dropM)
      expect(simulated.timeS).toBeCloseTo(fallTimeForS(dropM), 2)
      expect(simulated.impactMps).toBeCloseTo(impactSpeedMps(dropM), 1)
    }
    // A four-deck fall down the spine run: 1.62 s, 15.8 m/s — inside the clamp.
    expect(fallTimeForS(4 * DECK_PITCH_M)).toBeCloseTo(1.615696, 6)
    expect(impactSpeedMps(4 * DECK_PITCH_M)).toBeCloseTo(15.844565, 6)
    expect(impactSpeedMps(4 * DECK_PITCH_M)).toBeLessThan(TERMINAL_SPEED_M_S)
  })

  it('scales as sqrt(2d/g): four times the drop is twice the time', () => {
    expect(fallTimeForS(4)).toBeCloseTo(2 * fallTimeForS(1), 12)
    expect(impactSpeedMps(4)).toBeCloseTo(2 * impactSpeedMps(1), 12)
    expect(fallTimeForS(0)).toBe(0)
    expect(fallTimeForS(-3.2)).toBe(fallTimeForS(3.2))
  })
})
