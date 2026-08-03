/** Checks car-on-car contact and barrier clearance in the running game. */
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const PORT = 8235;
const server = spawn('python3', ['-m','http.server',String(PORT)], { stdio:'ignore' });
await new Promise(r=>setTimeout(r,900));
const browser = await puppeteer.launch({ headless:'new', args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({width:1280,height:720});
page.on('pageerror', e=>console.log('[PAGEERROR]', e.message));
page.on('console', m=>{ if(m.type()==='error') console.log('[error]', m.text()); });
await page.goto(`http://localhost:${PORT}/index.html?scene=race1`, { waitUntil:'load' });
await new Promise(r=>setTimeout(r,9000));

const out = await page.evaluate(async () => {
  const g = TEKER.game;
  const player = g.player;
  const rival = g.vehicles.find(v => v !== player);
  if (!rival) return { error: 'no rival spawned' };

  // Park the rival just ahead of the player, both pointing the same way.
  const h = player.heading;
  const fwd = { x: Math.sin(h), z: Math.cos(h) };
  const start = {
    x: player.position.x + fwd.x * 5.0,
    z: player.position.z + fwd.z * 5.0,
  };
  const THREE = await import('three');
  rival.reset(new THREE.Vector3(start.x, player.position.y, start.z), h);
  g.setDriver(rival, () => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }));
  rival.velocity.set(0,0,0);
  player.velocity.set(fwd.x * 26, 0, fwd.z * 26);

  const before = { x: rival.position.x, z: rival.position.z, speed: rival.speed };
  let contactEvents = 0;
  const off = TEKER.events.on('vehicle:contact', () => contactEvents++);

  for (let i = 0; i < 200; i++) g.loop.onFixed(1/120, g.loop);
  off();

  const gap = Math.hypot(rival.position.x - player.position.x, rival.position.z - player.position.z);
  return {
    rivalMoved: +Math.hypot(rival.position.x - before.x, rival.position.z - before.z).toFixed(2),
    rivalSpeedAfter: +rival.speed.toFixed(2),
    playerSpeedAfter: +player.speed.toFixed(2),
    gapAfter: +gap.toFixed(2),
    contactEvents,
  };
});
console.log('car-on-car:', JSON.stringify(out));

// Barrier clearance while actually driving: hug the right-hand barrier.
const hug = await page.evaluate(async () => {
  const g = TEKER.game;
  const t = g.world.getTrack('track1');
  const THREE = await import('three');
  const i = t.sampleIndexAt(0.3);
  let touches = 0;
  // Sit 90% of the way to the tarmac edge — should be clean.
  const off = t.halfWidth[i] * 0.9;
  g.player.reset(new THREE.Vector3(
    t.px[i] + t.rx[i]*off, t.py[i]+0.5, t.pz[i] + t.rz[i]*off
  ), Math.atan2(t.tx[i], t.tz[i]));
  g.player.velocity.set(Math.sin(g.player.heading)*30, 0, Math.cos(g.player.heading)*30);
  const offEv = TEKER.events.on('vehicle:collision', () => touches++);
  for (let k = 0; k < 600; k++) g.loop.onFixed(1/120, g.loop);
  offEv();
  const q = t.query(g.player.position.x, g.player.position.z, {});
  return { touches, stillOnTrack: !!q && q.dist < q.halfWidth + 2, distFromCentre: q ? +q.dist.toFixed(2) : null, halfWidth: q ? +q.halfWidth.toFixed(2) : null };
});
console.log('hugging the edge for 5s:', JSON.stringify(hug));

mkdirSync('tools/out',{recursive:true});
await page.screenshot({ path:'tools/out/contact.png' });
await browser.close(); server.kill();
