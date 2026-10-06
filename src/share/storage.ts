/**
 * M6-T3 — localStorage autosave (PRD §6.1 "autosave of the selected spec +
 * seed to localStorage").
 *
 * The autosave entry is exactly the share link's query string, stored under a
 * versioned key — one codec, one wire format, so a link and an autosave can
 * never disagree about how a ship is written down. Every browser touch is
 * wrapped: a denied/quotas-full storage (Safari private mode, a full disk)
 * returns false/null instead of throwing, because persistence is a
 * convenience, never a reason the walkthrough fails to boot.
 */

import { decodeShareState, encodeShareState } from './codec'
import type { ShareState } from './types'

/** Versioned storage key: a future format change starts a fresh entry. */
export const SHARE_STORAGE_KEY = 'torchship.share.v1'

/** The slice of the Web Storage API the autosave needs (fakeable in tests). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** The browser's localStorage, or null when there is none / it is denied. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Persist the current share state. false when there is no usable storage. */
export function saveAutosave(
  state: ShareState,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) {
    return false
  }
  try {
    storage.setItem(SHARE_STORAGE_KEY, encodeShareState(state))
    return true
  } catch {
    return false
  }
}

/** Read the autosaved share state, or null when absent / corrupt / no storage. */
export function loadAutosave(
  storage: StorageLike | null = browserStorage(),
): ShareState | null {
  if (!storage) {
    return null
  }
  try {
    const raw = storage.getItem(SHARE_STORAGE_KEY)
    return raw === null || raw === '' ? null : decodeShareState(raw)
  } catch {
    return null
  }
}

/** Drop the autosave entry (used by tests and a future "reset" affordance). */
export function clearAutosave(storage: StorageLike | null = browserStorage()): void {
  if (!storage) {
    return
  }
  try {
    storage.removeItem(SHARE_STORAGE_KEY)
  } catch {
    /* nothing to do — the entry is already unusable */
  }
}
