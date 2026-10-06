/**
 * M6-T3 — the share control: the DOM affordance over the share codec.
 *
 * A compact panel (top-right of the viewport, independent of pointer lock)
 * that exposes exactly what the PRD §6.1 authoring must-have names: the three
 * preset ships, a seed stepper, and the resulting share link with a copy
 * button. It is presentational — it holds only the transient "copied" flag and
 * hands every real change up through `onChange`, so the app owns persistence
 * (localStorage) and the URL write (`applyShareState`).
 *
 * The active preset is matched structurally against the spec (`specsEqual`),
 * so the highlight is derived from the state, never a separate selection flag
 * that could drift.
 */

import { useRef, useState } from 'react'
import { getShipFixture } from '../fixtures'
import type { FixtureId } from '../fixtures'
import { MAX_SEED, REAL_PRESET_IDS, clampSeed, specsEqual } from './codec'
import type { ShareState } from './types'

export interface ShareControlProps {
  /** The current share state (spec + seed + wear rung). */
  share: ShareState
  /** The shareable link for that state (built by the app). */
  url: string
  /** Called with a changed state; the app persists it and rewrites the URL. */
  onChange: (next: ShareState) => void
}

export function ShareControl({ share, url, onChange }: ShareControlProps) {
  const [copied, setCopied] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  const selectPreset = (id: FixtureId) => {
    const spec = getShipFixture(id).spec
    onChange({ spec, seed: spec.seed, wearDensity: share.wearDensity })
  }

  const setSeed = (value: number) => {
    onChange({ ...share, seed: clampSeed(value) })
  }

  const copyLink = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) {
      urlRef.current?.select()
      return
    }
    void clipboard.writeText(url).then(
      () => setCopied(true),
      () => urlRef.current?.select(),
    )
  }

  return (
    <div className="share-control" data-testid="share-control">
      <div className="share-row">
        <span className="share-label">Ship</span>
        <div className="share-presets" role="group" aria-label="Ship preset">
          {REAL_PRESET_IDS.map((id) => {
            const fixture = getShipFixture(id)
            const active = specsEqual(fixture.spec, share.spec)
            return (
              <button
                key={id}
                type="button"
                className={active ? 'share-preset share-preset-active' : 'share-preset'}
                data-testid={`share-preset-${id}`}
                aria-pressed={active}
                onClick={() => selectPreset(id)}
              >
                {fixture.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="share-row">
        <span className="share-label">Seed</span>
        <button
          type="button"
          className="share-stepper"
          data-testid="share-seed-down"
          aria-label="Seed down"
          onClick={() => setSeed(share.seed - 1)}
        >
          −
        </button>
        <input
          type="number"
          className="share-seed"
          data-testid="share-seed"
          aria-label="Variation seed"
          min={0}
          max={MAX_SEED}
          value={share.seed}
          onChange={(event) => setSeed(Number(event.currentTarget.value))}
        />
        <button
          type="button"
          className="share-stepper"
          data-testid="share-seed-up"
          aria-label="Seed up"
          onClick={() => setSeed(share.seed + 1)}
        >
          +
        </button>
      </div>
      <div className="share-row">
        <input
          ref={urlRef}
          className="share-url"
          data-testid="share-url"
          aria-label="Share link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="share-copy"
          data-testid="share-copy"
          onClick={copyLink}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </div>
  )
}
