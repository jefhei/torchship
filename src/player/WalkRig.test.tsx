import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

const mocks = vi.hoisted(() => ({
  useFrame: vi.fn(),
  useThree: vi.fn(),
}))

// The R3F canvas cannot run in jsdom (no WebGL), so the two hooks the rig
// consumes are mocked and the frame callback is driven by hand — exactly the
// pattern the ported PlanWalker rig test uses. Everything else is real: the
// three.js PointerLockControls, the controls bridge, the walker, and the
// canonical Patrol ship.
vi.mock('@react-three/fiber', () => ({
  useFrame: mocks.useFrame,
  useThree: mocks.useThree,
}))

import { assembleShip } from '../assembler'
import { PATROL_SPEC } from '../fixtures'
import {
  isWalkLocked,
  registerWalkControls,
  requestWalkLock,
  setWalkLocked,
} from './controlsStore'
import { EYE_HEIGHT_M, WALK_SPEED_M_S } from './move'
import { navigationWorldOf, type NavigationWorld } from './nav'
import { WalkRig, type WalkReport } from './WalkRig'
import { defaultSpawnFeet } from './spawn'
import type { WalkerWorld } from './walker'

const assembly = assembleShip(PATROL_SPEC)
const world = navigationWorldOf(assembly)
const spawn = defaultSpawnFeet(assembly)
if (spawn === null) {
  throw new Error('WalkRig.test: the Patrol ship has no crew-deck spawn')
}
const CREW_FLOOR_Y = world.walker.decks[1].floorY

let camera: THREE.PerspectiveCamera
let domElement: HTMLElement
let requestLockSpy: ReturnType<typeof vi.fn>
let exitLockSpy: ReturnType<typeof vi.fn>

/** The frame callback the rig registered with useFrame. */
function frame(): (state: unknown, delta: number) => void {
  expect(mocks.useFrame).toHaveBeenCalled()
  const calls = mocks.useFrame.mock.calls
  return calls[calls.length - 1][0]
}

/** Run `count` frames of `delta` seconds each, from a captured frame callback. */
function frames(
  count: number,
  delta: number,
  step: (state: unknown, d: number) => void,
): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      step({}, delta)
    }
  })
}

function pressKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }))
}

function releaseKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }))
}

/** Simulate the browser entering pointer lock (fires pointerlockchange). */
function simulateLock(): void {
  Object.defineProperty(document, 'pointerLockElement', {
    value: domElement,
    configurable: true,
    writable: true,
  })
  document.dispatchEvent(new Event('pointerlockchange'))
}

/** Simulate the browser exiting pointer lock (ESC or exitPointerLock). */
function simulateUnlock(): void {
  Object.defineProperty(document, 'pointerLockElement', {
    value: null,
    configurable: true,
    writable: true,
  })
  document.dispatchEvent(new Event('pointerlockchange'))
}

beforeEach(() => {
  mocks.useFrame.mockReset()
  mocks.useThree.mockReset()

  camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 200)
  domElement = document.createElement('canvas')
  requestLockSpy = vi.fn()
  exitLockSpy = vi.fn()
  Object.defineProperty(Element.prototype, 'requestPointerLock', {
    value: requestLockSpy,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(document, 'exitPointerLock', {
    value: exitLockSpy,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(document, 'pointerLockElement', {
    value: null,
    configurable: true,
    writable: true,
  })

  mocks.useThree.mockImplementation(
    (
      selector: (store: {
        camera: THREE.PerspectiveCamera
        gl: { domElement: HTMLElement }
      }) => unknown,
    ) => selector({ camera, gl: { domElement } }),
  )

  // Module-level bridge state persists across tests in a file: reset it.
  registerWalkControls(null)
  setWalkLocked(false)
})

describe('WalkRig (M3-T4 first-person rig)', () => {
  it('registers with the controls bridge and locks on request', () => {
    render(<WalkRig world={world} spawn={spawn} />)
    act(() => requestWalkLock())
    expect(requestLockSpy).toHaveBeenCalledTimes(1)
    expect(requestLockSpy).toHaveBeenCalledWith({ unadjustedMovement: false })
  })

  it('unregisters on unmount so requests become no-ops', () => {
    const { unmount } = render(<WalkRig world={world} spawn={spawn} />)
    unmount()
    act(() => requestWalkLock())
    expect(requestLockSpy).not.toHaveBeenCalled()
  })

  it('drops the camera at the spawn point, eye height over the feet', () => {
    render(<WalkRig world={world} spawn={spawn} />)
    expect(camera.position.x).toBe(spawn[0])
    expect(camera.position.y).toBeCloseTo(spawn[1] + EYE_HEIGHT_M, 10)
    expect(camera.position.z).toBe(spawn[2])
    // A levelled horizon, in the yaw-first rotation order the rig expects.
    expect(camera.rotation.x).toBe(0)
    expect(camera.rotation.z).toBe(0)
    expect(camera.rotation.order).toBe('YXZ')
  })

  it('ignores the keys while unlocked but still lands the walker (physics never pauses)', () => {
    // Spawned a metre above the crew deck floor with the pointer free: no input
    // is accepted, yet gravity must drop the walker onto the plate.
    const airborne: [number, number, number] = [spawn[0], CREW_FLOOR_Y + 1, spawn[2]]
    render(<WalkRig world={world} spawn={airborne} />)
    const step = frame()
    pressKey('KeyW')
    frames(40, 0.05, step)
    expect(camera.position.z).toBeCloseTo(spawn[2], 10)
    expect(camera.position.y).toBeLessThan(CREW_FLOOR_Y + 1 + EYE_HEIGHT_M)
    // Feet on the deck plate (its 0.06 m cable runs are within the step).
    expect(camera.position.y - CREW_FLOOR_Y).toBeGreaterThanOrEqual(EYE_HEIGHT_M - 1e-6)
    expect(camera.position.y - CREW_FLOOR_Y).toBeLessThanOrEqual(
      EYE_HEIGHT_M + 0.06 + 1e-6,
    )
    releaseKey('KeyW')
  })

  it('walks with W while locked, holding the eye height over the deck', () => {
    render(<WalkRig world={world} spawn={spawn} />)
    simulateLock()
    expect(isWalkLocked()).toBe(true)
    pressKey('KeyW')
    const step = frame()
    frames(1, 0.05, step)
    // Yaw 0 faces −z: the walker steps 2.2 × 0.05 m aft-ward along the plate.
    expect(camera.position.z).toBeCloseTo(spawn[2] - WALK_SPEED_M_S * 0.05, 6)
    expect(camera.position.x).toBeCloseTo(spawn[0], 6)
    expect(camera.position.y - CREW_FLOOR_Y).toBeGreaterThanOrEqual(EYE_HEIGHT_M - 1e-6)
    expect(camera.position.y - CREW_FLOOR_Y).toBeLessThanOrEqual(
      EYE_HEIGHT_M + 0.06 + 1e-6,
    )
    releaseKey('KeyW')
  })

  it('stops moving when the pointer is released (ESC)', () => {
    render(<WalkRig world={world} spawn={spawn} />)
    simulateLock()
    pressKey('KeyW')
    const step = frame()
    frames(1, 0.05, step)
    const travelled = camera.position.z
    simulateUnlock()
    expect(isWalkLocked()).toBe(false)
    frames(10, 0.05, step)
    expect(camera.position.z).toBeCloseTo(travelled, 10)
    releaseKey('KeyW')
  })

  it('lowers the camera and slows the walk while crouching (Ctrl)', () => {
    render(<WalkRig world={world} spawn={spawn} />)
    simulateLock()
    pressKey('ControlLeft')
    pressKey('KeyW')
    const step = frame()
    frames(1, 0.05, step)
    // Crouch wins: 1.1 m/s and eyes at 1.0 m.
    expect(camera.position.z).toBeCloseTo(spawn[2] - 1.1 * 0.05, 6)
    expect(camera.position.y - CREW_FLOOR_Y).toBeGreaterThanOrEqual(1.0 - 1e-6)
    expect(camera.position.y - CREW_FLOOR_Y).toBeLessThanOrEqual(1.0 + 0.06 + 1e-6)
    releaseKey('ControlLeft')
    releaseKey('KeyW')
  })

  it('ignores the keys while disabled', () => {
    render(<WalkRig world={world} spawn={spawn} enabled={false} />)
    simulateLock()
    pressKey('KeyW')
    const step = frame()
    frames(10, 0.05, step)
    expect(camera.position.z).toBeCloseTo(spawn[2], 10)
    releaseKey('KeyW')
  })

  it('reports the walker state on change, not every frame', () => {
    const reports: WalkReport[] = []
    render(
      <WalkRig world={world} spawn={spawn} onStep={(report) => reports.push(report)} />,
    )
    const step = frame()
    frames(60, 0.05, step)
    expect(reports.length).toBeGreaterThan(0)
    // Landing is one change; crouch/ground/deck stay put afterwards.
    expect(reports.length).toBeLessThanOrEqual(3)
    const last = reports[reports.length - 1]
    expect(last.deckId).toBe('crew')
    expect(last.deckLabel).toBe('Crew deck — galley & bunks')
    expect(last.grounded).toBe(true)
    expect(last.crouched).toBe(false)
    expect(last.arrested).toBe(false)
  })

  it('reports a deck change as the walker falls past a deck boundary', () => {
    // A two-deck world with a plate only under the deeper deck: the walker
    // starts airborne over the head deck and lands on the crew deck, so the
    // report must cross the boundary (this is the M5 deck-indicator path).
    const twoDeckWalker: WalkerWorld = {
      ship: world.walker.ship,
      decks: [
        { deckIndex: 0, deckId: 'head', label: 'Head — bridge', floorY: 0 },
        {
          deckIndex: 1,
          deckId: 'crew',
          label: 'Crew deck — galley & bunks',
          floorY: -3.2,
        },
      ],
      hull: [{ min: [-5, -3.4, -5], max: [5, -3.2, 5] }],
      bottomFloorY: -3.2,
    }
    // No runs and no hatches: this test drives the walker's fall, not the climb.
    const twoDeck: NavigationWorld = {
      walker: twoDeckWalker,
      runs: [],
      hatches: [],
    }
    const reports: WalkReport[] = []
    render(
      <WalkRig
        world={twoDeck}
        spawn={[0, 0.5, 0]}
        onStep={(report) => reports.push(report)}
      />,
    )
    const step = frame()
    frames(60, 0.05, step)
    expect(reports[0].deckId).toBe('head')
    const last = reports[reports.length - 1]
    expect(last.deckId).toBe('crew')
    expect(last.grounded).toBe(true)
  })
})

describe('the provisional spawn (M3-T4 plumbing for M3-T6)', () => {
  it('drops the walker into the crew deck’s first room, on its floor', () => {
    expect(spawn[1]).toBeCloseTo(CREW_FLOOR_Y, 10)
    expect(spawn[0]).toBe(0)
    expect(world.walker.decks.map((deck) => deck.deckId)).toEqual([
      'head',
      'crew',
      'ops',
      'engineering',
      'aft',
    ])
  })
})

describe('the M3-T5 rig: hatches and the climb', () => {
  /** The last report the rig produced, and the frame callback. */
  function runFrames(count: number): (state: unknown, d: number) => void {
    const step = frame()
    frames(count, 0.05, step)
    return step
  }

  it('opens the spine hatch with E once the walker is at the door', () => {
    const reports: WalkReport[] = []
    render(<WalkRig world={world} spawn={spawn} onStep={(r) => reports.push(r)} />)
    simulateLock()
    pressKey('KeyW')
    runFrames(20)
    // Walking into the shut hatch stops the walker inside the galley, with the
    // hatch offered in the report (the HUD's prompt).
    const atDoor = reports[reports.length - 1]
    expect(atDoor.deckId).toBe('crew')
    expect(atDoor.hatchPromptId).toBe('crew-galley#0-spine-door')
    expect(atDoor.hatchAction).toBeNull()
    // E opens it, and the report says so.
    pressKey('KeyE')
    runFrames(1)
    const opened = reports.find((report) => report.hatchAction === 'opened')
    expect(opened).toBeDefined()
    releaseKey('KeyW')
  })

  it('walks through the open hatch, mounts the ladder and arrives on the head deck', () => {
    const reports: WalkReport[] = []
    render(<WalkRig world={world} spawn={spawn} onStep={(r) => reports.push(r)} />)
    simulateLock()
    pressKey('KeyW')
    runFrames(20)
    pressKey('KeyE')
    runFrames(1)
    // Still holding W: through the doorway, onto the rung line, up the storey.
    runFrames(120)
    const climbing = reports.filter((report) => report.phase === 'climb')
    expect(climbing.length).toBeGreaterThan(0)
    expect(climbing.every((report) => report.climbDirection === 'up')).toBe(true)
    expect(climbing.some((report) => report.rungIndex !== null)).toBe(true)
    const last = reports[reports.length - 1]
    expect(last.phase).toBe('walk')
    expect(last.deckId).toBe('head')
    expect(last.grounded).toBe(true)
    // The camera is on the head deck's plate, in the lane beside the ladder.
    expect(camera.position.y).toBeCloseTo(CREW_FLOOR_Y + 3.2 + EYE_HEIGHT_M, 3)
    releaseKey('KeyW')
  })

  it('does not work a hatch while the pointer is free (keys are dropped)', () => {
    const reports: WalkReport[] = []
    render(<WalkRig world={world} spawn={spawn} onStep={(r) => reports.push(r)} />)
    pressKey('KeyW')
    frames(20, 0.05, frame())
    pressKey('KeyE')
    frames(3, 0.05, frame())
    expect(reports.some((report) => report.hatchAction !== null)).toBe(false)
    releaseKey('KeyW')
  })
})
