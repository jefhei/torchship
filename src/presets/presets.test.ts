/**
 * M1-T3 — preset JSON for the four canonical fixtures.
 *
 * BUILD_PLAN M1-T3: "…+ preset JSON for the four fixtures". The fixtures
 * (src/fixtures/registry.ts) are plain JSON-round-trippable data; the
 * checked-in preset files under public/presets/ are the serialized form the
 * M6 share-URL / preset picker loads at runtime (Vite serves public/ at the
 * site root, so /presets/patrol.json is fetchable as-is).
 *
 * These tests keep the files honest:
 *  - SYNC (generator): every fixture's file exists and parses back to the
 *    exact fixture object. When a fixture changes, this test REWRITES the
 *    file (like a golden-file updater) so the drift shows up in git status
 *    and is committed with the change — never silently ignored. The write
 *    is canonical JSON.stringify(2-space); run `npx prettier --write
 *    public/presets` afterwards (the repo formatter's JSON layout differs
 *    on nested arrays, so the comparison here is semantic, not textual).
 *  - GUARD: the checked-in files parse back to the exact fixture objects
 *    (id/label/description/expectValid/spec), so a hand-edited or stale
 *    preset cannot pass.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHIP_FIXTURES } from '../fixtures'
import type { ShipFixture } from '../fixtures'

/** Directory the presets are served from / checked in at. */
export const PRESET_DIR = resolve(process.cwd(), 'public', 'presets')

/** File name for a fixture's preset (fixture id + .json). */
export function presetFileName(fixture: ShipFixture): string {
  return `${fixture.id}.json`
}

/** Canonical serialized preset content for a fixture (2-space, trailing LF). */
export function presetJson(fixture: ShipFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}

function presetPath(fixture: ShipFixture): string {
  return join(PRESET_DIR, presetFileName(fixture))
}

describe('fixture preset JSON (public/presets)', () => {
  it('syncs a checked-in preset file for every canonical fixture', () => {
    mkdirSync(PRESET_DIR, { recursive: true })
    for (const fixture of SHIP_FIXTURES) {
      const path = presetPath(fixture)
      const onDisk = existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8'))
        : undefined
      // Semantic compare: formatting (prettier layout) never counts as drift.
      const stale = onDisk === undefined || !deepEqual(onDisk, fixture)
      if (stale) {
        writeFileSync(path, presetJson(fixture), 'utf8')
      }
      expect(JSON.parse(readFileSync(path, 'utf8'))).toStrictEqual(fixture)
    }
  })

  it('checked-in preset files parse back to the exact fixture objects', () => {
    for (const fixture of SHIP_FIXTURES) {
      const raw = readFileSync(presetPath(fixture), 'utf8')
      expect(JSON.parse(raw)).toStrictEqual(fixture)
    }
  })

  it('names the four presets by fixture id (patrol → stress)', () => {
    expect(SHIP_FIXTURES.map(presetFileName)).toEqual([
      'patrol.json',
      'long-haul.json',
      'science.json',
      'stress.json',
    ])
  })
})

/** Structural equality (JSON.parse output vs the plain-data fixture). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    )
  }
  return false
}
