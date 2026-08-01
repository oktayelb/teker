/**
 * INPUT — raw devices in, one abstract intent struct out.
 *
 * The vehicle never reads the keyboard. It reads an `InputState`. That
 * indirection is what lets the intro director take the wheel (`pushOverride`)
 * or take control away entirely (`setLocked`) without any system knowing.
 */

import { deadzone, clamp } from './mathx.js';
import { events } from './events.js';

/** Logical actions → default key codes. Rebindable at runtime. */
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  lookBehind: ['KeyV'],
  cycleCamera: ['KeyC'],
  respawn: ['KeyR'],
  horn: ['KeyH'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  skip: ['Enter', 'Space'],
  debugPanel: ['Backquote'],
  // Free-camera only
  camUp: ['KeyE'],
  camDown: ['KeyQ'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};

/** The struct every consumer reads. Values are already smoothed-free/raw. */
export function createInputState() {
  return {
    /** -1..1, positive = right */
    steer: 0,
    /** 0..1 */
    throttle: 0,
    /** 0..1 */
    brake: 0,
    /** 0..1 */
    handbrake: 0,
    /** true while held */
    lookBehind: false,
    /** Free-cam vertical, -1..1 */
    lift: 0,
    sprint: false,
    /** Mouse delta since last frame, radians-ish (free cam only). */
    mouseDx: 0,
    mouseDy: 0,
    /** True when the state came from a script rather than a human. */
    synthetic: false,
  };
}

export class Input {
  /**
   * @param {HTMLElement} target element that receives key/pointer events
   */
  constructor(target = globalThis) {
    this.target = target;
    this.state = createInputState();
    /** Edge-triggered actions consumed via `pressed()`. */
    this._down = new Set();
    this._pressedThisFrame = new Set();
    this._releasedThisFrame = new Set();
    this._mouseDx = 0;
    this._mouseDy = 0;
    this._pointerLocked = false;

    /** When locked, the human is ignored (but overrides still apply). */
    this.locked = false;
    /** Stack of scripted input providers; the top one wins. */
    this._overrides = [];
    /** Gamepad index, or null. */
    this.gamepadIndex = null;
    this.enabled = true;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onGamepad = this._onGamepad.bind(this);
  }

  attach() {
    globalThis.addEventListener('keydown', this._onKeyDown, { passive: false });
    globalThis.addEventListener('keyup', this._onKeyUp);
    globalThis.addEventListener('blur', this._onBlur);
    globalThis.addEventListener('mousemove', this._onMouseMove);
    globalThis.addEventListener('gamepadconnected', this._onGamepad);
    return this;
  }

  detach() {
    globalThis.removeEventListener('keydown', this._onKeyDown);
    globalThis.removeEventListener('keyup', this._onKeyUp);
    globalThis.removeEventListener('blur', this._onBlur);
    globalThis.removeEventListener('mousemove', this._onMouseMove);
    globalThis.removeEventListener('gamepadconnected', this._onGamepad);
  }

  // -- device handlers ------------------------------------------------------

  _isTypingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  _onKeyDown(e) {
    if (this._isTypingTarget(e.target)) return;
    // Stop the page scrolling under the game.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this._down.add(e.code);
    this._pressedThisFrame.add(e.code);
    events.emit('input:key', { code: e.code, down: true });
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
    this._releasedThisFrame.add(e.code);
    events.emit('input:key', { code: e.code, down: false });
  }

  _onBlur() {
    this._down.clear();
  }

  _onMouseMove(e) {
    if (this._pointerLocked) {
      this._mouseDx += e.movementX || 0;
      this._mouseDy += e.movementY || 0;
    }
  }

  _onGamepad(e) {
    this.gamepadIndex = e.gamepad.index;
    events.emit('input:gamepad', { index: e.gamepad.index, id: e.gamepad.id });
  }

  // -- queries --------------------------------------------------------------

  /** Is any key bound to `action` held? Ignores `locked` — for UI keys. */
  isDown(action) {
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const c of codes) if (this._down.has(c)) return true;
    return false;
  }

  /** Was `action` pressed this frame? Edge-triggered. */
  pressed(action) {
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const c of codes) if (this._pressedThisFrame.has(c)) return true;
    return false;
  }

  released(action) {
    const codes = BINDINGS[action];
    if (!codes) return false;
    for (const c of codes) if (this._releasedThisFrame.has(c)) return true;
    return false;
  }

  // -- scripted control -----------------------------------------------------

  /**
   * Take the wheel. `provider(state, dt)` mutates the state struct.
   * Returns a release function. Used by the intro; nothing else should need it.
   */
  pushOverride(provider) {
    const entry = { provider };
    this._overrides.push(entry);
    return () => {
      const i = this._overrides.indexOf(entry);
      if (i >= 0) this._overrides.splice(i, 1);
    };
  }

  /** Freeze the human's driving inputs (menus, cutscenes, the glitch). */
  setLocked(locked) {
    this.locked = !!locked;
    if (locked) {
      this.state.steer = 0;
      this.state.throttle = 0;
      this.state.brake = 0;
      this.state.handbrake = 0;
    }
  }

  // -- per-frame ------------------------------------------------------------

  /** Sample devices into `state`. Call once per rendered frame, before update. */
  update(dt) {
    const s = this.state;
    s.synthetic = false;

    if (!this.enabled || this.locked) {
      s.steer = 0;
      s.throttle = 0;
      s.brake = 0;
      s.handbrake = 0;
      s.lookBehind = false;
      s.lift = 0;
      s.mouseDx = 0;
      s.mouseDy = 0;
    } else {
      let steer = 0;
      if (this.isDown('left')) steer -= 1;
      if (this.isDown('right')) steer += 1;
      let throttle = this.isDown('forward') ? 1 : 0;
      let brake = this.isDown('back') ? 1 : 0;
      let handbrake = this.isDown('handbrake') ? 1 : 0;
      let lift = 0;
      if (this.isDown('camUp')) lift += 1;
      if (this.isDown('camDown')) lift -= 1;

      const pad = this._readGamepad();
      if (pad) {
        if (Math.abs(pad.steer) > Math.abs(steer)) steer = pad.steer;
        throttle = Math.max(throttle, pad.throttle);
        brake = Math.max(brake, pad.brake);
        handbrake = Math.max(handbrake, pad.handbrake);
      }

      s.steer = clamp(steer, -1, 1);
      s.throttle = clamp(throttle, 0, 1);
      s.brake = clamp(brake, 0, 1);
      s.handbrake = clamp(handbrake, 0, 1);
      s.lookBehind = this.isDown('lookBehind') || (pad?.lookBehind ?? false);
      s.lift = lift;
      s.sprint = this.isDown('sprint');
      s.mouseDx = this._mouseDx;
      s.mouseDy = this._mouseDy;
    }

    // Scripted control runs last so it can override anything above.
    for (const { provider } of this._overrides) {
      provider(s, dt);
      s.synthetic = true;
    }

    this._mouseDx = 0;
    this._mouseDy = 0;
    return s;
  }

  /** Clear edge-triggered sets. Call at the very END of the frame. */
  endFrame() {
    this._pressedThisFrame.clear();
    this._releasedThisFrame.clear();
  }

  _readGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return null;
    return {
      steer: deadzone(gp.axes[0] ?? 0),
      // Standard mapping: 7 = right trigger, 6 = left trigger.
      throttle: Math.max(gp.buttons[7]?.value ?? 0, gp.buttons[0]?.pressed ? 1 : 0),
      brake: gp.buttons[6]?.value ?? 0,
      handbrake: gp.buttons[1]?.pressed ? 1 : 0,
      lookBehind: !!gp.buttons[3]?.pressed,
    };
  }

  setPointerLocked(v) {
    this._pointerLocked = !!v;
  }
}

export const input = new Input();
