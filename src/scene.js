// Mallihirren piha: ympäristö, aluspuut ja veistolastut.

import * as THREE from 'three/webgpu';
import { Fn, float, vec3, attribute, positionLocal, positionWorld, max, min, mix, smoothstep, clamp, sqrt, mx_noise_float } from 'three/tsl';
import { L, HW } from './log/shape.js';
import { createWoodMaterial, SURF } from './log/wood.js';
import { mulberry32 } from './log/hewing.js';
import { createEnvironment as createBaseEnvironment } from './env.js';

export const BEARER = { size: 0.15, length: 1.05, at: [0.85, 4.15] };

export function createEnvironment(renderer, scene, { shadowSize = 4096 } = {}) {
  // Hirsi peittää maalta osan taivaasta: äärettömän pitkän palkin varjostus lasketaan
  // sen poikkileikkauksen kulmista ja häivytetään hirren päissä.
  const logBottom = float(BEARER.size);
  const logTop = float(BEARER.size + 0.33);
  const occlusion = Fn(() => {
    const z = positionWorld.z;
    const s = (ze, ye) => {
      const dz = float(ze).sub(z);
      return dz.div(sqrt(dz.mul(dz).add(ye.mul(ye))));
    };
    const a = s(-HW, logBottom), b = s(HW, logBottom), c = s(-HW, logTop), d = s(HW, logTop);
    const strip = max(max(a, b), max(c, d)).sub(min(min(a, b), min(c, d))).mul(0.5);
    const x = positionWorld.x;
    const along = smoothstep(-0.25, 0.3, x).mul(smoothstep(L - 0.3, L + 0.25, x).oneMinus());
    return clamp(strip.mul(along).mul(0.8), 0, 1).oneMinus();
  });
  const env = createBaseEnvironment(renderer, scene, {
    shadowSize,
    shadowBox: new THREE.Box3(new THREE.Vector3(-0.15, 0, -0.62), new THREE.Vector3(L + 0.15, 0.56, 0.62)),
    groundAO: occlusion(),
  });

  // --- aluspuut: sahattua, pihalla harmaantunutta 150 × 150 -puutavaraa ---
  const bearers = new THREE.Group();
  const bearerShape = {
    length: BEARER.length,
    rButt: 0.21,
    rTop: 0.21,
    flare: 0,
    pithY: [[0.0, 0, 0]],
    pithZ: [[0.0, 0, 0]],
    oval: [[0.012, 2, 0.5, 0.4], [0.006, 3, 0.9, 1.9]],
    rings: 70,
    ringExp: 1.15,
    heart: 0.55,
  };
  BEARER.at.forEach((x, i) => {
    const s = BEARER.size;
    const g = new THREE.BoxGeometry(BEARER.length, s, s);
    // sydän sivussa: sahatavara on rungon reunasta
    const off = i === 0 ? [0.05, -0.035] : [-0.04, 0.06];
    g.translate(BEARER.length / 2, off[0], off[1]);
    const n = g.attributes.normal;
    const surf = new Float32Array(n.count);
    for (let k = 0; k < n.count; k++) surf[k] = Math.abs(n.getX(k)) > 0.5 ? SURF.END : SURF.SAWN;
    g.setAttribute('surf', new THREE.BufferAttribute(surf, 1));
    const mat = createWoodMaterial({ shape: bearerShape, tint: [0.6, 0.59, 0.57], gray: 0.72 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    mesh.position.set(-BEARER.length / 2, -off[0], -off[1]);
    holder.add(mesh);
    holder.rotation.y = Math.PI / 2 + (i === 0 ? 0.035 : -0.05);
    holder.position.set(x, s / 2, i === 0 ? 0.03 : -0.02);
    bearers.add(holder);
  });
  scene.add(bearers);

  // --- veistolastut: piilukirves irrottaa ohuita, käyriä lastuja hirren viereen ---
  const chips = createChips();
  scene.add(chips);

  return { ...env, bearers, chips };
}

// Lastut ovat ohuita, hieman käpristyneitä suikaleita; ne on siroteltu sille puolelle, jolla
// veistäjä on seissyt, ja muutama on lentänyt kauemmas.
function createChips() {
  const rnd = mulberry32(4711);
  const COUNT = 260;
  const base = new THREE.PlaneGeometry(1, 1, 8, 2);
  base.rotateX(-Math.PI / 2); // x = pituus, z = leveys, y = ylös
  const pos = base.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // suippenevat päät: lastu on paksuin ja levein keskeltä
    const taper = Math.pow(Math.max(1 - Math.pow(Math.abs(2 * x), 5), 0), 0.5);
    const zz = z * (0.12 + 0.88 * taper) * (1 + 0.5 * x) + 0.12 * x * x;
    pos.setZ(i, zz);
    // käyristys pituussuunnassa ja lievä kourumaisuus poikittain
    pos.setY(i, 0.5 * x * x + 0.5 * zz * zz * 0.5);
  }
  base.computeVertexNormals();

  const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const tone = attribute('tone', 'vec3');
  const p = positionLocal;
  const streak = mx_noise_float(vec3(p.x.mul(3), p.z.mul(46), tone.x.mul(31)));
  const ringLine = smoothstep(0.55, 0.9, mx_noise_float(vec3(p.x.mul(1.2), p.z.mul(9), tone.y.mul(17))).mul(0.5).add(0.5));
  const chipCol = mix(vec3(0.84, 0.69, 0.43), vec3(0.68, 0.45, 0.22), ringLine.mul(0.6)).mul(streak.mul(0.1).add(1));
  mat.colorNode = chipCol.mul(tone.z);
  mat.roughnessNode = float(0.55).add(streak.mul(0.08));
  mat.metalnessNode = float(0);

  const mesh = new THREE.InstancedMesh(base, mat, COUNT);
  const tones = new Float32Array(COUNT * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const t = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    // useimmat lastut putoavat hirren +z-puolelle 0,2–1,1 m päähän
    const far = rnd() < 0.12;
    const side = rnd() < 0.82 ? 1 : -1;
    const d = far ? 0.9 + rnd() * 1.4 : 0.16 + Math.pow(rnd(), 1.6) * 0.85;
    const x = -0.2 + rnd() * (L + 0.4);
    const len = 0.035 + Math.pow(rnd(), 1.7) * 0.13;
    const wid = 0.014 + rnd() * 0.034;
    const curl = 0.3 + rnd() * 2.6;
    s.set(len, len * curl * 0.5, wid);
    e.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35);
    q.setFromEuler(e);
    t.set(x, 0.004 + rnd() * 0.006, side * d);
    m.compose(t, q, s);
    mesh.setMatrixAt(i, m);
    tones.set([rnd(), rnd(), 0.7 + rnd() * 0.42], i * 3);
  }
  base.setAttribute('tone', new THREE.InstancedBufferAttribute(tones, 3));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
