# TEKERLEK

A racing game with a door in it.

You race two parkours through pine forest. On the third, the outside of a fast
left-hander is coated in ice and the barrier there was never installed. You slide
wide, find nothing, and keep going — and the world outside the track turns out to
be a real place you can drive around in. Thirty seconds later you hear sirens.

The logo splits the word: **Tek**·erlek. *Tek* is Turkish for *single, sole, the
only one*.

---

## Running it

```bash
npm install     # once — also vendors three.js into vendor/
npm run dev     # http://localhost:8000
npm test        # headless: world, physics, and the escape itself
npm run inspect -- "?skip=intro"   # boot it in headless Chromium, screenshot,
                                   # and print every console error
```

No build step. ES modules straight from the filesystem, three.js pinned in
`vendor/` by `tools/vendor.mjs` (which follows three's internal imports —
`three.module.js` is *not* one file, it pulls in `three.core.js` beside it).

`npm run inspect` is the tool to reach for when something looks wrong on screen.
It launches the real game in Chromium with software GL, captures page errors,
404s and shader compile failures, dumps a diagnostic snapshot (camera, mode,
draw calls, render-target size) and writes a PNG to `tools/out/`. It needs
`puppeteer`, which is a devDependency — delete it if you do not want the
download.

### URL switches

| Switch | Effect |
| --- | --- |
| `?skip=intro` | Straight into free roam. **This is the game without the story.** |
| `?scene=race1\|race2\|race3\|open\|chase` | Boot directly into one situation |
| `?cam=chase\|chaseTight\|chaseWide\|hood\|bumper\|cinematic\|free` | Force a camera rig |
| `?theme=forest\|outside\|night\|glitch` | Force a palette |
| `?render=psx\|n64\|clean` | Force a render preset |
| `?seed=12345` | Different world |
| `?nocops` | Explore in peace |
| `?panel` | Open the tuning panel on boot |
| `?mute` | Silence |

### Keys

`W A S D` / arrows drive · `Space` handbrake · `C` cycle camera · `V` look behind
· `R` respawn (races only) · `H` horn · `` ` `` tuning panel · `Esc` pause

---

## The four files you will actually edit

Everything tunable is in `src/config/`. No system file contains a magic number.

| File | Owns |
| --- | --- |
| **`tuning.js`** | How the car *feels* — power, grip, friction, steering, body roll. Also `SURFACES`, the grip/drag multipliers per ground type. |
| **`camera.js`** | How the game is *framed*. Seven rigs; add an eighth by adding an object. |
| **`style.js`** | How it *looks*. `RENDER_PRESETS` (the PS1 pipeline) and `THEMES` (four complete palettes). |
| **`gameplay.js`** | Rules and timings — laps, the chase, the thirty seconds. |

Press `` ` `` in game for live sliders over all of it. `Copy values` puts a JSON
snapshot on your clipboard to paste back into the config.

### Changing the feel

`PROFILES` in `tuning.js` are whole cars. There is a `drifter` in there already —
set `ACTIVE_PROFILE = 'drifter'` and the game is a different game. Profiles
support `inherits`, so a variant is four lines.

The dials that matter most, in order:

1. `lateralGrip` / `slideGrip` — how planted the car is, and what a slide feels like.
2. `maxLateralAccel` — the understeer ceiling. See the warning below.
3. `engineForce` + `powerCurve` — the shape of acceleration.
4. `stabilityAssist` — 0 spins, 1 is on rails.
5. `PACE.timeScale` — the whole game's speed, in one number.

> **⚠ `maxLateralAccel`, `SURFACES.ICE.grip` and `track3`'s `patches` are load-bearing.**
> Together they are what takes the third parkour away from the player. Make the
> car grippier or the ice less slippery and the corner quietly becomes
> survivable — no error, no crash, the game just stops having a second half.
> `npm test` drives that corner with a simulated human and asserts they come off.
> Run it after touching the car.

### Changing the look

`THEMES` are complete colour worlds. Geometry is baked with vertex colours and
the materials multiply by a tint, so `game.setTheme('night', 8)` cross-fades the
entire world over eight seconds without rebuilding a single mesh. Add a theme by
adding an object; `inherits` works here too.

`RENDER_PRESETS` control the retro pipeline: internal resolution, PS1 vertex
snapping, affine texture warp, colour quantisation, dithering, scanlines,
chromatic aberration. `clean` turns all of it off, which is the preset to use
when you are debugging geometry rather than looking at the game.

### Changing the camera

Rigs are declarative. The one field worth understanding is `velocityFollow`: at
0 the camera is welded behind the car's nose and drifts are invisible; at 1 it
trails the car's actual velocity and you watch the car go sideways across the
screen. 0.6 reads best. Everything else is offsets and stiffnesses.

---

## Architecture

```
src/
  config/     tuning · camera · style · gameplay      ← the knobs
  core/       loop · events · input · modes · rng · mathx
  render/     renderer · postfx · psx · materials · cameraRig · geometry
  world/      terrain · track · scatter · props · collision · world
    tracks/   track1 · track2 · track3                ← parkours as data
  vehicle/    vehicle · chassis · ai
  audio/      procedural WebAudio — no asset files
  ui/         logo · hud · screens · subtitles · tuningPanel
  game/       game · chase
    modes/    raceMode · openWorldMode
    intro/    introDirector · beats                   ← deletable
```

Four rules hold it together:

1. **Config first.** Systems read `src/config/`; they never hard-code.
2. **The intro is a director, not a dependency.** See below.
3. **Events over references.** Cross-system talk goes through `core/events.js`.
4. **Data over code.** Tracks, props and narrative beats are plain objects.

### One world, three tracks

All three parkours are built into the same terrain, at the same time, once. A
race does not load a track; it points the rules at one of the ribbons that were
always there.

That costs some memory and buys the entire premise. When you leave the third
parkour, the first two are still standing a few hundred metres away, and you can
drive back and look at the start line you were on ten minutes ago. The rival cars
are still going round it. Nothing streams in behind you, because nothing was ever
streamed in.

### The intro is deletable

`src/game/intro/` may import from anywhere. **Nothing outside it may import from
it.** The only exception is one line in `src/main.js`. `npm test` asserts this.

The director only ever listens to events the game already emits and calls methods
the game already exposes. `RaceMode` does not know a story is being told over the
top of it — it reports `race:offCourse` with a distance and a duration, the way it
would for any car on any track. The director reads that as the end of the world.

Delete the folder and the import, and `main.js` boots straight into free roam
with everything intact. `?skip=intro` does the same thing without deleting
anything — **that URL is the game you are building on top of.**

### The break is physics, not a cutscene

There is no trigger volume and no scripted crash. Two entries in
`src/world/tracks/track3.js` do all of it:

```js
patches:  [{ from: 0.523, to: 0.612, surface: 'ICE', runoff: 34 }]
barriers: { gaps: [{ from: 0.478, to: 0.68 }] }
```

`SURFACES.ICE.grip` is `0.12`, so the tyres make about 1.9 m/s² of cornering
force. The corner's radius is ~115m, which needs about 12. You arrive at 150 km/h
and the car simply does not turn. `runoff: 34` continues the ice for 34 metres
past the tarmac, so you do not reach grippy verge a metre later and tuck back in.
Then there is no barrier.

The AI rivals sail through it, because `Vehicle#ignoreSurfaces` makes the road
always tarmac for them. They are part of the track, not competitors. The world's
surfaces apply to you and to nothing else — which is the whole game, expressed as
one boolean.

### Escaping the chase is about sight, not speed

The cops are marginally faster than you in a straight line, so running does not
work. `heat` rises while a cop can see you and falls while none can; break line of
sight for long enough and they lose you. Trees block sight. Cops lose grip
off-road faster than you do (`CHASE.offroadPenalty`). The forest is the answer to
the question the sirens ask.

`CHASE.mercyAfter` guarantees you win eventually. It is a scene, not a skill check.

---

## Where to continue

`?skip=intro` drops you into `OpenWorldMode` with a car, a world, and no rules.
That is the seam. Some places to build from:

- **`OpenWorldMode`** is deliberately thin. New systems attach to it the way
  `ChaseSystem` does — as a system, not a mode, so the player never stops driving.
- **`World.landmarks`** already fires `world:landmark` when you reach one. Six
  exist; only the radio mast has geometry.
- **`game.flags`** carries `escaped` / `chaseOver` / `racesCompleted` across modes.
- **Themes** are how the game changes its mind about where you are. `glitch` is
  written and currently used for about two seconds.
- **`beats.js`** is the whole script. A second act is a second beats file and a
  second director; the first one detaches itself when it is done.

## Testing

`npm test` runs 89 checks headlessly — module graph, the intro-decoupling
contract, config resolution, world generation, road smoothness, seed determinism,
collision, and the physics: 0–100, top speed, braking, understeer on ice, and a
simulated human driving the third parkour's corner and coming off it.

### Bugs it caught, and one it could not

Worth knowing about, because they are all the kind that produce no error:

1. **The stability assist bypassed the grip ceiling.** It was applied after the
   yaw clamp, so on ice the car pirouetted instead of understeering. The clamp
   must be the last thing that touches `targetYaw`.
2. **The car was airborne on every downhill step.** A fixed ground tolerance is
   smaller than the distance travelled in one 8ms tick, so descending terrain
   fell away faster than the car did. It silently lost drive, grip and the yaw
   ceiling on every descent, and presented as "handling feels a bit floaty".
   See the ground-sticking block in `Vehicle#fixedUpdate`.
3. **Ice did not extend past the tarmac,** so a car sliding off reached grippy
   verge one metre later and tucked straight back on. Hence `patches[].runoff`.

Three more only showed up on screen, which is why `npm run inspect` exists:

4. **`three.core.js` was not vendored.** three's ESM build is two files; copying
   only `three.module.js` gave a 404 that killed the module graph before any of
   our code ran — a black page with an *empty* console. `tools/vendor.mjs` now
   follows the imports.
5. **`BufferAttribute` has no `userData`.** Used it to cache brake-light state;
   threw every frame.
6. **The entire road ribbon was wound inside-out.** Every quad's normal pointed
   down, so with front-face culling you saw straight through the tarmac to the
   terrain below — the road rendered as grass. A back-facing surface does not
   look broken, it looks *absent*. `GeomBuilder.addQuadFacing()` now makes the
   mistake unmakeable, and the suite asserts road normals point up.
