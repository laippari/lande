// Hirsimökki rinnetontilla järven rannassa.
//
// Mökki: 12 × 8 m, sisäkorkeus 3 m, lohenpyrstönurkat, valettu sokkeli, neljä ikkunaa järvelle,
// terassi, lasitettu pergola ja palju. Tontti: loiva mäntykangasrinne, jossa metsä ulottuu
// vesirajaan. Mökkiä voi siirtää ja kääntää tontilla: maa muotoutuu sen alle, ja puut, kivet ja
// varvut väistyvät.

import * as THREE from 'three/webgpu';
import { startViewer, showError } from './viewer.js';
import { createEnvironment } from './env.js';
import { planCabin, DIM } from './mokki/plan.js';
import { Timber } from './mokki/mesh.js';
import { createCabinWoodMaterial } from './mokki/wood.js';
import { createRoof, ROOF_LIMITS } from './mokki/roof.js';
import { PLINTH, addFloor, addWindows, glassGeometry, createGlassMaterial, createConcreteMaterial, pillarGeometry, plinthGeometry, ventGeometry } from './mokki/structure.js';
import { TERRACE, buildTerrace, buildGroundworks, footprintBoxes } from './mokki/terrace.js';
import { SITE, heightAt, naturalHeight, setPad, inland, shoreZ, coverAt, sandAt, footprint, footprintDistanceJS, bakeCover, createTerrain } from './tontti/terrain.js';
import { createForest } from './tontti/forest.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, [a, b]) => Math.min(Math.max(v, a), b);
const number = (key, fallback) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);
const HOME = { x: 3, z: -8, yaw: 0 };

const state = {
  roofOn: params.get('katto') !== '0',
  roofType: params.get('tyyppi') === 'harja' ? 'gable' : 'mono',
  front: clamp(number('etu', 0.6), ROOF_LIMITS.front),
  back: clamp(number('taka', 0.5), ROOF_LIMITS.back),
  side: clamp(number('sivu', 0.4), ROOF_LIMITS.side),
  terrace: {
    on: params.get('terassi') !== '0',
    side: params.get('paa') === 'oikea' ? 'right' : 'left',
    tub: { spa: 'spa', ei: 'none' }[params.get('allas')] || 'palju',
    glazing: params.get('lasit') !== '0',
  },
  place: { x: number('x', HOME.x), z: number('z', HOME.z), yaw: THREE.MathUtils.degToRad(number('suunta', 0)) },
  moving: false,
};

// Näkymät. local: kameran paikka ja kohde mökin omassa koordinaatistossa (seuraa mökkiä), muut
// maailman koordinaateissa. sun: [atsimuutti x-akselista kohti järveä, korkeus].
const VIEWS = {
  mokki: { name: 'Mökki', local: true, pos: [-10, 3.4, 21], target: [0, 1.5, 3.2], bias: 0, tall: { local: true, pos: [-2.5, 4.6, 22], target: [0, 1.4, 3.6], bias: 0, fit: true, margin: 0.93, sun: [128, 33] }, sun: [128, 33], fit: true },
  tontti: { name: 'Tontti', pos: [-58, 30, 104], target: [0, 3, -4], sun: [128, 35] },
  terassi: { name: 'Terassi', local: true, pos: [7.5, 2.5, 14.5], target: [-1.6, 1.4, 5.6], sun: [118, 30] },
  nurkka: { name: 'Nurkka', local: true, pos: [-9.0, 1.7, -6.7], target: [-5.9, 1.45, -3.9], sun: [214, 27] },
  ranta: { name: 'Ranta', shore: true, sun: [140, 24] },
  varvikko: { name: 'Varvikko', floor: true, sun: [150, 30] },
};

let scene3d = null;

function build({ renderer, scene, quality, Q }) {
  // --- tontti ---
  const forest = createForest({ quality });
  const terrain = createTerrain(bakeCover(forest.trees));
  terrain.water.layers.set(1);
  scene.add(terrain.mesh, terrain.water, forest.group);

  // --- mökki ---
  const cabin = new THREE.Group();
  cabin.name = 'mökki';
  scene.add(cabin);
  const wood = createCabinWoodMaterial();
  const mesh = (material, cast = true) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    cabin.add(m);
    return m;
  };
  const frame = mesh(wood);
  const works = mesh(wood); // portaat ja kaide: riippuvat maastosta
  const pillars = mesh(createConcreteMaterial()); // terassin harkot
  const plinth = mesh(createConcreteMaterial({ cast: true }));
  plinth.geometry = plinthGeometry();
  const vents = mesh(new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0b, roughness: 0.6, metalness: 0.4 }), false);
  vents.geometry = ventGeometry();
  const glassMaterial = createGlassMaterial();
  const glass = mesh(glassMaterial, false);
  const sliding = mesh(glassMaterial, false);
  glass.renderOrder = 3;
  sliding.renderOrder = 3;
  const roof = createRoof();
  cabin.add(roof.group);
  let parts = null; // altaan ja kaminan osat
  let terracePillars = [];

  const stats = { logs: 0, triangles: 0, roofTriangles: 0, frameMs: 0 };
  let plan = null;
  const swap = (m, geometry) => {
    m.geometry.dispose();
    m.geometry = geometry;
    // tyhjää verkkoa ei piirretä
    m.visible = (geometry.index ? geometry.index.count : geometry.attributes.position.count) > 0;
  };

  const toWorld = (x, y, z) => cabin.localToWorld(new THREE.Vector3(x, y, z));
  const boxes = () => footprintBoxes(state.terrace);

  // Rakennuspaikka: maa tasataan mökin ja terassin alta jalanjäljen luonnollisen maan
  // keskikorkeuteen (leikkaus ja täyttö tasan), ja sokkelia jää näkyviin noin 35 cm.
  const settle = () => {
    const { x, z, yaw } = state.place;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const world = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    let sum = 0, count = 0;
    for (const [bx, bz, hx, hz] of boxes()) {
      if (!(hx > 0)) continue;
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          sum += naturalHeight(...world(bx - hx + (2 * hx * i) / 8, bz - hz + (2 * hz * j) / 8));
          count++;
        }
      }
    }
    const level = sum / count + 0.06;
    const y0 = level + PLINTH.height;
    setPad(state.place, boxes(), level);
    terrain.reshape();
    cabin.position.set(x, y0, z);
    cabin.rotation.y = yaw;
    cabin.updateMatrixWorld(true);
    const groundAt = (lx, lz) => heightAt(...world(lx, lz)) - y0;

    swap(pillars, pillarGeometry(state.terrace.on ? terracePillars : [], groundAt));
    const t = new Timber();
    if (state.terrace.on) buildGroundworks(t, state.terrace, groundAt);
    swap(works, t.build().geometry);

    // kasvit ja kivet väistyvät jalanjäljen alta, ja varvikko seuraa muotoiltua maata
    const [a, b] = boxes();
    footprint.place.value.set(x, z, c, s);
    footprint.boxA.value.set(...a);
    footprint.boxB.value.set(...b);
    footprint.house.value.set(0, 0, DIM.width / 2, DIM.depth / 2);
    footprint.pad.value.set(level, 1);
    // pihapiiri etuseinästä 17 m järvelle päin
    footprint.yard.value.set(0, DIM.depth / 2 + 8.5, 10, 8.5);
    footprint.view.value.set(0, DIM.depth / 2 + 22, 9, 22);
  };

  const rebuildRoof = () => {
    stats.roofTriangles = roof.update(plan, state);
    roof.group.visible = state.roofOn;
  };

  // Runko rakennetaan uudelleen, kun katon tyyppi (seinien korkeus) tai terassi muuttuu.
  const rebuildFrame = () => {
    const t0 = performance.now();
    plan = planCabin({ roofType: state.roofType });
    const timber = new Timber();
    for (const piece of plan.pieces) timber.addLog(piece, plan);
    addFloor(timber);
    const panes = addWindows(timber, plan);
    let slides = [];
    if (parts) cabin.remove(parts);
    parts = null;
    terracePillars = [];
    if (state.terrace.on) {
      const terrace = buildTerrace(timber, state.terrace);
      panes.push(...terrace.glass);
      slides = terrace.sliding;
      parts = terrace.parts;
      terracePillars = terrace.pillars;
      cabin.add(parts);
    }
    const built = timber.build();
    swap(frame, built.geometry);
    swap(glass, glassGeometry(panes));
    swap(sliding, glassGeometry(slides));
    sliding.visible = sliding.visible && state.terrace.glazing;
    stats.logs = built.logs;
    stats.boards = built.boards;
    stats.triangles = built.triangles;
    rebuildRoof();
    settle();
    stats.frameMs = Math.round(performance.now() - t0);
  };
  rebuildFrame();

  // --- ympäristö ---
  const env = createEnvironment(renderer, scene, {
    shadowSize: Q.shadow,
    shadowSquare: true,
    shadowReach: 46,
    staticShadows: true,
    shadowBox: new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 28, 20)),
    flatGround: false,
    fog: [110, 1250],
    groundTint: [0.5, 0.52, 0.36],
  });

  // Varjokartta seuraa kameran kohdetta: lähellä tarkka, kaukaa koko tontin kattava.
  let shadowKey = '';
  const onFrame = (camera, controls) => {
    forest.update(camera);
    const t = controls.target;
    const dist = camera.position.distanceTo(t);
    let r = 17;
    while (r < dist * 0.62 && r < 78) r *= 1.3;
    const snap = r / 4;
    const cx = Math.round(t.x / snap) * snap, cz = Math.round(t.z / snap) * snap;
    const key = `${r.toFixed(1)}|${cx}|${cz}`;
    if (key === shadowKey) return;
    shadowKey = key;
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const h = Math.max(heightAt(cx + dx * r, cz + dz * r), 0);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    env.setShadowBox(new THREE.Box3(new THREE.Vector3(cx - r, lo - 0.5, cz - r), new THREE.Vector3(cx + r, hi + 25, cz + r)));
  };

  // --- näkymät ---
  // varvikkonäkymä: tiheä varvikko tontin etuosassa, mökin jalanjäljen ulkopuolella
  const floorSpot = () => {
    let best = null;
    for (let z = 6; z < 34; z += 1.5) {
      for (let x = -30; x < 30; x += 1.5) {
        if (footprintDistanceJS(state.place, boxes(), x, z) < 4) continue;
        let score = coverAt(x, z) - sandAt(x, z) * 2;
        for (const t of forest.trees) if (t.lod === 0 && Math.hypot(t.x - x, t.z - z) < 1.4) score -= 1;
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    return best || { x: -14, z: 22 };
  };
  // Kuinka paljon tontin puita on kameran ja kohdepisteiden välissä (pihapiiristä kaadettuja
  // ei lasketa). Käytetään valitsemaan kuvakulma, josta mökki näkyy runkojen välistä.
  const yardBox = () => [[0, DIM.depth / 2 + 8.5, 10, 8.5]];
  const blocked = (cx, cz, targets) => {
    let score = 0;
    for (const t of forest.trees) {
      if (t.lod !== 0) continue;
      if (footprintDistanceJS(state.place, yardBox(), t.x, t.z) < 0 || footprintDistanceJS(state.place, boxes(), t.x, t.z) < t.margin) continue;
      for (const [tx, tz] of targets) {
        const dx = tx - cx, dz = tz - cz, len = Math.hypot(dx, dz);
        const u = ((t.x - cx) * dx + (t.z - cz) * dz) / (len * len);
        if (u < 0.03 || u > 0.97) continue;
        const side = Math.abs((t.x - cx) * dz - (t.z - cz) * dx) / len;
        const reach = t.kind === 'pine' ? 0.7 : 2.4;
        if (side < reach) score += (1 - side / reach) * (1.3 - u);
        // aivan kameran edessä oleva puu peittäisi koko kuvan
        if (u * len < 5 && side < 2.5) score += 3;
      }
    }
    return score;
  };
  const resolveView = (view) => {
    if (view.local && view.fit) {
      // kokonaiskuva: kierretään kameraa mökin ympäri, kunnes edessä on vähiten puita
      const target = new THREE.Vector3(...view.target);
      const dir = new THREE.Vector3(...view.pos).sub(target);
      const facade = [-5, 0, 5].map((lx) => {
        const p = toWorld(lx, 1.5, DIM.depth / 2);
        return [p.x, p.z];
      });
      let best = null;
      for (let a = -48; a <= 48; a += 8) {
        const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(a));
        const flat = Math.hypot(d.x, d.z);
        const reachOut = innerWidth / innerHeight < 0.8 ? 35 : 28;
        const probe = toWorld(target.x + (d.x / flat) * reachOut, 2, target.z + (d.z / flat) * reachOut);
        const score = blocked(probe.x, probe.z, facade) + Math.abs(a - (view.bias || 0)) * 0.012;
        if (!best || score < best.score) best = { score, d };
      }
      const pos = target.clone().add(best.d);
      const sun = [view.sun[0] - THREE.MathUtils.radToDeg(state.place.yaw), view.sun[1]];
      return { ...view, pos: toWorld(pos.x, pos.y, pos.z).toArray(), target: toWorld(...view.target).toArray(), sun };
    }
    if (view.local) {
      const sun = [view.sun ? view.sun[0] - THREE.MathUtils.radToDeg(state.place.yaw) : 0, view.sun ? view.sun[1] : 30];
      return { ...view, pos: toWorld(...view.pos).toArray(), target: toWorld(...view.target).toArray(), sun };
    }
    if (view.shore) {
      // järveltä rantaan: veneestä katsottuna rantaviiva, lehtipuureunus ja mökki puiden takana
      const front = toWorld(0, 1.4, DIM.depth / 2);
      let best = null;
      for (let off = -12; off <= 12; off += 1.5) {
        const x = front.x + off, z = shoreZ(x) + 9;
        const score = blocked(x, z, [[front.x - 3, front.z], [front.x + 3, front.z]]) + Math.abs(off) * 0.02;
        if (!best || score < best.score) best = { x, z, score };
      }
      return { ...view, pos: [best.x, 1.7, best.z], target: [front.x, front.y - 0.6, front.z] };
    }
    if (view.floor) {
      const p = floorSpot();
      const h = heightAt(p.x, p.z);
      return { ...view, pos: [p.x + 1.5, h + 0.62, p.z + 2.0], target: [p.x, h + 0.12, p.z] };
    }
    return view;
  };
  const fitCorners = () => {
    const out = [];
    const z1 = state.terrace.on ? DIM.depth / 2 + TERRACE.depth + 0.6 : DIM.depth / 2 + 0.4;
    for (const x of [-DIM.width / 2 - 0.5, DIM.width / 2 + 0.5]) for (const y of [-0.4, plan.roofMax + 0.3]) for (const z of [-DIM.depth / 2 - 0.4, z1]) out.push(toWorld(x, y, z));
    return out;
  };

  // --- mökin siirto ---
  // Jalanjäljen pitää pysyä tontilla ja kuivalla maalla.
  const limit = (p) => {
    const reach = 12.5;
    p.x = Math.min(Math.max(p.x, SITE.x0 + reach), SITE.x1 - reach);
    const d = inland(p.x, p.z);
    if (d < SITE.beach + 4 + reach) p.z -= SITE.beach + 4 + reach - d;
    if (d > SITE.depth - reach) p.z += d - (SITE.depth - reach);
    return p;
  };
  const moveTo = (x, z, yaw = state.place.yaw) => {
    Object.assign(state.place, limit({ x, z }), { yaw });
    settle();
  };
  moveTo(state.place.x, state.place.z);
  const onTap = (raycaster) => {
    if (!state.moving) return false;
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    if (!hit || hit.point.y < 0.2) return true;
    moveTo(hit.point.x, hit.point.z);
    env.refreshShadows();
    return true;
  };

  scene3d = { cabin, roof, rebuildFrame, rebuildRoof, moveTo, stats, forest, terrain, env };
  return {
    env,
    fitCorners,
    resolveView,
    onFrame,
    onTap,
    groundY: (x, z) => Math.max(heightAt(x, z), 0) + 0.3,
    shed: () => forest.shed(),
    focusTargets: () => [frame, terrain.mesh],
    info: () => ({ ...stats, roof: state.roofType, place: { ...state.place, y: cabin.position.y }, forest: forest.stats, terrainTriangles: terrain.triangles }),
  };
}

function wireControls(viewer) {
  const { roof, rebuildFrame, rebuildRoof, moveTo, stats, env } = scene3d;
  const fmt = (v) => `${v.toFixed(2).replace('.', ',')} m`;
  const pressed = (el, on) => el.setAttribute('aria-pressed', String(on));
  const sync = () => {
    pressed($('roofOn'), state.roofOn);
    document.querySelectorAll('[data-roof]').forEach((b) => pressed(b, b.dataset.roof === state.roofType));
    for (const key of ['front', 'back', 'side']) {
      $(key).value = state[key];
      $(`${key}Out`).textContent = fmt(state[key]);
    }
    // etu- ja takaylitystä säädetään vain pulpettikatossa
    $('frontRow').hidden = state.roofType !== 'mono';
    $('backRow').hidden = state.roofType !== 'mono';
    $('sideLabel').textContent = state.roofType === 'mono' ? 'Ylitys sivuilla' : 'Ylitys päädyissä';
    const t = state.terrace;
    pressed($('deckOn'), t.on);
    document.querySelectorAll('[data-end]').forEach((b) => pressed(b, b.dataset.end === t.side));
    document.querySelectorAll('[data-tub]').forEach((b) => pressed(b, b.dataset.tub === t.tub));
    pressed($('glazing'), t.glazing);
    pressed($('moveOn'), state.moving);
    const deg = Math.round(THREE.MathUtils.radToDeg(state.place.yaw));
    $('yaw').value = deg;
    $('yawOut').textContent = `${deg}°`;
    $('facts').textContent = `12 × 8 m · sisäkorkeus 3 m · ${stats.logs} hirttä`;
    $('hint').textContent = state.moving ? 'Napauta maastoa: mökki siirtyy siihen' : 'Vedä · nipistä · kaksoisnapauta tarkentaaksesi';
    $('hint').classList.toggle('gone', !state.moving && $('hint').dataset.seen === '1');
  };
  const redraw = () => {
    sync();
    env.refreshShadows();
    viewer.invalidate();
  };
  setTimeout(() => {
    $('hint').dataset.seen = '1';
  }, 9000);

  $('roofOn').addEventListener('click', () => {
    state.roofOn = !state.roofOn;
    roof.group.visible = state.roofOn;
    redraw();
  });
  document.querySelectorAll('[data-roof]').forEach((b) => b.addEventListener('click', () => {
    if (state.roofType === b.dataset.roof) return;
    state.roofType = b.dataset.roof;
    rebuildFrame();
    redraw();
  }));
  for (const key of ['front', 'back', 'side']) {
    $(key).addEventListener('input', () => {
      state[key] = Number($(key).value);
      rebuildRoof();
      redraw();
    });
  }

  const terrace = (change) => () => {
    change(state.terrace);
    rebuildFrame();
    redraw();
  };
  $('deckOn').addEventListener('click', terrace((t) => { t.on = !t.on; }));
  $('glazing').addEventListener('click', terrace((t) => { t.glazing = !t.glazing; }));
  document.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', terrace((t) => { t.side = b.dataset.end; })));
  document.querySelectorAll('[data-tub]').forEach((b) => b.addEventListener('click', terrace((t) => { t.tub = b.dataset.tub; })));

  $('moveOn').addEventListener('click', () => {
    state.moving = !state.moving;
    redraw();
  });
  $('yaw').addEventListener('input', () => {
    moveTo(state.place.x, state.place.z, THREE.MathUtils.degToRad(Number($('yaw').value)));
    redraw();
  });
  $('placeReset').addEventListener('click', () => {
    moveTo(HOME.x, HOME.z, HOME.yaw);
    redraw();
  });
  // siirtotila päättyy, kun paneeli suljetaan
  document.querySelector('[data-panel="place"]').addEventListener('click', () => {
    if ($('place').hidden && state.moving) {
      state.moving = false;
      redraw();
    }
  });
  viewer.renderer.domElement.addEventListener('pointerup', () => setTimeout(sync, 0));

  sync();
  window.__cabin = { state, stats, rebuildFrame, rebuildRoof, moveTo, sync, site: scene3d };
}

startViewer({ views: VIEWS, defaultView: 'mokki', build, maxDistance: 170, aoRadius: 0.5, sunDefault: [128, 33], far: 1600, portraitFov: 46, maxPolar: 0.62 })
  .then(wireControls)
  .catch(showError);
