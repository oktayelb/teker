/**
 * GROUND COVER — grass you can actually see, rooted in the ground it grows on.
 *
 * THE TRICK, WHICH IS `wildlife.js`'s TRICK
 * -----------------------------------------
 * This is not scattered like the forest. A fixed population lives in bands
 * that FOLLOW THE CAMERA. A tuft that falls out of its band is reflected
 * through the camera to the opposite edge of the same band, which is both the
 * furthest point from the player and the point they are driving away from.
 * So 2800 tufts make an entire 1400m world look grassy, and every one of them
 * is somewhere you might look. Scatter 2800 tufts across that disc instead —
 * which is roughly what the old `scatterDensity.grass` did with twice as many —
 * and you meet one every forty metres.
 *
 * Reflection rather than a random re-place (which is what the animals get) for
 * two reasons: it is allocation-free AND rng-free at runtime, so the whole
 * system is a pure function of the seed and the camera path; and it preserves
 * the distribution exactly, where re-rolling a radius slowly bunches a pool up.
 *
 * NOTHING POPS IN
 * ---------------
 * A recycled tuft always arrives at its band's outer edge, and always at zero
 * scale. `fadeBand` is the fraction of the radius over which it grows to full
 * size, which at the far band's 78m is entirely inside the fog. The player
 * never sees grass appear; they see it resolve.
 *
 * WHAT IT COSTS PER FRAME
 * -----------------------
 * Almost nothing. An instance's matrix is rewritten only when it is recycled or
 * when its fade has moved by more than `fadeEpsilon` — the interior of a band,
 * which is most of it, is untouched from one frame to the next. The blades move
 * because the *shader* moves them (see `render/wind.js`), not because anything
 * here writes a matrix. Nothing is allocated after `build()`.
 */

import * as THREE from 'three';
import { buildVariants } from './props.js';
import { OPEN_WORLD } from '../config/gameplay.js';
import { Rng } from '../core/rng.js';
import { clamp01, smoothstep } from '../core/mathx.js';

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

export class GroundCover {
  /**
   * @param {object} opts
   * @param {import('./terrain.js').Terrain} opts.terrain
   * @param {import('../render/materials.js').MaterialLibrary} opts.materials
   * @param {object} opts.theme resolved theme
   * @param {number} [opts.seed]
   * @param {(x:number, z:number)=>boolean} [opts.avoid] true rejects a spot —
   *   the same predicate the forest is scattered with, so grass stops at the
   *   verge exactly where the trees do
   */
  constructor({ terrain, materials, theme, seed = 1, avoid = null }) {
    this.terrain = terrain;
    this.materials = materials;
    this.theme = theme;
    this.seed = seed;
    this.avoid = avoid;
    this.cfg = OPEN_WORLD.groundCover;
    this.root = new THREE.Group();
    this.root.name = 'groundCover';
    /** @type {{mesh: THREE.InstancedMesh, radius: number, items: object[]}[]} */
    this._groups = [];
    this._rng = new Rng(seed ^ 0x6a55);
    /** Accumulated wind phase in radians. See MaterialLibrary#setWindTime. */
    this._phase = 0;
    this._centre = new THREE.Vector3();
    /** Widest band — the distance that counts as a teleport rather than a drive. */
    this._widest = this.cfg.bands.reduce((m, b) => Math.max(m, b.radius), 0);
    /** False until the first `update` has laid the pool out around the camera. */
    this._laid = false;
    this.materials.configureWind(this.cfg.wind);
  }

  /** Tufts currently in the world, across every band. */
  get count() {
    let n = 0;
    for (const g of this._groups) n += g.items.length;
    return n;
  }

  build() {
    const mat = this.materials.get('grass');
    const C = this.cfg;

    for (let bi = 0; bi < C.bands.length; bi++) {
      const band = C.bands[bi];
      // Blade count is per band, so the far one is a genuinely cheaper prop
      // rather than the same prop drawn smaller.
      const variants = buildVariants(
        'grass',
        this.theme,
        this.seed ^ (0x9e37 + bi * 0x2545),
        band.variants,
        1,
        { blades: band.blades }
      );
      const per = Math.max(1, Math.floor(band.count / variants.length));
      // The spiral below is laid out across the whole BAND, not per variant —
      // restarting it for each mesh would stack four populations on one path.
      let seedIndex = 0;

      for (let vi = 0; vi < variants.length; vi++) {
        const n = vi === variants.length - 1 ? band.count - per * (variants.length - 1) : per;
        if (n <= 0) continue;
        const mesh = new THREE.InstancedMesh(variants[vi].geometry, mat, n);
        mesh.name = `groundCover:${bi}:${vi}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Instances roam, so a bounding sphere computed once would cull tufts
        // that have since been recycled to the other side of the player.
        mesh.frustumCulled = false;

        const items = [];
        const first = seedIndex;
        for (let i = 0; i < n; i++) {
          const it = {
            x: 0,
            z: 0,
            y: 0,
            /** Rotation about Y, fixed for this tuft's whole life. */
            yaw: this._rng.next() * Math.PI * 2,
            /** Base size before the fade-in multiplies it. */
            size: this._rng.range(band.scale[0], band.scale[1]),
            /** Terrain normal at its feet, so it stands on the slope. */
            nx: 0,
            ny: 1,
            nz: 0,
            /** Rejected ground (road, cliff, too steep) parks a tuft at zero. */
            valid: false,
            /** Last fade actually written into the instance matrix. */
            drawn: -1,
          };
          this._seed(it, band, seedIndex++);
          items.push(it);
        }

        // `first` is where this mesh's slice starts on the band's spiral, so a
        // re-lay puts every tuft back on the same curve it was seeded from.
        this._groups.push({ mesh, band, items, first });
        this.root.add(mesh);

        // Per-instance tint, the same trick the forest uses: a field of
        // identical green is the one thing that reads as computer-generated.
        for (let i = 0; i < n; i++) {
          const t = 1 + this._rng.signed() * 0.14;
          _color.setRGB(t, t, t);
          mesh.setColorAt(i, _color);
          // Everything starts hidden; the first `update` decides what is real.
          mesh.setMatrixAt(i, _hidden);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    return this;
  }

  /**
   * Lay a tuft out around the current centre on a golden-angle spiral.
   *
   * A spiral rather than a uniform disc because it gives an even covering with
   * no clumps and no rejection sampling; the small jitter on top is what stops
   * it reading AS a spiral. `index` is the tuft's place in its band, so the
   * whole band traces one continuous curve.
   */
  _seed(item, band, index) {
    const GOLDEN = 2.399963229728653;
    const t = band.count > 1 ? index / (band.count - 1) : 0;
    const r = band.radius * Math.sqrt(clamp01(t + this._rng.signed() * 0.02));
    const a = index * GOLDEN + this._rng.signed() * 0.4;
    item.x = this._centre.x + Math.cos(a) * r;
    item.z = this._centre.z + Math.sin(a) * r;
    this._sample(item);
  }

  /**
   * Lay the entire population out again around the current centre.
   *
   * Recycling by reflection assumes the camera WALKED here: tufts arrive at the
   * band edge at zero size and grow in as you drive toward them. A car that
   * teleports — a respawn, a mode change, the first frame after the world is
   * built somewhere the player is not — breaks that assumption completely.
   * Every tuft would recycle to the rim in one frame and then just sit there,
   * because nothing is moving toward them, and the player would be standing in
   * a perfectly circular bald patch. So a jump gets a re-lay instead.
   */
  _recentre() {
    for (const g of this._groups) {
      let index = g.first;
      for (const it of g.items) {
        this._seed(it, g.band, index++);
        // Force a rewrite: this tuft is somewhere else entirely now.
        it.drawn = -1;
      }
    }
  }

  /**
   * Root a tuft at its current x/z: ground height, terrain normal, and whether
   * anything is allowed to grow here at all.
   *
   * This is the only expensive call in the file, and it runs once per tuft per
   * recycle — a few dozen times a frame at racing speed, never per tuft.
   */
  _sample(item) {
    const C = this.cfg;
    const t = this.terrain;
    if (!t.contains(item.x, item.z)) {
      item.valid = false;
      return;
    }
    // One `normalAt` serves both the standing angle and the slope test; asking
    // `slopeAt` as well would sample the heightfield four more times for a
    // number we already have.
    t.normalAt(item.x, item.z, _normal);
    item.nx = _normal.x;
    item.ny = _normal.y;
    item.nz = _normal.z;
    item.y = t.heightAt(item.x, item.z) - C.sink;

    const slope = 1 - _normal.y;
    if (slope > C.maxSlope) {
      item.valid = false;
      return;
    }
    if (!C.surfaces.includes(t.surfaceAt(item.x, item.z))) {
      item.valid = false;
      return;
    }
    // Roads, shoulders and their run-off. Same predicate as the forest.
    if (this.avoid && this.avoid(item.x, item.z)) {
      item.valid = false;
      return;
    }
    item.valid = true;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} cameraPosition the population follows this
   */
  update(dt, cameraPosition) {
    // One float write animates every blade in the world.
    this._phase += dt * this.cfg.wind.speed;
    this.materials.setWindTime(this._phase);

    if (!this._groups.length) return;

    // Driving here and teleporting here are different events, and only one of
    // them can be served by recycling. See `_recentre`.
    let jumped = !this._laid;
    if (cameraPosition) {
      jumped =
        jumped ||
        Math.hypot(cameraPosition.x - this._centre.x, cameraPosition.z - this._centre.z) >
          this._widest;
      this._centre.copy(cameraPosition);
    }
    if (jumped) {
      this._laid = true;
      this._recentre();
    }

    const cx = this._centre.x;
    const cz = this._centre.z;
    const eps = this.cfg.fadeEpsilon;

    for (const group of this._groups) {
      const { mesh, band, items } = group;
      const R = band.radius;
      const fadeFrom = R * (1 - this.cfg.fadeBand);
      let dirty = false;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let dx = it.x - cx;
        let dz = it.z - cz;
        let d2 = dx * dx + dz * dz;

        if (d2 > R * R) {
          // RECYCLE. Reflect through the camera and pull just inside the rim:
          // the tuft reappears at the far edge of the band, directly ahead of
          // a player who was driving away from it, at zero size.
          const d = Math.sqrt(d2) || 1;
          const k = (R * 0.998) / d;
          it.x = cx - dx * k;
          it.z = cz - dz * k;
          this._sample(it);
          dx = it.x - cx;
          dz = it.z - cz;
          d2 = dx * dx + dz * dz;
        }

        let fade = it.valid ? 1 - smoothstep(fadeFrom, R, Math.sqrt(d2)) : 0;
        // Snap the two plateaus to exact values. Without this a tuft that
        // leaves the band while still an epsilon tall never gets its final
        // write, so it is *drawn*, at a sub-pixel size, at a position it left
        // several hundred metres ago. Invisible, and still a lie.
        if (fade < eps) fade = 0;
        else if (fade > 1 - eps) fade = 1;
        if (fade === it.drawn || Math.abs(fade - it.drawn) < eps) continue;

        it.drawn = fade;
        if (fade <= 0) {
          mesh.setMatrixAt(i, _hidden);
        } else {
          // Stand it on the slope, then spin it about its own new up-axis, so
          // the yaw does not un-tilt the blade on a hillside.
          _normal.set(it.nx, it.ny, it.nz);
          _tilt.setFromUnitVectors(_up, _normal);
          _yaw.setFromAxisAngle(_up, it.yaw);
          _q.copy(_tilt).multiply(_yaw);
          const s = it.size * fade;
          _pos.set(it.x, it.y, it.z);
          _scl.set(s, s, s);
          mesh.setMatrixAt(i, _m.compose(_pos, _q, _scl));
        }
        dirty = true;
      }

      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const g of this._groups) {
      g.mesh.geometry.dispose();
      g.mesh.dispose();
    }
    this._groups.length = 0;
    this.root.clear();
  }
}
