/**
 * SCATTER — places thousands of props without thousands of draw calls.
 *
 * One InstancedMesh per (prop kind, variant). Placement is rejection sampling
 * against a noise-driven density field, which is what stops a forest looking
 * like graph paper: trees clump into stands with clearings between them.
 *
 * Everything is deterministic from the world seed, so the same world comes back
 * every reload — which matters a great deal for a game whose whole premise is
 * that the world is a fixed, authored thing you were not supposed to leave.
 */

import * as THREE from 'three';
import { buildVariants } from './props.js';
import { fbm2, clamp01, lerp, smoothstep } from '../core/mathx.js';
import { Rng } from '../core/rng.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

/** Default scattering rules per prop kind. Override per call. */
export const SCATTER_RULES = {
  pine: {
    variants: 5,
    scale: [0.8, 1.35],
    /** Reject slopes steeper than this (0..1, from Terrain's slope metric). */
    maxSlope: 0.42,
    surfaces: ['GRASS', 'DIRT'],
    /** Clumping: higher = tighter stands with emptier gaps. */
    clumping: 0.72,
    clumpScale: 0.0022,
    tintJitter: 0.1,
    /** Random lean, radians. Trees are never perfectly upright. */
    lean: 0.045,
  },
  broadleaf: { variants: 4, scale: [0.85, 1.3], maxSlope: 0.38, surfaces: ['GRASS'], clumping: 0.55, clumpScale: 0.0031, tintJitter: 0.12, lean: 0.05 },
  dead: { variants: 3, scale: [0.8, 1.2], maxSlope: 0.5, surfaces: ['GRASS', 'DIRT', 'MUD'], clumping: 0.25, clumpScale: 0.005, tintJitter: 0.06, lean: 0.12 },
  rock: { variants: 6, scale: [0.7, 1.6], maxSlope: 0.8, surfaces: ['GRASS', 'DIRT', 'MUD'], clumping: 0.45, clumpScale: 0.004, tintJitter: 0.08, lean: 0.14 },
  bush: { variants: 5, scale: [0.7, 1.5], maxSlope: 0.5, surfaces: ['GRASS', 'DIRT'], clumping: 0.5, clumpScale: 0.0045, tintJitter: 0.14, lean: 0.08 },
  grass: { variants: 4, scale: [0.7, 1.6], maxSlope: 0.45, surfaces: ['GRASS'], clumping: 0.35, clumpScale: 0.006, tintJitter: 0.18, lean: 0.1 },
  log: { variants: 3, scale: [0.8, 1.2], maxSlope: 0.3, surfaces: ['GRASS', 'DIRT'], clumping: 0.2, clumpScale: 0.006, tintJitter: 0.08, lean: 0.06 },
  sign: { variants: 2, scale: [0.9, 1.1], maxSlope: 0.25, surfaces: ['GRASS', 'DIRT'], clumping: 0.0, clumpScale: 0.01, tintJitter: 0.03, lean: 0.02 },
};

export class Scatter {
  /**
   * @param {object} opts
   * @param {import('./terrain.js').Terrain} opts.terrain
   * @param {import('../render/materials.js').MaterialLibrary} opts.materials
   * @param {object} opts.theme resolved theme
   * @param {number} opts.seed
   */
  constructor({ terrain, materials, theme, seed = 1 }) {
    this.terrain = terrain;
    this.materials = materials;
    this.theme = theme;
    this.seed = seed;
    this.root = new THREE.Group();
    this.root.name = 'scatter';
    /** Colliders produced by placement; hand these to the CollisionGrid. */
    this.colliders = [];
    this._meshes = [];
  }

  /**
   * @param {object} opts
   * @param {string} opts.kind key in PROP_FACTORIES
   * @param {number} opts.count how many to *attempt* — clumping rejects some
   * @param {object} [opts.region] `{ radius }` disc, or `{ inner, outer }` ring
   * @param {(x:number,z:number)=>boolean} [opts.avoid] return true to reject a spot
   * @param {string} [opts.material] material role; defaults per kind
   */
  place({ kind, count, region = {}, avoid = null, material = null, rules = null }) {
    const R = { ...(SCATTER_RULES[kind] || SCATTER_RULES.rock), ...(rules || {}) };
    const rng = new Rng(this.seed ^ hash(kind));
    const variants = buildVariants(kind, this.theme, this.seed ^ hash(kind + ':geo'), R.variants);

    const inner = region.inner ?? 0;
    const outer = region.outer ?? region.radius ?? this.terrain.halfSpan * 0.95;

    /** @type {{matrix: THREE.Matrix4, tint: number}[][]} per variant */
    const buckets = variants.map(() => []);
    const maxAttempts = count * 3;
    let placed = 0;

    for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
      // Uniform in the annulus, not uniform in radius — otherwise everything
      // piles up at the centre.
      const r = Math.sqrt(lerp(inner * inner, outer * outer, rng.next()));
      const a = rng.next() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (!this.terrain.contains(x, z)) continue;
      if (avoid && avoid(x, z)) continue;

      const surface = this.terrain.surfaceAt(x, z);
      if (R.surfaces && !R.surfaces.includes(surface)) continue;

      // Slope rejection: nothing grows on a cliff face.
      this.terrain.normalAt(x, z, _pos);
      const slope = 1 - _pos.y;
      if (slope > R.maxSlope) continue;

      // Clumping: a low-frequency noise field decides where stands are.
      if (R.clumping > 0) {
        const d = fbm2(x * R.clumpScale, z * R.clumpScale, 3) * 0.5 + 0.5;
        const accept = lerp(1, smoothstep(0.32, 0.72, d), R.clumping);
        if (rng.next() > accept) continue;
      }

      const vi = rng.int(0, variants.length - 1);
      const y = this.terrain.heightAt(x, z);
      const scale = rng.range(R.scale[0], R.scale[1]);

      _pos.set(x, y - 0.08, z);
      _scl.set(scale, scale, scale);
      // Yaw is free variety; a small lean stops the "spawned by a computer" look.
      _q.setFromAxisAngle(_up, rng.next() * Math.PI * 2);
      if (R.lean > 0) {
        const leanQ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(rng.signed(), 0, rng.signed()).normalize(),
          rng.next() * R.lean
        );
        _q.premultiply(leanQ);
      }
      const m = new THREE.Matrix4().compose(_pos, _q, _scl);

      const jitter = 1 + rng.signed() * R.tintJitter;
      const entry = { matrix: m, tint: jitter, collider: null };
      buckets[vi].push(entry);

      const col = variants[vi].collider;
      if (col) {
        const collider =
          col.type === 'cylinder'
            ? {
                type: 'cylinder',
                x,
                y: y + (col.yOffset ?? 0) * scale,
                z,
                radius: col.radius * scale,
                height: (col.height ?? 4) * scale,
                blocksSight: !!col.blocksSight,
                kind,
              }
            : {
                type: 'box',
                x,
                y: y + (col.yOffset ?? 0) * scale,
                z,
                halfX: col.halfX * scale,
                halfY: col.halfY * scale,
                halfZ: col.halfZ * scale,
                rotationY: Math.atan2(
                  2 * (_q.w * _q.y + _q.x * _q.z),
                  1 - 2 * (_q.y * _q.y + _q.x * _q.x)
                ),
                blocksSight: !!col.blocksSight,
                kind,
              };
        // A collider IS the identity of one prop: damage, felling and the
        // instance that draws it all hang off this object. `mesh`/`instance`
        // are filled in below, once the InstancedMesh actually exists.
        collider.baseMatrix = m;
        collider.scale = scale;
        /** Local Y where this variant's canopy starts — see world/trees.js. */
        collider.canopyY = variants[vi].canopyY ?? null;
        collider.mesh = null;
        collider.instance = -1;
        collider.tint = jitter;
        entry.collider = collider;
        this.colliders.push(collider);
      }
      placed++;
    }

    // Build one InstancedMesh per variant that actually got used.
    const mat = this.materials.get(material || defaultMaterialFor(kind));
    for (let vi = 0; vi < variants.length; vi++) {
      const list = buckets[vi];
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(variants[vi].geometry, mat, list.length);
      mesh.name = `scatter:${kind}:${vi}`;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].matrix);
        const t = list[i].tint;
        _color.setRGB(t, t, t);
        mesh.setColorAt(i, _color);
        if (list[i].collider) {
          list[i].collider.mesh = mesh;
          list[i].collider.instance = i;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      this.root.add(mesh);
      this._meshes.push(mesh);
    }

    return placed;
  }

  dispose() {
    for (const m of this._meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this._meshes.length = 0;
    this.colliders.length = 0;
  }
}

function defaultMaterialFor(kind) {
  if (kind === 'rock') return 'prop';
  if (kind === 'sign' || kind === 'post') return 'barrier';
  if (kind === 'log') return 'trunk';
  return 'foliage';
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
