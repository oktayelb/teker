/**
 * BREAKOUT TIMING — when does parkur 3 decide the player has left?
 *
 * The bug this guards: `escapeHoldSeconds` used to be timed against
 * `offCourseTime`, which starts one centimetre past the ribbon edge. On a dirt
 * parkur you are past that edge for most of the lap, so the hold was always
 * already satisfied and the break fired the *instant* the car crossed the
 * distance line — the player never got a moment of being lost.
 *
 * So: run the verge for ten seconds first, exactly as a real player would,
 * and only then leave. The break must not fire during the first part, and must
 * wait out the hold in the second.
 *
 *   node tools/breakout-capture.mjs
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

const PORT = 8241;
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
  await page.goto(`http://localhost:${PORT}/index.html?start=race3`, { waitUntil: 'load' });
  await page.waitForFunction('globalThis.TEKER?.game?.loop?.running === true', { timeout: 60000 });
  await page.evaluate(() => {
    // Game seconds, not wall clock: the clocks under test accumulate `dt`, and
    // a software renderer runs well under real time.
    window.__broke = null;
    TEKER.events.on('intro:phase', (p) => {
      if (p.phase === 'breakout' && window.__broke == null) window.__broke = TEKER.game.time;
    });
    /** Park the player `m` metres past the ribbon edge and hold it there. */
    window.__park = (m) => {
      const t = TEKER.game.world.mainTrack;
      const v = TEKER.game.player;
      const q = t.query(v.position.x, v.position.z, {});
      const i = q ? q.index : t.startLine.sample;
      const off = t.halfWidth[i] + m;
      // Perpendicular to the tangent, pushed out to the side of the ribbon.
      const nx = -t.tz[i];
      const nz = t.tx[i];
      v.reset(
        new (Object.getPrototypeOf(v.position).constructor)(
          t.px[i] + nx * off,
          t.py[i] + 0.6,
          t.pz[i] + nz * off
        ),
        Math.atan2(t.tx[i], t.tz[i])
      );
    };
    window.__clocks = () => {
      const m = TEKER.game.modes.current;
      const p = m?.progress?.find((x) => x.vehicle === TEKER.game.player);
      return p
        ? {
            edge: +p.offCourseDistance.toFixed(1),
            offCourse: +p.offCourseTime.toFixed(2),
            outOfBounds: +p.outOfBoundsTime.toFixed(2),
          }
        : null;
    };
  });
  await page.waitForFunction('TEKER.game.modes.current?.state === "racing"', { timeout: 40000 });
  console.log('racing on track3.\n');

  // -- 1. run the verge: off course, but not out of bounds -----------------
  console.log('— running the verge, 8m past the edge, for 10s —');
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.__park(8));
    await sleep(500);
    if (i % 6 === 5) console.log('   ', JSON.stringify(await page.evaluate(() => window.__clocks())));
  }
  let c = await page.evaluate(() => window.__clocks());
  check('off-course clock is running', c.offCourse > 3, `offCourse=${c.offCourse}s game time`);
  check('out-of-bounds clock stays at zero', c.outOfBounds === 0, `outOfBounds=${c.outOfBounds}s`);
  check(
    'ten seconds on the verge does NOT break the game',
    await page.evaluate(() => window.__broke === null)
  );

  // -- 2. now actually leave ------------------------------------------------
  // Straight out into the trees rather than 70m to the side: parkur 3 loops, so
  // a point beside one section can sit within 20m of another and legitimately
  // reset the clock. Out here there is no ribbon to be near.
  console.log('\n— leaving: off into the world —');
  await page.evaluate(() => {
    const v = TEKER.game.player;
    window.__far = { x: v.position.x + 500, y: v.position.y + 4, z: v.position.z + 500 };
  });
  const t0 = await page.evaluate(() => {
    const v = TEKER.game.player;
    v.position.set(window.__far.x, window.__far.y, window.__far.z);
    return TEKER.game.time;
  });
  // Hold it out there; the hold has to be waited out, not skipped.
  for (let i = 0; i < 40 && (await page.evaluate(() => window.__broke === null)); i++) {
    await page.evaluate(() => {
      const v = TEKER.game.player;
      v.position.set(window.__far.x, window.__far.y, window.__far.z);
    });
    await sleep(120);
  }
  const broke = await page.evaluate(() => window.__broke);
  const delay = broke == null ? null : broke - t0;
  console.log(`    break fired after ${delay == null ? 'never' : delay.toFixed(2) + 's'}`);
  check('the break does fire once genuinely out of bounds', delay != null);
  check('…and waits out the hold instead of firing instantly', delay != null && delay > 1.3,
    `${delay?.toFixed(2)}s game time vs escapeHoldSeconds 1.6`);
  // Loose upper bound: under swiftshader the fixed-step accumulator falls behind
  // `game.time`, so the clock under test advances slower than the wall the delay
  // is measured against. On real hardware this lands near escapeHoldSeconds.
  check('…without dragging', delay != null && delay < 6, `${delay?.toFixed(2)}s`);

  await sleep(2500);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
