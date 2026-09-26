/**
 * M4-T2 — the rig, on screen: the practical fixtures of the deck the walker is
 * on, plus the warm fill they are read against.
 *
 * Work done by the AUTHORS, not here. The selector (`activeLightsFor`) decides
 * which of the ship's fixtures are lit — the current deck's set, capped by the
 * M4 frame budget — and every recipe on a light (colour, intensity in candela,
 * reach, decay, whether it may cast a shadow) was derived by `rig.ts` from the
 * module's own light socket and its kind's archetype. This file only ever turns
 * a `PlacedLight` into a three.js `<pointLight>` and mounts it, so a light that
 * appears in the frame is a light the report counted.
 *
 * Two things are deliberate:
 *
 *  - **Every fixture is a point light.** See the header of `archetypes.ts`: a
 *    spot rig needs a scene-anchored `target` object per fixture (three's
 *    `SpotLight` aims through an Object3D that must itself be in the graph, and
 *    R3F does not attach it), which buys a cone a tight interior does not read.
 *    Focus is expressed as range instead.
 *  - **The fill is ambient, warm and dim, and it is not a sun.** PRD §4 allows
 *    no directional light at all, so there is no key light in this file; the
 *    one ambient term is the "warmer ambient fill" PRD §11 asks for, capped by
 *    `RIG_AMBIENT_INTENSITY_MAX` so it can never flatten the interior.
 *
 * Shadows are opt-in per light and the rig only ever marks one per deck
 * (`withShadowCasters`), so the shadow spend is a property of the data, not of
 * this component.
 */

import { SHADOW_MAP_SIZE } from './archetypes.ts'
import { activeLightsFor } from './rig.ts'
import type { LightRig, PlacedLight } from './rig.ts'

/** One practical fixture: the archetype's recipe at the socket's own anchor. */
function PracticalLight({ light }: { light: PlacedLight }) {
  return (
    <pointLight
      name={light.id}
      position={light.position}
      color={light.color}
      intensity={light.intensity}
      distance={light.distanceM}
      decay={light.decay}
      castShadow={light.castsShadow}
      shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
      shadow-bias={-0.0004}
    />
  )
}

/**
 * The ship's practical lighting for one deck: `activeLightsFor(rig, deckIndex)`
 * — nothing more, and nothing off the selection. The ambient is mounted with
 * them so a light-less frame (before the first step report) still shows the
 * interior rather than black.
 */
export function ShipLighting({ rig, deckIndex }: { rig: LightRig; deckIndex: number }) {
  const lights = activeLightsFor(rig, deckIndex)
  return (
    <>
      <ambientLight color={rig.ambient.color} intensity={rig.ambient.intensity} />
      {lights.map((light) => (
        <PracticalLight key={light.id} light={light} />
      ))}
    </>
  )
}
