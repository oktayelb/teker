/**
 * VİYADÜK — bölüm 6, the viaduct in the mist.
 *
 * G LYDIAN. Major with a raised 4th, and that one note is the whole reason:
 * the #4 is the interval film scores use when something is supposed to feel
 * wondrous and slightly unreal. Bölüm 6 is a road held up in the air inside a
 * cloud, and it is the last stage before the game starts telling the truth —
 * so it gets the brightest mode in the book, used slightly wrong.
 *
 * The C# (degree 10, the raised 4th) belongs to the `bell` and nothing else.
 * The bass stays on root, fifth and sixth, which are the three degrees Lydian
 * shares with a plain major scale — so the ground is ordinary and only the air
 * above it is strange. Put the #4 in the bass and the track stops sounding like
 * height and starts sounding like a mistake.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'viyaduk',
  name: 'Viyadük',
  bpm: 130,
  root: 43, // G2
  scale: 'lydian',
  voices: {
    bass: { pattern: [0, null, 0, null, 4, null, 0, null, 5, null, 5, null, 4, null, 4, null] },
    // G – B – C# – D – B – G. The third note is the one you remember.
    bell: { pattern: [...rest(2), 7, null, 9, null, 10, null, ...rest(2), 11, null, 9, null, 7, null] },
    pad: { pattern: [2, ...rest(7), 4, ...rest(7)] },
    // Thin and late. There is not much to hit up here.
    hat: { gain: 0.08, pattern: [...rest(3), 0, ...rest(3), 0, ...rest(3), 0, null, null, 0, 4] },
  },
});
