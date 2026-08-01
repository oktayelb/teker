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

/** Grass tuft: two crossed blades. Cheap ground texture at low draw cost. */
export function createGrassTuft(theme, rng, scaleHint = 1) {
  const b = new GeomBuilder();
  const c = theme.foliage.grassBlade;
  const h = rng.range(0.4, 0.9) * scaleHint;
  const w = h * 0.55;
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI * 0.5 + rng.range(0, 0.6);
    const dx = Math.cos(a) * w;
    const dz = Math.sin(a) * w;
    b.addQuad(
      new THREE.Vector3(-dx, 0, -dz),
      new THREE.Vector3(dx, 0, dz),
      new THREE.Vector3(dx, h, dz),
      new THREE.Vector3(-dx, h, -dz),
      shade(c, rng.range(-0.05, 0.08))
    );
  }
  return { geometry: b.build(), collider: null, tag: 'grass', height: h };
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
export const PROP_FACTORIES = {
  pine: createPine,
  broadleaf: createBroadleaf,
  dead: createDeadTree,
  rock: createRock,
  bush: createBush,
  grass: createGrassTuft,
  log: createLog,
  post: createMarkerPost,
  sign: createBlankSign,
};

/**
 * Pre-build `count` variants of a prop type so instancing has something to
 * choose between.
 * @returns {Prop[]}
 */
export function buildVariants(kind, theme, seed, count = 4, scaleHint = 1) {
  const factory = PROP_FACTORIES[kind];
  if (!factory) throw new Error(`Unknown prop kind "${kind}"`);
  const rng = new Rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(factory(theme, rng, scaleHint));
  return out;
}
