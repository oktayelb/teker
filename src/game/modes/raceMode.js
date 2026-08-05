/**
 * RACE MODE — a normal race on a normal track.
 *
 * This file has no idea the game is going to break. It runs a countdown, tracks
 * laps and checkpoints, sorts the standings, and shows a results screen. That
 * is all it will ever do.
 *
 * IT DOES NOT LOAD ANYTHING. `enter({ levelId })` names a level, and by the
 * time this runs that level's map is already standing: `ModeManager#prepare`
 * built it (see `src/game/levels.js`). So the race can spawn cars in its first
 * few lines, and adding a level never means touching this file — the ribbon it
 * races is whichever one the loaded map has on it, and the rules come off the
 * level's own `race` block.
 *
 * It does, however, *report* honestly: when a car is a long way off course it
 * emits `race:offCourse` every step with how far and for how long. Race mode
 * treats that as a statistic. The intro director treats it as the end of the
 * world. Neither knows about the other.
 */

import * as THREE from 'three';
import { Mode } from '../../core/modes.js';
import { AiDriver } from '../../vehicle/ai.js';
import { events, Subscriptions } from '../../core/events.js';
import { RACE, PLAYER } from '../../config/gameplay.js';
import { clamp, clamp01, lerp } from '../../core/mathx.js';

/** Per-car race bookkeeping. */
class Progress {
  constructor(vehicle, track, checkpointCount) {
    this.vehicle = vehicle;
    this.track = track;
    this.checkpointCount = checkpointCount;
    this.lap = 0;
    this.lastProgress = track.startLine.sample / track.count;
    this.total = 0;
    this.lastCheckpoint = -1;
    this.finished = false;
    this.finishTime = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = Infinity;
    this.place = 1;
    // Off-course tracking. Three clocks, deliberately: running wide, being off
    // the course, and being somewhere the course has plainly let go of you.
    this.offTrackTime = 0;
    this.offCourseTime = 0;
    this.offCourseDistance = 0;
    this.outOfBoundsTime = 0;
    this.wrongWayTime = 0;
  }

  update(dt, time, query) {
    const v = this.vehicle;
    const t = this.track;
    const q = t.query(v.position.x, v.position.z, query);

    if (!q) {
      // Outside the track's spatial hash entirely — as far off as it gets.
      this.offCourseTime += dt;
      this.offCourseDistance = Infinity;
      this.outOfBoundsTime += dt;
      this.offTrackTime += dt;
      return null;
    }

    // -- lap / checkpoint ---------------------------------------------------
    const p = q.progress;
    let d = p - this.lastProgress;
    if (d < -0.5) {
      d += 1;
      this.lap++;
      if (this.lap > 0) {
        const lapTime = time - this.lapStart;
        this.lapTimes.push(lapTime);
        this.bestLap = Math.min(this.bestLap, lapTime);
        events.emit('race:lap', { id: v.id, lap: this.lap, time: lapTime });
      }
      this.lapStart = time;
    } else if (d > 0.5) {
      d -= 1;
      this.lap--;
    }
    this.lastProgress = p;
    this.total = this.lap + p;

    const cp = Math.floor(p * this.checkpointCount);
    if (cp !== this.lastCheckpoint) {
      const forward = ((cp - this.lastCheckpoint + this.checkpointCount) % this.checkpointCount) === 1;
      this.lastCheckpoint = cp;
      if (forward) events.emit('race:checkpoint', { id: v.id, index: cp });
    }

    // -- off course ---------------------------------------------------------
    const edge = q.dist - q.halfWidth;
    if (q.dist > q.halfWidth * RACE.offTrackFactor) this.offTrackTime += dt;
    else this.offTrackTime = 0;

    if (edge > 0) {
      this.offCourseTime += dt;
      this.offCourseDistance = edge;
    } else {
      this.offCourseTime = 0;
      this.offCourseDistance = 0;
    }

    // Out of bounds is its own clock, and it resets the moment the car is back
    // inside. Clipping the verge for twenty seconds must not count as twenty
    // seconds of having left.
    if (edge > RACE.outOfBoundsDistance) this.outOfBoundsTime += dt;
    else this.outOfBoundsTime = 0;

    // -- wrong way ----------------------------------------------------------
    const dot = v.forward.x * q.forwardX + v.forward.z * q.forwardZ;
    if (dot < -0.25 && v.speed > 4) this.wrongWayTime += dt;
    else this.wrongWayTime = 0;

    return q;
  }
}

export class RaceMode extends Mode {
  static modeName = 'race';

  constructor(ctx) {
    super(ctx);
    this.track = null;
    /** @type {object|null} the level being raced; set in `enter`. */
    this.level = null;
    /** @type {Progress[]} */
    this.progress = [];
    this.rivals = [];
    this.state = 'grid'; // grid → countdown → racing → finished
    this.time = 0;
    this.laps = RACE.laps;
    this.subs = new Subscriptions();
    this._query = {};
    this._results = null;
    this._timers = [];
    /** When false, finishing does not show a results screen — the director
     *  wants to handle the ending itself. */
    this.showResults = true;
    this.autoAdvance = null;
  }

  /**
   * @param {object} params
   * @param {string} params.levelId which level to race — its map is already
   *   loaded by the time this runs (see the header)
   * @param {string} [params.trackId] a specific ribbon, for a map with more
   *   than one. Defaults to the parkour the map was built around.
   * @param {number} [params.laps]
   * @param {number} [params.rivals]
   * @param {boolean} [params.showResults]
   * @param {string} [params.nextLabel] confirm-button text on the results panel
   * @param {boolean|'deferred'} [params.countdown] `true` counts down inside
   *   `enter()`; `false` starts racing at once; `'deferred'` holds the grid
   *   until the caller calls {@link startCountdown} — see the note there.
   */
  async enter(params = {}) {
    const g = this.ctx;
    /** @type {object|null} the level definition, for its name and its rules */
    this.level = g.levels.current;
    const trackId = params.trackId ?? g.world.mainTrack?.id;
    this.track = g.world.setActiveTrack(trackId);
    if (!this.track) {
      throw new Error(`RaceMode: level "${params.levelId ?? g.levels.currentId}" has no track "${trackId}"`);
    }
    this.laps = params.laps ?? this.level?.race?.laps ?? this.track.laps ?? RACE.laps;
    this.showResults = params.showResults !== false;
    this.autoAdvance = params.autoAdvance ?? null;
    // Race mode has no idea whether anything comes next — whoever sequenced it
    // does, so they get to name the button.
    this.nextLabel = params.nextLabel ?? (this.autoAdvance ? 'SONRAKİ YARIŞ' : 'DEVAM');

    // A level knows what time of day it is. Bölüm 3 is lit by a rig, not by
    // the sun, so it carries `theme: 'night'` — see its header. (A track may
    // still override its level, for a map with a stage on it that runs late.)
    const theme = this.track.data?.theme || this.level?.theme;
    if (theme) g.setTheme(theme, params.themeFade ?? 0);

    g.clearVehicles();
    g.useModeRig('race', true);
    g.ui.hud.setMode('race');
    g.ui.hud.setLap({ lap: 1, total: this.laps });

    const rivalCount = params.rivals ?? this.level?.race?.rivals ?? RACE.rivals;
    const palette = g.theme;

    // Player takes pole's inside line; the AI fills the grid behind.
    const playerSlot = this.track.gridSlot(0, RACE.gridRowGap, RACE.gridColumnGap, RACE.poleGap);
    const player = g.spawnVehicle({ kind: 'player', color: palette.vehicles.player, id: 'player', isPlayer: true });
    player.reset(playerSlot.position, playerSlot.heading);
    g.setDriver(player, (v) => (this.state === 'racing' ? g.input.state : ZERO_COMMAND));

    for (let i = 0; i < rivalCount; i++) {
      const slot = this.track.gridSlot(i + 1, RACE.gridRowGap, RACE.gridColumnGap, RACE.poleGap);
      const rival = g.spawnVehicle({
        profile: 'rival',
        kind: 'rival',
        color: palette.vehicles.rivals[i % palette.vehicles.rivals.length],
        id: `rival${i}`,
      });
      rival.reset(slot.position, slot.heading);
      // The rivals belong to the track. See Vehicle#ignoreSurfaces — this is
      // what lets them sail through the ice on parkur 3 while you do not.
      rival.ignoreSurfaces = true;
      const ai = new AiDriver(rival, {
        track: this.track,
        skill: lerp(0.62, 0.9, 1 - i / Math.max(1, rivalCount)),
        aggression: 0.5 + i * 0.12,
        seed: 1000 + i,
        world: g.world,
      });
      // AI is parked until the lights go out — no jump starts.
      g.setDriver(rival, (v, dt) => (this.state === 'racing' ? ai.update(dt) : ZERO_COMMAND));
      this.rivals.push({ vehicle: rival, ai });
    }

    for (const v of g.vehicles) {
      this.progress.push(new Progress(v, this.track, this.track.checkpoints.length));
    }

    // Hold the grid. Zeroing the driver commands is not enough: gravity still
    // integrates, and parkur 3 starts on a ridge, so the field creeps downhill
    // through the countdown and half of it is over the line before GO. `reset()`
    // has already seated every car exactly on the ground, so freezing here is
    // simply "stay where you were put".
    this._setGridHold(true);

    // The level says what its map sounds like. A night stage is not a forest
    // at noon, and neither is whatever the eighth one turns out to be.
    g.audio.setAmbience(this.level?.ambience || 'forest');
    g.audio.setMusic(this.level?.music ?? 'race');
    g.audio.startEngine();

    events.emit('race:ready', {
      levelId: this.level?.id ?? null,
      trackId: this.track.id,
      name: this.level?.name || this.track.name,
      laps: this.laps,
    });

    // 'deferred' leaves the cars parked on the grid. `enter()` resolves as soon
    // as the scene is built, and the caller decides when the lights go out.
    if (params.countdown === 'deferred') return;
    if (params.countdown !== false) await this._countdown();
    else this._go();
  }

  /**
   * Run the lights and release the cars.
   *
   * Only needed after `enter({ countdown: 'deferred' })`. A caller that fades to
   * black over the track swap must be able to fade back IN before the countdown
   * starts — otherwise 3·2·1·GO plays behind the curtain and the race is already
   * running by the time the player can see it.
   */
  async startCountdown() {
    if (this.state !== 'grid') return;
    await this._countdown();
  }

  async _countdown() {
    this.state = 'countdown';
    await this.ctx.ui.screens.showCountdown(RACE.countdownSeconds);
    this._go();
  }

  /**
   * Freeze/release every car on the grid. `disabled` is already honoured by
   * both `Vehicle#fixedUpdate` and `resolveVehicleContacts`, so a held car is
   * skipped by the physics entirely rather than fighting it.
   */
  _setGridHold(held) {
    for (const v of this.ctx.vehicles) v.disabled = held;
  }

  _go() {
    // A mode torn down mid-countdown must not start a race behind the next one.
    if (!this.active) return;
    this._setGridHold(false);
    this.state = 'racing';
    this.time = 0;
    for (const p of this.progress) p.lapStart = 0;
    events.emit('race:started', { levelId: this.level?.id ?? null, trackId: this.track.id, laps: this.laps });
  }

  async exit() {
    // Never hand a frozen car to the next mode — the breakout keeps the player
    // across the switch, and a mode torn down mid-countdown would strand it.
    this._setGridHold(false);
    for (const id of this._timers) clearTimeout(id);
    this._timers.length = 0;
    this.subs.dispose();
    this.ctx.world.setActiveTrack(null);
    this.ctx.ui.hud.setWarning(null);
    this.ctx.ui.hud.setMode('none');
    this.progress.length = 0;
    this.rivals.length = 0;
  }

  /**
   * What the minimap gets from a race: which ribbon is the live one, and which
   * checkpoint the player is actually driving at. Nothing else in the game
   * holds either fact.
   * @see Mode#mapState
   */
  mapState() {
    if (!this.track) return null;
    const player = this.ctx.player;
    const p = player ? this.progress.find((q) => q.vehicle === player) : null;
    const n = this.track.checkpoints.length;
    return {
      activeTrack: this.track.id,
      // `lastCheckpoint` is -1 before the first one is taken, which makes the
      // next one 0 — correct, and the reason this is not a guarded expression.
      nextCheckpoint: p && n > 0 ? (p.lastCheckpoint + 1) % n : null,
    };
  }

  fixedUpdate(dt) {
    if (this.state !== 'racing') return;
    this.time += dt;

    for (const p of this.progress) {
      if (p.finished) continue;
      p.update(dt, this.time, this._query);

      // Report anyone a long way off course. Race mode does nothing with this;
      // it exists so an observer can.
      if (p.offCourseTime > 0.25) {
        events.emit('race:offCourse', {
          id: p.vehicle.id,
          isPlayer: p.vehicle === this.ctx.player,
          distance: p.offCourseDistance,
          /** How long off the racing line at all. */
          duration: p.offCourseTime,
          /** How long genuinely out of bounds — see RACE.outOfBoundsDistance. */
          outOfBoundsTime: p.outOfBoundsTime,
          lap: p.lap,
          levelId: this.level?.id ?? null,
          trackId: this.track.id,
        });
      }

      if (p.lap >= this.laps && !p.finished) this._finish(p);
    }

    this._updateStandings();
    this._rubberBand();
  }

  _finish(p) {
    p.finished = true;
    p.finishTime = this.time;
    const isPlayer = p.vehicle === this.ctx.player;
    events.emit('race:carFinished', { id: p.vehicle.id, isPlayer, place: p.place, time: p.finishTime });
    if (isPlayer) this._finishRace(p);
  }

  async _finishRace(playerProgress) {
    this.state = 'finished';
    const g = this.ctx;
    g.audio.setMusic('none');

    this._results = {
      levelId: this.level?.id ?? null,
      trackId: this.track.id,
      trackName: this.level?.name || this.track.name,
      position: playerProgress.place,
      total: this.progress.length,
      laps: this.laps,
      totalTime: playerProgress.finishTime,
      bestLap: playerProgress.bestLap === Infinity ? null : playerProgress.bestLap,
    };
    // Two separate signals, and the difference matters:
    //   race:finished  — the moment the line is crossed. Stats, audio, records.
    //   race:dismissed — the player has SEEN the result and asked to move on.
    // A caller that sequences races must wait for the second one. Waiting for
    // the first tears the mode down while the results panel is still on screen,
    // which reads as the game skipping straight to the next race.
    events.emit('race:finished', this._results);

    if (this.showResults) {
      // Let the finish breathe: the car rolls on, the camera stays with it.
      await this._sleep(RACE.resultsDelay);
      if (!this.active) return;
      await g.ui.screens.showRaceResults({ ...this._results, next: this.nextLabel });
    }

    events.emit('race:dismissed', this._results);
    if (this.autoAdvance) g.modes.switchTo(this.autoAdvance.mode, this.autoAdvance.params);
  }

  /** Cancellable wait — a mode exit must not leave a timer running into it. */
  _sleep(seconds) {
    return new Promise((resolve) => {
      const id = setTimeout(resolve, seconds * 1000);
      this._timers.push(id);
    });
  }

  _updateStandings() {
    const sorted = [...this.progress].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.total - a.total;
    });
    for (let i = 0; i < sorted.length; i++) sorted[i].place = i + 1;
  }

  /** Keep the pack near the player without letting the AI teleport. */
  _rubberBand() {
    const playerP = this.progress.find((p) => p.vehicle === this.ctx.player);
    if (!playerP) return;
    const R = RACE.rubberBand;
    for (const { vehicle, ai } of this.rivals) {
      const p = this.progress.find((x) => x.vehicle === vehicle);
      if (!p) continue;
      const gap = (p.total - playerP.total) * this.track.length; // metres, signed
      const t = clamp(gap / R.range, -1, 1);
      ai.paceScale = t > 0 ? lerp(1, R.maxAhead, t) : lerp(1, R.maxBehind, -t);
    }
  }

  update(dt) {
    const g = this.ctx;
    const p = this.progress.find((x) => x.vehicle === g.player);
    if (!p) return;

    g.ui.hud.setSpeed(g.player.speedKmh);
    g.ui.hud.setGear(g.player.gear);
    g.ui.hud.setLap({ lap: clamp(p.lap + 1, 1, this.laps), total: this.laps });
    g.ui.hud.setPosition({ place: p.place, total: this.progress.length });
    g.ui.hud.setTime({
      current: this.time - p.lapStart,
      best: p.bestLap === Infinity ? null : p.bestLap,
    });

    let warning = null;
    if (p.wrongWayTime > RACE.wrongWayDelay) warning = 'TERS YÖN';
    else if (p.offTrackTime > 0.35) warning = 'PARKUR DIŞI';
    g.ui.hud.setWarning(warning);

    if (this.state === 'racing' && g.input.pressed('respawn') && RACE.respawnAfterOffTrack >= 0) {
      this._respawnPlayer();
    }
  }

  _respawnPlayer() {
    const g = this.ctx;
    const p = this.progress.find((x) => x.vehicle === g.player);
    if (!p) return;
    const q = this.track.query(g.player.position.x, g.player.position.z, this._query);
    const i = q ? q.index : this.track.startLine.sample;
    const t = this.track;
    g.player.reset(
      new THREE.Vector3(t.px[i], t.py[i] + 0.6, t.pz[i]),
      Math.atan2(t.tx[i], t.tz[i])
    );
    events.emit('race:respawned', { id: g.player.id });
  }
}

const ZERO_COMMAND = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: 0 });
