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
the decks were drawn one mesh per part (736 calls on Patrol); now Patrol draws **179 calls for 736
parts**, Vagabond 213, Surveyor 181, the QA rig 194 — all under the PRD §10 ceiling of **250**
(`DRAW_CALL_CEILING`, `src/assembler/drawCalls.ts`). `drawCallTally()` / `drawCallProblems()` are
the report surface, the ceiling is checked by the assembler gate (rule 12), and the numbers above
are pinned on every deck of all four ships in `src/assembler/drawCalls.test.ts` +
`src/player/deckGeometry.test.ts` (which also proves each instanced mould + placement reproduces
its world part, so the swap cannot move geometry). The `minInstances` assembler option is the one
knob that trades calls for instancing.

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
(Patrol 736 parts / 179 calls shaded from theme `firebrand`).

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

## Status

Tracked in `.hermes/status.json` (read FIRST) and `.task-progress.json`; both update after every
BUILD_PLAN task. Ship name locked at build start (rule 9): **Hound-class light corvette *Firebrand*** —
goes into the Ship Spec `name` field (M1-T2) and the share URL (M6).
