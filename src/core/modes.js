/**
 * MODES — one active game mode at a time, with clean hand-off.
 *
 * A mode owns a scene's worth of state: race, open world, chase. It is created,
 * entered, updated, exited and thrown away. Modes never reference each other;
 * they request the next mode through `ctx.modes.switchTo(...)` or by emitting
 * an event the director listens to.
 *
 * Lifecycle:
 *   new Mode(ctx) → await enter(params) → [update/fixedUpdate/render]* → await exit()
 */

import { events } from './events.js';

export class Mode {
  /** @param {object} ctx the shared game context (renderer, world, audio, ui…) */
  constructor(ctx) {
    this.ctx = ctx;
    this.name = new.target?.modeName || this.constructor.modeName || 'mode';
    /** Set false to stop receiving updates without exiting. */
    this.active = true;
  }

  /** Build the scene. May be async (world generation). */
  async enter(_params) {}
  /** Tear everything down. Must release GPU resources and subscriptions. */
  async exit() {}
  /** Variable-rate: input, UI, camera, effects. */
  update(_dt) {}
  /** Fixed-rate: physics, AI. */
  fixedUpdate(_dt) {}
  /** Called after update; `alpha` interpolates between physics steps. */
  render(_alpha) {}
  /** Optional: called when the window resizes. */
  resize(_w, _h) {}

  /**
   * Optional: what this mode wants the minimap to know.
   *
   * `Game` already knows where the player and the cars are; a mode is the only
   * thing that knows which checkpoint you are heading for or which ribbon you
   * are supposed to be on. Returning nothing is correct for a mode that has no
   * opinion, which is most of them.
   *
   * @returns {{activeTrack?: string|null, nextCheckpoint?: number|null}|null}
   */
  mapState() {
    return null;
  }
}

export class ModeManager {
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Mode|null} */
    this.current = null;
    this.currentName = null;
    /** Registered factories, so modes can be requested by string name. */
    this._registry = new Map();
    this._switching = false;
    this._queued = null;
    /** Optional async hook: `(phase, name) => Promise` for fades. */
    this.transition = null;
    /**
     * Optional async hook: `(name, params) => Promise`, run after the old mode
     * is gone and before the new one is built.
     *
     * It exists for exactly one thing, and that thing is worth a hook rather
     * than a line in every mode: `params.levelId` names a level, and a level is
     * a whole map that has to be *built* before anything can be spawned onto
     * it. `Game` installs the loader here (see `src/game/levels.js`), so a mode
     * written next year gets level loading by existing, and a mode that never
     * names a level never pays for it.
     *
     * Between exit and enter is the only correct moment: the previous mode has
     * released its cars, and the new one has not asked for the world yet.
     */
    this.prepare = null;
  }

  /** register('race', RaceMode) — lets the intro ask for modes by name. */
  register(name, ModeClass) {
    this._registry.set(name, ModeClass);
    return this;
  }

  has(name) {
    return this._registry.has(name);
  }

  /**
   * Swap to a new mode. Safe to call from inside a mode's update: the switch is
   * queued and performed between frames.
   * @param {string|typeof Mode} mode registered name, or a Mode subclass
   */
  async switchTo(mode, params = {}) {
    if (this._switching) {
      this._queued = { mode, params };
      return;
    }
    this._switching = true;
    try {
      const ModeClass = typeof mode === 'string' ? this._registry.get(mode) : mode;
      if (!ModeClass) throw new Error(`Unknown mode "${mode}"`);
      const name = typeof mode === 'string' ? mode : ModeClass.modeName || ModeClass.name;

      events.emit('mode:leaving', { from: this.currentName, to: name, params });
      if (this.transition) await this.transition('out', name, params);

      if (this.current) {
        this.current.active = false;
        await this.current.exit();
      }

      if (this.prepare) await this.prepare(name, params);

      const next = new ModeClass(this.ctx);
      next.name = name;
      this.current = next;
      this.currentName = name;
      await next.enter(params);

      events.emit('mode:entered', { name, params });
      if (this.transition) await this.transition('in', name, params);
    } finally {
      this._switching = false;
    }

    if (this._queued) {
      const q = this._queued;
      this._queued = null;
      await this.switchTo(q.mode, q.params);
    }
  }

  update(dt) {
    if (this.current?.active && !this._switching) this.current.update(dt);
  }
  fixedUpdate(dt) {
    if (this.current?.active && !this._switching) this.current.fixedUpdate(dt);
  }
  render(alpha) {
    if (this.current?.active) this.current.render(alpha);
  }
  resize(w, h) {
    this.current?.resize(w, h);
  }
  /** @see Mode#mapState */
  mapState() {
    return this.current?.active ? this.current.mapState() : null;
  }
}
