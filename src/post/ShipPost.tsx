/**
 * M4-T3 — the post-processing chain, on screen.
 *
 * This file does no deciding. Every number it mounts came from a `PostPlan`
 * (`plan.ts`): the bloom recipe is calibrated against the theme's own emissive
 * band, and whether the AO pass exists at all was settled by the frame budget
 * (both budgets, read off M3-T7's draw calls and M4-T2's deck-scoped light
 * ceiling). The component's whole job is the mapping plan → passes, which is
 * what makes the app side of M4-T3 testable without a GPU: a test can call it
 * and read the element tree, exactly as `ShipLighting.test.tsx` does for the
 * rig.
 *
 * Two deliberate choices:
 *
 *  - **`enableNormalPass` stays off.** postprocessing's own documentation keeps
 *    the normal pass for SSGI; SSAO reads depth and reconstructs what it needs,
 *    so mounting the extra full-screen normal target would be paying for a
 *    buffer nothing in this chain reads.
 *  - **The composer carries the anti-aliasing.** A composer takes rendering
 *    over from R3F, so the `<Canvas>`'s `antialias` flag is inert once this
 *    component is mounted; `POST_MULTISAMPLING` is the moderate MSAA the
 *    budget affords instead.
 *
 * `depthBuffer` is deliberately left at its default (true): without it there is
 * no depth to derive occlusion from.
 */

import { Bloom, EffectComposer, SSAO } from '@react-three/postprocessing'
import type { PostPlan } from './plan.ts'
import { POST_MULTISAMPLING } from './recipe.ts'

/** One bloom pass: the plan's calibrated strength, spread and threshold. */
function ShipBloom({ plan }: { plan: PostPlan }) {
  return (
    <Bloom
      intensity={plan.bloom.intensity}
      luminanceThreshold={plan.bloom.luminanceThreshold}
      luminanceSmoothing={plan.bloom.luminanceSmoothing}
      mipmapBlur={plan.bloom.mipmapBlur}
      radius={plan.bloom.radius}
    />
  )
}

/** The occlusion pass — mounted only when the budget afforded it. */
function ShipSsao({ plan }: { plan: PostPlan }) {
  return (
    <SSAO
      samples={plan.ssao.samples}
      rings={plan.ssao.rings}
      radius={plan.ssao.radius}
      intensity={plan.ssao.intensity}
      fade={plan.ssao.fade}
      luminanceInfluence={plan.ssao.luminanceInfluence}
    />
  )
}

/**
 * The ship's post chain for one plan: subtle bloom always, ambient occlusion
 * when the plan's budget said yes. Mounted inside the walkthrough's `<Canvas>`
 * (see `WalkthroughScene`), where it takes over rendering from R3F.
 */
export function ShipPost({ plan }: { plan: PostPlan }) {
  return (
    <EffectComposer multisampling={POST_MULTISAMPLING} enableNormalPass={false}>
      <ShipBloom plan={plan} />
      {plan.ssao.enabled ? <ShipSsao plan={plan} /> : null}
    </EffectComposer>
  )
}
