/**
 * M4-T3 — the post-processing recipe (BUILD_PLAN M4-T3: "Post-processing within
 * frame budget (subtle bloom; SSAO only if budget allows)").
 *
 * Two passes, and the plan's own words are the whole design:
 *
 *  - **subtle bloom** — PRD §4's lighting is practical-only, so the only thing
 *    in the ship bright enough to glow is an emissive lens (a panel, a task
 *    strip, a screen, the drive). Bloom exists to bleed a little light off
 *    those lenses and nothing else; it is not there to make the ship look
 *    cinematic. "Subtle" is therefore MEASURED here, not asserted: the
 *    luminance threshold is placed in the gap between the brightest a merely
 *    LIT surface may read (`POST_LIT_LUMINANCE_CEILING`) and the DIMMEST lens
 *    that emits (`dimmestEmissiveRow(theme)` — the coffee-station accent at
 *    0.141 in the standard theme, the binding constraint). Above the lit band,
 *    below the emissive band: nothing inert blooms, and every practical does.
 *    Both edges of that gap are read off real numbers from the layers below —
 *    M4-T1's authored PBR sets (`PBR_EMISSIVE_INTENSITY_MAX`, the emissive
 *    ceiling the band's head is measured against) and M4-T2's rig fill
 *    (`RIG_AMBIENT_*`, whose luminance must stay under the lit ceiling or the
 *    fill itself would smear a glow across the whole interior).
 *  - **SSAO only if the budget allows** — the decision is not made here, it is
 *    made by `plan.ts` against the same two budgets the rest of M4 is measured
 *    against (§10's draw calls and the deck-scoped light ceiling). This file
 *    authors the AO RECIPE (how dark, how tight, how many samples) and the
 *    gates that keep it from turning the interior murky: PRD §4's anti-goal is
 *    "no flat or murky rooms", and ambient occlusion is darkening, so its
 *    intensity and its radius are both capped relative to the library's own
 *    defaults.
 *
 * Nothing in this file touches three.js or React: a recipe is plain data, so
 * the values the renderer mounts are the values a test can read. The R3F side
 * is `ShipPost.tsx`, and the budget decision is `plan.ts`.
 *
 * Relative specifiers carry `.ts` extensions on the leaf modules this file
 * reads (the `src/materials/` convention), so the chain stays loadable by the
 * plain-node build gate as well as vite/vitest.
 */

import { MATERIAL_SLOTS } from '../types/materials.ts'
import type { MaterialSlot } from '../types/materials.ts'
import type { SlotSurface } from '../kit/render/slotSurfaces.ts'
import { slotSurface } from '../kit/render/slotSurfaces.ts'
import type { MaterialTheme } from '../materials/theme.ts'
import { DEFAULT_MATERIAL_THEME } from '../materials/themes.ts'
import { NO_EMISSION, PBR_EMISSIVE_INTENSITY_MAX } from '../materials/pbr.ts'
// The PURE leaf of the M4-T2 rig, never `../lighting` (whose barrel carries the
// R3F `ShipLighting` component) — the same rule `src/invariants/checks.ts` keeps.
import { RIG_AMBIENT_COLOR, RIG_AMBIENT_INTENSITY } from '../lighting/archetypes.ts'

/**
 * How much glow the pass adds, relative to the surface's own luminance.
 * Authored low on purpose: "subtle" is the requirement, and a bloom that adds
 * half a surface's luminance again is already at the edge of "baked-in".
 */
export const POST_BLOOM_INTENSITY = 0.35

/** A bloom stronger than this stops reading as a lens bleeding light. */
export const POST_BLOOM_INTENSITY_MAX = 0.5

/** Glow spread, postprocessing's `radius` (0…1, wider as it rises). */
export const POST_BLOOM_RADIUS = 0.6

/** postprocessing's `radius` tops out at 1. */
export const POST_BLOOM_RADIUS_MAX = 1

/** How softly the threshold is crossed — a hard cut aliases on the lens edge. */
export const POST_BLOOM_SMOOTHING = 0.2

/** `luminanceSmoothing` is a 0…1 knob in postprocessing. */
export const POST_BLOOM_SMOOTHING_MAX = 1

/**
 * The mip-chain flavour of bloom, not the full-kernel one. This is the budget
 * choice inside the effect itself: the mip chain resolves the glow from a
 * handful of downsampled buffers instead of a large separable kernel, which is
 * exactly the "within frame budget" half of M4-T3.
 */
export const POST_BLOOM_MIPMAP_BLUR = true

/**
 * The brightest a surface may read WITHOUT emitting anything. PRD §4's
 * anti-goal is "no blown-out panels", and this is that anti-goal expressed as
 * the number bloom uses: any pixel over this is either a lens or a bug.
 *
 * Two measured facts have to hold for it to be honest, and `bloomBandProblems`
 * checks both: the rig's own ambient fill lands BELOW it (`RIG_AMBIENT_COLOR`
 * at `RIG_AMBIENT_INTENSITY` measures ~0.075 — a fill that crossed the line
 * would bloom the whole interior), and every §4 lens lands ABOVE it (the
 * dimmest, the coffee-station accent, measures ~0.141).
 */
export const POST_LIT_LUMINANCE_CEILING = 0.1

/**
 * The threshold may never rise past an eighth of M4-T1's emissive ceiling: the
 * pass has to stay calibrated to the emissive band it exists to pick out.
 */
export const POST_BLOOM_THRESHOLD_MAX = PBR_EMISSIVE_INTENSITY_MAX / 8

/**
 * Ambient-occlusion intensity. AO is darkening, and the PRD asks for "no flat
 * or murky rooms", so it is deliberately well under postprocessing's 1.0 —
 * enough to seat fittings in their corners, not enough to re-light the room.
 */
export const POST_SSAO_INTENSITY = 0.35

/** AO stronger than this makes a dim interior murky (PRD §4 anti-goal). */
export const POST_SSAO_INTENSITY_MAX = 0.6

/**
 * Occlusion sampling radius, as a scale of the buffer (postprocessing's own
 * units). Kept TIGHTER than the library default (0.1825): the ship's crevices
 * are hatch frames, deck plating and equipment feet, so a wide radius would
 * carve shading out of open rooms instead of seating geometry in its corners.
 */
export const POST_SSAO_RADIUS = 0.12

/** Tighter than postprocessing's default radius — see`POST_SSAO_RADIUS`. */
export const POST_SSAO_RADIUS_MAX = 0.1825

/** Samples per pixel. postprocessing defaults to 9; this is a cost knob. */
export const POST_SSAO_SAMPLES = 9

/** Fewer samples than this reads as noise banding, not occlusion. */
export const POST_SSAO_SAMPLES_MIN = 5

/** Upper bound on the per-pixel occlusion cost (the pass is full-screen). */
export const POST_SSAO_SAMPLES_MAX = 16

/**
 * Spiral turns in the sampling pattern. postprocessing requires a prime, and a
 * samples-per-pixel count that is NOT a multiple of it (so the ring pattern
 * cannot alias into the sample count).
 */
export const POST_SSAO_RINGS = 7

/** Edge softness of the occlusion term. Lower = higher contrast. */
export const POST_SSAO_FADE = 0.02

/**
 * How much the scene's own luminance drives the occlusion. postprocessing's
 * default (0.7) suits an interior lit only by practicals: dark corners occlude
 * less than dark surfaces, which is what keeps a lamp-lit room from going
 * blotchy.
 */
export const POST_SSAO_LUMINANCE_INFLUENCE = 0.7

/** `luminanceInfluence` is a 0…1 knob. */
export const POST_SSAO_LUMINANCE_INFLUENCE_MAX = 1

/**
 * Multisampling on the composer's render target. The `<Canvas>`'s own
 * `antialias` flag is inert once a composer takes over rendering, so the
 * composer carries the edge smoothing instead — at the moderate 4× that fits
 * the frame budget rather than 8×.
 */
export const POST_MULTISAMPLING = 4

/** Above this the composer's resolve pass costs more than the edges are worth. */
export const POST_MULTISAMPLING_MAX = 4

/** One emitting lens, read off the active theme's PBR sets. */
export interface EmissiveRow {
  slot: MaterialSlot
  /** The tint the set emits (`'#000000'` for an inert set). */
  tint: string
  /** Emissive strength (0 for an inert set). */
  intensity: number
  /** `tintLuminance(tint) × intensity` — 0 exactly when the slot is inert. */
  luminance: number
}

/**
 * How bright a colour reads, by the BT.709 coefficients applied to its sRGB
 * channels. The project is colour-management-free (no textures, no tone-map
 * pipeline of its own), so this cheap weighting is the same currency the bloom
 * threshold is authored in — it is deliberately NOT a linearized luminance, and
 * the tests pin the absolute values so a change of formula is visible.
 *
 * Throws on anything that is not a `#rrggbb` hex: every value that reaches it
 * came out of the M4-T1 registry, which already refuses malformed colours, so a
 * throw here is the last line of defence.
 */
export function tintLuminance(tint: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(tint)
  if (match === null) {
    throw new Error(`post recipe: '${tint}' is not a #rrggbb tint`)
  }
  const [r, g, b] = match.slice(1).map((channel) => parseInt(channel, 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The luminance one resolved §4 surface contributes to a pixel: its emissive
 * tint's luminance times its strength, or 0 when the slot is inert (an inert
 * set carries `NO_EMISSION` at strength 0 — M4-T1's two-way rule).
 */
export function emissiveLuminanceOf(surface: SlotSurface): number {
  if (surface.emissive === NO_EMISSION || surface.emissiveIntensity <= 0) return 0
  return tintLuminance(surface.emissive) * surface.emissiveIntensity
}

/** Every §4 slot's emissive reading in a theme, in `MATERIAL_SLOTS` order. */
export function emissiveRowsFor(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): EmissiveRow[] {
  return MATERIAL_SLOTS.map((slot) => {
    const surface = slotSurface(slot, theme)
    return {
      slot,
      tint: surface.emissive,
      intensity: surface.emissiveIntensity,
      luminance: emissiveLuminanceOf(surface),
    }
  })
}

/** The §4 slots that emit anything at all in this theme, in slot order. */
export function emittingRowsFor(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): EmissiveRow[] {
  return emissiveRowsFor(theme).filter((row) => row.luminance > 0)
}

/**
 * The dimmest emitting lens — the one that fixes the bloom threshold, because
 * it is the faintest thing the pass must still pick up. `undefined` for a theme
 * in which nothing emits at all (there is no emissive band to bloom).
 */
export function dimmestEmissiveRow(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): EmissiveRow | undefined {
  return emittingRowsFor(theme).reduce<EmissiveRow | undefined>(
    (dimmest, row) =>
      dimmest === undefined || row.luminance < dimmest.luminance ? row : dimmest,
    undefined,
  )
}

/** The brightest emitting lens — the head of the band, the panel wash. */
export function brightestEmissiveRow(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): EmissiveRow | undefined {
  return emittingRowsFor(theme).reduce<EmissiveRow | undefined>(
    (brightest, row) =>
      brightest === undefined || row.luminance > brightest.luminance ? row : brightest,
    undefined,
  )
}

/**
 * What the rig's ambient fill alone puts on a surface: the M4-T2
 * `RIG_AMBIENT_*` term read in the same luminance currency as the bloom
 * threshold. It must stay under `POST_LIT_LUMINANCE_CEILING` — otherwise the
 * fill itself would cross into the bloom band and smear the whole interior.
 */
export function ambientFillLuminance(): number {
  return tintLuminance(RIG_AMBIENT_COLOR) * RIG_AMBIENT_INTENSITY
}

/**
 * The two edges of the lit/emissive gap the threshold has to sit in. Authored
 * as a record rather than read from the constants inside every gate, so the
 * bands are an argument like every other gate input in this codebase: the
 * default is the real measurement (`POST_LIT_LUMINANCE_CEILING` and the rig's
 * own fill), and a test can hand the gates a doctored pair to prove they
 * refuse bands that have crossed.
 */
export interface BloomBands {
  /** Brightest a merely-lit surface may read (`POST_LIT_LUMINANCE_CEILING`). */
  litCeiling: number
  /** What the rig's ambient fill alone puts on a surface. */
  fillLuminance: number
}

/** The measured bands: the authored lit ceiling and the M4-T2 fill. */
export function bloomBands(): BloomBands {
  return {
    litCeiling: POST_LIT_LUMINANCE_CEILING,
    fillLuminance: ambientFillLuminance(),
  }
}

/**
 * Where the bloom threshold goes: the midpoint of the gap between the lit
 * ceiling and the dimmest emitting lens. Derived, never authored — retuning a
 * lens (or the fill) moves the threshold with it, and `bloomBandProblems`
 * refuses a theme whose bands have crossed (no gap to sit in).
 *
 * The band's HEAD (the brightest lens, `brightestEmissiveRow`) is what the
 * threshold CAP is calibrated against: `POST_BLOOM_THRESHOLD_MAX` is a fraction
 * of M4-T1's `PBR_EMISSIVE_INTENSITY_MAX`, the ceiling that head is measured
 * against in the registry.
 */
export function bloomThresholdFor(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): number {
  const floor = dimmestEmissiveRow(theme)
  if (floor === undefined) {
    throw new Error(
      `post recipe: theme '${theme.id}' has no emitting §4 slot, so bloom has no ` +
        `emissive band to pick out`,
    )
  }
  return (bands.litCeiling + floor.luminance) / 2
}

/** The bloom pass's authored parameters. */
export interface BloomRecipe {
  /** `BloomEffect` intensity: how much glow the pass adds. */
  intensity: number
  /** Luminance above which a pixel blooms. */
  luminanceThreshold: number
  /** Softness of that threshold. */
  luminanceSmoothing: number
  /** Mip-chain bloom (the budget choice). */
  mipmapBlur: boolean
  /** Glow spread. */
  radius: number
}

/** The bloom recipe for a theme: the authored strength at that theme's threshold. */
export function bloomRecipeFor(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): BloomRecipe {
  return {
    intensity: POST_BLOOM_INTENSITY,
    luminanceThreshold: bloomThresholdFor(theme, bands),
    luminanceSmoothing: POST_BLOOM_SMOOTHING,
    mipmapBlur: POST_BLOOM_MIPMAP_BLUR,
    radius: POST_BLOOM_RADIUS,
  }
}

/** The AO pass's authored parameters (postprocessing's `SSAOEffect` options). */
export interface SsaoRecipe {
  samples: number
  rings: number
  radius: number
  intensity: number
  fade: number
  luminanceInfluence: number
}

/** The one AO recipe the ship uses — see the constants above for each choice. */
export function ssaoRecipe(): SsaoRecipe {
  return {
    samples: POST_SSAO_SAMPLES,
    rings: POST_SSAO_RINGS,
    radius: POST_SSAO_RADIUS,
    intensity: POST_SSAO_INTENSITY,
    fade: POST_SSAO_FADE,
    luminanceInfluence: POST_SSAO_LUMINANCE_INFLUENCE,
  }
}

/** True when `value` is a finite number in `[min, max]`. */
function inRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  )
}

/** True when `value` is a prime integer (the ring count must be one). */
function isPrime(value: number): boolean {
  if (!Number.isInteger(value) || value < 2) return false
  for (let factor = 2; factor * factor <= value; factor += 1) {
    if (value % factor === 0) return false
  }
  return true
}

/**
 * What is wrong with the two BANDS the threshold sits between (empty = there is
 * a gap to sit in). Every clause is a measured fact about the layers below:
 *
 *  1. the theme's lenses must emit at all (no band → nothing to bloom);
 *  2. the dimmest lens must clear the lit ceiling (the gap exists — otherwise
 *     the pass either misses the faintest practical or blooms lit steel);
 *  3. the rig's own ambient fill must stay under the lit ceiling (a fill that
 *     crossed it would bloom the whole interior).
 *
 * The bands are an argument (see `BloomBands`), so both edges can be doctored
 * in a test; the default pair is the real measurement.
 */
export function bloomBandProblems(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): string[] {
  const problems: string[] = []
  const dimmest = dimmestEmissiveRow(theme)

  if (dimmest === undefined) {
    problems.push(
      `bloom: theme '${theme.id}' has no emitting §4 slot — there is no emissive ` +
        `band to bloom, so a luminance threshold would be arbitrary`,
    )
    return problems
  }

  if (dimmest.luminance <= bands.litCeiling) {
    problems.push(
      `bloom: the dimmest emitting lens ('${dimmest.slot}' at ${dimmest.luminance}) ` +
        `does not clear the lit ceiling (${bands.litCeiling}) — the lit and ` +
        `emissive bands have crossed`,
    )
  }

  if (bands.fillLuminance >= bands.litCeiling) {
    problems.push(
      `bloom: the rig ambient fill measures ${bands.fillLuminance}, at or over the lit ` +
        `ceiling (${bands.litCeiling}) — the fill itself would bloom`,
    )
  }

  return problems
}

/**
 * What is wrong with one bloom recipe (empty = a subtle, calibrated pass):
 * a strength inside the "subtle" cap, a threshold inside `(litCeiling, dimmest
 * lens)` — i.e. strictly between the two bands — and inside the emissive-band
 * cap, a legal smoothing, the mip-chain flavour, and a spread in range.
 */
export function bloomRecipeProblems(
  recipe: BloomRecipe,
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): string[] {
  const problems: string[] = []

  if (!inRange(recipe.intensity, 0, POST_BLOOM_INTENSITY_MAX)) {
    problems.push(
      `bloom: intensity ${recipe.intensity} is outside 0…${POST_BLOOM_INTENSITY_MAX} ` +
        `(the pass must stay subtle)`,
    )
  }

  const dimmest = dimmestEmissiveRow(theme)
  if (!(recipe.luminanceThreshold > 0)) {
    problems.push(
      `bloom: luminance threshold ${recipe.luminanceThreshold} must be positive`,
    )
  } else if (recipe.luminanceThreshold > POST_BLOOM_THRESHOLD_MAX) {
    problems.push(
      `bloom: luminance threshold ${recipe.luminanceThreshold} is over ` +
        `${POST_BLOOM_THRESHOLD_MAX} (an eighth of M4-T1's emissive ceiling)`,
    )
  } else if (dimmest !== undefined) {
    if (!(recipe.luminanceThreshold > bands.litCeiling)) {
      problems.push(
        `bloom: luminance threshold ${recipe.luminanceThreshold} is at or under the lit ` +
          `ceiling (${bands.litCeiling}) — lit surfaces would bloom`,
      )
    }
    if (!(recipe.luminanceThreshold < dimmest.luminance)) {
      problems.push(
        `bloom: luminance threshold ${recipe.luminanceThreshold} does not clear the ` +
          `dimmest emitting lens ('${dimmest.slot}' at ${dimmest.luminance}) — that ` +
          `practical would not bloom`,
      )
    }
  }

  if (!inRange(recipe.luminanceSmoothing, 0, POST_BLOOM_SMOOTHING_MAX)) {
    problems.push(
      `bloom: luminance smoothing ${recipe.luminanceSmoothing} is outside ` +
        `0…${POST_BLOOM_SMOOTHING_MAX}`,
    )
  }

  if (recipe.mipmapBlur !== true) {
    problems.push(
      'bloom: the pass must use the mip-chain blur (the full-kernel flavour is the ' +
        'one that costs the frame budget)',
    )
  }

  if (!inRange(recipe.radius, 0, POST_BLOOM_RADIUS_MAX)) {
    problems.push(
      `bloom: radius ${recipe.radius} is outside 0…${POST_BLOOM_RADIUS_MAX}`,
    )
  }

  return problems
}

/**
 * What is wrong with one AO recipe (empty = a legal, budget-shaped occluder):
 * a sample count that is real, inside the cost band, not a multiple of the ring
 * count; a prime ring count; a radius at or inside the tighter-than-default
 * cap; an intensity under the murk cap; a positive fade; and a legal
 * luminance influence.
 */
export function ssaoRecipeProblems(recipe: SsaoRecipe): string[] {
  const problems: string[] = []

  if (!inRange(recipe.rings, 2, Number.MAX_SAFE_INTEGER) || !isPrime(recipe.rings)) {
    problems.push(
      `ao: ring count ${recipe.rings} is not a prime (postprocessing requires one)`,
    )
  }

  if (!Number.isInteger(recipe.samples)) {
    problems.push(`ao: sample count ${recipe.samples} is not an integer`)
  } else if (!inRange(recipe.samples, POST_SSAO_SAMPLES_MIN, POST_SSAO_SAMPLES_MAX)) {
    problems.push(
      `ao: sample count ${recipe.samples} is outside ` +
        `${POST_SSAO_SAMPLES_MIN}…${POST_SSAO_SAMPLES_MAX} (the pass is full-screen: ` +
        `samples are its cost)`,
    )
  } else if (recipe.samples % recipe.rings === 0) {
    problems.push(
      `ao: sample count ${recipe.samples} is a multiple of the ring count ` +
        `${recipe.rings} (the ring pattern would alias into the sample count)`,
    )
  }

  if (!inRange(recipe.radius, 1e-6, POST_SSAO_RADIUS_MAX)) {
    problems.push(
      `ao: radius ${recipe.radius} is outside 1e-6…${POST_SSAO_RADIUS_MAX} — a wider ` +
        `radius carves shading out of open rooms instead of seating geometry`,
    )
  }

  if (!inRange(recipe.intensity, 0, POST_SSAO_INTENSITY_MAX)) {
    problems.push(
      `ao: intensity ${recipe.intensity} is outside 0…${POST_SSAO_INTENSITY_MAX} ` +
        `(PRD §4: no murky rooms)`,
    )
  }

  if (!(recipe.fade > 0)) {
    problems.push(
      `ao: fade ${recipe.fade} must be positive (it softens the occlusion edge)`,
    )
  }

  if (!inRange(recipe.luminanceInfluence, 0, POST_SSAO_LUMINANCE_INFLUENCE_MAX)) {
    problems.push(
      `ao: luminance influence ${recipe.luminanceInfluence} is outside ` +
        `0…${POST_SSAO_LUMINANCE_INFLUENCE_MAX}`,
    )
  }

  return problems
}

/**
 * The whole recipe's verdict: the bands, the bloom and the AO together (empty =
 * a calibrated, budget-shaped, subtle post chain). The budget half of M4-T3
 * lives in `plan.ts` — this is only about whether the pass is WELL FORMED.
 */
export function postRecipeProblems(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): string[] {
  const bandProblems = bloomBandProblems(theme, bands)
  if (bandProblems.length > 0) return bandProblems
  return [
    ...bloomRecipeProblems(bloomRecipeFor(theme, bands), theme, bands),
    ...ssaoRecipeProblems(ssaoRecipe()),
  ]
}

/** One theme's post recipe, with the band it was calibrated against. */
export interface PostRecipeReport {
  themeId: string
  /** The lit/emissive gap the threshold sits in. */
  bands: BloomBands
  /** The faintest lens that must still bloom (the threshold's upper bound). */
  dimmestLens: EmissiveRow | undefined
  /** The brightest lens (the band's head). */
  brightestLens: EmissiveRow | undefined
  bloom: BloomRecipe
  ssao: SsaoRecipe
  /** Empty = the chain is calibrated. */
  problems: string[]
  /** One-line summary for logs and tracker notes. */
  detail: string
}

/**
 * The whole recipe as a report: the two bands, both ends of the emissive band,
 * the two recipes and the verdict. Deriving it THROWS on a theme with nothing
 * emitting (there is no threshold to derive) — `postRecipeProblems` is the
 * non-throwing surface, and it is the report's own verdict field that a caller
 * should read first.
 */
export function postRecipeReport(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
  bands: BloomBands = bloomBands(),
): PostRecipeReport {
  const bloom = bloomRecipeFor(theme, bands)
  const ssao = ssaoRecipe()
  const dimmest = dimmestEmissiveRow(theme)
  const brightest = brightestEmissiveRow(theme)
  const problems = postRecipeProblems(theme, bands)

  const detail =
    `post recipe: bloom ${bloom.intensity} at threshold ` +
    `${bloom.luminanceThreshold.toFixed(3)} — in the gap between the lit ceiling ` +
    `${bands.litCeiling} and the dimmest lens ` +
    `${dimmest === undefined ? '(none)' : dimmest.luminance.toFixed(3)}` +
    `${brightest === undefined ? '' : `, band head ${brightest.luminance.toFixed(3)}`}; ` +
    `ao ${ssao.intensity} r${ssao.radius} ×${ssao.samples}o${ssao.rings}`

  return {
    themeId: theme.id,
    bands,
    dimmestLens: dimmest,
    brightestLens: brightest,
    bloom,
    ssao,
    problems,
    detail,
  }
}

/** Throw when the post recipe — or the bands it calibrates against — is broken. */
export function assertPostRecipeValid(
  theme: MaterialTheme = DEFAULT_MATERIAL_THEME,
): void {
  const problems = postRecipeProblems(theme)
  if (problems.length > 0) {
    throw new Error(
      `post recipe: the post-processing chain is not calibrated:\n  ` +
        problems.join('\n  '),
    )
  }
}
