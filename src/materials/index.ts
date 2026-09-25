/**
 * M1-T4 — materials barrel: the public surface of src/materials/.
 *
 * Import theme data + the completeness gate from here, never from deep paths.
 * Relative specifiers carry `.ts` extensions so the barrel is loadable by the
 * plain-node build gate (scripts/check-material-slots.ts) as well as vite/vitest.
 *
 * `./pbr.ts` (M4-T1) is the set registry the themes resolve against: the nine
 * authored PBR surfaces, one per §4 slot, plus the gates that keep the registry
 * complete and every theme's slot payload resolvable.
 *
 * `./report.ts` (M4-T1) is the same table read over an assembled ship — per-slot
 * parts + draw calls and the resolution verdict on the real geometry.
 */

export * from './pbr.ts'
export * from './theme.ts'
export * from './themes.ts'
export * from './report.ts'
