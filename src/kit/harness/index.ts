/**
 * M2-T7 — kit-harness barrel: the public surface of src/kit/harness/.
 *
 * `runKitHarness()` / `assertKitHarnessClean()` are the gate; `MODULE_COMPONENTS`
 * + `StandaloneModuleScene` are the standalone render surface; `renderTree.ts` is
 * the headless render model; `checks.ts` holds the individual rules.
 */

export * from './renderTree'
export * from './components'
export * from './StandaloneModuleScene'
export * from './checks'
export * from './harness'
