/**
 * TRAILS, DRIVEN — and the horn.
 *
 * `npm test` proves the trail network reports `TRAIL` when the WORLD is asked.
 * That is not the same claim as the car feeling it: the vehicle samples the
 * ground through its own probes, a rival ignores surfaces entirely, and the
 * grip that reaches the tyres has been through `PACE.gripScale` on the way. So
 * this drives a real car down a real path in a real browser and reads the
 * number off the vehicle.
 *
 * The horn is here for the opposite reason — it is untestable anywhere else.
 * There is no WebAudio in Node, and the whole point of wiring `playHorn` to a
 * key is that it makes a sound, so the check is that pressing B builds an
 * oscillator pair and releasing B takes it down again.
 *
 *   node tools/trail-drive.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

const PORT = 8254;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await page.setViewport({ width: 960, height: 540 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });
  // `?level=1` on purpose: free roam now defaults to the level that breaks,
  // and that one is in the rain — where a worn path is MUD rather than TRAIL
  // (see `WET_SURFACE` in world.js), which is a different feature entirely.
  await page.goto(`http://localhost:${PORT}/index.html?scene=open&level=1`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.waitForFunction('TEKER.game.player != null', { timeout: 40000 });
  await sleep(600);

  // -- 1. put the car on a path --------------------------------------------
  // A spur, because a spur is the trail the player is actually likely to meet:
  // it starts at a parkour, which is where the player is. Aimed down the route
  // rather than at it, so driving forward follows the path.
  //
  // Searched backwards from the far end, and only where the world already says
  // TRAIL. A spur's first hundred metres are usually still under the glass over
  // the parkour it leaves, and a car put on the terrain under a dome it has
  // been outside of is standing below its own ground — it gets rescued onto the
  // roof, and then the car is honestly on glass. See bug 23.

  const placed = await page.evaluate(() => {
    const g = TEKER.game;
    const trails = g.world.trails;
    const spurs = trails.routes.slice(-9);
    for (const route of spurs.reverse()) {
      for (let i = route.length - 2; i > 0; i--) {
        const here = route[i];
        if (g.world.sampleGround(here.x, here.z, g.player).surface !== 'TRAIL') continue;
        const next = route[i + 1];
        const heading = Math.atan2(next.x - here.x, next.z - here.z);
        const y = g.world.groundHeightAt(here.x, here.z, g.player) + 1.2;
        // The car's own vector, reused — `reset` copies it, and this file has
        // no business importing three just to hand it three numbers.
        const at = g.player.position.clone().set(here.x, y, here.z);
        g.player.reset(at, heading);
        return { found: true, strength: trails.strengthAt(here.x, here.z) };
      }
    }
    return { found: false, strength: 0 };
  });
  check('found a worn spur to start on', placed.found && placed.strength > 0.55,
    `wear ${placed.strength.toFixed(2)}`);

  await sleep(400);
  const onPath = await page.evaluate(() => {
    const p = TEKER.game.player;
    return { surface: p.surface.id, grip: p.surface.grip };
  });
  check('the car standing on it knows it is on a path', onPath.surface === 'TRAIL', onPath.surface);
  check('…and the tyres get the grip that goes with it', onPath.grip > 0.8, String(onPath.grip));

  // -- 2. drive it ----------------------------------------------------------
  // Following a worn route should spend most of its time on the worn route.
  // Not all of it: the network fades in and out against a noise field on
  // purpose, so a path that never once dropped back to grass would mean the
  // patchiness had stopped working.

  const samples = [];
  const sampler = setInterval(async () => {
    try {
      samples.push(await page.evaluate(() => TEKER.game.player.surface.id));
    } catch {
      /* page busy */
    }
  }, 120);
  await page.keyboard.down('KeyW');
  await sleep(4000);
  await page.keyboard.up('KeyW');
  clearInterval(sampler);
  await sleep(200);

  const seen = samples.filter(Boolean);
  const trail = seen.filter((s) => s === 'TRAIL').length;
  const moved = await page.evaluate(() => TEKER.game.player.speedKmh);
  check('the car drove', seen.length > 5, `${seen.length} samples, ${moved.toFixed(0)} km/h at the end`);
  check(
    'following a worn route mostly keeps you on it',
    trail / Math.max(1, seen.length) > 0.4,
    `${trail}/${seen.length} samples on TRAIL`
  );

  // -- 3. off the path, the forest is the forest ---------------------------

  const offPath = await page.evaluate(() => {
    const g = TEKER.game;
    const p = g.player;
    const t = g.world.trails;
    // Straight out to the side until the trail field reads nothing at all.
    let d = 30;
    while (d < 300 && t.strengthAt(p.position.x + d, p.position.z) > 0) d += 10;
    const x = p.position.x + d;
    const z = p.position.z;
    return { surface: g.world.sampleGround(x, z, p).surface, metres: d };
  });
  check('step off it and the ground is ordinary again', offPath.surface !== 'TRAIL',
    `${offPath.metres}m aside reports ${offPath.surface}`);

  // -- 4. the horn ----------------------------------------------------------
  // `AudioEngine#playHorn` has existed since P11 and `BINDINGS.horn` since P22.
  // Until now nothing connected them, which is invisible in every other check
  // in this repo because silence looks exactly like working.

  const unlocked = await page.evaluate(() => TEKER.game.audio.ready && TEKER.game.audio._live);
  check('the audio graph is live', !!unlocked);

  await page.keyboard.down('KeyB');
  await sleep(250);
  const honking = await page.evaluate(() => {
    const h = TEKER.game.audio._horn;
    return { on: !!h, oscs: h?.oscs?.length ?? 0, held: TEKER.game._hornDown };
  });
  check('B sounds the horn', honking.on, `${honking.oscs} oscillators`);
  check('…two tones, because the beating is the sound', honking.oscs === 2);
  check('…and the game knows it is held', honking.held === true);

  await page.keyboard.up('KeyB');
  await sleep(400);
  const quiet = await page.evaluate(() => ({
    horn: TEKER.game.audio._horn,
    held: TEKER.game._hornDown,
  }));
  check('letting go stops it', quiet.horn === null, String(quiet.horn));
  check('…and the held state came back with it', quiet.held === false);

  // A press that is refused must not leave a release that latches. Lock the
  // human out, press and release, and nothing should have happened at all.
  await page.evaluate(() => TEKER.game.input.setLocked(true));
  await page.keyboard.down('KeyB');
  await sleep(200);
  const duringCutscene = await page.evaluate(() => !!TEKER.game.audio._horn);
  await page.keyboard.up('KeyB');
  await sleep(200);
  const after = await page.evaluate(() => ({ horn: !!TEKER.game.audio._horn, held: TEKER.game._hornDown }));
  await page.evaluate(() => TEKER.game.input.setLocked(false));
  check('a locked player cannot honk through a cutscene', !duringCutscene);
  check('…and the release did not latch anything', !after.horn && after.held === false);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\n\x1b[32mtrails + horn ok\x1b[0m' : `\n\x1b[31m${failures} failed\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
