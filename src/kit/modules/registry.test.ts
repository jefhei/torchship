import { describe, expect, it } from 'vitest'
import { kitManifestProblems } from '../../types'
import { CONTRACT_KIT } from '../../validation/contractKit'
import { GALLEY_MODULE } from './galley'
import { HEAD_MODULE } from './head'
import { moduleContractProblems, moduleProblems } from './integrity'
import {
  AUTHORED_KIT,
  AUTHORED_MODULES,
  assertAuthoredKitIntegrity,
  authoredKitProblems,
  getAuthoredModule,
} from './registry'
import type { AuthoredModule } from './types'

/** A deep clone of the bridge that a test may damage. */
function cloneModule(): AuthoredModule {
  return JSON.parse(JSON.stringify(HEAD_MODULE)) as AuthoredModule
}

describe('authored kit registry (M2-T2)', () => {
  it('registers the bridge and the galley/bunk, and exposes them as a KitManifest', () => {
    expect(AUTHORED_MODULES.map((module) => module.manifest.id)).toEqual([
      'head',
      'galley',
    ])
    expect(AUTHORED_KIT.modules).toEqual([HEAD_MODULE.manifest, GALLEY_MODULE.manifest])
    expect(getAuthoredModule('head')).toBe(HEAD_MODULE)
    expect(getAuthoredModule('galley')).toBe(GALLEY_MODULE)
    expect(() => getAuthoredModule('spine')).toThrow(/no module "spine"/)
  })

  it('is clean: per-module integrity, contract diff and the manifest contract', () => {
    expect(authoredKitProblems()).toEqual([])
    expect(authoredKitProblems(AUTHORED_MODULES, CONTRACT_KIT)).toEqual([])
    expect(() =>
      assertAuthoredKitIntegrity(AUTHORED_MODULES, CONTRACT_KIT),
    ).not.toThrow()
    expect(kitManifestProblems(AUTHORED_KIT)).toEqual([])
  })

  it('catches a duplicated module id', () => {
    expect(authoredKitProblems([HEAD_MODULE, HEAD_MODULE])).toContainEqual(
      expect.stringMatching(/module id "head" is duplicated/),
    )
  })

  it('catches a duplicated or unnamed assembly', () => {
    const duplicated = cloneModule()
    duplicated.assemblies = [duplicated.assemblies[0], duplicated.assemblies[0]]
    expect(moduleProblems(duplicated)).toContainEqual(
      expect.stringMatching(/assembly id "deck-plate" is duplicated/),
    )

    const unnamed = cloneModule()
    unnamed.assemblies = [{ ...unnamed.assemblies[0], id: '  ' }]
    expect(moduleProblems(unnamed)).toContainEqual(
      expect.stringMatching(/an assembly has no id/),
    )

    const empty = cloneModule()
    empty.assemblies = [{ ...empty.assemblies[0], parts: [] }]
    expect(moduleProblems(empty)).toContainEqual(
      expect.stringMatching(/assembly "deck-plate" builds no parts/),
    )
  })

  it('catches geometry that escapes the module box', () => {
    const escaped = cloneModule()
    escaped.assemblies = [
      { ...escaped.assemblies[0], placement: { position: [12, 0, 0] } },
    ]
    expect(moduleProblems(escaped)).toContainEqual(
      expect.stringMatching(/builds outside the module box/),
    )
  })

  it('catches a missing spine door, a door off its face and off the contract', () => {
    const doorless = cloneModule()
    doorless.manifest.doorSockets = []
    expect(moduleProblems(doorless)).toContainEqual(
      expect.stringMatching(/needs exactly one "spine-door" socket/),
    )

    const moved = cloneModule()
    moved.manifest.doorSockets = [
      { id: 'spine-door', position: [0, 1, -1.5], facing: '-z' },
    ]
    expect(moduleProblems(moved)).toContainEqual(
      expect.stringMatching(/off its −z face/),
    )
    expect(moduleContractProblems(moved, CONTRACT_KIT)).toContainEqual(
      expect.stringMatching(/off the contract origin/),
    )

    const wrongFacing = cloneModule()
    wrongFacing.manifest.doorSockets = [
      { id: 'spine-door', position: [0, 1, -1.8], facing: '+z' },
    ]
    expect(moduleProblems(wrongFacing)).toContainEqual(
      expect.stringMatching(/spine-door faces \+z, expected −z/),
    )

    // A module the contract does not know about has no diff (e.g. 'spine').
    const unknown = cloneModule()
    unknown.manifest.id = 'spine'
    expect(moduleContractProblems(unknown, CONTRACT_KIT)).toEqual([])
  })

  it('catches a doorway blocked by geometry and a drifted collision hint', () => {
    const blocked = cloneModule()
    blocked.assemblies = [
      ...blocked.assemblies,
      {
        id: 'barricade',
        parts: [
          {
            kind: 'box',
            materialSlot: 'bulkhead',
            size: [0.5, 2, 0.05],
            position: [0, 1, -1.75],
          },
        ],
        placement: {},
        solid: true,
      },
    ]
    expect(moduleProblems(blocked)).toContainEqual(
      expect.stringMatching(/blocks the "spine-door" doorway/),
    )

    const drifted = cloneModule()
    drifted.manifest.collisionHint.boxes = drifted.manifest.collisionHint.boxes.slice(1)
    expect(moduleProblems(drifted)).toContainEqual(
      expect.stringMatching(/must be derived from the geometry/),
    )

    const moved = cloneModule()
    moved.manifest.collisionHint.boxes = moved.manifest.collisionHint.boxes.map(
      (box) => ({
        min: [box.min[0] + 0.5, box.min[1], box.min[2]],
        max: [box.max[0] + 0.5, box.max[1], box.max[2]],
      }),
    )
    expect(moduleProblems(moved)).toContainEqual(
      expect.stringMatching(/has drifted from solid part/),
    )
  })

  it('catches an unlit room and a module with no landmarks', () => {
    const dark = cloneModule()
    dark.manifest.lightSockets = []
    expect(moduleProblems(dark)).toContainEqual(
      expect.stringMatching(/has no light sockets/),
    )

    const bare = cloneModule()
    bare.manifest.equipmentSlots = []
    expect(moduleProblems(bare)).toContainEqual(
      expect.stringMatching(/has no equipment slots/),
    )
  })

  it('catches an assembly with no parts and an empty module', () => {
    const none = cloneModule()
    none.assemblies = []
    expect(moduleProblems(none)).toContainEqual(
      expect.stringMatching(/has no assemblies/),
    )
  })
})
