/**
 * TAŞOCAĞI — bölüm 4, the quarry at dusk.
 *
 * E PHRYGIAN DOMINANT (hijaz). Phrygian with a major 3rd, which puts an
 * augmented second between the flat 2nd and the 3rd — F to G#. That interval is
 * the single most "hot, dry, far from home" sound in common practice; it is why
 * the mode carries flamenco and every desert cue ever written. The quarry is
 * the closest this game gets to a desert: cut stone, dust, low sun, nothing
 * growing.
 *
 * The bass hammers 0 → 1 (E → F). A flat 2nd falling onto the root is the
 * Andalusian cadence in miniature, and repeated under a race it stops being a
 * cadence and becomes heat.
 *
 * The lead runs fourteen steps against sixteen, so the phrase takes 112 steps
 * (seven bars) to come back to where it started. Nothing in a quarry lines up
 * either.
 */

import { defineTrack, rest } from '../track.js';

export default defineTrack({
  id: 'tasocagi',
  name: 'Taşocağı',
  bpm: 144,
  root: 40, // E2
  scale: 'phrygianDominant',
  voices: {
    bass: { pattern: [0, null, 0, 1, 0, null, 0, null, 6, null, 0, 1, 0, null, 5, null] },
    // B – G# – F – E, then back up through the augmented second. The descent is
    // the tune; the climb back is what makes it sound like it is refusing to end.
    lead: { pattern: [4, null, 2, null, 1, null, 0, null, 1, null, 2, null, null, null] },
    // A root pedal that shifts up one semitone and refuses to resolve.
    pad: { pattern: [0, ...rest(7), 1, ...rest(7)] },
    hat: { pattern: [0, null, null, 0, null, 0, null, null] },
  },
});
