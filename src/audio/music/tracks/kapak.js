/**
 * KAPAK — bölüm 8, the lid. The race that does not end.
 *
 * C# OCTATONIC (half-whole). Eight notes, alternating half and whole steps: a
 * symmetrical scale, which means it has no home. Every note is as much the root
 * as every other one, so the ear never finds a floor to stand on — which is why
 * it is the suspense scale, and why Stravinsky and every film composer since
 * uses it for the moment something is revealed to be wrong.
 *
 * It is also, technically, why this song fits under a race and still feels like
 * a trap: the symmetry gives you a tritone (degree 4, G) that sounds like a
 * fifth if you do not listen closely, and a flat 2nd (degree 1, D) grinding
 * against the root.
 *
 * The root is C#2, the same root as the `chase` track in `core.js`. That is not
 * a coincidence and should not be tidied: when the chase music takes over on
 * this stage, it takes over in the same key, and the change reads as the
 * simulation dropping a mask rather than as a new song starting.
 *
 * Thirteen-step stabs against a sixteen-step bass. The grid is 208 steps —
 * twenty seconds before the pattern repeats, which is longer than most players
 * survive here.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'kapak',
  name: 'Kapak',
  bpm: 150,
  root: 37, // C#2 — the chase's key. See the header.
  scale: 'octatonic',
  voices: {
    bass: { pattern: [0, 0, null, 0, 1, null, 0, null, 0, 0, null, 4, null, 0, 3, null] },
    stab: { pattern: [0, null, null, 4, null, null, 7, null, null, 1, null, null, 6] },
    // Root, then a semitone above it, both held. The two never agree.
    pad: { pattern: [0, ...rest(7), 1, ...rest(7)] },
    hat: { gain: 0.11, pattern: [0, null, 0, 0, null, 0, null, 0, 0, null, 0, null, 0, 0, null, 0] },
  },
});
