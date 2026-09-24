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

## Status

Tracked in `.hermes/status.json` (read FIRST) and `.task-progress.json`; both update after every
BUILD_PLAN task. Ship name locked at build start (rule 9): **Hound-class light corvette *Firebrand*** —
goes into the Ship Spec `name` field (M1-T2) and the share URL (M6).
