/**
 * M0-T2 spike — [auto] invariant tolerances, fixed from measured numbers.
 *
 * PRD §8 states the two seam invariants with bracketed, guessed tolerances:
 *   - module seams watertight: gap < 2 mm
 *   - hatch alignment: sockets land within 5 mm; no dangling sockets
 * Spike 2 exists to fix these from real measurements (BUILD_PLAN M0-T2).
 * The values below are the spike's output contract — M0-T6 (invariant
 * stubs) and M1-T3 (spec validator) import these, never re-derive them.
 *
 * Measured basis (seamStress.test.ts report card + docs/spikes.md):
 *  - Socket-solved joins of all six module types are exact to float
 *    precision: 78 joins @ zero offset, max seam gap / lateral / vertical /
 *    floor step all 0.000000 mm. The tolerance ceiling is set by error
 *    sources, not by the join math.
 *  - Response to spec offsets is linear and axis-separated (slope 1.000,
 *    measured across 5 room types × both placement policies): a normal
 *    offset δ becomes an open seam of exactly δ; a lateral δ becomes hatch
 *    misalignment of exactly δ; a vertical δ is either swallowed by the
 *    floor pin (door still mates) or becomes a δ door miss + δ floor step
 *    under a door solve.
 *  - Authoring noise ±ε at sockets (both sides): the mated door is immune
 *    in-plane (placement snaps the socket onto its target — gap/lateral
 *    measure 0.000 mm), but door-center height noise reaches 2ε (measured
 *    0.692 mm @ ±0.5 mm) and in-plane noise propagates rigidly to the
 *    module's far bulkhead face (≤ 2ε; measured 0.278 mm @ ±0.5 mm) — the
 *    channel that governs edge-to-edge bulkhead meets.
 *  - ε = 0.5 mm is the authoring ceiling: its 2ε = 1.0 mm bounds clear the
 *    2 mm watertight cap with exactly 2× margin and the 5 mm hatch cap with
 *    5× margin; at ε = 1.0 mm the 2ε = 2.0 mm bound equals the watertight
 *    cap with zero headroom.
 *  - Any spec offset ≥ 10 mm, and any authored door-center deviation (e.g.
 *    engineering's 1.2 m high-hatch mated to a standard 1.0 m door, which
 *    measures a 200 mm step), exceeds both caps — those joins are SPEC
 *    ERRORS the validator must reject (the negative cases M0-T5(d)'s
 *    pathological offset-hatch fixture exists to carry).
 */

export const SEAM_TOLERANCES = {
  /** Bulkhead-face gap at any door-socket join / module meet, mm (strict). */
  watertightGapMm: 2,
  /** Door-socket center misalignment (lateral or vertical), mm (inclusive). */
  hatchAlignMm: 5,
  /**
   * Authoring-error budget at door sockets, mm per axis (±). Measured
   * ceiling: keep kit socket placement within this or the 2× margin under
   * the watertight cap is lost.
   */
  maxSocketAuthoringErrorMm: 0.5,
  /** Standard door-center height above the deck floor, meters (kit rule). */
  standardDoorCenterM: 1.0,
} as const

/** PRD §8 watertight check: gap must be strictly under the cap. */
export function withinWatertight(gapMm: number): boolean {
  return Math.abs(gapMm) < SEAM_TOLERANCES.watertightGapMm
}

/** PRD §8 hatch-alignment check: misalignment may touch the cap. */
export function withinHatchAlign(mm: number): boolean {
  return Math.abs(mm) <= SEAM_TOLERANCES.hatchAlignMm
}
