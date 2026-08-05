/**
 * THE LEVELS, in the order the game presents them.
 *
 * ADDING ONE IS TWO LINES IN THIS FILE
 * ------------------------------------
 *   import level4 from './level4.js';        // 1
 *   export const LEVELS = order([… , level4]); // 2
 *
 * …and one new file next to this one. Nothing else in the codebase needs to
 * know it exists: the world is built from the level's own map spec, the race is
 * run from its own rules, the minimap re-indexes itself, the boot options grow
 * a `?scene=race4`, and the intro director walks this array rather than a list
 * of names it holds itself. See `defaults.js` for what a level file may leave
 * unsaid, and `src/game/levels.js` for what happens when the player enters one.
 *
 * There is no auto-discovery because there is no build step: the browser is
 * loading these modules straight off disk, and a folder cannot be listed over
 * HTTP. Two lines is the price of that, and it buys explicit ordering.
 */

import level1 from './level1.js';
import level2 from './level2.js';
import level3 from './level3.js';
import level4 from './level4.js';
import level5 from './level5.js';
import level6 from './level6.js';
import level7 from './level7.js';
import level8 from './level8.js';
import level9 from './level9.js';
import level10 from './level10.js';

/**
 * Stamp each level with its position, so nothing has to be numbered by hand —
 * and refuse two levels with the same id, which would otherwise present as one
 * of them silently never loading (and, because a level's seed is hashed from
 * its id, as the two of them standing on the same land).
 */
function order(levels) {
  const seen = new Set();
  levels.forEach((l, i) => {
    if (seen.has(l.id)) throw new Error(`Two levels share the id "${l.id}"`);
    seen.add(l.id);
    l.index = i + 1;
  });
  return levels;
}

export const LEVELS = order([level1, level2, level3, level4, level5, level6, level7, level8, level9, level10]);

/** Ids, in play order. */
export const LEVEL_ORDER = LEVELS.map((l) => l.id);

/** The one the game starts on. */
export const FIRST_LEVEL = LEVELS[0].id;

/**
 * The map free roam happens on.
 *
 * The level that breaks, and not by coincidence: the story ends by leaving a
 * race somewhere, and the place the player is left is the place they are free
 * in. A boot that skips the story (`?skip=intro`, SERBEST SÜRÜŞ) drops them on
 * the same map they would have escaped onto, rather than on the tutorial oval
 * — or, if no level claims the break, simply the last one.
 */
export const FREE_ROAM_LEVEL = (LEVELS.find((l) => l.story?.breaks) || LEVELS[LEVELS.length - 1]).id;

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

/**
 * A level from anything a human might have typed: an id (`level2`), a number
 * (`2` or `'2'`), or the level object itself. This is what makes `?level=2`
 * and `?level=level2` the same request.
 * @returns {object|null}
 */
export function resolveLevel(ref) {
  if (!ref && ref !== 0) return null;
  if (typeof ref === 'object') return levelById(ref.id);
  const n = Number(ref);
  if (Number.isFinite(n)) return levelAt(n);
  return levelById(String(ref));
}

/** 1-based, the way the player counts them: `levelAt(3)` is bölüm 3. */
export function levelAt(index) {
  return LEVELS[index - 1] || null;
}

/** The next level in play order, or null at the end of the game. */
export function nextLevel(id) {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 ? LEVELS[i + 1] || null : null;
}

export { level1, level2, level3, level4, level5, level6, level7, level8, level9, level10 };
