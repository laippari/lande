// Tontti: loiva mäntykangasrinne, joka laskee järveen.
//
// Esikuvana ovat Mäntyharjun rantatontit (Korpijärvi, Peruvesi, Huuhtjärvi): tasaikäinen
// mäntykangas, jonka pohja on yhtenäistä sammal- ja varpumattoa sammaleisine kivineen. Metsä
// ulottuu vesirajaan asti: rannassa on matala törmä, kivinen rantaviiva ja lehtipuureunus, ja
// hiekkapohja kuultaa matalassa, kirkkaassa mutta ruskehtavassa vedessä.
// Maailman koordinaatisto: järvi on +z-suunnassa, vedenpinta y = 0. Tontti on 90 m leveä ja
// ulottuu rannasta noin 118 m ylös rinteeseen (hieman yli hehtaarin).
//
// Korkeus lasketaan funktiosta heightAt, jota käyttävät maaston verkko, mökin perustus ja
// kamera. Luonnollinen maasto (naturalHeight) muotoillaan mökin kohdalta tasaiseksi (pad):
// maa leikataan ja täytetään mökin ja terassin alta ja liittyy ympäröivään rinteeseen muutaman
// metrin matkalla, minne tahansa mökki siirretään.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, attribute, positionWorld, texture, mix, smoothstep, max, min, abs, length, normalize,
  uniform, cameraPosition, normalWorld, exp, transformNormalToView,
} from 'three/tsl';
import { fbm, noise3 } from '../noise.js';
import { createGroundDetail } from './atlas.js';

export const SITE = { x0: -45, x1: 45, depth: 118, beach: 2 };
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

// Luonnollinen maasto ennen rakentamista.
export function naturalHeight(x, z) {
  const d = inland(x, z);
  if (d < 0) {
    // matala hiekkapohja rannan edessä, sitten syvenee
    const out = -d;
    return -Math.min(0.1 * Math.min(out, 2.5) + 0.3 * Math.max(out - 2.5, 0) + 0.006 * Math.max(out - 2.5, 0) ** 2, 7);
  }
  // kivinen rantaviiva, matala törmä, loiva rinne jossa on tasaisempi hylly, ja harjun laki takana
  // Rinne on noin 9 %: rannasta tontin perälle maa nousee noin 12 m.
  let h = 0.14 * Math.min(d, 0.8) + 0.45 * sstep(0.5, 2.2, d) + 0.088 * Math.max(d - 2.2, 0);
  h -= 0.35 * sstep(26, 56, d);
  h += 2.0 * sstep(68, 118, d);
  h -= 0.012 * Math.max(d - 125, 0);
  // maaston kumpuilu: ei aivan rannassa
  const k = sstep(3, 16, d);
  h += k * ((fbm(x / 24, z / 24, 3, 11) - 0.5) * 1.5 + (fbm(x / 7.5, z / 7.5, 2, 29) - 0.5) * 0.28);
  return h;
}

// --- rakennuspaikan muotoilu ---
// Mökin ja terassin alla maa on tasolla level; jalanjäljen ulkopuolella se liittyy luonnolliseen
// maastoon etäisyydellä PAD.inner…PAD.outer.
export const PAD = { inner: 0.7, outer: 6.5 };
const pad = { on: false, x: 0, z: 0, yaw: 0, level: 0, boxes: [] };

export function setPad(place, boxes, level) {
  Object.assign(pad, { on: true, x: place.x, z: place.z, yaw: place.yaw, level, boxes });
}

export function padWeight(x, z) {
  if (!pad.on || Math.abs(x - pad.x) > 30 || Math.abs(z - pad.z) > 30) return 0;
  return 1 - sstep(PAD.inner, PAD.outer, footprintDistanceJS(pad, pad.boxes, x, z));
}

export function heightAt(x, z) {
  const h = naturalHeight(x, z);
  const w = padWeight(x, z);
  return w > 0 ? h + (pad.level - h) * w : h;
}

// --- kasvupaikka: kuivuus, varpupeite ja paljas hiekka ---
// Kuivuus 0…1: kuivilla, paisteisilla kummuilla kasvaa kanervaa ja jäkälää, tavallisimmin
// puolukkaa ja mustikkaa sammalmatossa, notkoissa mustikkaa.
export function dryness(x, z) {
  return Math.min(Math.max(0.5 + (fbm(x / 19, z / 19, 3, 53) - 0.5) * 2.1 + (fbm(x / 5, z / 5, 2, 71) - 0.5) * 0.35, 0), 1);
}

// paljas hiekka ja sora 0…1: vain kapea kaista vesirajassa (ja järven pohja)
export function sandAt(x, z) {
  const d = inland(x, z);
  const edge = 0.45 + (fbm(x / 5, z / 5, 2, 5) - 0.5) * 0.9;
  return 1 - sstep(edge - 0.35, edge + 0.35, d);
}

// varpujen peittävyys 0…1
export function coverAt(x, z) {
  // Kangasmetsässä varvikko peittää pohjan lähes yhtenäisesti; harvempia kohtia on laikuittain.
  const c = 0.5 + 1.0 * fbm(x / 4.2, z / 4.2, 3, 37) - 0.28 * fbm(x / 1.3, z / 1.3, 2, 43);
  return Math.min(Math.max(c, 0), 1) * (1 - sandAt(x, z));
}

// --- mökin jalanjälki: varjostimet piilottavat kasvit ja kivet sen alta ---
// Kaksi suorakaidetta mökin koordinaatistossa (keskipiste ja puolimitat) sekä mökin paikka ja
// suunta maailmassa.
export const footprint = {
  place: uniform(new THREE.Vector4(0, 0, 1, 0)), // x, z, cos, sin
  boxA: uniform(new THREE.Vector4(0, 0, 6, 4)),
  boxB: uniform(new THREE.Vector4(0, 0, 0, 0)),
  house: uniform(new THREE.Vector4(0, 0, 6, 4)), // pelkkä mökki: sen ympärillä on sorakaista
  pad: uniform(new THREE.Vector2(0, 0)), // muotoillun maan taso ja päällä/pois
  roof: uniform(new THREE.Vector4(0, 0, 6.5, 4.5)), // katon ulottuma: puun runko ei saa osua räystääseen
  // Kameran ympäriltä puut voi piilottaa kuvaamista varten (x, z, säde). Varjot jäävät.
  clear: uniform(new THREE.Vector3(0, 0, 0)),
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

// etäisyys mökin sokkelista
export const houseDistance = (p) => boxDistance(toCabin(p), footprint.house);
// muotoillun maan paino kohdassa p ja korkeus, kun luonnollinen korkeus on y
export const padWeightNode = (p) => footprintDistance(p).smoothstep(PAD.inner, PAD.outer).oneMinus().mul(footprint.pad.y);
export const padLift = (p, y) => mix(y, footprint.pad.x, padWeightNode(p));

// puun etäisyys rakennuksista: jalanjälki tai katon ulottuma
export const buildingDistance = (p) => min(footprintDistance(p), boxDistance(toCabin(p), footprint.roof));
// onko kohta kameran ympäriltä raivatulla alueella
export const cameraCleared = (p) => length(p.sub(footprint.clear.xy)).lessThan(footprint.clear.z);

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

// Metsänpohjan värit (lineaarisia). Pohjakerros on yhtenäinen kellanvihreä sammalmatto
// (seinäsammal, kerrossammal); sen päällä mustikka on raikkaan vihreää ja puolukka tummaa.
export const GROUND = {
  moss: vec3(0.115, 0.135, 0.04),
  mossDark: vec3(0.06, 0.078, 0.03),
  mossYellow: vec3(0.18, 0.175, 0.055),
  mossDry: vec3(0.13, 0.115, 0.05),
  lichen: vec3(0.26, 0.27, 0.22),
  litter: vec3(0.15, 0.098, 0.056),
  lingon: vec3(0.05, 0.085, 0.032),
  bilberry: vec3(0.075, 0.135, 0.04),
  heather: vec3(0.105, 0.09, 0.075),
  sand: vec3(0.24, 0.2, 0.145),
  sandWet: vec3(0.13, 0.11, 0.08),
  bottom: vec3(0.4, 0.31, 0.19),
  soil: vec3(0.085, 0.07, 0.052),
  gravel: vec3(0.082, 0.078, 0.07),
};

// z-akseli: rantaviivan kohdalla tiheämpi, jotta törmä ja vesiraja piirtyvät tarkasti
function zAxis() {
  const core = [];
  for (let z = -78; z < 37 - 1e-6; z += 1.25) core.push(z);
  for (let z = 37; z < 54 - 1e-6; z += 0.5) core.push(z);
  for (let z = 54; z <= 62 + 1e-6; z += 1.25) core.push(z);
  const far = axis(0, 0, 1.25, 900);
  return [...far.filter((z) => z < -78.5), ...core, ...far.filter((z) => z > 62.5)];
}

export function createTerrain(coverTex) {
  const xs = axis(SITE.x0 - 6, SITE.x1 + 6, 1.25, 900);
  const zs = zAxis();
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const nor = new Float32Array(nx * nz * 3);
  const shore = new Float32Array(nx * nz);
  const natural = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], o = j * nx + i;
      natural[o] = naturalHeight(x, z);
      pos.set([x, natural[o], z], o * 3);
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
  const posAttr = new THREE.BufferAttribute(pos, 3);
  const norAttr = new THREE.BufferAttribute(nor, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', norAttr);
  geo.setAttribute('shore', new THREE.BufferAttribute(shore, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  // Korkeudet ja normaalit: luonnollinen maasto ja sen päällä rakennuspaikan muotoilu.
  // Kutsutaan aina, kun mökki siirtyy.
  const reshape = () => {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const o = j * nx + i;
        const w = padWeight(xs[i], zs[j]);
        pos[o * 3 + 1] = w > 0 ? natural[o] + (pad.level - natural[o]) * w : natural[o];
      }
    }
    for (let j = 0; j < nz; j++) {
      const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nz - 1);
      for (let i = 0; i < nx; i++) {
        const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1), o = j * nx + i;
        const gx = (pos[(j * nx + i1) * 3 + 1] - pos[(j * nx + i0) * 3 + 1]) / (xs[i1] - xs[i0]);
        const gz = (pos[(j1 * nx + i) * 3 + 1] - pos[(j0 * nx + i) * 3 + 1]) / (zs[j1] - zs[j0]);
        const l = Math.hypot(gx, 1, gz);
        nor[o * 3] = -gx / l;
        nor[o * 3 + 1] = 1 / l;
        nor[o * 3 + 2] = -gz / l;
      }
    }
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
  };
  reshape();

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
  // pohjakerros: sammalmatto mättäinä, paikoin kellertävää kerrossammalta
  const tone = nB.x.mul(0.5).add(nC.x.mul(0.25).mul(mid)).add(0.5);
  const green = mix(GROUND.mossDark, GROUND.moss, smoothstep(0.1, 0.9, tone));
  const yellow = smoothstep(0.15, 0.6, nB.w.add(nA.z.mul(0.5)));
  const moss = mix(mix(green, GROUND.mossYellow, yellow.mul(0.55)), GROUND.mossDry, smoothstep(0.65, 0.95, dry).mul(0.45));
  // poronjäkälää vain kuivimmilla paikoilla pieninä laikkuina
  const lichenMask = smoothstep(0.76, 0.92, dry).mul(smoothstep(0.2, 0.55, nB.y.add(nC.y.mul(0.3).mul(mid)))).mul(0.5);
  const floor = mix(moss, GROUND.lichen, lichenMask);
  // kenttäkerros: varvikko peittää pohjan sitä enemmän, mitä tiheämpi se on
  const shrub = mix(mix(GROUND.bilberry, GROUND.lingon, smoothstep(0.35, 0.6, dry)), GROUND.heather, smoothstep(0.8, 0.95, dry));
  const shrubMask = smoothstep(0.25, 0.7, cov.g.add(nC.z.mul(0.2).mul(mid))).mul(0.8);
  const veg = mix(floor, shrub.mul(nC.w.mul(0.25).mul(mid).add(1)), shrubMask);
  // kaukaa, missä mättäitä ei enää piirretä, varvikon laikut näkyvät maan värissä
  const farK = smoothstep(22, 55, dist).mul(shrubMask);
  // laaja laikutus: tummempia ja ruskeampia aloja, jottei pohja näytä nurmikolta
  const mottle = mix(vec3(0.66, 0.7, 0.74), vec3(1.1, 1.04, 0.9), smoothstep(-0.5, 0.5, nA.x.add(nB.y.mul(0.3))));
  // Kaukaa varvikko näkyy mättäinä: tummia varpujen latvoja ja vaaleampia sammalaukkoja
  // niiden välissä, ei tasaisena nurmena. Lähellä kuvion tekevät mättäät itse, kauempana
  // varjostin; kuvion koko kasvaa etäisyyden mukana, jottei se suodatu tasaiseksi.
  const fineClumps = smoothstep(-0.35, 0.3, nC.x.add(nB.x.mul(0.5)));
  const wideClumps = smoothstep(-0.4, 0.35, nB.x.add(nA.y.mul(0.8)).add(nB.z.mul(0.4)));
  const clumps = mix(fineClumps, wideClumps, smoothstep(25, 60, dist));
  const shrubDark = mix(GROUND.bilberry, GROUND.lingon, 0.55).mul(0.6);
  const toned = mix(veg.mul(vec3(1.05, 1.0, 0.86)), shrubDark, clumps.mul(shrubMask.add(0.25).min(1)));
  const farK2 = smoothstep(8, 30, dist);
  const patchy = mix(veg, toned, farK2).mul(mottle).mul(mix(float(1), float(0.82), smoothstep(40, 120, dist)));
  // neulaskarike puiden tyvillä
  const litterMask = smoothstep(0.45, 0.95, cov.r.add(nB.z.mul(0.4)).add(nC.x.mul(0.15).mul(mid)));
  const forest = mix(patchy, GROUND.litter.mul(nC.y.mul(0.2).mul(mid).add(1)), litterMask.mul(0.7));
  // vesirajan kapea kivinen hiekkakaista: märkää ja tummaa
  const sandMask = smoothstep(0.35, 0.65, cov.a.add(nB.w.mul(0.12)));
  const wet = smoothstep(0.0, 0.8, d).oneMinus();
  const stones = smoothstep(0.1, 0.45, nC.y.add(nB.z.mul(0.6)));
  const sand = mix(mix(GROUND.sand, GROUND.sandWet, wet), vec3(0.1, 0.095, 0.088), stones.mul(0.6));
  let col = mix(forest, sand, sandMask);
  // sokkelin ympärillä puolen metrin kaista tummaa soraa; terassin alla paljas maa
  const fd = footprintDistance(xz);
  const hd = houseDistance(xz);
  const gravelMask = hd.add(nB.x.mul(0.06)).smoothstep(0.46, 0.6).oneMinus();
  const gravel = GROUND.gravel.mul(nD.x.mul(0.45).mul(near).add(1)).mul(nC.x.mul(0.2).mul(mid).add(1));
  col = mix(col, GROUND.soil, fd.smoothstep(-0.35, 0.05).oneMinus());
  col = mix(col, gravel, gravelMask);
  // hieno rakenne läheltä: sammalen versot, neulaset ja risut kuvasta, rakeisuus kohinasta
  const detail = texture(detailTex, xz.div(1.2)).rgb.mul(2);
  const fineK = smoothstep(2.5, 13, dist).oneMinus().mul(mix(float(1), float(0.4), sandMask)).mul(gravelMask.oneMinus());
  col = col.mul(mix(vec3(1), detail, fineK)).mul(nD.x.mul(0.2).mul(near).add(1));
  // Veden alla hiekkapohja kuultaa läpi: kirkas mutta ruskehtava (humuspitoinen) vesi värjää sen
  // meripihkan sävyiseksi ja tummentaa syvemmällä.
  const depth = max(P.y.negate(), 0);
  const bed = mix(GROUND.bottom, vec3(0.13, 0.12, 0.1), stones.mul(smoothstep(0.2, 1.2, depth).oneMinus().mul(0.5).add(0.2))).mul(nA.y.mul(0.1).add(1));
  const tinted = bed.mul(exp(depth.mul(vec3(-0.85, -1.5, -2.6)))).mul(vec3(1, 0.84, 0.58));
  col = mix(col, tinted, smoothstep(0, 0.06, depth));

  mat.colorNode = col;
  mat.roughnessNode = mix(float(0.96), float(0.55), wet.mul(sandMask));
  mat.metalnessNode = float(0);
  // terassin alle ei näy taivasta
  mat.aoNode = mix(float(0.5), float(1), fd.smoothstep(-0.8, 0.6));
  // mättäiden kohouma varjostuksessa
  const relief = sandMask.oneMinus().mul(gravelMask.oneMinus()).mul(0.8).add(0.2).mul(near);
  const bump = nC.x.mul(0.26).add(nD.y.mul(0.1)).mul(relief);
  const bump2 = nC.z.mul(0.26).add(nD.z.mul(0.1)).mul(relief);
  mat.normalNode = transformNormalToView(normalize(normalWorld.add(vec3(bump, 0, bump2))));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'maasto';

  // --- vesi ---
  // Järvi: ylhäältä katsoen rannan matalikossa näkyy pohja, syvemmällä vesi on tummaa; loivassa
  // kulmassa pinta heijastaa taivaan ja vastarannan.
  const wz = zs.filter((z) => z > 36);
  const wn = wz.length;
  const wpos = new Float32Array(nx * wn * 3);
  const wdep = new Float32Array(nx * wn);
  for (let j = 0; j < wn; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      wpos.set([xs[i], 0, wz[j]], o * 3);
      wdep[o] = -naturalHeight(xs[i], wz[j]);
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
  const toEye = cameraPosition.sub(P);
  const wdist = length(toEye);
  const r1 = noise3(vec3(xz.x.mul(0.9), 1.5, xz.y.mul(0.55)));
  const r2 = noise3(vec3(xz.x.mul(3.1), 5.5, xz.y.mul(2.3)));
  const calm = smoothstep(20, 160, wdist).oneMinus().mul(0.8).add(0.2);
  // pinta peittää pohjan sitä enemmän, mitä syvempää vesi on ja mitä loivemmin sitä katsotaan
  const through = exp(wd.mul(-1.1));
  const graze = toEye.y.div(wdist).oneMinus().pow(4);
  wmat.colorNode = vec3(0.012, 0.022, 0.03);
  wmat.opacityNode = max(through.oneMinus(), graze.mul(0.92)).mul(smoothstep(0.0, 0.04, wd));
  wmat.roughnessNode = float(0.05);
  wmat.metalnessNode = float(0);
  wmat.normalNode = transformNormalToView(normalize(vec3(r1.x.mul(0.035).add(r2.x.mul(0.02)).mul(calm), 1, r1.y.mul(0.05).add(r2.y.mul(0.025)).mul(calm))));
  const water = new THREE.Mesh(wgeo, wmat);
  water.receiveShadow = true;
  water.renderOrder = 2;
  water.name = 'vesi';

  return { mesh, water, reshape, triangles: idx.length / 3 + widx.length / 3 };
}
