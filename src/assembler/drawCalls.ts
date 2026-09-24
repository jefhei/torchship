/**
 * M3-T7 — the draw-call pass (BUILD_PLAN M3-T7 "draw-call pass: geometry
 * merging + instancing to ≤ 250 calls on Patrol"; PRD §10/§11 "≤ 250 draw
 * calls after merging deck geometry + instancing lockers/panels/conduit").
 *
 * The assembler already emits the two halves of one partition
 * (`DeckAssembly.groups` = merged per-slot geometry, `DeckAssembly.batches` =
 * instanced moulds — batches.ts). This module is the measurement: it states
 * how many draw calls the renderer issues for an assembly and gates the
 * preset against the ceiling.
 *
 * WHY `groups + batches` IS THE DRAW-CALL COUNT — the renderer's own contract
 * (src/player/deckGeometry.ts, built on the src/kit/render merge/instance
 * layer, mounted by ShipInterior in src/player/WalkthroughScene.tsx):
 *
 *  - ONE merged `GeometryGroup` → ONE `BufferGeometry` → ONE mesh → one call;
 *  - ONE `InstanceBatch` → ONE mould `BufferGeometry` + ONE `InstancedMesh`
 *    (`batch.placements.length` transforms) → one call.
 *
 * So the partition IS the draw-call plan: there is no second opinion about how
 * many calls a deck costs, and the renderer cannot quietly draw per-part again
 * (that was the pre-M3-T7 state: one mesh per part, 736 calls on Patrol). The
 * per-fixture sweep in src/player/deckGeometry.test.ts pins the identity
 * `deckDrawPlan(deck).length === deckDrawCalls(deck)` on every deck of every
 * canonical ship, so a future renderer change that adds or drops a call fails
 * the suite rather than silently blowing the frame budget.
 *
 * Measured (2026-09-24, default options — the numbers pinned in
 * drawCalls.test.ts):
 *
 * | ship | decks | placed parts | merged / instanced parts | groups | batches | calls |
 * |------|-------|--------------|--------------------------|--------|---------|-------|
 * | Firebrand (patrol) | 5 | 736 | 107 / 629 | 29 | 150 | **179** |
 * | Vagabond (long-haul) | 6 | 932 | 121 / 811 | 34 | 179 | **213** |
 * | Surveyor (science) | 5 | 676 | 119 / 557 | 30 | 151 | **181** |
 * | Offspec (QA rig) | 5 | 749 | 123 / 626 | 29 | 165 | **194** |
 *
 * All four fixtures are under the 250-call ceiling; Patrol carries 71 calls of
 * headroom for M4's clutter pass, the deepest deck (aft, 196 parts) costs 34
 * and the most expensive deck on any ship is the crew deck's 38. The
 * `minInstances` threshold is the only knob that trades calls for instancing
 * (measured on Patrol: 1 → 257 calls, 2 → 179, 3 → 109, 4 → 95, 6 → 70,
 * 8 → 56, 12 → 40, 20 → 37): raising it merges more shapes into the slot
 * groups (fewer calls, more merged vertices), lowering it to 1 gives every
 * distinct mould its own batch (no merging at all — 257 calls, over the
 * ceiling, which is why the default stays 2: the vertex-memory win exactly
 * where a mould repeats).
 */

import { placedPartsOf } from './assemble'
import type { DeckAssembly, ShipAssembly } from './types'

/** PRD §10/§11 after merging + instancing: the preset's draw-call ceiling. */
export const DRAW_CALL_CEILING = 250

/** One deck's draw calls, part by part — the report row. */
export interface DrawCallRow {
  deckIndex: number
  deckId: string
  /** Human deck label from the spec. */
  label: string
  /** Placed parts the deck draws (module instances + generated seam parts). */
  parts: number
  /** Parts merged into the deck's slot groups. */
  mergedParts: number
  /** Parts drawn by the deck's instanced batches. */
  instancedParts: number
  /** Merged per-slot geometry groups — one draw call each. */
  groups: number
  /** Instanced kit-piece batches — one draw call each. */
  batches: number
  /** `groups + batches`: the deck's draw calls. */
  calls: number
}

/** A ship's draw-call report: the rows, the total, and the budget arithmetic. */
export interface DrawCallTally {
  ship: string
  rows: DrawCallRow[]
  total: number
  ceiling: number
  /** `ceiling − total`; negative means over budget. */
  headroom: number
  /** The deck with the most draw calls (undefined only for a shipless assembly). */
  worstDeck: DrawCallRow | undefined
}

/**
 * The draw calls one deck costs: one per merged slot group, one per instanced
 * batch. Reads the partition the assembler emitted — nothing is re-derived
 * (the renderer draws exactly these two lists, see the header).
 */
export function deckDrawCalls(deck: Pick<DeckAssembly, 'groups' | 'batches'>): number {
  return deck.groups.length + deck.batches.length
}

/** One row per deck, deck order (nose → aft) — the report surface. */
export function drawCallRows(ship: ShipAssembly): DrawCallRow[] {
  return ship.decks.map((deck) => {
    const mergedParts = deck.groups.reduce((sum, plan) => sum + plan.parts.length, 0)
    const instancedParts = deck.batches.reduce(
      (sum, plan) => sum + plan.parts.length,
      0,
    )
    return {
      deckIndex: deck.deckIndex,
      deckId: deck.deckId,
      label: deck.label,
      parts: placedPartsOf(deck).length,
      mergedParts,
      instancedParts,
      groups: deck.groups.length,
      batches: deck.batches.length,
      calls: deckDrawCalls(deck),
    }
  })
}

/**
 * The whole ship's draw-call tally against a ceiling (default the PRD §10
 * preset ceiling). `headroom` is the budget left, `worstDeck` the row to look
 * at first when it runs out.
 */
export function drawCallTally(
  ship: ShipAssembly,
  ceiling: number = DRAW_CALL_CEILING,
): DrawCallTally {
  const rows = drawCallRows(ship)
  const total = rows.reduce((sum, row) => sum + row.calls, 0)
  let worstDeck: DrawCallRow | undefined
  for (const row of rows) {
    if (worstDeck === undefined || row.calls > worstDeck.calls) worstDeck = row
  }
  return {
    ship: ship.spec.name,
    rows,
    total,
    ceiling,
    headroom: ceiling - total,
    worstDeck,
  }
}

/**
 * Draw-call problems, in report order (the M3 machine gate's "draw calls under
 * ceiling" half; `assemblyProblems` rule 12 calls this):
 *
 *  1. the ship is over the ceiling — PRD §10's budget line, measured after
 *     merging + instancing;
 *  2. one deck alone is over the ceiling — a single deck that cannot fit the
 *     whole preset's budget is a partition regression (every canonical deck
 *     measures 34–51 calls), and naming it is what makes the finding fixable.
 */
export function drawCallProblems(
  ship: ShipAssembly,
  ceiling: number = DRAW_CALL_CEILING,
): string[] {
  const problems: string[] = []
  const tally = drawCallTally(ship, ceiling)

  if (tally.total > ceiling) {
    const worst =
      tally.worstDeck === undefined
        ? ''
        : ` (worst deck ${tally.worstDeck.deckIndex} "${tally.worstDeck.deckId}" at ${tally.worstDeck.calls})`
    problems.push(
      `ship "${ship.spec.name}" draws ${tally.total} draw call(s) — over the ${ceiling}-call ` +
        `ceiling (§10, after merging + instancing)${worst}`,
    )
  }

  for (const row of tally.rows) {
    if (row.calls > ceiling) {
      problems.push(
        `deck ${row.deckIndex} ("${row.deckId}") draws ${row.calls} draw call(s) — ` +
          `over the ${ceiling}-call ceiling on its own`,
      )
    }
  }

  return problems
}
