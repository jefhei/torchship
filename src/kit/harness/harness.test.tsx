/**
 * M2-T7 — the kit test harness tests.
 *
 * Pins the M2 machine gate ("every module compiles, renders in harness, fills
 * all material slots; socket origins match the contract") as executable checks:
 *
 *  - `runKitHarness()` is clean on the authored kit: 6 modules, every module's
 *    standalone component draws exactly its own parts, every drawn §4 slot is
 *    assigned in the ship's theme, and every contract door socket sits at its
 *    spec'd origin (0.000 mm residual);
 *  - the harness is a real GATE, not a fixture-shaped tautology: injected
 *    dimension drift, socket drift, a missing/extra socket, an unassigned slot,
 *    a missing render component and a render that draws the wrong geometry all
 *    come back as problems;
 *  - the headless render model (renderTree.ts) agrees with a REAL react-dom
 *    render of the same components — mesh count, geometry args, transforms and
 *    slot names — so it can never silently drift from what React does;
 *  - `StandaloneModuleScene` renders one module and nothing else.
 *
 * jsdom has no WebGL, so the R3F intrinsics (`<mesh>`, `<boxGeometry>`, …) are
 * rendered by react-dom as unknown elements. React logs a casing/unrecognized-tag
 * warning per intrinsic; those are the ONLY console errors this file tolerates
 * (see `renderModuleDom`), because they are react-dom not knowing R3F's
 * vocabulary, not a defect in the kit.
 */

import { createElement } from 'react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MATERIAL_SLOTS } from '../../types'
import type { MaterialSlot, Vec3 } from '../../types'
import { SHIP_FIXTURES } from '../../fixtures'
import { getMaterialTheme, DEFAULT_THEME_ID } from '../../materials/themes'
import type { MaterialTheme } from '../../materials/theme'
import { CONTRACT_KIT, contractSocketOrigins } from '../../validation'
import { KitParts } from '../render/KitParts'
import type { KitPart } from '../types'
import { AUTHORED_KIT, AUTHORED_MODULES, getAuthoredModule } from '../modules/registry'
import type { AuthoredModule } from '../modules/types'
import { moduleParts } from '../modules/types'
import { MODULE_COMPONENTS, moduleComponentFor, moduleSceneElement } from './components'
import { StandaloneModuleScene } from './StandaloneModuleScene'
import type { ModuleComponent } from './components'
import {
  collectRenderedParts,
  describeRenderedPart,
  expectedRenderedParts,
  renderedPartsEqual,
} from './renderTree'
import type { RenderedPart } from './renderTree'
import {
  maxSocketResidualMm,
  moduleRenderProblems,
  moduleSlotProblems,
  moduleSocketResiduals,
  socketOriginIndex,
} from './checks'
import { assertKitHarnessClean, runKitHarness, runModuleHarness } from './harness'

/* ---------- helpers ------------------------------------------------- */

const THEME = getMaterialTheme(DEFAULT_THEME_ID)

/** A module clone with one manifest field overridden (integrity stays intact). */
function moduleWith(
  module: AuthoredModule,
  overrides: Partial<AuthoredModule['manifest']>,
) {
  return { ...module, manifest: { ...module.manifest, ...overrides } }
}

/**
 * react-dom's warnings for R3F's vocabulary — the only ones tolerated:
 * unknown intrinsic tags (`<mesh>`, `<boxGeometry>`, …) and the R3F-only props
 * they carry (`emissiveIntensity`, …). Both are react-dom not knowing three.js,
 * not a kit defect; anything else in console.error fails the render tests.
 */
const R3F_INTRINSIC_WARNING =
  /incorrect casing|is unrecognized in this browser|does not recognize the .* prop on a DOM element|non-boolean attribute/

/**
 * Render one module component for real (react-dom + jsdom) and return the DOM
 * plus any console errors that were NOT react-dom complaining about R3F's
 * intrinsic tag names. Those specific warnings are expected — react-dom has no
 * idea what a `<mesh>` is — and are asserted to be the only noise.
 */
function renderModuleDom(element: ReactElement): {
  container: HTMLElement
  errors: string[]
  warnings: string[]
} {
  const messages: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(' '))
  })
  let container: HTMLElement
  try {
    container = render(element).container
  } finally {
    spy.mockRestore()
  }
  return {
    container,
    errors: messages.filter((message) => !R3F_INTRINSIC_WARNING.test(message)),
    warnings: messages.filter((message) => R3F_INTRINSIC_WARNING.test(message)),
  }
}

/** Read the meshes react-dom actually produced, in the kit's own shape. */
function renderedPartsFromDom(container: HTMLElement): RenderedPart[] {
  return Array.from(container.querySelectorAll('mesh')).map((mesh) => {
    const geometry = mesh.querySelector('boxgeometry, cylindergeometry')
    const material = mesh.querySelector('meshstandardmaterial')
    if (geometry === null || material === null) {
      throw new Error('rendered a mesh without a geometry or a material')
    }
    const args = (geometry.getAttribute('args') ?? '').split(',').map(Number)
    const shape =
      geometry.tagName.toLowerCase() === 'boxgeometry'
        ? { kind: 'box' as const, size: [args[0], args[1], args[2]] as Vec3 }
        : {
            kind: 'cylinder' as const,
            radius: args[0],
            length: args[2],
          }
    const triple = (name: string): Vec3 =>
      (mesh.getAttribute(name) ?? '0,0,0').split(',').map(Number) as unknown as Vec3
    return {
      geometry: shape,
      slot: material.getAttribute('name') as MaterialSlot,
      position: triple('position'),
      rotation: triple('rotation'),
    }
  })
}

/* ---------- the gate on the authored kit ----------------------------- */

describe('kit harness: the authored kit (M2 machine gate)', () => {
  it('is clean: every module renders standalone, slots assigned, sockets at spec', () => {
    const report = runKitHarness()
    expect(report.problems).toEqual([])
    expect(report.kitProblems).toEqual([])
    expect(report.passed).toBe(true)
    expect(report.modules).toHaveLength(AUTHORED_MODULES.length)
    for (const module of report.modules) {
      expect(module.status).toBe('pass')
      expect(module.problems).toEqual([])
    }
    expect(report.modules.map((m) => m.moduleId)).toEqual([
      'head',
      'galley',
      'ops',
      'engineering',
      'storage',
      'spine',
    ])
  })

  it('reports one mesh per part for every module, in builder order', () => {
    const report = runKitHarness()
    expect(report.totals.meshes).toBe(report.totals.parts)
    expect(report.totals.parts).toBeGreaterThan(500)
    for (const module of report.modules) {
      expect(module.meshes).toBe(module.parts)
      expect(module.parts).toBe(moduleParts(getAuthoredModule(module.moduleId)).length)
    }
  })

  it('fills every §4 slot: the union of drawn slots is the whole vocabulary', () => {
    const report = runKitHarness()
    const drawn = new Set(report.modules.flatMap((module) => module.slots))
    expect([...drawn].sort()).toEqual([...MATERIAL_SLOTS].sort())
    for (const module of report.modules) {
      expect(module.slots.length).toBeGreaterThan(0)
      for (const slot of module.slots) expect(MATERIAL_SLOTS).toContain(slot)
    }
  })

  it('puts every contract door socket at its spec’d origin (0.000 mm)', () => {
    const report = runKitHarness()
    const contractSockets = report.modules
      .flatMap((module) => module.doorSockets)
      .filter((socket) => socket.contract)
    expect(contractSockets).toHaveLength(
      CONTRACT_KIT.modules.reduce((n, module) => n + module.doorSockets.length, 0),
    )
    for (const socket of contractSockets) {
      expect(socket.maxResidualMm).toBe(0)
    }
    expect(report.totals.maxSocketResidualMm).toBe(0)

    const galleySide = report.modules
      .find((module) => module.moduleId === 'galley')
      ?.doorSockets.find((socket) => socket.id === 'side-door')
    expect(galleySide?.contract).toBe(true)
    expect(galleySide?.residualMm).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('reports the band’s four face doorways as contract-free (the shaft is synthesized)', () => {
    const spine = runModuleHarness(getAuthoredModule('spine'))
    expect(spine.doorSockets.map((socket) => socket.id)).toEqual([
      '+z',
      '-z',
      '+x',
      '-x',
    ])
    expect(spine.doorSockets.every((socket) => socket.contract === false)).toBe(true)
    expect(spine.maxSocketResidualMm).toBe(0)
  })

  it('gives every module light and equipment anchors (the room-lit precondition)', () => {
    const report = runKitHarness()
    expect(report.totals.lightSockets).toBeGreaterThanOrEqual(AUTHORED_MODULES.length)
    for (const module of report.modules) {
      expect(module.lightSockets).toBeGreaterThanOrEqual(1)
      expect(module.equipmentSlots).toBeGreaterThanOrEqual(1)
      expect(module.doorSockets.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('summarizes the gate in one log line', () => {
    const report = runKitHarness()
    expect(report.detail).toMatch(/^kit harness clean: 6 modules render standalone/)
    expect(report.detail).toContain('9 §4 slots assigned')
    expect(report.detail).toContain('at spec’d origins'.replace('’', "'"))
    expect(report.detail).toContain('max residual 0.000 mm')
  })

  it('resolves every module type the canonical fixtures reference', () => {
    for (const fixture of SHIP_FIXTURES) {
      for (const deck of fixture.spec.decks) {
        for (const ref of deck.modules) {
          expect(AUTHORED_KIT.modules.map((module) => module.id)).toContain(
            ref.moduleId,
          )
        }
      }
    }
  })

  it('is deterministic and side-effect free (two runs, equal reports)', () => {
    expect(runKitHarness()).toEqual(runKitHarness())
  })

  it('assertKitHarnessClean returns the clean report and throws on a broken one', () => {
    const clean = assertKitHarnessClean()
    expect(clean.passed).toBe(true)
    const broken = [
      moduleWith(getAuthoredModule('head'), { dimensions: [4.81, 3, 3.6] }),
    ]
    expect(() => assertKitHarnessClean(broken)).toThrow(/kit harness:/)
    expect(() => assertKitHarnessClean(broken)).toThrow(/do not reproduce the contract/)
  })

  it('cross-pins the socket index against the contract’s own origin table', () => {
    expect(socketOriginIndex(CONTRACT_KIT)).toEqual(contractSocketOrigins())
  })
})

/* ---------- the gate is real: injected defects ----------------------- */

describe('kit harness: injected defects are caught', () => {
  it('catches dimension drift against the contract', () => {
    const drifted = moduleWith(getAuthoredModule('galley'), {
      dimensions: [4.2, 3, 5.05],
    })
    const report = runModuleHarness(drifted)
    expect(report.status).toBe('fail')
    expect(report.problems.join('; ')).toMatch(
      /dimensions .* do not reproduce the contract/,
    )
  })

  it('catches a door socket 0.6 mm off its spec’d origin, with the residual measured', () => {
    const head = getAuthoredModule('head')
    const drifted = moduleWith(head, {
      doorSockets: [
        { ...head.manifest.doorSockets[0], position: [-0.0006, 1.0, -1.8] },
      ],
    })
    const report = runModuleHarness(drifted)
    expect(report.status).toBe('fail')
    expect(report.problems.join('; ')).toMatch(
      /door socket "spine-door" sits 0\.6 mm off the contract origin/,
    )
    expect(report.maxSocketResidualMm).toBeCloseTo(0.6, 6)
    expect(report.doorSockets[0].residualMm.x).toBeCloseTo(0.6, 6)
  })

  it('catches a missing contract socket and an extra one', () => {
    const galley = getAuthoredModule('galley')
    const missing = moduleWith(galley, {
      doorSockets: galley.manifest.doorSockets.filter(
        (socket) => socket.id !== 'side-door',
      ),
    })
    expect(runModuleHarness(missing).problems.join('; ')).toMatch(
      /missing the contract door socket "side-door"/,
    )

    const extra = moduleWith(galley, {
      doorSockets: [
        ...galley.manifest.doorSockets,
        { id: 'ghost-door', position: [0, 1, 0], facing: '+z' },
      ],
    })
    const problems = runModuleHarness(extra).problems.join('; ')
    expect(problems).toMatch(
      /declares door socket "ghost-door", which the contract does not have/,
    )
  })

  it('catches a slot the module draws that the theme leaves unassigned', () => {
    const blanked: MaterialTheme = {
      ...THEME,
      slots: { ...THEME.slots, hazard: { set: '   ' } },
    }
    const engineering = getAuthoredModule('engineering')
    const problems = moduleSlotProblems(engineering, blanked)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/slot 'hazard' is drawn by its geometry but unassigned/)
    // The clean theme assigns it — the rule is not tautological.
    expect(moduleSlotProblems(engineering, THEME)).toEqual([])
  })

  it('catches an incomplete theme as a kit-level problem', () => {
    const blanked: MaterialTheme = {
      ...THEME,
      slots: { ...THEME.slots, webbing: { set: '' } },
    }
    const report = runKitHarness(AUTHORED_MODULES, { theme: blanked })
    expect(report.passed).toBe(false)
    expect(report.kitProblems.join('; ')).toMatch(
      /theme: .*slot 'webbing' is assigned an empty payload/,
    )
  })

  it('catches a module with no standalone render component', () => {
    const withoutSpine: Record<string, ModuleComponent> = { ...MODULE_COMPONENTS }
    delete withoutSpine.spine
    const report = runModuleHarness(getAuthoredModule('spine'), {
      components: withoutSpine,
    })
    expect(report.status).toBe('fail')
    expect(report.problems.join('; ')).toMatch(/has no standalone render component/)
    expect(report.meshes).toBe(0)

    const kit = runKitHarness(AUTHORED_MODULES, { components: withoutSpine })
    expect(kit.kitProblems.join('; ')).toMatch(
      /module "spine" has no standalone render component in the harness/,
    )
  })

  it('catches a standalone component that draws another module’s geometry', () => {
    const report = runModuleHarness(getAuthoredModule('head'), {
      components: { ...MODULE_COMPONENTS, head: MODULE_COMPONENTS.galley },
    })
    expect(report.status).toBe('fail')
    expect(report.problems.join('; ')).toMatch(/renders 99 mesh\(es\) for 70 part\(s\)/)
  })

  it('catches a component that draws nothing at all', () => {
    const empty: ModuleComponent = () => createElement('group')
    const report = runModuleHarness(getAuthoredModule('ops'), {
      components: { ...MODULE_COMPONENTS, ops: empty },
    })
    expect(report.problems.join('; ')).toMatch(/renders 0 mesh\(es\) for 90 part\(s\)/)
  })

  it('catches a mesh whose transform has drifted from the part it claims to draw', () => {
    const module = getAuthoredModule('head')
    const parts = moduleParts(module)
    const shifted: ModuleComponent = () =>
      createElement(KitParts, {
        parts: parts.map((part, index): KitPart =>
          index === 0
            ? {
                ...part,
                position: [
                  part.position[0] + 0.5,
                  part.position[1],
                  part.position[2],
                ] as Vec3,
              }
            : part,
        ),
      })
    const report = runModuleHarness(module, {
      components: { ...MODULE_COMPONENTS, head: shifted },
    })
    expect(report.status).toBe('fail')
    expect(report.problems.join('; ')).toMatch(/mesh 0 is .*, expected /)
  })

  it('catches a duplicated module id and a missing contract module', () => {
    const head = getAuthoredModule('head')
    const duplicated = runKitHarness([head, head, ...AUTHORED_MODULES.slice(1)])
    expect(duplicated.kitProblems.join('; ')).toMatch(/module id "head" is duplicated/)

    const shortKit = AUTHORED_MODULES.filter(
      (module) => module.manifest.id !== 'storage',
    )
    const incomplete = runKitHarness(shortKit)
    expect(incomplete.kitProblems.join('; ')).toMatch(
      /contract kit's module "storage" is not authored/,
    )
  })

  it('never throws on a broken kit — problems are data', () => {
    const broken = AUTHORED_MODULES.map((module) =>
      moduleWith(module, { dimensions: [1, 1, 1] }),
    )
    expect(() => runKitHarness(broken)).not.toThrow()
    const report = runKitHarness(broken)
    expect(report.passed).toBe(false)
    expect(report.problems.length).toBeGreaterThan(AUTHORED_MODULES.length)
    expect(report.detail).toMatch(/problem\(s\) across/)
  })
})

/* ---------- the headless render model -------------------------------- */

describe('render tree model', () => {
  it('describes every authored module exactly as its parts do', () => {
    for (const module of AUTHORED_MODULES) {
      const expected = expectedRenderedParts(moduleParts(module))
      const actual = collectRenderedParts(moduleSceneElement(module))
      expect(actual).toHaveLength(expected.length)
      actual.forEach((item, index) => {
        expect(renderedPartsEqual(item, expected[index])).toBe(true)
      })
    }
  })

  it('carries the §4 slot on every material and reads it back', () => {
    const items = collectRenderedParts(moduleSceneElement(getAuthoredModule('galley')))
    const slots = new Set(items.map((item) => item.slot))
    expect(slots.size).toBeGreaterThan(1)
    for (const slot of slots) expect(MATERIAL_SLOTS).toContain(slot)
  })

  it('applies the module placement to the group, not to the meshes', () => {
    const module = getAuthoredModule('head')
    const atOrigin = collectRenderedParts(moduleSceneElement(module))
    const placed = collectRenderedParts(
      moduleSceneElement(module, { position: [0, 0, 3.0], rotation: 2 }),
    )
    expect(placed).toEqual(atOrigin)
  })

  it('rejects hosts the kit does not draw', () => {
    expect(() =>
      collectRenderedParts(createElement('group', null, createElement('sphere'))),
    ).toThrow(/unexpected host element <sphere>/)
    expect(() =>
      collectRenderedParts(createElement('boxGeometry', { args: [1, 1, 1] })),
    ).toThrow(/must be a child of a <mesh>/)
  })

  it('rejects a mesh without exactly one geometry and one material', () => {
    expect(() =>
      collectRenderedParts(
        createElement(
          'group',
          null,
          createElement(
            'mesh',
            null,
            createElement('boxGeometry', { args: [1, 1, 1] }),
          ),
        ),
      ),
    ).toThrow(/carries 0 materials/)
    expect(() =>
      collectRenderedParts(
        createElement(
          'group',
          null,
          createElement(
            'mesh',
            null,
            createElement('boxGeometry', { args: [1, 1, 1] }),
            createElement('boxGeometry', { args: [1, 1, 1] }),
            createElement('meshStandardMaterial', { name: 'bulkhead' }),
          ),
        ),
      ),
    ).toThrow(/carries 2 geometries/)
  })

  it('rejects a material that lost its §4 slot name', () => {
    expect(() =>
      collectRenderedParts(
        createElement(
          'group',
          null,
          createElement(
            'mesh',
            null,
            createElement('boxGeometry', { args: [1, 1, 1] }),
            createElement('meshStandardMaterial', { color: '#fff' }),
          ),
        ),
      ),
    ).toThrow(/missing its §4 slot name/)
  })

  it('summarizes a rendered part readably', () => {
    const [first] = expectedRenderedParts(moduleParts(getAuthoredModule('head')))
    expect(describeRenderedPart(first)).toMatch(
      /box 4\.8×0\.2×3\.6 m @ 0,-0\.1,0 \[deckplate\]/,
    )
  })
})

/* ---------- standalone rendering in a real DOM ----------------------- */

describe('standalone module scene', () => {
  it('looks a module component up by id and fails loudly on unknown ids', () => {
    expect(moduleComponentFor(getAuthoredModule('storage'))).toBe(
      MODULE_COMPONENTS.storage,
    )
    const unknown = moduleWith(getAuthoredModule('head'), { id: 'torpedo-bay' })
    expect(() => moduleComponentFor(unknown)).toThrow(
      /torpedo-bay.*no standalone render component/,
    )
    expect(() => moduleComponentFor(unknown)).toThrow(/head, galley, ops/)
  })

  it('renders exactly one module — its own meshes, no siblings', () => {
    for (const module of AUTHORED_MODULES) {
      const items = collectRenderedParts(
        createElement(StandaloneModuleScene, { moduleId: module.manifest.id }),
      )
      expect(items).toHaveLength(moduleParts(module).length)
    }
    expect(() =>
      collectRenderedParts(createElement(StandaloneModuleScene, { moduleId: 'nope' })),
    ).toThrow(/no module "nope"/)
  })

  it('mounts every module on its own in the DOM with one mesh per part', () => {
    for (const module of AUTHORED_MODULES) {
      const Component = moduleComponentFor(module)
      const { container, errors } = renderModuleDom(
        createElement(Component, { position: [1.5, 0, -0.7] }),
      )
      const expected = expectedRenderedParts(moduleParts(module))
      const actual = renderedPartsFromDom(container)
      expect(actual).toHaveLength(expected.length)
      actual.forEach((item, index) => {
        expect(renderedPartsEqual(item, expected[index])).toBe(true)
      })
      // Only react-dom's R3F-intrinsic warnings are tolerated.
      expect(errors).toEqual([])
    }
  })

  it('applies the deck-local pose to the standalone scene’s group', () => {
    const { container } = renderModuleDom(
      createElement(StandaloneModuleScene, {
        moduleId: 'galley',
        position: [0, 0, 3.2],
        rotation: 1,
      }),
    )
    const group = container.querySelector('group')
    expect(group?.getAttribute('position')).toBe('0,0,3.2')
    expect(Number(group?.getAttribute('rotation')?.split(',')[1])).toBeCloseTo(
      Math.PI / 2,
      9,
    )
  })

  it('puts every mesh under a single group (the module root)', () => {
    const { container } = renderModuleDom(
      createElement(StandaloneModuleScene, { moduleId: 'ops' }),
    )
    const groups = container.querySelectorAll('group')
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelectorAll('mesh')).toHaveLength(
      moduleParts(getAuthoredModule('ops')).length,
    )
  })

  it('routes module geometry through the M2-T1 builders, not hand-placed meshes', () => {
    // Every mesh's geometry args must be a positive box/cylinder the builders
    // could have produced: no zero-sized or negative geometry may reach the DOM.
    for (const module of AUTHORED_MODULES) {
      const items = collectRenderedParts(moduleSceneElement(module))
      for (const item of items) {
        const extents =
          item.geometry.kind === 'box'
            ? item.geometry.size
            : [item.geometry.radius * 2, item.geometry.length]
        for (const extent of extents) expect(extent).toBeGreaterThan(0)
      }
    }
  })
})

/* ---------- render checks are wired into the report ------------------ */

describe('harness render + socket reporting', () => {
  it('reports the same mesh count the render check measures', () => {
    const module = getAuthoredModule('engineering')
    const render = moduleRenderProblems(module, MODULE_COMPONENTS)
    expect(render.problems).toEqual([])
    expect(render.meshes).toBe(moduleParts(module).length)
    expect(runModuleHarness(module).meshes).toBe(render.meshes)
  })

  it('measures residuals per axis for every socket of every module', () => {
    for (const module of AUTHORED_MODULES) {
      const rows = moduleSocketResiduals(module, CONTRACT_KIT)
      expect(rows.map((row) => row.id)).toEqual(
        module.manifest.doorSockets.map((socket) => socket.id),
      )
      for (const row of rows) {
        expect(row.maxResidualMm).toBe(
          Math.max(row.residualMm.x, row.residualMm.y, row.residualMm.z),
        )
        expect(row.residualMm).toEqual({ x: 0, y: 0, z: 0 })
      }
      expect(maxSocketResidualMm(module, CONTRACT_KIT)).toBe(0)
    }
  })

  it('reports a residual for a socket the contract does not carry as zero and unconstrained', () => {
    const spine = getAuthoredModule('spine')
    for (const row of moduleSocketResiduals(spine, CONTRACT_KIT)) {
      expect(row.contract).toBe(false)
      expect(row.maxResidualMm).toBe(0)
    }
  })
})
