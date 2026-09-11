/**
 * M2-T1 — the kit-primitive catalog: the authored default instance per
 * primitive, and the gate that keeps the table honest.
 *
 * The catalog is the interface M2-T2..T6 author the six room modules against
 * — "build each room type once from kit primitives" (BUILD_PLAN M2). Each
 * entry declares the local-frame box its DEFAULT instance occupies and the §4
 * slots that default draws from; `defaultPrimitiveParts(id)` generates that
 * instance through the same builders the modules use, and catalog.test.ts
 * asserts the two agree to 1e-9. So the table cannot drift from the geometry
 * it describes: change a builder and the gate tells you to update the table
 * (or the module footprint the M3 assembler reserved).
 *
 * Every default is a real, placeable instance — the M2-T7 harness renders
 * these standalone, and the M3 assembler sizes its deck clearance from them.
 * Non-default params (a wider locker bank, a taller ladder storey, a
 * non-standard hatch on engineering's high-hatch) are legal and are the
 * module authors' job.
 */

import {
  DECK_CLEAR_M,
  MATERIAL_SLOTS,
  STANDARD_DOOR_CENTER_M,
  STANDARD_DOOR_SIZE,
} from '../types'
import type { Aabb3, MaterialSlot, Vec3 } from '../types'
import {
  bulkheadParts,
  coffeeStationParts,
  conduitRunParts,
  couchParts,
  deckPlateParts,
  hatchParts,
  heatShieldParts,
  ladderSegmentParts,
  lockerParts,
  panelLightParts,
  screenParts,
  tableParts,
} from './parts'
import type {
  BulkheadParams,
  CoffeeStationParams,
  ConduitRunParams,
  CouchParams,
  DeckPlateParams,
  HatchParams,
  HeatShieldParams,
  LadderSegmentParams,
  LockerParams,
  PanelLightParams,
  ScreenParams,
  TableParams,
} from './parts'
import type { KitPrimitive, KitPart, PrimitiveCategory, PrimitiveId } from './types'

/* --------------------------------------------------------- default params */

const BULKHEAD_DEFAULT: BulkheadParams = {
  width: 4.8,
  height: DECK_CLEAR_M,
  thickness: 0.1,
  door: {
    width: STANDARD_DOOR_SIZE.width,
    height: STANDARD_DOOR_SIZE.height,
    centerY: STANDARD_DOOR_CENTER_M,
  },
}

const DECK_PLATE_DEFAULT: DeckPlateParams = {
  width: 4.8,
  depth: 5.0,
  thickness: 0.2,
  cableRuns: { count: 3, width: 0.12, height: 0.06, spacing: 1.6 },
}

const CONDUIT_RUN_DEFAULT: ConduitRunParams = {
  length: 3.0,
  radius: 0.05,
  axis: 'x',
  brackets: 4,
  clampThickness: 0.03,
}

const PANEL_LIGHT_DEFAULT: PanelLightParams = {
  width: 0.6,
  depth: 0.3,
  housingThickness: 0.06,
  lensInset: 0.08,
}

const HATCH_DEFAULT: HatchParams = {
  door: { width: STANDARD_DOOR_SIZE.width, height: STANDARD_DOOR_SIZE.height },
  leafThickness: 0.05,
  frameWidth: 0.05,
  clearance: 0.01,
}

const LADDER_SEGMENT_DEFAULT: LadderSegmentParams = {
  height: DECK_CLEAR_M,
  width: 0.45,
  railRadius: 0.03,
  rungRadius: 0.025,
  rungSpacing: 0.3,
}

const LOCKER_DEFAULT: LockerParams = {
  width: 0.9,
  height: 2.0,
  depth: 0.45,
  doors: 1,
  doorThickness: 0.03,
  doorGap: 0.02,
}

const SCREEN_DEFAULT: ScreenParams = {
  width: 0.7,
  height: 0.45,
  depth: 0.06,
  bezel: 0.03,
}

const COUCH_DEFAULT: CouchParams = {
  width: 0.8,
  depth: 0.9,
  seatHeight: 0.5,
  backHeight: 0.7,
  straps: 3,
}

const TABLE_DEFAULT: TableParams = {
  width: 1.6,
  depth: 0.8,
  height: 0.75,
  topThickness: 0.05,
  legRadius: 0.03,
}

const COFFEE_STATION_DEFAULT: CoffeeStationParams = {
  width: 1.0,
  height: 0.95,
  depth: 0.6,
  accentThickness: 0.04,
  carafeRadius: 0.07,
  carafeHeight: 0.22,
}

const HEAT_SHIELD_DEFAULT: HeatShieldParams = {
  width: 1.2,
  height: 0.8,
  thickness: 0.04,
  stripeHeight: 0.1,
}

/* --------------------------------------------------------------- catalog */

/**
 * The authored kit primitives, in the BUILD_PLAN M2-T1 vocabulary order
 * (bulkhead, deck plate, conduit, panel light, hatch, ladder, then the
 * equipment props) with the drive's heat shield last. `bounds` are the
 * local-frame extents of the DEFAULT instance above.
 */
export const KIT_PRIMITIVES: readonly KitPrimitive[] = [
  {
    id: 'bulkhead',
    label: 'Bulkhead panel (painted steel, optional doorway)',
    category: 'shell',
    bounds: { min: [-2.4, 0, -0.05], max: [2.4, DECK_CLEAR_M, 0.05] },
    materialSlots: ['bulkhead'],
    fillsSocket: false,
  },
  {
    id: 'deck-plate',
    label: 'Deck plate with cable runs (walking surface at local y = 0)',
    category: 'shell',
    bounds: { min: [-2.4, -0.2, -2.5], max: [2.4, 0.06, 2.5] },
    materialSlots: ['deckplate', 'conduit'],
    fillsSocket: false,
  },
  {
    id: 'conduit-run',
    label: 'Conduit / pipe run with clamps (exposed service routing)',
    category: 'utility',
    bounds: { min: [-1.5, -0.065, -0.065], max: [1.5, 0.065, 0.065] },
    materialSlots: ['bulkhead', 'conduit'],
    fillsSocket: false,
  },
  {
    id: 'panel-light',
    label: 'Recessed panel light (emissive lens in a bulkhead housing)',
    category: 'utility',
    bounds: { min: [-0.3, -0.048, -0.15], max: [0.3, 0.03, 0.15] },
    materialSlots: ['bulkhead', 'panel-light'],
    fillsSocket: false,
  },
  {
    id: 'hatch',
    label: 'Hatch (door leaf + frame, socket-centred on the door opening)',
    category: 'navigation',
    bounds: { min: [-0.5, -1.05, -0.0375], max: [0.5, 1.05, 0.0375] },
    materialSlots: ['bulkhead', 'hazard'],
    fillsSocket: true,
  },
  {
    id: 'ladder-segment',
    label: 'Ladder storey (rails + rungs, floor at local y = 0)',
    category: 'navigation',
    bounds: { min: [-0.225, 0, -0.03], max: [0.225, DECK_CLEAR_M, 0.03] },
    materialSlots: ['bulkhead', 'conduit'],
    fillsSocket: false,
  },
  {
    id: 'locker',
    label: 'Equipment locker bank (bulkhead body, conduit handles)',
    category: 'prop',
    bounds: { min: [-0.45, 0, -0.225], max: [0.45, 2.0, 0.275] },
    materialSlots: ['bulkhead', 'conduit'],
    fillsSocket: false,
  },
  {
    id: 'screen',
    label: 'Screen (bulkhead bezel, emissive glass panel)',
    category: 'prop',
    bounds: { min: [-0.35, -0.225, -0.03], max: [0.35, 0.225, 0.03] },
    materialSlots: ['bulkhead', 'screen'],
    fillsSocket: false,
  },
  {
    id: 'couch',
    label: 'Crash couch (pedestal, seat pan, backrest, webbing straps)',
    category: 'prop',
    bounds: { min: [-0.4, 0, -0.45], max: [0.4, 1.2, 0.45] },
    materialSlots: ['bulkhead', 'webbing'],
    fillsSocket: false,
  },
  {
    id: 'table',
    label: 'Table (bulkhead top on conduit pipe legs, bolted down)',
    category: 'prop',
    bounds: { min: [-0.8, 0, -0.4], max: [0.8, 0.75, 0.4] },
    materialSlots: ['bulkhead', 'conduit'],
    fillsSocket: false,
  },
  {
    id: 'coffee-station',
    label: 'Coffee station (the §4 warm-accent landmark, glass carafe, task light)',
    category: 'prop',
    bounds: { min: [-0.5, 0, -0.34], max: [0.5, 1.17, 0.35] },
    materialSlots: ['bulkhead', 'panel-light', 'screen', 'coffee-accent'],
    fillsSocket: false,
  },
  {
    id: 'heat-shield',
    label: 'Ceramic heat shield with worn hazard stripe (drive-adjacent)',
    category: 'thermal',
    bounds: { min: [-0.6, -0.4, -0.024], max: [0.6, 0.4, 0.024] },
    materialSlots: ['hazard', 'ceramic'],
    fillsSocket: false,
  },
] as const

/** Every primitive id, in catalog order. */
export const PRIMITIVE_IDS: readonly PrimitiveId[] = KIT_PRIMITIVES.map(
  (primitive) => primitive.id,
)

/** Look a primitive up by id; throws on unknown ids (typos fail loudly). */
export function getKitPrimitive(id: string): KitPrimitive {
  const primitive = KIT_PRIMITIVES.find((candidate) => candidate.id === id)
  if (primitive === undefined) {
    throw new Error(
      `kit primitive: no primitive "${id}" (known: ${PRIMITIVE_IDS.join(', ')})`,
    )
  }
  return primitive
}

/** The primitives in one category, in catalog order. */
export function primitivesInCategory(
  category: PrimitiveCategory,
  primitives: readonly KitPrimitive[] = KIT_PRIMITIVES,
): KitPrimitive[] {
  return primitives.filter((primitive) => primitive.category === category)
}

/** Nominal size [x, y, z] of a primitive's default instance, meters. */
export function primitiveDimensions(primitive: KitPrimitive): Vec3 {
  const { min, max } = primitive.bounds
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

/**
 * The §4 slots the authored kit collectively draws from, in MATERIAL_SLOTS
 * order. The M2-T7 harness + M4-T1 material pass diff their work against
 * this; today it is all nine slots, so no §4 surface is left unbuilt.
 */
export function kitPrimitiveMaterialSlots(
  primitives: readonly KitPrimitive[] = KIT_PRIMITIVES,
): MaterialSlot[] {
  const used = new Set<MaterialSlot>()
  for (const primitive of primitives) {
    for (const slot of primitive.materialSlots) used.add(slot)
  }
  return MATERIAL_SLOTS.filter((slot) => used.has(slot))
}

/* --------------------------------------------------------------- builders */

/**
 * Generate the DEFAULT instance of a primitive through its builder — the
 * exact parts the catalog's `bounds`/`materialSlots` describe. The switch is
 * exhaustive over `PrimitiveId`, so adding a primitive to the union without a
 * default here is a compile error, not a runtime surprise.
 */
export function defaultPrimitiveParts(id: PrimitiveId): KitPart[] {
  switch (id) {
    case 'bulkhead':
      return bulkheadParts(BULKHEAD_DEFAULT)
    case 'deck-plate':
      return deckPlateParts(DECK_PLATE_DEFAULT)
    case 'conduit-run':
      return conduitRunParts(CONDUIT_RUN_DEFAULT)
    case 'panel-light':
      return panelLightParts(PANEL_LIGHT_DEFAULT)
    case 'hatch':
      return hatchParts(HATCH_DEFAULT)
    case 'ladder-segment':
      return ladderSegmentParts(LADDER_SEGMENT_DEFAULT)
    case 'locker':
      return lockerParts(LOCKER_DEFAULT)
    case 'screen':
      return screenParts(SCREEN_DEFAULT)
    case 'couch':
      return couchParts(COUCH_DEFAULT)
    case 'table':
      return tableParts(TABLE_DEFAULT)
    case 'coffee-station':
      return coffeeStationParts(COFFEE_STATION_DEFAULT)
    case 'heat-shield':
      return heatShieldParts(HEAT_SHIELD_DEFAULT)
    default: {
      const unreachable: never = id
      throw new Error(`kit primitive: no default instance for "${String(unreachable)}"`)
    }
  }
}

/* ------------------------------------------------------------- integrity */

/**
 * Every way a primitives table can violate its own contract, as
 * human-readable problems. Empty array = the catalog is intact. Mirrors
 * `kitManifestProblems` (src/types/kit.ts): this checks the CATALOG, not how
 * a module places a primitive.
 */
export function kitPrimitiveProblems(primitives: readonly KitPrimitive[]): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()

  for (const primitive of primitives) {
    const where = `primitive "${primitive.id}"`
    if (seenIds.has(primitive.id)) {
      problems.push(`primitive id "${primitive.id}" is duplicated in the catalog`)
    }
    seenIds.add(primitive.id)

    if (primitive.label.trim() === '') problems.push(`${where}: label is required`)

    const { min, max } = primitive.bounds
    const axes = ['x', 'y', 'z']
    for (let axis = 0; axis < 3; axis++) {
      if (!(max[axis] > min[axis])) {
        problems.push(`${where}: bounds are empty on the ${axes[axis]} axis`)
      }
    }

    if (primitive.materialSlots.length === 0) {
      problems.push(`${where}: declares no material slots`)
    }
    const seenSlots = new Set<MaterialSlot>()
    for (const slot of primitive.materialSlots) {
      if (!MATERIAL_SLOTS.includes(slot)) {
        problems.push(`${where}: unknown material slot "${slot}"`)
      }
      if (seenSlots.has(slot)) {
        problems.push(`${where}: material slot "${slot}" is listed twice`)
      }
      seenSlots.add(slot)
    }

    // The declared slots must be in canonical order so consumers can diff by
    // index (partMaterialSlots emits MATERIAL_SLOTS order).
    const canonical = MATERIAL_SLOTS.filter((slot) => seenSlots.has(slot))
    if (canonical.join(',') !== primitive.materialSlots.join(',')) {
      problems.push(
        `${where}: material slots are not in MATERIAL_SLOTS order ` +
          `(got ${primitive.materialSlots.join(', ')}; want ${canonical.join(', ')})`,
      )
    }
  }

  return problems
}

/**
 * Catalog integrity gate: throws (listing every problem) when the authored
 * primitive table violates its contract. Tests, the M2-T7 harness and any
 * future catalog JSON call this so a malformed kit fails the build.
 */
export function assertKitPrimitivesIntegrity(
  primitives: readonly KitPrimitive[] = KIT_PRIMITIVES,
): void {
  const problems = kitPrimitiveProblems(primitives)
  if (problems.length > 0) {
    throw new Error(`kit primitive catalog integrity:\n- ${problems.join('\n- ')}`)
  }
}

/** Declared bounds as an explicit [min, max] pair (readability helper). */
export function primitiveBounds(primitive: KitPrimitive): Aabb3 {
  return primitive.bounds
}
