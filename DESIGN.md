# TEKERLEK — Roadmap

What is actually here, what act two could be, what to build, and what to refuse.

This sits next to `README.md` (how it works) and `PROGRESS.md` (how it got built)
because it is the third question those two don't answer: what next. All three are
English; only the game speaks Turkish.

Everything below cites files. If a proposal does not name the system it hangs off,
it is not a proposal.

---

## 1. Where the game is now

The told story is thirty-three beats in one file, and it ends. `IntroDirector`
plays race 1 → race 2 → race 3 → the slide → the failed reset → the open world →
thirty seconds → sirens → the chase → `alone`, then calls `detach()` and emits
`intro:finished`. **After that moment nothing in the codebase is watching the
player.** The car still drives, the forest still falls over, the animals come out,
the rivals keep lapping — and no system has an opinion about any of it.

That is not a criticism. It is exactly the handover the architecture was built for.
But it means the honest description of the game today is: *a complete forty-minute
opening attached to a very good empty world.*

### What is finished

Three parkours baked into one 2.86 km terrain (449k tris, 6.6k colliders, ~200 ms).
Vehicle physics with a real grip ceiling. Seven camera rigs. Four themes that
cross-fade without rebuilding a mesh. A chase that is won by sight, not speed.
Trees that remember being hit and can be worn. Pooled wildlife. 100% procedural
audio. A player settings menu and a designer tuning panel. 151/151 headless checks.

### What is a stub

**`World.landmarks` — six defined, one built.** `_placeLandmarks()` (`world.js:199`)
positions `Vadi`, `Kule`, `Göl`, `Taşlar`, `Sırt`, `Kenar` by angle and fraction of
`terrain.halfSpan`. Only `Kule` gets geometry, via `_buildMast()` immediately below
it. The other five are invisible circles on a heightfield: you drive into a radius,
a subtitle says *"still water"*, and there is no water.

**`world:landmark` has exactly one listener in the entire project** —
`IntroDirector._onLandmark` (`introDirector.js:393`) — and it is guarded to
`phase === 'free' || 'chase'`, and the director detaches. After the handover,
`OpenWorldMode._checkLandmarks()` faithfully adds a name to a `Set`, sets
`l.discovered = true`, emits the event, and nothing at all happens. Both halves of
the wire exist and they are not connected to anything.

**`game.flags` is written in five places and read in zero.** `escaped`,
`chaseOver`, `racesCompleted`. The README calls it the seam that carries state
across modes; today it is a declared seam, not a used one.

### What is written and barely used

| Thing | Where | Screen time |
| --- | --- | --- |
| `THEMES.glitch` — a complete colour world | `style.js:242` | `setTheme('glitch', 0.4)` at `introDirector.js:314`, replaced 1.4 s later. **~2 seconds, once, ever.** |
| HUD `chase` personality — pursuit meter, timing hidden, red segments | `hud.js:14`, `ui.css:633` | **Never.** `setMode('chase')` is not called anywhere. |
| Subtitle tone `radio` — styled with ‹ › guillemets | `subtitles.js:23`, `ui.css:992` | **Never.** A whole voice, built, unused. |
| `subtitle.speaker` — documented, plumbed, rendered | `beats.js:15`, `ui/index.js:319`, `subtitles.js:155` | **Never set by a beat.** Nobody in this game has a name yet. |
| Alert tone `glitch` | `ui.css:831` | **Never.** Beats use `system` and `warning` only. |
| `Hud#setCheckpointFlash()` | `hud.js:281` | Never called; `race:checkpoint` only reaches `audio.playCheckpoint()`. |

The pursuit meter one is worth stating plainly because it is a live bug, not just
an unused feature: `OpenWorldMode.enter()` sets `hud.setMode('openWorld')`, and
`ui.css:618` says `.tk-hud[data-mode="openWorld"] .tk-hud-heat { display: none }`.
`ChaseSystem.update()` then calls `hud.setHeat(this.heat)` sixty times a second
into a hidden element for the whole chase. **The heat bar has never been on screen.**

### Events emitted with nobody listening

`tree:felled`, `tree:damaged`, `vehicle:disguised`, `vehicle:undisguised`,
`chase:sighted`, `lighting:blackout`, `lighting:restored`, `intro:blackout`,
`intro:escaped`. Nine events, correct payloads, zero subscribers. This is the
cheapest surface in the codebase — somebody already ran the wire for each of them.

### Config keys nothing reads

`RACE.checkpointRadius`, `BREAKOUT.armedOnLap`, `BREAKOUT.normalResetDelay`,
`BREAKOUT.glitchSeconds`, `OPEN_WORLD.radius` (the world span actually comes from
`terrainResolution * terrainCellSize`), `OPEN_WORLD.scatterDrawDistance`,
`CHASE.searchSeconds`, `PLAYER.respawnKey`, `PLAYER.respawnDelay`. Harmless, but
they are promises the config makes that the code does not keep, and this project's
whole contract is that `src/config/` is where behaviour lives.

### Two things the world already contains that mean nothing yet

**140 posters and 70 wrecks.** `createPoster()` (`props.js:260`) is a missing-person
notice on a stake with a dark rectangle where a face would be, deliberately
unreadable. `createWreck()` (`props.js:290`) is *the same silhouette as the cars you
race*, minus the glass, minus a wheel, plus a decade — and it is the one scattered
prop with a collider. Somebody walked out here and put up notices. Somebody else
didn't get out. Neither fact is referenced by a single line of script.

**The edge of the world is a secret nobody has told.** `Terrain.contains()` is
`|x| < halfSpan && |z| < halfSpan`; past it, `heightAt()` clamps to the boundary row
and the ground continues flat forever. `World.sampleGround()` returns
`surface: 'VOID'` out there, and `SURFACES.VOID` is `grip 0.85, drag 0.8,
power 1.05` — **grippier, slicker and faster than grass**, annotated "deliberately
wrong-feeling". There is no wall. You can drive off the edge of the visible world
onto an invisible plane where the car gets *better*. And the landmark named
`Kenar`, "where the fog does not lift", sits at `dist: 0.93` — just inside it.

That is a finished piece of design with no delivery mechanism attached.

### One documentation error

`README.md` says the suite runs 136 checks. It runs 151. `PROGRESS.md` is right.

---

## 2. Storyline

### What the existing script already commits you to

Read `beats.js` as a contract, not as placeholder text. It establishes:

- You are `UNIT 0451`. Not a name — a manifest entry.
- The system's failure mode is **administrative, not hostile**: `OFF-MANIFEST`,
  `RETURNING TO LAST VALID POSITION`, `NO VALID POSITION FOUND`, `TRACE LOST`,
  `LOGGING ANOMALY`. The file's own tone note is explicit: *"Do not let the system
  be witty. It is not taunting you; it is filing a report about you."*
- They are **recovery units**, not police. `TWO RECOVERY UNITS DISPATCHED`.
- The world speaks Turkish; the system speaks English in capitals.
- The rivals are not competitors. `Vehicle#ignoreSurfaces` makes the road always
  tarmac for them; `createChassis` gives them no headlights (`chassis.js:44`), so
  they lap a pitch-dark stage at racing speed because they were never using their
  eyes. They are furniture with a racing line.
- The last word is `Tek.`

Any act two that contradicts one of those is a different game.

### The questions the geometry asks

These are not invented. They are already standing in the world:

1. Who put up 140 posters, and for whom?
2. Why do 70 wrecks share a silhouette with the rivals?
3. Why is there a 58-metre radio mast with a red lamp that blinks, in the comment's
   own words, *"for no one"* (`world.js:239`)?
4. Why did somebody hang a floodlight rig along a route nobody was supposed to
   leave — and then leave a gap in it?
5. What is `Kenar`?

---

### Direction A — *The Maintenance Story* (recommended)

**Tone:** procedural, sad, administrative. The system is not evil. It is
understaffed, and it has been understaffed for a very long time.

**Premise.** The valley is a facility that is still running and no longer
maintained. The posters are not missing persons — they are the previous units, and
somebody still out here is putting up notices for cars that came off. The wrecks are
what those notices were for. The mast is how the facility used to report in; it is
unlit because nothing is at the other end. The gap in the parkur 3 lighting plan was
never a trap. It is a repair that was never made, and you are the first one to find
it alive because everyone else who found it is a wreck.

The escape in act one is not an achievement. It is a **maintenance failure**, and
act two is about discovering the scale of the neglect.

**The shape.** Three movements:

*Movement 1 — the mast.* The only landmark with geometry, visible from a long way
off, blinking. You reach it, and it has a switch. Turning it on is the first
irreversible thing the player has ever done in this game — everything up to now has
happened *to* them.

*Movement 2 — the schedule.* What comes back on the `radio` tone is not a person. It
is a loop: a race schedule, read out, with timestamps in a format that stopped
making sense some time ago. Then, once, in the middle of it, somebody interrupts —
surprised that anything is transmitting. **This is where Direction B's second
character lives: as a voice, not a car.** They give you nothing useful. They ask
which unit you are, and you have no way to answer.

*Movement 3 — the valley lights up.* Turning the mast on is also how you are seen.
Every rig in the valley comes up — `TrackLighting.setPower(1)` on all three tracks
at once — and the second chase begins under floodlights. The forest, which has been
your only cover for the whole game, is now lit.

That inversion is the point. Act one taught you that hiding beats running. Act two
takes the same lesson and turns it: the thing you switched on to find out where you
are is the thing that shows them where you are. It is the same structural move
parkur 3 makes on races 1 and 2 — teach a rule, then charge for it — which is why it
will feel like the same game.

*The ending.* You cannot leave. `Kenar` is where the fog does not lift, and past it
is `VOID` — flat, endless, and grippier than the world, which is the engine's own
way of saying "this is not a place". So the ending is not an exit. It is a choice
about the mast:

- **Leave it on.** Somebody else hears the schedule. Another unit finds the gap.
  The valley stays lit and the chase never fully ends for you. Theme stays lit;
  wildlife stays away.
- **Turn it off.** Nothing is transmitting again. The lights go down, the recovery
  units go home, and the game returns to permanent silence. `setTheme('night')`,
  `audio.setMusic('none')`, `Tek.`

Two endings, both of which are one boolean and a theme call. No dialogue system, no
UI. That is the right scale for this game.

**Concrete beats, as ids for a second beats file.** Each names the hook it hangs on:

```
'mast.seen'      first sight    — distance + line of sight to the Kule landmark
'mast.arrive'    world:landmark — already fires, payload already has name/label
'mast.switch'    input          — the prompt, in the register of FARLAR / KAMERA
'mast.power'     new event      — mast:powered
'mast.loop'      radio tone     — the schedule, speaker: 'YAYIN'
'mast.voice'     radio tone     — once, speaker: 'BİLİNMEYEN'
'valley.lit'     lighting:restored × 3 — the event already exists and is unheard
'hunt.start'     chase:started  — same event, more units, lit forest
'hunt.seen'      chase:sighted  — currently unheard; this is what it was for
'hunt.escaped'   chase:escaped
'choice.return'  world:landmark — Kule again, with mast.powered set
'end.on' / 'end.off'
```

Ten of those twelve attach to events the game already emits. The two new ones
(`mast:powered`, and a proximity check for `mast.seen`) are together about forty
lines in a `MastSystem` that lives in `src/world/`, not in the story folder — so the
narrative stays deletable.

**Why this one.** It uses what exists instead of adding a genre. It gives the
`radio` tone a job and `speaker` its first value. It makes `_buildMast()`
load-bearing. It converts the posters and the wrecks from set dressing into the
plot without ever explaining them. It keeps the system bureaucratic. And it does not
require a single new mode — `OpenWorldMode` plus systems, the way `ChaseSystem`
already works.

---

### Direction B — *Somebody Else Got Out*

**Tone:** warmer, a two-hander, closer to a road movie than to a report.

**Premise.** There is a car in the world that is not a rival and not a recovery
unit. It runs on `AiDriver` in `idle`/`search` mode, it is a `hatchback` in a colour
that is not in `theme.vehicles.rivals`, and it is avoiding you. You find where it
has been: a poster fresher than the rest, a wreck that has been stripped rather than
rotted, an engine on the ambience bus you can hear and never see. Eventually it
stops and waits. The story becomes whether you follow it out or it follows you back.

**Why it is genuinely attractive.** It is the cheapest possible act two.
`OpenWorldMode._adoptGhostRacers()` already proves an AI car can live in the open
world indefinitely with no mode owning it. No new systems at all: one vehicle, one
AI mode, a handful of hand-placed props, a beats file. It also gives the player a
reason to *look* at the world rather than drive through it, which is the thing the
open world most needs.

**Why it is not the recommendation.** It spends the title. The whole third act of
the intro exists to deliver `Tek` — *the only one* — and the moment there is a
companion car, "The trees keep going / Nobody built this to be looked at closely /
And yet here it all is" becomes a conversation. Loneliness is the only thing this
game has that a hundred other driving games don't, and a passenger costs it in one
scene.

It is a good chapter and a bad spine. Which is why Direction A takes it and demotes
it to a voice: **a person you hear once and never meet is `Tek`-compatible in a way
a person you drive next to is not.**

---

### Direction C — rejected on sight

*"It's an open world with police, so: wanted levels, garages, races for money, a map
with icons, chop shops, respawn at the hospital."*

Considered, and no. Full reasoning in §4.1, but the short version: every one of
those mechanics answers the question "what should I do next", and this game's entire
premise is that **nobody is telling you what to do next any more.** The chase is a
scene with `CHASE.mercyAfter` guaranteeing you win; it is not a difficulty system
waiting to be extended. Turning the recovery units into a wanted level converts a
one-time institutional failure into a renewable resource, and the sentence
"UNIT 0451 UNRECOVERED · LOGGING ANOMALY" stops meaning anything the second time it
prints.

---

### Recommendation

**Direction A, with B folded in as the radio voice and a trail of traces.**

Reasoning, in order of weight:

1. It is the only direction where the existing unused assets — `radio`, `speaker`,
   `glitch`, the chase HUD, nine orphaned events, five empty landmarks — are all
   *load-bearing* rather than decorated over. That is not a coincidence; those
   things were built by somebody who had roughly this story in mind.
2. It gives the player one irreversible action. Act one is entirely passive: the ice
   takes the car, the reset fails, the sirens arrive. A second act that is also
   passive is the same act again.
3. It inverts a taught mechanic instead of repeating one.
4. It ends without leaving, which is the only ending consistent with `VOID` and the
   fog wall.

### Where act two attaches

`IntroDirector.detach()` emits `intro:finished`. A second director subscribes to
that and takes over. Same contract, second folder:

```
src/game/act2/act2Director.js
src/game/act2/beats.js
```

`main.js` gains one more import — the second and last exception to the rule. The
smoke test's intro-decoupling check (`smoke.mjs:64`) should be generalised from
`src/game/intro/` to "any narrative folder under `src/game/`", so both are asserted
deletable.

One thing to know before wiring it: `TREES.breakableBy` includes `'intro:finished'`,
so a director attaching on that event attaches at exactly the frame the forest goes
soft. That is convenient — act two starts the moment the player is handed the
felling mechanic — but it is load-bearing, so do not reorder it casually.

---

## 3. Features, by size

### An afternoon

**A1 — Turn the pursuit meter on.**
`g.ui.hud.setMode('chase')` in `OpenWorldMode#startChase()`, and back to
`'openWorld'` on `chase:escaped`. The HUD code and the CSS have both existed since
P12. Right now the entire chase runs with its central readout `display: none`.
*Cost: two lines and one subscription. Highest ratio in the document.*

**A2 — Landmarks that survive the handover.**
Move the reaction to `world:landmark` out of the intro director. A ~30-line
`LandmarkSystem` attached to `OpenWorldMode` the way `ChaseSystem` is, owning the
subtitle and a discovered count. The director can keep overriding it during the
story if you want the narrator's voice on the first one. Without this, every
landmark you build in B1 is invisible to a player who reached it by any path except
the scripted one.

**A3 — Give felling a sound and a weight.**
`tree:damaged` and `tree:felled` are unheard. Audio already has a stinger path and a
collision channel; `camera:shake` already has a `landing` profile
(`camera.js:203`, amplitude 0.3). A splinter on damage, a heavy settle on the fell,
a shake on both. The mechanic currently has the best comment block in the codebase
and no sound at all.

**A4 — Move the disguise prompt into the story layer.**
`GİZLENDİN · ATMAK İÇİN BOŞLUK + GAZ` is emitted from inside `trees.js:255` — a
world system writing player-facing prose. It works, but it is the one place the
data/code separation leaks. `vehicle:disguised` already carries everything needed.
While you are there: `audio.setDucking()` while a tree is worn, so hiding *sounds*
like hiding.

**A5 — Acknowledge the edge.**
`SURFACES.VOID` is authored as "deliberately wrong-feeling" and the player has no
way to know they found it. One beat on the first frame `player.surface.id === 'VOID'`
is the whole feature. This is the strongest existing secret in the game and it
currently reads as a missing collider.

**A6 — `?scene=chase` should stage the arrival.**
`SCENES.chase` calls `startChase()` immediately, so two cars materialise 145 m
behind a stationary player facing the other way and the debug scene shows an empty
road. The told version gets this right (`sirenToSpawn: 6.5`, sound before sight);
the debug scene should borrow it.

### About a week

**B1 — Build the five missing landmarks. Do this before anything else on this list.**

`_placeLandmarks()` already positions them; `_buildMast()` is the pattern —
build geometry, add to `this.root`, insert a collider. Each is 40–200 triangles in
the existing `GeomBuilder` idiom. In order of value per hour:

- **`Taşlar` — "stones in a ring."** Twelve `createRock()` variants placed on a
  circle by hand instead of by `Scatter`. Zero new geometry: the *placement* is the
  entire content, and rocks that are obviously arranged is the strongest possible
  "somebody was here" signal available for free. Half a day.
- **`Sırt` — "the ridge."** A viewpoint. `Terrain.shaper` is already a chainable
  hook (`world.js:106`) — a landmark can shape terrain exactly the way a track does.
  From the top you should be able to see the mast and the lit stage. This is what
  replaces the minimap the HUD deliberately refuses to draw: the world becomes a map
  in the player's head. One day.
- **`Vadi` — "the valley floor."** Where the wrecks concentrate. A second
  `Scatter.place({ kind: 'wreck', region: { inner, outer } })` around it plus a
  handful of hand-placed ones. Half a day, and it is where Direction A's plot
  becomes visible without a word of text.
- **`Kenar` — "where the fog does not lift."** No geometry at all. A local fog
  override — the theme system already cross-fades fog per theme, so a
  proximity-driven push toward `glitch`'s fog is nearly free, and it is the only
  honest use of `glitch` outside the two seconds it currently gets. One day.
- **`Göl` — "still water."** The only one needing new material work, and the
  material is already there: `materials.get('water')` exists (`materials.js:24,110`)
  and `TERRAIN_SHAPE.waterLevel` is already `-6`. A flat quad at the water level in
  a shaped depression, a `MUD` ring around it. Also the only place in the world
  where a car can be stopped by something that is not a tree. One to two days.

While in there, give the landmark defs a `build:` field so `_placeLandmarks()` stops
special-casing the mast by name (`world.js:222`).

**B2 — `MastSystem`, and a switch.**
`TrackLighting` already has `setPower` / `blackout` / `hold`, and `World.lighting`
is a `Map` of rigs. A system that owns the mast's power state and can bring all
three rigs up from one place is ~80 lines, emits `mast:powered`, and finally gives
`lighting:restored` a listener. This is the single best use of infrastructure that
is already built and currently drives one scripted beat.

**B3 — The act two director.** Structurally small (see above). The writing is the
work, not the code.

**B4 — Traces of the other car.** Direction B, demoted. A fresher poster variant, a
stripped wreck, a `hatchback`-shaped wreck in a colour close to the player's, each
with a landmark-style radius and one beat. No AI, no second vehicle, no companion.

**B5 — Weather as a theme.**
`setTheme(name, seconds)` cross-fades an entire colour world without touching a
mesh, and `PACE.gripScale` is already a global grip multiplier. A `rain` theme
inheriting `night`, plus a scoped grip scale, is a genuinely new drive feel for
maybe 150 lines. **Scope it to post-breakout only** — rain during the races would
either make the SLICK corner survivable or make race 1 lethal, and `npm test` drives
that corner with a simulated human and asserts they come off.

### A rewrite

**C1 — A save.** There is no persistence except `settings.js`. Act two needs a
world you can come back to, and `game.flags` is currently write-only. This is the
one piece of plumbing act two cannot fake, and it is where the deletable-story
contract gets its real test: the save must live in the game, not in the director,
or deleting `src/game/act2/` breaks loading. Budget a week and expect the design
argument (what is a save in a game with no checkpoints?) to take longer than the
code.

**C2 — Streaming terrain / a larger world.** Tempting and wrong. `world.js:11`
states the premise: *"Nothing is streamed in behind them, because nothing was ever
streamed in."* Everything builds once in ~200 ms. If the world needs to feel bigger,
make it **denser**, not wider — B1 makes 2.86 km feel larger than 6 km of the same
forest would.

**C3 — Vehicle damage.** Trees have a damage model and the car does not, which looks
like an inconsistency and is not one. `CHASE.mercyAfter` exists specifically to
guarantee the chase is a scene rather than a skill check; a car that can be destroyed
turns every chase into a fail state and every fail state needs a retry, and a retry
needs a checkpoint, and a checkpoint is `RETURNING TO LAST VALID POSITION`. That
sentence is a story beat in this game. Do not make it a mechanic.

**C4 — The other side of the fog.** A second world past `Kenar`. See §4.6.

---

## 4. What NOT to build

### 4.1 Wanted levels, garages, a crime economy

The recovery units are an institutional failure that happens once. Turning them into
a renewable resource with escalating tiers converts the most specific thing about
this game into the most generic. Concretely: `CHASE.mercyAfter: 150` and
`mercyRate: 1.9` exist so the player always wins — the chase has somewhere it needs
to get to. A wanted system needs the opposite: chases you can lose, and stakes that
scale. You cannot have both, and the one that is already built is better.

Also: money implies purchase implies progression implies a reason to grind, in a
game whose thesis is that there are no longer any reasons.

### 4.2 A minimap, quest markers, or a landmark compass

`Hud#setMinimap()` exists and is *deliberately never called*. The comment at
`hud.js:315` is not a TODO, it is policy: *"a map is exactly the wrong thing to hand
a player whose whole arc is discovering the world has no edges."* That is correct
and it extends to objective markers, waypoint arrows and a discovered-landmark list.

If the answer to "the player is lost" needs to exist, it is `Sırt` — a hill you can
see the mast from. Navigation by landmark is the mechanic; a UI that does it for you
deletes the mechanic and the theme in one commit.

### 4.3 More races

The game has three parkours and the third one's job is to end racing. A time-attack
mode, a free-roam race series or an "open world event" re-teaches the exact lesson
the breakout spent forty minutes un-teaching: that there is a scored activity and
you should be doing it. If you want more driving, add **places**, not events.

The rivals lapping forever, indifferent, are the correct amount of racing left in
this game.

### 4.4 Fixing the "inconsistencies" in `TREES`

Two will look like bugs to a fresh reader and are neither:

- **`TREES.playerOnly`** — cops cannot damage trunks. Otherwise recovery units
  plough through the forest, fell trees onto themselves, and the player's one
  advantage becomes a slapstick routine happening to somebody else.
- **`TREES.breakableBy: ['chase:escaped', 'intro:finished']`** — the forest is
  indestructible for the whole opening. `gameplay.js:198` says why: felling would
  *"teach the player that scenery is destructible at exactly the moment the game is
  pretending to be a racing game"*, and the first chase is meant to be won by
  breaking line of sight, not by wearing a hat. Make trees fellable earlier and the
  reveal lands as a feature rather than as a discovery.

Both are gated by event name in config, which makes them look like knobs. They are
not knobs.

### 4.5 A difficulty setting, or anything that makes parkur 3 survivable

Already flagged in the README, restated here because it is the failure mode with no
error message. `maxLateralAccel`, `SURFACES.SLICK.grip` and `track3.patches` are the
game. A "hard mode" that also ships an "easy mode" with more grip ships a build where
the third parkour is a race you win and the game has no second half — silently, with
151/151 still passing if somebody weakened the assertion instead of the number.

### 4.6 Anything past `Kenar`

The strongest instinct after playing act one is "and then you drive through the fog
and there is something on the other side". There must not be. The fog wall is the
same statement as `RESET FAILED`: the system has run out of places to put you. A
second area behind it makes the first area a level, retroactively. `VOID` — flat,
featureless, and slightly *too good to drive on* — is already the correct answer,
and it costs nothing because it is already implemented.

The only thing to add out there is acknowledgement (A5). Never destination.

### 4.7 Multiplayer, ghosts, leaderboards

`Tek`. Also: the rivals already are the ghosts, and they are better as ghosts than
any recorded lap would be, because they are still racing a race that ended for you.

### 4.8 A dialogue system, choices with a UI, readable posters, a browsable terminal

`createPoster()`'s comment is the best writing in this repo: *"The player never gets
to find out who is missing, which is the point."* Hold that line everywhere. The
radio should broadcast a **schedule**, not an explanation. The `alone` beat is three
subtitles and a full stop; every branch this game needs is a boolean and a theme
call. A conversation UI would be the first element in the game that waits for the
player, and this game never waits for the player.

### 4.9 Modernising the render preset

`psx` is not a filter over the game, it is the reason a 40-triangle poster reads as a
poster. `vertexSnap: 140` and `colorLevels: 32` are doing narrative work: they are
why the world looks *authored and cheap*, which is what makes "nobody built this to
be looked at closely" land. `clean` exists for debugging geometry. It is not an
upgrade path.

### 4.10 Fast travel

The distance between the mast and the tracks is the content. A game where reaching
`Kenar` costs four minutes of driving through identical forest is a game where
`Kenar` means something.

---

## 5. Recommended order

### Phase A — pay off what is already built (a week, no story required)

```
A1 pursuit meter ──┐
A3 tree audio      ├── independent, do in any order
A4 disguise beat   │
A6 scene=chase ────┘
A2 landmark system ──── blocks all of Phase B
A5 the edge ──────────── wants A2's subtitle plumbing but can precede it
```

**A2 is the gate.** Every landmark built in Phase B is invisible without a listener
that outlives the intro director. Do it second, right after A1.

### Phase B — give the world somewhere to go (two to three weeks)

```
B1 landmarks ─── Taşlar → Sırt → Vadi → Kenar → Göl
     │              (cheapest first; Göl last, it needs the water material)
     ├──► B2 MastSystem      (wants Kule reachable and worth reaching)
     └──► B4 traces          (needs somewhere to put them)
B5 weather ───── independent, but only ship it gated post-breakout
```

Phase B is the highest-value block in this document and it needs no narrative
decisions at all. A world with five real places in it is a better game today, and it
is the prerequisite for every version of act two — including the one you write
instead of Direction A.

### Phase C — the second act (open-ended)

```
C1 save ──► B3 act2 director ──► the beats
```

B3 can be prototyped before C1 as long as it is single-session; do not ship it that
way. Write the beats file first and the director second, exactly as `beats.js` and
`introDirector.js` were — the script is the design document for the staging, not the
other way round.

### If you only have one afternoon

A1 (two lines — the pursuit meter has never been visible), then A2, then start
`Taşlar`. Twelve rocks in a circle is the smallest change in this document that
makes the open world feel like somebody had been there.

### Tests

`npm test` is 151/151 and the corner assertion is the guard rail on all of Phase A
and B5 — run it after anything that touches `tuning.js`, `track3.js` or `PACE`.
Phase B wants two new checks and they are cheap: every landmark has geometry under
`world.root`, and every landmark with a collider inserted it into the grid. That
turns "five of six landmarks are stubs" into a thing the suite would have told you.
