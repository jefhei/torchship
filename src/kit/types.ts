/**
 * M2-T1 — kit-primitive vocabulary (PRD §4 material vocabulary + BUILD_PLAN
 * M2-T1 "kit primitives").
 *
 * A kit primitive is the smallest authored piece the six room modules are
 * built from: a bulkhead panel, a deck plate, a conduit run, a panel light, a
 * hatch, a ladder segment, an equipment prop (locker, screen, couch, table,
 * coffee station) and the drive's ceramic heat shield. Modules (M2-T2..T6)
 * compose primitives; the M3 assembler merges/instances the parts; the M3-T2
 * seam pass generates mating geometry from door sockets only.
 *
 * The type side is deliberately three.js-agnostic (same rule as
 * src/types/geometry.ts and src/types/scene.ts): `KitPart`s are plain
 * boxes/cylinders in meters, tagged with the §4 material slot they draw from.
 * The R3F layer (src/kit/render/) maps them onto meshes at the boundary; the
 * pure builders in src/kit/parts.ts stay headless-testable (jsdom has no
 * WebGL — see src/test-setup.ts).
 */

import type { Aabb3 } from '../types/kit'
import type { MaterialSlot } from '../types/materials'
import type { Rotation, Vec3 } from '../types/geometry'

/** Axis a cylinder part runs along (three's default cylinder axis is Y). */
export type PartAxis = 'x' | 'y' | 'z'

/** An axis-aligned box part in the primitive's local frame, meters. */
export interface BoxPart {
  kind: 'box'
  /** §4 material slot this part's surface resolves to (never a raw material). */
  materialSlot: MaterialSlot
  /** Full extents [x, y, z], meters. */
  size: Vec3
  /** Centre of the box in the primitive's local frame, meters. */
  position: Vec3
  /** Quarter-turn yaw about +Y; omitted = 0 (axis-aligned). */
  rotation?: Rotation
}

/** A cylinder part (pipe, rung, rail, leg, carafe) in the local frame, meters. */
export interface CylinderPart {
  kind: 'cylinder'
  materialSlot: MaterialSlot
  radius: number
  length: number
  axis: PartAxis
  /** Centre of the cylinder in the primitive's local frame, meters. */
  position: Vec3
}

/** One generated piece of primitive geometry. */
export type KitPart = BoxPart | CylinderPart

/**
 * What a primitive is for. Keeps the module-authoring vocabularies from
 * collapsing into one undifferentiated bag of pieces.
 */
export type PrimitiveCategory = 'shell' | 'utility' | 'navigation' | 'prop' | 'thermal'

/** Every kit primitive the catalog knows (BUILD_PLAN M2-T1 list + heat shield,
 * glow window + radiation sign (M2-T5 reactor room), cargo crate (M2-T5 hold)). */
export type PrimitiveId =
  | 'bulkhead'
  | 'deck-plate'
  | 'conduit-run'
  | 'panel-light'
  | 'hatch'
  | 'ladder-segment'
  | 'locker'
  | 'screen'
  | 'couch'
  | 'table'
  | 'coffee-station'
  | 'suit-rack'
  | 'heat-shield'
  | 'glow-window'
  | 'radiation-sign'
  | 'cargo-crate'

/**
 * A catalog entry: what the primitive is, the local-frame box its default
 * instance occupies, and the §4 slots that default draws from. `bounds` is
 * the M2-T7 reference the authored modules and the assembler reason about —
 * it must match what `defaultPrimitiveParts(id)` actually generates (gated by
 * catalog.test.ts), so the table can never drift from the geometry.
 */
export interface KitPrimitive {
  id: PrimitiveId
  /** Human label (kit piece + §4 role). */
  label: string
  category: PrimitiveCategory
  /** Local-frame extents the default build occupies, meters. */
  bounds: Aabb3
  /** §4 slots the default build draws from, in MATERIAL_SLOTS order. */
  materialSlots: readonly MaterialSlot[]
  /**
   * True when the primitive is authored at a DoorSocket (its local origin is
   * the door centre, so the assembler can seat it on any socket) and seals
   * that opening. Only the hatch fills a socket — sockets are the ONLY join
   * interface (M0-T2 decision 1 / BUILD_PLAN rule 8).
   */
  fillsSocket: boolean
}

/** Where a primitive instance is placed: module-local position + quarter-turn yaw. */
export interface PrimitivePlacement {
  /** Module-local position of the primitive's local origin, meters. */
  position?: Vec3
  /** Quarter-turn yaw about +Y; omitted = 0. */
  rotation?: Rotation
}
