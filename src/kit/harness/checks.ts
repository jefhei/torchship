/**
 * M2-T7 — the kit harness's checks.
 *
 * Three rule groups, one per half of "each module renders standalone, material
 * slots fully assigned, door sockets at spec'd origins" (BUILD_PLAN M2-T7).
 * Every function is PURE and reports human-readable problems (§8-style: empty
 * array = clean); the harness (harness.ts) merges them into per-module reports
 * and never throws.
 *
 * None of these rules are re-derived here:
 *
 *  - the manifest / authoring rules are `moduleProblems` (M2-T2 integrity.ts),
 *  - the contract rules are `moduleContractProblems` (the same file, comparing
 *    against the fixture-time CONTRACT_KIT socket origins),
 *  - the slot rule is the M1-T4 `themeAssignsSlot` query over the M1-T2 slot
 *    vocabulary (an unassigned slot is already a failed build — this asks the
 *    same question per module), PLUS the M4-T1 resolution rule: an assigned slot
 *    must name a PBR set the registry knows and that is declared for that slot,
 *    so "the module draws materials the renderer can actually shade" is asked
 *    per module too,
 *  - the render rule compares the ACTUAL render tree (renderTree.ts) against the
 *    module's own parts, so a module cannot ship a mesh its geometry does not
 *    describe (or hide geometry behind a missing mesh).
 */

import type { Facing, KitManifest, Vec3 } from '../../types'
import { MM } from '../../types'
import type { MaterialTheme } from '../../materials/theme'
import { themeAssignsSlot } from '../../materials/theme'
import { slotSetProblems } from '../../materials/pbr'
import { moduleMaterialSlots, moduleParts } from '../modules/types'
import type { AuthoredModule } from '../modules/types'
import type { ModuleComponent } from './components'
import { moduleComponentFor, moduleSceneElement } from './components'
import {
  collectRenderedParts,
  describeRenderedPart,
  expectedRenderedParts,
  renderedPartsEqual,
} from './renderTree'

/** One door socket measured against the contract kit, for the harness report. */
export interface DoorSocketRow {
  id: string
  facing: Facing
  /** Authored module-local origin, meters. */
  position: Vec3
  /** True when the contract kit carries this socket (the shaft band has none). */
  contract: boolean
  /** Per-axis deviation from the contract origin, mm (0 when unconstrained). */
  residualMm: { x: number; y: number; z: number }
  /** Largest per-axis residual, mm. */
  maxResidualMm: number
}

/**
 * The slot half of the M2 gate: every §4 slot the module's geometry draws is
 * assigned in the theme AND resolves to a PBR set declared for it (M4-T1).
 */
export function moduleSlotProblems(
  module: AuthoredModule,
  theme: MaterialTheme,
): string[] {
  const problems: string[] = []
  const slots = moduleMaterialSlots(module)
  const where = `module "${module.manifest.id}"`

  if (slots.length === 0) {
    problems.push(`${where}: draws no §4 material slots (it builds no geometry)`)
    return problems
  }

  for (const slot of slots) {
    if (!themeAssignsSlot(theme, slot)) {
      problems.push(
        `${where}: slot '${slot}' is drawn by its geometry but unassigned in theme '${theme.id}' ` +
          `(unassigned slot = failed build)`,
      )
      continue
    }
    // Assigned: it must also RESOLVE, or the renderer has nothing to shade with.
    const payload = (theme.slots as Record<string, unknown>)[slot]
    for (const problem of slotSetProblems(payload, slot)) {
      problems.push(
        `${where}: drawn slot '${slot}' does not resolve in theme '${theme.id}' — ${problem}`,
      )
    }
  }

  return problems
}

/**
 * The render half: the module's standalone component draws exactly its own
 * parts — same count, same geometry, same slots, same transforms, in order.
 * Returns the number of meshes seen so callers can report it even on failure.
 */
export function moduleRenderProblems(
  module: AuthoredModule,
  components: Readonly<Record<string, ModuleComponent>>,
): { problems: string[]; meshes: number } {
  const problems: string[] = []
  const where = `module "${module.manifest.id}"`
  const parts = moduleParts(module)

  let meshes = 0
  let rendered
  try {
    rendered = collectRenderedParts(moduleSceneElement(module, {}, components))
    meshes = rendered.length
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    problems.push(`${where}: does not render standalone — ${message}`)
    return { problems, meshes }
  }

  const expected = expectedRenderedParts(parts)
  if (meshes !== expected.length) {
    problems.push(
      `${where}: renders ${meshes} mesh(es) for ${expected.length} part(s) — the standalone ` +
        `component must draw exactly the module's geometry`,
    )
    return { problems, meshes }
  }

  rendered.forEach((item, index) => {
    const want = expected[index]
    if (!renderedPartsEqual(item, want)) {
      problems.push(
        `${where}: mesh ${index} is ${describeRenderedPart(item)}, expected ${describeRenderedPart(want)}`,
      )
    }
  })

  return { problems, meshes }
}

/** Index of a kit manifest's door sockets by `moduleId.socketId`. */
export function socketOriginIndex(
  kit: KitManifest,
): Record<string, { position: Vec3; facing: Facing }> {
  const out: Record<string, { position: Vec3; facing: Facing }> = {}
  for (const module of kit.modules) {
    for (const socket of module.doorSockets) {
      out[`${module.id}.${socket.id}`] = {
        position: [...socket.position] as Vec3,
        facing: socket.facing,
      }
    }
  }
  return out
}

/** Millimetre residual, rounded to the µm the M0-T2 channels are measured in. */
function residualMm(authored: number, contract: number): number {
  return Math.round((Math.abs(authored - contract) / MM) * 1000) / 1000
}

/**
 * Every door socket of the module as a measured row against the contract kit:
 * the "door sockets at spec'd origins" evidence (the pass/fail decision is
 * `moduleContractProblems`; this is the number behind it).
 */
export function moduleSocketResiduals(
  module: AuthoredModule,
  contractKit: KitManifest,
): DoorSocketRow[] {
  const origins = socketOriginIndex(contractKit)
  return module.manifest.doorSockets.map((socket) => {
    const entry = origins[`${module.manifest.id}.${socket.id}`]
    if (entry === undefined) {
      return {
        id: socket.id,
        facing: socket.facing,
        position: [...socket.position] as Vec3,
        contract: false,
        residualMm: { x: 0, y: 0, z: 0 },
        maxResidualMm: 0,
      }
    }
    const residual = {
      x: residualMm(socket.position[0], entry.position[0]),
      y: residualMm(socket.position[1], entry.position[1]),
      z: residualMm(socket.position[2], entry.position[2]),
    }
    return {
      id: socket.id,
      facing: socket.facing,
      position: [...socket.position] as Vec3,
      contract: true,
      residualMm: residual,
      maxResidualMm: Math.max(residual.x, residual.y, residual.z),
    }
  })
}

/** The largest contract residual across every socket of the module, mm. */
export function maxSocketResidualMm(
  module: AuthoredModule,
  contractKit: KitManifest,
): number {
  return moduleSocketResiduals(module, contractKit).reduce(
    (max, row) => (row.contract ? Math.max(max, row.maxResidualMm) : max),
    0,
  )
}

/** The module's render component, or undefined when it has none (harness-safe). */
export function renderComponentOf(
  module: AuthoredModule,
  components: Readonly<Record<string, ModuleComponent>>,
): ModuleComponent | undefined {
  try {
    return moduleComponentFor(module, components)
  } catch {
    return undefined
  }
}
