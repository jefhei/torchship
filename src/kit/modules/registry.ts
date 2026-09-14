/**
 * M2-T2 — the authored-kit registry.
 *
 * The registry is the bridge between authoring (M2-T2..T6) and the assembler
 * (M3-T1): it collects the authored modules, exposes them as the M1-T2
 * `KitManifest` the assembler consumes, and gates the whole set —
 * `authoredKitProblems(modules, contractKit)` is what the M2-T7 harness and CI
 * run: per-module integrity, unique module ids, and (when a contract kit is
 * supplied) the contract diff against the M0-T5 fixture-time socket origins.
 *
 * It grows one line per authored module; today that is the bridge (`head`) and
 * the galley/bunk (`galley`).
 */

import type { KitManifest } from '../../types'
import { GALLEY_MODULE } from './galley'
import { HEAD_MODULE } from './head'
import { moduleContractProblems, moduleProblems } from './integrity'
import { OPS_MODULE } from './ops'
import type { AuthoredModule } from './types'

/** Every authored module, in build order (one entry per M2-T2..T6 task). */
export const AUTHORED_MODULES: readonly AuthoredModule[] = [
  HEAD_MODULE,
  GALLEY_MODULE,
  OPS_MODULE,
]

/** The authored kit as the assembler reads it (M1-T2 manifest). */
export const AUTHORED_KIT: KitManifest = {
  modules: AUTHORED_MODULES.map((module) => module.manifest),
}

/** Look an authored module up by id; throws on unknown ids (typos fail loudly). */
export function getAuthoredModule(id: string): AuthoredModule {
  const module = AUTHORED_MODULES.find((candidate) => candidate.manifest.id === id)
  if (module === undefined) {
    const known = AUTHORED_MODULES.map((candidate) => candidate.manifest.id).join(', ')
    throw new Error(`authored kit: no module "${id}" (known: ${known})`)
  }
  return module
}

/**
 * Every problem in an authored kit: duplicate module ids, per-module integrity
 * (`moduleProblems`) and — when `contractKit` is supplied — each module's diff
 * against the fixture-time contract origins (`moduleContractProblems`).
 * Empty array = the kit is intact and reproduces the contract.
 */
export function authoredKitProblems(
  modules: readonly AuthoredModule[] = AUTHORED_MODULES,
  contractKit?: KitManifest,
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const module of modules) {
    const id = module.manifest.id
    if (seen.has(id))
      problems.push(`module id "${id}" is duplicated in the authored kit`)
    seen.add(id)
    problems.push(...moduleProblems(module))
    if (contractKit !== undefined) {
      problems.push(...moduleContractProblems(module, contractKit))
    }
  }

  return problems
}

/** Authored-kit integrity gate: throws (listing every problem) on a broken kit. */
export function assertAuthoredKitIntegrity(
  modules: readonly AuthoredModule[] = AUTHORED_MODULES,
  contractKit?: KitManifest,
): void {
  const problems = authoredKitProblems(modules, contractKit)
  if (problems.length > 0) {
    throw new Error(`authored kit integrity:\n- ${problems.join('\n- ')}`)
  }
}
