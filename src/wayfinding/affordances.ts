/**
 * M5-T1 — hatch AFFORDANCES: what the interact key will actually do, in words.
 *
 * Before this task the HUD could only say "E — open or close this hatch": the
 * walk report carried the hatch in reach but not its state, so the prompt could
 * not name the action. The rig now reports `hatchPromptOpen` (src/player/nav.ts)
 * and this module turns the pair into a sign:
 *
 *   `E — open the spine hatch`   (the leaf is shut; the press retracts it)
 *   `E — close the spine hatch`  (the leaf is open; the press seats it again)
 *
 * The words come from the hatch's own record — its deck (deck label), its owner
 * module instance and the door socket it seals (M3-T5's `Hatch`, built from the
 * module's own geometry). Nothing here re-derives which hatch is where; the
 * REACH test stays `hatchInReach` (src/player/hatch.ts), the one the state
 * machine uses, so a prompt can never name a hatch E would not act on.
 */

import type { Hatch } from '../player/hatch'
import type { WayfindingDeck } from './decks'

/** What one interact press on a hatch in reach will do. */
export interface HatchAffordance {
  hatchId: string
  /** The action the NEXT press performs: retract ('open') or seat ('close'). */
  action: 'open' | 'close'
  /** True when the leaf is currently retracted into its jamb. */
  isOpen: boolean
  /** The sign: `E — open the spine hatch`. */
  text: string
  /** Which hatch, for the detail line: `Crew deck · galley#0 · "spine-door"`. */
  detail: string
}

/**
 * The hatch's short name in the ship's own terms: the spine doorways are the
 * ones the ladder lands on, everything else is a room's side hatch. The socket
 * ids are the kit's own (`spine-door`, `side-door`, `high-hatch`).
 */
export function hatchShortName(hatch: Hatch): string {
  if (hatch.socketId === 'spine-door') {
    return 'spine hatch'
  }
  return hatch.socketId === 'high-hatch' ? 'high hatch' : 'side hatch'
}

/** The sign for the hatch a walker is standing at. */
export function hatchAffordance(
  hatch: Hatch,
  isOpen: boolean,
  deck: WayfindingDeck | null,
): HatchAffordance {
  const action: 'open' | 'close' = isOpen ? 'close' : 'open'
  const where = deck === null ? `deck ${hatch.deckIndex} "${hatch.deckId}"` : deck.name
  return {
    hatchId: hatch.id,
    action,
    isOpen,
    text: `E — ${action} the ${hatchShortName(hatch)}`,
    detail: `${where} · ${hatch.moduleId}#${hatch.moduleIndex} · "${hatch.socketId}"`,
  }
}

/** The notice shown when a close was refused because the walker is standing in the leaf. */
export const HATCH_BLOCKED_NOTICE = 'the hatch will not close on you'
