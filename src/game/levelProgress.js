/**
 * LEVEL PROGRESS — how far the player has got, and what the menu says about it.
 *
 * One fact is stored: which levels have been finished. Everything else is
 * derived, because everything else can be. "Unlocked" is not a second list that
 * could disagree with the first — a level is open when the one before it is
 * done, and bölüm 1 is open because there is nothing before it.
 *
 * IT DOES NOT GATE ANYTHING. Nothing here refuses to load a level; the lock is
 * a thing the menu draws, not a rule the game enforces. Level select hands out
 * any level that is asked for — that is deliberate, and it is what lets the
 * tenth map be looked at without driving the nine in front of it.
 *
 * Persisted like settings and the patrol's one-time lessons: its own versioned
 * key, written through `localStorage` when there is one and simply forgotten
 * when there is not (a headless test, a `file://` boot, private browsing).
 * Deliberately NOT part of `settings.js`, whose whole schema is rendered into
 * the options menu — "has finished bölüm 4" is not an option anybody is offered.
 */

import { LEVELS, levelById } from '../levels/index.js';

const KEY = 'teker.levels.v1';

class LevelProgress {
  constructor() {
    /** @type {Set<string>} ids of levels whose finish line has been crossed */
    this._done = new Set();
    this._loaded = false;
  }

  /** Read the store. Called lazily by everything below, so import is inert. */
  load() {
    this._loaded = true;
    this._done.clear();
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      const data = JSON.parse(raw || '{}');
      for (const id of Array.isArray(data.completed) ? data.completed : []) {
        // Drop ids that no longer name a level, so a renamed or deleted level
        // cannot leave a lock hanging on nothing.
        if (levelById(String(id))) this._done.add(String(id));
      }
    } catch {
      // Unreadable or absent. A fresh game is the right answer to both.
    }
    return this;
  }

  _ensure() {
    if (!this._loaded) this.load();
  }

  _save() {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ completed: [...this._done] }));
    } catch {
      // No storage. Progress becomes per-session, which is a fine failure.
    }
  }

  /** @param {string} levelId */
  isCompleted(levelId) {
    this._ensure();
    return this._done.has(levelId);
  }

  /**
   * Open, in the sense the menu means it: the first level always, and any level
   * whose predecessor has been finished.
   * @param {string} levelId
   */
  isUnlocked(levelId) {
    this._ensure();
    const i = LEVELS.findIndex((l) => l.id === levelId);
    if (i <= 0) return i === 0;
    return this._done.has(LEVELS[i - 1].id);
  }

  /** Crossing the line, whatever place it was in. @param {string} levelId */
  complete(levelId) {
    this._ensure();
    if (!levelId || !levelById(levelId) || this._done.has(levelId)) return false;
    this._done.add(levelId);
    this._save();
    return true;
  }

  /** Back to a game that has never been played. */
  reset() {
    this._loaded = true;
    this._done.clear();
    this._save();
    return this;
  }
}

/** The game-wide store. Import this, not the class. */
export const levelProgress = new LevelProgress();

/**
 * The level list as a menu draws it: every level, in play order, carrying what
 * the player is allowed to know about it.
 *
 * This is the only shape `Screens#showLevelSelect` understands, and building it
 * here rather than in the UI is what keeps the UI ignorant of levels, progress
 * and storage all at once.
 *
 * @param {{currentId?: string|null}} [opts]
 */
export function levelMenuItems({ currentId = null } = {}) {
  return LEVELS.map((level) => ({
    id: level.id,
    index: level.index,
    name: level.name,
    subtitle: level.subtitle || '',
    done: levelProgress.isCompleted(level.id),
    locked: !levelProgress.isUnlocked(level.id),
    current: level.id === currentId,
  }));
}
