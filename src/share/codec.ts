/**
 * M6-T3 — the share codec: `ShareState` ⇆ a URL query string.
 *
 * The link is deliberately COMPACT and PRESET-AWARE: when the spec is one of
 * the three canonical ships it is encoded as `p=<preset-id>` (the whole spec
 * already lives in the bundle — this is the common case, PRD §6.1's three
 * presets), otherwise the full spec travels as base64url JSON under `s=`.
 * `seed` (when it differs from the spec's own seed) and `w` (the wear rung,
 * when not the default) ride alongside. So the default ship shares as
 * `p=patrol` and a custom hull as `s=<base64url>`.
 *
 * The decoder is TOTAL and strict: it never throws, and it returns `null` for
 * anything it cannot reconstruct exactly — an unknown preset id, malformed
 * base64, JSON that is not a Ship Spec, a spec the M1-T3 validator rejects
 * (this is what keeps the deliberately-invalid stress rig from travelling in
 * a link), a non-integer/out-of-range seed, or an unknown wear rung. Callers
 * (./resolve) fall back to the autosave and then the default preset, so a
 * truncated link degrades gracefully instead of loading a half-built ship.
 *
 * base64url is UTF-8-safe (TextEncoder/TextDecoder): deck labels carry em
 * dashes ("Head — bridge"), which `btoa` alone would reject.
 */

import { getShipFixture, SHIP_FIXTURES } from '../fixtures'
import type { FixtureId } from '../fixtures'
import type { ShipSpec } from '../types'
import { isValidShipSpec } from '../validation'
import { DEFAULT_WEAR_DENSITY, WEAR_DENSITY_ORDER } from '../wear/recipes'
import type { WearDensity } from '../assembler'
import type { ShareState } from './types'

/** The codec's wire format version (bumped if the encoding ever changes shape). */
export const SHARE_VERSION = 1

/** The default preset a link with no spec source points at. */
export const DEFAULT_PRESET_ID: FixtureId = 'patrol'

/** The query parameter names the codec owns. */
export const SHARE_PARAMS = {
  /** Wire-format version (omitted while it is the current version). */
  version: 'v',
  /** Canonical preset id (short form). */
  preset: 'p',
  /** base64url JSON Ship Spec (custom form). */
  spec: 's',
  /** Variation seed, when it differs from the spec's own. */
  seed: 'seed',
  /** Worn-detail density, when not the default. */
  wear: 'w',
} as const

/** The real ships a share link may name (the stress rig is a negative control). */
export const REAL_PRESET_IDS: readonly FixtureId[] = SHIP_FIXTURES.filter(
  (fixture) => fixture.expectValid,
).map((fixture) => fixture.id)

/** The largest seed the codec accepts (the M4-T4 streams are 32-bit unsigned). */
export const MAX_SEED = 0xffff_ffff

/** Clamp a candidate seed into the accepted 32-bit unsigned range. */
export function clampSeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(MAX_SEED, Math.max(0, Math.trunc(value)))
}

/* --------------------------------------------------------------- base64url */

/** UTF-8 string → base64url (no padding), the URL-safe alphabet. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → UTF-8 string, or null when the token is not decodable. */
export function fromBase64Url(token: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(token)) {
    return null
  }
  const padded = token.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = padded.length % 4
  const withPadding = remainder === 0 ? padded : padded + '='.repeat(4 - remainder)
  let binary: string
  try {
    binary = atob(withPadding)
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/* ------------------------------------------------------------- deep equal */

/** Structural equality for the plain-JSON values a ShareState is made of. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((value, index) => deepEqual(value, b[index]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) {
      return false
    }
    return keys.every((key) => deepEqual(left[key], right[key]))
  }
  return false
}

/** True when two Ship Specs are the same ship, structurally. */
export function specsEqual(a: ShipSpec, b: ShipSpec): boolean {
  return deepEqual(a, b)
}

/** True when two share states are identical (used to skip no-op updates). */
export function shareStatesEqual(a: ShareState, b: ShareState): boolean {
  return deepEqual(a, b)
}

/* ---------------------------------------------------------------- decode */

/** Parse the mutable input forms the decoder accepts into a URLSearchParams. */
function toParams(input: string | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) {
    return input
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      return new URL(input).searchParams
    } catch {
      return new URLSearchParams()
    }
  }
  return new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
}

/** Whether the query carries at least one parameter the codec owns. */
function hasShareParams(params: URLSearchParams): boolean {
  const { preset, spec, seed, wear } = SHARE_PARAMS
  return [preset, spec, seed, wear].some((key) => params.get(key) !== null)
}

/** A parsed JSON value shaped like a Ship Spec (validated separately). */
function asSpec(value: unknown): ShipSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const spec = value as Partial<ShipSpec>
  if (
    typeof spec.classId !== 'string' ||
    typeof spec.name !== 'string' ||
    typeof spec.registry !== 'string' ||
    typeof spec.seed !== 'number' ||
    !Number.isFinite(spec.seed)
  ) {
    return null
  }
  if (!Array.isArray(spec.decks) || spec.decks.length === 0) {
    return null
  }
  return spec as ShipSpec
}

function parseSeed(raw: string | null, fallback: number): number | null {
  if (raw === null) {
    return fallback
  }
  if (!/^\d{1,10}$/.test(raw)) {
    return null
  }
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 && value <= MAX_SEED ? value : null
}

function parseWear(raw: string | null): WearDensity | null {
  if (raw === null) {
    return DEFAULT_WEAR_DENSITY
  }
  return (WEAR_DENSITY_ORDER as readonly string[]).includes(raw)
    ? (raw as WearDensity)
    : null
}

/** A fresh copy of a spec, so a decoded link can never alias a fixture object. */
function cloneSpec(spec: ShipSpec): ShipSpec {
  return JSON.parse(JSON.stringify(spec)) as ShipSpec
}

/**
 * Decode a query string / `URLSearchParams` / full URL into a ShareState.
 * Returns null when the input carries no share parameters or cannot be
 * reconstructed exactly (see the module header — the decoder is total).
 */
export function decodeShareState(input: string | URLSearchParams): ShareState | null {
  const params = toParams(input)
  const version = params.get(SHARE_PARAMS.version)
  if (version !== null && version !== String(SHARE_VERSION)) {
    return null
  }
  if (!hasShareParams(params)) {
    return null
  }

  const preset = params.get(SHARE_PARAMS.preset)
  const encoded = params.get(SHARE_PARAMS.spec)
  let spec: ShipSpec | null
  if (preset !== null) {
    spec = REAL_PRESET_IDS.includes(preset as FixtureId)
      ? cloneSpec(getShipFixture(preset as FixtureId).spec)
      : null
  } else if (encoded !== null) {
    const json = fromBase64Url(encoded)
    spec = json === null ? null : asSpec(safeJsonParse(json))
  } else {
    spec = cloneSpec(getShipFixture(DEFAULT_PRESET_ID).spec)
  }
  if (spec === null) {
    return null
  }
  try {
    if (!isValidShipSpec(spec)) {
      return null
    }
  } catch {
    return null
  }

  const seed = parseSeed(params.get(SHARE_PARAMS.seed), spec.seed)
  if (seed === null) {
    return null
  }
  const wearDensity = parseWear(params.get(SHARE_PARAMS.wear))
  if (wearDensity === null) {
    return null
  }
  return { spec, seed, wearDensity }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------- encode */

/**
 * Encode a ShareState into a query string (no leading `?`). Preset specs take
 * the short form; anything else is base64url JSON. Parameters are emitted in a
 * fixed order so the same state always yields the same link.
 */
export function encodeShareState(state: ShareState): string {
  const params = new URLSearchParams()
  const presetId = REAL_PRESET_IDS.find((id) =>
    specsEqual(getShipFixture(id).spec, state.spec),
  )
  if (presetId) {
    params.set(SHARE_PARAMS.preset, presetId)
  } else {
    params.set(SHARE_PARAMS.spec, toBase64Url(JSON.stringify(state.spec)))
  }
  if (state.seed !== state.spec.seed) {
    params.set(SHARE_PARAMS.seed, String(state.seed))
  }
  if (state.wearDensity !== DEFAULT_WEAR_DENSITY) {
    params.set(SHARE_PARAMS.wear, state.wearDensity)
  }
  return params.toString()
}
