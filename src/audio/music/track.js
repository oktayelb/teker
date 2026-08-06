/**
 * TRACK — how a song is written, and what the sequencer gets.
 *
 * `AudioEngine` has a deliberately stupid step sequencer: per step, per voice,
 * look up a semitone offset and play a note. It knows nothing about keys or
 * modes and it should stay that way. This file is the compiler that sits in
 * front of it, so that a song can be *composed* — in a scale, with named
 * instruments — instead of typed out as raw MIDI arithmetic.
 *
 * WRITING A SONG
 * --------------
 *   export default defineTrack({
 *     id: 'karHatti',
 *     bpm: 120,
 *     root: 45,                 // MIDI note. 45 = A2.
 *     scale: 'hirajoshi',
 *     voices: {
 *       bass: { pattern: [0, ...rest(3), 4, ...rest(3)] },
 *       bell: { pattern: [...rest(4), 5, null, 7, null] },
 *       ice:  { instrument: 'pad', scale: 'wholeTone', pattern: [...] },
 *     },
 *   });
 *
 * Three things are doing work there:
 *
 *   **Degrees, not semitones.** A pattern entry is a scale degree (0 = root,
 *   1 = the next note of the scale, 7 = the octave in a seven-note mode, 5 in
 *   a pentatonic one). `null` is a rest. Change `scale:` and the whole song
 *   moves with it and stays in tune. See `./scales.js`.
 *
 *   **Instruments.** A voice's key picks its sound from `INSTRUMENTS` unless it
 *   names one explicitly, and any field can be overridden inline. A song is
 *   then mostly patterns, which is the part worth reading.
 *
 *   **A voice may leave the key.** `scale:` on a voice overrides the track's.
 *   That is how a whole-tone shimmer sits on top of a tonal bassline without
 *   the whole song losing its floor.
 *
 * WHAT COMES OUT is exactly the shape `AUDIO_CONFIG.MUSIC.tracks` always held:
 * `{ bpm, stepsPerBeat, steps, root, voices: { name: { wave, …, pattern } } }`
 * with `pattern` in semitones. Nothing in `audio.js` had to learn about scales.
 */

import { degreeToSemitone, resolveScale } from './scales.js';

/**
 * The instrument shelf. A voice merges over one of these, so a song only states
 * what it changes. `chromatic` voices take their pattern as literal semitones —
 * percussion, where the number transposes a noise band rather than naming a
 * note, and putting that through a scale would be meaningless.
 *
 * Every field here is a field `AudioEngine#_playMusicNote` reads; there is no
 * indirection. Fields: wave ('sawtooth'|'square'|'triangle'|'sine'|'noise'),
 * octave (× 12 semitones), detuneCents (a second oscillator, for warmth),
 * gain (linear), attack/hold/release (seconds), cutoffHz + q (the filter).
 */
export const INSTRUMENTS = {
  /** The floor. Present in nearly every track; it is what you drive to. */
  bass: { wave: 'sawtooth', octave: -1, detuneCents: 6, gain: 0.2, attack: 0.004, hold: 0.03, release: 0.13, cutoffHz: 520, q: 3.0 },
  /** Lower and rounder — weight rather than movement. */
  subBass: { wave: 'square', octave: -2, detuneCents: 0, gain: 0.16, attack: 0.006, hold: 0.1, release: 0.5, cutoffHz: 380, q: 2.0 },
  /** Slow, wide, overlapping. Sets the harmony without anyone noticing. */
  pad: { wave: 'sawtooth', octave: 0, detuneCents: 11, gain: 0.09, attack: 0.6, hold: 1.1, release: 1.4, cutoffHz: 900, q: 0.9 },
  /** A pad that never quite stops. For stages that need one held breath. */
  drone: { wave: 'sawtooth', octave: -1, detuneCents: 5, gain: 0.13, attack: 2.2, hold: 2.6, release: 3.0, cutoffHz: 460, q: 0.7 },
  /** The tune, when a stage gets one. */
  lead: { wave: 'triangle', octave: 1, detuneCents: 0, gain: 0.12, attack: 0.01, hold: 0.05, release: 0.55, cutoffHz: 2400, q: 1.0 },
  /** High, clean, long tail. Reads as distance and cold. */
  bell: { wave: 'sine', octave: 2, detuneCents: 0, gain: 0.1, attack: 0.005, hold: 0.02, release: 1.3, cutoffHz: 3200, q: 0.8 },
  /** Short and dry. Rhythm you can hear pitch in. */
  pluck: { wave: 'square', octave: 1, detuneCents: 0, gain: 0.09, attack: 0.003, hold: 0.02, release: 0.2, cutoffHz: 1900, q: 4.0 },
  /** Detuned and resonant — a chord hit, not a note. */
  stab: { wave: 'sawtooth', octave: 1, detuneCents: 18, gain: 0.11, attack: 0.004, hold: 0.02, release: 0.22, cutoffHz: 1800, q: 5.0 },
  /** Noise through a bandpass. The pattern value moves the band, not a pitch. */
  hat: { wave: 'noise', octave: 0, gain: 0.1, attack: 0.001, hold: 0.0, release: 0.05, cutoffHz: 5200, q: 1.4, chromatic: true },
  snare: { wave: 'noise', octave: 0, gain: 0.12, attack: 0.001, hold: 0.01, release: 0.12, cutoffHz: 2400, q: 1.0, chromatic: true },
};

/** Anything a voice neither states nor inherits from an instrument. */
export const VOICE_DEFAULTS = {
  wave: 'sawtooth',
  octave: 0,
  detuneCents: 0,
  gain: 0.1,
  attack: 0.01,
  hold: 0.05,
  release: 0.4,
  cutoffHz: 1600,
  q: 1.0,
};

/** The fields a voice may override. Everything else in a voice is compiler input. */
const VOICE_FIELDS = Object.keys(VOICE_DEFAULTS);

/**
 * Patterns are read at a glance or they are not read at all, and a bar of
 * sixteenths is mostly silence. `[0, ...rest(3), 4, ...rest(3)]` says "root,
 * three off, fifth, three off" — `[0,null,null,null,4,null,null,null]` says
 * nothing.
 * @param {number} n
 * @returns {null[]}
 */
export function rest(n) {
  return new Array(Math.max(0, n | 0)).fill(null);
}

/** Biggest grid the compiler will build for itself. See `gridSteps`. */
const MAX_STEPS = 256;

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

/**
 * How many steps the track's own counter runs before it repeats.
 *
 * This matters more than it looks. `AudioEngine` advances one counter modulo
 * `steps` and each voice reads `pattern[step % pattern.length]` — so a 13-step
 * riff against a 16-step grid is NOT polymeter, it is a 16-step riff with three
 * steps of the 13 never heard. Real polymeter needs the grid to be the common
 * multiple, and that is what this computes: give a track a 16 and a 12 and it
 * runs 48 steps, the two lines drifting apart and back exactly as written.
 *
 * Above `MAX_STEPS` the least common multiple stops being a musical idea and
 * starts being an accident (15 against 16 is a 240-step phrase nobody will ever
 * hear the end of), so it falls back to the longest pattern and the shorter
 * ones simply loop inside it.
 */
function gridSteps(lengths) {
  if (!lengths.length) return 16;
  const grid = lengths.reduce(lcm, 1);
  return grid <= MAX_STEPS ? grid : Math.max(...lengths);
}

/** Degrees → semitones, or straight through for percussion. */
function compilePattern(trackId, voiceName, pattern, scale, chromatic) {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    throw new Error(`track "${trackId}": voice "${voiceName}" has no pattern`);
  }
  return pattern.map((entry, i) => {
    if (entry === null || entry === undefined) return null;
    if (!Number.isInteger(entry)) {
      throw new Error(`track "${trackId}": voice "${voiceName}" step ${i} is "${entry}", not a degree or null`);
    }
    return chromatic ? entry : degreeToSemitone(scale, entry);
  });
}

/**
 * Compile a composition into the sequencer's shape.
 *
 * @param {object} def
 * @param {string} def.id            registry key; what a level's `music:` says
 * @param {string} [def.name]        human name, for tools
 * @param {number} def.bpm
 * @param {number} [def.stepsPerBeat=4]  4 = sixteenths, 2 = eighths, 1 = quarters
 * @param {number} [def.steps]       grid length; defaults to the LCM of the voices
 * @param {number} def.root          MIDI note. 38 = D2, 45 = A2.
 * @param {string|number[]} [def.scale='minorPentatonic']
 * @param {Record<string, object>} def.voices
 */
export function defineTrack(def) {
  if (!def?.id) throw new Error('defineTrack: a track needs an id');
  if (!Number.isFinite(def.bpm) || def.bpm <= 0) throw new Error(`track "${def.id}": bpm must be a positive number`);
  if (!Number.isFinite(def.root)) throw new Error(`track "${def.id}": root must be a MIDI note number`);

  const trackScale = resolveScale(def.scale ?? 'minorPentatonic');
  const voices = {};
  const lengths = [];

  for (const [key, v] of Object.entries(def.voices || {})) {
    // The voice's key names its instrument unless it says otherwise, so a voice
    // called `bass` needs to say nothing but its pattern, and one called
    // `shimmer` says `instrument: 'pad'` once.
    const base = INSTRUMENTS[v.instrument || key] || VOICE_DEFAULTS;
    const scale = v.scale ? resolveScale(v.scale) : trackScale;
    const pattern = compilePattern(def.id, key, v.pattern, scale, base.chromatic || v.chromatic);

    const voice = { pattern };
    for (const f of VOICE_FIELDS) voice[f] = v[f] ?? base[f] ?? VOICE_DEFAULTS[f];
    voices[key] = voice;
    lengths.push(pattern.length);
  }

  if (lengths.length === 0) throw new Error(`track "${def.id}": a song needs at least one voice`);

  return {
    id: def.id,
    name: def.name || def.id,
    bpm: def.bpm,
    stepsPerBeat: def.stepsPerBeat ?? 4,
    steps: def.steps ?? gridSteps(lengths),
    root: def.root,
    /** Kept for tools and tests; the sequencer never reads it. */
    scale: def.scale ?? 'minorPentatonic',
    voices,
  };
}
