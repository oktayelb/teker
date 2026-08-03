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
 *
 * IT IS ALSO THE ONLY CHASE
 * -------------------------
 * The open-world patrols (`src/game/patrol.js`) do not implement pursuit. When
 * one of them sees the player it hands its cruiser to `start({ adopt: [car] })`
 * and stops existing. Everything after that — heat, search, escape, mercy — is
 * this file, unchanged, so an encounter that began three hours into free roam
 * ends the same way the scripted one does. Sight is decided in
 * `src/game/perception.js`, shared for the same reason.
 */

import * as THREE from 'three';
import { AiDriver } from '../vehicle/ai.js';
import { events } from '../core/events.js';
import { canSee } from './perception.js';
import { CHASE } from '../config/gameplay.js';
import { clamp, clamp01 } from '../core/mathx.js';

const _toPlayer = new THREE.Vector3();
const _spawn = new THREE.Vector3();

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
   * @param {import('../vehicle/vehicle.js').Vehicle[]} [opts.adopt]
   *   Cars that already exist and are already here. A patrol that has just seen
   *   the player hands its cruiser over this way (`src/game/patrol.js`) instead
   *   of the chase spawning a second one — the car that spotted you has to be
   *   the car that comes after you, or the player watches their pursuer blink
   *   into existence next to the one that was actually looking at them.
   */
  start({ count = CHASE.copCount, distance = CHASE.spawnDistance, adopt = null } = {}) {
    if (this.active) return;
    const g = this.game;
    const t = this.target;

    if (adopt && adopt.length) {
      for (let i = 0; i < adopt.length; i++) {
        this._enlist(adopt[i], i, adopt[i].position.distanceTo(t.position));
      }
    } else {
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
        this._enlist(cop, i, distance);
      }
    }

    this.state = 'pursuing';
    this.heat = CHASE.heat.start;
    this.elapsed = 0;
    this._escapeHold = 0;
    this._mercy = 1;
    this._lastSeen.copy(t.position);

    g.audio.setMusic('chase');
    // The pursuit meter is the HUD's third personality and it only exists while
    // this is running. Without the swap the meter is fed a number every frame
    // and never drawn — `ui.css` hides it in the open world on purpose.
    g.ui.hud.setMode('chase');
    events.emit('chase:started', { count: this.cops.length });
  }

  /**
   * Turn a cruiser into a pursuer. The single place that decides what a cop in
   * a chase *is*, whether it was spawned for the job or was already out here.
   * @param {import('../vehicle/vehicle.js').Vehicle} cop
   * @param {number} index
   * @param {number} distance metres from the player, for the initial siren mix
   */
  _enlist(cop, index, distance) {
    const g = this.game;
    const id = `cop${index}`;
    cop.chassis.setSiren(true);
    // Headlights on: beams sweeping the trees behind you is most of what makes
    // the chase read at night.
    cop.chassis.setHeadlights(true);

    const ai = new AiDriver(cop, {
      skill: 0.85,
      aggression: 0.9,
      seed: 4000 + index,
      world: g.world,
    });
    ai.pursue(this.target);

    const entry = { vehicle: cop, ai, id, sees: false, ramCooldown: 0 };
    g.setDriver(cop, (_, dt) => this._driveCop(entry, dt));
    this.cops.push(entry);
    g.audio.startSiren(id, { distance, pan: 0 });
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
    g.ui.hud.setMode('openWorld');
  }

  /** Cops peel off and leave rather than blinking out of existence. */
  disengage() {
    for (const c of this.cops) {
      c.vehicle.chassis.setSiren(false);
      c.ai.idle();
      this.game.audio.stopSiren(c.id);
    }
    // Headlights stay on as they drive away — that is the last you see of them.
    this.state = 'escaped';
    this.heat = 0;
    this.game.audio.setMusic('alone');
    // The meter goes with them, and so does the HUD it was living in.
    this.game.ui.hud.setHeat(null);
    this.game.ui.hud.setMode('openWorld');
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

  /**
   * Shared with the open-world patrols, which is the whole reason it moved out
   * of this file. See `src/game/perception.js`; the defaults it uses are the
   * `CHASE.vision*` numbers, so this behaves exactly as it always did.
   *
   * No headlight modifier here, deliberately: these two were *dispatched* to
   * your last known position. They are not finding you by looking for a glow.
   */
  _canSee(cop) {
    return canSee(cop, this.target, this.game.world);
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
