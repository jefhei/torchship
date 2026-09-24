/**
 * M3-T7 — merge/instance geometry builder tests (src/kit/render/merged.ts).
 *
 * The draw-call pass is only real if the geometry the renderer draws is the
 * geometry the assembler measured. These tests prove it at the three.js level,
 * headless (geometry construction needs no WebGL context):
 *
 *  - a part's placement (position + quarter-turn yaw / cylinder axis) produces
 *    EXACTLY the analytic bounds `partBounds` (src/kit/parts.ts) computes, so
 *    the GL geometry and the collision hull / seam measurement describe the
 *    same shape;
 *  - a merged group is ONE geometry covering the union of its parts, with the
 *    summed vertex/index counts — one mesh instead of N;
 *  - a mould + a placement reproduces the world part exactly: the three.js
 *    twin of the assembler's `placePart(mouldOf(shape), placementFor(shape,
 *    part)) ≡ world part` pin, which is what makes `InstancedMesh` legal.
 */

import { describe, expect, it } from 'vitest'
import { partBounds } from '../parts'
import type { Aabb3 } from '../../types'
import type { BoxPart, CylinderPart, KitPart } from '../types'
import {
  CYLINDER_SEGMENTS,
  geometryBounds,
  mergedPartsGeometry,
  mouldGeometry,
  partGeometry,
  placedPartGeometry,
  placementMatrix,
} from './merged'

/**
 * three.js stores vertex positions as float32, so a GL bounding box and the
 * assembler's analytic `partBounds` can only agree to float32 precision
 * (~1.2e-7 relative) — 5 decimals covers a 40 m ship with room to spare, and
 * still catches the errors that matter (a yaw applied the wrong way is metres).
 */
const FLOAT32_DIGITS = 5

/** Compare two boxes component-wise, to float32 precision. */
function expectBoxClose(actual: Aabb3, expected: Aabb3): void {
  ;(['min', 'max'] as const).forEach((edge) => {
    actual[edge].forEach((value, axis) => {
      expect(value, `${edge}[${axis}]`).toBeCloseTo(
        expected[edge][axis],
        FLOAT32_DIGITS,
      )
    })
  })
}

const BOX: BoxPart = {
  kind: 'box',
  materialSlot: 'bulkhead',
  size: [2, 1, 0.5],
  position: [1, 0.5, -2],
}

const PIPE_X: CylinderPart = {
  kind: 'cylinder',
  materialSlot: 'conduit',
  radius: 0.1,
  length: 1,
  axis: 'x',
  position: [0, 2, 0],
}

describe('partGeometry', () => {
  it('builds a box in its own frame, centred on the origin', () => {
    const bounds = geometryBounds(partGeometry(BOX))
    expectBoxClose(bounds, { min: [-1, -0.5, -0.25], max: [1, 0.5, 0.25] })
  })

  it('builds a cylinder on three default +Y axis at the shared tessellation', () => {
    const geometry = partGeometry(PIPE_X)
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    // 16 radial segments: a side ring of 16 quads + two 16-triangle caps.
    expect(index?.count).toBe(CYLINDER_SEGMENTS * 6 + CYLINDER_SEGMENTS * 3 * 2)
    expectBoxClose(geometryBounds(geometry), {
      min: [-0.1, -0.5, -0.1],
      max: [0.1, 0.5, 0.1],
    })
  })
})

describe('placedPartGeometry', () => {
  it('places a box part to exactly the analytic bounds partBounds gives', () => {
    expectBoxClose(geometryBounds(placedPartGeometry(BOX)), partBounds(BOX))
  })

  it('swaps a box XZ extents on a quarter-turn yaw, exactly as partBounds does', () => {
    const yawed: BoxPart = { ...BOX, rotation: 1 }
    expectBoxClose(geometryBounds(placedPartGeometry(yawed)), partBounds(yawed))
    const once = geometryBounds(placedPartGeometry(yawed))
    // The 2 m span now runs along Z and the 0.5 m span along X.
    expect(once.max[0] - once.min[0]).toBeCloseTo(0.5, 9)
    expect(once.max[2] - once.min[2]).toBeCloseTo(2, 9)
  })

  it('re-axes a cylinder onto x, y and z exactly as partBounds does', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const part: CylinderPart = { ...PIPE_X, axis }
      expectBoxClose(geometryBounds(placedPartGeometry(part)), partBounds(part))
      // The 1 m axis reads on the axis's own component, ±radius elsewhere.
      const bounds = geometryBounds(placedPartGeometry(part))
      const spans = [
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ]
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      expect(spans[axisIndex]).toBeCloseTo(1, FLOAT32_DIGITS)
      spans.forEach((span, index) => {
        if (index !== axisIndex) expect(span).toBeCloseTo(0.2, FLOAT32_DIGITS)
      })
    }
  })

  it('keeps a part-list pose exact on every axis (a rotated, offset stack)', () => {
    const parts: KitPart[] = [BOX, { ...BOX, rotation: 2 }, PIPE_X]
    for (const part of parts) {
      expectBoxClose(geometryBounds(placedPartGeometry(part)), partBounds(part))
    }
  })
})

describe('mergedPartsGeometry', () => {
  const parts: KitPart[] = [
    BOX,
    { ...PIPE_X, axis: 'z' },
    {
      kind: 'box',
      materialSlot: 'deckplate',
      size: [0.4, 0.4, 0.4],
      position: [-1, 0, 0],
      rotation: 3,
    },
  ]

  it('is ONE geometry covering the union of its parts', () => {
    const merged = mergedPartsGeometry(parts)
    expect(merged).not.toBeNull()
    if (merged === null) return
    const lo: number[] = [Infinity, Infinity, Infinity]
    const hi: number[] = [-Infinity, -Infinity, -Infinity]
    for (const part of parts) {
      const bounds = partBounds(part)
      bounds.min.forEach((value, axis) => {
        lo[axis] = Math.min(lo[axis], value)
      })
      bounds.max.forEach((value, axis) => {
        hi[axis] = Math.max(hi[axis], value)
      })
    }
    expectBoxClose(geometryBounds(merged), {
      min: [lo[0], lo[1], lo[2]],
      max: [hi[0], hi[1], hi[2]],
    })
  })

  it('sums the parts vertex and index counts (nothing dropped, nothing doubled)', () => {
    const merged = mergedPartsGeometry(parts)
    if (merged === null) throw new Error('merge failed')
    let vertices = 0
    let indices = 0
    for (const part of parts) {
      const geometry = placedPartGeometry(part)
      vertices += geometry.attributes.position.count
      indices += geometry.getIndex()?.count ?? 0
      geometry.dispose()
    }
    expect(merged.attributes.position.count).toBe(vertices)
    expect(merged.getIndex()?.count).toBe(indices)
    // One merged mesh draws both box and cylinder geometry: same attribute set.
    expect(Object.keys(merged.attributes).sort()).toEqual(['normal', 'position', 'uv'])
  })

  it('keeps a single part where it belongs (merged bounds are not the sum of poses)', () => {
    const only = mergedPartsGeometry([BOX])
    if (only === null) throw new Error('merge failed')
    expectBoxClose(geometryBounds(only), partBounds(BOX))
  })

  it('reports an empty group as no geometry at all', () => {
    expect(mergedPartsGeometry([])).toBeNull()
  })

  it('is deterministic: the same group merges to the same bounds twice', () => {
    const first = mergedPartsGeometry(parts)
    const second = mergedPartsGeometry(parts)
    if (first === null || second === null) throw new Error('merge failed')
    expectBoxClose(geometryBounds(second), geometryBounds(first))
    expect(second.attributes.position.count).toBe(first.attributes.position.count)
  })
})

describe('mouldGeometry + placementMatrix', () => {
  const mouldX: CylinderPart = { ...PIPE_X, position: [0, 0, 0] }

  it('builds the mould in its own frame (a cylinder keeps its mould axis)', () => {
    expectBoxClose(geometryBounds(mouldGeometry(mouldX)), {
      min: [-0.5, -0.1, -0.1],
      max: [0.5, 0.1, 0.1],
    })
    expectBoxClose(geometryBounds(mouldGeometry({ ...BOX, position: [0, 0, 0] })), {
      min: [-1, -0.5, -0.25],
      max: [1, 0.5, 0.25],
    })
  })

  it('applies translate ∘ rotate (a placement is a yaw in world space)', () => {
    const geometry = partGeometry(BOX).applyMatrix4(
      placementMatrix({ position: [1, 2, 3], rotation: 1 }),
    )
    expectBoxClose(geometryBounds(geometry), {
      min: [1 - 0.25, 2 - 0.5, 3 - 1],
      max: [1 + 0.25, 2 + 0.5, 3 + 1],
    })
  })

  it('supports a uniform scale placement (Transform3.scale)', () => {
    const geometry = partGeometry(BOX).applyMatrix4(
      placementMatrix({ position: [0, 0, 0], rotation: 0, scale: 2 }),
    )
    expectBoxClose(geometryBounds(geometry), {
      min: [-2, -1, -0.5],
      max: [2, 1, 0.5],
    })
  })

  it('mould + placement reproduces the world part exactly (the instancing pin)', () => {
    // A cylinder moulded along X, instanced onto a part running along Z, and a
    // box mould instanced onto a yawed box: the two cases `placementFor`
    // produces (batches.ts). This is `placePart(mouldOf(shape),
    // placementFor(shape, part))` ≡ part, in three.js.
    const cylinder: CylinderPart = { ...PIPE_X, axis: 'z', position: [1.5, -2, 0.25] }
    const cylinderInstance = mouldGeometry(mouldX)
    cylinderInstance.applyMatrix4(
      placementMatrix({ position: [1.5, -2, 0.25], rotation: 1 }),
    )
    expectBoxClose(geometryBounds(cylinderInstance), partBounds(cylinder))

    const box: BoxPart = { ...BOX, rotation: 3 }
    const boxInstance = mouldGeometry({ ...BOX, rotation: 0, position: [0, 0, 0] })
    boxInstance.applyMatrix4(
      placementMatrix({ position: box.position, rotation: box.rotation ?? 0 }),
    )
    expectBoxClose(geometryBounds(boxInstance), partBounds(box))
  })
})
