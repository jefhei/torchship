/**
 * M4-T3 — the post-processing PLAN: which passes the app mounts, and whether
 * the budget affords them.
 *
 * BUILD_PLAN M4-T3 is one sentence with two halves, and this file is the second
 * half: "*post-processing within frame budget* (subtle bloom; **SSAO only if the
 * budget allows**)". The bloom recipe is authored and gated in `recipe.ts`; the
 * decision "does the budget allow AO?" is made HERE, by rule rather than by
 * taste, against the same two budgets every other M4 task is measured against:
 *
 *  - **§10 draw calls** (`drawCallTally`, M3-T7): the scene's calls against the
 *    250-call ceiling. A post pass adds full-screen GPU work but no scene draw
 *    call, so what it needs is MARGIN — a scene already pressed against the
 *    ceiling has no room for another full-screen pass;
 *  - **the deck-scoped light ceiling** (`activeLightsFor`, M4-T2): a forward
 *    renderer pays per active light per fragment, so the number of fixtures a
 *    deck mounts at once is the other half of what the frame can afford. AO is
 *    a per-fragment pass over exactly those fragments.
 *
 * Both thresholds are authored constants and both are measured on all four
 * canonical fixtures in the tests. The measured outcome is the interesting part:
 * the three real ships afford AO (their worst deck mounts 10 of 12 fixtures,
 * their draw calls leave 37+ of margin) and the QA rig does NOT — its rig-3 deck
 * hosts two rooms and mounts the full 12, so `ssaoAffordableIn` says no and the
 * plan drops the pass on the ship that is already over budget. That is "SSAO
 * only if budget allows" happening to a real fixture rather than to a synthetic
 * one.
 *
 * **The budget is a product gate, not a §8 invariant** — the same rule M4-T2
 * set for the light frame budget: the QA rig is legitimately over budget and
 * still perfectly walkable, so nothing here is wired into
 * `src/invariants/checks.ts`. `postProblems` is the M4 machine-gate surface
 * ("frame budget met on Patrol"), and `postPlanOf` is what the app mounts.
 */

import { drawCallTally } from '../assembler/drawCalls.ts'
import type { ShipAssembly } from '../assembler'
import type { MaterialTheme } from '../materials/theme.ts'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes.ts'
import { LIGHTS_ACTIVE_MAX } from '../lighting/archetypes.ts'
import { activeLightsFor, lightRigOf } from '../lighting/rig.ts'
import {
  bloomBands,
  bloomRecipeFor,
  dimmestEmissiveRow,
  postRecipeProblems,
  type BloomRecipe,
  type SsaoRecipe,
  ssaoRecipe,
} from './recipe.ts'

/**
 * Draw-call margin the scene must still have before a full-screen pass is
 * affordable. Patrol leaves 71 (§10) — the pass is paid for out of that margin.
 */
export const POST_SSAO_MIN_CALL_HEADROOM = 24

/**
 * Fixtures the worst deck must leave unmounted before AO is affordable: 12 of
 * 12 leaves the forward pass with nothing in reserve.
 */
export const POST_SSAO_MIN_LIGHT_HEADROOM = 1

/** The two budgets a post pass competes for, measured on an assembled ship. */
export interface PostBudget {
  ship: string
  /** Scene draw calls after M3-T7's merge/instance pass. */
  calls: number
  /** §10's ceiling (PRD §10/§11: ≤ 250 after merging + instancing). */
  ceiling: number
  /** `ceiling − calls`; negative means the scene is already over budget. */
  callsHeadroom: number
  /** Fixtures the worst deck mounts at once (the M4-T2 frame-budget number). */
  activeLights: number
  /** `LIGHTS_ACTIVE_MAX`: the fixtures one deck may mount at once. */
  lightBudget: number
  /** `lightBudget − activeLights`; negative means a deck is over it. */
  lightHeadroom: number
}

/**
 * What the current scene costs, in the two currencies the post pass competes
 * for. Nothing is re-derived: the draw calls are M3-T7's `drawCallTally` and
 * the light count is M4-T2's `activeLightsFor` read across every deck.
 */
export function postBudgetOf(ship: ShipAssembly): PostBudget {
  const calls = drawCallTally(ship)
  const rig = lightRigOf(ship)
  const activeLights = ship.decks.reduce(
    (worst, deck) => Math.max(worst, activeLightsFor(rig, deck.deckIndex).length),
    0,
  )
  return {
    ship: calls.ship,
    calls: calls.total,
    ceiling: calls.ceiling,
    callsHeadroom: calls.headroom,
    activeLights,
    lightBudget: LIGHTS_ACTIVE_MAX,
    lightHeadroom: LIGHTS_ACTIVE_MAX - activeLights,
  }
}

/** Whether AO is affordable on a ship, and the sentence that says why. */
export interface SsaoAffordability {
  affordable: boolean
  /** Always populated: it is the plan's `reason`, either way. */
  reason: string
}

/**
 * "SSAO only if the budget allows", as a rule. AO is affordable when the scene
 * still has `POST_SSAO_MIN_CALL_HEADROOM` draw calls of margin AND the worst
 * deck leaves `POST_SSAO_MIN_LIGHT_HEADROOM` fixtures unmounted. The reason is
 * written in the numbers that decided it, so a report can say why the pass is
 * off without re-deriving anything.
 */
export function ssaoAffordableIn(budget: PostBudget): SsaoAffordability {
  if (budget.callsHeadroom < POST_SSAO_MIN_CALL_HEADROOM) {
    return {
      affordable: false,
      reason:
        `${budget.calls} of ${budget.ceiling} draw calls leave ` +
        `${budget.callsHeadroom} of margin, under the ${POST_SSAO_MIN_CALL_HEADROOM} ` +
        `a full-screen pass needs`,
    }
  }
  if (budget.lightHeadroom < POST_SSAO_MIN_LIGHT_HEADROOM) {
    return {
      affordable: false,
      reason:
        `the worst deck mounts ${budget.activeLights} of ${budget.lightBudget} fixtures, ` +
        `leaving ${budget.lightHeadroom} of light headroom (needs ` +
        `${POST_SSAO_MIN_LIGHT_HEADROOM})`,
    }
  }
  return {
    affordable: true,
    reason:
      `${budget.callsHeadroom} draw calls of margin (§10) and ` +
      `${budget.lightHeadroom} fixture${budget.lightHeadroom === 1 ? '' : 's'} of light ` +
      `headroom on the worst deck`,
  }
}

/** What the app mounts: the two recipes plus the budget that afforded them. */
export interface PostPlan {
  ship: string
  themeId: string
  /** The calibrated bloom pass. Always mounted. */
  bloom: BloomRecipe
  /** The AO pass, with the budget's verdict on it. */
  ssao: SsaoRecipe & { enabled: boolean }
  /** Why AO is on or off (the numbered reason above). */
  ssaoReason: string
  budget: PostBudget
  /** Full-screen passes the chain costs (bloom, plus AO's two when enabled). */
  passes: number
  /** Empty = the chain is well formed AND fits the frame budget. */
  problems: string[]
  /** One-line summary for logs, tracker notes and the QA rows. */
  detail: string
}

/** Full-screen passes one bloom costs (the mip chain and its composite). */
const BLOOM_PASSES = 1

/** Full-screen passes AO costs (the depth down-sample and the occlusion blur). */
const SSAO_PASSES = 2

/**
 * What is wrong with a plan (empty = a well-formed chain that fits): the recipe
 * gates from `recipe.ts`, then the budget —
 *
 *  1. the scene itself must be inside §10 and inside the light ceiling (post
 *     processing cannot rescue geometry that is already over budget);
 *  2. AO must be on exactly when the budget affords it (the plan derives
 *     `enabled` from `ssaoAffordableIn`, so a mismatch means the decision was
 *     overridden somewhere).
 *
 * Exported (rather than only used by `postPlanOf`) so the two budget clauses
 * can be measured against a DOCTORED budget: on a real ship they hold by
 * construction, which is exactly what makes a scene that has slipped past the
 * ceiling worth reporting when it happens.
 */
export function postPlanProblems(
  ssao: SsaoRecipe & { enabled: boolean },
  budget: PostBudget,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  const problems = postRecipeProblems(theme).map((problem) => `recipe: ${problem}`)

  if (budget.callsHeadroom < 0) {
    problems.push(
      `frame budget: "${budget.ship}" draws ${budget.calls} draw calls (${-budget.callsHeadroom} ` +
        `over §10's ${budget.ceiling}) — post-processing cannot rescue a scene that is ` +
        `already over the ceiling`,
    )
  }
  if (budget.lightHeadroom < 0) {
    problems.push(
      `frame budget: the worst deck mounts ${budget.activeLights} fixtures over the ` +
        `${budget.lightBudget} the rig allows — fix the rig before adding passes`,
    )
  }

  const { affordable, reason } = ssaoAffordableIn(budget)
  if (ssao.enabled !== affordable) {
    problems.push(
      `frame budget: the AO pass is ${ssao.enabled ? 'mounted' : 'dropped'} but the ` +
        `budget says ${affordable ? 'it fits' : 'it does not'} (${reason})`,
    )
  }

  return problems
}

/**
 * The post-processing plan for an assembled ship: the calibrated bloom recipe,
 * the AO recipe with the budget's verdict on it, and the arithmetic both were
 * decided on. Pure data — `ShipPost.tsx` turns it into passes, a test can read
 * every number in it.
 */
export function postPlanOf(
  ship: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): PostPlan {
  const budget = postBudgetOf(ship)
  const bloom = bloomRecipeFor(theme)
  const { affordable, reason } = ssaoAffordableIn(budget)
  const ssao = { ...ssaoRecipe(), enabled: affordable }

  const problems = postPlanProblems(ssao, budget, theme)

  const passes = BLOOM_PASSES + (ssao.enabled ? SSAO_PASSES : 0)
  const bands = bloomBands()
  const dimmest = dimmestEmissiveRow(theme)
  const detail =
    `post: subtle bloom (intensity ${bloom.intensity} at threshold ` +
    `${bloom.luminanceThreshold.toFixed(3)} — the gap between the lit ceiling ` +
    `${bands.litCeiling} and the dimmest lens ` +
    `${dimmest === undefined ? '(none)' : dimmest.luminance.toFixed(3)}, mip-chain) + ` +
    `ambient occlusion ${ssao.enabled ? 'on' : 'off'} (${reason}); ` +
    `${budget.calls} of ${budget.ceiling} draw calls and ${budget.activeLights} of ` +
    `${budget.lightBudget} fixtures on the worst deck; ${passes} full-screen ` +
    `pass${passes === 1 ? '' : 'es'}`

  return {
    ship: budget.ship,
    themeId: theme.id,
    bloom,
    ssao,
    ssaoReason: reason,
    budget,
    passes,
    problems,
    detail,
  }
}

/**
 * The M4 machine-gate verdict for the post pass: empty on ALL FOUR canonical
 * ships — on the three real ones because the calibrated chain fits with margin,
 * and on the QA rig because the plan drops the AO pass rather than breaking the
 * budget ("SSAO only if budget allows", measured: the rig's worst deck mounts
 * all 12 fixtures). The rig's own over-budget deck is M4-T2's finding
 * (`lightRigProblems`), not this pass's.
 */
export function postProblems(
  ship: ShipAssembly,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): string[] {
  return postPlanOf(ship, theme).problems
}

/** Readable one-line description of one pass (reports and failure messages). */
export function postPassLabel(plan: PostPlan): string {
  return (
    `bloom ${plan.bloom.intensity} @ ${plan.bloom.luminanceThreshold.toFixed(3)}` +
    (plan.ssao.enabled
      ? `, ao ${plan.ssao.intensity} r${plan.ssao.radius} ×${plan.ssao.samples}`
      : ', ao off')
  )
}
