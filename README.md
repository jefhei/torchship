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
npm run dev      # Vite dev server
npm run verify   # lint + typecheck + test + build (the machine gate)
```

## Status

Tracked in `.hermes/status.json` (read FIRST) and `.task-progress.json`; both update after every
BUILD_PLAN task. Ship name: TBD by the crew (M6 — every Rocinante needs its name).
