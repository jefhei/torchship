/**
 * M0-T6 — the [auto] invariant harness: run the PRD §8 checks over the
 * canonical fixtures.
 *
 * BUILD_PLAN M0-T6: "Stub [auto] invariant checks (PRD §8) as runnable
 * tests against the fixtures." This harness is what runs:
 *
 *   runInvariantHarness(fixture) → six InvariantRuns (one per §8 bullet,
 *   in registry order) for ONE canonical ship. A run is:
 *     - 'pass'/'fail' — a LIVE check (registry status 'live', function in
 *       LIVE_CHECKS) computed a real spec-level verdict, or
 *     - 'deferred'   — a STUB invariant (declared target): the M0 fixture
 *       data does not yet carry what the real check needs (assembled
 *       geometry, kit door sockets, collision hulls, light sockets). The
 *       detail names the owning milestone and the required input; that
 *       milestone replaces the stub with a real check and the run flips
 *       from 'deferred' to a verdict.
 *
 * The harness never throws on a canonical fixture — every run carries a
 * detail string, so later milestones (M1-T3 validator, M3 assembler, M2-T7
 * kit harness) can wire real checks in without reshaping the harness.
 */

import { AUTO_INVARIANTS, getAutoInvariant } from './registry'
import type { AutoInvariant, InvariantId, LimitSpec, RunStatus } from './registry'
import { LIVE_CHECKS } from './checks'
import { SHIP_FIXTURES, getShipFixture } from '../fixtures'
import type { FixtureId, ShipFixture } from '../fixtures'

/** Result of running one invariant over one fixture. */
export interface InvariantRun {
  fixtureId: FixtureId
  invariantId: InvariantId
  status: RunStatus
  /** Verdict detail, or the deferred reason naming the owning milestone. */
  detail: string
}

/** Render a limit as a compact cap phrase, e.g. "gap < 2 mm". */
function limitPhrase(limit: LimitSpec): string {
  const rel =
    limit.relation === '<' ? '<' : limit.relation === '<=' ? '\u2264' : '\u2265'
  return `${rel} ${limit.value} ${limit.unit}`
}

/** Deferred detail for a stub: who wires it and what input it needs. */
function deferredDetail(inv: AutoInvariant): string {
  const cap = inv.limit ? `; cap ${limitPhrase(inv.limit)}` : ''
  return (
    `deferred — declared target at M0-T6: ${inv.owner} wires the real check ` +
    `once it supplies ${inv.needs ?? 'its required input'}${cap}`
  )
}

/**
 * Run one invariant over one fixture. Stubs (no live check registered)
 * report 'deferred'; live checks report their computed verdict verbatim.
 */
export function runInvariant(inv: AutoInvariant, fixture: ShipFixture): InvariantRun {
  const check = LIVE_CHECKS[inv.id]
  if (!check) {
    return {
      fixtureId: fixture.id,
      invariantId: inv.id,
      status: 'deferred',
      detail: deferredDetail(inv),
    }
  }
  const verdict = check(fixture.spec)
  return {
    fixtureId: fixture.id,
    invariantId: inv.id,
    status: verdict.status,
    detail: verdict.detail,
  }
}

/** Run an invariant over a fixture by ids (throws on unknown ids). */
export function runInvariantById(
  invariantId: InvariantId,
  fixtureId: FixtureId,
): InvariantRun {
  return runInvariant(getAutoInvariant(invariantId), getShipFixture(fixtureId))
}

/** Run all six invariants over one fixture, in §8 order. */
export function runInvariantHarness(fixture: ShipFixture): InvariantRun[] {
  return AUTO_INVARIANTS.map((inv) => runInvariant(inv, fixture))
}

/** Run the full harness: all six invariants × all four canonical fixtures. */
export function runInvariantHarnessAll(): InvariantRun[] {
  return SHIP_FIXTURES.flatMap((f) => runInvariantHarness(f))
}

/** Runs of one invariant across every fixture (column view for reports). */
export function runsForInvariant(invariantId: InvariantId): InvariantRun[] {
  const inv = getAutoInvariant(invariantId)
  return SHIP_FIXTURES.map((f) => runInvariant(inv, f))
}
