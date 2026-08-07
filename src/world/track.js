/**
 * TRACK — turns a plain data file (a level's `track` block, `src/levels/*.js`)
 * into a drivable parkour: a resampled centreline, road geometry, checkpoints,
 * a starting grid, barriers, and the queries the rest of the game needs.
 *
 * Nothing here knows about racing rules. It answers questions:
 *   "where is the road nearest this point, how wide is it, and what is it
 *    made of?"  Race mode and the intro director do the interpreting.
 *
 * The escape route on the parkour that breaks is not a special case in this
 * file. It is a `patches` entry that makes a corner slippery and a `gaps` entry
 * that leaves the barrier out. The world is simply built with a hole in it.
 */

import * as THREE from 'three';
import { GeomBuilder, shade } from '../render/geometry.js';
import { catmullRom, clamp, clamp01, lerp, smoothstep, pointSegmentXZ } from '../core/mathx.js';

/** Road construction constants — proportions, not gameplay. */
export const ROAD = {
  /** Metres between resampled centreline points. Smaller = smoother corners. */
  sampleSpacing: 3.0,
  /** Painted line inset from the road edge, metres. */
  lineInset: 0.55,
  lineWidth: 0.28,
  centreDashLength: 3.2,
  centreDashGap: 4.0,
  /** Graded shoulder either side of the tarmac. */
  shoulderWidth: 3.4,
  shoulderDrop: 0.18,
  /** Kerbs appear where the centreline curves more than this (1/metres). */
  kerbCurvature: 0.012,
  kerbWidth: 1.1,
  kerbStripeLength: 2.4,
  /**
   * How far past the tarmac the terrain is flattened *completely*, metres.
   *
   * THIS MUST EXCEED THE TERRAIN GRID DIAGONAL (`cellSize * 1.42`, ~19m at the
   * defaults). The terrain is a coarse heightfield sampled every 13 metres and
   * interpolated in between. A grid vertex sitting just outside the flatten core
   * keeps most of its natural height, and the road — which is only ~14m wide —
   * ends up interpolating between one flattened vertex and one hillside. That
   * put the terrain up to FIVE METRES above the tarmac and the road simply
   * disappeared under grass.
   *
   * Full flatten out past the grid diagonal means every vertex that can
   * influence a point on the road is pinned to the road's own height.
   */
  flattenCore: 24,
  /** …then eased back to natural ground by this radius. */
  flattenRadius: 52,
  /** Road surface sits this far above the flattened terrain. */
  roadLift: 0.22,
  /** Barrier posts. */
  barrierHeight: 1.05,
  barrierSpacing: 5.5,
  barrierOffset: 1.4,

  // -- viaducts -------------------------------------------------------------
  // A road that leaves the ground. See `Track#_applyElevated`.

  /** Depth of the deck below the driving surface, metres. */
  deckThickness: 1.6,
  /** Parapet wall along an elevated edge: height and thickness, metres. */
  parapetHeight: 0.9,
  parapetThickness: 0.45,
  /** Metres between support pillars. */
  pillarSpacing: 34,
  /** Pillar half-width. They taper: this is the top. */
  pillarHalfWidth: 1.5,
  /**
   * How far the deck's influence fades in at each end of an elevated run, in
   * SAMPLES. The terrain stops being flattened over this distance rather than
   * at a line, so a viaduct grows out of an earth abutment instead of ending
   * in a cliff face. See `Track#_applyElevated`.
   */
  deckBlendSamples: 14,
};

export class Track {
  /** @param {object} data a track definition module's default export */
  constructor(data) {
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.loop = data.loop !== false;
    this.laps = data.laps ?? 2;

    /** Resampled centreline. Parallel arrays keep the hot query allocation-free. */
    this.count = 0;
    this.px = null;
    this.py = null;
    this.pz = null;
    /** Unit tangent (direction of travel) per sample. */
    this.tx = null;
    this.tz = null;
    /** Unit right vector per sample. */
    this.rx = null;
    this.rz = null;
    /**
     * Rise per horizontal metre along the tangent — the road's own gradient.
     * 0.2 is a 1-in-5 climb. This is what `World#sampleGround` builds the
     * surface normal out of; without it the physics reads the *terrain's*
     * normal, which under a viaduct is the valley floor. @see Track#normalAt
     */
    this.grade = null;
    this.halfWidth = null;
    this.curvature = null;
    /** Cumulative arc length, metres. */
    this.arc = null;
    this.length = 0;
    /** Surface id string per sample. */
    this.surfaces = [];

    this.checkpoints = [];
    this.startLine = null;
    this.colliders = [];
    /** Plastic delineator posts: `{x, y, z, side, t}`. Cosmetic, never solid. */
    this.markers = [];
    /** Where the lighting rig hangs: `{x, y, z, side, t}`. */
    this.lightAnchors = [];

    /** Spatial hash: cell key → sample indices. */
    this._grid = new Map();
    this._cellSize = 24;
    this._maxHalfWidth = 0;

    this._build();
  }

  // -- construction ---------------------------------------------------------

  _build() {
    const raw = this.data.points;
    if (!raw || raw.length < 4) throw new Error(`Track "${this.id}" needs at least 4 points`);

    // 1. Densely evaluate the Catmull-Rom spline through the control points.
    const dense = [];
    const n = raw.length;
    const segs = this.loop ? n : n - 1;
    const stepsPerSeg = 24;
    for (let i = 0; i < segs; i++) {
      const p0 = raw[this._wrap(i - 1, n)];
      const p1 = raw[this._wrap(i, n)];
      const p2 = raw[this._wrap(i + 1, n)];
      const p3 = raw[this._wrap(i + 2, n)];
      for (let s = 0; s < stepsPerSeg; s++) {
        const t = s / stepsPerSeg;
        dense.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
          y: catmullRom(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, t),
          z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
          w: catmullRom(
            p0.width ?? this.data.defaultWidth,
            p1.width ?? this.data.defaultWidth,
            p2.width ?? this.data.defaultWidth,
            p3.width ?? this.data.defaultWidth,
            t
          ),
        });
      }
    }
    if (!this.loop) dense.push({ ...raw[n - 1], w: raw[n - 1].width ?? this.data.defaultWidth });

    // 2. Resample at a uniform arc length so geometry and physics agree about
    //    "how far along the track" a point is.
    const resampled = this._resample(dense, ROAD.sampleSpacing);
    this.count = resampled.length;
    this._allocate(this.count);

    for (let i = 0; i < this.count; i++) {
      const p = resampled[i];
      this.px[i] = p.x;
      this.py[i] = p.y;
      this.pz[i] = p.z;
      this.halfWidth[i] = p.w / 2;
      this._maxHalfWidth = Math.max(this._maxHalfWidth, p.w / 2);
    }

    this._computeFrames();
    this._applyPatches();
    this._applyElevated();
    this._buildSpatialHash();
    this._buildCheckpoints();
    this._buildBarriers();
    this._buildParapets();
    this._buildMarkers();
    this._buildLightAnchors();
  }

  _wrap(i, n) {
    if (this.loop) return ((i % n) + n) % n;
    return clamp(i, 0, n - 1);
  }

  _allocate(count) {
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.tx = new Float32Array(count);
    this.tz = new Float32Array(count);
    this.rx = new Float32Array(count);
    this.rz = new Float32Array(count);
    this.grade = new Float32Array(count);
    this.halfWidth = new Float32Array(count);
    this.curvature = new Float32Array(count);
    this.arc = new Float32Array(count);
    this.surfaces = new Array(count).fill(this.data.defaultSurface || 'TARMAC');
    /** Metres beyond the tarmac that this sample's surface keeps going. */
    this.runoff = new Float32Array(count);
    /**
     * 0 = the road is lying on the ground, 1 = it is a deck in the air, and in
     * between is the abutment where one becomes the other. @see _applyElevated
     */
    this.deck = new Float32Array(count);
  }

  _resample(dense, spacing) {
    const out = [];
    let carry = 0;
    out.push({ ...dense[0] });
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 1e-6) continue;
      let travelled = carry;
      while (travelled + spacing <= segLen) {
        travelled += spacing;
        const t = travelled / segLen;
        out.push({
          x: lerp(a.x, b.x, t),
          y: lerp(a.y, b.y, t),
          z: lerp(a.z, b.z, t),
          w: lerp(a.w, b.w, t),
        });
      }
      carry = travelled - segLen;
    }
    return out;
  }

  _computeFrames() {
    const c = this.count;
    let arc = 0;
    for (let i = 0; i < c; i++) {
      const prev = this.loop ? (i - 1 + c) % c : Math.max(0, i - 1);
      const next = this.loop ? (i + 1) % c : Math.min(c - 1, i + 1);
      let dx = this.px[next] - this.px[prev];
      let dz = this.pz[next] - this.pz[prev];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      // Central difference, over the same two neighbours the tangent uses, so
      // the gradient and the direction it is measured along cannot disagree.
      this.grade[i] = (this.py[next] - this.py[prev]) / len;
      // Right-hand normal in the XZ plane, matching the vehicle's convention
      // (forward = (sin h, 0, cos h) → right = (cos h, 0, -sin h)).
      this.rx[i] = dz;
      this.rz[i] = -dx;

      if (i > 0) {
        arc += Math.hypot(this.px[i] - this.px[i - 1], this.pz[i] - this.pz[i - 1]);
      }
      this.arc[i] = arc;
    }
    if (this.loop) {
      arc += Math.hypot(this.px[0] - this.px[c - 1], this.pz[0] - this.pz[c - 1]);
    }
    this.length = arc;

    // Curvature from the turn rate of the tangent — drives kerb placement and
    // the AI's braking points.
    for (let i = 0; i < c; i++) {
      const prev = this.loop ? (i - 1 + c) % c : Math.max(0, i - 1);
      const next = this.loop ? (i + 1) % c : Math.min(c - 1, i + 1);
      const cross = this.tx[prev] * this.tz[next] - this.tz[prev] * this.tx[next];
      const ds = Math.max(
        Math.hypot(this.px[next] - this.px[prev], this.pz[next] - this.pz[prev]),
        0.001
      );
      this.curvature[i] = cross / ds;
    }
  }

  /**
   * Apply `patches` — the data-driven surface overrides.
   *
   * A patch may also declare a `runoff` in metres. That is how far *past the
   * tarmac* the patch's surface continues, and it matters more than it sounds:
   * without it, a car sliding off an icy corner reaches the grippy verge one
   * metre later and simply steers back on. Ice on the road but not beside it is
   * a wobble; ice on the road and the ground next to it is a crash.
   */
  _applyPatches() {
    for (const patch of this.data.patches || []) {
      const from = Math.floor(patch.from * this.count);
      const to = Math.ceil(patch.to * this.count);
      for (let k = from; k < to; k++) {
        const i = this.loop ? ((k % this.count) + this.count) % this.count : clamp(k, 0, this.count - 1);
        this.surfaces[i] = patch.surface;
        this.runoff[i] = patch.runoff ?? 0;
      }
    }
  }

  /**
   * THE ROAD LEAVES THE GROUND.
   *
   * `data.elevated: [{ from, to }]` — lap fractions, same shape as `patches` —
   * marks the runs the road crosses on a deck instead of on earth. Three things
   * follow from a sample being elevated, and they are the whole feature:
   *
   *   1. THE TERRAIN IS NOT FLATTENED UNDER IT. `shapeTerrain` normally pins
   *      the ground to the road's own height for twenty-four metres either
   *      side. Do that to a road forty metres in the air and you do not get a
   *      viaduct, you get an embankment the size of a hill — and the valley the
   *      bridge was crossing fills in. So the shaper backs off, and what is
   *      under the deck is whatever was there before.
   *   2. IT IS ONLY GROUND FROM ABOVE. See `World#sampleGround`: a car under a
   *      viaduct is driving on the forest floor, not on the underside of a
   *      bridge, and a car that runs out of deck falls off the side of it.
   *   3. IT IS BUILT RATHER THAN GRADED. Deck, parapets, pillars down to
   *      whatever the ground is doing underneath. See `_buildDeckMesh`.
   *
   * `deck` is a 0..1 FIELD rather than a flag, tapered over
   * `ROAD.deckBlendSamples` at each end, because the two states have to meet
   * somewhere: at the tapered end the ground is still pulled part of the way up
   * to the road, which is exactly what an abutment is — earth ramped up to
   * where the bridge starts.
   *
   * A spiral is not a special case here. It is an elevated run whose control
   * points happen to pass over themselves; what makes it work is `query`
   * knowing which of two decks you are on, not anything in this method.
   */
  _applyElevated() {
    const runs = this.data.elevated || [];
    if (runs.length === 0) return;
    for (const run of runs) {
      const from = Math.floor(run.from * this.count);
      const to = Math.ceil(run.to * this.count);
      for (let k = from; k < to; k++) {
        const i = this.loop ? ((k % this.count) + this.count) % this.count : clamp(k, 0, this.count - 1);
        this.deck[i] = 1;
      }
    }

    // Taper the ends. Walked as a distance transform out of the solid runs, so
    // two runs that nearly touch do not carve a notch between them.
    const blend = Math.max(1, ROAD.deckBlendSamples);
    const src = this.deck.slice();
    for (let i = 0; i < this.count; i++) {
      if (src[i] > 0) continue;
      let nearest = Infinity;
      for (let d = 1; d <= blend; d++) {
        const a = this.loop ? (i - d + this.count) % this.count : Math.max(0, i - d);
        const b = this.loop ? (i + d) % this.count : Math.min(this.count - 1, i + d);
        if (src[a] > 0 || src[b] > 0) {
          nearest = d;
          break;
        }
      }
      if (nearest <= blend) this.deck[i] = 1 - nearest / (blend + 1);
    }
  }

  /** True where the road is a deck rather than a graded cut. */
  isElevated(i) {
    return this.deck[i] > 0.5;
  }

  _cellKey(x, z) {
    return `${Math.floor(x / this._cellSize)},${Math.floor(z / this._cellSize)}`;
  }

  _buildSpatialHash() {
    const pad = this._maxHalfWidth + ROAD.flattenRadius;
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i];
      const z = this.pz[i];
      const x0 = Math.floor((x - pad) / this._cellSize);
      const x1 = Math.floor((x + pad) / this._cellSize);
      const z0 = Math.floor((z - pad) / this._cellSize);
      const z1 = Math.floor((z + pad) / this._cellSize);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx},${cz}`;
          let list = this._grid.get(key);
          if (!list) this._grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  _buildCheckpoints() {
    const wanted = this.data.checkpoints ?? 10;
    const step = this.count / wanted;
    for (let k = 0; k < wanted; k++) {
      const i = Math.floor(k * step);
      this.checkpoints.push({
        index: k,
        sample: i,
        position: new THREE.Vector3(this.px[i], this.py[i], this.pz[i]),
        forward: new THREE.Vector3(this.tx[i], 0, this.tz[i]),
        halfWidth: this.halfWidth[i],
        arc: this.arc[i],
      });
    }
    const s =
      this.data.startSample ??
      clamp(Math.round((this.data.startProgress ?? 0) * this.count), 0, this.count - 1);
    this.startLine = {
      sample: s,
      position: new THREE.Vector3(this.px[s], this.py[s], this.pz[s]),
      forward: new THREE.Vector3(this.tx[s], 0, this.tz[s]),
      right: new THREE.Vector3(this.rx[s], 0, this.rz[s]),
    };
  }

  _buildBarriers() {
    const cfg = this.data.barriers;
    if (!cfg || cfg.enabled === false) return;
    const gaps = cfg.gaps || [];
    const step = Math.max(1, Math.round(ROAD.barrierSpacing / ROAD.sampleSpacing));

    for (let i = 0; i < this.count; i += step) {
      const t = i / this.count;
      // A gap is a deliberate hole in the world's edge.
      if (gaps.some((g) => t >= g.from && t <= g.to)) continue;
      const sides = cfg.sides || ['left', 'right'];
      for (const side of sides) {
        const s = side === 'left' ? -1 : 1;
        const off = this.halfWidth[i] + ROAD.barrierOffset;
        this.colliders.push({
          type: 'box',
          x: this.px[i] + this.rx[i] * off * s,
          y: this.py[i] + ROAD.barrierHeight / 2,
          z: this.pz[i] + this.rz[i] * off * s,
          halfX: 0.22,
          halfY: ROAD.barrierHeight / 2,
          halfZ: ROAD.barrierSpacing * 0.55,
          rotationY: Math.atan2(this.tx[i], this.tz[i]),
          kind: 'barrier',
          side,
          sample: i,
        });
      }
    }
  }

  /**
   * The wall along the edge of a deck.
   *
   * Not the same thing as `barriers`, and it is not optional in the same way.
   * Armco is a choice a track makes about how much it is willing to catch you;
   * a parapet is what stops a bridge being a diving board. Anywhere the road is
   * genuinely in the air it gets one on both sides, whatever the track said
   * about barriers — including bölüm 3's "no barriers at all", which is a
   * statement about a dirt road on a hillside and not permission to build an
   * unfenced viaduct. `parapet: false` is there for a track that wants the
   * diving board, and nothing in the game uses it.
   *
   * It is low, so it is still possible to be thrown over it, and it is solid,
   * so you have to be thrown rather than merely wander.
   */
  _buildParapets() {
    if (this.data.parapet === false) return;
    const step = Math.max(1, Math.round(ROAD.barrierSpacing / ROAD.sampleSpacing));
    const H = ROAD.parapetHeight;
    for (let i = 0; i < this.count; i += step) {
      if (!this.isElevated(i)) continue;
      for (const side of ['left', 'right']) {
        const s = side === 'left' ? -1 : 1;
        const off = this.halfWidth[i] + ROAD.parapetThickness * 0.5 + 0.2;
        this.colliders.push({
          type: 'box',
          x: this.px[i] + this.rx[i] * off * s,
          y: this.py[i] + H / 2,
          z: this.pz[i] + this.rz[i] * off * s,
          halfX: ROAD.parapetThickness * 0.5,
          halfY: H / 2,
          halfZ: ROAD.barrierSpacing * 0.55,
          rotationY: Math.atan2(this.tx[i], this.tz[i]),
          kind: 'parapet',
          side,
          sample: i,
        });
      }
    }
  }

  /**
   * Plastic delineator posts. These mark where the road is and nothing else —
   * they have no colliders at all. A car goes straight through them, which is
   * the point: on a route defined by posts rather than Armco, the only thing
   * keeping you on the road is being able to see it.
   */
  _buildMarkers() {
    const cfg = this.data.markers;
    if (!cfg || cfg.enabled === false) return;
    const step = Math.max(1, Math.round((cfg.spacing ?? 9) / ROAD.sampleSpacing));
    const gaps = cfg.gaps || [];
    const sides = cfg.sides || ['left', 'right'];

    for (let i = 0; i < this.count; i += step) {
      const t = i / this.count;
      if (gaps.some((g) => t >= g.from && t <= g.to)) continue;
      for (const side of sides) {
        const s = side === 'left' ? -1 : 1;
        const off = this.halfWidth[i] + (cfg.offset ?? 0.7);
        this.markers.push({
          x: this.px[i] + this.rx[i] * off * s,
          y: this.py[i],
          z: this.pz[i] + this.rz[i] * off * s,
          rotationY: Math.atan2(this.tx[i], this.tz[i]),
          side,
          t,
          sample: i,
        });
      }
    }
  }

  /**
   * Where the lighting rig hangs. Only anchors — `src/world/lighting.js` owns
   * the actual lights, because how many of them can be lit at once is a
   * rendering budget question, not a track question.
   */
  _buildLightAnchors() {
    const cfg = this.data.lighting;
    if (!cfg || cfg.enabled === false) return;
    const step = Math.max(1, Math.round((cfg.spacing ?? 40) / ROAD.sampleSpacing));
    const gaps = cfg.gaps || [];
    let flip = 0;

    for (let i = 0; i < this.count; i += step) {
      const t = i / this.count;
      if (gaps.some((g) => t >= g.from && t <= g.to)) continue;
      // Alternating sides reads as a rigged route rather than an avenue, and
      // halves the number of poles for the same coverage.
      const side = cfg.alternate === false ? 'right' : flip++ % 2 ? 'left' : 'right';
      const s = side === 'left' ? -1 : 1;
      const off = this.halfWidth[i] + (cfg.offset ?? 4.5);
      this.lightAnchors.push({
        x: this.px[i] + this.rx[i] * off * s,
        y: this.py[i],
        z: this.pz[i] + this.rz[i] * off * s,
        height: cfg.height ?? 8,
        // Lamps lean over the road, so the head is inboard of the pole.
        aimX: this.px[i],
        aimZ: this.pz[i],
        side,
        t,
        sample: i,
      });
    }
  }

  // -- queries --------------------------------------------------------------

  /**
   * Nearest point on the track to (x, z).
   *
   * `y` is optional and only matters where a road passes over itself — a
   * spiral, a flyover, a figure of eight. In plan view those are the same
   * place, and a query that only knows (x, z) has to guess which deck it is
   * being asked about; guessing wrong teleports a car sixty metres. Given a
   * height it prefers the deck nearest that height, and a car climbing a
   * spiral stays on the ramp it is on.
   *
   * The penalty is a WEIGHTED tie-break rather than a filter: two metres of
   * height error is worth `HEIGHT_BIAS` metres of lateral error, so on ordinary
   * ground (where only one candidate is anywhere near) it changes nothing at
   * all, and where two decks overlap it decides. Passing no height is still
   * valid and still means "whatever is nearest in plan" — which is what every
   * caller that is not a car wants.
   *
   * @param {number} [y] height of whoever is asking, if they have one
   * @returns {null | {index:number, dist:number, signedDist:number, height:number,
   *   halfWidth:number, surface:string, progress:number, onRoad:boolean,
   *   deck:number, forwardX:number, forwardZ:number, grade:number}}
   */
  query(x, z, out = {}, y = null) {
    const candidates = this._grid.get(this._cellKey(x, z));
    if (!candidates) return null;

    let best = -1;
    let bestDist = Infinity;
    let bestScore = Infinity;
    let bestT = 0;
    for (let k = 0; k < candidates.length; k++) {
      const i = candidates[k];
      const j = this.loop ? (i + 1) % this.count : Math.min(i + 1, this.count - 1);
      const r = pointSegmentXZ(x, z, this.px[i], this.pz[i], this.px[j], this.pz[j]);
      let score = r.dist;
      if (y != null) {
        const segY = lerp(this.py[i], this.py[j], r.t);
        score += Math.abs(y - segY) * HEIGHT_BIAS;
      }
      if (score < bestScore) {
        bestScore = score;
        bestDist = r.dist;
        best = i;
        bestT = r.t;
      }
    }
    if (best < 0) return null;

    const j = this.loop ? (best + 1) % this.count : Math.min(best + 1, this.count - 1);
    const halfWidth = lerp(this.halfWidth[best], this.halfWidth[j], bestT);
    const height = lerp(this.py[best], this.py[j], bestT);
    // Sign tells you which side you fell off, which the escape needs to know.
    const dx = x - lerp(this.px[best], this.px[j], bestT);
    const dz = z - lerp(this.pz[best], this.pz[j], bestT);
    const side = dx * this.rx[best] + dz * this.rz[best] >= 0 ? 1 : -1;

    out.index = best;
    out.dist = bestDist;
    out.signedDist = bestDist * side;
    out.height = height;
    out.halfWidth = halfWidth;
    out.surface = this.surfaces[best];
    out.runoff = this.runoff[best];
    out.progress = this.length > 0 ? this.arc[best] / this.length : 0;
    out.onRoad = bestDist <= halfWidth;
    /** 0 on the ground, 1 on a deck in the air. @see _applyElevated */
    out.deck = lerp(this.deck[best], this.deck[j], bestT);
    out.forwardX = this.tx[best];
    out.forwardZ = this.tz[best];
    /**
     * Interpolated across the segment, unlike the tangent above. A per-sample
     * gradient read raw is a staircase, and a staircase in the *normal* is a
     * car whose body flicks between two angles every four metres — which is
     * what a climb read off the terrain heightfield used to look like.
     */
    out.grade = lerp(this.grade[best], this.grade[j], bestT);
    return out;
  }

  /**
   * The road's own surface normal at a query result.
   *
   * The ribbon is not banked: it tilts along its length and nowhere else, so
   * the normal falls straight out of the gradient and the horizontal tangent —
   * (-tx·g, 1, -tz·g), normalised. That is worth having as a function rather
   * than as three lines at the call site because the alternative, and what the
   * physics did before, is to ask the *terrain* what the normal is.
   *
   * Asking the terrain is wrong in two ways that both show up as "the car will
   * not sit on the road". Under a deck the terrain is the valley floor forty
   * metres down, and its normal has nothing to do with the bridge — the car is
   * tilted by scenery it is flying over, and gravity's in-plane component drags
   * it sideways off a deck that is perfectly flat. On graded ground it is
   * subtler and just as visible: the heightfield carries one sample every
   * several metres, so a steep quarry climb is a coarse approximation of the
   * smooth ribbon laid over it, and the car's attitude disagrees with the road
   * you can see under its wheels.
   *
   * @param {{forwardX:number, forwardZ:number, grade:number}} q a `query` result
   * @param {THREE.Vector3} out
   */
  normalAt(q, out) {
    const g = q.grade || 0;
    return out.set(-q.forwardX * g, 1, -q.forwardZ * g).normalize();
  }

  /**
   * Terrain shaper: flattens the land under and beside the road.
   * Install with `terrain.shaper = track.shapeTerrain`.
   */
  shapeTerrain = (x, z, h) => {
    const q = this.query(x, z, _queryScratch);
    if (!q) return h;
    if (q.dist >= ROAD.flattenRadius) return h;
    // Exactly the road's height out to `flattenCore`, then eased back to the
    // natural ground. See the note on ROAD.flattenCore — the core radius is
    // what keeps the tarmac from being swallowed by the heightfield.
    const core = Math.max(q.halfWidth + ROAD.shoulderWidth, ROAD.flattenCore);
    const w = q.dist <= core ? 1 : (1 - smoothstep(core, ROAD.flattenRadius, q.dist)) ** 2;
    // …and a deck does not grade the land at all: it stands over it. The
    // taper in `deck` is what turns the last stretch of graded earth into the
    // abutment the bridge starts from. @see _applyElevated
    return lerp(h, q.height, w * (1 - q.deck));
  };

  /**
   * Position and heading for grid slot `index`.
   *
   * Slot 0 is POLE: centred, alone on the front row, and `poleGap` clear of
   * everyone else so the chase camera has empty track to sit in.
   */
  gridSlot(index, rowGap, colGap, poleGap = 0) {
    const isPole = index === 0;
    const row = isPole ? 0 : Math.floor((index - 1) / 2) + 1;
    const col = isPole ? 0 : (index - 1) % 2 === 0 ? -1 : 1;
    // Walk backwards along the track from the start line.
    const back = rowGap + (isPole ? 0 : poleGap + (row - 1) * rowGap);
    const samplesBack = Math.round(back / ROAD.sampleSpacing);
    const i = this.loop
      ? ((this.startLine.sample - samplesBack) % this.count + this.count) % this.count
      : Math.max(0, this.startLine.sample - samplesBack);
    const off = (colGap / 2) * col;
    return {
      position: new THREE.Vector3(
        this.px[i] + this.rx[i] * off,
        this.py[i] + 0.5,
        this.pz[i] + this.rz[i] * off
      ),
      heading: Math.atan2(this.tx[i], this.tz[i]),
      sample: i,
    };
  }

  /** A point on the racing line, `metresAhead` along the track from sample `i`. */
  ahead(i, metresAhead, out = new THREE.Vector3()) {
    const steps = Math.round(metresAhead / ROAD.sampleSpacing);
    const j = this.loop
      ? ((i + steps) % this.count + this.count) % this.count
      : clamp(i + steps, 0, this.count - 1);
    return out.set(this.px[j], this.py[j], this.pz[j]);
  }

  sampleIndexAt(progress) {
    return clamp(Math.floor(progress * this.count), 0, this.count - 1);
  }

  // -- geometry -------------------------------------------------------------

  /**
   * @param {import('../render/materials.js').MaterialLibrary} materials
   * @param {object} theme resolved theme
   * @param {import('./terrain.js').Terrain} [terrain] only needed by a track
   *   with an elevated run in it — a pillar has to reach the ground, and the
   *   ground is the one thing a track does not otherwise know about.
   */
  buildMesh(materials, theme, terrain = null) {
    const group = new THREE.Group();
    group.name = `track:${this.id}`;

    const roadB = new GeomBuilder();
    const decalB = new GeomBuilder();
    const R = theme.road;

    const paint = this.data.paint || {};

    const c = this.count;
    const last = this.loop ? c : c - 1;
    let dashRun = 0;
    let kerbRun = 0;

    for (let i = 0; i < last; i++) {
      const j = this.loop ? (i + 1) % c : i + 1;
      const segLen = Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);

      const surf = this.surfaces[i];
      // Surface tells you what the road is *made of* — the ice patch on the
      // third parkour is visible, not a trap you cannot see coming.
      const roadColor = surfaceColor(surf, R.surface, theme);

      const a0 = this._edge(i, -this.halfWidth[i], ROAD.roadLift);
      const a1 = this._edge(i, this.halfWidth[i], ROAD.roadLift);
      const b0 = this._edge(j, -this.halfWidth[j], ROAD.roadLift);
      const b1 = this._edge(j, this.halfWidth[j], ROAD.roadLift);
      roadB.addQuadFacing(a0, a1, b1, b0, roadColor);

      // Graded shoulders — but only where there is ground to grade. A deck's
      // edge is a wall and a drop, and it is built in `_buildDeckMesh`.
      if (this.deck[i] < 0.5) {
        const s = ROAD.shoulderWidth;
        const d = -ROAD.shoulderDrop;
        roadB.addQuadFacing(
          this._edge(i, -this.halfWidth[i] - s, d),
          a0,
          b0,
          this._edge(j, -this.halfWidth[j] - s, d),
          R.shoulder
        );
        roadB.addQuadFacing(
          a1,
          this._edge(i, this.halfWidth[i] + s, d),
          this._edge(j, this.halfWidth[j] + s, d),
          b1,
          R.shoulder
        );
      }

      // Painted markings. Hoisted out of the conditionals below because the
      // centre dashes need `lw` too, and an unsealed track skips both.
      const li = ROAD.lineInset;
      const lw = ROAD.lineWidth;

      // Edge lines.
      if (paint.edgeLines !== false) {
      for (const side of [-1, 1]) {
        const inner = side * (this.halfWidth[i] - li);
        const outer = side * (this.halfWidth[i] - li - lw);
        const innerJ = side * (this.halfWidth[j] - li);
        const outerJ = side * (this.halfWidth[j] - li - lw);
        const p0 = this._edge(i, Math.min(inner, outer), ROAD.roadLift + 0.012);
        const p1 = this._edge(i, Math.max(inner, outer), ROAD.roadLift + 0.012);
        const p2 = this._edge(j, Math.max(innerJ, outerJ), ROAD.roadLift + 0.012);
        const p3 = this._edge(j, Math.min(innerJ, outerJ), ROAD.roadLift + 0.012);
        decalB.addQuadFacing(p0, p1, p2, p3, R.edgeLine);
      }
      }

      // Dashed centre line.
      dashRun += segLen;
      const cycle = ROAD.centreDashLength + ROAD.centreDashGap;
      if (paint.centreLine !== false && dashRun % cycle < ROAD.centreDashLength) {
        decalB.addQuadFacing(
          this._edge(i, -lw, ROAD.roadLift + 0.012),
          this._edge(i, lw, ROAD.roadLift + 0.012),
          this._edge(j, lw, ROAD.roadLift + 0.012),
          this._edge(j, -lw, ROAD.roadLift + 0.012),
          R.centreLine
        );
      }

      // Kerbs on the inside of tight corners.
      const k = this.curvature[i];
      if (paint.kerbs !== false && Math.abs(k) > ROAD.kerbCurvature) {
        kerbRun += segLen;
        const stripe = Math.floor(kerbRun / ROAD.kerbStripeLength) % 2 === 0;
        const side = k > 0 ? -1 : 1;
        const inner = side * this.halfWidth[i];
        const outer = side * (this.halfWidth[i] + ROAD.kerbWidth);
        const innerJ = side * this.halfWidth[j];
        const outerJ = side * (this.halfWidth[j] + ROAD.kerbWidth);
        decalB.addQuadFacing(
          this._edge(i, Math.min(inner, outer), ROAD.roadLift + 0.02),
          this._edge(i, Math.max(inner, outer), ROAD.roadLift + 0.02),
          this._edge(j, Math.max(innerJ, outerJ), ROAD.roadLift + 0.02),
          this._edge(j, Math.min(innerJ, outerJ), ROAD.roadLift + 0.02),
          stripe ? R.kerbA : R.kerbB
        );
      } else {
        kerbRun = 0;
      }
    }

    const road = new THREE.Mesh(roadB.build(), materials.get('road'));
    road.name = 'road';
    group.add(road);
    const decals = new THREE.Mesh(decalB.build(), materials.get('roadDecal'));
    decals.name = 'roadDecals';
    group.add(decals);

    group.add(this._buildStartLine(materials, theme));
    const deck = this._buildDeckMesh(materials, theme, terrain);
    if (deck) group.add(deck);
    const barriers = this._buildBarrierMesh(materials, theme);
    if (barriers) group.add(barriers);
    const markers = this._buildMarkerMesh(materials, theme);
    if (markers) group.add(markers);
    const lamps = this._buildLampMesh(materials, theme);
    if (lamps) group.add(lamps);

    return group;
  }

  _edge(i, offset, lift) {
    return new THREE.Vector3(
      this.px[i] + this.rx[i] * offset,
      this.py[i] + lift,
      this.pz[i] + this.rz[i] * offset
    );
  }

  _buildStartLine(materials, theme) {
    const b = new GeomBuilder();
    const i = this.startLine.sample;
    const hw = this.halfWidth[i];
    const squares = 10;
    const depth = 2.2;
    for (let k = 0; k < squares; k++) {
      const o0 = -hw + (k / squares) * hw * 2;
      const o1 = -hw + ((k + 1) / squares) * hw * 2;
      for (let row = 0; row < 2; row++) {
        const dark = (k + row) % 2 === 0;
        const z0 = (row - 1) * depth * 0.5;
        const z1 = row * depth * 0.5;
        const p = (off, along) =>
          new THREE.Vector3(
            this.px[i] + this.rx[i] * off + this.tx[i] * along,
            this.py[i] + ROAD.roadLift + 0.03,
            this.pz[i] + this.rz[i] * off + this.tz[i] * along
          );
        b.addQuadFacing(p(o0, z0), p(o1, z0), p(o1, z1), p(o0, z1), dark ? 0x161616 : 0xe8e4cc);
      }
    }
    const m = new THREE.Mesh(b.build(), materials.get('roadDecal'));
    m.name = 'startLine';
    return m;
  }

  /**
   * The bridge itself: what you see from underneath and from the side.
   *
   * Three parts, and each one is answering a question the player will ask by
   * looking at it. The SIDE is why the road does not simply stop at its own
   * edge — a ribbon in the air with no thickness reads as a texture painted on
   * the sky. The SOFFIT (the underside) is why driving beneath a viaduct is
   * worth doing at all: there is a ceiling down there. The PILLARS are why it
   * is standing up, and they are the reason this method needs the terrain —
   * each one is cut to the ground it happens to land on, so a bridge across a
   * valley grows longer legs in the middle without anybody authoring that.
   *
   * The parapets are the same walls the physics already has (`_buildParapets`),
   * drawn from the colliders so the thing you hit and the thing you see cannot
   * drift apart.
   */
  _buildDeckMesh(materials, theme, terrain) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.deck[i] > 0.01) {
        any = true;
        break;
      }
    }
    if (!any) return null;

    const R = theme.road;
    const P = theme.props;
    const structure = new GeomBuilder();
    const T = ROAD.deckThickness;
    const c = this.count;
    const last = this.loop ? c : c - 1;

    for (let i = 0; i < last; i++) {
      const j = this.loop ? (i + 1) % c : i + 1;
      // Both ends of a span have to be in the air, or the abutment gets a face
      // hanging in mid-air where the deck begins.
      if (this.deck[i] < 0.5 || this.deck[j] < 0.5) continue;

      const hwI = this.halfWidth[i] + ROAD.parapetThickness;
      const hwJ = this.halfWidth[j] + ROAD.parapetThickness;
      const topI = ROAD.roadLift;
      const under = -T;

      // Sides, seen edge-on from the road below.
      for (const s of [-1, 1]) {
        const t0 = this._edge(i, hwI * s, topI);
        const t1 = this._edge(j, hwJ * s, topI);
        const b0 = this._edge(i, hwI * s, under);
        const b1 = this._edge(j, hwJ * s, under);
        if (s > 0) structure.addQuadFacing(t0, b0, b1, t1, shade(R.surface, -0.18));
        else structure.addQuadFacing(b0, t0, t1, b1, shade(R.surface, -0.18));
      }

      // The soffit. Darker than anything else on the structure, because it
      // never sees the sun and because it is what makes the underside read as
      // the underside of something.
      structure.addQuadFacing(
        this._edge(j, -hwJ, under),
        this._edge(j, hwJ, under),
        this._edge(i, hwI, under),
        this._edge(i, -hwI, under),
        shade(R.surface, -0.42)
      );
    }

    // Pillars, at a spacing rather than per sample: a leg every few metres is
    // a wall, and a wall under a bridge is a dam.
    if (terrain) {
      const step = Math.max(2, Math.round(ROAD.pillarSpacing / ROAD.sampleSpacing));
      for (let i = 0; i < this.count; i += step) {
        if (!this.isElevated(i)) continue;
        const x = this.px[i];
        const z = this.pz[i];
        const ground = terrain.heightAt(x, z);
        const top = this.py[i] - T;
        const height = top - ground + 1.5;
        // Nothing to hold up: the deck is grazing the hillside here.
        if (height < 3) continue;
        const hw = ROAD.pillarHalfWidth;
        structure.addBox(
          { x, y: ground - 0.75 + height / 2, z },
          { x: hw * 2, y: height, z: hw * 1.3 },
          { all: shade(P.barrier, -0.28), top: shade(P.barrier, -0.1) },
          Math.atan2(this.tx[i], this.tz[i])
        );
        // A wider foot, so the leg meets the ground rather than ending at it.
        structure.addBox(
          { x, y: ground + 0.6, z },
          { x: hw * 2.9, y: 1.2, z: hw * 2.1 },
          { all: shade(P.barrier, -0.34), top: shade(P.barrier, -0.16) },
          Math.atan2(this.tx[i], this.tz[i])
        );
      }
    }

    // The walls, drawn from the colliders that already exist.
    for (const col of this.colliders) {
      if (col.kind !== 'parapet') continue;
      structure.addBox(
        { x: col.x, y: col.y, z: col.z },
        { x: col.halfX * 2, y: col.halfY * 2, z: col.halfZ * 2 },
        { all: P.barrier, top: shade(P.barrier, 0.14) },
        col.rotationY
      );
    }

    const mesh = new THREE.Mesh(structure.build(), materials.get('barrier'));
    mesh.name = 'deck';
    return mesh;
  }

  _buildBarrierMesh(materials, theme) {
    if (this.colliders.length === 0) return null;
    const b = new GeomBuilder();
    const P = theme.props;
    for (const c of this.colliders) {
      if (c.kind !== 'barrier') continue;
      const stripe = Math.floor(c.sample / 4) % 2 === 0;
      b.addBox(
        { x: c.x, y: c.y, z: c.z },
        { x: c.halfX * 2, y: c.halfY * 2, z: c.halfZ * 2 },
        { all: stripe ? P.barrier : P.barrierAlt, top: shade(P.barrier, 0.1) },
        c.rotationY
      );
    }
    const m = new THREE.Mesh(b.build(), materials.get('barrier'));
    m.name = 'barriers';
    return m;
  }

  /**
   * The plastic posts. Flexible orange delineators with a reflective band —
   * the cheapest possible way to say "the road is this wide" without putting
   * anything solid at the edge of it.
   */
  _buildMarkerMesh(materials, theme) {
    if (this.markers.length === 0) return null;
    const cfg = this.data.markers || {};
    const h = cfg.height ?? 1.05;
    const body = new GeomBuilder();
    const band = new GeomBuilder();
    const post = cfg.color ?? 0xe06a2a;

    for (const m of this.markers) {
      body.addBox(
        { x: m.x, y: m.y + h / 2, z: m.z },
        { x: 0.11, y: h, z: 0.055 },
        { all: post, top: shade(post, 0.18) },
        m.rotationY
      );
      // Two reflective bands. On the emissive material they stay legible at
      // night and in fog, which is the entire job of these things.
      for (const frac of [0.78, 0.56]) {
        band.addBox(
          { x: m.x, y: m.y + h * frac, z: m.z },
          { x: 0.13, y: h * 0.1, z: 0.07 },
          0xf2f0e2,
          m.rotationY
        );
      }
    }

    const g = new THREE.Group();
    g.name = 'markers';
    g.add(new THREE.Mesh(body.build(), materials.get('barrier')));
    g.add(new THREE.Mesh(band.build(), materials.get('emissive')));
    return g;
  }

  /**
   * The lighting rig: poles with a head canted over the road. The heads are
   * emissive so they read as "lit" even when `src/world/lighting.js` has not
   * given this pole one of its limited real lights.
   */
  _buildLampMesh(materials, theme) {
    if (this.lightAnchors.length === 0) return null;
    const poles = new GeomBuilder();
    const heads = new GeomBuilder();

    for (const a of this.lightAnchors) {
      const dx = a.aimX - a.x;
      const dz = a.aimZ - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ix = dx / len;
      const iz = dz / len;
      const yaw = Math.atan2(ix, iz);
      const reach = 2.4;

      poles.addCylinder({ x: a.x, y: a.y + a.height / 2, z: a.z }, 0.17, 0.12, a.height, 6, {
        side: theme.props.post,
        top: shade(theme.props.post, 0.1),
      });
      // The arm out over the road.
      poles.addBox(
        { x: a.x + ix * reach * 0.5, y: a.y + a.height, z: a.z + iz * reach * 0.5 },
        { x: 0.1, y: 0.1, z: reach },
        theme.props.post,
        yaw
      );
      // Housing.
      poles.addBox(
        { x: a.x + ix * reach, y: a.y + a.height - 0.08, z: a.z + iz * reach },
        { x: 0.62, y: 0.2, z: 0.9 },
        { all: 0x2a2a2e, top: 0x3a3a40 },
        yaw
      );
      // The lit face, pointing down.
      heads.addBox(
        { x: a.x + ix * reach, y: a.y + a.height - 0.2, z: a.z + iz * reach },
        { x: 0.5, y: 0.06, z: 0.76 },
        0xfff0cc,
        yaw
      );
    }

    const g = new THREE.Group();
    g.name = 'lamps';
    g.add(new THREE.Mesh(poles.build(), materials.get('barrier')));
    const lit = new THREE.Mesh(heads.build(), materials.get('emissive').clone());
    lit.userData.ownsMaterial = true;
    lit.name = 'lampHeads';
    g.add(lit);
    return g;
  }
}

const _queryScratch = {};

/**
 * Metres of lateral error that one metre of height error is worth, when a
 * caller tells `query` how high up it is.
 *
 * Sized against the two things it has to separate. A spiral's decks are twelve
 * to twenty metres apart vertically, and a road is sixteen metres wide: at 3
 * the wrong deck costs 36m+ of score and can never win, while a car half a
 * metre off its own deck (which is every car, every frame — they sit on top of
 * it) costs 1.5m and never changes the answer.
 */
const HEIGHT_BIAS = 3;

/** Ice and mud read as a visible change in the road, not an invisible trap. */
function surfaceColor(surface, base, theme) {
  switch (surface) {
    case 'ICE':
      return 0xb9cfd8;
    case 'MUD':
      return 0x5b4a35;
    case 'DIRT':
      return theme.road.shoulder;
    case 'GRASS':
      return theme.ground.base;
    default:
      return base;
  }
}
