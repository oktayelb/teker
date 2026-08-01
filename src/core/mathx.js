/** Small maths helpers. Framerate-independent smoothing lives here. */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

/**
 * Framerate-independent exponential smoothing. Use this instead of
 * `lerp(a, b, 0.1)` — that one changes behaviour with framerate.
 * `stiffness` is roughly "how many e-folds of catch-up per second".
 */
export function damp(current, target, stiffness, dt) {
  return lerp(current, target, 1 - Math.exp(-stiffness * dt));
}

/** Same, for angles: takes the short way round. */
export function dampAngle(current, target, stiffness, dt) {
  return current + shortestAngle(current, target) * (1 - Math.exp(-stiffness * dt));
}

/** Signed smallest difference from `a` to `b`, in (-PI, PI]. */
export function shortestAngle(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a) {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current, target, maxDelta) {
  const d = target - current;
  return Math.abs(d) <= maxDelta ? target : current + sign(d) * maxDelta;
}

/** Asymmetric approach — rise and fall at different rates (throttle feel). */
export function approach(current, target, riseRate, fallRate, dt) {
  const rate = target > current ? riseRate : fallRate;
  if (rate <= 0) return target;
  return moveToward(current, target, dt / rate);
}

/** Deadzone with rescaling so the usable range stays 0..1. */
export function deadzone(v, dz = 0.12) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return sign(v) * ((a - dz) / (1 - dz));
}

/** Catmull–Rom interpolation, used by the track splines. */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Distance from point P to segment AB, in the XZ plane. Returns {dist, t}. */
export function pointSegmentXZ(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / lenSq) : 0;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t, x: cx, z: cz };
}

/** 2D value noise — cheap, deterministic terrain detail. */
export function fract(x) {
  return x - Math.floor(x);
}

export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return fract(s);
}

export function valueNoise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

/** Fractal Brownian motion over valueNoise2. */
export function fbm2(x, y, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
