# Torchship — A Walkable Interior of an Ex-Navy Fusion-Torch Corvette

**Product Requirements Document (PRD)**

> "Roci-inspired": an original ship in the same *genre position* as the Rocinante from The Expanse — small, worn, ex-navy warship turned found-family home, decks stacked along the thrust axis, fusion torch drive. Not a replica: original hull, original name, original markings. The structural ideas are borrowed; the pixels are ours.

| Field | Value |
|---|---|
| Idea ID | `[local-2026-09-03-01]` |
| Category | 3D web / Three.js (R3F) |
| Difficulty | Intermediate |
| Status | Draft |
| Generated | 2026-09-03 |
| MVP Timeline | 2 weeks |
| **Generation paradigm** | **Hybrid** — authored room-module kit, assembled procedurally from a ship spec (see §5) |

---

## 1. Executive Summary

Torchship is a browser-based walkthrough of the interior of a **Hound-class light corvette** — a decommissioned navy patrol ship, ~45 m of fusion torch, reactor, and recycled air, now running cargo and odd jobs with a crew of four. The user picks a deck-plan preset, spawns on the crew deck, and walks nose-ward through the ship under thrust gravity: crash-couch bridge at the head, galley with the coffee station, ops deck with airlock and med bay, and the reactor room glowing at the aft end above the drive. The world is small, dense, and fully bounded — a closed world whose every surface is hand-placed kit or deterministically assembled from a spec.

The generation paradigm is hybrid: we **author a kit of room modules** (bridge, galley, bunkroom, med bay, airlock, engine room) plus the kit primitives that fill them (bulkheads, deck plates, conduit runs, lockers, screens, crash couches), and a deterministic **assembler** stacks modules into decks along a vertical spine from a typed Ship Spec. The same kit can produce a patrol corvette, a stretched long-haul variant, or a science retrofit — three presets ship in the MVP, proving the contract design and giving the demo variety for free.

Every Expanse-style signature is structural, not visual: **under burn, "down" is toward the drive**, so walking from the engine room to the bridge is a climb; lighting is **practical only** — no sun, every lumen comes from panels, task lights, screens, and the reactor; and the aesthetic is worn and utilitarian — painted metal, cable runs, hazard striping, zero gloss.

## 2. Problem / Motivation

Browser 3D is full of spaceship *exteriors* — orbit sims, dogfight games, model viewers. Almost nobody builds the inside of a small ship as a walkable, lit, coherent place, and the few that exist are either game corridors (wide, gamey, made for combat flow) or sterile concept-art interiors (pristine, oversized, no sense of a crew living there). The Expanse's interior sets proved how magnetic a *cramped, plausible, lived-in* ship can be — the Roci felt like a character. Fans and creators search for exactly that feeling and can't walk through it anywhere in a browser. A closed, deck-stacked, torchship interior is also an ideal fit for the procedural-with-authored-kit build pattern: bounded world, deterministic layout, and a review loop small enough to actually reach "clean."

## 3. Target Audience

**Primary:** Sci-fi fans and The Expanse audience who want to *be inside* the ship they love; creators looking for walkthrough b-roll; Three.js/R3F developers who want a reference project for authored-kit + procedural assembly and practical lighting.

**Secondary:** Game level-design students (kit assembly, vertical navigation); educators explaining real spacecraft concepts (torch drives, thrust gravity, deck orientation).

## 4. Art Direction / Theme Brief ★

**Theme: Ex-Navy Torch Corvette (Roci-inspired, original design)**

- **Reference imagery:** The Expanse *interior set design* (worn bulkheads, deck plating, practical lighting) as vibe ground-truth — NOT the Rocinante's exterior silhouette, markings, or name. Plus real-world references: ISS interior modules, naval ship passageways, submarine galley spaces. Reference board checked into the repo at `docs/reference/`.
- **Mood / atmosphere:** utilitarian, warm-and-worn; amber task lighting against cool metal; quiet hum of a working reactor; lived-in clutter but not filthy. Time of day: n/a — shipboard, always lit by practical fixtures.
- **Palette:** worn gunmetal / warm grey, amber-and-white practical light, faded navy-blue paint patches, rust + copper accents, hazard yellow/black striping, screen glow (teal/white). One warm accent color reserved for the coffee station.
- **Signature landmarks (must be present):**
  - The **head** (bridge): two crash-couch stations facing a sensor-wall display, pilot/gunner consoles.
  - The **galley**: table with a bolted-down coffee station — the crew's heart; must read instantly.
  - The **airlock & suit locker**: interior hatch, two vac suits on racks, tool wall.
  - The **med bay**: fold-down exam bed, med cabinet, red cross-free hazard-adjacent styling.
  - The **reactor room**: the drive's glow visible through a shielded window / grating, radiation trefoil, warning striping.
  - The **spine**: the ladder/crawl shaft connecting all decks — the ship's vertical artery.
- **Material vocabulary:** painted steel bulkheads (brushed, scuffed), diamond-pattern deck plate with cable runs, exposed conduit and pipe runs, ceramic heat shielding near the drive, canvas webbing and straps, rubber gaskets, worn hazard striping, glass/acrylic screens.
- **Ambient / sound (in scope for polish, stretch for MVP):** low reactor thrum, hull creaks, ventilation air movement, coffee machine gurgle in the galley, hatch clunks. Muted alarm klaxon test during review walks.
- **Scale & extent:** interior-only MVP. ~45 m ship, 5 decks on a vertical spine, each deck ~3 m ceiling, corridors wide enough for two people (1.2–1.5 m) — cramped but passable. Navigable volume ≈ the ship interior + nothing else. Exterior hull model is a stretch goal (see §6.2).
- **Anti-goals:** NOT a Rocinante replica (no MCRN-style livery, no "legitimate salvage", original name — renameable by the player/owner); not pristine sci-fi (no gloss, no white plastic); not a game corridor set (no combat flow, no double-height atrium spaces); no spin-gravity ring; no FTL/magic tech; not a ruin — a functioning, grimy, loved ship.

## 5. Generation Paradigm ★

- [ ] **Procedural** — *dominant risk: edge-case coverage; ugly or broken outputs on unusual parameters.*
- [x] **Authored + Procedural Assembly (Hybrid)** — an **authored module kit** (each room type hand-built once with standardized door sockets, light sockets, equipment slots) placed by a **deterministic assembler** from a typed Ship Spec. Kit gives art quality and coherence; the spec + assembler give variety and testability.
- [ ] **AI-generated** — *rejected: nondeterminism is poison for a dense interior you must walk through without clipping.*
- [ ] **Reconstructed** — *rejected: no source scan data for fictional ships.*

**Chosen paradigm & rationale:** Hybrid authored-kit/procedural-assembly. Author the ~6 room modules and kit primitives once (this is where the "worn ship" art direction lives), then let Ship Specs assemble them into decks. The MVP ships three deck-plan presets from one kit — that is the proof the contracts work. **Dominant risk: module seam/interface correctness** — door sockets must align, bulkheads must meet watertight, and the vertical spine must connect every deck; a 2 mm seam or a misaligned hatch breaks the closed world's believability. This risk is de-risked in M0 (§11) and enforced by [auto] invariants (§8).

## 6. Feature Requirements

### 6.1 Must-Have (MVP)

- **Source / authoring:** preset picker of three Ship Specs — *"Patrol"* (default, 5-deck Roci-like corvette), *"Long-Haul"* (stretched cargo variant, extra storage module), *"Science"* (retrofit: med bay expanded, sensor module). Seed control for minor kit variation (clutter, paint patches, cable routing). No free-form editing in MVP.
- **Geometry generation:** module kit (bridge, galley/bunk combo, ops, engineering, airlock, storage) authored from kit primitives; assembler stacks decks along the thrust axis from the spec; ladder/crawl shaft generated as a continuous vertical run; repeated kit pieces instanced/merged to the draw-call ceiling (§10).
- **Materials & lighting:** practical-only lighting rig — recessed panel lights, task lights, screen emissives, reactor glow; PBR materials from the §4 vocabulary; subtle bloom; no sun/sky.
- **Interaction / walkthrough:** first-person controls at 1.6 m eye height (reuse the PlanWalker movement rig pattern); **under-burn gravity model** — constant 1 g, "down" = toward the drive, floors perpendicular to the thrust axis; ladder climbing + hatch traversal between decks (vertical navigation is a first-class mechanic); collision against ship geometry; spawn on the crew deck at the foot of the spine.
- **Export & persistence:** glTF export of the full interior (validated in Blender); autosave of the selected spec + seed to localStorage; shareable URL encodes spec + seed.

### 6.2 Nice-to-Have (Post-MVP)

- **Zero-G float mode** — drive off: gravity direction flips off, mag-boot toggle, camera/gravity rework (the biggest stretch; deliberately excluded from MVP).
- **Exterior hull model + fly-around** (slow orbit camera around the assembled ship; interior/exterior coherence via the same Ship Spec).
- **Alert state** — red lighting sweep + klaxon during review walks (dramatizes the demo).
- **Ambient soundscape** (§4) — reactor thrum, ventilation, coffee machine.
- Crew touches: nameplate editor (player names the ship), photo frames, mission-post flavor text on the ops screen.
- Multiple kit themes later (Belter-scavenged, luxury-yacht retrofit).

## 7. Data Contracts ★

All typed interfaces, checked into `src/types/`. These are the spine; every stage builds against them.

- **Ship Spec** (`ShipSpec`): the interchange format between authoring and the assembler. `{ classId, name, registry, seed, decks: DeckSpec[] }` where `DeckSpec = { id, label, yPosition, modules: ModuleRef[] }`, `ModuleRef = { moduleId, rotation, offset }`. Decks are ordered nose→aft (index 0 = head deck, highest Y; thrust axis = −Y).
- **Module Kit contract** (kit → assembler): every authored module exposes `{ id, dimensions, doorSockets: DoorSocket[] (position + facing + deck offset), lightSockets, equipmentSlots, collisionHint }`. Door sockets are the interface — the assembler only ever joins module-to-module or module-to-spine *at door sockets*. The spine shaft itself is a kit module type with sockets on every deck level.
- **Scene graph contract** (assembler → renderer): merged per-deck geometry + instanced kit-piece batches + named transforms for interactive elements (hatches, screens) + collision hulls per deck. Material references by slot name, resolved by the theme (§4).
- **Material contract** (theme → surfaces): named slots the theme must fill — `deckplate`, `bulkhead`, `conduit`, `panel-light`, `screen`, `hazard`, `ceramic`, `webbing`, `coffee-accent`. One slot = one PBR set; unassigned slot = failed build (checked in CI).
- **Export contract** (scene → glTF): deck groups named `deck-0..N`, consistent unit scale (meters), Y-up with thrust axis = −Y (documented), material slots mapped to named export materials; validated by loading in Blender (§13).

## 8. Closed-World Invariants ★

- **[auto]** Module seams are watertight: for every door-socket join and bulkhead meet, gap < 2 mm in spec space (assembler geometry test).
- **[auto]** Hatch alignment: every module's door sockets land on the spine or a mating module within `[5 mm]`; no dangling sockets (spec validator).
- **[auto]** The spine connects every deck: ladder/crawl run is continuous from crew deck to head and to engineering (graph reachability test on the spec).
- **[auto]** Collision hull matches visible geometry within `[10 cm]` per deck.
- **[auto]** Spawn point is inside the crew deck, not intersecting geometry.
- **[auto]** Every module instance has ≥ 1 light fixture (no legally-dark room in the spec).
- **[review]** No clipping through bulkheads or hull during a scripted walk; no camera escape from the ship interior.
- **[review]** All §4 signature landmarks present and recognizable on every preset (esp. the coffee station — the fans will look).
- **[review]** No unlit rooms; no blown-out overbright panels; mood reads as worn-and-warm, not sterile or horror-dark.
- **[review]** Deck-order logic is legible: climbing nose-ward from engineering to the bridge *feels* like going "up" a ship under burn.

## 9. Technical Architecture (High-Level)

```
[browser / client]
  authoring (preset picker + seed)
      │  ShipSpec (§7)
      ▼
  assembler ── deck spine, module placement, seam checks
      │  scene graph (§7)
      ▼
  renderer (R3F)
      ├─ materials (theme slot sets)      ├─ practical lighting rig
      ├─ collision (deck hulls)           ├─ controls + ladder/hatch nav
      └─ instance/merge pass → draw-call ceiling
            scene ──(export contract)──▶ glTF (Blender-validated)
```

- **Stack:** Vite + TypeScript + React + R3F + drei + @react-three/postprocessing + three `[0.1xx]`.
- **Runtime:** client-only. No backend, no inference. Ship Specs ship as typed JSON presets.
- **State:** small Zustand store (selected spec, seed, current deck, controls state) — same pattern as PlanWalker's sceneStore.
- **Reuse:** the PlanWalker movement/collision rig pattern ports directly; vertical navigation adds a ladder-climb state machine on top.

## 10. Fidelity / Performance Budget ★

**Target:** 60 fps → 16.6 ms/frame on a mid-range laptop GPU (GTX 1660-class / Apple M1) for the *Patrol* preset (5 decks, ~45 m).

| Budget line | Allocation (ms) | Notes |
|---|---|---|
| Geometry / draw calls | 6.0 | ≤ 250 draw calls after merging deck geometry + instancing lockers/panels/conduit |
| Shadows | 1.5 | small shadow maps only for task lights that matter; most light is baked-feel via emissives |
| Post-processing | 2.0 | bloom only (subtle); skip SSAO in MVP — tight interiors hide AO noise and cost budget |
| Everything else (render, JS, nav) | 7.1 | controls math, deck bookkeeping, React overhead |

**Degradation ladder (drop top-first when over budget):**
1. Bloom
2. Shadow-map resolution (→ off)
3. Post-processing entirely
4. Prop/clutter density (fewer loose items per module)
5. Instancing aggressiveness stays — geometry merging is never dropped (it's what keeps the deck count sane)

> Interior worlds are small; the budget risk is **not** raw triangle count but (a) draw-call explosion from hundreds of loose kit pieces and (b) overbright/flat lighting making the space unreadable. Both are addressed by the merge/instance pass and the practical-light rig, not by late-game optimization.

## 11. Risks & Spikes ★

| Risk | Why it's scary | De-risking spike (M0) | Fallback if it fails |
|---|---|---|---|
| **Dense interior reads as confusing/claustrophobic sameness** | Every corridor and room is metal-on-metal; players get lost in 45 m of ship | M0 spike: assemble 3 rough decks from white-box modules and walk them before any polish — test wayfinding, lighting landmarks, spatial memory | Add per-deck color coding (paint patches), stronger landmark lighting, and deck signage as first-class kit items |
| **Module seams / hatch alignment break the closed world** | A 2 mm gap or misaligned door socket = visible light leak, clipped walk, or a deck you can't reach | M0 spike: join all 6 module types in a stress spec with offsets; measure seam gaps and socket misalignment; set the [auto] tolerances from real numbers | Standardize on one door-socket origin per module and generate mating geometry from sockets (never freehand) |
| **Practical-only lighting comes out flat or murky** | No sun means every room is its own lighting problem; risk of unreadable, dull, or horror-dark spaces | M0 spike: light ONE fully-kitted module (galley) to the §4 mood; treat it as the lighting reference for all modules | Bias toward warmer ambient fills + emissive panels; if still flat, add a subtle fill via soft area-light approximation |
| **Vertical navigation (ladders/hatches) feels bad** | Climbing in first-person is famously janky; a bad ladder = motion sickness + review-loop sev-1s | Spike within M0: prototype the ladder-climb state machine on a 2-deck whitebox; tune speed/step/hatch transitions | Hatch-to-hatch "tram" transition (fade + instant move between decks) as a pragmatic fallback |
| Scope creep toward zero-G | Float mode is seductive and would double the movement/camera work | Explicitly out of MVP (§6.2); the gravity model is fixed at "always under burn" | n/a — it stays out until the review loop is clean |

## 12. Milestones & Timeline

| Milestone | Name | Days | Exit Criteria (machine + human) |
|---|---|---|---|
| M0 | Spike & Fixtures | 1–2 | Four spikes (§11) verdicts recorded; canonical test ships checked in (Patrol, Long-Haul, Science, + a pathological offset-hatch stress spec) |
| M1 | Foundation & Data Contracts | 1–2 | Vite+R3F scaffold boots; ShipSpec + module-kit types compile; spec validator + CI green; test runner works |
| M2 | Module Kit Authoring | 3–4 | All 6 module types + spine built from kit primitives to §4 mood; every module fills its material slots; kit renders standalone in a test harness |
| M3 | Assembler & Vertical Navigation | 2–3 | Presets assemble from specs; seams/hatch [auto] invariants pass on all fixtures; ladder climb + hatch traversal + collision work end-to-end |
| M4 | Materials, Lighting & Atmosphere | 2 | Practical-light rig across all modules; frame budget met on Patrol; §8 lighting review items pass on the realistic fixture |
| M5 | Walkthrough Polish & Review Loops | 1–2 | Spawn/deck UX, scripted walks on all three ships, Review Loop passes to exit rule |
| M6 | Export, QA & Launch | 1–2 | glTF export loads in Blender with materials intact; README + screenshots; demo deployed |

## 13. Success Metrics

**Machine-verifiable**
- Build/lint/test green; all [auto] invariants (§8) pass on the three canonical ships + stress spec.
- Performance: 60 fps on the §10 reference hardware for the Patrol preset; ≤ 250 draw calls.
- Export: glTF interior loads in Blender with material slots intact and deck groups named per contract.

**Human-verifiable (via the review loop, §14)**
- Theme fidelity: all §4 landmarks present on all three presets; reviewer signs off on worn-and-warm mood against the reference board.
- Walkthrough quality: zero sev-1 (world-breaking) defects; ≤ 5 sev-2 (cosmetic).
- Wayfinding: a fresh player can walk from crew deck to bridge and back without getting lost, on the first try (hallway test, n = 3).
- Onboarding: time-to-first-walkthrough < 60 s from page load (preset → click → walking).

## 14. Review Loop Definition ★

- **Test scenes:** the three canonical ships from M0 + the stress spec — never an ad-hoc scene.
- **Checklist:** the [review] invariants (§8) + the §4 landmark list; add a scripted "coffee run" walk (crew deck → galley → coffee station → back) as the standard movement test on every review pass.
- **Defect log:** each defect gets `{ severity: sev-1 world-breaking | sev-2 cosmetic, ship, deck, location, repro }`.
- **Exit rule (honest):** zero sev-1; ≤ 5 sev-2. Record the final log in `QA.md`.

---

*Template v1 (3D-world projects) — filled per its own guidance: §4, §5, §7, §8, §10, §11 first; the rest followed. Ship name TBD by the crew when the build starts — every Rocinante needs its name.*
