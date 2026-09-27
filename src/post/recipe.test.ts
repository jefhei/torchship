/**
 * M4-T3 — the post-processing recipe, measured.
 *
 * Pins (BUILD_PLAN M4-T3 "post-processing within frame budget" + "subtle bloom";
 * PRD §4 "no blown-out panels", "no flat or murky rooms"):
 *
 *  - the emissive BAND read off M4-T1's authored PBR sets — every §4 slot's
 *    emissive luminance, with the coffee-station accent measured as the dimmest
 *    lens (0.141) and the panel lens as the band's head (1.386), both under the
 *    emissive ceiling the registry caps at 4;
 *  - the rig's own ambient fill (M4-T2) measured at 0.075 — under the lit
 *    ceiling, so the fill cannot bloom the interior;
 *  - the DERIVED threshold: the midpoint of the lit/emissive gap (0.120 in the
 *    standard theme), moving with the theme rather than authored;
 *  - the gates: an over-strength pass, a threshold inside either band, a
 *    non-mip-chain blur, a wide AO radius, an AO that could go murky, a
 *    non-prime ring count and a sample count that aliases into it are all
 *    refused, and the two band edges are doctored to prove the gates fire.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes'
import type { MaterialTheme, MaterialSlotSpec } from '../materials/theme'
import type { MaterialSlots } from '../types'
import { PBR_EMISSIVE_INTENSITY_MAX, NO_EMISSION } from '../materials/pbr'
import { RIG_AMBIENT_COLOR, RIG_AMBIENT_INTENSITY } from '../lighting/archetypes'
import {
  POST_BLOOM_INTENSITY,
  POST_BLOOM_INTENSITY_MAX,
  POST_BLOOM_MIPMAP_BLUR,
  POST_BLOOM_RADIUS,
  POST_BLOOM_SMOOTHING,
  POST_BLOOM_THRESHOLD_MAX,
  POST_LIT_LUMINANCE_CEILING,
  POST_SSAO_FADE,
  POST_SSAO_INTENSITY,
  POST_SSAO_INTENSITY_MAX,
  POST_SSAO_LUMINANCE_INFLUENCE,
  POST_SSAO_RADIUS,
  POST_SSAO_RADIUS_MAX,
  POST_SSAO_RINGS,
  POST_SSAO_SAMPLES,
  ambientFillLuminance,
  assertPostRecipeValid,
  bloomBandProblems,
  bloomBands,
  bloomRecipeFor,
  bloomRecipeProblems,
  bloomThresholdFor,
  brightestEmissiveRow,
  dimmestEmissiveRow,
  emissiveLuminanceOf,
  emissiveRowsFor,
  emittingRowsFor,
  postRecipeProblems,
  postRecipeReport,
  ssaoRecipe,
  ssaoRecipeProblems,
  tintLuminance,
} from './recipe'

/** The accents the measured table is pinned against (M4-T1's authored tints). */
const PANEL_LENS = 1.3864370196078433
const SCREEN_LENS = 0.8658795294117647
const COFFEE_LENS = 0.14093882352941176

/**
 * A doctored theme: the standard slots with entries swapped. Deliberately able
 * to break M4-T1's slot → set rule — this is a probe for the threshold
 * DERIVATION and the band gates, not a theme anyone would ship.
 */
function themeWith(overrides: Partial<MaterialSlots<MaterialSlotSpec>>): MaterialTheme {
  return {
    id: 'doctored',
    label: 'Doctored',
    slots: { ...DEFAULT_MATERIAL_THEME.slots, ...overrides },
  }
}

/** Every emitting slot swapped to an inert set: no emissive band at all. */
const UNLIT_THEME = themeWith({
  'panel-light': { set: 'webbing-canvas-strap' },
  screen: { set: 'webbing-canvas-strap' },
  'coffee-accent': { set: 'webbing-canvas-strap' },
})

describe('the emissive band (M4-T3, read off M4-T1 + M4-T2)', () => {
  it('reads every §4 slot, with the inert ones exactly at zero', () => {
    const rows = emissiveRowsFor()
    expect(rows.map((row) => row.slot)).toEqual([
      'deckplate',
      'bulkhead',
      'conduit',
      'panel-light',
      'screen',
      'hazard',
      'ceramic',
      'webbing',
      'coffee-accent',
    ])

    const luminanceOf = (slot: string) =>
      rows.find((row) => row.slot === slot)?.luminance ?? Number.NaN
    expect(luminanceOf('panel-light')).toBeCloseTo(PANEL_LENS, 12)
    expect(luminanceOf('screen')).toBeCloseTo(SCREEN_LENS, 12)
    expect(luminanceOf('coffee-accent')).toBeCloseTo(COFFEE_LENS, 12)
    for (const slot of [
      'deckplate',
      'bulkhead',
      'conduit',
      'hazard',
      'ceramic',
      'webbing',
    ]) {
      expect(luminanceOf(slot)).toBe(0)
      expect(rows.find((row) => row.slot === slot)?.tint).toBe(NO_EMISSION)
    }
  })

  it('measures the coffee-station accent as the dimmest lens and the panel as the head', () => {
    const dimmest = dimmestEmissiveRow()
    const brightest = brightestEmissiveRow()
    expect(dimmest?.slot).toBe('coffee-accent')
    expect(dimmest?.luminance).toBeCloseTo(COFFEE_LENS, 12)
    expect(brightest?.slot).toBe('panel-light')
    expect(brightest?.luminance).toBeCloseTo(PANEL_LENS, 12)
    // The band's head is under the §4 emissive ceiling the registry enforces.
    expect(brightest?.luminance ?? Number.NaN).toBeLessThan(PBR_EMISSIVE_INTENSITY_MAX)
    expect(emittingRowsFor()).toHaveLength(3)
  })

  it('keeps the rig ambient fill under the lit ceiling (M4-T2 is a bloom input)', () => {
    expect(tintLuminance(RIG_AMBIENT_COLOR)).toBeCloseTo(0.2694039215686274, 12)
    expect(ambientFillLuminance()).toBeCloseTo(
      0.2694039215686274 * RIG_AMBIENT_INTENSITY,
      12,
    )
    expect(ambientFillLuminance()).toBeCloseTo(0.07543309803921568, 12)
    expect(ambientFillLuminance()).toBeLessThan(POST_LIT_LUMINANCE_CEILING)
  })

  it('puts the threshold in the middle of the gap, derived rather than authored', () => {
    // (0.1 + 0.14093882352941176) / 2
    expect(bloomThresholdFor()).toBeCloseTo(0.12046941176470588, 12)
    expect(bloomThresholdFor()).toBeGreaterThan(POST_LIT_LUMINANCE_CEILING)
    expect(bloomThresholdFor()).toBeLessThan(COFFEE_LENS)
  })

  it('derives an inert surface as exactly zero emission', () => {
    expect(
      emissiveLuminanceOf({
        color: '#ffffff',
        emissive: NO_EMISSION,
        emissiveIntensity: 0,
        metalness: 0,
        roughness: 1,
      }),
    ).toBe(0)
  })

  it('refuses a colour that is not a #rrggbb tint', () => {
    expect(() => tintLuminance('rebeccapurple')).toThrow(/#rrggbb tint/)
    expect(() => tintLuminance('#FFF')).toThrow(/#rrggbb tint/)
  })
})

describe('the bloom recipe', () => {
  it('authors a subtle, mip-chain pass at the derived threshold', () => {
    expect(bloomRecipeFor()).toEqual({
      intensity: POST_BLOOM_INTENSITY,
      luminanceThreshold: bloomThresholdFor(),
      luminanceSmoothing: POST_BLOOM_SMOOTHING,
      mipmapBlur: POST_BLOOM_MIPMAP_BLUR,
      radius: POST_BLOOM_RADIUS,
    })
    expect(bloomRecipeFor().intensity).toBe(0.35)
    expect(bloomRecipeFor().luminanceThreshold).toBeCloseTo(0.12046941176470588, 12)
    expect(postRecipeProblems()).toEqual([])
  })

  it('caps the threshold at an eighth of M4-T1 emissive ceiling', () => {
    expect(POST_BLOOM_THRESHOLD_MAX).toBe(PBR_EMISSIVE_INTENSITY_MAX / 8)
    expect(POST_BLOOM_THRESHOLD_MAX).toBe(0.5)
    expect(bloomRecipeFor().luminanceThreshold).toBeLessThan(POST_BLOOM_THRESHOLD_MAX)
    expect(
      bloomRecipeProblems({ ...bloomRecipeFor(), luminanceThreshold: 0.6 }),
    ).toEqual([
      expect.stringMatching(
        /threshold 0\.6 is over 0\.5 \(an eighth of M4-T1's emissive ceiling\)/,
      ),
    ])
  })

  it('refuses a pass that is not subtle, or not mip-chained', () => {
    expect(
      bloomRecipeProblems({
        ...bloomRecipeFor(),
        intensity: POST_BLOOM_INTENSITY_MAX + 0.01,
      }),
    ).toEqual([
      expect.stringMatching(
        /intensity 0\.51 is outside 0…0\.5 \(the pass must stay subtle\)/,
      ),
    ])
    expect(bloomRecipeProblems({ ...bloomRecipeFor(), mipmapBlur: false })).toEqual([
      expect.stringMatching(/mip-chain blur/),
    ])
    expect(bloomRecipeProblems({ ...bloomRecipeFor(), radius: 1.2 })).toEqual([
      expect.stringMatching(/radius 1\.2 is outside 0…1/),
    ])
    expect(
      bloomRecipeProblems({ ...bloomRecipeFor(), luminanceSmoothing: -0.1 }),
    ).toEqual([expect.stringMatching(/luminance smoothing -0\.1 is outside 0…1/)])
  })

  it('refuses a threshold that would bloom lit surfaces', () => {
    const belowTheCeiling = bloomRecipeProblems({
      ...bloomRecipeFor(),
      luminanceThreshold: POST_LIT_LUMINANCE_CEILING,
    })
    expect(belowTheCeiling).toEqual([
      expect.stringMatching(
        /at or under the lit ceiling \(0\.1\) — lit surfaces would bloom/,
      ),
    ])
  })

  it('refuses a threshold that would miss the faintest practical', () => {
    const aboveTheAccent = bloomRecipeProblems({
      ...bloomRecipeFor(),
      luminanceThreshold: 0.2,
    })
    expect(aboveTheAccent).toEqual([
      expect.stringMatching(
        /does not clear the dimmest emitting lens \('coffee-accent' at 0\.14093882352941176\)/,
      ),
    ])
  })
})

describe('the band gates (doctored bands prove they fire)', () => {
  it('refuses bands that have crossed', () => {
    const problems = bloomBandProblems(DEFAULT_MATERIAL_THEME, {
      litCeiling: 0.2,
      fillLuminance: 0.075,
    })
    expect(problems).toEqual([
      expect.stringMatching(
        /dimmest emitting lens \('coffee-accent' at 0\.14093882352941176\) does not clear the lit ceiling \(0\.2\)/,
      ),
    ])
  })

  it('refuses a fill that reaches the lit ceiling', () => {
    const problems = bloomBandProblems(DEFAULT_MATERIAL_THEME, {
      litCeiling: POST_LIT_LUMINANCE_CEILING,
      fillLuminance: POST_LIT_LUMINANCE_CEILING,
    })
    expect(problems).toEqual([
      expect.stringMatching(
        /ambient fill measures 0\.1, at or over the lit ceiling \(0\.1\)/,
      ),
    ])
  })

  it('refuses a theme in which nothing emits', () => {
    expect(emittingRowsFor(UNLIT_THEME)).toEqual([])
    expect(dimmestEmissiveRow(UNLIT_THEME)).toBeUndefined()
    expect(brightestEmissiveRow(UNLIT_THEME)).toBeUndefined()
    expect(bloomBandProblems(UNLIT_THEME)).toEqual([
      expect.stringMatching(/no emitting §4 slot/),
    ])
    expect(() => bloomThresholdFor(UNLIT_THEME)).toThrow(/no emitting §4 slot/)
    expect(postRecipeProblems(UNLIT_THEME)).toEqual([
      expect.stringMatching(/no emitting §4 slot/),
    ])
  })

  it('measures the real bands as a gap, not a collision', () => {
    expect(bloomBands()).toEqual({
      litCeiling: POST_LIT_LUMINANCE_CEILING,
      fillLuminance: ambientFillLuminance(),
    })
    expect(bloomBandProblems()).toEqual([])
  })
})

describe('the threshold follows the theme', () => {
  it('moves up when the dimmest lens is re-pointed at an inert surface', () => {
    const reSkinned = themeWith({ 'coffee-accent': { set: 'webbing-canvas-strap' } })
    expect(dimmestEmissiveRow(reSkinned)?.slot).toBe('screen')
    // Now the screen is the faintest practical: the gap is (0.1, 0.8658795294117647).
    expect(bloomThresholdFor(reSkinned)).toBeCloseTo(0.48293976470588235, 12)
    expect(bloomThresholdFor(reSkinned)).toBeGreaterThan(bloomThresholdFor())
    expect(bloomBandProblems(reSkinned)).toEqual([])
    // The re-pointed threshold still clears both bands it sits between.
    expect(bloomRecipeProblems(bloomRecipeFor(reSkinned), reSkinned)).toEqual([])
  })
})

describe('the AO recipe', () => {
  it('is the authored, tighter-than-default, cost-bounded pass', () => {
    expect(ssaoRecipe()).toEqual({
      samples: POST_SSAO_SAMPLES,
      rings: POST_SSAO_RINGS,
      radius: POST_SSAO_RADIUS,
      intensity: POST_SSAO_INTENSITY,
      fade: POST_SSAO_FADE,
      luminanceInfluence: POST_SSAO_LUMINANCE_INFLUENCE,
    })
    expect(ssaoRecipe().radius).toBeLessThan(POST_SSAO_RADIUS_MAX)
    expect(ssaoRecipeProblems(ssaoRecipe())).toEqual([])
  })

  it('refuses an occlusion that could go murky or wide', () => {
    expect(
      ssaoRecipeProblems({ ...ssaoRecipe(), intensity: POST_SSAO_INTENSITY_MAX + 0.1 }),
    ).toEqual([
      expect.stringMatching(
        /intensity 0\.7 is outside 0…0\.6 \(PRD §4: no murky rooms\)/,
      ),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), radius: 0.5 })).toEqual([
      expect.stringMatching(/radius 0\.5 is outside 1e-6…0\.1825/),
    ])
  })

  it('refuses a sampling pattern postprocessing cannot use', () => {
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), rings: 6 })).toEqual([
      expect.stringMatching(/ring count 6 is not a prime/),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), samples: 14 })).toEqual([
      expect.stringMatching(/sample count 14 is a multiple of the ring count 7/),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), samples: 4 })).toEqual([
      expect.stringMatching(/sample count 4 is outside 5…16/),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), samples: 8.5 })).toEqual([
      expect.stringMatching(/sample count 8\.5 is not an integer/),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), fade: 0 })).toEqual([
      expect.stringMatching(/fade 0 must be positive/),
    ])
    expect(ssaoRecipeProblems({ ...ssaoRecipe(), luminanceInfluence: 1.5 })).toEqual([
      expect.stringMatching(/luminance influence 1\.5 is outside 0…1/),
    ])
  })
})

describe('the recipe report and its assertion', () => {
  it('reads both band edges and stays calibrated', () => {
    const report = postRecipeReport()
    expect(report.themeId).toBe('firebrand')
    expect(report.dimmestLens?.slot).toBe('coffee-accent')
    expect(report.brightestLens?.slot).toBe('panel-light')
    expect(report.problems).toEqual([])
    expect(report.detail).toMatch(
      /bloom 0\.35 at threshold 0\.120 — in the gap between the lit ceiling 0\.1 and the dimmest lens 0\.141, band head 1\.386; ao 0\.35 r0\.12 ×9o7/,
    )
  })

  it('asserts the standard theme and refuses a theme with no emissive band', () => {
    expect(() => assertPostRecipeValid()).not.toThrow()
    expect(() => assertPostRecipeValid(UNLIT_THEME)).toThrow(
      /the post-processing chain is not calibrated/,
    )
  })
})
