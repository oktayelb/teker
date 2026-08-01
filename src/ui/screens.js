/**
 * SCREENS — full-viewport overlays.
 *
 * Every public method returns a Promise. The game awaits them, which keeps the
 * story readable as a script:
 *
 *   await screens.showCountdown(3);
 *   const r = await screens.showRaceResults({...});
 *   await screens.showSystemMessage(['ANOMALY DETECTED', 'UNIT 0451 OFF-MANIFEST']);
 *
 * Two design rules:
 *  1. Every shell is built once in `mount()`. Opening a screen fills text and
 *     flips a class — it never rebuilds a tree.
 *  2. Time comes from `update(dt)`, not from setTimeout, so the countdown and
 *     the typewriter freeze when the game freezes. (UI keeps a rAF watchdog for
 *     the case where nobody is driving `update` — see index.js.)
 */

import { createLogo } from './logo.js';
import { formatTime } from './hud.js';
import { resolveTheme, hexToCss } from '../config/style.js';

/** Keys a modal owns outright while it is open. */
const NAV_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
  'Space',
  'Escape',
  'w',
  's',
  'W',
  'S',
]);

const DEFAULT_TITLE_ITEMS = [
  { id: 'start', label: 'START' },
  { id: 'options', label: 'OPTIONS' },
];

const PAUSE_ITEMS = [
  { id: 'resume', label: 'DEVAM ET' },
  { id: 'settings', label: 'AYARLAR' },
  { id: 'restart', label: 'YENİDEN BAŞLA' },
  { id: 'mainMenu', label: 'ANA MENÜ' },
];

/** Characters per second for the system typewriter. Deliberately unhurried. */
const DEFAULT_CPS = 34;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function safeResolve(name) {
  try {
    return resolveTheme(name);
  } catch {
    return null;
  }
}

export class Screens {
  /** @param {Element|null} root */
  constructor(root) {
    this.root = root || null;
    this.el = null;
    /** @type {{t:number, fn:Function, cancelled:boolean}[]} */
    this._timers = [];
    /** Modal key handlers, innermost last. */
    this._stack = [];
    /** name → resolve fn for the currently open screens. */
    this._pending = new Map();
    this._typer = null;
    this._theme = null;
    this._reduced = false;
  }

  mount() {
    if (this.el || !this.root) return this;

    const wrap = el('div', 'tk-screens');

    // -- title --------------------------------------------------------------
    // Scrim rather than solid: the game parks a car on the first grid behind
    // the title, and the whole point of the opening is that this is a place.
    this._title = el('div', 'tk-screen tk-screen-scrim');
    this.logo = createLogo({ size: 132 });
    this.logo.classList.add('tk-title-logo');
    this._titleTag = el('div', 'tk-title-tag tk-txt', 'A FOREST RACING SIMULATION');
    this._titleMenu = el('nav', 'tk-menu');
    this._titleFoot = el('div', 'tk-title-foot tk-txt', '↑ ↓  SELECT     ENTER  CONFIRM');
    this._title.append(this.logo, this._titleTag, this._titleMenu, this._titleFoot);

    // -- countdown ----------------------------------------------------------
    this._countdown = el('div', 'tk-screen');
    this._countNum = el('div', 'tk-count tk-num', '3');
    this._countdown.append(this._countNum);

    // -- results ------------------------------------------------------------
    this._results = el('div', 'tk-screen tk-screen-dim');
    const card = el('div', 'tk-results tk-panel');
    this._resultsTitle = el('h2', null, 'RACE COMPLETE');
    card.append(this._resultsTitle);
    // A fixed row set: position, laps, total, best. Filled, never rebuilt.
    this._resultRows = {};
    for (const [key, label] of [
      ['position', 'POSITION'],
      ['laps', 'LAPS'],
      ['totalTime', 'TOTAL'],
      ['bestLap', 'BEST LAP'],
    ]) {
      const row = el('div', 'tk-row');
      const value = el('span', 'tk-num', '—');
      row.append(el('span', 'tk-label tk-txt', label), value);
      card.append(row);
      this._resultRows[key] = { row, value };
    }
    this._resultsBtn = el('button', 'tk-btn', 'CONTINUE');
    this._resultsBtn.type = 'button';
    const btnWrap = el('div', 'tk-menu');
    btnWrap.append(this._resultsBtn);
    card.append(btnWrap);
    this._results.append(card);

    // -- pause --------------------------------------------------------------
    this._pause = el('div', 'tk-screen tk-screen-dim');
    const pauseCard = el('div', 'tk-results tk-panel');
    pauseCard.append(el('h2', null, 'DURAKLADI'));
    this._pauseMenu = el('nav', 'tk-menu');
    pauseCard.append(this._pauseMenu);
    this._pause.append(pauseCard);

    // -- loading ------------------------------------------------------------
    this._loading = el('div', 'tk-screen tk-screen-solid');
    this._loadingText = el('div', 'tk-loading-text tk-txt', 'LOADING');
    this._loading.append(this._loadingText, el('div', 'tk-loading-bar'));

    // -- alert --------------------------------------------------------------
    this._alert = el('div', 'tk-alert');
    this._alertTitle = el('div', 'tk-alert-title tk-txt', '');
    this._alertBody = el('div', 'tk-alert-body tk-txt', '');
    this._alert.append(this._alertTitle, this._alertBody);

    // -- system message -----------------------------------------------------
    // One text node for the whole block (white-space: pre-wrap handles the
    // newlines) so the typewriter costs exactly one textContent write a frame.
    this._sysmsg = el('div', 'tk-sysmsg');
    this._sysHead = el('div', 'tk-sysmsg-head');
    this._sysHeadLeft = el('span', 'tk-txt', 'SYSTEM');
    this._sysHeadRight = el('span', 'tk-txt', '0451');
    this._sysHead.append(this._sysHeadLeft, this._sysHeadRight);
    const sysBody = el('div', 'tk-sysmsg-body');
    this._sysText = el('span', 'tk-sysmsg-text tk-txt', '');
    this._sysCursor = el('span', 'tk-cursor');
    sysBody.append(this._sysText, this._sysCursor);
    this._sysHint = el('div', 'tk-sysmsg-hint tk-txt', 'PRESS ANY KEY');
    this._sysmsg.append(this._sysHead, sysBody, this._sysHint);

    // -- fade (topmost of the stage) ---------------------------------------
    this._fade = el('div', 'tk-fade');

    wrap.append(
      this._title,
      this._countdown,
      this._results,
      this._pause,
      this._loading,
      this._alert,
      this._sysmsg,
      this._fade
    );
    this.el = wrap;
    this.root.append(wrap);

    this._reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Capture phase: while a modal is up it owns the navigation keys outright,
    // so the car does not steer behind the pause menu.
    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler, true);

    if (this._theme) this.applyTheme(this._theme);
    return this;
  }

  unmount() {
    if (this._keyHandler) window.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
    this.clearAll();
    this.el?.remove();
    this.el = null;
  }

  /** True while any screen that takes input is open — gate your own Escape on it. */
  get isModalOpen() {
    return this._stack.length > 0;
  }

  /** Drives the title logo (and nothing else) from UI.setGlitch. */
  setGlitch(amount01) {
    this.logo?.setGlitch(amount01);
  }

  // -------------------------------------------------------------------------
  // TITLE
  // -------------------------------------------------------------------------

  /**
   * @param {{items?: {id:string,label:string}[], tagline?: string}} [opts]
   * @returns {Promise<string>} the chosen item id ('start' | 'options' | …)
   */
  showTitle(opts = {}) {
    if (!this.el) return Promise.resolve('start');
    const items = Array.isArray(opts.items) && opts.items.length ? opts.items : DEFAULT_TITLE_ITEMS;
    if (typeof opts.tagline === 'string') this._titleTag.textContent = opts.tagline;
    return new Promise((resolve) => {
      this._openMenu(this._title, this._titleMenu, items, 'title', resolve);
    });
  }

  // -------------------------------------------------------------------------
  // COUNTDOWN
  // -------------------------------------------------------------------------

  /**
   * 3 · 2 · 1 · GO.
   * @param {number} [seconds=3]
   * @returns {Promise<void>} resolves after GO clears
   */
  showCountdown(seconds = 3) {
    if (!this.el) return Promise.resolve();
    const n = Math.max(1, Math.floor(Number(seconds) || 3));
    this._open(this._countdown);
    return new Promise((resolve) => {
      const beat = (value, isGo) => {
        this._countNum.textContent = value;
        this._countNum.classList.toggle('is-go', isGo);
        // Restart the pop animation. One forced reflow per second is nothing,
        // and it keeps the reduced-motion opt-out entirely inside the CSS.
        this._countNum.classList.remove('is-beat');
        void this._countNum.offsetWidth;
        this._countNum.classList.add('is-beat');
      };
      let i = n;
      beat(String(i), false);
      const step = () => {
        i -= 1;
        if (i > 0) {
          beat(String(i), false);
          this._after(1, step);
        } else {
          beat('GO', true);
          this._after(0.75, () => {
            this._close(this._countdown);
            resolve();
          });
        }
      };
      this._after(1, step);
    });
  }

  // -------------------------------------------------------------------------
  // RESULTS
  // -------------------------------------------------------------------------

  /**
   * @param {object} [data]
   * @param {number} [data.position] finishing place
   * @param {number} [data.total] number of racers
   * @param {number} [data.laps]
   * @param {number} [data.totalTime] seconds
   * @param {number} [data.bestLap] seconds
   * @param {string} [data.next] label for the confirm button
   * @returns {Promise<'next'>}
   */
  showRaceResults(data = {}) {
    if (!this.el) return Promise.resolve('next');
    const { position, total, laps, totalTime, bestLap, next } = data || {};

    const setRow = (key, text) => {
      const r = this._resultRows[key];
      const empty = text == null || text === '';
      r.row.classList.toggle('tk-hidden', empty);
      if (!empty) r.value.textContent = text;
    };

    setRow('position', position == null ? null : total ? `${position} / ${total}` : `${position}`);
    setRow('laps', laps == null ? null : String(laps));
    setRow('totalTime', totalTime == null ? null : formatTime(totalTime));
    setRow('bestLap', bestLap == null ? null : formatTime(bestLap));
    this._resultsTitle.textContent = position === 1 ? 'WIN' : 'RACE COMPLETE';
    this._resultsBtn.textContent = String(next || 'CONTINUE');

    return new Promise((resolve) => {
      const finish = () => {
        this._resultsBtn.onclick = null;
        this._close(this._results);
        popLayer();
        this._pending.delete('results');
        resolve('next');
      };
      this._resultsBtn.onclick = finish;
      const popLayer = this._pushLayer((e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          finish();
          return true;
        }
        return false;
      });
      this._pending.set('results', finish);
      this._open(this._results);
      this._resultsBtn.classList.add('is-active');
    });
  }

  // -------------------------------------------------------------------------
  // PAUSE
  // -------------------------------------------------------------------------

  /** @returns {Promise<'resume'|'restart'|'quit'>} */
  showPause(opts = {}) {
    if (!this.el) return Promise.resolve('resume');
    const items = Array.isArray(opts.items) && opts.items.length ? opts.items : PAUSE_ITEMS;
    return new Promise((resolve) => {
      this._openMenu(this._pause, this._pauseMenu, items, 'pause', resolve, 'resume');
    });
  }

  // -------------------------------------------------------------------------
  // LOADING
  // -------------------------------------------------------------------------

  /**
   * @param {string} [text]
   * @returns {Promise<void>} resolves once the panel has actually painted, so
   *   `await showLoading()` is safe to put in front of a blocking build step.
   */
  showLoading(text = 'LOADING') {
    if (!this.el) return Promise.resolve();
    this._loadingText.textContent = String(text || 'LOADING').toUpperCase();
    this._open(this._loading);
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      } else resolve();
    });
  }

  /** @returns {Promise<void>} resolves after the panel has faded out. */
  hideLoading() {
    if (!this.el) return Promise.resolve();
    this._close(this._loading);
    return new Promise((resolve) => this._after(0.2, resolve));
  }

  // -------------------------------------------------------------------------
  // FADE
  // -------------------------------------------------------------------------

  /**
   * DOM-level fade, above everything except the CRT overlay.
   * @param {string|null} color CSS colour to fade TO; `null`/'transparent' fades back out
   * @param {number} [duration=0.6] seconds
   * @returns {Promise<void>}
   */
  fadeTo(color, duration = 0.6) {
    if (!this.el) return Promise.resolve();
    const ms = Math.max(0, (Number(duration) || 0) * 1000);
    const out = color == null || color === 'transparent' || color === 'none';
    const from = Number(this._fade.style.opacity || 0);
    const to = out ? 0 : 1;

    if (!out) this._fade.style.background = String(color);
    this._fade.classList.add('is-on');

    const settle = () => {
      this._fade.style.opacity = String(to);
      if (to === 0) this._fade.classList.remove('is-on');
    };

    if (ms === 0 || typeof this._fade.animate !== 'function') {
      settle();
      return Promise.resolve();
    }
    // WAAPI rather than a CSS transition: no first-frame race with `visibility`,
    // and the finished promise is exactly the contract we want to return.
    const anim = this._fade.animate([{ opacity: from }, { opacity: to }], {
      duration: ms,
      easing: 'linear',
      fill: 'forwards',
    });
    return anim.finished
      .catch(() => {})
      .then(() => {
        try {
          anim.cancel();
        } catch {
          /* already gone */
        }
        settle();
      });
  }

  // -------------------------------------------------------------------------
  // ALERT
  // -------------------------------------------------------------------------

  /**
   * A short banner. Only one exists — a new alert replaces the current one and
   * resolves its promise early with 'replaced'.
   * @param {{title?:string, body?:string, tone?:'system'|'warning'|'glitch', duration?:number}} [opts]
   * @returns {Promise<'timeout'|'dismissed'|'replaced'>}
   */
  showAlert(opts = {}) {
    if (!this.el) return Promise.resolve('timeout');
    const { title = '', body = '', tone = 'system', duration = 2.6 } = opts || {};

    this._pending.get('alert')?.('replaced');

    this._alertTitle.textContent = String(title).toUpperCase();
    this._alertBody.textContent = String(body || '');
    this._alertBody.classList.toggle('tk-hidden', !body);
    this._alert.dataset.tone = ['system', 'warning', 'glitch'].includes(tone) ? tone : 'system';
    this._alert.classList.add('is-open');

    return new Promise((resolve) => {
      let cancelTimer = null;
      let popLayer = null;
      const done = (reason) => {
        cancelTimer?.();
        popLayer?.();
        this._pending.delete('alert');
        this._alert.classList.remove('is-open');
        resolve(reason);
      };
      this._pending.set('alert', done);
      const secs = Number(duration);
      if (Number.isFinite(secs) && secs > 0) {
        cancelTimer = this._after(secs, () => done('timeout'));
      } else {
        // A sticky alert has to be dismissable or the game deadlocks.
        popLayer = this._pushLayer(() => {
          done('dismissed');
          return true;
        }, true);
      }
    });
  }

  // -------------------------------------------------------------------------
  // SYSTEM MESSAGE
  // -------------------------------------------------------------------------

  /**
   * The voice of the thing that runs the world. Typed out, monospace, block
   * cursor — it should feel like the game is printing to a console you were
   * never meant to see.
   *
   * @param {string|string[]} lines
   * @param {object} [opts]
   * @param {number} [opts.cps=34]      characters per second
   * @param {number} [opts.hold=1.8]    seconds to hold after the last character
   * @param {boolean} [opts.dismissible=true] first key completes, second closes
   * @param {string} [opts.title='SYSTEM']
   * @param {string} [opts.tag]         right-hand header slug, e.g. 'UNIT 0451'
   * @returns {Promise<void>}
   */
  showSystemMessage(lines, opts = {}) {
    if (!this.el) return Promise.resolve();
    const list = Array.isArray(lines) ? lines : lines == null ? [] : [lines];
    const text = list.map((l) => String(l ?? '')).join('\n');
    const {
      cps = DEFAULT_CPS,
      hold = 1.8,
      dismissible = true,
      title = 'SYSTEM',
      tag = '0451',
    } = opts || {};

    // A second call replaces the first rather than interleaving two typewriters.
    this._pending.get('sysmsg')?.();

    this._sysHeadLeft.textContent = String(title).toUpperCase();
    this._sysHeadRight.textContent = String(tag).toUpperCase();
    this._sysText.textContent = '';
    this._sysHint.classList.remove('is-shown');
    this._sysmsg.classList.add('is-open');

    return new Promise((resolve) => {
      let popLayer = null;
      let cancelHold = null;

      const close = () => {
        cancelHold?.();
        popLayer?.();
        this._typer = null;
        this._pending.delete('sysmsg');
        this._sysmsg.classList.remove('is-open');
        resolve();
      };

      const complete = () => {
        this._sysText.textContent = text;
        if (this._typer) this._typer.chars = text.length;
        if (dismissible) this._sysHint.classList.add('is-shown');
        cancelHold = this._after(Math.max(0, Number(hold) || 0), close);
      };

      // Reduced motion: no reveal animation, just the message.
      this._typer = this._reduced
        ? null
        : {
            text,
            chars: 0,
            cps: Math.max(1, Number(cps) || DEFAULT_CPS),
            onDone: complete,
          };
      if (!this._typer) complete();

      this._pending.set('sysmsg', close);

      if (dismissible) {
        popLayer = this._pushLayer(() => {
          if (this._typer) {
            // First press: skip the reveal. Second press: dismiss.
            const t = this._typer;
            this._typer = null;
            t.onDone();
          } else {
            close();
          }
          return true;
        }, true);
      }
    });
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE
  // -------------------------------------------------------------------------

  /** Close everything and settle every outstanding promise. */
  clearAll() {
    for (const resolve of [...this._pending.values()]) {
      try {
        resolve('cleared');
      } catch {
        /* a rejected screen must not take the rest down */
      }
    }
    this._pending.clear();
    for (const t of this._timers) t.cancelled = true;
    this._timers.length = 0;
    this._stack.length = 0;
    this._typer = null;
    if (!this.el) return;
    for (const node of [this._title, this._countdown, this._results, this._pause, this._loading]) {
      this._close(node);
    }
    this._alert.classList.remove('is-open');
    this._sysmsg.classList.remove('is-open');
    this._fade.classList.remove('is-on');
    this._fade.style.opacity = '0';
  }

  /** @param {object|string} resolvedTheme */
  applyTheme(resolvedTheme) {
    const theme = typeof resolvedTheme === 'string' ? safeResolve(resolvedTheme) : resolvedTheme;
    this._theme = theme || this._theme;
    if (!this.el || !this._theme?.ui) return;
    const ui = this._theme.ui;
    // The system voice always speaks in the theme's alternate accent — in
    // `night` that turns it police-blue, which is the joke.
    if (ui.accentAlt != null) this.el.style.setProperty('--accent-alt', hexToCss(ui.accentAlt));
    if (ui.accent != null) this.el.style.setProperty('--accent', hexToCss(ui.accent));
  }

  /** Per-frame. Runs the typewriter and every pending timer. */
  update(dt) {
    const d = Number(dt) || 0;

    if (this._typer) {
      const t = this._typer;
      t.chars += t.cps * d;
      const n = Math.min(t.text.length, Math.floor(t.chars));
      if (n !== this._sysShown) {
        this._sysShown = n;
        this._sysText.textContent = t.text.slice(0, n);
      }
      if (n >= t.text.length) {
        this._typer = null;
        this._sysShown = -1;
        t.onDone();
      }
    }

    if (this._timers.length) {
      // Backwards so firing handlers may push new timers safely.
      for (let i = this._timers.length - 1; i >= 0; i--) {
        const timer = this._timers[i];
        if (timer.cancelled) {
          this._timers.splice(i, 1);
          continue;
        }
        timer.t -= d;
        if (timer.t <= 0) {
          this._timers.splice(i, 1);
          try {
            timer.fn();
          } catch (err) {
            console.error('[ui/screens] timer threw:', err);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  _open(node) {
    node.classList.add('is-open');
  }

  _close(node) {
    node.classList.remove('is-open');
  }

  /** @returns {() => void} cancel */
  _after(seconds, fn) {
    const timer = { t: Math.max(0, Number(seconds) || 0), fn, cancelled: false };
    this._timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  /**
   * @param {(e: KeyboardEvent) => boolean} handler return true if consumed
   * @param {boolean} [anyKey] handler wants every key, not just navigation keys
   */
  _pushLayer(handler, anyKey = false) {
    const layer = { handler, anyKey };
    this._stack.push(layer);
    return () => {
      const i = this._stack.indexOf(layer);
      if (i >= 0) this._stack.splice(i, 1);
    };
  }

  _onKey(e) {
    const layer = this._stack[this._stack.length - 1];
    if (!layer) return;
    if (!layer.anyKey && !NAV_KEYS.has(e.key)) return;
    // Ignore modifier-only presses so Alt-Tab does not dismiss a message.
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    if (layer.handler(e) !== false) {
      e.preventDefault();
      // The modal owns this key; nothing behind it should also react.
      e.stopPropagation();
    }
  }

  /**
   * Shared menu machinery for the title and pause screens: builds the buttons
   * once per item list, wires pointer + keyboard, resolves with an item id.
   */
  _openMenu(screen, container, items, name, resolve, escapeId = null) {
    // Rebuild only when the item list actually differs from what is there.
    const signature = items.map((i) => `${i.id}:${i.label}`).join('|');
    if (container._signature !== signature) {
      container.textContent = '';
      container._buttons = items.map((item) => {
        const btn = el('button', 'tk-btn', String(item.label));
        btn.type = 'button';
        btn.dataset.id = String(item.id);
        container.append(btn);
        return btn;
      });
      container._signature = signature;
    }
    const buttons = container._buttons;
    let index = 0;

    const paint = () => {
      for (let i = 0; i < buttons.length; i++) buttons[i].classList.toggle('is-active', i === index);
    };

    const finish = (id) => {
      for (const b of buttons) {
        b.onclick = null;
        b.onmouseenter = null;
      }
      popLayer();
      this._close(screen);
      this._pending.delete(name);
      resolve(id);
    };

    buttons.forEach((btn, i) => {
      btn.onmouseenter = () => {
        index = i;
        paint();
      };
      btn.onclick = () => finish(btn.dataset.id);
    });

    const popLayer = this._pushLayer((e) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          index = (index - 1 + buttons.length) % buttons.length;
          paint();
          return true;
        case 'ArrowDown':
        case 's':
        case 'S':
          index = (index + 1) % buttons.length;
          paint();
          return true;
        case 'Enter':
        case ' ':
          finish(buttons[index].dataset.id);
          return true;
        case 'Escape':
          if (escapeId) {
            finish(escapeId);
            return true;
          }
          return false;
        default:
          return false;
      }
    });

    this._pending.set(name, () => finish(escapeId || items[0].id));
    paint();
    this._open(screen);
  }
}
