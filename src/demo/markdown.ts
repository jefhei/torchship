/**
 * M6-T4 — the README's Demo section, GENERATED from the shot list so it cannot
 * drift from what the build actually ships.
 *
 * The section is derived data: the deploy target + URL come from `deploy.ts`,
 * the gallery rows come from the shot list, and the asset paths come from the
 * shots themselves. `src/demo/demo.test.ts` asserts the repo's `README.md`
 * contains this exact section, so editing the README by hand (or adding a shot)
 * fails the gate until the generator is re-run — the same golden-file posture as
 * the M5-T3 `QA.md`.
 */

import type { DemoPlan } from './shots'
import { demoClip, demoStills } from './shots'
import type { DeployTarget } from './deploy'
import { DEFAULT_DEPLOY_TARGET_ID, DEPLOY_TARGETS, PRODUCTION_BASE } from './deploy'

/** Every `public/`-relative asset path the plan names, in plan order. */
export function demoAssetPaths(plan: DemoPlan): string[] {
  return plan.shots.map((shot) => shot.asset)
}

/**
 * The README "Demo" section for a shot list. Deterministic: same plan ⇒ same
 * bytes (the test compares it to the checked-in README verbatim).
 */
export function demoMarkdown(
  plan: DemoPlan,
  targets: readonly DeployTarget[] = DEPLOY_TARGETS,
): string {
  const primary =
    targets.find((target) => target.id === DEFAULT_DEPLOY_TARGET_ID) ?? targets[0]
  const stills = demoStills(plan)
  const clip = demoClip(plan)

  const lines: string[] = []
  lines.push('## Demo (M6-T4)')
  lines.push('')
  lines.push(
    'The app is a **client-only static site**: `npm run build` writes `dist/` and `npm run preview` ' +
      `serves it locally. The build uses the relative Vite base \`${PRODUCTION_BASE}\`, so the same ` +
      '`dist/` runs from a subpath (a GitHub Pages project site) as well as a domain root. ' +
      '`npm run deploy:check` validates a built `dist/` against the deploy contract — ' +
      '`index.html`, relative asset refs, the four preset JSONs, the favicon, and the JS/CSS bundle.',
  )
  lines.push('')
  lines.push(
    `- **Demo:** ${primary.url ?? '`npm run preview`'} (${primary.label}${primary.url === null ? '' : `, served from \`${primary.mountPath}\``})`,
  )
  lines.push('')
  lines.push(
    'The picker ships the three real presets. Each interior below is a Blender render of the M6-T1 ' +
      "glTF export from that ship's own assembly (regenerate with `npm run demo:render`):",
  )
  lines.push('')
  lines.push('| Preset | Space | Interior |')
  lines.push('| --- | --- | --- |')
  for (const shot of stills) {
    lines.push(
      `| ${shot.label} | ${shot.space} | ![${shot.label} — ${shot.space}](public/${shot.asset}) |`,
    )
  }
  if (clip !== null) {
    lines.push('')
    lines.push(
      `The **coffee run** (${clip.space.toLowerCase()}) — replayed headlessly by the M5-T2 recorder ` +
        `and rendered frame by frame (${clip.frames.length} frames at ${clip.fps} fps):`,
    )
    lines.push('')
    lines.push(`![${clip.label}](public/${clip.asset})`)
  }
  lines.push('')
  return lines.join('\n')
}
