import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// RTL's auto-cleanup relies on a global afterEach; vitest runs with
// globals disabled, so register it explicitly here.
afterEach(() => {
  cleanup()
})

// jsdom ships no canvas 2D implementation: calling getContext('2d') returns
// null AND emits a noisy "Not implemented" jsdomError per call. Return null
// silently instead. Tests that need a real 2D context stub it per test via
// vi.spyOn, which layers on top of this.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null
  } as typeof HTMLCanvasElement.prototype.getContext
}
