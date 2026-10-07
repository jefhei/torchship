/**
 * M6-T4 — the demo gate: the deploy contract, the shot list, and the README
 * cross-pin. Everything here is headless (no WebGL, no dev server): the shot
 * list is geometry, the deploy gate reads a file list, and the README section is
 * compared verbatim against the committed file.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectValidFixtures } from '../fixtures'
import { EYE_HEIGHT_M } from '../player/move'
import {
  DEFAULT_DEPLOY_TARGET_ID,
  DEPLOY_TARGETS,
  PRODUCTION_BASE,
  assetProblems,
  assetRefs,
  demoClip,
  demoMarkdown,
  demoStills,
  deployUrlFor,
  distProblems,
  getDeployTarget,
  heroDeckIndex,
  planDemo,
  poseProblems,
  type DistFile,
} from './index'
import { assembleShip } from '../assembler'
import { navigationWorldOf } from '../player/nav'

/** A minimal, well-formed build: relative refs, favicon, presets, js + css. */
function validDist(): DistFile[] {
  const html =
    '<!doctype html><html><head>' +
    '<link rel="icon" href="./favicon.svg" />' +
    '<script type="module" src="./assets/index-abc.js"></script>' +
    '<link rel="stylesheet" href="./assets/index-def.css" />' +
    '</head><body><div id="root"></div></body></html>'
  return [
    { path: 'index.html', text: html },
    { path: 'favicon.svg' },
    { path: 'assets/index-abc.js' },
    { path: 'assets/index-def.css' },
    { path: 'presets/patrol.json' },
    { path: 'presets/long-haul.json' },
    { path: 'presets/science.json' },
    { path: 'presets/stress.json' },
  ]
}

/** Every file under `public/`, as `public/`-relative POSIX paths. */
function publicFiles(): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    const dir = path.resolve('public', rel)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        walk(child)
      } else {
        out.push(child)
      }
    }
  }
  walk('')
  return out
}

describe('M6-T4 deploy contract', () => {
  it('ships a relative Vite base', () => {
    expect(PRODUCTION_BASE).toBe('./')
  })

  it('names a GitHub Pages project site as the primary target', () => {
    const primary = getDeployTarget(DEFAULT_DEPLOY_TARGET_ID)
    expect(primary.url).toBe('https://jefhei.github.io/torchship/')
    expect(primary.mountPath).toBe('/torchship/')
    expect(DEPLOY_TARGETS.map((target) => target.id)).toEqual([
      'github-pages',
      'static',
    ])
    expect(() => getDeployTarget('nope' as never)).toThrow(/no target/)
  })

  it('builds preset-deep demo links', () => {
    const pages = getDeployTarget('github-pages')
    expect(deployUrlFor(pages)).toBe('https://jefhei.github.io/torchship/')
    expect(deployUrlFor(pages, 'science')).toBe(
      'https://jefhei.github.io/torchship/?p=science',
    )
    expect(deployUrlFor(getDeployTarget('static'), 'patrol')).toBeNull()
  })
})

describe('M6-T4 dist gate', () => {
  it('passes a well-formed build', () => {
    expect(distProblems(validDist())).toEqual([])
  })

  it('reads every href/src ref out of the document', () => {
    expect(assetRefs('<a href="x">y</a><img src="z"/>')).toEqual(['x', 'z'])
  })

  it('catches a root-absolute asset ref (the subpath breaker)', () => {
    const files = validDist().map((file) =>
      file.path === 'index.html'
        ? { ...file, text: '<script src="/assets/index-abc.js"></script>' }
        : file,
    )
    const problems = distProblems(files)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/root-absolute path/)
  })

  it('catches a missing entry document', () => {
    const files = validDist().filter((file) => file.path !== 'index.html')
    expect(distProblems(files).some((p) => p.includes('index.html is missing'))).toBe(
      true,
    )
  })

  it('catches a missing favicon or preset', () => {
    for (const drop of ['favicon.svg', 'presets/science.json']) {
      const files = validDist().filter((file) => file.path !== drop)
      expect(distProblems(files).some((p) => p.includes(drop))).toBe(true)
    }
  })

  it('catches a ref that resolves to no file', () => {
    const files = validDist().map((file) =>
      file.path === 'index.html'
        ? { ...file, text: '<script src="./assets/gone.js"></script>' }
        : file,
    )
    expect(distProblems(files).some((p) => p.includes('./assets/gone.js'))).toBe(true)
  })

  it('catches a build with no js or no css bundle', () => {
    expect(
      distProblems(validDist().filter((f) => !f.path.endsWith('.js'))).some((p) =>
        p.includes('assets/*.js'),
      ),
    ).toBe(true)
    expect(
      distProblems(validDist().filter((f) => !f.path.endsWith('.css'))).some((p) =>
        p.includes('assets/*.css'),
      ),
    ).toBe(true)
  })

  it('ignores external, data: and fragment refs', () => {
    const files = validDist().map((file) =>
      file.path === 'index.html'
        ? {
            ...file,
            text:
              '<link href="https://fonts.example/x" />' +
              '<a href="#top">top</a>' +
              '<img src="data:image/png;base64,AAAA" />' +
              '<script src="./assets/index-abc.js"></script>',
          }
        : file,
    )
    expect(distProblems(files)).toEqual([])
  })
})

describe('M6-T4 shot list', () => {
  const plan = planDemo()

  it('derives every shot without a problem', () => {
    expect(plan.problems).toEqual([])
  })

  it('plans one still per real preset, in registry order, plus the clip', () => {
    expect(plan.shots).toHaveLength(4)
    const stills = demoStills(plan)
    expect(stills.map((shot) => shot.presetId)).toEqual([
      'patrol',
      'long-haul',
      'science',
    ])
    expect(stills.map((shot) => shot.asset)).toEqual([
      'demo/patrol.png',
      'demo/long-haul.png',
      'demo/science.png',
    ])
    const clip = demoClip(plan)
    expect(clip?.asset).toBe('demo/coffee-run.gif')
    expect(clip?.presetId).toBe('patrol')
  })

  it('stands each still eye EYE_HEIGHT_M above its feet', () => {
    for (const shot of demoStills(plan)) {
      expect(shot.pose.eye[0]).toBeCloseTo(shot.pose.feet[0], 9)
      expect(shot.pose.eye[2]).toBeCloseTo(shot.pose.feet[2], 9)
      expect(shot.pose.eye[1] - shot.pose.feet[1]).toBeCloseTo(EYE_HEIGHT_M, 9)
    }
  })

  it('measures every still pose standable on its own ship', () => {
    for (const fixture of expectValidFixtures()) {
      const still = demoStills(plan).find((shot) => shot.presetId === fixture.id)
      expect(still).toBeDefined()
      const assembly = assembleShip(fixture.spec)
      const world = navigationWorldOf(assembly)
      expect(poseProblems(assembly, world, still!.pose)).toEqual([])
    }
  })

  it('samples the coffee run to CLIP_FRAMES poses on the crew deck', () => {
    const clip = demoClip(plan)
    expect(clip).not.toBeNull()
    expect(clip!.frames).toHaveLength(24)
    expect(clip!.fps).toBe(12)
    expect(clip!.frames.every((pose) => pose.deckIndex === 1)).toBe(true)
    const first = clip!.frames[0].feet
    const last = clip!.frames[clip!.frames.length - 1].feet
    expect(Math.hypot(last[0] - first[0], last[2] - first[2])).toBeLessThan(0.3)
  })

  it('shoots the default preset on the crew deck and a variant on its signature deck', () => {
    const [patrol, longHaul, science] = expectValidFixtures()
    expect(heroDeckIndex(patrol)).toBe(1)
    // Long-Haul repeats storage → its second cargo hold (the last deck, 5).
    expect(heroDeckIndex(longHaul)).toBe(5)
    // Science repeats the ops module → the retrofit deck, 3 (not the last deck).
    expect(heroDeckIndex(science)).toBe(3)
    for (const fixture of [longHaul, science]) {
      const deck = fixture.spec.decks[heroDeckIndex(fixture)]
      expect(deck.modules.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    expect(JSON.stringify(planDemo())).toBe(JSON.stringify(planDemo()))
  })
})

describe('M6-T4 demo assets + README', () => {
  const plan = planDemo()

  it('has every committed demo asset under public/', () => {
    expect(assetProblems(publicFiles(), plan)).toEqual([])
  })

  it('names every missing asset', () => {
    const problems = assetProblems([], plan)
    expect(problems).toHaveLength(4)
    expect(problems[0]).toMatch(/demo\/patrol\.png/)
  })

  it('keeps README.md in sync with the generated Demo section', () => {
    const readme = readFileSync(path.resolve('README.md'), 'utf8')
    expect(readme).toContain(demoMarkdown(plan))
  })
})
