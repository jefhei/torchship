/**
 * M3-T4 — the first-person rig.
 *
 * Mounts three.js PointerLockControls on the R3F camera and drives the walker
 * (src/player/walker.ts) each frame: held WASD (+ Shift sprint, Ctrl crouch)
 * become a planar step under the camera's yaw, gravity integrates along the
 * thrust axis, and the camera rides the eye height over the walker's feet
 * (PRD §6.1: 1.6 m, crouched 1.0 m).
 *
 * Pointer lock engages through the controls bridge (controlsStore): the DOM
 * overlay's click handler calls `requestWalkLock()` and the browser's
 * `pointerlockchange` flows back through `setWalkLocked`. Movement input is
 * only accepted while the pointer is captured (that is what makes WASD safe to
 * bind globally), but the UNDER-BURN PHYSICS ALWAYS RUNS — a walker dropped at
 * spawn, or one who stepped over the spine's crawl opening, falls whether or
 * not the pointer is captured. Only the keys stop.
 *
 * The rig is logic-only (renders null) and owns no geometry: the interior is
 * mounted beside it (src/player/WalkthroughScene.tsx), and the camera is written
 * from the walker's feet every frame so gravity, collision and the eye can
 * never disagree about where the walker is.
 *
 * `onStep` is reported only when the READABLE state changes (deck, grounded,
 * crouched, failed fall) — not 60 times a second — so the DOM HUD can be plain
 * React state without re-rendering the shell every frame.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls as PointerLockControlsImpl } from 'three/examples/jsm/controls/PointerLockControls.js'
import type { Vec3 } from '../types'
import { registerWalkControls, setWalkLocked } from './controlsStore'
import { EYE_HEIGHT_M, clampFrameDelta, isLocomotionKey, keysToMoveState } from './move'
import {
  spawnWalker,
  stepWalker,
  type WalkerState,
  type WalkerStep,
  type WalkerWorld,
} from './walker'

/** What the DOM overlay needs off a frame (see the module doc on reporting). */
export interface WalkReport {
  deckIndex: number
  deckId: string
  deckLabel: string
  grounded: boolean
  crouched: boolean
  /** True once a fall has been arrested at the bottom of the spine run. */
  arrested: boolean
}

/** The readable fields of a step, in the order the report key is built. */
function reportOf(step: WalkerStep): WalkReport {
  return {
    deckIndex: step.deckIndex,
    deckId: step.deckId,
    deckLabel: step.deckLabel,
    grounded: step.state.grounded,
    crouched: step.crouched,
    arrested: step.arrested,
  }
}

function reportKey(report: WalkReport): string {
  return [
    report.deckIndex,
    report.deckId,
    report.grounded ? 'grounded' : 'airborne',
    report.crouched ? 'crouch' : 'stand',
    report.arrested ? 'arrested' : 'ok',
  ].join('|')
}

export function WalkRig({
  world,
  spawn,
  yaw = 0,
  enabled = true,
  onStep,
  onLockChange,
}: {
  /** The ship to walk: deck floors + the M3-T3 collision hull. */
  world: WalkerWorld
  /** Feet position at spawn, world meters (M3-T6 owns the real selection). */
  spawn: Vec3
  /** Initial camera yaw, radians (0 = facing −z). */
  yaw?: number
  /** When false the keys are ignored (gravity still runs). Default true. */
  enabled?: boolean
  /** Called when the readable walker state changes (not every frame). */
  onStep?: (report: WalkReport) => void
  /** Lock-state callback (true when the pointer is captured). */
  onLockChange?: (locked: boolean) => void
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)

  const controls = useMemo(() => new PointerLockControlsImpl(camera), [camera])

  const keysRef = useRef<Set<string>>(new Set())
  const lockedRef = useRef(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const stateRef = useRef<WalkerState>(spawnWalker(spawn))
  const lastReportRef = useRef<string | null>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const onLockChangeRef = useRef(onLockChange)
  onLockChangeRef.current = onLockChange

  // Track held locomotion keys. The set is cleared on blur so a keyup that
  // lands outside the window (alt-tab, devtools) cannot stick a key down.
  useEffect(() => {
    const keys = keysRef.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (isLocomotionKey(event.code)) {
        keys.add(event.code)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (isLocomotionKey(event.code)) {
        keys.delete(event.code)
      }
    }
    const onBlur = () => keys.clear()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      keys.clear()
    }
  }, [])

  // Connect the pointer-lock controls, mirror lock state out to the DOM.
  useEffect(() => {
    controls.connect(gl.domElement)
    const onLock = () => {
      lockedRef.current = true
      setWalkLocked(true)
      onLockChangeRef.current?.(true)
    }
    const onUnlock = () => {
      lockedRef.current = false
      setWalkLocked(false)
      onLockChangeRef.current?.(false)
    }
    controls.addEventListener('lock', onLock)
    controls.addEventListener('unlock', onUnlock)
    return () => {
      controls.removeEventListener('lock', onLock)
      controls.removeEventListener('unlock', onUnlock)
      controls.disconnect()
    }
  }, [controls, gl.domElement])

  // Expose lock/unlock to the DOM side (the prompt overlay's click).
  useEffect(() => {
    registerWalkControls({
      lock: () => controls.lock(),
      unlock: () => controls.unlock(),
    })
    return () => registerWalkControls(null)
  }, [controls])

  // Spawn: level horizon, feet at the spawn point, eye at standing height.
  useEffect(() => {
    camera.rotation.order = 'YXZ'
    camera.rotation.set(0, yaw, 0)
    stateRef.current = spawnWalker(spawn)
    lastReportRef.current = null
    camera.position.set(spawn[0], spawn[1] + EYE_HEIGHT_M, spawn[2])
  }, [camera, spawn, yaw])

  // The frame step: keys → command → walker → camera.
  useFrame((_state, delta) => {
    const dt = clampFrameDelta(delta)
    const locomotion =
      lockedRef.current && enabledRef.current
        ? keysToMoveState(keysRef.current)
        : {
            input: { forward: 0 as const, strafe: 0 as const },
            sprint: false,
            crouch: false,
          }
    const step = stepWalker(
      stateRef.current,
      { ...locomotion, yaw: camera.rotation.y, dt },
      world,
    )
    stateRef.current = step.state
    camera.position.set(
      step.state.feet[0],
      step.state.feet[1] + step.eyeHeightM,
      step.state.feet[2],
    )
    const report = reportOf(step)
    const key = reportKey(report)
    if (key !== lastReportRef.current) {
      lastReportRef.current = key
      onStepRef.current?.(report)
    }
  })

  return null
}
