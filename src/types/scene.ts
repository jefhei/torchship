/**
 * M1-T2 — Scene graph contract (PRD §7, "assembler → renderer").
 *
 * The assembler's output: per-deck merged geometry groups + instanced
 * kit-piece batches + named interactive transforms (hatches, screens, doors)
 * + a collision hull per deck. Material references are slot names, resolved
 * by the theme (src/types/materials.ts) — the renderer never invents
 * materials.
 *
 * This is a manifest contract, deliberately three-agnostic: nodes carry
 * stable ids, slot names, and grid-aligned transforms; the M3 renderer
 * attaches the actual merged BufferGeometry / InstancedMesh objects to the
 * nodes by id. The M6 glTF export walks the same structure (deck groups named
 * `deck-${deckIndex}`, slot names mapped to named export materials), so the
 * contract stays loadable by both the live renderer and the exporter.
 */

import type { Aabb3 } from './kit'
import type { MaterialSlot } from './materials'
import type { Rotation, Transform3, Vec3 } from './geometry'

/** Ship identity echoed onto the scene graph (self-describing output). */
export interface ShipIdentity {
  classId: string
  name: string
  registry: string
  seed: number
}

/** Provenance of a scene-graph entity: which kit module instance it came from. */
export interface ModuleSource {
  deckId: string
  moduleId: string
  /** Index into that deck's DeckSpec.modules array. */
  moduleIndex: number
}

/** The assembled ship, ready for the renderer. */
export interface SceneGraph {
  ship: ShipIdentity
  /** Deck nodes in nose → aft order (index 0 = head deck). */
  decks: DeckNode[]
}

/** Everything the renderer needs for one deck. */
export interface DeckNode {
  /** Deck id from the spec; export contract names the group `deck-${deckIndex}`. */
  deckId: string
  deckIndex: number
  /** World Y of the deck floor, meters. */
  floorY: number
  /**
   * Merged per-deck geometry groups — the M3-T7 merge/instance pass emits
   * ONE draw call per group (bulkhead/plate geometry merged per material).
   */
  geometry: GeometryGroup[]
  /** Instanced kit-piece batches on this deck (lockers, panel lights, conduit). */
  instances: InstanceBatch[]
  /** Named interactive elements with world transforms (hatches, screens, doors). */
  interactives: InteractiveElement[]
  /** Per-deck collision hull(s) merged from module collision hints (M3-T3). */
  collision: CollisionHull
}

/** One merged geometry group: a single draw call under one material slot. */
export interface GeometryGroup {
  /** Stable group id the renderer attaches merged geometry to. */
  id: string
  /** Material slot name — resolved to the theme's PBR set by the renderer. */
  materialSlot: MaterialSlot
  /** Kit modules merged into this group (traceability for QA and export). */
  sources: ModuleSource[]
}

/** An instanced batch of a repeated kit piece, all under one material slot. */
export interface InstanceBatch {
  /** Stable batch id the renderer attaches its InstancedMesh to. */
  id: string
  /** Kit piece instanced (locker, panel light, conduit run, …). */
  pieceId: string
  materialSlot: MaterialSlot
  /** One grid-aligned placement per instance. */
  placements: Transform3[]
}

/** Kinds of named interactive element the scene graph carries. */
export type InteractiveKind = 'hatch' | 'screen' | 'door'

/** A named interactive element with a world transform. */
export interface InteractiveElement {
  /** Stable element id — the renderer exposes this named transform. */
  id: string
  kind: InteractiveKind
  /** World position, meters (a hatch seals a door socket; a screen is an equipment slot). */
  position: Vec3
  rotation: Rotation
  /** Which kit module instance this element belongs to. */
  source: ModuleSource
}

/** Per-deck collision hull(s) merged from the placed modules' collision hints. */
export interface CollisionHull {
  /** Solid axis-aligned boxes in deck/world meters covering walls and kit. */
  boxes: Aabb3[]
}
