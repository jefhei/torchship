/**
 * M1-T4 — materials barrel: the public surface of src/materials/.
 *
 * Import theme data + the completeness gate from here, never from deep paths.
 * Relative specifiers carry `.ts` extensions so the barrel is loadable by the
 * plain-node build gate (scripts/check-material-slots.ts) as well as vite/vitest.
 */

export * from './theme.ts'
export * from './themes.ts'
