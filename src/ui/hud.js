/**
 * HUD — the telemetry layer.
 *
 * Updated 60 times a second, so the rule here is absolute: build every node
 * once in `mount()`, then only ever touch `textContent`, a class, or a CSS
 * custom property. Nothing in this file may create or remove an element after
 * mount. Every setter also caches its last value and returns early when it has
 * not changed — most frames the car's gear and lap did not move.
 *
 * The HUD has three personalities, selected with `setMode()`:
 *   race       — full instrumentation, the sanctioned experience
 *   openWorld  — almost nothing. The emptiness is the point: once you leave the
 *                track there is no lap, no rival, no split. Just a dim speed.
 *   chase      — a red pursuit meter that eats the top of the screen
 *   none       — off
 * The mode is written as a data attribute and ui.css decides what survives.
 */

import { createWordmark } from './logo.js';
import { Minimap } from './minimap.js';
import { resolveTheme, hexToCss } from '../config/style.js';

/** Segments in the speed bar. */
const SEGMENTS = 20;
/** Fraction of the bar rendered as redline. */
const REDLINE = 0.8;
/** Bar full-scale speed, km/h. Overwrite with `hud.topSpeed = n` if tuning moves. */
const DEFAULT_TOP_SPEED = 240;
/** Seconds the checkpoint highlight takes to decay. */
const FLASH_TIME = 0.55;

const MODES = new Set(['race', 'openWorld', 'chase', 'none']);

/**
 * Seconds → `m:ss.mmm`. Shared with screens.js so a lap time reads identically
 * on the HUD and on the results board.
 * @param {number|null|undefined} seconds
 */
export function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--.---';
  const sign = seconds < 0 ? '-' : '';
  const t = Math.abs(seconds);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** Seconds → `+1.204` / `-0.318`, the split-time convention. */
export function formatDelta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const sign = seconds >= 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class Hud {
  /** @param {Element|null} root container supplied by UI.mount() */
  constructor(root) {
    // No DOM here on purpose — this class is constructed before mount so the
    // module can be imported in plain Node.
    this.root = root || null;
    this.el = null;
    this.topSpeed = DEFAULT_TOP_SPEED;

    /** Last values written, so a static frame costs zero DOM work. */
    this._last = {
      speed: -1,
      lit: -1,
      gear: null,
      lap: '',
      pos: '',
      cur: '',
      best: '',
      delta: '',
      deltaSign: 0,
      warn: null,
      heat: -1,
    };
    this._mode = 'race';
    this._visible = true;
    this._flash = 0;
    this._theme = null;
    this._segments = [];

    // Constructed here, like everything else, so `hud.minimap.setWorld(...)` is
    // safe to call before mount. It builds no DOM until its own mount().
    this._minimap = new Minimap(null);
  }

  /** The map behind H. See `src/config/minimap.js` for everything it does. */
  get minimap() {
    return this._minimap;
  }

  mount() {
    if (this.el || !this.root) return this;

    const hud = el('div', 'tk-hud');
    hud.dataset.mode = this._mode;
    // #ui-root is aria-live="polite". A speed readout changing 60x/second would
    // turn a screen reader into a fire alarm, so the HUD opts out entirely;
    // subtitles and system messages carry the narration instead.
    hud.setAttribute('aria-hidden', 'true');

    // -- timing (top-left) --------------------------------------------------
    const timing = el('div', 'tk-hud-timing tk-panel');
    const timeRow = el('div', 'tk-time-row');
    this._cur = el('span', 'tk-time-cur tk-num', '0:00.000');
    this._best = el('span', 'tk-time-best tk-num', '');
    this._delta = el('span', 'tk-time-delta tk-num', '');
    timeRow.append(this._cur, this._best, this._delta);
    timing.append(el('div', 'tk-label tk-txt', 'TIME'), timeRow);

    // -- standings (top-right) ---------------------------------------------
    const standings = el('div', 'tk-hud-standings tk-panel');
    this._lapWrap = el('div', 'tk-hud-lap');
    this._lapWrap.append(el('span', 'tk-label tk-txt', 'LAP '));
    this._lap = el('span', 'tk-standings-big tk-num', '1/3');
    this._lapWrap.append(this._lap);
    this._posWrap = el('div', 'tk-hud-pos');
    this._posWrap.append(el('span', 'tk-label tk-txt', 'POS '));
    this._pos = el('span', 'tk-standings-big tk-num', '1/4');
    this._posWrap.append(this._pos);
    standings.append(this._lapWrap, this._posWrap);

    // -- heat / pursuit (top-centre) ---------------------------------------
    const heat = el('div', 'tk-hud-heat');
    heat.append(el('div', 'tk-label tk-txt', 'PURSUIT'));
    const heatTrack = el('div', 'tk-heat-track');
    this._heatFill = el('div', 'tk-heat-fill');
    heatTrack.append(this._heatFill);
    heat.append(heatTrack);

    // -- warning (centre) ---------------------------------------------------
    const warning = el('div', 'tk-hud-warning tk-txt', '');

    // -- minimap ------------------------------------------------------------
    // A positioned host, not a grid cell: the map's corner is a config value
    // (`MINIMAP.anchor`) and it has to be able to sit where the timing panel or
    // the speed readout already lives without fighting the grid for the slot.
    const minimap = el('div', 'tk-hud-minimap');

    // -- wordmark (bottom-left) --------------------------------------------
    const mark = el('div', 'tk-hud-mark');
    this._wordmark = createWordmark();
    mark.append(this._wordmark);

    // -- speed (bottom-right) ----------------------------------------------
    const speed = el('div', 'tk-hud-speed');
    this._gear = el('span', 'tk-speed-gear tk-num', '');
    this._speedNum = el('span', 'tk-speed-num tk-num', '0');
    const speedUnit = el('div', 'tk-speed-unit tk-txt', 'KM/H');
    const bar = el('div', 'tk-speed-bar');
    for (let i = 0; i < SEGMENTS; i++) {
      const seg = el('i', 'tk-seg');
      if (i / SEGMENTS >= REDLINE) seg.classList.add('is-red');
      bar.append(seg);
      this._segments.push(seg);
    }
    speed.append(this._gear, this._speedNum, speedUnit, bar);

    hud.append(timing, heat, standings, warning, minimap, mark, speed);
    this.el = hud;
    this._timing = timing;
    this._standings = standings;
    this._heat = heat;
    this._warning = warning;
    // NOT `this._minimap` — that is the Minimap component. `minimap` here is
    // only the positioned host it mounts its canvas into, below.
    this._minimapHost = minimap;

    // Nothing has been fed to us yet — start from a clean, hidden state.
    warning.classList.add('tk-hidden');
    heat.classList.add('tk-hidden');
    this._best.classList.add('tk-hidden');
    this._delta.classList.add('tk-hidden');

    this.root.append(hud);
    // The map builds its canvas into the host above. It manages its own
    // visibility from here on — see `Minimap#setVisible` and `#setMode`.
    this._minimap.root = minimap;
    this._minimap.mount();
    this._minimap.setMode(this._mode);
    if (this._theme) this.applyTheme(this._theme);
    this.setVisible(this._visible);
    return this;
  }

  unmount() {
    this._minimap.dispose();
    this.el?.remove();
    this.el = null;
    this._segments.length = 0;
  }

  setVisible(v) {
    this._visible = !!v;
    this.el?.classList.toggle('is-hidden', !this._visible);
  }

  /** @param {number} kmh */
  setSpeed(kmh) {
    if (!this.el) return;
    const v = Number.isFinite(kmh) ? Math.max(0, Math.round(kmh)) : 0;
    if (v !== this._last.speed) {
      this._last.speed = v;
      this._speedNum.textContent = String(v);
    }
    // The bar only changes when a whole segment crosses — 20 possible states
    // per frame instead of 20 class writes.
    const lit = Math.round(clamp01(v / this.topSpeed) * SEGMENTS);
    if (lit !== this._last.lit) {
      const prev = Math.max(0, this._last.lit);
      this._last.lit = lit;
      const from = Math.min(prev, lit);
      const to = Math.max(prev, lit);
      for (let i = from; i < to; i++) this._segments[i]?.classList.toggle('is-on', i < lit);
    }
  }

  /** @param {number|string|null} n gear index; N/R accepted as strings */
  setGear(n) {
    if (!this.el) return;
    const label = n == null || n === '' ? '' : typeof n === 'number' ? `GEAR ${n}` : String(n);
    if (label === this._last.gear) return;
    this._last.gear = label;
    this._gear.textContent = label;
  }

  /** @param {{lap?: number, total?: number}} [data] total 0 hides the row */
  setLap({ lap = 0, total = 0 } = {}) {
    if (!this.el) return;
    const text = total > 0 ? `${Math.max(1, lap)}/${total}` : '';
    if (text === this._last.lap) return;
    this._last.lap = text;
    this._lapWrap.classList.toggle('tk-hidden', text === '');
    if (text) this._lap.textContent = text;
    this._syncStandings();
  }

  /** @param {{place?: number, total?: number}} [data] total 0 hides the row */
  setPosition({ place = 0, total = 0 } = {}) {
    if (!this.el) return;
    const text = total > 0 ? `${Math.max(1, place)}/${total}` : '';
    if (text === this._last.pos) return;
    this._last.pos = text;
    this._posWrap.classList.toggle('tk-hidden', text === '');
    if (text) this._pos.textContent = text;
    this._syncStandings();
  }

  _syncStandings() {
    const empty = this._last.lap === '' && this._last.pos === '';
    this._standings.classList.toggle('tk-hidden', empty);
  }

  /** @param {{current?: number, best?: number|null, delta?: number|null}} [t] seconds */
  setTime({ current = null, best = null, delta = null } = {}) {
    if (!this.el) return;

    const cur = formatTime(current);
    if (cur !== this._last.cur) {
      this._last.cur = cur;
      this._cur.textContent = cur;
    }

    const bestText = best == null ? '' : `BEST ${formatTime(best)}`;
    if (bestText !== this._last.best) {
      this._last.best = bestText;
      this._best.classList.toggle('tk-hidden', bestText === '');
      if (bestText) this._best.textContent = bestText;
    }

    const deltaText = formatDelta(delta);
    if (deltaText !== this._last.delta) {
      this._last.delta = deltaText;
      this._delta.classList.toggle('tk-hidden', deltaText === '');
      if (deltaText) this._delta.textContent = deltaText;
    }
    // Colour is a separate cache: the sign changes far less often than digits.
    const sign = delta == null ? 0 : delta >= 0 ? 1 : -1;
    if (sign !== this._last.deltaSign) {
      this._last.deltaSign = sign;
      this._delta.classList.toggle('is-up', sign > 0);
      this._delta.classList.toggle('is-down', sign < 0);
    }
  }

  /** Brief highlight on the timing panel. Decays in `update()`. */
  setCheckpointFlash() {
    this._flash = 1;
  }

  /** @param {string|null} text 'WRONG WAY' | 'OFF TRACK' | null to clear */
  setWarning(text) {
    if (!this.el) return;
    const t = text == null || text === '' ? null : String(text).toUpperCase();
    if (t === this._last.warn) return;
    this._last.warn = t;
    this._warning.classList.toggle('tk-hidden', t === null);
    if (t) this._warning.textContent = t;
  }

  /** @param {number|null} amount01 null hides the meter entirely */
  setHeat(amount01) {
    if (!this.el) return;
    if (amount01 == null) {
      if (this._last.heat === -1) return;
      this._last.heat = -1;
      this._heat.classList.add('tk-hidden');
      return;
    }
    const h = clamp01(Number(amount01) || 0);
    // Quantise to 1% — the fill is a percentage width, sub-pixel churn is waste.
    const q = Math.round(h * 100) / 100;
    if (q === this._last.heat) return;
    const wasHidden = this._last.heat === -1;
    this._last.heat = q;
    if (wasHidden) this._heat.classList.remove('tk-hidden');
    this._heat.style.setProperty('--heat', String(q));
    this._heat.classList.toggle('is-critical', q > 0.8);
  }

  /**
   * Show or hide the map.
   *
   * This used to be a deliberate no-op — a map being "exactly the wrong thing to
   * hand a player whose whole arc is discovering the world has no edges". The
   * map now exists, and that argument is answered by it being *closed* until the
   * player asks for it with H rather than by it not existing. See
   * `MINIMAP.startVisible` if you want the old policy back in one line.
   *
   * @param {boolean|null} on `null` hides, for the old call convention
   */
  setMinimap(on) {
    this._minimap.setVisible(!!on);
  }

  /** @param {'race'|'openWorld'|'chase'|'none'} name */
  setMode(name) {
    const mode = MODES.has(name) ? name : 'race';
    if (mode === this._mode) return;
    this._mode = mode;
    if (this.el) this.el.dataset.mode = mode;
    // The map is allowed in some HUD personalities and not others; it decides,
    // and it remembers whether the player had it open across the gap.
    this._minimap.setMode(mode);
  }

  get mode() {
    return this._mode;
  }

  /** @param {object|string} resolvedTheme a resolveTheme() result, or a theme name */
  applyTheme(resolvedTheme) {
    const theme =
      typeof resolvedTheme === 'string' ? safeResolve(resolvedTheme) : resolvedTheme;
    this._theme = theme || this._theme;
    if (!this.el || !this._theme?.ui) return;
    const ui = this._theme.ui;
    // Component-local overrides only; the global palette lives on #ui-root.
    if (ui.bad != null) this.el.style.setProperty('--bad', hexToCss(ui.bad));
    if (ui.accentAlt != null) this.el.style.setProperty('--accent-alt', hexToCss(ui.accentAlt));
    // The map paints on a canvas, where a CSS custom property is no use to it;
    // it needs the resolved theme object to look colours up itself.
    this._minimap.applyTheme(this._theme);
  }

  /**
   * Per-frame.
   *
   * `mapState` is forwarded straight to the minimap and is the only reason this
   * takes a second argument — everything else on the HUD is push-based. A map
   * cannot be: it needs where the player is *this frame*, and asking gameplay to
   * push that sixty times a second would be a worse contract than reading it.
   *
   * @param {number} dt seconds
   * @param {object} [mapState] see `Minimap#update`
   */
  update(dt, mapState = null) {
    this._minimap.update(dt, mapState);
    if (!this.el || this._flash <= 0) return;
    this._flash = Math.max(0, this._flash - (Number(dt) || 0) / FLASH_TIME);
    this._timing.style.setProperty('--flash', this._flash.toFixed(3));
  }

  /** Viewport changed. The map owns a canvas, so it needs to know. */
  resize() {
    this._minimap.resize();
  }
}

function safeResolve(name) {
  try {
    return resolveTheme(name);
  } catch {
    return null;
  }
}
