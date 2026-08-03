/**
 * PROPS — the things that fill the forest.
 *
 * Each factory returns one small BufferGeometry in local space with its origin
 * at ground level. They are drawn as InstancedMeshes, so a variant costs one
 * draw call no matter how many of it exist. A handful of variants plus
 * per-instance scale, rotation and tint is enough to stop a forest of 4000
 * trees looking like a wallpaper.
 *
 * Poly budgets are intentionally tiny — a pine is about 40 triangles.
 */

import * as THREE from 'three';
import { GeomBuilder, shade } from '../render/geometry.js';
import { Rng } from '../core/rng.js';

/** @typedef {{geometry: THREE.BufferGeometry, collider: object|null, tag: string}} Prop */

const V0 = { x: 0, y: 0, z: 0 };

/** Conifer: the backbone of the forest. */
export function createPine(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const height = rng.range(7, 13) * scaleHint;
  const trunkH = height * rng.range(0.2, 0.3);
  const trunkR = height * 0.035;

  b.addCylinder({ x: 0, y: trunkH / 2, z: 0 }, trunkR * 1.25, trunkR, trunkH, 5, {
    side: F.trunk,
    top: shade(F.trunk, 0.08),
  });

  const tiers = rng.int(3, 4);
  const canopyH = height - trunkH;
  const shades = [F.canopyA, F.canopyB, F.canopyC];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = trunkH + canopyH * t * 0.72;
    const r = height * 0.26 * (1 - t * 0.62);
    const h = canopyH * (0.46 - t * 0.06);
    b.addCone({ x: 0, y, z: 0 }, r, h, 6, {
      side: shades[i % shades.length],
      bottom: shade(shades[i % shades.length], -0.06),
    }, rng.range(0, 1));
  }

  return {
    geometry: b.build(),
    collider: { type: 'cylinder', radius: trunkR * 3.2, height: height * 0.9, yOffset: height * 0.45, blocksSight: true },
    tag: 'pine',
    height,
    /** Local Y where the trunk stops and the canopy starts. See world/trees.js:
     *  a tree that comes down on a car is worn as canopy only. */
    canopyY: trunkH,
  };
}

/** Rounder, lighter tree — used to break up the conifer rhythm. */
export function createBroadleaf(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const height = rng.range(6, 10) * scaleHint;
  const trunkH = height * rng.range(0.34, 0.44);
  const trunkR = height * 0.045;

  b.addCylinder({ x: 0, y: trunkH / 2, z: 0 }, trunkR * 1.3, trunkR * 0.85, trunkH, 5, {
    side: F.trunk,
    top: shade(F.trunk, 0.06),
  });

  // Canopy: two overlapping squashed cones, offset — asymmetry reads as organic.
  const canopyR = height * 0.3;
  const canopyY = trunkH * 0.92;
  const shadesA = rng.pick([F.canopyA, F.canopyB]);
  b.addFrustumBox(
    { x: 0, y: canopyY + canopyR * 0.55, z: 0 },
    { x: canopyR * 2, y: canopyR * 1.4, z: canopyR * 2 },
    { x: 0.55, z: 0.55 },
    { all: shadesA, top: shade(shadesA, 0.09), bottom: shade(shadesA, -0.1) },
    rng.range(0, Math.PI)
  );
  b.addFrustumBox(
    { x: canopyR * rng.range(-0.3, 0.3), y: canopyY + canopyR * 1.25, z: canopyR * rng.range(-0.3, 0.3) },
    { x: canopyR * 1.3, y: canopyR * 0.9, z: canopyR * 1.3 },
    { x: 0.4, z: 0.4 },
    { all: shade(shadesA, 0.05), top: shade(shadesA, 0.12) },
    rng.range(0, Math.PI)
  );

  return {
    geometry: b.build(),
    collider: { type: 'cylinder', radius: trunkR * 3.4, height: height * 0.8, yOffset: height * 0.4, blocksSight: true },
    tag: 'broadleaf',
    height,
    canopyY: canopyY * 0.92,
  };
}

/** Bare, forked, slightly wrong. Good for the world beyond the tracks. */
export function createDeadTree(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const height = rng.range(5, 9) * scaleHint;
  const trunkR = height * 0.04;
  const col = shade(F.trunk, -0.05);
  b.addCylinder({ x: 0, y: height / 2, z: 0 }, trunkR * 1.5, trunkR * 0.5, height, 5, { all: col });

  const branches = rng.int(2, 4);
  for (let i = 0; i < branches; i++) {
    const a = rng.range(0, Math.PI * 2);
    const y = height * rng.range(0.5, 0.9);
    const len = height * rng.range(0.16, 0.3);
    const dx = Math.cos(a) * len * 0.5;
    const dz = Math.sin(a) * len * 0.5;
    b.addFrustumBox(
      { x: dx, y: y + len * 0.22, z: dz },
      { x: trunkR * 1.4, y: len, z: trunkR * 1.4 },
      { x: 0.4, z: 0.4, offsetX: dx * 0.7, offsetZ: dz * 0.7 },
      { all: col }
    );
  }
  return {
    geometry: b.build(),
    collider: { type: 'cylinder', radius: trunkR * 3, height: height * 0.9, yOffset: height * 0.45, blocksSight: false },
    tag: 'dead',
    height,
    /** A dead tree is all trunk; "the top part" is the branchy upper half. */
    canopyY: height * 0.45,
  };
}

export function createRock(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const base = theme.props.rock;
  const size = rng.range(0.8, 3.4) * scaleHint;
  const lumps = rng.int(1, 3);
  for (let i = 0; i < lumps; i++) {
    const s = size * (i === 0 ? 1 : rng.range(0.4, 0.75));
    b.addFrustumBox(
      { x: rng.range(-0.4, 0.4) * size, y: s * 0.35, z: rng.range(-0.4, 0.4) * size },
      { x: s * 1.6, y: s * 0.9, z: s * 1.35 },
      { x: rng.range(0.45, 0.8), z: rng.range(0.45, 0.8) },
      {
        all: shade(base, rng.range(-0.06, 0.02)),
        top: shade(base, 0.08),
        bottom: shade(base, -0.12),
      },
      rng.range(0, Math.PI)
    );
  }
  return {
    geometry: b.build(),
    collider: size > 1.4
      ? { type: 'cylinder', radius: size * 0.8, height: size * 1.2, yOffset: size * 0.4, blocksSight: size > 2.2 }
      : null,
    tag: 'rock',
    height: size,
  };
}

export function createBush(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const size = rng.range(0.7, 1.9) * scaleHint;
  const lumps = rng.int(2, 3);
  for (let i = 0; i < lumps; i++) {
    const s = size * rng.range(0.6, 1);
    b.addFrustumBox(
      { x: rng.range(-0.5, 0.5) * size, y: s * 0.4, z: rng.range(-0.5, 0.5) * size },
      { x: s * 1.5, y: s * 0.85, z: s * 1.4 },
      { x: 0.55, z: 0.55 },
      { all: shade(F.bush, rng.range(-0.05, 0.05)), top: shade(F.bush, 0.1) },
      rng.range(0, Math.PI)
    );
  }
  // Bushes are scenery, not obstacles — you should be able to plough through.
  return { geometry: b.build(), collider: null, tag: 'bush', height: size };
}

/**
 * Grass tuft: a rosette of tapered, arching blades.
 *
 * This used to be two crossed quads standing straight up, which from a chase
 * camera is a green X on the floor — a decal, not a plant. What sells grass at
 * this poly count is the SILHOUETTE: several blades leaving one point at
 * different angles, each narrowing and bending over. Three triangles buys all
 * of that per blade (a quad for the stem, one triangle for the tip), and the
 * two pieces take different shades so the tuft has a dark root and a lit tip
 * without a single extra vertex.
 *
 * Everything starts at y = 0 because the wind shader bends by y² — see
 * `render/wind.js`. A blade whose base is above the origin would visibly slide.
 *
 * @param {object} [opts]
 * @param {number} [opts.blades] blades in the rosette; 3 is the far-band LOD
 */
export function createGrassTuft(theme, rng, scaleHint = 1, opts = null) {
  const b = new GeomBuilder();
  const c = theme.foliage.grassBlade;
  const blades = Math.max(1, Math.round(opts?.blades ?? 4));
  const h = rng.range(0.42, 0.85) * scaleHint;
  // Blades share the rosette evenly, then jitter — evenly spaced alone reads as
  // a fan, purely random leaves gaps you see as a bald patch.
  const step = (Math.PI * 2) / blades;
  const spin = rng.range(0, Math.PI * 2);
  let tallest = 0;

  for (let i = 0; i < blades; i++) {
    const a = spin + i * step + rng.range(-0.35, 0.35);
    const len = h * rng.range(0.7, 1.25);
    tallest = Math.max(tallest, len);
    const halfW = len * rng.range(0.045, 0.075);
    // Which way this blade arches, and how far it has fallen from vertical.
    const bend = len * rng.range(0.18, 0.5);
    const bx = Math.cos(a) * bend;
    const bz = Math.sin(a) * bend;
    // The blade's own plane, so the strip is not edge-on to its own arc.
    const px = -Math.sin(a) * halfW;
    const pz = Math.cos(a) * halfW;

    const midY = len * 0.55;
    const tone = rng.range(-0.06, 0.06);
    const root = shade(c, tone - 0.07);
    const tip = shade(c, tone + 0.09);

    // Stem: full width at the ground, three-fifths of it at mid height, already
    // leaning a third of the way into the arch.
    const mx = bx * 0.3;
    const mz = bz * 0.3;
    b.addQuad(
      new THREE.Vector3(-px, 0, -pz),
      new THREE.Vector3(px, 0, pz),
      new THREE.Vector3(mx + px * 0.6, midY, mz + pz * 0.6),
      new THREE.Vector3(mx - px * 0.6, midY, mz - pz * 0.6),
      root
    );
    // Tip: from mid width to a point, out at the end of the arch.
    b.addTriangle(
      new THREE.Vector3(mx - px * 0.6, midY, mz - pz * 0.6),
      new THREE.Vector3(mx + px * 0.6, midY, mz + pz * 0.6),
      new THREE.Vector3(bx, len, bz),
      tip
    );
  }

  return { geometry: b.build(), collider: null, tag: 'grass', height: tallest };
}

/**
 * Fern: a rosette of arching fronds.
 *
 * A frond is TWO triangles, arranged as a lance — pointed where it leaves the
 * crown, widest in the middle, pointed again at the tip. A rectangle costs the
 * same two triangles and reads as a strip of tape; the two points are the
 * entire difference between a fern and a flag. They arch outward and over,
 * because a frond held straight up is a blade of grass.
 */
export function createFern(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const fronds = rng.int(4, 6);
  const h = rng.range(0.5, 1.05) * scaleHint;
  const spin = rng.range(0, Math.PI * 2);
  const step = (Math.PI * 2) / fronds;

  for (let i = 0; i < fronds; i++) {
    const a = spin + i * step + rng.range(-0.3, 0.3);
    const len = h * rng.range(0.8, 1.2);
    const reach = len * rng.range(0.55, 0.95);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Across the frond, so the lance has width to be seen from the side.
    const halfW = len * rng.range(0.13, 0.2);
    const px = -sin * halfW;
    const pz = cos * halfW;
    // Mid-point is out and up; the tip is further out and has started to fall.
    const mx = cos * reach * 0.45;
    const mz = sin * reach * 0.45;
    const my = len * 0.62;
    const tx = cos * reach;
    const tz = sin * reach;
    const ty = len * rng.range(0.7, 0.95);

    const tone = rng.range(-0.05, 0.05);
    b.addTriangle(
      new THREE.Vector3(0, len * 0.1, 0),
      new THREE.Vector3(mx + px, my, mz + pz),
      new THREE.Vector3(mx - px, my, mz - pz),
      shade(F.fern, tone - 0.05)
    );
    b.addTriangle(
      new THREE.Vector3(mx - px, my, mz - pz),
      new THREE.Vector3(mx + px, my, mz + pz),
      new THREE.Vector3(tx, ty, tz),
      shade(F.fern, tone + 0.06)
    );
  }
  return { geometry: b.build(), collider: null, tag: 'fern', height: h };
}

/**
 * Undergrowth: the low broad-leaved stuff that fills the gaps between ferns.
 *
 * Four flat leaves lying almost horizontally, which is what makes it read as a
 * different plant to the fern standing next to it rather than a smaller one.
 * Nothing under a canopy grows tall; it grows sideways, at the light.
 */
export function createUndergrowth(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const leaves = rng.int(3, 5);
  const size = rng.range(0.35, 0.8) * scaleHint;
  const spin = rng.range(0, Math.PI * 2);
  const step = (Math.PI * 2) / leaves;
  const base = rng.bool(0.35) ? F.bush : F.fern;

  for (let i = 0; i < leaves; i++) {
    const a = spin + i * step + rng.range(-0.4, 0.4);
    const len = size * rng.range(0.85, 1.3);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const w = len * rng.range(0.3, 0.45);
    // Almost flat, tipped just enough to catch a different shade of light.
    const lift = size * rng.range(0.12, 0.34);
    const stem = size * 0.14;
    b.addQuad(
      new THREE.Vector3(-sin * stem * 0.5, stem, cos * stem * 0.5),
      new THREE.Vector3(sin * stem * 0.5, stem, -cos * stem * 0.5),
      new THREE.Vector3(cos * len + sin * w, lift, sin * len - cos * w),
      new THREE.Vector3(cos * len - sin * w, lift, sin * len + cos * w),
      shade(base, rng.range(-0.06, 0.08))
    );
  }
  return { geometry: b.build(), collider: null, tag: 'undergrowth', height: size * 0.4 };
}

/**
 * Leaf litter and twigs — the forest floor itself.
 *
 * A handful of small quads lying nearly flat, plus a couple of sticks. Kept
 * DELIBERATELY SMALL, under half a metre across, and lifted a little clear of
 * the origin. `Scatter` sinks every prop 8cm and does not tilt anything to the
 * ground, so a wide flat patch on a slope has one edge in the air and the other
 * buried. A small patch sinks a centimetre at worst, and leaves that are half
 * in the soil are leaves.
 */
export function createLitter(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const F = theme.foliage;
  const spread = rng.range(0.3, 0.45) * scaleHint;
  const pieces = rng.int(2, 4);

  for (let i = 0; i < pieces; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = spread * rng.range(0.1, 1);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = 0.13 + rng.range(0, 0.09);
    const w = spread * rng.range(0.35, 0.65);
    const l = w * rng.range(1.1, 1.9);
    const t = rng.range(0, Math.PI);
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    // A leaf: a long quad, tipped a few degrees so a whole patch is not one
    // perfectly level plane. The tip only ever goes UP — a downward corner puts
    // that end of the leaf under the ground, which is the whole reason the
    // lowest point of this geometry has to clear the sink.
    const tip = rng.range(0, 0.05);
    b.addQuadFacing(
      new THREE.Vector3(cx - cos * l - sin * w, y, cz - sin * l + cos * w),
      new THREE.Vector3(cx + cos * l - sin * w, y + tip, cz + sin * l + cos * w),
      new THREE.Vector3(cx + cos * l + sin * w, y + tip, cz + sin * l - cos * w),
      new THREE.Vector3(cx - cos * l + sin * w, y, cz - sin * l - cos * w),
      shade(F.litter, rng.range(-0.1, 0.1))
    );
  }
  // One twig, always. It is the thing that says "floor" rather than "carpet".
  {
    const a = rng.range(0, Math.PI * 2);
    const len = spread * rng.range(1.4, 2.4);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const w = spread * 0.06;
    b.addQuadFacing(
      new THREE.Vector3(-cos * len - sin * w, 0.13, -sin * len + cos * w),
      new THREE.Vector3(cos * len - sin * w, 0.16, sin * len + cos * w),
      new THREE.Vector3(cos * len + sin * w, 0.16, sin * len - cos * w),
      new THREE.Vector3(-cos * len + sin * w, 0.13, -sin * len - cos * w),
      shade(F.trunk, rng.range(-0.04, 0.06))
    );
  }
  return { geometry: b.build(), collider: null, tag: 'litter', height: 0.2 };
}

/** A felled log — reads as "someone worked here", which the empty world needs. */
export function createLog(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const len = rng.range(3, 6.5) * scaleHint;
  const r = rng.range(0.25, 0.45) * scaleHint;
  b.addCylinder({ x: 0, y: r, z: 0 }, r, r * 0.92, len, 6, {
    side: theme.foliage.trunk,
    top: shade(theme.foliage.trunk, 0.15),
    bottom: shade(theme.foliage.trunk, 0.15),
  }, 'z');
  return {
    geometry: b.build(),
    collider: { type: 'box', halfX: r, halfY: r, halfZ: len / 2, yOffset: r, blocksSight: false },
    tag: 'log',
    height: r * 2,
  };
}

/** Roadside marker post — the game's furniture, and a speed reference. */
export function createMarkerPost(theme, rng) {
  const b = new GeomBuilder();
  const h = 1.05;
  b.addBox({ x: 0, y: h / 2, z: 0 }, { x: 0.13, y: h, z: 0.13 }, {
    all: theme.props.barrier,
    top: 0xe8e4cc,
  });
  b.addBox({ x: 0, y: h * 0.86, z: 0.075 }, { x: 0.1, y: 0.17, z: 0.02 }, 0xc44a3a);
  return { geometry: b.build(), collider: null, tag: 'post', height: h };
}

/**
 * A signpost with no text on it. Out in the open world these are everywhere and
 * all of them are blank — the world was never meant to be read this closely.
 */
export function createBlankSign(theme, rng) {
  const b = new GeomBuilder();
  const h = rng.range(2.1, 2.8);
  b.addBox({ x: 0, y: h / 2, z: 0 }, { x: 0.12, y: h, z: 0.12 }, theme.props.post);
  b.addBox({ x: 0, y: h, z: 0 }, { x: 1.5, y: 0.85, z: 0.08 }, {
    all: theme.props.sign,
    front: shade(theme.props.sign, 0.06),
  });
  return {
    geometry: b.build(),
    collider: { type: 'cylinder', radius: 0.3, height: h, yOffset: h / 2, blocksSight: false },
    tag: 'sign',
    height: h,
  };
}

/** Every prop factory, keyed by name, for data-driven scattering. */
/**
 * A missing-person poster stapled to a stake.
 *
 * Deliberately unreadable at 40 poly — a pale sheet with a dark rectangle where
 * a face would be. The player never gets to find out who is missing, which is
 * the point: somebody put these up, in a forest, for somebody who left.
 */
export function createPoster(theme, rng) {
  const b = new GeomBuilder();
  const P = theme.props;
  const h = rng.range(1.5, 2.1);
  const lean = rng.range(-0.06, 0.06);

  b.addBox({ x: 0, y: h / 2, z: 0 }, { x: 0.08, y: h, z: 0.08 }, P.post, lean);

  // The sheet. Weathered ones have curled and gone grey.
  const age = rng.next();
  const paper = shade(P.paper, -age * 0.18);
  const w = rng.range(0.42, 0.54);
  b.addBox({ x: 0, y: h - w * 0.55, z: 0.05 }, { x: w, y: w * 1.35, z: 0.03 }, {
    all: paper,
    front: shade(paper, 0.05),
  }, lean);
  // The photograph, and a line of text under it.
  b.addBox({ x: 0, y: h - w * 0.45, z: 0.07 }, { x: w * 0.6, y: w * 0.6, z: 0.02 }, P.paperInk, lean);
  b.addBox({ x: 0, y: h - w * 1.0, z: 0.07 }, { x: w * 0.7, y: w * 0.08, z: 0.02 }, P.paperInk, lean);

  return { geometry: b.build(), collider: null, tag: 'poster', height: h };
}

/**
 * A car that has been in this forest a very long time.
 *
 * Same silhouette as the ones still being raced, minus the glass, minus a
 * wheel, plus a decade. It IS solid — the one thing in this list you can crash
 * into — because a car-sized lump of steel you drive through reads as a bug.
 */
export function createWreck(theme, rng) {
  const b = new GeomBuilder();
  const P = theme.props;
  const V = theme.vehicles;

  const len = rng.range(3.6, 4.4);
  const wid = rng.range(1.6, 1.9);
  // Whatever it was painted, it is mostly rust now. Weighted hard toward brown:
  // `shade` only moves lightness, so a factory yellow stays recognisably yellow
  // no matter how far it is darkened, and a bright wreck reads as a parked car.
  const base = rng.next() < 0.62 ? rng.pick([P.rust, P.rustDark]) : rng.pick([...V.rivals, V.player]);
  const paint = shade(base, rng.range(-0.15, -0.03));
  const rust = shade(P.rust, rng.range(-0.08, 0.08));
  // Settled into the ground at an angle, on whatever corners still have a wheel.
  const tilt = rng.range(-0.09, 0.09);

  // Lower body, sagging.
  b.addFrustumBox(
    { x: 0, y: 0.42, z: 0 },
    { x: wid, y: 0.62, z: len },
    { x: 0.94, z: 0.9 },
    { all: paint, top: shade(paint, 0.05), bottom: rust },
    tilt
  );
  // Cabin, roof caved in.
  b.addFrustumBox(
    { x: 0, y: 0.92, z: -len * 0.06 },
    { x: wid * 0.86, y: 0.44, z: len * 0.44 },
    { x: 0.7, z: 0.66 },
    { all: rust, top: shade(rust, -0.12) },
    tilt
  );
  // Three wheels. The fourth is the joke.
  const missing = rng.int(0, 3);
  const wx = wid * 0.46;
  const wz = len * 0.32;
  const corners = [
    { x: -wx, z: wz },
    { x: wx, z: wz },
    { x: -wx, z: -wz },
    { x: wx, z: -wz },
  ];
  for (let i = 0; i < corners.length; i++) {
    if (i === missing) continue;
    b.addCylinder({ x: corners[i].x, y: 0.26, z: corners[i].z }, 0.28, 0.28, 0.2, 6, {
      all: shade(V.tyre, rng.range(-0.02, 0.04)),
    }, 'x');
  }

  return {
    geometry: b.build(),
    collider: {
      type: 'box',
      halfX: wid * 0.5,
      halfY: 0.6,
      halfZ: len * 0.5,
      yOffset: 0.5,
      blocksSight: true,
    },
    tag: 'wreck',
    height: 1.3,
  };
}

// ---------------------------------------------------------------------------
// ANIMALS
// ---------------------------------------------------------------------------
// Geometry only. What they DO lives in `world/wildlife.js`, which moves them
// around the camera. None of them has a collider — you drive through a
// butterfly, and the cat was never really there.
//
// All four face local +Z, which is the convention `wildlife.js` steers by.

/**
 * A cat, at about twelve triangles.
 *
 * Note the sizes here and below are generous — a real cat is 25cm at the
 * shoulder, which from a chase camera eight metres back is three pixels and
 * therefore nothing at all. Everything alive is drawn nearer half again to
 * life size so it registers as an animal rather than as dirt on the screen.
 */
export function createCat(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const A = theme.animals;
  const s = rng.range(0.42, 0.55) * scaleHint;
  const fur = rng.next() < 0.45 ? A.catAlt : A.cat;
  const body = shade(fur, rng.range(-0.05, 0.05));

  b.addFrustumBox({ x: 0, y: s * 0.9, z: 0 }, { x: s * 0.72, y: s * 0.8, z: s * 1.7 }, { x: 0.85, z: 0.8 }, {
    all: body,
    top: shade(body, 0.07),
  });
  // Head, forward and up.
  b.addBox({ x: 0, y: s * 1.35, z: s * 0.78 }, { x: s * 0.56, y: s * 0.5, z: s * 0.5 }, {
    all: shade(body, 0.04),
  });
  // Ears.
  b.addCone({ x: -s * 0.17, y: s * 1.6, z: s * 0.78 }, s * 0.13, s * 0.22, 4, { all: shade(body, -0.1) });
  b.addCone({ x: s * 0.17, y: s * 1.6, z: s * 0.78 }, s * 0.13, s * 0.22, 4, { all: shade(body, -0.1) });
  // Tail, up like a question mark.
  b.addCylinder({ x: 0, y: s * 1.25, z: -s * 0.95 }, s * 0.09, s * 0.06, s * 1.0, 4, {
    all: shade(body, -0.06),
  });
  // Legs.
  for (const lx of [-s * 0.26, s * 0.26]) {
    for (const lz of [s * 0.5, -s * 0.5]) {
      b.addBox({ x: lx, y: s * 0.28, z: lz }, { x: s * 0.16, y: s * 0.56, z: s * 0.16 }, shade(body, -0.12));
    }
  }
  return { geometry: b.build(), collider: null, tag: 'cat', height: s * 1.7 };
}

/** A fox: longer, lower, and the tail is most of it. */
export function createFox(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const A = theme.animals;
  const s = rng.range(0.5, 0.64) * scaleHint;
  const coat = shade(A.fox, rng.range(-0.06, 0.06));

  b.addFrustumBox({ x: 0, y: s * 0.85, z: 0 }, { x: s * 0.66, y: s * 0.68, z: s * 2.1 }, { x: 0.9, z: 0.78 }, {
    all: coat,
    top: shade(coat, 0.06),
    bottom: shade(A.foxTail, -0.15),
  });
  // Long muzzle.
  b.addFrustumBox({ x: 0, y: s * 1.15, z: s * 1.05 }, { x: s * 0.46, y: s * 0.42, z: s * 0.7 }, { x: 0.45, z: 0.5 }, {
    all: shade(coat, 0.03),
  });
  b.addCone({ x: -s * 0.16, y: s * 1.42, z: s * 0.86 }, s * 0.13, s * 0.28, 4, { all: shade(coat, -0.16) });
  b.addCone({ x: s * 0.16, y: s * 1.42, z: s * 0.86 }, s * 0.13, s * 0.28, 4, { all: shade(coat, -0.16) });
  // Brush, white-tipped, held low and straight out behind.
  b.addFrustumBox({ x: 0, y: s * 0.78, z: -s * 1.5 }, { x: s * 0.42, y: s * 0.42, z: s * 1.2 }, { x: 0.5, z: 0.45 }, {
    all: shade(coat, -0.04),
    front: A.foxTail,
  });
  for (const lx of [-s * 0.24, s * 0.24]) {
    for (const lz of [s * 0.62, -s * 0.58]) {
      b.addBox({ x: lx, y: s * 0.26, z: lz }, { x: s * 0.14, y: s * 0.52, z: s * 0.14 }, shade(coat, -0.28));
    }
  }
  return { geometry: b.build(), collider: null, tag: 'fox', height: s * 1.6 };
}

/** A bird, seen from below and a long way off: two wings and a body. */
export function createBird(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const A = theme.animals;
  const s = rng.range(0.95, 1.5) * scaleHint;
  const feather = rng.next() < 0.4 ? A.birdAlt : A.bird;
  const col = shade(feather, rng.range(-0.05, 0.05));

  b.addFrustumBox({ x: 0, y: 0, z: 0 }, { x: s * 0.3, y: s * 0.26, z: s * 1.1 }, { x: 0.35, z: 0.3 }, {
    all: col,
    top: shade(col, 0.08),
  });
  // Swept wings, angled up slightly so they catch the light differently.
  const span = s * 1.5;
  for (const dir of [-1, 1]) {
    b.addTriangle(
      { x: 0, y: 0, z: s * 0.28 },
      { x: dir * span, y: s * 0.16, z: -s * 0.3 },
      { x: 0, y: 0, z: -s * 0.42 },
      shade(col, dir > 0 ? 0.05 : -0.05)
    );
    b.addTriangle(
      { x: 0, y: 0, z: -s * 0.42 },
      { x: dir * span, y: s * 0.16, z: -s * 0.3 },
      { x: 0, y: 0, z: s * 0.28 },
      shade(col, dir > 0 ? -0.02 : 0.02)
    );
  }
  return { geometry: b.build(), collider: null, tag: 'bird', height: s * 0.3 };
}

/** Four triangles and a crumb of body. Sold entirely by how it moves. */
export function createButterfly(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const A = theme.animals;
  const s = rng.range(0.3, 0.46) * scaleHint;
  const wing = rng.next() < 0.5 ? A.butterfly : A.butterflyAlt;
  const col = shade(wing, rng.range(-0.08, 0.08));

  b.addBox({ x: 0, y: 0, z: 0 }, { x: s * 0.16, y: s * 0.16, z: s * 0.9 }, shade(col, -0.5));
  for (const dir of [-1, 1]) {
    // Fore and hind wing, held in a shallow V.
    b.addTriangle(
      { x: 0, y: 0, z: s * 0.35 },
      { x: dir * s * 1.15, y: s * 0.5, z: s * 0.5 },
      { x: dir * s * 0.9, y: s * 0.45, z: -s * 0.35 },
      col
    );
    b.addTriangle(
      { x: 0, y: 0, z: -s * 0.1 },
      { x: dir * s * 0.9, y: s * 0.45, z: -s * 0.35 },
      { x: dir * s * 0.7, y: s * 0.38, z: -s * 0.8 },
      shade(col, -0.12)
    );
  }
  return { geometry: b.build(), collider: null, tag: 'butterfly', height: s };
}

export const PROP_FACTORIES = {
  pine: createPine,
  broadleaf: createBroadleaf,
  dead: createDeadTree,
  rock: createRock,
  bush: createBush,
  fern: createFern,
  undergrowth: createUndergrowth,
  litter: createLitter,
  grass: createGrassTuft,
  log: createLog,
  post: createMarkerPost,
  sign: createBlankSign,
  poster: createPoster,
  wreck: createWreck,
  cat: createCat,
  fox: createFox,
  bird: createBird,
  butterfly: createButterfly,
};

/**
 * Pre-build `count` variants of a prop type so instancing has something to
 * choose between.
 * @param {object} [opts] passed through to the factory — how a caller asks for
 *   a cheaper or denser build of the same prop without props.js reading config
 * @returns {Prop[]}
 */
export function buildVariants(kind, theme, seed, count = 4, scaleHint = 1, opts = null) {
  const factory = PROP_FACTORIES[kind];
  if (!factory) throw new Error(`Unknown prop kind "${kind}"`);
  const rng = new Rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(factory(theme, rng, scaleHint, opts));
  return out;
}
