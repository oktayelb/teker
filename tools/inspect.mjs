/**
 * Launches the game in a real headless browser, captures every console message,
 * page error, failed request and WebGL/shader problem, and screenshots the
 * result. `node tools/inspect.mjs [urlSuffix]`
 */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 8231;
const suffix = process.argv[2] ?? '';
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader', '--disable-gpu-sandbox',
    '--no-sandbox', '--window-size=1280,720',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[PAGEERROR] ${e.message}\n${e.stack ?? ''}`));
  page.on('requestfailed', (r) => console.log(`[404/FAIL] ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) console.log(`[HTTP ${r.status()}] ${r.url()}`); });

  await page.goto(`http://localhost:${PORT}/index.html${suffix}`, { waitUntil: 'load', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 9000));

  const diag = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const g = globalThis.TEKERLEK;
    const gl = c?.getContext('webgl2') || c?.getContext('webgl');
    const r = g?.game?.renderer;
    // Read the centre pixel of the actual drawing buffer.
    let centre = null;
    try {
      const px = new Uint8Array(4);
      const glc = r?.renderer?.getContext();
      if (glc) {
        glc.readPixels(glc.drawingBufferWidth >> 1, glc.drawingBufferHeight >> 1, 1, 1,
          glc.RGBA, glc.UNSIGNED_BYTE, px);
        centre = [...px];
      }
    } catch (e) { centre = 'read failed: ' + e.message; }
    return {
      canvas: c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : 'missing',
      contextLost: gl ? gl.isContextLost?.() : 'no ctx',
      hasGlobal: !!g,
      mode: g?.game?.modes?.currentName ?? null,
      sceneChildren: r?.scene?.children?.length ?? null,
      camPos: g?.game?.renderer?.camera?.position?.toArray?.().map((n) => +n.toFixed(1)) ?? null,
      camFov: g?.game?.renderer?.camera?.fov ?? null,
      rig: g?.game?.camera?.rigName ?? null,
      rtSize: r ? [r.internalWidth, r.internalHeight] : null,
      loopFrames: g?.game?.loop?.stats?.frames ?? null,
      fps: g?.game?.loop?.stats?.fps?.toFixed?.(1) ?? null,
      drawCalls: r?.renderer?.info?.render?.calls ?? null,
      triangles: r?.renderer?.info?.render?.triangles ?? null,
      programs: r?.renderer?.info?.programs?.length ?? null,
      fade: r?.postfx?.uniforms?.uFade?.value ?? null,
      glitch: r?.postfx?.uniforms?.uGlitch?.value ?? null,
      centrePixel: centre,
      uiOverlays: [...document.querySelectorAll('#ui-root *')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.opacity !== '0' && el.getBoundingClientRect().width > 600;
        })
        .slice(0, 6)
        .map((el) => `${el.className || el.id || el.tagName} op=${getComputedStyle(el).opacity} bg=${getComputedStyle(el).backgroundColor}`),
    };
  });
  console.log('\n=== DIAGNOSTICS ===');
  console.log(JSON.stringify(diag, null, 2));

  mkdirSync('tools/out', { recursive: true });
  await page.screenshot({ path: `tools/out/shot${suffix ? '-' + suffix.replace(/\W+/g, '') : ''}.png` });
  console.log('\nscreenshot → tools/out/');
} finally {
  await browser.close();
  server.kill();
}
