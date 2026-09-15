/**
 * M2-T1 — the authored kit primitives as R3F components.
 *
 * These are the composition surface for the six room modules (M2-T2..T6): a
 * module author writes `<Bulkhead width={…} door={…} position={…} />` and gets
 * the panel *with its doorway already cut* — the geometry always comes from
 * the builders in src/kit/parts.ts, never from hand-placed meshes (BUILD_PLAN
 * execution rule 8: door sockets are the only join interface).
 *
 * A component rebuilds its parts on each render. That is deliberate and
 * cheap for the standalone/authoring path, and it keeps the components
 * stateless; the M3-T7 merge/instance pass is what will collapse whole decks
 * into merged geometry + instanced batches (src/types/scene.ts), so these
 * per-part meshes never ship as the final draw-call story.
 *
 * Every component takes a `PrimitivePlacement` (module-local position +
 * quarter-turn yaw) and defaults to the origin. Local frames are documented
 * per builder; `hatch` is socket-centred, so placing it ON a DoorSocket
 * position is the correct — and only — way to seat it.
 */

import {
  bulkheadParts,
  cargoCrateParts,
  coffeeStationParts,
  conduitRunParts,
  couchParts,
  deckPlateParts,
  glowWindowParts,
  hatchParts,
  heatShieldParts,
  ladderSegmentParts,
  lockerParts,
  panelLightParts,
  radiationSignParts,
  screenParts,
  suitRackParts,
  tableParts,
} from '../parts'
import type {
  BulkheadParams,
  CargoCrateParams,
  CoffeeStationParams,
  ConduitRunParams,
  CouchParams,
  DeckPlateParams,
  GlowWindowParams,
  HatchParams,
  HeatShieldParams,
  LadderSegmentParams,
  LockerParams,
  PanelLightParams,
  RadiationSignParams,
  ScreenParams,
  SuitRackParams,
  TableParams,
} from '../parts'
import type { PrimitivePlacement } from '../types'
import { KitParts } from './KitParts'
import { boxEuler, vec3Tuple } from './transforms'

/** R3F group props for a primitive's placement (module-local + yaw). */
function placementProps({ position, rotation }: PrimitivePlacement) {
  return {
    position: position === undefined ? undefined : vec3Tuple(position),
    rotation: boxEuler(rotation ?? 0),
  }
}

/** Wall panel in the local XY plane with an optional doorway cut through it. */
export function Bulkhead({
  position,
  rotation,
  ...params
}: BulkheadParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={bulkheadParts(params)} />
    </group>
  )
}

/** Deck plate whose walking surface is local y = 0, with optional cable runs. */
export function DeckPlate({
  position,
  rotation,
  ...params
}: DeckPlateParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={deckPlateParts(params)} />
    </group>
  )
}

/** Exposed conduit / pipe run along X, Y or Z, with optional clamps. */
export function ConduitRun({
  position,
  rotation,
  ...params
}: ConduitRunParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={conduitRunParts(params)} />
    </group>
  )
}

/** Recessed ceiling panel light (housing + emissive lens). */
export function PanelLight({
  position,
  rotation,
  ...params
}: PanelLightParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={panelLightParts(params)} />
    </group>
  )
}

/** Hatch that seals a DoorSocket — place it ON the socket position. */
export function Hatch({
  position,
  rotation,
  ...params
}: HatchParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={hatchParts(params)} />
    </group>
  )
}

/** One ladder storey: rails plus rungs, growing up from local y = 0. */
export function LadderSegment({
  position,
  rotation,
  ...params
}: LadderSegmentParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={ladderSegmentParts(params)} />
    </group>
  )
}

/** Equipment locker bank standing on the floor. */
export function Locker({
  position,
  rotation,
  ...params
}: LockerParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={lockerParts(params)} />
    </group>
  )
}

/** Screen: bulkhead bezel with an emissive glass panel. */
export function Screen({
  position,
  rotation,
  ...params
}: ScreenParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={screenParts(params)} />
    </group>
  )
}

/** Crash couch facing +Z: pedestal, seat, backrest, webbing straps. */
export function Couch({
  position,
  rotation,
  ...params
}: CouchParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={couchParts(params)} />
    </group>
  )
}

/** Bolted-down table: bulkhead top on conduit pipe legs. */
export function Table({
  position,
  rotation,
  ...params
}: TableParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={tableParts(params)} />
    </group>
  )
}

/** The galley's coffee station — the §4 warm-accent landmark. */
export function CoffeeStation({
  position,
  rotation,
  ...params
}: CoffeeStationParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={coffeeStationParts(params)} />
    </group>
  )
}

/** Ceramic heat shield with a worn hazard stripe (drive-adjacent). */
export function HeatShield({
  position,
  rotation,
  ...params
}: HeatShieldParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={heatShieldParts(params)} />
    </group>
  )
}

/** Vac-suit rack: a rack board with vac suits hanging on it, faces local +Z. */
export function SuitRack({
  position,
  rotation,
  ...params
}: SuitRackParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={suitRackParts(params)} />
    </group>
  )
}

/** Shielded drive-glow window: reactor glow behind a grating, faces local +Z. */
export function GlowWindow({
  position,
  rotation,
  ...params
}: GlowWindowParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={glowWindowParts(params)} />
    </group>
  )
}

/** Radiation placard: the three-fold hazard mark on a hazard plate. */
export function RadiationSign({
  position,
  rotation,
  ...params
}: RadiationSignParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={radiationSignParts(params)} />
    </group>
  )
}

/** Cargo crate on its skids, webbing tie-downs, hazard placard on local +Z. */
export function CargoCrate({
  position,
  rotation,
  ...params
}: CargoCrateParams & PrimitivePlacement) {
  return (
    <group {...placementProps({ position, rotation })}>
      <KitParts parts={cargoCrateParts(params)} />
    </group>
  )
}
