/**
 * SCALES — the colour a level is written in.
 *
 * A scale is just a list of semitone offsets from a root, but it is the single
 * biggest lever on how a stage *feels*. Every mode has one note that gives it
 * its identity, and that one altered note is enough to move a piece from warm
 * to sinister without changing a single rhythm. That is why the level tracks in
 * `./tracks/` are authored in scale **degrees** rather than semitones: swap the
 * scale on a track and the whole song moves with it, still in tune.
 *
 * WHY EACH ONE IS HERE
 * --------------------
 * The notes below are the reason a given map got a given scale. They are not
 * decoration — if you add a level, pick its scale from this list by mood first
 * and transpose later.
 *
 *   dorian            minor with a raised 6th. Melancholy that is still moving
 *                     forward — the racing-game mode (F-Zero's "Mute City"
 *                     opens in it). Warm, not sad. → forest, first stages.
 *   mixolydian        major with a flat 7th. Bright and rolling without the
 *                     sugar of a straight major. → daylight, water, folk drive.
 *   aeolian           the natural minor. The introspective one, "a heartfelt
 *                     letter on a rainy afternoon". → night.
 *   phrygian          minor with a flat 2nd. Tension and yearning; that b2
 *                     leaning on the root is the whole mode. → thin air, dread.
 *   phrygianDominant  phrygian with a major 3rd — the flamenco/hijaz scale. The
 *                     augmented second (b2 → 3) is heat, dust and distance.
 *                     → quarries, deserts, anywhere the sun is the antagonist.
 *   lydian            major with a raised 4th. Whimsical wonder and altitude —
 *                     the mode film scores reach for when something is *magic*.
 *                     → mist, height, the viaduct.
 *   harmonicMinor     minor with a major 7th. The leading tone gives a cadence
 *                     that actually closes, and the b6 → 7 augmented second
 *                     makes it ceremonial. → finales.
 *   wholeTone         six equal steps, no leading tone, no home. Debussy's
 *                     water and dream music: deliberately unmoored. Used as a
 *                     *colour voice* over a tonal bass, not on its own.
 *                     → rain, ice, anything that shimmers.
 *   octatonic         alternating half and whole steps. Symmetrical, unstable,
 *                     sinister — the suspense scale. → the storm, the break.
 *   kumoi             Japanese pentatonic, melancholic but serene. Five notes
 *                     carry a melody without ever demanding resolution.
 *                     → still water.
 *   hirajoshi         Japanese pentatonic with a b2 and b5 flavour: wistful,
 *                     contemplative, dark-but-beautiful stillness. → snow.
 *   minorPentatonic   the safe one. Nothing in it can clash. → fallbacks.
 *   chromatic         all twelve. Degrees become plain semitones, which is how
 *                     the four hand-voiced tracks in `tracks/core.js` are
 *                     written — they predate this file and must not move.
 *
 * Sources for the mood readings are linked at the bottom of the README's
 * bölümler table; the short version is that these are the conventional
 * associations rather than house style, so they are worth trusting.
 */

/** name → semitone offsets from the root, ascending, one octave. */
export const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],

  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],

  wholeTone: [0, 2, 4, 6, 8, 10],
  /** Half-whole diminished. The other rotation is whole-half; this one first. */
  octatonic: [0, 1, 3, 4, 6, 7, 9, 10],

  kumoi: [0, 2, 3, 7, 9],
  hirajoshi: [0, 2, 3, 7, 8],
  minorPentatonic: [0, 3, 5, 7, 10],

  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/**
 * A scale from a name or from a literal array of offsets.
 * Throws rather than falling back: a typo'd mode that silently became aeolian
 * would be a song quietly written in the wrong colour, which is exactly the
 * kind of bug you never find by ear.
 * @param {string|number[]} ref
 * @returns {number[]}
 */
export function resolveScale(ref) {
  if (Array.isArray(ref)) {
    if (ref.length === 0) throw new Error('resolveScale: an empty scale has no notes');
    return ref;
  }
  const s = SCALES[ref];
  if (!s) throw new Error(`resolveScale: unknown scale "${ref}" (have: ${Object.keys(SCALES).join(', ')})`);
  return s;
}

/**
 * Scale degree → semitones above the root.
 *
 * Degrees run 0 = root, 1 = the next note *of this scale*, and keep going past
 * the octave: with a 7-note mode degree 7 is the octave, with a pentatonic
 * degree 5 is. Negative degrees walk down below the root the same way. This is
 * what lets one melody read correctly in a five-note scale and a seven-note
 * one — it is written in steps, not in intervals.
 *
 * @param {number[]} scale
 * @param {number} degree
 */
export function degreeToSemitone(scale, degree) {
  const n = scale.length;
  const oct = Math.floor(degree / n);
  return scale[degree - oct * n] + 12 * oct;
}
