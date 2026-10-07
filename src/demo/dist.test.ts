/**
 * M6-T4 — the deploy gate over the REAL `dist/`.
 *
 * `npm run test` runs before `npm run build`, so on a clean checkout there is no
 * `dist/` and this suite SKIPS. When a build is present (the verification run,
 * or `npm run verify` after a build) it reads the actual files the deploy gate
 * would see — that is what makes "the built demo is shippable from a subpath"
 * a measurement rather than an assertion.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { distProblems, type DistFile } from './index'

const DIST_DIR = path.resolve('dist')
const HAS_DIST = existsSync(path.join(DIST_DIR, 'index.html'))

/** Every file under `dist/`, POSIX-relative, with index.html read as text. */
function distFiles(): DistFile[] {
  const out: DistFile[] = []
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(DIST_DIR, rel), {
      withFileTypes: true,
    })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
      } else if (child === 'index.html') {
        out.push({
          path: child,
          text: readFileSync(path.join(DIST_DIR, child), 'utf8'),
        })
      } else {
        out.push({ path: child })
      }
    }
  }
  walk('')
  return out
}

describe('M6-T4 real build', () => {
  it.skipIf(!HAS_DIST)(
    'the built dist/ satisfies the deploy contract (relative base, presets, bundles)',
    () => {
      expect(distProblems(distFiles())).toEqual([])
    },
  )
})
