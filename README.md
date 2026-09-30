# Torchship

A walkable interior of an ex-navy fusion-torch corvette — Roci-inspired, original design.
First-person walkthrough under thrust gravity: decks stacked along the thrust axis, practical-only
lighting, worn and lived-in. Built with Vite + TypeScript + React 19 + React Three Fiber.

See `PRD.md` for requirements and `BUILD_PLAN.md` for the task plan (M0 spike & fixtures →
M1 contracts → M2 module kit → M3 assembler & vertical nav → M4 lighting → M5 review loops →
M6 export & launch).

## Dev

```bash
npm install
npm run dev          # Vite dev server
npm run verify       # the machine gate: lint + format:check + typecheck + test + build
npm run check:slots  # material-slot completeness gate (also runs first in `npm run build`)
npm run check:kit    # kit harness (M2 machine gate) — see "Kit harness" below
```

## Kit harness

`src/kit/harness/` is the M2 machine gate as executable data. `runKitHarness()` reports, per
authored module: manifest/authoring integrity, the contract diff against the fixture-time kit
(door sockets with per-axis millimetre residuals), every §4 slot the geometry draws resolving in
the ship's theme, and — walking the module's own render tree, pinned against a real react-dom
render of the same components — one mesh per part with the geometry, slot and transform the part
list describes. `npm run check:kit` runs it; `assertKitHarnessClean()` is the throwing form.
`StandaloneModuleScene` renders one module alone (the harness's composition surface).

CI (`.github/workflows/ci.yml`) runs the machine gate on every push to `main` and every pull
request — lint/format/typecheck/material-slots, then vitest, then the Vite build. An unassigned
material slot fails the build (PRD §7): the §4 slot vocabulary lives in `src/types/materials.ts`,
the theme registry and its completeness gate in `src/materials/`.

> The workflow is checked in at **`ci/github-actions-ci.yml`**, not `.github/workflows/ci.yml`:
> GitHub rejects any push that creates `.github/workflows/*` unless the credential carries the
> `workflow` permission, and this machine's token is a classic `repo`-scope PAT (see
> `~/notes/github-token-strategy.md`). Activate it with
> `git mv ci/github-actions-ci.yml .github/workflows/ci.yml` from a workflow-scoped credential.
> Until then CI does not run and `npm run verify` is the gate.

## Seams (M3-T2)

Every joint's mating geometry is generated from the door sockets themselves — never freehand
(`src/assembler/seams.ts`). A **sleeve** (the contact annulus between two mating wall faces,
extruded across the seam) seals each join; a **plug** (cut from the socket's opening, lapped onto
the wall and measured against the wall it sits in) closes every blanked socket a module does not
already hatch. The pass measures itself — gap against the 2 mm watertight cap, coverage of the
annulus, bite past both wall planes, and a clear pass-through — and that measurement is the PRD §8
bullet 1 `[auto]` invariant (`seams-watertight`, live at M3-T2 in the M0-T6 harness via
`checkSeamsWatertight`). `seamTally()` / `seamsWatertightProblems()` are the report surface.

## Draw calls (M3-T7)

The deck geometry partition the assembler emits (`groups` = merged per-slot geometry, `batches` =
instanced moulds) is exactly the draw-call plan: `src/player/deckGeometry.ts` builds ONE merged
`BufferGeometry` per group and ONE mould + placements per batch, and `ShipInterior`
(`src/player/WalkthroughScene.tsx`) mounts one mesh / one `InstancedMesh` for each. Before M3-T7
the decks were drawn one mesh per part (736 calls on Patrol); now Patrol draws **186 calls for 772
parts** (the M4-T4 worn detail included), Vagabond 221, Surveyor 185, the QA rig 204 — all under the
PRD §10 ceiling of **250** (`DRAW_CALL_CEILING`, `src/assembler/drawCalls.ts`). `drawCallTally()` /
`drawCallProblems()` are the report surface, the ceiling is checked by the assembler gate (rule 12),
and the numbers above are pinned on every deck of all four ships in
`src/assembler/drawCalls.test.ts` + `src/player/deckGeometry.test.ts` (which also proves each
instanced mould + placement reproduces its world part, so the swap cannot move geometry). The
`minInstances` assembler option is the one knob that trades calls for instancing; `wearDensity:
'off'` is the other, and it reproduces the pre-M4-T4 numbers (Patrol 736 parts / 179 calls).

## Material sets (M4-T1)

`src/materials/pbr.ts` authors the **nine PBR sets** — one per §4 slot — that the theme's slot
payloads resolve to: diamond-pattern deck plate, brushed/scuffed painted steel, copper-and-rust
pipe runs, recessed practical-light lenses, glass/acrylic screens, worn hazard striping, ceramic
heat shielding, canvas webbing, and the single warm accent reserved for the coffee station. A set
carries exactly what `meshStandardMaterial` spends (base albedo, metalness, roughness, plus an
emissive tint + strength for the light slots); worn-ness lives in `roughness`, bounded by
`PBR_MIN_ROUGHNESS` ("no gloss", PRD §4) and `PBR_EMISSIVE_INTENSITY_MAX` ("no blown-out panels").
The gates now check resolution as well as assignment: `themeProblems` fails the build on a set id
the registry does not know or one declared for another slot, and `npm run check:slots` asserts the
registry covers every slot exactly once. `src/kit/render/slotSurfaces.ts` is the slot → shading
bridge (theme-driven, no colour left in the kit) and `materialSetReport(ship)` reports per-slot
parts + draw calls for an assembled ship. Measured: all four canonical ships draw **9/9 slots**
(Patrol 772 parts / 186 calls shaded from theme `firebrand`).

## Practical lighting (M4-T2)

PRD §4 allows **no sun and no sky**: every lumen comes from a panel, a task strip, a screen or the
reactor. `src/lighting/archetypes.ts` authors exactly those four `LightKind` recipes — and they are
physical, not taste. Each names the §4 lens slot the fixture is *drawn* with, so a light's colour
IS that lens's emissive tint (resolved through the M4-T1 bridge: re-skin the panel lens and the
ship re-lights; an inert lens is refused); a designed throw, a target illuminance, and an intensity
**derived as `target × throw²`** in candela (three.js is physically correct, decay 2); a reach
bounded below by the throw and above by `MAX_LIGHT_RANGE_M`; and a shadow request only on task
lights (PRD §11 "small shadow maps only for task lights that matter"). `src/lighting/rig.ts` then
mounts **one fixture per authored light socket** of an assembled ship, in world space through the
same transform the geometry went through — nothing is hand-placed. The frame budget is a forward
renderer's: the rig is **deck-scoped** (`LIGHTS_ACTIVE_MAX` = 12 mounted at once, an over-budget
deck keeping landmarks and work lights before ceiling fill), and `lightRigReport(ship).activeMax`
is the number the M4 gate reads. Measured: Patrol **43 fixtures** (28 panel + 6 task + 8 screen +
1 reactor) over 5 decks, 10 mounted at once, 5 shadow-casting; Vagabond 51, Surveyor 44. The one
fill is warm and dim (`#4a443c` @ 0.28) and capped, so it can never flatten the interior.

## Worn detail (M4-T4)

`src/wear/` is the pass that makes the ship read as *lived in* (PRD §4 mood, §6 seed control):
**paint patches**, **cable routing** and **floor clutter**, authored once in `recipes.ts` as a small
vocabulary and GENERATED per ship from `ShipSpec.seed` (mulberry32 + an FNV-1a stream per deck /
module / facet — the same seed always yields the same ship, a different seed a different one).
Nothing is freehand (rule 8): a patch is painted on a `bulkhead` panel the module already draws, a
cable drops from one of the module's own light sockets down a wall it already has, and a prop rests
on the deck plate against that wall — `mounts.ts` derives every surface from the module instance,
and `checks.ts` RE-MEASURES the emitted world geometry (mounted/touching, inside its module, clear
of foreign kit + seam geometry and of every doorway's keep-clear zone, solid, and under the M3-T4
walk-over step so clutter is stepped over rather than walling the ship off). It draws only the nine
§4 slots and never the reserved `coffee-accent`. The gate (`wearProblems`) rides the assembler as
**rule 13** and is empty on all four canonical ships. Density is PRD §10's fourth degradation rung
(`AssembleOptions.wearDensity`: `full` → `reduced` → `off`, the last being the pre-M4-T4 ship and
the baseline the pass's cost is measured against): Patrol's 29 plans / 36 parts cost **7 draw
calls** (186 with the pass, 179 without; per-deck ≤ the 8-call budget), and `wearReport(ship)` prints
the whole ledger.

## Wayfinding UX (M5-T1)

`src/wayfinding/` is the deck/wayfinding UX (BUILD_PLAN M5-T1, PRD §8's "deck-order logic is
legible" / §11 risk 1 — a metal interior that reads as sameness). Three pieces, all DOM over the
canvas (never three objects), all derived from the assembly so a sign can never drift from the ship:

- **Per-deck label moments** (`moments.ts`) — the sign raised on a deck transition (the first report
  of a session, a climb arrival, a fall): `DECK 1 · Crew deck`, the deck's own spec label, what is
  aboard it (the modules' own kit-manifest labels) and how you got there, in the ship's own
  direction — decks descend nose → aft in index and Y, so a LOWER index is **up** under burn
  (`up the ladder from Ops deck — toward the bow`). It holds `MOMENT_HOLD_MS` (4 s) and clears.
- **Optional deck indicator** (`indicator.ts`) — the whole ship as one stack, bow at the top, the
  walker's deck flagged, and ladder marks (▲/▼) taken from **M3-T5's own run list**, so no row
  promises a climb the ship cannot make. Toggled with **`I`** (`INDICATOR_TOGGLE_KEY`) — optional by
  key, on by default.
- **Hatch affordances** (`affordances.ts`) — the prompt names the hatch in reach *and what E will
  do* (`E — open the spine hatch` / `E — close the spine hatch`), from the hatch's own record and
  the new `hatchPromptOpen` field the rig reports (`NavStep.hatchPromptOpen`, `WalkReport`). The
  reach test stays `hatchInReach` — the one the state machine uses — so the prompt can never name a
  hatch E would not act on.

`wayfindingProblems(ship, world)` (`checks.ts`) is the product gate — every deck has a name and a
room to name, the stack covers every deck in ship order with exactly one current row, every ladder
mark is backed by a run, and every hatch has a unique id and the right verb for its state. It is
empty on all four canonical ships (the QA rig's defects are geometry, never wayfinding) and is NOT a
§8 verdict (the M4-T2/T4 precedent).

## Status

Tracked in `.hermes/status.json` (read FIRST) and `.task-progress.json`; both update after every
BUILD_PLAN task. Ship name locked at build start (rule 9): **Hound-class light corvette *Firebrand*** —
goes into the Ship Spec `name` field (M1-T2) and the share URL (M6).
