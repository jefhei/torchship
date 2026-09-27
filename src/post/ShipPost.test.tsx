/**
 * M4-T3 — the mounted post chain, headless.
 *
 * jsdom has no WebGL, so the walkthrough's `<Canvas>` is mocked in the app's
 * tests and the post chain is never reconciled by a real renderer. This file
 * reads the element tree instead, the same technique `ShipLighting.test.tsx`
 * (M4-T2) and the M2-T7 harness use: `ShipPost` is called directly — it is
 * hook-free by design — and its children are walked as the composer would
 * receive them. The library's own components (`EffectComposer`, `Bloom`,
 * `SSAO`) are opaque LEAVES of that walk: they are `wrapEffect` wrappers that
 * use hooks, so calling one outside a renderer would throw, and there is
 * nothing to learn from their internals anyway — what this file pins is exactly
 * what the app hands them.
 *
 * The two things that matter about the app side of M4-T3:
 *
 *  - the frame mounts the plan's passes and NOTHING else — bloom always, AO
 *    only where the budget afforded it, so the QA rig's plan mounts one pass
 *    fewer than Patrol's;
 *  - every prop on a mounted pass came from the plan's own derivation (the
 *    derived luminance threshold, the mip-chain flag, the AO recipe), and the
 *    composer's own knobs are the authored ones (`POST_MULTISAMPLING`, and the
 *    normal pass deliberately off).
 *
 * NOTE: importing `@react-three/postprocessing` pulls a second three.js module
 * instance in under vitest, so this file (and any other that imports the
 * library) logs the benign `THREE.WARNING: Multiple instances of Three.js being
 * imported` line to stderr. It is a module-registry artifact of the test
 * environment, not a defect in the app.
 */

import { Fragment, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { Bloom, EffectComposer, SSAO } from '@react-three/postprocessing'
import { assembleShip } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { FIXTURE_IDS, getShipFixture } from '../fixtures'
import { POST_MULTISAMPLING, POST_SSAO_SAMPLES } from './recipe'
import { postPlanOf, type PostPlan } from './plan'
import { ShipPost } from './ShipPost'

/** Assemble a canonical fixture exactly as the app does (the rig rejects one). */
function shipOf(fixtureId: (typeof FIXTURE_IDS)[number]): ShipAssembly {
  const fixture = getShipFixture(fixtureId)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

const PATROL_PLAN = postPlanOf(shipOf('patrol'))
const RIG_PLAN = postPlanOf(shipOf('stress'))

/** The library components this chain is allowed to mount (opaque leaves). */
const LIBRARY: readonly unknown[] = [EffectComposer, Bloom, SSAO]

/**
 * Flatten a children node into the elements the composer receives: arrays and
 * fragments are resolved away, OUR components are called (they are hook-free),
 * and the library's own components are left as leaves.
 */
function passesOf(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) passesOf(child as ReactNode, out)
    return out
  }
  if (!isValidElement(node)) return out

  const element = node as ReactElement
  const { type } = element
  if (type === Fragment) {
    passesOf(propsOf(element).children as ReactNode, out)
    return out
  }
  if (typeof type === 'function' && !LIBRARY.includes(type)) {
    passesOf((type as (props: unknown) => ReactNode)(element.props), out)
    return out
  }
  out.push(element)
  return out
}

/** Props of an element, as a plain record. */
function propsOf(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>
}

/** The composer and the passes it mounts, for one plan. */
function mounted(plan: PostPlan) {
  const composer = ShipPost({ plan })
  expect(composer.type).toBe(EffectComposer)
  const children = passesOf(propsOf(composer).children as ReactNode)
  return { composer: propsOf(composer), children }
}

describe('ShipPost (M4-T3)', () => {
  it('mounts the composer with the authored knobs', () => {
    const { composer } = mounted(PATROL_PLAN)
    expect(composer.multisampling).toBe(POST_MULTISAMPLING)
    // SSAO reads depth; the normal buffer is for SSGI and is paid for by nobody.
    expect(composer.enableNormalPass).toBe(false)
  })

  it('flattens to exactly bloom + AO, both from the plan', () => {
    const { children } = mounted(PATROL_PLAN)
    expect(children.map((child) => child.type)).toEqual([Bloom, SSAO])

    const [bloom, ssao] = children.map((child) => propsOf(child))
    expect(bloom.intensity).toBe(PATROL_PLAN.bloom.intensity)
    expect(bloom.luminanceThreshold).toBe(PATROL_PLAN.bloom.luminanceThreshold)
    expect(bloom.luminanceSmoothing).toBe(PATROL_PLAN.bloom.luminanceSmoothing)
    expect(bloom.mipmapBlur).toBe(true)
    expect(bloom.radius).toBe(PATROL_PLAN.bloom.radius)

    expect(ssao.samples).toBe(POST_SSAO_SAMPLES)
    expect(ssao.rings).toBe(PATROL_PLAN.ssao.rings)
    expect(ssao.radius).toBe(PATROL_PLAN.ssao.radius)
    expect(ssao.intensity).toBe(PATROL_PLAN.ssao.intensity)
    expect(ssao.fade).toBe(PATROL_PLAN.ssao.fade)
    expect(ssao.luminanceInfluence).toBe(PATROL_PLAN.ssao.luminanceInfluence)
  })

  it('mounts no pass the plan did not author', () => {
    const { children } = mounted(PATROL_PLAN)
    for (const child of children) {
      expect(LIBRARY).toContain(child.type)
    }
    // The composer itself is the only other element in the chain.
    expect(LIBRARY).toContain(ShipPost({ plan: PATROL_PLAN }).type)
  })

  it('drops the AO pass on a ship whose budget does not afford it', () => {
    const { children } = mounted(RIG_PLAN)
    expect(RIG_PLAN.ssao.enabled).toBe(false)
    expect(children.map((child) => child.type)).toEqual([Bloom])
    expect(propsOf(children[0]).luminanceThreshold).toBe(
      RIG_PLAN.bloom.luminanceThreshold,
    )
  })

  it('mounts the same chain on every ship whose plan affords AO', () => {
    for (const id of ['patrol', 'long-haul', 'science'] as const) {
      const plan = postPlanOf(shipOf(id))
      const { children } = mounted(plan)
      expect(children.map((child) => child.type)).toEqual([Bloom, SSAO])
      expect(propsOf(children[0]).luminanceThreshold).toBeCloseTo(
        0.12046941176470588,
        12,
      )
    }
  })

  it('keeps the derived threshold on the pass, not a literal', () => {
    // A plan is data: a re-thresholded plan mounts the new value unchanged.
    const retuned: PostPlan = {
      ...PATROL_PLAN,
      bloom: { ...PATROL_PLAN.bloom, luminanceThreshold: 0.13 },
    }
    const { children } = mounted(retuned)
    expect(propsOf(children[0]).luminanceThreshold).toBe(0.13)
  })
})
