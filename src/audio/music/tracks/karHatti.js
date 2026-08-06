/**
 * KAR HATTI — bölüm 7, the snow line.
 *
 * A HIRAJOSHI, iced with WHOLE TONE. Hirajoshi is a five-note Japanese scale
 * whose usual description is "wistful and contemplative" — it is the scale
 * reached for when the subject is stillness. Two of its five notes are a
 * semitone apart from their neighbours, so a melody in it always sounds like it
 * is holding something back. That is snow: a lot of space and one cold note.
 *
 * Everything here is written for a stage where the weather is louder than the
 * car. The bass is on quarter notes, the percussion is muffled (a low cutoff on
 * the hat, because snow eats transients and a bright hi-hat over a blizzard
 * reads as a different game), and the `ice` pad plays whole-tone in twelve
 * against the bass's sixteen — a 48-step grid, so the two never quite settle.
 *
 * Its two whole-tone notes, A and F, happen to be in hirajoshi too, so the ice
 * never argues with the tune. It only refuses to belong to it.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'karHatti',
  name: 'Kar Hattı',
  bpm: 120,
  root: 45, // A2
  scale: 'hirajoshi',
  voices: {
    // A – F – E – C. The F is the flat 6th, and it is what makes this cold
    // rather than merely quiet.
    bass: { pattern: [0, null, null, null, 0, null, 4, null, 3, null, null, null, 2, null, null, null] },
    // A – C – E – C, high and with a long tail. A minor triad taken apart.
    bell: { pattern: [...rest(4), 5, null, 7, null, ...rest(4), 8, null, 7, null] },
    ice: {
      instrument: 'pad',
      scale: 'wholeTone',
      gain: 0.08,
      release: 2.2, // longer than the pad default: it has to hang in the air
      pattern: [0, ...rest(5), 4, ...rest(5)],
    },
    // Muffled on purpose. See the header.
    hat: { gain: 0.06, cutoffHz: 2600, pattern: [null, null, 0, null, null, null, 0, null] },
  },
});
