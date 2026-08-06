/**
 * HAVAİ HAT — bölüm 9, the skyway.
 *
 * E PHRYGIAN. Minor with a flat 2nd. That b2 leaning down onto the root is the
 * whole mode: unresolved yearning, a step that is too small. Phrygian is the
 * one mode that sounds like it is about to fall, which is the correct feeling
 * for a road with nothing under it, driven by somebody who now knows what the
 * road is.
 *
 * It is a deliberate echo of bölüm 4's phrygian dominant — same flat 2nd, but
 * with the minor 3rd restored, so the heat is gone and only the tension is
 * left. If you play the two back to back you should hear the same building,
 * lit differently.
 *
 * The lead sits mostly on F (degree 8, the flat 2nd an octave up) and refuses
 * to come down to E until the very end of the phrase.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'havaiHat',
  name: 'Havai Hat',
  bpm: 134,
  root: 40, // E2
  scale: 'phrygian',
  voices: {
    // E – F – D – C – F: the Phrygian descent, bII and bVII and bVI.
    bass: { pattern: [0, null, 0, null, 1, null, 0, null, 6, null, 0, null, 5, null, 1, null] },
    lead: { pattern: [...rest(2), 8, null, 7, null, ...rest(2), 9, null, 8, null, 7, null, 1, null] },
    pad: { pattern: [3, ...rest(7), 1, ...rest(7)] },
    hat: { pattern: [0, null, null, 0, null, 0, null, null] },
  },
});
