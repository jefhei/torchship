import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spies = vi.hoisted(() => ({ requestWalkLock: vi.fn() }))

/**
 * jsdom has no WebGL, so the real R3F <Canvas> cannot mount: swap it for a stub
 * that fires `onCreated` (the boot path the ready chip depends on) and renders
 * NO children — which keeps the walkthrough scene (and the rig's useThree /
 * useFrame) out of jsdom entirely. What this file exercises is the DOM half of
 * the walkthrough UI over the canvas.
 */
vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@react-three/fiber')>()
  const { useEffect, createElement } = await import('react')
  return {
    ...actual,
    Canvas: ({ onCreated }: { onCreated?: () => void }) => {
      useEffect(() => {
        onCreated?.()
      }, [onCreated])
      return createElement('canvas', { 'data-testid': 'viewport-canvas' })
    },
  }
})

// Only the pointer-lock request is stubbed; the rest of the player module (the
// lock-state bridge the overlay subscribes to) stays real.
vi.mock('./player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./player')>()
  return { ...actual, requestWalkLock: spies.requestWalkLock }
})

import Viewport from './Viewport'
import { setWalkLocked } from './player'

afterEach(() => {
  act(() => setWalkLocked(false))
  spies.requestWalkLock.mockReset()
})

describe('Viewport walkthrough UI (M3-T4)', () => {
  it('shows the pointer-lock prompt once the renderer has booted', async () => {
    render(<Viewport />)
    const prompt = await screen.findByTestId('walk-lock-prompt')
    expect(prompt).toHaveTextContent('Click to look around')
    expect(screen.getByTestId('viewport-canvas')).toBeInTheDocument()
    // The HUD only appears once the pointer is captured.
    expect(screen.queryByTestId('walk-hud')).toBeNull()
  })

  it('requests pointer lock from the prompt click (a user gesture)', async () => {
    render(<Viewport />)
    const prompt = await screen.findByTestId('walk-lock-prompt')
    act(() => {
      prompt.click()
    })
    expect(spies.requestWalkLock).toHaveBeenCalledTimes(1)
  })

  it('swaps the prompt for the movement HUD while the pointer is captured', async () => {
    render(<Viewport />)
    await screen.findByTestId('walk-lock-prompt')
    act(() => setWalkLocked(true))
    const hud = screen.getByTestId('walk-hud')
    expect(hud).toHaveTextContent('WASD move')
    expect(hud).toHaveTextContent('Shift sprint')
    expect(hud).toHaveTextContent('Ctrl crouch')
    expect(hud).toHaveTextContent('ESC release')
    expect(screen.queryByTestId('walk-lock-prompt')).toBeNull()
  })
})
