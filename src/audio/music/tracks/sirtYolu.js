/**
 * SIRT YOLU — bölüm 3, the ridge road at night.
 *
 * F AEOLIAN. The natural minor, the plainly introspective one. No borrowed
 * brightness, no raised anything: this is the first stage that is dark rather
 * than merely dim, and the mode does not argue with it.
 *
 * What makes it a night drive instead of a lament is the rhythm — the bass is
 * on sixteenths and almost never leaves the root, so the song has no room to
 * be mournful. It only sits still and goes fast. The one place it moves is the
 * flat 6th (Db, degree 5), which is where the headlights find the drop.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'sirtYolu',
  name: 'Sırt Yolu',
  bpm: 138,
  root: 41, // F2
  scale: 'aeolian',
  voices: {
    bass: { pattern: [0, 0, null, 0, null, 0, null, 0, 5, null, 0, null, 4, null, 3, null] },
    // Two hits a bar, high and resonant. Headlights across a rock face.
    stab: { pattern: [...rest(6), 7, null, ...rest(4), 9, null, ...rest(2)] },
    // Root, then the flat 6th held under everything: the mode's cold note.
    pad: { pattern: [0, ...rest(7), 5, ...rest(7)] },
    hat: { pattern: [0, null, 0, null, 0, null, 0, 4, 0, null, 0, null, 0, null, 4, 0] },
  },
});
