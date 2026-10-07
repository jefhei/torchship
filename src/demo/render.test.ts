/**
 * M6-T4 — the demo-render ARTIFACT writer.
 *
 * The shot list (`shots.ts`) is pure data; the pixels are made by
 * `scripts/blender-render.py`, which — like `scripts/blender-validate.py`
 * (M6-T2) — cannot import the extensionless TypeScript module graph. So this
 * test is the bridge (the same "write the corpus from a test" precedent as
 * M6-T1/M6-T2): it assembles each real preset, writes its glTF export to
 * `dist/demo/`, and writes `dist/demo/manifest.json` — the exact shot list, with
 * every camera pose in ship world meters — for the renderer to consume.
 *
 * It asserts the manifest is complete and that every export is contract-clean,
 * so a `npm run demo:render` run renders ships that really came out of the
 * assembler. `dist/` is gitignored; regenerating is free.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleShip } from '../assembler'
import { exportGltf, exportProblems, gltfFileName, toGltfJson } from '../export'
import { expectValidFixtures } from '../fixtures'
import { demoMarkdown } from './markdown'
import { planDemo } from './shots'

const OUT_DIR = path.resolve('dist/demo')

/** One camera pose as the renderer reads it (ship world meters + yaw radians). */
interface ManifestPose {
  eye: [number, number, number]
  yaw: number
  deckIndex: number
}

/** The manifest written for `scripts/blender-render.py`. */
interface RenderManifest {
  presets: { id: string; ship: string; file: string }[]
  shots: (
    | {
        id: string
        kind: 'still'
        presetId: string
        ship: string
        asset: string
        pose: ManifestPose
      }
    | {
        id: string
        kind: 'clip'
        presetId: string
        ship: string
        asset: string
        fps: number
        frames: ManifestPose[]
      }
  )[]
}

describe('demo render manifest (M6-T4)', () => {
  it('writes dist/demo/manifest.json + a contract-clean glTF per preset', async () => {
    mkdirSync(OUT_DIR, { recursive: true })
    const plan = planDemo()
    expect(plan.problems).toEqual([])

    const fileFor = new Map<string, string>()
    for (const fixture of expectValidFixtures()) {
      const assembly = assembleShip(fixture.spec)
      const gltf = await exportGltf(assembly)
      expect(exportProblems(gltf, assembly)).toEqual([])
      const file = path.join(OUT_DIR, gltfFileName(fixture.spec.name))
      writeFileSync(file, toGltfJson(gltf))
      fileFor.set(fixture.id, file)
    }

    const manifest: RenderManifest = {
      presets: expectValidFixtures().map((fixture) => ({
        id: fixture.id,
        ship: fixture.spec.name,
        file: fileFor.get(fixture.id) ?? '',
      })),
      shots: plan.shots.map((shot) => {
        if (shot.kind === 'still') {
          return {
            id: shot.id,
            kind: 'still' as const,
            presetId: shot.presetId,
            ship: shot.ship,
            asset: shot.asset,
            pose: {
              eye: [...shot.pose.eye] as [number, number, number],
              yaw: shot.pose.yaw,
              deckIndex: shot.pose.deckIndex,
            },
          }
        }
        return {
          id: shot.id,
          kind: 'clip' as const,
          presetId: shot.presetId,
          ship: shot.ship,
          asset: shot.asset,
          fps: shot.fps,
          frames: shot.frames.map((pose) => ({
            eye: [...pose.eye] as [number, number, number],
            yaw: pose.yaw,
            deckIndex: pose.deckIndex,
          })),
        }
      }),
    }

    writeFileSync(
      path.join(OUT_DIR, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    // The generated README section alongside the manifest, so the checked-in
    // README can be refreshed from the same run that renders the pixels.
    writeFileSync(path.join(OUT_DIR, 'demo-section.md'), demoMarkdown(plan))

    expect(manifest.presets).toHaveLength(3)
    expect(manifest.presets.every((preset) => preset.file !== '')).toBe(true)
    expect(manifest.shots).toHaveLength(4)
    const clip = manifest.shots.find((shot) => shot.kind === 'clip')
    expect(clip !== undefined && clip.kind === 'clip').toBe(true)
  }, 60_000)
})
