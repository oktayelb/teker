/**
 * RACE START — the grid, the countdown, and the sky over parkur 3.
 *
 * Three things that were wrong before the lights go out:
 *   1. Parkur 3 ran under a daytime sky, so the floodlight rig, the gaps in it
 *      and the headlights all meant nothing.
 *   2. ESC during the countdown paused the game but not the countdown, so the
 *      race started while the pause menu was still up.
 *   3. Cars integrated gravity on the grid and crept downhill before GO.
 *
 * Screenshots (if SHOTS is set) go to a directory OUTSIDE the repo.
 *
 *   node tools/race-start.mjs
 *   SHOTS=/tmp/somewhere node tools/race-start.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8245;
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

const open = async (query) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });
  await page.goto(`http://localhost:${PORT}/index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  return page;
};

const snapshot = (page) =>
  page.evaluate(() => {
    const g = TEKER.game;
    return {
      state: g.modes.current?.state ?? null,
      theme: g.renderer.theme?.label ?? '?',
      count: document.querySelector('.tk-count')?.textContent ?? null,
      paused: g.loop.paused,
      cars: g.vehicles.map((v) => ({
        id: v.id,
        disabled: v.disabled,
        p: [+v.position.x.toFixed(3), +v.position.y.toFixed(3), +v.position.z.toFixed(3)],
      })),
    };
  });

const drift = (a, b) =>
  Math.max(
    ...a.cars.map((car, i) => {
      const q = b.cars[i]?.p ?? car.p;
      return Math.hypot(q[0] - car.p[0], q[1] - car.p[1], q[2] - car.p[2]);
    })
  );

try {
  // =========================================================================
  console.log('\n— parkur 3: the sky, and the grid —');
  const p3 = await open('?start=race3');
  await p3.waitForFunction('TEKER.game.modes.current?.track?.id === "track3"', { timeout: 40000 });

  let s = await snapshot(p3);
  check('parkur 3 runs at night', s.theme === 'Night', `theme=${s.theme}`);
  check('cars are held on the grid', s.cars.every((c) => c.disabled), JSON.stringify(s.cars.map((c) => c.disabled)));

  // Sit through the grid hold and the countdown, sampling for creep.
  const first = s;
  let worst = 0;
  for (let i = 0; i < 14; i++) {
    await sleep(300);
    const now = await snapshot(p3);
    if (now.state === 'racing') break;
    worst = Math.max(worst, drift(first, now));
  }
  check('no car creeps before GO', worst < 0.02, `worst drift = ${worst.toFixed(4)} m`);

  if (SHOTS) await p3.screenshot({ path: `${SHOTS}/race3-night.png` });

  await p3.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 30000 });
  s = await snapshot(p3);
  check('cars are released at GO', s.cars.every((c) => !c.disabled));
  await sleep(1500);
  const moved = drift(first, await snapshot(p3));
  check('…and they actually move once racing', moved > 0.5, `moved ${moved.toFixed(2)} m`);
  await p3.close();

  // =========================================================================
  console.log('\n— ESC during the countdown —');
  const page = await open('');
  await sleep(1200);
  await page.keyboard.press('Enter'); // BAŞLA
  // Wait for the countdown to be on screen, then pause it.
  await page.waitForFunction('TEKER.game.modes.current?.state === "countdown"', { timeout: 30000 });
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(500);

  const atPause = await snapshot(page);
  console.log(`    paused with the counter on "${atPause.count}"`);
  check('the game is paused', atPause.paused === true);
  check('the race has not started', atPause.state === 'countdown', String(atPause.state));

  await sleep(4000); // far longer than the whole 3·2·1·GO
  const held = await snapshot(page);
  check('the counter does not tick while paused', held.count === atPause.count,
    `"${atPause.count}" → "${held.count}"`);
  check('the race still has not started', held.state === 'countdown', String(held.state));
  check('cars stay frozen through the pause', held.cars.every((c) => c.disabled));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/countdown-paused.png` });

  // Resume: it must pick up where it left off, not skip.
  await page.keyboard.press('Enter'); // DEVAM ET
  await sleep(700);
  const resumed = await snapshot(page);
  check('resuming unpauses', resumed.paused === false);
  await page.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 20000 });
  console.log('    countdown resumed and the race started.');
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
