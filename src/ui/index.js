/**
 * UI — the single entry point for everything the player reads.
 *
 *   import { ui } from './ui/index.js';
 *   ui.mount();
 *   ui.applyTheme('forest');
 *   // per frame:
 *   ui.update(dt);
 *   ui.hud.setSpeed(kmh);
 *
 * Two contracts hold this together:
 *
 *  1. NOTHING touches `document` at import time or in a constructor. The module
 *     must import cleanly in plain Node so tooling and tests can load the game
 *     graph headlessly. All DOM work starts in `mount()`.
 *
 *  2. Gameplay does not have to know the UI exists. `UI` subscribes to a handful
 *     of event-bus channels (`ui:subtitle`, `ui:alert`, `ui:systemMessage`,
 *     `render:theme`), which is how the intro director narrates the story
 *     without importing a single UI symbol.
 */

import { events, Subscriptions } from '../core/events.js';
import { resolveTheme, hexToCss, DEFAULT_THEME } from '../config/style.js';
import { Hud } from './hud.js';
import { Screens } from './screens.js';
import { Subtitles } from './subtitles.js';
import { SettingsMenu } from './settingsMenu.js';

export { createLogo, createWordmark } from './logo.js';
export { Hud } from './hud.js';
export { Screens } from './screens.js';
export { Subtitles } from './subtitles.js';
export { formatTime, formatDelta } from './hud.js';

/** How long the internal watchdog waits before deciding nobody is driving us. */
const EXTERNAL_TIMEOUT_MS = 250;
/** Jitter is re-rolled on this interval, not per frame — smooth noise reads as
 *  motion blur; stepped noise reads as a broken signal. */
const JITTER_STEP = 0.055;
/** Peak jitter in px at glitch 1. Above ~6 the text stops being legible. */
const JITTER_AMP = 5;

function nowMs() {
  return typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function clamp01(n) {
  const v = Number(n);
  return !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
}

/** `0xrrggbb` → `"r g b"` for rgba() composition in CSS. */
function hexToRgbTriple(hex) {
  const n = hex >>> 0;
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export class UI {
  constructor(rootSelector = '#ui-root') {
    this.rootSelector = rootSelector;
    /** @type {Element|null} */
    this.root = null;
    /** @type {Element|null} */
    this.stage = null;
    this.mounted = false;

    // Constructed here (they never touch the DOM until their own mount()) so
    // `ui.hud.setSpeed(...)` is safe to call before, during and after mount.
    this._hud = new Hud(null);
    this._screens = new Screens(null);
    this._subtitles = new Subtitles(null);
    this._settingsMenu = new SettingsMenu(null);

    this._subs = null;
    this._theme = null;
    this._glitch = 0;
    this._jitterT = 0;
    this._jitterWritten = false;
    this._reduced = false;
    this._lastExternal = -Infinity;
    this._raf = 0;
  }

  get hud() {
    return this._hud;
  }
  get screens() {
    return this._screens;
  }
  get subtitles() {
    return this._subtitles;
  }
  /** The options panel behind Escape → AYARLAR. */
  get settingsMenu() {
    return this._settingsMenu;
  }
  get glitch() {
    return this._glitch;
  }

  // -------------------------------------------------------------------------

  mount() {
    if (this.mounted) return this;
    if (typeof document === 'undefined') {
      throw new Error('[ui] mount() requires a DOM. Import is safe in Node; mount is not.');
    }

    let root = document.querySelector(this.rootSelector);
    if (!root) {
      // index.html should provide #ui-root, but a missing host must not be
      // fatal — a broken overlay is better than a dead game.
      console.warn(`[ui] "${this.rootSelector}" not found; creating it.`);
      root = document.createElement('div');
      if (this.rootSelector.startsWith('#')) root.id = this.rootSelector.slice(1);
      document.body.append(root);
    }
    this.root = root;

    // Everything lives inside the stage so the glitch transform has exactly one
    // target and never drags the CRT overlay (a pseudo-element of #ui-root).
    const stage = document.createElement('div');
    stage.className = 'tk-stage';
    root.append(stage);
    this.stage = stage;

    this._reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this._hud.root = stage;
    this._screens.root = stage;
    this._subtitles.root = stage;
    this._hud.mount();
    this._screens.mount();
    this._subtitles.mount();
    // Mounted on the root, not the stage: the settings panel must stay readable
    // and un-jittered even while the rest of the UI is glitching.
    this._settingsMenu.mount(root);

    this.applyTheme(this._theme?.name || DEFAULT_THEME);
    this.setGlitch(this._glitch);

    this._bindEvents();
    this._startWatchdog();

    this.mounted = true;
    return this;
  }

  unmount() {
    if (!this.mounted) return this;
    this._subs?.dispose();
    this._subs = null;
    if (this._raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._hud.unmount();
    this._screens.unmount();
    this._subtitles.unmount();
    this.stage?.remove();
    this.stage = null;
    this.root = null;
    this.mounted = false;
    return this;
  }

  /**
   * Repaint the whole UI in a theme.
   * @param {string|object} themeNameOrResolvedTheme a THEMES key, or a resolveTheme() result
   */
  applyTheme(themeNameOrResolvedTheme) {
    let theme = themeNameOrResolvedTheme;
    if (typeof theme === 'string') {
      try {
        theme = resolveTheme(theme);
      } catch (err) {
        console.warn('[ui] unknown theme, keeping current:', err.message);
        return this;
      }
    }
    if (!theme || typeof theme !== 'object') return this;
    this._theme = theme;
    if (!this.root) return this; // stashed; re-applied on mount

    const ui = theme.ui || {};
    const set = (prop, hex) => {
      if (hex == null) return;
      this.root.style.setProperty(prop, hexToCss(hex));
    };
    set('--ink', ui.ink);
    set('--ink-dim', ui.inkDim);
    set('--accent', ui.accent);
    set('--accent-alt', ui.accentAlt);
    set('--panel', ui.panel);
    set('--panel-edge', ui.panelEdge);
    set('--good', ui.good);
    set('--bad', ui.bad);
    // Triples for the rgba() work CSS cannot do from a hex custom property.
    const triple = (prop, hex) => {
      if (hex == null) return;
      this.root.style.setProperty(prop, hexToRgbTriple(hex));
    };
    triple('--ink-rgb', ui.ink);
    triple('--accent-rgb', ui.accent);
    triple('--accent-alt-rgb', ui.accentAlt);
    triple('--panel-rgb', ui.panel);
    triple('--bad-rgb', ui.bad);
    if (theme.fog?.color != null) set('--haze', theme.fog.color);
    this.root.dataset.theme = theme.name || '';

    this._hud.applyTheme(theme);
    this._screens.applyTheme(theme);
    this._subtitles.applyTheme(theme);
    this._settingsMenu.applyTheme(theme);
    return this;
  }

  /**
   * Distort the whole UI layer: stepped jitter, RGB fringing on text, flicker,
   * and the logo tearing along its seam.
   * @param {number} amount01
   */
  setGlitch(amount01) {
    const g = clamp01(amount01);
    this._glitch = g;
    this._screens.setGlitch(g);
    this._hud._wordmark?.setGlitch(g);
    if (!this.stage || !this.root) return this;
    this.root.style.setProperty('--glitch', g.toFixed(3));
    this.stage.classList.toggle('is-glitching', g > 0.01);
    if (g <= 0.01) this._resetJitter();
    return this;
  }

  /**
   * Freeze counted screen time — the countdown, alert durations, the
   * typewriter — while the game is paused. Animation is unaffected.
   */
  setPaused(paused) {
    this._screens.setPaused(paused);
    return this;
  }

  /** Per-frame. `dt` in seconds. */
  update(dt) {
    this._lastExternal = nowMs();
    this._tick(dt);
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  _tick(dt) {
    const d = Number(dt) || 0;
    this._hud.update(d);
    this._screens.update(d);
    this._subtitles.update(d);
    this._updateJitter(d);
  }

  _updateJitter(dt) {
    if (!this.stage) return;
    if (this._glitch <= 0.01 || this._reduced) {
      this._resetJitter();
      return;
    }
    this._jitterT -= dt;
    if (this._jitterT > 0) return;
    this._jitterT = JITTER_STEP;
    const amp = this._glitch * JITTER_AMP;
    // Whole pixels: a sub-pixel offset would be resampled into a soft blur,
    // and nothing about this game is allowed to look soft.
    const x = Math.round((Math.random() * 2 - 1) * amp);
    const y = Math.round((Math.random() * 2 - 1) * amp * 0.6);
    this.stage.style.setProperty('--gx', `${x}px`);
    this.stage.style.setProperty('--gy', `${y}px`);
    this._jitterWritten = true;
  }

  _resetJitter() {
    if (!this._jitterWritten || !this.stage) return;
    this.stage.style.setProperty('--gx', '0px');
    this.stage.style.setProperty('--gy', '0px');
    this._jitterWritten = false;
  }

  /**
   * If the game loop is not calling `update()` — title screen before the loop
   * starts, a UI-only test page, a mode transition — drive ourselves from rAF
   * so typewriters and countdowns still resolve. Yields the moment the game
   * takes over, so nothing is ever ticked twice in a frame.
   */
  _startWatchdog() {
    if (typeof requestAnimationFrame !== 'function') return;
    let last = nowMs();
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const t = typeof now === 'number' ? now : nowMs();
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      if (t - this._lastExternal > EXTERNAL_TIMEOUT_MS) this._tick(dt);
    };
    this._raf = requestAnimationFrame(frame);
  }

  _bindEvents() {
    const subs = new Subscriptions(events);

    // Every handler assumes the payload is garbage until proven otherwise —
    // these channels are fed by narrative data files, not by type-checked code.
    subs.on('ui:subtitle', (p) => {
      const text = p?.text ?? p?.line ?? (typeof p === 'string' ? p : null);
      if (!text) return;
      this._subtitles.show(text, {
        duration: p?.duration,
        speaker: p?.speaker,
        tone: p?.tone,
      });
    });

    subs.on('ui:alert', (p) => {
      if (!p) return;
      const title = p.title ?? p.text ?? '';
      if (!title && !p.body) return;
      this._screens.showAlert({
        title,
        body: p.body,
        tone: p.tone,
        duration: p.duration,
      });
    });

    subs.on('ui:systemMessage', (p) => {
      const lines = Array.isArray(p) ? p : (p?.lines ?? p?.text ?? null);
      if (!lines || (Array.isArray(lines) && lines.length === 0)) return;
      this._screens.showSystemMessage(lines, {
        cps: p?.cps,
        hold: p?.hold,
        dismissible: p?.dismissible,
        title: p?.title,
        tag: p?.tag,
      });
    });

    subs.on('render:theme', (p) => {
      const name = typeof p === 'string' ? p : p?.name;
      if (name) this.applyTheme(name);
    });

    this._subs = subs;
  }
}

/** The game-wide UI. Import this, not the class. */
export const ui = new UI();
