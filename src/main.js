/**
 * TEKER — boot.
 *
 * This is the only file that knows the intro exists. Everything below the
 * `if (boot.skipIntro)` is the game; everything above it is the story about the
 * game. Delete `src/game/intro/` and the `import` here, and the rest still runs.
 *
 *   ?skip=intro          straight to free roam
 *   ?start=race3         story, but starting at the parkour that breaks
 *   ?scene=race1|race2|race3|open|chase   one situation, no director
 *   ?cam=chase|hood|bumper|chaseWide|cinematic|free
 *   ?theme=forest|outside|night|glitch
 *   ?render=psx|n64|clean
 *   ?seed=12345   ?panel   ?gizmos   ?nocops   ?mute
 */

import { Game } from './game/game.js';
import { RaceMode } from './game/modes/raceMode.js';
import { OpenWorldMode } from './game/modes/openWorldMode.js';
import { readBootOptions } from './config/gameplay.js';
import { events } from './core/events.js';
import { ui } from './ui/index.js';

// The one intro import in the entire codebase.
import { IntroDirector } from './game/intro/introDirector.js';

const SCENES = {
  race1: { mode: 'race', params: { trackId: 'track1' } },
  race2: { mode: 'race', params: { trackId: 'track2' } },
  race3: { mode: 'race', params: { trackId: 'track3' } },
  open: { mode: 'openWorld', params: { rig: 'chaseWide' } },
  chase: { mode: 'openWorld', params: { rig: 'chaseTight', startChase: true } },
};

async function boot() {
  const canvas = document.getElementById('game-canvas');
  const options = readBootOptions();

  ui.mount();
  ui.screens.showLoading('DERLENİYOR');

  const game = new Game(canvas, options);
  await game.init({
    onProgress: (stage, progress) => {
      ui.screens.showLoading(`${stage.toUpperCase()} · ${Math.round(progress * 100)}%`);
    },
  });

  game.modes.register('race', RaceMode);
  game.modes.register('openWorld', OpenWorldMode);
  ui.screens.hideLoading();
  game.start();

  // Expose for the console. Tuning a car is much easier when you can poke it.
  globalThis.TEKER = { game, events, ui };

  if (options.panel) game.toggleDebugPanel();

  // --- direct scene boot: debugging, and proof the game stands alone -------
  if (options.scene && SCENES[options.scene]) {
    const s = SCENES[options.scene];
    game.setTheme(options.theme || (options.scene === 'chase' ? 'night' : 'forest'), 0);
    await game.modes.switchTo(s.mode, s.params);
    if (s.params.startChase) game.modes.current?.startChase?.({});
    return;
  }

  // --- no intro: the game as it will be once the opening is over -----------
  if (options.skipIntro) {
    game.flags.escaped = true;
    game.setTheme(options.theme || 'outside', 0);
    game.audio.setAmbience('outside');
    await game.modes.switchTo('openWorld', { rig: 'chaseWide' });
    // The glass over the parkours is part of the world once the story is over,
    // and there is nobody here to reveal it dramatically.
    game.world.revealDomes();
    // Say so. Systems that wait for the story to be over — the wildlife, which
    // only comes out once nothing is chasing you — would otherwise wait forever
    // on a boot that never had a story to finish.
    events.emit('intro:finished', { skipped: true });
    return;
  }

  // --- the opening ---------------------------------------------------------
  const director = new IntroDirector(game);
  // `?start=race3` skips the title and the two warm-up races, but keeps the
  // director attached — so everything after the third race still plays.
  if (options.start) director.startAt = options.start;
  const prevUpdate = game.loop.onUpdate;
  game.loop.onUpdate = (dt, loop) => {
    prevUpdate(dt, loop);
    director.update(dt);
  };
  events.once('intro:finished', () => {
    game.loop.onUpdate = prevUpdate;
  });
  await director.run();
}

// Guard so tooling can import this file to inspect it without starting a game.
if (typeof document === 'undefined') {
  console.warn('[teker] no DOM — not booting.');
} else {
  boot().catch(reportBootFailure);
}

function reportBootFailure(err) {
  console.error('[teker] boot failed:', err);
  const root = document.getElementById('ui-root');
  if (root) {
    root.innerHTML = `<pre style="position:fixed;inset:0;padding:2rem;margin:0;color:#d8483a;
      background:#0b0d0c;font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;
      pointer-events:auto;z-index:9999">TEKER failed to start.\n\n${
        (err && (err.stack || err.message)) || err
      }</pre>`;
  }
}
