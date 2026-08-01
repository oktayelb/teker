/**
 * RNG — seeded, so the world is the same every time you reload.
 *
 * Use a *named stream* per system (`rng.stream('trees')`) so adding a new
 * system does not shuffle every other system's output.
 */

/** mulberry32 — small, fast, good enough for scatter and AI jitter. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — turn a stream name into a seed offset. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  /** A deterministic, independent generator derived from this one. */
  stream(name) {
    return new Rng((this.seed ^ hashString(name)) >>> 0);
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  /** 0..1 */
  next() {
    return this._next();
  }
  /** lo..hi */
  range(lo, hi) {
    return lo + (hi - lo) * this._next();
  }
  /** Integer in [lo, hi] inclusive. */
  int(lo, hi) {
    return Math.floor(lo + (hi - lo + 1) * this._next());
  }
  /** -1..1 */
  signed() {
    return this._next() * 2 - 1;
  }
  bool(chance = 0.5) {
    return this._next() < chance;
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  /** Fisher–Yates, in place. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Approximately gaussian, mean 0, sd 1. */
  gaussian() {
    return (this._next() + this._next() + this._next() - 1.5) * 1.1547;
  }
  /** Uniform point in a disc of `radius`, returned as {x, z}. */
  discXZ(radius) {
    const r = radius * Math.sqrt(this._next());
    const a = this._next() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

/** The shared world generator RNG. Reseeded at boot from gameplay config. */
export const worldRng = new Rng(0x7e4e17);
