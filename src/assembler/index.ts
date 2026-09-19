/**
 * M3-T1 — assembler barrel: the public surface of src/assembler/.
 *
 * Milestones import the assembler from here (e.g. `import { assembleShip } from
 * '../assembler'`), never from deep paths — same convention as src/kit/ and
 * src/validation/. `./types` is type-only (`export type *`); the rest carries
 * the entry points, the placement transforms, the instancing partition, the
 * spine-run generator, the socket scan and the consistency gate.
 *
 * Consumers, by milestone:
 *  - M3-T2 seam/hatch enforcement: `joins` + `blanks` per deck (mating and
 *    sealing geometry is generated FROM those sockets);
 *  - M3-T3 collision: `DeckNode.collision` (the modules' own hints, placed) and
 *    `assemblyProblems` as the first consistency view;
 *  - M3-T5 navigation: `interactives` (doors + hatches) and `spineRun`;
 *  - M3-T7 draw calls: `DeckAssembly.parts` (the world part list with
 *    provenance) + `partitionParts` with a higher `minInstances`;
 *  - M4/M6: `graph` (the M1-T2 SceneGraph the renderer and the glTF export
 *    both walk).
 */

export type * from './types'
export * from './batches'
export * from './place'
export * from './spineRun'
export * from './joins'
export * from './seams'
export * from './assemble'
export * from './checks'
