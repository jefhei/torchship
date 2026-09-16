/**
 * M2-T1 — parametric part builders for the kit primitives.
 *
 * Each primitive is authored ONCE here as a pure function from parameters to
 * a list of `KitPart`s: axis-aligned boxes and cylinders in the primitive's
 * local frame, each tagged with the §4 material slot it draws from. Nothing
 * three.js-specific — the R3F layer (src/kit/render/) maps parts onto meshes,
 * the M3-T7 merge/instance pass consumes the same lists, and the seam/hatch
 * checks can never see freehand geometry (BUILD_PLAN execution rule 8).
 *
 * Frames. The M1-T2 kit authoring frame applies to whole MODULES (floor at
 * local y = 0, footprint centred on the origin in XZ). It applies to the
 * floor-standing primitives too — bulkhead, ladder segment, locker, couch,
 * table and coffee station grow upward from y = 0. Fixtures that hang on a
 * wall or ceiling (conduit run, panel light, hatch, screen, heat shield) are
 * authored about their own centre and PLACED by the caller; the hatch is
 * socket-centred because it seals a DoorSocket (position = door centre).
 *
 * Every computed coordinate is normalized through `n0` (−0 → 0): vitest's
 * Object.is-strict matchers treat −0 and +0 as distinct, and the repo
 * normalizes on every grid-math return path (src/types/geometry.ts,
 * src/types/units.ts).
 */

import { MATERIAL_SLOTS } from '../types'
import type { Aabb3, MaterialSlot, Vec3 } from '../types'
import type { BoxPart, CylinderPart, KitPart, PartAxis } from './types'

/** Tolerance for "is this dimension effectively zero" checks, meters. */
const EPS = 1e-9

/** Normalize −0 → 0 so downstream Object.is-strict comparisons stay clean. */
function n0(x: number): number {
  return x === 0 ? 0 : x
}

function box(materialSlot: MaterialSlot, size: Vec3, position: Vec3): BoxPart {
  return { kind: 'box', materialSlot, size, position }
}

function cyl(
  materialSlot: MaterialSlot,
  radius: number,
  length: number,
  axis: PartAxis,
  position: Vec3,
): CylinderPart {
  return { kind: 'cylinder', materialSlot, radius, length, axis, position }
}

function requirePositive(values: Record<string, number>, what: string): void {
  for (const [name, value] of Object.entries(values)) {
    if (!(value > 0)) {
      throw new Error(`${what}: ${name} must be positive, got ${value}`)
    }
  }
}

/* ------------------------------------------------------------------ shell */

export interface BulkheadDoor {
  width: number
  height: number
  /** Door-centre height above the panel's bottom edge, meters. */
  centerY: number
  /**
   * Door-centre offset along the panel's local X, meters; omitted = 0, i.e.
   * the doorway is centred in the panel. A side door sits off-centre in its
   * wall (the galley's `side-door`, ops' `side-door`, engineering's
   * `high-hatch`), so the module authors place the opening along the wall
   * with the same builder that cuts it — never with freehand geometry
   * (BUILD_PLAN rule 8).
   */
  centerX?: number
}

export interface BulkheadParams {
  width: number
  height: number
  thickness: number
  /** Optional doorway cut through the panel; omitted = solid wall panel. */
  door?: BulkheadDoor
}

/**
 * A wall panel in the local XY plane (normal = ±Z), standing on y = 0. With a
 * doorway, the panel is emitted as the pieces that SURROUND the opening —
 * two piers, a sill below and a lintel above — so the hole is exactly
 * `door.width × door.height` (laterally centred on `door.centerX`) and the
 * solid area is exactly
 * `width·height − door.width·door.height`. That is the geometry the M3-T2
 * watertight check measures against.
 */
export function bulkheadParts(params: BulkheadParams): KitPart[] {
  const { width, height, thickness, door } = params
  requirePositive({ width, height, thickness }, 'bulkhead')
  if (door === undefined) {
    return [box('bulkhead', [width, height, thickness], [0, n0(height / 2), 0])]
  }

  const { width: doorWidth, height: doorHeight, centerY } = door
  const centerX = door.centerX ?? 0
  requirePositive({ 'door.width': doorWidth, 'door.height': doorHeight }, 'bulkhead')
  if (!Number.isFinite(centerX)) {
    throw new Error(`bulkhead: door.centerX must be finite, got ${centerX}`)
  }
  const bottom = n0(centerY - doorHeight / 2)
  const top = n0(centerY + doorHeight / 2)
  if (bottom < -EPS || top > height + EPS) {
    throw new Error(
      `bulkhead: doorway ${doorWidth} × ${doorHeight} m at centre y ${centerY} ` +
        `does not fit a ${height} m panel`,
    )
  }

  // Wall material left of and right of the opening. Both must survive: a door
  // as wide as the panel (or one pushed off the edge by its centerX) leaves
  // nothing to hang the doorway in.
  const pier = n0((width - doorWidth) / 2)
  const leftPier = n0(pier + centerX)
  const rightPier = n0(pier - centerX)
  if (leftPier <= EPS || rightPier <= EPS) {
    throw new Error(
      `bulkhead: doorway ${doorWidth} m wide at centre x ${centerX} m ` +
        `leaves no panel of a ${width} m wall`,
    )
  }

  // Pier centres: the opening's offset shifts each centre by half of it — the
  // pier on the side the door moves TOWARD loses the full offset of width, so
  // its centre moves by half of it (and vice versa). Both shift the same way.
  const parts: KitPart[] = [
    box(
      'bulkhead',
      [leftPier, height, thickness],
      [n0(-(doorWidth / 2 + pier / 2) + centerX / 2), n0(height / 2), 0],
    ),
    box(
      'bulkhead',
      [rightPier, height, thickness],
      [n0(doorWidth / 2 + pier / 2 + centerX / 2), n0(height / 2), 0],
    ),
  ]
  if (bottom > EPS) {
    parts.push(
      box('bulkhead', [doorWidth, bottom, thickness], [n0(centerX), n0(bottom / 2), 0]),
    )
  }
  const lintel = n0(height - top)
  if (lintel > EPS) {
    parts.push(
      box(
        'bulkhead',
        [doorWidth, lintel, thickness],
        [n0(centerX), n0((top + height) / 2), 0],
      ),
    )
  }
  return parts
}

export interface DeckPlateCableRuns {
  count: number
  /** Duct width across the plate, meters. */
  width: number
  /** Duct height above the walking surface, meters. */
  height: number
  /** Centre-to-centre spacing of the ducts along Z, meters. */
  spacing: number
}

/**
 * A hole through a deck plate — the vertical-navigation equivalent of a
 * bulkhead's doorway cut. The M2-T6 spine shaft's crawl opening (the ladder's
 * passage between decks) is the first consumer; it is cut by the builder, so
 * the shaft floor is never freehand geometry (BUILD_PLAN rule 8).
 */
export interface DeckPlateOpening {
  /** Opening extent along X, meters. */
  width: number
  /** Opening extent along Z, meters. */
  depth: number
  /** Opening centre along X, meters; omitted = 0 (centred in the plate). */
  centerX?: number
  /** Opening centre along Z, meters; omitted = 0 (centred in the plate). */
  centerZ?: number
}

export interface DeckPlateParams {
  width: number
  depth: number
  /** Plate thickness below the walking surface, meters. */
  thickness: number
  /** Raised cable-run ducts on the plate (§4: "deck plate with cable runs"). */
  cableRuns?: DeckPlateCableRuns
  /**
   * Optional crawl opening cut through the plate. The plate is then emitted
   * as the four pieces that SURROUND the hole, so the opening is exactly
   * `width × depth` and the solid area is exactly
   * `width·depth − opening.width·opening.depth` — the geometry the M3-T2
   * watertight check measures against. Mutually exclusive with `cableRuns`:
   * the ducts run the full width of the plate and an opening breaks them.
   */
  opening?: DeckPlateOpening
}

/**
 * A deck plate whose WALKING SURFACE is local y = 0 (the plate is the
 * structure beneath it, like the 0.2 m deck-plate in the deck pitch). Cable
 * runs sit on top of the plate as low ducts across the full width. With an
 * `opening`, the plate is instead a closed frame around a rectangular hole
 * (the crawl / ladder passage) — still four boxes, still built here.
 */
export function deckPlateParts(params: DeckPlateParams): KitPart[] {
  const { width, depth, thickness, cableRuns, opening } = params
  requirePositive({ width, depth, thickness }, 'deck plate')

  if (opening !== undefined) {
    return deckPlateFrame(width, depth, thickness, opening, cableRuns)
  }

  const parts: KitPart[] = [
    box('deckplate', [width, thickness, depth], [0, n0(-thickness / 2), 0]),
  ]

  if (cableRuns !== undefined) {
    const { count, width: runWidth, height: runHeight, spacing } = cableRuns
    requirePositive(
      {
        'cableRuns.width': runWidth,
        'cableRuns.height': runHeight,
        'cableRuns.spacing': spacing,
      },
      'deck plate',
    )
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `deck plate: cable-run count must be a non-negative integer, got ${count}`,
      )
    }
    for (let i = 0; i < count; i++) {
      const z = n0((i - (count - 1) / 2) * spacing)
      parts.push(
        box('conduit', [width, runHeight, runWidth], [0, n0(runHeight / 2), z]),
      )
    }
  }

  return parts
}

/**
 * A deck plate as the closed frame of DECKPLATE around a rectangular crawl
 * opening: a strip on either side of the hole along X (full depth) plus the
 * two end strips between them, all at the plate's own y (walking surface at
 * 0, structure below). The four strips are ordered −x, +x, −z, +z.
 */
function deckPlateFrame(
  width: number,
  depth: number,
  thickness: number,
  opening: DeckPlateOpening,
  cableRuns: DeckPlateCableRuns | undefined,
): KitPart[] {
  const { width: openingWidth, depth: openingDepth } = opening
  const centerX = opening.centerX ?? 0
  const centerZ = opening.centerZ ?? 0
  requirePositive(
    { 'opening.width': openingWidth, 'opening.depth': openingDepth },
    'deck plate',
  )
  if (!Number.isFinite(centerX)) {
    throw new Error(`deck plate: opening.centerX must be finite, got ${centerX}`)
  }
  if (!Number.isFinite(centerZ)) {
    throw new Error(`deck plate: opening.centerZ must be finite, got ${centerZ}`)
  }
  if (cableRuns !== undefined) {
    throw new Error(
      'deck plate: cable runs cannot cross a crawl opening — the ducts run the ' +
        'full width of the plate (route them on a plate without an opening)',
    )
  }

  const halfWidth = width / 2
  const halfDepth = depth / 2
  const xLo = n0(centerX - openingWidth / 2)
  const xHi = n0(centerX + openingWidth / 2)
  const zLo = n0(centerZ - openingDepth / 2)
  const zHi = n0(centerZ + openingDepth / 2)

  // Plate material left of and right of the hole (full depth), then the end
  // strips that close the frame between them. Every strip must survive: an
  // opening as large as the plate (or one pushed off its edge) leaves the
  // deck with nothing to walk on.
  const leftWidth = n0(xLo + halfWidth)
  const rightWidth = n0(halfWidth - xHi)
  const aftDepth = n0(zLo + halfDepth)
  const foreDepth = n0(halfDepth - zHi)
  if (leftWidth <= EPS || rightWidth <= EPS) {
    throw new Error(
      `deck plate: opening ${openingWidth} m wide at centre x ${centerX} m ` +
        `leaves no plate of a ${width} m deck`,
    )
  }
  if (aftDepth <= EPS || foreDepth <= EPS) {
    throw new Error(
      `deck plate: opening ${openingDepth} m deep at centre z ${centerZ} m ` +
        `leaves no plate of a ${depth} m deck`,
    )
  }

  const y = n0(-thickness / 2)
  return [
    box('deckplate', [leftWidth, thickness, depth], [n0((-halfWidth + xLo) / 2), y, 0]),
    box('deckplate', [rightWidth, thickness, depth], [n0((xHi + halfWidth) / 2), y, 0]),
    box(
      'deckplate',
      [openingWidth, thickness, aftDepth],
      [n0(centerX), y, n0((-halfDepth + zLo) / 2)],
    ),
    box(
      'deckplate',
      [openingWidth, thickness, foreDepth],
      [n0(centerX), y, n0((zHi + halfDepth) / 2)],
    ),
  ]
}

/* ---------------------------------------------------------------- utility */

export interface ConduitRunParams {
  length: number
  radius: number
  /** Direction the pipe runs in. */
  axis: PartAxis
  /** Pipe clamps along the run, evenly spaced between the ends. */
  brackets?: number
  /** Strap thickness of each clamp (perpendicular to the run), meters. */
  clampThickness?: number
}

/** Size + placer for a pipe clamp around a run of the given axis. */
function clampForAxis(
  axis: PartAxis,
  radius: number,
  thickness: number,
): { size: Vec3; at: (t: number) => Vec3 } {
  const across = n0(2 * radius + thickness)
  const dims: Record<PartAxis, Vec3> = {
    x: [thickness, across, across],
    y: [across, thickness, across],
    z: [across, across, thickness],
  }
  const at = (t: number): Vec3 => {
    if (axis === 'x') return [n0(t), 0, 0]
    if (axis === 'y') return [0, n0(t), 0]
    return [0, 0, n0(t)]
  }
  return { size: dims[axis], at }
}

/**
 * An exposed pipe/conduit run (cylinder along `axis`) with optional clamps.
 * Authored about its centre — the caller routes it along a bulkhead or
 * ceiling.
 */
export function conduitRunParts(params: ConduitRunParams): KitPart[] {
  const { length, radius, axis, brackets = 0, clampThickness = 0.03 } = params
  requirePositive({ length, radius, clampThickness }, 'conduit run')
  if (!Number.isInteger(brackets) || brackets < 0) {
    throw new Error(
      `conduit run: bracket count must be a non-negative integer, got ${brackets}`,
    )
  }

  const parts: KitPart[] = [cyl('conduit', radius, length, axis, [0, 0, 0])]
  const clamp = clampForAxis(axis, radius, clampThickness)
  for (let i = 0; i < brackets; i++) {
    const t = n0(-length / 2 + (length * (i + 1)) / (brackets + 1))
    parts.push(box('bulkhead', clamp.size, clamp.at(t)))
  }
  return parts
}

export interface PanelLightParams {
  width: number
  depth: number
  /** Housing height behind the lens, meters. */
  housingThickness: number
  /** Lens inset as a fraction of each half-extent, in [0, 0.5). */
  lensInset: number
}

/**
 * A recessed ceiling panel light: a bulkhead housing with an emissive
 * `panel-light` lens proud of the housing's local −Y face. Origin is the
 * housing centre; the M4 practical-light rig places the matching LightSocket.
 */
export function panelLightParts(params: PanelLightParams): KitPart[] {
  const { width, depth, housingThickness, lensInset } = params
  requirePositive({ width, depth, housingThickness }, 'panel light')
  if (!(lensInset >= 0 && lensInset < 0.5)) {
    throw new Error(`panel light: lensInset must be in [0, 0.5), got ${lensInset}`)
  }
  const inset = 1 - 2 * lensInset
  return [
    box('bulkhead', [width, housingThickness, depth], [0, 0, 0]),
    box(
      'panel-light',
      [n0(width * inset), n0(housingThickness * 0.6), n0(depth * inset)],
      [0, n0(-housingThickness * 0.5), 0],
    ),
  ]
}

/* ------------------------------------------------------------- navigation */

export interface HatchParams {
  /** Opening the hatch seals, meters (standard: 0.9 × 2.0). */
  door: { width: number; height: number }
  leafThickness: number
  /** Frame border width beyond the opening, meters. */
  frameWidth: number
  /** Gap between the leaf edge and the opening edge, meters. */
  clearance: number
}

/** Height of the knee-level hazard stripe on a hatch leaf, meters. */
const HATCH_STRIPE_HEIGHT = 0.12

/**
 * A hatch that seals a DoorSocket, SOCKET-CENTRED: the local origin is the
 * door centre in the opening's plane (local Z is the wall normal), so the
 * assembler seats it directly on a socket with no re-derivation. Emits the
 * leaf, the four-member frame around the opening, and the knee-level hazard
 * stripe (§4 worn hazard striping).
 */
export function hatchParts(params: HatchParams): KitPart[] {
  const { door, leafThickness, frameWidth, clearance } = params
  const { width: doorWidth, height: doorHeight } = door
  requirePositive(
    {
      'door.width': doorWidth,
      'door.height': doorHeight,
      leafThickness,
      frameWidth,
    },
    'hatch',
  )
  if (!(clearance >= 0)) {
    throw new Error(`hatch: clearance must be non-negative, got ${clearance}`)
  }
  const leafWidth = n0(doorWidth - 2 * clearance)
  const leafHeight = n0(doorHeight - 2 * clearance)
  if (!(leafWidth > 0) || !(leafHeight > 0)) {
    throw new Error(
      `hatch: clearance ${clearance} m leaves no leaf in a ` +
        `${doorWidth} × ${doorHeight} m opening`,
    )
  }
  const frameThickness = n0(leafThickness * 1.5)
  const halfW = n0(doorWidth / 2 + frameWidth / 2)
  const halfH = n0(doorHeight / 2 + frameWidth / 2)

  return [
    box('bulkhead', [leafWidth, leafHeight, leafThickness], [0, 0, 0]),
    box(
      'bulkhead',
      [n0(doorWidth + 2 * frameWidth), frameWidth, frameThickness],
      [0, halfH, 0],
    ),
    box(
      'bulkhead',
      [n0(doorWidth + 2 * frameWidth), frameWidth, frameThickness],
      [0, n0(-halfH), 0],
    ),
    box('bulkhead', [frameWidth, doorHeight, frameThickness], [n0(-halfW), 0, 0]),
    box('bulkhead', [frameWidth, doorHeight, frameThickness], [halfW, 0, 0]),
    box(
      'hazard',
      [leafWidth, HATCH_STRIPE_HEIGHT, n0(leafThickness * 1.1)],
      [0, n0(-doorHeight / 2 + clearance + HATCH_STRIPE_HEIGHT / 2 + 0.02), 0],
    ),
  ]
}

export interface LadderSegmentParams {
  height: number
  /** Centre-to-centre rail span, meters. */
  width: number
  railRadius: number
  rungRadius: number
  /** Vertical rung spacing, meters. */
  rungSpacing: number
  /** Height of the first rung above the floor; defaults to `rungSpacing`. */
  firstRungY?: number
}

/**
 * One storey of ladder: two rails (pipe stock, y = 0 → `height`) with rungs
 * spanning between them. The rung count is derived from the spacing, so the
 * M3-T5 climb state machine can read the rung heights straight off the parts
 * instead of re-deriving them.
 */
export function ladderSegmentParts(params: LadderSegmentParams): KitPart[] {
  const { height, width, railRadius, rungRadius, rungSpacing } = params
  requirePositive(
    { height, width, railRadius, rungRadius, rungSpacing },
    'ladder segment',
  )
  const firstRungY = params.firstRungY ?? rungSpacing
  requirePositive({ firstRungY }, 'ladder segment')
  if (firstRungY + rungRadius > height) {
    throw new Error(
      `ladder segment: first rung at ${firstRungY} m (radius ${rungRadius} m) ` +
        `does not fit a ${height} m segment`,
    )
  }
  const railInset = n0(width / 2 - railRadius)
  if (!(railInset > 0)) {
    throw new Error(
      `ladder segment: rails of radius ${railRadius} m overlap across a ${width} m span`,
    )
  }
  const rungLength = n0(width - 2 * railRadius)

  const parts: KitPart[] = [
    cyl('conduit', railRadius, height, 'y', [railInset, n0(height / 2), 0]),
    cyl('conduit', railRadius, height, 'y', [n0(-railInset), n0(height / 2), 0]),
  ]

  // Rungs are kept strictly inside the storey: the last one must not poke
  // through the deck plate above (the M3-T5 climb pass reads these heights).
  const count = Math.floor((height - rungRadius - firstRungY) / rungSpacing + EPS) + 1
  if (count < 1) {
    throw new Error(
      `ladder segment: no rung fits a ${height} m storey at ${rungSpacing} m spacing`,
    )
  }
  for (let i = 0; i < count; i++) {
    parts.push(
      cyl('bulkhead', rungRadius, rungLength, 'x', [
        0,
        n0(firstRungY + i * rungSpacing),
        0,
      ]),
    )
  }
  return parts
}

/* ------------------------------------------------------------------ props */

const LOCKER_HANDLE = { width: 0.02, height: 0.12, depth: 0.02 } as const

export interface LockerParams {
  width: number
  height: number
  depth: number
  doors: number
  doorThickness: number
  doorGap: number
}

/** An equipment locker bank standing on the floor, with door panels + handles. */
export function lockerParts(params: LockerParams): KitPart[] {
  const { width, height, depth, doors, doorThickness, doorGap } = params
  requirePositive({ width, height, depth, doorThickness }, 'locker')
  if (!Number.isInteger(doors) || doors < 1) {
    throw new Error(`locker: door count must be a positive integer, got ${doors}`)
  }
  if (!(doorGap >= 0)) {
    throw new Error(`locker: doorGap must be non-negative, got ${doorGap}`)
  }
  const doorWidth = n0(width / doors)
  const panelWidth = n0(doorWidth - doorGap)
  const panelHeight = n0(height - 2 * doorGap)
  if (!(panelWidth > 0) || !(panelHeight > 0)) {
    throw new Error(
      `locker: ${doors} door(s) with ${doorGap} m gaps do not fit a ` +
        `${width} × ${height} m face`,
    )
  }

  const parts: KitPart[] = [
    box('bulkhead', [width, height, depth], [0, n0(height / 2), 0]),
  ]
  for (let i = 0; i < doors; i++) {
    const x = n0(-width / 2 + doorWidth * (i + 0.5))
    parts.push(
      box(
        'bulkhead',
        [panelWidth, panelHeight, doorThickness],
        [x, n0(height / 2), n0(depth / 2 + doorThickness / 2)],
      ),
    )
    parts.push(
      box(
        'conduit',
        [LOCKER_HANDLE.width, LOCKER_HANDLE.height, LOCKER_HANDLE.depth],
        [
          n0(x + doorWidth / 2 - 0.08),
          n0(height / 2 - 0.12),
          n0(depth / 2 + doorThickness + LOCKER_HANDLE.depth / 2),
        ],
      ),
    )
  }
  return parts
}

export interface ScreenParams {
  width: number
  height: number
  depth: number
  bezel: number
}

/** A bulkhead bezel with an emissive `screen` panel proud of its +Z face. */
export function screenParts(params: ScreenParams): KitPart[] {
  const { width, height, depth, bezel } = params
  requirePositive({ width, height, depth }, 'screen')
  if (!(bezel >= 0)) {
    throw new Error(`screen: bezel must be non-negative, got ${bezel}`)
  }
  const panelWidth = n0(width - 2 * bezel)
  const panelHeight = n0(height - 2 * bezel)
  if (!(panelWidth > 0) || !(panelHeight > 0)) {
    throw new Error(
      `screen: bezel ${bezel} m leaves no panel in a ${width} × ${height} m screen`,
    )
  }
  return [
    box('bulkhead', [width, height, depth], [0, 0, 0]),
    box('screen', [panelWidth, panelHeight, n0(depth * 0.5)], [0, 0, n0(depth * 0.25)]),
  ]
}

export interface CouchParams {
  width: number
  depth: number
  /** Seat height above the floor, meters. */
  seatHeight: number
  /** Backrest height above the seat, meters. */
  backHeight: number
  /** Canvas webbing straps across the backrest. */
  straps: number
}

/** A crash couch facing +Z: pedestal, seat pan, backrest and webbing straps. */
export function couchParts(params: CouchParams): KitPart[] {
  const { width, depth, seatHeight, backHeight, straps } = params
  requirePositive({ width, depth, seatHeight, backHeight }, 'couch')
  if (!Number.isInteger(straps) || straps < 0) {
    throw new Error(`couch: strap count must be a non-negative integer, got ${straps}`)
  }
  const seatPan = 0.12
  const backThickness = 0.12
  const parts: KitPart[] = [
    box(
      'bulkhead',
      [n0(width * 0.5), seatHeight, n0(depth * 0.6)],
      [0, n0(seatHeight / 2), 0],
    ),
    box('bulkhead', [width, seatPan, depth], [0, n0(seatHeight - seatPan / 2), 0]),
    box(
      'bulkhead',
      [width, backHeight, backThickness],
      [0, n0(seatHeight + backHeight / 2), n0(-depth / 2 + backThickness / 2)],
    ),
  ]
  for (let i = 0; i < straps; i++) {
    const y = n0(seatHeight + (backHeight * (i + 1)) / (straps + 1))
    parts.push(
      box(
        'webbing',
        [width, 0.06, n0(backThickness * 1.4)],
        [0, y, n0(-depth / 2 + backThickness * 0.7)],
      ),
    )
  }
  return parts
}

export interface TableParams {
  width: number
  depth: number
  height: number
  topThickness: number
  /** Pipe-post leg radius, meters. */
  legRadius: number
}

/** A bolted-down table: a bulkhead top on conduit pipe legs. */
export function tableParts(params: TableParams): KitPart[] {
  const { width, depth, height, topThickness, legRadius } = params
  requirePositive({ width, depth, height, topThickness, legRadius }, 'table')
  const legLength = n0(height - topThickness)
  const insetX = n0(width / 2 - legRadius * 2)
  const insetZ = n0(depth / 2 - legRadius * 2)
  if (!(legLength > 0) || !(insetX > 0) || !(insetZ > 0)) {
    throw new Error(
      `table: a ${width} × ${depth} × ${height} m top with ${legRadius} m legs ` +
        'leaves no room for the legs',
    )
  }
  const leg = (x: number, z: number): KitPart =>
    cyl('conduit', legRadius, legLength, 'y', [n0(x), n0(legLength / 2), n0(z)])
  return [
    box(
      'bulkhead',
      [width, topThickness, depth],
      [0, n0(height - topThickness / 2), 0],
    ),
    leg(insetX, insetZ),
    leg(-insetX, insetZ),
    leg(insetX, -insetZ),
    leg(-insetX, -insetZ),
  ]
}

export interface CoffeeStationParams {
  width: number
  height: number
  depth: number
  accentThickness: number
  carafeRadius: number
  carafeHeight: number
}

/**
 * The galley's coffee station — the §4 landmark with the ONE reserved warm
 * accent. Cabinet body (bulkhead) + accent backsplash (`coffee-accent`), a
 * glass carafe (`screen`, the glass/acrylic slot) on the counter, and a task
 * light strip (`panel-light`) over the counter.
 */
export function coffeeStationParts(params: CoffeeStationParams): KitPart[] {
  const { width, height, depth, accentThickness, carafeRadius, carafeHeight } = params
  requirePositive(
    { width, height, depth, accentThickness, carafeRadius, carafeHeight },
    'coffee station',
  )
  return [
    box('bulkhead', [width, height, depth], [0, n0(height / 2), 0]),
    box(
      'coffee-accent',
      [width, n0(height * 0.45), accentThickness],
      [0, n0(height * 0.775), n0(-depth / 2 - accentThickness / 2)],
    ),
    cyl('screen', carafeRadius, carafeHeight, 'y', [
      n0(-width * 0.25),
      n0(height + carafeHeight / 2),
      0,
    ]),
    box(
      'panel-light',
      [n0(width * 0.6), 0.03, 0.05],
      [0, n0(height - 0.08), n0(depth / 2 + 0.025)],
    ),
  ]
}

export interface SuitRackParams {
  /** Rack board width across the wall, meters. */
  width: number
  /** Rack board height (the board grows up from local y = 0), meters. */
  height: number
  /** Rack board thickness, proud of the wall, meters. */
  depth: number
  /** Vac suits hanging on the rack, one bay each. */
  suits: number
  /** Torso block width, meters. */
  suitWidth: number
  /** Torso block height, meters. */
  suitHeight: number
  /** Torso block depth — how far the suit hangs proud of the board, meters. */
  suitDepth: number
  /** Torso base height above the floor (the hook height), meters. */
  suitY: number
  /** Helmet radius; the suit's head is a barrel of this radius, meters. */
  helmetRadius: number
}

/** Visor thickness (along the suit's front normal), meters. */
const SUIT_VISOR_THICKNESS = 0.05
/** Visor radius as a fraction of the helmet it sits on. */
const SUIT_VISOR_RADIUS_RATIO = 0.62

/**
 * A vac-suit rack: a rack board on a wall with `suits` vac suits hanging in
 * equal bays along it. Each suit is a torso block (`webbing` — the §4 canvas
 * and straps), a barrel helmet (`bulkhead`) and a proud visor disc (`screen`,
 * the glass/acrylic slot), so the §4 "two vac suits on racks" landmark of the
 * airlock reads as suits rather than as another locker bank.
 *
 * Local frame: the board stands on local y = 0 in the XY plane (thickness
 * along local Z), so the caller places it against a wall with the suits
 * facing the room along +Z.
 */
export function suitRackParts(params: SuitRackParams): KitPart[] {
  const {
    width,
    height,
    depth,
    suits,
    suitWidth,
    suitHeight,
    suitDepth,
    suitY,
    helmetRadius,
  } = params
  requirePositive(
    { width, height, depth, suitWidth, suitHeight, suitDepth, helmetRadius },
    'suit rack',
  )
  if (!Number.isInteger(suits) || suits < 1) {
    throw new Error(`suit rack: suit count must be a positive integer, got ${suits}`)
  }
  if (!(suitY >= 0)) {
    throw new Error(`suit rack: suitY must be non-negative, got ${suitY}`)
  }
  const bay = n0(width / suits)
  if (suitWidth > bay + EPS) {
    throw new Error(
      `suit rack: a ${suitWidth} m suit does not fit a ${bay} m bay of a ` +
        `${width} m rack for ${suits} suit(s)`,
    )
  }
  // The head is a barrel centred on the torso's top edge, so it reaches
  // suitY + suitHeight + helmetRadius — inside the board, or the rack reads as
  // decapitated.
  const headTop = n0(suitY + suitHeight + helmetRadius)
  if (headTop > height + EPS) {
    throw new Error(
      `suit rack: a suited head reaching ${headTop} m pokes above the ` +
        `${height} m rack board`,
    )
  }
  const torsoZ = n0(depth / 2 + suitDepth / 2)
  const visorZ = n0(depth / 2 + suitDepth / 2 + helmetRadius + SUIT_VISOR_THICKNESS / 2)

  const parts: KitPart[] = [
    box('bulkhead', [width, height, depth], [0, n0(height / 2), 0]),
  ]
  for (let i = 0; i < suits; i++) {
    const x = n0(-width / 2 + bay * (i + 0.5))
    parts.push(
      box(
        'webbing',
        [suitWidth, suitHeight, suitDepth],
        [x, n0(suitY + suitHeight / 2), torsoZ],
      ),
    )
    parts.push(
      cyl('bulkhead', helmetRadius, n0(2 * helmetRadius), 'y', [
        x,
        n0(suitY + suitHeight),
        torsoZ,
      ]),
    )
    parts.push(
      cyl(
        'screen',
        n0(helmetRadius * SUIT_VISOR_RADIUS_RATIO),
        SUIT_VISOR_THICKNESS,
        'z',
        [x, n0(suitY + suitHeight), visorZ],
      ),
    )
  }
  return parts
}

export interface HeatShieldParams {
  width: number
  height: number
  thickness: number
  stripeHeight: number
}

/**
 * A ceramic heat-shield plate with a worn hazard stripe — the drive-adjacent
 * shielding the engineering module (M2-T5) leans on.
 */
export function heatShieldParts(params: HeatShieldParams): KitPart[] {
  const { width, height, thickness, stripeHeight } = params
  requirePositive({ width, height, thickness, stripeHeight }, 'heat shield')
  if (stripeHeight + 0.04 > height) {
    throw new Error(
      `heat shield: a ${stripeHeight} m stripe does not fit a ${height} m plate`,
    )
  }
  return [
    box('ceramic', [width, height, thickness], [0, 0, 0]),
    box(
      'hazard',
      [width, stripeHeight, n0(thickness * 1.2)],
      [0, n0(-height / 2 + stripeHeight / 2 + 0.02), 0],
    ),
  ]
}

/* -------------------------------------------------------------- reactor */

export interface GlowWindowParams {
  /** Outer frame width across the wall, meters. */
  width: number
  /** Outer frame height, meters. */
  height: number
  /** Frame depth along the wall normal (local Z), meters. */
  depth: number
  /** Frame border width around the opening, meters. */
  frameWidth: number
  /** Glow-lens inset as a fraction of each opening half-extent, in [0, 0.5). */
  glowInset: number
  /** Grating bars across the opening (0 = an unshielded window). */
  barCount: number
  /** Grating bar width across the opening, meters. */
  barWidth: number
  /** Grating bar thickness proud of the frame's +Z face, meters. */
  barThickness: number
}

/** Glow-lens thickness as a fraction of the frame depth. */
const GLOW_LENS_DEPTH_RATIO = 0.4

/**
 * The reactor room's shielded drive-glow window (M2-T5): a bulkhead frame
 * around the opening, the drive's glow recessed behind it in the
 * `panel-light` slot — the one warm light of the reactor room, and the
 * M4 practical-light rig's `reactor` socket — and grating bars proud of the
 * frame's local +Z face, so the glow reads as light coming through a shield
 * rather than as a screen.
 *
 * Authored about its centre in the local XY plane (thickness along Z), like
 * `screenParts` and `heatShieldParts`: place it flush on a bulkhead and yaw it
 * so the grating faces the room. The frame is FOUR pieces so the jambs fill
 * the panel exactly; the recessed lens never protrudes past the frame.
 */
export function glowWindowParts(params: GlowWindowParams): KitPart[] {
  const {
    width,
    height,
    depth,
    frameWidth,
    glowInset,
    barCount,
    barWidth,
    barThickness,
  } = params
  requirePositive(
    { width, height, depth, frameWidth, barWidth, barThickness },
    'glow window',
  )
  if (!(glowInset >= 0 && glowInset < 0.5)) {
    throw new Error(`glow window: glowInset must be in [0, 0.5), got ${glowInset}`)
  }
  if (!Number.isInteger(barCount) || barCount < 0) {
    throw new Error(
      `glow window: barCount must be a non-negative integer, got ${barCount}`,
    )
  }
  const halfDepth = n0(depth / 2)
  const openWidth = n0(width - 2 * frameWidth)
  const openHeight = n0(height - 2 * frameWidth)
  if (!(openWidth > 0) || !(openHeight > 0)) {
    throw new Error(
      `glow window: a ${frameWidth} m frame leaves no opening in a ` +
        `${width} × ${height} m window`,
    )
  }
  if (barCount > 0 && barWidth > n0(openWidth / barCount) + EPS) {
    throw new Error(
      `glow window: ${barCount} bar(s) ${barWidth} m wide do not fit a ` +
        `${openWidth} m opening`,
    )
  }

  const inset = 1 - 2 * glowInset
  const parts: KitPart[] = [
    // Frame: the rails span the full width, the jambs fill the corners.
    box(
      'bulkhead',
      [width, frameWidth, depth],
      [0, n0(height / 2 - frameWidth / 2), 0],
    ),
    box(
      'bulkhead',
      [width, frameWidth, depth],
      [0, n0(-height / 2 + frameWidth / 2), 0],
    ),
    box(
      'bulkhead',
      [frameWidth, openHeight, depth],
      [n0(-width / 2 + frameWidth / 2), 0, 0],
    ),
    box(
      'bulkhead',
      [frameWidth, openHeight, depth],
      [n0(width / 2 - frameWidth / 2), 0, 0],
    ),
    // The drive's glow, RECESSED inside the opening (never proud of the frame).
    box(
      'panel-light',
      [
        n0(openWidth * inset),
        n0(openHeight * inset),
        n0(depth * GLOW_LENS_DEPTH_RATIO),
      ],
      [0, 0, 0],
    ),
  ]

  for (let i = 0; i < barCount; i++) {
    const x = n0(-openWidth / 2 + (openWidth * (i + 0.5)) / barCount)
    parts.push(
      box(
        'conduit',
        [barWidth, openHeight, barThickness],
        [x, 0, n0(halfDepth + barThickness / 2)],
      ),
    )
  }
  return parts
}

export interface RadiationSignParams {
  /** Placard width across the wall, meters. */
  width: number
  /** Placard height, meters. */
  height: number
  /** Placard plate thickness (along local Z), meters. */
  thickness: number
  /** Radius of the mark's centre hub, meters. */
  hubRadius: number
  /** Radius of each of the three blades, meters. */
  bladeRadius: number
  /** Centre-to-centre distance from the hub to each blade, meters. */
  bladeDistance: number
  /** How far the mark sits proud of the plate's +Z face, meters. */
  markThickness: number
}

/**
 * Blade centre angles of the three-fold radiation mark, degrees: up (90°) and
 * the two lower blades (210° / 330°) — the trefoil's own geometry.
 */
const TREFOIL_BLADE_ANGLES_DEG = [90, 210, 330] as const

/**
 * The reactor room's radiation warning placard (M2-T5): a hazard-slot plate
 * with the three-fold radiation mark proud of its +Z face.
 *
 * The kit's vocabulary is boxes and cylinders, so the mark is built from DISC
 * blades (z-axis cylinders) at the symbol's own 120° blade positions — the
 * three-fold warning mark at ship scale, and the reason it is a primitive
 * rather than something a module author hand-places (BUILD_PLAN rule 8).
 * The well-known symbol's wedges are approximated by discs: same three-fold
 * read, no non-axis-aligned geometry to render or collide.
 *
 * Authored about its centre in the local XY plane; the mark must fit inside
 * the plate (so the plate always sets the bounds), and `markReach` — the
 * farthest point of the mark from the plate's centre — is the fit test.
 */
export function radiationSignParts(params: RadiationSignParams): KitPart[] {
  const {
    width,
    height,
    thickness,
    hubRadius,
    bladeRadius,
    bladeDistance,
    markThickness,
  } = params
  requirePositive(
    { width, height, thickness, hubRadius, bladeRadius, bladeDistance, markThickness },
    'radiation sign',
  )
  const markReach = Math.max(hubRadius, bladeDistance + bladeRadius)
  if (!(markReach < Math.min(width, height) / 2)) {
    throw new Error(
      `radiation sign: a mark reaching ${markReach} m does not fit inside a ` +
        `${width} × ${height} m placard`,
    )
  }

  const markZ = n0(thickness / 2 + markThickness / 2)
  const parts: KitPart[] = [
    // The placard: the §4 hazard slot (the one warning-coloured surface).
    box('hazard', [width, height, thickness], [0, 0, 0]),
    // The hub of the mark.
    cyl('bulkhead', hubRadius, markThickness, 'z', [0, 0, markZ]),
  ]
  for (const angleDeg of TREFOIL_BLADE_ANGLES_DEG) {
    const radians = (angleDeg * Math.PI) / 180
    parts.push(
      cyl('bulkhead', bladeRadius, markThickness, 'z', [
        n0(bladeDistance * Math.cos(radians)),
        n0(bladeDistance * Math.sin(radians)),
        markZ,
      ]),
    )
  }
  return parts
}

/* ---------------------------------------------------------------- cargo */

export interface CargoCrateParams {
  /** Crate width across the room, meters. */
  width: number
  /** Crate body height (above its skids), meters. */
  height: number
  /** Crate depth along the row, meters. */
  depth: number
  /** Skid height above the deck, meters. */
  skidHeight: number
  /** Skid runner thickness (across the crate's depth), meters. */
  skidThickness: number
  /** Webbing tie-down straps wrapping the crate, one per bay. */
  straps: number
  /** Strap width across the crate, meters. */
  strapWidth: number
  /** Strap thickness proud of the crate's faces, meters. */
  strapThickness: number
}

/** Height of the cargo crate's hazard placard, meters. */
const CRATE_LABEL_HEIGHT = 0.12
/** Clearance between the placard and the crate's lid, meters. */
const CRATE_LABEL_MARGIN = 0.06
/** Placard thickness as a fraction of the strap thickness (never sets bounds). */
const CRATE_LABEL_THICKNESS_RATIO = 0.4
/** Widest placard a crate carries, meters. */
const CRATE_LABEL_MAX_WIDTH = 0.4

/**
 * A cargo crate (M2-T5): a bulkhead container riding on two conduit skids
 * (the pallet), webbing tie-down straps wrapping it over the lid and down both
 * ends (§4 "canvas webbing and straps" doing the work the long-haul hold needs
 * — cargo that reads as SECURED), and a hazard placard small enough never to
 * beat the straps for the bounding box.
 *
 * Local frame: the skids stand on local y = 0, so the crate rests on the deck
 * like every other floor-standing primitive; the placard is on the local +Z
 * face, which is the side a crate shows to the walkway.
 */
export function cargoCrateParts(params: CargoCrateParams): KitPart[] {
  const {
    width,
    height,
    depth,
    skidHeight,
    skidThickness,
    straps,
    strapWidth,
    strapThickness,
  } = params
  requirePositive(
    { width, height, depth, skidHeight, skidThickness, strapWidth, strapThickness },
    'cargo crate',
  )
  if (!Number.isInteger(straps) || straps < 1) {
    throw new Error(
      `cargo crate: strap count must be a positive integer, got ${straps}`,
    )
  }
  if (!(skidThickness <= depth / 2 + EPS)) {
    throw new Error(
      `cargo crate: ${skidThickness} m skids do not fit under a ${depth} m crate`,
    )
  }
  const bay = n0(width / straps)
  if (!(strapWidth <= bay + EPS)) {
    throw new Error(
      `cargo crate: a ${strapWidth} m strap is wider than its ${bay} m bay of a ` +
        `${width} m crate`,
    )
  }
  if (!(height > CRATE_LABEL_HEIGHT + 2 * CRATE_LABEL_MARGIN)) {
    throw new Error(
      `cargo crate: a ${CRATE_LABEL_HEIGHT} m placard does not fit a ${height} m crate`,
    )
  }

  const skidY = n0(skidHeight / 2)
  const bodyY = n0(skidHeight + height / 2)
  const lidY = n0(skidHeight + height)
  const parts: KitPart[] = [
    box(
      'conduit',
      [width, skidHeight, skidThickness],
      [0, skidY, n0(depth / 2 - skidThickness / 2)],
    ),
    box(
      'conduit',
      [width, skidHeight, skidThickness],
      [0, skidY, n0(-depth / 2 + skidThickness / 2)],
    ),
    box('bulkhead', [width, height, depth], [0, bodyY, 0]),
  ]

  for (let i = 0; i < straps; i++) {
    const x = n0(-width / 2 + bay * (i + 0.5))
    parts.push(
      box(
        'webbing',
        [strapWidth, strapThickness, n0(depth + 2 * strapThickness)],
        [x, n0(lidY + strapThickness / 2), 0],
      ),
      box(
        'webbing',
        [strapWidth, height, strapThickness],
        [x, bodyY, n0(depth / 2 + strapThickness / 2)],
      ),
      box(
        'webbing',
        [strapWidth, height, strapThickness],
        [x, bodyY, n0(-depth / 2 - strapThickness / 2)],
      ),
    )
  }

  const labelThickness = n0(strapThickness * CRATE_LABEL_THICKNESS_RATIO)
  parts.push(
    box(
      'hazard',
      [
        Math.min(CRATE_LABEL_MAX_WIDTH, n0(width * 0.5)),
        CRATE_LABEL_HEIGHT,
        labelThickness,
      ],
      [
        0,
        n0(lidY - CRATE_LABEL_MARGIN - CRATE_LABEL_HEIGHT / 2),
        n0(depth / 2 + labelThickness / 2),
      ],
    ),
  )
  return parts
}

/* -------------------------------------------------------------- inspection */

/** Local-frame bounds of one part (rotation-aware for boxes). */
export function partBounds(part: KitPart): Aabb3 {
  if (part.kind === 'box') {
    const [sx, sy, sz] = part.size
    // A quarter-turn yaw swaps the box's X and Z extents on odd turns.
    const oddTurn = (part.rotation ?? 0) % 2 === 1
    const extX = n0(oddTurn ? sz : sx)
    const extZ = n0(oddTurn ? sx : sz)
    const [px, py, pz] = part.position
    return {
      min: [n0(px - extX / 2), n0(py - sy / 2), n0(pz - extZ / 2)],
      max: [n0(px + extX / 2), n0(py + sy / 2), n0(pz + extZ / 2)],
    }
  }
  const half = n0(part.length / 2)
  const r = part.radius
  const ext: Vec3 =
    part.axis === 'x' ? [half, r, r] : part.axis === 'y' ? [r, half, r] : [r, r, half]
  const [px, py, pz] = part.position
  return {
    min: [n0(px - ext[0]), n0(py - ext[1]), n0(pz - ext[2])],
    max: [n0(px + ext[0]), n0(py + ext[1]), n0(pz + ext[2])],
  }
}

/** Local-frame bounds of a whole part list. Throws on an empty list. */
export function partsBounds(parts: readonly KitPart[]): Aabb3 {
  if (parts.length === 0) {
    throw new Error('partsBounds: no parts to measure')
  }
  let min: [number, number, number] = [Infinity, Infinity, Infinity]
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    const b = partBounds(part)
    for (let axis = 0; axis < 3; axis++) {
      if (b.min[axis] < min[axis]) min[axis] = b.min[axis]
      if (b.max[axis] > max[axis]) max[axis] = b.max[axis]
    }
  }
  return { min, max }
}

/**
 * The §4 material slots a part list actually draws from, in the canonical
 * MATERIAL_SLOTS order (stable, de-duplicated). This is what the M2-T7
 * "material slots fully assigned" harness diffs against a module's slots.
 */
export function partMaterialSlots(parts: readonly KitPart[]): MaterialSlot[] {
  const used = new Set<MaterialSlot>(parts.map((part) => part.materialSlot))
  return MATERIAL_SLOTS.filter((slot) => used.has(slot))
}

/** Total number of parts (for draw-call accounting notes in tests/reports). */
export function partCount(parts: readonly KitPart[]): number {
  return parts.length
}

/** The part list's size [x, y, z] in meters. Handy for nominal-size checks. */
export function partsSize(parts: readonly KitPart[]): Vec3 {
  const b = partsBounds(parts)
  return [n0(b.max[0] - b.min[0]), n0(b.max[1] - b.min[1]), n0(b.max[2] - b.min[2])]
}
