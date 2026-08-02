/**
 * AUDIO PROBE — sound must survive a refused gesture.
 *
 * The bug: game.js retired the pointerdown/keydown unlock listeners on the
 * first *attempt* rather than the first *success*. `audio.unlock()` resolves to
 * whether the context actually reached 'running', and a browser can refuse a
 * gesture — most likely the first one after a navigation, which is exactly what
 * ANA MENÜ does. One refusal used to mean silence for the rest of the session.
 *
 * Chrome will not refuse a gesture on demand, so scenario B fakes the refusal
 * at the seam that matters and checks the listeners are still armed afterwards.
 *
 * Writes no files.
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

const PORT = 8000;
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
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--autoplay-policy=document-user-activation-required',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await page.setCacheEnabled(false);
  page.on('pageerror', (e) => {
    failures++;
    console.log('[PAGEERROR]', e.message);
  });

  const ready = () =>
    page.waitForFunction('globalThis.TEKERLEK?.game?.loop?.running === true', { timeout: 60000 });
  const tap = () =>
    page.evaluate(() => {
      const a = TEKERLEK.game.audio;
      if (!a._ctx || !a._master) return false;
      const an = a._ctx.createAnalyser();
      an.fftSize = 2048;
      a._master.connect(an);
      window.__an = an;
      window.__buf = new Float32Array(an.fftSize);
      return true;
    });
  const level = async () => {
    await page.keyboard.down('w');
    let peak = 0;
    for (let i = 0; i < 16; i++) {
      peak = Math.max(
        peak,
        await page.evaluate(() => {
          if (!window.__an) return 0;
          window.__an.getFloatTimeDomainData(window.__buf);
          let m = 0;
          for (const v of window.__buf) m = Math.max(m, Math.abs(v));
          return m;
        })
      );
      await sleep(120);
    }
    await page.keyboard.up('w');
    return peak;
  };

  // =========================================================================
  console.log('\n— A. normal play, then ANA MENÜ, then play again —');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await ready();
  await page.evaluate(() => (window.__gen = 'ALIVE'));
  await page.keyboard.press('Enter');
  await page.waitForFunction('TEKERLEK.game.modes.current?.state === "racing"', { timeout: 40000 });
  await tap();
  check('race 1 has sound', (await level()) > 0.001);

  await page.keyboard.press('Escape');
  await sleep(1000);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await sleep(150);
  }
  await page.keyboard.press('Enter'); // ANA MENÜ
  await sleep(4000);
  await ready();
  check('ANA MENÜ actually reloaded the page', await page.evaluate(() => window.__gen === undefined));

  await page.keyboard.press('Enter');
  await page.waitForFunction('TEKERLEK.game.modes.current?.state === "racing"', { timeout: 40000 });
  await tap();
  check('sound after ANA MENÜ', (await level()) > 0.001);

  // =========================================================================
  // The seam itself: refuse the first two gestures the way a browser would.
  console.log('\n— B. the first two gestures are refused —');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await ready();
  await page.evaluate(() => {
    const a = TEKERLEK.game.audio;
    const real = a.unlock.bind(a);
    window.__calls = 0;
    a.unlock = () => {
      window.__calls++;
      // Refuse the first two, exactly as a browser that rejects resume() does.
      if (window.__calls <= 2) return Promise.resolve(false);
      return real();
    };
  });

  await page.keyboard.press('Enter'); // refused #1
  await sleep(500);
  await page.keyboard.press('Enter'); // refused #2
  await sleep(500);
  const callsAfterRefusals = await page.evaluate(() => window.__calls);
  check(
    'a refused gesture does NOT disarm the retry',
    callsAfterRefusals === 2,
    `unlock attempts so far: ${callsAfterRefusals}`
  );

  // Third gesture is allowed through — the listeners must still be there.
  await page.waitForFunction('TEKERLEK.game.modes.current?.state === "racing"', { timeout: 40000 });
  await page.keyboard.press('ArrowUp'); // gesture #3, this one really unlocks
  await sleep(900);
  const calls = await page.evaluate(() => window.__calls);
  check('a later gesture retried and got through', calls >= 3, `unlock attempts: ${calls}`);
  await tap();
  const peak = await level();
  check('sound recovers after the refusals', peak > 0.001, `peak=${peak.toFixed(4)}`);

  // And once it works, it stops re-arming.
  const before = await page.evaluate(() => window.__calls);
  await page.keyboard.press('ArrowDown');
  await sleep(400);
  const after = await page.evaluate(() => window.__calls);
  check('listeners retire once sound is actually running', after === before, `${before} → ${after}`);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
