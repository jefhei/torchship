/**
 * M4-T4 — the seeded worn-detail generator (BUILD_PLAN M4-T4: "worn-detail
 * pass: clutter, paint patches, cable routing variation by seed").
 *
 * One pure function per deck: `wearPlansForDeck` walks the deck's module
 * instances and asks each of the three facets for its authored quota
 * (src/wear/recipes.ts `WEAR_DENSITY_LEVELS`) — paint patches on the module's
 * own wall panels, cable routes dropped from the module's own light sockets,
 * and loose clutter stowed against its walls — placing every candidate from a
 * stream seeded by the SHIP SEED plus the deck and module identity
 * (src/wear/random.ts), so the same spec always yields the same ship and a
 * different seed yields a different one.
 *
 * Three rules make the output trustworthy, and checks.ts re-measures all three
 * on the emitted world parts (the gate never trusts the generator):
 *
 *  1. **mounted, never floating.** Every plan records the module part it is
 *     mounted on (`WearMount`) and its geometry TOUCHES that part: a patch is
 *     painted flush on the panel's inner face, a cable drop runs tangent to it
 *     from its fixture down to the deck plate, a prop rests on the plate with
 *     its back against the wall;
 *  2. **clear of everything else.** Each facet SEARCHES for a clear spot: it
 *     walks seeded candidates and keeps the first whose parts clear the
 *     module's existing geometry (the galley's wall-run conduit is exactly the
 *     obstacle a real cable route has to avoid), the other plans and every
 *     door's keep-clear zone. Nothing found means the item is simply not
 *     placed — the quota is a ceiling (PRD §11 risk 4: clone density down,
 *     never crowd);
 *  3. **solid and walk-over.** Every detail is real geometry: it joins the
 *     deck's collision hull (all three facets stand in the walker's volume) and
 *     the floor props are authored under the M3-T4 step height, so clutter is
 *     stepped over rather than walling the ship off. The shaft band carries no
 *     wear — it is structure, not a room (1.4 m of ladder trunk).
 *
 * The generated parts are ordinary `PlacedPart`s: they join the deck's
 * geometry partition in assemble.ts exactly like the M3-T2 seam geometry, so
 * the pass cannot bypass the draw-call budget (M3-T7) or the material report
 * (M4-T1) — both are measured on the assembled deck, wear included.
 */

import type { Aabb3, MaterialSlot, Vec3 } from '../types'
import { partBounds } from '../kit/parts'
import { moduleParts } from '../kit/modules/types'
import type { AuthoredModule } from '../kit/modules/types'
import { placeParts } from '../kit/modules/placement'
import type { KitPart } from '../kit/types'
import { placedPartOf } from '../assembler/place'
import type {
  PlacedModule,
  PlacedPart,
  WearDensity,
  WearPlan,
} from '../assembler/types'
import {
  CABLE_BASE_RUN_MAX_M,
  CABLE_BASE_RUN_MIN_M,
  CABLE_BASE_Y_M,
  CABLE_CLAMP_M,
  CABLE_CLAMP_NORMAL_M,
  CABLE_CLAMPS_PER_DROP,
  CABLE_LIGHT_KINDS,
  CABLE_RUN_RADIUS_M,
  CABLE_SOCKET_CLEARANCE_M,
  CLUTTER_FLOOR_Y_M,
  CLUTTER_VARIANTS,
  CLUTTER_WALL_GAP_M,
  CLUTTER_WALL_REACH_M,
  PAINT_PATCH_BAND_MAX_M,
  PAINT_PATCH_BAND_MIN_M,
  PAINT_PATCH_THICKNESS_M,
  PAINT_PATCH_VARIANTS,
  WEAR_DENSITY_LEVELS,
  WEAR_DOOR_LATERAL_M,
  WEAR_DOOR_REACH_FLOOR_M,
  WEAR_DOOR_REACH_WALL_M,
  WEAR_OVERLAP_EPS_M,
  WEAR_PART_CLEARANCE_M,
  WEAR_PLACEMENT_TRIES,
} from './recipes'
import {
  boxGap,
  boxUnion,
  floorMountPartOf,
  moduleDoorZones,
  overlapsAny,
  overlapsAnyBox,
  spanAxisOf,
  wallMountsOf,
} from './mounts'
import type { WallMount } from './mounts'
import { chance, clamp, mulberry32, n0, pick, range, seedFor } from './random'

/** The one part a plan is mounted on, plus what the plan needs to place itself. */
interface MountChoice {
  mount: WallMount
  /** The mount part's own module-local box (the surface to touch). */
  box: Aabb3
  /** Index into the owning module's part list (`WearMount.partIndex`). */
  partIndex: number
}

/** A candidate plan under construction, module-local. */
interface Candidate {
  variant: string
  mount: MountChoice
  parts: KitPart[]
}

/**
 * The accept predicate the generator hands each facet: true when a candidate's
 * parts clear the module's existing geometry, the module's door keep-clear
 * zones and every detail already placed on this module instance. Single home
 * for the rule — the gate re-measures the same three things on the emitted
 * world parts (checks.ts).
 */
type ClearCheck = (parts: readonly KitPart[]) => boolean

/** A vector built by module-local axis key (0 = X, 1 = Y, 2 = Z), −0-normalized. */
export function vecByAxis(byAxis: Partial<Record<0 | 1 | 2, number>>): Vec3 {
  return [n0(byAxis[0] ?? 0), n0(byAxis[1] ?? 0), n0(byAxis[2] ?? 0)]
}

function boxPart(materialSlot: MaterialSlot, size: Vec3, position: Vec3): KitPart {
  return { kind: 'box', materialSlot, size, position }
}

function cylPart(
  materialSlot: MaterialSlot,
  radius: number,
  length: number,
  axis: 'x' | 'y' | 'z',
  position: Vec3,
): KitPart {
  return { kind: 'cylinder', materialSlot, radius, length, axis, position }
}

/**
 * A seeded permutation of a list (Fisher–Yates): the facets walk their own
 * surfaces in a seed-dependent order rather than always starting from the
 * first wall, which is what makes two seeds produce two different fittings.
 */
function seededOrder<T>(rng: () => number, items: readonly T[]): T[] {
  const order = [...items]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  return order
}

/** How far a socket is from a wall panel: out-of-plane distance + in-plane gap. */
function wallCost(wall: MountChoice, point: Vec3): number {
  const spanAxis = spanAxisOf(wall.mount.normalAxis)
  const inPlane = Math.max(
    wall.mount.uLo - point[spanAxis],
    point[spanAxis] - wall.mount.uHi,
    0,
  )
  return Math.abs(point[wall.mount.normalAxis] - wall.mount.faceCoord) + inPlane
}

/* ---------------------------------------------------------- facets */

/** Seeded paint patches, painted flush on the module's own wall panels. */
function paintCandidate(
  rng: () => number,
  walls: readonly MountChoice[],
  isClear: ClearCheck,
): Candidate | undefined {
  if (walls.length === 0) return undefined
  const order = seededOrder(rng, walls)
  for (let attempt = 0; attempt < WEAR_PLACEMENT_TRIES; attempt++) {
    const mount = order[attempt % order.length]
    const variant = pick(rng, PAINT_PATCH_VARIANTS)
    const spanAxis = spanAxisOf(mount.mount.normalAxis)
    const halfWidth = variant.width / 2
    const halfHeight = variant.height / 2
    const uLo = mount.mount.uLo + halfWidth + WEAR_PART_CLEARANCE_M
    const uHi = mount.mount.uHi - halfWidth - WEAR_PART_CLEARANCE_M
    const vLo = Math.max(mount.mount.vLo + halfHeight + 0.1, PAINT_PATCH_BAND_MIN_M)
    const vHi = Math.min(mount.mount.vHi - halfHeight - 0.1, PAINT_PATCH_BAND_MAX_M)
    if (uHi <= uLo || vHi <= vLo) continue
    const u = range(rng, uLo, uHi)
    const v = range(rng, vLo, vHi)
    const parts: KitPart[] = [
      boxPart(
        variant.materialSlot,
        vecByAxis({
          [mount.mount.normalAxis]: PAINT_PATCH_THICKNESS_M,
          1: variant.height,
          [spanAxis]: variant.width,
        }),
        vecByAxis({
          [mount.mount.normalAxis]:
            mount.mount.faceCoord + mount.mount.inward * (PAINT_PATCH_THICKNESS_M / 2),
          1: v,
          [spanAxis]: u,
        }),
      ),
    ]
    if (isClear(parts)) return { variant: variant.id, mount, parts }
  }
  return undefined
}

/** The parts of one cable route from a socket down a tangent wall. */
function cableParts(
  rng: () => number,
  socket: { position: Vec3 },
  mount: MountChoice,
  topY: number,
): KitPart[] {
  const { normalAxis, faceCoord, inward, uLo, uHi } = mount.mount
  const spanAxis = spanAxisOf(normalAxis)
  const u = clamp(socket.position[spanAxis], uLo + 0.08, uHi - 0.08)
  const dropLength = topY - CABLE_BASE_Y_M
  const offset = faceCoord + inward * CABLE_RUN_RADIUS_M
  const parts: KitPart[] = [
    cylPart(
      'conduit',
      CABLE_RUN_RADIUS_M,
      dropLength,
      'y',
      vecByAxis({
        [normalAxis]: offset,
        1: (topY + CABLE_BASE_Y_M) / 2,
        [spanAxis]: u,
      }),
    ),
  ]

  // A base run along the wall, in the seeded direction the route takes from
  // the drop — the "variation" the facet is named for.
  const direction = chance(rng, 0.5) ? 1 : -1
  const room = direction > 0 ? uHi - 0.05 - u : u - (uLo + 0.05)
  const wanted = range(rng, CABLE_BASE_RUN_MIN_M, CABLE_BASE_RUN_MAX_M)
  const baseLength = Math.min(wanted, room)
  if (baseLength >= 0.25) {
    parts.push(
      cylPart(
        'conduit',
        CABLE_RUN_RADIUS_M,
        baseLength,
        spanAxis === 0 ? 'x' : 'z',
        vecByAxis({
          [normalAxis]: offset,
          1: CABLE_BASE_Y_M,
          [spanAxis]: u + direction * (baseLength / 2),
        }),
      ),
    )
  }

  // Saddles clipping the drop to the wall (they touch the panel and wrap the
  // cable — same plan, so the gate's separation rule never sees them).
  for (let i = 1; i <= CABLE_CLAMPS_PER_DROP; i++) {
    const y = CABLE_BASE_Y_M + (dropLength * i) / (CABLE_CLAMPS_PER_DROP + 1)
    parts.push(
      boxPart(
        'bulkhead',
        vecByAxis({
          [normalAxis]: CABLE_CLAMP_NORMAL_M,
          1: CABLE_CLAMP_M,
          [spanAxis]: CABLE_CLAMP_M,
        }),
        vecByAxis({
          [normalAxis]: faceCoord + inward * (CABLE_CLAMP_NORMAL_M / 2),
          1: y,
          [spanAxis]: u,
        }),
      ),
    )
  }
  return parts
}

/**
 * A seeded cable route: a wall-tangent drop from one of the module's own light
 * fixtures down to the deck plate. Both the fixture and the wall are searched
 * in seeded order, so a route that would run through a wall conduit (the kit
 * routes its own runs along the same walls) moves to the next wall rather than
 * being abandoned — the "cable routing variation" the plan asks for.
 */
function cableCandidate(
  rng: () => number,
  module: AuthoredModule,
  walls: readonly MountChoice[],
  isClear: ClearCheck,
): Candidate | undefined {
  if (walls.length === 0) return undefined
  const sockets = module.manifest.lightSockets.filter((socket) =>
    CABLE_LIGHT_KINDS.includes(socket.kind),
  )
  if (sockets.length === 0) return undefined

  for (const socket of seededOrder(rng, sockets)) {
    const topY = socket.position[1] - CABLE_SOCKET_CLEARANCE_M
    if (!(topY - CABLE_BASE_Y_M > 0.4)) continue
    // The drop is tangent to the panel for its whole length, so the panel must
    // reach from the deck plate up past the fixture: a doorway's pier or lintel
    // (the kit cuts walls around openings) cannot carry it.
    const covering = walls
      .filter(
        (wall) => wall.mount.vLo <= CABLE_BASE_Y_M + 0.02 && wall.mount.vHi >= topY,
      )
      .sort((a, b) => wallCost(a, socket.position) - wallCost(b, socket.position))
    for (const mount of covering) {
      const parts = cableParts(rng, socket, mount, topY)
      if (isClear(parts)) return { variant: 'cable-drop', mount, parts }
    }
  }
  return undefined
}

/** A seeded loose prop, stowed against a wall on the deck plate. */
function clutterCandidate(
  rng: () => number,
  walls: readonly MountChoice[],
  isClear: ClearCheck,
): Candidate | undefined {
  if (walls.length === 0) return undefined
  const order = seededOrder(rng, walls)
  for (let attempt = 0; attempt < WEAR_PLACEMENT_TRIES; attempt++) {
    const mount = order[attempt % order.length]
    const variant = pick(rng, CLUTTER_VARIANTS)
    const spanAxis = spanAxisOf(mount.mount.normalAxis)
    const normalAxis = mount.mount.normalAxis
    // Authored box extents are [width along the wall, height, depth]; a
    // cylinder is square in plan and stands on its own axis.
    const width = variant.kind === 'cylinder' ? 2 * variant.radius : variant.size[0]
    const height = variant.kind === 'cylinder' ? variant.length : variant.size[1]
    const depth = variant.kind === 'cylinder' ? 2 * variant.radius : variant.size[2]
    const halfWidth = width / 2
    const uLo = mount.mount.uLo + halfWidth + WEAR_PART_CLEARANCE_M
    const uHi = mount.mount.uHi - halfWidth - WEAR_PART_CLEARANCE_M
    if (uHi <= uLo) continue
    const u = range(rng, uLo, uHi)
    const acrossWall =
      mount.mount.faceCoord + mount.mount.inward * (CLUTTER_WALL_GAP_M + depth / 2)
    const centreY = CLUTTER_FLOOR_Y_M + height / 2
    const position = vecByAxis({ [normalAxis]: acrossWall, 1: centreY, [spanAxis]: u })
    const parts: KitPart[] = [
      variant.kind === 'cylinder'
        ? cylPart(variant.materialSlot, variant.radius, variant.length, 'y', position)
        : boxPart(
            variant.materialSlot,
            vecByAxis({ [normalAxis]: depth, 1: height, [spanAxis]: width }),
            position,
          ),
    ]
    if (isClear(parts)) return { variant: variant.id, mount, parts }
  }
  return undefined
}

/* ------------------------------------------------------------ the pass */

/**
 * The wear plans one module instance contributes. Exported for the gate's
 * doctored-plan tests and for M5's density-knob work.
 */
export function wearPlansForModule(
  owner: Pick<PlacedModule, 'source' | 'module' | 'origin' | 'rotation'>,
  deckIndex: number,
  deckId: string,
  seed: number,
  density: WearDensity,
): WearPlan[] {
  const recipe = WEAR_DENSITY_LEVELS[density]
  if (recipe.paint === 0 && recipe.cable === 0 && recipe.clutter === 0) return []

  const module = owner.module
  const localBounds = moduleParts(module).map(partBounds)
  const walls: MountChoice[] = wallMountsOf(module).map((mount) => ({
    mount,
    box: localBounds[mount.partIndex],
    partIndex: mount.partIndex,
  }))
  const floorPartIndex = floorMountPartOf(module)
  // A floor prop leans on a panel that reaches the deck plate (a doorway lintel
  // is a wall panel too — it just starts above the prop's head).
  const floorWalls = walls.filter(
    (wall) => wall.mount.vLo <= CLUTTER_FLOOR_Y_M + CLUTTER_WALL_REACH_M,
  )
  const wallZones = moduleDoorZones(module, WEAR_DOOR_REACH_WALL_M, WEAR_DOOR_LATERAL_M)
  const floorZones = moduleDoorZones(
    module,
    WEAR_DOOR_REACH_FLOOR_M,
    WEAR_DOOR_LATERAL_M,
  )

  const accepted: KitPart[] = []
  const acceptedBounds: Aabb3[] = []
  const plans: WearPlan[] = []

  const quota: readonly { facet: WearPlan['facet']; count: number }[] = [
    { facet: 'paint', count: recipe.paint },
    { facet: 'cable', count: recipe.cable },
    { facet: 'clutter', count: recipe.clutter },
  ]

  for (const { facet, count } of quota) {
    if (facet === 'clutter' && floorPartIndex === undefined) continue
    const zones = facet === 'clutter' ? floorZones : wallZones
    const isClear: ClearCheck = (parts) =>
      !parts.some((part) => overlapsAny(partBounds(part), zones, 0)) &&
      !parts.some((part) =>
        overlapsAnyBox(partBounds(part), localBounds, WEAR_OVERLAP_EPS_M),
      ) &&
      !parts.some((part) =>
        overlapsAnyBox(partBounds(part), acceptedBounds, WEAR_OVERLAP_EPS_M),
      )

    for (let index = 0; index < count; index++) {
      const stream = seedFor(
        seed,
        deckIndex,
        owner.source.moduleId,
        owner.source.moduleIndex,
        facet,
        index,
      )
      const rng = mulberry32(stream)
      const found =
        facet === 'paint'
          ? paintCandidate(rng, walls, isClear)
          : facet === 'cable'
            ? cableCandidate(rng, module, walls, isClear)
            : clutterCandidate(rng, floorWalls, isClear)
      if (found === undefined) continue

      const source = owner.source
      const worldParts = placeParts(found.parts, {
        position: owner.origin,
        rotation: owner.rotation,
      })
      const face = {
        normalAxis: found.mount.mount.normalAxis,
        faceCoord: found.mount.mount.faceCoord,
        inward: found.mount.mount.inward,
      }
      plans.push({
        id: `deck-${deckIndex}-wear-${owner.source.moduleIndex}-${facet}-${index + 1}`,
        facet,
        deckIndex,
        deckId,
        source,
        variant: found.variant,
        mount:
          facet === 'clutter' && floorPartIndex !== undefined
            ? // A prop rests on the deck plate and leans on the wall panel.
              {
                kind: 'floor',
                partIndex: floorPartIndex,
                backPartIndex: found.mount.partIndex,
                ...face,
              }
            : { kind: 'wall', partIndex: found.mount.partIndex, ...face },
        seed: stream,
        solid: true,
        parts: worldParts.map((part) => placedPartOf(part, source)),
      })
      accepted.push(...found.parts)
      acceptedBounds.push(...found.parts.map(partBounds))
    }
  }

  return plans
}

/**
 * Every wear plan of one deck: one pass over its room instances, in spec order
 * (the synthesized shaft band carries no wear — see the header). The knob is
 * the density rung; `'off'` returns nothing, which is what makes the pass's
 * draw-call cost measurable (src/wear/report.ts).
 */
export function wearPlansForDeck(
  modules: readonly PlacedModule[],
  deckIndex: number,
  deckId: string,
  seed: number,
  density: WearDensity,
): WearPlan[] {
  return modules
    .filter((owner) => !owner.band)
    .flatMap((owner) => wearPlansForModule(owner, deckIndex, deckId, seed, density))
}

/** Every generated wear part of a deck, in plan order. */
export function wearPartsOf(deck: { wear: readonly WearPlan[] }): PlacedPart[] {
  return deck.wear.flatMap((plan) => plan.parts)
}

/** The union of a plan's parts and its mount's box — the gate's contact measure. */
export function planToMountGap(parts: readonly KitPart[], mountBox: Aabb3): number {
  let union: Aabb3 | undefined
  for (const part of parts) {
    const box = partBounds(part)
    union = union === undefined ? box : boxUnion(union, box)
  }
  return union === undefined ? Infinity : boxGap(union, mountBox)
}
