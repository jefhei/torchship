/**
 * M6-T1 — export barrel: the public surface of src/export/.
 *
 * The glTF export contract (PRD §7/§13): `exportGltf` serialises an assembled
 * ship to a glTF 2.0 document, `exportProblems` validates a document against
 * the contract (deck groups `deck-0..N`, named slot materials, meters, thrust
 * axis = −Y), and `buildExportScene` is the three.js scene the renderer-shaped
 * draw plan becomes. M6-T2 adds `blenderValidation` / `auditNormals` — the
 * consumer-shaped checks a Blender import performs (deck groups present,
 * materials intact, no flipped normals). Consumers: M6-T3/T4 wire the download
 * + the deployed demo.
 */

export * from './scene'
export * from './contract'
export * from './normals'
export * from './blender'
export * from './gltf'
