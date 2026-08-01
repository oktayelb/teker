/**
 * RACE MODE — a normal race on a normal track.
 *
 * This file has no idea the game is going to break. It runs a countdown, tracks
 * laps and checkpoints, sorts the standings, and shows a results screen. That
 * is all it will ever do.
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
    // Off-course tracking.
    this.offTrackTime = 0;
    this.offCourseTime = 0;
    this.offCourseDistance = 0;
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
    /** @type {Progress[]} */
    this.progress = [];
    this.rivals = [];
    this.state = 'grid'; // grid → countdown → racing → finished
    this.time = 0;
    this.laps = RACE.laps;
    this.subs = new Subscriptions();
    this._query = {};
    this._results = null;
    /** When false, finishing does not show a results screen — the director
     *  wants to handle the ending itself. */
    this.showResults = true;
    this.autoAdvance = null;
  }

  /**
   * @param {object} params
   * @param {string} params.trackId
   * @param {number} [params.laps]
   * @param {number} [params.rivals]
   * @param {boolean} [params.showResults]
   * @param {boolean} [params.countdown]
   */
  async enter(params = {}) {
    const g = this.ctx;
    this.track = g.world.setActiveTrack(params.trackId);
    if (!this.track) throw new Error(`RaceMode: unknown track "${params.trackId}"`);
    this.laps = params.laps ?? this.track.laps ?? RACE.laps;
    this.showResults = params.showResults !== false;
    this.autoAdvance = params.autoAdvance ?? null;

    g.clearVehicles();
    g.useModeRig('race', true);
    g.ui.hud.setMode('race');
    g.ui.hud.setLap({ lap: 1, total: this.laps });

    const rivalCount = params.rivals ?? RACE.rivals;
    const theme = g.theme;

    // Player takes pole's inside line; the AI fills the grid behind.
    const playerSlot = this.track.gridSlot(0, RACE.gridRowGap, RACE.gridColumnGap);
    const player = g.spawnVehicle({ kind: 'player', color: theme.vehicles.player, id: 'player', isPlayer: true });
    player.reset(playerSlot.position, playerSlot.heading);
    g.setDriver(player, (v) => (this.state === 'racing' ? g.input.state : ZERO_COMMAND));

    for (let i = 0; i < rivalCount; i++) {
      const slot = this.track.gridSlot(i + 1, RACE.gridRowGap, RACE.gridColumnGap);
      const rival = g.spawnVehicle({
        profile: 'rival',
        kind: 'rival',
        color: theme.vehicles.rivals[i % theme.vehicles.rivals.length],
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

    g.audio.setAmbience('forest');
    g.audio.setMusic('race');
    g.audio.startEngine();

    events.emit('race:ready', { trackId: this.track.id, name: this.track.name, laps: this.laps });

    if (params.countdown !== false) await this._countdown();
    else this._go();
  }

  async _countdown() {
    this.state = 'countdown';
    await this.ctx.ui.screens.showCountdown(RACE.countdownSeconds);
    this._go();
  }

  _go() {
    this.state = 'racing';
    this.time = 0;
    for (const p of this.progress) p.lapStart = 0;
    events.emit('race:started', { trackId: this.track.id, laps: this.laps });
  }

  async exit() {
    this.subs.dispose();
    this.ctx.world.setActiveTrack(null);
    this.ctx.ui.hud.setWarning(null);
    this.ctx.ui.hud.setMode('none');
    this.progress.length = 0;
    this.rivals.length = 0;
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
          duration: p.offCourseTime,
          lap: p.lap,
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
      trackId: this.track.id,
      trackName: this.track.name,
      position: playerProgress.place,
      total: this.progress.length,
      laps: this.laps,
      totalTime: playerProgress.finishTime,
      bestLap: playerProgress.bestLap === Infinity ? null : playerProgress.bestLap,
    };
    events.emit('race:finished', this._results);

    if (!this.showResults) return;
    await g.ui.screens.showRaceResults({ ...this._results, next: this.autoAdvance ? 'NEXT RACE' : 'CONTINUE' });
    if (this.autoAdvance) g.modes.switchTo(this.autoAdvance.mode, this.autoAdvance.params);
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
