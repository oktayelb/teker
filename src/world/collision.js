/**
 * COLLISION — a uniform spatial hash over static obstacles.
 *
 * There is no rigid-body solver here and there does not need to be. Cars are
 * treated as a vertical cylinder; trees, rocks and barriers are cylinders or
 * boxes. A query returns the single deepest overlap, which the vehicle pushes
 * out of. For an arcade racer that reads as "solid" and costs nothing.
 */

import * as THREE from 'three';

const _n = new THREE.Vector3();

export class CollisionGrid {
  constructor(cellSize = 12) {
    this.cellSize = cellSize;
    /** @type {Map<number, object[]>} */
    this.cells = new Map();
    this.count = 0;
    /** Reused result object — collision queries run in the physics hot path. */
    this._result = { normal: new THREE.Vector3(), depth: 0, collider: null };
  }

  _key(cx, cz) {
    // Pack two signed 16-bit cell coordinates into one number: much faster to
    // hash than a template string, and we do this several times per step.
    return ((cx & 0xffff) << 16) | (cz & 0xffff);
  }

  /**
   * @param {object} c
   * @param {'cylinder'|'box'} c.type
   * @param {number} c.x @param {number} c.y @param {number} c.z
   * @param {number} [c.radius] cylinder only
   * @param {number} [c.halfX] @param {number} [c.halfY] @param {number} [c.halfZ] box only
   * @param {number} [c.height] cylinder only; defaults to tall enough to matter
   * @param {number} [c.rotationY] box only
   */
  insert(c) {
    const r = c.type === 'cylinder' ? c.radius : Math.hypot(c.halfX, c.halfZ);
    const cs = this.cellSize;
    const x0 = Math.floor((c.x - r) / cs);
    const x1 = Math.floor((c.x + r) / cs);
    const z0 = Math.floor((c.z - r) / cs);
    const z1 = Math.floor((c.z + r) / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
    this.count++;
    return this;
  }

  insertAll(colliders) {
    for (const c of colliders) this.insert(c);
    return this;
  }

  /**
   * Deepest overlap between a vertical cylinder and anything static.
   * @param {THREE.Vector3} position centre of the moving body
   * @param {number} radius
   * @param {number} [height] body height; used to skip obstacles you fly over
   * @returns {null | {normal: THREE.Vector3, depth: number, collider: object}}
   */
  resolve(position, radius, height = 1.4) {
    const cs = this.cellSize;
    const cx = Math.floor(position.x / cs);
    const cz = Math.floor(position.z / cs);

    let bestDepth = 0;
    let bestCollider = null;
    let bestNx = 0;
    let bestNz = 0;

    // Only the 3x3 neighbourhood can contain an overlap, given cellSize is
    // larger than any collider's radius plus the car's.
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const list = this.cells.get(this._key(ix, iz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.disabled) continue;

          // Vertical rejection: you can clear a low rock on a jump.
          const halfH = c.type === 'cylinder' ? (c.height ?? 4) / 2 : c.halfY;
          if (Math.abs(position.y - c.y) > halfH + height) continue;

          let nx;
          let nz;
          let depth;
          if (c.type === 'cylinder') {
            const dx = position.x - c.x;
            const dz = position.z - c.z;
            const d = Math.hypot(dx, dz);
            const overlap = c.radius + radius - d;
            if (overlap <= 0) continue;
            depth = overlap;
            if (d > 1e-4) {
              nx = dx / d;
              nz = dz / d;
            } else {
              nx = 1;
              nz = 0;
            }
          } else {
            // Box: work in the box's local frame, clamp to find the closest
            // point, then transform the separation back out.
            const cos = Math.cos(-c.rotationY || 0);
            const sin = Math.sin(-c.rotationY || 0);
            const dx = position.x - c.x;
            const dz = position.z - c.z;
            const lx = dx * cos - dz * sin;
            const lz = dx * sin + dz * cos;
            const clampedX = Math.max(-c.halfX, Math.min(c.halfX, lx));
            const clampedZ = Math.max(-c.halfZ, Math.min(c.halfZ, lz));
            const ox = lx - clampedX;
            const oz = lz - clampedZ;
            const distSq = ox * ox + oz * oz;
            if (distSq > radius * radius) continue;
            let lnx;
            let lnz;
            if (distSq > 1e-8) {
              const d = Math.sqrt(distSq);
              depth = radius - d;
              lnx = ox / d;
              lnz = oz / d;
            } else {
              // Centre is inside the box: escape through the nearest face.
              const px = c.halfX - Math.abs(lx);
              const pz = c.halfZ - Math.abs(lz);
              if (px < pz) {
                depth = px + radius;
                lnx = Math.sign(lx) || 1;
                lnz = 0;
              } else {
                depth = pz + radius;
                lnx = 0;
                lnz = Math.sign(lz) || 1;
              }
            }
            const c2 = Math.cos(c.rotationY || 0);
            const s2 = Math.sin(c.rotationY || 0);
            nx = lnx * c2 - lnz * s2;
            nz = lnx * s2 + lnz * c2;
          }

          if (depth > bestDepth) {
            bestDepth = depth;
            bestCollider = c;
            bestNx = nx;
            bestNz = nz;
          }
        }
      }
    }

    if (!bestCollider) return null;
    const r = this._result;
    r.normal.set(bestNx, 0, bestNz);
    r.depth = bestDepth;
    r.collider = bestCollider;
    return r;
  }

  /** Is the straight line from A to B blocked? Used for cop line-of-sight. */
  raycastBlocked(ax, az, bx, bz, step = 3.5) {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return false;
    const steps = Math.min(64, Math.ceil(len / step));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      _n.set(ax + dx * t, 0, az + dz * t);
      const list = this.cells.get(this._key(Math.floor(_n.x / this.cellSize), Math.floor(_n.z / this.cellSize)));
      if (!list) continue;
      for (const c of list) {
        if (c.disabled || !c.blocksSight) continue;
        const r = c.type === 'cylinder' ? c.radius : Math.hypot(c.halfX, c.halfZ);
        if (Math.hypot(_n.x - c.x, _n.z - c.z) < r) return true;
      }
    }
    return false;
  }

  clear() {
    this.cells.clear();
    this.count = 0;
  }
}
