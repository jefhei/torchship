/**
 * M3-T5 — the first-person rig, now driving the navigation machine.
 *
 * M3-T4 mounted a walker; M3-T5 gives it vertical navigation. The rig itself is
 * unchanged in shape — it still owns the PointerLockControls, still tracks the
 * held keys, still writes the camera from the walker's feet every frame — but
 * the frame step is now `stepNav` (src/player/nav.ts): walk, mount a ladder,
 * climb, arrive on another deck, and work the hatches with E.
 *
 * Three things the rig adds for the mechanic:
 *  - the INTERACT key is EDGE-triggered (a press is one action), so it lives in
 *    its own ref and is consumed by the next frame rather than being read as a
 *    held state like WASD;
 *  - the report carries the climb (phase, direction, rung) and the hatch in
 *    reach, so the DOM HUD can say "climbing · rung 4 of 10" and "E — open
 *    hatch" without the shell re-rendering every frame;
 *  - movement input is still only accepted while the pointer is captured, but
 *    the PHYSICS AND THE CLIMB ARE NOT PAUSED by an unlocked pointer: a walker
 *    dropped mid-deck falls, and a climber mid-storey keeps hold of the ladder.
 *    Only the keys stop.
 *
 * The rig is logic-only (renders null) and owns no geometry: the interior is
 * mounted beside it (src/player/WalkthroughScene.tsx).
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls as PointerLockControlsImpl } from 'three/examples/jsm/controls/PointerLockControls.js'
import type { Vec3 } from '../types'
import { registerWalkControls, setWalkLocked } from './controlsStore'
import {
  EYE_HEIGHT_M,
  clampFrameDelta,
  isInteractKey,
  isNavigationKey,
  keysToMoveState,
} from './move'
import {
  initialNavState,
  stepNav,
  type NavPhase,
  type NavState,
  type NavStep,
} from './nav'
import type { HatchAction } from './hatch'
import type { NavigationWorld } from './nav'

/** What the DOM overlay needs off a frame (see the module doc on reporting). */
export interface WalkReport {
  deckIndex: number
  deckId: string
  deckLabel: string
  grounded: boolean
  crouched: boolean
  /** True once a fall has been arrested at the bottom of the spine run. */
  arrested: boolean
  /** 'walk' or 'climb' — which mode the navigation machine is in. */
  phase: NavPhase
  /** While climbing: 'up' nose-ward, 'down' toward the drive, null resting. */
  climbDirection: 'up' | 'down' | null
  /** While climbing: the rung under the climber's feet (0-based), or null. */
  rungIndex: number | null
  /** The hatch the interact key would act on right now, or null. */
  hatchPromptId: string | null
  /** What the interact key did on this frame, if anything. */
  hatchAction: HatchAction | null
}

/** The readable fields of a step, in the order the report key is built. */
function reportOf(step: NavStep): WalkReport {
  return {
    deckIndex: step.deckIndex,
    deckId: step.deckId,
    deckLabel: step.deckLabel,
    grounded: step.phase === 'climb' ? true : !step.airborne,
    crouched: step.crouched,
    arrested: step.arrested,
    phase: step.phase,
    climbDirection: step.climbDirection,
    rungIndex: step.rungIndex,
    hatchPromptId: step.hatchPrompt?.id ?? null,
    hatchAction: step.hatchAction,
  }
}

function reportKey(report: WalkReport): string {
  return [
    report.deckIndex,
    report.deckId,
    report.grounded ? 'grounded' : 'airborne',
    report.crouched ? 'crouch' : 'stand',
    report.arrested ? 'arrested' : 'ok',
    report.phase,
    report.climbDirection ?? 'still',
    report.rungIndex ?? '-',
    report.hatchPromptId ?? '-',
    // The action is a moment, not a state: it must be reported even when
    // nothing else about the walker changed (opening the hatch you are at).
    report.hatchAction ?? '-',
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
  /** The ship to walk, climb and open: hull, ladder runs and hatch leaves. */
  world: NavigationWorld
  /** Feet position at spawn, world meters (the M3-T6 selection, src/player/spawn.ts). */
  spawn: Vec3
  /** Initial camera yaw, radians (0 = facing −z). */
  yaw?: number
  /** When false the keys are ignored (gravity and the climb still run). */
  enabled?: boolean
  /** Called when the readable navigation state changes (not every frame). */
  onStep?: (report: WalkReport) => void
  /** Lock-state callback (true when the pointer is captured). */
  onLockChange?: (locked: boolean) => void
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)

  const controls = useMemo(() => new PointerLockControlsImpl(camera), [camera])

  const keysRef = useRef<Set<string>>(new Set())
  const interactRef = useRef(false)
  const lockedRef = useRef(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const stateRef = useRef<NavState>(initialNavState(spawn))
  const lastReportRef = useRef<string | null>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep
  const onLockChangeRef = useRef(onLockChange)
  onLockChangeRef.current = onLockChange

  // Track the held locomotion keys and latch the interact press. The held set is
  // cleared on blur so a keyup that lands outside the window (alt-tab, devtools)
  // cannot stick a key down.
  useEffect(() => {
    const keys = keysRef.current
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInteractKey(event.code)) {
        interactRef.current = true
        return
      }
      if (isNavigationKey(event.code)) {
        keys.add(event.code)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (isNavigationKey(event.code)) {
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
      interactRef.current = false
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
    stateRef.current = initialNavState(spawn)
    lastReportRef.current = null
    camera.position.set(spawn[0], spawn[1] + EYE_HEIGHT_M, spawn[2])
  }, [camera, spawn, yaw])

  // The frame step: keys → command → nav machine → camera.
  useFrame((_state, delta) => {
    const dt = clampFrameDelta(delta)
    const acceptsInput = lockedRef.current && enabledRef.current
    const locomotion = acceptsInput
      ? keysToMoveState(keysRef.current)
      : {
          input: { forward: 0 as const, strafe: 0 as const },
          sprint: false,
          crouch: false,
        }
    // The interact press is edge-triggered and consumed here — a press that
    // arrives while the pointer is free is dropped, like any other key.
    const interact = acceptsInput ? interactRef.current : false
    interactRef.current = false

    const step = stepNav(
      stateRef.current,
      { ...locomotion, yaw: camera.rotation.y, dt, interact },
      world,
    )
    stateRef.current = step.state
    camera.position.set(step.feet[0], step.feet[1] + step.eyeHeightM, step.feet[2])
    const report = reportOf(step)
    const key = reportKey(report)
    if (key !== lastReportRef.current) {
      lastReportRef.current = key
      onStepRef.current?.(report)
    }
  })

  return null
}
