/**
 * M6-T3 — resolution + apply: how the app decides which ship to load, and what
 * happens when the author changes it.
 *
 * PRECEDENCE (boot): a share link in the URL is an explicit instruction and
 * wins; otherwise the localStorage autosave from the last session; otherwise
 * the default preset (Patrol — the PRD §6.1 default). A link that carries share
 * parameters but fails to decode is treated as absent, so a corrupt link falls
 * back to the autosave rather than blocking the app.
 *
 * APPLY (on change): persist to localStorage AND rewrite the URL, so the
 * address bar is always the share link and a reload restores the same ship.
 */

import { PATROL_SPEC } from '../fixtures'
import type { ShipSpec } from '../types'
import { DEFAULT_WEAR_DENSITY } from '../wear/recipes'
import { decodeShareState } from './codec'
import { loadAutosave, saveAutosave } from './storage'
import type { StorageLike } from './storage'
import { syncShareUrl } from './url'
import type { UrlTarget } from './url'
import type { ShareState } from './types'

export { DEFAULT_PRESET_ID } from './codec'
export { shareStatesEqual } from './codec'

/** The ship the app boots with when there is no link and no autosave. */
export function defaultShareState(): ShareState {
  return {
    spec: PATROL_SPEC,
    seed: PATROL_SPEC.seed,
    wearDensity: DEFAULT_WEAR_DENSITY,
  }
}

/** Inputs to `resolveShareState` (both fakeable in tests). */
export interface ResolveInput {
  /** A `location.search` (with or without the `?`); omit to skip the URL. */
  search?: string
  /** Storage override; null means "no storage"; omit for the browser's. */
  storage?: StorageLike | null
}

/** Pick the share state to load: URL → autosave → default preset. */
export function resolveShareState(input: ResolveInput = {}): ShareState {
  if (typeof input.search === 'string') {
    const fromUrl = decodeShareState(input.search)
    if (fromUrl) {
      return fromUrl
    }
  }
  return loadAutosave(input.storage) ?? defaultShareState()
}

/**
 * The spec to assemble: the selected seed is authoritative, so the effective
 * spec is the stored spec with its `seed` field overridden. A fresh object, so
 * the caller (and React memo deps) never mutate a shared fixture.
 */
export function effectiveSpec(state: ShareState): ShipSpec {
  return { ...state.spec, seed: state.seed }
}

/** Where `applyShareState` writes (defaults to the live window + storage). */
export interface ApplyTarget extends UrlTarget {
  storage?: StorageLike | null
}

/** The outcome of an apply, for the UI/tests to observe. */
export interface ApplyResult {
  persisted: boolean
  urlUpdated: boolean
}

/** Persist + publish a state: save the autosave and rewrite the address bar. */
export function applyShareState(
  state: ShareState,
  target: ApplyTarget = {},
): ApplyResult {
  return {
    persisted: saveAutosave(state, target.storage),
    urlUpdated: syncShareUrl(state, target),
  }
}
