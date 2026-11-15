// Tontti: loiva harjurinne, joka laskee järveen.
//
// Esikuvana ovat Etelä-Savon ja Päijänteen harjurannat (Mäntyharju): lajittunutta hiekkaa ja
// soraa, kuivahko mäntykangas, loivasti syvenevä hiekkaranta ja kirkas, hieman ruskea vesi.
// Maailman koordinaatisto: järvi on +z-suunnassa, vedenpinta y = 0. Tontti on 90 m leveä ja
// ulottuu rannasta noin 118 m ylös rinteeseen (hieman yli hehtaarin).
//
// Korkeus lasketaan funktiosta heightAt, jota käyttävät maaston verkko, kasvien ja kivien
// sijoittelu, mökin pilarit ja kamera.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, attribute, positionWorld, texture, mix, smoothstep, clamp, max, min, abs, length, normalize,
  uniform, cameraPosition, normalWorld, exp, transformNormalToView,
} from 'three/tsl';
import { fbm, noise3 } from '../noise.js';
import { createGroundDetail } from './atlas.js';

export const SITE = { x0: -45, x1: 45, depth: 118, beach: 8 };
// kasvillisuuskartan kattama alue (maailman x ja z)
export const MAP = { x0: -112, x1: 112, z0: -150, z1: 74, size: 512 };

const sstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// rantaviivan z kohdassa x: loiva poukama
export const shoreZ = (x) => 46 + 3.2 * Math.sin(x * 0.045 + 0.8) + 2.0 * Math.sin(x * 0.021 - 1.3);

// etäisyys rantaviivasta sisämaahan (m); negatiivinen järvellä
export const inland = (x, z) => shoreZ(x) - z;

export function heightAt(x, z) {
  const d = inland(x, z);
  if (d < 0) return Math.max(d * 0.085 - d * d * 0.0011, -4.5); // loivasti syvenevä hiekkapohja
  // ranta, rantatörmä, loiva rinne jossa on tasaisempi hylly, ja harjun laki tontin takana
  let h = 0.07 * Math.min(d, 6) + 0.045 * Math.max(d - 6, 0);
  h += 0.45 * sstep(6, 11, d);
  h -= 0.55 * sstep(26, 56, d);
  h += 3.0 * sstep(68, 118, d);
  h -= 0.012 * Math.max(d - 125, 0);
  // maaston kumpuilu: ei rannalla
  const k = sstep(7, 24, d);
  h += k * ((fbm(x / 24, z / 24, 3, 11) - 0.5) * 1.5 + (fbm(x / 7.5, z / 7.5, 2, 29) - 0.5) * 0.28);
  return h;
}

// --- kasvupaikka: kuivuus, varpupeite ja paljas hiekka ---
// Kuivuus 0…1: kuivilla, paisteisilla kummuilla kasvaa kanervaa ja jäkälää (kanervatyyppi),
// tavallisimmin puolukkaa (puolukkatyyppi) ja notkoissa mustikkaa ja sammalta (mustikkatyyppi).
export function dryness(x, z) {
  return Math.min(Math.max(0.5 + (fbm(x / 19, z / 19, 3, 53) - 0.5) * 2.1 + (fbm(x / 5, z / 5, 2, 71) - 0.5) * 0.35, 0), 1);
}

// paljas hiekka 0…1: ranta ja hiekkaiset laikut
export function sandAt(x, z) {
  const d = inland(x, z);
  const edge = SITE.beach + (fbm(x / 6, z / 6, 2, 5) - 0.5) * 5;
  const beach = 1 - sstep(edge - 1.2, edge + 1.6, d);
  const patch = sstep(0.75, 0.83, fbm(x / 9, z / 9, 3, 91)) * 0.85;
  return Math.max(beach, patch);
}

// varpujen peittävyys 0…1
export function coverAt(x, z) {
  const c = 0.2 + 1.25 * fbm(x / 4.2, z / 4.2, 3, 37) - 0.35 * fbm(x / 1.3, z / 1.3, 2, 43);
  return Math.min(Math.max(c, 0), 1) * (1 - sandAt(x, z));
}

// --- mökin jalanjälki: varjostimet piilottavat kasvit ja kivet sen alta ---
// Kaksi suorakaidetta mökin koordinaatistossa (keskipiste ja puolimitat) sekä mökin paikka ja
// suunta maailmassa.
export const footprint = {
  place: uniform(new THREE.Vector4(0, 0, 1, 0)), // x, z, cos, sin
  boxA: uniform(new THREE.Vector4(0, 0, 6, 4)),
  boxB: uniform(new THREE.Vector4(0, 0, 0, 0)),
  yard: uniform(new THREE.Vector4(0, 12.5, 10, 8.5)), // pihapiiri mökin edessä: puut on kaadettu
  view: uniform(new THREE.Vector4(0, 24, 9, 20)), // näkymälinja järvelle: matalat puut on raivattu, petäjät jätetty
};

const toCabin = (p) => {
  const d = p.sub(footprint.place.xy);
  const c = footprint.place.z, s = footprint.place.w;
  return vec2(d.x.mul(c).sub(d.y.mul(s)), d.x.mul(s).add(d.y.mul(c)));
};
const boxDistance = (l, b) => {
  const q = abs(l.sub(b.xy)).sub(b.zw);
  return length(max(q, 0)).add(min(max(q.x, q.y), 0));
};

// etäisyys jalanjäljen reunasta maailman pisteessä (negatiivinen sisällä)
export const footprintDistance = (p) => {
  const l = toCabin(p);
  return min(boxDistance(l, footprint.boxA), boxDistance(l, footprint.boxB));
};

// etäisyys pihapiirin reunasta (negatiivinen pihalla)
export const yardDistance = (p) => boxDistance(toCabin(p), footprint.yard);
// etäisyys järvinäkymän raivatusta linjasta
export const viewDistance = (p) => boxDistance(toCabin(p), footprint.view);

// sama JavaScriptissä: boxes = [[cx, cz, hx, hz], …] mökin koordinaatistossa
export function footprintDistanceJS(place, boxes, x, z) {
  const dx = x - place.x, dz = z - place.z;
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  let best = Infinity;
  for (const [cx, cz, hx, hz] of boxes) {
    const qx = Math.abs(lx - cx) - hx, qz = Math.abs(lz - cz) - hz;
    best = Math.min(best, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  return best;
}

// Ruudukko: tiheä tontilla, harveneva kauas.
function axis(a, b, step, far) {
  const v = [];
  for (let x = a; x <= b + 1e-6; x += step) v.push(x);
  let s = step;
  while (v[v.length - 1] < far) {
    s *= 1.38;
    v.push(Math.min(v[v.length - 1] + s, far));
  }
  s = step;
  while (v[0] > -far) {
    s *= 1.38;
    v.unshift(Math.max(v[0] - s, -far));
  }
  return v;
}

// Kasvillisuuskartta: R = neulaskarike puiden alla, G = varpupeite, B = kuivuus, A = paljas hiekka.
export function bakeCover(trees) {
  const n = MAP.size;
  const data = new Uint8Array(n * n * 4);
  const litter = new Float32Array(n * n);
  const sx = (MAP.x1 - MAP.x0) / n, sz = (MAP.z1 - MAP.z0) / n;
  for (const t of trees) {
    const r = t.litter;
    if (!(r > 0)) continue;
    const i0 = Math.max(0, Math.floor((t.x - r - MAP.x0) / sx)), i1 = Math.min(n - 1, Math.ceil((t.x + r - MAP.x0) / sx));
    const j0 = Math.max(0, Math.floor((t.z - r - MAP.z0) / sz)), j1 = Math.min(n - 1, Math.ceil((t.z + r - MAP.z0) / sz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(MAP.x0 + (i + 0.5) * sx - t.x, MAP.z0 + (j + 0.5) * sz - t.z) / r;
        if (d < 1) litter[j * n + i] = Math.max(litter[j * n + i], Math.pow(1 - d, 1.3) * t.litterAmount);
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = MAP.x0 + (i + 0.5) * sx, z = MAP.z0 + (j + 0.5) * sz, o = (j * n + i) * 4;
      data[o] = Math.round(Math.min(litter[j * n + i], 1) * 255);
      data[o + 1] = Math.round(coverAt(x, z) * 255);
      data[o + 2] = Math.round(dryness(x, z) * 255);
      data[o + 3] = Math.round(sandAt(x, z) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// kasvillisuuskartan arvot maailman kohdassa xz
export const coverSample = (tex, xz) => texture(tex, vec2(xz.x.sub(MAP.x0).div(MAP.x1 - MAP.x0), xz.y.sub(MAP.z0).div(MAP.z1 - MAP.z0)));

// Kangasmetsän pohjan värit (lineaarisia): seinäsammal on kellanvihreää, poronjäkälä
// harmaanvalkeaa, puolukka tummaa ja kiiltävää, mustikka kirkkaan vihreää, kanerva ruskeanvihreää.
export const GROUND = {
  moss: vec3(0.085, 0.094, 0.034),
  mossDark: vec3(0.042, 0.054, 0.023),
  mossDry: vec3(0.105, 0.09, 0.048),
  lichen: vec3(0.215, 0.225, 0.185),
  litter: vec3(0.155, 0.098, 0.055),
  lingon: vec3(0.045, 0.075, 0.03),
  bilberry: vec3(0.075, 0.135, 0.04),
  heather: vec3(0.105, 0.09, 0.08),
  sand: vec3(0.4, 0.325, 0.225),
  sandWet: vec3(0.23, 0.185, 0.13),
  soil: vec3(0.19, 0.15, 0.105),
};

export function createTerrain(coverTex) {
  const xs = axis(SITE.x0 - 6, SITE.x1 + 6, 1.25, 900);
  const zs = axis(-78, 62, 1.25, 900);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const shore = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], o = j * nx + i;
      const h = heightAt(x, z);
      pos.set([x, h, z], o * 3);
      const e = 0.4;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      nor.set([-gx / l, 1 / l, -gz / l], o * 3);
      shore[o] = inland(x, z);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const detailTex = createGroundDetail();
  const mat = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const xz = P.xz;
  const d = attribute('shore', 'float');
  const cov = coverSample(coverTex, xz);
  const dist = length(P.sub(cameraPosition));
  const near = smoothstep(4, 16, dist).oneMinus();
  const mid = smoothstep(25, 70, dist).oneMinus();

  // kohina: karkea laikutus, keskikokoinen mätästys ja hieno rakenne
  const nA = noise3(vec3(xz.x.mul(0.37), 0.5, xz.y.mul(0.37)));
  const nB = noise3(vec3(xz.x.mul(1.9), 3.5, xz.y.mul(1.9)));
  const nC = noise3(vec3(xz.x.mul(9.5), 7.5, xz.y.mul(9.5)));
  const nD = noise3(vec3(xz.x.mul(41), 11.5, xz.y.mul(41)));

  const dry = cov.b;
  // pohjakerros: sammalmatto, kuivilla paikoilla ruskeampi ja jäkäläinen
  const moss = mix(mix(GROUND.mossDark, GROUND.moss, nB.x.mul(0.5).add(0.5)), GROUND.mossDry, smoothstep(0.45, 0.85, dry));
  // poronjäkälä kasvaa laikkuina kuivimmilla paikoilla
  const lichenMask = smoothstep(0.58, 0.78, dry).mul(smoothstep(-0.1, 0.55, nB.y.mul(0.5).add(nA.z.mul(0.8)).add(nC.y.mul(0.25).mul(mid)))).mul(0.7);
  const floor = mix(moss, GROUND.lichen.mul(nC.x.mul(0.12).mul(mid).add(1)), lichenMask);
  // kenttäkerros: varvikko peittää pohjan sitä enemmän, mitä tiheämpi se on
  const shrub = mix(mix(GROUND.bilberry, GROUND.lingon, smoothstep(0.3, 0.5, dry)), GROUND.heather, smoothstep(0.6, 0.8, dry));
  const shrubMask = smoothstep(0.2, 0.65, cov.g.add(nC.z.mul(0.2).mul(mid))).mul(0.88);
  const veg = mix(floor, shrub.mul(nC.w.mul(0.25).mul(mid).add(1)), shrubMask);
  // neulaskarike puiden alla
  const litterMask = smoothstep(0.2, 0.8, cov.r.add(nB.z.mul(0.42)).add(nA.w.mul(0.3)).add(nC.x.mul(0.15).mul(mid)));
  // laaja laikutus: tummempia ja ruskeampia aloja, jottei pohja näytä kaukaa nurmikolta
  const mottled = veg.mul(mix(vec3(0.62, 0.66, 0.7), vec3(1.12, 1.05, 0.9), smoothstep(-0.5, 0.5, nA.x.add(nB.x.mul(0.35)))));
  // kaukaa, missä mättäitä ei enää piirretä, varvikon laikut näkyvät maan värissä
  const farK = smoothstep(22, 55, dist).mul(shrubMask);
  const patchy = mottled.mul(mix(float(1), smoothstep(-0.25, 0.35, nB.x).mul(0.55).add(0.68), farK));
  const forest = mix(patchy, GROUND.litter.mul(nC.y.mul(0.2).mul(mid).add(1)), litterMask.mul(0.8));
  // hiekka: ranta ja laikut; vesirajassa märkää ja tummaa
  const sandMask = smoothstep(0.35, 0.65, cov.a.add(nB.w.mul(0.12)));
  const wet = smoothstep(0.1, 0.9, d).oneMinus();
  const sand = mix(GROUND.sand, GROUND.sandWet, wet).mul(nA.x.mul(0.06).add(1));
  // mökin alla ja ympärillä maa on paljasta
  const fd = footprintDistance(xz);
  const yard = smoothstep(0.2, 1.3, fd.add(nB.x.mul(0.35))).oneMinus();
  let col = mix(forest, sand, sandMask);
  col = mix(col, GROUND.soil.mul(nB.y.mul(0.1).add(1)), yard.mul(sandMask.oneMinus()).mul(0.9));
  // hieno rakenne läheltä: sammalen versot, neulaset ja risut kuvasta, hiekanjyvät kohinasta
  const detail = texture(detailTex, xz.div(1.2)).rgb.mul(2);
  const fineK = smoothstep(2.5, 13, dist).oneMinus().mul(mix(float(1), float(0.45), sandMask));
  col = col.mul(mix(vec3(1), detail, fineK)).mul(nD.x.mul(0.2).mul(near).add(1)).mul(nA.y.mul(0.2).add(1));
  // veden alla pohja tummuu ja ruskistuu syvyyden mukana (humuspitoinen vesi)
  const depth = max(P.y.negate(), 0);
  col = mix(col, col.mul(vec3(0.5, 0.36, 0.2)), smoothstep(0, 0.35, depth)).mul(exp(depth.mul(vec3(-0.75, -0.95, -1.35))));

  mat.colorNode = col;
  mat.roughnessNode = mix(float(0.96), float(0.6), wet.mul(sandMask));
  mat.metalnessNode = float(0);
  // mökin alle ei näy taivasta
  const under = smoothstep(-0.4, 1.6, fd);
  mat.aoNode = mix(float(0.55), float(1), under);
  // mättäiden kohouma varjostuksessa
  const bump = nC.x.mul(0.22).add(nD.y.mul(0.1)).mul(near).mul(sandMask.oneMinus().mul(0.8).add(0.2));
  const bump2 = nC.z.mul(0.22).add(nD.z.mul(0.1)).mul(near).mul(sandMask.oneMinus().mul(0.8).add(0.2));
  mat.normalNode = transformNormalToView(normalize(normalWorld.add(vec3(bump, 0, bump2))));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'maasto';

  // --- vesi ---
  // Tyyni järvi: taivas heijastuu, rannassa pohja kuultaa läpi ja syvemmällä vesi tummuu.
  const wz = zs.filter((z) => z > 34);
  const wn = wz.length;
  const wpos = new Float32Array(nx * wn * 3);
  const wdep = new Float32Array(nx * wn);
  for (let j = 0; j < wn; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      wpos.set([xs[i], 0, wz[j]], o * 3);
      wdep[o] = -heightAt(xs[i], wz[j]);
    }
  }
  const widx = new Uint32Array((nx - 1) * (wn - 1) * 6);
  k = 0;
  for (let j = 0; j < wn - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      widx.set([a, c, b, b, c, e], k);
      k += 6;
    }
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
  wgeo.setAttribute('depth', new THREE.BufferAttribute(wdep, 1));
  wgeo.setIndex(new THREE.BufferAttribute(widx, 1));
  wgeo.computeBoundingSphere();
  const wmat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const wd = attribute('depth', 'float');
  const wdist = length(P.sub(cameraPosition));
  const r1 = noise3(vec3(xz.x.mul(0.9), 1.5, xz.y.mul(0.55)));
  const r2 = noise3(vec3(xz.x.mul(3.1), 5.5, xz.y.mul(2.3)));
  const calm = smoothstep(20, 160, wdist).oneMinus().mul(0.8).add(0.2);
  wmat.colorNode = vec3(0.012, 0.02, 0.022);
  wmat.opacityNode = clamp(float(1).sub(exp(wd.mul(-1.7))), 0, 1).mul(smoothstep(0.0, 0.03, wd)).max(smoothstep(0.02, 0.06, wd).mul(0.35));
  wmat.roughnessNode = float(0.05);
  wmat.metalnessNode = float(0);
  wmat.normalNode = transformNormalToView(normalize(vec3(r1.x.mul(0.035).add(r2.x.mul(0.02)).mul(calm), 1, r1.y.mul(0.05).add(r2.y.mul(0.025)).mul(calm))));
  const water = new THREE.Mesh(wgeo, wmat);
  water.receiveShadow = true;
  water.renderOrder = 2;
  water.name = 'vesi';

  return { mesh, water, triangles: idx.length / 3 + widx.length / 3 };
}
