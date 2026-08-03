/**
 * SETTINGS — the options the *player* changes, as opposed to the numbers the
 * designer changes in the rest of `src/config/`.
 *
 * Schema-driven on purpose: `src/ui/settingsMenu.js` renders whatever is listed
 * here, and `Game#_applySetting` decides what each one does. Adding an option is
 * one entry below plus one `case`. The menu never needs touching.
 *
 * Values persist to localStorage, so they survive the reload that "Ana Menü"
 * performs.
 */

import { events } from '../core/events.js';

const STORAGE_KEY = 'teker.settings.v1';

const pct = (v) => `${Math.round(v * 100)}%`;
const mult = (v) => `${v.toFixed(2)}×`;

/**
 * @typedef {object} SettingItem
 * @property {string} id
 * @property {string} label
 * @property {'slider'|'toggle'|'choice'} type
 * @property {any} default
 */

export const SETTINGS_SCHEMA = [
  {
    id: 'audio',
    label: 'SES',
    items: [
      { id: 'muted', label: 'Sessiz', type: 'toggle', default: false },
      { id: 'masterVolume', label: 'Ana Ses', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.8, format: pct },
      { id: 'musicVolume', label: 'Müzik', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 1, format: pct },
      { id: 'sfxVolume', label: 'Efektler', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 1, format: pct },
      { id: 'engineVolume', label: 'Motor', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 1, format: pct },
      { id: 'ambienceVolume', label: 'Ortam', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 1, format: pct },
    ],
  },
  {
    id: 'light',
    label: 'IŞIK',
    items: [
      {
        id: 'worldLight',
        label: 'Dünya Işığı',
        hint: 'Sahnedeki güneş ve ortam ışığı',
        type: 'slider', min: 0.3, max: 2.5, step: 0.05, default: 1, format: mult,
      },
      {
        id: 'brightness',
        label: 'Parlaklık',
        hint: 'Ekran parlaklığı (gece bölümü için)',
        type: 'slider', min: 0.6, max: 2.0, step: 0.05, default: 1, format: mult,
      },
      { id: 'contrast', label: 'Kontrast', type: 'slider', min: 0.7, max: 1.6, step: 0.05, default: 1, format: mult },
    ],
  },
  {
    id: 'video',
    label: 'GÖRÜNTÜ',
    items: [
      {
        id: 'renderPreset',
        label: 'Görüntü Modu',
        hint: 'PSX en retro, Clean en net',
        type: 'choice',
        options: [
          { value: 'psx', label: 'PSX' },
          { value: 'n64', label: 'N64' },
          { value: 'clean', label: 'CLEAN' },
        ],
        default: 'psx',
      },
      // Multipliers on the active preset, not absolutes — so switching to
      // CLEAN really does remove them rather than the override forcing them back.
      { id: 'scanlines', label: 'Tarama Çizgileri', type: 'slider', min: 0, max: 2, step: 0.05, default: 1, format: mult },
      { id: 'vignette', label: 'Köşe Karartma', type: 'slider', min: 0, max: 2, step: 0.05, default: 1, format: mult },
      { id: 'chromatic', label: 'Renk Kayması', type: 'slider', min: 0, max: 2, step: 0.05, default: 1, format: mult },
    ],
  },
  {
    id: 'game',
    label: 'OYUN',
    items: [
      {
        id: 'cameraRig',
        label: 'Kamera',
        type: 'choice',
        options: [
          { value: 'chase', label: 'TAKİP' },
          { value: 'chaseTight', label: 'YAKIN' },
          { value: 'chaseWide', label: 'GENİŞ' },
          { value: 'hood', label: 'KAPUT' },
          { value: 'bumper', label: 'TAMPON' },
        ],
        default: 'chase',
      },
      { id: 'cameraShake', label: 'Kamera Sarsıntısı', type: 'slider', min: 0, max: 2, step: 0.1, default: 1, format: mult },
    ],
  },
];

/** Flat id → item lookup. */
export const SETTING_ITEMS = new Map();
for (const section of SETTINGS_SCHEMA) {
  for (const item of section.items) SETTING_ITEMS.set(item.id, item);
}

export const DEFAULTS = Object.fromEntries([...SETTING_ITEMS].map(([id, it]) => [id, it.default]));

class SettingsStore {
  constructor() {
    this.values = { ...DEFAULTS };
    this._loaded = false;
  }

  /** Read from localStorage. Safe to call before any DOM exists. */
  load() {
    if (this._loaded) return this;
    this._loaded = true;
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return this;
      const saved = JSON.parse(raw);
      for (const [k, v] of Object.entries(saved)) {
        // Ignore anything the schema no longer knows about, so an old save
        // cannot resurrect a removed option.
        if (SETTING_ITEMS.has(k)) this.values[k] = v;
      }
    } catch {
      /* corrupt or unavailable storage is not worth crashing over */
    }
    return this;
  }

  save() {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* private browsing, quota, etc. */
    }
  }

  get(id) {
    return this.values[id];
  }

  /** Set and broadcast. `silent` skips the event (used during bulk apply). */
  set(id, value, { silent = false, persist = true } = {}) {
    const item = SETTING_ITEMS.get(id);
    if (!item) return;
    let v = value;
    if (item.type === 'slider') v = Math.min(item.max, Math.max(item.min, Number(v)));
    if (item.type === 'toggle') v = !!v;
    if (this.values[id] === v) return;
    this.values[id] = v;
    if (persist) this.save();
    if (!silent) events.emit('settings:changed', { id, value: v });
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.save();
    events.emit('settings:reset', {});
    for (const id of SETTING_ITEMS.keys()) {
      events.emit('settings:changed', { id, value: this.values[id] });
    }
  }

  /** Re-broadcast everything — used once at boot to apply the saved state. */
  applyAll() {
    for (const id of SETTING_ITEMS.keys()) {
      events.emit('settings:changed', { id, value: this.values[id] });
    }
  }
}

export const settings = new SettingsStore();
