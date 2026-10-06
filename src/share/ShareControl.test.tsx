/**
 * M6-T3 tests — the share control (jsdom). The component is presentational:
 * it renders the presets / seed stepper / link and hands every change up
 * through `onChange`; the app owns persistence and the URL write.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LONG_HAUL_SPEC, PATROL_SPEC } from '../fixtures'
import { DEFAULT_WEAR_DENSITY } from '../wear/recipes'
import { ShareControl } from './ShareControl'
import { clampSeed } from './codec'
import type { ShareState } from './types'

function stateWith(seed = PATROL_SPEC.seed): ShareState {
  return { spec: PATROL_SPEC, seed, wearDensity: DEFAULT_WEAR_DENSITY }
}

/** Install (or replace) navigator.clipboard for a test. */
function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

function clearClipboard(): void {
  delete (navigator as { clipboard?: unknown }).clipboard
}

afterEach(() => {
  clearClipboard()
  vi.restoreAllMocks()
})

describe('M6-T3 share control', () => {
  it('renders the three preset ships with the current one active', () => {
    render(
      <ShareControl share={stateWith()} url="/ship?p=patrol" onChange={() => {}} />,
    )
    expect(screen.getByTestId('share-preset-patrol')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('share-preset-long-haul')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByTestId('share-preset-science')).toBeInTheDocument()
  })

  it('hands a preset selection up as a spec + its canonical seed', () => {
    const onChange = vi.fn()
    render(<ShareControl share={stateWith(5)} url="/ship" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('share-preset-long-haul'))
    expect(onChange).toHaveBeenCalledWith({
      spec: LONG_HAUL_SPEC,
      seed: LONG_HAUL_SPEC.seed,
      wearDensity: DEFAULT_WEAR_DENSITY,
    })
  })

  it('keeps the wear rung when switching preset', () => {
    const onChange = vi.fn()
    render(
      <ShareControl
        share={{ spec: PATROL_SPEC, seed: 2, wearDensity: 'reduced' }}
        url="/ship"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByTestId('share-preset-science'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ wearDensity: 'reduced' }),
    )
  })

  it('steps the seed up and down', () => {
    const onChange = vi.fn()
    render(<ShareControl share={stateWith(5)} url="/ship" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('share-seed-up'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ seed: 6 }))
    fireEvent.click(screen.getByTestId('share-seed-down'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ seed: 4 }))
  })

  it('clamps a stepped seed at zero', () => {
    const onChange = vi.fn()
    render(<ShareControl share={stateWith(0)} url="/ship" onChange={onChange} />)
    fireEvent.click(screen.getByTestId('share-seed-down'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ seed: 0 }))
  })

  it('accepts a typed seed', () => {
    const onChange = vi.fn()
    render(<ShareControl share={stateWith(5)} url="/ship" onChange={onChange} />)
    fireEvent.change(screen.getByTestId('share-seed'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ seed: 12 }))
  })

  it('clampSeed normalizes to a 32-bit unsigned integer', () => {
    expect(clampSeed(-3)).toBe(0)
    expect(clampSeed(1.9)).toBe(1)
    expect(clampSeed(Number.NaN)).toBe(0)
    expect(clampSeed(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampSeed(0x1_0000_0000 + 5)).toBe(0xffff_ffff)
  })

  it('shows the share link read-only', () => {
    render(
      <ShareControl
        share={stateWith(3)}
        url="/ship?p=patrol&seed=3"
        onChange={() => {}}
      />,
    )
    const input = screen.getByTestId('share-url') as HTMLInputElement
    expect(input.value).toBe('/ship?p=patrol&seed=3')
    expect(input).toHaveAttribute('readonly')
  })

  it('copies the link to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    render(
      <ShareControl share={stateWith()} url="/ship?p=patrol" onChange={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('share-copy'))
    expect(writeText).toHaveBeenCalledWith('/ship?p=patrol')
    await waitFor(() => {
      expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied')
    })
  })

  it('selects the link for manual copy when the Clipboard API is missing', () => {
    clearClipboard()
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    render(
      <ShareControl share={stateWith()} url="/ship?p=patrol" onChange={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('share-copy'))
    expect(select).toHaveBeenCalled()
  })

  it('selects the link when the clipboard write is rejected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    setClipboard({ writeText })
    const select = vi.spyOn(HTMLInputElement.prototype, 'select')
    render(
      <ShareControl share={stateWith()} url="/ship?p=patrol" onChange={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('share-copy'))
    await waitFor(() => {
      expect(select).toHaveBeenCalled()
    })
  })
})
