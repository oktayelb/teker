/** Opens the game, presses Escape, walks into AYARLAR, and screenshots. */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const PORT = 8234;
const server = spawn('python3', ['-m','http.server',String(PORT)], { stdio:'ignore' });
await new Promise(r=>setTimeout(r,900));
const browser = await puppeteer.launch({ headless:'new', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({width:1280,height:720});
page.on('pageerror', e=>console.log('[PAGEERROR]', e.message));
page.on('console', m=>{ if(m.type()==='error') console.log('[error]', m.text()); });
await page.goto(`http://localhost:${PORT}/index.html?skip=intro`, { waitUntil:'load' });
await new Promise(r=>setTimeout(r,7000));
mkdirSync('tools/out',{recursive:true});

// Steering: hold D and see which way the car goes.
const before = await page.evaluate(()=>{ const p=TEKER.game.player; p.velocity.set(0,0,22); return [p.position.x,p.position.z,p.heading]; });
await page.keyboard.down('KeyD');
await new Promise(r=>setTimeout(r,2500));
await page.keyboard.up('KeyD');
const after = await page.evaluate(()=>{ const p=TEKER.game.player; return [p.position.x,p.position.z,p.heading]; });
console.log('D held → dx=', (after[0]-before[0]).toFixed(1), ' dHeading=', (after[2]-before[2]).toFixed(3));

// Escape → pause menu
await page.keyboard.press('Escape');
await new Promise(r=>setTimeout(r,900));
await page.screenshot({ path:'tools/out/menu-pause.png' });
console.log('paused:', await page.evaluate(()=>TEKER.game.loop.paused));

// Down to AYARLAR, Enter
await page.keyboard.press('ArrowDown');
await new Promise(r=>setTimeout(r,250));
await page.keyboard.press('Enter');
await new Promise(r=>setTimeout(r,900));
await page.screenshot({ path:'tools/out/menu-settings.png' });

const state = await page.evaluate(()=>{
  const el = document.querySelector('.tk-settings');
  return { exists: !!el, open: el?.classList.contains('is-open'),
           rows: document.querySelectorAll('.tk-settings-row').length,
           active: document.querySelector('.tk-settings-row.is-active')?.dataset.id };
});
console.log('settings panel:', JSON.stringify(state));

// Drive a slider with the arrow keys and confirm it reaches the renderer.
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
await new Promise(r=>setTimeout(r,200));
const volBefore = await page.evaluate(()=>TEKER.game.audio.getBusVolume('music'));
for (let i=0;i<4;i++){ await page.keyboard.press('ArrowRight'); await new Promise(r=>setTimeout(r,80)); }
const volAfter = await page.evaluate(()=>TEKER.game.audio.getBusVolume('music'));
console.log('music bus:', volBefore, '→', volAfter);

// Jump to the light section and change world light.
const light = await page.evaluate(()=>{
  const { settings } = TEKER; return null;
});
await page.evaluate(async ()=>{
  const m = await import('./src/config/settings.js');
  m.settings.set('worldLight', 2.0);
  m.settings.set('brightness', 1.4);
});
await new Promise(r=>setTimeout(r,400));
console.log('sun intensity after worldLight=2:', await page.evaluate(()=>TEKER.game.renderer.sun.intensity.toFixed(2)));
console.log('uGain after brightness=1.4:', await page.evaluate(()=>TEKER.game.renderer.postfx.uniforms.uGain.value.toFixed(3)));
await page.screenshot({ path:'tools/out/menu-bright.png' });

// Escape closes settings, back to pause; Escape again resumes.
await page.keyboard.press('Escape');
await new Promise(r=>setTimeout(r,600));
console.log('after Esc — settings open:', await page.evaluate(()=>document.querySelector('.tk-settings')?.classList.contains('is-open')));
await browser.close(); server.kill();
