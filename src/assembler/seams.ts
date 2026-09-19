/**
 * M3-T2 — seam/hatch enforcement: mating geometry generated FROM sockets.
 *
 * BUILD_PLAN M3-T2: "Seam/hatch enforcement: mating geometry generated from
 * sockets (never freehand); [auto] watertight + alignment checks wired into
 * the assembler." The M0-T2 spike settled the rule and every number used here
 * (docs/spikes.md): door sockets are the ONLY join interface, so the seal
 * between two mating modules is *derived* from the two `DoorSocket`s — never
 * drawn by hand — and the measured caps live in `SEAM_TOLERANCES` (watertight
 * gap < 2 mm, hatch alignment ≤ 5 mm; imported, never re-derived).
 *
 * What a "seam" is, geometrically. Two modules mate wall-face to wall-face:
 * each wall is a panel with a doorway cut in it (the M2-T1 `bulkheadParts`
 * decomposition), the two outer faces are coplanar (the kit's authoring frame
 * puts every socket flush in its module face, M2-T2), and their doorways line
 * up into one pass-through. The contact region is therefore the intersection
 * of the two wall-face rectangles minus the doorway — and a normal offset
 * between the spec's modules opens exactly that much of a slot between the
 * faces (M0-T2 measured the response slope at 1.000). Three claims follow, all
 * machine-checkable and all measured on the geometry the assembler emits:
 *
 *  1. GAP — the along-normal separation of the two wall planes is under the
 *     watertight cap (the QA rig's 10 mm deck is a leak; the validator rejects
 *     that ship before assembly, and this is the assembled-geometry view of
 *     the same fact);
 *  2. COVERAGE — a seal reaches past BOTH wall planes (its bite) and covers
 *     every band of the contact annulus, so a legal (sub-cap) gap cannot leak;
 *  3. PASSAGE — the seal never intrudes into the doorway it frames: the
 *     pass-through stays exactly as wide as the sockets say it is.
 *
 * The seal itself is a **sleeve**: the annulus decomposed into the same
 * members `bulkheadParts` cuts a wall into (two piers/jambs, plus a sill
 * and/or lintel only when the doorway does not reach the panel edge — a
 * standard 0.9 × 2.0 door standing on the floor line therefore yields jambs +
 * lintel and no sill), extruded along the join normal from `planeA −
 * SEAM_BITE_M` to `planeB + SEAM_BITE_M`. Each member's outer edges overshoot
 * the contact region by `SEAM_OVERHANG_M` so the sleeve's faces never land
 * coplanar on a module face (no z-fighting, no knife-edge joins), while its
 * inner edges sit exactly on the doorway edge so the passage is untouched.
 * The sleeve lies inside the two walls' own thickness: it IS the joint, not
 * decoration.
 *
 * A BLANKED socket (one that joins nothing — the kit contracts every module to
 * carry its full socket set, and a ship blanks what it does not join) is
 * closed the same derived way: by the owner module's own `fillsSocket` hatch
 * when it authors one (M2 — a room seals its own doorways), otherwise by a
 * **plug**: a blanking sleeve cut from the socket's own opening, lapped
 * `SEAM_PLUG_LIP_M` onto the surrounding wall so it is never edge-to-edge with
 * the doorway's cut faces, and deep enough to fill the wall it sits in (that
 * wall's thickness is read off the assembled module geometry, then bitten past
 * on both faces). A plug fills a REAL opening, so it is `solid: true` — M3-T3
 * folds solid seam parts into the deck's collision hull.
 *
 * Everything here is pure and measured; nothing throws on a bad ship. A seam
 * that cannot be closed reports problem strings (`SeamPlan.problems`), the
 * plan still exists, and the assembler gate (`assemblyProblems`) and the §8
 * invariant check (`checkSeamsWatertight`) both surface it.
 */

import { MM } from '../types'
import type { Aabb3, Facing, MaterialSlot, ModuleSource } from '../types'
import { moduleBounds } from '../kit/modules/types'
import type { ModuleAssembly } from '../kit/modules/types'
import type { KitPart } from '../kit/types'
import { partBounds } from '../kit/parts'
import { placePoint } from '../kit/modules/placement'
import { SEAM_TOLERANCES, withinWatertight } from '../spikes/seams/tolerances'
import { SOCKET_ENGAGE_RADIUS_MM, doorLabel, oppositeFacing, toMm } from '../validation'
import type { PlacedDoor } from '../validation'
import { joinLabel } from './joins'
import { pieceShapeOf } from './batches'
import { facingTurns, transformAabb } from './place'
import type {
  DeckAssembly,
  DeckJoin,
  PlacedModule,
  PlacedPart,
  SeamPlan,
  SeamRect,
  SeamSide,
  ShipAssembly,
  SocketScan,
} from './types'

/** §4 slot every seam part draws from: the joints are structural steel. */
export const SEAM_SLOT: MaterialSlot = 'bulkhead'

/**
 * How far a seal bites PAST each mating wall plane, meters. Redundant by
 * design: the M0-T2 caps allow up to a 5 mm placement residual, so a 30 mm
 * bite keeps every legal join sealed with 6× margin (15× the watertight cap).
 * It also has to exceed the kit's wall thickness so a sleeve can never fall
 * inside one wall and miss the other.
 */
export const SEAM_BITE_M = 0.03

/**
 * How far a sleeve's FREE edges overshoot the contact region, meters. The
 * contact boundary is where the module faces end; ending a sleeve exactly
 * there would put two faces in the same plane (z-fighting in the renderer,
 * knife-edge joins in the export). 10 mm is below the eye and always lands
 * inside neighbouring material.
 */
export const SEAM_OVERHANG_M = 0.01

/**
 * How far a plug laps onto the wall around its opening, meters. A plug is CUT
 * from its socket, so its edges would otherwise be coplanar with the doorway's
 * cut faces; the lap swallows the edge inside the wall's own material (the
 * kit's walls are 0.1 m thick, so a 20 mm lap always lands inside).
 */
export const SEAM_PLUG_LIP_M = 0.02

/** Depth a plug falls back to when no wall can be measured around its socket. */
export const SEAM_PLUG_FALLBACK_DEPTH_M = 2 * SEAM_BITE_M

/** Socket authoring budget (±0.5 mm), meters — the M0-T2 measured tolerance. */
const SOCKET_EPS_M = SEAM_TOLERANCES.maxSocketAuthoringErrorMm * MM

const AXIS_Y = 1
/** Extent below which a band/edge does not exist (float noise floor), m. */
const EXTENT_EPS_M = 1e-9
/** Coverage tolerance, meters (the generator emits exact edges). */
const COVER_EPS_M = 1e-6

/* ---------------------------------------------------------------- planes */

/** Facing order, so a facing pair is visited exactly once per module pair. */
const FACING_ORDER: readonly Facing[] = ['+x', '-x', '+z', '-z']

/** The world horizontal axis a facing's wall plane spans (±X → Z, ±Z → X). */
export function horizontalAxisOf(facing: Facing): 0 | 2 {
  return facing === '+x' || facing === '-x' ? 2 : 0
}

/** The world axis a facing's outward normal runs along. */
export function normalAxisOf(facing: Facing): 0 | 2 {
  return horizontalAxisOf(facing) === 0 ? 2 : 0
}

/** +1 when a facing points along its axis' positive direction. */
export function normalSignOf(facing: Facing): 1 | -1 {
  return facing === '+x' || facing === '+z' ? 1 : -1
}

/** The placed module's world AABB (its declared box, placed). */
export function moduleWorldBox(owner: PlacedModule): Aabb3 {
  return transformAabb(moduleBounds(owner.module), owner.origin, owner.rotation)
}

/** The wall-face rectangle a module presents at `facing` (world meters). */
export function faceRectOfFacing(owner: PlacedModule, facing: Facing): SeamRect {
  const box = moduleWorldBox(owner)
  const horizontal = horizontalAxisOf(facing)
  return {
    horizontal,
    uLo: box.min[horizontal],
    uHi: box.max[horizontal],
    vLo: box.min[AXIS_Y],
    vHi: box.max[AXIS_Y],
  }
}

/** World coordinate of a module's wall face at `facing`, meters. */
export function facePlaneOfFacing(owner: PlacedModule, facing: Facing): number {
  const box = moduleWorldBox(owner)
  const axis = normalAxisOf(facing)
  return normalSignOf(facing) === 1 ? box.max[axis] : box.min[axis]
}

/** The wall-face rectangle a door socket sits in (its owner's face, world). */
export function faceRectOf(owner: PlacedModule, door: PlacedDoor): SeamRect {
  return faceRectOfFacing(owner, door.facing)
}

/** The opening rectangle a door socket cuts in its wall plane (world). */
export function openingRectOf(door: PlacedDoor): SeamRect {
  const horizontal = horizontalAxisOf(door.facing)
  const halfU = door.width / 2
  const halfV = door.height / 2
  return {
    horizontal,
    uLo: door.center[horizontal] - halfU,
    uHi: door.center[horizontal] + halfU,
    vLo: door.center[AXIS_Y] - halfV,
    vHi: door.center[AXIS_Y] + halfV,
  }
}

/* ------------------------------------------------------------ rectangles */

function rect(
  horizontal: 0 | 2,
  uLo: number,
  uHi: number,
  vLo: number,
  vHi: number,
): SeamRect {
  return { horizontal, uLo, uHi, vLo, vHi }
}

/** Width of a rectangle along its plane's horizontal axis, meters. */
export function rectWidth(r: SeamRect): number {
  return r.uHi - r.uLo
}

/** Height of a rectangle along world Y, meters. */
export function rectHeight(r: SeamRect): number {
  return r.vHi - r.vLo
}

/** The two rectangles' overlap, or undefined when they do not overlap. */
export function rectIntersect(a: SeamRect, b: SeamRect): SeamRect | undefined {
  if (a.horizontal !== b.horizontal) return undefined
  const uLo = Math.max(a.uLo, b.uLo)
  const uHi = Math.min(a.uHi, b.uHi)
  const vLo = Math.max(a.vLo, b.vLo)
  const vHi = Math.min(a.vHi, b.vHi)
  if (uHi - uLo <= EXTENT_EPS_M || vHi - vLo <= EXTENT_EPS_M) return undefined
  return rect(a.horizontal, uLo, uHi, vLo, vHi)
}

/** The smallest rectangle containing both (they must share a wall plane). */
export function rectUnion(a: SeamRect, b: SeamRect): SeamRect {
  return rect(
    a.horizontal,
    Math.min(a.uLo, b.uLo),
    Math.max(a.uHi, b.uHi),
    Math.min(a.vLo, b.vLo),
    Math.max(a.vHi, b.vHi),
  )
}

/** True when `inner` lies inside `outer` (within `eps` meters). */
export function rectContains(
  outer: SeamRect,
  inner: SeamRect,
  eps: number = COVER_EPS_M,
): boolean {
  return (
    outer.horizontal === inner.horizontal &&
    inner.uLo >= outer.uLo - eps &&
    inner.uHi <= outer.uHi + eps &&
    inner.vLo >= outer.vLo - eps &&
    inner.vHi <= outer.vHi + eps
  )
}

/** Overlap area of two rectangles in one wall plane, m² (0 = disjoint). */
export function rectOverlapArea(a: SeamRect, b: SeamRect): number {
  const overlap = rectIntersect(a, b)
  return overlap === undefined ? 0 : rectWidth(overlap) * rectHeight(overlap)
}

/** A rectangle grown by `margin` on every side. */
export function rectGrow(r: SeamRect, margin: number): SeamRect {
  return rect(
    r.horizontal,
    r.uLo - margin,
    r.uHi + margin,
    r.vLo - margin,
    r.vHi + margin,
  )
}

/** True when two rectangles share an edge within `eps` meters. */
export function rectEdgesMeet(a: SeamRect, b: SeamRect, eps: number): boolean {
  if (a.horizontal !== b.horizontal) return false
  const touchesU = Math.abs(a.uLo - b.uHi) <= eps || Math.abs(a.uHi - b.uLo) <= eps
  const touchesV = Math.abs(a.vLo - b.vHi) <= eps || Math.abs(a.vHi - b.vLo) <= eps
  const overlapsU = Math.min(a.uHi, b.uHi) - Math.max(a.uLo, b.uLo) > eps
  const overlapsV = Math.min(a.vHi, b.vHi) - Math.max(a.vLo, b.vLo) > eps
  return (touchesU && overlapsV) || (touchesV && overlapsU)
}

/* -------------------------------------------------------------- annulus */

/** Which edges of an annulus member are free (module-face) edges. */
export interface SeamFreeEdges {
  uLo: boolean
  uHi: boolean
  vLo: boolean
  vHi: boolean
}

/** One band of `contact` minus `opening`, plus which of its edges may overshoot. */
export interface AnnulusMember {
  /** The exact rectangle the seal must cover. */
  rect: SeamRect
  /** Free edges: they lie on the contact boundary, so they may be overshot. */
  free: SeamFreeEdges
}

/**
 * `contact` minus `opening`, decomposed exactly the way `bulkheadParts` cuts a
 * wall panel: left/right jambs spanning the full contact height, then a sill
 * and/or lintel spanning only the opening's width. Bands with no extent are
 * omitted (a doorway standing on the floor line has no sill). An opening that
 * misses the contact region entirely leaves the whole contact region as the
 * annulus — the wall faces are solid there.
 */
export function annulusMembers(contact: SeamRect, opening: SeamRect): AnnulusMember[] {
  const horizontal = contact.horizontal
  const passage = rectIntersect(contact, opening)
  if (passage === undefined) {
    return [{ rect: contact, free: { uLo: true, uHi: true, vLo: true, vHi: true } }]
  }

  const members: AnnulusMember[] = []
  if (passage.uLo - contact.uLo > EXTENT_EPS_M) {
    members.push({
      rect: rect(horizontal, contact.uLo, passage.uLo, contact.vLo, contact.vHi),
      free: { uLo: true, uHi: false, vLo: true, vHi: true },
    })
  }
  if (contact.uHi - passage.uHi > EXTENT_EPS_M) {
    members.push({
      rect: rect(horizontal, passage.uHi, contact.uHi, contact.vLo, contact.vHi),
      free: { uLo: false, uHi: true, vLo: true, vHi: true },
    })
  }
  if (passage.vLo - contact.vLo > EXTENT_EPS_M) {
    members.push({
      rect: rect(horizontal, passage.uLo, passage.uHi, contact.vLo, passage.vLo),
      free: { uLo: false, uHi: false, vLo: true, vHi: false },
    })
  }
  if (contact.vHi - passage.vHi > EXTENT_EPS_M) {
    members.push({
      rect: rect(horizontal, passage.uLo, passage.uHi, passage.vHi, contact.vHi),
      free: { uLo: false, uHi: false, vLo: false, vHi: true },
    })
  }
  return members
}

/** A member's rectangle with its free edges overshot by `overhang` meters. */
export function overshootMember(member: AnnulusMember, overhang: number): SeamRect {
  const { rect: r, free } = member
  return rect(
    r.horizontal,
    free.uLo ? r.uLo - overhang : r.uLo,
    free.uHi ? r.uHi + overhang : r.uHi,
    free.vLo ? r.vLo - overhang : r.vLo,
    free.vHi ? r.vHi + overhang : r.vHi,
  )
}

/* ---------------------------------------------------------------- parts */

/**
 * The structural box a plane rectangle becomes when extruded along its wall
 * normal: `depth` meters of wall centred on `normalCenter`, authored in the
 * SOCKET'S OWN FRAME (local +Z = the wall normal, local X = the plane's
 * horizontal axis) exactly like the kit's hatch — so the same plate generated
 * for two different wall facings is one mould, and the M3-T1 partition batches
 * them together (M3-T7's draw-call ceiling).
 */
export function sealPartFor(
  r: SeamRect,
  facing: Facing,
  depth: number,
  normalCenter: number,
): KitPart {
  const normalAxis = r.horizontal === 0 ? 2 : 0
  const size: [number, number, number] = [rectWidth(r), rectHeight(r), depth]
  const position: [number, number, number] = [0, 0, 0]
  position[r.horizontal] = (r.uLo + r.uHi) / 2
  position[AXIS_Y] = (r.vLo + r.vHi) / 2
  position[normalAxis] = normalCenter
  // A quarter-turn yaw is omitted when it is 0 (repo convention: `placePart`
  // with turns 0 must reproduce the part field-for-field).
  const turns = facingTurns(facing)
  return {
    kind: 'box',
    materialSlot: SEAM_SLOT,
    size,
    position,
    ...(turns === 0 ? {} : { rotation: turns }),
  }
}

/** Wrap a generated part as a placed part with provenance + instancing key. */
export function placedSeamPart(part: KitPart, source: ModuleSource): PlacedPart {
  return {
    part,
    materialSlot: part.materialSlot,
    pieceId: pieceShapeOf(part).id,
    source,
  }
}

/** The provenance a socket's owner hands to the geometry generated from it. */
export function sourceOfDoor(door: PlacedDoor): ModuleSource {
  return { deckId: door.deckId, moduleId: door.moduleId, moduleIndex: door.moduleIndex }
}

/** The owner module instance of a door socket, when the deck has one. */
export function ownerOfDoor(
  modules: readonly PlacedModule[],
  door: PlacedDoor,
): PlacedModule | undefined {
  return modules.find(
    (owner) =>
      owner.source.moduleId === door.moduleId &&
      owner.source.moduleIndex === door.moduleIndex,
  )
}

/** One placed part's extent along a world axis, meters. */
function extentOn(entry: PlacedPart, axis: 0 | 2): [number, number] {
  const bounds = partBounds(entry.part)
  return [bounds.min[axis], bounds.max[axis]]
}

/**
 * The footprint a part covers in a wall plane whose horizontal axis is
 * `horizontal` (0 = X, 2 = Z). The axis is passed in — never inferred from the
 * box's own size, because a yawed box carries its size in its LOCAL frame while
 * its world bounds are already rotated (the kit's side walls are exactly that
 * case).
 */
function footprintOn(entry: PlacedPart, horizontal: 0 | 2): SeamRect {
  const bounds = partBounds(entry.part)
  return rect(
    horizontal,
    bounds.min[horizontal],
    bounds.max[horizontal],
    bounds.min[AXIS_Y],
    bounds.max[AXIS_Y],
  )
}

/**
 * The wall a socket sits in, MEASURED off the assembled module geometry: the
 * owner parts that straddle the socket plane inward (opposite the socket's
 * outward facing) and whose in-plane footprint shares an edge with the
 * opening — i.e. the panel the doorway is cut into, never the opening itself.
 * The thinnest such candidate wins (a perpendicular wall running past the
 * plane is a candidate too, but it is always thicker). Returns the wall's
 * interval along the wall normal in world meters, or undefined when the module
 * carries no wall around that socket.
 */
export function wallExtentOf(
  owner: PlacedModule,
  door: PlacedDoor,
): [number, number] | undefined {
  const axis = normalAxisOf(door.facing)
  const sign = normalSignOf(door.facing)
  const plane = door.center[axis]
  const opening = openingRectOf(door)

  let thickness = Infinity
  for (const entry of owner.parts) {
    const [lo, hi] = extentOn(entry, axis)
    if (!(lo - SOCKET_EPS_M <= plane && plane <= hi + SOCKET_EPS_M)) continue
    const inward = sign === 1 ? plane - lo : hi - plane
    if (!(inward > EXTENT_EPS_M)) continue // touches the plane but does not span the wall
    if (!rectEdgesMeet(footprintOn(entry, opening.horizontal), opening, SOCKET_EPS_M))
      continue
    thickness = Math.min(thickness, inward)
  }
  if (!Number.isFinite(thickness)) return undefined
  return sign === 1 ? [plane - thickness, plane] : [plane, plane + thickness]
}

/**
 * The owner module's own sealing assembly for a socket: the `fillsSocket`
 * assembly seated ON that socket (the kit rule: a hatch's local origin IS the
 * door centre, so the pairing is an anchor comparison, not a guess — the same
 * rule the assembler's hatch interactives use).
 */
export function selfSealingAssemblyOf(
  owner: PlacedModule | undefined,
  door: PlacedDoor,
): ModuleAssembly | undefined {
  if (owner === undefined) return undefined
  return owner.module.assemblies.find((assembly) => {
    if (assembly.fillsSocket !== true) return false
    const origin = placePoint(assembly.placement.position ?? [0, 0, 0], {
      position: owner.origin,
      rotation: owner.rotation,
    })
    return door.center.every(
      (value, index) => Math.abs(value - origin[index]) <= SOCKET_EPS_M,
    )
  })
}

/**
 * The owner module's own sealing parts for a socket: the slice of the module's
 * PLACED parts that belongs to the `fillsSocket` assembly seated on it (same
 * objects the deck already draws — evidence, never a re-generation). Empty when
 * the socket seals nothing by itself.
 */
export function selfSealedParts(
  owner: PlacedModule | undefined,
  door: PlacedDoor,
): PlacedPart[] {
  const assembly = selfSealingAssemblyOf(owner, door)
  if (assembly === undefined || owner === undefined) return []
  let offset = 0
  for (const candidate of owner.module.assemblies) {
    if (candidate === assembly) {
      return owner.parts.slice(offset, offset + assembly.parts.length)
    }
    offset += candidate.parts.length
  }
  return []
}

/* ------------------------------------------------------------- measuring */

/**
 * Measure a generated seal against the geometry it must close — the §8 bullet
 * 1 measurement, exported because it is the primitive M3-T3/T7 and the QA
 * report card reason about:
 *
 *  - every required rectangle is covered by at least one emitted part;
 *  - the covering parts reach past `lo` and `hi` (the two wall planes of a
 *    join, or the two faces of the wall a plug fills) — the BITE;
 *  - `mustCover` (a plug's opening + the wall interval it fills) is covered
 *    and spanned end to end;
 *  - no part intrudes into `passage` (a join's doorway stays clear).
 *
 * `horizontal` is the wall plane's horizontal world axis (`opening.horizontal`);
 * the wall normal is the other horizontal axis.
 */
export function measureSealCoverage(
  parts: readonly PlacedPart[],
  required: readonly SeamRect[],
  lo: number,
  hi: number,
  mustCover: { opening: SeamRect; wall: [number, number] } | undefined,
  passage: SeamRect | undefined,
  horizontal: 0 | 2,
): { problems: string[]; biteLo: number; biteHi: number } {
  const problems: string[] = []
  const axis: 0 | 2 = horizontal === 0 ? 2 : 0
  if (parts.length === 0) {
    return {
      problems: required.length > 0 ? ['no sealing geometry was generated'] : [],
      biteLo: 0,
      biteHi: 0,
    }
  }
  let biteLo = Infinity
  let biteHi = Infinity

  for (const r of required) {
    const covering = parts.filter((entry) =>
      rectContains(footprintOn(entry, horizontal), r, COVER_EPS_M),
    )
    if (covering.length === 0) {
      problems.push(
        `the generated seal does not cover a ${rectWidth(r).toFixed(3)} × ` +
          `${rectHeight(r).toFixed(3)} m band of the seam — an open leak`,
      )
      biteLo = -Infinity
      biteHi = -Infinity
      continue
    }
    const coverLo = Math.min(...covering.map((entry) => extentOn(entry, axis)[0]))
    const coverHi = Math.max(...covering.map((entry) => extentOn(entry, axis)[1]))
    if (coverLo > lo + COVER_EPS_M) {
      problems.push(
        `the generated seal stops ${toMm(coverLo - lo).toFixed(1)} mm short of the near wall ` +
          `plane (${toMm(lo).toFixed(1)} mm) — an open seam`,
      )
    }
    if (coverHi < hi - COVER_EPS_M) {
      problems.push(
        `the generated seal stops ${toMm(hi - coverHi).toFixed(1)} mm short of the far wall ` +
          `plane (${toMm(hi).toFixed(1)} mm) — an open seam`,
      )
    }
    biteLo = Math.min(biteLo, lo - coverLo)
    biteHi = Math.min(biteHi, coverHi - hi)
  }

  if (mustCover !== undefined) {
    if (
      !rectContains(footprintOn(parts[0], horizontal), mustCover.opening, COVER_EPS_M)
    ) {
      problems.push('the plug does not cover the opening it fills')
    }
    const coverLo = Math.min(...parts.map((entry) => extentOn(entry, axis)[0]))
    const coverHi = Math.max(...parts.map((entry) => extentOn(entry, axis)[1]))
    if (
      coverLo > mustCover.wall[0] + COVER_EPS_M ||
      coverHi < mustCover.wall[1] - COVER_EPS_M
    ) {
      problems.push(
        `the plug does not fill the wall it sits in (needs ` +
          `${toMm(mustCover.wall[0]).toFixed(1)}…${toMm(mustCover.wall[1]).toFixed(1)} mm, ` +
          `spans ${toMm(coverLo).toFixed(1)}…${toMm(coverHi).toFixed(1)} mm)`,
      )
    }
    biteLo = Math.min(biteLo, mustCover.wall[0] - coverLo)
    biteHi = Math.min(biteHi, coverHi - mustCover.wall[1])
  }

  if (passage !== undefined) {
    for (const entry of parts) {
      const overlap = rectOverlapArea(footprintOn(entry, horizontal), passage)
      if (overlap > COVER_EPS_M) {
        problems.push(
          `the generated seal intrudes ${(overlap * 1e6).toFixed(0)} mm² into the ` +
            `pass-through opening it frames`,
        )
        break
      }
    }
  }

  return {
    problems,
    biteLo: Number.isFinite(biteLo) ? biteLo : 0,
    biteHi: Number.isFinite(biteHi) ? biteHi : 0,
  }
}

/* ----------------------------------------------------------------- plans */

/** One side record: the socket, its wall plane, its measured bite. */
function sideOf(
  side: 'a' | 'b',
  door: PlacedDoor,
  plane: number,
  biteM: number,
): SeamSide {
  return { side, door, plane, biteM }
}

/**
 * The mating sleeve of a join: the contact annulus, extruded across the seam.
 * Every dimension comes from the two sockets (openings, centers, facings) and
 * the two owner modules' declared face rectangles — nothing is freehand.
 */
export function seamPlanForJoin(
  join: DeckJoin,
  ownerA: PlacedModule,
  ownerB: PlacedModule,
  index: number,
  deckId: string,
): SeamPlan {
  const axis = normalAxisOf(join.a.facing)
  const planeA = join.a.center[axis]
  const planeB = join.b.center[axis]
  const lo = Math.min(planeA, planeB)
  const hi = Math.max(planeA, planeB)
  const gapMm = toMm(Math.abs(planeB - planeA))
  const depth = hi - lo + 2 * SEAM_BITE_M
  const center = (lo + hi) / 2

  const problems: string[] = []
  let contact: SeamRect | undefined
  let opening: SeamRect = openingRectOf(join.a)
  let required: SeamRect[] = []
  let parts: PlacedPart[] = []

  if (horizontalAxisOf(join.a.facing) !== horizontalAxisOf(join.b.facing)) {
    problems.push(
      `the two sockets of ${joinLabel(join)} do not present parallel wall planes`,
    )
  } else {
    opening = rectUnion(openingRectOf(join.a), openingRectOf(join.b))
    contact = rectIntersect(faceRectOf(ownerA, join.a), faceRectOf(ownerB, join.b))
    if (contact === undefined) {
      problems.push(
        `the mating wall faces of ${joinLabel(join)} do not overlap — there is no ` +
          `contact area to seal`,
      )
    } else {
      const members = annulusMembers(contact, opening)
      required = members.map((member) => member.rect)
      parts = members.map((member) =>
        placedSeamPart(
          sealPartFor(
            overshootMember(member, SEAM_OVERHANG_M),
            join.a.facing,
            depth,
            center,
          ),
          sourceOfDoor(join.b),
        ),
      )
    }
  }

  if (!withinWatertight(gapMm)) {
    problems.push(
      `open seam of ${gapMm.toFixed(1)} mm between the mating wall faces of ` +
        `${joinLabel(join)} — the watertight cap is < ${SEAM_TOLERANCES.watertightGapMm} mm`,
    )
  }

  // Measured on the emitted geometry: coverage, bite, and a clear passage.
  const passage = contact === undefined ? undefined : rectIntersect(contact, opening)
  const measured = measureSealCoverage(
    parts,
    required,
    lo,
    hi,
    undefined,
    passage,
    opening.horizontal,
  )
  problems.push(...measured.problems)

  const biteOf = (plane: number): number =>
    plane <= lo ? measured.biteLo : measured.biteHi
  const fallback = contact ?? faceRectOf(ownerA, join.a)

  return {
    id: `deck-${join.a.deckIndex}-seam-${index}-${join.kind}`,
    kind: join.kind,
    deckIndex: join.a.deckIndex,
    deckId,
    doors: [join.a, join.b],
    contact: fallback,
    opening,
    required,
    gapMm,
    sides: [
      sideOf('a', join.a, planeA, biteOf(planeA)),
      sideOf('b', join.b, planeB, biteOf(planeB)),
    ],
    sealedBy: parts.length > 0 ? 'sleeve' : 'none',
    parts,
    solid: false,
    sealEvidence: [],
    watertight: problems.length === 0,
    problems,
  }
}

/**
 * The closing of one blanked socket: the owner's own hatch when it authors one
 * (evidence only — that geometry is already part of the module), otherwise a
 * plug cut from the socket's own opening.
 */
export function seamPlanForBlank(
  door: PlacedDoor,
  owner: PlacedModule | undefined,
  index: number,
  deckId: string,
): SeamPlan {
  const axis = normalAxisOf(door.facing)
  const plane = door.center[axis]
  const opening = openingRectOf(door)
  const contact = owner === undefined ? opening : faceRectOf(owner, door)
  const problems: string[] = []

  const evidence = selfSealedParts(owner, door)
  if (evidence.length > 0) {
    const [lo, hi] = extentOfAny(evidence, axis)
    if (!(lo <= plane && hi >= plane)) {
      problems.push(
        `${doorLabel(door)} is sealed by the module's own hatch, but that hatch does not ` +
          `straddle the socket plane (it spans ${toMm(lo).toFixed(1)}…${toMm(hi).toFixed(1)} mm ` +
          `against a plane at ${toMm(plane).toFixed(1)} mm)`,
      )
    }
    return {
      id: `deck-${door.deckIndex}-seam-${index}-blank`,
      kind: 'blank',
      deckIndex: door.deckIndex,
      deckId,
      doors: [door],
      contact,
      opening,
      required: [],
      gapMm: 0,
      sides: [sideOf('a', door, plane, lo <= plane && hi >= plane ? 0 : -1)],
      sealedBy: 'hatch',
      parts: [],
      solid: false,
      sealEvidence: evidence,
      watertight: problems.length === 0,
      problems,
    }
  }

  const wall = owner === undefined ? undefined : wallExtentOf(owner, door)
  const sealLo =
    wall === undefined ? plane - SEAM_PLUG_FALLBACK_DEPTH_M / 2 : wall[0] - SEAM_BITE_M
  const sealHi =
    wall === undefined ? plane + SEAM_PLUG_FALLBACK_DEPTH_M / 2 : wall[1] + SEAM_BITE_M
  const plug = placedSeamPart(
    sealPartFor(
      rectGrow(opening, SEAM_PLUG_LIP_M),
      door.facing,
      sealHi - sealLo,
      (sealLo + sealHi) / 2,
    ),
    sourceOfDoor(door),
  )

  if (owner === undefined) {
    problems.push(
      `${doorLabel(door)} has no owner module instance on its deck — the blank was plugged ` +
        `from the socket alone, without measuring the wall it should fill`,
    )
  } else if (wall === undefined) {
    problems.push(
      `${doorLabel(door)} has no wall measured around its opening in ` +
        `"${owner.source.moduleId}"#${owner.source.moduleIndex} — the plug fell back to a ` +
        `${toMm(SEAM_PLUG_FALLBACK_DEPTH_M).toFixed(0)} mm plate`,
    )
  }

  const measured = measureSealCoverage(
    [plug],
    [opening],
    wall === undefined ? sealLo : wall[0],
    wall === undefined ? sealHi : wall[1],
    { opening, wall: wall ?? [sealLo + SEAM_BITE_M, sealHi - SEAM_BITE_M] },
    undefined,
    opening.horizontal,
  )
  problems.push(...measured.problems)

  return {
    id: `deck-${door.deckIndex}-seam-${index}-blank`,
    kind: 'blank',
    deckIndex: door.deckIndex,
    deckId,
    doors: [door],
    contact,
    opening,
    required: [opening],
    gapMm: 0,
    sides: [sideOf('a', door, plane, measured.biteLo)],
    sealedBy: 'plug',
    parts: [plug],
    solid: true,
    sealEvidence: [],
    watertight: problems.length === 0,
    problems,
  }
}

/** Min/max extent of a part list along a world axis, meters. */
function extentOfAny(parts: readonly PlacedPart[], axis: 0 | 2): [number, number] {
  return [
    Math.min(...parts.map((entry) => extentOn(entry, axis)[0])),
    Math.max(...parts.map((entry) => extentOn(entry, axis)[1])),
  ]
}

/* ------------------------------------------------------------ deck / ship */

/**
 * Every seam of one deck, in scan order: one sleeve plan per join, then one
 * plan per blanked socket (hatch-sealed or plugged). Deterministic.
 */
export function seamPlansForDeck(
  modules: readonly PlacedModule[],
  scan: SocketScan,
  deckIndex: number,
  deckId: string,
): SeamPlan[] {
  const plans: SeamPlan[] = []
  for (const join of scan.joins) {
    const ownerA = ownerOfDoor(modules, join.a)
    const ownerB = ownerOfDoor(modules, join.b)
    if (ownerA === undefined || ownerB === undefined) {
      plans.push(unresolvablePlan(join, plans.length, deckIndex, deckId))
      continue
    }
    plans.push(seamPlanForJoin(join, ownerA, ownerB, plans.length, deckId))
  }
  for (const door of scan.blanks) {
    plans.push(seamPlanForBlank(door, ownerOfDoor(modules, door), plans.length, deckId))
  }
  return plans
}

/** A join whose owner modules are missing from the deck (reported, not invented). */
function unresolvablePlan(
  join: DeckJoin,
  index: number,
  deckIndex: number,
  deckId: string,
): SeamPlan {
  const problem =
    `${joinLabel(join)} has no owner module instance on its deck — no mating geometry ` +
    `can be generated for it`
  return {
    id: `deck-${deckIndex}-seam-${index}-unresolved`,
    kind: join.kind,
    deckIndex,
    deckId,
    doors: [join.a, join.b],
    contact: openingRectOf(join.a),
    opening: openingRectOf(join.a),
    required: [],
    gapMm: 0,
    sides: [sideOf('a', join.a, 0, 0), sideOf('b', join.b, 0, 0)],
    sealedBy: 'none',
    parts: [],
    solid: false,
    sealEvidence: [],
    watertight: false,
    problems: [problem],
  }
}

/** Every seam of every deck of an assembled ship, deck order. */
export function seamPlansOf(ship: ShipAssembly): SeamPlan[] {
  return ship.decks.flatMap((deck) => deck.seams)
}

/** Every generated seam part of one deck (part of its geometry partition). */
export function seamPartsOf(deck: DeckAssembly): PlacedPart[] {
  return deck.seams.flatMap((plan) => plan.parts)
}

/** The seam parts that must block a walker — M3-T3's hull input. */
export function seamSolidParts(deck: DeckAssembly): PlacedPart[] {
  return deck.seams.filter((plan) => plan.solid).flatMap((plan) => plan.parts)
}

/**
 * §8 bullet 1 problems as the ASSEMBLED ship sees them: every sleeve's gap,
 * coverage, bite and passage, plus a meet check for module faces that touch
 * without a door socket between them ("every door-socket join and bulkhead
 * meet").
 */
export function seamsWatertightProblems(ship: ShipAssembly): string[] {
  const problems: string[] = []
  for (const deck of ship.decks) {
    for (const plan of deck.seams) {
      for (const problem of plan.problems) {
        problems.push(
          `deck ${deck.deckIndex} ("${deck.deckId}") ${plan.id}: ${problem}`,
        )
      }
    }
    problems.push(...bulkheadMeetProblems(deck))
  }
  return problems
}

/**
 * Module faces that touch (within the socket engagement radius) with
 * overlapping rectangles but are NOT a door-socket join: the §8 bullet 1
 * "bulkhead meet" half. A join already owns its seam, so joined pairs are
 * skipped here — this catches contact between modules that carry no socket
 * interface at all.
 */
export function bulkheadMeetProblems(deck: DeckAssembly): string[] {
  const problems: string[] = []
  const modules = deck.modules

  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i]
      const b = modules[j]
      if (joinedPair(deck.joins, a, b)) continue
      for (const facing of FACING_ORDER) {
        const opposite = oppositeFacing(facing)
        if (FACING_ORDER.indexOf(facing) > FACING_ORDER.indexOf(opposite)) continue
        const gapMm = toMm(
          Math.abs(facePlaneOfFacing(b, opposite) - facePlaneOfFacing(a, facing)),
        )
        if (gapMm > SOCKET_ENGAGE_RADIUS_MM) continue // the faces do not engage
        const overlap = rectOverlapArea(
          faceRectOfFacing(a, facing),
          faceRectOfFacing(b, opposite),
        )
        if (overlap <= COVER_EPS_M) continue // touching along an edge only
        if (!withinWatertight(gapMm)) {
          problems.push(
            `deck ${deck.deckIndex} ("${deck.deckId}") bulkhead meet ` +
              `${a.source.moduleId}#${a.source.moduleIndex} "${facing}" ↔ ` +
              `${b.source.moduleId}#${b.source.moduleIndex} "${opposite}": ` +
              `${gapMm.toFixed(1)} mm gap over ${overlap.toFixed(2)} m² — the watertight ` +
              `cap is < ${SEAM_TOLERANCES.watertightGapMm} mm`,
          )
        }
      }
    }
  }
  return problems
}

/** True when two module instances form a join (a seam already owns their contact). */
function joinedPair(
  joins: readonly DeckJoin[],
  a: PlacedModule,
  b: PlacedModule,
): boolean {
  return joins.some(
    (join) =>
      (ownerMatches(join.a, a) && ownerMatches(join.b, b)) ||
      (ownerMatches(join.a, b) && ownerMatches(join.b, a)),
  )
}

/** True when a placed door belongs to a module instance. */
function ownerMatches(door: PlacedDoor, owner: PlacedModule): boolean {
  return (
    door.moduleId === owner.source.moduleId &&
    door.moduleIndex === owner.source.moduleIndex
  )
}

/** Tallies for a seam report line. */
export function seamTally(ship: ShipAssembly): {
  joins: number
  blanks: number
  sleeved: number
  plugged: number
  hatchSealed: number
  parts: number
  maxGapMm: number
  minBiteM: number
} {
  const plans = seamPlansOf(ship)
  // Only GENERATED seals have a bite: a socket the module's own hatch closes
  // generates no geometry here (that hatch is the module's, M2).
  const bites = plans
    .filter((plan) => plan.sealedBy === 'sleeve' || plan.sealedBy === 'plug')
    .flatMap((plan) => plan.sides.map((side) => side.biteM))
    .filter((bite) => Number.isFinite(bite))
  return {
    joins: plans.filter((plan) => plan.kind !== 'blank').length,
    blanks: plans.filter((plan) => plan.kind === 'blank').length,
    sleeved: plans.filter((plan) => plan.sealedBy === 'sleeve').length,
    plugged: plans.filter((plan) => plan.sealedBy === 'plug').length,
    hatchSealed: plans.filter((plan) => plan.sealedBy === 'hatch').length,
    parts: plans.reduce((sum, plan) => sum + plan.parts.length, 0),
    maxGapMm: plans.reduce((max, plan) => Math.max(max, plan.gapMm), 0),
    minBiteM: bites.length === 0 ? 0 : Math.min(...bites),
  }
}
