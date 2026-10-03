import { describe, expect, it } from 'vitest'
import { PATROL_SPEC, SHIP_FIXTURES, atSpine } from '../fixtures'
import type { ShipFixture } from '../fixtures'
import { deckFloorYFor, type ModuleRef, type ShipSpec } from '../types'
import {
  EXIT_MAX_SEV1,
  EXIT_MAX_SEV2,
  REVIEW_SEVERITIES,
  reviewLoop,
  reviewShip,
  sortedDefects,
} from './loop'
import { qaMarkdown, readQaLog, writeQaLog } from './qa'
import { runFixLoops } from './fixLoop'

const FIXTURE_ORDER = ['patrol', 'long-haul', 'science', 'stress']
const REAL = SHIP_FIXTURES.filter((fixture) => fixture.expectValid)
const report = reviewLoop()
const fixReport = runFixLoops(SHIP_FIXTURES)

/** Replace the crew deck's galley with storage — a ship with no coffee run. */
function noGalleySpec(): ShipSpec {
  return {
    ...PATROL_SPEC,
    name: 'Shiprat',
    decks: PATROL_SPEC.decks.map((deck) =>
      deck.yPosition === deckFloorYFor(1)
        ? { ...deck, modules: [atSpine('storage')] satisfies ModuleRef[] }
        : deck,
    ),
  }
}

const NO_GALLEY: ShipFixture = {
  id: 'patrol',
  label: 'No-galley variant',
  description: 'synthetic injection — the crew deck seats no galley',
  expectValid: true,
  spec: noGalleySpec(),
}

describe('M5-T3 review loop — the four canonical ships', () => {
  it('runs over the four canonical fixtures in registry order', () => {
    expect(report.ships.map((ship) => ship.fixtureId)).toEqual(FIXTURE_ORDER)
    expect(report.ships.map((ship) => ship.ship)).toEqual([
      'Firebrand',
      'Vagabond',
      'Surveyor',
      'Offspec',
    ])
  })

  it('signs off every shippable ship: exit rule met, zero sev-1', () => {
    const shippable = report.ships.filter((ship) => ship.expectValid)
    expect(shippable).toHaveLength(REAL.length)
    for (const ship of shippable) {
      expect(ship.exitRuleMet).toBe(true)
      expect(ship.sev1).toBe(EXIT_MAX_SEV1)
      expect(ship.sev2).toBeLessThanOrEqual(EXIT_MAX_SEV2)
      expect(ship.controlDetected).toBe(false)
      expect(ship.defects).toEqual([])
      expect(ship.checks.every((check) => check.status === 'pass')).toBe(true)
    }
  })

  it('rejects the negative control and names its seeded defects', () => {
    const control = report.ships.find((ship) => !ship.expectValid)!
    expect(control.fixtureId).toBe('stress')
    expect(control.exitRuleMet).toBe(false)
    expect(control.sev1).toBeGreaterThan(0)
    expect(control.controlDetected).toBe(true)
    // The M0-T2 reject cases surface through the loop's own checks.
    const checks = new Set(control.defects.map((defect) => defect.check))
    expect(checks.has('spec-valid')).toBe(true)
    expect(checks.has('auto-invariants')).toBe(true)
    const findings = control.defects.map((defect) => defect.detail).join('\n')
    expect(findings).toMatch(/rig-1/)
    expect(findings).toMatch(/200/)
  })

  it('reports a clean loop verdict', () => {
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.passed).toBe(REAL.length)
    expect(report.failed).toBe(0)
  })

  it('is deterministic — two passes are the same pass', () => {
    expect(reviewLoop()).toEqual(report)
    expect(qaMarkdown(reviewLoop())).toBe(qaMarkdown(report))
  })
})

describe('M5-T3 review loop — defect log shape', () => {
  it('gives every defect the PRD §14 log fields', () => {
    for (const ship of report.ships) {
      for (const defect of ship.defects) {
        expect(REVIEW_SEVERITIES).toContain(defect.severity)
        expect(defect.ship).toBe(ship.ship)
        expect(defect.location.trim().length).toBeGreaterThan(0)
        expect(defect.check.trim().length).toBeGreaterThan(0)
        expect(defect.checkLabel.trim().length).toBeGreaterThan(0)
        expect(defect.detail.trim().length).toBeGreaterThan(0)
        expect(defect.repro).toContain('qa:review')
        expect(defect.repro).toContain(`fixture "${ship.fixtureId}"`)
        if (defect.deck !== null) {
          expect(Number.isInteger(defect.deck)).toBe(true)
          expect(defect.deck).toBeGreaterThanOrEqual(0)
        }
        if (defect.deckName !== null) {
          expect(defect.deckName.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('ranks sev-1 before sev-2 in the sorted log', () => {
    const control = report.ships.find((ship) => !ship.expectValid)!
    const sorted = sortedDefects(control)
    const severities = sorted.map((defect) => defect.severity)
    expect(severities.indexOf('sev-2')).toBeGreaterThan(severities.lastIndexOf('sev-1'))
  })

  it('counts sev-1 / sev-2 consistently with the defect list', () => {
    for (const ship of report.ships) {
      expect(ship.sev1).toBe(
        ship.defects.filter((defect) => defect.severity === 'sev-1').length,
      )
      expect(ship.sev2).toBe(
        ship.defects.filter((defect) => defect.severity === 'sev-2').length,
      )
    }
  })
})

describe('M5-T3 review loop — detection is real, not fixture-shaped', () => {
  it('finds the missing coffee run on a synthetic no-galley ship', () => {
    const review = reviewShip(NO_GALLEY)
    expect(review.expectValid).toBe(true)
    expect(review.exitRuleMet).toBe(false)
    expect(review.sev1).toBeGreaterThan(0)
    const walk = review.checks.find((check) => check.id === 'walk')!
    expect(walk.status).toBe('fail')
    expect(walk.defects[0].detail).toMatch(/coffee run/)
    const landmarks = review.checks.find((check) => check.id === 'landmarks')!
    expect(landmarks.status).toBe('fail')
    expect(
      landmarks.defects.some((defect) => defect.detail.includes('coffee-station')),
    ).toBe(true)
  })

  it('keeps every [auto] invariant live (no deferred runs) on all four ships', () => {
    const autoChecks = report.ships.map((ship) =>
      ship.checks.find((check) => check.id === 'auto-invariants')!,
    )
    for (const check of autoChecks) {
      expect(check.detail).not.toContain('deferred')
    }
  })
})

describe('M5-T3 review loop — QA.md artifact', () => {
  it('keeps the checked-in QA.md in sync with the loop', () => {
    writeQaLog(report, fixReport)
    expect(readQaLog()).toBe(qaMarkdown(report, fixReport))
  })

  it('writes a log with a verdict, every ship, and the open human sign-off', () => {
    const log = qaMarkdown(report)
    expect(log).toContain('# QA — Torchship Review Loop Log')
    expect(log).toContain('## Loop verdict — PASS')
    for (const ship of report.ships) {
      expect(log).toContain(`fixture \`${ship.fixtureId}\``)
    }
    expect(log).toContain('## Human sign-off (open)')
    expect(log).toContain('zero sev-1')
  })
})
