/**
 * M2-T7 — the kit test harness.
 *
 * BUILD_PLAN M2-T7: "Kit test harness: each module renders standalone, material
 * slots fully assigned, door sockets at spec'd origins." And the M2 machine
 * gate: "every module compiles, renders in harness, fills all material slots;
 * socket origins match the contract."
 *
 * `runKitHarness()` is that gate as data — run it over the authored kit and the
 * whole M2 machine gate comes back as one report:
 *
 *   integrity  `moduleProblems` (M2-T2) — the manifest contract plus the
 *              authoring rules (assemblies named/non-empty, geometry inside the
 *              declared box, exactly one standardized spine-door, traversal
 *              prisms clear, collision hint derived from the parts);
 *   contract   `moduleContractProblems` — the authored dims and door-socket
 *              origins reproduce the fixture-time CONTRACT_KIT the M0-T5 ships
 *              were authored against, with the measured per-axis residuals in
 *              millimetres (mm) attached to every row;
 *   slots      every §4 slot the module's geometry draws is assigned in the
 *              active theme (the M1-T4 "unassigned slot = failed build" rule,
 *              asked per module);
 *   render     the module's standalone component draws EXACTLY the module's
 *              parts — one mesh per part, same geometry, same slot, same
 *              transform, in order (src/kit/harness/renderTree.ts);
 *   kit        one module id each, every contract module authored (so a spec ref
 *              resolves), a standalone component for every module, and a
 *              complete theme.
 *
 * Rules, not shapes: the harness NEVER throws on the authored kit — problems
 * come back as strings so a report can list all of them at once (same posture as
 * the M0-T6 invariant harness and the M1-T3 validator). `assertKitHarnessClean`
 * is the throwing form for callers that want a gate.
 *
 * This is the one place under src/kit/ that reads src/validation/'s contract kit
 * (as the DEFAULT for its optional `contractKit` option). The authoring modules
 * still never import validation — the comparison lives in the harness, which is
 * exactly what an integration gate is for.
 */

import type { KitManifest } from '../../types'
import type { MaterialTheme } from '../../materials/theme'
import { themesProblems } from '../../materials/theme'
import { DEFAULT_THEME_ID, getMaterialTheme } from '../../materials/themes'
import { CONTRACT_KIT } from '../../validation/contractKit'
import { moduleContractProblems, moduleProblems } from '../modules/integrity'
import { AUTHORED_MODULES } from '../modules/registry'
import type { AuthoredModule } from '../modules/types'
import { moduleMaterialSlots, moduleParts } from '../modules/types'
import {
  maxSocketResidualMm,
  moduleRenderProblems,
  moduleSlotProblems,
  moduleSocketResiduals,
  renderComponentOf,
} from './checks'
import type { DoorSocketRow } from './checks'
import type { ModuleComponent } from './components'
import { MODULE_COMPONENTS } from './components'

/** Inputs the harness can be pointed at (tests inject broken kits through these). */
export interface HarnessOptions {
  /** The contract to reproduce; defaults to the fixture-time CONTRACT_KIT. */
  contractKit?: KitManifest
  /** The material theme the slots must resolve in; defaults to 'firebrand'. */
  theme?: MaterialTheme
  /** The standalone render components; defaults to MODULE_COMPONENTS. */
  components?: Readonly<Record<string, ModuleComponent>>
}

/** One authored module's harness verdict. */
export interface ModuleHarnessReport {
  moduleId: string
  label: string
  status: 'pass' | 'fail'
  /** Every problem this module has, across all four rule groups. */
  problems: string[]
  /** Parts the module's geometry builds. */
  parts: number
  /** Meshes its standalone component draws (must equal `parts`). */
  meshes: number
  /** §4 slots the geometry draws, in MATERIAL_SLOTS order. */
  slots: string[]
  lightSockets: number
  equipmentSlots: number
  /** Door sockets measured against the contract kit (mm residuals). */
  doorSockets: DoorSocketRow[]
  /** Largest contract residual across the module's sockets, mm. */
  maxSocketResidualMm: number
}

/** The whole kit's harness verdict. */
export interface KitHarnessReport {
  passed: boolean
  /** Every problem in the kit: per-module problems + kit-level rules. */
  problems: string[]
  /** Kit-level problems only (duplicate ids, missing components, theme). */
  kitProblems: string[]
  modules: ModuleHarnessReport[]
  totals: {
    modules: number
    parts: number
    meshes: number
    lightSockets: number
    equipmentSlots: number
    doorSockets: number
    maxSocketResidualMm: number
  }
  /** One-line summary for logs and tracker notes. */
  detail: string
}

/** Resolve the harness inputs, filling in the documented defaults. */
function resolveOptions(options: HarnessOptions): Required<HarnessOptions> {
  return {
    contractKit: options.contractKit ?? CONTRACT_KIT,
    theme: options.theme ?? getMaterialTheme(DEFAULT_THEME_ID),
    components: options.components ?? MODULE_COMPONENTS,
  }
}

/**
 * Run every harness rule over one module. Never throws: a module that cannot
 * render standalone comes back as a problem, not an exception.
 */
export function runModuleHarness(
  module: AuthoredModule,
  options: HarnessOptions = {},
): ModuleHarnessReport {
  const { contractKit, theme, components } = resolveOptions(options)
  const render = renderComponentOf(module, components)
    ? moduleRenderProblems(module, components)
    : {
        problems: [
          `module "${module.manifest.id}": has no standalone render component ` +
            `(each module must render alone in the harness)`,
        ],
        meshes: 0,
      }
  const doorSockets = moduleSocketResiduals(module, contractKit)

  const problems = [
    ...moduleProblems(module),
    ...moduleContractProblems(module, contractKit),
    ...moduleSlotProblems(module, theme),
    ...render.problems,
  ]

  return {
    moduleId: module.manifest.id,
    label: module.manifest.label,
    status: problems.length === 0 ? 'pass' : 'fail',
    problems,
    parts: moduleParts(module).length,
    meshes: render.meshes,
    slots: [...moduleMaterialSlots(module)],
    lightSockets: module.manifest.lightSockets.length,
    equipmentSlots: module.manifest.equipmentSlots.length,
    doorSockets,
    maxSocketResidualMm: maxSocketResidualMm(module, contractKit),
  }
}

/** Kit-level rules: what a single module cannot know about the kit as a whole. */
function kitProblems(
  modules: readonly AuthoredModule[],
  contractKit: KitManifest,
  theme: MaterialTheme,
  components: Readonly<Record<string, ModuleComponent>>,
): string[] {
  const problems: string[] = []
  const ids = new Set<string>()

  for (const module of modules) {
    const id = module.manifest.id
    if (ids.has(id))
      problems.push(`module id "${id}" is duplicated in the authored kit`)
    ids.add(id)
    if (components[id] === undefined) {
      problems.push(`module "${id}" has no standalone render component in the harness`)
    }
  }

  // Every contract module must be authored: a spec ref must resolve to real
  // geometry, and the socket origins the fixtures were authored with must exist.
  for (const contract of contractKit.modules) {
    if (!ids.has(contract.id)) {
      problems.push(
        `the contract kit's module "${contract.id}" is not authored — a spec ref to it cannot resolve`,
      )
    }
  }

  // The theme gate the build runs, asked here so the harness is self-contained.
  for (const problem of themesProblems([theme])) {
    problems.push(`theme: ${problem}`)
  }

  return problems
}

/**
 * Run the whole harness over a kit (default: the authored kit against the
 * fixture-time contract kit and the ship's standard theme).
 */
export function runKitHarness(
  modules: readonly AuthoredModule[] = AUTHORED_MODULES,
  options: HarnessOptions = {},
): KitHarnessReport {
  const { contractKit, theme, components } = resolveOptions(options)

  const reports = modules.map((module) =>
    runModuleHarness(module, { contractKit, theme, components }),
  )
  const kitLevel = kitProblems(modules, contractKit, theme, components)
  const problems = [...reports.flatMap((report) => report.problems), ...kitLevel]

  const totals = {
    modules: reports.length,
    parts: reports.reduce((sum, report) => sum + report.parts, 0),
    meshes: reports.reduce((sum, report) => sum + report.meshes, 0),
    lightSockets: reports.reduce((sum, report) => sum + report.lightSockets, 0),
    equipmentSlots: reports.reduce((sum, report) => sum + report.equipmentSlots, 0),
    doorSockets: reports.reduce((sum, report) => sum + report.doorSockets.length, 0),
    maxSocketResidualMm: reports.reduce(
      (max, report) => Math.max(max, report.maxSocketResidualMm),
      0,
    ),
  }

  const slots = new Set(reports.flatMap((report) => report.slots))
  const contractSockets = reports
    .flatMap((report) => report.doorSockets)
    .filter((socket) => socket.contract).length

  const detail =
    problems.length === 0
      ? `kit harness clean: ${totals.modules} modules render standalone (${totals.parts} parts = ` +
        `${totals.meshes} meshes), ${slots.size} §4 slots assigned in theme '${theme.id}', ` +
        `${contractSockets} contract door sockets at spec'd origins ` +
        `(max residual ${totals.maxSocketResidualMm.toFixed(3)} mm), ` +
        `${totals.lightSockets} light + ${totals.equipmentSlots} equipment anchors`
      : `kit harness: ${problems.length} problem(s) across ${totals.modules} modules ` +
        `(${reports.filter((report) => report.status === 'fail').length} failing)`

  return {
    passed: problems.length === 0,
    problems,
    kitProblems: kitLevel,
    modules: reports,
    totals,
    detail,
  }
}

/** The harness as a gate: throws (listing every problem) on a failing kit. */
export function assertKitHarnessClean(
  modules: readonly AuthoredModule[] = AUTHORED_MODULES,
  options: HarnessOptions = {},
): KitHarnessReport {
  const report = runKitHarness(modules, options)
  if (!report.passed) {
    throw new Error(`kit harness:\n- ${report.problems.join('\n- ')}`)
  }
  return report
}
