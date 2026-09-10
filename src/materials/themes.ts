/**
 * M1-T4 — the authored material theme registry.
 *
 * One entry per material theme. The canonical `firebrand` theme is the ship's
 * standard §4 surface set; the registry is the input to the completeness gate
 * (`assertThemesComplete`, run by `npm run build` + CI) and, later, the source
 * the M6 export maps to named glTF materials.
 *
 * Slot payloads are `MaterialSlotSpec` — interim ids M4-T1 resolves to real PBR
 * sets. Swapping a set id here is the whole edit; nothing else re-derives.
 */

import type { MaterialTheme, MaterialSlotSpec } from './theme.ts'
import type { MaterialSlots } from '../types/materials.ts'

/** Id of the ship's standard theme (Hound-class "Firebrand", BUILD_PLAN rule 9). */
export const DEFAULT_THEME_ID = 'firebrand'

/**
 * Set ids, per §4 material vocabulary. Named once so M4-T1 can author exactly
 * these sets and M2 modules can reference the slots, never the raw ids.
 */
const FIREBRAND_SETS: MaterialSlots<MaterialSlotSpec> = {
  deckplate: { set: 'deckplate-diamond-cable-runs' },
  bulkhead: { set: 'bulkhead-painted-steel-scuffed' },
  conduit: { set: 'conduit-exposed-pipe-run' },
  'panel-light': { set: 'panel-light-recessed' },
  screen: { set: 'screen-glass-emissive' },
  hazard: { set: 'hazard-striping-worn' },
  ceramic: { set: 'ceramic-heat-shield-drive' },
  webbing: { set: 'webbing-canvas-strap' },
  'coffee-accent': { set: 'coffee-accent-warm' },
}

/** Every material theme the build knows about (the completeness gate's input). */
export const MATERIAL_THEMES: readonly MaterialTheme[] = [
  {
    id: DEFAULT_THEME_ID,
    label: 'Firebrand standard',
    slots: FIREBRAND_SETS,
  },
]

/** Look a theme up by id; throws when the id is unknown (typos fail loudly). */
export function getMaterialTheme(id: string): MaterialTheme {
  const theme = MATERIAL_THEMES.find((candidate) => candidate.id === id)
  if (theme === undefined) {
    const known = MATERIAL_THEMES.map((candidate) => candidate.id).join(', ')
    throw new Error(`unknown material theme '${id}' (known themes: ${known})`)
  }
  return theme
}
