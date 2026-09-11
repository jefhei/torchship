import { describe, expect, it } from 'vitest'
import { boxEuler, cylinderEuler, vec3Tuple } from './transforms'

/** Euler components are compared numerically — the products differ in ulps. */
function expectEuler(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 12)
  }
}

describe('kit render transforms (M2-T1)', () => {
  it('vec3Tuple copies a readonly tuple into a mutable one', () => {
    const source = [1, 2, 3] as const
    const tuple = vec3Tuple(source)
    expect(tuple).toEqual([1, 2, 3])
    tuple[0] = 9
    expect(tuple).toEqual([9, 2, 3])
    expect(source).toEqual([1, 2, 3])
  })

  it('boxEuler maps the stored quarter-turn yaw onto +Y', () => {
    expect(boxEuler(0)).toEqual([0, 0, 0])
    expectEuler(boxEuler(1), [0, Math.PI / 2, 0])
    expectEuler(boxEuler(2), [0, Math.PI, 0])
    expectEuler(boxEuler(3), [0, (3 * Math.PI) / 2, 0])
  })

  it('cylinderEuler turns the default +Y cylinder onto the part axis', () => {
    expect(cylinderEuler('y')).toEqual([0, 0, 0])
    expectEuler(cylinderEuler('x'), [0, 0, Math.PI / 2])
    expectEuler(cylinderEuler('z'), [Math.PI / 2, 0, 0])
  })
})
