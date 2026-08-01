/**
 * The parkours, in the order the game presents them.
 *
 * Adding a track is a matter of dropping a file in this folder and adding it to
 * `ALL_TRACKS`. Nothing else in the codebase needs to know it exists.
 */

import track1 from './track1.js';
import track2 from './track2.js';
import track3 from './track3.js';

export const ALL_TRACKS = [track1, track2, track3];

/** The scripted sequence of races the intro plays. */
export const RACE_ORDER = ['track1', 'track2', 'track3'];

export function trackById(id) {
  return ALL_TRACKS.find((t) => t.id === id) || null;
}

export { track1, track2, track3 };
