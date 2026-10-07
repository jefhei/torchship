/**
 * M6-T4 — the deploy surface: what the built demo IS, and the gate that a
 * `dist/` build is actually shippable.
 *
 * BUILD_PLAN M6-T4 is "Deploy demo + README with screenshots". The deployable
 * artifact is the M1-T1 Vite app: a client-only static site. This module makes
 * the deploy claims CHECKABLE rather than asserted, in the same "data, never a
 * throw" posture as every other gate in the repo:
 *
 *  - `PRODUCTION_BASE` is the Vite `base` the app ships with (`./`, relative).
 *    The default absolute base (`/`) hard-codes the site to a domain root; a
 *    project site is served from a subpath (`/torchship/`) and would 404 on
 *    every `/assets/...` URL. A RELATIVE base makes one `dist/` serve from any
 *    mount point — the project-site subpath AND a plain static host — which is
 *    exactly what `distProblems` asserts of the built `index.html`.
 *  - `DEPLOY_TARGETS` names where the demo can live (a GitHub Pages project
 *    site and any static host) with the mount path each needs; `deployUrlFor`
 *    builds a preset-deep link (`?p=<preset>`) so the README can point at a
 *    specific ship.
 *  - `distProblems(files)` is the gate: `index.html` present, no root-absolute
 *    asset refs (the subpath guarantee), every referenced local asset really in
 *    the build, the favicon and the four preset JSONs present, and a JS + CSS
 *    bundle. It reads a plain file list (path + optional text) so it is pure —
 *    `src/demo/dist.test.ts` feeds it the REAL `dist/` when one exists.
 *
 * Pure and dependency-light (no fs, no three): the caller reads the disk.
 */

import type { FixtureId } from '../fixtures'

/**
 * The Vite `base` the app is built with (vite.config.ts). Relative, so the
 * built `index.html` references assets with `./...` and the SAME `dist/` serves
 * from `https://host/`, `https://host/torchship/` or a file subdirectory.
 */
export const PRODUCTION_BASE = './'

/** One place the built demo can be served from. */
export interface DeployTarget {
  id: 'github-pages' | 'static'
  /** Human label for the README. */
  label: string
  /** The absolute demo URL, or null when it depends on where it is hosted. */
  url: string | null
  /** The path `dist/` is mounted under on this target. */
  mountPath: string
  /** Why this target / how it is served (README prose). */
  note: string
}

/**
 * The deploy targets, primary first. GitHub Pages (a project site) is the
 * shipped demo; `static` is the generic "any web server" case the relative
 * base buys us (and what `npm run preview` exercises locally).
 */
export const DEPLOY_TARGETS: readonly DeployTarget[] = [
  {
    id: 'github-pages',
    label: 'GitHub Pages (project site)',
    url: 'https://jefhei.github.io/torchship/',
    mountPath: '/torchship/',
    note: 'A project site is served from the /torchship/ subpath, which only works because the build uses the relative base.',
  },
  {
    id: 'static',
    label: 'Any static host or `npm run preview`',
    url: null,
    mountPath: '/',
    note: 'The relative base means the same dist/ also runs from a domain root or a local preview.',
  },
]

/** The target the README points at by default. */
export const DEFAULT_DEPLOY_TARGET_ID: DeployTarget['id'] = 'github-pages'

/** Look up a deploy target by id (unknown ids surface immediately). */
export function getDeployTarget(id: DeployTarget['id']): DeployTarget {
  const target = DEPLOY_TARGETS.find((t) => t.id === id)
  if (target === undefined) {
    throw new Error(`deploy: no target "${id}"`)
  }
  return target
}

/**
 * A preset-deep demo link for a target, or null when the target has no absolute
 * URL to link to. The default preset is the bare URL (the app boots Patrol
 * anyway); any other preset rides as `?p=<preset>` — the M6-T3 share codec's own
 * token.
 */
export function deployUrlFor(target: DeployTarget, preset?: FixtureId): string | null {
  if (target.url === null) {
    return null
  }
  return preset === undefined ? target.url : `${target.url}?p=${preset}`
}

/* ------------------------------------------------------------------- the gate */

/** One file in a built `dist/`: its path relative to `dist/` (POSIX) + its text. */
export interface DistFile {
  path: string
  /** Text content, when the caller read it (only `index.html` is needed). */
  text?: string
}

/** The four preset JSONs the build must carry (copied from `public/presets/`). */
export const DIST_PRESET_FILES: readonly string[] = [
  'presets/patrol.json',
  'presets/long-haul.json',
  'presets/science.json',
  'presets/stress.json',
]

/** Normalize a dist path: POSIX, no leading `./`, no trailing slash. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Every `href="..."` / `src="..."` value in an HTML document, in order. */
export function assetRefs(html: string): string[] {
  const refs: string[] = []
  const re = /\b(?:href|src)\s*=\s*"([^"]*)"/g
  let match = re.exec(html)
  while (match !== null) {
    refs.push(match[1])
    match = re.exec(html)
  }
  return refs
}

/** True for a ref that names a file in the build (not external, data: or a fragment). */
function isLocalRef(ref: string): boolean {
  return (
    !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) &&
    !ref.startsWith('data:') &&
    !ref.startsWith('#') &&
    !ref.startsWith('mailto:')
  )
}

/**
 * The deploy gate over a built `dist/`: everything a subpath-hosted static site
 * needs, reported as data (empty = shippable). `base` is the Vite base the build
 * was made with (default `PRODUCTION_BASE`).
 */
export function distProblems(
  files: readonly DistFile[],
  options: { base?: string } = {},
): string[] {
  const problems: string[] = []
  const paths = new Set(files.map((file) => normalize(file.path)))
  const index = files.find((file) => normalize(file.path) === 'index.html')
  if (index === undefined) {
    problems.push('dist/index.html is missing — the build produced no entry document')
  } else if (index.text !== undefined) {
    const base = options.base ?? PRODUCTION_BASE
    for (const ref of assetRefs(index.text)) {
      if (!isLocalRef(ref)) {
        continue
      }
      if (ref.startsWith('/')) {
        problems.push(
          `index.html references "${ref}" with a root-absolute path — it only works mounted at "/" (build with base "${base}")`,
        )
        continue
      }
      const target = normalize(ref.split('?')[0].split('#')[0])
      if (target !== '' && !paths.has(target)) {
        problems.push(`index.html references "${ref}" but dist has no "${target}"`)
      }
    }
  }

  for (const required of ['favicon.svg', ...DIST_PRESET_FILES]) {
    if (!paths.has(required)) {
      problems.push(`dist is missing "${required}"`)
    }
  }
  if (![...paths].some((path) => /^assets\/[^/]+\.js$/.test(path))) {
    problems.push('dist has no assets/*.js — the app bundle is missing')
  }
  if (![...paths].some((path) => /^assets\/[^/]+\.css$/.test(path))) {
    problems.push('dist has no assets/*.css — the stylesheet is missing')
  }
  return problems
}
