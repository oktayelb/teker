/**
 * INTRO DIRECTOR — the one-time opening, and nothing else.
 *
 * THE CONTRACT
 * ------------
 * Files under `src/game/intro/` may import from anywhere in the project.
 * NOTHING outside this folder may import from here. Verified by `npm test`.
 *
 * The director only ever does two things:
 *   1. listens to events the game already emits, and
 *   2. calls public methods the game already exposes.
 *
 * It never reaches into a mode's internals. `RaceMode` does not know a story is
 * being told over the top of it; it just reports that a car is a long way off
 * course, the way it would for any car on any track. Delete this folder and
 * `main.js` boots straight into free-roam with everything intact.
 *
 * WHAT IT STAGES
 *   every level in `src/levels/`, in order, until one of them says it breaks
 *   → the slide → the failed reset → the open world → thirty seconds of quiet
 *   → sirens → two cars → the escape → alone.
 * Then it detaches itself and the game is yours.
 *
 * IT DOES NOT HOLD A LIST OF RACES. It walks `LEVELS`, and a level that
 * carries `story.breaks` is the one the game stops pretending on. Adding a
 * fourth level puts a fourth race in the opening without this file changing;
 * moving the break is moving one flag in a level file. The only thing here that
 * is still per-level is the *writing* — subtitle beats, looked up by convention
 * as `<levelId>.pre` and `<levelId>.post`, and simply absent (and silent) for a
 * level nobody has written lines for yet. See `beats.js`.
 */

import * as THREE from 'three';
import { Subscriptions, events } from '../../core/events.js';
import { RaceMode } from '../modes/raceMode.js';
import { OpenWorldMode } from '../modes/openWorldMode.js';
import { BEATS, INTRO_TIMING as T, getBeat } from './beats.js';
import { BREAKOUT, OPEN_WORLD, RACE } from '../../config/gameplay.js';
import { LEVELS, FREE_ROAM_LEVEL, resolveLevel, nextLevel } from '../../levels/index.js';
import { levelMenuItems } from '../levelProgress.js';
import { clamp01, lerp } from '../../core/mathx.js';

/**
 * `race` is one phase however many levels there are; which level it is racing
 * lives in `this.level`. A phase per level would mean editing this list every
 * time somebody adds one, which is exactly the tangle levels are meant to end.
 */
const PHASES = ['boot', 'title', 'race', 'breakout', 'free', 'siren', 'chase', 'after', 'done'];

export class IntroDirector {
  /** @param {import('../game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.subs = new Subscriptions();
    this.phase = 'boot';
    /** @type {object|null} the level being raced during the `race` phase. */
    this.level = null;
    this.attached = false;

    this._timers = [];
    this._time = 0;
    this._phaseTime = 0;
    this._played = new Set();
    this._wanderTimer = 0;
    this._wanderIndex = 1;
    this._freeTime = 0;
    this._sirenArmed = false;
    this._chase = null;
    this._everHidden = false;
    this._trackFoundAt = -Infinity;
    /** The dome reveal is once, ever. True while it is on screen. */
    this._domeShotPlayed = false;
    this._domeShotRunning = false;
    /** Set to a title-menu id to skip the menu entirely (see `?start=`). */
    this.startAt = null;
    /** A level the player picked from BÖLÜMLER mid-race; see `_onLevelSelected`. */
    this._jumpTo = null;
  }

  // -- lifecycle ------------------------------------------------------------

  attach() {
    if (this.attached) return this;
    this.attached = true;
    const g = this.game;

    g.modes.register('race', RaceMode);
    g.modes.register('openWorld', OpenWorldMode);

    this.subs
      // Crossing the line scores it; pressing on is what moves the story.
      .on('race:finished', () => this.game.flags.racesCompleted++)
      .on('race:dismissed', (p) => this._onRaceDismissed(p))
      .on('race:offCourse', (p) => this._onOffCourse(p))
      // BÖLÜMLER, from the pause menu. The game does not switch the level
      // itself while a story is being staged — it says which one was asked
      // for and lets whoever is sequencing races put it in the right place.
      .on('game:levelSelected', (p) => this._onLevelSelected(p))
      .on('chase:escaped', () => this._onChaseEscaped())
      .on('chase:lost', () => this._onChaseLost())
      // The world reveals its own domes; the director only stages the shot.
      .on('world:domesRevealed', (p) => this._onDomesRevealed(p))
      .on('world:landmark', (p) => this._onLandmark(p));

    return this;
  }

  /** Remove every trace of the director. The game keeps running. */
  detach() {
    this.subs.dispose();
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
    this.attached = false;
    this.phase = 'done';
    events.emit('intro:finished', {});
  }

  /** Called every frame by main.js. */
  update(dt) {
    if (!this.attached) return;
    this._time += dt;
    this._phaseTime += dt;

    switch (this.phase) {
      case 'race':
        this._watchForBlackout(dt);
        break;
      case 'free':
        this._updateFree(dt);
        break;
      case 'chase':
        this._updateChase(dt);
        break;
    }
  }

  // -- staging --------------------------------------------------------------

  /** Entry point. Runs the whole opening. */
  async run() {
    this.attach();
    const g = this.game;

    this._setPhase('title');
    g.setTheme('forest', 0);
    g.audio.setAmbience('forest');
    g.audio.setMusic('menu');
    g.camera.setRig('cinematic', true);
    // No lap counter over the title — nothing has started yet.
    g.ui.hud.setMode('none');

    // Park a car on the first grid so the title screen has something to look
    // at. Whatever the first level is, the game has already built its map.
    const first = g.world.mainTrack;
    const slot = first.gridSlot(0, RACE.gridRowGap, RACE.gridColumnGap, RACE.poleGap);
    const showcase = g.spawnVehicle({ kind: 'player', color: g.theme.vehicles.player, id: 'showcase' });
    showcase.reset(slot.position, slot.heading);
    g.camera.setTarget(showcase);

    // Pass the menu explicitly rather than relying on the UI's defaults — the
    // ids below are the director's contract with the title screen.
    //
    // BÖLÜMLER resolves to a level id, which is the same thing `?start=` hands
    // over: "race this one, then everything after it". Backing out of the list
    // simply asks the title again, which is why this is a loop.
    let action = this.startAt;
    while (!action) {
      this._play('title.tagline');
      const choice = await g.ui.screens.showTitle({
        tagline: `${LEVELS.length} parkur · Orman devresi`,
        items: [
          { id: 'start', label: 'BAŞLA' },
          { id: 'levels', label: 'BÖLÜMLER' },
          { id: 'freeRoam', label: 'SERBEST SÜRÜŞ' },
        ],
      });
      if (choice === 'levels') {
        action = await g.ui.screens.showLevelSelect({ items: levelMenuItems() });
      } else {
        action = choice;
      }
    }

    if (action === 'skip' || action === 'freeRoam') {
      // The player asked to skip the story. Honour it completely.
      await this._handOver({ skipped: true });
      return;
    }

    // Start part-way in. `?start=level3` / `?start=3` / the menu item all mean
    // "skip the warm-up races and keep everything downstream" — the blackout,
    // the breakout, the sirens and the chase are unchanged.
    const from = action === 'start' ? null : resolveLevel(action) || resolveLevel(String(action).replace(/^race/, ''));
    let level = from || LEVELS[0];
    if (from) g.flags.racesCompleted = LEVELS.indexOf(from);

    // Not a for-loop over a fixed queue: BÖLÜMLER can redirect the running
    // order at any point (see `_onLevelSelected`), and "which level is next"
    // has to be a question asked after each race rather than a list decided
    // before the first one.
    for (;;) {
      const after = nextLevel(level.id);
      const last = level.story?.breaks || !after;
      await this._runRace(level, {
        // A race on the map that is ALREADY standing does not fade: the title
        // screen is parked on that very grid, so cutting to it reads as the
        // camera settling rather than as a load. Every other one crosses to a
        // map that has to be built, and the black is what it is built behind.
        fade: level.id !== g.levels.currentId,
        nextLabel: last ? undefined : 'SONRAKİ YARIŞ',
      });
      // A level picked from the pause menu outranks both the break and the
      // running order — the player asked to be somewhere else.
      if (this._jumpTo) {
        level = this._jumpTo;
        this._jumpTo = null;
        continue;
      }
      // A level that breaks never resolves: `_onOffCourse` takes the story
      // from here, and nothing after this loop runs.
      if (level.story?.breaks || !after) return;
      level = after;
    }
  }

  /**
   * BÖLÜMLER while a race is on. Two cases, and the difference is whether there
   * is still a queue to redirect:
   *
   *   during a race → drop the level that is running and take the new one as
   *     the next in the running order, so everything downstream (the break, the
   *     sirens, the chase) still happens — exactly like `?start=`.
   *   after the races → there is nothing left to sequence, so stop directing
   *     and hand the player over to the level they asked for. Detaching emits
   *     `intro:finished`, which is what tells the game to stop routing level
   *     select through here at all.
   */
  async _onLevelSelected(p) {
    const level = resolveLevel(p?.levelId);
    if (!level || !this.attached) return;

    if (this.phase === 'race') {
      this._jumpTo = level;
      this.game.flags.racesCompleted = LEVELS.indexOf(level);
      // Unblock `_runRace`, which is sitting on `race:dismissed` for a race
      // that is not going to finish.
      this._onRaceDismissed({ jumped: true, levelId: level.id });
      return;
    }

    this.detach();
    await this.game.modes.switchTo('race', { levelId: level.id });
  }

  /**
   * One level, start to finish, at the pace of a person rather than a loader.
   *
   *   fade to black → build the level's map → fade in → name the parkour →
   *   hold → 3·2·1·GO → [the race] → the finish breathes → results, waiting on
   *   ENTER → the closing line → hold → the next one.
   *
   * Every one of those steps is a wait the player can feel. Cutting straight
   * from a finish line to the next countdown is what made three races read as
   * one long menu.
   *
   * THE BLACK IS ALSO THE LOAD. Each level owns a map, so the swap between two
   * races is a world being built (see `src/game/levels.js`) — which is why the
   * fade goes out before `switchTo` and only comes back after it. The loading
   * panel the host raises lives behind that curtain.
   *
   * @param {object} level a resolved level from `src/levels/`
   */
  async _runRace(level, { fade = true, nextLabel } = {}) {
    const g = this.game;
    this._setPhase('race');
    this.level = level;
    this._raceResolved = null;
    this._blackoutDone = false;

    // Black over the swap. Building a grid in full view of the player is the
    // one moment the illusion of a continuous place is cheapest to break.
    if (fade) await g.ui.screens.fadeTo('#05070a', T.raceFadeOut);
    await g.modes.switchTo('race', {
      levelId: level.id,
      // The ending of the level that breaks is the director's, not the results
      // screen's — there is no result, because there is no finish.
      showResults: !level.story?.breaks,
      nextLabel,
      // Hold on the grid: the fade-in below has to finish before the lights go
      // out, or the countdown plays behind the curtain. See RaceMode#startCountdown.
      countdown: 'deferred',
    });
    if (fade) await g.ui.screens.fadeTo(null, T.raceFadeIn);

    // Name the parkour while the player is still sitting on the grid looking
    // at it, then let it sit for a beat before the countdown takes over.
    this._play(this._beat(level, 'pre'));
    await this._wait(T.gridHold);
    await g.modes.current?.startCountdown?.();

    // Resolves when the player has seen the result and pressed on — NOT when
    // the line is crossed. On the level that breaks it never resolves; the
    // breakout does.
    await new Promise((resolve) => {
      this._raceResolved = resolve;
    });
    // Nothing closes a race the player walked out of: the line about how that
    // one went belongs to a race that was actually finished.
    if (this._jumpTo) return;
    this._play(this._beat(level, 'post'));
    await this._wait(T.betweenRaces);
  }

  /**
   * A level's beat id for a moment in its race.
   *
   * By convention — `level3.blackout` is the blackout line for `level3` — so a
   * new level's writing is entries in `beats.js` and nothing else, and a level
   * with no writing yet plays nothing rather than throwing. A level may name
   * its beats explicitly in `story.beats` if it wants to share another's.
   */
  _beat(level, moment) {
    return level?.story?.beats?.[moment] ?? `${level?.id}.${moment}`;
  }

  _onRaceDismissed(p) {
    if (this._raceResolved) {
      const r = this._raceResolved;
      this._raceResolved = null;
      r(p);
    }
  }

  // -- THE BREAK ------------------------------------------------------------

  /**
   * Watch the player round the parkour that breaks and cut the lights at the
   * scripted point. Called from `update()`; `race:offCourse` handles what
   * happens after. On any level that does not break, `track.data.breakout` is
   * absent and this is a couple of property reads per frame.
   */
  _watchForBlackout(dt) {
    if (this.phase !== 'race' || this._blackoutDone || !this.level?.story?.breaks) return;
    const g = this.game;
    // `world` is genuinely null while a level's map is being built — the old
    // one is disposed before the new one exists (see `src/game/levels.js`), and
    // the loop keeps running behind the loading screen. Everything the director
    // reads per frame has to survive that gap.
    const track = g.world?.mainTrack;
    const player = g.player;
    if (!track?.data?.breakout || !player) return;

    const q = track.query(player.position.x, player.position.z, this._q || (this._q = {}));
    if (!q) return;

    const cfg = track.data.breakout || {};
    const at = cfg.blackoutAt ?? 0.44;
    // A window, not an instant — the player can be doing 40 m/s through here.
    if (q.progress < at || q.progress > at + 0.05) return;

    this._blackoutDone = true;
    this._cutTheLights(track, cfg);
  }

  async _cutTheLights(track, cfg) {
    const g = this.game;
    const rig = g.world.lighting.get(track.id);

    events.emit('intro:blackout', {});
    // The rig stutters and dies. It does not come back before the corner.
    rig?.blackout(cfg.blackoutSeconds ?? 9);
    g.audio.playGlitchStinger?.();
    g.setGlitch(0.28);
    this._play(this._beat(this.level, 'blackout'));

    // Headlights. The reason they were off is that they were never needed:
    // the route was lit for you, right up until it wasn't.
    await this._wait(0.55);
    g.player?.chassis?.setHeadlights(true);
    events.emit('ui:subtitle', { text: 'FARLAR', duration: 1.4, tone: 'system' });

    await this._wait(0.9);
    g.setGlitch(0);
  }

  _onOffCourse(p) {
    // Only on the level that breaks. Running wide on bölüm 1 is running wide.
    if (this.phase !== 'race' || !this.level?.story?.breaks || !p.isPlayer) return;

    // Time it against `outOfBoundsTime`, never `duration`. `duration` counts
    // from the first centimetre past the ribbon edge, which on a dirt parkur is
    // most of the lap — so by the moment the player actually left it had been
    // running for twenty seconds, every hold below was already satisfied, and
    // the break fired the instant they crossed the distance line. The player
    // never got to be lost; the game just glitched at them.
    const out = p.outOfBoundsTime;

    // Generous on purpose, but both paths now require the player to have been
    // gone for a while: unambiguously far out, or merely out and not coming back.
    const escaped = p.distance > BREAKOUT.escapeDistance && out > BREAKOUT.escapeHoldSeconds;
    const stranded = out > BREAKOUT.strandedSeconds;
    if (!escaped && !stranded) return;

    this._breakOut();
  }

  async _breakOut() {
    if (this.phase === 'breakout') return;
    this._setPhase('breakout');
    const g = this.game;
    g.flags.escaped = true;

    this._play('breakout.slide');

    // 1. Time stumbles. Not a freeze — the car keeps moving, wrongly.
    g.loop.effectTimeScale = T.breakSlowMo;
    events.emit('camera:shake', { source: 'glitch', scale: 1 });

    // 2. The game tries to put the player back, and says so.
    this._play('breakout.reset');
    g.input.setLocked(true);
    await this._rampGlitch(0, 0.55, T.glitchAttack);
    await this._wait(0.9);

    // 3. It fails.
    this._play('breakout.resetFailed');
    await this._rampGlitch(0.55, 1.0, 0.18);
    g.setTheme('glitch', 0.4);
    await this._wait(T.glitchSustain);

    // 4. Hand over. The *same car*, still moving, now in a mode with no rules.
    //    No fade, no load, no reset — this is the whole trick, and it is why
    //    no `levelId` is passed: the open world the player breaks into is the
    //    map they were already racing on. Loading anything here would stop the
    //    car, and stopping the car is the one thing this moment cannot do.
    await g.modes.switchTo('openWorld', { keepPlayer: true, keepRacers: true, rig: 'chaseWide' });
    const track = g.world.mainTrack;
    g.world.setBarriersEnabled(track?.id, false);
    // The rig never comes back on. Drive past the stage later and it is dark.
    const rig = g.world.lighting.get(track?.id);
    rig?.hold();
    rig?.setPower(0);
    // Headlights stay on from here — it is the only light the player owns.
    g.player?.chassis?.setHeadlights(true);

    g.loop.effectTimeScale = 1;
    g.input.setLocked(false);
    await this._rampGlitch(1.0, 0, T.glitchRelease);
    // Stay in the dark. Parkur 3 runs at night (see track3.js), so brightening
    // to overcast daylight here would undo the point of the whole sequence —
    // the headlights switched on above are the only light the player owns, and
    // the sun coming up the moment they escape hands that back for free. Dawn
    // is earned later, after the chase: see `_onChaseEscaped`.
    g.setTheme('night', 3.5);
    g.audio.setAmbience('night');
    g.audio.setMusic('none');

    this._setPhase('free');
    this._freeTime = 0;
    events.emit('intro:escaped', {});

    this._after(T.freeLineDelay, () => this._play('breakout.free'));
  }

  /** Smoothly move the glitch amount over `seconds`. */
  _rampGlitch(from, to, seconds) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const t = clamp01((performance.now() - start) / (seconds * 1000));
        this.game.setGlitch(lerp(from, to, t));
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  // -- the open world -------------------------------------------------------

  _updateFree(dt) {
    const g = this.game;
    this._freeTime += dt;

    // Ambient observations, but only while the player is actually going
    // somewhere. Standing still should stay silent.
    if (g.player && g.player.speed > 6) {
      this._wanderTimer += dt;
      if (this._wanderTimer > T.wanderInterval && this._wanderIndex <= 3) {
        this._wanderTimer = 0;
        this._play(`wander.${this._wanderIndex++}`);
      }
    }

    // Driving back onto the ribbon you escaped from is the payoff for the whole
    // premise: the rivals are still going round it, still racing a race that
    // ended for you. `T.trackFoundReturn` keeps it off the first minute — the
    // player has only just slid off the thing, and being told about it while
    // the tyre marks are still behind them says nothing.
    if (
      g.player &&
      this._freeTime > T.trackFoundReturn &&
      this._time - this._trackFoundAt > T.trackFoundCooldown
    ) {
      const t = g.world?.onAnyTrack(g.player.position.x, g.player.position.z);
      if (t) {
        this._trackFoundAt = this._time;
        this._play('wander.trackFound');
      }
    }

    // The thirty seconds. Not while the camera is off the car looking at a
    // dome — two scripted moments over the top of each other is neither.
    if (this._domeShotRunning) return;
    if (!this._sirenArmed && this._freeTime >= OPEN_WORLD.sirenDelay && !g.boot.noCops) {
      this._sirenArmed = true;
      this._startSirens();
    }
  }

  /**
   * THE GLASS. Fired by the world the instant a dome closes behind the player;
   * see `DomeField#sync`. The domes are already visible by the time this runs —
   * that is the world's business, not the story's — so everything here is
   * presentation, and skipping all of it costs nothing but the shot.
   *
   * @param {{trackId: string|null, dome: object|null}} p
   */
  async _onDomesRevealed(p) {
    if (this._domeShotPlayed) return;
    this._domeShotPlayed = true;
    const g = this.game;
    const player = g.player;
    const dome = p?.dome;

    // Mid-chase, or after the director has stopped mattering, the domes just
    // appear. Taking the camera off a player who is being pursued is worse than
    // saying nothing at all.
    if (this.phase !== 'free' || !player || !dome) {
      this._play('dome.reveal');
      return;
    }

    // Stand off along the line the player came out on, so the car is in shot
    // with the whole dome behind it.
    const outX = player.position.x - dome.centerX;
    const outZ = player.position.z - dome.centerZ;
    const len = Math.hypot(outX, outZ) || 1;
    const eye = new THREE.Vector3(
      player.position.x + (outX / len) * T.domeCameraBack,
      player.position.y + T.domeCameraUp,
      player.position.z + (outZ / len) * T.domeCameraBack
    );

    const aim = new THREE.Vector3().lerpVectors(player.position, dome.apex, T.domeLookBlend);

    const rig = g.camera.rigName;
    this._domeShotRunning = true;
    g.loop.effectTimeScale = T.domeSlowMo;
    g.input.setLocked(true);
    g.camera.setStatic(eye, aim);
    this._play('dome.reveal');

    // The push-in. Slow, and over the whole hold — a snap zoom would read as a
    // cut, and the shot is meant to feel like being made to look.
    await this._rampFov(0, T.domeZoom, T.domeHold);

    g.camera.fovBias = 0;
    g.camera.clearStatic();
    g.camera.setRig(rig, true);
    g.loop.effectTimeScale = 1;
    g.input.setLocked(false);
    this._domeShotRunning = false;
  }

  /** Ease the camera's lens offset. Real time, like `_rampGlitch`. */
  _rampFov(from, to, seconds) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (!this.attached) return resolve();
        const t = clamp01((performance.now() - start) / (seconds * 1000));
        // Ease out, so most of the movement is at the front and the shot
        // settles rather than arriving.
        this.game.camera.fovBias = lerp(from, to, 1 - (1 - t) * (1 - t));
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  }

  _onLandmark(p) {
    if (this.phase !== 'free' && this.phase !== 'chase') return;
    const beat = getBeat('wander.landmark');
    if (!beat) return;
    events.emit('ui:subtitle', {
      text: beat[0].subtitle.text.replace('{label}', p.label || p.name),
      duration: beat[0].subtitle.duration,
      tone: 'neutral',
    });
  }

  // -- the chase ------------------------------------------------------------

  async _startSirens() {
    this._setPhase('siren');
    const g = this.game;

    this._play('siren.first');
    g.setTheme('night', 14);
    g.audio.setAmbience('night');
    // Sirens are audible before anything is visible: the sound arrives first.
    g.audio.startSiren('distant', { distance: 320, pan: 0 });

    await this._wait(2.4);
    this._play('siren.alert');
    await this._wait(OPEN_WORLD.sirenToSpawn - 2.4);

    g.audio.stopSiren('distant');
    const mode = g.modes.current;
    this._chase = mode?.startChase ? mode.startChase({ rig: 'chaseTight' }) : null;
    this._setPhase('chase');
    this._play('chase.start');
  }

  _updateChase(dt) {
    if (!this._chase) return;
    if (this._chase.elapsed > 60 && !this._played.has('chase.long')) {
      this._play('chase.long');
    }
  }

  _onChaseLost() {
    if (this.phase !== 'chase' || this._everHidden) return;
    this._everHidden = true;
    this._play('chase.hidden');
  }

  async _onChaseEscaped() {
    if (this.phase !== 'chase') return;
    this._setPhase('after');
    const g = this.game;
    g.flags.chaseOver = true;

    this._play('chase.escaped');
    g.camera.setRig('chaseWide');
    g.setTheme('outside', 20);
    g.audio.setAmbience('outside');

    await this._wait(T.aloneDelay);
    this._play('alone');
    await this._wait(10);

    await this._handOver({ skipped: false });
  }

  // -- handover -------------------------------------------------------------

  /**
   * The end of the director's job. From here the game is a car in a world and
   * nothing is watching it.
   */
  async _handOver({ skipped }) {
    const g = this.game;
    if (skipped) {
      g.clearVehicles();
      g.setGlitch(0);
      g.setTheme('outside', 0);
      g.audio.setAmbience('outside');
      // The map the story would have left them on. See `FREE_ROAM_LEVEL`.
      await g.modes.switchTo('openWorld', {
        levelId: g.boot.level || FREE_ROAM_LEVEL,
        keepPlayer: false,
        rig: 'chaseWide',
      });
      g.flags.escaped = true;
      // Nobody is going to narrate the glass on a boot that skipped the story,
      // so it is simply already there. `?skip=intro` does the same in main.js.
      g.world.revealDomes();
    }
    g.ui.hud.setMode('openWorld');
    this.detach();
  }

  // -- helpers --------------------------------------------------------------

  _setPhase(name) {
    if (!PHASES.includes(name)) throw new Error(`Unknown intro phase "${name}"`);
    this.phase = name;
    this._phaseTime = 0;
    events.emit('intro:phase', { phase: name });
  }

  /** Play a beat by id, at most once unless `repeat` is passed. */
  _play(id, repeat = false) {
    if (!id) return;
    if (!repeat && this._played.has(id)) return;
    this._played.add(id);
    const beats = getBeat(id);
    if (!beats) return;

    let delay = 0;
    for (const beat of beats) {
      const at = delay;
      if (beat.subtitle) {
        this._after(at, () => events.emit('ui:subtitle', { ...beat.subtitle }));
        delay += (beat.subtitle.duration ?? 2.5) * 0.85;
      } else if (beat.system) {
        this._after(at, () => events.emit('ui:systemMessage', { ...beat.system }));
        delay += (beat.system.hold ?? 2) + beat.system.lines.length * 0.45;
      } else if (beat.alert) {
        this._after(at, () => events.emit('ui:alert', { ...beat.alert }));
        delay += beat.alert.duration ?? 3;
      }
    }
  }

  _after(seconds, fn) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== id);
      if (this.attached) fn();
    }, seconds * 1000);
    this._timers.push(id);
    return id;
  }

  _wait(seconds) {
    return new Promise((resolve) => this._after(seconds, resolve));
  }
}
