/**
 * SYNTH — the low-level WebAudio toolbox.
 *
 * Nothing in here knows what a car is. It builds noise buffers, shaping curves,
 * envelopes and small node clusters, and it does so *defensively*: every helper
 * assumes it may be handed a half-broken or vendor-prefixed AudioContext.
 *
 * Two rules this file exists to enforce:
 *   1. **No WebAudio at module scope.** Everything is a function that takes a
 *      live `ctx`. Importing this file under plain Node must be harmless.
 *   2. **Every source cleans itself up.** One-shots are torn down from
 *      `onended`, so a busy crash-fest doesn't slowly leak a thousand nodes.
 */

// ---------------------------------------------------------------------------
// Maths / small utilities
// ---------------------------------------------------------------------------

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Coerce anything the game might hand us into a sane 0..1. NaN/undefined → 0. */
export const clamp01 = (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

export const lerp = (a, b, t) => a + (b - a) * t;

/** `num(maybeUndefined, fallback)` — payloads from the event bus are untrusted. */
export const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** MIDI note number → Hz. 69 = A4 = 440 Hz. */
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Decibels → linear gain. Handy when tuning by ear ( -6 dB = half amplitude ). */
export const dbToGain = (db) => Math.pow(10, db / 20);

/**
 * mulberry32 — 32-bit PRNG. Used so noise buffers are *reproducible*: the same
 * build always hisses identically, which matters when you're tuning by ear and
 * don't want the character of the noise shifting under you between reloads.
 */
export function makeRng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Context acquisition
// ---------------------------------------------------------------------------

/**
 * Returns the AudioContext constructor, or null when WebAudio doesn't exist
 * (plain Node, ancient browsers, hardened embedders). Callers must treat null
 * as "run silent", never as an error.
 */
export function pickAudioContextCtor() {
  const g = /** @type {any} */ (globalThis);
  return g.AudioContext || g.webkitAudioContext || null;
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

/**
 * Generate a mono noise buffer.
 *
 * `kind`:
 *   'white'      — flat spectrum. Tyres, wind, impacts.
 *   'pink'       — -3 dB/octave (Paul Kellet's economy filter). Sounds like
 *                  "air" rather than "static"; used for ambience beds.
 *   'sampleHold' — white noise held for N samples at a time. This is the sound
 *                  of a broken DAC: stepping introduces aliased harmonics that
 *                  no filter can produce. It is the backbone of the glitch bed.
 *
 * Buffers are generated once at init and shared by every voice, so keep them
 * a few seconds long: short loops get an audible periodic "pulse".
 */
export function makeNoiseBuffer(ctx, seconds = 3, kind = 'white', opts = {}) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  const rng = opts.rng || makeRng(opts.seed ?? 1337);

  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (kind === 'sampleHold') {
    const step = Math.max(1, Math.floor(opts.holdSamples ?? 24));
    let held = 0;
    for (let i = 0; i < len; i++) {
      if (i % step === 0) held = rng() * 2 - 1;
      data[i] = held;
    }
  } else {
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
  }
  return buf;
}

/**
 * A looping player for a shared noise buffer.
 * `playbackRate` doubles as a cheap tone control (rate > 1 = brighter) *and* as
 * a decorrelator: two branches reading the same buffer at different rates stop
 * sounding like the same hiss twice.
 */
export function makeNoiseSource(ctx, buffer, playbackRate = 1, loop = true) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.playbackRate.value = playbackRate;
  // Random start offset so simultaneous branches never phase-align on loop.
  return src;
}

// ---------------------------------------------------------------------------
// Waveshaper curves
// ---------------------------------------------------------------------------

/**
 * Soft clipper. Adds odd harmonics without the hard fizz of true clipping —
 * this is what makes a synthesised engine sound like it's pushing air rather
 * than like three oscillators added together.
 */
export function makeSoftClipCurve(amount = 0.6, n = 1024) {
  const k = clamp(amount, 0, 0.999) * 100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/**
 * Staircase curve = amplitude quantisation = bit crushing. `levels` is the
 * number of steps across the full range; 4–8 is unmistakably "broken machine",
 * 32+ is just a bit gritty.
 */
export function makeBitcrushCurve(levels = 8, n = 1024) {
  const steps = Math.max(2, Math.floor(levels));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

/** Connect a list of nodes in series. Returns the last one. */
export function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

export function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch {
    /* already gone */
  }
}

export function safeStop(node, when) {
  try {
    node.stop(when);
  } catch {
    /* already stopped, or not a source */
  }
}

/**
 * StereoPanner isn't universal (old Safari). Fall back to a plain gain node so
 * the graph shape never changes — the game just loses stereo placement.
 */
export function createPanner(ctx) {
  if (typeof ctx.createStereoPanner === 'function') {
    try {
      return ctx.createStereoPanner();
    } catch {
      /* fall through */
    }
  }
  return ctx.createGain();
}

/** Set pan if this node actually has a pan param (see createPanner fallback). */
export function setPan(node, value, now, tc = 0.05) {
  if (node && node.pan) glide(node.pan, clamp(value, -1, 1), tc, now);
}

export function makeGain(ctx, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function makeFilter(ctx, type = 'lowpass', freq = 1000, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function makeOsc(ctx, type = 'sawtooth', freq = 220, detuneCents = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detuneCents;
  return o;
}

/**
 * An LFO whose *output* is already scaled to `depth`. Connect `.out` to any
 * AudioParam: WebAudio sums connected signals onto the param's intrinsic value,
 * so `param.value` stays the centre and the LFO swings around it.
 */
export function makeLfo(ctx, { hz = 1, depth = 1, type = 'sine' } = {}) {
  const osc = makeOsc(ctx, type, hz);
  const out = makeGain(ctx, depth);
  osc.connect(out);
  return { osc, out };
}

// ---------------------------------------------------------------------------
// Parameter automation
// ---------------------------------------------------------------------------

/**
 * Last target per AudioParam, so per-frame `glide()` calls that don't actually
 * change anything don't pile events onto the automation timeline. WeakMap so a
 * disposed graph is still collectable.
 */
const lastTargets = new WeakMap();

/**
 * Smooth per-frame parameter follow. `tc` is the exponential time constant in
 * seconds (~63% of the way there per tc). Use this — never `param.value = x` —
 * for anything driven at frame rate, or you get zipper noise.
 */
export function glide(param, target, tc, now, eps = 1e-4) {
  if (!param || !Number.isFinite(target)) return;
  const prev = lastTargets.get(param);
  if (prev !== undefined && Math.abs(prev - target) <= eps) return;
  lastTargets.set(param, target);
  try {
    param.setTargetAtTime(target, now, Math.max(0.001, tc));
  } catch {
    try {
      param.value = target;
    } catch {
      /* nothing more we can do */
    }
  }
}

/** Immediate linear ramp, used for fades where we want a known end time. */
export function ramp(param, target, now, dur) {
  if (!param) return;
  try {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + Math.max(0.001, dur));
    lastTargets.delete(param);
  } catch {
    /* ignore */
  }
}

/**
 * Percussive envelope: exponential attack → optional hold → exponential decay.
 *
 * Exponential (not linear) because ears hear amplitude logarithmically — a
 * linear decay sounds like it stops abruptly halfway. `floor` exists because
 * `exponentialRampToValueAtTime` is undefined for 0.
 *
 * Returns the total duration in seconds so callers can schedule teardown.
 */
export function envAD(param, t0, { peak = 1, attack = 0.004, hold = 0, release = 0.2, floor = 0.0005 } = {}) {
  const a = Math.max(0.0005, attack);
  const h = Math.max(0, hold);
  const r = Math.max(0.005, release);
  const top = Math.max(floor * 2, peak);
  try {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(floor, t0);
    param.exponentialRampToValueAtTime(top, t0 + a);
    if (h > 0) param.setValueAtTime(top, t0 + a + h);
    param.exponentialRampToValueAtTime(floor, t0 + a + h + r);
  } catch {
    /* ignore */
  }
  return a + h + r;
}

/**
 * Start every source, stop them all at `stopTime`, and disconnect the whole
 * cluster once the last one reports `onended`. This is the only teardown path
 * for one-shots — if you build a voice without it, you have written a leak.
 */
export function scheduleTeardown(sources, nodes, startTime, stopTime, onDone) {
  let pending = sources.length;
  const finish = () => {
    if (--pending > 0) return;
    for (const s of sources) safeDisconnect(s);
    for (const n of nodes) safeDisconnect(n);
    if (onDone) onDone();
  };
  for (const s of sources) {
    s.onended = finish;
    try {
      s.start(startTime);
    } catch {
      /* already started */
    }
    safeStop(s, stopTime);
  }
  if (pending === 0 && onDone) onDone();
}

// ---------------------------------------------------------------------------
// Voice budget
// ---------------------------------------------------------------------------

/**
 * Hard cap on simultaneous one-shots. Past the cap we *drop* new sounds rather
 * than let the graph thrash — a missing crash sound is invisible, a stuttering
 * audio thread stalls the whole frame.
 */
export class VoicePool {
  constructor(max = 12) {
    this.max = max;
    this.active = 0;
  }
  take() {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }
  release() {
    if (this.active > 0) this.active--;
  }
  reset() {
    this.active = 0;
  }
}

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

/**
 * World position → { distance, pan } relative to a listener.
 *
 * Right vector is `forward × up` with up = +Y, i.e. (-fz, 0, fx). With three.js'
 * default camera forward of (0,0,-1) that yields (1,0,0) — screen right is +X,
 * which is what you'd expect.
 */
export function panAndDistance(listener, x, y, z, width = 0.85) {
  const lx = num(listener?.x, 0);
  const ly = num(listener?.y, 0);
  const lz = num(listener?.z, 0);
  let fx = num(listener?.forwardX, 0);
  let fz = num(listener?.forwardZ, -1);
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;

  const dx = num(x, 0) - lx;
  const dy = num(y, ly) - ly;
  const dz = num(z, 0) - lz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-3) return { distance: 0, pan: 0 };

  const rx = -fz;
  const rz = fx;
  const pan = clamp(((dx * rx + dz * rz) / dist) * width, -1, 1);
  return { distance: dist, pan };
}

/**
 * Distance attenuation. Inverse-distance with a reference radius, softened by
 * `rolloff`. Games want this gentler than physics does — real 1/d makes
 * everything more than 20 m away inaudible, which kills the chase tension.
 */
export function distanceGain(distance, refDistance = 12, rolloff = 0.9, maxDistance = 400) {
  const d = clamp(num(distance, 0), 0, maxDistance);
  return refDistance / (refDistance + rolloff * Math.max(0, d - refDistance));
}
