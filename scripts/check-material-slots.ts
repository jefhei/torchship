/**
 * M1-T4 — material-slot completeness build gate (PRD §7: "unassigned slot =
 * failed build").
 *
 * Runs before `tsc -b && vite build` in `npm run build` and as its own CI step,
 * so a theme that leaves any of the nine §4 material slots unassigned fails the
 * build with the offending theme + slot named. Loaded by Node's native
 * TypeScript type-stripping (Node ≥ 22.18) — no build step, no extra toolchain.
 */

import { MATERIAL_SLOTS } from '../src/types/materials.ts'
import { MATERIAL_THEMES, assertThemesComplete } from '../src/materials/index.ts'

try {
  assertThemesComplete(MATERIAL_THEMES)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    '✖ material-slot completeness check FAILED — the build will not ship a theme with unassigned slots:',
  )
  console.error(message)
  process.exit(1)
}

const assignments = MATERIAL_THEMES.length * MATERIAL_SLOTS.length
console.log(
  `✓ material-slot completeness: ${MATERIAL_THEMES.length} theme(s) × ` +
    `${MATERIAL_SLOTS.length} slots = ${assignments}/${assignments} assigned`,
)
