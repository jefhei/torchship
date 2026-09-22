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

---

## M3-T5 — provisional ladder tuning, awaiting the M0-T4 spike (2026-09-22)

> Not a verdict. The M0-T4 row above stays **pending — human-held (feel)**: the build cron
> does not run it and records nothing for it. This section exists so the interactive session
> that eventually runs M0-T4 knows exactly which numbers to retune and which ones are
> measured and must not be moved.

**Measured (do NOT retune — derived from the assembled ship, in `src/player/ladder.ts`):** the
run a band carries (rungs = the band's X-moulded cylinders: ten on a 0.3 m pitch, first at
0.3 m; rails = the storey-tall Y cylinders on the rung line), rung half-depth **0.018 m**,
ladder half-span **0.225 m**, the lane **`rungHalfDepth + PLAYER_RADIUS + 0.005 = 0.273 m`**
off the rung line (where the capsule really rests against the rungs — 0 heal fixes, plate
support equal to the deck floor), the rest-snap radius **half a rung pitch (0.15 m)**, and the
run's two landings (band *i* climbs deck *i* → deck *i−1*). The climbing **eye** travels the
0.7 m crawl opening's clear column with **0.077 m** to spare off the plate frame — it is a
point-lane slide and must stay one.

**Tuning set (the M0-T4 retune targets, all exported constants in `src/player/ladder.ts`):**

| Constant | Value | What the spike judges |
|---|---|---|
| `CLIMB_SPEED_M_S` | 1.4 m/s | climb pace — a 3.2 m storey takes 2.3 s |
| `CLIMB_SPRINT_SPEED_M_S` | 2.0 m/s | Shift; deliberately under the 2.2 m/s walk |
| `CLIMB_SIDE_SPEED_M_S` | 0.9 m/s | A/D slide along the rungs |
| `MOUNT_FACING_DOT` | 0.5 (≈60°) | how squarely you must look at the ladder to grab it |
| `MOUNT_LANE_TOLERANCE_M` | 0.05 m | how far off the lane a grab still takes (the grab snap) |
| `MOUNT_SPAN_SLACK_M` | 0.1 m | lateral slack past the ladder's own width |
| `NAV_EYE_CLEARANCE_M` | 0.05 m | the eye-clearance floor `navigationProblems` holds (measured margin 0.077 m) |

**Transitions the spike is really about (feel):** W = up / S = down with the mount decided
before the walk step (so S at a landing means "the ladder goes down from here"); arrival only
at the two landings a run connects, and once (a transition, not a per-frame re-report); rest
snapping onto a rung; the E hatch interaction reached from the lane with the facing test
waived within **0.5 m** (`HATCH_FACING_WAIVE_M`) so a climber can work the hatch on the deck
they just arrived at without turning round. Retune feel here; keep the measured geometry, the
0.9 m door corridor and the crawl-opening clearance untouched (those are invariant-checked).
