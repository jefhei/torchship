/**
 * M2-T7 — headless render introspection for the authored kit.
 *
 * jsdom has no WebGL (src/test-setup.ts), so the kit's R3F components cannot be
 * mounted on a real `<Canvas>` in tests. This module walks the React ELEMENT
 * TREE a module component returns and extracts exactly what the renderer would
 * draw: one item per `<mesh>`, with its geometry, its §4 material slot and its
 * transform.
 *
 * The walk resolves function components by CALLING them. That is safe — and
 * faithful — because the kit's render layer is deliberately dumb
 * (src/kit/render/KitParts.tsx): no hooks, no context, no state, just
 * part → mesh mapping. harness.test.tsx pins this model against a REAL
 * react-dom render of the same components (same mesh count, same geometry args,
 * same slot names), so the model cannot silently drift from what React does;
 * and it stays node-loadable, which keeps the harness usable outside jsdom.
 *
 * Two invariants it enforces on itself:
 *  - a mesh carries exactly one geometry and exactly one material (the kit's
 *    vocabulary is boxes and cylinders, nothing else);
 *  - the material names its §4 slot (`<SlotMaterial>` sets `name`), so a slot
 *    can never be inferred wrongly from a colour.
 */

import { Fragment, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { MaterialSlot, Vec3 } from '../../types'
import { MATERIAL_SLOTS } from '../../types'
import type { KitPart } from '../types'
import { boxEuler, cylinderEuler } from '../render/transforms'

/** Geometry a rendered kit mesh draws: the two shapes the builders emit. */
export type RenderedGeometry =
  { kind: 'box'; size: Vec3 } | { kind: 'cylinder'; radius: number; length: number }

/** One mesh the render tree produces, in builder order. */
export interface RenderedPart {
  geometry: RenderedGeometry
  /** §4 slot the mesh's material resolves to (the material's `name`). */
  slot: MaterialSlot
  /** Mesh position, meters (three's default `[0, 0, 0]` when unset). */
  position: Vec3
  /** Mesh Euler rotation, radians. */
  rotation: Vec3
}

/** Host elements the kit's render layer is allowed to emit. */
const KIT_HOSTS = new Set([
  'group',
  'mesh',
  'boxGeometry',
  'cylinderGeometry',
  'meshStandardMaterial',
])

/** True when `value` is a §4 material slot name. */
function isMaterialSlot(value: unknown): value is MaterialSlot {
  return (
    typeof value === 'string' && (MATERIAL_SLOTS as readonly string[]).includes(value)
  )
}

/** A triple from a React prop (undefined = three's default `[0, 0, 0]`). */
function tripleProp(value: unknown, what: string): Vec3 {
  if (value === undefined) return [0, 0, 0]
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`kit render tree: ${what} is not a 3-tuple`)
  }
  const [x, y, z] = value as unknown[]
  for (const component of [x, y, z]) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new Error(`kit render tree: ${what} has a non-finite component`)
    }
  }
  return [x as number, y as number, z as number]
}

/** Positive number from a geometry `args` entry. */
function positiveArg(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`kit render tree: ${what} is not a positive number`)
  }
  return value
}

/** Props of a React element, as a plain record. */
function propsOf(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>
}

/**
 * Flatten a children node into HOST elements: arrays, fragments and the kit's
 * function components are resolved away (a component is called — see the module
 * header), so the result is the element tree React would hand the renderer.
 */
function hostsOf(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  const visit = (current: ReactNode): void => {
    if (current === null || current === undefined || typeof current === 'boolean')
      return
    if (Array.isArray(current)) {
      for (const child of current) visit(child as ReactNode)
      return
    }
    if (typeof current === 'string' || typeof current === 'number') {
      throw new Error('kit render tree: a kit group contains a text node')
    }
    if (!isValidElement(current)) return

    const element = current as ReactElement
    const { type } = element
    if (type === Fragment) {
      visit(propsOf(element).children as ReactNode)
      return
    }
    if (typeof type === 'function') {
      visit((type as (props: unknown) => ReactNode)(propsOf(element)))
      return
    }
    if (typeof type === 'string') {
      out.push(element)
      return
    }
    throw new Error('kit render tree: unsupported element type')
  }
  visit(node)
  return out
}

/** Every host element of a children node, rejecting misplaced hosts. */
function hostChildren(node: ReactNode, parent: string): ReactElement[] {
  const hosts = hostsOf(node)
  for (const host of hosts) {
    if (typeof host.type !== 'string' || !KIT_HOSTS.has(host.type)) {
      throw new Error(`kit render tree: unexpected host element <${String(host.type)}>`)
    }
    if (host.type === 'group' || host.type === 'mesh') {
      throw new Error(
        `kit render tree: <${host.type}> may not nest inside <${parent}> ` +
          `(the kit draws flat groups of meshes)`,
      )
    }
  }
  return hosts
}

/** Read one `<mesh>` element (its geometry + material children). */
function meshOf(element: ReactElement): RenderedPart {
  const props = propsOf(element)
  const children = hostChildren(props.children as ReactNode, 'mesh')
  const geometry = children.filter(
    (child) => child.type === 'boxGeometry' || child.type === 'cylinderGeometry',
  )
  const materials = children.filter((child) => child.type === 'meshStandardMaterial')

  if (geometry.length !== 1) {
    throw new Error(
      `kit render tree: a mesh carries ${geometry.length} geometries (expected exactly 1)`,
    )
  }
  if (materials.length !== 1) {
    throw new Error(
      `kit render tree: a mesh carries ${materials.length} materials (expected exactly 1)`,
    )
  }
  if (children.length !== 2) {
    throw new Error(
      `kit render tree: a mesh carries ${children.length} children, expected a geometry and a material`,
    )
  }

  const geometryElement = geometry[0]
  const materialElement = materials[0]
  const args = propsOf(geometryElement).args
  if (!Array.isArray(args)) {
    throw new Error('kit render tree: a geometry has no constructor args')
  }

  let shape: RenderedGeometry
  if (geometryElement.type === 'boxGeometry') {
    shape = {
      kind: 'box',
      size: [
        positiveArg(args[0], 'box width'),
        positiveArg(args[1], 'box height'),
        positiveArg(args[2], 'box depth'),
      ],
    }
  } else {
    const radiusTop = positiveArg(args[0], 'cylinder radius')
    const radiusBottom = positiveArg(args[1], 'cylinder radius')
    if (radiusTop !== radiusBottom) {
      throw new Error('kit render tree: the kit draws uniform cylinders, not cones')
    }
    shape = {
      kind: 'cylinder',
      radius: radiusTop,
      length: positiveArg(args[2], 'cylinder length'),
    }
  }

  const name = propsOf(materialElement).name
  if (!isMaterialSlot(name)) {
    throw new Error(
      `kit render tree: a mesh material is missing its §4 slot name (got ${JSON.stringify(name)})`,
    )
  }

  return {
    geometry: shape,
    slot: name,
    position: tripleProp(props.position, 'mesh position'),
    rotation: tripleProp(props.rotation, 'mesh rotation'),
  }
}

/** Walk one node of a module's render tree, appending the meshes it draws. */
function walk(node: ReactNode, out: RenderedPart[]): void {
  for (const host of hostsOf(node)) {
    const type = host.type as string
    if (!KIT_HOSTS.has(type)) {
      throw new Error(`kit render tree: unexpected host element <${type}>`)
    }
    if (type === 'group') {
      walk(propsOf(host).children as ReactNode, out)
      continue
    }
    if (type === 'mesh') {
      out.push(meshOf(host))
      continue
    }
    throw new Error(`kit render tree: <${type}> must be a child of a <mesh>`)
  }
}

/** Every mesh a module's render tree draws, in order. */
export function collectRenderedParts(node: ReactNode): RenderedPart[] {
  const out: RenderedPart[] = []
  walk(node, out)
  return out
}

/** The render items a part list MUST produce (the KitParts contract). */
export function expectedRenderedParts(parts: readonly KitPart[]): RenderedPart[] {
  return parts.map((part) =>
    part.kind === 'box'
      ? {
          geometry: { kind: 'box', size: [...part.size] as Vec3 },
          slot: part.materialSlot,
          position: [...part.position] as Vec3,
          rotation: boxEuler(part.rotation ?? 0),
        }
      : {
          geometry: { kind: 'cylinder', radius: part.radius, length: part.length },
          slot: part.materialSlot,
          position: [...part.position] as Vec3,
          rotation: cylinderEuler(part.axis),
        },
  )
}

/** Numeric slack when comparing rendered transforms (float noise, not drift). */
const EPS = 1e-9

/** True when two rendered parts describe the same mesh. */
export function renderedPartsEqual(a: RenderedPart, b: RenderedPart): boolean {
  if (a.slot !== b.slot || a.geometry.kind !== b.geometry.kind) return false
  if (a.geometry.kind === 'box' && b.geometry.kind === 'box') {
    if (!sameTriple(a.geometry.size, b.geometry.size)) return false
  } else if (a.geometry.kind === 'cylinder' && b.geometry.kind === 'cylinder') {
    if (
      Math.abs(a.geometry.radius - b.geometry.radius) > EPS ||
      Math.abs(a.geometry.length - b.geometry.length) > EPS
    ) {
      return false
    }
  }
  return sameTriple(a.position, b.position) && sameTriple(a.rotation, b.rotation)
}

/** Component-wise triple equality within `EPS`. */
function sameTriple(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) <= EPS &&
    Math.abs(a[1] - b[1]) <= EPS &&
    Math.abs(a[2] - b[2]) <= EPS
  )
}

/** Readable one-line description of a rendered part (harness error messages). */
export function describeRenderedPart(part: RenderedPart): string {
  const geometry =
    part.geometry.kind === 'box'
      ? `box ${part.geometry.size.join('×')} m`
      : `cylinder r${part.geometry.radius} l${part.geometry.length} m`
  return `${geometry} @ ${part.position.join(',')} [${part.slot}]`
}
