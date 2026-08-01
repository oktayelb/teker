/**
 * GEOMETRY — a tiny non-indexed mesh builder with per-face colours.
 *
 * Everything in the game (terrain, trees, cars, signs) is assembled from this.
 * Non-indexed is deliberate: each triangle owns its three vertices, so a face
 * can have one flat colour and one flat normal. That is exactly the faceted,
 * vertex-coloured look of the era, and it means one material can draw the whole
 * world.
 *
 * Colours go in as `0xrrggbb`. They are converted to linear-space floats on the
 * way in, because that is what the renderer's colour management expects.
 */

import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Cache of hex → linear rgb triple, since we convert millions of these. */
const _colorCache = new Map();
function linearRgb(hex) {
  let v = _colorCache.get(hex);
  if (!v) {
    _c.set(hex); // THREE.Color.set() converts sRGB → working (linear) space
    v = [_c.r, _c.g, _c.b];
    _colorCache.set(hex, v);
  }
  return v;
}

export class GeomBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.uvs = [];
  }

  get triangleCount() {
    return this.positions.length / 9;
  }

  /** Counter-clockwise winding when viewed from the front face. */
  addTriangle(p0, p1, p2, color, uv) {
    _a.subVectors(p1, p0);
    _b.subVectors(p2, p0);
    _n.crossVectors(_a, _b).normalize();
    const [r, g, bl] = linearRgb(color);
    const P = this.positions;
    const N = this.normals;
    const C = this.colors;
    for (const p of [p0, p1, p2]) {
      P.push(p.x, p.y, p.z);
      N.push(_n.x, _n.y, _n.z);
      C.push(r, g, bl);
    }
    if (uv) this.uvs.push(...uv);
    else this.uvs.push(0, 0, 1, 0, 1, 1);
    return this;
  }

  /** Planar quad, wound p0→p1→p2→p3. */
  addQuad(p0, p1, p2, p3, color) {
    this.addTriangle(p0, p1, p2, color, [0, 0, 1, 0, 1, 1]);
    this.addTriangle(p0, p2, p3, color, [0, 0, 1, 1, 0, 1]);
    return this;
  }

  /**
   * A quad that is guaranteed to face `desiredNormal`, whichever way you happen
   * to have listed the corners.
   *
   * Winding is the easiest thing in the world to get backwards, and a
   * back-facing surface does not look broken — it looks *absent*, because you
   * see straight through it to whatever is behind. The entire road ribbon was
   * built inside-out exactly once, and it presented as "the tarmac is rendering
   * as grass". Use this for anything where you know which way the surface
   * should face, and the mistake becomes unmakeable.
   */
  addQuadFacing(p0, p1, p2, p3, color, desiredNormal = UP) {
    _a.subVectors(p1, p0);
    _b.subVectors(p2, p0);
    _n.crossVectors(_a, _b);
    if (_n.dot(desiredNormal) < 0) return this.addQuad(p0, p3, p2, p1, color);
    return this.addQuad(p0, p1, p2, p3, color);
  }

  /**
   * Axis-aligned box, optionally rotated about Y.
   * @param {{x,y,z}} center
   * @param {{x,y,z}} size full extents
   * @param {number|object} color a single colour, or `{ top, bottom, side, front, back }`
   */
  addBox(center, size, color, rotationY = 0) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);

    const p = (x, y, z) =>
      new THREE.Vector3(
        center.x + x * cos + z * sin,
        center.y + y,
        center.z + (-x * sin + z * cos)
      );

    const c = typeof color === 'number' ? { all: color } : color;
    const pick = (face) => c[face] ?? c.side ?? c.all ?? 0xffffff;

    // 8 corners
    const v000 = p(-hx, -hy, -hz);
    const v100 = p(hx, -hy, -hz);
    const v110 = p(hx, hy, -hz);
    const v010 = p(-hx, hy, -hz);
    const v001 = p(-hx, -hy, hz);
    const v101 = p(hx, -hy, hz);
    const v111 = p(hx, hy, hz);
    const v011 = p(-hx, hy, hz);

    this.addQuad(v011, v111, v101, v001, pick('front')); // +z
    this.addQuad(v110, v010, v000, v100, pick('back')); // -z
    this.addQuad(v111, v110, v100, v101, pick('right')); // +x
    this.addQuad(v010, v011, v001, v000, pick('left')); // -x
    this.addQuad(v010, v110, v111, v011, pick('top')); // +y
    this.addQuad(v001, v101, v100, v000, pick('bottom')); // -y
    return this;
  }

  /**
   * Tapered box — a box whose top face is scaled. Cheap car bodies, rocks,
   * tree trunks and cliffs all come from this.
   */
  addFrustumBox(center, size, topScale, color, rotationY = 0) {
    const hx = size.x / 2;
    const hy = size.y / 2;
    const hz = size.z / 2;
    const sx = typeof topScale === 'number' ? topScale : topScale.x;
    const sz = typeof topScale === 'number' ? topScale : topScale.z;
    const ox = topScale.offsetX || 0;
    const oz = topScale.offsetZ || 0;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const p = (x, y, z) =>
      new THREE.Vector3(center.x + x * cos + z * sin, center.y + y, center.z + (-x * sin + z * cos));

    const c = typeof color === 'number' ? { all: color } : color;
    const pick = (face) => c[face] ?? c.side ?? c.all ?? 0xffffff;

    const b00 = p(-hx, -hy, -hz);
    const b10 = p(hx, -hy, -hz);
    const b11 = p(hx, -hy, hz);
    const b01 = p(-hx, -hy, hz);
    const t00 = p(-hx * sx + ox, hy, -hz * sz + oz);
    const t10 = p(hx * sx + ox, hy, -hz * sz + oz);
    const t11 = p(hx * sx + ox, hy, hz * sz + oz);
    const t01 = p(-hx * sx + ox, hy, hz * sz + oz);

    this.addQuad(t01, t11, b11, b01, pick('front'));
    this.addQuad(t10, t00, b00, b10, pick('back'));
    this.addQuad(t11, t10, b10, b11, pick('right'));
    this.addQuad(t00, t01, b01, b00, pick('left'));
    this.addQuad(t00, t10, t11, t01, pick('top'));
    this.addQuad(b01, b11, b10, b00, pick('bottom'));
    return this;
  }

  /** N-sided cone — tree canopies, spikes. */
  addCone(center, radius, height, sides, color, tilt = 0) {
    const apex = new THREE.Vector3(center.x, center.y + height, center.z);
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + tilt;
      ring.push(new THREE.Vector3(center.x + Math.cos(a) * radius, center.y, center.z + Math.sin(a) * radius));
    }
    const c = typeof color === 'number' ? { all: color } : color;
    const side = c.side ?? c.all;
    const bottom = c.bottom ?? side;
    for (let i = 0; i < sides; i++) {
      const p0 = ring[i];
      const p1 = ring[(i + 1) % sides];
      this.addTriangle(p0, p1, apex, side);
      if (i > 1) this.addTriangle(ring[0], p1, p0, bottom);
    }
    return this;
  }

  /** N-sided cylinder with optional taper — trunks, posts, wheels. */
  addCylinder(center, radiusBottom, radiusTop, height, sides, color, axis = 'y', rotation = 0) {
    const c = typeof color === 'number' ? { all: color } : color;
    const side = c.side ?? c.all;
    const capTop = c.top ?? side;
    const capBottom = c.bottom ?? side;

    const at = (r, y, i) => {
      const a = (i / sides) * Math.PI * 2 + rotation;
      const u = Math.cos(a) * r;
      const w = Math.sin(a) * r;
      if (axis === 'y') return new THREE.Vector3(center.x + u, center.y + y, center.z + w);
      if (axis === 'x') return new THREE.Vector3(center.x + y, center.y + u, center.z + w);
      return new THREE.Vector3(center.x + u, center.y + w, center.z + y);
    };

    const h0 = -height / 2;
    const h1 = height / 2;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const b0 = at(radiusBottom, h0, i);
      const b1 = at(radiusBottom, h0, j);
      const t0 = at(radiusTop, h1, i);
      const t1 = at(radiusTop, h1, j);
      if (radiusTop > 0.0001 && radiusBottom > 0.0001) this.addQuad(t0, t1, b1, b0, side);
      else if (radiusTop > 0.0001) this.addTriangle(t0, t1, b0, side);
      else this.addTriangle(b0, b1, t0, side);
      if (i > 1) {
        if (radiusTop > 0.0001) this.addTriangle(at(radiusTop, h1, 0), t0, t1, capTop);
        if (radiusBottom > 0.0001) this.addTriangle(at(radiusBottom, h0, 0), b1, b0, capBottom);
      }
    }
    return this;
  }

  /** Merge another builder's contents, optionally transformed. */
  append(other, matrix = null) {
    if (!matrix) {
      this.positions.push(...other.positions);
      this.normals.push(...other.normals);
      this.colors.push(...other.colors);
      this.uvs.push(...other.uvs);
      return this;
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < other.positions.length; i += 3) {
      _a.set(other.positions[i], other.positions[i + 1], other.positions[i + 2]).applyMatrix4(matrix);
      this.positions.push(_a.x, _a.y, _a.z);
      _b.set(other.normals[i], other.normals[i + 1], other.normals[i + 2])
        .applyMatrix3(normalMatrix)
        .normalize();
      this.normals.push(_b.x, _b.y, _b.z);
    }
    this.colors.push(...other.colors);
    this.uvs.push(...other.uvs);
    return this;
  }

  /** @returns {THREE.BufferGeometry} */
  build(computeBounds = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (computeBounds) {
      g.computeBoundingSphere();
      g.computeBoundingBox();
    }
    return g;
  }

  clear() {
    this.positions.length = 0;
    this.normals.length = 0;
    this.colors.length = 0;
    this.uvs.length = 0;
    return this;
  }
}

/** Shorthand: build one geometry from a callback. */
export function buildGeometry(fn) {
  const b = new GeomBuilder();
  fn(b);
  return b.build();
}

/** Nudge a colour's brightness — for cheap face shading variety. */
export function shade(hex, amount) {
  _c.setHex(hex, THREE.SRGBColorSpace);
  const hsl = { h: 0, s: 0, l: 0 };
  _c.getHSL(hsl);
  _c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return _c.getHex(THREE.SRGBColorSpace);
}
