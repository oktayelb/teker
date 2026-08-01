/**
 * LOOP — fixed-timestep simulation with a variable-rate render.
 *
 * Physics runs at a constant `hz` so the car feels identical on a 60Hz laptop
 * and a 165Hz monitor. Rendering interpolates between the last two physics
 * states using `alpha`, so motion stays smooth between steps.
 */

import { PACE } from '../config/tuning.js';
import { events } from './events.js';

export class Loop {
  constructor({ hz = 120, maxSubSteps = 6 } = {}) {
    this.hz = hz;
    this.fixedDt = 1 / hz;
    this.maxSubSteps = maxSubSteps;

    /** Called at a fixed rate. Signature: (dt, ctx). */
    this.onFixed = null;
    /** Called once per rendered frame, before render. Signature: (dt, ctx). */
    this.onUpdate = null;
    /** Called once per rendered frame. Signature: (alpha, dt, ctx). */
    this.onRender = null;

    this.running = false;
    this.paused = false;
    /** Independent of PACE.timeScale — used for slow-mo effects. */
    this.effectTimeScale = 1;

    this._accumulator = 0;
    this._lastTime = 0;
    this._rafId = 0;
    this._tick = this._tick.bind(this);

    // Health metrics for the debug panel.
    this.stats = { fps: 0, frameMs: 0, steps: 0, elapsed: 0, frames: 0 };
    this._fpsAccum = 0;
    this._fpsFrames = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._rafId);
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    // Drop accumulated time so unpausing does not fast-forward.
    this._accumulator = 0;
    this._lastTime = performance.now();
    events.emit('loop:paused', { paused });
  }

  togglePause() {
    this.setPaused(!this.paused);
  }

  _tick(now) {
    if (!this.running) return;
    this._rafId = requestAnimationFrame(this._tick);

    const frameStart = now;
    // Clamp: a long stall (tab switch, breakpoint) must not spiral the physics.
    let rawDt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (rawDt > 0.25) rawDt = 0.25;

    const scale = PACE.timeScale * this.effectTimeScale;
    const dt = this.paused ? 0 : rawDt * scale;
    /**
     * Unscaled, unpaused frame time. The UI runs on this: a pause menu that
     * animates on the clock it just stopped would never finish appearing, and
     * slow-motion should not slow the subtitles down with it.
     */
    this.rawDt = rawDt;

    // FPS metric uses unscaled real time.
    this._fpsAccum += rawDt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.stats.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    if (this.onUpdate) this.onUpdate(dt, this);

    let steps = 0;
    if (!this.paused) {
      this._accumulator += dt;
      const step = this.fixedDt;
      while (this._accumulator >= step && steps < this.maxSubSteps) {
        if (this.onFixed) this.onFixed(step, this);
        this._accumulator -= step;
        steps++;
        this.stats.elapsed += step;
      }
      // Running behind: give up the backlog rather than death-spiral.
      if (steps >= this.maxSubSteps) this._accumulator = 0;
    }
    this.stats.steps = steps;

    const alpha = this.paused ? 1 : this._accumulator / this.fixedDt;
    if (this.onRender) this.onRender(alpha, dt, this);

    this.stats.frameMs = performance.now() - frameStart;
    this.stats.frames++;
  }
}
