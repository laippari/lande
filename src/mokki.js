// Hirsimökki rinnetontilla järven rannassa.
//
// Mökki: 12 × 8 m, sisäkorkeus 3 m, lohenpyrstönurkat, rossipohja betoniharkkopilareilla, neljä
// ikkunaa järvelle, terassi, pergola ja palju. Tontti: loiva harjurinne, mäntykangas, hiekkaranta.
// Mökkiä voi siirtää ja kääntää tontilla; puut, kivet ja varvut väistyvät sen alta.

import * as THREE from 'three/webgpu';
import { startViewer, showError } from './viewer.js';
import { createEnvironment } from './env.js';
import { planCabin, DIM } from './mokki/plan.js';
import { Timber } from './mokki/mesh.js';
import { createCabinWoodMaterial } from './mokki/wood.js';
import { createRoof, ROOF_LIMITS } from './mokki/roof.js';
import { BEAM, PILLAR, pillarSpots, addFloor, addWindows, glassGeometry, createGlassMaterial, createConcreteMaterial, pillarGeometry } from './mokki/structure.js';
import { TERRACE, buildTerrace, buildGroundworks, footprintBoxes } from './mokki/terrace.js';
import { SITE, heightAt, inland, shoreZ, coverAt, sandAt, footprint, footprintDistanceJS, bakeCover, createTerrain } from './tontti/terrain.js';
import { createForest } from './tontti/forest.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, [a, b]) => Math.min(Math.max(v, a), b);
const number = (key, fallback) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);
const HOME = { x: 3, z: 1, yaw: 0 };

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
    screen: params.get('suoja') !== '0',
  },
  place: { x: number('x', HOME.x), z: number('z', HOME.z), yaw: THREE.MathUtils.degToRad(number('suunta', 0)) },
  moving: false,
};

// Näkymät. local: kameran paikka ja kohde mökin omassa koordinaatistossa (seuraa mökkiä), muut
// maailman koordinaateissa. sun: [atsimuutti x-akselista kohti järveä, korkeus].
const VIEWS = {
  mokki: { name: 'Mökki', local: true, pos: [-10, 3.6, 21], target: [0, 1.7, 3.2], tall: { local: true, pos: [-2.5, 5.4, 22], target: [0, 1.6, 3.6] }, sun: [128, 33], fit: true },
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
  const pillars = mesh(createConcreteMaterial());
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

  // Mökin korkeusasema: perustuspalkkien alle jää ylärinteen puolella vähintään 40 cm, ja
  // alarinteen pilarit ovat sen verran pidempiä kuin rinne laskee.
  const settle = () => {
    const { x, z, yaw } = state.place;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ground = (lx, lz) => heightAt(x + lx * c + lz * s, z - lx * s + lz * c);
    let y0 = -Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 6; j++) y0 = Math.max(y0, ground(-DIM.width / 2 + (DIM.width * i) / 8, -DIM.depth / 2 + (DIM.depth * j) / 6) + 0.4 + BEAM.depth);
    if (state.terrace.on) {
      for (const [bx, bz, hx, hz] of boxes()) {
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) y0 = Math.max(y0, ground(bx - hx + (2 * hx * i) / 6, bz - hz + (2 * hz * j) / 6) + 0.3 + 0.16);
      }
    }
    cabin.position.set(x, y0, z);
    cabin.rotation.y = yaw;
    cabin.updateMatrixWorld(true);
    const groundAt = (lx, lz) => ground(lx, lz) - y0;

    const list = pillarSpots().map(([px, pz]) => ({ x: px, z: pz, top: -BEAM.depth - 0.006, size: PILLAR.size }));
    swap(pillars, pillarGeometry(list.concat(state.terrace.on ? terracePillars : []), groundAt));
    const t = new Timber();
    if (state.terrace.on) buildGroundworks(t, state.terrace, groundAt);
    swap(works, t.build().geometry);

    // kasvit ja kivet väistyvät jalanjäljen alta
    const [a, b] = boxes();
    footprint.place.value.set(x, z, c, s);
    footprint.boxA.value.set(...a);
    footprint.boxB.value.set(...b);
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
  const resolveView = (view) => {
    if (view.local) {
      const sun = [view.sun ? view.sun[0] - THREE.MathUtils.radToDeg(state.place.yaw) : 0, view.sun ? view.sun[1] : 30];
      return { ...view, pos: toWorld(...view.pos).toArray(), target: toWorld(...view.target).toArray(), sun };
    }
    if (view.shore) {
      // rannalta vesirajasta ylös mökille
      const front = toWorld(0, 1.4, DIM.depth / 2);
      const x = front.x + 7, z = shoreZ(x) - 0.6;
      return { ...view, pos: [x, heightAt(x, z) + 1.55, z], target: [front.x - 1, front.y + 0.4, front.z] };
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
    for (const x of [-DIM.width / 2 - 0.5, DIM.width / 2 + 0.5]) for (const y of [-1.0, plan.roofMax + 0.3]) for (const z of [-DIM.depth / 2 - 0.4, z1]) out.push(toWorld(x, y, z));
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
    pressed($('screen'), t.screen);
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
  $('screen').addEventListener('click', terrace((t) => { t.screen = !t.screen; }));
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

startViewer({ views: VIEWS, defaultView: 'mokki', build, maxDistance: 170, aoRadius: 0.5, sunDefault: [128, 33], far: 1600 })
  .then(wireControls)
  .catch(showError);
