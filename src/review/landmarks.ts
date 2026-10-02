/**
 * M5-T3 — the §4 landmark checklist: the machine half of PRD §8 [review]
 * "All §4 signature landmarks present and recognizable on every preset".
 *
 * A landmark is not a vibe — it is authored geometry. Every §4 room landmark
 * was anchored at M2 as an equipment slot on its module's own manifest
 * (`equipmentSlots`, e.g. the galley's `coffee-station`, engineering's
 * `glow-window`, ops' `suit-rack`), and the spine is the per-deck shaft band
 * the M3-T1 assembler synthesizes. So "is the bridge aboard?" is a question
 * about the ASSEMBLED ship: does any instance of the right module type carry
 * the anchors the landmark is built from? This module answers it, derivably.
 *
 * Pure and three-agnostic — a domain check over an assembled ship plus the
 * navigation world (for the spine's ladder runs), never a rendered scene.
 */

import type { ShipAssembly } from '../assembler'
import type { NavigationWorld } from '../player/nav'

/** One PRD §4 signature landmark and where its evidence lives in a ship. */
export interface LandmarkSpec {
  id: string
  /** Human title as the §4 brief names it. */
  title: string
  /** The kit module type that authors it, or null for the synthesized spine. */
  moduleId: string | null
  /** The equipment anchors (M2 manifests) that together prove the landmark. */
  anchors: readonly string[]
  /** What the landmark is, quoted from §4, for the report. */
  note: string
}

/**
 * The six §4 signature landmarks, in the order the brief lists them. `anchors`
 * are equipment-slot ids taken straight off the authored module manifests
 * (`src/kit/modules/*.ts`), so this table cannot drift from the geometry: if a
 * module stops authoring an anchor, the landmark goes missing here too.
 */
export const SHIP_LANDMARKS: readonly LandmarkSpec[] = [
  {
    id: 'bridge',
    title: 'The head (bridge)',
    moduleId: 'head',
    anchors: ['sensor-array', 'couch-pilot', 'console-pilot'],
    note: 'two crash-couch stations facing a sensor wall, pilot/gunner consoles',
  },
  {
    id: 'galley',
    title: 'The galley — coffee station',
    moduleId: 'galley',
    anchors: ['coffee-station', 'mess-table', 'bunk-lower'],
    note: "the mess table with the bolted-down coffee station — the crew's heart",
  },
  {
    id: 'airlock',
    title: 'Airlock & suit locker',
    moduleId: 'ops',
    anchors: ['suit-rack', 'tool-wall', 'hatch-airlock'],
    note: 'interior hatch, two vac suits on racks, tool wall',
  },
  {
    id: 'med-bay',
    title: 'The med bay',
    moduleId: 'ops',
    anchors: ['exam-bed', 'med-cabinet', 'med-screen'],
    note: 'fold-down exam bed, med cabinet, monitor',
  },
  {
    id: 'reactor-room',
    title: 'The reactor room',
    moduleId: 'engineering',
    anchors: ['glow-window', 'radiation-sign'],
    note: "the drive's glow through a shielded window, radiation trefoil",
  },
  {
    id: 'spine',
    title: 'The spine',
    moduleId: null,
    anchors: [],
    note: 'the ladder/crawl shaft connecting all decks — the ship’s vertical artery',
  },
]

/** Where one landmark was (or was not) found in an assembled ship. */
export interface LandmarkEvidence {
  id: string
  title: string
  note: string
  present: boolean
  /** The deck it was found on, or null (ship-wide / the spine spans decks). */
  deckIndex: number | null
  deckId: string | null
  /** The owning module instance, or null (the spine is per-deck). */
  moduleId: string | null
  moduleIndex: number | null
  /** Why it is present or missing, in the reports' wording. */
  detail: string
}

/** Does a module instance carry every anchor the landmark needs? */
function instanceHasAnchors(
  anchors: readonly string[],
  slots: readonly { id: string }[],
): boolean {
  return anchors.every((anchor) => slots.some((slot) => slot.id === anchor))
}

/**
 * Every §4 landmark measured against an assembled ship: the first instance of
 * the landmark's module type whose manifest carries all its anchors, or a
 * missing verdict. The spine is judged as a whole — a shaft band on every deck
 * AND at least one ladder run the walker can climb.
 */
export function landmarkEvidence(
  ship: ShipAssembly,
  world: NavigationWorld,
): LandmarkEvidence[] {
  const evidence: LandmarkEvidence[] = []

  for (const landmark of SHIP_LANDMARKS) {
    if (landmark.moduleId === null) {
      evidence.push(spineEvidence(ship, world, landmark))
      continue
    }

    let found: LandmarkEvidence | undefined
    for (const deck of ship.decks) {
      for (const owner of deck.modules) {
        if (owner.band) continue
        if (owner.source.moduleId !== landmark.moduleId) continue
        if (
          !instanceHasAnchors(landmark.anchors, owner.module.manifest.equipmentSlots)
        ) {
          continue
        }
        found = {
          id: landmark.id,
          title: landmark.title,
          note: landmark.note,
          present: true,
          deckIndex: deck.deckIndex,
          deckId: deck.deckId,
          moduleId: owner.source.moduleId,
          moduleIndex: owner.source.moduleIndex,
          detail:
            `${landmark.title} aboard deck ${deck.deckIndex} ("${deck.deckId}") as ` +
            `${owner.source.moduleId}#${owner.source.moduleIndex} ` +
            `(anchors ${landmark.anchors.join(' + ')})`,
        }
        break
      }
      if (found !== undefined) break
    }

    evidence.push(
      found ?? {
        id: landmark.id,
        title: landmark.title,
        note: landmark.note,
        present: false,
        deckIndex: null,
        deckId: null,
        moduleId: null,
        moduleIndex: null,
        detail:
          `${landmark.title} is not aboard — no "${landmark.moduleId}" instance ` +
          `authors ${landmark.anchors.join(' + ')}`,
      },
    )
  }

  return evidence
}

/** The spine's own evidence: a band on every deck, and a real ladder run. */
function spineEvidence(
  ship: ShipAssembly,
  world: NavigationWorld,
  landmark: LandmarkSpec,
): LandmarkEvidence {
  const decksWithoutBand = ship.decks.filter(
    (deck) => !deck.modules.some((owner) => owner.band),
  )
  const bands = ship.decks.reduce(
    (total, deck) => total + deck.modules.filter((owner) => owner.band).length,
    0,
  )
  const runs = world.runs.length
  const present = decksWithoutBand.length === 0 && runs > 0
  const missing = [
    decksWithoutBand.length > 0
      ? `deck(s) ${decksWithoutBand.map((deck) => deck.deckIndex).join(', ')} carry no shaft band`
      : null,
    runs === 0 ? 'no ladder run is climbable' : null,
  ].filter((line): line is string => line !== null)

  return {
    id: landmark.id,
    title: landmark.title,
    note: landmark.note,
    present,
    deckIndex: null,
    deckId: null,
    moduleId: null,
    moduleIndex: null,
    detail: present
      ? `${landmark.title}: ${bands} shaft band(s) over ${ship.decks.length} deck(s), ${runs} ladder run(s)`
      : `${landmark.title} is not climbable — ${missing.join('; ')}`,
  }
}

/**
 * Every §4 landmark that is missing from an assembled ship. Empty = the §4
 * brief's "must be present" list is satisfied.
 */
export function landmarkProblems(ship: ShipAssembly, world: NavigationWorld): string[] {
  return landmarkEvidence(ship, world)
    .filter((entry) => !entry.present)
    .map(
      (entry) => `the "${entry.title}" landmark (PRD §4) is missing: ${entry.detail}`,
    )
}

/** Present / total tally for a report line, e.g. "6/6 §4 landmarks present". */
export function landmarkTally(evidence: readonly LandmarkEvidence[]): string {
  const present = evidence.filter((entry) => entry.present).length
  return `${present}/${evidence.length} §4 landmarks present`
}
