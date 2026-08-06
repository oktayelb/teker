/**
 * THE SOUNDTRACK, as a registry.
 *
 * Every song the game can play, keyed by the name a level (or the story) asks
 * for. `AUDIO_CONFIG.MUSIC.tracks` is this object — `audio.js` imports it and
 * otherwise knows nothing about how a song was written.
 *
 * ADDING A SONG IS ONE FILE AND TWO LINES
 * ---------------------------------------
 *   1. `tracks/<name>.js`, copying the shortest one there (`camHalkasi.js`).
 *      Pick the scale first, by mood — `./scales.js` says what each one is for.
 *   2. Here: the import, and the entry in `register([...])`.
 *   3. In the level file: `music: '<name>'`.
 *
 * There is no auto-discovery, for the same reason `src/levels/index.js` has
 * none: no build step, and a folder cannot be listed over HTTP.
 *
 * WHICH SONG PLAYS WHEN
 * ---------------------
 *   a race        the level's `music:`, or `race` if it does not say
 *                 (`raceMode.enter` → `LEVEL_DEFAULTS.music`)
 *   the title      `menu`             (`intro/introDirector.js`)
 *   being chased   `chase`            (`game/chase.js`)
 *   after the door `alone`            (`game/chase.js`)
 *
 * The last three belong to the game rather than to a stage, and are the ones a
 * new level must NOT change: the story sounds the same whichever map it broke
 * on. See `tracks/core.js`.
 */

import { alone, chase, menu, race } from './tracks/core.js';

import camHalkasi from './tracks/camHalkasi.js';
import dereGecidi from './tracks/dereGecidi.js';
import sirtYolu from './tracks/sirtYolu.js';
import tasocagi from './tracks/tasocagi.js';
import golKiyisi from './tracks/golKiyisi.js';
import viyaduk from './tracks/viyaduk.js';
import karHatti from './tracks/karHatti.js';
import kapak from './tracks/kapak.js';
import havaiHat from './tracks/havaiHat.js';
import sonHalka from './tracks/sonHalka.js';

/**
 * id → track. Refuses duplicates: two songs with one name would present as one
 * of them simply never playing, on a stage, once, with no error anywhere.
 */
function register(tracks) {
  const byId = {};
  for (const t of tracks) {
    if (byId[t.id]) throw new Error(`Two music tracks share the id "${t.id}"`);
    byId[t.id] = t;
  }
  return byId;
}

export const MUSIC_TRACKS = register([
  // The game's own four.
  menu,
  race,
  chase,
  alone,
  // One per bölüm, in play order.
  camHalkasi,
  dereGecidi,
  sirtYolu,
  tasocagi,
  golKiyisi,
  viyaduk,
  karHatti,
  kapak,
  havaiHat,
  sonHalka,
]);

/** Every name `audio.setMusic()` will accept, besides `'none'`. */
export const MUSIC_TRACK_IDS = Object.keys(MUSIC_TRACKS);

export function musicTrack(id) {
  return MUSIC_TRACKS[id] || null;
}
