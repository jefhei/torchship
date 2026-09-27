/**
 * M4-T3 — the post-processing plan over the canonical ships.
 *
 * Pins (BUILD_PLAN M4-T3 "post-processing **within frame budget**"; the M4
 * machine gate "frame budget met on Patrol"):
 *
 *  - the two budgets the pass competes for, measured on all four fixtures: §10
 *    draw calls (M3-T7's tally) and the deck-scoped light ceiling (M4-T2's
 *    `activeLightsFor`) — Patrol 179 calls / 12-margin-is-71 / 10 of 12
 *    fixtures;
 *  - the affordability rule itself, on both edges (24 calls of margin, 1 fixture
 *    of headroom) and a doctored budget either side of each;
 *  - the measured outcome of "SSAO only if budget allows": the three real ships
 *    mount the pass (3 full-screen passes), and the QA rig — whose rig-3 deck
 *    hosts two rooms and mounts all 12 fixtures — drops it (1 pass);
 *  - the verdict: empty on all four, and a doctored plan that mounts AO on an
 *    unaffordable budget, or that runs on a scene already over §10, is refused.
 */

import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { FIXTURE_IDS, getShipFixture } from '../fixtures'
import { DRAW_CALL_CEILING } from '../assembler/drawCalls'
import { LIGHTS_ACTIVE_MAX } from '../lighting/archetypes'
import { POST_SSAO_SAMPLES, ssaoRecipe } from './recipe'
import {
  POST_SSAO_MIN_CALL_HEADROOM,
  POST_SSAO_MIN_LIGHT_HEADROOM,
  postBudgetOf,
  postPassLabel,
  postPlanOf,
  postPlanProblems,
  postProblems,
  ssaoAffordableIn,
  type PostBudget,
} from './plan'

/** Assemble a canonical fixture exactly as the app does (the rig rejects one). */
function shipOf(fixtureId: (typeof FIXTURE_IDS)[number]): ShipAssembly {
  const fixture = getShipFixture(fixtureId)
  return assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
}

const PATROL = shipOf('patrol')
const LONG_HAUL = shipOf('long-haul')
const SCIENCE = shipOf('science')
const STRESS = shipOf('stress')

/** The measured shape of the four canonical fixtures (M3-T7 + M4-T2 numbers). */
const MEASURED = {
  patrol: {
    calls: 179,
    callsHeadroom: 71,
    activeLights: 10,
    lightHeadroom: 2,
    ssao: true,
  },
  'long-haul': {
    calls: 213,
    callsHeadroom: 37,
    activeLights: 10,
    lightHeadroom: 2,
    ssao: true,
  },
  science: {
    calls: 181,
    callsHeadroom: 69,
    activeLights: 10,
    lightHeadroom: 2,
    ssao: true,
  },
  stress: {
    calls: 194,
    callsHeadroom: 56,
    activeLights: 12,
    lightHeadroom: 0,
    ssao: false,
  },
} as const

/** A synthetic budget, so the affordability rule can be probed on both edges. */
function budgetWith(overrides: Partial<PostBudget>): PostBudget {
  return {
    ship: 'test',
    calls: 179,
    ceiling: DRAW_CALL_CEILING,
    callsHeadroom: 71,
    activeLights: 10,
    lightBudget: LIGHTS_ACTIVE_MAX,
    lightHeadroom: 2,
    ...overrides,
  }
}

describe('the frame budget the post pass competes for (M4-T3)', () => {
  it('measures §10 draw calls and the light ceiling on every canonical ship', () => {
    for (const id of FIXTURE_IDS) {
      const budget = postBudgetOf(shipOf(id))
      const expected = MEASURED[id]
      expect(budget.calls).toBe(expected.calls)
      expect(budget.ceiling).toBe(DRAW_CALL_CEILING)
      expect(budget.callsHeadroom).toBe(expected.callsHeadroom)
      expect(budget.activeLights).toBe(expected.activeLights)
      expect(budget.lightBudget).toBe(LIGHTS_ACTIVE_MAX)
      expect(budget.lightHeadroom).toBe(expected.lightHeadroom)
    }
    // Every real ship is inside §10 with room; the rig is too (its defect is
    // the deck that mounts every fixture, not the draw-call ceiling).
    for (const id of FIXTURE_IDS) {
      expect(MEASURED[id].callsHeadroom).toBeGreaterThanOrEqual(
        POST_SSAO_MIN_CALL_HEADROOM,
      )
    }
  })

  it('affords AO on the three real ships and refuses it on the QA rig', () => {
    for (const id of FIXTURE_IDS) {
      const { affordable, reason } = ssaoAffordableIn(postBudgetOf(shipOf(id)))
      expect(affordable).toBe(MEASURED[id].ssao)
      expect(reason.length).toBeGreaterThan(0)
    }
    const rig = ssaoAffordableIn(postBudgetOf(STRESS))
    expect(rig.reason).toMatch(
      /worst deck mounts 12 of 12 fixtures, leaving 0 of light headroom \(needs 1\)/,
    )
    const patrol = ssaoAffordableIn(postBudgetOf(PATROL))
    expect(patrol.reason).toMatch(
      /71 draw calls of margin \(§10\) and 2 fixtures of light headroom/,
    )
  })

  it('draws the line at exactly the two margins it names', () => {
    // Calls: the margin is inclusive, one under it is not enough.
    expect(
      ssaoAffordableIn(budgetWith({ callsHeadroom: POST_SSAO_MIN_CALL_HEADROOM }))
        .affordable,
    ).toBe(true)
    expect(
      ssaoAffordableIn(budgetWith({ callsHeadroom: POST_SSAO_MIN_CALL_HEADROOM - 1 })),
    ).toEqual({
      affordable: false,
      reason: expect.stringMatching(
        /leave 23 of margin, under the 24 a full-screen pass needs/,
      ),
    })

    // Lights: one fixture of headroom is the minimum, none is not.
    expect(
      ssaoAffordableIn(
        budgetWith({ activeLights: 11, lightHeadroom: POST_SSAO_MIN_LIGHT_HEADROOM }),
      ).affordable,
    ).toBe(true)
    expect(
      ssaoAffordableIn(budgetWith({ activeLights: 12, lightHeadroom: 0 })),
    ).toEqual({
      affordable: false,
      reason: expect.stringMatching(
        /mounts 12 of 12 fixtures, leaving 0 of light headroom \(needs 1\)/,
      ),
    })
  })
})

describe('the post plan (M4-T3)', () => {
  it('mounts the calibrated bloom on every ship, and AO only where it fits', () => {
    for (const id of FIXTURE_IDS) {
      const plan = postPlanOf(shipOf(id))
      const expected = MEASURED[id]

      expect(plan.ship).toBe(getShipFixture(id).spec.name)
      expect(plan.themeId).toBe('firebrand')
      expect(plan.bloom.intensity).toBe(0.35)
      expect(plan.bloom.luminanceThreshold).toBeCloseTo(0.12046941176470588, 12)
      expect(plan.ssao.enabled).toBe(expected.ssao)
      expect(plan.ssao.samples).toBe(POST_SSAO_SAMPLES)
      expect(plan.passes).toBe(expected.ssao ? 3 : 1)
      expect(plan.problems).toEqual([])
      expect(plan.detail).toMatch(
        /^post: subtle bloom \(intensity 0\.35 at threshold 0\.120/,
      )
    }
  })

  it('passes the recipe through untouched — no second opinion about the AO pass', () => {
    const plan = postPlanOf(PATROL)
    expect(plan.ssao).toEqual({ ...ssaoRecipe(), enabled: true })
    expect(plan.bloom.mipmapBlur).toBe(true)
    expect(postPassLabel(plan)).toBe('bloom 0.35 @ 0.120, ao 0.35 r0.12 ×9')
    expect(postPassLabel(postPlanOf(STRESS))).toBe('bloom 0.35 @ 0.120, ao off')
  })

  it('says why AO was dropped, in the numbers that decided it', () => {
    expect(postPlanOf(STRESS).ssaoReason).toMatch(/12 of 12 fixtures/)
    expect(postPlanOf(PATROL).ssaoReason).toMatch(/71 draw calls of margin/)
    expect(postPlanOf(SCIENCE).detail).toMatch(
      /181 of 250 draw calls and 10 of 12 fixtures/,
    )
    expect(postPlanOf(LONG_HAUL).detail).toMatch(/ambient occlusion on/)
  })

  it('is deterministic and stable across calls', () => {
    expect(postPlanOf(PATROL)).toEqual(postPlanOf(PATROL))
    expect(postPlanOf(PATROL).budget).toEqual(postBudgetOf(PATROL))
  })

  it('carries the whole ship through the M4 machine gate', () => {
    for (const id of FIXTURE_IDS) {
      expect(postProblems(shipOf(id))).toEqual([])
    }
    expect(postProblems(PATROL)).toEqual(postPlanOf(PATROL).problems)
  })
})

describe('the plan gates (doctored budgets prove they fire)', () => {
  it('refuses a scene that is already over §10', () => {
    const problems = postPlanProblems(
      { ...ssaoRecipe(), enabled: false },
      budgetWith({ calls: 260, callsHeadroom: -10 }),
    )
    expect(problems).toEqual([
      expect.stringMatching(
        /frame budget: "test" draws 260 draw calls \(10 over §10's 250\) — post-processing cannot rescue/,
      ),
    ])
  })

  it('refuses a scene whose rig is over the light ceiling', () => {
    const problems = postPlanProblems(
      { ...ssaoRecipe(), enabled: false },
      budgetWith({ activeLights: 15, lightHeadroom: -3 }),
    )
    expect(problems).toEqual([
      expect.stringMatching(
        /the worst deck mounts 15 fixtures over the 12 the rig allows/,
      ),
    ])
  })

  it('refuses an AO pass mounted on a budget that does not afford it', () => {
    const overBudget = budgetWith({ activeLights: 12, lightHeadroom: 0 })
    expect(postPlanProblems({ ...ssaoRecipe(), enabled: true }, overBudget)).toEqual([
      expect.stringMatching(/the AO pass is mounted but the budget says it does not/),
    ])
    // ...and the other direction: dropping a pass the budget affords.
    expect(
      postPlanProblems({ ...ssaoRecipe(), enabled: false }, budgetWith({})),
    ).toEqual([
      expect.stringMatching(/the AO pass is dropped but the budget says it fits/),
    ])
  })
})
