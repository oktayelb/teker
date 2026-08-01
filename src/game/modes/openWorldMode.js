/**
 * OPEN WORLD MODE — no laps, no checkpoints, no barriers, no rules.
 *
 * This is the game the rest of the project exists to hand over to. It is
 * deliberately thin: a car, a world, and a camera. Everything that happens
 * *in* it (the sirens, the chase, the narrative) is attached from outside.
 *
 * SEAMLESS ENTRY
 * --------------
 * `enter({ keepPlayer: true })` adopts the car that is already driving instead
 * of spawning a new one. That is what lets the third race become the open world
 * without a fade, a load, or a single dropped frame — the player never stops
 * holding the throttle. Do not "fix" this by resetting the player here.
 *
 * The rival cars are left running on their track on purpose. Drive back and
 * they are still going round, still racing a race that ended for you.
 */

import * as THREE from 'three';
import { Mode } from '../../core/modes.js';
import { AiDriver } from '../../vehicle/ai.js';
import { events, Subscriptions } from '../../core/events.js';
import { ChaseSystem } from '../chase.js';
import { OPEN_WORLD } from '../../config/gameplay.js';
import { clamp01 } from '../../core/mathx.js';

export class OpenWorldMode extends Mode {
  static modeName = 'openWorld';

  constructor(ctx) {
    super(ctx);
    this.subs = new Subscriptions();
    /** @type {ChaseSystem|null} */
    this.chase = null;
    this.elapsed = 0;
    /** Landmarks the player has stood in. */
    this.discovered = new Set();
    this._ghostRacers = [];
  }

  /**
   * @param {object} params
   * @param {boolean} [params.keepPlayer] adopt the existing player car
   * @param {{position: THREE.Vector3, heading: number}} [params.spawn]
   * @param {boolean} [params.keepRacers] leave AI cars lapping their track
   * @param {string} [params.rig]
   */
  async enter(params = {}) {
    const g = this.ctx;
    this.elapsed = 0;

    if (!params.keepPlayer || !g.player) {
      g.clearVehicles();
      const spawn = params.spawn || this._defaultSpawn();
      const player = g.spawnVehicle({ kind: 'player', color: g.theme.vehicles.player, id: 'player', isPlayer: true });
      player.reset(spawn.position, spawn.heading);
      g.setDriver(player, () => g.input.state);
      g.camera.setRig(params.rig || 'chaseWide', true);
    } else if (params.rig) {
      g.camera.setRig(params.rig);
    }

    // Adopt any leftover AI cars: they keep lapping, indifferent to you.
    if (params.keepRacers !== false) this._adoptGhostRacers();
    else this._despawnNonPlayers();

    g.world.setActiveTrack(null);
    g.ui.hud.setMode('openWorld');
    g.ui.hud.setLap({ lap: 0, total: 0 });
    g.ui.hud.setPosition({ place: 0, total: 0 });
    g.ui.hud.setHeat(null);

    this.chase = new ChaseSystem(g, { target: g.player });

    events.emit('openWorld:entered', { keepPlayer: !!params.keepPlayer });
  }

  _defaultSpawn() {
    const w = this.ctx.world;
    const t = w.getTrack('track3') || w.tracks.values().next().value;
    const slot = t.gridSlot(0, 7, 4.2, 14);
    return slot;
  }

  /** Re-install AI on any non-player car so they keep going after the race. */
  _adoptGhostRacers() {
    const g = this.ctx;
    for (const v of g.vehicles) {
      if (v === g.player) continue;
      const track = g.world.onAnyTrack(v.position.x, v.position.z) || g.world.getTrack('track3');
      const ai = new AiDriver(v, { track, skill: 0.7, aggression: 0.5, seed: 7 + this._ghostRacers.length, world: g.world });
      g.setDriver(v, (_, dt) => ai.update(dt));
      this._ghostRacers.push({ vehicle: v, ai });
    }
  }

  _despawnNonPlayers() {
    const g = this.ctx;
    for (const v of [...g.vehicles]) if (v !== g.player) g.despawnVehicle(v);
  }

  async exit() {
    this.subs.dispose();
    this.chase?.stop();
    this.chase = null;
    this._ghostRacers.length = 0;
  }

  /**
   * Public API for a director: begin the pursuit.
   * @param {object} opts forwarded to ChaseSystem#start
   */
  startChase(opts = {}) {
    if (!this.chase) return null;
    this.chase.start(opts);
    this.ctx.camera.setRig(opts.rig || 'chaseTight');
    return this.chase;
  }

  fixedUpdate(dt) {
    this.elapsed += dt;
    this.chase?.fixedUpdate(dt);
  }

  update(dt) {
    const g = this.ctx;
    if (!g.player) return;

    g.ui.hud.setSpeed(g.player.speedKmh);
    g.ui.hud.setGear(g.player.gear);
    this.chase?.update(dt);
    this._checkLandmarks();
  }

  /** Quietly note where the player has been. The world is worth exploring. */
  _checkLandmarks() {
    const p = this.ctx.player;
    const l = this.ctx.world.landmarkAt(p.position.x, p.position.z);
    if (!l || this.discovered.has(l.name)) return;
    this.discovered.add(l.name);
    l.discovered = true;
    events.emit('world:landmark', { name: l.name, label: l.label, count: this.discovered.size });
  }
}
