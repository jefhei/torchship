#!/usr/bin/env node
/**
 * M6-T2 — run the real-Blender export validation.
 *
 * Regenerates nothing: it validates the `.gltf` corpus the vitest suite writes
 * to `dist/export/` (run `npm run validate:export` first, or `npm test`). It
 * finds a Python that can `import bpy` — `$BLENDER_PYTHON` first, then `python3`,
 * then a `blender` binary on PATH — and runs `scripts/blender-validate.py` over
 * every `.gltf`, relaying its JSON and exit code.
 *
 *   BLENDER_PYTHON=/path/to/bpy/python npm run validate:blender
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(process.cwd(), 'dist/export')
if (!existsSync(dir)) {
  console.error(
    `no corpus at ${dir} — run \`npm run validate:export\` (or \`npm test\`) first`,
  )
  process.exit(2)
}
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.gltf'))
  .sort()
  .map((name) => resolve(dir, name))
if (files.length === 0) {
  console.error(`no .gltf files in ${dir}`)
  process.exit(2)
}

const script = resolve(process.cwd(), 'scripts/blender-validate.py')
const candidates = [
  process.env.BLENDER_PYTHON,
  'python3',
  'python3.11',
  '/tmp/bpyenv/bin/python',
].filter(Boolean)

let ran = null
for (const python of candidates) {
  const probe = spawnSync(python, ['-c', 'import bpy'], { stdio: 'ignore' })
  if (probe.status === 0) {
    ran = { command: python, args: [script, ...files] }
    break
  }
}
if (ran === null) {
  const blender = spawnSync('blender', ['--version'], { stdio: 'ignore' })
  if (blender.status === 0) {
    ran = { command: 'blender', args: ['-b', '--python', script, '--', ...files] }
  }
}
if (ran === null) {
  console.error(
    'no Blender found. Install the module (`pip install bpy`) and set ' +
      'BLENDER_PYTHON to that python, or put `blender` on PATH.',
  )
  process.exit(3)
}

console.error(`# validating ${files.length} file(s) with ${ran.command}`)
const result = spawnSync(ran.command, ran.args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
