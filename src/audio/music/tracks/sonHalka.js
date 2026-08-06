/**
 * SON HALKA — bölüm 10, the last ring. Night, and snow.
 *
 * A HARMONIC MINOR. Natural minor with the 7th raised back up, which does two
 * things no other minor mode does. It restores the leading tone, so a phrase
 * can actually *close* — the only track in the game that gets a real cadence,
 * and it gets it because it is the last one. And it opens an augmented second
 * between the flat 6th and that raised 7th (F to G#), the same interval that
 * makes bölüm 4 sound like a desert, here made ceremonial by being slow and in
 * a minor key.
 *
 * The bass walks E – F – E – G# – A: up to the flat 6th, across the augmented
 * second, and home. That is a formal ending, played once a bar, under a race
 * the player has been driving towards for nine stages.
 *
 * It closes the ring with bölüm 1 on purpose: `camHalkasi` is Dorian, a minor
 * that never resolves because it never needed to. This is the same darkness
 * with the door shut.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'sonHalka',
  name: 'Son Halka',
  bpm: 128,
  root: 45, // A2
  scale: 'harmonicMinor',
  voices: {
    bass: { pattern: [0, null, 0, null, 4, null, 0, null, 5, null, 4, null, 6, null, 0, null] },
    // A – C – E – D – C – A. Plain, and the last thing you hear.
    lead: { pattern: [...rest(4), 7, null, 9, null, 11, null, 10, null, 9, null, 7, null] },
    // C, then the raised 7th held underneath. That G# is the whole mode.
    pad: { pattern: [2, ...rest(7), 6, ...rest(7)] },
    hat: { pattern: [0, null, null, null, 0, null, null, 4, 0, null, null, null, 0, 4, null, 0] },
  },
});
