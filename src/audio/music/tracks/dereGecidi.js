/**
 * DERE GEÇİDİ — bölüm 2, the creek crossing.
 *
 * E MIXOLYDIAN. Major with a flat 7th. Bright and rolling, but the b7 keeps it
 * off the nose — it is the mode of folk tunes and open road, daylight without
 * the sugar of a straight major scale. Bölüm 2 is still the easy world; this is
 * what the easy world sounds like when it is also moving water.
 *
 * The water is the `pluck`: a twelve-step arpeggio against a sixteen-step
 * bassline, so the grid is 48 and the two lines drift apart and meet again over
 * three bars. Nothing about the figure changes — it only ever lands somewhere
 * else, which is roughly what a creek does.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'dereGecidi',
  name: 'Dere Geçidi',
  bpm: 132,
  root: 40, // E2
  scale: 'mixolydian',
  voices: {
    // E – B – D – A: I, V, bVII, IV. The bVII is the mode announcing itself.
    bass: { pattern: [0, null, 0, 4, null, 0, null, 6, 0, null, 0, 3, null, 6, null, 4] },
    // Twelve against sixteen. See the header.
    pluck: { pattern: [0, null, 4, null, 7, null, 4, null, 6, null, 4, null] },
    pad: { pattern: [2, ...rest(7), 6, ...rest(7)] },
    hat: { pattern: [null, null, 0, null, null, null, 0, 4] },
  },
});
