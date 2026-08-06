/**
 * LEVELS — what a level IS, and everything a level file gets for free.
 *
 * ONE LEVEL, ONE MAP
 * ------------------
 * A level owns a world. Not a corner of a world — the whole thing: its own
 * terrain, its own seed, its own forest, its own landmarks, its own weather and
 * its own parkour standing in the middle of it. Two levels never share ground,
 * because two levels are never built at the same time: entering a level builds
 * its world and throws the previous one away (`src/game/levels.js`).
 *
 * That is the reason `seed` defaults to a hash of the level's id rather than to
 * a constant. Author a new level, give it a name, and it is on land nobody has
 * driven on — without having to remember to pick a number nobody else used.
 *
 * ADDING A LEVEL
 * --------------
 *   1. Copy the shortest existing file in this folder (`level2.js`).
 *   2. Change `id`, `name`, and the `track.points`.
 *   3. Add two lines to `index.js`: the import, and the entry in `LEVELS`.
 *   4. Write it a song — one file in `src/audio/music/tracks/`, two lines in
 *      `src/audio/music/index.js`, and `music:` here. A map with somebody
 *      else's music on it is a map nobody remembers.
 *
 * That is the whole procedure. Everything below is a default you may override
 * and never have to state:
 *
 *   theme/ambience/music   what the level looks and sounds like
 *   race.laps / race.rivals   the rules of its race
 *   map.seed               the land it stands on
 *   map.terrain            how big and how finely that land is built
 *   map.scatter            how thick the forest is
 *   map.landmarks          six places to drive to, rotated per level
 *   map.trails             the ruts somebody wore into it before you
 *   map.domes              whether the parkour is under glass
 *   story.beats            subtitle ids, `<id>.pre` / `<id>.post` by convention
 *
 * WHERE TO PUT A PARKOUR'S POINTS. Around the origin. The map is built around
 * the track, the landmarks are placed relative to the map, and the world's rim
 * closes in at 72% of `halfSpan` — so a parkour authored a kilometre off-centre
 * spends half its lap climbing the edge of the world. Every track in here is
 * centred on (0, 0) and none of them is wider than 600 metres.
 */

import { LANDMARK_DEFS } from '../world/world.js';
import { OPEN_WORLD, RACE } from '../config/gameplay.js';
import { hashString } from '../core/rng.js';

/**
 * Everything a level file may leave unsaid.
 *
 * `map` is handed to `World` as its spec; see `World#_resolveSpec`, which
 * applies the same defaults again for anyone building a world without a level
 * (the headless tests do).
 */
export const LEVEL_DEFAULTS = {
  theme: 'forest',
  ambience: 'forest',
  /**
   * The fallback song, not the expected one. Every shipped level names its own
   * (`music: 'karHatti'`), composed for that map's weather and time of day —
   * see `src/audio/music/`. A level that says nothing races to the generic
   * loop, which is fine while you are still laying out its road and a smell
   * you should not ship.
   */
  music: 'race',
  race: {
    laps: RACE.laps,
    rivals: RACE.rivals,
  },
  map: {
    terrain: {
      resolution: OPEN_WORLD.terrainResolution,
      cellSize: OPEN_WORLD.terrainCellSize,
    },
    /** Per-kind counts, merged over `OPEN_WORLD.scatterDensity`. */
    scatter: null,
    /** Multiplies every scatter count. A cheaper map is one number, not eight. */
    density: 1,
    /** `null` → the default six, rotated by the level's own seed. */
    landmarks: null,
    /** `false` switches the worn routes off entirely. */
    trails: true,
    /** Glass over the parkour. See `src/world/dome.js`. */
    domes: true,
  },
};

/**
 * Turn a level file's default export into the object the game consumes.
 *
 * Everything the author did not say is filled in from `LEVEL_DEFAULTS`, and two
 * things are derived rather than defaulted:
 *
 *   `map.seed`     — hashed from the id, so every level is on different land by
 *                    construction rather than by the author remembering.
 *   `map.landmarks` — the standard six, rotated by that seed, so the valley,
 *                    the mast and the lake are not in the same place on every
 *                    map. The rotation preserves index order, which matters:
 *                    `OPEN_WORLD.trails.links` indexes into this array.
 *
 * @param {object} def a level module's default export
 * @returns {object} a resolved level
 */
export function defineLevel(def) {
  if (!def?.id) throw new Error('defineLevel: a level needs an id');
  const tracks = def.tracks || (def.track ? [def.track] : []);
  if (tracks.length === 0) throw new Error(`Level "${def.id}" has no track`);

  const seed = def.map?.seed ?? (hashString(`map:${def.id}`) & 0x7fffffff);
  const map = { ...LEVEL_DEFAULTS.map, ...(def.map || {}) };
  map.seed = seed;
  map.terrain = { ...LEVEL_DEFAULTS.map.terrain, ...(def.map?.terrain || {}) };
  map.landmarks = map.landmarks ?? rotateLandmarks(LANDMARK_DEFS, seed);

  return {
    ...def,
    id: def.id,
    /** Filled in by `index.js` from the order levels are listed in. */
    index: def.index ?? 0,
    name: def.name || def.id,
    subtitle: def.subtitle || '',
    theme: def.theme || LEVEL_DEFAULTS.theme,
    ambience: def.ambience || def.theme || LEVEL_DEFAULTS.ambience,
    music: def.music ?? LEVEL_DEFAULTS.music,
    race: { ...LEVEL_DEFAULTS.race, ...(def.race || {}) },
    map,
    /**
     * Every parkour on this level's map. One, nearly always — but a level that
     * wants a service road beside its stage costs nothing to express, and the
     * world already builds a list.
     */
    tracks: tracks.map((t, i) => ({
      // A track's id and name default to the level's, because a level has one
      // map and one parkour on it, and naming the same thing twice is how the
      // two drift apart. A second ribbon on the same map has to say who it is.
      id: t.id || (i === 0 ? def.id : `${def.id}-${i}`),
      name: t.name || (i === 0 ? def.name : `${def.name} ${i + 1}`),
      subtitle: t.subtitle || (i === 0 ? def.subtitle : ''),
      ...t,
    })),
    /**
     * Read only by `src/game/intro/` — the story staged over the top. A level
     * with none is a level the director will simply race and move on from.
     */
    story: def.story || null,
  };
}

/** The first parkour on a level's map. What "the track" means, unqualified. */
export function levelTrack(level) {
  return level.tracks[0];
}

/**
 * The standard landmark set, turned around the map by a seeded angle.
 *
 * Cheap variety with a real payoff: the six places are polar (`angle`, `dist`),
 * so one rotation puts the lake on the far side of the ridge for the next
 * level and drags the whole trail network with it — the routes are drawn from
 * the landmarks down to the parkour, and both ends have moved.
 *
 * @param {object[]} defs `LANDMARK_DEFS` or a level's own list
 * @param {number} seed
 */
export function rotateLandmarks(defs, seed) {
  const turn = ((seed % 6283) / 1000) % (Math.PI * 2);
  return defs.map((d) => ({ ...d, angle: (d.angle + turn) % (Math.PI * 2) }));
}
