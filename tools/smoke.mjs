/**
 * Headless checks. `npm test`.
 *
 * Everything here runs in plain Node with no WebGL and no DOM: three.js only
 * needs a GPU when you actually render, so the world, the tracks and the whole
 * physics model can be built and driven in a terminal.
 *
 * The interesting one is TEST 5. The third parkour's escape is the load-bearing
 * moment of the entire game, and it is produced by physics rather than by a
 * script — which means it can silently stop working when the car is retuned.
 * So we drive it, every time, and assert that the car actually ends up outside.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `  ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
section('1. every module imports cleanly');

// `main.js` is an entry point — importing it starts a game. Excluded here and
// covered by the source checks in section 2 instead.
const files = walk('src')
  .filter((f) => !f.includes('/ui/') || f.endsWith('index.js'))
  .filter((f) => !f.endsWith('main.js'));
for (const f of files) {
  try {
    await import('./../' + f.replace(/\\/g, '/'));
    ok(relative('.', f), true);
  } catch (err) {
    ok(relative('.', f), false, err.message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
section('2. the intro is deletable (nothing imports it but main.js)');

const allFiles = walk('src');
const offenders = [];
for (const f of allFiles) {
  if (f.includes('game/intro/')) continue;
  const src = readFileSync(f, 'utf8');
  const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const imp of imports) {
    if (imp.includes('intro/') && !f.endsWith('main.js')) offenders.push(`${f} → ${imp}`);
  }
}
ok('no non-main module imports src/game/intro/', offenders.length === 0, offenders.join(', '));

const mainSrc = readFileSync('src/main.js', 'utf8');
const mainIntroImports = [...mainSrc.matchAll(/from\s+['"]([^'"]*intro\/[^'"]*)['"]/g)];
ok('main.js is the single intro import', mainIntroImports.length === 1, mainIntroImports[0]?.[1] ?? 'none');

// The intro must not be reachable through a side door either: the modes it
// stages have to work when it is gone.
for (const f of ['src/game/modes/raceMode.js', 'src/game/modes/openWorldMode.js', 'src/game/chase.js', 'src/game/game.js']) {
  const src = readFileSync(f, 'utf8');
  ok(`${relative('.', f)} is intro-free`, !/from\s+['"][^'"]*intro/.test(src));
}

// ---------------------------------------------------------------------------
section('3. config resolves');

const { resolveProfile, PROFILES, SURFACES, samplePowerCurve } = await import('../src/config/tuning.js');
const { resolveTheme, THEMES, resolveRenderPreset, RENDER_PRESETS } = await import('../src/config/style.js');
const { resolveRig, CAMERA_RIGS } = await import('../src/config/camera.js');

for (const name of Object.keys(PROFILES)) {
  const p = resolveProfile(name);
  ok(`profile "${name}"`, p.engineForce > 0 && p.maxSteer > 0 && p.lateralGrip > 0);
}
for (const name of Object.keys(THEMES)) {
  const t = resolveTheme(name);
  ok(`theme "${name}"`, !!t.fog && !!t.ground.base && !!t.vehicles && !!t.grade);
}
for (const name of Object.keys(RENDER_PRESETS)) ok(`render preset "${name}"`, !!resolveRenderPreset(name));
for (const name of Object.keys(CAMERA_RIGS)) {
  const r = resolveRig(name);
  ok(`camera rig "${name}"`, typeof r.offset?.z === 'number' && r.fov > 0);
}
ok('power curve endpoints', samplePowerCurve([1, 0.5, 0], 0) === 1 && samplePowerCurve([1, 0.5, 0], 1) === 0);

// ---------------------------------------------------------------------------
section('4. the world builds');

const { MaterialLibrary } = await import('../src/render/materials.js');
const { World } = await import('../src/world/world.js');
const { LEVELS, levelById } = await import('../src/levels/index.js');
const { ROAD } = await import('../src/world/track.js');

const theme = resolveTheme('forest');
const preset = resolveRenderPreset('psx');
const materials = new MaterialLibrary(theme, preset);

/**
 * Build a level's own map, exactly the way `LevelHost` does it in the game.
 *
 * Every level has a world to itself, so a test that wants two levels builds
 * two worlds — there is no longer a single terrain with every parkour on it,
 * and asserting against one would be asserting against something the game
 * never constructs.
 */
async function buildLevel(id, { scatter = true } = {}) {
  const level = levelById(id);
  if (!level) throw new Error(`no such level "${id}"`);
  const th = resolveTheme(level.theme);
  const w = new World({ materials: new MaterialLibrary(th, preset), theme: th, spec: level.map });
  await w.build({ trackData: level.tracks, scatter });
  return w;
}

const t0 = Date.now();
/** Bölüm 1's map: the barriered oval in daylight. Most checks below use it. */
const world = await buildLevel('level1');
const buildMs = Date.now() - t0;
/**
 * The map of whichever level says it breaks — found rather than named, because
 * the stage that ends the game has moved once already (bölüm 3 → bölüm 8) and
 * the checks below are about the trap, not about a number.
 */
const breaking = LEVELS.find((l) => l.story?.breaks) || LEVELS[LEVELS.length - 1];
const world3 = await buildLevel(breaking.id);
const t1 = world.mainTrack;
const t3 = world3.mainTrack;

ok('build time is sane', buildMs < 30000, `${buildMs}ms`);

// -- ONE LEVEL, ONE MAP ------------------------------------------------------
// The premise of `src/levels/`: no two levels stand on the same ground. Every
// one of them is built here, cheaply (no forest), and asked three things —
// does it have a map of its own, is its parkour on it, and is that map
// genuinely different land from every other level's.
{
  const seeds = new Map();
  const heights = [];
  for (const level of LEVELS) {
    const w = await buildLevel(level.id, { scatter: false });
    const track = w.mainTrack;
    ok(`${level.id} "${level.name}" has a map of its own`, !!track && !!w.terrain,
      `seed 0x${level.map.seed.toString(16)}, ${Math.round(w.halfSpan)}m half-span`);

    // A parkour authored off the middle of its map spends its lap climbing the
    // rim (see `TERRAIN_SHAPE.rimStart`). Every track has room around it.
    let furthest = 0;
    for (let i = 0; i < track.count; i++) furthest = Math.max(furthest, Math.hypot(track.px[i], track.pz[i]));
    ok(`…with its parkour inside it`, furthest < w.halfSpan * 0.6,
      `furthest point ${Math.round(furthest)}m of ${Math.round(w.halfSpan)}m`);

    ok(`…and exactly its own tracks on it`, w.tracks.size === level.tracks.length,
      [...w.tracks.keys()].join(', '));

    if (seeds.has(level.map.seed)) {
      ok(`…on land nobody else is standing on`, false, `shares a seed with ${seeds.get(level.map.seed)}`);
    } else {
      seeds.set(level.map.seed, level.id);
      ok(`…on land nobody else is standing on`, true);
    }
    // THE GLASS, ON EVERY MAP. A dome is derived from the ribbon under it and
    // sampled off the ground around it, so it is only as good as the land the
    // level was seeded onto — and a bad draw is a roof the player cannot drive
    // up or one the forest grows through. Checked here, per level, so the
    // answer arrives when the level is added rather than when somebody
    // eventually drives out there. If it fails: pick another `map.seed`.
    const dome = w.domes?.domes[0];
    if (dome) {
      let headroom = Infinity;
      for (let i = 0; i < track.count; i++) {
        headroom = Math.min(headroom, dome.heightAt(track.px[i], track.pz[i]) - track.py[i]);
      }
      ok(`…with a roof over the racing line`, headroom > 15,
        `${headroom.toFixed(1)}m at the tightest point, ${Math.round(dome.height)}m at the apex`);

      const nrm = new THREE.Vector3();
      const slopes = [];
      for (let ri = 1; ri < 40; ri++) {
        for (let ai = 0; ai < 60; ai++) {
          const r = (ri / 40) * dome.radius * 0.999;
          const a = (ai / 60) * Math.PI * 2;
          const x = dome.centerX + Math.cos(a) * r;
          const z = dome.centerZ + Math.sin(a) * r;
          if (dome.heightAt(x, z) - w.terrain.heightAt(x, z) < 12) continue;
          dome.normalAt(x, z, nrm);
          slopes.push((Math.acos(Math.min(1, nrm.y)) * 180) / Math.PI);
        }
      }
      slopes.sort((a, b) => a - b);
      // Measured at the 95th rather than the 99th, and the difference is a
      // level like the quarry: a map with a cliff in it has glass over the
      // cliff, and that patch of roof is unclimbable because the ground under
      // it is. What has to hold is that the roof is drivable in general — if
      // the *bulk* of it stands up like a wall there is nowhere to get on.
      const p95 = slopes[Math.floor(slopes.length * 0.95)];
      ok(`…and glass a car can climb`, p95 < 30,
        `p95 ${p95.toFixed(1)}°, p99 ${slopes[Math.floor(slopes.length * 0.99)].toFixed(1)}°, worst ${slopes.at(-1).toFixed(1)}°`);
    }

    // The road faces up. A back-facing surface does not look broken, it looks
    // *absent* — and the way it happens is a spline cusp folding the quads on
    // the inside of a corner, which is a thing a new level can author by
    // accident and nothing else would catch.
    {
      const group = w.root.getObjectByName(`track:${track.id}`);
      let worstUp = 1;
      let checked = 0;
      for (const meshName of ['road', 'roadDecals', 'startLine']) {
        const nrm = group?.getObjectByName(meshName)?.geometry?.getAttribute('normal');
        if (!nrm) continue;
        for (let i = 0; i < nrm.count; i += 5) {
          worstUp = Math.min(worstUp, nrm.getY(i));
          checked++;
        }
      }
      ok(`…and its road surface faces up`, checked > 100 && worstUp > 0.25,
        `${checked} normals, worst up-component ${worstUp.toFixed(3)}`);
    }

    heights.push({ id: level.id, h: [0, 300, -700].map((x) => w.terrain.heightAt(x, x * 0.4)) });
    w.dispose();
  }
  // Different seeds could still produce the same hills if the seed stopped
  // reaching the noise. Prove the ground actually differs.
  let identical = 0;
  for (let i = 0; i < heights.length; i++) {
    for (let j = i + 1; j < heights.length; j++) {
      if (heights[i].h.every((v, k) => Math.abs(v - heights[j].h[k]) < 0.01)) identical++;
    }
  }
  ok('and the ground under each level really is different ground', identical === 0,
    `${LEVELS.length} maps compared`);
}

let triangles = 0;
world.root.traverse((o) => {
  if (o.geometry?.index) triangles += o.geometry.index.count / 3;
  else if (o.geometry?.attributes.position) triangles += (o.geometry.attributes.position.count / 3) * (o.count || 1);
});
ok('world has geometry', triangles > 50000, `${Math.round(triangles / 1000)}k triangles`);
ok('collision grid populated', world.collision.count > 1000, `${world.collision.count} colliders`);

for (const w of [world, world3]) {
  for (const t of w.tracks.values()) {
    ok(`${t.id} "${t.name}"`, t.count > 100 && t.length > 500, `${Math.round(t.length)}m, ${t.count} samples`);
  }
}

// The road must be flat under the car, not stepped by the coarse heightfield.
let maxStep = 0;
for (let i = 0; i < t3.count; i += 3) {
  const a = world3.sampleGround(t3.px[i], t3.pz[i]).height;
  const j = (i + 3) % t3.count;
  const b = world3.sampleGround(t3.px[j], t3.pz[j]).height;
  maxStep = Math.max(maxStep, Math.abs(b - a));
}
ok('road surface is smooth', maxStep < 2.2, `max step ${maxStep.toFixed(2)}m over 9m`);

// ---------------------------------------------------------------------------
// THE GROUND YOU CAN SEE IS THE GROUND YOU DRIVE ON
//
// `Terrain#heightAt` used to interpolate bilinearly while the mesh was
// triangulated with an alternating diagonal. Those are two different surfaces:
// they agree at the corners of a cell and nowhere else, and at the centre they
// differ by the cell's twist. On natural ground that is centimetres; where a
// track's shaper flattens the land beside the road it reached 3.9m, and the
// car was parked 3.5m below the hill it was standing on. This is the check
// that stops the sampler and the mesh builder ever drifting apart again.
{
  const { cellIsAntiDiagonal, cellTriangleHeight } = await import('../src/world/terrain.js');
  const terrain = world.terrain;
  const n = terrain.gridSize;
  const cs = terrain.cellSize;
  const half = terrain.halfSpan;

  /**
   * Height read straight off the rendered chunk geometry: find the triangle
   * containing (x, z) by barycentric test and evaluate its plane. This is
   * deliberately NOT a call into Terrain — it reads the index buffer the GPU
   * gets, so nothing about the sampler can make it agree by construction.
   */
  const chunkFor = (x, z) => {
    for (const mesh of terrain.chunks) {
      const pos = mesh.geometry.getAttribute('position');
      const idx = mesh.geometry.index;
      const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox);
      if (x < bb.min.x - 0.01 || x > bb.max.x + 0.01 || z < bb.min.z - 0.01 || z > bb.max.z + 0.01) continue;
      for (let f = 0; f < idx.count; f += 3) {
        const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
        const ax = pos.getX(a), az = pos.getZ(a);
        const bx = pos.getX(b), bz = pos.getZ(b);
        const cx = pos.getX(c), cz = pos.getZ(c);
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        return l1 * pos.getY(a) + l2 * pos.getY(b) + l3 * pos.getY(c);
      }
    }
    return null;
  };

  let worstMesh = 0;
  let checkedMesh = 0;
  for (let k = 0; k < 400; k++) {
    // Concentrated near the tracks, which is where the shaper makes the twist
    // large and where the player actually is.
    const tr = t1;
    const i = Math.floor((k / 400) * tr.count);
    const off = ((k * 37) % 61) - 30;
    const x = tr.px[i] + tr.rx[i] * off;
    const z = tr.pz[i] + tr.rz[i] * off;
    if (!terrain.contains(x, z)) continue;
    const fromMesh = chunkFor(x, z);
    if (fromMesh === null) continue;
    checkedMesh++;
    worstMesh = Math.max(worstMesh, Math.abs(terrain.heightAt(x, z) - fromMesh));
  }
  ok(
    'sampled ground matches the triangle the GPU is drawing',
    checkedMesh > 300 && worstMesh < 0.01,
    `${checkedMesh} points beside the parkour, worst disagreement ${worstMesh.toFixed(5)}m`
  );

  // The same thing over the whole world, cheaply, against the shared helper.
  let worstAll = 0;
  let biggestTwist = 0;
  for (let k = 0; k < 120000; k++) {
    const x = (((k * 2654435761) >>> 0) / 4294967296 * 2 - 1) * half * 0.98;
    const z = (((k * 40503 + 12345) % 65536) / 65536 * 2 - 1) * half * 0.98;
    const fx = (x + half) / cs;
    const fz = (z + half) / cs;
    const i = Math.min(Math.max(Math.floor(fx), 0), n - 2);
    const j = Math.min(Math.max(Math.floor(fz), 0), n - 2);
    const row = j * n + i;
    const h00 = terrain.heights[row], h10 = terrain.heights[row + 1];
    const h01 = terrain.heights[row + n], h11 = terrain.heights[row + n + 1];
    const expect = cellTriangleHeight(h00, h10, h01, h11, fx - i, fz - j, cellIsAntiDiagonal(i, j));
    worstAll = Math.max(worstAll, Math.abs(terrain.heightAt(x, z) - expect));
    biggestTwist = Math.max(biggestTwist, Math.abs((h00 + h11 - h01 - h10) / 4));
  }
  ok('…everywhere, not just near the road', worstAll < 1e-9, `120k points, worst ${worstAll.toExponential(1)}m`);
  // If this ever reads ~0 the twist has gone away and the check above has
  // stopped proving anything. It is the size of the bug that was fixed.
  ok(
    'the twist that caused it is still there to be got wrong',
    biggestTwist > 0.5,
    `worst cell twist ${biggestTwist.toFixed(2)}m — that was the burial depth`
  );

  // Corners are the one place the two surfaces always agreed, so they are the
  // control: a sampler that returned nonsense would fail here too.
  let cornerErr = 0;
  for (let j = 4; j < n - 4; j += 17) {
    for (let i = 4; i < n - 4; i += 17) {
      const x = -half + i * cs;
      const z = -half + j * cs;
      cornerErr = Math.max(cornerErr, Math.abs(terrain.heightAt(x, z) - terrain.heights[j * n + i]));
    }
  }
  ok('grid corners still read exactly', cornerErr < 1e-6, `worst ${cornerErr.toExponential(1)}m`);

  // normalAt must NOT have gone faceted along with heightAt. It is what the car
  // lies down on every frame; a gradient taken across triangles steps at every
  // seam, and the body twitches. Pin the two surfaces apart: the height comes
  // from the facets, the slope comes from the smooth field, and this is the
  // only place in the codebase they are allowed to disagree.
  const e = terrain.cellSize * 0.5;
  const nrm = new THREE.Vector3();
  const expect = new THREE.Vector3();
  let worstNormalErr = 0;
  let facetGap = 0;
  for (let k = 0; k < 3000; k++) {
    const x = (((k * 7919) % 1999) / 1999 * 2 - 1) * half * 0.9;
    const z = (((k * 104729) % 2003) / 2003 * 2 - 1) * half * 0.9;
    terrain.normalAt(x, z, nrm);
    expect
      .set(
        terrain.smoothHeightAt(x - e, z) - terrain.smoothHeightAt(x + e, z),
        2 * e,
        terrain.smoothHeightAt(x, z - e) - terrain.smoothHeightAt(x, z + e)
      )
      .normalize();
    worstNormalErr = Math.max(worstNormalErr, nrm.distanceTo(expect));
    facetGap = Math.max(facetGap, Math.abs(terrain.heightAt(x, z) - terrain.smoothHeightAt(x, z)));
  }
  ok(
    'normalAt still reads the smooth surface, not the facets',
    worstNormalErr < 1e-9 && facetGap > 0.2,
    `3k points identical to the bilinear gradient; the two surfaces differ by up to ${facetGap.toFixed(2)}m, so this is not vacuous`
  );
}

// Winding. A back-facing surface does not look broken, it looks *absent* —
// you see through it to whatever is behind. The road shipped inside-out once
// and presented as "the tarmac renders as grass".
for (const w of [world, world3]) {
  const id = w.mainTrack.id;
  const group = w.root.getObjectByName(`track:${id}`);
  let worstUp = 1;
  let checked = 0;
  for (const meshName of ['road', 'roadDecals', 'startLine']) {
    const mesh = group?.getObjectByName(meshName);
    const n = mesh?.geometry?.getAttribute('normal');
    if (!n) continue;
    for (let i = 0; i < n.count; i += 7) {
      worstUp = Math.min(worstUp, n.getY(i));
      checked++;
    }
  }
  ok(
    `${id} road faces up`,
    checked > 0 && worstUp > 0.3,
    `${checked} normals checked, worst up-component ${worstUp.toFixed(3)}`
  );
}

// The stage that breaks is an unsealed track with a slick section, marked by
// plastic posts and lit by a rig — not a road with Armco. Check that the shape
// of it holds, because the ending of the game is produced by that shape.
const slickSamples = t3.surfaces.filter((s) => s === 'SLICK').length;
ok(`${breaking.name}: a slick section`, slickSamples > 20, `${slickSamples} samples`);
ok(
  `${breaking.name}: unsealed for its whole length`,
  t3.surfaces.every((s) => s !== 'TARMAC'),
  `${t3.surfaces.filter((s) => s === 'TARMAC').length} tarmac samples`
);
ok(`${breaking.name}: no barriers at all`, t3.colliders.length === 0, `${t3.colliders.length} colliders`);
ok(`${breaking.name}: plastic markers instead`, t3.markers.length > 100, `${t3.markers.length} posts`);
ok(`${breaking.name}: a lighting rig`, t3.lightAnchors.length > 20, `${t3.lightAnchors.length} lamps`);

// The markers and the lights stop over the same stretch, and the slick section
// is inside it. If these three drift apart the whole beat stops landing.
const mGap = t3.data.markers.gaps[0];
const lGap = t3.data.lighting.gaps[0];
const slick = t3.data.patches.find((p) => p.surface === 'SLICK');
ok(
  'the unlit stretch and the unmarked stretch are the same stretch',
  mGap.from === lGap.from && mGap.to === lGap.to,
  `markers ${mGap.from}–${mGap.to}, lights ${lGap.from}–${lGap.to}`
);
ok(
  'the slick clay sits inside the dark',
  slick.from >= lGap.from && slick.to <= lGap.to,
  `slick ${slick.from}–${slick.to} in dark ${lGap.from}–${lGap.to}`
);
ok(
  'the blackout is triggered before the player reaches the dark',
  t3.data.breakout.blackoutAt < lGap.from,
  `blackout at ${t3.data.breakout.blackoutAt}, dark starts ${lGap.from}`
);
// Nothing on this track may be solid — that is the whole design.
const markerColliders = t3.markers.filter((m) => m.solid);
ok('the plastic posts are not solid', markerColliders.length === 0);
ok('bölüm 1 is fully enclosed', t1.colliders.length > 100);

// ---------------------------------------------------------------------------
section('5. physics — and the escape actually happens');

const { Vehicle } = await import('../src/vehicle/vehicle.js');
const { AiDriver } = await import('../src/vehicle/ai.js');

const DT = 1 / 120;
function simulate(vehicle, steps, driver) {
  for (let i = 0; i < steps; i++) {
    vehicle.setCommand(driver(vehicle, DT, i * DT));
    vehicle.fixedUpdate(DT);
  }
}

// -- straight-line performance ----------------------------------------------
const flat = {
  sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), surface: 'TARMAC' }),
  collide: () => null,
};
const test = new Vehicle({ profile: 'hatchback', world: flat, id: 'test' });
test.reset(new THREE.Vector3(0, 0, 0), 0);

let timeTo100 = null;
simulate(test, 120 * 30, (v, dt, t) => {
  if (timeTo100 === null && v.speed * 3.6 >= 100) timeTo100 = t;
  return { throttle: 1, brake: 0, steer: 0, handbrake: 0 };
});
const topSpeed = test.speed * 3.6;
ok('0–100 km/h is arcade-quick', timeTo100 > 2 && timeTo100 < 9, `${timeTo100?.toFixed(2)}s`);
ok('top speed is sane', topSpeed > 120 && topSpeed < 260, `${topSpeed.toFixed(0)} km/h`);

// -- braking -----------------------------------------------------------------
// Note: holding `brake` past a standstill engages reverse, by design. Measure
// the time to stop, not the speed after a fixed window.
const before = test.speed;
let timeToStop = null;
simulate(test, 120 * 4, (v, dt, t) => {
  if (timeToStop === null && v.longSpeed < 0.5) timeToStop = t;
  return { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
});
ok(
  'brakes stop the car',
  timeToStop !== null && timeToStop < 4,
  `${before.toFixed(0)} m/s → stopped in ${timeToStop?.toFixed(2)}s`
);
ok('holding brake past zero reverses', test.longSpeed < -1, `${test.longSpeed.toFixed(1)} m/s`);

// -- which way is right? -----------------------------------------------------
// Mirrored steering is not a subtle bug to play but it IS a subtle bug to read,
// because every sign in the file is individually plausible. Pin it down.
{
  const car = new Vehicle({ profile: 'hatchback', world: flat, id: 'steer' });
  car.reset(new THREE.Vector3(0, 0, 0), 0); // heading 0 → facing +Z
  car.velocity.set(0, 0, 25);
  simulate(car, 120 * 2, () => ({ throttle: 0.4, brake: 0, steer: 1, handbrake: 0 }));

  // Camera sits behind on -Z looking toward +Z, so screen-right is world -X.
  ok(
    'steer +1 turns the car to the driver\'s right',
    car.position.x < -2,
    `moved to x=${car.position.x.toFixed(1)} (screen-right is -x)`
  );
  const fresh = new Vehicle({ profile: 'hatchback', world: flat, id: 'basis' });
  fresh.reset(new THREE.Vector3(0, 0, 0), 0);
  ok(
    '...and right is forward × up at heading 0',
    fresh.right.x < -0.99 && Math.abs(fresh.forward.z - 1) < 0.01,
    `forward=(${fresh.forward.x.toFixed(2)}, 0, ${fresh.forward.z.toFixed(2)}) right=(${fresh.right.x.toFixed(2)}, 0, ${fresh.right.z.toFixed(2)})`
  );

  const mirror = new Vehicle({ profile: 'hatchback', world: flat, id: 'steer2' });
  mirror.reset(new THREE.Vector3(0, 0, 0), 0);
  mirror.velocity.set(0, 0, 25);
  simulate(mirror, 120 * 2, () => ({ throttle: 0.4, brake: 0, steer: -1, handbrake: 0 }));
  ok('steer -1 turns left, symmetrically', mirror.position.x > 2 && Math.abs(mirror.position.x + car.position.x) < 0.5,
    `x=${mirror.position.x.toFixed(1)} vs ${car.position.x.toFixed(1)}`);

  // And the keyboard has to agree: D is `right`, which must produce steer > 0.
  const { BINDINGS } = await import('../src/core/input.js');
  ok('D is bound to right, A to left', BINDINGS.right.includes('KeyD') && BINDINGS.left.includes('KeyA'));
  ok('arrows agree', BINDINGS.right.includes('ArrowRight') && BINDINGS.left.includes('ArrowLeft'));
}

// -- grip: the same corner on tarmac and on ice ------------------------------
function corneringRadius(surfaceId) {
  const ground = {
    sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), surface: surfaceId }),
    collide: () => null,
  };
  const v = new Vehicle({ profile: 'hatchback', world: ground, id: 's' });
  v.reset(new THREE.Vector3(0, 0, 0), 0);
  v.velocity.set(0, 0, 30);
  simulate(v, 120 * 3, () => ({ throttle: 0.5, brake: 0, steer: 1, handbrake: 0 }));
  return { lateral: Math.abs(v.position.x), heading: v.heading, slip: v.slip };
}
const onTarmac = corneringRadius('TARMAC');
const onIce = corneringRadius('ICE');
ok(
  'ice understeers badly vs tarmac',
  Math.abs(onIce.heading) < Math.abs(onTarmac.heading) * 0.75,
  `turned ${((onTarmac.heading * 180) / Math.PI).toFixed(0)}° on tarmac vs ${((onIce.heading * 180) / Math.PI).toFixed(0)}° on ice`
);

// -- THE ESCAPE --------------------------------------------------------------
const { BREAKOUT, TREES } = await import('../src/config/gameplay.js');
const q = {};

/**
 * A player, not an AI.
 *
 * The distinction matters. `AiDriver` re-reads the surface it is standing on
 * every step, so it starts respecting the ice the instant it touches it. A
 * human on their first lap does not know the corner is coming, arrives at
 * racing speed, and needs about a third of a second to notice anything is wrong
 * and react. That is who the trap has to work on.
 */
function playerModel(track, { reaction = 0.35, lookahead = 18 } = {}) {
  const history = [];
  const goal = new THREE.Vector3();
  return (v, dt) => {
    const r = track.query(v.position.x, v.position.z, q);
    let steer = 0;
    if (r) {
      track.ahead(r.index, lookahead + v.speed * 0.35, goal);
      const dx = goal.x - v.position.x;
      const dz = goal.z - v.position.z;
      const angle = Math.atan2(dx, dz) - v.heading;
      // Negated: `angle` is a heading delta, `steer` is positive-is-right, and
      // heading decreases when turning right. Same rule as AiDriver#_steerTo.
      steer = Math.max(-1, Math.min(1, -Math.atan2(Math.sin(angle), Math.cos(angle)) * 2.0));
    }
    // Delayed perception of the slide.
    history.push(v.slip);
    const delayed = history.length > reaction / dt ? history.shift() : 0;
    const panicBrake = delayed > 0.85 ? 0.6 : 0;
    return { throttle: panicBrake > 0 ? 0 : 1, brake: panicBrake, steer, handbrake: 0 };
  };
}

function runCorner(driverFactory, label, profile = 'hatchback', ignoreSurfaces = false) {
  const startIndex = t3.sampleIndexAt(0.42);
  // On bölüm 3's own map: the clay, the terrain under it and the car all have
  // to be the ones the player actually meets.
  const car = new Vehicle({ profile, world: world3, id: label });
  car.ignoreSurfaces = ignoreSurfaces;
  car.reset(
    new THREE.Vector3(t3.px[startIndex], t3.py[startIndex] + 0.5, t3.pz[startIndex]),
    Math.atan2(t3.tx[startIndex], t3.tz[startIndex])
  );
  car.velocity.set(car.forward.x * 36, 0, car.forward.z * 36);
  const drive = driverFactory(car);
  let maxOff = 0;
  let offFor = 0;
  let peakOffFor = 0;
  let entrySpeed = 0;
  simulate(car, 120 * 24, (v, dt) => {
    const cmd = drive(v, dt);
    const r = t3.query(v.position.x, v.position.z, q);
    if (r && r.surface === 'SLICK' && entrySpeed === 0) entrySpeed = v.speed;
    // A null query means the car is outside the track's spatial hash entirely —
    // further off than any number the hash can report.
    const edge = r ? r.dist - r.halfWidth : Infinity;
    if (edge > 0) {
      maxOff = Math.max(maxOff, edge);
      offFor += dt;
      peakOffFor = Math.max(peakOffFor, offFor);
    } else offFor = 0;
    return cmd;
  });
  return { maxOff, peakOffFor, entrySpeed, car };
}

const human = runCorner((v) => playerModel(t3), 'escapee');
const wouldTrigger =
  human.maxOff > BREAKOUT.escapeDistance ||
  (human.maxOff > 30 && human.peakOffFor > BREAKOUT.escapeHoldSeconds);
ok(
  'a player arrives at the clay carrying speed',
  human.entrySpeed > 28,
  `${(human.entrySpeed * 3.6).toFixed(0)} km/h at the clay`
);
ok(
  'and loses the car completely',
  human.maxOff > 30,
  human.maxOff === Infinity
    ? `left the track network entirely, for ${human.peakOffFor.toFixed(1)}s`
    : `ran ${human.maxOff.toFixed(0)}m past the ribbon edge for ${human.peakOffFor.toFixed(1)}s`
);
ok('...far enough to trigger the breakout', wouldTrigger, `threshold ${BREAKOUT.escapeDistance}m`);

// The AI can feel the ice the instant it touches it and still gets thrown well
// off the road. It recovers where a human would not, which is the correct
// outcome: the corner is unfair to reflexes, not impossible in principle.
const ai = runCorner(
  (v) => {
    const d = new AiDriver(v, { track: t3, skill: 0.85, aggression: 0.7, seed: 9, world: world3 });
    return (_, dt) => d.update(dt);
  },
  'ai-escapee'
);
ok(
  'even a perfect line gets thrown off the track',
  ai.maxOff > 5,
  `${ai.maxOff.toFixed(1)}m past the edge (it recovers; a human does not)`
);

// -- the rivals must NOT go off ---------------------------------------------
// They are part of the track (Vehicle#ignoreSurfaces), so the ice is not there
// for them. If this ever fails the whole field slides off and the moment reads
// as a bug rather than as something happening to you specifically.
const rival = runCorner(
  (v) => {
    const d = new AiDriver(v, { track: t3, skill: 0.85, aggression: 0.6, seed: 3, world: world3 });
    return (_, dt) => d.update(dt);
  },
  'rival',
  'rival',
  true
);
ok(
  'the rivals take the same corner cleanly',
  rival.maxOff < 6,
  `stayed within ${rival.maxOff.toFixed(1)}m of the ribbon`
);

// -- oriented boxes -----------------------------------------------------------
// A guardrail is a long thin box laid ALONG the track. If its local frame is
// built the wrong way round it is correct at multiples of 90° and silently
// rotated everywhere between, so on a curve the rail becomes a wall across the
// road. The barrier is drawn in the right place either way, so it presents as
// "invisible boxes near the barriers".
{
  const { CollisionGrid } = await import('../src/world/collision.js');
  let worstAcross = 0;
  let worstAlong = Infinity;
  for (const deg of [0, 20, 45, 70, 90, 135, 200, 310]) {
    const h = (deg * Math.PI) / 180;
    const grid = new CollisionGrid(12);
    // Same shape the track builds: 0.44m thick, 6m long, laid along heading h.
    grid.insert({ type: 'box', x: 0, y: 0, z: 0, halfX: 0.22, halfY: 0.5, halfZ: 3.0, rotationY: h });
    // forward = (sin h, cos h); across = (cos h, -sin h)
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const ax = Math.cos(h);
    const az = -Math.sin(h);
    // 2.5m along the rail must still be inside it…
    const along = new THREE.Vector3(fx * 2.5, 0, fz * 2.5);
    if (grid.resolve(along, 0.3)) worstAlong = Math.min(worstAlong, 1);
    else worstAlong = 0;
    // …and 2.0m out to the side must be nowhere near it.
    const across = new THREE.Vector3(ax * 2.0, 0, az * 2.0);
    if (grid.resolve(across, 0.3)) worstAcross++;
  }
  ok('oriented boxes stay solid along their length', worstAlong === 1);
  ok(
    'oriented boxes are thin across their width at every angle',
    worstAcross === 0,
    `${worstAcross} of 8 angles reported a phantom hit 2m to the side`
  );
}

// -- the car's own footprint --------------------------------------------------
{
  const car = new Vehicle({ profile: 'hatchback', world: flat, id: 'shape' });
  const T = car.tuning;
  ok(
    'car hitbox is as wide as the car, not as long',
    car.collisionRadius < T.halfExtents.x * 1.2,
    `radius ${car.collisionRadius.toFixed(2)}m vs half-width ${T.halfExtents.x}m`
  );
  const span = Math.max(...car.collisionProbes) + car.collisionRadius;
  ok(
    '...and its probes still cover the full length',
    Math.abs(span - T.halfExtents.z) < 0.05,
    `covers ${span.toFixed(2)}m of ${T.halfExtents.z}m`
  );

  // Drive down the middle of a barriered straight and touch nothing.
  const t1 = world.mainTrack;
  const q2 = {};
  let clipped = 0;
  for (let i = 0; i < t1.count; i += 4) {
    const probe = new THREE.Vector3(t1.px[i], t1.py[i] + 0.5, t1.pz[i]);
    car.reset(probe, Math.atan2(t1.tx[i], t1.tz[i]));
    for (let p = 0; p < car.collisionProbes.length; p++) {
      if (world.collide(car.probePosition(p), car.collisionRadius)) clipped++;
    }
  }
  ok(
    'the racing line is clear of barriers all the way round',
    clipped === 0,
    `${clipped} phantom contacts on the centreline of ${t1.id}`
  );

  // How far off the racing line can you get before you touch the Armco? This is
  // the number the player actually feels. It should be just past the edge of the
  // tarmac — not well inside it, which is what "invisible boxes" means.
  const contactAt = [];
  for (const frac of [0.08, 0.21, 0.34, 0.47, 0.6, 0.73, 0.86, 0.95]) {
    const i = t1.sampleIndexAt(frac);
    const hw = t1.halfWidth[i];
    let firstTouch = null;
    for (let off = 0; off < hw + 4; off += 0.05) {
      const p = new THREE.Vector3(
        t1.px[i] + t1.rx[i] * off,
        t1.py[i] + 0.5,
        t1.pz[i] + t1.rz[i] * off
      );
      car.reset(p, Math.atan2(t1.tx[i], t1.tz[i]));
      let hit = false;
      for (let k = 0; k < car.collisionProbes.length; k++) {
        if (world.collide(car.probePosition(k), car.collisionRadius)) hit = true;
      }
      if (hit) {
        firstTouch = off - hw; // metres past the tarmac edge
        break;
      }
    }
    contactAt.push(firstTouch ?? 99);
  }
  const worst = Math.min(...contactAt);
  ok(
    'you can reach the edge of the tarmac before the barrier stops you',
    worst > -0.15,
    `nearest contact ${worst.toFixed(2)}m relative to the tarmac edge (negative = stopped early)`
  );
}

// -- car on car ---------------------------------------------------------------
{
  const { resolveVehicleContacts, CONTACT } = await import('../src/vehicle/contacts.js');
  const mk = (id, x, z, vz) => {
    const v = new Vehicle({ profile: 'hatchback', world: flat, id });
    v.reset(new THREE.Vector3(x, 0, z), 0);
    v.velocity.set(0, 0, vz);
    return v;
  };

  // Rear-ending: the faster car behind must slow, the one in front must speed up.
  const behind = mk('behind', 0, 0, 30);
  const ahead = mk('ahead', 0, 4.0, 12);
  for (let i = 0; i < 120; i++) {
    behind.fixedUpdate(DT);
    ahead.fixedUpdate(DT);
    resolveVehicleContacts([behind, ahead], DT);
  }
  ok(
    'a rear-end transfers momentum',
    behind.velocity.z < 30 && ahead.velocity.z > 12,
    `${behind.velocity.z.toFixed(1)} m/s into ${ahead.velocity.z.toFixed(1)} m/s`
  );
  const gap = ahead.position.z - behind.position.z;
  ok('...and the cars do not end up inside each other', gap > 3.4, `gap ${gap.toFixed(2)}m`);

  // Without the pass they would pass straight through — check that directly.
  const ghostA = mk('ga', 0, 0, 30);
  const ghostB = mk('gb', 0, 4.0, 12);
  for (let i = 0; i < 120; i++) {
    ghostA.fixedUpdate(DT);
    ghostB.fixedUpdate(DT);
  }
  ok(
    'without the contact pass they overlap (proving the test is live)',
    ghostA.position.z > ghostB.position.z,
    `${ghostA.position.z.toFixed(1)} vs ${ghostB.position.z.toFixed(1)}`
  );

  // Side-swipe: a glancing hit should push the other car sideways and spin it.
  const meA = mk('sa', 0, 0, 26);
  const meB = mk('sb', 1.5, 1.0, 26);
  const headingBefore = meB.heading;
  for (let i = 0; i < 90; i++) {
    meA.velocity.x = 3; // steer into them
    meA.fixedUpdate(DT);
    meB.fixedUpdate(DT);
    resolveVehicleContacts([meA, meB], DT);
  }
  ok('a side-swipe shoves the other car sideways', meB.position.x > 1.8, `x=${meB.position.x.toFixed(2)}`);
  ok('...and disturbs its heading', Math.abs(meB.heading - headingBefore) > 0.002,
    `Δheading ${(meB.heading - headingBefore).toFixed(4)}`);

  // A heavier car should win the exchange.
  const light = mk('light', 0, 0, 28);
  const heavy = new Vehicle({ profile: 'cruiser', world: flat, id: 'heavy' });
  heavy.reset(new THREE.Vector3(0, 0, 4.0), 0);
  heavy.velocity.set(0, 0, 10);
  const lightStart = light.position.x;
  for (let i = 0; i < 120; i++) {
    light.fixedUpdate(DT);
    heavy.fixedUpdate(DT);
    resolveVehicleContacts([light, heavy], DT);
  }
  ok(
    'mass decides who moves',
    Math.abs(light.velocity.z - 28) > Math.abs(heavy.velocity.z - 10),
    `light lost ${(28 - light.velocity.z).toFixed(1)}, heavy gained ${(heavy.velocity.z - 10).toFixed(1)}`
  );
}

// -- collision ----------------------------------------------------------------
const tree = world.scatter.colliders.find((c) => c.type === 'cylinder' && c.radius > 0.8);
if (tree) {
  // Direct query first: is the grid even reporting the overlap?
  const probe = new THREE.Vector3(tree.x, tree.y, tree.z);
  ok('collision grid finds a tree', !!world.collide(probe, 1.7), `r=${tree.radius.toFixed(2)}`);
  const clear = new THREE.Vector3(tree.x + 60, tree.y, tree.z + 60);
  ok('collision grid reports empty space as empty', !world.collide(clear, 1.7));

  // Then drive into it from close range, where terrain drift cannot make us miss.
  //
  // Speed matters now: a trunk has a capacity, and past it the tree comes down
  // on the car and takes its collider with it (see world/trees.js). So "solid"
  // has to be tested below that line, and felling tested above it.
  // Capacity is joules now, so the survivable speed comes back through
  // v = sqrt(2E/m). Well under one trunk's worth, with room for the extra hits
  // that three seconds of shoving at full throttle lands on top of it.
  const capacity = tree.radius * TREES.capacityPerRadius;
  const survivable = Math.sqrt((2 * capacity * 0.4) / 1100);

  // -- before the forest is armed, none of the above is true ----------------
  //
  // A fresh World has taken no `chase:escaped` / `intro:finished`, which is the
  // state the whole opening is played in: trees stop cars and hide them, and
  // nothing else. This is the check that the races cannot be spent knocking the
  // scenery down. See TREES.breakableBy.
  ok('a fresh forest takes no damage', world.trees.breakable === false);
  const early = new Vehicle({ profile: 'hatchback', world, id: 'early' });
  early.isPlayer = true;
  early.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  early.velocity.set(0, 0, 34);
  simulate(early, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('…so a flat-out hit before the first escape does nothing at all',
    !tree.felled && !tree.damage, `damage=${Math.round(tree.damage || 0)} J`);
  ok('…and it is still standing in the way', early.position.z < tree.z + 4);

  // -- and cops never get to fell one, armed or not -------------------------
  world.trees.allowDamage();
  const cop = new Vehicle({ profile: 'cruiser', world, id: 'cop-test' });
  cop.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  cop.velocity.set(0, 0, 34);
  simulate(cop, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('a cop cannot damage a tree even once the forest is armed',
    !tree.felled && !tree.damage, `damage=${Math.round(tree.damage || 0)} J`);

  const hitCar = new Vehicle({ profile: 'hatchback', world, id: 'crash' });
  hitCar.isPlayer = true;
  hitCar.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  hitCar.velocity.set(0, 0, survivable);
  simulate(hitCar, 120 * 3, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  const passedThrough = hitCar.position.z > tree.z + 4;
  ok(
    'trees are solid below their capacity',
    !passedThrough && !tree.felled,
    passedThrough ? 'drove straight through' : `stopped by the trunk at ${survivable.toFixed(1)} m/s`
  );
  ok(
    'leaning on a trunk at full throttle does not fell it',
    !tree.felled,
    `${Math.round((tree.damage || 0) / 1000)} kJ / ${Math.round(capacity / 1000)} kJ`
  );
  // -- the lean IS the damage, drawn ----------------------------------------
  //
  // A trunk on the way down has to read as one from a moving car with no health
  // bar anywhere on the screen. So the tilt is not decoration: it is exactly
  // damage/capacity of TREES.maxLean, and a trunk that has taken twice as much
  // leans twice as far. Measured as the angle between the trunk's up vector
  // before and after, which is what the player actually sees.
  const bend = world.scatter.colliders.find(
    (c) => c !== tree && c.type === 'cylinder' && c.radius > 0.8 && c.mesh && !c.felled
  );
  if (bend) {
    const _p = new THREE.Vector3();
    const _r = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const upOf = (m) => {
      m.decompose(_p, _r, _s);
      return new THREE.Vector3(0, 1, 0).applyQuaternion(_r);
    };
    const rest = upOf(bend.baseMatrix);
    const leanNow = () => {
      const m = new THREE.Matrix4();
      bend.mesh.getMatrixAt(bend.instance, m);
      return rest.angleTo(upOf(m));
    };

    world.onImpact(hitCar, bend, 40000);
    const lean1 = leanNow();
    const t1 = bend.damage / bend.capacity;
    world.onImpact(hitCar, bend, 40000);
    const lean2 = leanNow();
    const t2 = bend.damage / bend.capacity;

    ok('a damaged trunk leans by its share of its capacity',
      Math.abs(lean1 - t1 * TREES.maxLean) < 0.02,
      `${lean1.toFixed(3)} rad at ${Math.round(t1 * 100)}% spent`);
    ok('…and a second hit bends it further, by the same rule',
      lean2 > lean1 && Math.abs(lean2 - t2 * TREES.maxLean) < 0.02,
      `${lean2.toFixed(3)} rad at ${Math.round(t2 * 100)}% spent`);
    ok('…without felling it', !bend.felled);
  }

  // Now hit it properly.
  const ram = new Vehicle({ profile: 'hatchback', world, id: 'ram' });
  ram.isPlayer = true;
  ram.reset(new THREE.Vector3(tree.x, 0, tree.z - 9), 0);
  ram.velocity.set(0, 0, 30);
  simulate(ram, 120, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }));
  ok('a hard enough hit fells the tree', !!tree.felled,
    `${Math.round((tree.damage || 0) / 1000)} kJ / ${Math.round(capacity / 1000)} kJ`);
  ok('a felled tree leaves no hitbox', tree.disabled === true && tree.blocksSight === false);

  // -- what actually flips the switch ---------------------------------------
  //
  // The forest listens for the story rather than being told by it: `Trees` never
  // imports the chase and the chase never mentions trees. That wire is the whole
  // gate, so it is worth one check on a throwaway instance.
  const { Trees } = await import('../src/world/trees.js');
  const { events } = await import('../src/core/events.js');
  const forest = new Trees();
  ok('a new forest starts unbreakable', forest.breakable === false && forest.armed === false);
  events.emit('chase:started', {});
  ok('the sirens arm the disguise, but not the axe',
    forest.armed === true && forest.breakable === false);
  events.emit('chase:escaped', {});
  ok('ditching the first cops is what makes the forest breakable', forest.breakable === true);
  forest.dispose();
}

// ---------------------------------------------------------------------------
// THE CAR IS NOT A POINT
//
// `Vehicle` stuck itself to the ground sampled at its own centre, so on any
// slope the nose or a flank was inside the hill while the physics insisted the
// car was on top of it. Drive the real car across the real world and measure
// how far the bodywork ends up under the terrain — using the visual transform,
// tilt and all, because that is what the player is complaining about.
{
  const FLOOR_Y = 0.01; // underside of the body shell, see chassis.js
  const p = new THREE.Vector3();

  const drive = (footprint) => {
    let worst = 0;
    let buried = 0;
    let samples = 0;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let r = 0; r < 12; r++) {
      const a = rnd() * Math.PI * 2;
      const d = 200 + rnd() * 900;
      const car = new Vehicle({ profile: 'hatchback', world, id: `dig${r}` });
      car.groundReach = car.tuning.halfExtents.z * footprint;
      car.groundReachLat = car.tuning.halfExtents.x * footprint;
      car.reset(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), rnd() * Math.PI * 2);
      let steer = 0;
      for (let s = 0; s < 120 * 14; s++) {
        if (s % 90 === 0) steer = (rnd() * 2 - 1) * 0.55;
        car.setCommand({ throttle: 0.85, brake: 0, steer, handbrake: 0 });
        car.fixedUpdate(1 / 120);
        car.syncVisual(1, 1 / 120);
        if (s % 8 || !car.grounded) continue;
        if (!world.terrain.contains(car.position.x, car.position.z)) break;
        car.object.updateMatrixWorld(true);
        const hx = car.tuning.halfExtents.x;
        const hz = car.tuning.halfExtents.z;
        let deepest = 0;
        for (const sz of [-hz, 0, hz]) {
          for (const sx of [-hx, hx]) {
            p.set(sx, FLOOR_Y, sz).applyMatrix4(car.object.matrixWorld);
            if (!world.terrain.contains(p.x, p.z)) continue;
            deepest = Math.max(deepest, world.groundHeightAt(p.x, p.z) - p.y);
          }
        }
        samples++;
        if (deepest > 0.05) buried++;
        worst = Math.max(worst, deepest);
      }
    }
    return { worst, rate: buried / samples, samples };
  };

  const point = drive(0); // the old behaviour, for contrast
  const footprint = drive(resolveProfile('hatchback').groundFootprint);
  ok(
    'the car does not drive inside hills any more',
    footprint.worst < 1.0 && footprint.rate < 0.01,
    `worst ${footprint.worst.toFixed(2)}m under ground, ${(footprint.rate * 100).toFixed(2)}% of ${footprint.samples} samples`
  );
  ok(
    '…and that is the footprint sampler doing it, not luck',
    footprint.worst < point.worst * 0.75 && footprint.rate < point.rate * 0.5,
    `centre-only: ${point.worst.toFixed(2)}m / ${(point.rate * 100).toFixed(2)}%`
  );
  ok(
    'the ground probes sit inside the bodywork',
    resolveProfile('hatchback').groundFootprint > 0 && resolveProfile('hatchback').groundFootprint <= 1,
    `groundFootprint ${resolveProfile('hatchback').groundFootprint}`
  );
}

// ---------------------------------------------------------------------------
section('6. lights');

{
  const { LightPool, LIGHT_BUDGET } = await import('../src/render/lightPool.js');
  const { TrackLighting, LIGHTING } = await import('../src/world/lighting.js');

  const scene = new THREE.Scene();
  const pool = new LightPool(scene);
  const lightCount = scene.children.filter((o) => o.isLight).length;
  ok(
    'the pool allocates its whole budget up front',
    lightCount === LIGHT_BUDGET.point + LIGHT_BUDGET.spot,
    `${lightCount} lights in the scene`
  );
  ok('…all parked at zero', scene.children.filter((o) => o.isLight && o.intensity > 0).length === 0);

  const taken = [];
  for (let i = 0; i < LIGHT_BUDGET.spot; i++) taken.push(pool.acquireSpot());
  ok('spot leases run out cleanly', pool.acquireSpot() === null);
  taken[0].release();
  ok('…and come back after release', pool.acquireSpot() !== null);
  pool.releaseAll();

  // The light count must never change after boot, or three recompiles every
  // material in the world at the exact moment something dramatic happens.
  const afterChurn = scene.children.filter((o) => o.isLight).length;
  ok('acquiring never changes the light count', afterChurn === lightCount, `${afterChurn}`);

  // -- the rig ---------------------------------------------------------------
  const rigPool = new LightPool(new THREE.Scene());
  const rig = new TrackLighting({ track: t3, pool: rigPool });
  ok('the rig leases lights for the nearest poles', rig._leases.length === LIGHTING.maxActive);

  // Point the camera at one known anchor and check that anchor gets a light.
  const target = t3.lightAnchors[10];
  rig.update(0.5, { x: target.x, y: target.y, z: target.z });
  const lit = rig._leases.filter((l) => l.light.intensity > 0);
  ok('…and they actually light up', lit.length > 0, `${lit.length} of ${rig._leases.length} on`);
  const nearest = rig._leases[0].light;
  ok(
    '…nearest first',
    Math.hypot(nearest.position.x - target.x, nearest.position.z - target.z) < 6,
    `${Math.hypot(nearest.position.x - target.x, nearest.position.z - target.z).toFixed(1)}m from the anchor`
  );

  // Blackout: the whole rig has to go to nothing, and stay there.
  rig.blackout(9);
  for (let i = 0; i < 60; i++) rig.update(1 / 30, { x: target.x, y: target.y, z: target.z });
  ok('blackout kills the rig', rig.power < 0.02, `power ${rig.power.toFixed(3)}`);
  ok('…and every lamp with it', rig._leases.every((l) => l.light.intensity < 1));
  rig.hold();
  rig.dispose();
  ok('disposing gives the leases back', rigPool.points.every((l) => !l.inUse));
}

{
  // Headlights are the scarcest lease. Only the cars the player watches in the
  // dark get one — see the `headlights` default in createChassis.
  const { createChassis } = await import('../src/vehicle/chassis.js');
  const { LightPool } = await import('../src/render/lightPool.js');
  const scene = new THREE.Scene();
  const pool = new LightPool(scene);
  const he = { x: 0.9, y: 0.65, z: 2.05 };
  const mk = (kind) => createChassis({ materials, theme, kind, halfExtents: he, lightPool: pool });

  const before = pool.spots.filter((l) => l.inUse).length;
  const rival = mk('rival');
  ok('rivals do not burn a spot light', pool.spots.filter((l) => l.inUse).length === before);
  const player = mk('player');
  ok('the player does', pool.spots.filter((l) => l.inUse).length === before + 1);
  const cop = mk('cop');
  ok('so do the cops', pool.spots.filter((l) => l.inUse).length === before + 2);

  player.setHeadlights(true);
  const on = pool.spots.find((l) => l.inUse && l.light.intensity > 0);
  ok('switching them on lights a real spot', !!on, on ? `intensity ${on.light.intensity}` : 'none');
  player.setHeadlights(false);
  ok('…and off again', !pool.spots.some((l) => l.inUse && l.light.intensity > 0));

  for (const c of [rival, player, cop]) c.dispose();
  ok('chassis dispose returns every lease', pool.spots.every((l) => !l.inUse) && pool.points.every((l) => !l.inUse));
}

// ---------------------------------------------------------------------------
section('7. seed determinism');
// A level is not kept in memory while you are away from it (see
// `src/game/levels.js`) — going back rebuilds it. So "the same level twice" and
// "the level you left" have to be the same valley, or coming back is arriving
// somewhere new.
const worldB = await buildLevel('level1', { scatter: false });
const sampleA = world.terrain.heightAt(123, -456);
const sampleB = worldB.terrain.heightAt(123, -456);
ok('same level, same terrain, every time it is rebuilt', Math.abs(sampleA - sampleB) < 1e-6,
  `${sampleA.toFixed(4)} vs ${sampleB.toFixed(4)}`);
ok('…and a different level is somewhere else',
  Math.abs(world3.terrain.heightAt(123, -456) - sampleA) > 0.01,
  `${world3.terrain.heightAt(123, -456).toFixed(4)} on bölüm 3`);
worldB.dispose();

// ---------------------------------------------------------------------------
section('8. saved sound settings actually reach the mix');

// The player restores their volumes at boot, which is *before* the first
// gesture, which means the AudioContext is still suspended and the GainNodes
// will not take a value. The engine has to remember and replay. Nothing here
// makes a sound — the fakes below only record what lands on each AudioParam,
// because the bug was a number that never reached the node at all.
{
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  /** An AudioParam that just remembers the last value scheduled onto it. */
  const param = (v) => ({
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { this.value = x; return this; },
    cancelScheduledValues() { return this; },
    cancelAndHoldAtTime() { return this; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });

  function fakeAudioContext() {
    return {
      state: 'suspended',
      currentTime: 0,
      // Only decides how long the noise buffers are. Keep it small: the real
      // 44.1kHz would generate half a million samples we are never going to hear.
      sampleRate: 8000,
      destination: node(),
      onstatechange: null,
      createGain: () => node({ gain: param(1) }),
      createDynamicsCompressor: () =>
        node({
          threshold: param(0), knee: param(0), ratio: param(1),
          attack: param(0), release: param(0),
        }),
      createBuffer: (_ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBufferSource: () =>
        node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {}, onended: null }),
      resume() {
        this.state = 'running';
        this.onstatechange?.();
        return Promise.resolve();
      },
    };
  }

  const { AudioEngine, AUDIO_CONFIG } = await import('../src/audio/audio.js');
  const bv = AUDIO_CONFIG.MASTER.busVolumes;
  globalThis.AudioContext = fakeAudioContext;

  {
    const engine = new AudioEngine();
    engine.init();
    ok('the graph builds before any gesture', engine.ready && !engine._live);

    // This is Game#init: settings.load() → applyAll() → setBusVolume, all of it
    // while the context is still asleep.
    engine.setMasterVolume(0.35);
    engine.setBusVolume('music', 0.2);
    engine.setBusVolume('engine', 0.4);
    ok('a suspended bus cannot take the value yet', engine._bus.music.gain.value === bv.music);
    ok('…but the engine remembered the scale', engine.getBusVolume('music') === 0.2);

    await engine.unlock();
    ok('the first gesture starts the context', engine._live);
    ok(
      'the saved bus scale is on the real node',
      near(engine._bus.music.gain.value, bv.music * 0.2),
      `${engine._bus.music.gain.value.toFixed(4)} = ${bv.music} × 0.2`
    );
    ok('…for every bus that was set', near(engine._bus.engine.gain.value, bv.engine * 0.4));
    ok('…and buses nobody touched keep the AUDIO_CONFIG balance', engine._bus.sfx.gain.value === bv.sfx);
    ok('master survives the suspension too', near(engine._master.gain.value, 0.35));
    engine.dispose();
  }

  {
    // Tab-hide suspends the context and drops the graph's automation. Coming
    // back must not come back at the defaults.
    const engine = new AudioEngine();
    engine.init();
    await engine.unlock();
    engine.setBusVolume('siren', 0.1);
    engine._ctx.state = 'suspended';
    engine._bus.siren.gain.value = bv.siren; // what a rebuilt/reset node looks like
    engine._ctx.state = 'running';
    engine._ctx.onstatechange();
    ok('a resumed tab gets the mix back', near(engine._bus.siren.gain.value, bv.siren * 0.1));
    engine.dispose();
  }

  delete globalThis.AudioContext;
}

// The other half of the round trip: the value has to survive the page as well
// as the suspension. A second module instance is what a reload actually is.
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const { events } = await import('../src/core/events.js');
  const { settings } = await import('../src/config/settings.js?instance=write');

  let fired = 0;
  const off = events.on('settings:changed', () => fired++);
  settings.set('musicVolume', 0.3);
  ok('changing a setting broadcasts it', fired === 1);
  settings.set('musicVolume', 0.3);
  ok('…and setting the same value again is correctly a no-op', fired === 1);
  settings.set('musicVolume', 0.35);
  ok('…while a real change still gets through', fired === 2, `${settings.get('musicVolume')}`);
  off();

  ok('it reached localStorage', store.size === 1);
  const readModule = await import('../src/config/settings.js?instance=read');
  const reloaded = readModule.settings;
  // Against DEFAULTS, not a literal. This asserted `=== 1` and so broke the
  // moment the mix was retuned — which is a change to the game's balance, not
  // to whether a fresh page reads its defaults.
  ok('a fresh page starts at the default',
    reloaded.get('musicVolume') === readModule.DEFAULTS.musicVolume,
    `${reloaded.get('musicVolume')}`);
  reloaded.load();
  ok('…and load() brings the saved value back', reloaded.get('musicVolume') === 0.35);

  let applied = null;
  const off2 = events.on('settings:changed', ({ id, value }) => {
    if (id === 'musicVolume') applied = value;
  });
  reloaded.applyAll();
  ok('…and applyAll() hands it to Game#_applySetting', applied === 0.35);
  off2();

  delete globalThis.localStorage;
}

// ---------------------------------------------------------------------------
section('9. ground cover — grass that is actually there');

// Grass is a pool that follows the camera, not scatter (see world/groundCover.js).
// None of it can be seen from a screenshot in this environment, so everything
// the eye would have caught is asserted numerically instead: that the blades
// are ON the ground rather than floating over it, standing on the slope rather
// than through it, and absent from the road, the cliffs and the steep ground.
{
  const { OPEN_WORLD } = await import('../src/config/gameplay.js');
  const { GroundCover } = await import('../src/world/groundCover.js');
  const GC = OPEN_WORLD.groundCover;
  const cover = world.groundCover;
  const terrain = world.terrain;

  ok('the world grows ground cover', !!cover);
  ok(
    'the pool is the configured size',
    cover.count === GC.bands.reduce((n, b) => n + b.count, 0),
    `${cover.count} tufts`
  );
  ok('grass is no longer scattered', !world.scatter.root.getObjectByName('scatter:grass:0'));

  /** Every visible tuft, decomposed out of the instance matrices. */
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3();
  const _n9 = new THREE.Vector3();
  //
  // NOTE the scale is measured off the raw basis column rather than taken from
  // `decompose`. A hidden instance is a zero matrix, and this three returns
  // scale (1,1,1) with an identity rotation for anything whose determinant is
  // zero — so decompose reports every hidden tuft as a full-size one sitting at
  // the origin, and every assertion below quietly becomes a lie.
  function visible(cvr) {
    const out = [];
    for (const g of cvr._groups) {
      for (let i = 0; i < g.items.length; i++) {
        g.mesh.getMatrixAt(i, m);
        const e = m.elements;
        if (Math.hypot(e[0], e[1], e[2]) < 1e-4) continue;
        m.decompose(p, q, s);
        out.push({
          x: p.x,
          y: p.y,
          z: p.z,
          scale: s.x,
          up: up.set(0, 1, 0).applyQuaternion(q).clone(),
          radius: g.band.radius,
          size: g.items[i].size,
        });
      }
    }
    return out;
  }

  // Somewhere out in the forest, well clear of the tracks.
  const spot = new THREE.Vector3(430, 0, -260);
  spot.y = terrain.heightAt(spot.x, spot.z);
  cover.update(1 / 60, spot);
  let live = visible(cover);
  ok('grass appears around the camera', live.length > 400, `${live.length} tufts visible`);

  // ROOTED. A blade whose origin is not on the terrain is a floating card, and
  // that is exactly what this replaced.
  let worstDrop = 0;
  let worstTilt = 0;
  for (const t of live) {
    worstDrop = Math.max(worstDrop, Math.abs(t.y + GC.sink - terrain.heightAt(t.x, t.z)));
    terrain.normalAt(t.x, t.z, _n9);
    worstTilt = Math.max(worstTilt, Math.abs(1 - t.up.dot(_n9)));
  }
  // A millimetre, not zero: instance matrices live in a Float32Array, so the
  // position read back is the one the GPU will use rather than the one we
  // composed. Anything a floating card would show up as is orders of
  // magnitude above this.
  ok('every tuft is rooted in the terrain', worstDrop < 1e-3, `worst gap ${worstDrop.toExponential(1)}m`);
  ok(
    'every tuft stands on the terrain normal',
    worstTilt < 1e-6,
    `worst deviation ${worstTilt.toExponential(1)}`
  );

  // The placement rules, all of which are invisible until they are wrong.
  let onCliff = 0;
  let tooSteep = 0;
  let outsideBand = 0;
  let unfaded = 0;
  for (const t of live) {
    const surface = terrain.surfaceAt(t.x, t.z);
    if (!GC.surfaces.includes(surface)) onCliff++;
    if (terrain.slopeAt(t.x, t.z) > GC.maxSlope) tooSteep++;
    const d = Math.hypot(t.x - spot.x, t.z - spot.z);
    if (d > t.radius) outsideBand++;
    // Nothing pops in: a tuft arriving at the rim must still be almost nothing.
    if (d > t.radius * 0.97 && t.scale > t.size * 0.15) unfaded++;
  }
  ok('no grass on cliffs or mud', onCliff === 0, `${onCliff} bad surfaces`);
  ok('no grass on slopes it could not root in', tooSteep === 0, `${tooSteep} over ${GC.maxSlope}`);
  ok('every tuft is inside its own band', outsideBand === 0, `${outsideBand} strays`);
  ok('nothing arrives at full size', unfaded === 0, `${unfaded} would pop in`);

  // ON THE ROAD IS THE ONE PLACE IT MUST NOT BE. Park on the start line of
  // parkur 1 — the tightest case, because the camera is then surrounded by it.
  const t1 = world.mainTrack;
  const onTrack = new THREE.Vector3(t1.px[0], 0, t1.pz[0]);
  onTrack.y = terrain.heightAt(onTrack.x, onTrack.z);
  cover.update(1 / 60, onTrack);
  live = visible(cover);
  let onRoad = 0;
  let nearest = Infinity;
  const scratch = {};
  for (const t of live) {
    for (const tr of world._trackList) {
      const query = tr.query(t.x, t.z, scratch);
      if (!query) continue;
      const edge = query.dist - query.halfWidth;
      nearest = Math.min(nearest, edge);
      if (edge < GC.trackClearance) onRoad++;
    }
  }
  ok('grass never grows on the racing surface', onRoad === 0, `${onRoad} tufts on tarmac`);
  ok(
    'the verge is bare for the configured clearance',
    nearest >= GC.trackClearance,
    `nearest blade ${nearest.toFixed(2)}m past the edge, clearance ${GC.trackClearance}m`
  );
  ok('there is still grass beside the track', live.length > 200, `${live.length} tufts`);

  // Drive, do not teleport: the pool must follow without changing size and
  // without allocating. This is the whole reason it is a pool.
  const before = cover.count;
  const walk = onTrack.clone();
  for (let i = 0; i < 120; i++) {
    walk.x += 0.9;
    walk.z += 0.4;
    walk.y = terrain.heightAt(walk.x, walk.z);
    cover.update(1 / 60, walk);
  }
  live = visible(cover);
  let strays = 0;
  for (const t of live) if (Math.hypot(t.x - walk.x, t.z - walk.z) > t.radius) strays++;
  ok('driving recycles rather than reallocates', cover.count === before, `${cover.count} tufts`);
  ok('the pool stays centred on the camera', strays === 0, `${strays} left behind`);

  // Determinism. Same seed and same camera path, twice, matrix for matrix.
  {
    const mk = () =>
      new GroundCover({
        terrain,
        materials,
        theme,
        seed: 0x7e4e17 ^ 0x6c0f,
        avoid: world._trackAvoidance(GC.trackClearance),
      }).build();
    const a = mk();
    const b = mk();
    const path = [spot, new THREE.Vector3(spot.x + 30, 0, spot.z + 12), onTrack];
    for (const point of path) {
      a.update(1 / 60, point);
      b.update(1 / 60, point);
    }
    const A = visible(a);
    const B = visible(b);
    let same = A.length === B.length && A.length > 0;
    for (let i = 0; same && i < A.length; i++) {
      same = A[i].x === B[i].x && A[i].y === B[i].y && A[i].scale === B[i].scale;
    }
    ok('same seed, same grass', same, `${A.length} tufts compared`);
    a.dispose();
    b.dispose();
  }
}

// ---------------------------------------------------------------------------
section('10. the wind is in the shader, and only in the grass');

// Vertex wind is `onBeforeCompile` surgery (src/render/wind.js) and there is no
// GL context here to compile it. What CAN be checked is the two ways this fails
// silently: the injection missing its anchor, and the material sharing a
// compiled program with something that must not wave.
{
  const { MaterialLibrary } = await import('../src/render/materials.js');
  const lib = new MaterialLibrary(theme, preset);
  const grass = lib.get('grass');
  const foliage = lib.get('foliage');

  // Stand-in for three's shader object, carrying the anchors both passes need.
  const fake = () => ({
    uniforms: {},
    vertexShader: 'void main() {\n#include <begin_vertex>\n#include <fog_vertex>\n}',
    fragmentShader: 'void main() {\n#include <map_fragment>\n}',
  });

  const shader = fake();
  grass.onBeforeCompile(shader, null);
  ok('the wind reaches the vertex shader', /transformed\.xz \+= uWindDir/.test(shader.vertexShader));
  ok('…anchored to begin_vertex, before projection', shader.vertexShader.indexOf('uWindDir *') < shader.vertexShader.indexOf('#include <fog_vertex>'));
  ok('…and it still runs the PSX snap', /uSnapResolution/.test(shader.vertexShader));
  for (const u of ['uWindTime', 'uWindStrength', 'uWindScale', 'uWindDir']) {
    ok(`uniform ${u} is bound`, !!shader.uniforms[u]);
  }
  // The roots. `transformed.y` squared is what welds the base of a blade to the
  // ground; drop it and the whole tuft slides sideways in the wind.
  ok('the bend is zero at the root', /windBend \* windBend/.test(shader.vertexShader));

  // Two MeshLambertMaterials with the same parameters share a compiled program.
  // If the grass reported the plain PSX cache key, three would hand the terrain
  // the wind shader and the ground itself would start waving.
  ok(
    'the grass does not share a program with the still world',
    grass.customProgramCacheKey() !== foliage.customProgramCacheKey(),
    `${grass.customProgramCacheKey()} vs ${foliage.customProgramCacheKey()}`
  );

  const plain = fake();
  foliage.onBeforeCompile(plain, null);
  ok('nothing else got the wind', !/uWindDir/.test(plain.vertexShader));

  // The phase is a number the world drives; a stuck one is grass frozen mid-gust.
  lib.setWindTime(4.25);
  ok('the world can advance the wind', lib._wind.uWindTime.value === 4.25);
  lib.configureWind({ strength: 0.3, scale: 0.06, direction: { x: 3, z: 4 } });
  ok(
    'the wind direction is normalised',
    Math.abs(lib._wind.uWindDir.value.length() - 1) < 1e-6,
    `(${lib._wind.uWindDir.value.x.toFixed(2)}, ${lib._wind.uWindDir.value.y.toFixed(2)})`
  );
  lib.dispose();
}

// ---------------------------------------------------------------------------
section('11. the ground looks like ground');

// Terrain colour is baked into the mesh's vertex colours, which is the one
// thing about the look that a headless run can read directly. So read it: pull
// every vertex out of the built chunks and check the three claims the palette
// makes — turf wears off as the land tips over, everything low goes dark and
// damp, and there is grit in all of it.
{
  const { GROUND_PAINT } = await import('../src/config/style.js');
  const { TERRAIN_SHAPE } = await import('../src/world/terrain.js');
  const terrain = world.terrain;

  for (const name of Object.keys(THEMES)) {
    const g = resolveTheme(name).ground;
    ok(
      `theme "${name}" has earth to paint with`,
      [g.dirt, g.mud, g.grit].every((c) => typeof c === 'number'),
      `dirt ${g.dirt?.toString(16)} mud ${g.mud?.toString(16)} grit ${g.grit?.toString(16)}`
    );
  }

  /** Greenness: how much a colour leans green against its own red and blue. */
  const green = (r, gg, b) => gg - (r + b) / 2;
  const luma = (r, gg, b) => 0.299 * r + 0.587 * gg + 0.114 * b;

  const all = [];
  for (const chunk of terrain.chunks) {
    const pos = chunk.geometry.getAttribute('position');
    const col = chunk.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i += 11) {
      const x = pos.getX(i);
      const h = pos.getY(i);
      const z = pos.getZ(i);
      all.push({
        slope: terrain.slopeAt(x, z),
        h,
        green: green(col.getX(i), col.getY(i), col.getZ(i)),
        luma: luma(col.getX(i), col.getY(i), col.getZ(i)),
      });
    }
  }
  const mean = (rows, key) => rows.reduce((s, r) => s + r[key], 0) / Math.max(1, rows.length);

  // Percentiles, not thresholds. This valley is far gentler than `cliffSlope`
  // assumes — median slope 0.004, steepest vertex 0.43 — so "steep" has to mean
  // "steep for this world" or the bucket comes back empty and the assertion
  // passes without ever having looked at anything.
  const bySlope = [...all].sort((a, b) => a.slope - b.slope);
  const flat = bySlope.slice(0, Math.floor(bySlope.length * 0.5));
  const steep = bySlope.slice(Math.floor(bySlope.length * 0.98));
  ok('there is flat ground and steep ground to compare', flat.length > 200 && steep.length > 40,
    `${flat.length} flat (to slope ${flat.at(-1).slope.toFixed(3)}), ${steep.length} steep (from ${steep[0].slope.toFixed(3)})`);
  ok(
    'turf wears off as the land tips over',
    mean(steep, 'green') < mean(flat, 'green') * 0.6,
    `greenness ${mean(flat, 'green').toFixed(4)} flat vs ${mean(steep, 'green').toFixed(4)} steep`
  );

  const low = all.filter((r) => r.h < TERRAIN_SHAPE.waterLevel - GROUND_PAINT.dampBelow);
  const high = all.filter((r) => r.h > TERRAIN_SHAPE.waterLevel + GROUND_PAINT.dampAbove + 30);
  ok('there is low ground and high ground to compare', low.length > 20 && high.length > 200,
    `${low.length} low, ${high.length} high`);
  ok(
    'the low ground is dark and damp',
    mean(low, 'luma') < mean(high, 'luma') * 0.75,
    `luma ${mean(high, 'luma').toFixed(4)} high vs ${mean(low, 'luma').toFixed(4)} low`
  );

  // Variation. A palette that has stopped mottling still passes every average
  // above, because the average is all it produces.
  const mu = mean(all, 'luma');
  const sd = Math.sqrt(all.reduce((s, r) => s + (r.luma - mu) ** 2, 0) / all.length);
  ok('the ground is not one flat colour', sd / mu > 0.12, `luma spread ${(100 * sd / mu).toFixed(1)}%`);

  // COLOURS COME FROM THE THEME, NOT FROM THIS FILE. Paint a slope that is
  // steep enough and high enough to be nothing but bare earth, twice, with the
  // theme's dirt colour swapped underneath. A hard-coded brown would not move.
  {
    const { Terrain } = await import('../src/world/terrain.js');
    const mk = (dirtHex) => {
      const t = JSON.parse(JSON.stringify(resolveTheme('forest')));
      t.ground.dirt = dirtHex;
      const terr = new Terrain({ resolution: 8, cellSize: 13, seed: 7 }).generate();
      // A uniform 40-degree ramp, well above the water line.
      for (let j = 0; j < terr.gridSize; j++) {
        for (let i = 0; i < terr.gridSize; i++) terr.heights[j * terr.gridSize + i] = 40 + i * 11;
      }
      terr._classifySurfaces();
      terr.buildMesh(materials, t, 8);
      const col = terr.chunks[0].geometry.getAttribute('color');
      return [col.getX(12), col.getY(12), col.getZ(12)];
    };
    const brown = mk(0x6b5537);
    const magenta = mk(0xff00ff);
    ok(
      "the earth is the theme's earth",
      Math.abs(brown[0] - magenta[0]) > 0.05 && Math.abs(brown[2] - magenta[2]) > 0.05,
      `${brown.map((v) => v.toFixed(3)).join(',')} vs ${magenta.map((v) => v.toFixed(3)).join(',')}`
    );
  }
}

// ---------------------------------------------------------------------------
section('12. somebody was here first');

// Worn trails are vertex-colour darkening on the terrain that already exists —
// no mesh, no decal, no texture (world/trails.js). Which means the evidence
// that they worked is in the same colour buffer as everything else, and a
// headless run can check all of it: where the routes go, how much of the world
// they touch, and whether the ground under them actually changed.
{
  const { OPEN_WORLD } = await import('../src/config/gameplay.js');
  const { Trails } = await import('../src/world/trails.js');
  const { pointSegmentXZ } = await import('../src/core/mathx.js');
  /** This map's landmarks — the defaults, turned by the level's own seed. */
  const { TERRAIN_SHAPE } = await import('../src/world/terrain.js');
  const { GROUND_PAINT: GP } = await import('../src/config/style.js');
  const T = OPEN_WORLD.trails;
  const LM = world.spec.landmarks;
  const trails = world.trails;
  const terrain = world.terrain;

  ok('the world has worn routes in it', !!trails && trails.routes.length > 0,
    `${trails?.routes.length} routes, ${trails?.segments.length} segments`);
  ok(
    'one route per landmark, plus the links, plus the spurs',
    trails.routes.length <= LM.length + T.links.length + T.spurs.count &&
      trails.routes.length >= LM.length + T.links.length,
    `${trails.routes.length} of at most ${LM.length + T.links.length + T.spurs.count}`
  );
  ok('a trail is not geometry', !world.root.getObjectByName('trails') && typeof terrain.painter === 'function');

  /** Distance from a point to the nearest parkour centreline sample. */
  const toTrack = (p) => {
    let best = Infinity;
    for (const tk of world._trackList) {
      for (let k = 0; k < tk.count; k++) {
        best = Math.min(best, Math.hypot(tk.px[k] - p.x, tk.pz[k] - p.z));
      }
    }
    return best;
  };

  // The first six routes are the landmark ones, in the level's landmark order.
  const span = terrain.halfSpan;
  let atLandmark = 0;
  let atTrack = 0;
  for (let i = 0; i < LM.length; i++) {
    const d = LM[i];
    const route = trails.routes[i];
    const want = { x: Math.cos(d.angle) * span * d.dist, z: Math.sin(d.angle) * span * d.dist };
    if (Math.hypot(route[0].x - want.x, route[0].z - want.z) < 0.001) atLandmark++;
    if (toTrack(route.at(-1)) < 0.001) atTrack++;
  }
  ok('every landmark route starts at its landmark', atLandmark === LM.length,
    `${atLandmark}/${LM.length}`);
  ok('…and ends on a parkour', atTrack === LM.length, `${atTrack}/${LM.length}`);

  // A route that goes from A to B in a straight line is a survey line, not a
  // path somebody wore. Every one of them has to leave the straight line.
  let straightest = Infinity;
  for (const route of trails.routes) {
    const a = route[0];
    const b = route.at(-1);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let off = 0;
    for (const p of route) off = Math.max(off, pointLineDistance(p, a, b));
    straightest = Math.min(straightest, off / Math.max(1, len));
  }
  ok('no route is a ruler line', straightest > 0.02, `least wander ${(100 * straightest).toFixed(1)}% of its length`);

  // The spurs. These leave a parkour and end in the trees; a spur that comes
  // back to the road is a lay-by, which is a different and much tidier story.
  const spurs = trails.routes.slice(LM.length + T.links.length);
  let leaveRoad = 0;
  for (const s of spurs) if (toTrack(s[0]) < 0.001 && toTrack(s.at(-1)) > 80) leaveRoad++;
  ok('the spurs leave the road and stop in the trees', spurs.length > 0 && leaveRoad === spurs.length,
    `${leaveRoad}/${spurs.length}`);

  // SUBTLETY IS THE BRIEF. Atmosphere, not a road network.
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  const green = (r, g, b) => g - (r + b) / 2;
  let vertices = 0;
  let touched = 0;
  const wornRows = [];
  const cleanRows = [];
  for (const chunk of terrain.chunks) {
    const pos = chunk.geometry.getAttribute('position');
    const col = chunk.geometry.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const h = pos.getY(i);
      const z = pos.getZ(i);
      vertices++;
      const s = trails.strengthAt(x, z);
      if (s > 0.5) touched++;
      // Compare on dry ground only — above where the damp layer stops. It
      // darkens the low places on its own, and the trails do not run uniformly
      // across the height range, so mixing the two measures the wrong thing.
      if (h < TERRAIN_SHAPE.waterLevel + GP.dampAbove) continue;
      const rec = {
        luma: luma(col.getX(i), col.getY(i), col.getZ(i)),
        green: green(col.getX(i), col.getY(i), col.getZ(i)),
      };
      if (s > 0.6) wornRows.push(rec);
      else if (s === 0) cleanRows.push(rec);
    }
  }
  const share = (100 * touched) / vertices;
  ok('the world is not paved', share < 4, `${share.toFixed(2)}% of the ground is worn`);
  ok('…but it is marked', share > 0.2 && wornRows.length > 30,
    `${touched} worn vertices, ${wornRows.length} of them on dry ground`);

  const mean = (rows, key) => rows.reduce((s, r) => s + r[key], 0) / Math.max(1, rows.length);
  ok(
    'a worn route is darker than the ground beside it',
    mean(wornRows, 'luma') < mean(cleanRows, 'luma') * 0.9,
    `luma ${mean(cleanRows, 'luma').toFixed(4)} clean vs ${mean(wornRows, 'luma').toFixed(4)} worn`
  );
  ok(
    '…and browner',
    mean(wornRows, 'green') < mean(cleanRows, 'green') * 0.5,
    `greenness ${mean(cleanRows, 'green').toFixed(4)} clean vs ${mean(wornRows, 'green').toFixed(4)} worn`
  );

  // Grass does not grow on a path. The ground cover shares the trail field.
  {
    let onPath = 0;
    const probe = new THREE.Vector3();
    const mid = trails.routes[0][Math.floor(trails.routes[0].length / 2)];
    probe.set(mid.x, terrain.heightAt(mid.x, mid.z), mid.z);
    world.groundCover.update(1 / 60, probe);
    const mm = new THREE.Matrix4();
    for (const g of world.groundCover._groups) {
      for (let i = 0; i < g.items.length; i++) {
        g.mesh.getMatrixAt(i, mm);
        const e = mm.elements;
        if (Math.hypot(e[0], e[1], e[2]) < 1e-4) continue;
        if (trails.strengthAt(e[12], e[14]) > T.clearAbove) onPath++;
      }
    }
    ok('grass does not grow on a worn path', onPath === 0, `${onPath} tufts on the trail`);
  }

  // ---------------------------------------------------------------------
  // …AND THE PATH DRIVES LIKE ONE.
  //
  // The whole point of the network. It was colour for as long as it existed;
  // a trail that reports the same surface as the grass beside it is a texture,
  // and the player has no reason to believe it goes anywhere. These checks are
  // the ones that keep it a mechanic.
  {
    const { SURFACES } = await import('../src/config/tuning.js');
    const trail = SURFACES.TRAIL;

    ok('there is a TRAIL surface', !!trail && trail.id === 'TRAIL');
    ok(
      '…and it sits between the forest floor and the road',
      trail.grip > SURFACES.DIRT.grip && trail.grip < SURFACES.TARMAC.grip,
      `grass ${SURFACES.GRASS.grip} < dirt ${SURFACES.DIRT.grip} < trail ${trail.grip} < tarmac ${SURFACES.TARMAC.grip}`
    );
    ok(
      '…by enough to feel: a trail out-grips grass by a third',
      trail.grip / SURFACES.GRASS.grip > 1.3,
      `${(trail.grip / SURFACES.GRASS.grip).toFixed(2)}x the grip of grass`
    );
    ok(
      'the drivable band sits inside the cleared band',
      T.driveAbove >= T.clearAbove,
      `cleared above ${T.clearAbove}, drivable above ${T.driveAbove}`
    );

    // Drive the field, not the config: walk every route and ask the WORLD what
    // the ground is, which is the same question the car asks.
    let onTrail = 0;
    let samples = 0;
    const strays = {};
    for (const route of trails.routes) {
      for (let i = 1; i < route.length - 1; i++) {
        const p = route[i];
        // Skip anywhere a parkour has its own opinion; a road overrides a
        // trail on purpose and is checked separately below.
        if (toTrack(p) < 60) continue;
        samples++;
        const g = world.sampleGround(p.x, p.z);
        if (g.surface === 'TRAIL') onTrail++;
        else if (trails.strengthAt(p.x, p.z) > T.driveAbove) {
          strays[g.surface] = (strays[g.surface] || 0) + 1;
        }
      }
    }
    ok(
      'the middle of a worn route drives as TRAIL',
      samples > 40 && onTrail / samples > 0.5,
      `${onTrail}/${samples} route centres report TRAIL`
    );
    // The one exception, and it is deliberate: a worn line across a bog is
    // still a bog. MUD near the water is a hazard the player can see, and a
    // trail is not allowed to quietly cancel one. Anything ELSE turning up
    // here means the override in `sampleGround` has grown a hole.
    const strayKinds = Object.keys(strays).filter((k) => k !== 'MUD');
    ok(
      '…and the only worn ground that is not a path is the wet kind',
      strayKinds.length === 0,
      Object.entries(strays).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'
    );

    // Off the path, the forest is still the forest. Sampled 60m to the side of
    // every route centre — far outside `edgeWidth`.
    //
    // "Off the path" means off EVERY path. Routes cross each other, and they
    // do it far more now that all of a map's trails converge on the one
    // parkour standing in the middle of it — six landmark routes and eleven
    // spurs all arriving at the same ribbon. A sample 60m to the side of one
    // route that lands on another is two paths meeting, which is what happens
    // where people walk; the thing this check exists to catch is a *band* that
    // has spread wider than it should, so a sample that is near any other
    // route's centreline is not evidence either way and is skipped.
    const nearAnyRoute = (x, z, except) => {
      for (const r of trails.routes) {
        if (r === except) continue;
        for (let k = 0; k < r.length - 1; k++) {
          if (pointSegmentXZ(x, z, r[k].x, r[k].z, r[k + 1].x, r[k + 1].z).dist < T.edgeWidth * 1.5) return true;
        }
      }
      return false;
    };
    let beside = 0;
    let besideTrail = 0;
    for (const route of trails.routes) {
      for (let i = 1; i < route.length - 1; i++) {
        const a = route[i - 1];
        const b = route[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        for (const side of [1, -1]) {
          const x = route[i].x + ((-(b.z - a.z) / len) * 60 * side);
          const z = route[i].z + (((b.x - a.x) / len) * 60 * side);
          if (!terrain.contains(x, z) || toTrack({ x, z }) < 60) continue;
          if (nearAnyRoute(x, z, route)) continue;
          beside++;
          if (world.sampleGround(x, z).surface === 'TRAIL') besideTrail++;
        }
      }
    }
    ok('the forest either side of it is not a path', beside > 40 && besideTrail === 0,
      `${besideTrail}/${beside} samples 60m off-route report TRAIL`);

    // A parkour still wins where the two meet — a spur arriving at the road
    // becomes road, rather than staying a path drawn across it.
    {
      const spur = trails.routes.at(-1);
      const g = world.sampleGround(spur[0].x, spur[0].z);
      ok('a road still beats a trail where they cross', g.surface !== 'TRAIL', `spur start reports ${g.surface}`);
    }

    // Nothing stands in the corridor. This is the difference between a trail
    // that leads somewhere and a trail with a pine tree in it.
    {
      let blocking = 0;
      for (const c of world.scatter.colliders) {
        if (trails.strengthAt(c.x, c.z) > T.driveAbove) blocking++;
      }
      ok('nothing is standing in the drivable corridor', blocking === 0,
        `${blocking} colliders on a drivable trail`);
    }

    // The tyres have to have something to say about it too, or the strongest
    // cue in the game is one the player only feels through the steering.
    {
      const { AUDIO_CONFIG } = await import('../src/audio/audio.js');
      const tone = AUDIO_CONFIG.SURFACES.TRAIL;
      ok('a trail sounds like a trail', !!tone && tone.hz !== AUDIO_CONFIG.SURFACES.GRASS.hz,
        tone ? `${tone.hz}Hz vs grass ${AUDIO_CONFIG.SURFACES.GRASS.hz}Hz` : 'missing');
    }

    // And it must not cost anything: `sampleGround` runs several times per car
    // per 120Hz step, and this added a spatial query to it.
    {
      const span = terrain.halfSpan * 0.8;
      const t0 = performance.now();
      const N = 20000;
      for (let i = 0; i < N; i++) {
        const a = (i * 2.399963) % (Math.PI * 2);
        const r = ((i * 37) % 1000) / 1000 * span;
        world.sampleGround(Math.cos(a) * r, Math.sin(a) * r);
      }
      const per = ((performance.now() - t0) * 1000) / N;
      ok('asking the ground what it is stayed cheap', per < 12, `${per.toFixed(2)}µs per sampleGround`);
    }
  }

  // Deterministic from the seed, like everything else that generates the world.
  {
    const marks = LM.map((d) => ({
      x: Math.cos(d.angle) * span * d.dist,
      z: Math.sin(d.angle) * span * d.dist,
    }));
    const mk = (seed) => new Trails({ halfSpan: span, landmarks: marks, tracks: world._trackList, seed });
    const a = mk(0x7e4e17);
    const b = mk(0x7e4e17);
    const c = mk(0x51ee11);
    const same = JSON.stringify(a.routes) === JSON.stringify(b.routes);
    const different = JSON.stringify(a.routes) !== JSON.stringify(c.routes);
    ok('same seed, same trails', same, `${a.routes.length} routes compared`);
    ok('…and a different seed wears the ground somewhere else', different);
  }
}

// ---------------------------------------------------------------------------
section('13. there is something growing under the trees');

// Ferns, undergrowth and leaf litter go through the same `Scatter` as the
// forest, so what is worth checking is the part that is NOT shared: that they
// land in the tree stands rather than evenly across the map, that none of them
// is solid, and that the litter is not floating.
{
  const { OPEN_WORLD } = await import('../src/config/gameplay.js');
  const { SCATTER_RULES } = await import('../src/world/scatter.js');
  const { buildVariants } = await import('../src/world/props.js');
  const D = OPEN_WORLD.scatterDensity;
  const terrain = world.terrain;

  /** Every placed instance of a scatter kind, as world positions. */
  const positionsOf = (kind) => {
    const out = [];
    const m = new THREE.Matrix4();
    for (const mesh of world.scatter._meshes) {
      if (!mesh.name.startsWith(`scatter:${kind}:`)) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        out.push({ x: m.elements[12], y: m.elements[13], z: m.elements[14] });
      }
    }
    return out;
  };

  const ferns = positionsOf('fern');
  const under = positionsOf('undergrowth');
  const litter = positionsOf('litter');
  const pines = positionsOf('pine');

  ok('ferns were planted', ferns.length > D.ferns * 0.4, `${ferns.length} of ${D.ferns} attempted`);
  ok('undergrowth was planted', under.length > D.undergrowth * 0.4, `${under.length} of ${D.undergrowth}`);
  ok('leaf litter was scattered', litter.length > D.litter * 0.4, `${litter.length} of ${D.litter}`);

  // CLUSTERED AROUND THE TREE STANDS. The mechanism is that the understorey
  // samples the pines' own clumping noise at the pines' own frequency, so they
  // clump in the same places — nothing looks up where a tree is. Measure it:
  // an understorey plant should be markedly nearer a pine than a fair coin
  // toss on the same ground would put it.
  const nearestPine = (p) => {
    let best = Infinity;
    for (let i = 0; i < pines.length; i++) {
      const d = (pines[i].x - p.x) ** 2 + (pines[i].z - p.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const sample = (arr, n) => {
    const out = [];
    const stride = Math.max(1, Math.floor(arr.length / n));
    for (let i = 0; i < arr.length && out.length < n; i += stride) out.push(arr[i]);
    return out;
  };

  // The control: points spread over the same disc the ferns were offered.
  const control = [];
  for (let i = 0; control.length < 250 && i < 4000; i++) {
    const a = i * 2.399963229728653;
    const r = terrain.halfSpan * 0.95 * Math.sqrt((i % 997) / 997);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (terrain.contains(x, z)) control.push({ x, z });
  }
  const fernNear = median(sample(ferns, 250).map(nearestPine));
  const anyNear = median(control.map(nearestPine));
  ok(
    'the understorey grows where the trees are',
    fernNear < anyNear * 0.7,
    `median fern-to-pine ${fernNear.toFixed(1)}m vs ${anyNear.toFixed(1)}m for open ground`
  );
  ok(
    '…and so does the litter',
    median(sample(litter, 250).map(nearestPine)) < anyNear * 0.7,
    `${median(sample(litter, 250).map(nearestPine)).toFixed(1)}m`
  );

  // The hard version of the same claim: NOTHING is out on its own. Measured
  // against every trunk the predicate was built from, not just the pines.
  {
    const trunks = world.scatter.colliders.filter(
      (c) => c.kind === 'pine' || c.kind === 'broadleaf'
    );
    const nearestTrunk = (p) => {
      let best = Infinity;
      for (let i = 0; i < trunks.length; i++) {
        const d = (trunks[i].x - p.x) ** 2 + (trunks[i].z - p.z) ** 2;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    };
    let stray = 0;
    let worst = 0;
    for (const p of [...sample(ferns, 200), ...sample(under, 200), ...sample(litter, 200)]) {
      const d = nearestTrunk(p);
      worst = Math.max(worst, d);
      if (d > OPEN_WORLD.understoreyRadius + 0.001) stray++;
    }
    ok(
      'no understorey plant grows out in the open',
      stray === 0,
      `furthest from a trunk ${worst.toFixed(2)}m, limit ${OPEN_WORLD.understoreyRadius}m`
    );
  }

  // You drive through undergrowth. None of it may be solid, and none of it may
  // end up in the collision grid or in the fellable set.
  const solid = world.scatter.colliders.filter((c) =>
    ['fern', 'undergrowth', 'litter'].includes(c.kind)
  );
  ok('you can drive straight through all of it', solid.length === 0, `${solid.length} colliders`);

  // Off the racing surface, same rule as the forest.
  let onRoad = 0;
  const scratch = {};
  for (const p of [...sample(ferns, 200), ...sample(litter, 200), ...sample(under, 200)]) {
    for (const tk of world._trackList) {
      const q = tk.query(p.x, p.z, scratch);
      if (q && q.dist < q.halfWidth) onRoad++;
    }
  }
  ok('none of it grows on the road', onRoad === 0, `${onRoad} on tarmac`);

  // LITTER MUST NOT FLOAT, AND MUST NOT SINK. `Scatter` drops every prop 8cm
  // and never tilts it to the ground, so the geometry has to start above that
  // by itself — and by little enough that it still reads as lying down.
  {
    const variants = buildVariants('litter', theme, 1234, SCATTER_RULES.litter.variants);
    let lowest = Infinity;
    let highest = -Infinity;
    for (const v of variants) {
      v.geometry.computeBoundingBox();
      lowest = Math.min(lowest, v.geometry.boundingBox.min.y);
      highest = Math.max(highest, v.geometry.boundingBox.max.y);
    }
    const sink = 0.08;
    ok(
      'leaf litter clears the prop sink',
      lowest * SCATTER_RULES.litter.scale[0] > sink,
      `lowest piece ${(lowest * SCATTER_RULES.litter.scale[0]).toFixed(3)}m vs ${sink}m sink`
    );
    ok(
      '…and is still lying on the floor',
      highest * SCATTER_RULES.litter.scale[1] - sink < 0.35,
      `highest piece ${(highest * SCATTER_RULES.litter.scale[1] - sink).toFixed(3)}m above ground`
    );
  }

  // Colours come from the theme. Every theme has to have somewhere to get them.
  for (const name of Object.keys(THEMES)) {
    const f = resolveTheme(name).foliage;
    ok(`theme "${name}" has an understorey palette`,
      typeof f.fern === 'number' && typeof f.litter === 'number',
      `fern ${f.fern?.toString(16)} litter ${f.litter?.toString(16)}`);
  }
  // …and the night one has to be its OWN, not forest's inherited daylight green.
  const dayFern = resolveTheme('forest').foliage.fern;
  const nightFern = resolveTheme('night').foliage.fern;
  ok('the night forest floor is not lit like the day one', dayFern !== nightFern,
    `${dayFern.toString(16)} vs ${nightFern.toString(16)}`);
}

// ---------------------------------------------------------------------------
section('14. the trees got a nudge, and still work');

// Tree geometry is not only scenery: `collider.canopyY` is where `Trees`
// cuts a felled tree into the thing the player wears, and the collider is the
// identity of a fellable trunk. Adding roots, tiers and a spire is exactly the
// kind of change that quietly breaks felling, so everything the disguise
// depends on is asserted against the geometry itself.
{
  const { buildVariants } = await import('../src/world/props.js');
  const { SCATTER_RULES } = await import('../src/world/scatter.js');
  const { Trees } = await import('../src/world/trees.js');
  const { TREES } = await import('../src/config/gameplay.js');

  // A pine is multiplied by ~2600 and a broadleaf by ~1200. The budget is the
  // art direction, not a limitation, and this is the guard on it.
  const BUDGET = { pine: 60, broadleaf: 56, dead: 68 };

  for (const kind of ['pine', 'broadleaf', 'dead']) {
    const variants = buildVariants(kind, theme, 4242, SCATTER_RULES[kind].variants);
    let worstTris = 0;
    let noTrunk = 0;
    let noCanopy = 0;
    let outsideHitbox = 0;
    let coversBuilt = 0;

    for (const v of variants) {
      const pos = v.geometry.getAttribute('position');
      worstTris = Math.max(worstTris, pos.count / 3);
      const cut = v.canopyY;

      // Split the tree the way `Trees#_canopyGeometry` splits it, and check
      // both halves exist. A tree with nothing under the cut has no trunk; one
      // with nothing over it can never be worn.
      //
      // The BASE region is stricter than "below the cut": a broadleaf's lowest
      // foliage legitimately dips under its own `canopyY`, and foliage is
      // *supposed* to overhang the hitbox — you drive under branches. What may
      // never overhang is the bit at the bottom you would actually hit, which
      // is where the new roots are.
      let below = 0;
      let above = 0;
      let baseRadius = 0;
      for (let t = 0; t < pos.count; t += 3) {
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        if (cy < cut) below++;
        else above++;
        if (cy >= cut * 0.5) continue;
        for (let k = 0; k < 3; k++) {
          baseRadius = Math.max(baseRadius, Math.hypot(pos.getX(t + k), pos.getZ(t + k)));
        }
      }
      if (below === 0) noTrunk++;
      if (above === 0) noCanopy++;
      if (baseRadius > v.collider.radius + 1e-6) outsideHitbox++;

      // And the cover itself, built by the real code path.
      const src = { geometry: v.geometry, material: null, userData: {} };
      const cover = new Trees()._canopyGeometry(src, { canopyY: v.canopyY, instance: 0 });
      if (cover && cover.radius > 0 && cover.height > 0) coversBuilt++;
    }

    ok(`a ${kind} is still cheap`, worstTris <= BUDGET[kind], `${worstTris} triangles, budget ${BUDGET[kind]}`);
    ok(`every ${kind} variant has a trunk`, noTrunk === 0);
    ok(`every ${kind} variant has a canopy above the cut`, noCanopy === 0);
    ok(`the base of a ${kind} fits inside its own hitbox`, outsideHitbox === 0, `${outsideHitbox} variants`);

    // `dead` is deliberately absent. A felled dead tree has never produced a
    // wearable cover — its trunk is one cylinder spanning the whole height, so
    // `_canopyGeometry`'s first pass takes `base` from the ground and the
    // `wornCanopy` ceiling lands below the cut, leaving an empty band. That is
    // a pre-existing bug in the interaction between the prop and `TREES`
    // (PROGRESS bug 20), verified present before these tree changes, and its
    // fix belongs in `trees.js`.
    if (kind !== 'dead') {
      ok(
        `every ${kind} can still be worn`,
        coversBuilt === variants.length,
        `${coversBuilt}/${variants.length} covers built`
      );
    }
  }

  // The world's own trees, as `Scatter` produced them: every fellable collider
  // has to carry a usable `canopyY`, because that is what identifies it.
  const fellable = world.scatter.colliders.filter((c) => TREES.fellable.includes(c.kind));
  const broken = fellable.filter(
    (c) => !(c.canopyY > 0) || !(c.radius > 0) || !(c.height > 0) || !c.baseMatrix || !(c.scale > 0)
  );
  ok('every fellable tree in the world knows where its canopy starts', broken.length === 0,
    `${fellable.length} trees, ${broken.length} broken`);
  ok('…and they are all inside the collision grid', world.collision.count > fellable.length,
    `${world.collision.count} colliders, ${fellable.length} of them trees`);
}

// ---------------------------------------------------------------------------
section('15. the handbrake is a parking brake');
// "On space the car should not move at all, no matter how steep the surface is."
// It used to creep: `handbrakeForce` (9000 N) against a 1100 kg car on a 20°
// slope (~9200 N) is a stalemate the hill wins, and the pull is longitudinal
// only, so parked ACROSS a slope nothing opposed the downhill component at all.
{
  const _n = new THREE.Vector3();
  const span = world.terrain.halfSpan;
  const rng = { s: 12345, next() { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s / 0x7fffffff; } };
  let steep = null;
  for (let i = 0; i < 40000; i++) {
    const x = (rng.next() * 2 - 1) * span * 0.9;
    const z = (rng.next() * 2 - 1) * span * 0.9;
    world.terrain.normalAt(x, z, _n);
    const deg = (Math.acos(Math.min(1, _n.y)) * 180) / Math.PI;
    if (!steep || deg > steep.deg) steep = { x, z, deg };
  }
  ok('there is genuinely steep ground to test on', steep.deg > 25, `${steep.deg.toFixed(1)}°`);

  // Settle first, THEN measure. A car teleported onto a cliff face arrives
  // airborne and slides a metre or two before it is on the ground at all, which
  // is the spawn, not the brake. The question is whether a car that has come to
  // rest under the handbrake ever moves again.
  const park = (heading, handbrake) => {
    const v = new Vehicle({ world, id: 'brake' });
    v.reset(new THREE.Vector3(steep.x, 0, steep.z), heading);
    const cmd = () => ({ throttle: 0, brake: 0, steer: 0, handbrake });
    simulate(v, 240, cmd);
    const from = v.position.clone();
    simulate(v, 1200, cmd);
    return { drift: Math.hypot(v.position.x - from.x, v.position.z - from.z), speed: v.speed };
  };

  // Every heading, because the failure was direction-dependent: pointing down
  // the hill the longitudinal brake fought it, pointing across it did nothing.
  let worst = 0;
  let fastest = 0;
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const r = park(h, 1);
    worst = Math.max(worst, r.drift);
    fastest = Math.max(fastest, r.speed);
  }
  ok('a held handbrake does not move at all', worst < 0.01,
    `worst drift ${worst.toFixed(4)}m over 10s, final speed ${fastest.toFixed(4)}`);
  // …and the slope it is being held against is real, not a flat patch.
  ok('…on ground that would otherwise roll away', park(0, 0).drift > 5,
    `${park(0, 0).drift.toFixed(1)}m without it`);

  // It has to stop a moving car, not just hold a stopped one — the hold only
  // engages below walking pace, so the car has to be able to get there.
  {
    const v = new Vehicle({ world, id: 'brake2' });
    v.reset(new THREE.Vector3(steep.x, 0, steep.z), 0);
    v.velocity.set(0, 0, 25);
    simulate(v, 1200, () => ({ throttle: 0, brake: 0, steer: 0, handbrake: 1 }));
    ok('…and it brings a car doing 25 m/s to a dead stop', v.speed < 0.01, `${v.speed.toFixed(3)} m/s`);
  }

  // None of which may cost the handbrake turn, which is the other half of what
  // the key is for. See TUNING.handbrakeSlideSpeed.
  {
    const t = world.mainTrack;
    const i = 40;
    const v = new Vehicle({ world, id: 'brake3' });
    v.reset(new THREE.Vector3(t.px[i], t.py[i], t.pz[i]), Math.atan2(t.tx[i], t.tz[i]));
    v.velocity.set(v.forward.x * 24, 0, v.forward.z * 24);
    let slip = 0;
    simulate(v, 200, () => {
      slip = Math.max(slip, Math.abs(v.latSpeed));
      return { throttle: 0.2, brake: 0, steer: 1, handbrake: 1 };
    });
    ok('a handbrake turn still breaks the back end away', slip > 3, `${slip.toFixed(1)} m/s of slip at 24 m/s`);
  }
}

// ---------------------------------------------------------------------------
section('16. the glass over the parkours');
// The domes are the answer to "what stops the player driving back onto a race
// that is still running" — nothing does; the race has a roof. Almost all of
// this is geometry that can only be checked by measuring it, and every number
// below has already been wrong once.
{
  const { DOME } = await import('../src/config/gameplay.js');
  const { SURFACES } = await import('../src/config/tuning.js');
  const { events } = await import('../src/core/events.js');
  const field = world.domes;

  ok('every parkour is under one', field.count === world.tracks.size, `${field.count} domes`);
  ok('glass is a surface the car knows about', !!SURFACES.GLASS, SURFACES.GLASS?.id);

  for (const d of field.domes) {
    const t = world.getTrack(d.id);
    let outside = 0;
    let headroom = Infinity;
    for (let i = 0; i < t.count; i++) {
      if (d.distanceTo(t.px[i], t.pz[i]) + t.halfWidth[i] > d.radius) outside++;
      headroom = Math.min(headroom, d.heightAt(t.px[i], t.pz[i]) - t.py[i]);
    }
    ok(`${d.id} is entirely under its own dome`, outside === 0,
      `R=${Math.round(d.radius)}m, H=${Math.round(d.height)}m`);
    // A loop track runs near the edge of its own footprint, which is where a
    // dome is lowest. Nine metres of headroom is what `profileExponent: 1.5`
    // gave, and the pines out here are thirteen.
    ok(`${d.id} has real headroom over the racing line`, headroom > 15,
      `${headroom.toFixed(1)}m at the tightest point`);
  }

  // Two domes overlapping would give a car two floors to be on. `domeAt` picks
  // the higher, so it would not crash — it would just be quietly wrong.
  let closest = Infinity;
  for (let i = 0; i < field.count; i++) {
    for (let j = i + 1; j < field.count; j++) {
      const a = field.domes[i];
      const b = field.domes[j];
      closest = Math.min(closest, Math.hypot(a.centerX - b.centerX, a.centerZ - b.centerZ) - a.radius - b.radius);
    }
  }
  ok('no two domes overlap', closest > 0, `closest pair clears by ${Math.round(closest)}m`);

  // THE ROOF HAS TO BE DRIVABLE. Anchored to the raw heightfield the flanks
  // reached 44°, which is a wall. See DOME.basePasses.
  {
    const n = new THREE.Vector3();
    const slopes = [];
    for (const d of field.domes) {
      for (let ri = 1; ri < 60; ri++) {
        for (let ai = 0; ai < 90; ai++) {
          const r = (ri / 60) * d.radius * 0.999;
          const a = (ai / 90) * Math.PI * 2;
          const x = d.centerX + Math.cos(a) * r;
          const z = d.centerZ + Math.sin(a) * r;
          // Below this the ground is still winning and you are not on glass.
          if (d.heightAt(x, z) - world.terrain.heightAt(x, z) < 12) continue;
          d.normalAt(x, z, n);
          slopes.push((Math.acos(Math.min(1, n.y)) * 180) / Math.PI);
        }
      }
    }
    slopes.sort((a, b) => a - b);
    const median = slopes[Math.floor(slopes.length / 2)];
    const p99 = slopes[Math.floor(slopes.length * 0.99)];
    ok('the roof is a gentle slope almost everywhere', median < 16, `median ${median.toFixed(1)}°`);
    ok('…and climbable at the 99th percentile', p99 < 33, `p99 ${p99.toFixed(1)}°`);
  }

  // The rim has to come down into the earth, not hover over it. A hovering rim
  // is a step you hit at 40 m/s.
  {
    let floating = 0;
    let samples = 0;
    for (const d of field.domes) {
      for (let k = 0; k < 240; k++) {
        const a = (k / 240) * Math.PI * 2;
        const r = d.radius * 0.997;
        const x = d.centerX + Math.cos(a) * r;
        const z = d.centerZ + Math.sin(a) * r;
        samples++;
        if (d.heightAt(x, z) > world.terrain.heightAt(x, z)) floating++;
      }
    }
    ok('the rim is sunk into the ground all the way round', floating === 0, `${floating} of ${samples} float`);
  }

  // Nothing tall grows where the glass comes down. The cleared ring is what
  // stops trunks skewering the panes; see DOME.treeClearance.
  {
    let skewered = 0;
    let trees = 0;
    for (const c of world.scatter.colliders) {
      if (!['pine', 'broadleaf', 'dead'].includes(c.kind)) continue;
      trees++;
      for (const d of field.domes) {
        if (d.distanceTo(c.x, c.z) > d.radius) continue;
        const h = d.heightAt(c.x, c.z);
        if (h > c.y - c.height / 2 && h < c.y + c.height / 2) skewered++;
      }
    }
    ok('no tree is run through by a pane', skewered === 0, `${trees} trees checked`);
  }

  // THE ONE RULE. A dome is solid only for a car that has been outside it —
  // which is the entire reason the player can escape from under parkur 3 and
  // still never get back in.
  {
    // Whichever parkour this map carries — the rule is not about bölüm 3, it
    // is about every dome the player ever comes out from under.
    const d3 = field.byId(world.mainTrack.id);
    const player = { position: new THREE.Vector3(d3.centerX + 60, 0, d3.centerZ), isPlayer: true };
    const rival = { position: new THREE.Vector3(d3.centerX + 60, 0, d3.centerZ), isPlayer: false };

    let revealedWith = null;
    const off = events.on('world:domesRevealed', (p) => { revealedWith = p.trackId; });

    field.arm();
    field.sync([player, rival]);
    ok('under the glass it is not there yet', !field.sealedFor(player, d3));
    ok('…and the ground underneath is the ground',
      world.sampleGround(player.position.x, player.position.z, player).surface !== 'GLASS');
    ok('…and nothing has been revealed', !field.revealed);

    // Out from under the rim.
    player.position.set(d3.centerX + d3.radius + DOME.sealMargin + 5, 0, d3.centerZ);
    field.sync([player, rival]);
    ok('it closes behind you', field.sealedFor(player, d3));
    ok('…and that is what reveals them', field.revealed && revealedWith === world.mainTrack.id, revealedWith);

    // Back to where the escape happened. There is a roof there now.
    player.position.set(d3.centerX + 60, 0, d3.centerZ);
    const onTop = world.sampleGround(player.position.x, player.position.z, player);
    const under = world.sampleGround(rival.position.x, rival.position.z, rival);
    ok('you cannot get back under it', onTop.surface === 'GLASS', `${onTop.height.toFixed(0)}m up`);
    ok('…but the cars still racing under it never left', under.surface !== 'GLASS',
      `${under.surface} at ${under.height.toFixed(0)}m`);
    ok('the fore-and-aft probes agree with the centre',
      Math.abs(world.groundHeightAt(player.position.x, player.position.z, player) - onTop.height) < 0.001);
    ok('a caller with no car in the question sees no glass',
      world.sampleGround(player.position.x, player.position.z).surface !== 'GLASS');

    // A car put back on the TERRAIN under a dome it is sealed against is
    // immediately below its own ground, so it is rescued again, and again, and
    // never moves. `Game#_rescueFallen` is the caller that made this real.
    const rescue = world.safePlaceNear(player.position.x, player.position.z, player);
    ok('a rescue puts you on the glass, not under it',
      rescue.y > onTop.height, `${rescue.y.toFixed(0)}m vs ${onTop.height.toFixed(0)}m of glass`);
    // …and a cruiser spawned on top of one starts out already sealed against
    // it, or it drops through the roof it was standing on. See DomeField#_stateFor.
    const cop = { position: new THREE.Vector3(player.position.x, onTop.height + 1, player.position.z) };
    field.sync([cop]);
    ok('a car that arrives on top of a dome is standing on it',
      field.sealedFor(cop, d3));

    off();
  }
}

// ---------------------------------------------------------------------------
section('17. every level is drivable, and the ones in the air hold you up');

// The point of this section is that ten levels is too many to check by driving
// them. A track is a spline through control points somebody typed, and the
// ways it can be wrong — a corner tighter than the car can turn, a climb
// steeper than it can pull, a deck that is not there when you land on it — all
// present as "the AI drives into the scenery and stops", which is exactly what
// a headless run can measure.
{
  const AI_LAP_SECONDS = 150;

  for (const level of LEVELS) {
    const w = await buildLevel(level.id, { scatter: false });
    const track = w.mainTrack;
    const car = new Vehicle({ profile: 'rival', world: w, id: `lap-${level.id}` });
    // Rivals belong to the track: `ignoreSurfaces` is what stops this becoming
    // a test of whether an AI can drive on ice, which it cannot and is not
    // supposed to be able to. What is being checked here is the SHAPE.
    car.ignoreSurfaces = true;
    const slot = track.gridSlot(0, 7, 4.2, 14);
    car.reset(slot.position, slot.heading);
    const ai = new AiDriver(car, { track, skill: 0.85, aggression: 0.4, seed: 11, world: w });

    const q = {};
    let last = track.query(car.position.x, car.position.z, q, car.position.y)?.progress ?? 0;
    let travelled = 0;
    let stuckFor = 0;
    let worstOff = 0;
    let seconds = 0;
    const steps = Math.round(AI_LAP_SECONDS / DT);
    for (let i = 0; i < steps && travelled < 0.995; i++) {
      car.setCommand(ai.update(DT));
      car.fixedUpdate(DT);
      seconds += DT;
      const r = track.query(car.position.x, car.position.z, q, car.position.y);
      if (r) {
        let d = r.progress - last;
        if (d < -0.5) d += 1;
        else if (d > 0.5) d -= 1;
        if (d > 0) travelled += d;
        last = r.progress;
        worstOff = Math.max(worstOff, r.dist - r.halfWidth);
      }
      stuckFor = car.speed < 1.5 ? stuckFor + DT : 0;
      if (stuckFor > 6) break;
    }

    ok(
      `${level.id} can be driven all the way round`,
      travelled >= 0.99,
      `${(travelled * 100).toFixed(0)}% of a lap in ${seconds.toFixed(0)}s` +
        (stuckFor > 6 ? ', then stopped' : '')
    );
    // …and round it on the road. A lap completed by ploughing across the
    // infield is not a lap, and on a level with a deck in it, it is a fall.
    ok(`…without leaving the ribbon`, worstOff < 14, `worst ${worstOff.toFixed(1)}m past the edge`);
    w.dispose();
  }
}

// -- the road in the air ------------------------------------------------------
{
  const elevated = LEVELS.filter((l) => (l.tracks[0].elevated || []).length > 0);
  ok('some levels put the road in the air', elevated.length >= 2, elevated.map((l) => l.id).join(', '));

  for (const level of elevated) {
    const w = await buildLevel(level.id, { scatter: false });
    const t = w.mainTrack;

    // 1. THE GROUND IS STILL UNDER IT. The whole reason `shapeTerrain` backs
    //    off over a deck: flatten the land to a road forty metres up and the
    //    valley it was crossing fills in, and there is no bridge, just a hill.
    let minClear = Infinity;
    let deckSamples = 0;
    for (let i = 0; i < t.count; i++) {
      if (!t.isElevated(i)) continue;
      deckSamples++;
      minClear = Math.min(minClear, t.py[i] - w.terrain.heightAt(t.px[i], t.pz[i]));
    }
    ok(`${level.id}: the deck stands clear of the ground`, minClear > 4,
      `${deckSamples} samples in the air, lowest ${minClear.toFixed(1)}m over it`);

    // 2. IT IS GROUND ONLY FROM ABOVE. Same query, two heights, two answers.
    const i = Math.round(t.count * (level.tracks[0].elevated[0].from + level.tracks[0].elevated[0].to) / 2);
    const x = t.px[i];
    const z = t.pz[i];
    const above = w.sampleGround(x, z, { position: new THREE.Vector3(x, t.py[i] + 0.5, z) });
    const below = w.sampleGround(x, z, { position: new THREE.Vector3(x, w.terrain.heightAt(x, z) + 0.6, z) });
    ok(`…and a car on the deck is on the road`, Math.abs(above.height - t.py[i]) < 1,
      `${above.surface} at ${above.height.toFixed(1)}m`);
    ok(`…while a car underneath it is on the earth`, below.height < t.py[i] - 4,
      `${below.surface} at ${below.height.toFixed(1)}m, deck at ${t.py[i].toFixed(1)}m`);

    // 3. THERE IS A WALL ALONG THE EDGE, and it is solid.
    const parapets = t.colliders.filter((c) => c.kind === 'parapet');
    ok(`…with a parapet along it`, parapets.length > 10, `${parapets.length} sections`);

    w.dispose();
  }
}

// -- the car sits on the road it is on ---------------------------------------
//
// `sampleGround` returns a height AND a normal, and for a long time only the
// height came from the road: the normal was always the terrain's. That is two
// bugs wearing one coat, and both of them present as "the car will not sit on
// the ground where the road climbs".
//
//   On a DECK the terrain underneath is the valley floor, untouched, because
//   `shapeTerrain` deliberately does not grade under a bridge. So a car on a
//   flat viaduct was tilted by scenery forty metres below it — and worse, the
//   in-plane component of gravity is taken from that normal, so it was shoved
//   sideways along a deck that is level. Parked, hands off, it slid off.
//
//   On GRADED ground it is quieter and just as wrong: the heightfield carries
//   one sample every several metres, so a steep quarry climb is a staircase
//   approximation of the smooth ribbon lying on it, and the car's attitude
//   flicks about while the road under its wheels is straight.
//
// What is asserted: on the tarmac, the physics normal is the ROAD's, and a car
// left alone on a level piece of road stays where it was put. The numbers below
// are what these levels measured before the fix — 70° of tilt on bölüm 4's
// quarry, and 5 m/s of self-propelled drift on bölüm 9.
{
  const ZERO = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
  for (const level of LEVELS) {
    const w = await buildLevel(level.id, { scatter: false });
    const t = w.mainTrack;
    const q = {};
    let worstTilt = 0;
    let worstDrift = 0;
    let flatSamples = 0;

    const car = new Vehicle({ profile: 'rival', world: w, id: `sit-${level.id}` });
    car.ignoreSurfaces = true;

    for (let i = 0; i < t.count; i += 5) {
      // The road's own normal, from its own gradient. Derived here from the
      // sample arrays rather than from `Track#normalAt`, so this is a check and
      // not a restatement of the thing being checked.
      const pv = (i - 1 + t.count) % t.count;
      const nx = (i + 1) % t.count;
      const seg = Math.hypot(t.px[nx] - t.px[pv], t.pz[nx] - t.pz[pv]) || 1;
      const grade = (t.py[nx] - t.py[pv]) / seg;
      const rn = new THREE.Vector3(-t.tx[i] * grade, 1, -t.tz[i] * grade).normalize();

      const g = w.sampleGround(t.px[i], t.pz[i], { position: new THREE.Vector3(t.px[i], t.py[i] + 0.5, t.pz[i]) });
      const dot = Math.min(1, Math.max(-1, g.normal.dot(rn)));
      worstTilt = Math.max(worstTilt, (Math.acos(dot) * 180) / Math.PI);

      // …and the behaviour that follows from it. Only on the level stretches:
      // a car on a hill is supposed to roll down the hill.
      if (Math.abs(grade) >= 0.02) continue;
      flatSamples++;
      car.reset({ x: t.px[i], y: t.py[i] + 2, z: t.pz[i] }, Math.atan2(t.tx[i], t.tz[i]));
      for (let s = 0; s < 90; s++) {
        car.setCommand(ZERO);
        car.fixedUpdate(DT);
      }
      const r = t.query(car.position.x, car.position.z, q, car.position.y);
      if (r && r.onRoad) worstDrift = Math.max(worstDrift, Math.hypot(car.velocity.x, car.velocity.z));
    }

    ok(`${level.id}: the car leans the way the road does`, worstTilt < 3,
      `worst ${worstTilt.toFixed(1)}° from the ribbon's own normal`);
    ok(`…and parked on the level it stays parked`, worstDrift < 0.5,
      `worst ${worstDrift.toFixed(2)}m/s over ${flatSamples} level samples`);
    w.dispose();
  }
}

// -- a road that passes over itself ------------------------------------------
// The spiral on bölüm 6 comes down through its own shadow, which means two
// pieces of road are at the same (x, z) and only their height tells them apart.
// Everything that asks the track where it is has to ask with a height, or a car
// on the top deck is told it is on the bottom one and is thirty metres in the
// air with no road under it.
{
  const level = LEVELS.find((l) => l.id === 'level6');
  const w = await buildLevel(level.id, { scatter: false });
  const t = w.mainTrack;
  const q = {};

  // Find where the ribbon crosses itself in plan view.
  let crossing = null;
  for (let i = 0; i < t.count && !crossing; i += 3) {
    for (let j = i + 60; j < t.count; j += 3) {
      const d = Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]);
      if (d < 6 && Math.abs(t.py[i] - t.py[j]) > 12) {
        crossing = { i, j, gap: Math.abs(t.py[i] - t.py[j]) };
        break;
      }
    }
  }
  ok('bölüm 6 passes over itself', !!crossing,
    crossing ? `${crossing.gap.toFixed(0)}m between the decks` : 'no crossing found');

  if (crossing) {
    const { i, j } = crossing;
    const hi = t.py[i] > t.py[j] ? i : j;
    const lo = hi === i ? j : i;
    const onTop = t.query(t.px[hi], t.pz[hi], q, t.py[hi] + 0.5);
    ok('…and asking from the upper deck answers with the upper deck',
      Math.abs(onTop.height - t.py[hi]) < 2, `${onTop.height.toFixed(1)}m vs ${t.py[hi].toFixed(1)}m`);
    const underneath = t.query(t.px[lo], t.pz[lo], q, t.py[lo] + 0.5);
    ok('…and asking from underneath answers with the lower one',
      Math.abs(underneath.height - t.py[lo]) < 2, `${underneath.height.toFixed(1)}m vs ${t.py[lo].toFixed(1)}m`);
    // Without a height it is a coin toss, and that is exactly why every caller
    // that owns a car passes one.
    const blind = t.query(t.px[hi], t.pz[hi], q);
    ok('…and without a height it still answers something sane',
      Math.abs(blind.height - t.py[hi]) < 2 || Math.abs(blind.height - t.py[lo]) < 2,
      `${blind.height.toFixed(1)}m`);
  }
  w.dispose();
}

// -- weather -----------------------------------------------------------------
{
  const wet = LEVELS.filter((l) => l.map.weather?.wet);
  const snowy = LEVELS.filter((l) => l.map.weather?.kind === 'snow');
  ok('some levels are wet', wet.length >= 2, wet.map((l) => l.id).join(', '));
  ok('…and some are snowed on', snowy.length >= 1, snowy.map((l) => l.id).join(', '));

  const w = await buildLevel(wet[0].id, { scatter: false });
  const t = w.mainTrack;
  const i = Math.round(t.count * 0.05);
  const g = w.sampleGround(t.px[i], t.pz[i]);
  // The road is not made of anything different; it is the same road, wet.
  ok(`${wet[0].id}: the road reports WET`, g.surface === 'WET', g.surface);
  const { surfaceById } = await import('../src/config/tuning.js');
  ok('…and wet tarmac grips less than dry',
    surfaceById('WET').grip < surfaceById('TARMAC').grip * 0.85,
    `${surfaceById('WET').grip} vs ${surfaceById('TARMAC').grip}`);
  ok('…and there is rain in the world to explain it',
    w.weather?.mesh?.count > 200, `${w.weather?.mesh?.count} drops`);
  // Nothing about the weather may cost anything when there is none.
  const dry = await buildLevel('level1', { scatter: false });
  ok('a dry level has no weather at all', dry.weather === null && dry.wet === false);
  const dryGround = dry.sampleGround(dry.mainTrack.px[0], dry.mainTrack.pz[0]);
  ok('…and its road is just a road', dryGround.surface === 'TARMAC', dryGround.surface);
  dry.dispose();
  w.dispose();
}

// -- authored ground ---------------------------------------------------------
{
  const w = await buildLevel('level5', { scatter: false });
  // The lake: a pane at a fixed height over a basin the level dug for it.
  const water = w.root.getObjectByName('water');
  ok('bölüm 5 has water in it', !!water, water ? `at ${water.position.y}m` : 'none');
  const bed = w.terrain.heightAt(20, 0);
  ok('…and a hollow for it to sit in', bed < water.position.y - 8,
    `bed ${bed.toFixed(1)}m, surface ${water.position.y}m`);
  // …and the road is not in it.
  const t = w.mainTrack;
  let lowest = Infinity;
  for (let i = 0; i < t.count; i++) lowest = Math.min(lowest, t.py[i]);
  ok('…and the parkour stays out of the lake', lowest > water.position.y,
    `lowest point of the road ${lowest.toFixed(1)}m`);
  w.dispose();
}

// ---------------------------------------------------------------------------
section('18. bölümler — what the menu knows about progress');

// The list behind BÖLÜMLER is derived from one stored fact: which levels have
// been finished. What is asserted here is that the derivation is the rule the
// menu draws (a level opens when the one before it is done), that it survives
// the page, and — the load-bearing one — that NOTHING here refuses to hand out
// a level. The lock is a note, not a door; the tenth map has to be reachable
// without driving the nine in front of it.
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const mod = await import('../src/game/levelProgress.js?instance=write');
  const { levelProgress, levelMenuItems } = mod;
  levelProgress.reset();

  ok('bölüm 1 is open from the start', levelProgress.isUnlocked(LEVELS[0].id));
  ok('…and bölüm 2 is not', !levelProgress.isUnlocked(LEVELS[1].id));
  ok('…and nothing is finished yet', !levelProgress.isCompleted(LEVELS[0].id));

  levelProgress.complete(LEVELS[0].id);
  ok('finishing one opens the next', levelProgress.isUnlocked(LEVELS[1].id));
  ok('…and only the next', !levelProgress.isUnlocked(LEVELS[2].id));
  ok('…and completing it twice is a no-op', levelProgress.complete(LEVELS[0].id) === false);
  ok('an id that is not a level is refused', levelProgress.complete('level999') === false);

  const items = levelMenuItems({ currentId: LEVELS[1].id });
  ok('the menu lists every level, in order', items.length === LEVELS.length &&
    items.every((it, i) => it.id === LEVELS[i].id && it.index === i + 1));
  ok('…marks the finished one', items[0].done && !items[0].locked);
  ok('…marks where the player is', items[1].current && !items[1].locked);
  ok('…and draws the rest as locked', items.slice(2).every((it) => it.locked && !it.done),
    `${items.filter((it) => it.locked).length} locked`);
  ok('…but every row still names a real level anyone can ask for',
    items.every((it) => !!levelById(it.id)));

  ok('it reached localStorage', store.size === 1);
  const reread = (await import('../src/game/levelProgress.js?instance=read')).levelProgress;
  ok('a fresh page finds the progress again', reread.isUnlocked(LEVELS[1].id));

  // Storage that is not there at all — private mode, a file:// boot, this test
  // a moment from now. Progress becomes per-session; nothing throws.
  delete globalThis.localStorage;
  const offline = (await import('../src/game/levelProgress.js?instance=offline')).levelProgress;
  ok('without storage the game still starts on bölüm 1', offline.isUnlocked(LEVELS[0].id));
  ok('…and still records a finish for this session',
    offline.complete(LEVELS[0].id) === true && offline.isUnlocked(LEVELS[1].id));
}

// The two menus that reach it. Neither is worth a browser: what breaks in
// practice is an id going out of sync between the screen that offers it and the
// code that acts on it, which is a text-level fact about these three files.
{
  const screens = readFileSync('src/ui/screens.js', 'utf8');
  const game = readFileSync('src/game/game.js', 'utf8');
  const director = readFileSync('src/game/intro/introDirector.js', 'utf8');

  ok('the pause menu offers BÖLÜMLER', /id: 'levels', label: 'BÖLÜMLER'/.test(screens));
  ok('…and the game acts on that id', /choice === 'levels'/.test(game));
  ok('the title menu offers it too', /id: 'levels', label: 'BÖLÜMLER'/.test(director));
  ok('…and the screen it opens exists', /showLevelSelect\(/.test(screens));
  ok('level select is what BÖLÜM N’TEN BAŞLA used to be',
    !/BÖLÜM \$\{[^}]+\}’TEN BAŞLA/.test(director));
  ok('a chosen level goes through one door', /async startLevel\(levelId\)/.test(game));
  ok('…which hands over to a story rather than jumping its queue',
    /game:levelSelected/.test(game) && /game:levelSelected/.test(director));
}

// ---------------------------------------------------------------------------
section('19. every bölüm has its own song');

// Music is the one thing in the game that fails *silently*: a level naming a
// track that does not exist gets a console warning nobody reads and then the
// previous track keeps playing, so bölüm 7 races to bölüm 6's music and nothing
// anywhere says so. These checks are the thing that says so.
{
  const { MUSIC_TRACKS } = await import('../src/audio/music/index.js');
  const { defineTrack, rest } = await import('../src/audio/music/track.js');
  const { SCALES, degreeToSemitone, resolveScale } = await import('../src/audio/music/scales.js');
  const { AUDIO_CONFIG } = await import('../src/audio/audio.js');
  const { LEVEL_DEFAULTS } = await import('../src/levels/defaults.js');

  ok('the engine plays what the registry holds', AUDIO_CONFIG.MUSIC.tracks === MUSIC_TRACKS);

  // -- the levels ------------------------------------------------------------
  const missing = LEVELS.filter((l) => !MUSIC_TRACKS[l.music]);
  ok('every level names a song that exists', missing.length === 0,
    missing.map((l) => `${l.id}→${l.music}`).join(', '));

  const songs = new Set(LEVELS.map((l) => l.music));
  ok('…and no two levels share one', songs.size === LEVELS.length,
    `${songs.size} songs for ${LEVELS.length} levels`);
  ok('…and none of them settled for the fallback', !songs.has(LEVEL_DEFAULTS.music),
    LEVEL_DEFAULTS.music);

  // The point of the exercise: ten stages, ten different colours. Two levels in
  // the same mode at the same root would be one song with two names.
  const keys = new Set(LEVELS.map((l) => `${MUSIC_TRACKS[l.music].scale}@${MUSIC_TRACKS[l.music].root}`));
  ok('…and no two are in the same key and mode', keys.size === LEVELS.length,
    [...keys].join(' '));

  // -- what belongs to the game, not to a stage ------------------------------
  for (const id of ['menu', 'race', 'chase', 'alone']) {
    ok(`${id} is still there for the story to reach for`, !!MUSIC_TRACKS[id]);
    ok(`…and no level took it`, !songs.has(id));
  }

  // -- the compiler ----------------------------------------------------------
  // Degrees are steps *in the scale*, which is what lets one phrase read
  // correctly in a five-note scale and a seven-note one.
  ok('degree 7 of a seven-note mode is the octave',
    degreeToSemitone(SCALES.dorian, 7) === 12);
  ok('…and degree 5 of a pentatonic is', degreeToSemitone(SCALES.kumoi, 5) === 12);
  ok('…and negative degrees walk down below the root',
    degreeToSemitone(SCALES.aeolian, -1) === -2, `${degreeToSemitone(SCALES.aeolian, -1)}`);
  ok('chromatic degrees are plain semitones — core.js depends on it',
    [0, 5, 12, 19, -3].every((d) => degreeToSemitone(SCALES.chromatic, d) === d));
  let threw = false;
  try { resolveScale('lidyan'); } catch { threw = true; }
  ok('a misspelled mode is refused, not quietly defaulted', threw);

  // The grid has to be the common multiple of the voices or the "polymeter" is
  // just a pattern with an unreachable tail. This is the check that keeps a new
  // song from losing its last four steps to arithmetic.
  const poly = defineTrack({
    id: 'test', bpm: 120, root: 45, scale: 'aeolian',
    voices: { bass: { pattern: [0, ...rest(15)] }, lead: { pattern: [0, ...rest(11)] } },
  });
  ok('a 16 and a 12 give a 48-step grid', poly.steps === 48, `${poly.steps}`);
  for (const t of Object.values(MUSIC_TRACKS)) {
    if (t.id === 'chase' || t.id === 'alone') continue; // hand-voiced, see core.js
    const reach = Object.values(t.voices).every((v) => t.steps % v.pattern.length === 0);
    ok(`${t.id}: every step of every voice is reachable`, reach,
      `${t.steps} steps, voices ${Object.values(t.voices).map((v) => v.pattern.length).join('/')}`);
  }

  // -- and it has to be playable ---------------------------------------------
  for (const t of Object.values(MUSIC_TRACKS)) {
    const notes = [];
    for (const v of Object.values(t.voices)) {
      for (const n of v.pattern) if (n !== null) notes.push(t.root + (v.octave || 0) * 12 + n);
    }
    const lo = Math.min(...notes);
    const hi = Math.max(...notes);
    // Below MIDI 21 is under a piano's bottom note and turns to mud on a
    // laptop; above 100 it is a whistle over an engine.
    ok(`${t.id} stays in a range a speaker can render`, lo >= 21 && hi <= 100,
      `MIDI ${lo}..${hi}`);
    ok(`…and its loop is long enough not to nag`, (60 / t.bpm / t.stepsPerBeat) * t.steps >= 1.5,
      `${((60 / t.bpm / t.stepsPerBeat) * t.steps).toFixed(1)}s`);
  }
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
}

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
