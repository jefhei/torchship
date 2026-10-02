/**
 * M5-T3 — the Review Loop: PRD §14 as a runnable pass over the canonical ships.
 *
 * BUILD_PLAN M5-T3 is "Full Review Loop pass on all four ships (see below)".
 * PRD §14 defines the loop: test scenes are the three M0 ships + the stress
 * spec; the checklist is the §8 [review] invariants + the §4 landmark list,
 * with the scripted coffee run (M5-T2) as the standard movement test; every
 * defect is logged as `{ severity, ship, deck, location, repro }`; and the exit
 * rule is zero sev-1 and ≤ 5 sev-2. This module runs that loop headlessly.
 *
 * It is the CONSUMER of the gates every earlier milestone built — it derives
 * nothing itself, it just runs the checks the repo already owns and ranks what
 * they find:
 *
 *   1. `spec-valid`      — the M1-T3 validator accepts the spec (authored kit);
 *   2. `auto-invariants` — the M0-T6/M1-T3/M2-T7/M3-T2/M3-T3 harness: all six
 *                          §8 [auto] invariants;
 *   3. `assembly`        — the M3/M4 assembler gate (partition, seams, hull,
 *                          draw calls, worn detail);
 *   4. `walk`            — §8 [review] 1: the scripted coffee run does not clip,
 *                          the camera does not escape, every waypoint is reached;
 *   5. `landmarks`       — §8 [review] 2: the six §4 landmarks are aboard;
 *   6. `lighting`        — §8 [review] 3 (machine half): no unlit room, plus the
 *                          practical-light frame budget;
 *   7. `atmosphere`      — §8 [review] 3 (machine half): the calibrated post pass;
 *   8. `wayfinding`      — §8 [review] 4: deck signs + ladder marks are legible.
 *
 * The three §8 [review] items that need a human eye (worn-and-warm mood, the
 * fresh-player hallway test, onboarding time) are reported as OPEN human
 * sign-off items — never quietly passed.
 *
 * SEVERITY (PRD §13/§14): sev-1 = world-breaking (a broken closed world, an
 * unreachable/misaligned deck, a missing signature landmark, a dark room, a
 * clipped or escaped walk, or a spec the validator rejects); sev-2 = cosmetic /
 * budget (a frame-budget overflow, the post pass, wayfinding signage). The
 * stress rig is the NEGATIVE CONTROL: it is not a shippable ship, so the loop
 * requires it to FAIL (≥ 1 sev-1) — a rig the loop signs off would mean the
 * loop is not looking.
 *
 * Pure and three-agnostic (it imports pure leaves, never the R3F barrels), so
 * the whole pass runs in CI and QA.md is a measured artifact.
 */

import { assembleShip, assemblyProblems } from '../assembler'
import type { ShipAssembly } from '../assembler'
import { SHIP_FIXTURES, type FixtureId, type ShipFixture } from '../fixtures'
import { runInvariantHarness } from '../invariants'
import { AUTHORED_KIT } from '../kit/modules/registry'
import { LIGHTS_ACTIVE_MAX, LIGHTS_PER_DECK_MAX } from '../lighting/archetypes'
import { lightRigCoverageProblems, lightRigReport } from '../lighting/rig'
import { navigationWorldOf, type NavigationWorld } from '../player/nav'
import { postPlanOf, postProblems } from '../post/plan'
import { shipSpecProblems } from '../validation/validator'
import { wayfindingProblems } from '../wayfinding/checks'
import { wayfindingDecksOf } from '../wayfinding/decks'
import { scriptDeck, walkProblems } from './checks'
import { landmarkEvidence, landmarkProblems, landmarkTally } from './landmarks'
import { planCoffeeRun } from './path'
import { recordWalk } from './record'

/** The two severities PRD §14 logs. */
export type ReviewSeverity = 'sev-1' | 'sev-2'

/** Both severities, worst first (report order). */
export const REVIEW_SEVERITIES: readonly ReviewSeverity[] = ['sev-1', 'sev-2']

/** PRD §14 exit rule: zero sev-1 defects. */
export const EXIT_MAX_SEV1 = 0

/** PRD §14 exit rule: at most five sev-2 defects. */
export const EXIT_MAX_SEV2 = 5

/** The checklist items, in report order. */
export type ReviewCheckId =
  | 'spec-valid'
  | 'auto-invariants'
  | 'assembly'
  | 'walk'
  | 'landmarks'
  | 'lighting'
  | 'atmosphere'
  | 'wayfinding'

/** The `[review]` checklist items only a human can sign. */
export const HUMAN_REVIEW_ITEMS: readonly string[] = [
  'Worn-and-warm mood (PRD §8 [review] 3): the reviewer signs off the §4 mood against the reference board — amber practicals on cool metal, lived-in but not filthy, never sterile or horror-dark, no blown-out panels.',
  'Wayfinding hallway test (PRD §13): a fresh player walks crew deck → bridge and back on the first try (n = 3).',
  'Onboarding (PRD §13): time-to-first-walkthrough < 60 s from page load (preset → click → walking).',
  'Ladder/hatch feel (M0-T4, human-held): the climb pace, rung snapping and hatch transitions read right in a browser walk.',
]

/** One defect in PRD §14's log shape. */
export interface ReviewDefect {
  severity: ReviewSeverity
  /** Ship identity name (spec.name), e.g. "Firebrand". */
  ship: string
  /** Deck index the finding sits on, or null when ship-wide. */
  deck: number | null
  /** Deck id/label-ish name, or null. */
  deckName: string | null
  /** Human location line (deck + what was being checked). */
  location: string
  check: ReviewCheckId
  checkLabel: string
  /** What is wrong, verbatim from the gate that found it. */
  detail: string
  /** How to reproduce this pass. */
  repro: string
}

/** One checklist item's verdict on one ship. */
export interface ReviewCheck {
  id: ReviewCheckId
  label: string
  /** The requirement this item checks, in PRD/BUILD_PLAN terms. */
  source: string
  status: 'pass' | 'fail' | 'human'
  /** True when the item is a human sign-off (never a defect). */
  human: boolean
  /** One-line measured verdict. */
  detail: string
  defects: ReviewDefect[]
}

/** The full review of one ship. */
export interface ShipReview {
  fixtureId: FixtureId
  /** Preset label, e.g. "Patrol". */
  label: string
  ship: string
  /** true = a shippable ship; false = the negative control. */
  expectValid: boolean
  decks: number
  checks: ReviewCheck[]
  defects: ReviewDefect[]
  sev1: number
  sev2: number
  /** Exit rule met (only meaningful for a shippable ship). */
  exitRuleMet: boolean
  /** Negative control: the loop detected its seeded defects (≥ 1 sev-1). */
  controlDetected: boolean
  /** Human-only sign-offs that stay open on every ship. */
  humanItems: readonly string[]
  /** One-line summary in the reports' style. */
  summary: string
}

/** The whole Review Loop pass. */
export interface ReviewLoopReport {
  ships: ShipReview[]
  /** Shippable ships that meet the exit rule. */
  passed: number
  /** Shippable ships that do not. */
  failed: number
  /** Loop-level problems: a shippable ship failing, or the control passing. */
  problems: string[]
  /** True when `problems` is empty. */
  ok: boolean
}

/** The deck a gate's problem line names (`deck N ("id"): …`), or null. */
function deckOfProblem(line: string): { deck: number; deckId: string } | null {
  const match = /^deck (\d+) \("([^"]+)"\)/.exec(line)
  if (match === null) return null
  return { deck: Number(match[1]), deckId: match[2] }
}

/** A defect, with the deck fields pulled off the finding's own wording. */
function makeDefect(
  ship: string,
  fixture: ShipFixture,
  check: ReviewCheckId,
  checkLabel: string,
  severity: ReviewSeverity,
  detail: string,
  location: string,
  deck: number | null = null,
  deckName: string | null = null,
): ReviewDefect {
  return {
    severity,
    ship,
    deck,
    deckName,
    location,
    check,
    checkLabel,
    detail,
    repro: `npm run qa:review — check "${check}" on fixture "${fixture.id}"`,
  }
}

/** The deck a finding names, or the ship-wide placeholder. */
function deckFields(line: string): {
  deck: number | null
  deckName: string | null
  location: string
} {
  const named = deckOfProblem(line)
  if (named === null) {
    return { deck: null, deckName: null, location: 'ship-wide' }
  }
  return {
    deck: named.deck,
    deckName: named.deckId,
    location: `deck ${named.deck} ("${named.deckId}")`,
  }
}

/**
 * Severity of one assembled-ship finding: the §10 draw-call and §6 clutter
 * BUDGET overflows are cosmetic/perf (PRD §10's degradation ladder drops them);
 * everything else in the assembler gate is structural and world-breaking. The
 * default is sev-1, so a reworded finding can never be silently downgraded.
 */
export function assemblyFindingSeverity(line: string): ReviewSeverity {
  return /draw call|frame budget|clutter/i.test(line) ? 'sev-2' : 'sev-1'
}

/** The spec validator (M1-T3) against the authored kit the app loads. */
function specValidCheck(fixture: ShipFixture, ship: string): ReviewCheck {
  const problems = shipSpecProblems(fixture.spec, AUTHORED_KIT)
  return {
    id: 'spec-valid',
    label: 'Ship Spec valid',
    source: 'PRD §7 / M1-T3 validator',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      problems.length > 0
        ? `spec rejected: ${problems.length} validator problem(s)`
        : 'spec accepted — schema, socket alignment and spine connectivity clean',
    defects: problems.map((problem) =>
      makeDefect(
        ship,
        fixture,
        'spec-valid',
        'Ship Spec valid',
        'sev-1',
        problem,
        'spec (ship-wide)',
      ),
    ),
  }
}

/** The six §8 [auto] invariants (M0-T6 harness). */
function autoInvariantCheck(fixture: ShipFixture, ship: string): ReviewCheck {
  const runs = runInvariantHarness(fixture)
  const failed = runs.filter((run) => run.status === 'fail')
  const deferred = runs.filter((run) => run.status === 'deferred')
  return {
    id: 'auto-invariants',
    label: 'PRD §8 [auto] invariants',
    source: 'PRD §8 bullets 1–6 / M0-T6 harness',
    status: failed.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      `${runs.length - failed.length - deferred.length}/${runs.length} live [auto] invariant(s) pass` +
      `${deferred.length > 0 ? `, ${deferred.length} deferred` : ''}` +
      `${failed.length > 0 ? `, ${failed.length} FAIL` : ''}`,
    defects: failed.map((run) =>
      makeDefect(
        ship,
        fixture,
        'auto-invariants',
        'PRD §8 [auto] invariants',
        'sev-1',
        `§8 [auto] "${run.invariantId}" fails: ${run.detail}`,
        'ship-wide',
      ),
    ),
  }
}

/** The assembled-ship gate (M3/M4). */
function assemblyCheck(fixture: ShipFixture, ship: ShipAssembly): ReviewCheck {
  const name = ship.spec.name
  const problems = assemblyProblems(ship)
  return {
    id: 'assembly',
    label: 'Assembled-ship integrity',
    source: 'PRD §7 scene graph / M3–M4 assembler gate',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      problems.length > 0
        ? `${problems.length} assembled-ship problem(s)`
        : 'assembled ship faithful — partition, seams, hull, draw calls and worn detail clean',
    defects: problems.map((problem) => {
      const fields = deckFields(problem)
      return makeDefect(
        name,
        fixture,
        'assembly',
        'Assembled-ship integrity',
        assemblyFindingSeverity(problem),
        problem,
        fields.location,
        fields.deck,
        fields.deckName,
      )
    }),
  }
}

/** §8 [review] 1 — the scripted coffee run (M5-T2). */
function walkCheck(
  fixture: ShipFixture,
  ship: ShipAssembly,
  world: NavigationWorld,
): ReviewCheck {
  const name = ship.spec.name
  const plan = planCoffeeRun(ship, world)
  if (plan.script === null) {
    return {
      id: 'walk',
      label: 'Scripted walk (coffee run)',
      source: 'PRD §8 [review] 1 / §14 coffee run',
      status: 'fail',
      human: false,
      detail: `no scripted coffee run to make: ${plan.problems.join('; ')}`,
      defects: [
        makeDefect(
          name,
          fixture,
          'walk',
          'Scripted walk (coffee run)',
          'sev-1',
          `the ship offers no scripted coffee run: ${plan.problems.join('; ')}`,
          'movement (ship-wide)',
        ),
      ],
    }
  }

  const recording = recordWalk(ship, world, plan.script)
  const problems = walkProblems(recording)
  const deck = scriptDeck(plan.script)
  return {
    id: 'walk',
    label: 'Scripted walk (coffee run)',
    source: 'PRD §8 [review] 1 / §14 coffee run',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      problems.length > 0
        ? `${problems.length} walk defect(s) over ${recording.framesRun} frames`
        : `coffee run clean — ${recording.waypoints.length} waypoints, ` +
          `${recording.framesRun} frames, ${recording.distanceM.toFixed(1)} m, ` +
          `no clip, no escape, ${recording.maxDepenetrations} worst depenetration`,
    defects: problems.map((problem) =>
      makeDefect(
        name,
        fixture,
        'walk',
        'Scripted walk (coffee run)',
        'sev-1',
        problem,
        deck === null ? 'movement (ship-wide)' : `movement / coffee run (deck ${deck})`,
        deck,
      ),
    ),
  }
}

/** §8 [review] 2 — the §4 landmark list. */
function landmarksCheck(
  fixture: ShipFixture,
  ship: ShipAssembly,
  world: NavigationWorld,
): ReviewCheck {
  const name = ship.spec.name
  const evidence = landmarkEvidence(ship, world)
  const problems = landmarkProblems(ship, world)
  return {
    id: 'landmarks',
    label: 'PRD §4 landmarks present',
    source: 'PRD §8 [review] 2 / §4 signature landmarks',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail: landmarkTally(evidence),
    defects: problems.map((problem) =>
      makeDefect(
        name,
        fixture,
        'landmarks',
        'PRD §4 landmarks present',
        'sev-1',
        problem,
        'ship-wide',
      ),
    ),
  }
}

/** §8 [review] 3 (machine half) — the practical-light rig. */
function lightingCheck(fixture: ShipFixture, ship: ShipAssembly): ReviewCheck {
  const name = ship.spec.name
  const coverage = lightRigCoverageProblems(ship)
  const report = lightRigReport(ship)
  const budgetRows = report.decks.filter((row) => row.lights > LIGHTS_PER_DECK_MAX)

  const defects: ReviewDefect[] = [
    ...coverage.map((problem) =>
      makeDefect(
        name,
        fixture,
        'lighting',
        'Practical lighting (no dark room)',
        'sev-1',
        problem,
        'lighting (ship-wide)',
      ),
    ),
    ...budgetRows.map((row) =>
      makeDefect(
        name,
        fixture,
        'lighting',
        'Practical lighting (no dark room)',
        'sev-2',
        `frame budget: deck ${row.deckIndex} ("${row.deckId}") carries ${row.lights} ` +
          `fixtures over the ${LIGHTS_PER_DECK_MAX} the rig mounts at once`,
        `deck ${row.deckIndex} ("${row.deckId}")`,
        row.deckIndex,
        row.deckId,
      ),
    ),
  ]

  return {
    id: 'lighting',
    label: 'Practical lighting (no dark room)',
    source: 'PRD §8 [review] 3 (machine half) / M4-T2 rig',
    status: defects.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      `${coverage.length === 0 ? 'no dark room' : `${coverage.length} unlit finding(s)`}, ` +
      `${report.activeMax} of ${LIGHTS_ACTIVE_MAX} fixtures on the worst deck`,
    defects,
  }
}

/** §8 [review] 3 (machine half) — the calibrated post pass. */
function atmosphereCheck(fixture: ShipFixture, ship: ShipAssembly): ReviewCheck {
  const name = ship.spec.name
  const problems = postProblems(ship)
  const plan = postPlanOf(ship)
  return {
    id: 'atmosphere',
    label: 'Post processing within budget',
    source: 'PRD §8 [review] 3 (machine half) / M4-T3 post plan',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail: plan.detail,
    defects: problems.map((problem) =>
      makeDefect(
        name,
        fixture,
        'atmosphere',
        'Post processing within budget',
        'sev-2',
        problem,
        'post-processing (ship-wide)',
      ),
    ),
  }
}

/** §8 [review] 4 — deck signs, ladder marks and hatch affordances. */
function wayfindingCheck(
  fixture: ShipFixture,
  ship: ShipAssembly,
  world: NavigationWorld,
): ReviewCheck {
  const name = ship.spec.name
  const problems = wayfindingProblems(ship, world)
  const decks = wayfindingDecksOf(ship)
  return {
    id: 'wayfinding',
    label: 'Deck-order legibility',
    source: 'PRD §8 [review] 4 / M5-T1 wayfinding gate',
    status: problems.length > 0 ? 'fail' : 'pass',
    human: false,
    detail:
      `${decks.length} deck sign(s), ${world.hatches.length} hatch affordance(s), ` +
      `${world.runs.length} ladder mark(s) — ` +
      `${problems.length === 0 ? 'legible' : `${problems.length} problem(s)`}`,
    defects: problems.map((problem) =>
      makeDefect(
        name,
        fixture,
        'wayfinding',
        'Deck-order legibility',
        'sev-2',
        problem,
        'wayfinding (ship-wide)',
      ),
    ),
  }
}

/**
 * Run the full Review Loop checklist on one canonical ship. `requireValidSpec`
 * is false so the NEGATIVE control (which the validator must reject) still
 * reports its own checklist findings instead of throwing — the validator's
 * verdict is this loop's `spec-valid` row, not a crash.
 */
export function reviewShip(fixture: ShipFixture): ShipReview {
  const ship = assembleShip(fixture.spec, { requireValidSpec: false })
  const world = navigationWorldOf(ship)
  const name = ship.spec.name

  const checks: ReviewCheck[] = [
    specValidCheck(fixture, name),
    autoInvariantCheck(fixture, name),
    assemblyCheck(fixture, ship),
    walkCheck(fixture, ship, world),
    landmarksCheck(fixture, ship, world),
    lightingCheck(fixture, ship),
    atmosphereCheck(fixture, ship),
    wayfindingCheck(fixture, ship, world),
  ]
  const defects = checks.flatMap((check) => check.defects)
  const sev1 = defects.filter((defect) => defect.severity === 'sev-1').length
  const sev2 = defects.filter((defect) => defect.severity === 'sev-2').length
  const exitRuleMet =
    fixture.expectValid && sev1 <= EXIT_MAX_SEV1 && sev2 <= EXIT_MAX_SEV2
  const controlDetected = !fixture.expectValid && sev1 > 0

  return {
    fixtureId: fixture.id,
    label: fixture.label,
    ship: name,
    expectValid: fixture.expectValid,
    decks: ship.decks.length,
    checks,
    defects,
    sev1,
    sev2,
    exitRuleMet,
    controlDetected,
    humanItems: HUMAN_REVIEW_ITEMS,
    summary:
      `${name} (${fixture.label}) · ${ship.decks.length} decks · ` +
      `${sev1} sev-1 / ${sev2} sev-2 · ` +
      (fixture.expectValid
        ? `exit rule ${exitRuleMet ? 'met' : 'NOT met'}`
        : `negative control ${controlDetected ? 'detected' : 'PASSED (loop blind!)'}`),
  }
}

/** Loop-level rules: shippable ships must pass; the control must fail. */
export function loopProblems(ships: readonly ShipReview[]): string[] {
  const problems: string[] = []
  for (const ship of ships) {
    if (ship.expectValid) {
      if (!ship.exitRuleMet) {
        problems.push(
          `"${ship.ship}" (${ship.label}) fails the PRD §14 exit rule: ` +
            `${ship.sev1} sev-1 (max ${EXIT_MAX_SEV1}) / ${ship.sev2} sev-2 (max ${EXIT_MAX_SEV2})`,
        )
      }
    } else if (!ship.controlDetected) {
      problems.push(
        `the negative control "${ship.ship}" (${ship.label}) passed the review loop ` +
          `with zero sev-1 — the loop did not detect its seeded defects`,
      )
    }
  }
  return problems
}

/**
 * Run the full PRD §14 Review Loop over the canonical fixtures (default: all
 * four, in registry order) and return the structured log. `ok` is the loop's
 * own verdict: every shippable ship meets the exit rule AND the negative
 * control was rejected.
 */
export function reviewLoop(
  fixtures: readonly ShipFixture[] = SHIP_FIXTURES,
): ReviewLoopReport {
  const ships = fixtures.map(reviewShip)
  const problems = loopProblems(ships)
  return {
    ships,
    passed: ships.filter((ship) => ship.expectValid && ship.exitRuleMet).length,
    failed: ships.filter((ship) => ship.expectValid && !ship.exitRuleMet).length,
    problems,
    ok: problems.length === 0,
  }
}

/** Defects of a ship, worst severity first, deck order stable within a severity. */
export function sortedDefects(review: ShipReview): ReviewDefect[] {
  return [...review.defects].sort(
    (a, b) =>
      REVIEW_SEVERITIES.indexOf(a.severity) - REVIEW_SEVERITIES.indexOf(b.severity) ||
      (a.deck ?? -1) - (b.deck ?? -1),
  )
}

/** The exit-rule arithmetic as a short phrase, e.g. "0 sev-1 / 0 sev-2". */
export function exitRuleLine(review: ShipReview): string {
  return `${review.sev1} sev-1 / ${review.sev2} sev-2`
}
