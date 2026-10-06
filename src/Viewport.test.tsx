import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { SHARE_STORAGE_KEY } from './share'

afterEach(() => {
  act(() => setWalkLocked(false))
  spies.requestWalkLock.mockReset()
  // M6-T3: a share-change test writes the autosave and the address bar; reset
  // both so the environment the other tests boot into is untouched.
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
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
    // M5-T1: the legend names the optional deck indicator's key too.
    expect(hud).toHaveTextContent('I deck indicator')
    expect(screen.queryByTestId('walk-lock-prompt')).toBeNull()
  })

  it('mounts the M5-T1 wayfinding overlay with the walkthrough UI', async () => {
    render(<Viewport />)
    await screen.findByTestId('walk-lock-prompt')
    // Nothing to sign before the walkthrough is entered.
    expect(screen.queryByTestId('wayfinding')).toBeNull()
    act(() => setWalkLocked(true))
    expect(screen.getByTestId('walk-hud')).toBeInTheDocument()
    expect(screen.getByTestId('wayfinding')).toBeInTheDocument()
    // No walk report has arrived in jsdom (the rig is not mounted), so the
    // overlay has nothing to say yet — but it is wired and mounted.
    expect(screen.queryByTestId('deck-indicator')).toBeNull()
    act(() => setWalkLocked(false))
    expect(screen.queryByTestId('wayfinding')).toBeNull()
  })
})

describe('Viewport share + autosave (M6-T3)', () => {
  it('boots the default Patrol preset and shows its share link', async () => {
    render(<Viewport />)
    await screen.findByTestId('walk-lock-prompt')
    expect(screen.getByTestId('share-control')).toBeInTheDocument()
    const url = screen.getByTestId('share-url') as HTMLInputElement
    expect(url.value).toContain('p=patrol')
    expect(screen.getByTestId('share-preset-patrol')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('re-assembles the ship, autosaves and rewrites the URL on a preset change', async () => {
    render(<Viewport />)
    await screen.findByTestId('walk-lock-prompt')
    fireEvent.click(screen.getByTestId('share-preset-long-haul'))
    await waitFor(() => {
      expect(window.location.search).toBe('?p=long-haul')
    })
    expect(window.localStorage.getItem(SHARE_STORAGE_KEY)).toBe('p=long-haul')
    expect(screen.getByTestId('share-preset-long-haul')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
