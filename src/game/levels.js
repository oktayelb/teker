/**
 * LEVEL HOST — one level's map is loaded, and only one, ever.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Every level owns a world (`src/levels/`). Entering a level means building
 * that world and throwing the previous one away: new terrain, new forest, new
 * landmarks, new parkour. Nothing is shared between two levels except the
 * renderer, the materials and the car.
 *
 * That is a load, and it is honest about being one. The alternative — every
 * parkour standing in one big valley — is cheaper to enter and buys a smaller
 * game: eight tracks in one terrain are eight tracks at arm's length from each
 * other, with the forest between them doing the job of a corridor. Eight maps
 * are eight places.
 *
 * THE SWAP, IN ORDER
 * ------------------
 *   1. cars off the board       — a Vehicle holds the world it is standing on
 *   2. old root out of the scene, old world disposed
 *   3. new World built from the level's map spec, with progress reported
 *   4. everything that holds a world pointed at the new one
 *
 * Step 1 is not optional and not a tidy-up: `Vehicle` samples its ground from
 * the world it was constructed with, so a car that survived the swap would be
 * driving on a terrain that no longer exists. Modes spawn their own cars in
 * `enter()`, which runs after this, so the ordering falls out naturally — and
 * `keepPlayer` hand-offs (the breakout) never cross a level boundary, because
 * the breakout happens on the map it started on.
 *
 * DETERMINISM INSTEAD OF A CACHE
 * ------------------------------
 * Nothing is kept. Going back to bölüm 2 rebuilds bölüm 2's map from its seed,
 * and a seed produces the same valley every time — the same hills, the same
 * trees, the same wrecks in the same clearings. So "the level you left" and
 * "the level you came back to" are the same place without a megabyte of it
 * being held in memory while you were away. What is *not* preserved is what you
 * did to it (a felled tree, a car parked in a clearing); when the game needs
 * that, it goes in a save file, not in a retained world.
 */

import { World } from '../world/world.js';
import { LEVELS, FIRST_LEVEL, levelById, nextLevel, resolveLevel } from '../levels/index.js';
import { events } from '../core/events.js';
import { levelTrack } from '../levels/defaults.js';

export class LevelHost {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    /** @type {object|null} the resolved level definition currently loaded */
    this.current = null;
    /** @type {World|null} its map */
    this.world = null;
    this._loading = null;
  }

  get currentId() {
    return this.current?.id ?? null;
  }

  /** Every level in play order, for menus and level select. */
  get all() {
    return LEVELS;
  }

  /** The parkour on the level that is loaded. */
  get track() {
    return this.world?.mainTrack ?? null;
  }

  /**
   * Make `levelId` the loaded level, building its map if it is not already.
   *
   * Idempotent: asking for the level that is already loaded costs nothing, so
   * modes may call it unconditionally (and `ModeManager#prepare` does, on every
   * switch). Concurrent calls are serialised — the second one waits for the
   * first and then re-checks, because two half-built worlds in one scene is a
   * class of bug worth making impossible.
   *
   * @param {string} levelId
   * @param {object} [opts]
   * @param {(stage:string, progress:number)=>void} [opts.onProgress]
   * @param {boolean} [opts.screen] show the loading panel over the build
   * @param {boolean} [opts.force] rebuild even if it is already loaded
   * @returns {Promise<World>}
   */
  async load(levelId, { onProgress = null, screen = true, force = false } = {}) {
    if (this._loading) await this._loading;
    // `resolveLevel` so `?level=2` and a menu handing over a level object both
    // land here without every caller normalising first.
    const level = resolveLevel(levelId) || levelById(FIRST_LEVEL);
    if (!level) throw new Error(`LevelHost: unknown level "${levelId}"`);
    if (!force && this.current?.id === level.id && this.world) return this.world;

    this._loading = this._build(level, { onProgress, screen });
    try {
      return await this._loading;
    } finally {
      this._loading = null;
    }
  }

  async _build(level, { onProgress, screen }) {
    const g = this.game;
    const from = this.current?.id ?? null;
    events.emit('level:loading', { id: level.id, from, name: level.name, index: level.index });

    const report =
      onProgress ||
      ((stage, progress) =>
        screen && g.ui?.screens?.showLoading(`${level.name.toUpperCase()} · ${Math.round(progress * 100)}%`));
    if (screen) await g.ui?.screens?.showLoading(`${level.name.toUpperCase()} · 0%`);

    // 1. Nothing may be standing on the map that is about to stop existing.
    g.clearVehicles();
    g.camera.setTarget(null);

    // 2. Out with the old. `removeRoot` disposes the geometry it finds; the
    //    world's own `dispose` gives back the light leases, the collision grid
    //    and the pooled systems that never lived under `root`.
    if (this.world) {
      g.renderer.removeRoot(this.world.root);
      this.world.dispose();
      this.world = null;
      // Genuinely null, not left pointing at a world that has been disposed —
      // the loop is still running behind the loading screen, and a stale world
      // answers "what is the ground here" with freed geometry. Everything that
      // reads `game.world` every frame is written to survive this gap; a `?.`
      // in a per-frame reader is what that survival looks like.
      g.world = null;
      g.camera.world = null;
      g.ui.minimap.setWorld(null);
    }

    // 3. THE THEME FIRST, THEN THE MAP.
    //
    // Not a presentation detail and not reorderable: a world bakes the theme
    // into its vertex colours as it is built (`Terrain#buildMesh`, every prop
    // factory), so the palette has to be the level's before anything is
    // generated. Building a snow level while the renderer is still in `forest`
    // gives you a white sky, white fog, white light — and green grass, because
    // the ground was coloured before anybody said where we were.
    //
    // `?theme=` still wins: it is a debug override and its whole point is
    // seeing a level under a palette it was not written for.
    g.setTheme(g.boot.theme || level.theme || 'forest', 0);

    const world = new World({
      materials: g.materials,
      theme: g.renderer.theme,
      // `?seed=` is a debug override and outranks the level, which is what
      // makes "the same level on different land" a one-URL experiment.
      seed: g.boot.seed ?? null,
      spec: level.map,
      lightPool: g.renderer.lights,
    });
    await world.build({ trackData: level.tracks, onProgress: report });

    // 4. Everything that holds a world.
    this.world = world;
    this.current = level;
    g.world = world;
    g.camera.world = world;
    g.renderer.addRoot(world.root);
    // The map re-indexes the whole forest here rather than per frame; it has to
    // be told, or it keeps drawing the trees of a world that is gone.
    g.ui.minimap.setWorld(world);

    if (screen) await g.ui?.screens?.hideLoading();
    events.emit('level:loaded', {
      id: level.id,
      from,
      name: level.name,
      index: level.index,
      trackId: levelTrack(level).id,
    });
    return world;
  }

  /** The level after this one, or null at the end of the game. */
  next() {
    return this.currentId ? nextLevel(this.currentId) : LEVELS[0];
  }

  dispose() {
    if (this.world) {
      this.game.renderer.removeRoot(this.world.root);
      this.world.dispose();
    }
    this.world = null;
    this.current = null;
  }
}
