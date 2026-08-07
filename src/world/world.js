/**
 * WORLD — one terrain, the parkour standing on it, a forest, and everything in
 * between.
 *
 * THE IMPORTANT DECISION IN THIS FILE
 * -----------------------------------
 * A World is ONE LEVEL'S MAP. It is built whole — terrain, ribbons, glass,
 * forest, landmarks, worn routes — and when the player leaves that level it is
 * disposed and the next level's map is built in its place. Two levels never
 * share ground and never exist at the same time. `src/game/levels.js` owns that
 * swap; this file knows nothing about it beyond being buildable and disposable.
 *
 * What that buys: a level is a place. Its parkour sits in the middle of its own
 * valley with a kilometre of forest around it, and the ground beyond the
 * barriers is genuinely somewhere — not the gap between two other levels'
 * parkours. What it costs: getting from one level to another is a build, behind
 * a loading screen, rather than a drive.
 *
 * Nothing here is streamed. Within a level, everything you can reach was there
 * before you arrived and is still there when you drive away from it.
 *
 * WHAT A LEVEL GETS TO CHOOSE. `spec` (see `_resolveSpec`) is the level's map
 * definition: its seed, how big and how finely the terrain is built, how thick
 * the forest is, where its landmarks are, whether it has worn routes and
 * whether its parkour is under glass. Build a World without one and you get the
 * defaults out of `OPEN_WORLD`, which is what the headless tests do.
 *
 * The World is also the physics environment. It answers two questions for any
 * vehicle: what is the ground here, and did I just hit something.
 */

import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Track, ROAD } from './track.js';
import { DomeField } from './dome.js';
import { Scatter } from './scatter.js';
import { CollisionGrid } from './collision.js';
import { TrackLighting } from './lighting.js';
import { Trees } from './trees.js';
import { Wildlife } from './wildlife.js';
import { GroundCover } from './groundCover.js';
import { Trails } from './trails.js';
import { Precipitation } from '../render/weather.js';
import { DOME, OPEN_WORLD } from '../config/gameplay.js';
import { surfaceById } from '../config/tuning.js';
import { clamp01, lerp, smoothstep } from '../core/mathx.js';
import { events } from '../core/events.js';

const _normal = new THREE.Vector3();
/** The road's own normal, before it is blended into `_normal`. @see sampleGround */
const _roadNormal = new THREE.Vector3();

/**
 * How far below a deck still counts as standing on it, metres.
 *
 * It has to clear one physics step of falling (at 40 m/s and 120 Hz, a third of
 * a metre) with room to spare, and stay well under the height of anything a car
 * could be driving beneath — which on every viaduct in the game is at least
 * eight metres of clearance. Between those two it does not matter.
 */
const DECK_REACH = 2.5;

/**
 * What each surface becomes when it is raining.
 *
 * Deliberately short. Wet tarmac is a different road — that is the whole point
 * of a wet race — and wet dirt is mud, which the game already has a word for.
 * Everything absent from this table is unchanged, because grass is grass.
 */
const WET_SURFACE = {
  TARMAC: 'WET',
  DIRT: 'MUD',
  TRAIL: 'MUD',
};

/**
 * Points of interest, as data — the DEFAULT set, which every level gets unless
 * it names its own (`level.map.landmarks`, see `src/levels/defaults.js`, which
 * also rotates these by the level's seed so the lake is not in the same place
 * on every map).
 *
 * Polar rather than cartesian so they survive a change of world radius, and
 * module-scope rather than inline because the trail network needs to know
 * where they are *before* the terrain mesh is built — a path that leads
 * somewhere has to be painted into the ground at the same moment the ground is
 * (`world/trails.js`). `OPEN_WORLD.trails.links` indexes into this array.
 *
 * `map.icon` is how a landmark draws on the minimap, and it is the only thing a
 * *new* landmark has to declare to appear there: the key names an entry in
 * `MINIMAP_ICONS` (`src/config/minimap.js`), which the map looks up. Leave it
 * off and you get the generic ring, which is the right answer for a place that
 * does not have a shape yet.
 */
export const LANDMARK_DEFS = [
  { name: 'Vadi', label: 'the valley floor', angle: 0.4, dist: 0.34, radius: 90, map: { icon: 'valley' } },
  { name: 'Kule', label: 'a radio mast, unlit', angle: 2.1, dist: 0.62, radius: 70, map: { icon: 'mast' } },
  { name: 'Göl', label: 'still water', angle: 3.4, dist: 0.48, radius: 110, map: { icon: 'water' } },
  { name: 'Taşlar', label: 'stones in a ring', angle: 4.6, dist: 0.55, radius: 60, map: { icon: 'stones' } },
  { name: 'Sırt', label: 'the ridge', angle: 5.5, dist: 0.72, radius: 100, map: { icon: 'ridge' } },
  { name: 'Kenar', label: 'where the fog does not lift', angle: 1.2, dist: 0.93, radius: 140, map: { icon: 'edge' } },
];

export class World {
  /**
   * @param {object} opts
   * @param {import('../render/materials.js').MaterialLibrary} opts.materials
   * @param {object} opts.theme resolved theme
   * @param {object} [opts.spec] the level's map definition — see `_resolveSpec`
   * @param {number} [opts.seed] overrides `spec.seed` (the `?seed=` boot option)
   */
  constructor({ materials, theme, seed = null, lightPool = null, spec = null }) {
    this.materials = materials;
    this.lightPool = lightPool;
    this.theme = theme;
    /** @type {object} the resolved map definition this world was built from */
    this.spec = this._resolveSpec(spec);
    if (seed != null) this.spec.seed = seed;
    this.seed = this.spec.seed;

    this.root = new THREE.Group();
    this.root.name = 'world';

    this.terrain = null;
    /** @type {Map<string, Track>} */
    this.tracks = new Map();
    /** @type {Track|null} the ribbon the current mode cares about */
    this.activeTrack = null;
    this.collision = new CollisionGrid(12);
    /**
     * The glass over the parkours. Built with the world, invisible and inert
     * until the game stops pretending. See `src/world/dome.js`.
     * @type {DomeField|null}
     */
    this.domes = null;
    this.scatter = null;
    /** Animals, pooled around the camera. See wildlife.js. */
    this.wildlife = null;
    /** Grass, pooled around the camera the same way. See groundCover.js. */
    this.groundCover = null;
    /** Worn routes, painted into the terrain's vertex colours. See trails.js. */
    this.trails = null;
    /** Rain or snow, if this level's map has weather. See render/weather.js. */
    this.weather = null;
    /** Whether the ground on this map is wet. @see WET_SURFACE */
    this.wet = !!this.spec.weather?.wet;
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

  /**
   * A level's map definition, with every default filled in.
   *
   * The defaults are exactly what the game shipped with before levels had maps
   * of their own, so `new World({ materials, theme })` still builds the world
   * this file used to build — which is what the headless tests rely on.
   *
   * @param {object|null} spec `level.map`; see `src/levels/defaults.js`
   */
  _resolveSpec(spec) {
    const s = spec || {};
    return {
      seed: s.seed ?? OPEN_WORLD.seed,
      terrain: {
        resolution: s.terrain?.resolution ?? OPEN_WORLD.terrainResolution,
        cellSize: s.terrain?.cellSize ?? OPEN_WORLD.terrainCellSize,
        /**
         * EARTHWORKS — ground a level authored rather than inherited.
         *
         * `[{ x, z, radius, height, falloff }]`, applied before the tracks get
         * their turn at the shaper. Inside `radius` the ground is exactly
         * `height`; over `falloff` metres beyond it, it eases back to whatever
         * the noise was doing.
         *
         * This exists because two of the things a level most wants are things
         * a heightfield will not hand you: a FLOOR (the pan a spiral comes down
         * into, the bench a quarry is cut into) and a BASIN (a valley worth
         * bridging, a bed for a lake to sit in). Both are statements about a
         * place, and a seed that happens to produce one is not a level design.
         */
        shapes: s.terrain?.shapes || [],
      },
      /**
       * Standing water at a fixed height — see `_buildWater`. A level with a
       * lake in it needs the lake to be somewhere, and a basin full of mud is
       * a bog, not a lake.
       */
      water: s.water ? { level: 0, ...s.water } : null,
      /** Per-kind counts. A level may thin its forest, or thicken it. */
      scatter: { ...OPEN_WORLD.scatterDensity, ...(s.scatter || {}) },
      /** …or scale the lot with one number. */
      density: s.density ?? 1,
      landmarks: s.landmarks || LANDMARK_DEFS,
      /** `false` for a map with nobody's ruts in it. */
      trails: s.trails === false ? null : { ...OPEN_WORLD.trails, ...(s.trails === true ? {} : s.trails || {}) },
      /**
       * The glass. `false` for a map with none; an object to bend the shape of
       * it, merged over `DOME`. A level whose parkour climbs forty metres into
       * the air needs a wider footprint than the default, or its dome grows a
       * flank nobody can drive up — `margin` is the dial for that.
       */
      domes: s.domes === false ? false : s.domes ? { ...DOME, ...s.domes } : true,
      /**
       * WEATHER, as a property of the place rather than of the moment.
       *
       * `{ kind: 'rain'|'snow', amount: 0..1, wet: bool }`. A level that says
       * nothing gets `null` and costs nothing: no particle system is built, no
       * surface is remapped, and the ground query does not grow a branch.
       */
      weather: s.weather ? { kind: 'rain', amount: 1, wet: s.weather.kind !== 'snow', ...s.weather } : null,
    };
  }

  get halfSpan() {
    return this.terrain?.halfSpan ?? 0;
  }

  /**
   * The parkour this map was built around.
   *
   * A level has one map and, nearly always, one ribbon on it — so "the track",
   * unqualified, is a question with an answer, and callers that used to name
   * `'track3'` can ask the world instead. See `src/levels/defaults.js`.
   * @type {Track|null}
   */
  get mainTrack() {
    return this._trackList[0] || null;
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
        resolution: this.spec.terrain.resolution,
        cellSize: this.spec.terrain.cellSize,
        seed: this.seed,
      });
    });

    await step('tracks', 0.15, () => {
      for (const data of trackData) {
        const t = new Track(data);
        this.tracks.set(t.id, t);
        this._trackList.push(t);
      }
      // The land the level asked for, then the land the roads insist on.
      // Order matters and only one way round works: a track has to be able to
      // flatten the floor it was laid on, and a floor that overwrote the road
      // would bury it. @see `_resolveSpec` terrain.shapes
      const shapes = this.spec.terrain.shapes;
      this.terrain.shaper = (x, z, h) => {
        let out = h;
        for (const s of shapes) {
          const d = Math.hypot(x - s.x, z - s.z);
          const w = 1 - smoothstep(s.radius, s.radius + (s.falloff ?? 140), d);
          if (w > 0) out = lerp(out, s.height, w * w);
        }
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
      if (!this.spec.trails) return;
      const span = this.terrain.halfSpan;
      this.trails = new Trails({
        halfSpan: span,
        landmarks: this.spec.landmarks.map((d) => ({
          x: Math.cos(d.angle) * span * d.dist,
          z: Math.sin(d.angle) * span * d.dist,
        })),
        tracks: this._trackList,
        seed: this.seed,
        cfg: this.spec.trails,
      });
      this.terrain.painter = this.trails.painter(this.theme);
    });

    await step('terrain-mesh', 0.5, () => {
      this.root.add(this.terrain.buildMesh(this.materials, this.theme));
      if (this.spec.water) this.root.add(this._buildWater());
    });

    await step('track-mesh', 0.62, () => {
      for (const t of this._trackList) {
        // The terrain goes with it: a track with a viaduct in it has to know
        // where the ground is to stand pillars on it. @see Track#_buildDeckMesh
        const g = t.buildMesh(this.materials, this.theme, this.terrain);
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

    // The glass. Built now, with the tracks it belongs to and the terrain it is
    // anchored to, and then nothing happens to it for the whole of the story.
    await step('domes', 0.68, () => {
      if (!this.spec.domes) return;
      this.domes = new DomeField({
        tracks: this._trackList,
        terrain: this.terrain,
        cfg: this.spec.domes === true ? DOME : this.spec.domes,
      });
      this.root.add(this.domes.build(this.materials, this.theme));
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
        const avoidTrails = this._trailAvoidance();
        this.groundCover = new GroundCover({
          terrain: this.terrain,
          materials: this.materials,
          theme: this.theme,
          seed: this.seed ^ 0x6c0f,
          avoid: (x, z) => offRoad(x, z) || avoidTrails(x, z),
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

    // The weather, if this is a place that has any. Built after the scenery
    // because it is drawn over all of it, and last because it is the cheapest
    // thing here by an order of magnitude — see `render/weather.js`.
    if (this.spec.weather) {
      await step('weather', 0.92, () => {
        this.weather = new Precipitation({
          kind: this.spec.weather.kind,
          amount: this.spec.weather.amount,
          theme: this.theme,
          seed: this.seed ^ 0x5a1e,
        }).build();
        this.root.add(this.weather.root);
      });
    }

    await step('landmarks', 0.94, () => this._placeLandmarks());

    onProgress?.('done', 1);
    this._built = true;
    events.emit('world:built', { tracks: [...this.tracks.keys()] });
    return this;
  }

  /**
   * A predicate that rejects anywhere the ground is already worn.
   *
   * The sibling of `_trackAvoidance`, and shared by everything that grows or
   * stands for exactly the same reason: one answer to "has this ground been
   * used?" Grass has always obeyed it. The forest now does too, because a trail
   * you can drive faster along is worth nothing if a pine is standing in it —
   * and a trail with a pine standing in it was never a trail, it was a stripe.
   *
   * `OPEN_WORLD.trails.clearAbove` is deliberately *below* `driveAbove`, so the
   * cleared band is wider than the drivable one and the corridor the player can
   * read is empty by construction rather than by luck.
   *
   * @returns {(x:number, z:number)=>boolean} true = do not place here
   */
  _trailAvoidance() {
    const worn = this.spec.trails?.clearAbove ?? OPEN_WORLD.trails.clearAbove;
    return (x, z) => this.trails != null && this.trails.strengthAt(x, z) > worn;
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
    // And off the worn routes, which is what makes a trail somewhere the player
    // can GO rather than somewhere that is merely coloured differently.
    //
    // The two are folded into one predicate that every placement below takes,
    // rather than added per kind, so there is nothing to remember when a new
    // prop is scattered — and so ground that is used is used for everything.
    const avoidTracks = this._trackAvoidance(3.5);
    const avoidTrails = this._trailAvoidance();
    const avoidUsed = (x, z) => avoidTracks(x, z) || avoidTrails(x, z);
    // Trees, and only trees, also keep off the ring where the glass comes down
    // to meet the earth: a band forty-odd metres wide at each dome's rim, and
    // nowhere else. Under the middle of a dome the roof is sixty metres up and
    // the forest is untouched. Without this the rim runs a pane through every
    // trunk it passes; with it, the rim sits in a cleared ring, which is what
    // seating a dome in a forest would actually take. Rocks and bushes are
    // waist-high and stay, so the ring reads as cleared rather than as sterile.
    const skewered = this.domes ? this.domes.skewerAvoidance(this.terrain) : () => false;
    const avoidTrees = (x, z) => avoidUsed(x, z) || skewered(x, z);

    // The level's own forest. `density` scales every count at once, so a map
    // that wants thinner woods is one number rather than eight.
    const k = this.spec.density;
    const raw = this.spec.scatter;
    const D = {};
    for (const key of Object.keys(raw)) D[key] = Math.round(raw[key] * k);
    const span = this.terrain.halfSpan;
    s.place({ kind: 'pine', count: Math.round(D.trees * 0.62), region: { radius: span * 0.97 }, avoid: avoidTrees });
    s.place({ kind: 'broadleaf', count: Math.round(D.trees * 0.28), region: { radius: span * 0.9 }, avoid: avoidTrees });
    s.place({ kind: 'dead', count: Math.round(D.trees * 0.1), region: { inner: span * 0.3, radius: span * 0.97 }, avoid: avoidTrees });
    s.place({ kind: 'rock', count: D.rocks, region: { radius: span * 0.97 }, avoid: avoidUsed });
    s.place({ kind: 'bush', count: D.bushes, region: { radius: span * 0.95 }, avoid: avoidUsed });
    // THE UNDERSTOREY, placed after the canopy it belongs under and *because*
    // of it: `_treeProximity` rejects anywhere that is not within reach of a
    // trunk that has already gone in. Everything from here down is scenery you
    // drive straight through, so none of it produces a collider.
    const nearTrees = this._treeProximity(
      s.colliders.filter((c) => c.kind === 'pine' || c.kind === 'broadleaf'),
      OPEN_WORLD.understoreyRadius
    );
    const underCanopy = (x, z) => avoidUsed(x, z) || nearTrees(x, z);
    s.place({ kind: 'fern', count: D.ferns, region: { radius: span * 0.95 }, avoid: underCanopy });
    s.place({ kind: 'undergrowth', count: D.undergrowth, region: { radius: span * 0.95 }, avoid: underCanopy });
    s.place({ kind: 'litter', count: D.litter, region: { radius: span * 0.95 }, avoid: underCanopy });
    // Grass is NOT scattered. It is a pool that follows the camera — see
    // `groundCover.js` and `OPEN_WORLD.groundCover`.
    s.place({ kind: 'log', count: Math.round(D.rocks * 0.35), region: { radius: span * 0.9 }, avoid: avoidUsed });
    // Blank signs only exist away from the tracks. Nobody was meant to read them.
    s.place({ kind: 'sign', count: 90, region: { inner: span * 0.25, radius: span * 0.9 }, avoid: avoidUsed });
    // Signs somebody left, and cars somebody left. Kept off the inner ring so
    // the first thing past the tracks is still forest.
    s.place({ kind: 'poster', count: D.posters, region: { inner: span * 0.12, radius: span * 0.92 }, avoid: avoidUsed });
    s.place({ kind: 'wreck', count: D.wrecks, region: { inner: span * 0.15, radius: span * 0.9 }, avoid: avoidUsed });

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
    for (const d of this.spec.landmarks) {
      const x = Math.cos(d.angle) * span * d.dist;
      const z = Math.sin(d.angle) * span * d.dist;
      this.landmarks.push({
        name: d.name,
        label: d.label,
        position: new THREE.Vector3(x, this.terrain.heightAt(x, z), z),
        radius: d.radius,
        discovered: false,
        /** Carried through untouched; the minimap is the only reader. */
        map: d.map || null,
      });
    }

    // One physical landmark you can actually see from a distance: the mast.
    const mast = this.landmarks.find((l) => l.name === 'Kule');
    if (mast) this.root.add(this._buildMast(mast.position));
  }

  /**
   * Standing water, as one flat pane across the whole map.
   *
   * It works because the ground is already the right shape: the pane is at a
   * fixed height and the terrain is above it everywhere except in the basins a
   * level dug for it (`terrain.shapes`), so a single quad becomes exactly as
   * much lake as the map has hollows — no shoreline to author, no mask, no
   * second mesh. Move the level's basin and the lake moves with it.
   *
   * No collision and no surface of its own: the bed underneath is already MUD
   * (see `Terrain#_classifySurfaces`), which is what driving into a lake
   * should feel like anyway.
   */
  _buildWater() {
    const span = this.terrain.halfSpan * 2;
    const geo = new THREE.PlaneGeometry(span, span, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    const c = new THREE.Color(this.theme.props.water);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, this.materials.get('water'));
    mesh.position.y = this.spec.water.level;
    mesh.name = 'water';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
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
   *
   * `agent` is the car (or camera target) asking. It exists for one reason: a
   * dome is only ground for something that has been outside it, so "what is the
   * ground here" genuinely has a different answer for the player on top of the
   * glass and the three rivals still lapping underneath it. Pass nothing and
   * you get the world without any glass in it, which is what every caller that
   * does not belong to a specific car wants.
   *
   * @param {{position: THREE.Vector3}} [agent]
   * @returns {{height:number, normal:THREE.Vector3, surface:string}}
   */
  sampleGround(x, z, agent = null) {
    const terrainH = this.terrain.heightAt(x, z);
    let height = terrainH;
    let surface = this.terrain.surfaceAt(x, z);

    // A worn route drives like one.
    //
    // WHY THIS IS NOT IN THE SURFACE GRID. Every other surface in the world is
    // baked per terrain vertex by `Terrain#_classifySurfaces`, and this one
    // cannot be: the grid carries one sample every 13 metres and `surfaceAt`
    // snaps to the nearest, so a trail baked into it would drive as square
    // 13m blocks that do not line up with the band you can see. The trail
    // field is continuous, so we ask it directly and the surface you feel is
    // the same function as the colour you are looking at — the same contract
    // `heightAt` keeps with the mesh, one layer up.
    //
    // Cheap enough to sit in the per-step path: `strengthAt` is one hash-grid
    // lookup, and in open forest — which is nearly everywhere — that lookup
    // misses and the query is over.
    //
    // Only over the ground the forest grew on. A worn line across a bog is
    // still a bog, and MUD near the water is a hazard the player can see; a
    // trail is not allowed to quietly cancel one. The tracks below then
    // override this in turn, so a spur meeting its parkour becomes road at the
    // verge rather than staying a path across it.
    if (
      this.trails &&
      (surface === 'GRASS' || surface === 'DIRT') &&
      this.trails.strengthAt(x, z) > this.trails.cfg.driveAbove
    ) {
      surface = 'TRAIL';
    }

    // Roads override height, surface AND NORMAL. Using the ribbon's own
    // elevation (rather than the coarse heightfield) is what keeps the tarmac
    // glass-smooth while the terrain around it stays cheap — and the normal has
    // to come from the same place as the height, or the car is standing on one
    // surface and leaning on another. @see Track#normalAt
    //
    // `roadNormalWeight` is how much of the road's answer this point gets, and
    // it is deliberately the SAME weight the height blend uses: full on the
    // tarmac, fading to the terrain's own normal out across the verge. Blend
    // them differently and you can feel the seam.
    let roadNormalWeight = 0;
    const y = agent?.position?.y ?? null;
    for (const t of this._trackList) {
      const q = t.query(x, z, this._query, y);
      if (!q) continue;

      // A DECK IS GROUND ONLY FROM ABOVE.
      //
      // Same shape of rule as the glass overhead, and for the same reason: "what
      // is the ground here" genuinely has two answers where a road is in the
      // air. Off the side of it there is nothing to stand on — that is a fall,
      // and it is meant to be. Underneath it there is forest floor, and the
      // bridge is a ceiling. Only a car on top of the deck is on the road.
      if (q.deck > 0.5) {
        const deckY = q.height + ROAD.roadLift;
        if (q.dist > q.halfWidth + ROAD.parapetThickness) continue;
        if (y != null && y < deckY - DECK_REACH) continue;
        height = deckY;
        surface = q.surface;
        // A deck stands over ground it has nothing to do with, so it takes the
        // normal outright. There is no verge to blend into — off the edge is a
        // fall, not a shoulder.
        t.normalAt(q, _roadNormal);
        roadNormalWeight = 1;
        break;
      }

      const inner = q.halfWidth + ROAD.shoulderWidth;
      const reach = Math.max(inner, q.halfWidth + q.runoff);
      if (q.dist > reach + 9) continue;
      const w = 1 - smoothstep(inner, inner + 9, q.dist);
      height = lerp(terrainH, q.height + ROAD.roadLift, w);
      t.normalAt(q, _roadNormal);
      roadNormalWeight = w;
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

    // Rain does not change what the road is made of; it changes what it is
    // like. One mapping, applied last, so a level says `weather.wet` once and
    // every surface in it answers for itself. @see World#_resolveSpec
    if (this.wet) surface = WET_SURFACE[surface] ?? surface;

    // Outside the built world the ground is flat, wrong, and obviously so.
    if (!this.terrain.contains(x, z)) {
      surface = 'VOID';
    }

    this.terrain.normalAt(x, z, _normal);
    if (roadNormalWeight > 0) {
      // `lerp` between two unit vectors is short; renormalising is what keeps
      // it a direction rather than a slightly-squashed one.
      if (roadNormalWeight >= 1) _normal.copy(_roadNormal);
      else _normal.lerp(_roadNormal, roadNormalWeight).normalize();
    }

    // The glass wins wherever it is above the earth. Highest-wins rather than a
    // replacement is what makes the rim seamless: the shell is sunk into the
    // ground out there (see DOME.groundBite), so driving onto a dome is the
    // ground quietly stopping being the ground, with no step to hit.
    const dome = this.domes?.domeAt(x, z, agent);
    if (dome) {
      const glass = dome.heightAt(x, z);
      if (glass > height) {
        height = glass;
        surface = 'GLASS';
        dome.normalAt(x, z, _normal);
      }
    }

    return { height, normal: _normal, surface };
  }

  /**
   * Just the height, for callers that ask several times per step and do not
   * care about the surface or the normal — see `Vehicle#_sampleGround`, which
   * probes the ground fore and aft of the car so the nose stops burying itself
   * in hillsides. Skipping `normalAt` alone saves four heightfield samples.
   * @param {{position: THREE.Vector3}} [agent] see `sampleGround`
   * @returns {number} metres
   */
  groundHeightAt(x, z, agent = null) {
    const glass = this.domes ? this.domes.heightAt(x, z, agent) : -Infinity;
    const terrainH = this.terrain.heightAt(x, z);
    let height = terrainH;
    const y = agent?.position?.y ?? null;
    for (const t of this._trackList) {
      const q = t.query(x, z, this._query, y);
      if (!q) continue;
      // The probes have to agree with `sampleGround` about the deck, or the
      // nose of a car on a viaduct reads the ground forty metres below it and
      // the car pitches into the floor. @see sampleGround
      if (q.deck > 0.5) {
        const deckY = q.height + ROAD.roadLift;
        if (q.dist > q.halfWidth + ROAD.parapetThickness) continue;
        if (y != null && y < deckY - DECK_REACH) continue;
        height = deckY;
        break;
      }
      const inner = q.halfWidth + ROAD.shoulderWidth;
      const reach = Math.max(inner, q.halfWidth + q.runoff);
      if (q.dist > reach + 9) continue;
      const w = 1 - smoothstep(inner, inner + 9, q.dist);
      height = lerp(terrainH, q.height + ROAD.roadLift, w);
      break;
    }
    return glass > height ? glass : height;
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

  /** By id, or — with no id — the ribbon this map was built around. */
  getTrack(id = null) {
    if (id == null) return this.mainTrack;
    return this.tracks.get(id) || null;
  }

  setActiveTrack(id) {
    this.activeTrack = id ? this.tracks.get(id) || null : null;
    return this.activeTrack;
  }

  /** Show or hide a track's furniture — used to strip the barriers away. */
  setTrackVisible(id, visible) {
    const g = this._trackGroups.get(id ?? this.mainTrack?.id);
    if (g) g.visible = visible;
  }

  /**
   * Remove a track's barriers from the collision world.
   * The parkour that breaks uses this the moment the game stops pretending.
   * Omit the id and it means this map's own ribbon.
   */
  setBarriersEnabled(trackId, enabled) {
    const t = trackId == null ? this.mainTrack : this.tracks.get(trackId);
    if (!t) return;
    trackId = t.id;
    for (const c of t.colliders) c.disabled = !enabled;
    const g = this._trackGroups.get(trackId);
    const mesh = g?.getObjectByName('barriers');
    if (mesh) mesh.visible = enabled;
  }

  /**
   * Start the glass watching. Until this is called the domes are drawn by
   * nobody, collided with by nobody, and cost one branch per ground query.
   *
   * `OpenWorldMode` calls it on entry, which is deliberately the *only* caller:
   * the open world is the moment the game stops pretending, whichever way the
   * player reached it.
   */
  armDomes() {
    this.domes?.arm();
  }

  /** @see DomeField#reveal — for a boot that skips straight past the reveal. */
  revealDomes() {
    return this.domes?.reveal() ?? false;
  }

  /** Nearest landmark within its own radius, or null. */
  landmarkAt(x, z) {
    for (const l of this.landmarks) {
      if (Math.hypot(x - l.position.x, z - l.position.z) < l.radius) return l;
    }
    return null;
  }

  /**
   * Somewhere sensible to put a car that has fallen out of the world.
   *
   * `agent` matters here for the same reason it does in `sampleGround`, and the
   * consequence of leaving it out is worse: a car sealed against a dome, put
   * back on the *terrain* underneath that dome, is instantly below its own
   * ground again — so it is rescued again, and again, and never moves. Placing
   * it on whatever surface it is actually entitled to stand on is the fix.
   */
  safePlaceNear(x, z, agent = null) {
    const h = this.groundHeightAt(x, z, agent);
    return new THREE.Vector3(x, h + 1.5, z);
  }

  /**
   * @param {object[]} [vehicles] everything the domes have to keep a latch for.
   *   Passed in rather than held, because the world does not own the cars.
   */
  update(dt, time, cameraPosition = null, vehicles = null) {
    // Before anything reads the ground this frame: has anyone come out from
    // under a dome since the last one?
    this.domes?.sync(vehicles);
    this.domes?.update(dt);
    this.wildlife?.update(dt, cameraPosition);
    // One uniform write. The column of rain travels with whoever is looking.
    this.weather?.update(dt, cameraPosition);
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
    // Materials handle the recolour; nothing here needs rebuilding — except
    // the weather, which is not a material: its colour is the sky's.
    this.weather?.applyTheme(theme);
  }

  dispose() {
    for (const rig of this.lighting.values()) rig.dispose();
    this.lighting.clear();
    this.terrain?.dispose();
    this.domes?.dispose();
    this.weather?.dispose();
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
