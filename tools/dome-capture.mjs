/**
 * THE GLASS — does a dome look like a dome, and can you drive on one?
 *
 * Everything about the domes that `npm test` can check is geometry. This is the
 * half that is not: the panes have to read as a structure against the sky, the
 * seams have to carry through night fog at three hundred metres, and a car put
 * on the roof has to stay on the roof rather than sink through it.
 *
 * Screenshots (if SHOTS is set) go OUTSIDE the repo.
 *
 *   node tools/dome-capture.mjs
 *   SHOTS=/tmp/domes node tools/dome-capture.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8253;
const SHOTS = process.env.SHOTS || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `   ${detail}` : ''}`);
};

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await sleep(900);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1120, height: 630 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });

  // `?scene=open` boots the open world with no director at all — the domes are
  // armed by the mode, and nothing has revealed them.
  await page.goto(`http://localhost:${PORT}/index.html?scene=open`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.waitForFunction('TEKER.game.player != null', { timeout: 40000 });
  // …and wait until the glass has actually SEEN the car under it. The latch is
  // set on the first sync after a car appears (`DomeField#_stateFor`), and a
  // car that is teleported out from under a dome before that first frame was,
  // as far as the field is concerned, never under one — it seals silently and
  // nothing is revealed. Which is correct, and is not what this tool is here to
  // photograph. Under swiftshader one frame can be a couple of hundred
  // milliseconds, so this waits for the fact rather than for a duration.
  await page.waitForFunction(
    'TEKER.game.world.domes._state.get(TEKER.game.player)?.inside > 0',
    { timeout: 40000 }
  );

  const shot = async (name) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  };

  // -- 1. invisible until you come out from under one -----------------------
  console.log('\n— before —');
  const before = await page.evaluate(() => {
    const f = TEKER.game.world.domes;
    return {
      armed: f.armed,
      revealed: f.revealed,
      drawn: f.domes.map((d) => d.group.visible),
      presence: f.presence,
    };
  });
  console.log('   ', JSON.stringify(before));
  check('the glass is armed by the open world', before.armed === true);
  check('…but nothing is drawn', before.revealed === false && before.drawn.every((v) => v === false));
  await shot('dome-1-invisible');

  // -- 2. drive out from under parkur 3 -------------------------------------
  console.log('\n— coming out from under it —');
  const out = await page.evaluate(async () => {
    const g = TEKER.game;
    const f = g.world.domes;
    const d = f.domes[0];
    const p = g.player;
    // Straight out past the rim, the way the escape carries you.
    const x = d.centerX + d.radius + 60;
    const z = d.centerZ;
    p.reset(g.world.safePlaceNear(x, z), Math.PI);
    await new Promise((r) => setTimeout(r, 900));
    return {
      revealed: f.revealed,
      sealed: f.sealedFor(p, d),
      presence: Number(f.presence.toFixed(2)),
      drawn: f.domes.every((dd) => dd.group.visible),
    };
  });
  console.log('   ', JSON.stringify(out));
  check('the dome closes behind you', out.sealed === true);
  check('…and every dome is revealed at once', out.revealed === true && out.drawn === true);
  check('…and the glass has resolved', out.presence > 0.9);

  // Look back at what you came out of — the director's own shot, framed with
  // the numbers the director uses, so this is what the player will actually see.
  const frameReveal = () =>
    page.evaluate(async () => {
      const g = TEKER.game;
      const d = g.world.domes.domes[0];
      const p = g.player;
      const V = Object.getPrototypeOf(p.position).constructor;
      const T = (await import('/src/game/intro/beats.js')).INTRO_TIMING;
      const ox = p.position.x - d.centerX;
      const oz = p.position.z - d.centerZ;
      const len = Math.hypot(ox, oz) || 1;
      g.camera.setStatic(
        new V(
          p.position.x + (ox / len) * T.domeCameraBack,
          p.position.y + T.domeCameraUp,
          p.position.z + (oz / len) * T.domeCameraBack
        ),
        new V().lerpVectors(p.position, d.apex, T.domeLookBlend)
      );
      g.camera.fovBias = T.domeZoom;
    });
  await frameReveal();
  await sleep(700);
  await shot('dome-2-the-reveal-shot-day');

  // -- 3. it holds your weight ----------------------------------------------
  console.log('\n— standing on it —');
  const roof = await page.evaluate(async () => {
    const g = TEKER.game;
    const d = g.world.domes.domes[0];
    const p = g.player;
    // Halfway up the flank, where a dome is both high and sloped.
    const x = d.centerX + d.radius * 0.45;
    const z = d.centerZ;
    const glassY = d.heightAt(x, z);
    p.reset(new (Object.getPrototypeOf(p.position).constructor)(x, glassY + 2, z), Math.PI * 0.5);
    // Let it settle, then let it roll.
    for (let i = 0; i < 240; i++) g.loop.onFixed(1 / 120);
    const settledY = p.position.y;
    const settledGlass = d.heightAt(p.position.x, p.position.z);
    const terrain = g.world.terrain.heightAt(p.position.x, p.position.z);
    return {
      surface: p.surface.id,
      grounded: p.grounded,
      aboveGlass: Number((settledY - settledGlass).toFixed(2)),
      aboveTerrain: Number((settledY - terrain).toFixed(1)),
    };
  });
  console.log('   ', JSON.stringify(roof));
  check('the car is on glass', roof.surface === 'GLASS' && roof.grounded === true);
  check('…resting on it, not in it', Math.abs(roof.aboveGlass) < 1.2, `${roof.aboveGlass}m`);
  check('…a long way above the race below', roof.aboveTerrain > 25, `${roof.aboveTerrain}m up`);

  await page.evaluate(() => TEKER.game.camera.clearStatic());
  await page.evaluate(() => TEKER.game.camera.setRig('chaseWide', true));
  await sleep(700);
  await shot('dome-3-on-the-roof');

  // Same spot, from up high, so the shape of the thing is in frame.
  await page.evaluate(() => {
    const g = TEKER.game;
    const d = g.world.domes.domes[0];
    const p = g.player;
    const V = Object.getPrototypeOf(p.position).constructor;
    g.camera.setStatic(new V(d.centerX + d.radius * 1.5, d.apex.y + 190, d.centerZ + d.radius * 1.5), d.apex);
  });
  await sleep(700);
  await shot('dome-4-overhead');

  // -- 4. at night, which is when the reveal actually happens ---------------
  // The break-out leaves the world on the `night` theme, so this — not the
  // daylight version above — is the frame the player gets.
  console.log('\n— the reveal light —');
  await page.evaluate(() => {
    const g = TEKER.game;
    const d = g.world.domes.domes[0];
    const p = g.player;
    const V = Object.getPrototypeOf(p.position).constructor;
    g.setTheme('night', 0);
    p.reset(g.world.safePlaceNear(d.centerX + d.radius + 60, d.centerZ), Math.PI);
    p.chassis?.setHeadlights(true);
  });
  await sleep(400);
  await frameReveal();
  await sleep(1200);
  await shot('dome-5-the-reveal-shot-night');

  // …and from a long way off, which is how you find the other two.
  await page.evaluate(() => {
    const g = TEKER.game;
    const d = g.world.domes.domes[0];
    const V = Object.getPrototypeOf(g.player.position).constructor;
    g.camera.fovBias = 0;
    g.camera.setStatic(new V(d.centerX + d.radius + 320, d.apex.y + 40, d.centerZ), d.apex);
  });
  await sleep(900);
  await shot('dome-6-night-at-range');

  // -- 5. the cars underneath are unaffected --------------------------------
  console.log('\n— the race underneath —');
  const under = await page.evaluate(() => {
    const g = TEKER.game;
    const f = g.world.domes;
    const d = f.domes[0];
    const t = g.world.mainTrack;
    const V = Object.getPrototypeOf(g.player.position).constructor;
    // A car standing where the race runs, that has never been outside.
    const probe = { position: new V(t.px[0], t.py[0], t.pz[0]), isPlayer: false };
    f.sync([probe]);
    const ground = g.world.sampleGround(probe.position.x, probe.position.z, probe);
    return { sealed: f.sealedFor(probe, d), surface: ground.surface, y: Number(ground.height.toFixed(1)) };
  });
  console.log('   ', JSON.stringify(under));
  check('a car that never left is still on the track', under.sealed === false && under.surface !== 'GLASS');
} finally {
  await browser.close();
  server.kill();
}

console.log(
  failures === 0 ? '\n\x1b[32mthe glass holds\x1b[0m\n' : `\n\x1b[31m${failures} failures\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
