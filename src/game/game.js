/**
 * GAME — the context object every mode is handed.
 *
 * It owns the long-lived things: the renderer, the world, the camera, input,
 * audio, UI, and the vehicle registry. It owns no rules. Modes own rules.
 *
 * NOTE ON THE INTRO
 * -----------------
 * This file does not import anything from `src/game/intro/`. It exposes enough
 * surface (`modes`, `spawnVehicle`, `setTheme`, `player`, the event bus) for a
 * director to drive it from outside. `src/main.js` decides whether to attach
 * one. Delete the intro folder and this class does not notice.
 */

import * as THREE from 'three';
import { RetroRenderer } from '../render/renderer.js';
import { CameraRig } from '../render/cameraRig.js';
import { World } from '../world/world.js';
import { Vehicle } from '../vehicle/vehicle.js';
import { createChassis } from '../vehicle/chassis.js';
import { resolveVehicleContacts } from '../vehicle/contacts.js';
import { Loop } from '../core/loop.js';
import { ModeManager } from '../core/modes.js';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';
import { ui } from '../ui/index.js';
import { ALL_TRACKS } from '../world/tracks/index.js';
import { MODE_RIGS } from '../config/camera.js';
import { OPEN_WORLD, PLAYER } from '../config/gameplay.js';
import { ACTIVE_PROFILE } from '../config/tuning.js';
import { settings } from '../config/settings.js';
import { clamp01 } from '../core/mathx.js';

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} boot options from `readBootOptions()`
   */
  constructor(canvas, boot = {}) {
    this.canvas = canvas;
    this.boot = boot;
    this.time = 0;

    this.renderer = new RetroRenderer(canvas, {
      theme: boot.theme || 'forest',
      preset: boot.renderPreset || undefined,
    });
    this.camera = new CameraRig(this.renderer.camera, null);
    this.input = input;
    this.events = events;
    this.audio = audio;
    this.ui = ui;
    this.loop = new Loop({ hz: 120, maxSubSteps: 6 });
    this.modes = new ModeManager(this);

    /** @type {World|null} */
    this.world = null;
    /** @type {Vehicle|null} the car the human is driving */
    this.player = null;
    /** @type {Vehicle[]} everything that gets a physics step */
    this.vehicles = [];
    /** Per-vehicle driver hook: `(vehicle, dt) => command`. */
    this._drivers = new Map();

    /** Set by modes; the intro reads it to know where it is. */
    this.flags = { escaped: false, chaseOver: false, racesCompleted: 0 };

    this._boundResize = () => this._onResize();
    this._debugPanel = null;
  }

  get materials() {
    return this.renderer.materials;
  }
  get theme() {
    return this.renderer.theme;
  }
  get scene() {
    return this.renderer.scene;
  }

  // -- lifecycle ------------------------------------------------------------

  async init({ onProgress = null } = {}) {
    this.ui.mount();
    this.ui.applyTheme(this.renderer.theme);
    this.input.attach();

    // Audio must wait for a gesture; arm it on the first one we see.
    //
    // CAPTURE PHASE, and it matters. Modal screens also listen on `window`, in
    // the capture phase, and call stopPropagation() on the keys they own (see
    // ui/screens.js `_onKey`). `window` is both the first node of the capture
    // path and the last of the bubble path, so stopping there means a
    // bubble-phase listener never runs at all — and the very first gesture a
    // player makes is ENTER on the title menu, which the menu owns. Registered
    // on the bubble it was swallowed, the context stayed suspended, and the
    // game was silent until the player happened to press a key no modal wanted.
    this.audio.init();
    const unlock = () => {
      // Retire the listeners only once the context is GENUINELY running.
      //
      // `unlock()` resolves to whether it worked: resume() can reject, or
      // resolve with the context still suspended, whenever the browser decides
      // a gesture doesn't count — and the first gesture after a navigation is
      // exactly the one it's most likely to refuse. ANA MENÜ navigates the page
      // (see togglePause), so unhooking on the first *attempt* rather than the
      // first *success* left the game silent for the rest of the session with
      // nothing left listening to try again.
      //
      // Now every gesture retries until sound actually happens, and only then
      // does this stop costing anything.
      Promise.resolve(this.audio.unlock()).then((running) => {
        if (!running) return;
        globalThis.removeEventListener('pointerdown', unlock, true);
        globalThis.removeEventListener('keydown', unlock, true);
      });
    };
    globalThis.addEventListener('pointerdown', unlock, true);
    globalThis.addEventListener('keydown', unlock, true);
    if (this.boot.muted) this.audio.setMuted(true);

    this.world = new World({
      materials: this.materials,
      theme: this.renderer.theme,
      seed: this.boot.seed ?? OPEN_WORLD.seed,
      lightPool: this.renderer.lights,
    });
    this.camera.world = this.world;

    await this.world.build({ trackData: ALL_TRACKS, onProgress });
    this.renderer.addRoot(this.world.root);

    globalThis.addEventListener('resize', this._boundResize);
    this._onResize();
    this._wireGlobalKeys();

    // Player settings, restored from localStorage and applied to everything
    // that was just built. Must come after the renderer, audio and camera exist.
    settings.load();
    events.on('settings:changed', ({ id, value }) => this._applySetting(id, value));
    settings.applyAll();

    // Remember what the current mode was entered with, so pause → restart can
    // rebuild it exactly.
    events.on('mode:entered', ({ params }) => {
      this._lastModeParams = params;
    });

    this.loop.onUpdate = (dt) => this._update(dt);
    this.loop.onFixed = (dt) => this._fixedUpdate(dt);
    this.loop.onRender = (alpha, dt) => this._render(alpha, dt);

    events.emit('game:ready', {});
    return this;
  }

  start() {
    this.loop.start();
    return this;
  }

  dispose() {
    this.loop.stop();
    globalThis.removeEventListener('resize', this._boundResize);
    this.input.detach();
    this.world?.dispose();
    this.renderer.dispose();
    this.ui.unmount();
    this.audio.dispose();
  }

  // -- vehicles -------------------------------------------------------------

  /**
   * @param {object} opts
   * @param {string} [opts.profile] key into PROFILES
   * @param {'player'|'rival'|'cop'} [opts.kind]
   * @param {number} [opts.color]
   * @param {boolean} [opts.isPlayer]
   * @returns {Vehicle}
   */
  spawnVehicle({ profile = ACTIVE_PROFILE, kind = 'rival', color = null, id = null, isPlayer = false } = {}) {
    const v = new Vehicle({
      profile,
      world: this.world,
      id: id || `${kind}-${this.vehicles.length}`,
    });
    const chassis = createChassis({
      materials: this.materials,
      theme: this.renderer.theme,
      kind,
      color,
      halfExtents: v.tuning.halfExtents,
      lightPool: this.renderer.lights,
    });
    v.attachChassis(chassis);
    this.renderer.scene.add(v.object);
    this.vehicles.push(v);
    if (isPlayer) {
      this.player = v;
      v.isPlayer = true;
      this.camera.setTarget(v);
    }
    return v;
  }

  /** Install the thing that decides a vehicle's controls each step. */
  setDriver(vehicle, driver) {
    if (driver) this._drivers.set(vehicle, driver);
    else this._drivers.delete(vehicle);
  }

  despawnVehicle(vehicle) {
    const i = this.vehicles.indexOf(vehicle);
    if (i >= 0) this.vehicles.splice(i, 1);
    this._drivers.delete(vehicle);
    // Give the leased lights back, or the pool drains after a few respawns.
    vehicle.chassis?.dispose?.();
    this.renderer.scene.remove(vehicle.object);
    vehicle.object.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.player === vehicle) this.player = null;
  }

  clearVehicles() {
    for (const v of [...this.vehicles]) this.despawnVehicle(v);
    this.vehicles.length = 0;
    this._drivers.clear();
    this.player = null;
  }

  // -- presentation ---------------------------------------------------------

  setTheme(name, duration = 0) {
    this.renderer.setTheme(name, duration);
    if (duration <= 0) this.ui.applyTheme(this.renderer.theme);
  }

  /** Camera rig for a mode, respecting a `?cam=` override. */
  useModeRig(modeName, snap = false) {
    const rig = this.boot.rig || MODE_RIGS[modeName] || 'chase';
    this.camera.setRig(rig, snap);
  }

  /** 0..1 — the simulation visibly failing. Drives post FX, UI and audio. */
  setGlitch(amount) {
    const a = clamp01(amount);
    this.renderer.setGlitch(a);
    this.ui.setGlitch(a);
    this.audio.setGlitch(a);
  }

  setFade(amount, color) {
    this.renderer.setFade(amount, color);
  }

  // -- frame ----------------------------------------------------------------

  _update(dt) {
    this.time += dt;
    const inputState = this.input.update(dt);
    this.renderer.update(dt);
    this.world?.update(dt, this.time, this.renderer.camera.position);
    this.modes.update(dt);
    this.camera.update(dt, inputState);
    // The UI runs on real time so it keeps animating through pause and slow-mo.
    this.ui.update(this.loop.rawDt ?? dt);
    this._updateAudio(dt);
    this.input.endFrame();
  }

  _fixedUpdate(dt) {
    for (const v of this.vehicles) {
      const driver = this._drivers.get(v);
      if (driver) v.setCommand(driver(v, dt));
      v.fixedUpdate(dt);
    }
    // Cars hit each other. Runs after every vehicle has integrated, so both
    // sides of a contact are resolved against the same instant in time.
    if (this.vehicles.length > 1) resolveVehicleContacts(this.vehicles, dt);
    this._rescueFallen();
    this.modes.fixedUpdate(dt);
  }

  _render(alpha, dt) {
    for (const v of this.vehicles) v.syncVisual(alpha, dt);
    // Cockpit rigs hide the car they are inside.
    if (this.player?.chassis) {
      this.player.chassis.root.visible = !this.camera.hidesOwner;
    }
    this.modes.render(alpha);
    this.renderer.render(this.renderer.camera);
  }

  _updateAudio(dt) {
    const p = this.player;
    if (!p) return;
    const cam = this.renderer.camera;
    this.audio.setListener({
      x: cam.position.x,
      y: cam.position.y,
      z: cam.position.z,
      forwardX: Math.sin(this.camera._yaw),
      forwardZ: Math.cos(this.camera._yaw),
    });
    this.audio.updateEngine({
      rpm01: p.rpm01,
      load: p.throttle,
      speed: p.speed,
      surface: p.surface.id,
      slip: p.slip,
      airborne: !p.grounded,
    });
  }

  /** A car that has ended up under the world is put back on it. */
  _rescueFallen() {
    if (!this.world) return;
    for (const v of this.vehicles) {
      if (v.position.y > v.groundHeight - PLAYER.fallRescueDepth) continue;
      const p = this.world.safePlaceNear(v.position.x, v.position.z);
      v.reset(p, v.heading);
      events.emit('vehicle:rescued', { id: v.id });
    }
  }

  _onResize() {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.resize(w, h);
    this.modes.resize(w, h);
  }

  _wireGlobalKeys() {
    events.on('input:key', ({ code, down }) => {
      if (!down) return;
      // Read raw key events rather than the input state, so these still work
      // while the human's driving controls are locked during a cutscene.
      if (code === 'KeyC') {
        const next = this.camera.cycleRig(1);
        events.emit('ui:subtitle', { text: `KAMERA · ${next}`, duration: 1.1, tone: 'system' });
      }
      if (code === 'Backquote') this.toggleDebugPanel();
      if (code === 'Escape' || code === 'KeyP') this.togglePause();
    });
  }

  /**
   * Escape. Opens the pause menu, and keeps re-opening it after the settings
   * panel closes so the player can dip in and out without losing their place.
   */
  async togglePause() {
    if (this._pausing) return;
    if (this.loop.paused) {
      this.loop.setPaused(false);
      return;
    }
    // `isModalOpen` is a getter, not a method — do not add parentheses.
    if (this.ui.screens.isModalOpen) return;

    this._pausing = true;
    this.loop.setPaused(true);
    this.audio.setDucking(0.8);
    try {
      for (;;) {
        const choice = await this.ui.screens.showPause();

        if (choice === 'settings') {
          // Live: every control applies immediately, so you can hear the
          // volume and see the brightness while you drag them.
          await this.ui.settingsMenu.show();
          continue; // back to the pause menu
        }

        if (choice === 'restart' && this.modes.currentName) {
          const name = this.modes.currentName;
          this.loop.setPaused(false);
          await this.modes.switchTo(name, this._lastModeParams || {});
        } else if (choice === 'mainMenu') {
          // A full reload is the honest way back to the title: the intro
          // director has already detached itself by the time most players see
          // this menu, and half-rebuilding it would be a bug farm.
          events.emit('game:mainMenu', {});
          globalThis.location.href = globalThis.location.pathname;
          return;
        } else {
          this.loop.setPaused(false);
        }
        break;
      }
    } finally {
      this.audio.setDucking(0);
      this._pausing = false;
    }
  }

  // -- settings -------------------------------------------------------------

  /**
   * One place where a player-facing option becomes a thing that happens.
   * Adding an option is an entry in `SETTINGS_SCHEMA` plus a `case` here.
   */
  _applySetting(id, value) {
    const r = this.renderer;
    switch (id) {
      case 'muted': this.audio.setMuted(value); break;
      case 'masterVolume': this.audio.setMasterVolume(value); break;
      case 'musicVolume':
        this.audio.setBusVolume('music', value);
        this.audio.setBusVolume('ambience', value * settings.get('ambienceVolume'));
        break;
      case 'ambienceVolume':
        this.audio.setBusVolume('ambience', value * settings.get('musicVolume'));
        break;
      case 'sfxVolume':
        this.audio.setBusVolume('sfx', value);
        this.audio.setBusVolume('siren', value);
        this.audio.setBusVolume('tyres', value);
        break;
      case 'engineVolume': this.audio.setBusVolume('engine', value); break;

      case 'worldLight': r.setOverride('lightScale', value); break;
      case 'brightness': r.setOverride('brightness', value); break;
      case 'contrast': r.setOverride('contrast', value); break;
      case 'scanlines': r.setOverride('scanlines', value); break;
      case 'vignette': r.setOverride('vignette', value); break;
      case 'chromatic': r.setOverride('chromatic', value); break;

      case 'renderPreset':
        if (r.preset.name !== value) r.setRenderPreset(value);
        break;

      case 'cameraRig':
        // Don't yank the camera during a cutscene or a cockpit-locked moment.
        if (this.camera.rig.type === 'follow') this.camera.setRig(value);
        break;
      case 'cameraShake':
        this.camera.globalShakeScale = value;
        break;
      default:
        break;
    }
  }

  async toggleDebugPanel() {
    if (!this._debugPanel) {
      const { TuningPanel } = await import('../ui/tuningPanel.js');
      this._debugPanel = new TuningPanel(this);
    }
    this._debugPanel.toggle();
  }
}
