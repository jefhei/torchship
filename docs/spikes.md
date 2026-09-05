# M0 Spike Verdicts

Time-boxed experiments from BUILD_PLAN M0. Each spike records: hypothesis, what was built,
verdict (proven / pivoted), and the decision that carries into the real build.

| Spike | Task | Verdict | Date | Decision carried forward |
|-------|------|---------|------|--------------------------|
| Wayfinding (can a player find the bridge?) | M0-T1 | _pending — human-held (visual)_ | | Run interactively; record here |
| Module seams / hatch alignment tolerances | M0-T2 | **proven** | 2026-09-05 | Door sockets are the ONLY join interface; seams measured 0.000 mm; [auto] tolerances fixed: watertight < 2 mm, hatch ≤ 5 mm, kit socket-authoring budget ±0.5 mm, standard door center 1.0 m. Spec offsets ≥ 10 mm and non-standard door centers are validator rejections (see entry below) |
| Practical lighting reference (galley) | M0-T3 | _pending — human-held (visual)_ | | Run interactively; record here |
| Ladder-climb state machine | M0-T4 | _pending — human-held (feel)_ | | Run interactively; record here |

> NOTE: spikes 1, 3 and 4 are inherently visual/feel — they need a browser walkthrough, not
> just CI. The build cron SKIPS them (leaves them unchecked, records no verdict) until an
> interactive session runs them; they block nothing.

---

## M0-T2 — Seam & hatch-alignment tolerances (measured 2026-09-05, headless)

**Hypothesis (PRD §11 risk 2):** a 2 mm gap or misaligned door socket = visible light leak,
clipped walk, or an unreachable deck. The fallback rule "standardize on one door-socket origin
per module and generate mating geometry from sockets (never freehand)" can be validated and the
[auto] invariant tolerances fixed from real measured numbers before any M2 art is authored.

**What was built** (`src/spikes/seams/`, pure spec-space math — no WebGL):
- `kit.ts` — white-box stand-ins for all **six module types** (head, galley, ops, engineering,
  storage + spine deck band) with contract-level door sockets: dims from PRD §4 scale
  (3.0 m decks, 3.2 m pitch), standard door 0.9×2.0 m centered 1.0 m above the floor, sockets
  flush in their module faces. Engineering deliberately carries a **non-standard 1.2 m
  high-hatch** so the kit has a real authored deck-offset to measure.
- `measure.ts` — join measurement at a door-socket pair under two placement policies:
  `floorPinned` (module floor pinned to the deck plate — what a walkable ship must do) and
  `doorSolved` (transform solved so door centers coincide exactly). Reports seam gap (mm,
  along the mating normal), lateral + vertical hatch misalignment (mm), and floor step (mm).
- `stress.ts` — the stress spec + runs: exactness matrix (all module pairs), offset sweeps
  (δ ∈ {1, 2, 5, 10, 25} mm along normal/lateral/vertical × both policies × all 5 room types),
  seeded authoring-noise sweeps (ε ∈ {0.25, 0.5, 1.0} mm), and pathological joins.
- `tolerances.ts` — the **output contract**: the [auto] tolerance constants fixed below.
  M0-T6 / M1-T3 import these; they are not re-derived.

**Measured verdict** (13 vitest assertions pin every number; report card reproduced by running
`seamStress.test.ts`):
- **Socket-solved joins are exact**: 78 joins @ zero offset across all six types →
  max seam gap / lateral / vertical / floor step = **0.000000 mm**. The join math is never
  the error source.
- **Offset response is linear and axis-separated (slope 1.000, no amplification)**:
  normal δ → open seam of exactly δ (both policies); lateral δ → lateral misalignment of
  exactly δ; vertical δ → **swallowed by the floor pin** (door still mates the real socket —
  floor-pinned assembly is self-correcting for vertical spec drift) but under a door solve it
  becomes a δ door miss + δ floor step.
- **Authoring noise budget**: ±ε per axis at sockets (both sides) → mated-door seam is immune
  in-plane (0.000 mm — placement snaps the socket onto its target), door-center height noise
  ≤ 2ε (measured **0.692 mm @ ±0.5 mm**), and in-plane noise propagates rigidly to the
  module's far bulkhead face ≤ 2ε (measured **0.278 mm @ ±0.5 mm**) — the channel governing
  edge-to-edge bulkhead meets.
- **Pathological joins (the validator's reject set)**: 10 mm normal offset → 10 mm open seam;
  25 mm lateral → 25 mm misalignment; 25 mm vertical (door solve) → 25 mm miss + 25 mm floor
  step; engineering's 1.2 m high-hatch mated to a standard 1.0 m door → **200 mm step** (floor-
  pinned: at the door; door-solved: off the deck). All exceed both caps.

**Decision carried forward** (becomes M1-T3 spec-validator rules + M3-T2 assembler rule):
1. **Door sockets are the only join interface** — mating geometry is generated from sockets,
   never freehand. Standardized socket origin: flush in the module face, door center 1.0 m
   above the module floor (kit rule; non-standard doors must be declared, cf. DoorSocket
   deck-offset field).
2. **Fixed [auto] tolerances** (PRD §8, now from real numbers): seams watertight
   **gap < 2 mm**; hatch alignment **≤ 5 mm**; **kit socket authoring budget ±0.5 mm per
   axis** (its 2ε = 1.0 mm bounds give exactly 2× margin under the watertight cap and 5× under
   the hatch cap; at ε = 1.0 mm the bound equals the cap with zero headroom — 0.5 mm is the
   ceiling).
3. **Validator rejects**: any spec join whose resolved residual ≥ caps (offsets ≥ 10 mm
   measured), and any mating pair whose door-center heights disagree beyond tolerance — the
   negative cases the M0-T5(d) pathological offset-hatch fixture will carry.
4. Assembler places modules **floor-pinned** (floors on the deck plate, under-burn gravity),
   deriving XZ from sockets; vertical socket drift then self-corrects and only authored
   door-height inconsistencies surface as hatch misalignment — which the kit scanner
   (`nonStandardDoors()`) flags at authoring time.
