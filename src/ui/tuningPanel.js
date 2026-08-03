/**
 * TUNING PANEL — live knobs for the things that are hard to judge on paper.
 *
 * Press ` (backtick) in game. Everything here edits the *resolved* objects the
 * running systems already hold, so changes land on the next frame with no
 * reload: `vehicle.tuning` is a live snapshot, `cameraRig.rig` is a live
 * preset, and the renderer's preset is re-applied on write.
 *
 * The panel is a debug tool, not a settings menu. It is deliberately ugly, it
 * does not persist, and `Copy values` gives you something to paste back into
 * `src/config/` once you have found a feel you like.
 */

import { PACE, PROFILES } from '../config/tuning.js';
import { CYCLE_ORDER } from '../config/camera.js';
import { RENDER_PRESETS, THEMES } from '../config/style.js';
import { events } from '../core/events.js';

/** [label, path, min, max, step] — path is resolved against the target object. */
const VEHICLE_FIELDS = [
  ['Engine force', 'engineForce', 2000, 30000, 100],
  ['Max speed', 'maxSpeed', 10, 90, 1],
  ['Throttle rise', 'throttleRise', 0, 1, 0.01],
  ['Brake force', 'brakeForce', 2000, 45000, 250],
  ['Drag', 'dragCoefficient', 0, 2, 0.01],
  ['Rolling resist.', 'rollingResistance', 0, 60, 0.5],
  ['Engine braking', 'engineBraking', 0, 20, 0.1],
  ['Steer lock °', 'maxSteerDeg', 8, 60, 1],
  ['Steer falloff', 'steerSpeedFalloff', 0.05, 1, 0.01],
  ['Turn rate', 'turnRate', 0.4, 6, 0.05],
  ['Yaw damping', 'yawDamping', 0.5, 12, 0.1],
  ['Lateral grip', 'lateralGrip', 1, 30, 0.25],
  ['Slide grip', 'slideGrip', 0.5, 20, 0.25],
  ['Slip threshold', 'slipThreshold', 0.5, 14, 0.1],
  ['Stability assist', 'stabilityAssist', 0, 1, 0.01],
  ['Handbrake grip', 'handbrakeGripScale', 0.02, 1, 0.01],
  ['Gravity', 'gravity', 8, 45, 0.5],
  ['Body roll', 'bodyRollGain', 0, 0.3, 0.005],
  ['Body pitch', 'bodyPitchGain', 0, 0.3, 0.005],
];

const CAMERA_FIELDS = [
  ['Offset X', 'offset.x', -12, 12, 0.1],
  ['Offset Y', 'offset.y', 0.2, 14, 0.1],
  ['Offset Z', 'offset.z', -22, 6, 0.1],
  ['Look Y', 'lookAt.y', -2, 6, 0.1],
  ['Look Z', 'lookAt.z', -10, 24, 0.2],
  ['Pos stiffness', 'positionStiffness', 0.5, 40, 0.25],
  ['Look stiffness', 'lookStiffness', 0.5, 40, 0.25],
  ['Rot stiffness', 'rotationStiffness', 0.5, 40, 0.25],
  ['Velocity follow', 'velocityFollow', 0, 1, 0.01],
  ['Speed pullback', 'speedPullback', 0, 12, 0.1],
  ['Speed drop', 'speedDrop', 0, 4, 0.05],
  ['FOV', 'fov', 30, 110, 1],
  ['FOV speed gain', 'fovSpeedGain', 0, 40, 0.5],
  ['Lateral lead', 'lateralLead', 0, 3, 0.05],
  ['Shake scale', 'shakeScale', 0, 3, 0.05],
];

const PACE_FIELDS = [
  ['Time scale', 'timeScale', 0.2, 2, 0.01],
  ['Force scale', 'forceScale', 0.2, 3, 0.01],
  ['Grip scale', 'gripScale', 0.2, 3, 0.01],
];

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function set(obj, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export class TuningPanel {
  /** @param {import('../game/game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.visible = false;
    this._rows = [];
    this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'tuning-panel';
    el.setAttribute('data-open', 'false');
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: '330px',
      maxHeight: '100vh',
      overflowY: 'auto',
      background: 'rgba(8,10,12,0.93)',
      color: '#d8e0d8',
      font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
      padding: '10px 12px 40px',
      zIndex: '10000',
      display: 'none',
      pointerEvents: 'auto',
      borderLeft: '1px solid #2a3630',
    });
    this.el = el;

    el.appendChild(this._header());
    el.appendChild(this._selectors());
    el.appendChild(this._section('VEHICLE', VEHICLE_FIELDS, () => this.game.player?.tuning));
    el.appendChild(this._section('CAMERA', CAMERA_FIELDS, () => this.game.camera.rig));
    el.appendChild(this._section('PACE', PACE_FIELDS, () => PACE));
    el.appendChild(this._readout());
    el.appendChild(this._actions());

    document.body.appendChild(el);
  }

  _header() {
    const h = document.createElement('div');
    h.textContent = 'TEKER · TUNING  [`] to close';
    Object.assign(h.style, {
      fontWeight: 'bold',
      letterSpacing: '0.08em',
      color: '#54c8b0',
      marginBottom: '8px',
      borderBottom: '1px solid #2a3630',
      paddingBottom: '6px',
    });
    return h;
  }

  _selectors() {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '10px';

    const mk = (label, options, current, onChange) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      row.style.marginBottom = '4px';
      const l = document.createElement('span');
      l.textContent = label;
      l.style.width = '74px';
      l.style.opacity = '0.7';
      const sel = document.createElement('select');
      Object.assign(sel.style, {
        flex: '1',
        background: '#121a18',
        color: '#d8e0d8',
        border: '1px solid #2a3630',
        font: 'inherit',
        padding: '2px',
      });
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        if (o === current()) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      row.append(l, sel);
      wrap.appendChild(row);
      return sel;
    };

    mk('Camera', CYCLE_ORDER.concat('free'), () => this.game.camera.rigName, (v) => {
      this.game.camera.setRig(v);
      this.refresh();
    });
    mk('Render', Object.keys(RENDER_PRESETS), () => this.game.renderer.preset.name, (v) =>
      this.game.renderer.setRenderPreset(v)
    );
    mk('Theme', Object.keys(THEMES), () => this.game.renderer.theme.name, (v) =>
      this.game.setTheme(v, 0.8)
    );
    mk('Profile', Object.keys(PROFILES), () => this.game.player?.tuning.name ?? '', (v) => {
      events.emit('ui:subtitle', { text: `PROFILE · ${v} (respawn to apply)`, duration: 2, tone: 'system' });
      this._pendingProfile = v;
    });
    return wrap;
  }

  _section(title, fields, getTarget) {
    const wrap = document.createElement('details');
    wrap.open = true;
    const sum = document.createElement('summary');
    sum.textContent = title;
    Object.assign(sum.style, { cursor: 'pointer', color: '#9aa694', margin: '8px 0 4px', letterSpacing: '0.1em' });
    wrap.appendChild(sum);

    for (const [label, path, min, max, step] of fields) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' });

      const l = document.createElement('span');
      l.textContent = label;
      Object.assign(l.style, { width: '96px', opacity: '0.75', flexShrink: '0' });

      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      Object.assign(input.style, { flex: '1', minWidth: '0', accentColor: '#54c8b0' });

      const val = document.createElement('span');
      Object.assign(val.style, { width: '52px', textAlign: 'right', color: '#54c8b0', flexShrink: '0' });

      input.addEventListener('input', () => {
        const target = getTarget();
        if (!target) return;
        const n = parseFloat(input.value);
        set(target, path, n);
        val.textContent = fmt(n);
        // Degrees fields have a radians twin that systems actually read.
        if (path === 'maxSteerDeg') target.maxSteer = (n * Math.PI) / 180;
        if (path === 'lateralRollDeg') target.lateralRoll = (n * Math.PI) / 180;
      });

      row.append(l, input, val);
      wrap.appendChild(row);
      this._rows.push({ input, val, path, getTarget });
    }
    return wrap;
  }

  _readout() {
    const el = document.createElement('pre');
    Object.assign(el.style, {
      margin: '10px 0 0',
      padding: '6px',
      background: '#101614',
      border: '1px solid #2a3630',
      color: '#8fb3a4',
      whiteSpace: 'pre',
      fontSize: '10px',
    });
    this._readoutEl = el;
    return el;
  }

  _actions() {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', gap: '6px', marginTop: '8px' });
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1',
        background: '#1a2422',
        color: '#d8e0d8',
        border: '1px solid #2a3630',
        font: 'inherit',
        padding: '4px',
        cursor: 'pointer',
      });
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    };
    mk('Copy values', () => this._copy());
    mk('Reset car', () => {
      const g = this.game;
      if (!g.player) return;
      const p = g.world.safePlaceNear(g.player.position.x, g.player.position.z);
      g.player.reset(p, g.player.heading);
    });
    return wrap;
  }

  _copy() {
    const v = this.game.player?.tuning;
    const c = this.game.camera.rig;
    const out = {
      profile: v ? Object.fromEntries(VEHICLE_FIELDS.map(([, p]) => [p, get(v, p)])) : null,
      cameraRig: { name: c.name, ...Object.fromEntries(CAMERA_FIELDS.map(([, p]) => [p, get(c, p)])) },
      pace: { ...PACE },
    };
    const text = JSON.stringify(out, null, 2);
    navigator.clipboard?.writeText(text);
    console.log('[tuning] copied:\n' + text);
    events.emit('ui:subtitle', { text: 'VALUES COPIED TO CLIPBOARD', duration: 1.6, tone: 'system' });
  }

  /** Pull current values back into the sliders (after a rig or car change). */
  refresh() {
    for (const r of this._rows) {
      const target = r.getTarget();
      if (!target) continue;
      const v = get(target, r.path);
      if (typeof v !== 'number') continue;
      r.input.value = String(v);
      r.val.textContent = fmt(v);
    }
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    this.el.setAttribute('data-open', String(this.visible));
    if (this.visible) {
      this.refresh();
      this._startReadout();
    } else {
      clearInterval(this._readoutTimer);
    }
  }

  _startReadout() {
    clearInterval(this._readoutTimer);
    this._readoutTimer = setInterval(() => {
      const g = this.game;
      const p = g.player;
      const lines = [
        `fps      ${g.loop.stats.fps.toFixed(0)}   steps ${g.loop.stats.steps}`,
        `mode     ${g.modes.currentName ?? '—'}`,
        `rig      ${g.camera.rigName}`,
      ];
      if (p) {
        lines.push(
          `speed    ${(p.speed * 3.6).toFixed(1)} km/h  (${p.speed.toFixed(1)} m/s)`,
          `surface  ${p.surface.id}  grip ${p.surface.grip}`,
          `slip     ${p.slip.toFixed(2)}   yaw ${p.yawRate.toFixed(2)}`,
          `pos      ${p.position.x.toFixed(0)}, ${p.position.z.toFixed(0)}`,
          `ground   ${p.grounded ? 'yes' : 'AIR'}  h ${p.groundHeight.toFixed(1)}`
        );
      }
      this._readoutEl.textContent = lines.join('\n');
    }, 120);
  }

  dispose() {
    clearInterval(this._readoutTimer);
    this.el.remove();
  }
}

function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(3);
}
