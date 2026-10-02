import { describe, expect, it } from 'vitest'
import type { ReviewCheck, ReviewDefect, ReviewLoopReport, ShipReview } from './loop'
import { HUMAN_REVIEW_ITEMS, reviewLoop } from './loop'
import { qaMarkdown } from './qa'

const report = reviewLoop()

/** A minimal shippable ship review carrying one defect. */
function shipWith(defect: ReviewDefect): ShipReview {
  const check: ReviewCheck = {
    id: 'assembly',
    label: 'Assembled-ship integrity',
    source: 'PRD §7',
    status: 'fail',
    human: false,
    detail: 'one problem',
    defects: [defect],
  }
  return {
    fixtureId: 'patrol',
    label: 'Patrol',
    ship: defect.ship,
    expectValid: true,
    decks: 5,
    checks: [check],
    defects: [defect],
    sev1: defect.severity === 'sev-1' ? 1 : 0,
    sev2: defect.severity === 'sev-2' ? 1 : 0,
    exitRuleMet: false,
    controlDetected: false,
    humanItems: HUMAN_REVIEW_ITEMS,
    summary: 'a ship',
  }
}

const DEFECT: ReviewDefect = {
  severity: 'sev-1',
  ship: 'Firebrand',
  deck: 2,
  deckName: 'ops',
  location: 'deck 2 ("ops")',
  check: 'assembly',
  checkLabel: 'Assembled-ship integrity',
  detail: 'a pipe | inside the detail',
  repro: 'npm run qa:review — check "assembly" on fixture "patrol"',
}

describe('M5-T3 QA.md renderer', () => {
  it('renders the loop verdict, the ship sections and the human sign-off', () => {
    const log = qaMarkdown(report)
    expect(log).toContain('# QA — Torchship Review Loop Log')
    expect(log).toContain('## Loop verdict — PASS')
    expect(log).toContain('shippable ship(s)')
    expect(log).toContain('| Preset | Ship | Decks | sev-1 | sev-2 | Verdict |')
    for (const ship of report.ships) {
      expect(log).toContain(`## ${ship.label} — "${ship.ship}"`)
      expect(log).toContain('| Checklist item | Source | Verdict | Detail |')
    }
    expect(log).toContain('## Human sign-off (open)')
    for (const item of HUMAN_REVIEW_ITEMS) {
      expect(log).toContain(item)
    }
  })

  it('is deterministic', () => {
    expect(qaMarkdown(report)).toBe(qaMarkdown(report))
  })

  it('escapes pipes so a defect cannot break the markdown table', () => {
    const log = qaMarkdown({
      ships: [shipWith(DEFECT)],
      passed: 0,
      failed: 1,
      problems: ['"Firebrand" fails the exit rule'],
      ok: false,
    } satisfies ReviewLoopReport)
    expect(log).toContain('a pipe \\| inside the detail')
    expect(log).toContain('## Loop verdict — FAIL')
    expect(log).toContain('**Loop problems:**')
    expect(log).toContain('- "Firebrand" fails the exit rule')
  })

  it('marks an undetected negative control loudly', () => {
    const control = report.ships.find((ship) => !ship.expectValid)!
    const log = qaMarkdown({
      ships: [{ ...control, sev1: 0, sev2: 0, controlDetected: false }],
      passed: 0,
      failed: 0,
      problems: [],
      ok: false,
    } satisfies ReviewLoopReport)
    expect(log).toContain('the loop is blind')
  })
})
