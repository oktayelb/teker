/**
 * SUBTITLES — the narrative caption channel.
 *
 * Deliberately NOT the same voice as `screens.showSystemMessage()`. A system
 * message is the world's operating system addressing you in a box it drew
 * itself. A subtitle is narration: bottom-centre, no frame, gone in a moment.
 * Keeping them visually distinct is what lets the player feel the difference
 * between being *told* something and being *processed*.
 *
 * One caption element, reused forever. Captions have a duration and a queue,
 * both ticked from `update(dt)` so they pause when the game pauses.
 */

import { resolveTheme, hexToCss } from '../config/style.js';

/** Fade in/out, seconds. Long enough to feel like film, short enough to read. */
const FADE = 0.22;
/** Reading-speed model for captions with no explicit duration. */
const BASE_SECONDS = 1.1;
const SECONDS_PER_CHAR = 0.045;
const MAX_AUTO = 8;

const TONES = new Set(['neutral', 'system', 'radio']);

function autoDuration(text) {
  return Math.min(MAX_AUTO, BASE_SECONDS + String(text).length * SECONDS_PER_CHAR);
}

function safeResolve(name) {
  try {
    return resolveTheme(name);
  } catch {
    return null;
  }
}

export class Subtitles {
  /** @param {Element|null} root */
  constructor(root) {
    this.root = root || null;
    this.el = null;
    /** @type {{text:string,duration:number,speaker:string,tone:string}[]} */
    this._queue = [];
    this._current = null;
    this._t = 0;
    /** 'idle' | 'hold' | 'out' */
    this._state = 'idle';
    this._theme = null;
  }

  mount() {
    if (this.el || !this.root) return this;
    const wrap = document.createElement('div');
    wrap.className = 'tk-subs';
    wrap.dataset.tone = 'neutral';
    // Captions are the one part of the HUD worth speaking aloud, so this is
    // the live region that survives (#ui-root is polite; the HUD opts out).
    wrap.setAttribute('role', 'status');

    this._speaker = document.createElement('span');
    this._speaker.className = 'tk-subs-speaker tk-txt';
    this._text = document.createElement('span');
    this._text.className = 'tk-subs-text tk-txt';

    wrap.append(this._speaker, this._text);
    this.el = wrap;
    this.root.append(wrap);
    if (this._theme) this.applyTheme(this._theme);
    return this;
  }

  unmount() {
    this.el?.remove();
    this.el = null;
    this.clear();
  }

  /**
   * Show now, replacing whatever is on screen. Anything already queued still
   * plays afterwards — `show` interrupts, it does not cancel.
   * @param {string} text
   * @param {{duration?:number, speaker?:string, tone?:'neutral'|'system'|'radio'}} [opts]
   */
  show(text, opts = {}) {
    if (text == null || text === '') return;
    this._present(this._normalise(text, opts));
  }

  /** Append to the queue; plays when the current caption ends. */
  queue(text, opts = {}) {
    if (text == null || text === '') return;
    const item = this._normalise(text, opts);
    if (!this._current && this._state === 'idle') this._present(item);
    else this._queue.push(item);
  }

  /** Drop the current caption and everything waiting. */
  clear() {
    this._queue.length = 0;
    this._current = null;
    this._t = 0;
    this._state = 'idle';
    this.el?.classList.remove('is-shown');
  }

  /** @param {object|string} resolvedTheme */
  applyTheme(resolvedTheme) {
    const theme = typeof resolvedTheme === 'string' ? safeResolve(resolvedTheme) : resolvedTheme;
    this._theme = theme || this._theme;
    if (!this.el || !this._theme?.ui) return;
    const ui = this._theme.ui;
    if (ui.ink != null) this.el.style.setProperty('--ink', hexToCss(ui.ink));
    if (ui.accentAlt != null) this.el.style.setProperty('--accent-alt', hexToCss(ui.accentAlt));
  }

  update(dt) {
    if (!this.el || this._state === 'idle') return;
    this._t -= Number(dt) || 0;
    if (this._t > 0) return;

    if (this._state === 'hold') {
      this._state = 'out';
      this._t = FADE;
      this.el.classList.remove('is-shown');
      return;
    }
    // 'out' finished.
    this._current = null;
    this._state = 'idle';
    const next = this._queue.shift();
    if (next) this._present(next);
  }

  // -- internals ------------------------------------------------------------

  _normalise(text, opts = {}) {
    const o = opts || {};
    const str = String(text);
    return {
      text: str,
      duration: Number.isFinite(o.duration) && o.duration > 0 ? o.duration : autoDuration(str),
      speaker: o.speaker ? String(o.speaker) : '',
      tone: TONES.has(o.tone) ? o.tone : 'neutral',
    };
  }

  _present(item) {
    if (!this.el) {
      // Before mount, hold the newest caption so nothing is silently lost.
      this._current = item;
      return;
    }
    this._current = item;
    this._text.textContent = item.text;
    this._speaker.textContent = item.speaker;
    this._speaker.classList.toggle('tk-hidden', !item.speaker);
    this.el.dataset.tone = item.tone;
    this.el.classList.add('is-shown');
    this._state = 'hold';
    this._t = item.duration;
  }
}
