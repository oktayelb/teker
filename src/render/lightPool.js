/**
 * LIGHT POOL — a fixed set of lights, handed out and returned.
 *
 * WHY THIS EXISTS
 * ---------------
 * three.js bakes the light *count* into every material's shader. Add a point
 * light and every material in the world recompiles — a visible, one-off hitch at
 * exactly the wrong moment, because the moments you add lights are the dramatic
 * ones: the cops arriving, the headlights coming on.
 *
 * So the pool allocates every light the game will ever use at boot, parks them
 * at zero intensity, and lends them out. The count never changes, so nothing
 * ever recompiles. The budget below is the hard ceiling — if you need more,
 * raise it here and pay for it once, at startup.
 *
 * Cost is not really the issue: the scene renders at 512×288, so per-pixel
 * lighting is close to free. Shader permutations are the issue.
 */

import * as THREE from 'three';

export const LIGHT_BUDGET = {
  /** Track lamps along parkur 3, plus the cop light bars. */
  point: 14,
  /** Headlights: the player and two cops, plus one spare. */
  spot: 4,
};

/** A lease on one light. Release it when you are done. */
class Lease {
  constructor(light, pool) {
    this.light = light;
    this.pool = pool;
    this.inUse = false;
  }
  release() {
    this.pool._release(this);
  }
}

export class LightPool {
  /**
   * @param {THREE.Scene} scene
   * @param {{point?:number, spot?:number}} [budget]
   */
  constructor(scene, budget = LIGHT_BUDGET) {
    this.scene = scene;
    /** @type {Lease[]} */
    this.points = [];
    /** @type {Lease[]} */
    this.spots = [];

    for (let i = 0; i < (budget.point ?? 0); i++) {
      const l = new THREE.PointLight(0xffffff, 0, 40, 2);
      l.name = `pool:point${i}`;
      l.visible = false;
      scene.add(l);
      this.points.push(new Lease(l, this));
    }

    for (let i = 0; i < (budget.spot ?? 0); i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 90, 0.5, 0.55, 1.4);
      l.name = `pool:spot${i}`;
      l.visible = false;
      // A spot light aims at its target's world position, so the target has to
      // live in the scene graph even when the light is parked.
      l.target.name = `pool:spot${i}:target`;
      scene.add(l);
      scene.add(l.target);
      this.spots.push(new Lease(l, this));
    }
  }

  /** @returns {Lease|null} null when the budget is exhausted */
  acquirePoint() {
    return this._acquire(this.points);
  }

  /** @returns {Lease|null} */
  acquireSpot() {
    return this._acquire(this.spots);
  }

  _acquire(list) {
    for (const lease of list) {
      if (lease.inUse) continue;
      lease.inUse = true;
      lease.light.visible = true;
      lease.light.intensity = 0;
      return lease;
    }
    console.warn('[lightPool] budget exhausted — raise LIGHT_BUDGET');
    return null;
  }

  _release(lease) {
    if (!lease?.inUse) return;
    lease.inUse = false;
    lease.light.intensity = 0;
    lease.light.visible = false;
    lease.light.position.set(0, -1000, 0);
  }

  releaseAll() {
    for (const l of this.points) this._release(l);
    for (const l of this.spots) this._release(l);
  }

  get stats() {
    return {
      point: `${this.points.filter((l) => l.inUse).length}/${this.points.length}`,
      spot: `${this.spots.filter((l) => l.inUse).length}/${this.spots.length}`,
    };
  }
}
