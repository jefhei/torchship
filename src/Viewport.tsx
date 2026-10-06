import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { assembleShip } from './assembler'
import {
  WalkthroughScene,
  isWalkLocked,
  navigationWorldOf,
  requestWalkLock,
  subscribeWalkLock,
  type WalkReport,
} from './player'
import {
  ShareControl,
  applyShareState,
  effectiveSpec,
  encodeShareState,
  resolveShareState,
  shareStatesEqual,
  shareUrlFor,
  type ShareState,
} from './share'
import { WayfindingOverlay } from './wayfinding'

/**
 * M1-T1 viewport, M3-T4 walkthrough, M5-T1 wayfinding UX, M6-T3 share/autosave.
 *
 * The `<Canvas>` carries the assembled ship (M3-T1's scene graph, drawn by the
 * M2 part renderer) and the first-person rig (M3-T4): a walker is dropped at
 * the M3-T6 spawn — the crew deck at the foot of the spine, facing into the
 * galley — under-burn gravity pulls it toward the drive, and the WASD keys
 * drive it through the M3-T3 collision hull.
 *
 * WHICH ship is assembled is M6-T3's job: the app boots from a share link in
 * the URL, else the localStorage autosave, else the default preset (Patrol) —
 * `resolveShareState`. The `<ShareControl>` panel lets the author pick one of
 * the three preset ships and step the variation seed; every change re-assembles
 * the ship, autosaves it, and rewrites the address bar so the link always
 * reproduces what is on screen (`applyShareState`). Because a change swaps the
 * ship the walker stands in, the scene is keyed by the encoded share state, so
 * a new ship remounts the rig at its own spawn instead of carrying a stale pose
 * across.
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
 * Lighting is M4-T2's practical-only rig: `WalkthroughScene` derives it from
 * the assembly's own light sockets and mounts the deck the walker is on, which
 * is why this component hands it `walk.deckIndex` — the walk report is already
 * the app's one source for "which deck am I on". The interim M1-T1 ambient
 * light is gone (PRD §4 allows no sun and no sky; the rig carries its own warm
 * fill).
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
  const [share, setShare] = useState<ShareState>(() =>
    resolveShareState({
      search: typeof window === 'undefined' ? '' : window.location.search,
    }),
  )

  // The latest state without re-creating `changeShare` on every change (so the
  // control's callbacks stay stable across re-assemblies).
  const shareRef = useRef(share)

  const changeShare = useCallback((next: ShareState) => {
    if (shareStatesEqual(shareRef.current, next)) {
      return
    }
    shareRef.current = next
    // Persist to localStorage and publish to the address bar; the reload path
    // (resolveShareState) reads exactly these two back.
    applyShareState(next)
    setShare(next)
  }, [])

  const spec = useMemo(() => effectiveSpec(share), [share])
  const assembly = useMemo(
    () => assembleShip(spec, { wearDensity: share.wearDensity }),
    [spec, share.wearDensity],
  )
  const world = useMemo(() => navigationWorldOf(assembly), [assembly])
  const hatch = useMemo(
    () =>
      world.hatches.find((candidate) => candidate.id === walk?.hatchPromptId) ?? null,
    [world, walk?.hatchPromptId],
  )
  // A stable identity for the assembled ship: a new key remounts the rig when
  // the ship (or the seed that varies its detail) changes.
  const shareKey = useMemo(() => encodeShareState(share), [share])
  const shareUrl = useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : shareUrlFor(share, window.location.origin + window.location.pathname),
    [share],
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
          key={shareKey}
          assembly={assembly}
          deckIndex={walk?.deckIndex ?? null}
          onStep={setWalk}
        />
      </Canvas>
      <ShareControl share={share} url={shareUrl} onChange={changeShare} />
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
