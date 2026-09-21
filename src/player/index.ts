/**
 * M3-T4 — player barrel: the public surface of src/player/.
 *
 * Milestones import the rig from here (`import { stepWalker } from '../player'`),
 * never from deep paths — the same convention as src/kit/, src/validation/ and
 * src/assembler/.
 *
 * Consumers, by milestone:
 *  - M3-T5 ladder/hatch nav: `WalkerState` / `stepWalker` (the climb is a
 *    state-machine layer on top of this frame step) and the deck lookup
 *    (`deckIndexAtY`, `deckLevelAtY`);
 *  - M3-T6 spawn selection: `WalkerWorld` (deck floors + hull) and the §8
 *    spawn-inside check (`bodyBoxAt`, `blockingBoxes`, `supportHeightAt`);
 *  - M4 lighting/atmosphere: the eye position the practical rig is tuned from
 *    (`eyePosition`, `eyeHeightFor`) and the walker's deck;
 *  - M5 scripted review walks: `stepWalker` driven headlessly on a recorded
 *    command sequence — the coffee run is a `WalkerCommand[]` plus the
 *    M0 fixtures.
 */

export * from './move'
export * from './gravity'
export * from './hull'
export * from './collide'
export * from './walker'
export * from './spawn'
export * from './controlsStore'
export * from './WalkRig'
export * from './WalkthroughScene'
