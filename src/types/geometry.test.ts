import { describe, expect, it } from 'vitest'
import { FACING_VEC, rotY } from './geometry'
import type { Rotation, Vec3 } from './geometry'

describe('geometry primitives (M1-T2)', () => {
  it('FACING_VEC covers all four horizontal facings with unit vectors', () => {
    expect(Object.keys(FACING_VEC).sort()).toEqual(['+x', '+z', '-x', '-z'])
    expect(FACING_VEC['+x']).toEqual([1, 0, 0])
    expect(FACING_VEC['-x']).toEqual([-1, 0, 0])
    expect(FACING_VEC['+z']).toEqual([0, 0, 1])
    expect(FACING_VEC['-z']).toEqual([0, 0, -1])
    for (const v of Object.values(FACING_VEC)) {
      expect(Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)).toBeCloseTo(1, 12)
    }
  })

  it('rotY quarter-turns map the axes exactly (one turn: (x, z) → (z, −x))', () => {
    expect(rotY([1, 0, 0], 0)).toEqual([1, 0, 0])
    expect(rotY([1, 0, 0], 1)).toEqual([0, 0, -1])
    expect(rotY([1, 0, 0], 2)).toEqual([-1, 0, 0])
    expect(rotY([1, 0, 0], 3)).toEqual([0, 0, 1])
    expect(rotY([0, 0, -1], 1)).toEqual([-1, 0, 0])
  })

  it('rotY is a yaw about the thrust axis: Y is never touched', () => {
    const v: Vec3 = [0.5, 2.75, -1.25]
    for (const t of [0, 1, 2, 3] as Rotation[]) {
      const r = rotY(v, t)
      expect(r[1]).toBe(v[1])
      expect(Math.sqrt(r[0] ** 2 + r[2] ** 2)).toBeCloseTo(
        Math.sqrt(v[0] ** 2 + v[2] ** 2),
        12,
      )
    }
  })

  it('rotY composes: two quarter-turns equal a half-turn, four return identity', () => {
    const v: Vec3 = [1.3, 0.2, -0.7]
    expect(rotY(rotY(v, 1), 1)).toEqual(rotY(v, 2))
    expect(rotY(rotY(v, 2), 1)).toEqual(rotY(v, 3))
    expect(rotY(rotY(v, 3), 1)).toEqual(v)
  })
})
