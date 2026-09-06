import { describe, expect, it } from 'vitest'
import {
  doorCenterDeckOffsetM,
  doorSizeOf,
  getKitModule,
  isStandardDoorCenter,
  kitManifestProblems,
  assertKitManifestIntegrity,
} from './kit'
import { STANDARD_DOOR_SIZE } from './units'
import type { DoorSocket, KitManifest, KitModule } from './kit'

/** Galley-like module: 4.2 × 3.0 × 5.0 m, floor at y=0, footprint centered in XZ. */
function galleyModule(): KitModule {
  return {
    id: 'galley',
    label: 'Galley / bunk (table + coffee station)',
    dimensions: [4.2, 3.0, 5.0],
    doorSockets: [
      { id: 'spine-door', position: [0, 1.0, -2.5], facing: '-z' },
      { id: 'side-door', position: [2.1, 1.0, 1.2], facing: '+x' },
    ],
    lightSockets: [
      { id: 'panel-1', kind: 'panel', position: [0, 2.9, 0] },
      { id: 'task-coffee', kind: 'task', position: [1.6, 1.3, 2.2] },
    ],
    equipmentSlots: [{ id: 'coffee-station', position: [1.6, 0, 2.2] }],
    collisionHint: {
      boxes: [{ min: [-2.1, 0, -2.5], max: [2.1, 3.0, 2.5] }],
    },
  }
}

/** Engineering-like module carrying the deliberate non-standard 1.2 m high-hatch. */
function engineeringModule(): KitModule {
  return {
    id: 'engineering',
    label: 'Engineering (reactor access, drive glow window)',
    dimensions: [4.5, 3.0, 4.8],
    doorSockets: [
      { id: 'spine-door', position: [0, 1.0, -2.4], facing: '-z' },
      {
        id: 'high-hatch',
        position: [2.25, 1.2, 0.6],
        facing: '+x',
        door: { width: 0.8, height: 1.6 },
      },
    ],
    lightSockets: [
      { id: 'panel-1', kind: 'panel', position: [0, 2.9, 0] },
      { id: 'reactor-glow', kind: 'reactor', position: [-1.2, 1.5, -1.0] },
    ],
    equipmentSlots: [{ id: 'reactor-access', position: [0.5, 0, 1.8] }],
    collisionHint: { boxes: [] },
  }
}

function manifest(...modules: KitModule[]): KitManifest {
  return { modules }
}

describe('door-socket contract helpers (M1-T2)', () => {
  it('doorCenterDeckOffsetM measures the deck offset from the standard 1.0 m center', () => {
    const standard = galleyModule().doorSockets[0]
    expect(doorCenterDeckOffsetM(standard)).toBe(0)
    const high = engineeringModule().doorSockets[1]
    expect(doorCenterDeckOffsetM(high)).toBeCloseTo(0.2, 12) // engineering's high-hatch
    const low: DoorSocket = { id: 'low', position: [0, 0.8, -1], facing: '-z' }
    expect(doorCenterDeckOffsetM(low)).toBeCloseTo(-0.2, 12)
  })

  it('isStandardDoorCenter flags only the standard height', () => {
    expect(isStandardDoorCenter(galleyModule().doorSockets[0])).toBe(true)
    expect(isStandardDoorCenter(engineeringModule().doorSockets[1])).toBe(false)
  })

  it('doorSizeOf defaults an omitted opening to the standard 0.9 × 2.0 m door', () => {
    const standard = galleyModule().doorSockets[0]
    expect(standard.door).toBeUndefined()
    expect(doorSizeOf(standard)).toEqual(STANDARD_DOOR_SIZE)
    const high = engineeringModule().doorSockets[1]
    expect(doorSizeOf(high)).toEqual({ width: 0.8, height: 1.6 })
  })

  it('getKitModule finds by id and throws on unknown module ids', () => {
    const m = manifest(galleyModule(), engineeringModule())
    expect(getKitModule(m, 'galley').label).toMatch(/Galley/)
    expect(() => getKitModule(m, 'ops')).toThrow(/no module "ops"/)
  })
})

describe('kit manifest integrity (M1-T2)', () => {
  it('accepts a well-formed manifest (standard + non-standard doors intact)', () => {
    const m = manifest(galleyModule(), engineeringModule())
    expect(kitManifestProblems(m)).toEqual([])
    expect(() => assertKitManifestIntegrity(m)).not.toThrow()
  })

  it('rejects duplicate module ids across the manifest', () => {
    const problems = kitManifestProblems(manifest(galleyModule(), galleyModule()))
    expect(problems.some((p) => p.includes('"galley" is duplicated'))).toBe(true)
  })

  it('rejects duplicate door/light/equipment ids within a module', () => {
    const dupDoor = galleyModule()
    dupDoor.doorSockets[1] = { ...dupDoor.doorSockets[1], id: 'spine-door' }
    let problems = kitManifestProblems(manifest(dupDoor))
    expect(
      problems.some((p) => p.includes('door socket id "spine-door" is duplicated')),
    ).toBe(true)

    const dupLight = galleyModule()
    dupLight.lightSockets[1] = { ...dupLight.lightSockets[1], id: 'panel-1' }
    problems = kitManifestProblems(manifest(dupLight))
    expect(
      problems.some((p) => p.includes('light socket id "panel-1" is duplicated')),
    ).toBe(true)

    const dupEquip = galleyModule()
    // A second equipment anchor reusing the existing id makes the duplicate.
    dupEquip.equipmentSlots.push({ id: 'coffee-station', position: [0, 0, 0] })
    problems = kitManifestProblems(manifest(dupEquip))
    expect(
      problems.some((p) =>
        p.includes('equipment slot id "coffee-station" is duplicated'),
      ),
    ).toBe(true)
  })

  it('rejects non-positive dimensions', () => {
    const bad = galleyModule()
    bad.dimensions = [4.2, 0, 5.0]
    const problems = kitManifestProblems(manifest(bad))
    expect(problems.some((p) => p.includes('dimensions must be positive'))).toBe(true)
  })

  it('rejects a door socket that is not flush with its face (beyond ±0.5 mm)', () => {
    const bad = galleyModule()
    // 0.1 m short of the +x face at x = 2.1.
    bad.doorSockets[1] = { ...bad.doorSockets[1], position: [2.0, 1.0, 1.2] }
    const problems = kitManifestProblems(manifest(bad))
    expect(problems.some((p) => p.includes('off its +x face'))).toBe(true)
    // Inside the authoring budget (±0.5 mm) is fine.
    const ok = galleyModule()
    ok.doorSockets[1] = { ...ok.doorSockets[1], position: [2.1004, 1.0, 1.2] }
    expect(kitManifestProblems(manifest(ok))).toEqual([])
  })

  it('rejects a door whose opening overhangs its face', () => {
    const bad = galleyModule()
    // A 5.2 m wide door centered on the −z face: the door spans
    // x ∈ [−2.6, 2.6] but that face only spans x ∈ [−2.1, 2.1] — it overhangs.
    bad.doorSockets[0] = {
      ...bad.doorSockets[0],
      position: [0, 1.0, -2.5],
      door: { width: 5.2, height: 2.0 },
    }
    const problems = kitManifestProblems(manifest(bad))
    expect(problems.some((p) => p.includes('overhangs its -z face'))).toBe(true)
  })

  it('rejects a door that does not fit floor-to-ceiling', () => {
    const bad = galleyModule()
    // 4.0 m tall door centered at 1.0 m: bottom edge 1.0 m below the floor.
    bad.doorSockets[0] = {
      ...bad.doorSockets[0],
      door: { width: 0.9, height: 4.0 },
    }
    const problems = kitManifestProblems(manifest(bad))
    expect(problems.some((p) => p.includes('does not fit floor-to-ceiling'))).toBe(true)
  })

  it('rejects light and equipment anchors outside the module box', () => {
    const badLight = galleyModule()
    badLight.lightSockets[0] = { ...badLight.lightSockets[0], position: [3.0, 2.9, 0] }
    const problems = kitManifestProblems(manifest(badLight))
    expect(
      problems.some(
        (p) => p.includes('light socket "panel-1"') && p.includes('outside'),
      ),
    ).toBe(true)

    const badEquip = galleyModule()
    badEquip.equipmentSlots[0] = {
      ...badEquip.equipmentSlots[0],
      position: [0, -0.5, 0],
    }
    const problems2 = kitManifestProblems(manifest(badEquip))
    expect(
      problems2.some(
        (p) => p.includes('equipment slot "coffee-station"') && p.includes('outside'),
      ),
    ).toBe(true)
  })

  it('assertKitManifestIntegrity throws with every problem listed', () => {
    const bad = galleyModule()
    bad.doorSockets[0] = { ...bad.doorSockets[0], id: 'side-door' } // duplicate + now no spine-door
    expect(() => assertKitManifestIntegrity(manifest(bad))).toThrow(
      /kit manifest integrity/,
    )
  })
})
