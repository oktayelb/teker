/**
 * ÇAM HALKASI — bölüm 1, the pine ring.
 *
 * D DORIAN. Minor with a raised 6th: the mode that is sad on paper and
 * optimistic in the ear, which is why racing games keep landing on it. It has
 * somewhere to go without ever sounding like a warning, and bölüm 1 is the
 * stage where nothing has gone wrong yet.
 *
 * The B natural — the raised 6th, the note that makes this Dorian instead of a
 * plain minor — is deliberately kept out of the bass and handed to the lead
 * (degree 12). You hear the mode as a colour on the melody rather than as a
 * chord, which is the difference between "hopeful" and "cheerful".
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'camHalkasi',
  name: 'Çam Halkası',
  bpm: 126,
  root: 38, // D2
  scale: 'dorian',
  voices: {
    // D – A – C – G – A. Root, fifth, flat seventh, fourth: the ground under it
    // never leaves the mode, so the melody can wander.
    bass: { pattern: [0, null, 0, null, 4, null, 0, null, 6, null, 0, null, 3, null, 4, null] },
    // Two long tones, F then A. A minor third and a fifth over the root: warmth
    // with no opinion about where the song is going.
    pad: { pattern: [2, ...rest(7), 4, ...rest(7)] },
    // D – F – B – A – F. The B is the Dorian sixth and the whole point.
    lead: { pattern: [...rest(4), 7, null, 9, null, ...rest(2), 12, null, 11, null, 9, null] },
    hat: { pattern: [null, null, 0, null, null, null, 0, 4] },
  },
});
