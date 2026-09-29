/**
 * M4-T4 — the authored worn-detail vocabulary (BUILD_PLAN M4-T4: "worn-detail
 * pass: clutter, paint patches, cable routing variation by seed").
 *
 * The pass is one sentence in the plan and three things in PRD §6: *clutter*,
 * *paint patches* and *cable routing*. Each is authored ONCE here as a small
 * vocabulary — the same posture as the M4-T1 PBR sets and the M4-T2 light
 * archetypes: a fixed set of shapes and slots that the seeded generator picks
 * from, so variation is *seeded selection and placement*, not unconstrained
 * authoring. Three consequences that matter:
 *
 *  - **no new §4 slots.** Everything the pass draws uses the existing nine-slot
 *    vocabulary, and `coffee-accent` is EXCLUDED (PRD §4: the one warm accent
 *    colour is reserved for the galley's coffee station) — gated in checks.ts;
 *  - **a tiny mould vocabulary keeps the draw-call cost bounded.** A detail's
 *    cost is not "one call per part": parts merge into their slot's group (free
 *    when the deck already draws that slot) and only a mould repeated on the
 *    deck becomes an instanced batch (one call). Keeping the shape vocabulary
 *    small is what makes the pass affordable — see `WEAR_CALLS_PER_DECK_MAX`;
 *  - **floor clutter is walk-over by construction.** A prop taller than the
 *    M3-T4 `STEP_HEIGHT_M` (0.25 m) would BLOCK a walker; every floor variant
 *    is authored under `WEAR_FLOOR_HEIGHT_MAX_M` so the deck stays walkable
 *    (pinned against `STEP_HEIGHT_M` in wear.test.ts).
 *
 * PRD §10's degradation ladder drops "prop/clutter density (fewer loose items
 * per module)" as its fourth rung: `WEAR_DENSITY_LEVELS` IS that rung — one
 * authored count triple per rung, applied per module instance by
 * `AssembleOptions.wearDensity`.
 */

import type { MaterialSlot } from '../types'
import type { WearDensity, WearFacet } from '../assembler/types'

/** The three facets in report order (paint patches, cable routing, clutter). */
export const WEAR_FACETS: readonly WearFacet[] = ['paint', 'cable', 'clutter']

/** How many of each facet one module instance carries, by density rung. */
export interface WearDensityRecipe {
  /** Paint patches on the module's own wall panels. */
  paint: number
  /** Cable routes dropped from the module's own light sockets. */
  cable: number
  /** Loose props on the module's deck plate. */
  clutter: number
}

/**
 * PRD §10's fourth degradation rung as data: `full` is the authored default
 * (a lived-in but not filthy ship — PRD §4 mood), `reduced` is what the frame
 * budget drops to first, `off` is the pre-M4-T4 ship (and the baseline every
 * draw-call measurement is taken against).
 */
export const WEAR_DENSITY_LEVELS: Readonly<Record<WearDensity, WearDensityRecipe>> = {
  full: { paint: 2, cable: 1, clutter: 3 },
  reduced: { paint: 1, cable: 1, clutter: 1 },
  off: { paint: 0, cable: 0, clutter: 0 },
}

/** The rungs, densest first — the order the ladder walks down. */
export const WEAR_DENSITY_ORDER: readonly WearDensity[] = ['full', 'reduced', 'off']

/** The default rung (PRD §4's lived-in read, under the §10 budget). */
export const DEFAULT_WEAR_DENSITY: WearDensity = 'full'

/* -------------------------------------------------------- paint patches */

/**
 * One authored paint-patch variant: a thin overlay plate that reads as a
 * repaint / touch-up / worn warning patch on a bulkhead (PRD §4 palette:
 * "faded navy-blue paint patches", hazard striping). `width` runs along the
 * wall, `height` up it; the thickness is one authored value so every patch
 * shares a mould family.
 */
export interface PaintPatchVariant {
  id: string
  materialSlot: MaterialSlot
  width: number
  height: number
}

/** Patch thickness (proud of the wall it is painted on), meters. */
export const PAINT_PATCH_THICKNESS_M = 0.012

export const PAINT_PATCH_VARIANTS: readonly PaintPatchVariant[] = [
  { id: 'repaint', materialSlot: 'bulkhead', width: 0.55, height: 0.4 },
  { id: 'touchup', materialSlot: 'bulkhead', width: 0.34, height: 0.26 },
  { id: 'warning', materialSlot: 'hazard', width: 0.3, height: 0.18 },
]

/** How high a patch may be mounted: clear of the floor and the ceiling. */
export const PAINT_PATCH_BAND_MIN_M = 0.9
export const PAINT_PATCH_BAND_MAX_M = 2.5

/* -------------------------------------------------------- cable routing */

/** Exposed cable/conduit drop radius (the kit's conduit is 0.05; a drop is thinner). */
export const CABLE_RUN_RADIUS_M = 0.03
/** How far a drop stops below its light socket (the fixture's own housing). */
export const CABLE_SOCKET_CLEARANCE_M = 0.12
/** Height of the wall-base run the drop lands on: a duct on the deck plate. */
export const CABLE_BASE_Y_M = CABLE_RUN_RADIUS_M
/** A base run's length band, meters (clamped to the wall panel it runs along). */
export const CABLE_BASE_RUN_MIN_M = 0.5
export const CABLE_BASE_RUN_MAX_M = 1.4
/**
 * Cable saddles on a drop: ONE, at mid-height (plus the base run's own bearing
 * on the plate). The count is deliberately minimal because it is a MOULD count,
 * not just a part count: two identical saddles per drop make a batch on every
 * deck that carries a route, and the long-haul ship is the tightest in the
 * fleet — measured at M4-T4, the extra call pushed it below the 24-call
 * headroom M4-T3's AO pass needs. One saddle per drop keeps every real ship's
 * frame budget, and the pass's cost stays inside `WEAR_CALLS_PER_DECK_MAX`.
 */
export const CABLE_CLAMPS_PER_DROP = 1
export const CABLE_CLAMP_M = 0.09
export const CABLE_CLAMP_NORMAL_M = 0.02
/** Light kinds a cable drop may be routed from (a screen is glass, not wired so). */
export const CABLE_LIGHT_KINDS: readonly string[] = ['panel']

/* --------------------------------------------------------------- clutter */

/**
 * One authored loose-prop variant. A box variant carries its extents `[x, y, z]`
 * in the module's own frame; the generator REORIENTS it (permutes the extents)
 * to lie against the wall it is stowed on rather than yawing it — a box needs
 * no quarter-turn to sit flush on an axis-aligned wall.
 */
export type ClutterVariant =
  | {
      id: string
      materialSlot: MaterialSlot
      kind: 'box'
      /** Box extents [x, y, z] in meters. */
      size: Vec3Tuple
    }
  | {
      id: string
      materialSlot: MaterialSlot
      kind: 'cylinder'
      radius: number
      length: number
    }

type Vec3Tuple = [number, number, number]

export const CLUTTER_VARIANTS: readonly ClutterVariant[] = [
  {
    id: 'spares-crate',
    materialSlot: 'bulkhead',
    kind: 'box',
    size: [0.34, 0.22, 0.26],
  },
  { id: 'tool-case', materialSlot: 'bulkhead', kind: 'box', size: [0.26, 0.16, 0.18] },
  {
    id: 'cable-coil',
    materialSlot: 'conduit',
    kind: 'cylinder',
    radius: 0.13,
    length: 0.14,
  },
  { id: 'strap-bundle', materialSlot: 'webbing', kind: 'box', size: [0.4, 0.14, 0.2] },
]

/**
 * A floor prop's back face is FLUSH with the wall it is stowed against (gap 0),
 * so the gate's contact rule can measure it with the same epsilon it uses for a
 * patch painted on that wall. Props hug the walls; the walk lane stays clear.
 */
export const CLUTTER_WALL_GAP_M = 0
/** A prop's lowest corner rests on the deck plate (floor at local y = 0). */
export const CLUTTER_FLOOR_Y_M = 0
/**
 * How low a wall panel must reach for a floor prop to lean on it: a doorway's
 * LINTEL is a wall panel too, so the prop's wall must come down to the plate.
 */
export const CLUTTER_WALL_REACH_M = 0.05

/* ------------------------------------------------------- shared bounds */

/**
 * Tallest allowed floor-clutter part, meters. Under the M3-T4 walk-over rule
 * (`STEP_HEIGHT_M` 0.25) a prop this tall is *stepped over*, never a blocker —
 * that is what lets every detail part be solid geometry without walling the
 * ship off. Pinned against `STEP_HEIGHT_M` in wear.test.ts.
 */
export const WEAR_FLOOR_HEIGHT_MAX_M = 0.22

/** A wall panel is a bulkhead box at least this tall and this wide, no thicker. */
export const WALL_MOUNT_MIN_HEIGHT_M = 1.2
export const WALL_MOUNT_MIN_WIDTH_M = 0.35
export const WALL_MOUNT_MAX_THICKNESS_M = 0.15

/* --------------------------------------------------- placement clearances */

/** Keep a wall detail this far off every door opening (its approach stays clear). */
export const WEAR_DOOR_REACH_WALL_M = 0.6
/** Keep a floor prop this far off every door opening — the walk-in lane. */
export const WEAR_DOOR_REACH_FLOOR_M = 1.6
/** Widen the door keep-clear zone this much across the face, meters. */
export const WEAR_DOOR_LATERAL_M = 0.5
/** Minimum gap between a generated part and any geometry it is NOT mounted on. */
export const WEAR_PART_CLEARANCE_M = 0.02
/** How many seeded candidates one detail may try before the density drops by one. */
export const WEAR_PLACEMENT_TRIES = 14

/* ------------------------------------------------------------------ gates */

/** Self-imposed frame cost of the pass: added draw calls per deck. */
export const WEAR_CALLS_PER_DECK_MAX = 8
/** A mounted part must TOUCH its mount within this (drawn flush/tangent), meters. */
export const WEAR_CONTACT_EPS_M = 0.002
/**
 * Tolerance on the walk-over cap: the cap is an authored design bound, not a
 * measurement, so a prop authored exactly AT it must not fail on the last
 * float ulp of a transformed bounds subtraction.
 */
export const WEAR_HEIGHT_EPS_M = 1e-9
/** Overlap allowed between a generated part and geometry it is not mounted on. */
export const WEAR_OVERLAP_EPS_M = 0.005
