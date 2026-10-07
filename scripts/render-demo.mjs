#!/usr/bin/env node
/**
 * M6-T4 — render the README's demo assets.
 *
 * Two steps, both headless:
 *   1. `scripts/blender-render.py` (Blender's Cycles, CPU) renders the shot list
 *      in `dist/demo/manifest.json` — the per-preset stills and the coffee-run
 *      clip frames — into a staging directory.
 *   2. The stills are copied to `public/demo/<preset>.png` and the clip frames
 *      are stitched into `public/demo/coffee-run.gif` with ffmpeg.
 *
 * The manifest is written by `src/demo/render.test.ts` (run `npm run demo:manifest`
 * or `npm test` first). Any extra CLI args are forwarded to the Blender step
 * (e.g. `--only patrol-interior`, `--samples 32`).
 *
 *   npm run demo:render
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const manifestPath = resolve('dist/demo/manifest.json')
if (!existsSync(manifestPath)) {
  console.error(
    `no manifest at ${manifestPath} — run \`npm run demo:manifest\` (or \`npm test\`) first`,
  )
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const script = resolve('scripts/blender-render.py')
const stage = resolve('dist/demo/render')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const candidates = [
  process.env.BLENDER_PYTHON,
  'python3',
  'python3.11',
  '/tmp/bpyenv/bin/python',
].filter(Boolean)

let blender = null
for (const python of candidates) {
  if (spawnSync(python, ['-c', 'import bpy'], { stdio: 'ignore' }).status === 0) {
    blender = { command: python, args: [script, manifestPath, stage] }
    break
  }
}
if (blender === null) {
  console.error(
    'no Blender found. Install the module (`pip install bpy`) and set BLENDER_PYTHON ' +
      'to that python, or put `blender` on PATH.',
  )
  process.exit(3)
}

const forward = process.argv.slice(2)
console.error(
  `# rendering with ${blender.command}${forward.length ? ` ${forward.join(' ')}` : ''}`,
)
const render = spawnSync(blender.command, [...blender.args, ...forward], {
  stdio: 'inherit',
})
if (render.status !== 0) {
  process.exit(render.status ?? 1)
}

const report = JSON.parse(readFileSync(resolve(stage, 'render-report.json'), 'utf8'))
if (report.failed.length > 0) {
  console.error(`# ${report.failed.length} shot(s) failed:`)
  for (const failure of report.failed) {
    console.error(`  - ${failure.id}: ${failure.error}`)
  }
  process.exit(4)
}

/** Where each shot's pixels ended up (asset path -> staged source). */
const publicDir = resolve('public')
mkdirSync(resolve(publicDir, 'demo'), { recursive: true })

// Only the shots the renderer actually produced (`--only` renders a subset).
const rendered = new Set(report.shots.map((shot) => shot.id))
const outputs = []
for (const shot of manifest.shots) {
  if (!rendered.has(shot.id)) {
    continue
  }
  const target = resolve(publicDir, shot.asset)
  mkdirSync(dirname(target), { recursive: true })
  if (shot.kind === 'still') {
    const source = resolve(stage, basename(shot.asset))
    copyFileSync(source, target)
    outputs.push(target)
  } else {
    const pattern = resolve(stage, 'frames', `${shot.id}_%04d.png`)
    const gif = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(shot.fps),
        '-i',
        pattern,
        '-vf',
        'split[s0][s1];[s0]palettegen=max_colors=160[p];[s1][p]paletteuse=dither=bayer',
        '-loop',
        '0',
        target,
      ],
      { stdio: 'inherit' },
    )
    if (gif.status !== 0) {
      console.error(`# ffmpeg failed for ${shot.id}`)
      process.exit(5)
    }
    outputs.push(target)
  }
}

let failed = false
for (const output of outputs) {
  const size = existsSync(output) ? statSync(output).size : 0
  console.error(`# ${size > 0 ? 'ok' : 'EMPTY'} ${output} (${size} bytes)`)
  if (size === 0) failed = true
}
console.error(`# ${outputs.length} asset(s) written`)
process.exit(failed ? 6 : 0)
