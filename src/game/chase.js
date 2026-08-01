/**
 * CHASE — two cars that want you back.
 *
 * A system, not a mode. The chase happens *inside* the open world, so starting
 * and ending it never unloads anything and the player never stops driving.
 *
 * HOW ESCAPING WORKS
 * ------------------
 * Not distance. Heat.
 *
 * While a cop can see you, heat rises. While none can, it falls. Below
 * `searchThreshold` they lose the trail and start sweeping your last known
 * position; below `escapeThreshold`, held for a few seconds, they give up.
 *
 * The practical consequence is that outrunning them in a straight line barely
 * works — they are marginally faster than you — but breaking line of sight does.
 * The forest is the answer to the question the sirens ask, which is the whole
 * reason the trees are dense enough to hide in.
 *
 * `mercyAfter` guarantees the player wins eventually. The chase is a scene, not
 * a skill check; it has somewhere it needs to get to.
 */

import * as THREE from 'three';
import { AiDriver } from '../vehicle/ai.js';
import { events } from '../core/events.js';
import { CHASE } from '../config/gameplay.js';
import { clamp, clamp01, lerp, shortestAngle } from '../core/mathx.js';

const _toPlayer = new THREE.Vector3();
const _spawn = new THREE.Vector3();

const VISION_COS = Math.cos((CHASE.visionConeDeg * Math.PI) / 180);

export class ChaseSystem {
  /**
   * @param {import('./game.js').Game} game
   * @param {{target: import('../vehicle/vehicle.js').Vehicle}} opts
   */
  constructor(game, { target }) {
    this.game = game;
    this.target = target;
    /** @type {{vehicle:any, ai:AiDriver, id:string, sees:boolean, ramCooldown:number}[]} */
    this.cops = [];

    /** 'inactive' | 'pursuing' | 'searching' | 'escaped' */
    this.state = 'inactive';
    this.heat = 0;
    this.elapsed = 0;
    this._escapeHold = 0;
    this._lastSeen = new THREE.Vector3();
    this._sawLastFrame = false;
    this._mercy = 1;
  }

  get active() {
    return this.state === 'pursuing' || this.state === 'searching';
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * @param {object} [opts]
   * @param {number} [opts.count]
   * @param {number} [opts.distance] how far behind to spawn them
   */
  start({ count = CHASE.copCount, distance = CHASE.spawnDistance } = {}) {
    if (this.active) return;
    const g = this.game;
    const t = this.target;

    // Spawn behind the player's *velocity*, not their nose, so they arrive from
    // where the player has just been rather than materialising in front.
    const backX = t.speed > 3 ? -t.velocity.x / t.speed : -Math.sin(t.heading);
    const backZ = t.speed > 3 ? -t.velocity.z / t.speed : -Math.cos(t.heading);

    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * CHASE.spawnSpread;
      const x = t.position.x + backX * distance - backZ * spread;
      const z = t.position.z + backZ * distance + backX * spread;
      const ground = g.world.sampleGround(x, z);
      _spawn.set(x, ground.height + 1, z);

      const cop = g.spawnVehicle({
        profile: 'cruiser',
        kind: 'cop',
        color: g.theme.vehicles.cop,
        id: `cop${i}`,
      });
      cop.reset(_spawn, Math.atan2(-backX, -backZ));
      cop.chassis.setSiren(true);

      const ai = new AiDriver(cop, {
        skill: 0.85,
        aggression: 0.9,
        seed: 4000 + i,
        world: g.world,
      });
      ai.pursue(t);

      const entry = { vehicle: cop, ai, id: `cop${i}`, sees: false, ramCooldown: 0 };
      g.setDriver(cop, (_, dt) => this._driveCop(entry, dt));
      this.cops.push(entry);

      g.audio.startSiren(entry.id, { distance, pan: 0 });
    }

    this.state = 'pursuing';
    this.heat = CHASE.heat.start;
    this.elapsed = 0;
    this._escapeHold = 0;
    this._mercy = 1;
    this._lastSeen.copy(t.position);

    g.audio.setMusic('chase');
    events.emit('chase:started', { count });
  }

  stop() {
    const g = this.game;
    for (const c of this.cops) {
      g.audio.stopSiren(c.id);
      g.despawnVehicle(c.vehicle);
    }
    this.cops.length = 0;
    this.state = 'inactive';
    this.heat = 0;
    g.ui.hud.setHeat(null);
  }

  /** Cops peel off and leave rather than blinking out of existence. */
  disengage() {
    for (const c of this.cops) {
      c.vehicle.chassis.setSiren(false);
      c.ai.idle();
      this.game.audio.stopSiren(c.id);
    }
    this.state = 'escaped';
    this.game.audio.setMusic('alone');
    events.emit('chase:escaped', { duration: this.elapsed });

    // Let them coast out of sight, then remove them.
    setTimeout(() => {
      if (this.state !== 'escaped') return;
      for (const c of this.cops) this.game.despawnVehicle(c.vehicle);
      this.cops.length = 0;
    }, 12000);
  }

  // -- per-step -------------------------------------------------------------

  fixedUpdate(dt) {
    if (!this.active) return;
    this.elapsed += dt;

    // After long enough, the world starts letting go.
    if (this.elapsed > CHASE.mercyAfter) {
      this._mercy = CHASE.mercyRate;
    }

    let anySees = false;
    for (const c of this.cops) {
      c.ramCooldown = Math.max(0, c.ramCooldown - dt);
      c.sees = this._canSee(c.vehicle);
      if (c.sees) anySees = true;
    }

    const H = CHASE.heat;
    if (anySees) {
      this.heat = clamp01(this.heat + H.riseRate * dt);
      this._lastSeen.copy(this.target.position);
      if (!this._sawLastFrame) events.emit('chase:sighted', { heat: this.heat });
    } else {
      this.heat = clamp01(this.heat - H.fallRate * this._mercy * dt);
      if (this._sawLastFrame) events.emit('chase:lost', { heat: this.heat });
    }
    this._sawLastFrame = anySees;

    // Behaviour follows heat.
    const wantSearch = this.heat < H.searchThreshold && !anySees;
    for (const c of this.cops) {
      if (anySees || this.heat >= H.searchThreshold) {
        if (c.ai.mode !== 'pursue') c.ai.pursue(this.target);
      } else if (wantSearch && c.ai.mode !== 'search') {
        // Each cop sweeps a different part of the last known area.
        const a = Math.random() * Math.PI * 2;
        c.ai.search(
          new THREE.Vector3(
            this._lastSeen.x + Math.cos(a) * CHASE.searchRadius * 0.6,
            this._lastSeen.y,
            this._lastSeen.z + Math.sin(a) * CHASE.searchRadius * 0.6
          )
        );
      }
    }
    this.state = anySees || this.heat >= H.searchThreshold ? 'pursuing' : 'searching';

    // Escape.
    if (this.heat <= H.escapeThreshold && this.elapsed > CHASE.minDuration) {
      this._escapeHold += dt;
      if (this._escapeHold >= H.escapeHold) this.disengage();
    } else {
      this._escapeHold = 0;
    }
  }

  update(dt) {
    if (this.cops.length === 0) return;
    const g = this.game;
    const t = this.target;

    // Siren mix: nearest cop drives the loudest voice.
    for (const c of this.cops) {
      const d = c.vehicle.position.distanceTo(t.position);
      _toPlayer.subVectors(c.vehicle.position, t.position).normalize();
      // Pan relative to where the camera is looking, not where the car points.
      // Screen-right = forward × up. Getting this backwards puts the siren in
      // the wrong ear, which is worse than no panning at all.
      const camYaw = g.camera._yaw;
      const rightX = -Math.cos(camYaw);
      const rightZ = Math.sin(camYaw);
      const pan = clamp(_toPlayer.x * rightX + _toPlayer.z * rightZ, -1, 1);
      g.audio.updateSiren(c.id, { distance: d, pan });
    }

    if (this.active) {
      g.ui.hud.setHeat(this.heat);
      // Sirens rattle the camera when they are right behind you.
      const nearest = Math.min(...this.cops.map((c) => c.vehicle.position.distanceTo(t.position)));
      if (nearest < 30) {
        events.emit('camera:shake', { source: 'siren', scale: 1 - nearest / 30 });
      }
    }
  }

  // -- perception -----------------------------------------------------------

  _canSee(cop) {
    const t = this.target;
    const dx = t.position.x - cop.position.x;
    const dz = t.position.z - cop.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > CHASE.visionRange) return false;

    // Cone: are you in front of them?
    const invD = 1 / (dist || 1);
    const dot = (dx * invD) * Math.sin(cop.heading) + (dz * invD) * Math.cos(cop.heading);
    if (dot < VISION_COS) return false;

    // Occlusion: trees and rock actually hide you.
    if (CHASE.occlusionCheck && dist > 12) {
      const blocked = this.game.world.collision.raycastBlocked(
        cop.position.x, cop.position.z, t.position.x, t.position.z
      );
      if (blocked) return false;
    }
    return true;
  }

  // -- driving --------------------------------------------------------------

  _driveCop(entry, dt) {
    const cmd = entry.ai.update(dt);
    const cop = entry.vehicle;

    // The cops' whole advantage is on tarmac. Off it they are heavy and clumsy,
    // which is the mechanical reason to leave the road.
    const offroad = cop.surface.id !== 'TARMAC';
    const pace = offroad ? CHASE.offroadPenalty : CHASE.speedAdvantage;
    entry.ai.paceScale = pace;
    cmd.throttle *= pace;

    // Ramming: only when close, only occasionally.
    if (entry.ramCooldown <= 0) {
      const d = cop.position.distanceTo(this.target.position);
      if (d < CHASE.ram.range && entry.sees) {
        entry.ramCooldown = CHASE.ram.cooldown;
        _toPlayer.subVectors(this.target.position, cop.position).normalize();
        this.target.velocity.addScaledVector(_toPlayer, CHASE.ram.force / this.target.tuning.mass);
        events.emit('camera:shake', { source: 'collision', scale: 0.55 });
        events.emit('vehicle:collision', { id: 'ram', intensity: 0.5, position: cop.position.clone() });
      }
    }
    return cmd;
  }
}
