/**
 * M5-T4 — the fix loop: PRD §14 step 4 ("Fix, then re-walk only the affected
 * ships") as a runnable pass.
 *
 * BUILD_PLAN M5-T4 is "Fix loop until exit rule met (zero sev-1; ≤ 5 sev-2)".
 * Where M5-T3 ran the Review Loop once and logged what it found, M5-T4 closes
 * the loop: it applies the repo's registered FIXERS to the defects the loop
 * reports, re-runs the whole pass (the affected ship's walk included — "re-walk
 * only the affected ships"), and repeats until the PRD §14 exit rule holds, no
 * fixer can help, or the pass budget runs out.
 *
 * The honest starting position — and the reason this task does not "fabricate
 * fixes" — is that the three canonical ships enter the loop already meeting the
 * exit rule (0 sev-1 / 0 sev-2). So on the real fixtures the loop converges at
 * pass 0 with zero fixes applied. The machinery exists so a regression (a
 * drifted spec, a ship that outgrows the §10 draw-call ceiling) is repaired
 * automatically instead of silently shipping. It is proven by injecting each
 * defect the loop can report and watching the matching fixer clear it.
 *
 * DESIGN (the rules that keep this honest):
 *  - The loop derives NOTHING itself. It runs `reviewShip` (the M5-T3 loop) and
 *    applies fixers; a fixer is the only thing that may change a ship.
 *  - A fixer declares which checklist items (`handles`) it can address and a
 *    predicate (`applies`); `fix` returns a PROPOSAL (a corrected spec and/or
 *    tightened assembler options) or null when it cannot help. A fixer that
 *    returns null stops the loop — the engine never invents a fix.
 *  - The engine stops on convergence, on a pass that makes no progress, or at
 *    the pass cap; `problems` names any shippable ship that did not converge.
 *  - The NEGATIVE control (the stress rig) is NEVER "fixed": it is a rig that
 *    must fail, so the loop skips it and says so.
 *
 * Pure and three-agnostic (it imports pure leaves — `reviewShip` and the
 * fixtures — never an R3F barrel), so the loop runs in CI and its verdict is a
 * measured artifact.
 */

import type { AssembleOptions, WearDensity } from '../assembler'
import type { ShipFixture, FixtureId } from '../fixtures'
import { ROOM_MODULE_IDS, atSpine, type RoomModuleId } from '../fixtures/layout'
import type { ModuleRef, ShipSpec } from '../types'
import type { ReviewCheckId, ReviewDefect, ShipReview } from './loop'
import { EXIT_MAX_SEV1, EXIT_MAX_SEV2, reviewShip } from './loop'

/** How many fix passes a ship is allowed before the loop declares it stuck. */
export const FIX_PASS_LIMIT = 6

/** The instancing rungs of PRD §10's degradation ladder (measured, M3-T7). */
export const DRAW_CALL_LADDER: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 20]

/** The worn-detail density rungs of PRD §10 (M4-T4), richest → leanest. */
export const WEAR_DENSITY_LADDER: readonly WearDensity[] = ['full', 'reduced', 'off']

/** What a fixer proposes: a corrected spec, tighter options, or both. */
export interface FixProposal {
  /** The corrected ship spec (a fixer that re-seats modules). */
  spec?: ShipSpec
  /** Assembler options the fixer tightens (a fixer that climbs a §10 rung). */
  options?: AssembleOptions
  /** One line describing the change, for the log. */
  note: string
}

/** Everything a fixer needs to decide whether and how to act. */
export interface FixContext {
  /** The fixture as it stands at this pass (name/label/id kept from the original). */
  fixture: ShipFixture
  /** The assembler options the last review ran with. */
  options: AssembleOptions
  /** The review the fixer is being asked to repair. */
  review: ShipReview
  /** The review's defects (shorthand for `review.defects`). */
  defects: readonly ReviewDefect[]
  /** 0-based pass the review came from. */
  iteration: number
}

/**
 * One registered repair for one class of Review Loop defect. A fixer must be
 * FAIL-SAFE: `applies` is a cheap predicate over the defect list, and `fix`
 * returns null the moment it cannot help (so the loop stops rather than loops).
 */
export interface Fixer {
  /** Stable id, used in the report and `fixesApplied`. */
  id: string
  /** What the fixer does, in PRD terms. */
  description: string
  /** The checklist items whose defects this fixer can address. */
  handles: readonly ReviewCheckId[]
  /** True when the current review carries a defect this fixer addresses. */
  applies(ctx: FixContext): boolean
  /** The repair, or null when the fixer cannot help (declines). */
  fix(ctx: FixContext): FixProposal | null
}

/** The five room ids a deck may place (the spine band is never a ref). */
function isRoomModule(moduleId: string): moduleId is RoomModuleId {
  return (ROOM_MODULE_IDS as readonly string[]).includes(moduleId)
}

/** Two module refs are the same pose (exact — both sides come from `atSpine`). */
function sameModuleRef(a: ModuleRef, b: ModuleRef): boolean {
  return (
    a.moduleId === b.moduleId &&
    a.rotation === b.rotation &&
    a.offset[0] === b.offset[0] &&
    a.offset[1] === b.offset[1] &&
    a.offset[2] === b.offset[2]
  )
}

/**
 * Re-seat every room module to the canonical spine +z-face attach pose. Returns
 * null when the spec already sits at every canonical pose (nothing to change) —
 * the M0-T2 rule "derive placement from the socket", applied as a repair.
 */
export function reseatSpec(spec: ShipSpec): ShipSpec | null {
  let anyChanged = false
  const decks = spec.decks.map((deck) => {
    let deckChanged = false
    const modules = deck.modules.map((ref) => {
      if (!isRoomModule(ref.moduleId)) return ref
      const canonical = atSpine(ref.moduleId)
      if (sameModuleRef(ref, canonical)) return ref
      deckChanged = true
      return canonical
    })
    if (!deckChanged) return deck
    anyChanged = true
    return { ...deck, modules }
  })
  return anyChanged ? { ...spec, decks } : null
}

/** Findings about a socket seat / seam / hatch — what a re-seat can repair. */
const SEAT_RE = /spine|seat|seam|hatch|floor pin/i

/**
 * Re-seat drifted room modules to the canonical spine pose. This is the repair
 * for the M0-T2 §11 seam risk: a spec whose room (or its modular origin) has
 * drifted off the standardized socket origin — the defect the M1-T3 validator
 * and the §8 hatch-alignment / spine-connectivity invariants report. Placement
 * is DERIVED from the socket contract, never hand-nudged.
 */
export const spineReseatFixer: Fixer = {
  id: 'spine-reseat',
  description:
    'Re-seat every drifted room module to the canonical spine +z-face attach pose (M0-T2: derive placement from the socket).',
  handles: ['spec-valid', 'auto-invariants', 'assembly'],
  applies(ctx) {
    return (
      ctx.defects.some((defect) => defect.check === 'spec-valid') ||
      ctx.defects.some((defect) => SEAT_RE.test(defect.detail))
    )
  },
  fix(ctx) {
    const spec = reseatSpec(ctx.fixture.spec)
    if (spec === null) return null
    return {
      spec,
      note: 're-seated every drifted room module to the canonical spine attach pose',
    }
  },
}

/** Findings about the draw-call budget — what the instancing rung repairs. */
const DRAW_CALL_RE = /draw call|draw-call|beat merging/i

/**
 * Climb PRD §10's instancing rung: raise `minInstances` to the next measured
 * step so repeated moulds batch and the deck's draw-call total drops under the
 * §10 ceiling. Pure re-partition — the rendered geometry is identical.
 */
export const drawCallLadderFixer: Fixer = {
  id: 'draw-call-ladder',
  description:
    "Climb PRD §10's instancing rung: raise `minInstances` until the draw-call total fits the §10 ceiling.",
  handles: ['assembly'],
  applies(ctx) {
    return ctx.defects.some((defect) => DRAW_CALL_RE.test(defect.detail))
  },
  fix(ctx) {
    const current = ctx.options.minInstances ?? 2
    const next = DRAW_CALL_LADDER.find((value) => value > current)
    if (next === undefined) return null
    return {
      options: { minInstances: next },
      note: `raised the instancing rung minInstances ${current} → ${next}`,
    }
  },
}

/** Findings about the worn-detail budget — what the density rung repairs. */
const WEAR_BUDGET_RE = /worn detail/i

/**
 * Drop PRD §10's prop/clutter density rung: `full → reduced → off`, cutting the
 * per-deck worn-detail draw calls until they fit their budget. The M4-T4 map.
 */
export const wearDensityRungFixer: Fixer = {
  id: 'wear-density-rung',
  description:
    "Drop PRD §10's worn-detail density rung (full → reduced → off) until the per-deck clutter budget fits.",
  handles: ['assembly'],
  applies(ctx) {
    return ctx.defects.some((defect) => WEAR_BUDGET_RE.test(defect.detail))
  },
  fix(ctx) {
    const current = ctx.options.wearDensity ?? 'full'
    const index = WEAR_DENSITY_LADDER.indexOf(current)
    const next = WEAR_DENSITY_LADDER[index + 1]
    if (next === undefined) return null
    return {
      options: { wearDensity: next },
      note: `dropped the worn-detail density rung ${current} → ${next}`,
    }
  },
}

/** The registered repairs, in the order the loop tries them. */
export const FIXERS: readonly Fixer[] = [
  spineReseatFixer,
  drawCallLadderFixer,
  wearDensityRungFixer,
]

/** One pass of the loop: the review it ran and the fix that moved past it. */
export interface FixPass {
  /** 0 = the initial review (nothing applied yet). */
  iteration: number
  sev1: number
  sev2: number
  /** The fixer applied to move PAST this pass, or null on the last pass. */
  fixerId: string | null
  /** The fix applied, or null. */
  note: string | null
}

/** The fix loop's verdict on one ship. */
export interface FixLoopReport {
  fixtureId: FixtureId
  label: string
  /** Ship identity name (spec.name). */
  ship: string
  expectValid: boolean
  /** True when the fixture is the negative control (skipped by design). */
  negativeControl: boolean
  /** True when the exit rule is met (shippable ships only). */
  converged: boolean
  /** Fixes applied (one per pass after the initial review). */
  iterations: number
  passes: FixPass[]
  fixesApplied: string[]
  /** Defects remaining after the loop stopped. */
  remainingSev1: number
  remainingSev2: number
  /** Loop-level problems (a shippable ship that did not converge). */
  problems: string[]
  ok: boolean
  summary: string
}

/** Options the fix loop accepts (the defaults are the review settings). */
export interface FixLoopOptions {
  /** The repairs to try, in order (default FIXERS). */
  fixers?: readonly Fixer[]
  /** Assembler options the initial review runs with (default {}). */
  options?: AssembleOptions
  /** Fix passes allowed after the initial review (default FIX_PASS_LIMIT). */
  maxPasses?: number
}

/** A fix loop's verdict on the fixtures the negative control did not cover. */
function negativeControlReport(fixture: ShipFixture): FixLoopReport {
  const ship = fixture.spec.name
  return {
    fixtureId: fixture.id,
    label: fixture.label,
    ship,
    expectValid: false,
    negativeControl: true,
    converged: false,
    iterations: 0,
    passes: [],
    fixesApplied: [],
    remainingSev1: 0,
    remainingSev2: 0,
    problems: [],
    ok: true,
    summary: `${ship} (${fixture.label}) · negative control — skipped (a rig that must fail is never repaired)`,
  }
}

/**
 * Run the fix loop on one fixture. Reviews the ship, applies the first fixer
 * that both `handles` a present defect and `applies`, re-reviews the corrected
 * ship, and repeats until the exit rule is met, no fixer can help, or the pass
 * cap is reached. The negative control is skipped and reported as such.
 */
export function runFixLoop(
  fixture: ShipFixture,
  options: FixLoopOptions = {},
): FixLoopReport {
  if (!fixture.expectValid) {
    return negativeControlReport(fixture)
  }

  const fixers = options.fixers ?? FIXERS
  const maxPasses = options.maxPasses ?? FIX_PASS_LIMIT
  let current = fixture
  let assembleOptions = options.options ?? {}
  const passes: FixPass[] = []
  const fixesApplied: string[] = []

  let review = reviewShip(current, assembleOptions)
  passes.push({
    iteration: 0,
    sev1: review.sev1,
    sev2: review.sev2,
    fixerId: null,
    note: null,
  })

  while (!review.exitRuleMet && passes.length - 1 < maxPasses) {
    const ctx: FixContext = {
      fixture: current,
      options: assembleOptions,
      review,
      defects: review.defects,
      iteration: passes.length - 1,
    }
    const fixer = fixers.find(
      (candidate) =>
        candidate.applies(ctx) &&
        candidate.handles.some((check) =>
          review.defects.some((defect) => defect.check === check),
        ),
    )
    if (fixer === undefined) break

    const proposal = fixer.fix(ctx)
    if (proposal === null) break

    if (proposal.spec !== undefined) {
      current = { ...current, spec: proposal.spec }
    }
    if (proposal.options !== undefined) {
      assembleOptions = { ...assembleOptions, ...proposal.options }
    }
    fixesApplied.push(fixer.id)

    const before = review.sev1 + review.sev2
    const next = reviewShip(current, assembleOptions)
    const after = next.sev1 + next.sev2
    passes.push({
      iteration: passes.length,
      sev1: next.sev1,
      sev2: next.sev2,
      fixerId: fixer.id,
      note: proposal.note,
    })
    review = next

    // A fix that does not reduce the defect count cannot help — stop honestly.
    if (!next.exitRuleMet && after >= before) break
  }

  const converged = review.exitRuleMet
  const problems = converged
    ? []
    : [
        `"${review.ship}" (${fixture.label}) did not reach the PRD §14 exit rule: ` +
          `${review.sev1} sev-1 (max ${EXIT_MAX_SEV1}) / ${review.sev2} sev-2 ` +
          `(max ${EXIT_MAX_SEV2}) remain after ${fixesApplied.length} fix(es)`,
      ]

  const summary = converged
    ? `${review.ship} (${fixture.label}) · exit rule met at pass ${passes.length - 1} · ` +
      `${fixesApplied.length} fix(es) applied`
    : `${review.ship} (${fixture.label}) · NOT converged · ` +
      `${review.sev1} sev-1 / ${review.sev2} sev-2 remaining`

  return {
    fixtureId: fixture.id,
    label: fixture.label,
    ship: review.ship,
    expectValid: true,
    negativeControl: false,
    converged,
    iterations: passes.length - 1,
    passes,
    fixesApplied,
    remainingSev1: review.sev1,
    remainingSev2: review.sev2,
    problems,
    ok: converged,
    summary,
  }
}

/**
 * Run the fix loop over the canonical fixtures (default: all four, in registry
 * order). The negative control is skipped by `runFixLoop`, so its report carries
 * no passes.
 */
export function runFixLoops(
  fixtures: readonly ShipFixture[],
  options: FixLoopOptions = {},
): FixLoopReport[] {
  return fixtures.map((fixture) => runFixLoop(fixture, options))
}

/** Loop-level problems: a shippable ship that did not converge. */
export function fixLoopProblems(reports: readonly FixLoopReport[]): string[] {
  return reports.flatMap((report) => report.problems)
}

/** The whole run's verdict: every shippable ship converged. */
export function fixLoopOk(reports: readonly FixLoopReport[]): boolean {
  return fixLoopProblems(reports).length === 0
}
