/**
 * SETTINGS MENU — the panel behind Escape → AYARLAR.
 *
 * Renders whatever `SETTINGS_SCHEMA` lists; it has no knowledge of what any
 * option does. Changing a value writes to the store, which broadcasts
 * `settings:changed`, which `Game` acts on — so every control is live while the
 * menu is open and you can hear and see what you are adjusting.
 *
 * Driven by keyboard (↑↓ to move, ←→ to change, Enter to toggle, Esc to close)
 * and by mouse. Both, because a driving game is played on a keyboard and a
 * menu is not.
 */

import { SETTINGS_SCHEMA, settings } from '../config/settings.js';
import { hexToCss } from '../config/style.js';
import { events } from '../core/events.js';

export class SettingsMenu {
  constructor(root = null) {
    this.root = root;
    this.el = null;
    this.open = false;
    /** @type {{item:object, row:HTMLElement, apply:(v:any)=>void}[]} */
    this._rows = [];
    this._index = 0;
    this._resolve = null;
    this._onKey = this._onKey.bind(this);
  }

  mount(root) {
    if (this.el) return this;
    this.root = root || this.root;
    if (!this.root) return this;

    const el = document.createElement('div');
    el.className = 'tk-screen tk-screen-dim tk-settings';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Ayarlar');

    const panel = document.createElement('div');
    panel.className = 'tk-settings-panel';

    const title = document.createElement('div');
    title.className = 'tk-settings-title';
    title.textContent = 'AYARLAR';
    panel.appendChild(title);

    const body = document.createElement('div');
    body.className = 'tk-settings-body';
    for (const section of SETTINGS_SCHEMA) {
      const h = document.createElement('div');
      h.className = 'tk-settings-section';
      h.textContent = section.label;
      body.appendChild(h);
      for (const item of section.items) body.appendChild(this._buildRow(item));
    }
    panel.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'tk-settings-foot';
    foot.innerHTML =
      '<span>↑↓ SEÇ</span><span>←→ DEĞİŞTİR</span><span>ENTER UYGULA</span><span>ESC KAPAT</span>';
    panel.appendChild(foot);

    const actions = document.createElement('div');
    actions.className = 'tk-settings-actions';
    actions.appendChild(this._button('VARSAYILANA DÖN', () => {
      settings.reset();
      this._syncAll();
      events.emit('ui:blip', { kind: 'back' });
    }));
    actions.appendChild(this._button('KAPAT', () => this.close()));
    panel.appendChild(actions);

    el.appendChild(panel);
    this.root.appendChild(el);
    this.el = el;
    return this;
  }

  _button(label, onClick) {
    const b = document.createElement('button');
    b.className = 'tk-settings-btn';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _buildRow(item) {
    const row = document.createElement('div');
    row.className = 'tk-settings-row';
    row.dataset.id = item.id;

    const label = document.createElement('div');
    label.className = 'tk-settings-label';
    label.textContent = item.label;
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'tk-settings-hint';
      hint.textContent = item.hint;
      label.appendChild(hint);
    }
    row.appendChild(label);

    const control = document.createElement('div');
    control.className = 'tk-settings-control';
    let apply;

    if (item.type === 'slider') {
      const bar = document.createElement('div');
      bar.className = 'tk-settings-bar';
      const fill = document.createElement('div');
      fill.className = 'tk-settings-fill';
      bar.appendChild(fill);
      const val = document.createElement('span');
      val.className = 'tk-settings-value';
      control.append(bar, val);

      bar.addEventListener('pointerdown', (e) => {
        const seek = (ev) => {
          const r = bar.getBoundingClientRect();
          const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
          settings.set(item.id, item.min + t * (item.max - item.min));
          this._sync(item.id);
        };
        seek(e);
        const move = (ev) => seek(ev);
        const up = () => {
          globalThis.removeEventListener('pointermove', move);
          globalThis.removeEventListener('pointerup', up);
        };
        globalThis.addEventListener('pointermove', move);
        globalThis.addEventListener('pointerup', up);
      });

      apply = (v) => {
        const t = (v - item.min) / (item.max - item.min);
        fill.style.width = `${Math.round(t * 100)}%`;
        val.textContent = item.format ? item.format(v) : String(v);
      };
    } else if (item.type === 'toggle') {
      const box = document.createElement('span');
      box.className = 'tk-settings-toggle';
      control.appendChild(box);
      box.addEventListener('click', () => {
        settings.set(item.id, !settings.get(item.id));
        this._sync(item.id);
      });
      apply = (v) => {
        box.textContent = v ? '[ AÇIK ]' : '[ KAPALI ]';
        box.dataset.on = String(!!v);
      };
    } else {
      const wrap = document.createElement('span');
      wrap.className = 'tk-settings-choice';
      control.appendChild(wrap);
      const buttons = item.options.map((opt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = opt.label;
        b.addEventListener('click', () => {
          settings.set(item.id, opt.value);
          this._sync(item.id);
        });
        wrap.appendChild(b);
        return { b, value: opt.value };
      });
      apply = (v) => {
        for (const { b, value } of buttons) b.dataset.on = String(value === v);
      };
    }

    row.appendChild(control);
    row.addEventListener('pointerenter', () => {
      this._index = this._rows.findIndex((r) => r.item.id === item.id);
      this._highlight();
    });
    this._rows.push({ item, row, apply });
    return row;
  }

  // -- open / close ---------------------------------------------------------

  /** @returns {Promise<void>} resolves when the player closes the panel */
  show() {
    if (!this.el) return Promise.resolve();
    this.open = true;
    this.el.classList.add('is-open');
    this._index = 0;
    this._syncAll();
    this._highlight();
    globalThis.addEventListener('keydown', this._onKey, true);
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el?.classList.remove('is-open');
    globalThis.removeEventListener('keydown', this._onKey, true);
    const r = this._resolve;
    this._resolve = null;
    r?.();
  }

  _syncAll() {
    for (const r of this._rows) r.apply(settings.get(r.item.id));
  }

  _sync(id) {
    const r = this._rows.find((x) => x.item.id === id);
    if (r) r.apply(settings.get(id));
  }

  _highlight() {
    this._rows.forEach((r, i) => r.row.classList.toggle('is-active', i === this._index));
    this._rows[this._index]?.row.scrollIntoView({ block: 'nearest' });
  }

  _onKey(e) {
    if (!this.open) return;
    // Capture phase + stopPropagation: while this panel is up it owns the
    // keyboard, so Escape does not also reach the pause menu underneath.
    const step = (dir) => {
      const { item } = this._rows[this._index];
      if (item.type === 'slider') {
        settings.set(item.id, settings.get(item.id) + dir * item.step);
      } else if (item.type === 'toggle') {
        settings.set(item.id, !settings.get(item.id));
      } else {
        const vals = item.options.map((o) => o.value);
        const i = vals.indexOf(settings.get(item.id));
        settings.set(item.id, vals[(i + dir + vals.length) % vals.length]);
      }
      this._sync(item.id);
      events.emit('ui:blip', { kind: 'move' });
    };

    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this._index = (this._index - 1 + this._rows.length) % this._rows.length;
        this._highlight();
        events.emit('ui:blip', { kind: 'move' });
        break;
      case 'ArrowDown':
      case 'KeyS':
        this._index = (this._index + 1) % this._rows.length;
        this._highlight();
        events.emit('ui:blip', { kind: 'move' });
        break;
      case 'ArrowLeft':
      case 'KeyA':
        step(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        step(1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        step(1);
        break;
      case 'Escape':
      case 'Backspace':
        events.emit('ui:blip', { kind: 'back' });
        this.close();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  applyTheme(theme) {
    if (!this.el || !theme?.ui) return;
    this.el.style.setProperty('--settings-accent', hexToCss(theme.ui.accent));
  }

  unmount() {
    globalThis.removeEventListener('keydown', this._onKey, true);
    this.el?.remove();
    this.el = null;
    this._rows.length = 0;
  }
}
