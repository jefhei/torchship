/**
 * M5-T3 — the Review Loop's QA.md artifact (PRD §14 step 5: "Record the final
 * log in `QA.md`").
 *
 * The loop pass is structured data (`src/review/loop.ts`); this module renders
 * it as the checked-in log and keeps the file honest. It is a pure function
 * plus a write — the golden test (`loop.test.ts`) regenerates the file whenever
 * the ships change, so a stale log cannot pass and the diff shows up in
 * `git status` exactly like the M1-T3 preset files.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReviewDefect, ReviewLoopReport, ShipReview } from './loop'
import { EXIT_MAX_SEV1, EXIT_MAX_SEV2, HUMAN_REVIEW_ITEMS } from './loop'

/** Absolute path of the checked-in log (repo root, `QA.md`). */
export const QA_PATH = resolve(process.cwd(), 'QA.md')

/** Collapse a value into one safe markdown table cell. */
function cell(text: string): string {
  return text
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/** The checklist verdict as a table glyph + word. */
function checkVerdict(status: ShipReview['checks'][number]['status']): string {
  if (status === 'pass') return '✅ pass'
  if (status === 'fail') return '❌ fail'
  return '👁 human'
}

/** The exit-rule cell for a ship in the summary table. */
function exitCell(ship: ShipReview): string {
  if (ship.expectValid) {
    return ship.exitRuleMet
      ? '✅ met'
      : `❌ not met (${ship.sev1} sev-1 / ${ship.sev2} sev-2)`
  }
  return ship.controlDetected
    ? `✅ control detected (${ship.sev1} sev-1)`
    : '❗ control PASSED — the loop is blind'
}

/** A ship's verdict headline. */
function verdictLine(ship: ShipReview): string {
  if (ship.expectValid) {
    const mark = ship.exitRuleMet ? '✅' : '❌'
    return (
      `${mark} **exit rule ${ship.exitRuleMet ? 'met' : 'NOT met'}** — ` +
      `${ship.sev1} sev-1 / ${ship.sev2} sev-2 ` +
      `(zero sev-1, ≤ ${EXIT_MAX_SEV2} sev-2; cap sev-1 ${EXIT_MAX_SEV1}).`
    )
  }
  return (
    `**negative control** — ${ship.sev1} sev-1 / ${ship.sev2} sev-2. ` +
    `This rig is not a shippable ship: it must fail, and ` +
    `${ship.controlDetected ? 'the loop detected its seeded defects ✅' : 'the loop found nothing ❌ — it is blind'}.`
  )
}

/** The checklist table for one ship. */
function checkTable(ship: ShipReview): string {
  const rows = ship.checks.map(
    (check) =>
      `| ${cell(check.label)} | ${cell(check.source)} | ${checkVerdict(check.status)} | ${cell(check.detail)} |`,
  )
  return [
    '| Checklist item | Source | Verdict | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/** The defect table (or an explicit "none"). */
function defectTable(defects: readonly ReviewDefect[]): string {
  if (defects.length === 0) {
    return '_No defects._'
  }
  const rows = defects.map(
    (defect) =>
      `| ${defect.severity} | ${defect.deck === null ? '—' : defect.deck} | ` +
      `${cell(defect.location)} | ${cell(defect.check)} | ${cell(defect.detail)} | ` +
      `${cell(defect.repro)} |`,
  )
  return [
    '| Sev | Deck | Location | Check | Detail | Repro |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

/**
 * Render the whole Review Loop pass as the checked-in QA.md log. Deterministic:
 * no timestamps, so the golden test can compare byte-for-byte.
 */
export function qaMarkdown(report: ReviewLoopReport): string {
  const shippable = report.ships.filter((ship) => ship.expectValid)
  const control = report.ships.filter((ship) => !ship.expectValid)

  const summaryRows = report.ships.map(
    (ship) =>
      `| ${cell(ship.label)} | ${cell(ship.ship)} | ${ship.decks} | ${ship.sev1} | ` +
      `${ship.sev2} | ${exitCell(ship)} |`,
  )

  const sections = report.ships.map((ship) => {
    const heading = `## ${cell(ship.label)} — "${cell(ship.ship)}" (fixture \`${ship.fixtureId}\`)`
    const defects =
      ship.defects.length > 0 ? defectTable(ship.defects) : defectTable([])
    return [
      heading,
      '',
      verdictLine(ship),
      '',
      checkTable(ship),
      '',
      '### Defects',
      '',
      defects,
    ].join('\n')
  })

  return [
    '# QA — Torchship Review Loop Log',
    '',
    '> **Generated artifact — do not hand-edit.** Produced by the M5-T3 Review Loop',
    '> (`src/review/loop.ts`, PRD §14). Regenerate with `npm run qa:review`; the loop’s',
    '> golden test keeps this file in sync, so drift shows up in `git status`.',
    '>',
    '> Test scenes are the three M0 canonical ships + the stress spec (PRD §14) — never',
    '> an ad-hoc scene. Exit rule (PRD §14): **zero sev-1; ≤ ' +
      `${EXIT_MAX_SEV2} sev-2** per shippable ship. The stress rig is the negative`,
    '> control: it must FAIL — a rig the loop signs off would mean the loop is not looking.',
    '',
    `## Loop verdict — ${report.ok ? 'PASS' : 'FAIL'}`,
    '',
    `${shippable.filter((ship) => ship.exitRuleMet).length}/${shippable.length} shippable ship(s) ` +
      `meet the exit rule; ${control.length} negative control(s) ` +
      `${control.every((ship) => ship.controlDetected) ? 'rejected' : 'NOT rejected'}.`,
    '',
    ...(report.problems.length > 0
      ? ['**Loop problems:**', '', ...report.problems.map((line) => `- ${line}`), '']
      : []),
    '| Preset | Ship | Decks | sev-1 | sev-2 | Verdict |',
    '| --- | --- | --- | --- | --- | --- |',
    ...summaryRows,
    '',
    ...sections.flatMap((section) => [section, '', '---', '']),
    '## Human sign-off (open)',
    '',
    'The `[review]` items only a human can sign. Their machine half (lighting,',
    'wayfinding, the scripted walk, the landmark list) is measured above; these',
    'remain open until an interactive session walks the ship in a browser.',
    '',
    ...HUMAN_REVIEW_ITEMS.map((item) => `- ${item}`),
    '',
  ].join('\n')
}

/**
 * Write QA.md from a report. Returns whether the file changed — the golden test
 * calls this so the log is regenerated on drift instead of failing on formatting.
 */
export function writeQaLog(report: ReviewLoopReport): {
  changed: boolean
  path: string
} {
  const content = qaMarkdown(report)
  const existing = existsSync(QA_PATH) ? readFileSync(QA_PATH, 'utf8') : undefined
  if (existing === content) {
    return { changed: false, path: QA_PATH }
  }
  writeFileSync(QA_PATH, content, 'utf8')
  return { changed: true, path: QA_PATH }
}

/** The checked-in log text, or undefined when the file is absent. */
export function readQaLog(): string | undefined {
  return existsSync(QA_PATH) ? readFileSync(QA_PATH, 'utf8') : undefined
}
