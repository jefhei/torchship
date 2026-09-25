/**
 * M1-T4 — material-slot completeness build gate (PRD §7: "unassigned slot =
 * failed build"). Extended at M4-T1 with the PBR-set half of the same gate.
 *
 * Runs before `tsc -b && vite build` in `npm run build` and as its own CI step,
 * so a theme that leaves any of the nine §4 material slots unassigned — or that
 * points a slot at a PBR set the registry does not know (M4-T1 `PBR_SETS`) —
 * fails the build with the offending theme + slot named. Loaded by Node's native
 * TypeScript type-stripping (Node ≥ 22.18) — no build step, no extra toolchain.
 */

import { MATERIAL_SLOTS } from '../src/types/materials.ts'
import {
  MATERIAL_THEMES,
  PBR_SETS,
  assertPbrSetsComplete,
  assertThemesComplete,
} from '../src/materials/index.ts'

try {
  // The nine authored PBR sets: one per §4 slot, well formed, uniquely declared.
  assertPbrSetsComplete(PBR_SETS)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('✖ PBR-set completeness check FAILED:')
  console.error(message)
  process.exit(1)
}

try {
  // Every theme must assign all nine slots AND every assignment must resolve to
  // one of those sets, declared for that slot (M4-T1).
  assertThemesComplete(MATERIAL_THEMES)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    '✖ material-slot completeness check FAILED — the build will not ship a theme with unassigned or unresolvable slots:',
  )
  console.error(message)
  process.exit(1)
}

const assignments = MATERIAL_THEMES.length * MATERIAL_SLOTS.length
console.log(
  `✓ material-slot completeness: ${MATERIAL_THEMES.length} theme(s) × ` +
    `${MATERIAL_SLOTS.length} slots = ${assignments}/${assignments} assigned`,
)
console.log(
  `✓ PBR sets: ${PBR_SETS.length}/${MATERIAL_SLOTS.length} §4 slots have an authored set, ` +
    `every theme slot resolves`,
)
