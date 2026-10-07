/**
 * M6-T4 — the deploy gate over a real built `dist/`.
 *
 * The pure gate lives in `src/demo/deploy.ts`; this is its CLI runner (the same
 * "Node's native TS type-stripping, no build step" shape as
 * `scripts/check-material-slots.ts` — `deploy.ts` has only TYPE imports, so it
 * loads directly). Run after a build:
 *
 *   npm run build && npm run check:dist      # or: npm run deploy:check
 *
 * It exits 1, naming the problem, when the build is not shippable from a
 * subpath (a root-absolute asset ref, a missing preset, no JS/CSS bundle).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { PRODUCTION_BASE, distProblems, type DistFile } from '../src/demo/deploy.ts'

const DIST_DIR = path.resolve('dist')
if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(
    '✖ no built dist/ (dist/index.html missing) — run `npm run build` first',
  )
  process.exit(1)
}

const files: DistFile[] = []
const walk = (rel: string): void => {
  const dir = path.join(DIST_DIR, rel)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      walk(child)
    } else {
      const full = path.join(DIST_DIR, child)
      const isIndex = child === 'index.html'
      files.push(
        isIndex ? { path: child, text: readFileSync(full, 'utf8') } : { path: child },
      )
    }
  }
}
walk('')

const problems = distProblems(files, { base: PRODUCTION_BASE })
if (problems.length > 0) {
  console.error(`✖ deploy check FAILED (base "${PRODUCTION_BASE}"):`)
  for (const problem of problems) {
    console.error(`  - ${problem}`)
  }
  process.exit(1)
}

const bytes = files.reduce(
  (total, file) => total + statSync(path.join(DIST_DIR, file.path)).size,
  0,
)
console.log(
  `✔ dist/ is deployable from base "${PRODUCTION_BASE}" ` +
    `(${files.length} files, ${(bytes / 1_048_576).toFixed(1)} MiB)`,
)
