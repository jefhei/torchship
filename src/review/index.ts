/**
 * M5-T2 — review barrel: the public surface of src/review/.
 *
 * The M5-T3 Review Loop imports from here, never from deep paths — the same
 * convention as src/wayfinding/, src/player/ and src/assembler/:
 *
 *  - `coffeeRunScript` / `planCoffeeRun` — the canonical review walk, DERIVED
 *    from the ship (the M3-T6 spawn → the galley's own coffee station → back);
 *  - `recordWalk` / `walkSummary` — replay a `WalkScript` through the M3-T5
 *    navigation machine and keep the whole deterministic trace;
 *  - `walkProblems` / `coffeeRunProblems` — the gate over a recording;
 *  - `recordCoffeeRun` — plan + record in one call, for the loop.
 *
 * `route.ts` is the planner behind the recorder (a walkable grid off the M3-T3
 * hull + a BFS route); it is exported so a future script can route to any
 * landmark the same way.
 *
 * Pure and three-agnostic — the recorder drives the navigation machine exactly
 * as `src/player/nav.test.ts` does, so a walk is checkable in CI.
 */

export * from './types'
export * from './route'
export * from './path'
export * from './record'
export * from './checks'
export * from './landmarks'
export * from './loop'
export * from './fixLoop'
export * from './qa'
