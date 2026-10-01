/**
 * M5-T2 — the walk recorder: replay a `WalkScript` headlessly through the M3-T5
 * navigation machine and keep the whole trace.
 *
 * This is the machine that makes a REVIEW walk repeatable. It owns one small
 * autopilot and nothing else:
 *
 *  1. TARGET — the walk is aiming at its next waypoint. If the walker is within
 *     the arrival radius of it, the waypoint is done and the next one is taken
 *     (a waypoint that is never reached is data too — it stays unreached and the
 *     gate reports it);
 *  2. ROUTE — otherwise the autopilot plans a fresh route to the waypoint across
 *     the deck's walkable grid (route.ts, derived from the ship's own hull) and
 *     walks its cell centres in order;
 *  3. STEER — every frame the camera yaw is pointed at the current route node
 *     (yaw is the only control the walker has over its own heading:
 *     `Math.atan2(-dx, -dz)` is the yaw that lays the camera's −z forward axis
 *     on the direction of travel), and the walk command is full forward at the
 *     fixed replay step;
 *  4. RECOVER — a walker that has not closed on its waypoint for a while has
 *     been wedged by a slide, so the route is replanned from where it actually
 *     is; after enough failed replans the recorder stops and says so rather than
 *     spinning in the frame budget.
 *
 * The autopilot is deliberately NOT a keyframe list. A recorded sequence of
 * yaws and WASD held-key runs would bake in one ship's geometry (the wear pass,
 * the seam plugs and the shaft band all move the free floor between ships).
 * Planning against the same hull the walker is solved against is what lets the
 * SAME script complete on all four canonical fixtures — which is exactly the
 * property M5-T3's Review Loop needs.
 *
 * Deterministic by construction: a fixed frame step, no randomness, a
 * fixed-order search, and a pure frame step (src/player/nav.ts) — so two
 * recordings of the same script over the same ship are deep-equal, and a diff
 * between two passes is a real change in the ship rather than replay noise.
 */

import type { Vec3 } from '../types'
import type { ShipAssembly } from '../assembler'
import { clampFrameDelta } from '../player/move'
import { STANDING_SHAPE } from '../player/hull'
import { deckIndexAtY } from '../player/walker'
import {
  initialNavState,
  stepNav,
  type NavigationWorld,
  type NavState,
} from '../player/nav'
import {
  ROUTE_SNAP_CELLS,
  deckRouteGrid,
  planRoute,
  type DeckRouteGrid,
  type GridPoint,
} from './route'
import {
  MAX_REPLANS,
  MAX_STALL_FRAMES,
  NODE_ARRIVE_M,
  REVIEW_FRAME_DT_S,
  WAYPOINT_ARRIVE_M,
  type WalkEvent,
  type WalkFrame,
  type WalkOptions,
  type WalkRecording,
  type WalkScript,
  type WaypointResult,
} from './types'

/** Default frame budget: 60 s of simulated time (3600 frames at 1/60 s). */
export const DEFAULT_MAX_FRAMES = 3600

/** One point as the reports write it. */
function fmtVec(v: Vec3): string {
  return `${v[0].toFixed(3)}, ${v[1].toFixed(3)}, ${v[2].toFixed(3)}`
}

/**
 * Replay a scripted walk over an assembled ship and return the full trace. See
 * the module doc for the autopilot; `options` tunes the step, the budget and the
 * arrival radii (the defaults are the review settings in ./types).
 */
export function recordWalk(
  ship: ShipAssembly,
  world: NavigationWorld,
  script: WalkScript,
  options: WalkOptions = {},
): WalkRecording {
  const dt = clampFrameDelta(options.dt ?? REVIEW_FRAME_DT_S)
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES
  const waypointArrive = options.waypointRadiusM ?? WAYPOINT_ARRIVE_M
  const nodeArrive = options.nodeRadiusM ?? NODE_ARRIVE_M
  const maxSnapCells = options.maxSnapCells ?? ROUTE_SNAP_CELLS
  const shape = options.shape ?? STANDING_SHAPE

  const waypoints = script.waypoints
  const results: WaypointResult[] = waypoints.map((waypoint) => ({
    id: waypoint.id,
    kind: waypoint.kind,
    label: waypoint.label,
    reached: false,
    frame: null,
    closestM: Infinity,
  }))
  const frames: WalkFrame[] = []
  const events: WalkEvent[] = []
  let distanceM = 0
  let maxDepenetrations = 0
  let truncated = false

  if (waypoints.length === 0) {
    return {
      ship: script.ship,
      script,
      frames,
      events,
      waypoints: results,
      framesRun: 0,
      elapsedS: 0,
      distanceM: 0,
      decksVisited: [],
      maxDepenetrations: 0,
      complete: true,
      truncated: false,
    }
  }

  // One walkable grid per deck, built lazily and reused (the grid is stable).
  const grids = new Map<number, DeckRouteGrid | null>()
  const gridFor = (deckIndex: number): DeckRouteGrid | null => {
    if (!grids.has(deckIndex)) {
      grids.set(deckIndex, deckRouteGrid(ship, world, deckIndex, shape))
    }
    return grids.get(deckIndex) ?? null
  }

  let nav: NavState = initialNavState(waypoints[0].point)
  const decksVisited: number[] = [deckIndexAtY(world.walker, waypoints[0].point[1])]

  let waypointIndex = 0
  let route: GridPoint[] | null = null
  let routeCursor = 0
  let lastDistance = Infinity
  let stallFrames = 0
  let replans = 0
  let yaw = 0

  for (let frame = 0; frame < maxFrames;) {
    if (waypointIndex >= waypoints.length) {
      break
    }
    const target = waypoints[waypointIndex]
    const result = results[waypointIndex]

    if (nav.phase === 'climb') {
      events.push({
        frame,
        kind: 'climb',
        detail: `the walker mounted the ladder at frame ${frame} — a walking script must not climb`,
      })
      truncated = true
      break
    }

    const feet: Vec3 = nav.walker.feet
    const distance = Math.hypot(target.point[0] - feet[0], target.point[2] - feet[2])
    result.closestM = Math.min(result.closestM, distance)

    const deck = deckIndexAtY(world.walker, feet[1])
    if (deck !== target.deckIndex) {
      events.push({
        frame,
        kind: 'deck-change',
        detail: `the walker is on deck ${deck}, but the next waypoint "${target.id}" is on deck ${target.deckIndex}`,
      })
      truncated = true
      break
    }
    if (distance <= waypointArrive) {
      result.reached = true
      result.frame = frame
      events.push({
        frame,
        kind: 'waypoint',
        detail: `reached "${target.id}" (${target.label}) at (${fmtVec(feet)})`,
      })
      waypointIndex += 1
      route = null
      routeCursor = 0
      lastDistance = Infinity
      stallFrames = 0
      continue
    }

    if (route === null) {
      const grid = gridFor(target.deckIndex)
      if (grid === null) {
        events.push({
          frame,
          kind: 'unreachable',
          detail: `deck ${target.deckIndex} has no walkable grid — the walk cannot route to "${target.id}"`,
        })
        truncated = true
        break
      }
      const planned = planRoute(
        grid,
        { x: feet[0], z: feet[2] },
        { x: target.point[0], z: target.point[2] },
        maxSnapCells,
      )
      if (planned.path === null) {
        events.push({
          frame,
          kind: 'unreachable',
          detail: `cannot route to "${target.id}": ${planned.reason}`,
        })
        truncated = true
        break
      }
      route = planned.path
      routeCursor = 0
    }

    while (routeCursor < route.length) {
      const node = route[routeCursor]
      if (Math.hypot(node.x - feet[0], node.z - feet[2]) > nodeArrive) {
        break
      }
      routeCursor += 1
    }
    const aim: GridPoint =
      routeCursor < route.length
        ? route[routeCursor]
        : { x: target.point[0], z: target.point[2] }
    const aimX = aim.x - feet[0]
    const aimZ = aim.z - feet[2]
    if (aimX !== 0 || aimZ !== 0) {
      yaw = Math.atan2(-aimX, -aimZ)
    }

    const step = stepNav(
      nav,
      {
        input: { forward: 1, strafe: 0 },
        sprint: false,
        crouch: false,
        yaw,
        dt,
        interact: false,
      },
      world,
    )

    frames.push({
      index: frame,
      t: frame * dt,
      feet: step.feet,
      yaw,
      deckIndex: step.deckIndex,
      phase: step.phase,
      movedM: step.movedM,
      blocked: step.blocked,
      grounded: step.phase === 'climb' ? true : !step.airborne,
      arrested: step.arrested,
      depenetrations: step.depenetrations,
      waypointIndex,
    })
    distanceM += Math.hypot(step.feet[0] - feet[0], step.feet[2] - feet[2])
    maxDepenetrations = Math.max(maxDepenetrations, step.depenetrations)
    if (step.deckIndex !== decksVisited[decksVisited.length - 1]) {
      decksVisited.push(step.deckIndex)
    }
    nav = step.state

    const nextDistance = Math.hypot(
      target.point[0] - step.feet[0],
      target.point[2] - step.feet[2],
    )
    if (nextDistance < lastDistance - 1e-4) {
      lastDistance = nextDistance
      stallFrames = 0
    } else {
      stallFrames += 1
    }
    if (stallFrames > MAX_STALL_FRAMES) {
      replans += 1
      if (replans > MAX_REPLANS) {
        events.push({
          frame,
          kind: 'stalled',
          detail: `the walker stopped making progress toward "${target.id}" at (${fmtVec(step.feet)})`,
        })
        truncated = true
        break
      }
      events.push({
        frame,
        kind: 'replanned',
        detail: `replanning the route to "${target.id}" from (${fmtVec(step.feet)})`,
      })
      route = null
      routeCursor = 0
      stallFrames = 0
      lastDistance = Infinity
    }
    frame += 1
  }

  if (waypointIndex < waypoints.length) {
    truncated = true
  }

  return {
    ship: script.ship,
    script,
    frames,
    events,
    waypoints: results,
    framesRun: frames.length,
    elapsedS: frames.length * dt,
    distanceM,
    decksVisited,
    maxDepenetrations,
    complete: results.every((waypoint) => waypoint.reached),
    truncated,
  }
}

/** A one-line summary of a recording, in the repo's report style. */
export function walkSummary(recording: WalkRecording): string {
  const reached = recording.waypoints.filter((waypoint) => waypoint.reached).length
  const status = recording.complete ? 'complete' : 'incomplete'
  return (
    `${recording.ship} · ${recording.script.kind} · ${status} · ` +
    `${reached}/${recording.waypoints.length} waypoints · ` +
    `${recording.framesRun} frames (${recording.elapsedS.toFixed(1)} s) · ` +
    `${recording.distanceM.toFixed(1)} m`
  )
}
