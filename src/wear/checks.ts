/**
 * M4-T4 — the worn-detail gate (the machine half of the pass; the human read
 * of "worn-and-warm but not filthy" is the M5 Review Loop's).
 *
 * The generator (detail.ts) decides what to place; this module RE-MEASURES the
 * emitted world geometry and never trusts it. `wearProblems(ship)` returns
 * human-readable strings (the repo's harness posture — never throws) and is
 * wired into `assemblyProblems` as rule 13, so the assembler gate carries it.
 *
 * Rules, in report order:
 *
 *  1. **shape** — plans have unique ids across the ship, name a real module
 *     instance on their own deck, carry at least one part, and every part draws
 *     a §4 slot from the vocabulary that is NOT `coffee-accent` (PRD §4: the
 *     one warm accent belongs to the galley's coffee station);
 *  2. **mounted** — every plan's geometry touches the module part it declares
 *     as its mount (`WearMount`), within `WEAR_CONTACT_EPS_M`: a patch flush on
 *     the panel's inner face, a cable drop tangent to it, a prop with its back
 *     to the wall and its base on the plate. Floating detail is a finding —
 *     this is the rule that makes "never freehand" (rule 8) measurable;
 *  3. **inside** — every part is inside the owning module's own world bounds
 *     (the M2 gate's subfloor / socket-straddle allowances);
 *  4. **clear** — no part overlaps geometry it is not mounted on, beyond
 *     `WEAR_OVERLAP_EPS_M`: the module's own parts, the generated seam parts,
 *     or another plan's parts. (Parts of the SAME plan may interpenetrate —
 *     that is how a saddle wraps its cable);
 *  5. **doorways** — no part enters a door's keep-clear zone: the opening
 *     extruded into the room (`WEAR_DOOR_REACH_WALL_M` for wall detail,
 *     `WEAR_DOOR_REACH_FLOOR_M` for floor props, both grown
 *     `WEAR_DOOR_LATERAL_M`). The zone is derived from the deck's own door
 *     sockets — including the M3-T6 spawn's walk-in lane;
 *  6. **solid** — any part standing in the room's interior (below the deck
 *     clear height) must be marked solid, because it is geometry a walker
 *     collides with; and the deck's collision hull must carry exactly one box
 *     per solid wear part, matching its geometry. A detail you can walk
 *     through is a bug this rule refuses to hide;
 *  7. **walk-over** — a floor prop is no taller than `WEAR_FLOOR_HEIGHT_MAX_M`,
 *     under the M3-T4 `STEP_HEIGHT_M` the walker steps over: clutter is never
 *     a blocker;
 *  8. **budget** — the pass's added draw calls per deck stay under
 *     `WEAR_CALLS_PER_DECK_MAX`, measured against the same spec assembled with
 *     the pass off (PRD §10's frame budget; the ship-wide ceiling itself is
 *     M3-T7's rule 12, deliberately NOT duplicated here).
 */

import { MATERIAL_SLOTS, MM } from '../types'
import type { Aabb3, MaterialSlot } from '../types'
import { partBounds } from '../kit/parts'
import { moduleBounds } from '../kit/modules/types'
import { boxContains, isWellFormedBox, transformAabb } from '../assembler/place'
import { drawCallTally } from '../assembler/drawCalls'
import { deckHull, overlapDepth, wearSolidParts } from '../assembler/collision'
import { assembleShip } from '../assembler/assemble'
import type {
  DeckAssembly,
  PlacedPart,
  ShipAssembly,
  WearPlan,
} from '../assembler/types'
import { boxGap, boxUnion, overlapsAny, placedDoorZones } from './mounts'
import {
  WEAR_CALLS_PER_DECK_MAX,
  WEAR_CONTACT_EPS_M,
  WEAR_DENSITY_LEVELS,
  WEAR_DOOR_LATERAL_M,
  WEAR_DOOR_REACH_FLOOR_M,
  WEAR_DOOR_REACH_WALL_M,
  WEAR_FACETS,
  WEAR_FLOOR_HEIGHT_MAX_M,
  WEAR_HEIGHT_EPS_M,
  WEAR_OVERLAP_EPS_M,
  WALL_MOUNT_MAX_THICKNESS_M,
} from './recipes'

/** The eight rules' findings, plus the words the report prints. */
export interface DeckWearTally {
  deckIndex: number
  deckId: string
  label: string
  plans: number
  parts: number
  /** Plans per facet, in WEAR_FACETS order. */
  byFacet: Record<WearPlan['facet'], number>
  /** Draw calls the deck draws with the pass on. */
  calls: number
  /** The same deck with the pass off (same spec) — the baseline. */
  callsWithoutWear: number
  /** `calls − callsWithoutWear`: what the pass costs this deck. */
  addedCalls: number
}

/** The pass's cost, deck by deck, measured against the pass-off assembly. */
export interface WearDrawCallDelta {
  ship: string
  rows: DeckWearTally[]
  withWear: number
  withoutWear: number
  addedCalls: number
}

/** Normalize −0 → 0 (Object.is-strict comparisons treat signed zeros apart). */
function n0(value: number): number {
  return value === 0 ? 0 : value
}

/** Meters → mm at 0.001 mm resolution for report strings (repo convention). */
function mm(meters: number): number {
  return Math.round((meters / MM) * 1000) / 1000
}

/** The world box of a module instance's own declared bounds. */
function moduleWorldBounds(deck: DeckAssembly, moduleIndex: number): Aabb3 | undefined {
  const owner = deck.modules.find(
    (candidate) => candidate.source.moduleIndex === moduleIndex,
  )
  if (owner === undefined) return undefined
  return transformAabb(moduleBounds(owner.module), owner.origin, owner.rotation)
}

/** The room's interior: the module box inset by the wall thickness, floor to ceiling. */
function interiorPrism(deck: DeckAssembly, moduleIndex: number): Aabb3 | undefined {
  const bounds = moduleWorldBounds(deck, moduleIndex)
  if (bounds === undefined) return undefined
  const t = WALL_MOUNT_MAX_THICKNESS_M
  return {
    min: [bounds.min[0] + t, bounds.min[1], bounds.min[2] + t],
    max: [bounds.max[0] - t, bounds.max[1], bounds.max[2] - t],
  }
}

/** How many of the deck's rooms carry wear (report convenience). */
export function wearPlanCount(deck: Pick<DeckAssembly, 'wear'>): number {
  return deck.wear.length
}

/**
 * The pass's draw-call cost on a ship, deck by deck: the same spec assembled
 * with the pass OFF is the baseline, so the number is a measurement rather than
 * an estimate (the part shapes are shared by merging and instancing, so only
 * re-partitioning can answer it — see src/assembler/batches.ts).
 */
export function wearDrawCallDelta(ship: ShipAssembly): WearDrawCallDelta {
  const baseline = assembleShip(ship.spec, {
    requireValidSpec: false,
    wearDensity: 'off',
  })
  const withRows = drawCallTally(ship).rows
  const withoutRows = drawCallTally(baseline).rows
  const rows: DeckWearTally[] = ship.decks.map((deck) => {
    const withRow = withRows[deck.deckIndex]
    const withoutRow = withoutRows[deck.deckIndex]
    const byFacet = { paint: 0, cable: 0, clutter: 0 } as Record<
      WearPlan['facet'],
      number
    >
    for (const plan of deck.wear) byFacet[plan.facet] += 1
    const parts = deck.wear.reduce((sum, plan) => sum + plan.parts.length, 0)
    const calls = withRow === undefined ? 0 : withRow.calls
    const callsWithoutWear = withoutRow === undefined ? 0 : withoutRow.calls
    return {
      deckIndex: deck.deckIndex,
      deckId: deck.deckId,
      label: deck.label,
      plans: deck.wear.length,
      parts,
      byFacet,
      calls,
      callsWithoutWear,
      addedCalls: calls - callsWithoutWear,
    }
  })
  return {
    ship: ship.spec.name,
    rows,
    withWear: rows.reduce((sum, row) => sum + row.calls, 0),
    withoutWear: rows.reduce((sum, row) => sum + row.callsWithoutWear, 0),
    addedCalls: rows.reduce((sum, row) => sum + row.addedCalls, 0),
  }
}

/**
 * Every problem the pass's own geometry has on an assembled ship. Empty = the
 * worn detail is mounted, clear, walk-over and inside the frame budget.
 */
export function wearProblems(ship: ShipAssembly, delta?: WearDrawCallDelta): string[] {
  const problems: string[] = []
  const cost = delta ?? wearDrawCallDelta(ship)
  const seenIds = new Set<string>()

  // 1. Shape: unique ids across the ship, resolvable sources, real slots.
  for (const deck of ship.decks) {
    const where = `deck ${deck.deckIndex} ("${deck.deckId}")`
    for (const plan of deck.wear) {
      const planWhere = `${where} wear plan "${plan.id}"`
      if (seenIds.has(plan.id)) {
        problems.push(`${planWhere}: wear plan id is duplicated`)
      }
      seenIds.add(plan.id)
      if (!WEAR_FACETS.includes(plan.facet)) {
        problems.push(`${planWhere}: unknown facet "${plan.facet}"`)
      }
      if (plan.variant.trim() === '') {
        problems.push(`${planWhere}: no authored variant named`)
      }
      if (plan.parts.length === 0) {
        problems.push(`${planWhere}: generated no parts`)
      }
      const owner = deck.modules.find(
        (candidate) =>
          candidate.source.moduleId === plan.source.moduleId &&
          candidate.source.moduleIndex === plan.source.moduleIndex,
      )
      if (owner === undefined) {
        problems.push(
          `${planWhere}: names module "${plan.source.moduleId}"#${plan.source.moduleIndex}, which is not on this deck`,
        )
        continue
      }
      for (const entry of plan.parts) {
        if (!(MATERIAL_SLOTS as readonly MaterialSlot[]).includes(entry.materialSlot)) {
          problems.push(
            `${planWhere}: part draws unknown §4 slot "${entry.materialSlot}"`,
          )
        }
        if (entry.materialSlot === 'coffee-accent') {
          problems.push(
            `${planWhere}: part draws the coffee-accent slot — PRD §4 reserves the warm accent for the coffee station`,
          )
        }
        if (!isWellFormedBox(partBounds(entry.part))) {
          problems.push(`${planWhere}: part has a degenerate box`)
        }
      }

      // 2. Mounted: the plan's geometry touches the part it is mounted on.
      const mountPart = owner.parts[plan.mount.partIndex]
      const backPart =
        plan.mount.backPartIndex === undefined
          ? undefined
          : owner.parts[plan.mount.backPartIndex]
      const contacts: { part: PlacedPart | undefined; what: string; index: number }[] =
        [
          {
            part: mountPart,
            what: plan.mount.kind === 'floor' ? 'deck plate' : 'wall panel',
            index: plan.mount.partIndex,
          },
        ]
      if (plan.mount.backPartIndex !== undefined) {
        contacts.push({
          part: backPart,
          what: 'wall panel its back is stowed against',
          index: plan.mount.backPartIndex,
        })
      }
      for (const contact of contacts) {
        if (contact.part === undefined) {
          problems.push(
            `${planWhere}: mount part ${contact.index} is not a part of "${plan.source.moduleId}"#${plan.source.moduleIndex}`,
          )
          continue
        }
        const gap = planUnionGap(plan, partBounds(contact.part.part))
        if (!(gap <= WEAR_CONTACT_EPS_M)) {
          problems.push(
            `${planWhere}: stands ${mm(gap).toFixed(1)} mm off the ${contact.what} it is ` +
              `mounted on (part ${contact.index}) — worn detail is mounted, never floating`,
          )
        }
      }
      if (!plan.solid) {
        const prism = interiorPrism(deck, plan.source.moduleIndex)
        const standsInRoom =
          prism !== undefined &&
          plan.parts.some(
            (entry) => overlapDepth(partBounds(entry.part), prism) > WEAR_OVERLAP_EPS_M,
          )
        if (standsInRoom) {
          problems.push(
            `${planWhere}: is not solid but stands in the room's interior — a walker would pass through it`,
          )
        }
      }

      // 3. Inside the owning module's own bounds.
      const bounds = moduleWorldBounds(deck, plan.source.moduleIndex)
      const relaxed: Aabb3 | undefined =
        bounds === undefined
          ? undefined
          : {
              min: [bounds.min[0] - 0.05, bounds.min[1] - 0.2, bounds.min[2] - 0.05],
              max: [bounds.max[0] + 0.05, bounds.max[1] + 0.05, bounds.max[2] + 0.05],
            }
      for (const entry of plan.parts) {
        const box = partBounds(entry.part)
        if (relaxed === undefined || !boxContains(relaxed, box, 0.05)) {
          problems.push(
            `${planWhere}: part reaches outside the world bounds of module "${plan.source.moduleId}"#${plan.source.moduleIndex}`,
          )
          break
        }
      }

      // 4. Clear of geometry it is not mounted on.
      const foreign: { box: Aabb3; what: string }[] = []
      for (const other of deck.modules) {
        if (
          other.source.moduleId === plan.source.moduleId &&
          other.source.moduleIndex === plan.source.moduleIndex
        ) {
          for (const entry of other.parts) {
            const box = partBounds(entry.part)
            if (entry === mountPart || entry === backPart) continue
            foreign.push({
              box,
              what: `"${other.source.moduleId}"#${other.source.moduleIndex} kit geometry`,
            })
          }
          for (const seam of deck.seams) {
            for (const entry of seam.parts) {
              foreign.push({
                box: partBounds(entry.part),
                what: `generated seam geometry`,
              })
            }
          }
        }
      }
      for (const other of deck.wear) {
        if (other.id === plan.id) continue
        for (const entry of other.parts) {
          foreign.push({ box: partBounds(entry.part), what: `wear plan "${other.id}"` })
        }
      }
      for (const entry of plan.parts) {
        const box = partBounds(entry.part)
        const clash = foreign.find(
          (item) => overlapDepth(box, item.box) > WEAR_OVERLAP_EPS_M,
        )
        if (clash !== undefined) {
          problems.push(
            `${planWhere}: part overlaps ${clash.what} by ${mm(overlapDepth(box, clash.box)).toFixed(1)} mm`,
          )
          break
        }
      }

      // 5. Doorways: the same deck's door sockets define the keep-clear zones.
      const reach =
        plan.mount.kind === 'floor' ? WEAR_DOOR_REACH_FLOOR_M : WEAR_DOOR_REACH_WALL_M
      const zones = placedDoorZones(owner.doors, reach, WEAR_DOOR_LATERAL_M)
      for (const entry of plan.parts) {
        const box = partBounds(entry.part)
        if (overlapsAny(box, zones, 0)) {
          problems.push(
            `${planWhere}: part stands in a door's keep-clear zone — the doorway approach stays clear`,
          )
          break
        }
      }

      // 7. Walk-over: a floor prop is under the walker's step height.
      if (plan.mount.kind === 'floor') {
        for (const entry of plan.parts) {
          const box = partBounds(entry.part)
          const height = box.max[1] - box.min[1]
          if (height > WEAR_FLOOR_HEIGHT_MAX_M + WEAR_HEIGHT_EPS_M) {
            problems.push(
              `${planWhere}: part stands ${mm(height).toFixed(1)} mm tall — floor clutter must stay under the ` +
                `${mm(WEAR_FLOOR_HEIGHT_MAX_M).toFixed(1)} mm walk-over cap`,
            )
            break
          }
        }
      }
    }

    // 6. Solid: the hull carries one box per solid wear part, matching it.
    const solid = wearSolidParts(deck)
    const hullWearBoxes = deckHull(deck.modules, deck.seams, deck.wear).filter(
      (entry) => entry.origin === 'wear',
    )
    if (hullWearBoxes.length !== solid.length) {
      problems.push(
        `${where}: the collision hull carries ${hullWearBoxes.length} wear box(es) for ${solid.length} solid wear part(s)`,
      )
    }
    solid.forEach((entry, index) => {
      const box = partBounds(entry.part)
      const hullBox = hullWearBoxes[index]?.box
      if (
        hullBox === undefined ||
        hullBox.min.some((value, axis) => value !== box.min[axis]) ||
        hullBox.max.some((value, axis) => value !== box.max[axis])
      ) {
        problems.push(
          `${where}: wear hull box ${index} is not the geometry it stands for`,
        )
      }
    })
  }

  // 8. Budget: the pass's own cost per deck.
  for (const row of cost.rows) {
    if (row.addedCalls > WEAR_CALLS_PER_DECK_MAX) {
      problems.push(
        `deck ${row.deckIndex} ("${row.deckId}") pays ${row.addedCalls} draw call(s) for its worn detail — ` +
          `over the ${WEAR_CALLS_PER_DECK_MAX}-call per-deck budget (drop the density rung, PRD §10)`,
      )
    }
  }

  return problems
}

/** The gap between a plan's parts (union) and its mount, meters. */
function planUnionGap(plan: WearPlan, mountBox: Aabb3): number {
  let union: Aabb3 | undefined
  for (const entry of plan.parts) {
    const box = partBounds(entry.part)
    union = union === undefined ? box : boxUnion(union, box)
  }
  return union === undefined ? Infinity : n0(boxGap(union, mountBox))
}

/** The rungs a report may name (defensive: the knob is typed). */
export function isWearDensity(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(WEAR_DENSITY_LEVELS, value)
}
