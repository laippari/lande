// Ympäristö: taivas, aurinko varjoineen ja maa.
//
// Valaistus on ulkovaloa: aurinko on suunnattu valo, jolla on varjot, ja taivas valaisee
// ympäristökartan kautta. Ympäristökartan alapuolisko on auringon valaisemaa maata, joten
// alapinnat saavat lämpimän heijastusvalon niin kuin pihalla.

import * as THREE from 'three/webgpu';
import {
  uniform, float, vec2, vec3, normalize, positionLocal, positionWorld, normalWorldGeometry, cameraPosition,
  dot, max, pow, mix, smoothstep, clamp, length, abs, floor, fract, sin, atan, mx_noise_float, transformNormalToView,
} from 'three/tsl';

const deg = THREE.MathUtils.degToRad;

// shadowBox: laatikko, jonka ympärille varjokartta sovitetaan. groundAO: valinnainen solmu, joka
// kertoo, kuinka paljon taivaasta näkyy maan kohdassa (1 = koko taivas). lightGround: kevyempi
// maan varjostin isoihin näkymiin.
export function createEnvironment(renderer, scene, { shadowSize = 4096, shadowBox, groundAO = null, lightGround = false } = {}) {
  const u = {
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(1, 1, 1)),
    zenith: uniform(new THREE.Color(0.1, 0.2, 0.5)),
    horizon: uniform(new THREE.Color(0.6, 0.7, 0.85)),
    ground: uniform(new THREE.Color(0.3, 0.27, 0.23)), // maan heijastama valo ympäristökartassa
  };

  // Kaukana näkyvä metsänreuna: matala, tumma ja utuinen kaistale, jonka yläreunassa
  // erottuu kuusten latvoja.
  const hash = (n) => fract(sin(n.mul(127.1)).mul(43758.5453));
  const noise = (x) => {
    const i = floor(x);
    const f = x.sub(i);
    return mix(hash(i), hash(i.add(1)), f.mul(f).mul(f.mul(-2).add(3)));
  };
  const treeline = (d) => {
    const az = atan(d.z, d.x);
    const row = (freq, phase, base, tall) => {
      const a = az.mul(freq).add(phase);
      const i = floor(a);
      const f = a.sub(i);
      const tip = (cell, x) => pow(clamp(abs(x.sub(0.5)).mul(-2).add(1), 0, 1), 1.3).mul(hash(cell).mul(0.75).add(0.25));
      const tops = max(tip(i, f), tip(i.add(0.5), fract(f.add(0.5))).mul(0.8));
      const canopy = noise(az.mul(freq * 0.11).add(phase)).mul(0.6).add(noise(az.mul(freq * 0.31)).mul(0.4));
      return float(base).add(canopy.mul(tall * 0.55)).add(tops.mul(tall * 0.45));
    };
    const far = row(260, 0.0, 0.008, 0.018);
    const nearRow = row(150, 1.7, 0.003, 0.03);
    const sunSide = dot(normalize(vec3(d.x, 0, d.z)), normalize(vec3(u.sunDir.x, 0, u.sunDir.z))).mul(0.5).add(0.5);
    const green = mix(vec3(0.012, 0.022, 0.016), vec3(0.04, 0.05, 0.022), sunSide).mul(u.sunColor.x.mul(0.3).add(0.3));
    const farCol = mix(green, u.horizon, 0.5);
    const nearCol = mix(green, u.horizon, 0.22);
    const y = d.y;
    const mFar = smoothstep(far.add(0.0015), far.sub(0.0015), y);
    const mNear = smoothstep(nearRow.add(0.0015), nearRow.sub(0.0015), y);
    return { color: mix(farCol, nearCol, mNear), mask: max(mFar, mNear) };
  };

  // Taivaan väri suuntaan d. Ympäristökarttaan (env) ei piirretä auringon kiekkoa, koska
  // suora valo tulee suunnatusta valosta; horisontin alle tulee maan heijastus.
  const sky = (d, env) => {
    const up = d.y;
    const t = pow(clamp(up, 0, 1), 0.6);
    const base = mix(u.horizon, u.zenith, t);
    const cs = max(dot(d, u.sunDir), 0);
    const glow = u.sunColor.mul(pow(cs, 6).mul(0.1).add(pow(cs, 60).mul(0.25)));
    let c = base.add(glow.mul(smoothstep(-0.05, 0.1, up)));
    if (env) {
      c = mix(u.ground, c, smoothstep(-0.03, 0.03, up));
    } else {
      c = c.mul(1.3).add(u.sunColor.mul(smoothstep(0.99985, 0.99995, cs).mul(6)).add(u.sunColor.mul(pow(cs, 900).mul(1.2))));
      const trees = treeline(d);
      c = mix(c, trees.color, trees.mask);
      c = mix(u.horizon, c, smoothstep(-0.003, 0.0, up));
    }
    return c;
  };

  scene.backgroundNode = sky(normalize(normalWorldGeometry), false);

  // Ympäristökartta piirretään pienestä näkymästä, jossa on vain taivaspallo.
  const envScene = new THREE.Scene();
  const envMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  envMat.colorNode = sky(normalize(positionLocal), true);
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;

  // --- aurinko ---
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize / 2);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.004;
  sun.shadow.radius = 2.5;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xffffff, 35, 320);

  // Varjokartta sovitetaan kohteen ja sen maahan lankeavan varjon ympärille.
  const box = shadowBox;
  const fitShadow = (dir) => {
    const target = box.getCenter(new THREE.Vector3());
    const dist = 14 + box.getSize(new THREE.Vector3()).length();
    sun.position.copy(target).addScaledVector(dir, dist);
    sun.target.position.copy(target);
    const z = dir.clone();
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const p = new THREE.Vector3();
    const add = (v) => {
      v.sub(target);
      x0 = Math.min(x0, v.dot(x)); x1 = Math.max(x1, v.dot(x));
      y0 = Math.min(y0, v.dot(y)); y1 = Math.max(y1, v.dot(y));
      z0 = Math.min(z0, v.dot(z)); z1 = Math.max(z1, v.dot(z));
    };
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      add(p.clone());
      // kulman varjo maassa (pitkät varjot rajataan)
      const k = Math.min(p.y / Math.max(dir.y, 0.05), 3.5 + box.max.y * 2);
      add(p.clone().addScaledVector(dir, -k).setY(0));
    }
    const m = 0.08;
    const cam = sun.shadow.camera;
    cam.left = x0 - m; cam.right = x1 + m; cam.bottom = y0 - m; cam.top = y1 + m;
    cam.near = dist - z1 - 0.5; cam.far = dist - z0 + 0.5;
    cam.updateProjectionMatrix();
  };

  // --- maa: tiivistä hiekkaa, jossa on siellä täällä pikkukiviä ---
  const groundMat = new THREE.MeshStandardNodeMaterial();
  const gp = positionWorld.xz;
  const dist = length(positionWorld.sub(cameraPosition));
  const near = smoothstep(2.5, 9, dist).oneMinus(); // hieno rakenne näkyy vain läheltä
  const mid = smoothstep(3, 11, dist).oneMinus();
  // matala lainehdinta ja jalanjälkien kaltainen epätasaisuus
  const relief = (p) => {
    const swell = mx_noise_float(p.mul(1.1)).mul(0.004).add(mx_noise_float(p.mul(3.9)).mul(0.0025));
    return lightGround ? swell : swell.add(mx_noise_float(p.mul(23)).mul(0.0012).mul(near));
  };
  const macro = mx_noise_float(gp.mul(0.45)).mul(0.6).add(mx_noise_float(gp.mul(2.3)).mul(0.4));
  const grain = lightGround
    ? mx_noise_float(gp.mul(120))
    : mx_noise_float(gp.mul(190)).mul(0.55).add(mx_noise_float(gp.mul(67)).mul(0.45));
  // tummia ja vaaleita hiekanjyviä ja pikkukiviä
  const speck = mx_noise_float(gp.mul(420));
  const flecks = smoothstep(0.45, 0.75, speck).mul(-0.3).add(smoothstep(0.5, 0.8, speck.negate()).mul(0.22));
  const damp = mx_noise_float(gp.mul(1.6).add(31)).mul(0.5).add(0.5); // kosteammat, tummemmat laikut
  const sand = mix(vec3(0.42, 0.357, 0.28), vec3(0.385, 0.328, 0.26), smoothstep(0.35, 0.8, damp));
  groundMat.colorNode = sand.mul(macro.mul(0.05).add(1)).mul(grain.mul(0.16).add(flecks).mul(near).add(1));
  groundMat.roughnessNode = float(0.95);
  groundMat.metalnessNode = float(0);
  const e = 0.004;
  const h0 = relief(gp);
  const hx = relief(gp.add(vec2(e, 0))).sub(h0).div(e).mul(mid);
  const hz = relief(gp.add(vec2(0, e))).sub(h0).div(e).mul(mid);
  // tason oma koordinaatisto: x = maailman x, y = −maailman z, z = ylös
  groundMat.normalNode = transformNormalToView(normalize(vec3(hx.negate(), hz, 1)));

  if (groundAO) groundMat.aoNode = groundAO;

  const ground = new THREE.Mesh(new THREE.CircleGeometry(320, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const state = { azimuth: 0, elevation: 30 };

  // Auringon suunta: atsimuutti asteina x-akselista kohti +z:aa, korkeus asteina.
  function setSun(azimuth, elevation, { environment = true } = {}) {
    state.azimuth = azimuth;
    state.elevation = elevation;
    const el = deg(elevation);
    const az = deg(azimuth);
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    u.sunDir.value.copy(dir);

    // Matalalla aurinko on lämmin ja himmeämpi, taivas syvempi.
    const s = THREE.MathUtils.smoothstep(elevation, 3, 45);
    const sunCol = new THREE.Color(1, 0.7 + 0.27 * s, 0.42 + 0.5 * s);
    const intensity = 5.2 + 5.4 * s;
    sun.color.copy(sunCol);
    sun.intensity = intensity;
    u.sunColor.value.copy(sunCol).multiplyScalar(intensity * 0.35);
    const k = 0.5 + 0.5 * s;
    u.zenith.value.setRGB(0.24 * k, 0.41 * k, 0.8 * k);
    u.horizon.value.setRGB(0.74 * k + 0.16 * (1 - s), 0.86 * k + 0.05 * (1 - s), 1.02 * k);
    // maan heijastama valo: albedo × (aurinko + taivas) / π
    const irr = intensity * Math.sin(el);
    const g = 0.36 / Math.PI;
    u.ground.value.setRGB(g * (irr * sunCol.r + 2.0 * k), g * 0.88 * (irr * sunCol.g + 2.3 * k), g * 0.72 * (irr * sunCol.b + 2.7 * k));
    scene.fog.color.copy(u.horizon.value);

    fitShadow(dir);
    if (environment) updateEnvironment();
  }

  function updateEnvironment() {
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = envTarget.texture;
  }

  // Kameran valotus: matalalla auringolla valoa on vähemmän, joten valotusta nostetaan.
  const exposure = () => 1 + 0.55 * (1 - THREE.MathUtils.smoothstep(state.elevation, 3, 45));

  return { sun, ground, setSun, updateEnvironment, exposure, state, uniforms: u };
}

