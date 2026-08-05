/**
 * TRACK SHAPES — where the control points in `src/levels/*.js` came from.
 *
 *   node tools/track-shapes.mjs          every route, with its numbers
 *   node tools/track-shapes.mjs 6        one of them
 *   PLOT=1 node tools/track-shapes.mjs 9 …and an ASCII plan view of it
 *
 * A parkour is a list of control points, and a list of control points is a
 * terrible thing to type. This is the authoring end of that: routes are built
 * as CHAINS of runs and arcs, each starting exactly where the last one ended,
 * resampled to uniform spacing, and printed in the form a level file wants.
 *
 * IT IS HERE BECAUSE THE MISTAKES ARE REPEATABLE. Every defect in the first
 * pass of levels 4–10 came from geometry, not from code: an arc entered from
 * the wrong side so the road doubled back; a closing segment shorter than its
 * neighbours so the spline cusped and the road turned inside out; a climb
 * eased with a smoothstep so its middle was half as steep again as its
 * average. The chain builder makes the first impossible, uniform resampling
 * makes the second impossible, and `emit` prints the numbers that catch the
 * third. `npm test` then drives an AI round every level, which catches
 * whatever is left.
 *
 * Nothing in `src/` imports this. It is a pen.
 */

const D = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;

/** Polar loop: entries of [angleDeg, radius, y, width]. */
export function polar(entries, { cx = 0, cz = 0 } = {}) {
  return entries.map(([a, r, y, w]) => ({
    x: cx + Math.cos(a * D) * r,
    z: cz + Math.sin(a * D) * r,
    y,
    width: w,
  }));
}

/** A helix: `turns` may exceed 1, and y eases from y0 to y1 across it. */
export function spiral({ cx, cz, r0, r1: rEnd = r0, from, to, y0, y1, step = 30, width, ease = 'smooth' }) {
  const out = [];
  const span = to - from;
  const n = Math.max(2, Math.round(Math.abs(span) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (from + span * t) * D;
    const r = r0 + (rEnd - r0) * t;
    // Smoothstep the height so the ramp eases in and out of the flat road at
    // each end rather than kinking.
    const s = ease === 'linear' ? t : t * t * (3 - 2 * t);
    out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, y: y0 + (y1 - y0) * s, width });
  }
  return out;
}

/** Straight-ish run between two points, with eased height. */
export function run(a, b, n, width, { bow = 0, ease = 'smooth' } = {}) {
  const out = [];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const nx = -dz / len;
  const nz = dx / len;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = ease === 'linear' ? t : t * t * (3 - 2 * t);
    const off = Math.sin(Math.PI * t) * bow;
    out.push({
      x: a.x + dx * t + nx * off,
      z: a.z + dz * t + nz * off,
      y: a.y + (b.y - a.y) * s,
      width: width ?? a.width ?? b.width,
    });
  }
  return out;
}

/** Drop consecutive duplicates and print as a level file's points block. */
export function emit(name, pts, { drop = 1 } = {}) {
  const clean = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(last.x - p.x, last.z - p.z) < drop) continue;
    clean.push(p);
  }
  // Report what the shape is going to feel like. Measured over a window
  // rather than per pair: uniform resampling makes adjacent-point metrics
  // pure noise, and what a driver feels is the curve, not the segment.
  let maxGrade = 0;
  let gradeAt = 0;
  let minR = Infinity;
  let radiusAt = 0;
  let len = 0;
  const n = clean.length;
  for (let i = 0; i < n; i++) {
    const a = clean[i];
    const b = clean[(i + 1) % n];
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  const W = 3;
  for (let i = 0; i < n; i++) {
    const a = clean[i];
    const b = clean[(i + W) % n];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 1) {
      const g = Math.abs(b.y - a.y) / d;
      if (g > maxGrade) { maxGrade = g; gradeAt = i; }
    }
    // Turn rate over the window → the radius of the curve it describes.
    const p0 = clean[(i - W + n) % n];
    const p2 = clean[(i + W) % n];
    const h0 = Math.atan2(a.x - p0.x, a.z - p0.z);
    const h1 = Math.atan2(p2.x - a.x, p2.z - a.z);
    let turn = h1 - h0;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const arc = Math.hypot(a.x - p0.x, a.z - p0.z) + Math.hypot(p2.x - a.x, p2.z - a.z);
    if (Math.abs(turn) > 0.02) {
      const r = arc / Math.abs(turn);
      if (r < minR) { minR = r; radiusAt = i; }
    }
  }
  const xs = clean.map((p) => p.x);
  const zs = clean.map((p) => p.z);
  console.log(
    `\n// ${name}: ${clean.length} points, ${Math.round(len)}m, ` +
      `extent ${Math.round(Math.max(...xs) - Math.min(...xs))}x${Math.round(Math.max(...zs) - Math.min(...zs))}, ` +
      `max grade ${(maxGrade * 100).toFixed(1)}% @${(gradeAt / clean.length).toFixed(2)}, ` +
      `tightest ~${Math.round(minR)}m @${(radiusAt / clean.length).toFixed(2)}, ` +
      `y ${r1(Math.min(...clean.map((p) => p.y)))}..${r1(Math.max(...clean.map((p) => p.y)))}`
  );
  for (const p of clean) {
    console.log(`      { x: ${r1(p.x)}, y: ${r1(p.y)}, z: ${r1(p.z)}, width: ${p.width} },`);
  }
  return clean;
}

/**
 * Walk a polyline and re-emit it at uniform spacing.
 *
 * For a loop the spacing is derived from the perimeter rather than fixed, so
 * the closing gap is exactly the same as every other gap. That is not tidiness:
 * Track runs Catmull-Rom through these points, and a closing segment shorter
 * than its neighbours makes the spline cusp — which shows up as a fifteen-metre
 * kink at the start line with the road quads folded inside out around it.
 */
export function resample(pts, spacing = 28, { loop = true } = {}) {
  const src = loop ? [...pts, pts[0]] : pts;
  let total = 0;
  for (let i = 1; i < src.length; i++) total += Math.hypot(src[i].x - src[i - 1].x, src[i].z - src[i - 1].z);
  const n = Math.max(4, Math.round(total / spacing));
  const step = total / (loop ? n : n - 1);

  const out = [];
  let seg = 1;
  let walked = 0;
  let segLen = Math.hypot(src[1].x - src[0].x, src[1].z - src[0].z);
  for (let k = 0; k < (loop ? n : n); k++) {
    const target = k * step;
    while (target > walked + segLen && seg < src.length - 1) {
      walked += segLen;
      seg++;
      segLen = Math.hypot(src[seg].x - src[seg - 1].x, src[seg].z - src[seg - 1].z);
    }
    const a = src[seg - 1];
    const b = src[seg];
    const f = segLen < 1e-6 ? 0 : (target - walked) / segLen;
    out.push({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      width: Math.round((a.width + (b.width - a.width) * f) * 10) / 10,
    });
  }
  return out;
}

/** ASCII plan view, so a shape can be eyeballed before it becomes a level. */
export function plot(pts, w = 74, h = 30) {
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const grid = Array.from({ length: h }, () => new Array(w).fill(' '));
  const ys = pts.map((p) => p.y);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ramp = '.:-=+*#%@';
  pts.forEach((p, i) => {
    const cx = Math.round(((p.x - x0) / Math.max(1, x1 - x0)) * (w - 1));
    const cz = Math.round(((p.z - z0) / Math.max(1, z1 - z0)) * (h - 1));
    const k = Math.round(((p.y - yMin) / Math.max(0.001, yMax - yMin)) * (ramp.length - 1));
    grid[h - 1 - cz][cx] = i === 0 ? 'S' : ramp[k];
  });
  console.log(grid.map((r) => '// ' + r.join('')).join('\n'));
  console.log(`// height ${yMin.toFixed(0)}..${yMax.toFixed(0)}m as ${ramp}`);
}

/**
 * Where does this route pass over itself? Reports every XZ crossing of two
 * non-adjacent segments with the height gap at the crossing — which is the
 * number that decides whether it reads as an overpass or as a bug.
 */
export function crossings(pts) {
  const n = pts.length;
  const out = [];
  const seg = (i) => [pts[i], pts[(i + 1) % n]];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b] = seg(i);
      const [c, d] = seg(j);
      const r = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
      if (Math.abs(r) < 1e-9) continue;
      const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / r;
      const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / r;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const y0 = a.y + (b.y - a.y) * t;
      const y1 = c.y + (d.y - c.y) * u;
      out.push({
        at: [Math.round(a.x + (b.x - a.x) * t), Math.round(a.z + (b.z - a.z) * t)],
        fracs: [Math.round((i / n) * 1000) / 1000, Math.round((j / n) * 1000) / 1000],
        gap: Math.round(Math.abs(y1 - y0) * 10) / 10,
      });
    }
  }
  for (const c of out) {
    console.log(`// crosses itself at ${c.at} — lap ${c.fracs[0]} over ${c.fracs[1]}, ${c.gap}m apart`);
  }
  if (out.length === 0) console.log('// no self-crossings');
  return out;
}

/**
 * A route as a chain of moves, each starting exactly where the last ended.
 *
 * This exists because every fold and kink in the first pass came from the same
 * mistake: a run and an arc that were *meant* to meet, authored as independent
 * coordinates, and off by fifteen metres and forty degrees. Catmull-Rom turns
 * that into a loop of road, and the road turns inside out.
 *
 *   route(start, [
 *     ['run', { x, z, y, width, n, bow, ease }],
 *     ['arc', { cx, cz, to, dir: 'cw'|'ccw', y, width, step, ease }],
 *   ])
 *
 * `arc` takes its radius and its start angle from wherever the chain currently
 * is, so a corner can only ever be tangent to what came before it.
 */
export function route(start, moves) {
  const D = Math.PI / 180;
  const out = [{ ...start }];
  const here = () => out[out.length - 1];
  for (const [kind, m] of moves) {
    const a = here();
    if (kind === 'run') {
      const b = { x: m.x, z: m.z, y: m.y ?? a.y, width: m.width ?? a.width };
      const n = m.n ?? Math.max(2, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 60));
      out.push(...run(a, b, n, b.width, { bow: m.bow ?? 0, ease: m.ease }).slice(1));
    } else if (kind === 'arc') {
      const r = Math.hypot(a.x - m.cx, a.z - m.cz);
      let from = Math.atan2(a.z - m.cz, a.x - m.cx) / D;
      // `sweep` is how far to turn (signed degrees, and it may exceed 360 — a
      // spiral is just an arc that keeps going); `to` is where to stop, taken
      // the short way round in the requested direction.
      let to;
      if (m.sweep != null) {
        to = from + m.sweep;
      } else {
        to = m.to;
        if (m.dir === 'cw') while (to > from) to -= 360;
        else while (to < from) to += 360;
      }
      out.push(
        ...spiral({
          cx: m.cx,
          cz: m.cz,
          r0: r,
          from,
          to,
          y0: a.y,
          y1: m.y ?? a.y,
          step: m.step ?? 18,
          width: m.width ?? a.width,
          ease: m.ease,
        }).slice(1)
      );
    }
  }
  return out;
}

/** Lap fraction of the point nearest (x, z) — for placing patches and gaps. */
export function at(pts, x, z) {
  let best = Infinity;
  let k = 0;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) {
      best = d;
      k = i;
    }
  });
  return Math.round((k / pts.length) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// THE ROUTES THEMSELVES
// ---------------------------------------------------------------------------

const which = process.argv[2] || 'all';
const want = (n) => which === 'all' || which === n;
const show = (name, pts, { deckAbove = null, marks = {} } = {}) => {
  const clean = emit(name, resample(pts, 28));
  const where = Object.entries(marks).map(([k, [x, z]]) => `${k} ${at(clean, x, z)}`);
  if (where.length) console.log('// waypoints: ' + where.join(', '));
  if (process.env.PLOT) plot(clean);
  if (deckAbove != null) {
    crossings(clean);
    const n = clean.length;
    const hi = clean.map((p, i) => [i / n, p.y]).filter(([, y]) => y > deckAbove);
    console.log(`// elevated ≈ ${hi[0]?.[0].toFixed(3)} … ${hi.at(-1)?.[0].toFixed(3)}`);
  }
  return clean;
};

// ---------------------------------------------------------------------------
// L4 — TAŞOCAĞI. Floor → hairpin → bench → rim → hairpin → plunge.
if (want('4'))
  show(
    'level4 quarry',
    route({ x: -240, y: -12, z: -192, width: 15 }, [
      ['run', { x: 190, z: -192, y: -8, n: 6 }],
      // Hairpin 1: right, tight, climbing out of the floor.
      ['arc', { cx: 190, cz: -140, to: 90, dir: 'ccw', y: 4, width: 12, step: 16, ease: 'linear' }],
      // West along the middle bench, climbing all the way.
      ['run', { x: -170, z: -60, y: 22, width: 13, n: 6, ease: 'linear' }],
      // Right, round the head of the pit and out onto the rim.
      ['arc', { cx: -170, cz: 62, to: 104, dir: 'cw', y: 34, width: 13, step: 16, ease: 'linear' }],
      // The rim: fast, flat, and the only place to overtake.
      ['run', { x: 170, z: 190, y: 31, width: 14, n: 5 }],
      // Hairpin 2: left, on the loose stuff at the top of the plunge.
      ['arc', { cx: 196, cz: 120, to: -100, dir: 'cw', y: 22, width: 12, step: 16, ease: 'linear' }],
      // THE PLUNGE — back down to the floor, blind over the crest.
      ['run', { x: -240, z: -60, y: -12, width: 14, n: 7, bow: -60, ease: 'linear' }],
      // …and the hairpin at the west end that puts you back on the floor.
      ['arc', { cx: -240, cz: -126, to: 270, dir: 'ccw', width: 15, step: 16 }],
    ]),
    { marks: { hairpin1: [190, -140], rim: [0, 190], hairpin2: [196, 120], plunge: [-40, 60], floor: [-100, -192] } }
  );

// ---------------------------------------------------------------------------
// L5 — GÖL KIYISI. The long straight, the chicane, and a lap of the lake.
if (want('5'))
  show(
    'level5 lake',
    route({ x: 300, y: 2, z: -190, width: 17 }, [
      ['run', { x: 306, z: 170, y: 6, n: 6 }],
      ['arc', { cx: 176, cz: 170, to: 100, dir: 'ccw', y: 11, width: 16, step: 16 }],
      // The chicane, on the far shore, where the water stands.
      ['run', { x: -54, z: 262, y: 11, width: 14, n: 3, bow: 26 }],
      ['run', { x: -196, z: 258, y: 8, width: 15, n: 3, bow: -22 }],
      // Long left down the west side of the lake.
      ['arc', { cx: -186, cz: 66, to: 248, dir: 'ccw', y: -4, width: 16, step: 16 }],
      // …and the run home along the bottom.
      ['run', { x: 190, z: -300, y: 0, width: 16, n: 6, bow: 46 }],
      ['arc', { cx: 190, cz: -190, to: 0, dir: 'ccw', y: 2, width: 16, step: 16 }],
    ]),
    { marks: { straight: [300, 0], headOfLake: [176, 300], chicane: [-120, 285], westSweep: [-380, 66], bottom: [0, -290] } }
  );

// ---------------------------------------------------------------------------
// L6 — VİYADÜK. Ramp, crossing, and a spiral down through its own shadow.
if (want('6'))
  show(
    'level6 viaduct',
    route({ x: -250, y: 0, z: -250, width: 16 }, [
      ['run', { x: 150, z: -250, y: 6, n: 5 }],
      ['arc', { cx: 150, cz: -160, to: 0, dir: 'ccw', y: 14, width: 15, step: 16 }],
      // THE RAMP, climbing north out of the forest.
      ['run', { x: 252, z: 60, y: 38, width: 14, n: 6, ease: 'linear' }],
      // THE CROSSING, level, over the gorge.
      ['run', { x: 120, z: 214, y: 38, width: 14, n: 4 }],
      // THE SPIRAL: one and a quarter turns down, under itself twice.
      ['arc', { cx: 58, cz: 214, sweep: 450, y: 2, width: 13, step: 20, ease: 'linear' }],
      // Out at the bottom, on the earth, running west.
      ['run', { x: -170, z: 244, y: 6, width: 15, n: 5 }],
      // The long left back down to the line.
      ['arc', { cx: -186, cz: -20, to: 206, dir: 'ccw', y: 0, width: 16, step: 18 }],
    ]),
    { deckAbove: 12 }
  );

// ---------------------------------------------------------------------------
// L7 — KAR HATTI. Esses on a plateau; the ice is in the shaded corners.
if (want('7'))
  show(
    'level7 snow',
    route({ x: 250, y: 20, z: -40, width: 15 }, [
      ['arc', { cx: 40, cz: -40, to: 62, dir: 'ccw', y: 30, width: 14, step: 22 }],
      ['run', { x: -30, z: 210, y: 26, width: 14, n: 3, bow: -30 }],
      ['arc', { cx: -60, cz: 60, to: 168, dir: 'ccw', y: 10, width: 15, step: 20 }],
      ['run', { x: -230, z: -80, y: 0, width: 14, n: 3, bow: 34 }],
      ['arc', { cx: -30, cz: -80, to: 262, dir: 'ccw', y: -10, width: 15, step: 20 }],
      ['run', { x: 150, z: -230, y: 4, width: 14, n: 3, bow: -26 }],
      ['arc', { cx: 60, cz: -70, to: -14, dir: 'ccw', y: 20, width: 15, step: 20 }],
    ]),
    { marks: { northEsse: [-30, 210], westDescent: [-230, -80], southEsse: [150, -230], climb: [250, -40] } }
  );

// ---------------------------------------------------------------------------
// L8 — KAPAK. The one that breaks: unsealed, unlit in one place, and wet.
// The corner after the cutting is the whole level: 120m of radius, taken in
// the dark, on clay, at a speed that was correct three seconds earlier.
if (want('8'))
  show(
    'level8 kapak',
    route({ x: 300, y: 0, z: 0, width: 14 }, [
      ['arc', { cx: 20, cz: 0, to: 68, dir: 'ccw', y: 8, width: 13, step: 20 }],
      ['run', { x: -60, z: 300, y: 6, width: 14, n: 3, bow: -30 }],
      ['arc', { cx: -60, cz: 170, to: 180, dir: 'ccw', y: 2, width: 13, step: 16 }],
      // THE CUTTING: straight, downhill, and the rig runs out halfway along it.
      ['run', { x: -232, z: -24, y: -8, width: 14, n: 4 }],
      // THE TRAP: a long left with clay through it.
      ['arc', { cx: -118, cz: -74, to: 302, dir: 'ccw', y: -6, width: 14, step: 14 }],
      ['run', { x: 180, z: -232, y: 0, width: 16, n: 3, bow: 26 }],
      ['arc', { cx: 116, cz: -76, to: 0, dir: 'ccw', y: 0, width: 14, step: 18 }],
    ]),
    { marks: { cuttingStart: [-140, 90], cuttingEnd: [-232, -24], trapApex: [-190, -140], bottom: [0, -250], line: [300, 0] } }
  );

// ---------------------------------------------------------------------------
// L9 — HAVAİ HAT. Up, out over the trees, across your own road, and down.
if (want('9'))
  show(
    'level9 skyway',
    route({ x: -250, y: 0, z: -256, width: 16 }, [
      ['run', { x: 170, z: -230, y: 4, n: 5 }],
      // Left onto the ramp, climbing out of the forest.
      ['arc', { cx: 170, cz: -120, to: 20, dir: 'ccw', y: 24, width: 14, step: 16, ease: 'linear' }],
      // THE CROSSING — straight over the road you come home on.
      ['run', { x: 60, z: 240, y: 42, width: 13, n: 5, ease: 'linear' }],
      // The helix down: five sixths of a turn, thirty-two metres.
      ['arc', { cx: 131, cz: 287, sweep: -303, y: 10, width: 13, step: 16, ease: 'linear' }],
      // Back on the earth, running west UNDER the deck you were just on.
      ['run', { x: -250, z: 196, y: 6, width: 16, n: 5 }],
      // The long fast sweeper down the west side, back to the line.
      ['arc', { cx: -250, cz: -30, to: 270, dir: 'ccw', y: 0, width: 16, step: 18 }],
    ]),
    { deckAbove: 14 }
  );

// ---------------------------------------------------------------------------
// L10 — SON HALKA. Everything the other nine taught you, in the dark.
if (want('10'))
  show(
    'level10 last',
    route({ x: -164, y: 0, z: -260, width: 15 }, [
      ['run', { x: 180, z: -284, y: 10, n: 5 }],
      ['arc', { cx: 180, cz: -170, to: 10, dir: 'ccw', y: 26, width: 14, step: 16, ease: 'linear' }],
      // The bridge over the gully.
      ['run', { x: 250, z: 60, y: 26, width: 13, n: 4 }],
      // Fast left along the top, into the ice.
      ['arc', { cx: 96, cz: 74, to: 108, dir: 'ccw', y: 16, width: 14, step: 18 }],
      ['run', { x: -110, z: 246, y: 12, width: 13, n: 3, bow: 18 }],
      // The long left at the far end.
      ['arc', { cx: -120, cz: 150, to: 190, dir: 'ccw', y: 6, width: 12, step: 16 }],
      // …and the plunge home in the dark.
      ['run', { x: -244, z: -180, y: 0, width: 15, n: 5 }],
      ['arc', { cx: -164, cz: -180, to: 270, dir: 'ccw', width: 15, step: 16 }],
    ]),
    { deckAbove: 22 }
  );
