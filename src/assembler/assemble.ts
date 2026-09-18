/**
 * M3-T1 — the assembler (BUILD_PLAN M3-T1: "stack decks from spec, join modules
 * at door sockets, generate spine run; emit merged per-deck geometry +
 * instanced kit batches").
 *
 * `assembleShip(spec)` is the whole task as one pure function:
 *
 *  1. STACK   one `DeckNode` per spec deck, in spec order (nose → aft), with
 *             the deck's world floor from the spec and the deck index as the
 *             array position — the renderer/exporter never recompute deck math.
 *  2. JOIN    every module ref is instantiated where the spec's offset puts it
 *             and its door sockets are resolved in world space (both through
 *             the M1-T3 resolver — `moduleOrigin`, `moduleDoors`), the deck's
 *             joins and legal blanks are scanned (joins.ts), and each room's
 *             socket-sealing hatch becomes a named interactive;
 *  3. SPINE   one shaft band per deck is synthesized at the deck-local origin
 *             (spineRun.ts) — the spec never references the trunk — and tiled
 *             into a continuous run;
 *  4. EMIT    the deck's kit parts are placed in world space and partitioned
 *             into merged per-slot `GeometryGroup`s and instanced `InstanceBatch`
 *             batches (batches.ts), with the deck's collision hull (the world
 *             boxes of every module's collision hint) and named interactives
 *             (doors + hatches).
 *
 * Nothing is freehand (BUILD_PLAN rule 8): module geometry comes from the M2
 * authored assemblies, placement from the shared transforms, hulls from the
 * modules' own collision hints, and joins from door sockets.
 *
 * Interactives:
 *  - `kind: 'door'` — every door socket of every ROOM instance, at the socket
 *    center, yawed to the socket's outward facing. These are the deck's
 *    passages (the band's own face sockets are structural join interfaces, not
 *    doorways — the room owns the doorway it lands on, M2-T6).
 *  - `kind: 'hatch'` — every `fillsSocket` assembly (the hatch leaf the module
 *    authored ON a door socket, M2-T2), at that socket's center, yawed to the
 *    hatch's own world yaw (a hatch leaf faces INTO the room, so its yaw is the
 *    inverse of the doorway's — the pairing is asserted, not assumed).
 * Equipment slots stay anchors for M4's props and the M4/M5 rigs; they are not
 * interactions.
 *
 * The scene graph is the M1-T2 contract; the richer `ShipAssembly` (placed
 * modules, joins, blanks, moulds) is what M3-T2/T3/T5/T7 consume — M3-T2
 * generates mating geometry from `joins`/`blanks`, M3-T3 verifies the emitted
 * hull, M3-T7 re-partitions the parts for its draw-call ceiling.
 */

import { AUTHORED_MODULES } from '../kit/modules/registry'
import { addTurns, placePoint } from '../kit/modules/placement'
import type { AuthoredModule } from '../kit/modules/types'
import { MM } from '../types'
import type {
  DeckNode,
  DeckSpec,
  InteractiveElement,
  KitManifest,
  ModuleRef,
  ModuleSource,
  ShipSpec,
  Vec3,
} from '../types'
import { SEAM_TOLERANCES } from '../spikes/seams/tolerances'
import { assertValidShipSpec, moduleDoors } from '../validation'
import { DEFAULT_MIN_INSTANCES, partitionParts } from './batches'
import { scanDeckSockets } from './joins'
import { facingTurns, worldBoxesOf, worldOriginOf, worldPartsOf } from './place'
import { bandRef, shaftModuleOf, spineRun } from './spineRun'
import type { AssembleOptions, DeckAssembly, PlacedModule, ShipAssembly } from './types'

/** Socket authoring budget (±0.5 mm), meters — the M0-T2 measured tolerance. */
const SOCKET_EPS_M = SEAM_TOLERANCES.maxSocketAuthoringErrorMm * MM

/** The spec's module refs must resolve: throw naming the deck and the ref. */
function moduleOf(
  modules: readonly AuthoredModule[],
  ref: ModuleRef,
  deck: DeckSpec,
  index: number,
): AuthoredModule {
  const found = modules.find((module) => module.manifest.id === ref.moduleId)
  if (found === undefined) {
    const known = modules.map((module) => module.manifest.id).join(', ')
    throw new Error(
      `assembler: deck "${deck.id}" module ${index} references unknown kit module ` +
        `"${ref.moduleId}" (known: ${known})`,
    )
  }
  return found
}

/** Resolve the assembler inputs, filling in the documented defaults. */
function resolveOptions(options: AssembleOptions): {
  kit: KitManifest
  modules: readonly AuthoredModule[]
  minInstances: number
  requireValidSpec: boolean
} {
  const modules = options.modules ?? AUTHORED_MODULES
  return {
    // A custom module list implies its own manifest: the two can never disagree.
    kit: options.kit ?? { modules: modules.map((module) => module.manifest) },
    modules,
    minInstances: options.minInstances ?? DEFAULT_MIN_INSTANCES,
    requireValidSpec: options.requireValidSpec ?? true,
  }
}

/** Instantiate one module (a spec ref, or the synthesized shaft band). */
function placeModule(
  ref: ModuleRef,
  moduleIndex: number,
  deck: DeckSpec,
  deckIndex: number,
  module: AuthoredModule,
  kit: KitManifest,
  band: boolean,
): PlacedModule {
  const origin = worldOriginOf(ref, deck)
  const source: ModuleSource = { deckId: deck.id, moduleId: ref.moduleId, moduleIndex }
  return {
    source,
    deckIndex,
    module,
    origin,
    rotation: ref.rotation,
    doors: moduleDoors(deck, deckIndex, ref, moduleIndex, kit),
    boxes: worldBoxesOf(module, origin, ref.rotation),
    parts: worldPartsOf(module, origin, ref.rotation, source),
    band,
  }
}

/** The world origin of a hatch assembly: its own module-local placement, placed. */
function hatchOrigin(owner: PlacedModule, localPosition: Vec3): Vec3 {
  return placePoint(localPosition, {
    position: owner.origin,
    rotation: owner.rotation,
  })
}

/**
 * The deck's named interactives: one 'door' per room door socket (at the
 * socket center, yawed to its outward facing), one 'hatch' per hatch assembly
 * the module authored on a socket (at that socket center, at the hatch's own
 * yaw). A hatch that cannot be paired with a socket is skipped here and
 * reported by `assemblyProblems` — never emitted at an invented position.
 */
export function interactivesOf(
  modules: readonly PlacedModule[],
  deckId: string,
): InteractiveElement[] {
  const interactives: InteractiveElement[] = []

  for (const owner of modules) {
    if (owner.band) continue // the band's faces are join interfaces, not doorways
    const index = owner.source.moduleIndex
    for (const door of owner.doors) {
      interactives.push({
        id: `${deckId}-${index}-${owner.source.moduleId}-door-${door.socketId}`,
        kind: 'door',
        position: door.center,
        rotation: facingTurns(door.facing),
        source: owner.source,
      })
    }
    for (const assembly of owner.module.assemblies) {
      if (assembly.fillsSocket !== true) continue
      const origin = hatchOrigin(owner, assembly.placement.position ?? [0, 0, 0])
      const socket = owner.doors.find(
        (door) =>
          Math.abs(door.center[0] - origin[0]) <= SOCKET_EPS_M &&
          Math.abs(door.center[1] - origin[1]) <= SOCKET_EPS_M &&
          Math.abs(door.center[2] - origin[2]) <= SOCKET_EPS_M,
      )
      if (socket === undefined) continue
      interactives.push({
        id: `${deckId}-${index}-${owner.source.moduleId}-hatch-${assembly.id}`,
        kind: 'hatch',
        position: socket.center,
        rotation: addTurns(owner.rotation, assembly.placement.rotation ?? 0),
        source: owner.source,
      })
    }
  }

  return interactives
}

/**
 * Assemble one deck: instantiate its rooms and its synthesized shaft band,
 * scan the joins, place the parts, partition them into merged groups and
 * instanced batches, and emit the M1-T2 deck node.
 */
export function assembleDeck(
  deck: DeckSpec,
  deckIndex: number,
  options: AssembleOptions = {},
): DeckAssembly {
  const { kit, modules, minInstances } = resolveOptions(options)

  const rooms = deck.modules.map((ref, index) =>
    placeModule(
      ref,
      index,
      deck,
      deckIndex,
      moduleOf(modules, ref, deck, index),
      kit,
      false,
    ),
  )
  const band = placeModule(
    bandRef(modules),
    -1,
    deck,
    deckIndex,
    shaftModuleOf(modules),
    kit,
    true,
  )
  const placed: PlacedModule[] = [...rooms, band]

  const scan = scanDeckSockets(placed)
  const parts = placed.flatMap((owner) => owner.parts)
  const { groups, batches } = partitionParts(parts, deckIndex, minInstances)

  const node: DeckNode = {
    deckId: deck.id,
    deckIndex,
    floorY: deck.yPosition,
    geometry: groups.map((plan) => plan.group),
    instances: batches.map((plan) => plan.batch),
    interactives: interactivesOf(placed, deck.id),
    collision: { boxes: placed.flatMap((owner) => owner.boxes) },
  }

  return {
    node,
    deckIndex,
    deckId: deck.id,
    label: deck.label,
    floorY: deck.yPosition,
    modules: placed,
    band,
    joins: scan.joins,
    blanks: scan.blanks,
    groups,
    batches,
  }
}

/**
 * Assemble a ship spec into the scene graph plus its provenance model.
 *
 * By default the spec is validated first (src/validation
 * `assertValidShipSpec` against the resolved kit): the walker only ever sees a
 * legal ship, and the M3 invariant work (M3-T2/T3/T6) can rely on the join set
 * it gets. Pass `requireValidSpec: false` to assemble a rejected spec anyway —
 * that is how the QA rig's declared defects are inspected (the exit code for
 * "would this ship walk" stays the validator's verdict, never this one).
 */
export function assembleShip(
  spec: ShipSpec,
  options: AssembleOptions = {},
): ShipAssembly {
  const { kit, requireValidSpec } = resolveOptions(options)
  if (requireValidSpec) assertValidShipSpec(spec, kit)

  const decks = spec.decks.map((deck, deckIndex) =>
    assembleDeck(deck, deckIndex, options),
  )

  return {
    spec,
    graph: {
      ship: {
        classId: spec.classId,
        name: spec.name,
        registry: spec.registry,
        seed: spec.seed,
      },
      decks: decks.map((deck) => deck.node),
    },
    decks,
    spineRun: spineRun(spec),
  }
}

/** The M1-T2 scene graph alone (the renderer/exporter's view). */
export function assembleScene(
  spec: ShipSpec,
  options: AssembleOptions = {},
): ShipAssembly['graph'] {
  return assembleShip(spec, options).graph
}
