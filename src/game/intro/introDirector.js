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
 *   race 1 → race 2 → race 3 → the slide → the failed reset → the open world
 *   → thirty seconds of quiet → sirens → two cars → the escape → alone.
 * Then it detaches itself and the game is yours.
 */

import * as THREE from 'three';
import { Subscriptions, events } from '../../core/events.js';
import { RaceMode } from '../modes/raceMode.js';
import { OpenWorldMode } from '../modes/openWorldMode.js';
import { BEATS, INTRO_TIMING as T, getBeat } from './beats.js';
import { BREAKOUT, OPEN_WORLD, RACE } from '../../config/gameplay.js';
import { RACE_ORDER, trackById } from '../../world/tracks/index.js';
import { clamp01, lerp } from '../../core/mathx.js';

const PHASES = ['boot', 'title', 'race1', 'race2', 'race3', 'breakout', 'free', 'siren', 'chase', 'after', 'done'];

export class IntroDirector {
  /** @param {import('../game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.subs = new Subscriptions();
    this.phase = 'boot';
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
  }

  // -- lifecycle ------------------------------------------------------------

  attach() {
    if (this.attached) return this;
    this.attached = true;
    const g = this.game;

    g.modes.register('race', RaceMode);
    g.modes.register('openWorld', OpenWorldMode);

    this.subs
      .on('race:finished', (p) => this._onRaceFinished(p))
      .on('race:offCourse', (p) => this._onOffCourse(p))
      .on('chase:escaped', () => this._onChaseEscaped())
      .on('chase:lost', () => this._onChaseLost())
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

    // Park a car on the first grid so the title screen has something to look at.
    const t1 = g.world.getTrack('track1');
    const slot = t1.gridSlot(0, RACE.gridRowGap, RACE.gridColumnGap);
    const showcase = g.spawnVehicle({ kind: 'player', color: g.theme.vehicles.player, id: 'showcase' });
    showcase.reset(slot.position, slot.heading);
    g.camera.setTarget(showcase);

    this._play('title.tagline');
    // Pass the menu explicitly rather than relying on the UI's defaults — the
    // ids below are the director's contract with the title screen.
    const action = await g.ui.screens.showTitle({
      tagline: 'Üç parkur · Orman devresi',
      items: [
        { id: 'start', label: 'BAŞLA' },
        { id: 'freeRoam', label: 'SERBEST SÜRÜŞ' },
      ],
    });
    if (action === 'skip' || action === 'freeRoam') {
      // The player asked to skip the story. Honour it completely.
      await this._handOver({ skipped: true });
      return;
    }

    await this._runRace('track1', 'race1', 'race1.pre', 'race1.post');
    await this._runRace('track2', 'race2', 'race2.pre', 'race2.post');
    await this._runRace('track3', 'race3', 'race3.pre', null);
    // Race 3 does not end. `_onOffCourse` takes it from here.
  }

  async _runRace(trackId, phase, preBeat, postBeat) {
    const g = this.game;
    this._setPhase(phase);
    this._racePost = postBeat;
    this._raceResolved = null;

    await g.modes.switchTo('race', {
      trackId,
      // Race 3's ending is the director's, not the results screen's.
      showResults: trackId !== 'track3',
      countdown: true,
    });
    this._play(preBeat);

    // Resolves when this race reports a finish (or, for track 3, never — the
    // breakout resolves it instead).
    await new Promise((resolve) => {
      this._raceResolved = resolve;
    });
    if (postBeat) this._play(postBeat);
    await this._wait(T.betweenRaces);
  }

  _onRaceFinished(p) {
    this.game.flags.racesCompleted++;
    if (this._raceResolved) {
      const r = this._raceResolved;
      this._raceResolved = null;
      r(p);
    }
  }

  // -- THE BREAK ------------------------------------------------------------

  _onOffCourse(p) {
    if (this.phase !== 'race3' || !p.isPlayer) return;
    // Generous on purpose: a long slide OR a sustained excursion both count.
    const far = p.distance > BREAKOUT.escapeDistance;
    const sustained = p.distance > 30 && p.duration > BREAKOUT.escapeHoldSeconds;
    if (!far && !sustained) return;

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
    //    No fade, no load, no reset — this is the whole trick.
    await g.modes.switchTo('openWorld', { keepPlayer: true, keepRacers: true, rig: 'chaseWide' });
    g.world.setBarriersEnabled('track3', false);

    g.loop.effectTimeScale = 1;
    g.input.setLocked(false);
    await this._rampGlitch(1.0, 0, T.glitchRelease);
    g.setTheme('outside', 3.5);
    g.audio.setAmbience('outside');
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

    // Driving back to a parkour you raced is the payoff for the whole premise.
    if (g.player && this._time - this._trackFoundAt > T.trackFoundCooldown) {
      const t = g.world.onAnyTrack(g.player.position.x, g.player.position.z);
      if (t && t.id !== 'track3') {
        this._trackFoundAt = this._time;
        this._play('wander.trackFound');
      }
    }

    // The thirty seconds.
    if (!this._sirenArmed && this._freeTime >= OPEN_WORLD.sirenDelay && !g.boot.noCops) {
      this._sirenArmed = true;
      this._startSirens();
    }
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
      await g.modes.switchTo('openWorld', { keepPlayer: false, rig: 'chaseWide' });
      g.flags.escaped = true;
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
