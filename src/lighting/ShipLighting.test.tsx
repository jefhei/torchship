/**
 * M4-T2 — the mounted rig, headless.
 *
 * jsdom has no WebGL, so the walkthrough's `<Canvas>` is mocked in the app's
 * tests (src/test-setup.ts) and the R3F host elements of `ShipLighting` are
 * never reconciled. This file reads the element tree instead — the same
 * technique the M2-T7 harness uses (`src/kit/harness/renderTree.ts`): the
 * component is called directly (it is hook-free by design) and its children are
 * walked as the renderer would receive them. That is enough to pin the two
 * things that matter about the app side of M4-T2:
 *
 *  - the frame mounts EXACTLY `activeLightsFor(rig, deckIndex)` — no light the
 *    selection did not choose, no chosen light missing;
 *  - every prop on a mounted light came from the rig's own derivation (colour,
 *    intensity, reach, decay, and a shadow map only where `castsShadow`).
 */

import { Fragment, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { getShipFixture } from '../fixtures'
import type { LightKind, Vec3 } from '../types'
import {
  LIGHTS_ACTIVE_MAX,
  SHADOW_MAP_SIZE,
  getLightArchetype,
  lightColorFor,
  rigAmbient,
} from './archetypes'
import {
  activeLightsFor,
  lightRigOf,
  shadowCastersOf,
  withShadowCasters,
  type LightRig,
  type PlacedLight,
} from './rig'
import { ShipLighting } from './ShipLighting'

const PATROL = assembleShip(getShipFixture('patrol').spec)

/**
 * The host elements a component's children resolve to: function components and
 * fragments are called/flattened away, so what is left is what R3F mounts.
 */
function hostElements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) hostElements(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out

  const element = node as ReactElement
  if (element.type === Fragment) {
    hostElements((element.props as { children?: ReactNode }).children, out)
    return out
  }
  if (typeof element.type === 'function') {
    hostElements((element.type as (props: unknown) => ReactNode)(element.props), out)
    return out
  }
  out.push(element)
  return out
}

/** The ambient fill + one `<pointLight>` per mounted fixture, in order. */
function mounted(rig: LightRig, deckIndex: number) {
  const elements = hostElements(ShipLighting({ rig, deckIndex }))
  for (const element of elements) {
    expect(['ambientLight', 'pointLight']).toContain(element.type)
  }
  return {
    ambient: elements
      .filter((element) => element.type === 'ambientLight')
      .map((element) => element.props as Record<string, unknown>),
    lights: elements
      .filter((element) => element.type === 'pointLight')
      .map((element) => element.props as Record<string, unknown>),
  }
}

/** A synthetic fixture, for the over-budget case no canonical deck produces. */
function fakeLight(id: string, kind: LightKind, deckIndex = 0): PlacedLight {
  const archetype = getLightArchetype(kind)
  return {
    id,
    kind,
    deckIndex,
    deckId: `deck-${deckIndex}`,
    source: { deckId: `deck-${deckIndex}`, moduleId: 'test', moduleIndex: 0 },
    socketId: id,
    position: [1, 2, 3],
    color: lightColorFor(archetype),
    intensity: archetype.intensity,
    distanceM: archetype.distanceM,
    decay: archetype.decay,
    castsShadow: false,
  }
}

describe('ShipLighting (M4-T2)', () => {
  it('mounts exactly the deck the selector chose, and one warm fill', () => {
    const rig = withShadowCasters(lightRigOf(PATROL))
    const { ambient, lights } = mounted(rig, 1)

    expect(lights.map((light) => light.name)).toEqual(
      activeLightsFor(rig, 1).map((light) => light.id),
    )
    expect(lights).toHaveLength(8)
    expect(ambient).toEqual([
      { color: rigAmbient().color, intensity: rigAmbient().intensity },
    ])
  })

  it('carries each fixture recipe onto the light it mounts', () => {
    const rig = withShadowCasters(lightRigOf(PATROL))
    const { lights } = mounted(rig, 0)
    const chosen = activeLightsFor(rig, 0)

    expect(lights).toHaveLength(chosen.length)
    chosen.forEach((light, index) => {
      const mountedLight = lights[index]
      expect(mountedLight.name).toBe(light.id)
      expect(mountedLight.position).toEqual(light.position)
      expect(mountedLight.color).toBe(light.color)
      expect(mountedLight.intensity).toBe(light.intensity)
      expect(mountedLight.distance).toBe(light.distanceM)
      expect(mountedLight.decay).toBe(light.decay)
      expect(mountedLight['shadow-mapSize']).toEqual([SHADOW_MAP_SIZE, SHADOW_MAP_SIZE])
    })
  })

  it('spends the shadow maps the rig marked, and no others', () => {
    const rig = withShadowCasters(lightRigOf(PATROL))
    const casters = new Set(shadowCastersOf(rig).map((light) => light.id))
    const { lights } = mounted(rig, 3)

    expect(lights.some((light) => light.castShadow === true)).toBe(true)
    for (const light of lights) {
      expect(light.castShadow).toBe(casters.has(light.name as string))
    }
  })

  it('shows no shadow-casting light at all before the rig marks any', () => {
    const rig = lightRigOf(PATROL)
    expect(rig.lights.every((light) => !light.castsShadow)).toBe(true)
    const { lights } = mounted(rig, 4)
    expect(lights).toHaveLength(8)
    expect(lights.every((light) => light.castShadow === false)).toBe(true)
  })

  it('caps an over-budget deck in the frame, exactly as the selector does', () => {
    const rig: LightRig = {
      ship: 'test',
      themeId: 'test',
      lights: [],
      byDeck: [
        [
          ...Array.from({ length: 6 }, (_u, i) => fakeLight(`p${i}`, 'panel')),
          ...Array.from({ length: 4 }, (_u, i) => fakeLight(`t${i}`, 'task')),
          ...Array.from({ length: 2 }, (_u, i) => fakeLight(`s${i}`, 'screen')),
          ...Array.from({ length: 2 }, (_u, i) => fakeLight(`r${i}`, 'reactor')),
        ],
      ],
      ambient: rigAmbient(),
    }
    rig.lights = rig.byDeck[0]
    const { lights } = mounted(rig, 0)
    expect(lights).toHaveLength(LIGHTS_ACTIVE_MAX)
    expect(lights.map((light) => light.name)).toEqual(
      activeLightsFor(rig, 0).map((light) => light.id),
    )
    // The drive glow is mounted first — the room's landmark survives the cut.
    expect(lights[0].name).toBe('r0')
  })

  it('mounts the fill alone for a deck that is not in the ship', () => {
    const rig = lightRigOf(PATROL)
    const { ambient, lights } = mounted(rig, 99)
    expect(lights).toEqual([])
    expect(ambient).toHaveLength(1)
  })

  it('passes the fixture position straight through as a 3-tuple', () => {
    const rig = lightRigOf(PATROL)
    const { lights } = mounted(rig, 1)
    const first = lights[0].position as Vec3
    expect(Array.isArray(first)).toBe(true)
    expect(first).toHaveLength(3)
    expect(first.every((axis) => Number.isFinite(axis))).toBe(true)
  })
})
