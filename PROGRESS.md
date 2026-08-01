# TEKERLEK — Build Progress

> **Resume file.** If a session is interrupted, read this top-to-bottom and continue
> at the first unchecked phase. Each phase is self-contained and leaves the game runnable.

## How to run

```bash
npm run dev        # serves on http://localhost:8000
```

Debug shortcuts (see `src/config/gameplay.js` → `DEBUG`):

- `?skip=intro` — jump straight to free-roam open world (proves intro is decoupled)
- `?scene=race1|race2|race3|open|chase` — boot directly into a mode
- `` ` `` (backtick) — toggle the live tuning panel
- `C` — cycle camera rigs

## Architecture contract (do not break)

1. **Config-first.** Everything the designer tunes lives in `src/config/`. No magic
   numbers in systems code. `tuning.js` (feel), `style.js` (look), `camera.js` (framing),
   `gameplay.js` (rules/timings).
2. **The intro is a director, not a dependency.** Files under `src/game/intro/` may import
   from anywhere. **Nothing outside `src/game/intro/` may import from it.** The intro drives
   the game through the event bus + public mode API only. Deleting the intro folder must
   leave a working free-roam game.
3. **Events over references.** Cross-system talk goes through `src/core/events.js`.
4. **Data over code.** Tracks, world props and narrative beats are plain data files.

## Phases

- [x] **P0 — Scaffold**: npm, vendored three.js, index.html, dev server, this file
- [x] **P1 — Config layer**: tuning / style / camera / gameplay knobs
- [x] **P2 — Core**: fixed-step loop, input, event bus, mode stack, seeded RNG, math
- [x] **P3 — Render**: retro renderer (low-res upscale, PSX vertex snap, fog, dither/CRT)
- [x] **P4 — Vehicle**: arcade car physics driven entirely by `tuning.js`
- [x] **P5 — Camera**: rig system with hot-swappable presets from `camera.js`
- [x] **P6 — World**: heightfield terrain, track ribbon builder, forest scatter, colliders
- [x] **P7 — Tracks**: 3 forest parkours as data (track 3 has the failing terrain)
- [x] **P8 — Race mode**: checkpoints, laps, AI racers, standings, results
- [x] **P9 — Open world**: free roam, landmarks, points of interest
- [x] **P10 — Chase**: cop AI, siren lights, heat/escape system
- [x] **P11 — Audio**: procedural WebAudio (engine, siren, glitch, ambience)
- [x] **P12 — UI**: Tek|erlek logo, HUD, screens, subtitle/narrative channel
- [x] **P13 — Intro director**: the decoupled first-run narrative sequence
- [x] **P14 — Polish**: live tuning panel, pause, README, headless test suite

**All phases complete.** `npm test` → 92/92, and it renders. See `README.md` for
how to tune it and where to build the next act.

## Status log

- **P0** — three 0.185.1 vendored by `tools/vendor.mjs` (postinstall), import map
  in `index.html`. It copies `three.module.js` **and** `three.core.js`.
- **P1** — 4 config modules. Profiles inherit; themes inherit; rigs inherit.
- **P2** — Fixed 120Hz sim with render interpolation. Input has an override stack
  so the intro can take the wheel without any system knowing.
- **P3** — Renders to a 288-line target and upscales with nearest-neighbour.
  Vertex snap + affine UVs injected into stock three materials via
  `onBeforeCompile`, so fog, instancing and vertex colours still work.
- **P4** — Local-space long/lat model. See the two comment blocks in
  `fixedUpdate` marked GRIP CEILING and ground contact; both are load-bearing.
- **P5** — 7 rigs, shake bus, terrain-aware collision avoidance.
- **P6** — One terrain, all three tracks baked into it. 449k triangles, 6.6k
  colliders, builds in ~200ms.
- **P7** — Parkur 3's escape is `patches` + `barriers.gaps` in the data. No script.
- **P8** — Emits `race:offCourse` for any car; that is the only hook the
  breakout needs.
- **P9** — `keepPlayer: true` adopts the car mid-drive, so race 3 → open world is
  seamless. The rivals keep lapping.
- **P10** — A system, not a mode; the chase happens inside the open world.
  Escape is line-of-sight, not distance.
- **P11 / P12** — Built in parallel by subagents against fixed interfaces.
  Audio is 100% synthesised; UI is vanilla DOM. No asset files anywhere.
- **P13** — `IntroDirector` + `beats.js`. Asserted deletable by the test suite.
- **P14** — Tuning panel on `` ` ``, pause on Esc, README, `tools/smoke.mjs`.

## Bugs found so far (do not reintroduce)

1. **Stability assist bypassed the grip ceiling.** It was applied after the yaw
   clamp, so on ice the car pirouetted instead of understeering. The clamp must
   be the last thing that touches `targetYaw`.
2. **The car was airborne on every downhill step.** A fixed ground tolerance is
   smaller than the distance travelled in one 8ms tick, so descending terrain
   fell away faster than the car did. It silently lost drive, grip and the yaw
   ceiling on every descent. Fixed with speed-scaled ground sticking.
3. **The ice did not extend past the tarmac.** A car sliding off reached grippy
   verge one metre later and tucked back on. Hence `patches[].runoff`.
4. **`three.core.js` was not vendored.** three's ESM build is two files. The
   404 killed the module graph before any game code ran — black page, empty
   console. `tools/vendor.mjs` follows the imports now; never hand-copy it.
5. **`BufferAttribute` has no `userData`.** Threw every frame in the chassis.
6. **The road ribbon was wound inside-out.** Normals pointed down, so with
   front-face culling the tarmac was invisible and you saw the terrain under it.
   Use `GeomBuilder.addQuadFacing()` for anything that must face a known way.
7. **Light intensities were ~3x too low.** three r155+ is physically correct and
   Lambert divides irradiance by PI. Old-style intensities render near-black.

## Tooling note

`npm run inspect -- "?scene=race1"` boots the real game in headless Chromium,
prints every console error / 404 / shader failure, dumps a diagnostic snapshot
and screenshots to `tools/out/`. Bugs 4–7 above were all invisible to `npm test`
and obvious within one run of this.
