/**
 * M0-T6 — spec-level analysis helpers the live invariant checks run on.
 *
 * The canonical fixture layout (src/fixtures/layout.ts) fixes one repeatable
 * attach pose: a rotation-0 room's standardized `spine-door` (its local −z
 * face, flush with the module's −z wall at the standard 1.0 m door-center
 * height) seats against the spine band's +z face, which stands at
 * z = SPINE_HALF_M on the deck-local origin column. This module measures how
 * far a module REF deviates from that pose — three independent channels that
 * map 1:1 onto the M0-T2 seam-spike measurements (docs/spikes.md):
 *
 *   lateral   — |offset.x|: the door center slides along the shaft face.
 *               A δ lateral offset → δ hatch misalignment (measured slope
 *               1.000).
 *   vertical  — |offset.y|: floor-pin drift lifts the door center off the
 *               standard 1.0 m height (offset.y is reserved 0 by the
 *               contract; a nonzero y is a floor-pin violation that becomes
 *               an exactly-δ vertical hatch miss).
 *   faceGap   — |offset.z − spineAttachOffsetZ(id)|: the door face stands
 *               off the shaft face along the join normal. A δ normal offset
 *               → an open seam of exactly δ.
 *
 * A module is SEATED on the shaft band when every channel is within the
 * measured hatch cap (SEAM_TOLERANCES.hatchAlignMm = 5 mm, M0-T2). This is
 * deliberately the coarse, socket-free half of PRD §8 bullets 2–3: it only
 * judges the canonical rot-0 spine-door pose that every fixture ref takes
 * (rotation ≠ 0 or a non-room id → not attributable → the M1-T3 socket
 * resolver owns it). All numbers are in millimeters (rounded to 0.001 mm —
 * below that is float noise, and the caps are 2/5 mm).
 *
 * Deck floors on the canonical grid (deckFloorYFor(index)) are included
 * here because they are the VERTICAL half of spine-run continuity: the
 * per-deck spine bands stack floor-to-floor, so an off-grid deck steps the
 * ladder run by exactly the floor error.
 */

import { spineAttachOffsetZ } from '../fixtures/layout'
import { ROOM_MODULE_IDS } from '../fixtures/layout'
import type { RoomModuleId } from '../fixtures/layout'
import { SEAM_TOLERANCES, withinHatchAlign } from '../spikes/seams/tolerances'
import { MM, deckFloorYFor } from '../types'
import type { DeckSpec, ModuleRef, ShipSpec } from '../types'

/** Meters → millimeters, rounded to 0.001 mm (float noise floor). */
function toMm(meters: number): number {
  return Math.round((meters / MM) * 1000) / 1000
}

/** True when the ref names one of the five room module types. */
function isRoomModuleId(moduleId: string): boolean {
  return (ROOM_MODULE_IDS as readonly string[]).includes(moduleId)
}

/** Per-channel deviation of a module ref from the canonical spine pose. */
export interface SpineSeatDeviationMm {
  /** |offset.x| — door center sliding along the shaft face, mm. */
  lateralMm: number
  /** |offset.y| — floor-pin drift off the standard 1.0 m door height, mm. */
  verticalMm: number
  /** |door face z − shaft face z| — open gap along the join normal, mm. */
  faceGapMm: number
  /**
   * Signed face gap, mm: positive = the door face stands proud of the spine
   * +z face (open seam pocket); negative = it is pushed into the shaft band.
   */
  faceGapSignedMm: number
}

/**
 * Measure a module ref against the canonical spine-attach pose, in mm.
 * Returns null when the coarse rule cannot judge the ref: a module id that
 * is not one of the five room types, or a rotation ≠ 0 (a rotated room
 * presents a different face to the shaft; only the M1-T3 socket resolver
 * can attribute it). Rotation-0 rooms always expose their standardized
 * spine-door to the shaft, so the pose deviation is fully determined by the
 * ref's offset and the module's footprint.
 */
export function spineSeatDeviationMm(ref: ModuleRef): SpineSeatDeviationMm | null {
  if (!isRoomModuleId(ref.moduleId) || ref.rotation !== 0) return null
  const id = ref.moduleId as RoomModuleId
  return {
    lateralMm: toMm(Math.abs(ref.offset[0])),
    verticalMm: toMm(Math.abs(ref.offset[1])),
    faceGapMm: toMm(Math.abs(ref.offset[2] - spineAttachOffsetZ(id))),
    faceGapSignedMm: toMm(ref.offset[2] - spineAttachOffsetZ(id)),
  }
}

/** True when a measured deviation is within the 5 mm hatch cap (all axes). */
export function isSeatedWithinHatch(dev: SpineSeatDeviationMm): boolean {
  return (
    withinHatchAlign(dev.lateralMm) &&
    withinHatchAlign(dev.verticalMm) &&
    withinHatchAlign(dev.faceGapMm)
  )
}

/**
 * Why a single module ref is not seated on the spine band, as human-readable
 * strings. Empty array = the module IS seated (attributable + every channel
 * within the hatch cap). Messages name the module and the measured channel
 * so a failing deck's report reads as a defect log entry.
 */
export function moduleSeatProblems(ref: ModuleRef): string[] {
  const dev = spineSeatDeviationMm(ref)
  if (dev === null) {
    return [
      `${ref.moduleId} (rotation ${ref.rotation}): not in the canonical rot-0 ` +
        `spine-attach pose — the coarse spec-level seat rule cannot verify it ` +
        `(the ${SEAM_TOLERANCES.hatchAlignMm} mm cap applies at socket level; M1-T3's resolver covers rotated placements)`,
    ]
  }
  const problems: string[] = []
  const cap = SEAM_TOLERANCES.hatchAlignMm
  if (dev.lateralMm > cap) {
    problems.push(
      `${ref.moduleId} spine-door center is ${dev.lateralMm.toFixed(1)} mm off the spine socket center laterally; cap ${cap} mm`,
    )
  }
  if (dev.verticalMm > cap) {
    problems.push(
      `${ref.moduleId} spine-door center sits ${dev.verticalMm.toFixed(1)} mm off the standard 1.0 m height ` +
        `(offset.y floor-pin drift); cap ${cap} mm`,
    )
  }
  if (dev.faceGapMm > cap) {
    const how =
      dev.faceGapSignedMm > 0
        ? 'proud of the spine +z face (open gap along the join normal)'
        : 'into the spine band (overlap)'
    problems.push(
      `${ref.moduleId} spine-door face is ${dev.faceGapMm.toFixed(1)} mm ${how}; cap ${cap} mm`,
    )
  }
  return problems
}

/** Per-deck spine-seat summary: is the deck ON the continuous shaft run? */
export interface DeckSeatSummary {
  deckId: string
  deckIndex: number
  /** True when ≥ 1 module on the deck seats flush on the spine band. */
  seated: boolean
  /** Human-readable reasons when the deck is not seated (empty when seated). */
  problems: string[]
}

/**
 * Judge one deck's shaft access: the deck sits on the continuous spine run
 * iff at least one of its modules seats flush on the shaft band (rot-0,
 * every channel within the hatch cap). Only failing decks carry problems —
 * a module that is not seated while another seats is a side-mate or a
 * socket-level question, which is M1-T3's resolver's job, not this run's.
 */
export function deckSeatSummary(deck: DeckSpec, deckIndex: number): DeckSeatSummary {
  if (deck.modules.length === 0) {
    return {
      deckId: deck.id,
      deckIndex,
      seated: false,
      problems: ['deck has no modules'],
    }
  }
  const perModule = deck.modules.map((m) => ({
    ref: m,
    problems: moduleSeatProblems(m),
  }))
  const seated = perModule.some((m) => m.problems.length === 0)
  const problems = seated ? [] : perModule.flatMap((m) => m.problems)
  return { deckId: deck.id, deckIndex, seated, problems }
}

/**
 * |deck floor Y − canonical grid Y| for its index, in mm (rounded). The
 * canonical grid is deckFloorYFor(index) — see src/types/units.ts.
 */
export function deckGridErrorMm(deck: DeckSpec, deckIndex: number): number {
  return toMm(Math.abs(deck.yPosition - deckFloorYFor(deckIndex)))
}

/** True when the deck hosts at least one module of the given type. */
export function deckHosts(deck: DeckSpec, moduleId: string): boolean {
  return deck.modules.some((m) => m.moduleId === moduleId)
}

/** Index of the deck hosting the named module type, or -1 when absent. */
export function findDeckHosting(spec: ShipSpec, moduleId: string): number {
  return spec.decks.findIndex((d) => deckHosts(d, moduleId))
}

/** Human description of the hatch cap used by the seat rule (shared wording). */
export function hatchCapDescription(): string {
  return `seated = every channel within ${SEAM_TOLERANCES.hatchAlignMm} mm (M0-T2 hatch cap)`
}
