import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

/**
 * jsdom has no WebGL, so the real R3F <Canvas> cannot mount in tests.
 * Swap it for a stub that renders a <canvas> element and fires onCreated
 * after mount — enough to prove the shell mounts a viewport and the boot
 * callback path runs (the `ready` chip depends on it).
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

describe('App shell (M1-T1)', () => {
  it('renders the project title and ship class line in the header', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Torchship' })).toBeInTheDocument()
    expect(
      screen.getByText('Hound-class light corvette · ex-navy fusion torch'),
    ).toBeInTheDocument()
  })

  it('shows the vessel name (locked at build start, rule 9)', () => {
    render(<App />)
    expect(screen.getByTestId('ship-name')).toHaveTextContent('Firebrand')
  })

  it('mounts the 3D viewport with an R3F canvas inside the main area', () => {
    render(<App />)
    const main = screen.getByRole('main')
    expect(screen.getByTestId('viewport')).toBeInTheDocument()
    expect(main).toContainElement(screen.getByTestId('viewport'))
    expect(screen.getByTestId('viewport-canvas')).toBeInTheDocument()
  })

  it('flips to "ready" when the renderer boot callback fires', async () => {
    render(<App />)
    // The mock Canvas fires onCreated on mount; the chip proves the boot
    // path — renderer created — reached React state.
    expect(await screen.findByTestId('viewport-ready')).toBeInTheDocument()
    expect(screen.getByTestId('viewport-ready')).toHaveTextContent('viewport ready')
  })
})
