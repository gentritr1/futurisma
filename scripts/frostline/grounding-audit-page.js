// In-page half of the Frostline grounding audit (served by the Vite dev server,
// driven by scripts/frostline/grounding-audit.mjs). It builds the real
// FrostlineEnvironment, labels every instance with the builder call that made
// it, and measures how each object meets the ground or the object below it.
import * as THREE from 'three';

const TOL = .3;                       // "touching" tolerance, metres
const PROBE_DEPTHS = [.03, .15, TOL]; // probe below each bottom point for a supporter

export async function runAudit(debugNear = null) {
  const {FrostlineCourse} = await import('/src/game/frostline-course.ts');
  const {FrostlineEnvironment} = await import('/src/game/frostline-environment.ts');
  const proto = FrostlineEnvironment.prototype;

  // --- 1. label every instance with the builder method stack that created it
  const stack = [], labels = new Map(); let modelSeq = 0, currentModel = -1; const moundModelSeq = [];
  const wrap = (name) => { const original = proto[name]; if (!original) return () => {}; proto[name] = function (...args) { stack.push(name); try { return original.apply(this, args); } finally { stack.pop(); } }; return () => { proto[name] = original; }; };
  const restores = ['buildRoad','buildLandscape','buildVillage','buildWinterOutposts','buildChristmasTree','buildArch','buildGarland','buildFestiveDetails','buildMarket','buildGondolas','buildPuddles','buildClock','sign','star','buildGround'].map(wrap);
  const originalAddModel = proto.addModel;
  proto.addModel = function (model) { currentModel = modelSeq++; try { return originalAddModel.call(this, model); } finally { currentModel = -1; } };
  const originalInstance = proto.instance;
  proto.instance = function (geometry, material, matrix) {
    const key = geometry.uuid + material.uuid; if (!labels.has(key)) labels.set(key, []);
    const scale = new THREE.Vector3(); matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const where = stack.filter(s => s !== 'sign' && s !== 'star').join('>') || 'constructor';
    labels.get(key).push({where, inStar: stack.includes('star'), inSign: stack.includes('sign'), model: currentModel, scale: scale.toArray()});
    if (where === 'buildLandscape' && geometry.type === 'IcosahedronGeometry' && scale.x === 15) moundModelSeq.push(modelSeq - 1);
    return originalInstance.call(this, geometry, material, matrix);
  };
  const course = new FrostlineCourse();
  let env;
  try { env = await FrostlineEnvironment.load(course); }
  finally { for (const r of restores) r(); proto.addModel = originalAddModel; proto.instance = originalInstance; }
  env.root.updateMatrixWorld(true);
  const lastMoundModel = moundModelSeq.length ? Math.max(...moundModelSeq) : -1;

  // --- 2. collect objects (one per instance / mesh)
  const gondolaParts = new Set(); for (const car of env.gondolas ?? []) car.traverse(o => gondolaParts.add(o));
  const holidayRoot = env.holidayLife?.root, winterRoot = env.winterEffects?.root;
  const within = (o, root) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const objects = [], ground = [], excluded = {};
  const exclude = (why, n = 1) => { excluded[why] = (excluded[why] ?? 0) + n; };
  const geomKind = g => ({BoxGeometry:'box',IcosahedronGeometry:'ball',ConeGeometry:'cone',SphereGeometry:'sphere',CylinderGeometry:'cylinder',PlaneGeometry:'plane',CircleGeometry:'disc',TorusGeometry:'ring',ExtrudeGeometry:'star',OctahedronGeometry:'octa',RingGeometry:'ringflat'})[g.type] ?? g.type;
  const matName = m => (m.name || '').replace('frostline_', '') || (m.type === 'MeshBasicMaterial' ? 'basic#' + m.color.getHexString() : m.type + '#' + (m.color?.getHexString?.() ?? ''));

  env.root.traverse(o => {
    if (o.isPoints || o.isLine || o.isLineSegments) { exclude('particles/lines (snow, smoke, glows, steam, fireworks, firework trails, snowball burst)'); return; }
    if (!o.isMesh) return;
    if (o.isReflector || o.material?.isShaderMaterial && o.material.uniforms?.tDiffuse) { exclude('road puddle reflector decal (on the road surface)'); return; }
    if (o.material?.isShaderMaterial && o.material.side === THREE.BackSide) { exclude('sky dome'); return; }
    if (gondolaParts.has(o)) { exclude('gondola car meshes (hang on the cable)'); return; }
    if (!o.visible || (o.parent && !o.parent.visible)) { exclude('hidden at load (snowball projectile)'); return; }
    o.geometry.boundingBox ?? o.geometry.computeBoundingBox();
    const module = within(o, holidayRoot) ? 'holiday' : within(o, winterRoot) ? 'winter' : 'env';
    const add = (matrix, label) => objects.push({matrix, geometry: o.geometry, kind: geomKind(o.geometry), material: matName(o.material), module, ...label});
    if (o.isInstancedMesh) {
      const list = labels.get(o.geometry.uuid + o.material.uuid);
      for (let i = 0; i < o.count; i++) {
        const m = new THREE.Matrix4(); o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
        const sc = new THREE.Vector3(); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
        const label = module === 'env' ? (list?.[i] ?? {where: 'unlabelled'}) : {where: module + ':' + geomKind(o.geometry) + ':' + matName(o.material), scale: sc.toArray()};
        add(m, label);
      }
    } else add(o.matrixWorld.clone(), {where: module === 'env' ? (o.name === 'frostline_ground' ? 'buildGround' : o.material?.name === 'frostline_road_surface' ? 'buildRoad' : o.parent === env.root ? 'mesh:' + geomKind(o.geometry) : 'child:' + geomKind(o.geometry)) : module + ':' + geomKind(o.geometry)});
  });

  // --- 3. family + role per object
  for (const ob of objects) {
    const s = ob.scale ?? [1,1,1], w = ob.where, k = ob.kind, m = ob.material;
    let family = w, role = 'prop';
    if (w === 'buildRoad' && ob.material === 'road_surface') { family = 'road surface'; role = 'ground'; }
    else if (w === 'buildGround') { family = 'terrain heightfield'; role = 'ground'; }
    else if (w === 'buildLandscape' && k === 'box' && s[0] > 1000) { family = 'flat snow slab (-3 m)'; role = 'ground'; }
    else if (w === 'buildRoad' && k === 'box' && Math.abs(s[0] - 30) < .01) { family = 'snow bank slab (road edge)'; role = 'ground'; }
    else if (m === 'bulb' || (ob.module === 'holiday' && m.includes('ffd79a'))) { family = 'bulbs/lamp lights (attached lights)'; role = 'attached'; }
    else if (ob.module === 'holiday' && w.endsWith('ShaderMaterial#')) { family = 'holiday glow discs (additive ground decal)'; role = 'airborne'; }
    else if (w.includes('buildGondolas')) { family = 'gondola cables'; role = 'airborne'; }
    else if (w.includes('buildGarland') && !(k === 'box' && m === 'wood')) { family = 'garland swag (hangs between poles)'; role = 'airborne'; }
    else if (w.includes('buildGarland')) family = 'garland poles';
    else if (w.includes('buildArch') && !(k === 'box' && (m === 'stone' || (m === 'snow' && s[0] > 4)))) { family = 'arch overhead (beam, sign, swag; spans the pillars)'; role = 'airborne'; }
    else if (w.includes('buildArch')) family = 'arch pillars';
    else if (ob.inSign) family = 'snow/ice signs';
    else if (w === 'buildFestiveDetails' && k === 'box' && m === 'dark') family = Math.abs(s[0] - .14) < .01 ? 'chevron panels (-14.7 m)' : 'festive flags (16.7 m, 6.4 m up)';
    else if (w === 'buildLandscape') {
      if (k === 'cone') family = 'forest cones (70-200 m)';
      else if (k === 'ball' && s[0] >= 100) family = 'distant hills';
      else if (k === 'ball') family = 'pine mounds';
      else if (ob.model >= 0 && ob.model <= lastMoundModel) family = 'large pines on mounds (65-86 m)';
      else if (ob.model >= 0) family = 'roadside pines (31-75 m)';
    }
    else if (w === 'buildVillage') family = ob.model >= 0 ? 'village chalets' : 'lantern posts (16.7 m)';
    else if (w === 'buildWinterOutposts') family = ob.model >= 0 ? 'outpost chalets' : k === 'cone' ? 'decorated trees (19.5 m)' : (k === 'box' && (Math.abs(s[0] - .15) < .01 || Math.abs(s[0] - .22) < .01 || Math.abs(s[0] - .2) < .01)) ? 'fence rails (17.3 m)' : 'outpost benches/gifts';
    else if (w === 'buildRoad') family = k === 'plane' ? 'snow/ice signs' : 'road rails, snow lips, lane strips';
    else if (w === 'buildMarket') family = ob.model >= 0 ? 'market stalls' : 'market crates/snowmen';
    else if (w === 'buildChristmasTree' && k === 'ball') { family = 'christmas tree ornaments (hang on branches)'; role = 'attached'; }
    else if (w === 'buildChristmasTree') family = 'christmas tree';
    else if (w === 'buildFestiveDetails') family = 'festive ribbon bows (13.8 m)';
    else if (w === 'buildClock' || w === 'child:disc' || w === 'child:box') { family = 'clock face/hands (on tower)'; }
    else if (w === 'constructor') family = 'clock tower';
    else if (w.startsWith('mesh:plane')) { const g = ob.geometry.parameters; if (g.width === 2.1 && g.height === 4.2) family = 'festive flags (16.7 m, 6.4 m up)'; else if (g.width === 5 && g.height === 2.5) family = 'chevron panels (-14.7 m)'; else if (g.width === 30) { family = 'arch overhead (beam, sign, swag; spans the pillars)'; role = 'airborne'; } else family = 'snow/ice signs'; }
    else if (ob.module === 'holiday' && ((k === 'plane' && ob.geometry.parameters.width === 3.5) || (k === 'box' && Math.abs(s[0] - 3.65) < .01 && Math.abs(s[1] - .15) < .01))) { family = 'cocoa cart signs (hang under the canopy)'; role = 'hung'; }
    else if (ob.module === 'holiday') family = 'holiday life (residents, carts, rink, train, sleighs)';
    else if (ob.module === 'winter') family = 'winter devices (pickups, snow cannons)';
    ob.family = family; ob.role = role;
  }

  // --- 4. ground height field from the ground meshes' real triangles
  const CELL = 10, cells = new Map(), tri = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (const ob of objects) if (ob.role === 'ground') {
    const g = ob.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(pos, idx ? idx.getX(t + j) : t + j).applyMatrix4(ob.matrix);
      const area = (v[1].x - v[0].x) * (v[2].z - v[0].z) - (v[2].x - v[0].x) * (v[1].z - v[0].z);
      if (Math.abs(area) < 1e-6) continue;
      const id = tri.length; tri.push([v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z, area, ob.family]);
      const x0 = Math.floor(Math.min(v[0].x, v[1].x, v[2].x) / CELL), x1 = Math.floor(Math.max(v[0].x, v[1].x, v[2].x) / CELL);
      const z0 = Math.floor(Math.min(v[0].z, v[1].z, v[2].z) / CELL), z1 = Math.floor(Math.max(v[0].z, v[1].z, v[2].z) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = x * 100003 + z; let c = cells.get(key); if (!c) cells.set(key, c = []); c.push(id); }
    }
  }
  const groundAt = (x, z) => {
    const c = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)); let best = -Infinity, by = null;
    if (c) for (const id of c) {
      const [ax, ay, az, bx, by_, bz, cx, cy, cz, area] = tri[id];
      const w0 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area, w1 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * ay + w1 * by_ + w2 * cy; if (y > best) { best = y; by = tri[id][10]; }
    }
    return {y: best, by};
  };

  // --- 5. probes, gaps, support propagation
  const p = new THREE.Vector3();
  for (const ob of objects) {
    const b = ob.geometry.boundingBox, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
    const local = ob.kind === 'ball' || ob.kind === 'sphere' ? [[cx, b.min.y, cz]] : [[cx, b.min.y, cz], [cx + .7 * hx, b.min.y, cz], [cx - .7 * hx, b.min.y, cz], [cx, b.min.y, cz + .7 * hz], [cx, b.min.y, cz - .7 * hz]];
    // A flat plane standing upright (signs, flags) has its "bottom" on the local -Y edge.
    ob.probes = local.map(l => p.set(...l).applyMatrix4(ob.matrix).toArray());
    const box = b.clone().applyMatrix4(ob.matrix); ob.aabb = box; ob.inverse = ob.matrix.clone().invert();
    ob.centre = box.getCenter(new THREE.Vector3());
    let gapMin = Infinity, gapMax = -Infinity, gapCentre = NaN;
    for (const [i, q] of ob.probes.entries()) { const g = groundAt(q[0], q[2]); const gap = q[1] - g.y; if (i === 0) { gapCentre = gap; ob.groundBy = g.by; ob.groundY = g.y; } gapMin = Math.min(gapMin, gap); gapMax = Math.max(gapMax, gap); }
    ob.gapMin = gapMin; ob.gapMax = gapMax; ob.gapCentre = gapCentre;
    ob.buried = box.max.y < ob.groundY - .05; // whole object under the ground surface
  }
  const props = objects.filter(o => o.role !== 'ground');
  const hash = new Map(), HC = 8;
  for (const [i, ob] of props.entries()) {
    const b = ob.aabb; for (let x = Math.floor(b.min.x / HC); x <= Math.floor(b.max.x / HC); x++) for (let z = Math.floor(b.min.z / HC); z <= Math.floor(b.max.z / HC); z++) { const k = x * 100003 + z; let c = hash.get(k); if (!c) hash.set(k, c = []); c.push(i); }
  }
  const lp = new THREE.Vector3();
  const inside = (sup, q) => {
    lp.set(q[0], q[1], q[2]).applyMatrix4(sup.inverse); const e = .02;
    switch (sup.kind) {
      case 'box': return Math.abs(lp.x) <= .5 + e && Math.abs(lp.y) <= .5 + e && Math.abs(lp.z) <= .5 + e;
      case 'ball': case 'sphere': { const r = sup.geometry.parameters?.radius ?? 1; return lp.length() <= r * (1 + e); }
      case 'cone': { const h = sup.geometry.parameters.height, r = sup.geometry.parameters.radius; return lp.y >= -h / 2 - e && lp.y <= h / 2 + e && Math.hypot(lp.x, lp.z) <= r * (.5 - lp.y / h) + e; }
      default: { const b = sup.geometry.boundingBox; return lp.x >= b.min.x - .05 && lp.x <= b.max.x + .05 && lp.y >= b.min.y - .05 && lp.y <= b.max.y + .05 && lp.z >= b.min.z - .05 && lp.z <= b.max.z + .05; }
    }
  };
  for (const ob of props) { ob.onGround = ob.gapMin <= TOL; ob.supported = ob.onGround; ob.restsOn = ob.onGround ? 'ground' : null; }
  // Lowest objects first so support climbs a stack in a single pass; airborne
  // families are excluded from the headline and never searched for support.
  const searchOrder = props.filter(o => o.role === 'prop' || o.role === 'attached').sort((a, b) => a.aabb.min.y - b.aabb.min.y);
  const t0 = performance.now(); let passes = 0;
  // Probe support converges first; the contact rule only runs afterwards.
  for (const allowContact of [false, true]) for (let pass = 0, changed = true; changed && pass < 12; pass++) {
    changed = false; passes++;
    for (const ob of searchOrder) if (!ob.supported) {
      search: for (const q of ob.probes) for (const d of PROBE_DEPTHS) {
        const probe = [q[0], q[1] - d, q[2]], c = hash.get(Math.floor(probe[0] / HC) * 100003 + Math.floor(probe[2] / HC)); if (!c) continue;
        for (const j of c) { const sup = props[j]; if (sup === ob || !sup.supported || (sup.role !== 'prop' && sup.role !== 'attached')) continue; const bb = sup.aabb; if (probe[0] < bb.min.x - .05 || probe[0] > bb.max.x + .05 || probe[1] < bb.min.y - .05 || probe[1] > bb.max.y + .05 || probe[2] < bb.min.z - .05 || probe[2] > bb.max.z + .05) continue; if (inside(sup, probe)) { ob.supported = true; ob.restsOn = sup.family; changed = true; break search; } }
      }
      // Contact rule (spans, mounts, hung boards): the object's box touches a
      // grounded object that reaches at least as low. Counted separately so a
      // family that is "supported" only by contact stays visible in the report.
      if (allowContact && !ob.supported) {
        const b = ob.aabb, seen = new Set();
        contact: for (let x = Math.floor(b.min.x / HC); x <= Math.floor(b.max.x / HC); x++) for (let z = Math.floor(b.min.z / HC); z <= Math.floor(b.max.z / HC); z++) {
          for (const j of hash.get(x * 100003 + z) ?? []) { if (seen.has(j)) continue; seen.add(j); const sup = props[j]; if (sup === ob || !sup.supported || (sup.role !== 'prop' && sup.role !== 'attached')) continue;
            const o = sup.aabb; if (o.min.y > b.min.y + .01) continue;
            if (o.min.x - .05 > b.max.x || o.max.x + .05 < b.min.x || o.min.y - .05 > b.max.y || o.max.y + .05 < b.min.y || o.min.z - .05 > b.max.z || o.max.z + .05 < b.min.z) continue;
            ob.supported = true; ob.byContact = true; ob.restsOn = sup.family; changed = true; break contact; }
        }
      }
    }
  }

  // Hung/airborne decor: it must at least touch something grounded (chains allowed).
  const hung = objects.filter(o => (o.role === 'hung' || o.role === 'airborne') && o.family !== 'gondola cables');
  for (const o of hung) o.attached = false;
  for (let pass = 0, changed = true; changed && pass < 40; pass++) {
    changed = false;
    for (const o of hung) if (!o.attached) {
      const b = o.aabb;
      const near = new Set(); for (let x = Math.floor(b.min.x / HC); x <= Math.floor(b.max.x / HC); x++) for (let z = Math.floor(b.min.z / HC); z <= Math.floor(b.max.z / HC); z++) for (const j of hash.get(x * 100003 + z) ?? []) near.add(props[j]);
      for (const other of near) { if (other === o || other.role === 'ground') continue; const ok = other.role === 'prop' || other.role === 'attached' ? other.supported : other.attached; if (!ok) continue; const c = other.aabb;
        if (c.min.x - .05 > b.max.x || c.max.x + .05 < b.min.x || c.min.y - .05 > b.max.y || c.max.y + .05 < b.min.y || c.min.z - .05 > b.max.z || c.max.z + .05 < b.min.z) continue;
        o.attached = true; changed = true; break; }
    }
  }

  // --- 6. report
  const regionOf = ob => { const pr = course.project(ob.centre, 0); return {progress: pr.progress, lateral: pr.lateral}; };
  const families = {};
  for (const ob of props) {
    const f = families[ob.family] ??= {role: ob.role, count: 0, floating: 0, gt05: 0, gt2: 0, gt10: 0, maxGap: 0, buried: 0, maxEmbed: 0, regions: Array(10).fill(0), examples: []};
    f.count++;
    const gap = ob.supported ? 0 : ob.gapMin; // closest approach to the ground for an unsupported object
    if (!ob.supported) { const sub = ob.kind + ':' + ob.material + (ob.scale ? ':' + ob.scale.map(v => +v.toFixed(2)).join('x') : ''); (f.floatingBy ??= {})[sub] = Math.max(f.floatingBy[sub] ?? 0, +gap.toFixed(2)); }
    if (!ob.supported) { f.floating++; const r = regionOf(ob); f.regions[Math.min(9, Math.floor(r.progress * 10))]++; if (f.examples.length < 4 || gap > f.examples[0].gap) { f.examples.push({gap: +gap.toFixed(2), progress: +r.progress.toFixed(4), lateral: +r.lateral.toFixed(1), y: +ob.aabb.min.y.toFixed(2), ground: +ob.groundY.toFixed(2)}); f.examples.sort((a, b) => b.gap - a.gap); f.examples.length = Math.min(f.examples.length, 4); } }
    if (gap > .5) f.gt05++; if (gap > 2) f.gt2++; if (gap > 10) f.gt10++; f.maxGap = Math.max(f.maxGap, gap);
    if (ob.buried) { f.buried++; const sub = ob.kind + ':' + ob.material; (f.buriedBy ??= {})[sub] = (f.buriedBy[sub] ?? 0) + 1; }
    if (ob.byContact) f.contactOnly = (f.contactOnly ?? 0) + 1;
    if (ob.role === 'hung' || ob.role === 'airborne') f.unattached = (f.unattached ?? 0) + (ob.attached ? 0 : 1);
    if (ob.onGround && -ob.gapCentre > f.maxEmbed) { const r = regionOf(ob); f.maxEmbedAt = {progress: +r.progress.toFixed(4), lateral: +r.lateral.toFixed(1), part: ob.kind + ':' + ob.material}; }
    if (ob.onGround) { f.maxEmbed = Math.max(f.maxEmbed, -ob.gapCentre); f.maxFootprintGap = Math.max(f.maxFootprintGap ?? 0, +ob.gapMax.toFixed(2)); }
  }
  for (const f of Object.values(families)) { f.maxGap = +f.maxGap.toFixed(2); f.maxEmbed = +f.maxEmbed.toFixed(2); }
  const groundFamilies = {}; for (const ob of objects) if (ob.role === 'ground') groundFamilies[ob.family] = (groundFamilies[ob.family] ?? 0) + 1;
  const sum = Object.values(families).reduce((a, f) => a + f.count, 0);
  const grounded = Object.entries(families).filter(([, f]) => f.role === 'prop');
  // ground continuity: terrain must never rise through the road deck
  let roadPoke = 0, roadChecks = 0;
  const groundOnly = (x, z, fam) => { const c = cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)); let best = -Infinity; if (c) for (const id of c) { const t = tri[id]; if (t[10] !== fam) continue; const [ax, ay, az, bx, by_, bz, cx, cy, cz, area] = t; const w0 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area, w1 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; best = Math.max(best, w0 * ay + w1 * by_ + w2 * cy); } return best; };
  const s = course.createSampleScratch(); let worstPoke = -Infinity;
  for (let i = 0; i < 1920; i++) { course.sample(i / 1920, s); for (const lat of [-12.9, -8, -4, 0, 4, 8, 12.9]) { const x = s.position.x + s.right.x * lat, z = s.position.z + s.right.z * lat; const road = groundOnly(x, z, 'road surface'); if (!isFinite(road)) continue; roadChecks++; for (const fam of ['terrain heightfield', 'flat snow slab (-3 m)']) { const g = groundOnly(x, z, fam); if (isFinite(g)) { worstPoke = Math.max(worstPoke, g - road); if (g > road - .02) roadPoke++; } } } }
  // Gondola cars ride a fixed cable (excluded from grounding): they must clear the ground.
  let gondolaClearance = Infinity;
  if (env.gondolas?.length) {
    const car = env.gondolas[0], saved = car.position.clone(); car.position.set(0, 0, 0); car.rotation.z = 0; car.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car); car.position.copy(saved); car.updateMatrixWorld(true);
    for (let k = 0; k <= 400; k++) { const phase = k / 400, x = -160 + phase * 350, y = 44 + phase * 26 - 10; for (const dx of [box.min.x, 0, box.max.x]) for (const dz of [box.min.z, 0, box.max.z]) { const g = groundAt(x + dx, -135 + dz).y; if (isFinite(g)) gondolaClearance = Math.min(gondolaClearance, y + box.min.y - g); } }
  }
  // The shared signature yard (circuit-signatures.ts) stands at its road's height, outside env.root.
  const {CIRCUIT_SIGNATURE_SITES, circuitSignatureOrigin} = await import('/src/game/circuit-signature-sites.ts');
  const origin = circuitSignatureOrigin(course), radius = CIRCUIT_SIGNATURE_SITES.frostline.radius; let yardLow = Infinity, yardHigh = -Infinity;
  for (let r = 0; r <= radius; r += radius / 4) for (let a = 0; a < 16; a++) { const g = groundAt(origin.x + Math.cos(a * Math.PI / 8) * r, origin.z + Math.sin(a * Math.PI / 8) * r).y - origin.y; yardLow = Math.min(yardLow, g); yardHigh = Math.max(yardHigh, g); }
  let near;
  if (debugNear) { const c = course.sample(debugNear.progress), at = c.position.clone().addScaledVector(c.right, debugNear.lateral); near = props.filter(o => Math.hypot(o.centre.x - at.x, o.centre.z - at.z) < debugNear.radius).map(o => ({family: o.family, kind: o.kind, material: o.material, min: o.aabb.min.toArray().map(v => +v.toFixed(2)), max: o.aabb.max.toArray().map(v => +v.toFixed(2)), ground: +o.groundY.toFixed(2), gapMin: +o.gapMin.toFixed(2), supported: o.supported, byContact: !!o.byContact, buried: o.buried, restsOn: o.restsOn})); }
  // Every grounded-prop exception, itemised when there are few enough to read.
  const exceptions = props.filter(o => o.role === 'prop' && !o.supported && o.gapMin > .5);
  const exceptionList = exceptions.length <= 150 ? exceptions.map(o => { const r = regionOf(o); return {family: o.family, part: o.kind + ':' + o.material + (o.scale ? ':' + o.scale.map(v => +v.toFixed(2)).join('x') : ''), progress: +r.progress.toFixed(4), lateral: +r.lateral.toFixed(1), gap: +o.gapMin.toFixed(2)}; }) : 'too many (' + exceptions.length + ')';
  const buriedList = props.filter(o => o.role === 'prop' && o.buried).slice(0, 150).map(o => { const r = regionOf(o); return {family: o.family, part: o.kind + ':' + o.material, progress: +r.progress.toFixed(4), lateral: +r.lateral.toFixed(1), top: +o.aabb.max.y.toFixed(2), ground: +o.groundY.toFixed(2)}; });
  // Terrain steepness (prop zone = within 300 m of the road): steps between road sections must stay walkable-looking.
  let steep30 = 0, steep45 = 0, tris = 0, maxSlope = 0;
  for (const t of tri) { if (t[10] !== 'terrain heightfield') continue; const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const deg = Math.acos(Math.abs(ny) / Math.hypot(nx, ny, nz)) * 180 / Math.PI; tris++; if (deg > 30) steep30++; if (deg > 45) steep45++; maxSlope = Math.max(maxSlope, deg); }
  return {
    terrainSlope: tris ? {triangles: tris, over30deg: steep30, over45deg: steep45, maxDeg: +maxSlope.toFixed(1)} : null,
    exceptionList, buriedList,
    near,
    gondolaMinClearance: +gondolaClearance.toFixed(2), signatureYardGroundMinusOrigin: [+yardLow.toFixed(2), +yardHigh.toFixed(2)],
    objects: objects.length, ground: groundFamilies, audited: sum, excluded, excludedTotal: Object.values(excluded).reduce((a, b) => a + b, 0),
    groundTriangles: tri.length,
    groundedSummary: {count: grounded.reduce((a, [, f]) => a + f.count, 0), gt05: grounded.reduce((a, [, f]) => a + f.gt05, 0), gt2: grounded.reduce((a, [, f]) => a + f.gt2, 0), gt10: grounded.reduce((a, [, f]) => a + f.gt10, 0), maxGap: Math.max(0, ...grounded.map(([, f]) => f.maxGap))},
    roadContinuity: {checks: roadChecks, terrainAboveRoad: roadPoke, worstTerrainMinusRoad: +worstPoke.toFixed(3)},
    families,
    stats: {meshes: env.stats.meshes, triangles: Math.round(env.stats.triangles)}, supportPasses: passes, supportMs: Math.round(performance.now() - t0),
  };
}
