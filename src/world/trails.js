/**
 * TRAILS — evidence that somebody was here first.
 *
 * The open world's whole premise is that it is a real place, and a real place
 * that people used to drive to has paths worn into it. An untouched forest
 * says the opposite: it says nobody has ever been here, including you.
 *
 * NO GEOMETRY
 * -----------
 * A trail is not a mesh, a decal or a texture. It is a rule that darkens the
 * terrain's own vertex colours as they are being baked, through
 * `Terrain#painter` — the colour-space sibling of `Terrain#shaper`. So the
 * entire network costs one extra distance query per terrain vertex at build
 * time and exactly nothing after that: no draw call, no overdraw, no
 * z-fighting with the ground it is drawn on, and it cross-fades with the theme
 * like every other vertex colour in the world.
 *
 * WHAT THE NETWORK IS
 * -------------------
 * One route from each landmark down to the nearest parkour, because that is
 * the journey somebody made, plus the handful of landmark-to-landmark links in
 * `OPEN_WORLD.trails.links`. That is all. A trail you can plan a route along
 * is a road, and there are no roads out here — the three parkours are the only
 * built thing in the world and they are the point.
 *
 * Routes wander (a seeded perpendicular offset, pinned at both ends) and fade
 * in and out along their length against a noise field, so most of any given
 * path has grown back over and you only catch it in stretches. A trail that is
 * continuous from end to end reads as a stripe somebody painted.
 *
 * THE RESOLUTION CEILING, STATED HONESTLY
 * ---------------------------------------
 * The heightfield carries one vertex every `OPEN_WORLD.terrainCellSize` — 13
 * metres. A two-metre tyre rut cannot be expressed in that at all: it would
 * fall between vertices and alias into nothing, or into a dotted line. So what
 * is drawn is a worn band a couple of vertices across, which is what an old
 * forest track looks like from a car anyway. Drawing the ruts themselves would
 * mean a second mesh, and a second mesh is the thing this file exists to avoid.
 */

import { OPEN_WORLD } from '../config/gameplay.js';
import { GROUND_PAINT } from '../config/style.js';
import { pointSegmentXZ, clamp01, fbm2, lerp, smoothstep } from '../core/mathx.js';
import { Rng, hashString } from '../core/rng.js';

export class Trails {
  /**
   * @param {object} opts
   * @param {number} opts.halfSpan world half-width, metres
   * @param {{x:number, z:number}[]} opts.landmarks where the routes go
   * @param {{px:Float32Array|number[], pz:Float32Array|number[], count:number}[]} [opts.tracks]
   *   parkour centrelines; each landmark gets a route to the nearest point on one
   * @param {number} [opts.seed]
   * @param {object} [opts.cfg] the level's own trail settings, merged over
   *   `OPEN_WORLD.trails` by `World#_resolveSpec`. A map with wider or fainter
   *   routes than the default is a level file field, not a fork of this class.
   */
  constructor({ halfSpan, landmarks, tracks = [], seed = 1, cfg = OPEN_WORLD.trails }) {
    this.cfg = cfg;
    this.halfSpan = halfSpan;
    this.seed = seed;
    /** @type {{x0:number,z0:number,x1:number,z1:number}[]} */
    this.segments = [];
    /** @type {{x:number,z:number}[][]} the polylines, kept for tests and debug */
    this.routes = [];
    this._grid = new Map();
    this._cell = this.cfg.edgeWidth * 4;
    this._scratch = {};
    this._build(landmarks, tracks);
  }

  _build(landmarks, tracks) {
    const rng = new Rng((this.seed ^ hashString('trails')) >>> 0);

    // One route per landmark, down to the nearest point on any parkour. That
    // is the journey the trail is evidence OF: somebody parked at the road and
    // walked, or drove, out to the thing.
    for (const lm of landmarks) {
      const near = nearestOnTracks(lm.x, lm.z, tracks);
      if (near) this._route(lm, near, rng);
    }
    // …and the few links between landmarks. Deliberately few.
    for (const [a, b] of this.cfg.links) {
      if (landmarks[a] && landmarks[b]) this._route(landmarks[a], landmarks[b], rng);
    }

    // …and the spurs, which are the ones the player will actually find.
    const S = this.cfg.spurs;
    const withNormals = tracks.filter((t) => t.rx && t.rz);
    for (let i = 0; withNormals.length && i < S.count; i++) {
      const t = withNormals[rng.int(0, withNormals.length - 1)];
      const k = rng.int(0, t.count - 1);
      const side = rng.bool() ? 1 : -1;
      // Off the road at roughly a right angle, jittered, then straight on into
      // the trees for a couple of hundred metres and no further.
      const jitter = rng.range(-0.7, 0.7);
      const dirX = (t.rx[k] * Math.cos(jitter) - t.rz[k] * Math.sin(jitter)) * side;
      const dirZ = (t.rx[k] * Math.sin(jitter) + t.rz[k] * Math.cos(jitter)) * side;
      const len = rng.range(S.length[0], S.length[1]);
      const a = { x: t.px[k], z: t.pz[k] };
      const b = { x: a.x + dirX * len, z: a.z + dirZ * len };
      if (Math.abs(b.x) > this.halfSpan * 0.97 || Math.abs(b.z) > this.halfSpan * 0.97) continue;
      // Not back onto a road, including one of the other two parkours.
      const end = nearestOnTracks(b.x, b.z, tracks);
      if (end && Math.hypot(end.x - b.x, end.z - b.z) < S.clearEnd) continue;
      this._route(a, b, rng);
    }
  }

  /** One wandering polyline from a to b, added to the segment index. */
  _route(a, b, rng) {
    const C = this.cfg;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    // Perpendicular, for the wander.
    const nx = -dz / len;
    const nz = dx / len;
    // Two waves at different rates, with random phases: one wave is a bow, and
    // a bow between two points is not a path, it is an arc.
    const p1 = rng.range(0, Math.PI * 2);
    const p2 = rng.range(0, Math.PI * 2);
    const a1 = rng.range(-1, 1);
    const a2 = rng.range(-0.6, 0.6);
    const amp = C.wander * Math.min(1, len / 400);

    const offsets = [];
    let strayed = 0;
    for (let i = 0; i <= C.segments; i++) {
      const t = i / C.segments;
      // sin(pi t) pins both ends: the trail arrives exactly at the landmark
      // and exactly at the road, however far it strayed in between.
      const hold = Math.sin(Math.PI * t);
      const off = (Math.sin(t * 3.1 + p1) * a1 + Math.sin(t * 6.7 + p2) * a2) * amp * hold;
      offsets.push(off);
      strayed = Math.max(strayed, Math.abs(off));
    }

    // NO ROUTE MAY COME OUT STRAIGHT.
    //
    // The two waves above are randomly phased, so now and then they cancel and
    // the "path" is a ruler line between two points — which is the one thing a
    // worn route must never look like. It used to be rare enough to ignore
    // because routes were short; on a map with a single parkour in the middle
    // of it a landmark route crosses most of the world, and a straight line
    // that long is a survey marking. So the wander is rescaled to a floor
    // proportional to the route's own length, rather than left to the dice.
    const floor = Math.min(amp, len * C.minWander);
    const scale = strayed > 1e-3 && strayed < floor ? floor / strayed : 1;

    const pts = [];
    for (let i = 0; i <= C.segments; i++) {
      const t = i / C.segments;
      const off = offsets[i] * scale;
      const x = a.x + dx * t + nx * off;
      const z = a.z + dz * t + nz * off;
      pts.push({ x, z });
    }
    this.routes.push(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      this._insert({ x0: pts[i].x, z0: pts[i].z, x1: pts[i + 1].x, z1: pts[i + 1].z });
    }
  }

  /** Bucket a segment into every grid cell its fattened bounds touch. */
  _insert(seg) {
    const idx = this.segments.push(seg) - 1;
    const pad = this.cfg.edgeWidth;
    const c = this._cell;
    const i0 = Math.floor((Math.min(seg.x0, seg.x1) - pad) / c);
    const i1 = Math.floor((Math.max(seg.x0, seg.x1) + pad) / c);
    const j0 = Math.floor((Math.min(seg.z0, seg.z1) - pad) / c);
    const j1 = Math.floor((Math.max(seg.z0, seg.z1) + pad) / c);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = i + ',' + j;
        let list = this._grid.get(key);
        if (!list) this._grid.set(key, (list = []));
        list.push(idx);
      }
    }
  }

  /**
   * How worn the ground is here, 0 (untouched) .. 1 (bare path).
   *
   * Cheap enough to call per terrain vertex at build time and per ground-cover
   * recycle at runtime: the segment index means a query in open forest touches
   * nothing at all.
   * @returns {number}
   */
  strengthAt(x, z) {
    const c = this._cell;
    const list = this._grid.get(Math.floor(x / c) + ',' + Math.floor(z / c));
    if (!list) return 0;
    const C = this.cfg;
    let best = Infinity;
    for (let k = 0; k < list.length; k++) {
      const s = this.segments[list[k]];
      const r = pointSegmentXZ(x, z, s.x0, s.z0, s.x1, s.z1);
      if (r.dist < best) best = r.dist;
    }
    if (best >= C.edgeWidth) return 0;
    const band = 1 - smoothstep(C.coreWidth, C.edgeWidth, best);
    // Patchiness along the route. Sampled in WORLD space rather than along the
    // route's own parameter, so two trails that cross grow over together and
    // the overgrown stretches read as thicker forest rather than as a fault in
    // one path.
    const n = fbm2(x * C.fadeScale, z * C.fadeScale, 3) * 0.5 + 0.5;
    return band * smoothstep(C.fadeFrom, C.fadeTo, n);
  }

  /**
   * A painter for `Terrain#painter`.
   *
   * Bakes the theme's colours in once, so the per-vertex cost is a lookup and
   * three lerps. Worn ground goes toward bare earth AND darker AND grittier: a
   * rut is exposed soil, it is in shadow because it is a groove, and it is
   * where the stones end up. Any one of those alone reads as a painted stripe.
   *
   * @param {object} theme resolved theme
   * @returns {(x:number, z:number, rgb:number[]) => void}
   */
  painter(theme) {
    const T = GROUND_PAINT.trail;
    const hexToLinear = (hex) => {
      // sRGB → linear, matching THREE.Color.set()'s working space. Kept local
      // so this module does not need three at all.
      const srgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255);
      return srgb.map((v) => (v < 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    };
    const dirt = hexToLinear(theme.ground.dirt);
    const grit = hexToLinear(theme.ground.grit);

    return (x, z, rgb) => {
      const w = this.strengthAt(x, z);
      if (w <= 0) return;
      const toDirt = w * T.toDirt;
      const gritMix = w * T.grit;
      const dark = 1 - w * T.darken;
      for (let i = 0; i < 3; i++) {
        let v = lerp(rgb[i], dirt[i], toDirt);
        v = lerp(v, grit[i], gritMix);
        rgb[i] = clamp01(v * dark);
      }
    };
  }
}

/** Nearest point on any parkour centreline, or null if there are no parkours. */
function nearestOnTracks(x, z, tracks) {
  let best = null;
  let bestD = Infinity;
  for (const t of tracks) {
    for (let i = 0; i < t.count; i++) {
      const d = (t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: t.px[i], z: t.pz[i] };
      }
    }
  }
  return best;
}
