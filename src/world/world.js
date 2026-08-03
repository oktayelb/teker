/**
 * WORLD — one terrain, three parkours, a forest, and everything in between.
 *
 * THE IMPORTANT DECISION IN THIS FILE
 * -----------------------------------
 * All three tracks are built into the *same* terrain, at the same time, once.
 * A race does not load a track; it points the rules at one of the ribbons that
 * were always there. That costs a little more memory and buys the entire
 * premise of the game: when the player leaves the third parkour, the first two
 * are still standing a few hundred metres away, and they can drive back to them
 * and look at the start line they were on ten minutes ago. Nothing is streamed
 * in behind them, because nothing was ever streamed in.
 *
 * The World is also the physics environment. It answers two questions for any
 * vehicle: what is the ground here, and did I just hit something.
 */

import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Track, ROAD } from './track.js';
import { Scatter } from './scatter.js';
import { CollisionGrid } from './collision.js';
import { TrackLighting } from './lighting.js';
import { Trees } from './trees.js';
import { Wildlife } from './wildlife.js';
import { GroundCover } from './groundCover.js';
import { Trails } from './trails.js';
import { OPEN_WORLD } from '../config/gameplay.js';
import { surfaceById } from '../config/tuning.js';
import { clamp01, lerp, smoothstep } from '../core/mathx.js';
import { events } from '../core/events.js';

const _normal = new THREE.Vector3();

/**
 * Points of interest, as data.
 *
 * Polar rather than cartesian so they survive a change of world radius, and
 * module-scope rather than inline because the trail network needs to know
 * where they are *before* the terrain mesh is built — a path that leads
 * somewhere has to be painted into the ground at the same moment the ground is
 * (`world/trails.js`). `OPEN_WORLD.trails.links` indexes into this array.
 */
export const LANDMARK_DEFS = [
  { name: 'Vadi', label: 'the valley floor', angle: 0.4, dist: 0.34, radius: 90 },
  { name: 'Kule', label: 'a radio mast, unlit', angle: 2.1, dist: 0.62, radius: 70 },
  { name: 'Göl', label: 'still water', angle: 3.4, dist: 0.48, radius: 110 },
  { name: 'Taşlar', label: 'stones in a ring', angle: 4.6, dist: 0.55, radius: 60 },
  { name: 'Sırt', label: 'the ridge', angle: 5.5, dist: 0.72, radius: 100 },
  { name: 'Kenar', label: 'where the fog does not lift', angle: 1.2, dist: 0.93, radius: 140 },
];

export class World {
  /**
   * @param {object} opts
   * @param {import('../render/materials.js').MaterialLibrary} opts.materials
   * @param {object} opts.theme resolved theme
   * @param {number} [opts.seed]
   */
  constructor({ materials, theme, seed = OPEN_WORLD.seed, lightPool = null }) {
    this.materials = materials;
    this.lightPool = lightPool;
    this.theme = theme;
    this.seed = seed;

    this.root = new THREE.Group();
    this.root.name = 'world';

    this.terrain = null;
    /** @type {Map<string, Track>} */
    this.tracks = new Map();
    /** @type {Track|null} the ribbon the current mode cares about */
    this.activeTrack = null;
    this.collision = new CollisionGrid(12);
    this.scatter = null;
    /** Animals, pooled around the camera. See wildlife.js. */
    this.wildlife = null;
    /** Grass, pooled around the camera the same way. See groundCover.js. */
    this.groundCover = null;
    /** Worn routes, painted into the terrain's vertex colours. See trails.js. */
    this.trails = null;
    /** Trunk damage and the disguise. See trees.js. */
    this.trees = new Trees();
    /** @type {{name:string,position:THREE.Vector3,radius:number,discovered:boolean}[]} */
    this.landmarks = [];
    /** @type {Map<string, TrackLighting>} tracks that carry a lighting rig */
    this.lighting = new Map();

    this._trackList = [];
    this._trackGroups = new Map();
    this._query = {};
    this._built = false;
  }

  get halfSpan() {
    return this.terrain?.halfSpan ?? 0;
  }

  /**
   * Build everything. Yields to the event loop between stages so a loading
   * screen can actually paint.
   * @param {object} opts
   * @param {object[]} opts.trackData track definition modules
   * @param {(stage:string, progress:number)=>void} [opts.onProgress]
   */
  async build({ trackData = [], onProgress = null, scatter = true } = {}) {
    const step = async (stage, progress, fn) => {
      onProgress?.(stage, progress);
      events.emit('world:building', { stage, progress });
      await new Promise((r) => setTimeout(r, 0));
      return fn();
    };

    await step('terrain', 0.05, () => {
      this.terrain = new Terrain({
        resolution: OPEN_WORLD.terrainResolution,
        cellSize: OPEN_WORLD.terrainCellSize,
        seed: this.seed,
      });
    });

    await step('tracks', 0.15, () => {
      for (const data of trackData) {
        const t = new Track(data);
        this.tracks.set(t.id, t);
        this._trackList.push(t);
      }
      // Every track flattens the land it sits on. Chained, so overlapping
      // flatten radii resolve to whichever track is nearest.
      this.terrain.shaper = (x, z, h) => {
        let out = h;
        for (const t of this._trackList) out = t.shapeTerrain(x, z, out);
        return out;
      };
    });

    await step('heightfield', 0.3, () => this.terrain.generate());

    // Worn routes have to exist BEFORE the ground is coloured, because they
    // are drawn into the ground's own vertex colours rather than on top of it.
    // Only positions are needed here, which is why `LANDMARK_DEFS` is data at
    // module scope and `_placeLandmarks` (which wants heights) can stay late.
    await step('trails', 0.42, () => {
      const span = this.terrain.halfSpan;
      this.trails = new Trails({
        halfSpan: span,
        landmarks: LANDMARK_DEFS.map((d) => ({
          x: Math.cos(d.angle) * span * d.dist,
          z: Math.sin(d.angle) * span * d.dist,
        })),
        tracks: this._trackList,
        seed: this.seed,
      });
      this.terrain.painter = this.trails.painter(this.theme);
    });

    await step('terrain-mesh', 0.5, () => {
      this.root.add(this.terrain.buildMesh(this.materials, this.theme));
    });

    await step('track-mesh', 0.62, () => {
      for (const t of this._trackList) {
        const g = t.buildMesh(this.materials, this.theme);
        this._trackGroups.set(t.id, g);
        this.root.add(g);
        this.collision.insertAll(t.colliders);
        // A track with a lighting rig gets a system to run it. Note the plastic
        // markers are deliberately NOT added to the collision grid.
        if (this.lightPool && t.lightAnchors.length > 0) {
          this.lighting.set(t.id, new TrackLighting({ track: t, pool: this.lightPool, group: g }));
        }
      }
    });

    if (scatter) {
      await step('forest', 0.72, () => this._scatterForest());
      await step('ground-cover', 0.86, () => {
        // Grass stops at the verge for the same reason the trees do, and by the
        // same rule — but tighter, because a track with a bare metre of dirt
        // either side of it reads as maintained, which this one is not. It also
        // stops on the worn routes: a path with grass growing down the middle
        // of it is a lawn, and the ground under it is already painted as bare.
        const offRoad = this._trackAvoidance(OPEN_WORLD.groundCover.trackClearance);
        const worn = OPEN_WORLD.trails.grassFreeAbove;
        this.groundCover = new GroundCover({
          terrain: this.terrain,
          materials: this.materials,
          theme: this.theme,
          seed: this.seed ^ 0x6c0f,
          avoid: (x, z) => offRoad(x, z) || this.trails.strengthAt(x, z) > worn,
        }).build();
        this.root.add(this.groundCover.root);
      });
      await step('wildlife', 0.9, () => {
        this.wildlife = new Wildlife({
          terrain: this.terrain,
          materials: this.materials,
          theme: this.theme,
          seed: this.seed ^ 0xa11e,
        }).build();
        this.root.add(this.wildlife.root);
      });
    }

    await step('landmarks', 0.94, () => this._placeLandmarks());

    onProgress?.('done', 1);
    this._built = true;
    events.emit('world:built', { tracks: [...this.tracks.keys()] });
    return this;
  }

  /**
   * A predicate that rejects anything too close to a racing surface.
   *
   * Shared by the forest and the ground cover so there is exactly one answer to
   * "is this the road?" — if they used different rules you would get grass
   * growing where trees are forbidden, which reads as a mown verge.
   *
   * @param {number} margin metres of clearance beyond the shoulder
   * @returns {(x:number, z:number)=>boolean} true = do not place here
   */
  _trackAvoidance(margin) {
    const clearance = ROAD.shoulderWidth + margin;
    return (x, z) => {
      for (const t of this._trackList) {
        const q = t.query(x, z, this._query);
        if (q && q.dist < q.halfWidth + clearance) return true;
      }
      return false;
    };
  }

  /**
   * A predicate that rejects anywhere NOT within `radius` of a tree that has
   * already been planted.
   *
   * The understorey has to come after the canopy, in both senses: it is placed
   * after the trees, and it is placed *because of* them. Handing this to
   * `Scatter#place` as its `avoid` is what turns a second even scattering of
   * ferns into a forest floor.
   *
   * Buckets the trunks into a grid at exactly the query radius, so a lookup
   * touches four cells and nothing else. With 4200 trees a linear scan per
   * attempt would be sixty million distance tests over the three placements.
   *
   * @param {object[]} colliders `Scatter#colliders`, filtered by `kind`
   * @param {number} radius metres
   * @returns {(x:number, z:number)=>boolean} true = do not place here
   */
  _treeProximity(colliders, radius) {
    const cell = radius;
    const grid = new Map();
    for (const c of colliders) {
      const key = Math.floor(c.x / cell) + ',' + Math.floor(c.z / cell);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(c);
    }
    const r2 = radius * radius;
    return (x, z) => {
      const gi = Math.floor(x / cell);
      const gj = Math.floor(z / cell);
      for (let j = gj - 1; j <= gj + 1; j++) {
        for (let i = gi - 1; i <= gi + 1; i++) {
          const list = grid.get(i + ',' + j);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const dx = list[k].x - x;
            const dz = list[k].z - z;
            if (dx * dx + dz * dz <= r2) return false;
          }
        }
      }
      return true;
    };
  }

  _scatterForest() {
    const s = new Scatter({
      terrain: this.terrain,
      materials: this.materials,
      theme: this.theme,
      seed: this.seed,
    });
    this.scatter = s;

    // Keep props off the racing surface and its run-off, but let them creep
    // right up to the edge — the forest should feel like it is pressing in.
    const avoidTracks = this._trackAvoidance(3.5);

    const D = OPEN_WORLD.scatterDensity;
    const span = this.terrain.halfSpan;
    s.place({ kind: 'pine', count: Math.round(D.trees * 0.62), region: { radius: span * 0.97 }, avoid: avoidTracks });
    s.place({ kind: 'broadleaf', count: Math.round(D.trees * 0.28), region: { radius: span * 0.9 }, avoid: avoidTracks });
    s.place({ kind: 'dead', count: Math.round(D.trees * 0.1), region: { inner: span * 0.3, radius: span * 0.97 }, avoid: avoidTracks });
    s.place({ kind: 'rock', count: D.rocks, region: { radius: span * 0.97 }, avoid: avoidTracks });
    s.place({ kind: 'bush', count: D.bushes, region: { radius: span * 0.95 }, avoid: avoidTracks });
    // THE UNDERSTOREY, placed after the canopy it belongs under and *because*
    // of it: `_treeProximity` rejects anywhere that is not within reach of a
    // trunk that has already gone in. Everything from here down is scenery you
    // drive straight through, so none of it produces a collider.
    const nearTrees = this._treeProximity(
      s.colliders.filter((c) => c.kind === 'pine' || c.kind === 'broadleaf'),
      OPEN_WORLD.understoreyRadius
    );
    const underCanopy = (x, z) => avoidTracks(x, z) || nearTrees(x, z);
    s.place({ kind: 'fern', count: D.ferns, region: { radius: span * 0.95 }, avoid: underCanopy });
    s.place({ kind: 'undergrowth', count: D.undergrowth, region: { radius: span * 0.95 }, avoid: underCanopy });
    s.place({ kind: 'litter', count: D.litter, region: { radius: span * 0.95 }, avoid: underCanopy });
    // Grass is NOT scattered. It is a pool that follows the camera — see
    // `groundCover.js` and `OPEN_WORLD.groundCover`.
    s.place({ kind: 'log', count: Math.round(D.rocks * 0.35), region: { radius: span * 0.9 }, avoid: avoidTracks });
    // Blank signs only exist away from the tracks. Nobody was meant to read them.
    s.place({ kind: 'sign', count: 90, region: { inner: span * 0.25, radius: span * 0.9 }, avoid: avoidTracks });
    // Signs somebody left, and cars somebody left. Kept off the inner ring so
    // the first thing past the tracks is still forest.
    s.place({ kind: 'poster', count: D.posters, region: { inner: span * 0.12, radius: span * 0.92 }, avoid: avoidTracks });
    s.place({ kind: 'wreck', count: D.wrecks, region: { inner: span * 0.15, radius: span * 0.9 }, avoid: avoidTracks });

    this.root.add(s.root);
    this.collision.insertAll(s.colliders);
  }

  /**
   * Points of interest, placed relative to the terrain rather than authored by
   * hand, so they survive a seed change. They exist to give the open world
   * somewhere to *go*.
   */
  _placeLandmarks() {
    const span = this.terrain.halfSpan;
    for (const d of LANDMARK_DEFS) {
      const x = Math.cos(d.angle) * span * d.dist;
      const z = Math.sin(d.angle) * span * d.dist;
      this.landmarks.push({
        name: d.name,
        label: d.label,
        position: new THREE.Vector3(x, this.terrain.heightAt(x, z), z),
        radius: d.radius,
        discovered: false,
      });
    }

    // One physical landmark you can actually see from a distance: the mast.
    const mast = this.landmarks.find((l) => l.name === 'Kule');
    if (mast) this.root.add(this._buildMast(mast.position));
  }

  _buildMast(position) {
    const g = new THREE.Group();
    g.name = 'landmark:mast';
    const mat = this.materials.get('barrier');
    const h = 58;
    const geo = new THREE.CylinderGeometry(0.5, 2.4, h, 5, 1, true);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    colors.fill(0.42);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, position.y + h / 2, position.z);
    g.add(mesh);

    // A red lamp at the top. It blinks. Nobody put it there for you.
    const lampGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const lampColors = new Float32Array(lampGeo.attributes.position.count * 3);
    for (let i = 0; i < lampGeo.attributes.position.count; i++) {
      lampColors[i * 3] = 1;
      lampColors[i * 3 + 1] = 0.1;
      lampColors[i * 3 + 2] = 0.1;
    }
    lampGeo.setAttribute('color', new THREE.BufferAttribute(lampColors, 3));
    const lamp = new THREE.Mesh(lampGeo, this.materials.get('emissive'));
    lamp.position.set(position.x, position.y + h + 1, position.z);
    lamp.userData.blink = true;
    g.add(lamp);
    this._mastLamp = lamp;

    this.collision.insert({
      type: 'cylinder',
      x: position.x,
      y: position.y + h / 2,
      z: position.z,
      radius: 2.6,
      height: h,
      blocksSight: true,
      kind: 'mast',
    });
    return g;
  }

  // -- the physics environment ----------------------------------------------

  /**
   * The ground under a world position.
   * @returns {{height:number, normal:THREE.Vector3, surface:string}}
   */
  sampleGround(x, z) {
    const terrainH = this.terrain.heightAt(x, z);
    let height = terrainH;
    let surface = this.terrain.surfaceAt(x, z);

    // Roads override both height and surface. Using the ribbon's own elevation
    // (rather than the coarse heightfield) is what keeps the tarmac glass-smooth
    // while the terrain around it stays cheap.
    for (const t of this._trackList) {
      const q = t.query(x, z, this._query);
      if (!q) continue;
      const inner = q.halfWidth + ROAD.shoulderWidth;
      const reach = Math.max(inner, q.halfWidth + q.runoff);
      if (q.dist > reach + 9) continue;
      const w = 1 - smoothstep(inner, inner + 9, q.dist);
      height = lerp(terrainH, q.height + ROAD.roadLift, w);
      if (q.dist <= q.halfWidth) {
        surface = q.surface;
      } else if (q.runoff > 0 && q.dist <= q.halfWidth + q.runoff) {
        // A patched section keeps its surface past the tarmac — see
        // Track#_applyPatches. This is what makes running wide unrecoverable.
        surface = q.surface;
      } else if (q.dist <= inner) {
        surface = 'DIRT';
      }
      break;
    }

    // Outside the built world the ground is flat, wrong, and obviously so.
    if (!this.terrain.contains(x, z)) {
      surface = 'VOID';
    }

    this.terrain.normalAt(x, z, _normal);
    return { height, normal: _normal, surface };
  }

  /**
   * Just the height, for callers that ask several times per step and do not
   * care about the surface or the normal — see `Vehicle#_sampleGround`, which
   * probes the ground fore and aft of the car so the nose stops burying itself
   * in hillsides. Skipping `normalAt` alone saves four heightfield samples.
   * @returns {number} metres
   */
  groundHeightAt(x, z) {
    const terrainH = this.terrain.heightAt(x, z);
    for (const t of this._trackList) {
      const q = t.query(x, z, this._query);
      if (!q) continue;
      const inner = q.halfWidth + ROAD.shoulderWidth;
      const reach = Math.max(inner, q.halfWidth + q.runoff);
      if (q.dist > reach + 9) continue;
      const w = 1 - smoothstep(inner, inner + 9, q.dist);
      return lerp(terrainH, q.height + ROAD.roadLift, w);
    }
    return terrainH;
  }

  /** @see CollisionGrid#resolve */
  collide(position, radius) {
    return this.collision.resolve(position, radius, 1.4);
  }

  /**
   * A vehicle just hit something static, hard. The world decides whether that
   * matters — for a trunk it does. Called from `Vehicle#_resolveWorldCollision`,
   * which is already the one place that holds both the car and what it hit.
   * @param {number} momentum kg·m/s along the impact normal
   */
  onImpact(vehicle, collider, momentum) {
    return this.trees.impact(vehicle, collider, momentum);
  }

  /** Is this point on any track's tarmac? Used by the escape detector. */
  onAnyTrack(x, z) {
    for (const t of this._trackList) {
      const q = t.query(x, z, this._query);
      if (q && q.onRoad) return t;
    }
    return null;
  }

  getTrack(id) {
    return this.tracks.get(id) || null;
  }

  setActiveTrack(id) {
    this.activeTrack = id ? this.tracks.get(id) || null : null;
    return this.activeTrack;
  }

  /** Show or hide a track's furniture — used to strip the barriers away. */
  setTrackVisible(id, visible) {
    const g = this._trackGroups.get(id);
    if (g) g.visible = visible;
  }

  /**
   * Remove a track's barriers from the collision world.
   * The third parkour uses this the moment the game stops pretending.
   */
  setBarriersEnabled(trackId, enabled) {
    const t = this.tracks.get(trackId);
    if (!t) return;
    for (const c of t.colliders) c.disabled = !enabled;
    const g = this._trackGroups.get(trackId);
    const mesh = g?.getObjectByName('barriers');
    if (mesh) mesh.visible = enabled;
  }

  /** Nearest landmark within its own radius, or null. */
  landmarkAt(x, z) {
    for (const l of this.landmarks) {
      if (Math.hypot(x - l.position.x, z - l.position.z) < l.radius) return l;
    }
    return null;
  }

  /** Somewhere sensible to put a car that has fallen out of the world. */
  safePlaceNear(x, z) {
    const h = this.terrain.heightAt(x, z);
    return new THREE.Vector3(x, h + 1.5, z);
  }

  update(dt, time, cameraPosition = null) {
    this.wildlife?.update(dt, cameraPosition);
    // Grass follows the camera and blows in the wind. Both live in here.
    this.groundCover?.update(dt, cameraPosition);
    // Watches for the player shrugging off a worn tree. Costs nothing while
    // nobody is wearing one, which is almost always.
    this.trees.update(dt);
    // The mast lamp blinks on its own schedule, forever, for no one.
    if (this._mastLamp) {
      this._mastLamp.visible = Math.sin(time * 1.6) > 0.3;
    }
    for (const rig of this.lighting.values()) rig.update(dt, cameraPosition);
  }

  applyTheme(theme) {
    this.theme = theme;
    // Materials handle the recolour; nothing here needs rebuilding.
  }

  dispose() {
    for (const rig of this.lighting.values()) rig.dispose();
    this.lighting.clear();
    this.terrain?.dispose();
    this.wildlife?.dispose();
    this.groundCover?.dispose();
    this.trees.dispose();
    this.scatter?.dispose();
    this.collision.clear();
    this.root.clear();
    this.tracks.clear();
    this._trackList.length = 0;
    this._trackGroups.clear();
  }
}
