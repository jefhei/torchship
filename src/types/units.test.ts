import { describe, expect, it } from 'vitest'
import {
  DECK_CLEAR_M,
  DECK_PITCH_M,
  MM,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
  deckFloorYFor,
} from './units'

describe('units & deck math (M1-T2)', () => {
  it('conventions: mm conversion and deck clear/pitch', () => {
    expect(MM).toBe(0.001)
    expect(DECK_CLEAR_M).toBe(3.0)
    expect(DECK_PITCH_M).toBe(3.2) // 3.0 clear + 0.2 m plate
  })

  it('standard door: 0.9 × 2.0 m centered 1.0 m sits its bottom edge on the floor', () => {
    expect(STANDARD_DOOR_SIZE).toEqual({ width: 0.9, height: 2.0 })
    expect(STANDARD_DOOR_CENTER_M - STANDARD_DOOR_SIZE.height / 2).toBeCloseTo(0, 12)
  })

  it('deck floors descend along −Y by one deck pitch per index', () => {
    expect(deckFloorYFor(0)).toBe(0) // head deck at the top
    expect(deckFloorYFor(1)).toBeCloseTo(-DECK_PITCH_M, 12)
    expect(deckFloorYFor(4)).toBeCloseTo(-4 * DECK_PITCH_M, 12)
    // Monotone nose→aft descent, pitch-separated.
    for (let i = 0; i < 6; i++) {
      expect(deckFloorYFor(i + 1)).toBeLessThan(deckFloorYFor(i))
      expect(deckFloorYFor(i) - deckFloorYFor(i + 1)).toBeCloseTo(DECK_PITCH_M, 12)
    }
  })
})
