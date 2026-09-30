import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { assembleShip } from './assembler'
import { PATROL_SPEC } from './fixtures'
import {
  WalkthroughScene,
  isWalkLocked,
  navigationWorldOf,
  requestWalkLock,
  subscribeWalkLock,
  type WalkReport,
} from './player'
import { WayfindingOverlay } from './wayfinding'

/**
 * M1-T1 viewport, M3-T4 walkthrough, M5-T1 wayfinding UX.
 *
 * The `<Canvas>` carries the assembled Patrol ship (M3-T1's scene graph, drawn
 * by the M2 part renderer) and the first-person rig (M3-T4): a walker is
 * dropped at the M3-T6 spawn — the crew deck at the foot of the spine, facing
 * into the galley — under-burn gravity pulls it toward the drive, and the WASD
 * keys drive it through the M3-T3 collision hull.
 *
 * Walking is the app's only camera mode — there is no orbit rig to swap to — so
 * the rig is always mounted and the DOM overlay is the whole walkthrough UI: a
 * "click to look around" prompt while the pointer is free (the Pointer Lock API
 * requires a user gesture, so this button is the entry point), and the
 * walkthrough UI while it is captured — the key legend and live state line in
 * the HUD, plus M5-T1's `<WayfindingOverlay>` (the per-deck label moment, the
 * optional deck indicator on `I`, and the hatch affordance naming what `E` will
 * do). ESC releases the pointer (browser default) and the keys stop; the walker
 * keeps standing where they left it — physics runs whether or not the pointer
 * is captured, so gravity is never paused.
 *
 * The preset is hard-wired to Patrol here; the picker (PRD §6.1) and the share
 * URL / seed (M6-T3) come later and will hand this component a different spec.
 * Lighting is M4-T2's practical-only rig: `WalkthroughScene` derives it from the
 * assembly's own light sockets and mounts the deck the walker is on, which is
 * why this component hands it `walk.deckIndex` — the walk report is already the
 * app's one source for "which deck am I on". The interim M1-T1 ambient light is
 * gone (PRD §4 allows no sun and no sky; the rig carries its own warm fill).
 *
 * M5-T1's overlay needs the same navigation world the rig walks (it reads the
 * ladder runs off it), so the app derives it once here from the same assembly —
 * `navigationWorldOf`, never a second model of where the ship's hatches are.
 *
 * `ready` still flips once the renderer exists (Canvas onCreated), letting the
 * shell — and tests — tell "booted and rendering" apart from a blank canvas.
 */
export default function Viewport() {
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(() => isWalkLocked())
  const [walk, setWalk] = useState<WalkReport | null>(null)

  const assembly = useMemo(() => assembleShip(PATROL_SPEC), [])
  const world = useMemo(() => navigationWorldOf(assembly), [assembly])
  const hatch = useMemo(
    () =>
      world.hatches.find((candidate) => candidate.id === walk?.hatchPromptId) ?? null,
    [world, walk?.hatchPromptId],
  )

  useEffect(() => subscribeWalkLock(() => setLocked(isWalkLocked())), [])

  return (
    <div className="viewport" data-testid="viewport">
      <Canvas
        camera={{ fov: 70, near: 0.05, far: 200 }}
        gl={{ antialias: true }}
        onCreated={() => setReady(true)}
      >
        <color attach="background" args={['#05070a']} />
        <WalkthroughScene
          assembly={assembly}
          deckIndex={walk?.deckIndex ?? null}
          onStep={setWalk}
        />
      </Canvas>
      {ready && (
        <span className="viewport-ready" data-testid="viewport-ready">
          viewport ready
        </span>
      )}
      {ready && !locked && (
        <button
          type="button"
          className="walk-prompt"
          data-testid="walk-lock-prompt"
          onClick={requestWalkLock}
        >
          <span className="walk-prompt-pill">Click to look around</span>
        </button>
      )}
      {ready && locked && (
        <div className="walk-hud" data-testid="walk-hud">
          <span className="walk-hud-keys">
            WASD move · Shift sprint · Ctrl crouch · E hatch · I deck indicator · ESC
            release
          </span>
          {walk && (
            <span className="walk-hud-deck" data-testid="walk-deck">
              {walk.deckLabel}
              {walk.phase === 'climb' ? ' · on the ladder' : ''}
              {walk.climbDirection !== null ? ` · climbing ${walk.climbDirection}` : ''}
              {walk.rungIndex !== null ? ` · rung ${walk.rungIndex + 1}` : ''}
              {walk.grounded ? '' : ' · falling'}
              {walk.arrested ? ' · bottom of the shaft' : ''}
            </span>
          )}
        </div>
      )}
      {ready && locked && (
        <WayfindingOverlay
          ship={assembly}
          world={world}
          deckIndex={walk?.deckIndex ?? null}
          phase={walk?.phase ?? 'walk'}
          arrived={walk?.arrived ?? false}
          landed={walk?.landed ?? false}
          hatch={hatch}
          hatchOpen={walk?.hatchPromptOpen ?? false}
          blocked={walk?.hatchAction === 'blocked'}
        />
      )}
    </div>
  )
}
