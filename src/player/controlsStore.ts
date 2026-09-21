/**
 * M3-T4 — the pointer-lock bridge between the R3F canvas and the DOM.
 *
 * The rig owns a three.js PointerLockControls instance, which lives inside the
 * `<Canvas>`; the walkthrough UI (the "click to look around" prompt, the
 * movement HUD) lives in the DOM outside it. The Pointer Lock API only grants
 * capture from a user gesture, so the two halves have to talk: the rig
 * registers its lock/unlock API on mount, a DOM click calls `requestWalkLock()`,
 * and the browser's `pointerlockchange` flows back out through `setWalkLocked`
 * to subscribers.
 *
 * Module-level state is deliberate (the ported PlanWalker pattern, PRD §7): the
 * app has exactly one canvas and exactly one walkthrough rig, so a store object
 * would be decoration. React reads it through `useSyncExternalStore`-style
 * subscribe/get pairs.
 */

/** The live rig's capture API; registered by the mounted rig. */
export interface WalkControlsApi {
  /** Request pointer lock (must be called from a user gesture). */
  lock(): void
  /** Exit pointer lock. */
  unlock(): void
}

let api: WalkControlsApi | null = null
let locked = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Register/unregister the live walk rig; pass null on unmount. */
export function registerWalkControls(next: WalkControlsApi | null): void {
  api = next
}

/** Request pointer lock through the live rig (user-gesture safe). */
export function requestWalkLock(): void {
  api?.lock()
}

/** Exit pointer lock through the live rig. */
export function requestWalkUnlock(): void {
  api?.unlock()
}

/**
 * Push the pointer-lock state from the rig (it observes the browser's
 * pointerlockchange events). Only emits when the value actually changes.
 */
export function setWalkLocked(next: boolean): void {
  if (next === locked) {
    return
  }
  locked = next
  emit()
}

/** True while the pointer is captured (the walker is under the player's keys). */
export function isWalkLocked(): boolean {
  return locked
}

/** Subscribe to lock-state changes; returns the unsubscribe function. */
export function subscribeWalkLock(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
