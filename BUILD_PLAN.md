# Build Plan: Torchship — Walkable Ex-Navy Fusion-Torch Corvette Interior

A first-person walkthrough of a cramped, lived-in, Roci-inspired corvette interior — original design, decks stacked along the thrust axis, practical-only lighting, under-burn gravity. See `PRD.md` for full requirements.

> **How to use this template.** Blockquoted notes are guidance — delete them as you go. `[brackets]` are placeholders. The structural choices that matter most for 3D-world projects are marked **★**: Milestone 0, the two-column acceptance table, the split verification gate, and the review-loop artifact.

- **Stack:** `Vite + TS + React + R3F + drei + postprocessing + three 0.1xx`
- **Runtime:** client-only (no backend, no inference)
- **Progress trackers:** `.hermes/status.json (read FIRST) + .task-progress.json` — update BOTH after every task.
- **Commit convention:** `feat: <task-id> — <description>` for the task, then a separate `chore: <task-id> — tracker update` commit. Push after each task.

## Two Acceptance Regimes ★

> Every exit criterion below belongs to exactly one column. Never let a human-verifiable criterion masquerade as a build gate.

- **Machine gate** — build/lint/test green; `[auto]` invariants pass (seam watertightness, hatch alignment, spine connectivity, collision match, spawn-inside, no spec-dark rooms). Checkable in CI, per task.
- **Human review** — worn-and-warm mood, wayfinding, ladder feel, landmark presence, defect log. Checked against the three canonical ships via the Review Loop (see end). Runs at milestone boundaries, not every task.

---

## M0 — Spike & Fixtures ★ (day 0–1)

> **Do this before scheduling anything else.** The four PRD §11 risks get time-boxed spikes here, and the canonical test ships get checked in — every later stage runs against them.

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M0-T1 | Spike 1 (wayfinding): assemble 3 rough white-box decks, walk them, record whether a player can find the bridge — **human-held (visual)** | M1-T1 | `0.5d` |
| [ ] M0-T2 | Spike 2 (seams): join all 6 module types in a stress spec with offsets; measure seam gaps + socket misalignment; fix [auto] tolerances from real numbers | M1-T1 | `0.5d` |
| [ ] M0-T3 | Spike 3 (lighting): light one fully-kitted module (galley) to the §4 mood as the lighting reference for all modules — **human-held (visual)** | M1-T1 | `0.5d` |
| [ ] M0-T4 | Spike 4 (ladder climb): prototype ladder/hatch state machine on a 2-deck whitebox; tune speed/step/hatch transitions — **human-held (feel)** | M1-T1 | `0.5d` |
| [ ] M0-T5 | Define canonical test ships & check them in: (a) Patrol 5-deck, (b) Long-Haul stretch, (c) Science retrofit, (d) pathological offset-hatch stress spec | M1-T2 | `0.5d` |
| [ ] M0-T6 | Stub `[auto]` invariant checks (PRD §8) as runnable tests against the fixtures | M0-T5 | `0.5d` |

> **Execution note:** M1-T1 (scaffold) has NO dependency — it runs first so spikes and fixtures have an app to live in. Spikes M0-T1 / M0-T3 / M0-T4 are **human-held**: they need visual/feel judgment (a browser walkthrough), so the daily build cron SKIPS them — leaves them unchecked, records no verdict — until an interactive session runs them. They do NOT block M1+ (nothing depends on them). M0-T2 (seam measurements), M0-T5 (fixtures) and M0-T6 (invariant stubs) are headless-completable by the cron.

**Machine gate:** spike verdicts recorded; fixtures load; invariant test harness runs (may fail — that's fine, they're targets).
**Human review:** n/a (human-held spikes T1/T3/T4 are run interactively and their verdicts recorded in `docs/spikes.md`).
**Exit:** riskiest bet is proven or the plan is pivoted around it; three test worlds exist in the repo.

## M1 — Foundation & Data Contracts (days 1–3)

> Nail the schemas from PRD §7 here as typed interfaces. The contracts are what make the module kit and the assembler independently buildable.

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M1-T1 | Scaffold app (Vite + TS + R3F); app boots with an empty viewport | — | `0.5d` |
| [ ] M1-T2 | Define data-contract types in `src/types/`: `ShipSpec`, `ModuleRef`, `DoorSocket`, module-kit manifest, scene graph, material slots | M1-T1 | `1d` |
| [ ] M1-T3 | Ship Spec validator (schema check, socket alignment, spine connectivity graph) + preset JSON for the four fixtures | M1-T2 | `1d` |
| [ ] M1-T4 | Lint/format/build CI + vitest runner; material-slot completeness check (unassigned slot = failed build) | M1-T1 | `0.5d` |

**Machine gate:** app boots; contract types compile; spec validator passes on all four fixtures; CI green.
**Human review:** n/a.

## M2 — Module Kit Authoring (days 3–7)

> The heart of the art direction: build each room type once from kit primitives to the §4 mood. Everything downstream is assembly and lighting. Reference board lives in `docs/reference/`.

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M2-T1 | Kit primitives: bulkhead, deck plate w/ cable runs, conduit, panel light, hatch, ladder segments, equipment props (lockers, screens, couches, table, coffee station) | M1 | `1.5d` |
| [ ] M2-T2 | Author **head** module (bridge: crash couches, sensor wall, consoles) | M2-T1 | `0.5d` |
| [ ] M2-T3 | Author **galley/bunk** module (table + coffee station landmark, bunks, head) | M2-T1 | `0.5d` |
| [ ] M2-T4 | Author **ops** module (airlock + suit locker, workbench, med bay bay) | M2-T1 | `0.5d` |
| [ ] M2-T5 | Author **engineering** module (reactor access, drive glow window, radiation striping) + **storage** module (long-haul variant) | M2-T1 | `0.5d` |
| [ ] M2-T6 | Author **spine** module (vertical ladder/crawl shaft with per-deck door sockets) | M2-T1 | `0.5d` |
| [ ] M2-T7 | Kit test harness: each module renders standalone, material slots fully assigned, door sockets at spec'd origins | M2-T2..T6 | `0.5d` |

**Machine gate:** every module compiles, renders in harness, fills all material slots; socket origins match the contract.
**Human review:** modules match the §4 mood and reference board (galley must read as the crew's heart).

## M3 — Assembler & Vertical Navigation (days 7–10)

> Ship Spec → scene graph. This is where the closed-world invariants get won or lost. Test against ALL four fixtures.

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M3-T1 | Assembler: stack decks from spec, join modules at door sockets, generate spine run; emit merged per-deck geometry + instanced kit batches | M2 | `1.5d` |
| [ ] M3-T2 | Seam/hatch enforcement: mating geometry generated from sockets (never freehand); [auto] watertight + alignment checks wired into the assembler | M3-T1 | `0.5d` |
| [ ] M3-T3 | Collision hulls per deck (from module collision hints) | M3-T1 | `0.5d` |
| [ ] M3-T4 | First-person rig + under-burn gravity (down = toward drive; port PlanWalker movement pattern) | M3-T1 | `0.5d` |
| [ ] M3-T5 | Ladder-climb state machine + hatch traversal between decks (from M0-T4 spike) | M3-T4 | `1d` |
| [ ] M3-T6 | Spawn selection: crew deck foot of spine; spawn-inside invariant | M3-T4 | `0.5d` |
| [ ] M3-T7 | Draw-call pass: geometry merging + instancing to ≤ 250 calls on Patrol | M3-T1 | `0.5d` |

**Machine gate:** `[auto]` invariants (seams, hatches, spine connectivity, collision-matches-geometry, spawn-inside) pass on all four ships; draw calls under ceiling.
**Human review:** a scripted walk of the Patrol ship: no clipping, ladder feels right, no camera escape, wayfinding holds (can find the bridge).

## M4 — Materials, Lighting & Atmosphere (days 10–12)

> Practical-only lighting: every lumen from panels, task lights, screens, reactor glow — no sun. The M0-T3 galley lighting reference governs every module.

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M4-T1 | PBR material sets for every §4 slot across all modules | M3 | `0.5d` |
| [ ] M4-T2 | Practical light rig: panel/task/screen/reactor light archetypes; per-module light placement from light sockets | M3 | `1d` |
| [ ] M4-T3 | Post-processing within frame budget (subtle bloom; SSAO only if budget allows) | M4-T1 | `0.5d` |
| [ ] M4-T4 | Worn-detail pass: clutter, paint patches, cable routing variation by seed | M4-T2 | `0.5d` |

**Machine gate:** frame budget met on Patrol; no spec-dark rooms; no material-slot gaps.
**Human review:** matches the §4 mood board; galley warm, engineering hot/threatening, no flat or murky rooms, no blown-out panels.

## M5 — Walkthrough Polish & Review Loops (days 12–13)

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M5-T1 | Deck/wayfinding UX: per-deck label moments, hatch affordances, optional deck indicator | M4 | `0.5d` |
| [ ] M5-T2 | Scripted walk recorder (coffee-run path) for repeatable review walks | M4 | `0.5d` |
| [ ] M5-T3 | Full Review Loop pass on all four ships (see below) | M5-T2 | `0.5d` |
| [ ] M5-T4 | Fix loop until exit rule met (zero sev-1; ≤ 5 sev-2) | M5-T3 | `1d` |

**Machine gate:** unchanged invariants stay green; scripted walks complete without clipping.
**Human review:** Review Loop exit rule met (§13 PRD hallway tests run: fresh player finds the bridge first try).

## M6 — Export, QA & Launch (days 13–14)

| Task | Description | Depends On | Est. |
|------|-------------|------------|------|
| [ ] M6-T1 | glTF export of full interior per export contract (deck groups, named materials, meters, Y-up) | M5 | `0.5d` |
| [ ] M6-T2 | Validate export in Blender (materials intact, deck groups present, no flipped normals) | M6-T1 | `0.5d` |
| [ ] M6-T3 | Shareable URL (spec + seed) + localStorage autosave | M4 | `0.5d` |
| [ ] M6-T4 | Deploy demo + README with screenshots (three presets, coffee run gif) | M6-T2 | `0.5d` |

**Machine gate:** export loads with materials intact; all `[auto]` invariants pass.
**Human review:** Review Loop exit rule met on the deployed demo.

---

## Execution Rules

1. Read `.hermes/status.json` AND this file at session start.
2. Resolve the next task by **dependency order**, not visual order.
3. Read ALL existing source in `src/` before writing new code.
4. Implement properly — working code, not stubs. Extend tests: spec validation, seam/hatch geometry, invariants, ladder state machine, collision.
5. Run every stage against the **canonical test ships** from M0, not ad-hoc scenes.
6. Update both trackers after every task; commit trackers as their own `chore:` commit.
7. When a task splits into independent modules (kit authoring, lighting, nav), the **data contract is the interface** — build modules against the contract, integrate, then run the Review Loop.
8. Never freehand mating geometry — door sockets are the only join interface (M3-T2 rule).
9. The ship needs a name before launch (M6). Pick one when the build starts; it goes in the Ship Spec `name` field and the share URL.

## Verification Gate — per task ★

**Machine gate (every task, blocks commit):**
- [ ] Code implemented + tests added/updated
- [ ] `[auto]` invariants relevant to this task pass on all four fixtures
- [ ] `npm run lint` clean
- [ ] `npm run build` green
- [ ] `npm run test` green
- [ ] Trackers updated, committed, pushed

**Human review (milestone boundaries only):** run the Review Loop below.

## Review Loop — the artifact ★

> Not a vibe check. A repeatable, logged procedure. Referenced by PRD §14.

1. **Load** each canonical ship (M0) in walkthrough mode.
2. **Walk** the checklist:
   - Every `[review]` invariant (PRD §8).
   - Every §4 landmark present & recognizable (bridge, galley coffee station, airlock/suit locker, med bay, reactor room, spine).
   - The **coffee run**: crew deck → galley → coffee station → back, on every pass.
   - Lighting: no unlit rooms, no blown panels; mood matches the galley reference.
   - Movement: no clipping, no camera escape, ladder/hatch transitions smooth.
3. **Log** each defect: `{ severity: sev-1 (world-breaking) | sev-2 (cosmetic), ship, deck, location, repro }`.
4. **Fix**, then re-walk only the affected ships.
5. **Exit rule:** zero sev-1; ≤ 5 sev-2. Record the final log in `QA.md`.
