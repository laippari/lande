// Hirsimökin runko: 14 × 6 m, sisäkorkeus 4 m, lohenpyrstönurkat. Katon voi ottaa pois, sen
// tyypin voi vaihtaa (pulpetti tai harja) ja pulpettikaton ylitystä voi säätää.

import * as THREE from 'three/webgpu';
import { positionWorld, abs, max, length, sqrt, vec2 } from 'three/tsl';
import { startViewer, showError } from './viewer.js';
import { createEnvironment } from './env.js';
import { planCabin, DIM } from './mokki/plan.js';
import { buildFrameGeometry } from './mokki/mesh.js';
import { createCabinWoodMaterial } from './mokki/wood.js';
import { createRoof, ROOF_LIMITS } from './mokki/roof.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (v, [a, b]) => Math.min(Math.max(v, a), b);

const state = {
  roofOn: params.get('katto') !== '0',
  roofType: params.get('tyyppi') === 'harja' ? 'gable' : 'mono',
  front: clamp(Number(params.get('etu') ?? 0.5), ROOF_LIMITS.front),
  side: clamp(Number(params.get('sivu') ?? 0.3), ROOF_LIMITS.side),
};

// Näkymät: kameran paikka ja kohde sekä auringon suunta (atsimuutti x-akselista kohti etuseinää).
const VIEWS = {
  koko: { name: 'Koko mökki', pos: [-11, 6.2, 15.5], target: [0, 2.5, 0], tall: { pos: [-15, 6.5, 9.5], target: [0, 2.4, 0] }, sun: [138, 31], fit: true },
  nurkka: { name: 'Nurkka', pos: [-9.5, 2.4, 5.7], target: [-6.9, 1.95, 2.9], sun: [150, 27] },
  seina: { name: 'Seinä', pos: [-5.4, 1.75, 4.25], target: [-2.4, 1.8, 3.0], sun: [172, 15] },
  paaty: { name: 'Pääty', pos: [-14.2, 3.4, 1.8], target: [-7, 3.0, 0], sun: [200, 30] },
};

let scene3d = null; // rungon ja katon osat, joita katon säätimet muuttavat

function build({ renderer, scene, Q }) {
  const material = createCabinWoodMaterial();
  const frame = new THREE.Mesh(new THREE.BufferGeometry(), material);
  frame.castShadow = true;
  frame.receiveShadow = true;
  scene.add(frame);

  const roof = createRoof();
  scene.add(roof.group);

  const stats = { logs: 0, triangles: 0, roofTriangles: 0, frameMs: 0 };
  let plan = null;
  const rebuildRoof = () => {
    stats.roofTriangles = roof.update(plan, state);
    roof.group.visible = state.roofOn;
  };
  // Katon tyyppi määrää seinien korkeuden ja päätyjen muodon, joten runko rakennetaan uudelleen.
  const rebuildFrame = () => {
    const t0 = performance.now();
    plan = planCabin({ roofType: state.roofType });
    const built = buildFrameGeometry(plan);
    frame.geometry.dispose();
    frame.geometry = built.geometry;
    stats.logs = built.logs;
    stats.triangles = built.triangles;
    stats.frameMs = Math.round(performance.now() - t0);
    rebuildRoof();
  };
  rebuildFrame();

  // sokkeli
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(DIM.width - 0.08, DIM.plinth, DIM.depth - 0.08),
    new THREE.MeshStandardNodeMaterial({ color: 0x8c8983, roughness: 0.93, metalness: 0 }),
  );
  plinth.position.y = DIM.plinth / 2;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);

  // Mökki peittää maalta osan taivaasta: seinän vierellä näkyy taivaasta noin puolet.
  const out = vec2(abs(positionWorld.x).sub(DIM.width / 2), abs(positionWorld.z).sub(DIM.depth / 2));
  const d = length(max(out, 0));
  const wallH = 4.6;
  const groundAO = d.div(sqrt(d.mul(d).add(wallH * wallH))).oneMinus().mul(0.45).oneMinus();

  const env = createEnvironment(renderer, scene, {
    shadowSize: Q.shadow,
    shadowBox: new THREE.Box3(new THREE.Vector3(-8.7, 0, -3.7), new THREE.Vector3(8.7, 6.4, 5.7)),
    groundAO,
    lightGround: true,
  });

  const fitCorners = [];
  for (const x of [-7.4, 7.4]) for (const y of [0.1, 5.7]) for (const z of [-3.6, 3.6]) fitCorners.push(new THREE.Vector3(x, y, z));

  scene3d = { frame, roof, rebuildFrame, rebuildRoof, stats };
  return { env, fitCorners, focusTargets: () => [frame], info: () => ({ ...stats, roof: state.roofType }) };
}

function wireRoofControls(viewer) {
  const { roof, rebuildFrame, rebuildRoof, stats } = scene3d;
  const fmt = (v) => `${v.toFixed(2).replace('.', ',')} m`;
  const sync = () => {
    $('roofOn').setAttribute('aria-pressed', String(state.roofOn));
    document.querySelectorAll('[data-roof]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.roof === state.roofType)));
    $('front').value = state.front;
    $('side').value = state.side;
    $('frontOut').textContent = fmt(state.front);
    $('sideOut').textContent = fmt(state.side);
    // etuylitystä säädetään vain pulpettikatossa
    $('frontRow').hidden = state.roofType !== 'mono';
    $('sideLabel').textContent = state.roofType === 'mono' ? 'Ylitys sivuilla' : 'Ylitys päädyissä';
    $('facts').textContent = `Runko 14 × 6 m · sisäkorkeus 4 m · ${stats.logs} hirttä`;
  };
  $('roofOn').addEventListener('click', () => {
    state.roofOn = !state.roofOn;
    roof.group.visible = state.roofOn;
    sync();
    viewer.invalidate();
  });
  document.querySelectorAll('[data-roof]').forEach((b) => b.addEventListener('click', () => {
    if (state.roofType === b.dataset.roof) return;
    state.roofType = b.dataset.roof;
    rebuildFrame();
    sync();
    viewer.invalidate();
  }));
  for (const key of ['front', 'side']) {
    $(key).addEventListener('input', () => {
      state[key] = Number($(key).value);
      rebuildRoof();
      sync();
      viewer.invalidate();
    });
  }
  sync();
  window.__cabin = { state, stats, rebuildFrame, rebuildRoof, sync };
}

startViewer({ views: VIEWS, defaultView: 'koko', build, maxDistance: 70, aoRadius: 0.5, sunDefault: [138, 31] })
  .then(wireRoofControls)
  .catch(showError);
