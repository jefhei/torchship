/**
 * M5-T1 — wayfinding barrel: the public surface of src/wayfinding/.
 *
 * The UI (Viewport.tsx) imports from here, never from deep paths — the same
 * convention as src/kit/, src/player/ and src/assembler/:
 *
 *  - `wayfindingDecksOf` / `deckNameOf` — the deck model every sign reads;
 *  - `deckIndicatorOf` / `DeckIndicator` / `INDICATOR_TOGGLE_KEY` — the optional
 *    deck stack (bow at the top, ladder marks from M3-T5's run list);
 *  - `deckMomentFor` / `MOMENT_HOLD_MS` / `DeckMoment` — the per-deck label
 *    moment raised on a transition;
 *  - `hatchAffordance` / `HatchAffordance` — what the interact key will do to
 *    the hatch in reach;
 *  - `wayfindingProblems` — the gate: every canonical ship can be signed;
 *  - `WayfindingOverlay` — the DOM overlay that mounts all three.
 */

export * from './decks'
export * from './indicator'
export * from './moments'
export * from './affordances'
export * from './checks'
export * from './WayfindingOverlay'
