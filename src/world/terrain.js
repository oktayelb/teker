/**
 * TERRAIN — the heightfield the whole world sits on.
 *
 * Heights are baked into a grid once, then sampled. Baking (rather than
 * evaluating noise per query) matters because the physics asks for the ground
 * several times per car per step, and because the collision surface then
 * provably matches the mesh you can see.
 *
 * THE SURFACE IS TRIANGLES, NOT A BILINEAR PATCH
 * ----------------------------------------------
 * This used to be sampled with bilinear interpolation while the mesh was
 * triangulated with an alternating diagonal. Those are two different surfaces:
 * they agree at the four corners of a cell and nowhere else, and at the centre
 * they differ by exactly the cell's twist, `(h00 + h11 - h01 - h10) / 4`. On
 * natural ground that is centimetres. Where a track's shaper flattens the land
 * beside the road it reaches 3.9 m — and a car parked on a surface 3.5 m below
 * the one being drawn is a car inside a hill.
 *
 * So `heightAt` evaluates the *triangle plane*, and both it and the mesh
 * builder get the diagonal from `cellIsAntiDiagonal()`. One rule, one function,
 * and the two can no longer drift apart. `smoothHeightAt` keeps the old
 * bilinear surface for `normalAt`, which wants a continuous gradient field
 * rather than the truth (see the note there).
 *
 * The mesh is split into chunks so frustum culling can throw away most of the
 * world — with the fog this dense, you are only ever looking at a few of them.
 */

import * as THREE from 'three';
import { fbm2, valueNoise2, clamp, clamp01, lerp, smoothstep } from '../core/mathx.js';
import { GROUND_PAINT } from '../config/style.js';

const _slopeNormal = new THREE.Vector3();

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

// ---------------------------------------------------------------------------
// THE CELL DIAGONAL — the one rule the sampler and the mesh must share
// ---------------------------------------------------------------------------

/**
 * Which way grid cell (gi, gj) is split into two triangles.
 *
 * The alternating diagonal exists to kill the directional "corduroy" a
 * uniformly split grid produces on slopes. It also means the ground under the
 * car is one of two different planes depending on a parity bit, and *anything*
 * that wants to know where the ground is has to ask the same question the mesh
 * builder asked. This function is that question. Do not inline it.
 *
 * Note the arguments are GLOBAL grid indices. Chunks happen to be an even
 * number of cells across, so chunk-local parity currently matches — but that
 * is a coincidence waiting to become a bug the first time `chunkCells` is odd.
 *
 * @param {number} gi global grid column
 * @param {number} gj global grid row
 * @returns {boolean} true = split along the anti-diagonal (tx + tz = 1)
 */
export function cellIsAntiDiagonal(gi, gj) {
  return ((gi + gj) & 1) === 1;
}

/**
 * Height on the triangle the mesh actually drew.
 *
 * @param {number} h00 corner at (gi, gj)
 * @param {number} h10 corner at (gi+1, gj)
 * @param {number} h01 corner at (gi, gj+1)
 * @param {number} h11 corner at (gi+1, gj+1)
 * @param {number} tx 0..1 across the cell
 * @param {number} tz 0..1 down the cell
 * @param {boolean} anti from `cellIsAntiDiagonal`
 */
export function cellTriangleHeight(h00, h10, h01, h11, tx, tz, anti) {
  if (anti) {
    // Triangles (a,c,b) and (b,c,e) — the seam runs from (1,0) to (0,1).
    if (tx + tz <= 1) return h00 + tx * (h10 - h00) + tz * (h01 - h00);
    return h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  }
  // Triangles (a,c,e) and (a,e,b) — the seam runs from (0,0) to (1,1).
  if (tz >= tx) return h00 + tz * (h01 - h00) + tx * (h11 - h01);
  return h00 + tx * (h10 - h00) + tz * (h11 - h10);
}

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

  /**
   * The ground, on the surface that is actually being drawn.
   *
   * This is the physics contract: whatever this returns, the player can see.
   * @returns {number} world-space height in metres
   */
  heightAt(x, z) {
    const n = this.gridSize;
    const { fx, fz } = this._gridCoords(x, z);
    const i = clamp(Math.floor(fx), 0, n - 2);
    const j = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp01(fx - i);
    const tz = clamp01(fz - j);
    const row = j * n + i;
    return cellTriangleHeight(
      this.heights[row],
      this.heights[row + 1],
      this.heights[row + n],
      this.heights[row + n + 1],
      tx,
      tz,
      cellIsAntiDiagonal(i, j)
    );
  }

  /**
   * The old bilinear surface — smooth, and wrong by up to the cell's twist.
   *
   * It survives for exactly one caller: `normalAt`. A gradient taken across the
   * true triangulated surface is piecewise constant and jumps at every facet
   * seam, and the car lies down on that normal every frame — see the comment on
   * `normalAt`. So the *height* comes from the triangles and the *slope* comes
   * from a smoothed field, which is the standard heightfield compromise and the
   * only place the two surfaces are allowed to disagree.
   */
  smoothHeightAt(x, z) {
    const n = this.gridSize;
    const { fx, fz } = this._gridCoords(x, z);
    const i = clamp(Math.floor(fx), 0, n - 2);
    const j = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp01(fx - i);
    const tz = clamp01(fz - j);
    const row = j * n + i;
    return lerp(
      lerp(this.heights[row], this.heights[row + 1], tx),
      lerp(this.heights[row + n], this.heights[row + n + 1], tx),
      tz
    );
  }

  /** Smooth normal from the height gradient. Cheaper than triangle normals and
   *  it does not make the car twitch as it crosses facet boundaries — which is
   *  why it samples `smoothHeightAt` rather than the faceted `heightAt`. */
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cellSize * 0.5;
    const hL = this.smoothHeightAt(x - e, z);
    const hR = this.smoothHeightAt(x + e, z);
    const hD = this.smoothHeightAt(x, z - e);
    const hU = this.smoothHeightAt(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /**
   * How steep the ground is here, 0 (flat) .. 1 (vertical), on the same metric
   * `TERRAIN_SHAPE.cliffSlope` and `SCATTER_RULES.maxSlope` are expressed in.
   * @returns {number}
   */
  slopeAt(x, z) {
    this.normalAt(x, z, _slopeNormal);
    return 1 - _slopeNormal.y;
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

        // The normal is already here, so the slope the palette wants for its
        // wear gradient is one subtraction rather than four more samples.
        const c = palette.sample(this.surfaces[gj * n + gi], h, gi, gj, 1 - nrm.y);
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
        // uniformly split grid produces on slopes. `cellIsAntiDiagonal` is the
        // ONLY place that rule is written down — `heightAt` reads the same
        // function, which is what stops the physics surface and the drawn
        // surface from ever describing different hills again.
        if (cellIsAntiDiagonal(i0 + ii, j0 + jj)) {
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
 * Terrain colours — the difference between ground and tinted noise.
 *
 * Four things are layered, in this order, and each one is answering a question
 * the previous layer left open:
 *
 *  1. TURF. Two scales of value noise pick between the theme's three greens, so
 *     grassland is mottled rather than a single flat colour.
 *  2. WEAR. Grass does not grow on ground it cannot hold onto. As the land tips
 *     past `GROUND_PAINT.wearStart` the turf thins to bare earth, and a noise
 *     field pushes that line around so it is a ragged edge instead of a
 *     contour. This is what puts brown on the hillsides and stops the world
 *     reading as a green bedsheet thrown over some hills.
 *  3. DAMP. Everything low is wet. From `dampAbove` metres over the water line
 *     down to `dampBelow` under it, the ground darkens into mud — which also
 *     means the streams and hollows read as *drainage* rather than as dents.
 *  4. GRIT. A per-vertex speckle toward the theme's stone colour, weak in
 *     grass and strong in bare earth, because soil is mostly small stones.
 *
 * All of it is baked into the mesh's colour attribute, which already exists, so
 * the entire thing is free at runtime. The theme tint still multiplies over the
 * top, so this survives a cross-fade to night the same as everything else.
 */
function buildPalette(theme) {
  const toLinear = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  const G = theme.ground;
  const base = toLinear(G.base);
  const varA = toLinear(G.variantA);
  const varB = toLinear(G.variantB);
  const cliff = toLinear(G.cliff);
  const dirt = toLinear(G.dirt);
  const mud = toLinear(G.mud);
  const grit = toLinear(G.grit);

  const P = GROUND_PAINT;
  const S = TERRAIN_SHAPE;
  const wearFrom = P.wearStart;
  const wearTo = P.wearFull;
  const wearJitter = P.wearNoise;
  const dampTop = S.waterLevel + P.dampAbove;
  const dampBottom = S.waterLevel - P.dampBelow;
  const out = [0, 0, 0];

  return {
    /**
     * @param {number} surfaceId see SURFACE_IDS
     * @param {number} height metres
     * @param {number} gi global grid column
     * @param {number} gj global grid row
     * @param {number} slope 0..1, the same metric as `cliffSlope`
     * @returns {number[]} linear rgb, reused between calls — copy it out
     */
    sample(surfaceId, height, gi, gj, slope) {
      // 1. TURF
      const patch = valueNoise2(gi * P.patchScale, gj * P.patchScale) * 0.5 + 0.5;
      const speck = valueNoise2(gi * P.speckScale, gj * P.speckScale) * 0.5 + 0.5;
      const t = clamp01(patch * 0.75 + speck * 0.25);
      let c = t < 0.42 ? varA : t > 0.68 ? varB : base;

      // 2. WEAR. A cliff is already bare, so it skips straight to rock.
      let earth = 0;
      if (surfaceId === SURFACE_IDS.CLIFF) {
        out[0] = cliff[0];
        out[1] = cliff[1];
        out[2] = cliff[2];
        earth = 1;
      } else {
        const ragged = valueNoise2(gi * P.wearNoiseScale, gj * P.wearNoiseScale) * wearJitter;
        earth = smoothstep(wearFrom + ragged, wearTo + ragged, slope);
        out[0] = lerp(c[0], dirt[0], earth);
        out[1] = lerp(c[1], dirt[1], earth);
        out[2] = lerp(c[2], dirt[2], earth);
      }

      // 3. DAMP
      const damp = 1 - smoothstep(dampBottom, dampTop, height);
      if (damp > 0) {
        out[0] = lerp(out[0], mud[0], damp);
        out[1] = lerp(out[1], mud[1], damp);
        out[2] = lerp(out[2], mud[2], damp);
        earth = Math.max(earth, damp);
      }

      // 4. GRIT — pale stones where the noise is positive, dark flecks where it
      // is negative. One-sided speckle reads as dust on the lens.
      const g = valueNoise2(gi * P.gritScale, gj * P.gritScale);
      const k = lerp(P.gritOnGrass, P.gritOnEarth, earth) * g;
      if (k > 0) {
        out[0] = lerp(out[0], grit[0], k);
        out[1] = lerp(out[1], grit[1], k);
        out[2] = lerp(out[2], grit[2], k);
      } else {
        const dark = 1 + k;
        out[0] *= dark;
        out[1] *= dark;
        out[2] *= dark;
      }

      // Higher ground catches more light; a free, cheap sense of relief.
      const L = P.lift;
      const lift = 1 + clamp((height - L.from) / L.range, L.min, L.max);
      out[0] *= lift;
      out[1] *= lift;
      out[2] *= lift;
      return out;
    },
  };
}
