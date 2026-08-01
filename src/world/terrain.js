/**
 * TERRAIN — the heightfield the whole world sits on.
 *
 * Heights are baked into a grid once, then sampled with bilinear interpolation.
 * Baking (rather than evaluating noise per query) matters because the physics
 * asks for the ground several times per car per step, and because the collision
 * surface then provably matches the mesh you can see.
 *
 * The mesh is split into chunks so frustum culling can throw away most of the
 * world — with the fog this dense, you are only ever looking at a few of them.
 */

import * as THREE from 'three';
import { fbm2, valueNoise2, clamp, clamp01, lerp, smoothstep } from '../core/mathx.js';
import { GeomBuilder } from '../render/geometry.js';

/** Terrain shape. All of it is tunable; none of it is load-bearing for gameplay. */
export const TERRAIN_SHAPE = {
  /** Height of the big rolling hills, metres. */
  amplitude: 46,
  /** Feature size of those hills — smaller = broader. */
  frequency: 0.00085,
  octaves: 5,
  /** Secondary ridges. */
  detailAmplitude: 9.5,
  detailFrequency: 0.0062,
  /** Fine bumpiness you feel through the wheels rather than see. */
  microAmplitude: 0.85,
  microFrequency: 0.035,
  /**
   * The land lifts toward the world edge, so the map feels like a valley
   * instead of a disc that stops. Purely to keep the player in without a wall.
   */
  rimStart: 0.72,
  rimHeight: 90,
  /** Below this height the ground is damp/muddy near the streams. */
  waterLevel: -6,
  /** Slope (0..1, 1 = vertical) above which ground becomes bare rock. */
  cliffSlope: 0.55,
};

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.resolution grid cells per side
   * @param {number} opts.cellSize metres per cell
   * @param {number} [opts.seed]
   */
  constructor({ resolution = 180, cellSize = 16, seed = 1 } = {}) {
    this.resolution = resolution;
    this.cellSize = cellSize;
    this.seed = seed;
    /** World spans [-halfSpan, +halfSpan] on both axes. */
    this.halfSpan = (resolution * cellSize) / 2;

    const n = resolution + 1;
    this.gridSize = n;
    this.heights = new Float32Array(n * n);
    /** Surface id index per grid vertex; see `SURFACE_IDS`. */
    this.surfaces = new Uint8Array(n * n);

    /**
     * Optional shaper, installed before `generate()`. Receives the natural
     * height and returns the final one — this is how tracks flatten the land
     * they sit on without the terrain knowing what a track is.
     * @type {null | ((x:number, z:number, height:number) => number)}
     */
    this.shaper = null;

    this._offset = (seed % 997) * 13.37;
    this.chunks = [];
    this.root = null;
  }

  /** Natural, unshaped height at a world position. */
  naturalHeight(x, z) {
    const S = TERRAIN_SHAPE;
    const ox = x + this._offset;
    const oz = z - this._offset;
    let h = fbm2(ox * S.frequency, oz * S.frequency, S.octaves) * S.amplitude;
    h += fbm2(ox * S.detailFrequency, oz * S.detailFrequency, 3) * S.detailAmplitude;
    h += valueNoise2(ox * S.microFrequency, oz * S.microFrequency) * S.microAmplitude;

    // Rim: lift the outer ring so the valley closes itself.
    const d = Math.hypot(x, z) / this.halfSpan;
    if (d > S.rimStart) {
      const t = smoothstep(S.rimStart, 1.05, d);
      h += t * t * S.rimHeight;
    }
    return h;
  }

  generate() {
    const n = this.gridSize;
    const half = this.halfSpan;
    const cs = this.cellSize;
    for (let j = 0; j < n; j++) {
      const z = -half + j * cs;
      for (let i = 0; i < n; i++) {
        const x = -half + i * cs;
        let h = this.naturalHeight(x, z);
        if (this.shaper) h = this.shaper(x, z, h);
        this.heights[j * n + i] = h;
      }
    }
    this._classifySurfaces();
    return this;
  }

  _classifySurfaces() {
    const n = this.gridSize;
    const S = TERRAIN_SHAPE;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const h = this.heights[idx];
        const slope = this._gridSlope(i, j);
        let id = SURFACE_IDS.GRASS;
        if (slope > S.cliffSlope) id = SURFACE_IDS.CLIFF;
        else if (h < S.waterLevel + 2.5) id = SURFACE_IDS.MUD;
        else if (slope > S.cliffSlope * 0.55) id = SURFACE_IDS.DIRT;
        this.surfaces[idx] = id;
      }
    }
  }

  _gridSlope(i, j) {
    const n = this.gridSize;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(n - 1, j + 1);
    const dx = (this.heights[j * n + i1] - this.heights[j * n + i0]) / ((i1 - i0) * this.cellSize);
    const dz = (this.heights[j1 * n + i] - this.heights[j0 * n + i]) / ((j1 - j0) * this.cellSize);
    // Convert the gradient into "how far from flat", 0..1.
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  // -- sampling -------------------------------------------------------------

  _gridCoords(x, z) {
    const half = this.halfSpan;
    const fx = (x + half) / this.cellSize;
    const fz = (z + half) / this.cellSize;
    return { fx, fz };
  }

  heightAt(x, z) {
    const n = this.gridSize;
    const { fx, fz } = this._gridCoords(x, z);
    const i = clamp(Math.floor(fx), 0, n - 2);
    const j = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp01(fx - i);
    const tz = clamp01(fz - j);
    const h00 = this.heights[j * n + i];
    const h10 = this.heights[j * n + i + 1];
    const h01 = this.heights[(j + 1) * n + i];
    const h11 = this.heights[(j + 1) * n + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Smooth normal from the height gradient. Cheaper than triangle normals and
   *  it does not make the car twitch as it crosses facet boundaries. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cellSize * 0.5;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  surfaceAt(x, z) {
    const n = this.gridSize;
    const { fx, fz } = this._gridCoords(x, z);
    const i = clamp(Math.round(fx), 0, n - 1);
    const j = clamp(Math.round(fz), 0, n - 1);
    return SURFACE_NAMES[this.surfaces[j * n + i]];
  }

  contains(x, z) {
    return Math.abs(x) < this.halfSpan && Math.abs(z) < this.halfSpan;
  }

  // -- mesh -----------------------------------------------------------------

  /**
   * @param {import('../render/materials.js').MaterialLibrary} materials
   * @param {object} theme resolved theme
   * @param {number} [chunkCells] cells per chunk side
   */
  buildMesh(materials, theme, chunkCells = 30) {
    const root = new THREE.Group();
    root.name = 'terrain';
    const res = this.resolution;
    const chunksPerSide = Math.ceil(res / chunkCells);
    const mat = materials.get('terrain');
    const palette = buildPalette(theme);

    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const i0 = cx * chunkCells;
        const j0 = cz * chunkCells;
        const i1 = Math.min(res, i0 + chunkCells);
        const j1 = Math.min(res, j0 + chunkCells);
        const geom = this._buildChunkGeometry(i0, j0, i1, j1, palette);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = `terrain:${cx},${cz}`;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        root.add(mesh);
        this.chunks.push(mesh);
      }
    }
    this.root = root;
    return root;
  }

  /** Indexed grid: one vertex per grid point, so the memory stays sane. Flat
   *  shading is done in the shader from screen-space derivatives, which means
   *  we get facets without paying for duplicated vertices. */
  _buildChunkGeometry(i0, j0, i1, j1, palette) {
    const n = this.gridSize;
    const w = i1 - i0 + 1;
    const d = j1 - j0 + 1;
    const count = w * d;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const half = this.halfSpan;
    const cs = this.cellSize;
    const nrm = new THREE.Vector3();

    for (let jj = 0; jj < d; jj++) {
      for (let ii = 0; ii < w; ii++) {
        const gi = i0 + ii;
        const gj = j0 + jj;
        const x = -half + gi * cs;
        const z = -half + gj * cs;
        const h = this.heights[gj * n + gi];
        const o = (jj * w + ii) * 3;
        positions[o] = x;
        positions[o + 1] = h;
        positions[o + 2] = z;

        this.normalAt(x, z, nrm);
        normals[o] = nrm.x;
        normals[o + 1] = nrm.y;
        normals[o + 2] = nrm.z;

        const c = palette.sample(this.surfaces[gj * n + gi], h, gi, gj);
        colors[o] = c[0];
        colors[o + 1] = c[1];
        colors[o + 2] = c[2];
      }
    }

    const indices = new Uint32Array((w - 1) * (d - 1) * 6);
    let k = 0;
    for (let jj = 0; jj < d - 1; jj++) {
      for (let ii = 0; ii < w - 1; ii++) {
        const a = jj * w + ii;
        const b = a + 1;
        const c = a + w;
        const e = c + 1;
        // Alternating diagonal removes the directional "corduroy" artefact a
        // uniformly split grid produces on slopes.
        if ((ii + jj) & 1) {
          indices[k++] = a; indices[k++] = c; indices[k++] = b;
          indices[k++] = b; indices[k++] = c; indices[k++] = e;
        } else {
          indices[k++] = a; indices[k++] = c; indices[k++] = e;
          indices[k++] = a; indices[k++] = e; indices[k++] = b;
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  dispose() {
    for (const c of this.chunks) c.geometry.dispose();
    this.chunks.length = 0;
  }
}

// ---------------------------------------------------------------------------

export const SURFACE_IDS = { GRASS: 0, DIRT: 1, MUD: 2, CLIFF: 3, ICE: 4 };
export const SURFACE_NAMES = ['GRASS', 'DIRT', 'MUD', 'GRASS', 'ICE'];

/**
 * Terrain colours. Ground type picks the base; a little deterministic noise
 * picks between the theme's variants so the ground is mottled rather than
 * a single flat green.
 */
function buildPalette(theme) {
  const toLinear = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  const base = toLinear(theme.ground.base);
  const varA = toLinear(theme.ground.variantA);
  const varB = toLinear(theme.ground.variantB);
  const cliff = toLinear(theme.ground.cliff);
  const mud = toLinear(theme.props.rock);

  return {
    sample(surfaceId, height, gi, gj) {
      let c;
      if (surfaceId === SURFACE_IDS.CLIFF) c = cliff;
      else if (surfaceId === SURFACE_IDS.MUD) c = mud;
      else {
        // Two-scale mottling: broad patches plus per-vertex speckle.
        const patch = valueNoise2(gi * 0.09, gj * 0.09) * 0.5 + 0.5;
        const speck = valueNoise2(gi * 0.61, gj * 0.61) * 0.5 + 0.5;
        const t = clamp01(patch * 0.75 + speck * 0.25);
        c = t < 0.42 ? varA : t > 0.68 ? varB : base;
      }
      // Higher ground catches more light; a free, cheap sense of relief.
      const lift = 1 + clamp((height - 10) / 260, -0.1, 0.16);
      return [c[0] * lift, c[1] * lift, c[2] * lift];
    },
  };
}
