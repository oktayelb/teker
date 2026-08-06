/**
 * THE FOUR THAT DO NOT BELONG TO A LEVEL.
 *
 * The title screen, the fallback race loop, the chase, and whatever is left
 * playing once the player is outside. These are the game's own voice rather
 * than a stage's, so they are fixed: a level may change what a race sounds
 * like, but being chased sounds like being chased everywhere, and the music
 * after the door sounds the same no matter which door you came through.
 *
 * They are written in `chromatic`, which makes a "degree" a plain semitone —
 * these four were hand-voiced note by note before `defineTrack` existed and are
 * reproduced here exactly, down to the explicit `steps`. Do not helpfully
 * re-key them into a mode. New songs go in their own file next to this one.
 */

import { defineTrack } from '../track.js';

/** Title screen. Patient, minor, a bit too still. */
export const menu = defineTrack({
  id: 'menu',
  name: 'ANA MENÜ',
  bpm: 68,
  stepsPerBeat: 2, // 8th notes
  steps: 16,
  root: 45, // A2
  scale: 'chromatic',
  voices: {
    pad: {
      wave: 'sawtooth', octave: -1, detuneCents: 9, gain: 0.2,
      attack: 1.4, hold: 2.2, release: 2.4, cutoffHz: 620, q: 0.8,
      pattern: [0, null, null, null, null, null, null, null, 7, null, null, null, null, null, null, null],
    },
    bass: {
      wave: 'square', octave: -2, detuneCents: 0, gain: 0.16,
      attack: 0.006, hold: 0.1, release: 0.5, cutoffHz: 380, q: 2.0,
      pattern: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, 5, null],
    },
    lead: {
      wave: 'triangle', octave: 1, detuneCents: 0, gain: 0.13,
      attack: 0.01, hold: 0.04, release: 0.85, cutoffHz: 2400, q: 1.0,
      pattern: [null, null, 12, null, null, null, null, 15, null, null, null, null, 19, null, null, 12],
    },
  },
});

/**
 * Racing, generic. Forward motion, no melody to speak of.
 *
 * Every shipped level names its own song, so this is now the *fallback* — what
 * `LEVEL_DEFAULTS.music` points at, and therefore what a half-written level
 * races to before somebody composes for it.
 */
export const race = defineTrack({
  id: 'race',
  name: 'YARIŞ',
  bpm: 132,
  stepsPerBeat: 4, // 16ths
  steps: 16,
  root: 38, // D2
  scale: 'chromatic',
  voices: {
    bass: {
      wave: 'sawtooth', octave: -1, detuneCents: 6, gain: 0.2,
      attack: 0.004, hold: 0.03, release: 0.13, cutoffHz: 520, q: 3.0,
      pattern: [0, null, 0, null, 0, null, 3, null, 0, null, 0, null, 5, null, 3, null],
    },
    perc: {
      wave: 'noise', octave: 0, gain: 0.1,
      attack: 0.001, hold: 0.0, release: 0.05, cutoffHz: 5200, q: 1.4,
      pattern: [null, null, 0, null, null, null, 0, null, null, null, 0, null, null, 7, 0, null],
    },
    pad: {
      wave: 'sawtooth', octave: 0, detuneCents: 11, gain: 0.09,
      attack: 0.6, hold: 1.1, release: 1.4, cutoffHz: 900, q: 0.9,
      pattern: [10, null, null, null, null, null, null, null, 8, null, null, null, null, null, null, null],
    },
  },
});

/** The chase. Faster, a semitone rubbing against itself. */
export const chase = defineTrack({
  id: 'chase',
  name: 'TAKİP',
  bpm: 152,
  stepsPerBeat: 4,
  steps: 16,
  root: 37, // C#2
  scale: 'chromatic',
  voices: {
    bass: {
      wave: 'square', octave: -1, detuneCents: 0, gain: 0.22,
      attack: 0.003, hold: 0.02, release: 0.1, cutoffHz: 640, q: 4.0,
      pattern: [0, 0, null, 0, null, 0, 0, null, 1, null, 0, null, 0, 0, null, 11],
    },
    stab: {
      wave: 'sawtooth', octave: 1, detuneCents: 18, gain: 0.11,
      attack: 0.004, hold: 0.02, release: 0.22, cutoffHz: 1800, q: 5.0,
      // 13 steps against a 16-step grid: the tail is deliberately unreachable,
      // which is what makes the line sound bent rather than looped.
      pattern: [0, null, null, 1, null, null, null, 0, null, null, 6, null, null],
    },
    perc: {
      wave: 'noise', octave: 0, gain: 0.12,
      attack: 0.001, hold: 0.0, release: 0.04, cutoffHz: 6400, q: 1.2,
      pattern: [0, null, 0, 0, null, 0, null, 0, 0, null, 0, null, 0, 0, null, 0],
    },
  },
});

/** After. Almost nothing — just enough to prove the world still runs. */
export const alone = defineTrack({
  id: 'alone',
  name: 'DIŞARISI',
  bpm: 48,
  stepsPerBeat: 1, // quarter notes
  steps: 8,
  root: 41, // F2
  scale: 'chromatic',
  voices: {
    pad: {
      wave: 'sawtooth', octave: -1, detuneCents: 5, gain: 0.18,
      attack: 2.6, hold: 3.0, release: 3.4, cutoffHz: 420, q: 0.7,
      pattern: [0, null, null, null, null, null, null, null],
    },
    lead: {
      wave: 'sine', octave: 1, detuneCents: 0, gain: 0.1,
      attack: 0.05, hold: 0.2, release: 2.0, cutoffHz: 1800, q: 0.8,
      // Eleven against a grid of eight, and the grid wins: only the 7 is ever
      // reached. It has always sounded like this and it is the right amount of
      // nothing, so the 8 stays stated rather than computed.
      pattern: [null, null, null, 7, null, null, null, null, null, 12, null],
    },
  },
});
