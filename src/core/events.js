/**
 * EVENTS — the seam that keeps systems apart.
 *
 * Rule of thumb: if system A needs to *tell* system B something, emit. If it
 * needs to *ask*, pass a reference. The intro director talks to the game almost
 * entirely through this bus, which is what makes it deletable.
 *
 * Channel names are `domain:verb`, e.g. `race:finished`, `chase:escaped`.
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._channels = new Map();
    /** @type {Set<Function>} */
    this._any = new Set();
    this.debug = false;
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(channel, handler) {
    let set = this._channels.get(channel);
    if (!set) this._channels.set(channel, (set = new Set()));
    set.add(handler);
    return () => this.off(channel, handler);
  }

  /** Subscribe for exactly one emission. */
  once(channel, handler) {
    const off = this.on(channel, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(channel, handler) {
    this._channels.get(channel)?.delete(handler);
  }

  /** Listen to everything — used by the debug overlay and the intro director. */
  onAny(handler) {
    this._any.add(handler);
    return () => this._any.delete(handler);
  }

  emit(channel, payload) {
    if (this.debug) console.debug('[event]', channel, payload);
    const set = this._channels.get(channel);
    if (set) {
      // Copy so handlers may unsubscribe during dispatch.
      for (const h of [...set]) {
        try {
          h(payload, channel);
        } catch (err) {
          console.error(`[events] handler for "${channel}" threw:`, err);
        }
      }
    }
    for (const h of [...this._any]) {
      try {
        h(payload, channel);
      } catch (err) {
        console.error('[events] wildcard handler threw:', err);
      }
    }
  }

  /** Drop every listener on a channel, or all channels when omitted. */
  clear(channel) {
    if (channel) this._channels.delete(channel);
    else {
      this._channels.clear();
      this._any.clear();
    }
  }
}

/** The game-wide bus. Systems import this directly. */
export const events = new EventBus();

/**
 * Collects unsubscribe functions so a mode can tear down cleanly.
 * `const subs = new Subscriptions(); subs.on('race:finished', fn); subs.dispose();`
 */
export class Subscriptions {
  constructor(bus = events) {
    this.bus = bus;
    this._offs = [];
  }
  on(channel, handler) {
    this._offs.push(this.bus.on(channel, handler));
    return this;
  }
  once(channel, handler) {
    this._offs.push(this.bus.once(channel, handler));
    return this;
  }
  add(off) {
    if (typeof off === 'function') this._offs.push(off);
    return this;
  }
  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }
}
