/**
 * M6-T4 — demo barrel: the public surface of src/demo/.
 *
 * `deploy.ts` (the deploy targets + the built-`dist/` gate), `shots.ts` (the
 * README shot list, derived from the assembled ships) and `markdown.ts` (the
 * generated README "Demo" section). The Blender renderer that turns the shot
 * list into pixels lives in `scripts/blender-render.py`; the jsdom test
 * `render.test.ts` writes the manifest it consumes.
 */

export * from './deploy'
export * from './shots'
export * from './markdown'
