/**
 * M6-T3 — URL plumbing: read the share out of a location, build the link, and
 * keep the address bar in sync as the author changes the ship.
 *
 * The link is written with `history.replaceState` (never `pushState`): changing
 * the preset or the seed is not navigation, so it must not pile up back-button
 * entries. Only the query changes — the path is preserved — and when the query
 * already equals the encoded state the write is skipped, so a no-op change does
 * not touch history at all (and tests don't see spurious replaceState calls).
 */

import { decodeShareState, encodeShareState } from './codec'
import type { ShareState } from './types'

/** A location surface the URL helpers need (fakeable in tests). */
export interface LocationLike {
  pathname: string
  search: string
}

/** A history surface the URL helpers need (fakeable in tests). */
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
}

/** The URL target for reads/writes; defaults to the live browser window. */
export interface UrlTarget {
  location?: LocationLike | null
  history?: HistoryLike | null
}

/** Decode the share carried by a `location.search` (with or without the `?`). */
export function readShareFromSearch(search: string): ShareState | null {
  return decodeShareState(search)
}

/** Build the full shareable link for a state on top of `base` (origin + path). */
export function shareUrlFor(state: ShareState, base: string): string {
  const clean = base.split(/[?#]/)[0]
  return `${clean}?${encodeShareState(state)}`
}

/** The default target: the live window, or nulls when there is no window. */
function liveTarget(): Required<UrlTarget> {
  if (typeof window === 'undefined') {
    return { location: null, history: null }
  }
  return { location: window.location, history: window.history }
}

/**
 * Rewrite the address bar to `?<encoded state>`, preserving the path. Returns
 * true when history actually changed. No-op when the query already matches.
 */
export function syncShareUrl(state: ShareState, target: UrlTarget = {}): boolean {
  const live = liveTarget()
  const location = target.location === undefined ? live.location : target.location
  const history = target.history === undefined ? live.history : target.history
  if (!location || !history) {
    return false
  }
  const query = encodeShareState(state)
  const current = location.search.startsWith('?')
    ? location.search.slice(1)
    : location.search
  if (current === query) {
    return false
  }
  try {
    history.replaceState(null, '', `${location.pathname}?${query}`)
    return true
  } catch {
    return false
  }
}
