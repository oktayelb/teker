/**
 * TRACK LIGHTING — the rig that makes an unlit forest path drivable.
 *
 * Parkur 3 is a dirt route through jungle marked only by plastic posts. It is
 * readable at all because somebody hung lights along it. This is that rig, and
 * it is also the switch the story flips.
 *
 * THE BUDGET PROBLEM
 * ------------------
 * A lap has forty-odd lamp poles. Forty real lights is not affordable, and
 * changing how many exist would recompile every material (see `lightPool.js`).
 * So a *fixed* handful of leases follow the camera: the nearest poles get a real
 * light, everything else is emissive geometry only. Because the fog closes in
 * well before the eighth-nearest pole, you never see the hand-off.
 *
 * The emissive lamp heads are always lit and cost nothing, so a pole in the
 * distance still reads as a light source. `power` dims both together.
 */

import * as THREE from 'three';
import { clamp01, damp } from '../core/mathx.js';
import { events } from '../core/events.js';

export const LIGHTING = {
  /** How many poles may hold a real light at once. */
  maxActive: 8,
  /** Poles further than this never get one. */
  range: 190,
  /**
   * Peak intensity of a lamp, in three's PHYSICAL units — which are not the
   * pre-r155 units and are much larger than they look. A lamp 8m above ground
   * with decay 1.3 delivers roughly `intensity/16` of irradiance, and Lambert
   * then divides by PI and multiplies by a night-time albedo of about 0.04.
   * 120 lit nothing at all; 520 puts a readable pool on the dirt.
   */
  intensity: 520,
  /** Falloff distance of each lamp. */
  distance: 70,
  decay: 1.3,
  color: 0xfff0cc,
  /** Emissive head brightness at full power. */
  headGlow: 1.0,
  /** Seconds for `setPower` to reach its target. Filament lamps are not LEDs. */
  fadeUp: 0.45,
  fadeDown: 0.12,
  /** Re-pick which poles hold lights this often, seconds. */
  reassignInterval: 0.35,
};

export class TrackLighting {
  /**
   * @param {object} opts
   * @param {import('./track.js').Track} opts.track
   * @param {import('../render/lightPool.js').LightPool} opts.pool
   * @param {THREE.Group} [opts.group] the track's mesh group, for the lamp heads
   */
  constructor({ track, pool, group = null }) {
    this.track = track;
    this.pool = pool;
    this.group = group;

    /** 0..1 — the master switch the story flips. */
    this.power = 1;
    this._targetPower = 1;
    /** Extra multiplier used by flicker; separate so a flicker cannot get stuck. */
    this._flicker = 1;
    this._flickerUntil = 0;
    this._time = 0;
    this._reassignAt = 0;

    /** @type {import('../render/lightPool.js').Lease[]} */
    this._leases = [];
    for (let i = 0; i < LIGHTING.maxActive; i++) {
      const lease = pool.acquirePoint();
      if (!lease) break;
      lease.light.color.set(LIGHTING.color);
      lease.light.distance = LIGHTING.distance;
      lease.light.decay = LIGHTING.decay;
      lease.light.intensity = 0;
      this._leases.push(lease);
    }

    /** The always-on emissive lamp faces. */
    this._heads = group?.getObjectByName('lampHeads') ?? null;
    this._headBase = null;
    if (this._heads) {
      const attr = this._heads.geometry.getAttribute('color');
      this._headBase = new Float32Array(attr.array);
    }
    this._headLevel = -1;
  }

  get anchors() {
    return this.track.lightAnchors;
  }

  /** 0 = blackout, 1 = full. Eased, not instant. */
  setPower(p) {
    this._targetPower = clamp01(p);
  }

  /** Snap without the fade — for setting the initial state. */
  setPowerImmediate(p) {
    this.power = this._targetPower = clamp01(p);
    this._apply(0);
  }

  /**
   * Kill the lights for `seconds`, with a stutter on the way down and a slow,
   * uneven recovery. This is the beat the whole third parkour turns on.
   */
  blackout(seconds = 6) {
    events.emit('lighting:blackout', { seconds });
    this._flickerUntil = this._time + 0.9;
    this.setPower(0);
    clearTimeout(this._restoreTimer);
    this._restoreTimer = setTimeout(() => {
      this._flickerUntil = this._time + 2.2;
      this.setPower(1);
      events.emit('lighting:restored', {});
    }, seconds * 1000);
  }

  /** Cancel a pending restore — used if the story moves on mid-blackout. */
  hold() {
    clearTimeout(this._restoreTimer);
  }

  update(dt, cameraPosition) {
    this._time += dt;
    const rate = this._targetPower > this.power ? LIGHTING.fadeUp : LIGHTING.fadeDown;
    this.power = damp(this.power, this._targetPower, 1 / Math.max(rate, 0.01), dt);

    // A dying fluorescent stutters rather than dimming smoothly.
    if (this._time < this._flickerUntil) {
      const n = Math.sin(this._time * 47) * Math.sin(this._time * 13.3) * Math.sin(this._time * 7.1);
      this._flicker = n > -0.15 ? 1 : 0.06;
    } else {
      this._flicker = 1;
    }

    this._reassignAt -= dt;
    if (this._reassignAt <= 0 && cameraPosition) {
      this._reassignAt = LIGHTING.reassignInterval;
      this._assign(cameraPosition);
    }
    this._apply(dt);
  }

  /** Give the leases to the nearest poles. */
  _assign(camera) {
    const anchors = this.anchors;
    if (anchors.length === 0) return;
    const near = [];
    const maxSq = LIGHTING.range * LIGHTING.range;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const dx = a.x - camera.x;
      const dz = a.z - camera.z;
      const d = dx * dx + dz * dz;
      if (d > maxSq) continue;
      near.push({ i, d });
    }
    near.sort((p, q) => p.d - q.d);

    for (let k = 0; k < this._leases.length; k++) {
      const lease = this._leases[k];
      const pick = near[k];
      if (!pick) {
        lease.light.intensity = 0;
        lease.light.userData.anchor = null;
        continue;
      }
      const a = anchors[pick.i];
      const dx = a.aimX - a.x;
      const dz = a.aimZ - a.z;
      const len = Math.hypot(dx, dz) || 1;
      // Sit the light where the lamp head is: out over the road, near the top.
      lease.light.position.set(
        a.x + (dx / len) * 2.4,
        a.y + a.height - 0.5,
        a.z + (dz / len) * 2.4
      );
      lease.light.userData.anchor = a;
      // Fade the furthest ones in rather than popping them.
      lease.light.userData.fade = clamp01(1 - Math.sqrt(pick.d) / LIGHTING.range);
    }
  }

  _apply() {
    const level = this.power * this._flicker;
    for (const lease of this._leases) {
      const fade = lease.light.userData.anchor ? lease.light.userData.fade ?? 1 : 0;
      lease.light.intensity = LIGHTING.intensity * level * fade;
    }

    // The emissive heads. Rewriting the colour buffer is cheap but not free, so
    // only do it when the level has actually moved.
    if (this._heads && this._headBase) {
      const q = Math.round(level * 24) / 24;
      if (q !== this._headLevel) {
        this._headLevel = q;
        const attr = this._heads.geometry.getAttribute('color');
        const lit = 0.06 + q * LIGHTING.headGlow;
        for (let i = 0; i < attr.array.length; i++) attr.array[i] = this._headBase[i] * lit;
        attr.needsUpdate = true;
      }
    }
  }

  dispose() {
    clearTimeout(this._restoreTimer);
    for (const l of this._leases) l.release();
    this._leases.length = 0;
  }
}
