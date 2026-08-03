/**
 * PATROL — the roads are still policed after the story stops watching.
 *
 * A system, not a mode, attached to the open world the way `ChaseSystem` is.
 * The player never stops driving; nothing loads; there is no encounter screen.
 * One cruiser appears somewhere out of sight, works a parkour ribbon for a
 * while, and leaves. If it happens to look at you, that becomes a chase — the
 * real one, in `chase.js`. This file contains no pursuit code at all.
 *
 * NOBODY TURNS THIS ON
 * --------------------
 * It arms itself off `PATROL.armedBy`, the same events that make the forest
 * fellable and bring the wildlife out. Through the three races and the scripted
 * first chase this object exists, listens, and does nothing — so a patrol can
 * never wander into a race, and `?skip=intro` (which emits `intro:finished`)
 * gets patrols on the first lap of the free world. Whoever constructed it never
 * has to know which of those two worlds they are in.
 *
 * THE THREE STATES, AS THE PLAYER MEETS THEM
 * ------------------------------------------
 *   somewhere  — it exists, too far to hear. Costs one AI update.
 *   near       — a siren off to one side, a light bar between the trunks, and
 *                the pursuit meter waking up and stopping short of half.
 *   seen       — the meter fills, the siren is behind you, and `ChaseSystem`
 *                owns the car. There is no ambiguity between the last two.
 *
 * WHAT IT COSTS
 * -------------
 * One vehicle, forever. `maxActive` caps how many exist and `despawnDistance` /
 * `despawnHold` remove one that has stopped mattering, so an hour of roaming
 * runs exactly as fast as the first minute.
 */

import * as THREE from 'three';
import { AiDriver } from '../vehicle/ai.js';
import { events, Subscriptions } from '../core/events.js';
import { canSee } from './perception.js';
import { PATROL, TREES } from '../config/gameplay.js';
import { Rng } from '../core/rng.js';
import { clamp, clamp01 } from '../core/mathx.js';

const _spawn = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Where "the player has already been taught this" survives a reload. */
const PROGRESS_KEY = 'tekerlek.progress.v1';

export class PatrolSystem {
  /**
   * @param {import('./game.js').Game} game
   * @param {object} opts
   * @param {import('../vehicle/vehicle.js').Vehicle} opts.target the player's car
   * @param {import('./chase.js').ChaseSystem} opts.chase the escalation path
   */
  constructor(game, { target, chase }) {
    this.game = game;
    this.target = target;
    this.chase = chase;

    /** @type {{vehicle:any, ai:AiDriver, id:string, farTime:number, heard:boolean}[]} */
    this.units = [];
    /**
     * Nothing happens until the story is over. See `PATROL.armedBy` — this is
     * the same self-arming pattern as `Wildlife` and `Trees`.
     */
    this.armed = false;
    /** Seconds until the next spawn attempt. Set when armed. */
    this.cooldown = Infinity;
    /** 'clear' | 'near' | 'seen' — what the alarm is currently saying. */
    this.alarm = 'clear';

    this._rng = new Rng(0xc0ffee ^ (game.boot?.seed ?? 0));
    this._nextId = 0;
    this._hintTimer = -1;
    this._toldNear = false;

    this.subs = new Subscriptions();
    for (const ev of [].concat(PATROL.armedBy)) this.subs.on(ev, () => this.arm());
  }

  /** Is a cruiser out there right now? */
  get active() {
    return this.units.length > 0;
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Let patrols start appearing. Idempotent — both arming events fire on the
   * told-story path and only the first one may count.
   * @returns {this}
   */
  arm() {
    if (this.armed) return this;
    // `?nocops` means peace, and it has to mean it for longer than the intro.
    if (this.game.boot?.noCops) return this;
    this.armed = true;
    this.cooldown = this._pick(PATROL.firstDelay);
    events.emit('patrol:armed', {});
    return this;
  }

  /** Remove every cruiser and stop listening. Called on mode exit. */
  stop() {
    for (const u of this.units) {
      this.game.audio.stopSiren(u.id);
      this.game.despawnVehicle(u.vehicle);
    }
    this.units.length = 0;
    this._clearAlarm();
    this.subs.dispose();
    this.armed = false;
  }

  // -- per-step -------------------------------------------------------------

  fixedUpdate(dt) {
    if (!this.armed) return;

    // A chase owns the world while it is running: no new patrols, and the one
    // that started it is not ours any more. Nothing here competes with it.
    if (this.chase?.active) {
      this.cooldown = this._pick(PATROL.interval);
      return;
    }

    if (this.units.length < PATROL.maxActive) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this._trySpawn();
    }

    for (const u of [...this.units]) {
      const d = u.vehicle.position.distanceTo(this.target.position);

      // Gone, and gone for long enough that coming back is not the plan.
      u.farTime = d > PATROL.despawnDistance ? u.farTime + dt : 0;
      if (u.farTime > PATROL.despawnHold) {
        this._retire(u);
        continue;
      }

      // The only question this system asks about the player.
      if (canSee(u.vehicle, this.target, this.game.world, {
        range: PATROL.vision.range,
        coneDeg: PATROL.vision.coneDeg,
        headlightRange: PATROL.headlightRange,
      })) {
        this._spotted(u);
        return;
      }
    }

    if (this._hintTimer > 0) {
      this._hintTimer -= dt;
      if (this._hintTimer <= 0) this._teachTheTrees();
    }
  }

  update(dt) {
    if (!this.units.length || this.chase?.active) return;
    const g = this.game;
    const nearest = this._nearest();
    const A = PATROL.alarm;

    // -- audio: the primary channel ------------------------------------------
    // You hear them before anything is on screen, and you hear WHERE. A siren
    // that is quietly somewhere off to the left is worth more than any HUD
    // element, because it tells you which way not to go.
    for (const u of this.units) {
      const d = u.vehicle.position.distanceTo(this.target.position);
      if (d <= A.range) {
        _to.subVectors(u.vehicle.position, this.target.position).normalize();
        // Pan against the CAMERA's frame, not the car's — same reasoning, and
        // the same right-vector, as ChaseSystem#update. Getting it backwards
        // puts the siren in the wrong ear, which is worse than no pan at all.
        const camYaw = g.camera._yaw;
        const pan = clamp(_to.x * -Math.cos(camYaw) + _to.z * Math.sin(camYaw), -1, 1);
        if (!u.heard) {
          u.heard = true;
          g.audio.startSiren(u.id, { distance: d, pan });
        } else {
          g.audio.updateSiren(u.id, { distance: d, pan });
        }
      } else if (u.heard) {
        u.heard = false;
        g.audio.stopSiren(u.id);
      }
    }

    // -- the meter -----------------------------------------------------------
    // It wakes up and stops. Half a bar that never reaches critical is a
    // different sentence from a full one, and the player learns the difference
    // the first time one of these turns into a chase.
    if (nearest.distance <= A.meterFrom) {
      const t = clamp01((A.meterFrom - nearest.distance) / Math.max(1, A.meterFrom - A.shakeFrom));
      if (this.alarm !== 'near') {
        this.alarm = 'near';
        g.ui.hud.setMode('chase');
        events.emit('patrol:near', { distance: nearest.distance });
        // Once, ever, in the world's voice. After that the siren says it.
        if (!this._toldNear) {
          this._toldNear = true;
          events.emit('ui:subtitle', { text: 'Uzakta bir siren.', duration: 2.6 });
        }
      }
      g.ui.hud.setHeat(t * A.heatCeiling);
      if (nearest.distance < A.shakeFrom) {
        events.emit('camera:shake', { source: 'siren', scale: 0.4 * (1 - nearest.distance / A.shakeFrom) });
      }
    } else if (this.alarm === 'near') {
      this._clearAlarm();
      events.emit('patrol:clear', {});
    }
  }

  // -- the encounter --------------------------------------------------------

  /**
   * They looked straight at you. Hand the car to the chase and get out of the
   * way — this system does not know how to pursue anybody and must not learn.
   */
  _spotted(unit) {
    const g = this.game;
    // The patrol siren stops so the chase can start its own on the same car;
    // two voices out of one roof is a mixing bug you can hear.
    g.audio.stopSiren(unit.id);
    this.units.splice(this.units.indexOf(unit), 1);
    g.setDriver(unit.vehicle, null);
    this._clearAlarm();

    this.alarm = 'seen';
    events.emit('patrol:spotted', { distance: unit.vehicle.position.distanceTo(this.target.position) });
    g.ui.hud.setWarning('GÖRÜLDÜN');
    // Long enough to read at speed, short enough that the meter is what the
    // player is watching by the time it matters.
    setTimeout(() => g.ui.hud.setWarning(null), 2200);

    this.chase.start({ adopt: [unit.vehicle] });
    this.cooldown = this._pick(PATROL.interval);
    // And this is the moment the forest becomes an answer. See `_teachTheTrees`.
    if (this._shouldTeach()) this._hintTimer = PATROL.hint.delay;
  }

  /**
   * THE TREE LESSON.
   *
   * The game's best mechanic has never been mentioned. It is mentionable now
   * because it is *true* now: `TREES.breakableBy` fires on the same events that
   * armed this system, so the first patrol to see the player is the first
   * moment felling a trunk has ever been possible.
   *
   * Taught the way this game teaches everything — two lines in the subtitle
   * channel, in the world's voice, while the thing they describe is the obvious
   * thing to do. Never during the intro, because the intro is over by
   * definition before any of this can run. Never when there is no forest within
   * reach, because advice you cannot act on is worse than silence. Twice in a
   * save, and then never again.
   */
  _teachTheTrees() {
    this._hintTimer = -1;
    if (!this._shouldTeach()) return;
    // Re-check the trees: several seconds have passed and the player may have
    // driven out onto open ground since the sighting.
    if (this._treesNearPlayer() < PATROL.hint.minTrees) return;

    bumpProgress('treeHint');
    let at = 0;
    for (const line of PATROL.hint.lines) {
      const delay = at;
      setTimeout(() => events.emit('ui:subtitle', { text: line.text, duration: line.duration }), delay * 1000);
      at += line.duration * 0.85;
    }
    events.emit('patrol:taught', { lesson: 'trees' });
  }

  /** Is the lesson still worth giving? */
  _shouldTeach() {
    if (readProgress('treeHint') >= PATROL.hint.maxTimes) return false;
    // A forest that cannot be felled has nothing to teach. In practice this is
    // always true by now — same arming events — but the two are configured
    // independently and a designer may separate them.
    if (!this.game.world?.trees?.breakable) return false;
    return this._treesNearPlayer() >= PATROL.hint.minTrees;
  }

  /** Fellable trunks the player could actually reach, right now. */
  _treesNearPlayer() {
    const grid = this.game.world?.collision;
    if (!grid) return 0;
    const p = this.target.position;
    const r = PATROL.hint.treeRadius;
    let n = 0;
    const seen = new Set();
    // Walk the cells the radius covers rather than every collider in the world.
    const size = grid.cellSize;
    for (let cx = Math.floor((p.x - r) / size); cx <= Math.floor((p.x + r) / size); cx++) {
      for (let cz = Math.floor((p.z - r) / size); cz <= Math.floor((p.z + r) / size); cz++) {
        const list = grid.cells.get(`${cx},${cz}`);
        if (!list) continue;
        for (const c of list) {
          if (seen.has(c) || c.felled || c.disabled) continue;
          seen.add(c);
          if (!TREES.fellable.includes(c.kind)) continue;
          if (Math.hypot(c.x - p.x, c.z - p.z) <= r) n++;
        }
      }
    }
    return n;
  }

  // -- population -----------------------------------------------------------

  /**
   * Put one on a road, far enough away that it arrives rather than appears.
   *
   * Patrols are a *road* phenomenon: if there is no ribbon at the right
   * distance the attempt simply fails and retries later. Drive deep enough into
   * the trees and there are no police out there, which is correct.
   */
  _trySpawn() {
    const g = this.game;
    const slot = this._findSpawn();
    if (!slot) {
      // Short retry — the player is probably mid-way between two ribbons and
      // will be back in range of one shortly.
      this.cooldown = PATROL.interval[0] * 0.25;
      return null;
    }

    const id = `patrol${this._nextId++}`;
    const cop = g.spawnVehicle({ profile: 'cruiser', kind: 'cop', color: g.theme.vehicles.cop, id });
    cop.reset(slot.position, slot.heading);
    // Bar on, wail on, nobody hiding: a patrol announces itself. That is what
    // makes it avoidable, and it is the only warning the player is owed.
    cop.chassis.setSiren(true);
    cop.chassis.setHeadlights(true);

    const ai = new AiDriver(cop, {
      track: slot.track,
      skill: 0.6,
      aggression: 0.25,
      seed: 9000 + this._nextId,
      world: g.world,
    });
    // Cruising, not qualifying. `paceScale` is the same dial the chase uses for
    // its off-road penalty, so an AI already knows how to be slow.
    ai.paceScale = PATROL.pace;

    const unit = { vehicle: cop, ai, id, farTime: 0, heard: false };
    g.setDriver(cop, (_, dt) => {
      const cmd = ai.update(dt);
      cmd.throttle *= PATROL.pace;
      return cmd;
    });
    this.units.push(unit);
    this.cooldown = this._pick(PATROL.interval);
    events.emit('patrol:spawned', { id, track: slot.track.id });
    return unit;
  }

  /**
   * A point on some parkour ribbon inside the spawn band.
   *
   * Rejection sampling over the ribbons rather than a nearest-point search:
   * with three tracks and ~1600 samples the odds of a hit are good, the cost is
   * bounded, and a random qualifying spot is what we actually want — a
   * deterministic "nearest valid sample" would put every patrol in the game's
   * history on the same three corners.
   */
  _findSpawn() {
    const tracks = [...this.game.world.tracks.values()];
    if (!tracks.length) return null;
    const p = this.target.position;
    const { min, max } = PATROL.spawnDistance;

    for (let attempt = 0; attempt < 48; attempt++) {
      const track = tracks[Math.floor(this._rng.next() * tracks.length) % tracks.length];
      const i = Math.floor(this._rng.next() * track.count) % track.count;
      const d = Math.hypot(track.px[i] - p.x, track.pz[i] - p.z);
      if (d < min || d > max) continue;
      _spawn.set(track.px[i], track.py[i] + 0.6, track.pz[i]);
      return { position: _spawn, heading: Math.atan2(track.tx[i], track.tz[i]), track };
    }
    return null;
  }

  _retire(unit) {
    this.game.audio.stopSiren(unit.id);
    this.game.despawnVehicle(unit.vehicle);
    const i = this.units.indexOf(unit);
    if (i >= 0) this.units.splice(i, 1);
    if (!this.units.length) this._clearAlarm();
    events.emit('patrol:gone', { id: unit.id });
  }

  _nearest() {
    let distance = Infinity;
    let unit = null;
    for (const u of this.units) {
      const d = u.vehicle.position.distanceTo(this.target.position);
      if (d < distance) {
        distance = d;
        unit = u;
      }
    }
    return { unit, distance };
  }

  /** Put the HUD back the way the open world likes it. */
  _clearAlarm() {
    if (this.alarm === 'clear') return;
    this.alarm = 'clear';
    // Never fight a live chase for the HUD — it owns the meter while it runs.
    if (this.chase?.active) return;
    this.game.ui.hud.setHeat(null);
    this.game.ui.hud.setMode('openWorld');
  }

  /** @param {[number, number]} range */
  _pick([lo, hi]) {
    return this._rng.range(lo, hi);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// One-time lessons outlive the session, the same way settings do — same shape,
// same versioned key, its own store. Deliberately NOT part of `settings.js`:
// everything in that schema is rendered into the options menu, and "has been
// told about trees" is not an option anybody should be offered.

function readProgress(key) {
  try {
    const raw = globalThis.localStorage?.getItem(PROGRESS_KEY);
    return Number(JSON.parse(raw || '{}')[key]) || 0;
  } catch {
    return 0;
  }
}

function bumpProgress(key) {
  try {
    const store = globalThis.localStorage;
    if (!store) return;
    const data = JSON.parse(store.getItem(PROGRESS_KEY) || '{}');
    data[key] = (Number(data[key]) || 0) + 1;
    store.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch {
    // No storage (private mode, a headless test, a file:// boot). The lesson
    // just becomes per-session, which is a fine failure.
  }
}
