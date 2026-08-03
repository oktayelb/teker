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

**All phases complete.** `npm test` → 167/167, and it renders. See `README.md` for
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
- **P14** — Tuning panel on `` ` `` (designer), settings menu on Esc (player),
  README, `tools/smoke.mjs`, `tools/inspect.mjs`.
- **P15** — Settings: schema in `src/config/settings.js`, generic renderer in
  `src/ui/settingsMenu.js`, effects in `Game#_applySetting`, persisted to
  localStorage. Sound / light / video / camera. Adding an option = schema entry
  + one `case`.

- **P16** — Parkur 3 rebuilt as an unsealed, lit night stage: no barriers at
  all, plastic delineator posts with no colliders, a floodlight rig
  (`src/world/lighting.js`), a mid-race blackout, and headlights on the player
  and the cops. Every light in the game now comes from a fixed pool
  (`src/render/lightPool.js`) so the count never changes and three never
  recompiles materials mid-scene.

- **P17** — Ground cover. Grass is no longer scattered; it is a camera-following
  pool in two bands (`src/world/groundCover.js`, `OPEN_WORLD.groundCover`),
  rooted with `terrain.heightAt` and stood up on `terrain.normalAt`. It bends
  in the vertex shader (`src/render/wind.js`), injected at `begin_vertex` so it
  cannot fight the PSX snap at `fog_vertex`. 2800 tufts, 29k triangles, zero
  allocation after `build()`.

- **P18** — Dirt. `buildPalette` now layers turf → wear → damp → grit into the
  terrain's vertex colours, with the colours per theme (`ground.dirt/mud/grit`)
  and the rules in `GROUND_PAINT` (`style.js`). The wear thresholds are
  ABSOLUTE, not fractions of `cliffSlope` — see bug 19.

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
8. **`right` pointed at the driver's LEFT.** `(cos h, 0, -sin h)` instead of
   `forward × up = (-cos h, 0, sin h)`. Mirrored the whole game at once —
   steering, body roll, camera lean, siren panning — with every individual sign
   still looking plausible. Asserted now: steer +1 must move the car toward -x.
9. **`AudioEngine#_live` / `#_now` are getters, not methods**, and
   `Screens#isModalOpen` likewise. Calling them with `()` throws. When reaching
   into a module someone else wrote, check the member kind first.
10. **Oriented boxes were rotated the wrong way.** `CollisionGrid` built the
    box's local frame with `-rotationY`, which is correct at multiples of 90°
    and reflected everywhere between. A 0.44m guardrail blocked 3.9m sideways
    at 45°, so barriers on curves became invisible walls across the road.
    Now asserted at eight headings.
11. **The car's hitbox was a circle sized to its LENGTH.** radius 1.74m for a
    1.8m-wide car — it behaved as if 3.5m wide and clipped barriers 0.56m
    *inside* the tarmac. Replaced with three probe circles down the centreline
    (`Vehicle#collisionProbes`): correct width, correct length.
12. **Cars had no vehicle-vehicle collision at all.** Only the static grid was
    ever queried, so the AI were ghosts. `src/vehicle/contacts.js` runs an
    impulse pass after every vehicle has integrated.
13. **The headlight beam cone was built pointing backwards.** `ConeGeometry`
    runs along +Y; a *positive* quarter-turn about X puts it on -Z, i.e. behind
    the car, where it swallowed the chase camera and filled the screen with an
    additive haze that looked nothing like a beam. Use `rotateX(-PI/2)`.
14. **A rival started inside the chase camera.** The grid put row 1 exactly
    where the camera sits, so the first thing you saw was the underside of
    somebody's door. Hence `RACE.poleGap` — it must exceed the rig's pull-back
    plus a car length.
15. **Light intensities again.** `LIGHTING.intensity: 120` lit nothing; the
    physical units need ~520 for a lamp 8m up over a night-albedo ground.
    Whenever a light "does not work", check the magnitude before the wiring.
16. **The saved sound settings never reached the mix.** `Game#init` restores
    them and applies them *before* the first gesture, so the AudioContext is
    still suspended — and `setBusVolume` remembers the scale but returns
    before touching the GainNode when it is not `_live`.
    `_realiseDesiredState()`, whose entire job is replaying what was asked for
    during the suspension, did not replay `_busScale`, so the buses stayed on
    their `AUDIO_CONFIG.MASTER.busVolumes` defaults for the whole session.
    The slider read back the saved value while the sound did not match it —
    a setting that *looks* applied is worse than one that visibly failed.
    Master and mute hid it by working, because `_applyMasterGain()` does not
    gate on `_live`. Anything deferred past unlock has to be replayed there.
17. **`Matrix4#decompose` lies about a zero matrix.** three returns scale
    `(1,1,1)` and an identity rotation for anything whose determinant is zero,
    which is exactly what a hidden InstancedMesh slot is. A test that finds the
    live instances by decomposing therefore sees every *hidden* one as full
    size at the origin — and passes, while asserting nothing. Measure the basis
    column instead: `Math.hypot(e[0], e[1], e[2])`.
18. **A pooled instance that stops moving keeps its last matrix.** Ground cover
    only rewrites an instance when its fade changes by more than an epsilon, so
    a tuft that left its band while still an epsilon tall never got the final
    write and stayed drawn, sub-pixel, at a position hundreds of metres behind
    the player. Invisible, and still wrong. Snap the fade's two plateaus to
    exactly 0 and 1 so "hidden" is a state you can compare against.
19. **`TERRAIN_SHAPE.cliffSlope` never fires.** The generated valley is far
    gentler than it assumes: median slope 0.004, 90th percentile 0.056,
    steepest vertex in the whole world 0.43, against a threshold of 0.55. Zero
    vertices classify as `CLIFF` and 78 out of 48,841 as `DIRT`. Anything
    expressed as a fraction of it — which is the natural thing to write — is
    dead code that looks alive, and it is why the ground read as tinted noise
    for so long. Measure the distribution before picking a slope threshold.

## Tooling note

`npm run inspect -- "?scene=race1"` boots the real game in headless Chromium,
prints every console error / 404 / shader failure, dumps a diagnostic snapshot
and screenshots to `tools/out/`. Bugs 4–7 and 9 were all invisible to `npm test`
and obvious within one run of this. `tools/menu-check.mjs` does the same for the
pause/settings flow, including driving the car to check which way it steers.
