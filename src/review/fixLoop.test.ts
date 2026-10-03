import { describe, expect, it } from 'vitest'
import {
  PATROL_SPEC,
  SHIP_FIXTURES,
  atSpine,
  spineAttachOffsetZ,
  type ShipFixture,
} from '../fixtures'
import { deckFloorYFor, type ModuleRef, type ShipSpec } from '../types'
import type { AssembleOptions } from '../assembler'
import type { ReviewCheckId, ReviewDefect, ReviewSeverity, ShipReview } from './loop'
import {
  FIXERS,
  drawCallLadderFixer,
  fixLoopOk,
  fixLoopProblems,
  reseatSpec,
  runFixLoop,
  runFixLoops,
  wearDensityRungFixer,
  spineReseatFixer,
  type FixContext,
} from './fixLoop'
import { fixLoopMarkdown } from './qa'

const PATROL_FIXTURE = SHIP_FIXTURES[0]
const reports = runFixLoops(SHIP_FIXTURES)

/** The crew galley pushed 25 mm off the spine face — an M0-T2 seat defect. */
function driftSpec(): ShipSpec {
  return {
    ...PATROL_SPEC,
    decks: PATROL_SPEC.decks.map((deck) =>
      deck.yPosition === deckFloorYFor(1)
        ? {
            ...deck,
            modules: [
              {
                ...atSpine('galley'),
                offset: [0, 0, spineAttachOffsetZ('galley') + 0.025],
              },
            ] satisfies ModuleRef[],
          }
        : deck,
    ),
  }
}

const DRIFTED: ShipFixture = {
  id: 'patrol',
  label: 'Drifted spec',
  description: 'synthetic injection — the crew galley sits 25 mm proud of the spine',
  expectValid: true,
  spec: driftSpec(),
}

const STUCK: ShipFixture = {
  id: 'patrol',
  label: 'Stuck variant',
  description: 'synthetic injection — spec-valid fails for a reason no fixer repairs',
  expectValid: true,
  spec: { ...PATROL_SPEC, name: '' },
}

/* ------------------------------------------------------- unit-test scaffolding */

function defect(
  check: ReviewCheckId,
  detail: string,
  severity: ReviewSeverity = 'sev-1',
): ReviewDefect {
  return {
    severity,
    ship: 'Firebrand',
    deck: null,
    deckName: null,
    location: 'ship-wide',
    check,
    checkLabel: check,
    detail,
    repro: 'test',
  }
}

function reviewOf(defects: ReviewDefect[]): ShipReview {
  const sev1 = defects.filter((d) => d.severity === 'sev-1').length
  const sev2 = defects.filter((d) => d.severity === 'sev-2').length
  return {
    fixtureId: 'patrol',
    label: 'Patrol',
    ship: 'Firebrand',
    expectValid: true,
    decks: 5,
    checks: [],
    defects,
    sev1,
    sev2,
    exitRuleMet: sev1 === 0 && sev2 <= 5,
    controlDetected: false,
    humanItems: [],
    summary: 'test',
  }
}

function baseCtx(options: AssembleOptions, defects: ReviewDefect[]): FixContext {
  return {
    fixture: PATROL_FIXTURE,
    options,
    review: reviewOf(defects),
    defects,
    iteration: 0,
  }
}

describe('M5-T4 fix loop — the canonical ships', () => {
  it('converges every shippable ship at pass 0 with zero fixes applied', () => {
    const shippable = reports.filter((report) => report.expectValid)
    expect(shippable).toHaveLength(3)
    for (const report of shippable) {
      expect(report.converged).toBe(true)
      expect(report.ok).toBe(true)
      expect(report.iterations).toBe(0)
      expect(report.fixesApplied).toEqual([])
      expect(report.passes).toHaveLength(1)
      expect(report.remainingSev1).toBe(0)
      expect(report.remainingSev2).toBe(0)
      expect(report.problems).toEqual([])
      expect(report.summary).toMatch(/exit rule met at pass 0/)
    }
  })

  it('skips the negative control — a rig that must fail is never repaired', () => {
    const control = reports.find((report) => !report.expectValid)!
    expect(control.fixtureId).toBe('stress')
    expect(control.negativeControl).toBe(true)
    expect(control.converged).toBe(false)
    expect(control.passes).toEqual([])
    expect(control.fixesApplied).toEqual([])
    expect(control.ok).toBe(true)
    expect(control.problems).toEqual([])
    expect(control.summary).toMatch(/negative control — skipped/)
  })

  it('reports no loop-level problems and is deterministic', () => {
    expect(fixLoopProblems(reports)).toEqual([])
    expect(fixLoopOk(reports)).toBe(true)
    expect(runFixLoops(SHIP_FIXTURES)).toEqual(reports)
  })

  it('registers the three §10 fixers in a fixed order', () => {
    expect(FIXERS.map((fixer) => fixer.id)).toEqual([
      'spine-reseat',
      'draw-call-ladder',
      'wear-density-rung',
    ])
  })
})

describe('M5-T4 fix loop — repairs a real defect', () => {
  it('repairs a drifted spec with the spine-reseat fixer', () => {
    const drift = runFixLoop(DRIFTED)
    expect(drift.converged).toBe(true)
    expect(drift.fixesApplied).toEqual(['spine-reseat'])
    expect(drift.iterations).toBe(1)
    expect(drift.passes).toHaveLength(2)
    expect(drift.passes[0].sev1).toBeGreaterThan(0)
    expect(drift.passes[1].sev1).toBe(0)
    expect(drift.passes[1].fixerId).toBe('spine-reseat')
    expect(drift.problems).toEqual([])
  })

  it('re-seats to the canonical pose and declines when already canonical', () => {
    const fixed = reseatSpec(driftSpec())
    expect(fixed).not.toBeNull()
    expect(fixed!.decks.map((deck) => deck.modules)).toEqual(
      PATROL_SPEC.decks.map((deck) => deck.modules),
    )
    expect(reseatSpec(PATROL_SPEC)).toBeNull()
  })

  it('climbs the instancing rung to clear a draw-call overflow', () => {
    const heavy = runFixLoop(PATROL_FIXTURE, { options: { minInstances: 1 } })
    expect(heavy.passes[0].sev1 + heavy.passes[0].sev2).toBeGreaterThan(0)
    expect(heavy.fixesApplied).toContain('draw-call-ladder')
    expect(heavy.converged).toBe(true)
    expect(heavy.remainingSev1).toBe(0)
    expect(heavy.remainingSev2).toBe(0)
  })

  it('stops honestly when no fixer can repair the ship', () => {
    const stuck = runFixLoop(STUCK)
    expect(stuck.converged).toBe(false)
    expect(stuck.ok).toBe(false)
    expect(stuck.fixesApplied).toEqual([])
    expect(stuck.remainingSev1).toBeGreaterThan(0)
    expect(stuck.problems).toHaveLength(1)
    expect(stuck.problems[0]).toMatch(/did not reach the PRD §14 exit rule/)
    expect(fixLoopProblems([stuck])).toHaveLength(1)
    expect(fixLoopOk([stuck])).toBe(false)
  })

  it('respects the pass cap', () => {
    const capped = runFixLoop(DRIFTED, { maxPasses: 0 })
    expect(capped.converged).toBe(false)
    expect(capped.passes).toHaveLength(1)
    expect(capped.fixesApplied).toEqual([])
  })
})

describe('M5-T4 fix loop — fixer contracts', () => {
  it('the instancing rung steps up and declines at the top', () => {
    expect(
      drawCallLadderFixer.fix(
        baseCtx({}, [defect('assembly', 'ship draws 300 draw call(s)')]),
      ),
    ).toEqual({ options: { minInstances: 3 }, note: expect.any(String) })
    expect(
      drawCallLadderFixer.fix(
        baseCtx({ minInstances: 20 }, [
          defect('assembly', 'ship draws 300 draw call(s)'),
        ]),
      ),
    ).toBeNull()
    expect(
      drawCallLadderFixer.applies(
        baseCtx({}, [defect('spec-valid', 'ship name is empty')]),
      ),
    ).toBe(false)
  })

  it('the density rung steps down and declines at the bottom', () => {
    const worn = [defect('assembly', 'deck 1 pays 9 draw call(s) for its worn detail')]
    expect(wearDensityRungFixer.fix(baseCtx({}, worn))).toEqual({
      options: { wearDensity: 'reduced' },
      note: expect.any(String),
    })
    expect(wearDensityRungFixer.fix(baseCtx({ wearDensity: 'off' }, worn))).toBeNull()
  })

  it('the spine-reseat fixer declines on an already-canonical spec', () => {
    expect(
      spineReseatFixer.fix(baseCtx({}, [defect('spec-valid', 'ship name is empty')])),
    ).toBeNull()
    expect(spineReseatFixer.applies(baseCtx({}, [defect('spec-valid', 'x')]))).toBe(
      true,
    )
  })
})

describe('M5-T4 fix loop — the QA.md section', () => {
  it('renders the fix-loop section with every ship and the fixer roster', () => {
    const markdown = fixLoopMarkdown(reports)
    expect(markdown).toContain('## Fix loop — M5-T4')
    for (const report of reports) {
      expect(markdown).toContain(`| ${report.label} | ${report.ship} |`)
    }
    expect(markdown).toContain('negative control (skipped)')
    for (const fixer of FIXERS) {
      expect(markdown).toContain(`\`${fixer.id}\``)
    }
    expect(markdown).toContain('✅ converged at pass 0')
  })
})
