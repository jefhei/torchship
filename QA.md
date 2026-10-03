# QA — Torchship Review Loop Log

> **Generated artifact — do not hand-edit.** Produced by the M5-T3 Review Loop
> (`src/review/loop.ts`, PRD §14). Regenerate with `npm run qa:review`; the loop’s
> golden test keeps this file in sync, so drift shows up in `git status`.
>
> Test scenes are the three M0 canonical ships + the stress spec (PRD §14) — never
> an ad-hoc scene. Exit rule (PRD §14): **zero sev-1; ≤ 5 sev-2** per shippable ship. The stress rig is the negative
> control: it must FAIL — a rig the loop signs off would mean the loop is not looking.

## Loop verdict — PASS

3/3 shippable ship(s) meet the exit rule; 1 negative control(s) rejected.

| Preset | Ship | Decks | sev-1 | sev-2 | Verdict |
| --- | --- | --- | --- | --- | --- |
| Patrol | Firebrand | 5 | 0 | 0 | ✅ met |
| Long-Haul | Vagabond | 6 | 0 | 0 | ✅ met |
| Science | Surveyor | 5 | 0 | 0 | ✅ met |
| Offset-hatch stress | Offspec | 5 | 23 | 1 | ✅ control detected (23 sev-1) |

## Patrol — "Firebrand" (fixture `patrol`)

✅ **exit rule met** — 0 sev-1 / 0 sev-2 (zero sev-1, ≤ 5 sev-2; cap sev-1 0).

| Checklist item | Source | Verdict | Detail |
| --- | --- | --- | --- |
| Ship Spec valid | PRD §7 / M1-T3 validator | ✅ pass | spec accepted — schema, socket alignment and spine connectivity clean |
| PRD §8 [auto] invariants | PRD §8 bullets 1–6 / M0-T6 harness | ✅ pass | 6/6 live [auto] invariant(s) pass |
| Assembled-ship integrity | PRD §7 scene graph / M3–M4 assembler gate | ✅ pass | assembled ship faithful — partition, seams, hull, draw calls and worn detail clean |
| Scripted walk (coffee run) | PRD §8 [review] 1 / §14 coffee run | ✅ pass | coffee run clean — 3 waypoints, 177 frames, 6.5 m, no clip, no escape, 0 worst depenetration |
| PRD §4 landmarks present | PRD §8 [review] 2 / §4 signature landmarks | ✅ pass | 6/6 §4 landmarks present |
| Practical lighting (no dark room) | PRD §8 [review] 3 (machine half) / M4-T2 rig | ✅ pass | no dark room, 10 of 12 fixtures on the worst deck |
| Post processing within budget | PRD §8 [review] 3 (machine half) / M4-T3 post plan | ✅ pass | post: subtle bloom (intensity 0.35 at threshold 0.120 — the gap between the lit ceiling 0.1 and the dimmest lens 0.141, mip-chain) + ambient occlusion on (64 draw calls of margin (§10) and 2 fixtures of light headroom on the worst deck); 186 of 250 draw calls and 10 of 12 fixtures on the worst deck; 3 full-screen passes |
| Deck-order legibility | PRD §8 [review] 4 / M5-T1 wayfinding gate | ✅ pass | 5 deck sign(s), 9 hatch affordance(s), 4 ladder mark(s) — legible |

### Defects

_No defects._

---

## Long-Haul — "Vagabond" (fixture `long-haul`)

✅ **exit rule met** — 0 sev-1 / 0 sev-2 (zero sev-1, ≤ 5 sev-2; cap sev-1 0).

| Checklist item | Source | Verdict | Detail |
| --- | --- | --- | --- |
| Ship Spec valid | PRD §7 / M1-T3 validator | ✅ pass | spec accepted — schema, socket alignment and spine connectivity clean |
| PRD §8 [auto] invariants | PRD §8 bullets 1–6 / M0-T6 harness | ✅ pass | 6/6 live [auto] invariant(s) pass |
| Assembled-ship integrity | PRD §7 scene graph / M3–M4 assembler gate | ✅ pass | assembled ship faithful — partition, seams, hull, draw calls and worn detail clean |
| Scripted walk (coffee run) | PRD §8 [review] 1 / §14 coffee run | ✅ pass | coffee run clean — 3 waypoints, 177 frames, 6.5 m, no clip, no escape, 0 worst depenetration |
| PRD §4 landmarks present | PRD §8 [review] 2 / §4 signature landmarks | ✅ pass | 6/6 §4 landmarks present |
| Practical lighting (no dark room) | PRD §8 [review] 3 (machine half) / M4-T2 rig | ✅ pass | no dark room, 10 of 12 fixtures on the worst deck |
| Post processing within budget | PRD §8 [review] 3 (machine half) / M4-T3 post plan | ✅ pass | post: subtle bloom (intensity 0.35 at threshold 0.120 — the gap between the lit ceiling 0.1 and the dimmest lens 0.141, mip-chain) + ambient occlusion on (29 draw calls of margin (§10) and 2 fixtures of light headroom on the worst deck); 221 of 250 draw calls and 10 of 12 fixtures on the worst deck; 3 full-screen passes |
| Deck-order legibility | PRD §8 [review] 4 / M5-T1 wayfinding gate | ✅ pass | 6 deck sign(s), 11 hatch affordance(s), 5 ladder mark(s) — legible |

### Defects

_No defects._

---

## Science — "Surveyor" (fixture `science`)

✅ **exit rule met** — 0 sev-1 / 0 sev-2 (zero sev-1, ≤ 5 sev-2; cap sev-1 0).

| Checklist item | Source | Verdict | Detail |
| --- | --- | --- | --- |
| Ship Spec valid | PRD §7 / M1-T3 validator | ✅ pass | spec accepted — schema, socket alignment and spine connectivity clean |
| PRD §8 [auto] invariants | PRD §8 bullets 1–6 / M0-T6 harness | ✅ pass | 6/6 live [auto] invariant(s) pass |
| Assembled-ship integrity | PRD §7 scene graph / M3–M4 assembler gate | ✅ pass | assembled ship faithful — partition, seams, hull, draw calls and worn detail clean |
| Scripted walk (coffee run) | PRD §8 [review] 1 / §14 coffee run | ✅ pass | coffee run clean — 3 waypoints, 177 frames, 6.5 m, no clip, no escape, 0 worst depenetration |
| PRD §4 landmarks present | PRD §8 [review] 2 / §4 signature landmarks | ✅ pass | 6/6 §4 landmarks present |
| Practical lighting (no dark room) | PRD §8 [review] 3 (machine half) / M4-T2 rig | ✅ pass | no dark room, 10 of 12 fixtures on the worst deck |
| Post processing within budget | PRD §8 [review] 3 (machine half) / M4-T3 post plan | ✅ pass | post: subtle bloom (intensity 0.35 at threshold 0.120 — the gap between the lit ceiling 0.1 and the dimmest lens 0.141, mip-chain) + ambient occlusion on (65 draw calls of margin (§10) and 2 fixtures of light headroom on the worst deck); 185 of 250 draw calls and 10 of 12 fixtures on the worst deck; 3 full-screen passes |
| Deck-order legibility | PRD §8 [review] 4 / M5-T1 wayfinding gate | ✅ pass | 5 deck sign(s), 9 hatch affordance(s), 4 ladder mark(s) — legible |

### Defects

_No defects._

---

## Offset-hatch stress — "Offspec" (fixture `stress`)

**negative control** — 23 sev-1 / 1 sev-2. This rig is not a shippable ship: it must fail, and the loop detected its seeded defects ✅.

| Checklist item | Source | Verdict | Detail |
| --- | --- | --- | --- |
| Ship Spec valid | PRD §7 / M1-T3 validator | ❌ fail | spec rejected: 11 validator problem(s) |
| PRD §8 [auto] invariants | PRD §8 bullets 1–6 / M0-T6 harness | ❌ fail | 2/6 live [auto] invariant(s) pass, 4 FAIL |
| Assembled-ship integrity | PRD §7 scene graph / M3–M4 assembler gate | ❌ fail | 7 assembled-ship problem(s) |
| Scripted walk (coffee run) | PRD §8 [review] 1 / §14 coffee run | ❌ fail | no scripted coffee run to make: the crew deck ("rig-1") seats no galley — there is no coffee station to run to |
| PRD §4 landmarks present | PRD §8 [review] 2 / §4 signature landmarks | ✅ pass | 6/6 §4 landmarks present |
| Practical lighting (no dark room) | PRD §8 [review] 3 (machine half) / M4-T2 rig | ❌ fail | no dark room, 12 of 12 fixtures on the worst deck |
| Post processing within budget | PRD §8 [review] 3 (machine half) / M4-T3 post plan | ✅ pass | post: subtle bloom (intensity 0.35 at threshold 0.120 — the gap between the lit ceiling 0.1 and the dimmest lens 0.141, mip-chain) + ambient occlusion off (the worst deck mounts 12 of 12 fixtures, leaving 0 of light headroom (needs 1)); 204 of 250 draw calls and 12 of 12 fixtures on the worst deck; 1 full-screen pass |
| Deck-order legibility | PRD §8 [review] 4 / M5-T1 wayfinding gate | ✅ pass | 5 deck sign(s), 10 hatch affordance(s), 4 ladder mark(s) — legible |

### Defects

| Sev | Deck | Location | Check | Detail | Repro |
| --- | --- | --- | --- | --- | --- |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 4 ("rig-4"): yPosition -12.75 m is off the canonical grid — deckFloorYFor(4) = -12.8 m (50.0 mm step) | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 4 ("rig-4") galley#0: offset.y = 0.2 m — floor-pinned assembly violation (ModuleRef.offset.y reserved 0) | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 1 ("rig-1") head#0: spine-door face is 10.0 mm proud of the spine face (open gap along the join normal); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 2 ("rig-2") ops#0: spine-door center is 25.0 mm off the spine socket center laterally; cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 3 ("rig-3") ops#1: spine-door center is 4200.0 mm off the spine socket center laterally; cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 3 ("rig-3") ops#1: spine-door face is 1700.0 mm proud of the spine face (open gap along the join normal); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 3 ("rig-3"): engineering#0 socket "high-hatch" (facing +x) faces ops#1 socket "side-door" (facing -x) — door centers disagree by 200.0 mm vertically (door-center step); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 4 ("rig-4") galley#0: spine-door center sits 200.0 mm off the standard 1.0 m height (offset.y floor-pin drift); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 1 ("rig-1"): no module seated on the spine band — deck 1 ("rig-1") head#0: spine-door face is 10.0 mm proud of the spine face (open gap along the join normal); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 2 ("rig-2"): no module seated on the spine band — deck 2 ("rig-2") ops#0: spine-door center is 25.0 mm off the spine socket center laterally; cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | spec (ship-wide) | spec-valid | deck 4 ("rig-4"): no module seated on the spine band — deck 4 ("rig-4") galley#0: spine-door center sits 200.0 mm off the standard 1.0 m height (offset.y floor-pin drift); cap 5 mm | npm run qa:review — check "spec-valid" on fixture "stress" |
| sev-1 | — | ship-wide | auto-invariants | §8 [auto] "seams-watertight" fails: deck 1 ("rig-1") deck-1-seam-0-spine: open seam of 10.0 mm between the mating wall faces of spine band "+z" ↔ head#0 "spine-door" — the watertight cap is < 2 mm | npm run qa:review — check "auto-invariants" on fixture "stress" |
| sev-1 | — | ship-wide | auto-invariants | §8 [auto] "hatch-alignment" fails: deck 1 ("rig-1") head#0: spine-door face is 10.0 mm proud of the spine face (open gap along the join normal); cap 5 mm; deck 2 ("rig-2") ops#0: spine-door center is 25.0 mm off the spine socket center laterally; cap 5 mm; deck 3 ("rig-3") ops#1: spine-door center is 4200.0 mm off the spine socket center laterally; cap 5 mm; deck 3 ("rig-3") ops#1: spine-door face is 1700.0 mm proud of the spine face (open gap along the join normal); cap 5 mm; deck 3 ("rig-3"): engineering#0 socket "high-hatch" (facing +x) faces ops#1 socket "side-door" (facing -x) — door centers disagree by 200.0 mm vertically (door-center step); cap 5 mm; deck 4 ("rig-4") galley#0: spine-door center sits 200.0 mm off the standard 1.0 m height (offset.y floor-pin drift); cap 5 mm | npm run qa:review — check "auto-invariants" on fixture "stress" |
| sev-1 | — | ship-wide | auto-invariants | §8 [auto] "spine-connectivity" fails: deck 1 (rig-1): no module seated on the spine band: head spine-door face is 10.0 mm proud of the spine +z face (open gap along the join normal); cap 5 mm; deck 2 (rig-2): no module seated on the spine band: ops spine-door center is 25.0 mm off the spine socket center laterally; cap 5 mm; deck 4 (rig-4): no module seated on the spine band: galley spine-door center sits 200.0 mm off the standard 1.0 m height (offset.y floor-pin drift); cap 5 mm; deck 4 (rig-4): floor is 50.0 mm off the canonical grid deckFloorYFor(4) — the spine run steps at this deck (cap 5 mm); the "rig-4" band's ladder (rig-4 → rig-3) spans 3.150 m, 50.0 mm off the 3.2 m deck pitch (cap 5 mm) — the run steps between the two decks | npm run qa:review — check "auto-invariants" on fixture "stress" |
| sev-1 | — | ship-wide | auto-invariants | §8 [auto] "spawn-inside" fails: crew/spawn deck (index 1, "rig-1") does not host a galley module — spawn is defined at the foot of the spine on the crew deck | npm run qa:review — check "auto-invariants" on fixture "stress" |
| sev-1 | 1 | deck 1 ("rig-1") | assembly | deck 1 ("rig-1"): "head#0" spine join is off by normal 10.0 / lateral 0.0 / vertical 0.0 mm; cap 5 mm | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 2 | deck 2 ("rig-2") | assembly | deck 2 ("rig-2"): "ops#0" spine join is off by normal 0.0 / lateral 25.0 / vertical 0.0 mm; cap 5 mm | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 3 | deck 3 ("rig-3") | assembly | deck 3 ("rig-3"): module "ops"#1 has no spine join — its spine-door does not land on the band (the deck is off the run) | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 3 | deck 3 ("rig-3") | assembly | deck 3 ("rig-3"): module join engineering#0 "high-hatch" ↔ ops#1 "side-door" is off by normal 0.0 / lateral 0.0 / vertical 200.0 mm; cap 5 mm | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 4 | deck 4 ("rig-4") | assembly | deck 4 ("rig-4"): "galley#0" spine join is off by normal 0.0 / lateral 0.0 / vertical 200.0 mm; cap 5 mm | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 1 | deck 1 ("rig-1") | assembly | deck 1 ("rig-1") seam "deck-1-seam-0-spine": open seam of 10.0 mm between the mating wall faces of spine band "+z" ↔ head#0 "spine-door" — the watertight cap is < 2 mm | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | 4 | deck 4 ("rig-4") | assembly | deck 4 ("rig-4"): the shaft run steps 50.0 mm between the "rig-3" band and this deck's band (floor -12.75 m is -0.050 m off the 3.2 m pitch) — the ladder phase breaks here | npm run qa:review — check "assembly" on fixture "stress" |
| sev-1 | — | movement (ship-wide) | walk | the ship offers no scripted coffee run: the crew deck ("rig-1") seats no galley — there is no coffee station to run to | npm run qa:review — check "walk" on fixture "stress" |
| sev-2 | 3 | deck 3 ("rig-3") | lighting | frame budget: deck 3 ("rig-3") carries 15 fixtures over the 12 the rig mounts at once | npm run qa:review — check "lighting" on fixture "stress" |

---

## Fix loop — M5-T4

> PRD §14 step 4: fix, then re-walk only the affected ships. This pass applies
> the registered fixers to the Review Loop’s defects until the exit rule holds,
> re-running the loop (the affected ship’s walk included) after each fix. The
> three canonical ships enter already clean, so the loop converges at pass 0 —
> no fix is fabricated. The negative control is skipped: a rig that must fail is
> never repaired.

| Preset | Ship | Passes | Fixes applied | sev-1 | sev-2 | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Patrol | Firebrand | 0 | — | 0 | 0 | ✅ converged at pass 0 |
| Long-Haul | Vagabond | 0 | — | 0 | 0 | ✅ converged at pass 0 |
| Science | Surveyor | 0 | — | 0 | 0 | ✅ converged at pass 0 |
| Offset-hatch stress | Offspec | — | — | — | — | ⊘ negative control (skipped) |

Registered fixers: `spine-reseat` · `draw-call-ladder` · `wear-density-rung`.

---

## Human sign-off (open)

The `[review]` items only a human can sign. Their machine half (lighting,
wayfinding, the scripted walk, the landmark list) is measured above; these
remain open until an interactive session walks the ship in a browser.

- Worn-and-warm mood (PRD §8 [review] 3): the reviewer signs off the §4 mood against the reference board — amber practicals on cool metal, lived-in but not filthy, never sterile or horror-dark, no blown-out panels.
- Wayfinding hallway test (PRD §13): a fresh player walks crew deck → bridge and back on the first try (n = 3).
- Onboarding (PRD §13): time-to-first-walkthrough < 60 s from page load (preset → click → walking).
- Ladder/hatch feel (M0-T4, human-held): the climb pace, rung snapping and hatch transitions read right in a browser walk.
