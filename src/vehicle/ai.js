/**
 * AI — one driver brain, three jobs: race a track, hunt a car, search for a car.
 *
 * The AI drives through exactly the same `command` struct as the player and
 * exactly the same physics. It has no extra grip and no extra power beyond the
 * multipliers you can see in this file, which means if it looks fast, it is
 * fast for reasons you could reproduce.
 *
 * Steering is pure pursuit: pick a point ahead, turn toward it. Speed control
 * comes from the curvature between here and there — the AI brakes for a corner
 * because it can see the corner, not because a designer placed a brake marker.
 */

import * as THREE from 'three';
import { clamp, clamp01, lerp, shortestAngle, smoothstep } from '../core/mathx.js';
import { Rng } from '../core/rng.js';

const _goal = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Behaviour constants. Per-driver `skill` scales the ones that matter. */
export const AI_TUNING = {
  /** Look-ahead distance = base + speed * perSpeed, metres. */
  lookaheadBase: 12,
  lookaheadPerSpeed: 0.62,
  /** Steering gain on the angle to the goal. Higher = twitchier. */
  steerGain: 1.75,
  /** Lateral acceleration the AI believes it can hold, m/s². Sets corner speed. */
  latAccelBudget: 16.5,
  /** Safety margin on the computed corner speed. */
  cornerMargin: 0.94,
  /** Start braking when this much faster than the upcoming corner allows. */
  brakeThreshold: 1.5,
  brakeGain: 0.34,
  /** How far ahead to scan for corners, metres. */
  scanDistance: 78,
  /** Random line variation so a grid of AI cars does not drive in one file. */
  lineWander: 0.35,
  lineWanderSpeed: 0.11,
  /** Recovery: if this far off the racing line, forget racing and get back. */
  lostDistance: 32,
  /** Handbrake if the angle to the goal exceeds this (radians) at low speed. */
  spinOutAngle: 2.1,
};

export class AiDriver {
  /**
   * @param {import('./vehicle.js').Vehicle} vehicle
   * @param {object} opts
   * @param {import('../world/track.js').Track} [opts.track]
   * @param {number} [opts.skill] 0..1
   * @param {number} [opts.aggression] 0..1 — willingness to carry speed
   * @param {number} [opts.seed]
   */
  constructor(vehicle, { track = null, skill = 0.75, aggression = 0.6, seed = 1, world = null } = {}) {
    this.vehicle = vehicle;
    this.track = track;
    this.world = world;
    this.skill = clamp01(skill);
    this.aggression = clamp01(aggression);
    this.rng = new Rng(seed);

    /** 'race' | 'pursue' | 'search' | 'idle' */
    this.mode = track ? 'race' : 'idle';
    /** @type {import('./vehicle.js').Vehicle|null} */
    this.target = null;
    /** For SEARCH: the last place the target was seen. */
    this.searchPoint = new THREE.Vector3();

    /** Multiplier applied to throttle — rubber-banding lives here. */
    this.paceScale = 1;

    this._command = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this._wanderPhase = this.rng.range(0, 100);
    this._sampleIndex = 0;
    this._stuckTime = 0;
    this._reverseTime = 0;
    this._query = {};

    /** Debug: the point currently being aimed at. */
    this.goal = new THREE.Vector3();
  }

  setTrack(track) {
    this.track = track;
    this.mode = track ? 'race' : this.mode;
  }

  pursue(target) {
    this.target = target;
    this.mode = 'pursue';
  }

  search(point) {
    this.searchPoint.copy(point);
    this.mode = 'search';
  }

  idle() {
    this.mode = 'idle';
  }

  /**
   * @param {number} dt
   * @returns {{throttle:number, brake:number, steer:number, handbrake:number}}
   */
  update(dt) {
    const c = this._command;
    c.throttle = 0;
    c.brake = 0;
    c.steer = 0;
    c.handbrake = 0;

    if (this.mode === 'idle') return c;

    this._wanderPhase += dt * AI_TUNING.lineWanderSpeed;
    this._detectStuck(dt);

    if (this._reverseTime > 0) {
      // Unstick: reverse, steering the opposite way to the wall.
      this._reverseTime -= dt;
      c.brake = 1;
      c.steer = -Math.sign(this._lastSteer || 1);
      return c;
    }

    switch (this.mode) {
      case 'race':
        this._driveTrack(dt, c);
        break;
      case 'pursue':
        this._drivePursuit(dt, c);
        break;
      case 'search':
        this._driveSearch(dt, c);
        break;
    }
    this._lastSteer = c.steer;
    return c;
  }

  // -- behaviours -----------------------------------------------------------

  _driveTrack(dt, c) {
    const v = this.vehicle;
    const t = this.track;
    if (!t) return;

    const q = t.query(v.position.x, v.position.z, this._query);
    if (!q) {
      // Off the map entirely — head for the nearest checkpoint instead.
      const cp = t.checkpoints[0];
      this._steerTo(cp.position, c);
      c.throttle = 0.6;
      return;
    }
    this._sampleIndex = q.index;

    const lookahead = AI_TUNING.lookaheadBase + v.speed * AI_TUNING.lookaheadPerSpeed;
    t.ahead(q.index, lookahead, _goal);

    // Drift the aim point sideways so cars do not stack up on one line.
    const wander =
      Math.sin(this._wanderPhase * 2.1) * AI_TUNING.lineWander * (1 - this.skill * 0.5);
    const j = t.sampleIndexAt(((q.progress + lookahead / t.length) % 1 + 1) % 1);
    _goal.x += t.rx[j] * wander * q.halfWidth;
    _goal.z += t.rz[j] * wander * q.halfWidth;

    // If shoved off the ribbon, prioritise getting back on it.
    if (q.dist > q.halfWidth + AI_TUNING.lostDistance) {
      _goal.set(t.px[q.index], t.py[q.index], t.pz[q.index]);
    }

    this.goal.copy(_goal);
    this._steerTo(_goal, c);
    this._paceForCorner(t, q.index, c);
  }

  _drivePursuit(dt, c) {
    const v = this.vehicle;
    const target = this.target;
    if (!target) {
      this.mode = 'search';
      return;
    }
    // Intercept, not follow: aim where the target will be, scaled by how far
    // away it is, so the cops cut corners instead of tracing your exact path.
    const dist = v.position.distanceTo(target.position);
    const leadTime = clamp(dist / Math.max(v.speed, 8), 0, 2.4);
    target.predict(leadTime, _goal);
    this.goal.copy(_goal);

    this._steerTo(_goal, c);

    // Full commitment up close; ease off at range so they do not overshoot.
    const angle = Math.abs(this._angleTo(_goal));
    const tooFast = angle > 0.55 && v.speed > 22;
    c.throttle = tooFast ? 0.35 : 1;
    c.brake = angle > 1.0 && v.speed > 26 ? 0.55 : 0;

    // Do not rear-end the target at full speed — nudge, then back off.
    if (dist < 7 && v.speed > target.speed + 4) c.throttle = 0.4;
    c.throttle *= this.paceScale;
  }

  _driveSearch(dt, c) {
    const v = this.vehicle;
    if (v.position.distanceTo(this.searchPoint) < 22) {
      // Arrived and found nothing. Cast around.
      const a = this._wanderPhase * 1.7;
      _goal.set(
        this.searchPoint.x + Math.cos(a) * 45,
        this.searchPoint.y,
        this.searchPoint.z + Math.sin(a) * 45
      );
    } else {
      _goal.copy(this.searchPoint);
    }
    this.goal.copy(_goal);
    this._steerTo(_goal, c);
    c.throttle = 0.62 * this.paceScale;
  }

  // -- primitives -----------------------------------------------------------

  _angleTo(point) {
    const v = this.vehicle;
    _tmp.subVectors(point, v.position);
    const desired = Math.atan2(_tmp.x, _tmp.z);
    return shortestAngle(v.heading, desired);
  }

  _steerTo(point, c) {
    const angle = this._angleTo(point);
    const v = this.vehicle;
    // Counter-steer when the car is already sliding — the same instinct a
    // player has, and it stops the AI spinning on the icy sections.
    const slideCorrection = -v.latSpeed * 0.055 * this.skill;
    c.steer = clamp(angle * AI_TUNING.steerGain + slideCorrection, -1, 1);

    if (Math.abs(angle) > AI_TUNING.spinOutAngle && v.speed < 6) {
      c.brake = 1;
      c.steer = Math.sign(angle) * -1;
    }
  }

  /** Look ahead along the track and set a speed the corner will accept. */
  _paceForCorner(track, index, c) {
    const v = this.vehicle;
    const steps = Math.max(1, Math.round(AI_TUNING.scanDistance / 3));
    let worst = 0;
    let worstAt = 0;
    for (let k = 1; k <= steps; k++) {
      const i = track.loop
        ? (index + k) % track.count
        : Math.min(index + k, track.count - 1);
      const curve = Math.abs(track.curvature[i]);
      // Weight nearer corners more heavily — a hairpin 70m away should not
      // make the car crawl now.
      const weight = 1 - (k / steps) * 0.55;
      if (curve * weight > worst) {
        worst = curve * weight;
        worstAt = k * 3;
      }
    }

    const budget =
      AI_TUNING.latAccelBudget * lerp(0.78, 1.06, this.skill) * lerp(0.92, 1.08, this.aggression);
    const surfaceGrip = v.surface.grip;
    const cornerSpeed =
      worst > 1e-4
        ? Math.sqrt((budget * surfaceGrip) / worst) * AI_TUNING.cornerMargin
        : v.tuning.maxSpeed;
    const targetSpeed = Math.min(cornerSpeed, v.tuning.maxSpeed) * this.paceScale;

    const over = v.speed - targetSpeed;
    if (over > AI_TUNING.brakeThreshold) {
      // Brake harder the later the corner is left.
      const urgency = clamp01(1 - worstAt / AI_TUNING.scanDistance);
      c.brake = clamp01(over * AI_TUNING.brakeGain * (0.5 + urgency));
      c.throttle = 0;
    } else {
      c.brake = 0;
      c.throttle = clamp01(1 - smoothstep(-4, 0, over)) * this.paceScale;
      // Never fully lift on a straight; it looks indecisive.
      if (worst < 0.004) c.throttle = Math.max(c.throttle, 0.85 * this.paceScale);
    }
  }

  /** Wedged against a tree? Back up. Nothing looks worse than a stuck AI. */
  _detectStuck(dt) {
    const v = this.vehicle;
    if (v.speed < 2.2 && (this._command.throttle > 0.3 || this.mode !== 'idle')) {
      this._stuckTime += dt;
      if (this._stuckTime > 1.6) {
        this._reverseTime = 1.1;
        this._stuckTime = 0;
      }
    } else {
      this._stuckTime = 0;
    }
  }
}
