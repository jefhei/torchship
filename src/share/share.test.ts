/**
 * M6-T3 tests — the pure share layer: codec, localStorage autosave, URL
 * plumbing, and resolution precedence. No DOM (except the storage/URL fakes),
 * no WebGL, no dev server.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  STRESS_SPEC,
  getShipFixture,
} from '../fixtures'
import type { ShipSpec } from '../types'
import { shipSpecProblems } from '../validation'
import { DEFAULT_WEAR_DENSITY } from '../wear/recipes'
import {
  MAX_SEED,
  REAL_PRESET_IDS,
  SHARE_PARAMS,
  SHARE_VERSION,
  decodeShareState,
  encodeShareState,
  fromBase64Url,
  shareStatesEqual,
  specsEqual,
  toBase64Url,
} from './codec'
import { SHARE_STORAGE_KEY, clearAutosave, loadAutosave, saveAutosave } from './storage'
import type { StorageLike } from './storage'
import { readShareFromSearch, shareUrlFor, syncShareUrl } from './url'
import type { HistoryLike, LocationLike } from './url'
import {
  applyShareState,
  defaultShareState,
  effectiveSpec,
  resolveShareState,
} from './resolve'
import type { ShareState } from './types'

/** The default share state: Patrol, its own seed, full wear. */
function patrolState(): ShareState {
  return {
    spec: PATROL_SPEC,
    seed: PATROL_SPEC.seed,
    wearDensity: DEFAULT_WEAR_DENSITY,
  }
}

/** A spec that matches no canonical preset but is still a valid ship. */
const CUSTOM_SPEC: ShipSpec = {
  ...PATROL_SPEC,
  name: 'Firebrand — Refit',
  registry: 'HCS-427R',
}

/** An in-memory StorageLike with a data map for assertions. */
function fakeStorage(
  initial: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    },
    removeItem: (key) => {
      delete data[key]
    },
  }
}

/** A StorageLike whose every method throws (denied / quota-full storage). */
function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('quota')
    },
    removeItem: () => {
      throw new Error('denied')
    },
  }
}

function locationOf(search: string, pathname = '/ship'): LocationLike {
  return { pathname, search }
}

describe('M6-T3 share codec', () => {
  it('encodes the default preset in short form (spec + seed in one token)', () => {
    expect(encodeShareState(patrolState())).toBe('p=patrol')
  })

  it('round-trips every canonical real ship', () => {
    for (const id of REAL_PRESET_IDS) {
      const fixture = getShipFixture(id)
      const state: ShareState = {
        spec: fixture.spec,
        seed: fixture.spec.seed,
        wearDensity: DEFAULT_WEAR_DENSITY,
      }
      const decoded = decodeShareState(encodeShareState(state))
      expect(decoded).not.toBeNull()
      expect(decoded?.spec).toEqual(fixture.spec)
      expect(decoded?.seed).toBe(fixture.spec.seed)
      expect(decoded?.wearDensity).toBe(DEFAULT_WEAR_DENSITY)
    }
  })

  it('carries a non-default seed explicitly, and omits it when it matches the spec', () => {
    expect(encodeShareState({ ...patrolState(), seed: 7 })).toBe('p=patrol&seed=7')
    expect(decodeShareState('p=patrol&seed=7')?.seed).toBe(7)
    expect(encodeShareState({ ...patrolState(), seed: PATROL_SPEC.seed })).toBe(
      'p=patrol',
    )
    expect(decodeShareState('p=patrol')?.seed).toBe(PATROL_SPEC.seed)
  })

  it('carries a non-default wear rung, and omits the default', () => {
    expect(encodeShareState({ ...patrolState(), wearDensity: 'reduced' })).toBe(
      'p=patrol&w=reduced',
    )
    expect(decodeShareState('p=patrol&w=reduced')?.wearDensity).toBe('reduced')
    expect(encodeShareState(patrolState())).not.toContain('w=')
  })

  it('encodes a custom spec as base64url JSON and round-trips UTF-8 labels', () => {
    const state: ShareState = {
      spec: CUSTOM_SPEC,
      seed: 42,
      wearDensity: 'off',
    }
    const query = encodeShareState(state)
    expect(query.startsWith(`${SHARE_PARAMS.spec}=`)).toBe(true)
    const decoded = decodeShareState(query)
    expect(decoded?.spec).toEqual(CUSTOM_SPEC)
    // The em dash in the name survived the base64url round trip.
    expect(decoded?.spec.name).toBe('Firebrand — Refit')
    expect(decoded?.seed).toBe(42)
    expect(decoded?.wearDensity).toBe('off')
  })

  it('emits parameters in a fixed order (deterministic link)', () => {
    const state: ShareState = { spec: PATROL_SPEC, seed: 3, wearDensity: 'off' }
    expect(encodeShareState(state)).toBe('p=patrol&seed=3&w=off')
    expect(encodeShareState(state)).toBe(encodeShareState(state))
  })

  it('rejects an unknown preset id', () => {
    expect(decodeShareState('p=destroyer')).toBeNull()
    expect(decodeShareState('p=')).toBeNull()
  })

  it('rejects malformed or non-JSON base64', () => {
    expect(decodeShareState('s=!!!not-base64')).toBeNull()
    expect(decodeShareState(`s=${toBase64Url('this is not json')}`)).toBeNull()
    expect(decodeShareState(`s=${toBase64Url('42')}`)).toBeNull()
  })

  it('rejects JSON that is not a Ship Spec', () => {
    expect(
      decodeShareState(`s=${toBase64Url(JSON.stringify({ hello: 1 }))}`),
    ).toBeNull()
    expect(
      decodeShareState(
        `s=${toBase64Url(JSON.stringify({ classId: 'x', name: 'y', decks: [] }))}`,
      ),
    ).toBeNull()
  })

  it('rejects a spec the M1-T3 validator rejects (the stress rig stays out of links)', () => {
    // The negative fixture really is invalid...
    expect(shipSpecProblems(STRESS_SPEC).length).toBeGreaterThan(0)
    // ...so a link that encodes it decodes to null.
    expect(decodeShareState(`s=${toBase64Url(JSON.stringify(STRESS_SPEC))}`)).toBeNull()
  })

  it('rejects a spec referencing an unknown module', () => {
    const broken: ShipSpec = {
      ...PATROL_SPEC,
      decks: [
        {
          id: 'x',
          label: 'X',
          yPosition: 0,
          modules: [{ moduleId: 'nope', rotation: 0, offset: [0, 0, 0] }],
        },
      ],
    }
    expect(decodeShareState(`s=${toBase64Url(JSON.stringify(broken))}`)).toBeNull()
  })

  it('rejects an out-of-range or non-integer seed', () => {
    for (const bad of [
      '-1',
      '1.5',
      'abc',
      '',
      ' 4',
      String(MAX_SEED + 1),
      '99999999999',
    ]) {
      expect(decodeShareState(`p=patrol&seed=${bad}`)).toBeNull()
    }
    expect(decodeShareState('p=patrol&seed=0')?.seed).toBe(0)
    expect(decodeShareState(`p=patrol&seed=${MAX_SEED}`)?.seed).toBe(MAX_SEED)
  })

  it('rejects an unknown wear rung', () => {
    expect(decodeShareState('p=patrol&w=maximum')).toBeNull()
  })

  it('returns null for a query with no share parameters', () => {
    for (const empty of ['', '?', '?foo=1', '?utm_source=x&page=2']) {
      expect(decodeShareState(empty)).toBeNull()
    }
  })

  it('ignores unknown extra parameters on an otherwise valid link', () => {
    expect(decodeShareState('p=patrol&utm_source=newsletter')?.spec).toEqual(
      PATROL_SPEC,
    )
  })

  it('honours the wire version: current decodes, a future version does not', () => {
    expect(decodeShareState(`v=${SHARE_VERSION}&p=patrol`)?.spec).toEqual(PATROL_SPEC)
    expect(decodeShareState('v=99&p=patrol')).toBeNull()
  })

  it('accepts URLSearchParams and a full URL as well as a bare query', () => {
    const fromParams = decodeShareState(new URLSearchParams('p=science'))
    expect(fromParams?.spec).toEqual(SCIENCE_SPEC)
    const fromUrl = decodeShareState('https://x.test/ship?p=science&seed=2')
    expect(fromUrl?.spec).toEqual(SCIENCE_SPEC)
    expect(fromUrl?.seed).toBe(2)
  })

  it('returns a fresh spec copy, never the fixture object', () => {
    const decoded = decodeShareState('p=patrol')
    expect(decoded?.spec).not.toBe(PATROL_SPEC)
    expect(decoded?.spec).toEqual(PATROL_SPEC)
  })

  it('exports the real preset ids and the wire constants', () => {
    expect(REAL_PRESET_IDS).toEqual(['patrol', 'long-haul', 'science'])
    expect(SHARE_VERSION).toBe(1)
    expect(MAX_SEED).toBe(0xffff_ffff)
  })

  it('base64url round-trips UTF-8 and produces only URL-safe characters', () => {
    const text = 'Head — bridge · 4.2 m ✓'
    const token = toBase64Url(text)
    expect(token).toMatch(/^[A-Za-z0-9_-]*$/)
    expect(fromBase64Url(token)).toBe(text)
    expect(fromBase64Url('!!!')).toBeNull()
  })

  it('specsEqual and shareStatesEqual are structural', () => {
    expect(specsEqual(PATROL_SPEC, PATROL_SPEC)).toBe(true)
    expect(specsEqual(PATROL_SPEC, LONG_HAUL_SPEC)).toBe(false)
    expect(specsEqual(PATROL_SPEC, { ...PATROL_SPEC })).toBe(true)
    expect(shareStatesEqual(patrolState(), patrolState())).toBe(true)
    expect(shareStatesEqual(patrolState(), { ...patrolState(), seed: 9 })).toBe(false)
    expect(
      shareStatesEqual(patrolState(), { ...patrolState(), wearDensity: 'off' }),
    ).toBe(false)
  })
})

describe('M6-T3 localStorage autosave', () => {
  it('saves then loads the same state under a versioned key', () => {
    const storage = fakeStorage()
    const state: ShareState = { spec: LONG_HAUL_SPEC, seed: 5, wearDensity: 'reduced' }
    expect(saveAutosave(state, storage)).toBe(true)
    expect(storage.data[SHARE_STORAGE_KEY]).toBe('p=long-haul&seed=5&w=reduced')
    const loaded = loadAutosave(storage)
    expect(loaded?.spec).toEqual(LONG_HAUL_SPEC)
    expect(loaded?.seed).toBe(5)
    expect(loaded?.wearDensity).toBe('reduced')
  })

  it('stores the share query string so a link and an autosave share one format', () => {
    const storage = fakeStorage()
    const state: ShareState = { spec: CUSTOM_SPEC, seed: 8, wearDensity: 'full' }
    saveAutosave(state, storage)
    expect(storage.data[SHARE_STORAGE_KEY]).toBe(encodeShareState(state))
  })

  it('loads null for an absent or empty entry', () => {
    expect(loadAutosave(fakeStorage())).toBeNull()
    expect(loadAutosave(fakeStorage({ [SHARE_STORAGE_KEY]: '' }))).toBeNull()
  })

  it('loads null for a corrupt entry instead of throwing', () => {
    expect(loadAutosave(fakeStorage({ [SHARE_STORAGE_KEY]: 'p=destroyer' }))).toBeNull()
    expect(loadAutosave(fakeStorage({ [SHARE_STORAGE_KEY]: 'garbage!!' }))).toBeNull()
  })

  it('overwrites a previous entry and clears on demand', () => {
    const storage = fakeStorage()
    saveAutosave(patrolState(), storage)
    saveAutosave({ spec: SCIENCE_SPEC, seed: 2, wearDensity: 'off' }, storage)
    expect(loadAutosave(storage)?.spec).toEqual(SCIENCE_SPEC)
    clearAutosave(storage)
    expect(storage.data[SHARE_STORAGE_KEY]).toBeUndefined()
    expect(loadAutosave(storage)).toBeNull()
  })

  it('degrades safely when storage throws (denied / quota-full)', () => {
    expect(saveAutosave(patrolState(), throwingStorage())).toBe(false)
    expect(loadAutosave(throwingStorage())).toBeNull()
    expect(() => clearAutosave(throwingStorage())).not.toThrow()
  })

  it('reports no persistence and no state when there is no storage', () => {
    expect(saveAutosave(patrolState(), null)).toBe(false)
    expect(loadAutosave(null)).toBeNull()
    expect(() => clearAutosave(null)).not.toThrow()
  })
})

describe('M6-T3 URL plumbing', () => {
  it('reads a share out of a location.search (with or without the ?)', () => {
    expect(readShareFromSearch('?p=long-haul&seed=4')?.seed).toBe(4)
    expect(readShareFromSearch('p=long-haul&seed=4')?.spec).toEqual(LONG_HAUL_SPEC)
    expect(readShareFromSearch('')).toBeNull()
  })

  it('builds a link from origin + path', () => {
    expect(shareUrlFor(patrolState(), 'https://x.test/ship')).toBe(
      'https://x.test/ship?p=patrol',
    )
  })

  it('strips any existing query or hash from the base', () => {
    const url = shareUrlFor(
      { ...patrolState(), seed: 2 },
      'https://x.test/ship?old=1#deck',
    )
    expect(url).toBe('https://x.test/ship?p=patrol&seed=2')
  })

  it('produces links that decode back to the same state', () => {
    const state: ShareState = { spec: SCIENCE_SPEC, seed: 11, wearDensity: 'reduced' }
    const url = shareUrlFor(state, '/ship')
    const decoded = decodeShareState(new URL(url, 'https://x.test').search)
    expect(decoded?.spec).toEqual(state.spec)
    expect(decoded?.seed).toBe(state.seed)
    expect(decoded?.wearDensity).toBe(state.wearDensity)
  })

  it('writes the query, preserving the path, and reports the change', () => {
    const replaceState = vi.fn()
    const history: HistoryLike = { replaceState }
    const updated = syncShareUrl(
      { ...patrolState(), seed: 3 },
      {
        location: locationOf(''),
        history,
      },
    )
    expect(updated).toBe(true)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/ship?p=patrol&seed=3')
  })

  it('is a no-op when the address bar already matches', () => {
    const replaceState = vi.fn()
    const updated = syncShareUrl(patrolState(), {
      location: locationOf('?p=patrol'),
      history: { replaceState },
    })
    expect(updated).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('does nothing without a location or history', () => {
    expect(syncShareUrl(patrolState(), { location: null, history: null })).toBe(false)
    expect(
      syncShareUrl(patrolState(), { location: locationOf(''), history: null }),
    ).toBe(false)
  })
})

describe('M6-T3 resolution + apply', () => {
  it('defaults to Patrol with its seed and full wear', () => {
    const state = defaultShareState()
    expect(state.spec).toBe(PATROL_SPEC)
    expect(state.seed).toBe(PATROL_SPEC.seed)
    expect(state.wearDensity).toBe(DEFAULT_WEAR_DENSITY)
  })

  it('prefers an explicit share link over the autosave and the default', () => {
    const storage = fakeStorage({
      [SHARE_STORAGE_KEY]: encodeShareState({
        spec: LONG_HAUL_SPEC,
        seed: 9,
        wearDensity: 'off',
      }),
    })
    const resolved = resolveShareState({ search: '?p=science&seed=2', storage })
    expect(resolved.spec).toEqual(SCIENCE_SPEC)
    expect(resolved.seed).toBe(2)
  })

  it('falls back to the autosave when there is no URL share', () => {
    const storage = fakeStorage({
      [SHARE_STORAGE_KEY]: encodeShareState({
        spec: SCIENCE_SPEC,
        seed: 6,
        wearDensity: 'reduced',
      }),
    })
    const resolved = resolveShareState({ search: '', storage })
    expect(resolved.spec).toEqual(SCIENCE_SPEC)
    expect(resolved.seed).toBe(6)
    expect(resolved.wearDensity).toBe('reduced')
  })

  it('falls back to the default when neither the URL nor the autosave has a state', () => {
    const resolved = resolveShareState({ search: '', storage: fakeStorage() })
    expect(resolved.spec).toBe(PATROL_SPEC)
    expect(resolved.seed).toBe(PATROL_SPEC.seed)
  })

  it('treats a malformed URL share as absent and uses the autosave', () => {
    const storage = fakeStorage({
      [SHARE_STORAGE_KEY]: encodeShareState({
        spec: LONG_HAUL_SPEC,
        seed: 1,
        wearDensity: 'full',
      }),
    })
    const resolved = resolveShareState({ search: '?p=destroyer', storage })
    expect(resolved.spec).toEqual(LONG_HAUL_SPEC)
  })

  it('skips the autosave entirely when storage is null', () => {
    const resolved = resolveShareState({ search: '', storage: null })
    expect(resolved.spec).toBe(PATROL_SPEC)
  })

  it('effectiveSpec applies the selected seed without mutating the source', () => {
    const state: ShareState = { spec: PATROL_SPEC, seed: 77, wearDensity: 'full' }
    const effective = effectiveSpec(state)
    expect(effective.seed).toBe(77)
    expect(effective.decks).toBe(PATROL_SPEC.decks)
    expect(PATROL_SPEC.seed).toBe(1)
    expect(state.spec.seed).toBe(1)
  })

  it('applies a change: persists the autosave and rewrites the URL', () => {
    const storage = fakeStorage()
    const replaceState = vi.fn()
    const state: ShareState = { spec: SCIENCE_SPEC, seed: 4, wearDensity: 'reduced' }
    const result = applyShareState(state, {
      storage,
      location: locationOf('?p=patrol'),
      history: { replaceState },
    })
    expect(result).toEqual({ persisted: true, urlUpdated: true })
    expect(loadAutosave(storage)?.spec).toEqual(SCIENCE_SPEC)
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/ship?p=science&seed=4&w=reduced',
    )
  })

  it('reports no persistence when there is no storage but still writes the URL', () => {
    const replaceState = vi.fn()
    const result = applyShareState(
      { ...patrolState(), seed: 2 },
      {
        storage: null,
        location: locationOf(''),
        history: { replaceState },
      },
    )
    expect(result.persisted).toBe(false)
    expect(result.urlUpdated).toBe(true)
  })
})
