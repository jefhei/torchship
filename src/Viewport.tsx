import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { assembleShip } from './assembler'
import { PATROL_SPEC } from './fixtures'
import {
  WalkthroughScene,
  isWalkLocked,
  requestWalkLock,
  subscribeWalkLock,
  type WalkReport,
} from './player'

/**
 * M1-T1 viewport, M3-T4 walkthrough.
 *
 * The `<Canvas>` now carries the assembled Patrol ship (M3-T1's scene graph,
 * drawn by the M2 part renderer) and the first-person rig (M3-T4): a walker is
 * dropped on the crew deck's first room, under-burn gravity pulls it toward the
 * drive, and the WASD keys drive it through the M3-T3 collision hull.
 *
 * Walking is the app's only camera mode — there is no orbit rig to swap to — so
 * the rig is always mounted and the DOM overlay is the whole walkthrough UI: a
 * "click to look around" prompt while the pointer is free (the Pointer Lock API
 * requires a user gesture, so this button is the entry point), and a HUD with
 * the movement keys and the deck the walker is on while it is captured. ESC
 * releases the pointer (browser default) and the keys stop; the walker keeps
 * standing where they left it — physics runs whether or not the pointer is
 * captured, so gravity is never paused.
 *
 * The preset is hard-wired to Patrol here; the picker (PRD §6.1) and the share
 * URL / seed (M6-T3) come later and will hand this component a different spec.
 * The interim ambient light keeps the interior legible until M4-T2's
 * practical-only rig lands — PRD §4 allows no sun and no sky, so nothing
 * directional is added here, and the ambient is the one line M4 replaces.
 *
 * `ready` still flips once the renderer exists (Canvas onCreated), letting the
 * shell — and tests — tell "booted and rendering" apart from a blank canvas.
 */
export default function Viewport() {
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(() => isWalkLocked())
  const [walk, setWalk] = useState<WalkReport | null>(null)

  const assembly = useMemo(() => assembleShip(PATROL_SPEC), [])

  useEffect(() => subscribeWalkLock(() => setLocked(isWalkLocked())), [])

  return (
    <div className="viewport" data-testid="viewport">
      <Canvas
        camera={{ fov: 70, near: 0.05, far: 200 }}
        gl={{ antialias: true }}
        onCreated={() => setReady(true)}
      >
        <color attach="background" args={['#05070a']} />
        {/* Interim key light — replaced by the M4-T2 practical rig. */}
        <ambientLight intensity={0.35} />
        <WalkthroughScene assembly={assembly} onStep={setWalk} />
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
            WASD move · Shift sprint · Ctrl crouch · E hatch · ESC release
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
          {walk && walk.hatchPromptId !== null && walk.hatchAction === null && (
            <span className="walk-hud-hatch" data-testid="walk-hatch-prompt">
              E — open or close this hatch
            </span>
          )}
          {walk?.hatchAction === 'blocked' && (
            <span className="walk-hud-hatch" data-testid="walk-hatch-blocked">
              the hatch will not close on you
            </span>
          )}
        </div>
      )}
    </div>
  )
}
