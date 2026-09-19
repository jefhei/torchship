/**
 * M3-T2 — seam/hatch enforcement tests (BUILD_PLAN M3-T2 "mating geometry
 * generated from sockets (never freehand); [auto] watertight + alignment
 * checks wired into the assembler").
 *
 * The claims pinned here, in order:
 *  - PLANES: the wall-plane algebra the generator rests on (which world axis a
 *    facing's plane spans, which way its normal points, the face rectangle and
 *    plane a placed module presents, the opening a socket cuts);
 *  - RECTANGLES + ANNULUS: `contact` minus `opening`, decomposed the way
 *    `bulkheadParts` cuts a wall (jambs + lintel, a sill only for a raised
 *    doorway, nothing when the doorway is the whole contact);
 *  - SLEEVES: every join of every canonical ship gets mating geometry derived
 *    from its two sockets — the gap it measures equals the join's own
 *    along-normal channel, the annulus is covered, both wall planes are bitten
 *    by SEAM_BITE_M, the passage stays clear, and the sleeve lies inside the
 *    mating walls (it is the joint, not decoration);
 *  - PLUGS + HATCHES: blanked sockets are closed — by the module's own hatch
 *    when it authors one, otherwise by a plug cut from the socket that laps the
 *    wall and fills the wall's MEASURED thickness, marked solid for M3-T3;
 *  - MEASUREMENT: the coverage/bite/passage measurement is real logic — a
 *    seal that falls short, leaves a band open, or grows into the doorway is
 *    caught, and a bulwark meet without a socket is caught too;
 *  - THE GATE: the three real ships come back watertight with every socket
 *    accounted for; the QA rig comes back with its open seam named.
 */

import { describe, expect, it } from 'vitest'
import { MATERIAL_SLOTS, MM, deckFloorYFor } from '../types'
import type { ShipSpec } from '../types'
import {
  LONG_HAUL_SPEC,
  PATROL_SPEC,
  SCIENCE_SPEC,
  SHIP_FIXTURES,
  STRESS_SPEC,
  atSpine,
} from '../fixtures'
import { partBounds } from '../kit/parts'
import { assembleShip } from './assemble'
import { pieceShapeOf } from './batches'
import type { PlacedPart, SeamRect } from './types'
import {
  SEAM_BITE_M,
  SEAM_OVERHANG_M,
  SEAM_PLUG_LIP_M,
  SEAM_SLOT,
  annulusMembers,
  bulkheadMeetProblems,
  facePlaneOfFacing,
  faceRectOf,
  faceRectOfFacing,
  horizontalAxisOf,
  measureSealCoverage,
  moduleWorldBox,
  normalAxisOf,
  normalSignOf,
  openingRectOf,
  overshootMember,
  ownerOfDoor,
  placedSeamPart,
  rectContains,
  rectGrow,
  rectHeight,
  rectIntersect,
  rectOverlapArea,
  rectUnion,
  rectWidth,
  sealPartFor,
  seamPlansForDeck,
  seamPlansOf,
  seamSolidParts,
  seamTally,
  seamsWatertightProblems,
  selfSealedParts,
  wallExtentOf,
} from './index'

// ── helpers ────────────────────────────────────────────────────────────────

/** A rectangle in an X-facing wall plane (u = world Z), for unit tests. */
function xRect(uLo: number, uHi: number, vLo: number, vHi: number): SeamRect {
  return { horizontal: 2, uLo, uHi, vLo, vHi }
}

/** The patrol deck that carries a single room (every deck, here) — deck 0. */
function patrolDeck(index: number) {
  return assembleShip(PATROL_SPEC).decks[index]
}

/** The spine join plan of a deck (the one that lands the room on the shaft). */
function spinePlan(deckIndex: number) {
  const plan = patrolDeck(deckIndex).seams.find(
    (candidate) => candidate.kind === 'spine',
  )
  if (plan === undefined) throw new Error('no spine seam plan')
  return plan
}

/**
 * A placed part whose box is the given rect extruded along its wall normal,
 * authored in the wall's own frame (the rect's `horizontal` axis IS the wall's
 * horizontal axis, so the facing follows from it).
 */
function partOfRect(rect: SeamRect, depth: number, normalCenter: number): PlacedPart {
  const facing = rect.horizontal === 0 ? ('+z' as const) : ('+x' as const)
  return placedSeamPart(sealPartFor(rect, facing, depth, normalCenter), {
    deckId: 'test',
    moduleId: 'test',
    moduleIndex: 0,
  })
}

// ── planes ─────────────────────────────────────────────────────────────────

describe('wall planes and openings (M3-T2)', () => {
  it('maps every facing onto its wall-plane axis, normal axis and sign', () => {
    expect((['+x', '-x', '+z', '-z'] as const).map(horizontalAxisOf)).toEqual([
      2, 2, 0, 0,
    ])
    expect((['+x', '-x', '+z', '-z'] as const).map(normalAxisOf)).toEqual([0, 0, 2, 2])
    expect((['+x', '-x', '+z', '-z'] as const).map(normalSignOf)).toEqual([
      1, -1, 1, -1,
    ])
  })

  it('reads a placed module\u2019s face rectangle and plane off its world box', () => {
    const deck = patrolDeck(0)
    const room = deck.modules.find((owner) => !owner.band)
    const band = deck.band
    expect(room).toBeDefined()
    if (room === undefined) return

    // The galley/head block: 4.2 × 3.0 × 5.0, its spine-door flush in −z.
    const box = moduleWorldBox(room)
    expect(box.min[1]).toBe(deck.floorY)
    expect(box.max[1]).toBe(deck.floorY + 3)
    // The −z face: u = X, plane = the box's min z (off the deck origin column).
    expect(faceRectOfFacing(room, '-z')).toEqual({
      horizontal: 0,
      uLo: box.min[0],
      uHi: box.max[0],
      vLo: box.min[1],
      vHi: box.max[1],
    })
    expect(facePlaneOfFacing(room, '-z')).toBe(box.min[2])
    expect(facePlaneOfFacing(room, '+z')).toBe(box.max[2])
    // The shaft band column: 1.4 × 3.2 × 1.4 on the deck-local origin.
    expect(faceRectOfFacing(band, '+z')).toEqual({
      horizontal: 0,
      uLo: -0.7,
      uHi: 0.7,
      vLo: deck.floorY,
      vHi: deck.floorY + 3.2,
    })
    expect(facePlaneOfFacing(band, '+z')).toBe(0.7)
    // A door's face rect is its facing's face rect.
    const spineDoor = room.doors.find((door) => door.socketId === 'spine-door')
    expect(spineDoor).toBeDefined()
    if (spineDoor !== undefined) {
      expect(faceRectOf(room, spineDoor)).toEqual(faceRectOfFacing(room, '-z'))
    }
  })

  it('cuts the opening rectangle from the socket\u2019s own size and centre', () => {
    const deck = patrolDeck(0)
    const spineDoor = deck.modules
      .find((owner) => !owner.band)
      ?.doors.find((door) => door.socketId === 'spine-door')
    expect(spineDoor).toBeDefined()
    if (spineDoor === undefined) return
    // Standard 0.9 × 2.0 door, 1.0 m centre, so its bottom edge is the floor.
    expect(openingRectOf(spineDoor)).toEqual({
      horizontal: 0,
      uLo: -0.45,
      uHi: 0.45,
      vLo: deck.floorY,
      vHi: deck.floorY + 2,
    })

    // The engineering high-hatch is the kit's one non-standard socket.
    const engineering = assembleShip(SCIENCE_SPEC).decks.find(
      (candidate) => candidate.deckId === 'engineering',
    )
    const highHatch = engineering?.modules
      .find((owner) => !owner.band)
      ?.doors.find((door) => door.socketId === 'high-hatch')
    expect(highHatch).toBeDefined()
    if (highHatch !== undefined && engineering !== undefined) {
      const rect = openingRectOf(highHatch)
      expect(rectWidth(rect)).toBeCloseTo(0.8, 9)
      expect(rectHeight(rect)).toBeCloseTo(1.6, 9)
      // Raised: the sill is a real band above the deck plate.
      expect(rect.vLo).toBeCloseTo(engineering.floorY + 0.4, 9)
      expect(rect.horizontal).toBe(2) // the +x face
    }
  })

  it('has no horizontal pair for a facing and its opposite… they share the plane', () => {
    // xRect is an X-facing plane helper: unions/intersections need one plane.
    expect(rectIntersect(xRect(0, 1, 0, 1), xRect(0.5, 2, 0.5, 2))).toEqual(
      xRect(0.5, 1, 0.5, 1),
    )
    expect(rectIntersect(xRect(0, 1, 0, 1), xRect(2, 3, 0, 1))).toBeUndefined()
    expect(
      rectIntersect(xRect(0, 1, 0, 1), { ...xRect(0, 1, 0, 1), horizontal: 0 }),
    ).toBeUndefined()
    expect(rectUnion(xRect(0, 1, 0, 1), xRect(0.5, 2, -1, 0.5))).toEqual(
      xRect(0, 2, -1, 1),
    )
    expect(rectContains(xRect(0, 2, 0, 2), xRect(0.5, 1, 0.5, 1))).toBe(true)
    expect(rectContains(xRect(0, 2, 0, 2), xRect(0.5, 2.5, 0.5, 1))).toBe(false)
    expect(rectOverlapArea(xRect(0, 2, 0, 2), xRect(1, 3, 1, 3))).toBeCloseTo(1, 9)
    expect(rectOverlapArea(xRect(0, 1, 0, 1), xRect(1, 2, 0, 1))).toBe(0)
    expect(rectGrow(xRect(0, 1, 0, 1), 0.5)).toEqual(xRect(-0.5, 1.5, -0.5, 1.5))
  })
})

// ── annulus ────────────────────────────────────────────────────────────────

describe('the contact annulus (M3-T2)', () => {
  it('cuts a standard doorway into jambs + lintel, and no sill on the floor line', () => {
    const contact = xRect(-0.7, 0.7, 0, 3)
    const members = annulusMembers(contact, xRect(-0.45, 0.45, 0, 2))
    expect(members.map((member) => member.rect)).toEqual([
      xRect(-0.7, -0.45, 0, 3), // jambs span the full contact height…
      xRect(0.45, 0.7, 0, 3),
      xRect(-0.45, 0.45, 2, 3), // …the lintel only the doorway width
    ])
    // Free edges: the jambs' outer edge + both ends, the lintel's top only.
    expect(members[0].free).toEqual({ uLo: true, uHi: false, vLo: true, vHi: true })
    expect(members[2].free).toEqual({ uLo: false, uHi: false, vLo: false, vHi: true })
  })

  it('emits a sill for a raised doorway and nothing when the doorway is the contact', () => {
    const raised = annulusMembers(xRect(-0.7, 0.7, 0, 3), xRect(-0.4, 0.4, 0.4, 2))
    expect(raised.map((member) => member.rect)).toEqual([
      xRect(-0.7, -0.4, 0, 3),
      xRect(0.4, 0.7, 0, 3),
      xRect(-0.4, 0.4, 0, 0.4), // the sill under the raised hatch
      xRect(-0.4, 0.4, 2, 3),
    ])
    // An opening that covers the whole contact leaves nothing to seal…
    expect(annulusMembers(xRect(0, 1, 0, 1), xRect(-1, 2, -1, 2))).toEqual([])
    // …an opening that misses it leaves the whole contact as wall.
    expect(annulusMembers(xRect(0, 1, 0, 1), xRect(5, 6, 0, 1))).toEqual([
      { rect: xRect(0, 1, 0, 1), free: { uLo: true, uHi: true, vLo: true, vHi: true } },
    ])
  })

  it('overshoots only the free edges (so no face lands coplanar on a module)', () => {
    const [jamb, , lintel] = annulusMembers(
      xRect(-0.7, 0.7, 0, 3),
      xRect(-0.45, 0.45, 0, 2),
    )
    expect(overshootMember(jamb, SEAM_OVERHANG_M)).toEqual(
      xRect(-0.71, -0.45, -0.01, 3.01),
    )
    expect(overshootMember(lintel, SEAM_OVERHANG_M)).toEqual(
      xRect(-0.45, 0.45, 2, 3.01),
    )
  })
})

// ── sleeves on the canonical ships ────────────────────────────────────────

describe('join sleeves (M3-T2)', () => {
  it('sleeves the spine join from the two sockets: gap, coverage, bite, passage', () => {
    const deck = patrolDeck(0)
    const plan = spinePlan(0)
    const join = deck.joins.find((candidate) => candidate.kind === 'spine')
    expect(join).toBeDefined()

    expect(plan.sealedBy).toBe('sleeve')
    expect(plan.watertight).toBe(true)
    expect(plan.problems).toEqual([])
    expect(plan.gapMm).toBe(join?.normalMm) // the join's own measured channel
    expect(plan.gapMm).toBe(0)
    // Two jambs + a lintel for the standard doorway (no sill on the floor line).
    expect(plan.required).toHaveLength(3)
    expect(plan.parts).toHaveLength(3)
    // Both sides bite 30 mm past their wall plane.
    for (const side of plan.sides) {
      expect(side.biteM).toBeCloseTo(SEAM_BITE_M, 9)
    }
    expect(plan.sides.map((side) => side.door.socketId)).toEqual(['+z', 'spine-door'])
    // Every generated part is a bulkhead-slot box with provenance + a mould key.
    for (const entry of plan.parts) {
      expect(entry.materialSlot).toBe(SEAM_SLOT)
      expect(entry.part.kind).toBe('box')
      expect(entry.pieceId).toBe(pieceShapeOf(entry.part).id)
      expect(entry.source.deckId).toBe(deck.deckId)
      expect(entry.source.moduleIndex).toBe(0) // the room owns the doorway
    }

    // The sleeve lies INSIDE the two walls: a 60 mm plate centred on the joint
    // plane, jambs 0.25 + overhang wide, the lintel exactly the 0.9 m doorway.
    const normalAxis = normalAxisOf(plan.doors[0].facing)
    for (const entry of plan.parts) {
      const bounds = partBounds(entry.part)
      expect(bounds.min[normalAxis]).toBeCloseTo(0.7 - SEAM_BITE_M, 9)
      expect(bounds.max[normalAxis]).toBeCloseTo(0.7 + SEAM_BITE_M, 9)
    }
    const sizes = plan.parts.map((entry) =>
      entry.part.kind === 'box' ? entry.part.size : [0, 0, 0],
    )
    expect(sizes[0][0]).toBeCloseTo(0.25 + SEAM_OVERHANG_M, 9)
    expect(sizes[0][1]).toBeCloseTo(3 + 2 * SEAM_OVERHANG_M, 9)
    expect(sizes[2][0]).toBeCloseTo(0.9, 9)
    expect(sizes[2][1]).toBeCloseTo(1.0 + SEAM_OVERHANG_M, 9)

    // The passage is exactly the doorway: nothing of the sleeve is in it.
    const opening = openingRectOf(plan.doors[1])
    for (const entry of plan.parts) {
      const bounds = partBounds(entry.part)
      const footprint: SeamRect = {
        horizontal: horizontalAxisOf(plan.doors[0].facing),
        uLo: bounds.min[horizontalAxisOf(plan.doors[0].facing)],
        uHi: bounds.max[horizontalAxisOf(plan.doors[0].facing)],
        vLo: bounds.min[1],
        vHi: bounds.max[1],
      }
      expect(rectOverlapArea(footprint, opening)).toBe(0)
    }
  })

  it('gives every join of every canonical ship a watertight sleeve', () => {
    for (const fixture of SHIP_FIXTURES) {
      const ship = assembleShip(fixture.spec, { requireValidSpec: fixture.expectValid })
      for (const deck of ship.decks) {
        const sleeves = deck.seams.filter((plan) => plan.kind !== 'blank')
        expect(sleeves).toHaveLength(deck.joins.length)
        deck.joins.forEach((join) => {
          const plan = sleeves.find(
            (candidate) =>
              candidate.doors.includes(join.a) && candidate.doors.includes(join.b),
          )
          expect(plan).toBeDefined()
          expect(plan?.gapMm).toBe(Math.abs(join.normalMm))
          expect(plan?.sealedBy).toBe(plan?.required.length === 0 ? 'none' : 'sleeve')
        })
        // Every socket is accounted for: a plan per join plus a plan per blank.
        const sockets = deck.modules.reduce((sum, owner) => sum + owner.doors.length, 0)
        expect(deck.seams.length).toBe(deck.joins.length + deck.blanks.length)
        expect(deck.blanks.length + 2 * deck.joins.length).toBe(sockets)
      }
    }
  })

  it('is deterministic and measured in world space on the band\u2019s own faces', () => {
    const first = assembleShip(PATROL_SPEC)
    const second = assembleShip(PATROL_SPEC)
    first.decks.forEach((deck, index) => {
      expect(deck.seams).toEqual(second.decks[index].seams)
    })
    // Deck 2's room mates the band's +z face; deck 1's the same on its own floor.
    for (const index of [1, 2, 3, 4]) {
      const deck = patrolDeck(index)
      const plan = spinePlan(index)
      expect(plan.sides[0].plane).toBeCloseTo(0.7, 9)
      expect(plan.sides[1].plane).toBeCloseTo(0.7, 9)
      expect(plan.doors[0].center[1]).toBeCloseTo(deck.floorY + 1, 9)
    }
  })

  it('sleeves a module-to-module mate from its side sockets (the QA rig)', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    const rig3 = rig.decks[3]
    const mate = rig3.seams.find((plan) => plan.kind === 'module')
    expect(mate).toBeDefined()
    if (mate === undefined) return
    expect(mate.sealedBy).toBe('sleeve')
    expect(mate.doors.map((door) => door.socketId).sort()).toEqual([
      'high-hatch',
      'side-door',
    ])
    // Faces coincide (gap 0) but the openings disagree by 200 mm — the sleeve
    // frames the UNION so both doorways stay passable, and it is watertight.
    expect(mate.gapMm).toBe(0)
    expect(mate.watertight).toBe(true)
    expect(rectHeight(mate.opening)).toBeCloseTo(2, 9)
    expect(rectWidth(mate.opening)).toBeCloseTo(0.9, 9)
    // No sleeve part enters the union opening.
    for (const entry of mate.parts) {
      const bounds = partBounds(entry.part)
      const horizontal = horizontalAxisOf(mate.doors[0].facing)
      const footprint: SeamRect = {
        horizontal,
        uLo: bounds.min[horizontal],
        uHi: bounds.max[horizontal],
        vLo: bounds.min[1],
        vHi: bounds.max[1],
      }
      expect(rectOverlapArea(footprint, mate.opening)).toBe(0)
    }
  })
})

// ── blanked sockets ───────────────────────────────────────────────────────

describe('blanked sockets (M3-T2)', () => {
  it('plugs the shaft\u2019s unjoined faces: one solid part that fills the wall', () => {
    const deck = patrolDeck(0)
    const bandFaces = deck.seams.filter(
      (plan) => plan.kind === 'blank' && plan.doors[0].moduleIndex === -1,
    )
    // The band presents four faces; one is the room\u2019s landing, three blank.
    expect(bandFaces).toHaveLength(3)
    for (const plan of bandFaces) {
      expect(plan.sealedBy).toBe('plug')
      expect(plan.solid).toBe(true)
      expect(plan.watertight).toBe(true)
      expect(plan.parts).toHaveLength(1)
      const [entry] = plan.parts
      // Cut from the socket: the opening lapped by the lip on all four sides.
      const bounds = partBounds(entry.part)
      const horizontal = horizontalAxisOf(plan.doors[0].facing)
      expect(bounds.min[horizontal]).toBeCloseTo(plan.opening.uLo - SEAM_PLUG_LIP_M, 9)
      expect(bounds.max[horizontal]).toBeCloseTo(plan.opening.uHi + SEAM_PLUG_LIP_M, 9)
      expect(bounds.min[1]).toBeCloseTo(plan.opening.vLo - SEAM_PLUG_LIP_M, 9)
      // …and it fills the wall the socket sits in, bitten past both faces: the
      // kit\u2019s 0.1 m wall, MEASURED off the band\u2019s own geometry.
      const axis = normalAxisOf(plan.doors[0].facing)
      const plane = plan.doors[0].center[axis]
      const sign = normalSignOf(plan.doors[0].facing)
      const wallLo = sign === 1 ? plane - 0.1 : plane
      expect(bounds.min[axis]).toBeCloseTo(wallLo - SEAM_BITE_M, 9)
      expect(bounds.max[axis]).toBeCloseTo(
        sign === 1 ? plane + SEAM_BITE_M : plane + 0.1 + SEAM_BITE_M,
        9,
      )
      expect(plan.sides[0].biteM).toBeCloseTo(SEAM_BITE_M, 9)
    }
    // The three plugs on a deck are one mould → one instanced batch (M3-T7).
    const plugPiece = seamSolidParts(deck)[0].pieceId
    const batch = deck.batches.find((plan) => plan.batch.pieceId === plugPiece)
    expect(batch?.parts).toHaveLength(3)
  })

  it('measures the wall a socket sits in, rather than assuming a thickness', () => {
    const deck = patrolDeck(0)
    const band = deck.band
    const face = band.doors.find((door) => door.socketId === '+z')
    expect(face).toBeDefined()
    if (face === undefined) return
    const wall = wallExtentOf(band, face)
    // The kit's bulkhead panel: 0.1 m thick, its outer face ON the module face.
    expect(wall).toBeDefined()
    expect(wall?.[0]).toBeCloseTo(0.7 - 0.1, 9)
    expect(wall?.[1]).toBeCloseTo(0.7, 9)
    // A room's side door is hatched (no plug), but its wall measures the same way.
    const room = deck.modules.find((owner) => !owner.band)
    const sideDoor = room?.doors.find((door) => door.socketId !== 'spine-door')
    if (room !== undefined && sideDoor !== undefined) {
      const sideWall = wallExtentOf(room, sideDoor)
      expect(sideWall).toBeDefined()
      const axis = normalAxisOf(sideDoor.facing)
      const sign = normalSignOf(sideDoor.facing)
      const plane = sideDoor.center[axis]
      expect(Math.abs(sideWall![1] - sideWall![0])).toBeCloseTo(0.1, 9)
      expect(sign === 1 ? sideWall![1] : sideWall![0]).toBeCloseTo(plane, 9)
    }
  })

  it('leaves a socket the module already seals to its own hatch (evidence only)', () => {
    const deck = patrolDeck(1) // the crew deck: the galley has a side door
    const room = deck.modules.find((owner) => !owner.band)
    expect(room).toBeDefined()
    if (room === undefined) return
    const sideDoor = room.doors.find((door) => door.socketId === 'side-door')
    expect(sideDoor).toBeDefined()
    if (sideDoor === undefined) return

    const plan = deck.seams.find(
      (candidate) => candidate.kind === 'blank' && candidate.doors[0] === sideDoor,
    )
    expect(plan?.sealedBy).toBe('hatch')
    expect(plan?.parts).toEqual([]) // never re-emitted: the module owns it
    expect(plan?.sealEvidence.length).toBeGreaterThan(0)
    expect(plan?.watertight).toBe(true)
    // The evidence is the hatch seated ON the socket, straddling its plane.
    const axis = normalAxisOf(sideDoor.facing)
    const bounds = plan?.sealEvidence.map((entry) => partBounds(entry.part)) ?? []
    expect(Math.min(...bounds.map((box) => box.min[axis]))).toBeLessThanOrEqual(
      sideDoor.center[axis],
    )
    expect(Math.max(...bounds.map((box) => box.max[axis]))).toBeGreaterThanOrEqual(
      sideDoor.center[axis],
    )
    // …and it is exactly the module's own fillsSocket assembly, placed.
    expect(selfSealedParts(room, sideDoor)).toHaveLength(plan?.sealEvidence.length ?? 0)
    // The hatch is not a seam part: nothing generated, nothing doubly drawn.
    expect(seamSolidParts(deck).some((entry) => entry.source.moduleIndex === -1)).toBe(
      true,
    )
  })

  it('reports a socket whose owner is missing instead of inventing geometry', () => {
    const deck = patrolDeck(0)
    const join = deck.joins[0]
    const scan = { joins: [join], blanks: [] }
    const [plan] = seamPlansForDeck([], scan, 0, deck.deckId)
    expect(plan.sealedBy).toBe('none')
    expect(plan.parts).toEqual([])
    expect(plan.watertight).toBe(false)
    expect(plan.problems.join(' ')).toMatch(/has no owner module instance/)
  })

  it('plugs a socket with no measurable wall from the socket alone, and says so', () => {
    const deck = patrolDeck(0)
    const band = deck.band
    const face = band.doors.find((door) => door.socketId === '+z')
    if (face === undefined) return
    // An empty module instance: the wall cannot be measured…
    const stripped = { ...band, parts: [] }
    expect(wallExtentOf(stripped, face)).toBeUndefined()
    // …which the plan reports rather than claiming a filled wall.
    expect(ownerOfDoor([stripped], face)).toBe(stripped)
  })
})

// ── measurement ───────────────────────────────────────────────────────────

describe('the watertight measurement is real logic (M3-T2)', () => {
  // An X-facing wall plane (horizontal axis = Z), joint planes at z = 0.7.
  const required = xRect(-0.7, -0.45, 0, 3)
  const passage = xRect(-0.45, 0.45, 0, 2)
  const planeLo = 0.7
  const planeHi = 0.7
  const horizontal = 2 as const
  const good = partOfRect(xRect(-0.71, -0.45, -0.01, 3.01), 0.06, 0.7)

  it('passes a seal that covers the annulus and bites past both planes', () => {
    const measured = measureSealCoverage(
      [good],
      [required],
      planeLo,
      planeHi,
      undefined,
      passage,
      horizontal,
    )
    expect(measured.problems).toEqual([])
    expect(measured.biteLo).toBeCloseTo(SEAM_BITE_M, 9)
    expect(measured.biteHi).toBeCloseTo(SEAM_BITE_M, 9)
  })

  it('catches a seal that falls short of a wall plane', () => {
    // A plate that only starts 5 mm inside the joint plane: an open seam.
    const short = partOfRect(required, 0.06, 0.7325) // spans 0.7025…0.7625
    const measured = measureSealCoverage(
      [short],
      [required],
      planeLo,
      planeHi,
      undefined,
      passage,
      horizontal,
    )
    expect(measured.problems.join(' ')).toMatch(
      /stops 2\.5 mm short of the near wall plane \(700\.0 mm\)/,
    )
    expect(measured.biteLo).toBeCloseTo(-0.0025, 9)
  })

  it('catches an uncovered band, missing geometry and an obstructed passage', () => {
    const tiny = partOfRect(xRect(-0.5, -0.48, 0, 3), 0.06, 0.7)
    const uncovered = measureSealCoverage(
      [tiny],
      [required],
      planeLo,
      planeHi,
      undefined,
      passage,
      horizontal,
    )
    expect(uncovered.problems.join(' ')).toMatch(
      /does not cover a 0\.250 × 3\.000 m band/,
    )
    expect(
      measureSealCoverage(
        [],
        [required],
        planeLo,
        planeHi,
        undefined,
        passage,
        horizontal,
      ).problems,
    ).toEqual(['no sealing geometry was generated'])
    const intruding = partOfRect(xRect(-0.5, 0.1, 1.0, 2.0), 0.06, 0.7)
    const intrusion = measureSealCoverage(
      [intruding],
      [required],
      planeLo,
      planeHi,
      undefined,
      passage,
      horizontal,
    )
    expect(intrusion.problems.join(' ')).toMatch(
      /intrudes \d+ mm² into the pass-through/,
    )
  })

  it('measures a plug against the wall it fills', () => {
    const opening = xRect(-0.45, 0.45, 0, 2)
    const wall: [number, number] = [0.6, 0.7]
    const plug = partOfRect(rectGrow(opening, SEAM_PLUG_LIP_M), 0.16, 0.65)
    const ok = measureSealCoverage(
      [plug],
      [opening],
      wall[0],
      wall[1],
      { opening, wall },
      undefined,
      horizontal,
    )
    expect(ok.problems).toEqual([])
    expect(ok.biteLo).toBeCloseTo(SEAM_BITE_M, 9)
    expect(ok.biteHi).toBeCloseTo(SEAM_BITE_M, 9)
    // A plate that only laps the outer face does not fill the wall.
    const shallow = partOfRect(rectGrow(opening, SEAM_PLUG_LIP_M), 0.06, 0.7)
    const bad = measureSealCoverage(
      [shallow],
      [opening],
      wall[0],
      wall[1],
      { opening, wall },
      undefined,
      horizontal,
    )
    expect(bad.problems.join(' ')).toMatch(/does not fill the wall it sits in/)
    // …and a plate that misses the opening leaves the hole open.
    const offset = partOfRect(rectGrow(xRect(2, 3, 0, 2), SEAM_PLUG_LIP_M), 0.16, 0.65)
    expect(
      measureSealCoverage(
        [offset],
        [opening],
        wall[0],
        wall[1],
        { opening, wall },
        undefined,
        horizontal,
      ).problems.join(' '),
    ).toMatch(/does not cover a/)
  })
})

describe('bulkhead meets without a socket interface (M3-T2)', () => {
  /** A 3-deck ship with a second galley yawed 90° onto the crew deck. */
  function twinSpec(offsetX: number): ShipSpec {
    return {
      classId: 'hound',
      name: 'Meet',
      registry: 'QA-MEET',
      seed: 3,
      decks: [
        {
          id: 'head',
          label: 'Head',
          yPosition: deckFloorYFor(0),
          modules: [atSpine('head')],
        },
        {
          id: 'crew',
          label: 'Crew',
          yPosition: deckFloorYFor(1),
          modules: [
            atSpine('galley'),
            // Yaw 1 turns the galley's −z wall onto world −x, so its face lands
            // on the first galley's +x face: a wall meet with no socket between.
            { moduleId: 'galley', rotation: 1, offset: [4.6 + offsetX, 0, 3.2] },
          ],
        },
        {
          id: 'engineering',
          label: 'Engineering',
          yPosition: deckFloorYFor(2),
          modules: [atSpine('engineering')],
        },
      ],
    }
  }

  it('passes touching faces and reports a gap beyond the watertight cap', () => {
    const flush = assembleShip(twinSpec(0), { requireValidSpec: false }).decks[1]
    expect(bulkheadMeetProblems(flush)).toEqual([])

    const gap = assembleShip(twinSpec(5 * MM), { requireValidSpec: false }).decks[1]
    const problems = bulkheadMeetProblems(gap)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(
      /bulkhead meet galley#0 "\+x" ↔ galley#1 "-x": 5\.0 mm gap/,
    )
    expect(problems[0]).toMatch(/the watertight cap is < 2 mm/)
  })

  it('never reports a pair that already owns a door-socket join', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      for (const deck of assembleShip(spec).decks) {
        expect(bulkheadMeetProblems(deck)).toEqual([])
      }
    }
  })
})

// ── the gate ──────────────────────────────────────────────────────────────

describe('the seam gate (M3-T2)', () => {
  it('the three real ships come back watertight with every socket closed', () => {
    for (const spec of [PATROL_SPEC, LONG_HAUL_SPEC, SCIENCE_SPEC]) {
      const ship = assembleShip(spec)
      expect(seamsWatertightProblems(ship)).toEqual([])
      const tally = seamTally(ship)
      // Every join is sleeved; every blank is closed one way or the other.
      expect(tally.joins).toBe(
        ship.decks.reduce((sum, deck) => sum + deck.joins.length, 0),
      )
      expect(tally.blanks).toBe(
        ship.decks.reduce((sum, deck) => sum + deck.blanks.length, 0),
      )
      expect(tally.sleeved).toBe(tally.joins)
      expect(tally.hatchSealed + tally.plugged).toBe(tally.blanks)
      expect(tally.maxGapMm).toBe(0)
      expect(tally.minBiteM).toBeCloseTo(SEAM_BITE_M, 9)
      expect(tally.parts).toBe(
        ship.decks.reduce(
          (sum, deck) =>
            sum + deck.seams.reduce((deckSum, plan) => deckSum + plan.parts.length, 0),
          0,
        ),
      )
    }
    // Patrol: 5 rooms → 5 joins; 4 room side doors + 15 shaft faces blanked.
    const patrol = seamTally(assembleShip(PATROL_SPEC))
    expect(patrol.joins).toBe(5)
    expect(patrol.blanks).toBe(19)
    expect(patrol.hatchSealed).toBe(4)
    expect(patrol.plugged).toBe(15)
    expect(patrol.parts).toBe(30) // 5 sleeves × 3 members + 15 plugs
  })

  it('fails the QA rig on the open seam, not on its alignment defects', () => {
    const rig = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    const problems = seamsWatertightProblems(rig)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/deck 1 \("rig-1"\)/)
    expect(problems[0]).toMatch(/open seam of 10\.0 mm/)
    // The rig's other decks are geometrically sealed (their defects are
    // alignment/run/floor problems, which stay the validator's and the
    // assembler gate's findings).
    expect(seamTally(rig).maxGapMm).toBe(10)
    expect(rig.decks[2].seams.every((plan) => plan.watertight)).toBe(true)
    expect(rig.decks[4].seams.every((plan) => plan.watertight)).toBe(true)
  })

  it('generates only bulkhead-slot geometry, from the §4 vocabulary', () => {
    const ship = assembleShip(PATROL_SPEC)
    for (const plan of seamPlansOf(ship)) {
      for (const entry of plan.parts) {
        expect(entry.materialSlot).toBe(SEAM_SLOT)
        expect(MATERIAL_SLOTS).toContain(entry.materialSlot)
      }
      // The seal evidence is the module's own parts, never re-generated: every
      // evidence part must appear in the module's placed part list.
      if (plan.sealedBy === 'hatch') {
        const owner = ship.decks[plan.deckIndex].modules.find(
          (candidate) =>
            candidate.source.moduleId === plan.doors[0].moduleId &&
            candidate.source.moduleIndex === plan.doors[0].moduleIndex,
        )
        for (const entry of plan.sealEvidence) {
          expect(owner?.parts.map((part) => part.part)).toContain(entry.part)
        }
      }
    }
  })

  it('reports a seam whose sleeve cannot be measured (no contact area)', () => {
    // A room whose floor is 2.5 m above the deck: its face rectangle no longer
    // overlaps the band's, so the join has no contact annulus to seal.
    const ship = assembleShip(STRESS_SPEC, { requireValidSpec: false })
    const rig1 = ship.decks[1]
    const plan = rig1.seams.find((candidate) => candidate.kind === 'spine')
    expect(plan?.required.length).toBeGreaterThan(0) // a real annulus, measured
    expect(plan?.parts.length).toBe(plan?.required.length)
    // Every sleeve member reproduces its required rect (with the overshoot).
    plan?.required.forEach((rect, index) => {
      const part = plan.parts[index].part
      const bounds = partBounds(part)
      const footprint: SeamRect = {
        horizontal: rect.horizontal,
        uLo: bounds.min[rect.horizontal],
        uHi: bounds.max[rect.horizontal],
        vLo: bounds.min[1],
        vHi: bounds.max[1],
      }
      expect(rectContains(footprint, rect, 1e-9)).toBe(true)
    })
  })
})
