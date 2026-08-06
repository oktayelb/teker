/**
 * GÖL KIYISI — bölüm 5, the lake shore in the rain.
 *
 * D KUMOI, with a WHOLE-TONE shimmer over the top. Two scales, two jobs.
 *
 * Kumoi is a five-note scale that is melancholy without being heavy — serene is
 * the usual word. Five notes means nothing in the melody can clash with
 * anything else in it, which is what lets this track be slower and more open
 * than the stages around it without falling apart under an engine.
 *
 * The `shimmer` voice leaves the key entirely and plays whole-tone: six equal
 * steps, no leading tone, no home. That is the scale classical music uses for
 * water and for dreams, precisely because it will not resolve. Its four notes
 * here — D, E, G#, C — are a whole-tone tetrachord, and each is placed where
 * the bass is consonant with it, so the pad reads as light on the surface of
 * the lake rather than as a wrong note. This is the pattern to copy for any
 * future weather stage: keep the floor tonal, colour the air.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'golKiyisi',
  name: 'Göl Kıyısı',
  bpm: 116,
  root: 38, // D2
  scale: 'kumoi',
  voices: {
    // D – B – A – F. Rocking rather than driving; the stage is wet and slow.
    bass: { pattern: [0, null, 0, null, 4, null, null, null, 3, null, 3, null, 2, null, null, null] },
    // Ten steps against sixteen — the drops never fall on the same beat twice.
    bell: { pattern: [5, null, 7, null, null, 6, null, null, 8, null] },
    shimmer: {
      instrument: 'pad',
      scale: 'wholeTone',
      gain: 0.075, // it is weather, not harmony — keep it under everything
      pattern: [0, ...rest(3), 1, ...rest(3), 5, ...rest(3), 3, ...rest(3)],
    },
    hat: { gain: 0.07, cutoffHz: 4200, pattern: [null, 0, null, null, null, 0, null, 0] },
  },
});
