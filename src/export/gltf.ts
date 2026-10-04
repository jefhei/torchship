/**
 * M6-T1 — the glTF exporter (BUILD_PLAN M6-T1: "glTF export of full interior
 * per export contract … validated by loading in Blender (§13)").
 *
 * `exportGltf(assembly)` serialises an assembled ship to a glTF 2.0 document
 * (JSON + an embedded base64 buffer) with three.js's own `GLTFExporter`, run on
 * the scene `src/export/scene.ts` builds from the M3-T7 draw plan. The
 * exporter's job here is confined to that serialisation — the scene already
 * carries the contract (deck groups `deck-0..N`, one named material per §4
 * slot, meters, thrust axis = −Y); this module adds the self-documentation
 * (`asset.extras`) and the file naming, then hands back the document.
 *
 * NO WEBGL, NO DEV SERVER: three's exporter is CPU-side for geometry with no
 * textures (the project authors no texture maps), so this runs under jsdom in
 * the test suite exactly as it runs in the browser — the "validated export"
 * claim is checked headlessly by `src/export/contract.ts`.
 *
 * The current build emits JSON glTF (`.gltf`, embedded buffer). A `.glb` would
 * be `{ binary: true }`; it is not needed by the contract and the JSON form
 * keeps the buffer inspectable in the QA/Blender step (M6-T2).
 */

import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { ShipAssembly } from '../assembler'
import type { MaterialTheme } from '../materials/theme'
import { EXPORT_DOCUMENTATION } from './contract'
import type { GltfDocument } from './contract'
import { buildExportScene, disposeExportScene, exportSceneName } from './scene'

export interface ExportGltfOptions {
  /** Theme whose surfaces the named materials carry (default: standard). */
  theme?: MaterialTheme
}

/**
 * Serialise an assembled ship to a glTF 2.0 document. The returned document's
 * `asset.extras` carry the export contract (units / upAxis / thrustAxis), so it
 * passes `exportProblems` for this assembly.
 */
export async function exportGltf(
  assembly: ShipAssembly,
  options: ExportGltfOptions = {},
): Promise<GltfDocument> {
  const built = buildExportScene(assembly, options.theme)
  try {
    const exporter = new GLTFExporter()
    const gltf = (await exporter.parseAsync(built.scene, {
      binary: false,
      // Explicit TRS keeps the deck groups readable (translation, not a matrix)
      // — the contract check reads their floor Y off `node.translation`.
      trs: true,
    })) as unknown as GltfDocument

    gltf.asset.extras = { ...EXPORT_DOCUMENTATION }
    const sceneName = exportSceneName(assembly.spec.name)
    if (gltf.scenes?.[0] !== undefined) gltf.scenes[0].name = sceneName
    return gltf
  } finally {
    disposeExportScene(built)
  }
}

/** The document as a JSON string (pretty by default — inspectable diffs). */
export function toGltfJson(gltf: GltfDocument, pretty = true): string {
  return pretty ? JSON.stringify(gltf, null, 2) : JSON.stringify(gltf)
}

/** Slugify a ship name for a file name (`Hound-class "Firebrand"` → `firebrand`). */
export function gltfFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug === '' ? 'torchship' : slug}.gltf`
}
