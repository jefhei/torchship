/**
 * M5-T2 — the scripted-walk vocabulary: a walk SCRIPT, the RECORDING it
 * produces, and the tuning constants the replay runs at.
 *
 * BUILD_PLAN M5-T2 is "scripted walk recorder (coffee-run path) for repeatable
 * review walks". The whole task exists so the M5-T3 Review Loop is not a vibe
 * check: a walk is a DATA artifact — an ordered list of world-space waypoints
 * plus the frame-by-frame trace a deterministic replay of it produces — so two
 * passes over the same ship can be compared, and a defect is a line with a
 * frame number rather than a memory.
 *
 * The vocabulary is deliberately three-agnostic (no React, no three, no DOM):
 * the recorder drives the M3-T5 navigation machine headlessly, exactly the way
 * `src/player/nav.test.ts` drives it, so the same walk that passes in CI is the
 * walk a human would take through the browser.
 *
 * UNITS AND DIRECTIONS are the repo's own: meters, world space, Y is the thrust
 * axis (nose = +Y, under-burn down = −Y), decks descend nose → aft in index and
 * in Y (src/types/units.ts), and camera yaw is `rotation.y` with yaw 0 facing
 * −z (src/types/geometry.ts).
 */

import type { Vec3 } from '../types'
import type { WalkerShape } from '../player/hull'

/**
 * Fixed replay frame delta (s). The recorder integrates at a fixed step so a
 * walk is bit-identical run to run — the whole point of a REVIEW walk is that
 * yesterday's pass and today's pass are the same walk. 1/60 s is comfortably
 * under the M3-T4 frame clamp (MAX_FRAME_DELTA_S = 0.05 s), so the nav machine
 * never clamps it and the recording's arithmetic is uniform.
 */
export const REVIEW_FRAME_DT_S = 1 / 60

/**
 * How close the walker's feet must come to a waypoint for it to count as
 * reached (m). Well inside a deck's open floor (the galley's walkway is ~2 m
 * wide) but bigger than a frame step at the walk speed (2.2 m/s × 1/60 s =
 * 0.037 m), so a waypoint is always reachable rather than skippable.
 */
export const WAYPOINT_ARRIVE_M = 0.2

/**
 * How close the walker must come to a planned route node to advance past it
 * (m). Half the route grid's cell pitch (0.1 m): the walker steps ~0.037 m per
 * frame, so it lands inside this radius on the first or second frame past the
 * node instead of overshooting to the far side.
 */
export const NODE_ARRIVE_M = 0.06

/**
 * Route-planning clearance margin (m): a grid cell is walkable only when the
 * walker's capsule clears every hull box by this much ON TOP of its own radius.
 * The M3-T4 solver lets a walker touch a wall (sliding contact is legal), so a
 * plan that hugged geometry would be valid but fragile; the margin keeps the
 * planned line visibly clear of the kit.
 */
export const CLEARANCE_MARGIN_M = 0.03

/**
 * Frames without reducing the distance to the current waypoint before the
 * recorder replans (2 s at 1/60 s). A walker that a slide has wedged in a
 * corner should re-route rather than press into the wall forever.
 */
export const MAX_STALL_FRAMES = 120

/** Replans before a walk is declared stuck (the recorder gives up honestly). */
export const MAX_REPLANS = 8

/** What a waypoint is for, so a report can group a walk's legs. */
export type WaypointKind =
  /** The pose the session starts at (the walk's origin). */
  | 'spawn'
  /** A §4 landmark the walk must reach (the coffee station). */
  | 'landmark'
  /** A leg back to the origin (the walk closes its loop). */
  | 'return'

/** One place a scripted walk must pass through. */
export interface WalkWaypoint {
  /** Stable id within the script ('spawn', 'coffee-station', 'return'). */
  id: string
  kind: WaypointKind
  /** The walker's FEET target, world meters (the eye is EYE_HEIGHT_M above). */
  point: Vec3
  /** The deck the waypoint stands on (a walk may not silently change decks). */
  deckIndex: number
  /** Human label for reports, e.g. 'The coffee station'. */
  label: string
  /** How the point was derived (report/debug — never hand-authored). */
  note: string
}

/** A repeatable walk: a named route through the ship, as an ordered waypoint list. */
export interface WalkScript {
  /** The ship the script was derived for (identity name). */
  ship: string
  /** What kind of walk this is ('coffee-run', a future 'bridge-run', …). */
  kind: string
  /** The waypoints, in the order the walk must pass through them. */
  waypoints: WalkWaypoint[]
}

/** One frame of a recorded walk: the machine's outcome plus the input that drove it. */
export interface WalkFrame {
  /** 0-based frame index. */
  index: number
  /** Simulated time at the frame's start, seconds. */
  t: number
  /** The walker's feet after the frame, world meters. */
  feet: Vec3
  /** Camera yaw the autopilot commanded this frame, radians. */
  yaw: number
  /** Deck the walker stands on after the frame. */
  deckIndex: number
  /** The navigation phase this frame ('walk' or 'climb'). */
  phase: 'walk' | 'climb'
  /** Horizontal distance travelled this frame, meters. */
  movedM: number
  /** True when hull geometry cut the step short. */
  blocked: boolean
  /** True when a supporting surface is under the footprint. */
  grounded: boolean
  /** True when the frame's fall was arrested at the bottom of the spine run. */
  arrested: boolean
  /** Boxes the healer had to push the walker out of at the frame's start. */
  depenetrations: number
  /** Index of the waypoint the walk was heading for this frame. */
  waypointIndex: number
}

/** The moments worth reporting out of a walk, with the frame they happened on. */
export type WalkEventKind =
  /** A waypoint was reached. */
  | 'waypoint'
  /** The route to the current waypoint was replanned (a stall recovery). */
  | 'replanned'
  /** The walk gave up: no progress for too long. */
  | 'stalled'
  /** No route exists to the current waypoint (an unwalkable target). */
  | 'unreachable'
  /** The walker is on a different deck from its next waypoint. */
  | 'deck-change'
  /** The walker unexpectedly mounted a ladder (a walking script must not). */
  | 'climb'

/** One reported moment of a walk. */
export interface WalkEvent {
  frame: number
  kind: WalkEventKind
  detail: string
}

/** What happened at one waypoint of a script. */
export interface WaypointResult {
  id: string
  kind: WaypointKind
  /** The waypoint's human label, copied so a report need not re-look it up. */
  label: string
  /** True when the walker came within WAYPOINT_ARRIVE_M of the point. */
  reached: boolean
  /** The frame it was reached on, or null. */
  frame: number | null
  /** Closest the walker's feet got to the point, meters. */
  closestM: number
}

/** The full trace of one scripted walk over one assembled ship. */
export interface WalkRecording {
  /** The ship the walk was recorded on (identity name). */
  ship: string
  /** The script that drove it. */
  script: WalkScript
  /** Every simulated frame, in order. */
  frames: WalkFrame[]
  /** The reported moments (waypoint arrivals, stalls, replans, a climb). */
  events: WalkEvent[]
  /** Per-waypoint outcome, in script order. */
  waypoints: WaypointResult[]
  /** Frames simulated. */
  framesRun: number
  /** Simulated elapsed time, seconds. */
  elapsedS: number
  /** Total horizontal distance travelled, meters. */
  distanceM: number
  /** Decks the walker stood on, in first-visit order. */
  decksVisited: number[]
  /** Largest depenetration count seen on any frame. */
  maxDepenetrations: number
  /** True when the final waypoint was reached. */
  complete: boolean
  /** True when the walk stopped early (frame budget, stall, or unreachable). */
  truncated: boolean
}

/** Options the recorder accepts (all optional; the defaults are the review settings). */
export interface WalkOptions {
  /** Replay frame delta, seconds (default REVIEW_FRAME_DT_S). */
  dt?: number
  /** Frame budget before the walk is declared truncated (default 3600 = 60 s). */
  maxFrames?: number
  /** Waypoint arrival radius, meters (default WAYPOINT_ARRIVE_M). */
  waypointRadiusM?: number
  /** Route-node arrival radius, meters (default NODE_ARRIVE_M). */
  nodeRadiusM?: number
  /** How far a route may snap a start/target to reach a walkable cell (cells). */
  maxSnapCells?: number
  /** The walker's collision shape (default the standing shape). */
  shape?: WalkerShape
}
