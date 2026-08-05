/** Title → BÖLÜMLER → a level, and the same door from the pause menu. */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = 'tools/out';
const PORT = 8236;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

const rows = () =>
  [...document.querySelectorAll('.tk-level')].map((b) => ({
    id: b.dataset.id,
    text: b.textContent.replace(/\s+/g, ' ').trim(),
    locked: b.classList.contains('is-locked'),
    active: b.classList.contains('is-active'),
    dim: getComputedStyle(b).opacity,
  }));

// ---------------------------------------------------------------- title menu
{
  const page = await newPage(`http://localhost:${PORT}/index.html`);
  await wait(9000);
  await page.screenshot({ path: `${OUT}/menu-title.png` });
  console.log('title items:', await page.evaluate(() =>
    [...document.querySelectorAll('.tk-menu .tk-btn')].map((b) => b.textContent)));

  await page.keyboard.press('ArrowDown'); // BÖLÜMLER
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(600);
  await page.screenshot({ path: `${OUT}/menu-levels.png` });
  console.log('level rows:', JSON.stringify(await page.evaluate(rows), null, 1));

  // Down to bölüm 5 and race it.
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await wait(120); }
  await page.keyboard.press('Enter');
  await wait(14000);
  await page.screenshot({ path: `${OUT}/menu-levels-race.png` });
  console.log('after picking bölüm 5:', await page.evaluate(() => ({
    level: TEKER.game.levels.currentId,
    mode: TEKER.game.modes.currentName,
    phase: TEKER.game.modes.current?.state,
  })));

  // Escape → the pause menu, mid-story.
  await page.keyboard.press('Escape');
  await wait(900);
  console.log('pause items:', await page.evaluate(() =>
    [...document.querySelectorAll('.tk-results .tk-menu .tk-btn')].map((b) => b.textContent)));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(120); }
  await page.keyboard.press('Enter'); // BÖLÜMLER
  await wait(700);
  await page.screenshot({ path: `${OUT}/menu-levels-pause.png` });
  const list = await page.evaluate(rows);
  console.log('open on:', list.find((r) => r.active)?.text, '| paused:',
    await page.evaluate(() => TEKER.game.loop.paused));

  // ESC backs out to the pause menu rather than swallowing the game.
  await page.keyboard.press('Escape');
  await wait(500);
  console.log('esc → back to pause:', await page.evaluate(() =>
    document.querySelector('.tk-screen.is-open .tk-menu')?.children.length));

  // …then jump to bölüm 9 for real. The pause menu reopens on its first item,
  // so walk back down to BÖLÜMLER.
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(120); }
  await page.keyboard.press('Enter'); // BÖLÜMLER again
  await wait(600);
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await wait(120); }
  await page.keyboard.press('Enter');
  await wait(16000);
  console.log('jumped mid-race to:', await page.evaluate(() => ({
    level: TEKER.game.levels.currentId,
    mode: TEKER.game.modes.currentName,
    paused: TEKER.game.loop.paused,
    modal: TEKER.ui.screens.isModalOpen,
  })));
  await page.screenshot({ path: `${OUT}/menu-levels-jump.png` });
  await page.close();
}

// ------------------------------------------------------- free roam, no story
{
  const page = await newPage(`http://localhost:${PORT}/index.html?skip=intro`);
  await wait(9000);
  await page.keyboard.press('Escape');
  await wait(800);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(120); }
  await page.keyboard.press('Enter');
  await wait(600);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(15000);
  console.log('free roam → level select:', await page.evaluate(() => ({
    level: TEKER.game.levels.currentId,
    mode: TEKER.game.modes.currentName,
    paused: TEKER.game.loop.paused,
  })));
  await page.screenshot({ path: `${OUT}/menu-levels-freeroam.png` });
  await page.close();
}

await browser.close();
server.kill();
