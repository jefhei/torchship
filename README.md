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
```

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

## Status

Tracked in `.hermes/status.json` (read FIRST) and `.task-progress.json`; both update after every
BUILD_PLAN task. Ship name locked at build start (rule 9): **Hound-class light corvette *Firebrand*** —
goes into the Ship Spec `name` field (M1-T2) and the share URL (M6).
