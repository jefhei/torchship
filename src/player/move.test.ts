import { describe, expect, it } from 'vitest'
import {
  BODY_HEIGHT_M,
  CROUCH_BODY_HEIGHT_M,
  CROUCH_EYE_HEIGHT_M,
  CROUCH_SPEED_M_S,
  EYE_HEIGHT_M,
  MAX_FRAME_DELTA_S,
  PLAYER_RADIUS_M,
  SPRINT_SPEED_M_S,
  STEP_HEIGHT_M,
  WALK_SPEED_M_S,
  bodyHeightFor,
  clampFrameDelta,
  eyeHeightFor,
  eyePosition,
  isLocomotionKey,
  isMovementKey,
  keysToMoveInput,
  keysToMoveState,
  locomotionSpeed,
  moveInputToWorldVector,
} from './move'

const held = (...codes: string[]): Set<string> => new Set(codes)

describe('locomotion constants (M3-T4)', () => {
  it('carries the PRD §6.1 walkthrough numbers', () => {
    expect(EYE_HEIGHT_M).toBe(1.6)
    expect(CROUCH_EYE_HEIGHT_M).toBe(1.0)
    expect(WALK_SPEED_M_S).toBe(2.2)
    expect(SPRINT_SPEED_M_S).toBe(4.2)
    expect(CROUCH_SPEED_M_S).toBe(1.1)
    expect(MAX_FRAME_DELTA_S).toBe(0.05)
  })

  it('keeps the ported capsule radius and a step height below the lowest blocking kit', () => {
    expect(PLAYER_RADIUS_M).toBe(0.25)
    // A standard 0.9 m door leaves a 0.4 m centre corridor (the ported contract).
    expect(0.9 - 2 * PLAYER_RADIUS_M).toBeCloseTo(0.4, 10)
    // Step height clears floor clutter but not the mess-table seat (0.45 m).
    expect(STEP_HEIGHT_M).toBeLessThan(0.45)
    expect(STEP_HEIGHT_M).toBeGreaterThan(0.06) // deck-plate cable runs
    expect(BODY_HEIGHT_M).toBe(1.8)
    expect(CROUCH_BODY_HEIGHT_M).toBeLessThan(BODY_HEIGHT_M)
  })
})

describe('key mapping (ported from the PlanWalker rig)', () => {
  it('maps W/A/S/D to planar input', () => {
    expect(keysToMoveInput(held('KeyW'))).toEqual({ forward: 1, strafe: 0 })
    expect(keysToMoveInput(held('KeyS'))).toEqual({ forward: -1, strafe: 0 })
    expect(keysToMoveInput(held('KeyA'))).toEqual({ forward: 0, strafe: -1 })
    expect(keysToMoveInput(held('KeyD'))).toEqual({ forward: 0, strafe: 1 })
    expect(keysToMoveInput(held())).toEqual({ forward: 0, strafe: 0 })
  })

  it('cancels opposing keys, so no contradictory input reaches the walker', () => {
    expect(keysToMoveInput(held('KeyW', 'KeyS'))).toEqual({ forward: 0, strafe: 0 })
    expect(keysToMoveInput(held('KeyA', 'KeyD'))).toEqual({ forward: 0, strafe: 0 })
    expect(keysToMoveInput(held('KeyW', 'KeyD'))).toEqual({ forward: 1, strafe: 1 })
  })

  it('reads the sprint and crouch modifiers off either side', () => {
    expect(keysToMoveState(held('ShiftLeft')).sprint).toBe(true)
    expect(keysToMoveState(held('ShiftRight')).sprint).toBe(true)
    expect(keysToMoveState(held('ControlLeft')).crouch).toBe(true)
    expect(keysToMoveState(held('ControlRight')).crouch).toBe(true)
    const both = keysToMoveState(held('KeyW', 'ShiftLeft', 'ControlRight'))
    expect(both).toEqual({
      input: { forward: 1, strafe: 0 },
      sprint: true,
      crouch: true,
    })
  })

  it('tracks exactly the keys the rig binds (WASD + Shift/Ctrl)', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      expect(isMovementKey(code)).toBe(true)
      expect(isLocomotionKey(code)).toBe(true)
    }
    for (const code of ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']) {
      expect(isMovementKey(code)).toBe(false)
      expect(isLocomotionKey(code)).toBe(true)
    }
    for (const code of ['KeyQ', 'Space', 'Escape']) {
      expect(isMovementKey(code)).toBe(false)
      expect(isLocomotionKey(code)).toBe(false)
    }
  })
})

describe('locomotion selection', () => {
  it('lets crouch beat sprint (you cannot run while hunched)', () => {
    expect(locomotionSpeed(false, false)).toBe(WALK_SPEED_M_S)
    expect(locomotionSpeed(true, false)).toBe(SPRINT_SPEED_M_S)
    expect(locomotionSpeed(false, true)).toBe(CROUCH_SPEED_M_S)
    expect(locomotionSpeed(true, true)).toBe(CROUCH_SPEED_M_S)
  })

  it('lowers the eyes and the body band while crouching', () => {
    expect(eyeHeightFor(false)).toBe(EYE_HEIGHT_M)
    expect(eyeHeightFor(true)).toBe(CROUCH_EYE_HEIGHT_M)
    expect(bodyHeightFor(false)).toBe(BODY_HEIGHT_M)
    expect(bodyHeightFor(true)).toBe(CROUCH_BODY_HEIGHT_M)
  })
})

describe('planar heading', () => {
  it('walks toward −z at yaw 0 and +z backwards (three.js convention)', () => {
    const forward = moveInputToWorldVector({ forward: 1, strafe: 0 }, 0)
    expect(forward.x).toBeCloseTo(0, 12)
    expect(forward.z).toBeCloseTo(-1, 12)
    const back = moveInputToWorldVector({ forward: -1, strafe: 0 }, 0)
    expect(back.z).toBeCloseTo(1, 12)
  })

  it('strafes right with D at yaw 0 and left with A', () => {
    expect(moveInputToWorldVector({ forward: 0, strafe: 1 }, 0).x).toBeCloseTo(1, 12)
    expect(moveInputToWorldVector({ forward: 0, strafe: -1 }, 0).x).toBeCloseTo(-1, 12)
  })

  it('turns the heading with the yaw (positive yaw = left)', () => {
    const left = moveInputToWorldVector({ forward: 1, strafe: 0 }, Math.PI / 2)
    expect(left.x).toBeCloseTo(-1, 12)
    expect(left.z).toBeCloseTo(0, 12)
    const around = moveInputToWorldVector({ forward: 1, strafe: 0 }, Math.PI)
    expect(around.z).toBeCloseTo(1, 12)
  })

  it('normalizes diagonals so they are not faster than cardinals', () => {
    const diagonal = moveInputToWorldVector({ forward: 1, strafe: 1 }, 0)
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1, 12)
  })

  it('returns a clean zero vector with no keys held', () => {
    expect(moveInputToWorldVector({ forward: 0, strafe: 0 }, 1.234)).toEqual({
      x: 0,
      z: 0,
    })
  })
})

describe('frame delta clamp (ported)', () => {
  it('collapses non-finite and negative deltas to 0', () => {
    expect(clampFrameDelta(Number.NaN)).toBe(0)
    expect(clampFrameDelta(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampFrameDelta(-1)).toBe(0)
    expect(clampFrameDelta(0)).toBe(0)
  })

  it('passes sane deltas through and clamps stalls to the ceiling', () => {
    expect(clampFrameDelta(0.016)).toBeCloseTo(0.016, 12)
    expect(clampFrameDelta(12)).toBe(MAX_FRAME_DELTA_S)
    // Even a clamped sprint step stays inside the capsule's reach.
    expect(SPRINT_SPEED_M_S * MAX_FRAME_DELTA_S).toBeLessThan(PLAYER_RADIUS_M)
  })
})

describe('eye placement', () => {
  it('rides the eye height over the walker feet', () => {
    expect(eyePosition([1, -3.2, 2], false)).toEqual([1, -3.2 + EYE_HEIGHT_M, 2])
    expect(eyePosition([1, -3.2, 2], true)).toEqual([1, -3.2 + CROUCH_EYE_HEIGHT_M, 2])
  })
})
