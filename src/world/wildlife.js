/**
 * WILDLIFE — the open world with something living in it.
 *
 * THE TRICK
 * ---------
 * These are not scattered like trees. A fixed population lives in a ring that
 * FOLLOWS THE CAMERA: anything that falls too far behind is recycled to
 * somewhere ahead of you. So a hundred and forty animals make an entire 1400m
 * world feel inhabited, and they are always near enough to see. Scatter a
 * hundred and forty cats across that disc instead and you would meet one a
 * fortnight.
 *
 * Nothing here has a collider, by design. You drive through a butterfly, and
 * the cat was never really there.
 *
 * One InstancedMesh per (kind, variant); each animal owns a permanent slot in
 * one of them, and "recycling" only ever rewrites its position. No allocation
 * happens after `build()`.
 */

import * as THREE from 'three';
import { buildVariants } from './props.js';
import { WILDLIFE } from '../config/gameplay.js';
import { Subscriptions } from '../core/events.js';
import { Rng } from '../core/rng.js';
import { lerp } from '../core/mathx.js';

const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();
const _color = new THREE.Color();

export class Wildlife {
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
    this.root.name = 'wildlife';
    /** @type {{mesh: THREE.InstancedMesh, kind: string, cfg: object, items: object[]}[]} */
    this._groups = [];
    this._meshes = [];
    this._time = 0;
    this._rng = new Rng(seed ^ 0x1f0e5);
    /** Where the population is currently centred. */
    this._centre = new THREE.Vector3();
    /**
     * The forest holds its breath until the cops are gone. Until this is true
     * nothing is drawn and nothing is stepped — see `WILDLIFE.armedBy`.
     */
    this.armed = false;
    this.subs = new Subscriptions();
    for (const ev of [].concat(WILDLIFE.armedBy)) this.subs.on(ev, () => this.arm());
  }

  /**
   * Let the world come back to life.
   *
   * Everyone was seeded around the origin when the world was built, which is a
   * long way from wherever the player finally shook the chase. Re-place the
   * whole population around the camera on the way in, or the first thing they
   * see is an empty forest and a distant cloud of butterflies over the start line.
   */
  arm() {
    if (this.armed) return this;
    this.armed = true;
    this.root.visible = true;
    for (const g of this._groups) for (const it of g.items) this._place(it, g.cfg, false);
    return this;
  }

  build() {
    // Built, but not present. `arm()` is what puts it on screen.
    this.root.visible = false;
    const mat = this.materials.get('foliage');
    for (const [kind, cfg] of Object.entries(WILDLIFE.kinds)) {
      const variants = buildVariants(kind, this.theme, this.seed ^ hash(kind), cfg.variants);
      // Spread the population evenly across the variants.
      const per = Math.max(1, Math.floor(cfg.count / variants.length));
      for (let vi = 0; vi < variants.length; vi++) {
        const n = vi === variants.length - 1 ? cfg.count - per * (variants.length - 1) : per;
        if (n <= 0) continue;
        const mesh = new THREE.InstancedMesh(variants[vi].geometry, mat, n);
        mesh.name = `wildlife:${kind}:${vi}`;
        // These move every frame, unlike everything else in the world.
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Frustum culling on a mesh whose instances roam is a liability: the
        // bounds are computed once and would cull animals that have since
        // wandered outside them.
        mesh.frustumCulled = false;

        const items = [];
        for (let i = 0; i < n; i++) items.push(this._spawn(kind, cfg, true));
        this._groups.push({ mesh, kind, cfg, items });
        this._meshes.push(mesh);
        this.root.add(mesh);

        // A touch of per-instance tint so a flock is not four clones.
        for (let i = 0; i < n; i++) {
          const t = 1 + this._rng.signed() * 0.09;
          _color.setRGB(t, t, t);
          mesh.setColorAt(i, _color);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    return this;
  }

  /** One animal's state. `initial` seeds it around the origin at build time. */
  _spawn(kind, cfg, initial = false) {
    const rng = this._rng;
    const item = {
      x: 0,
      y: 0,
      z: 0,
      heading: rng.next() * Math.PI * 2,
      speed: rng.range(cfg.speed[0], cfg.speed[1]),
      hover: rng.range(cfg.hover[0], cfg.hover[1]),
      phase: rng.next() * Math.PI * 2,
      timer: 0,
      moving: true,
      // Birds only.
      orbit: cfg.orbit ? rng.range(cfg.orbit[0], cfg.orbit[1]) : 0,
      cx: 0,
      cz: 0,
      spin: rng.signed() < 0 ? -1 : 1,
    };
    this._place(item, cfg, initial);
    return item;
  }

  /** Drop an animal somewhere in the ring around the camera. */
  _place(item, cfg, initial) {
    const rng = this._rng;
    const c = this._centre;
    const far = cfg.radius ?? WILDLIFE.radius;
    // Recycled animals reappear at least `minSpawn` away so nothing pops into
    // view — but never further than this kind's own range.
    const near = initial ? Math.min(8, far * 0.2) : Math.min(WILDLIFE.minSpawn, far * 0.65);
    const r = lerp(near, far, Math.sqrt(rng.next()));
    const a = rng.next() * Math.PI * 2;
    let x = c.x + Math.cos(a) * r;
    let z = c.z + Math.sin(a) * r;
    // Never outside the world; fold back toward the middle if we would be.
    if (!this.terrain.contains(x, z)) {
      x = c.x - Math.cos(a) * r;
      z = c.z - Math.sin(a) * r;
    }
    item.x = x;
    item.z = z;
    item.cx = x;
    item.cz = z;
    item.timer = rng.range(0.2, 2.5);
    item.y = this.terrain.heightAt(x, z) + item.hover;
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} cameraPosition the population follows this
   */
  update(dt, cameraPosition) {
    // Not armed: nothing drawn, nothing stepped, nothing costed.
    if (!this.armed || !this._groups.length) {
      if (cameraPosition) this._centre.copy(cameraPosition);
      return;
    }
    this._time += dt;
    if (cameraPosition) this._centre.copy(cameraPosition);
    for (const group of this._groups) {
      const { mesh, kind, cfg, items } = group;
      const cut = (cfg.radius ?? WILDLIFE.radius) + WILDLIFE.margin;
      const cutSq = cut * cut;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];

        const dx = it.x - this._centre.x;
        const dz = it.z - this._centre.z;
        if (dx * dx + dz * dz > cutSq) this._place(it, cfg, false);

        if (kind === 'bird') this._stepBird(it, dt, cfg);
        else if (kind === 'butterfly') this._stepButterfly(it, dt, cfg);
        else this._stepGround(it, dt, cfg);

        this._compose(it, kind, cfg);
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Cats and foxes: walk a while, stop a while, look around. */
  _stepGround(item, dt, cfg) {
    item.timer -= dt;
    if (item.timer <= 0) {
      item.moving = !item.moving;
      item.timer = item.moving
        ? this._rng.range(cfg.turn[0], cfg.turn[1])
        : this._rng.range(cfg.idle[0], cfg.idle[1]);
      if (item.moving) item.heading += this._rng.signed() * 2.2;
    }
    if (item.moving) {
      item.x += Math.sin(item.heading) * item.speed * dt;
      item.z += Math.cos(item.heading) * item.speed * dt;
    }
    const ground = this.terrain.heightAt(item.x, item.z);
    // A small vertical bob while moving reads as legs without animating any.
    const bob = item.moving ? Math.abs(Math.sin(this._time * 9 + item.phase)) * 0.05 : 0;
    item.y = ground + bob;
  }

  /** Butterflies: a drunk walk, close to the ground, never still. */
  _stepButterfly(item, dt, cfg) {
    item.timer -= dt;
    if (item.timer <= 0) {
      item.timer = this._rng.range(cfg.turn[0], cfg.turn[1]);
      item.heading += this._rng.signed() * 1.9;
    }
    item.x += Math.sin(item.heading) * item.speed * dt;
    item.z += Math.cos(item.heading) * item.speed * dt;
    const ground = this.terrain.heightAt(item.x, item.z);
    // Bobbing up and down is most of the illusion; the wings never flap.
    item.y = ground + item.hover + Math.sin(this._time * 4.5 + item.phase) * 0.35;
  }

  /** Birds: long lazy orbits, banked into the turn. */
  _stepBird(item, dt, cfg) {
    item.heading += (item.speed / Math.max(4, item.orbit)) * dt * item.spin;
    item.x = item.cx + Math.cos(item.heading) * item.orbit;
    item.z = item.cz + Math.sin(item.heading) * item.orbit;
    const ground = this.terrain.heightAt(item.x, item.z);
    item.y = ground + item.hover + Math.sin(this._time * 0.6 + item.phase) * 1.4;
  }

  _compose(item, kind, cfg) {
    _pos.set(item.x, item.y, item.z);
    if (kind === 'bird') {
      // Face along the tangent of the orbit, and lean into it.
      const yaw = -item.heading + (item.spin > 0 ? -Math.PI / 2 : Math.PI / 2);
      _euler.set(0, yaw, -cfg.bank * item.spin, 'YXZ');
    } else if (kind === 'butterfly') {
      // The flutter: a fast roll wobble around the direction of travel. At this
      // size it is indistinguishable from wings, and costs one sine.
      _euler.set(
        Math.sin(this._time * cfg.wobble * 0.7 + item.phase) * 0.35,
        item.heading,
        Math.sin(this._time * cfg.wobble + item.phase) * 0.9,
        'YXZ'
      );
    } else {
      _euler.set(0, item.heading, 0, 'YXZ');
    }
    _q.setFromEuler(_euler);
    _m.compose(_pos, _q, _scl);
  }

  dispose() {
    this.subs.dispose();
    for (const m of this._meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this._meshes.length = 0;
    this._groups.length = 0;
    this.root.clear();
  }
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
