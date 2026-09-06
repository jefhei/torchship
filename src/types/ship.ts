/**
 * M1-T2 — Ship Spec data contract (PRD §7).
 *
 * The ShipSpec is the interchange format between authoring and the M3
 * assembler: a typed deck plan the assembler turns into a scene graph, and
 * the object the M1-T3 validator checks (schema, socket alignment, spine
 * connectivity) against the canonical fixtures (M0-T5).
 *
 * Conventions:
 *  - decks[] is ordered nose → aft: index 0 is the head deck (bridge), the
 *    highest deck; floors descend along the thrust axis (−Y). The deck index
 *    is the array position, NOT a field — a spec with decks reordered
 *    silently renumbers the ship, so fixtures must keep canonical order.
 *  - DeckSpec.yPosition is the world Y of the deck's floor, in meters.
 *    Canonical specs place it at deckFloorYFor(index) (see units.ts); the
 *    M1-T3 validator checks the monotone nose→aft descent and grid
 *    consistency.
 *  - ModuleRef.offset is the module-local-origin position in deck-local
 *    space. A module's origin is the XZ center of its floor footprint with
 *    its floor on the deck plate, so offset.y is reserved and MUST be 0 —
 *    assembly is floor-pinned (M0-T2 decision 4); the validator rejects
 *    nonzero y as a floor-pinned violation. Vertical pathology lives in door
 *    sockets (declared non-standard door centers), never in refs.
 *  - Rotation is a quarter-turn yaw about +Y (0|1|2|3).
 */

import type { Rotation, Vec3 } from './geometry'

/** A typed deck plan — the authoring→assembler interchange format. */
export interface ShipSpec {
  /** Ship class id, e.g. 'hound' (Hound-class light corvette). */
  classId: string
  /** Vessel name — locked at build start: 'Firebrand' (BUILD_PLAN rule 9). */
  name: string
  /** Registry identifier, e.g. navy hull number. */
  registry: string
  /** Variation seed for kit-level detail (clutter, paint patches, cabling), M4-T4. */
  seed: number
  /** Decks ordered nose → aft: index 0 = head deck (highest Y). */
  decks: DeckSpec[]
}

/** One deck of the ship. */
export interface DeckSpec {
  /** Stable deck id; export contract names deck groups `deck-${index}` (M6). */
  id: string
  /** Human label, e.g. 'Head — bridge' or 'Crew deck'. */
  label: string
  /** World Y of this deck's floor, meters (thrust axis −Y). */
  yPosition: number
  /** Room modules placed on this deck (the spine band is implicit per deck). */
  modules: ModuleRef[]
}

/**
 * A reference to one kit module type placed on a deck. moduleId keys into the
 * KitManifest (src/types/kit.ts); the spine shaft is NOT referenced — the
 * assembler synthesizes one spine band per deck from the spec's deck list.
 */
export interface ModuleRef {
  /** Kit manifest module id, e.g. 'galley'. */
  moduleId: string
  /** Quarter-turn yaw about +Y applied to the module. */
  rotation: Rotation
  /**
   * Deck-local translation of the module origin, meters. y MUST be 0
   * (floor-pinned assembly — modules sit on the deck plate).
   */
  offset: Vec3
}
