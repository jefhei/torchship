/**
 * M5-T2 — the review-walk gate: the machine-checkable half of a scripted walk.
 *
 * A recording is data, so it can be judged: did the walk get where it was going,
 * and did it stay inside the ship while it did? These are the rules that would
 * make a REVIEW pass meaningless if they broke — a waypoint never reached (the
 * landmark is not actually walkable), a clip (the walker was pushed out of kit),
 * a fall out of the ship, a walk that wandered onto another deck or grabbed the
 * ladder. Every rule reads the recording's own frames, so the gate says exactly
 * which frame went wrong.
 *
 * PRODUCT gate, not a §8 verdict (the M4-T2 / M5-T1 precedent): nothing here is
 * wired into src/invariants/. The M5-T3 Review Loop is the consumer.
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'
import { planCoffeeRun } from './path'
import { recordWalk } from './record'
import type { WalkOptions, WalkRecording, WalkScript } from './types'

/** The deck a script stays on, or null when its waypoints span decks. */
export function scriptDeck(script: WalkScript): number | null {
  const first = script.waypoints[0]?.deckIndex
  if (first === undefined) {
    return null
  }
  return script.waypoints.every((waypoint) => waypoint.deckIndex === first)
    ? first
    : null
}

/** A length in the reports' meters style (a never-approached point reads '∞'). */
function fmtMeters(meters: number): string {
  return Number.isFinite(meters) ? `${meters.toFixed(3)} m` : 'no approach'
}

/**
 * Every defect of one recorded walk. Empty means the walk got to every waypoint
 * on its own two feet: no unreached waypoint, no clip, no fall out of the ship,
 * no stray deck, no unplanned climb.
 */
export function walkProblems(recording: WalkRecording): string[] {
  const problems: string[] = []

  for (const waypoint of recording.waypoints) {
    if (!waypoint.reached) {
      problems.push(
        `the walk never reached "${waypoint.id}" (${waypoint.label}) — closest approach ${fmtMeters(waypoint.closestM)}`,
      )
    }
  }

  for (const event of recording.events) {
    if (event.kind === 'unreachable' || event.kind === 'stalled') {
      problems.push(`the walk could not finish: ${event.detail}`)
    }
  }
  const climbEvent = recording.events.find((event) => event.kind === 'climb')
  if (climbEvent !== undefined) {
    problems.push(climbEvent.detail)
  }

  const nonFinite = recording.frames.find(
    (frame) => !frame.feet.every((component) => Number.isFinite(component)),
  )
  if (nonFinite !== undefined) {
    problems.push(`the walker's feet went non-finite at frame ${nonFinite.index}`)
  }
  const arrested = recording.frames.find((frame) => frame.arrested)
  if (arrested !== undefined) {
    problems.push(
      `the walker fell out of the ship at frame ${arrested.index} (arrested at the bottom of the spine run)`,
    )
  }
  const clipped = recording.frames.find((frame) => frame.depenetrations > 0)
  if (clipped !== undefined) {
    problems.push(
      `the walker clipped through kit at frame ${clipped.index} ` +
        `(${clipped.depenetrations} depenetration(s), ${recording.maxDepenetrations} at worst)`,
    )
  }

  const deck = scriptDeck(recording.script)
  if (deck !== null) {
    const stray = recording.decksVisited.find((visited) => visited !== deck)
    if (stray !== undefined) {
      problems.push(`the walk left its deck ${deck} for deck ${stray}`)
    }
  }

  // A walk that stopped with no more specific event still has to say so.
  const explained = recording.events.some(
    (event) =>
      event.kind === 'unreachable' ||
      event.kind === 'stalled' ||
      event.kind === 'climb',
  )
  if (recording.truncated && !explained) {
    problems.push(
      `the walk stopped early after ${recording.framesRun} frames (${recording.elapsedS.toFixed(1)} s)`,
    )
  }

  return problems
}

/** A recorded coffee run: the derived script plus its trace. */
export interface CoffeeRun {
  script: WalkScript
  recording: WalkRecording
}

/**
 * Record the coffee run for an assembled ship, or null when the ship offers one
 * to make (see `planCoffeeRun` for the reasons).
 */
export function recordCoffeeRun(
  ship: ShipAssembly,
  world: NavigationWorld,
  options: WalkOptions = {},
): CoffeeRun | null {
  const plan = planCoffeeRun(ship, world)
  if (plan.script === null) {
    return null
  }
  return {
    script: plan.script,
    recording: recordWalk(ship, world, plan.script, options),
  }
}

/**
 * The coffee-run gate for one assembled ship: plan the run, record it, and
 * report every defect. A ship with no coffee run reports the plan's own reasons
 * (no galley on the crew deck, no coffee-station anchor, …) rather than passing
 * silently — an absent review walk is itself a finding.
 */
export function coffeeRunProblems(
  ship: ShipAssembly,
  world: NavigationWorld,
  options: WalkOptions = {},
): string[] {
  const plan = planCoffeeRun(ship, world)
  if (plan.script === null) {
    return plan.problems
  }
  return walkProblems(recordWalk(ship, world, plan.script, options))
}
