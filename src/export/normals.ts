/**
 * M6-T2 — the "no flipped normals" half of the Blender validation (BUILD_PLAN
 * M6-T2: "Validate export in Blender (materials intact, deck groups present,
 * no flipped normals)"; PRD §13 "the glTF interior loads in Blender with
 * material slots intact and deck groups named per contract").
 *
 * Blender, on import, orients every face from its winding and its vertex
 * normals; a face whose winding disagrees with the normals it carries is a
 * flipped normal — it shades inside-out and `recalculate normals outside` would
 * have to fix it. The exporter writes three's own CCW winding and unit normals,
 * so a clean export has ZERO such disagreements. This module measures that on
 * the serialised document (POSITION + NORMAL + indices), headlessly — the
 * machine-gate form of the check Blender performs visually.
 *
 * The audit is deliberately conservative: only TRIANGLES primitives are
 * inspected (the kit emits triangles), degenerate faces are counted but never
 * judged (a zero-area face has no orientation to flip), and a malformed
 * document is reported as a problem rather than thrown (the same posture as
 * `exportProblems`). A non-unit normal is reported too — three normalises on
 * export, so anything else means the file was hand-edited.
 */

import type { GltfDocument } from './contract'
import { readAccessorValues } from './contract'

/** How far a normal may drift from unit length before it is reported. */
export const NORMAL_UNIT_EPS = 5e-3
/** Squared cross-product length under which a triangle is degenerate (no normal). */
export const DEGENERATE_AREA_EPS2 = 1e-12
/** Dot below which winding is judged to oppose the normals (gives ~0 some room). */
export const FLIP_DOT_EPS = -1e-6
/** glTF primitive mode TRIANGLES. */
const MODE_TRIANGLES = 4

/** One triangles primitive's normal audit. */
export interface PrimitiveNormalAudit {
  mesh: number
  primitive: number
  triangles: number
  degenerate: number
  flipped: number
  nonUnit: number
  /** Index of the first flipped triangle (for the report), or null. */
  firstFlippedTriangle: number | null
}

/** The normals audit over a whole glTF document. */
export interface NormalAudit {
  /** Triangles primitives inspected. */
  primitives: number
  triangles: number
  degenerate: number
  flipped: number
  nonUnit: number
  rows: PrimitiveNormalAudit[]
  problems: string[]
}

function vec(values: readonly number[], index: number): [number, number, number] {
  return [values[index * 3], values[index * 3 + 1], values[index * 3 + 2]]
}

function subtract(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function length(v: readonly [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/**
 * Audit every TRIANGLES primitive of a serialised glTF document for flipped /
 * non-unit / missing normals. Never throws: a malformed accessor is a problem.
 */
export function auditNormals(gltf: unknown): NormalAudit {
  const audit: NormalAudit = {
    primitives: 0,
    triangles: 0,
    degenerate: 0,
    flipped: 0,
    nonUnit: 0,
    rows: [],
    problems: [],
  }
  if (typeof gltf !== 'object' || gltf === null) {
    audit.problems.push('normals: not a glTF document object')
    return audit
  }
  const doc = gltf as GltfDocument
  const meshes = doc.meshes ?? []
  meshes.forEach((mesh, meshIndex) => {
    mesh.primitives.forEach((primitive, primIndex) => {
      if ((primitive.mode ?? MODE_TRIANGLES) !== MODE_TRIANGLES) return
      const positionIndex = primitive.attributes.POSITION
      const normalIndex = primitive.attributes.NORMAL
      if (positionIndex === undefined || normalIndex === undefined) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: triangles primitive without POSITION/NORMAL`,
        )
        return
      }
      let positions: number[]
      let normals: number[]
      let vertexCount: number
      try {
        positions = readAccessorValues(doc, positionIndex)
        normals = readAccessorValues(doc, normalIndex)
        vertexCount = doc.accessors?.[positionIndex]?.count ?? positions.length / 3
      } catch (error) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: cannot read geometry (${(error as Error).message})`,
        )
        return
      }
      if (normals.length !== positions.length) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: NORMAL count ${normals.length / 3} != POSITION count ${positions.length / 3}`,
        )
        return
      }

      let indices: number[]
      try {
        indices =
          primitive.indices === undefined
            ? Array.from({ length: vertexCount }, (_, i) => i)
            : readAccessorValues(doc, primitive.indices)
      } catch (error) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: cannot read indices (${(error as Error).message})`,
        )
        return
      }

      const row: PrimitiveNormalAudit = {
        mesh: meshIndex,
        primitive: primIndex,
        triangles: 0,
        degenerate: 0,
        flipped: 0,
        nonUnit: 0,
        firstFlippedTriangle: null,
      }
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
        if (!Number.isFinite(len) || Math.abs(len - 1) > NORMAL_UNIT_EPS) row.nonUnit++
      }
      const triangleCount = Math.floor(indices.length / 3)
      for (let t = 0; t < triangleCount; t++) {
        const i0 = indices[t * 3]
        const i1 = indices[t * 3 + 1]
        const i2 = indices[t * 3 + 2]
        if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) {
          audit.problems.push(
            `mesh ${meshIndex} prim ${primIndex}: triangle ${t} indexes vertex ${Math.max(i0, i1, i2)} >= ${vertexCount}`,
          )
          continue
        }
        const face = cross(
          subtract(vec(positions, i1), vec(positions, i0)),
          subtract(vec(positions, i2), vec(positions, i0)),
        )
        const area2 = face[0] * face[0] + face[1] * face[1] + face[2] * face[2]
        if (area2 <= DEGENERATE_AREA_EPS2) {
          row.degenerate++
          continue
        }
        const faceLen = Math.sqrt(area2)
        const avg: [number, number, number] = [
          normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3],
          normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1],
          normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2],
        ]
        const avgLen = length(avg)
        if (avgLen <= NORMAL_UNIT_EPS) continue // opposing normals: no orientation to judge
        const dot =
          (face[0] * avg[0] + face[1] * avg[1] + face[2] * avg[2]) / (faceLen * avgLen)
        if (dot < FLIP_DOT_EPS) {
          row.flipped++
          if (row.firstFlippedTriangle === null) row.firstFlippedTriangle = t
        }
      }

      audit.primitives++
      row.triangles = triangleCount
      audit.triangles += triangleCount
      audit.degenerate += row.degenerate
      audit.flipped += row.flipped
      audit.nonUnit += row.nonUnit
      audit.rows.push(row)

      if (row.flipped > 0) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: ${row.flipped}/${triangleCount} triangle(s) wind against their vertex normals — flipped normals`,
        )
      }
      if (row.nonUnit > 0) {
        audit.problems.push(
          `mesh ${meshIndex} prim ${primIndex}: ${row.nonUnit} normal(s) are not unit length`,
        )
      }
    })
  })
  return audit
}

/** The audit's problems, as data (empty = every normal is unit and outward). */
export function normalsProblems(gltf: unknown): string[] {
  return auditNormals(gltf).problems
}
