/**
 * M3-T1 — assembler vocabulary (BUILD_PLAN M3-T1: "stack decks from spec, join
 * modules at door sockets, generate spine run; emit merged per-deck geometry +
 * instanced kit batches").
 *
 * The assembler turns a `ShipSpec` (the authoring interchange format,
 * src/types/ship.ts) plus the authored kit (src/kit/) into the M1-T2
 * `SceneGraph` contract the renderer (M3-T7/M4) and the exporter (M6) consume.
 *
 * These types are the assembler's OWN intermediate model — richer than the
 * scene graph, and deliberately three-agnostic like every contract in this
 * repo:
 *
 *  - `PlacedModule` is one module INSTANCE on a deck: a spec ref's module (or
 *    the implicit per-deck shaft band, M2-T6) with its world origin, its door
 *    sockets and collision boxes in world space, and its kit parts placed;
 *  - `PlacedPart` carries provenance (which module instance built it) and the
 *    canonical instancing key;
 *  - `GroupPlan` / `BatchPlan` are the two halves of the per-deck geometry
 *    partition (merged-by-slot groups + instanced repeated shapes) behind
 *    `DeckNode.geometry` / `DeckNode.instances`;
 *  - `DeckJoin` / `SocketScan` are the socket joins the deck actually
 *    forms — M3-T2 generates its mating geometry from exactly these, never
 *    freehand (BUILD_PLAN rule 8), and M3-T5 walks them.
 *
 * Everything here is meters, world space (deck floors at
 * `deckFloorYFor(deckIndex)`, nose → aft), with grid-aligned quarter-turn
 * yaws — the same conventions as src/types/geometry.ts.
 */

import type {
  Aabb3,
  DeckNode,
  GeometryGroup,
  InstanceBatch,
  KitManifest,
  MaterialSlot,
  ModuleSource,
  Rotation,
  SceneGraph,
  ShipSpec,
  Vec3,
} from '../types'
import type { KitPart, PartAxis } from '../kit/types'
import type { AuthoredModule } from '../kit/modules/types'
import type { PlacedDoor } from '../validation'

/**
 * One kit part placed in world space, with provenance and its canonical
 * instancing key.
 */
export interface PlacedPart {
  /** The world-space part (module origin + yaw + any part-local yaw baked in). */
  part: KitPart
  /** §4 material slot the part's surface resolves to. */
  materialSlot: MaterialSlot
  /** Canonical instancing key (mould shape + slot) — see batches.ts. */
  pieceId: string
  /** Which module instance built this part. */
  source: ModuleSource
}

/**
 * One authored module instantiated on a deck: a spec ref's room, or the
 * implicit per-deck shaft band the assembler synthesizes (src/types/ship.ts —
 * the spine is never referenced in specs).
 */
export interface PlacedModule {
  /** Provenance: deck id, kit module id, spec index (−1 for the shaft band). */
  source: ModuleSource
  deckIndex: number
  /** The authored module this instance was built from. */
  module: AuthoredModule
  /** World position of the module's local origin, meters (floor-pinned). */
  origin: Vec3
  /** Quarter-turn yaw applied to the module (spec refs only; the band is 0). */
  rotation: Rotation
  /** The module's door sockets in world space (centers, facings, openings). */
  doors: PlacedDoor[]
  /** The module's collision hint in world space (one box per solid part). */
  boxes: Aabb3[]
  /** The module's kit parts in world space, in build order. */
  parts: PlacedPart[]
  /** True for the synthesized shaft band (never named by a spec ref). */
  band: boolean
}

/** What two joined doors are: a room landing on the shaft, or room↔room. */
export type JoinKind = 'spine' | 'module'

/**
 * A join the deck actually forms: two door sockets whose wall faces engage and
 * whose openings line up as a pass-through, measured on the three M0-T2
 * channels (mm; see src/validation/sockets.ts doorCenterDeviationMm).
 */
export interface DeckJoin {
  kind: JoinKind
  /** The reference door: its outward normal is the join normal. */
  a: PlacedDoor
  b: PlacedDoor
  /** Signed along-normal separation, mm (positive = `b` stands proud). */
  normalMm: number
  /** In-plane horizontal separation along the wall face, mm. */
  lateralMm: number
  /** Door-center height disagreement, mm. */
  verticalMm: number
  /** True when all three channels are within the M0-T2 hatch cap. */
  aligned: boolean
}

/** Every socket verdict of one deck: the joins formed, and the blanks. */
export interface SocketScan {
  joins: DeckJoin[]
  /**
   * Door sockets that join nothing. Legal by the kit contract (the module
   * carries its full socket set; the ship blanks what it does not join) —
   * M3-T2 generates the closing sleeve from the socket itself.
   */
  blanks: PlacedDoor[]
}

/**
 * The mould an instanced batch repeats: the canonical shape every instance is
 * a translated, yawed copy of. Boxes are moulded axis-aligned (their yaw lives
 * in the instance placement); cylinders are moulded along their own axis,
 * 'x' for the XZ axis pair ('y' stays 'y' — a yaw cannot re-axis it).
 */
export interface PieceShape {
  /** Canonical key: kind + slot + exact dimensions (+ mould axis). */
  id: string
  kind: 'box' | 'cylinder'
  materialSlot: MaterialSlot
  /** Box extents [x, y, z] in meters (kind 'box'). */
  size?: Vec3
  /** Cylinder radius, meters (kind 'cylinder'). */
  radius?: number
  /** Cylinder length, meters (kind 'cylinder'). */
  length?: number
  /** The cylinder's mould axis: the shape every instance is yawed from. */
  mouldAxis?: Extract<PartAxis, 'x' | 'y'>
}

/** One merged geometry group plus the parts it merges (one draw call). */
export interface GroupPlan {
  group: GeometryGroup
  /** The deck's non-instanced parts drawing this group's slot, in build order. */
  parts: PlacedPart[]
}

/** One instanced batch plus the parts it instances. */
export interface BatchPlan {
  batch: InstanceBatch
  /** The mould every placement repeats. */
  shape: PieceShape
  /** The world parts instanced, in build order (batch.placements is parallel). */
  parts: PlacedPart[]
}

/** Everything the assembler produced for one deck. */
export interface DeckAssembly {
  /** The M1-T2 scene-graph node (geometry + instances + interactives + hull). */
  node: DeckNode
  deckIndex: number
  deckId: string
  /** Human deck label from the spec. */
  label: string
  /** World Y of the deck floor, meters. */
  floorY: number
  /** The deck's module instances: rooms in spec order, then the shaft band. */
  modules: PlacedModule[]
  /** The implicit shaft band (also a member of `modules`). */
  band: PlacedModule
  /** Joins this deck forms (spine landings + room-to-room mates). */
  joins: DeckJoin[]
  /** Door sockets that join nothing (legal blanks — M3-T2 sleeves them). */
  blanks: PlacedDoor[]
  /** The geometry partition behind `node.geometry`. */
  groups: GroupPlan[]
  /** The instancing partition behind `node.instances`. */
  batches: BatchPlan[]
}

/** One shaft band of the generated spine run. */
export interface SpineBandRun {
  deckIndex: number
  deckId: string
  /** World Y of this deck's floor (the band's floor plane), meters. */
  floorY: number
  /** World position of the band's local origin (the shaft axis at this floor). */
  position: Vec3
  rotation: Rotation
}

/** The assembler's full output: the scene graph plus its provenance model. */
export interface ShipAssembly {
  spec: ShipSpec
  /** The M1-T2 scene graph the renderer attaches geometry to. */
  graph: SceneGraph
  decks: DeckAssembly[]
  /** One band per deck, nose → aft — the continuous vertical run. */
  spineRun: SpineBandRun[]
}

/** Inputs the assembler can be pointed at (tests inject broken kits/specs). */
export interface AssembleOptions {
  /**
   * The kit contract the spec refs resolve against. Defaults to the manifest
   * derived from `modules` (so a custom `modules` list is self-consistent).
   */
  kit?: KitManifest
  /** The authored modules to build from; defaults to AUTHORED_MODULES. */
  modules?: readonly AuthoredModule[]
  /**
   * Minimum occurrences of one mould shape on a deck for it to become an
   * instanced batch; shapes below it merge into their slot's geometry group.
   * Default 2 (M3-T7 may re-partition the exposed part list to chase its
   * draw-call ceiling).
   */
  minInstances?: number
  /**
   * Validate the spec (src/validation assertValidShipSpec) before assembling.
   * Default true — an invalid spec never reaches the walker. Tests pass false
   * to inspect what the assembler does with a rejected spec.
   */
  requireValidSpec?: boolean
}
