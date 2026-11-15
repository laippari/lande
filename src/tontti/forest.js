// Kangasmetsä: puut, siirtolohkareet ja varvikko.
//
// Tontti on kuivahkoa mäntykangasta (puolukkatyyppi). Valtapuu on mänty: vanhoja, korkealta
// oksattomia petäjiä, joiden yläosan kaarna on oranssia, ja nuorempia mäntyjä niiden välissä.
// Seassa on koivuja, haaparyhmä, alikasvoskuusia ja katajia, ja rannassa leppiä. Harjulla
// lohkareita on harvakseltaan: muutama iso siirtolohkare, pienempiä kiviä ja vesirajassa
// pyöristyneitä mukuloita.
//
// Kaikki on staattista geometriaa muutamassa verkossa. Jokainen kärki tietää kasvinsa tyven
// paikan, ja varjostin kutistaa pisteeksi ne kasvit ja kivet, jotka jäävät mökin jalanjäljen alle
// (ks. footprint, terrain.js): mökkiä siirrettäessä mitään ei rakenneta uudelleen.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, attribute, uv, texture, positionLocal, positionWorld, normalLocal, normalWorld, mix, smoothstep,
  length, normalize, cameraPosition, cameraViewMatrix, transformNormalToView, floor, select, uniform,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE, heightAt, inland, dryness, coverAt, sandAt, footprintDistance, yardDistance, viewDistance, shoreZ } from './terrain.js';
import { noise3, fbm, vnoise } from '../noise.js';
import { mulberry32 } from '../log/hewing.js';
import { createFoliageAtlas, createTuftAtlas, TUFT_HEIGHT } from './atlas.js';

const TAU = Math.PI * 2;
const SPECIES = { pine: 0, birch: 1, aspen: 2, spruce: 3, alder: 4 };
// lehvästön sävyt (lineaarisia kertoimia kuvan väreille)
const TINT = {
  pine: [0.92, 1.0, 0.9],
  birch: [1.0, 1.0, 0.92],
  aspen: [0.95, 1.0, 1.0],
  alder: [0.62, 0.74, 0.62],
  rowan: [0.8, 0.9, 0.66],
  spruce: [0.9, 1.0, 0.95],
  juniper: [0.86, 1.0, 1.02],
};

// --- geometrian keruu ---
class Bark {
  constructor() {
    this.pos = []; this.nor = []; this.base = []; this.bark = []; this.idx = [];
  }

  // Putki pisteiden kautta: pts = [{ p: [x, y, z], r, h }], h = suhteellinen korkeus puussa.
  tube(pts, sides, species, seed, base) {
    const start = this.pos.length / 3;
    let ux = 1, uy = 0, uz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(i - 1, 0)].p, b = pts[Math.min(i + 1, pts.length - 1)].p;
      let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      // u kohtisuoraan suuntaan nähden, jatkuvana renkaasta toiseen
      const d = ux * dx + uy * dy + uz * dz;
      ux -= d * dx; uy -= d * dy; uz -= d * dz;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-4) {
        ux = dy; uy = -dx; uz = 0;
        ul = Math.hypot(ux, uy, uz) || 1;
      }
      ux /= ul; uy /= ul; uz /= ul;
      const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
      const { p, r, h } = pts[i];
      for (let k = 0; k < sides; k++) {
        const an = (k / sides) * TAU, c = Math.cos(an), s = Math.sin(an);
        const nx = ux * c + vx * s, ny = uy * c + vy * s, nz = uz * c + vz * s;
        this.pos.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r);
        this.nor.push(nx, ny, nz);
        this.base.push(base[0], base[1], base[2]);
        this.bark.push(species, h, seed);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = start + i * sides + k, b = start + i * sides + ((k + 1) % sides), c = a + sides, d = b + sides;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('base', new THREE.Float32BufferAttribute(this.base, 3));
    g.setAttribute('bark', new THREE.Float32BufferAttribute(this.bark, 3));
    g.setIndex(this.idx);
    return g;
  }
}

class Foliage {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.base = []; this.tint = []; this.idx = [];
  }

  // Kortti: keskipiste c, puolivektorit right ja up. Normaalit osoittavat latvuksen keskeltä
  // (from) ulospäin, jolloin litteät kortit varjostuvat kuin pyöreä latvus.
  card(c, right, up, tileIndex, tint, base, from) {
    const start = this.pos.length / 3;
    const u0 = (tileIndex % 2) * 0.5 + 0.004, v0 = Math.floor(tileIndex / 2) * 0.5 + 0.004, w = 0.5 - 0.008;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = c[0] + right[0] * sx + up[0] * sy, y = c[1] + right[1] * sx + up[1] * sy, z = c[2] + right[2] * sx + up[2] * sy;
      this.pos.push(x, y, z);
      let nx = x - from[0], ny = y - from[1] + 0.6, nz = z - from[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.nor.push(nx, ny, nz);
      this.uv.push(u0 + ((sx + 1) / 2) * w, v0 + ((1 - sy) / 2) * w); // kuvan yläreuna kortin yläreunaan
      this.base.push(base[0], base[1], base[2]);
      this.tint.push(tint[0], tint[1], tint[2]);
    }
    this.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('base', new THREE.Float32BufferAttribute(this.base, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// --- puut ---
// lod 0: tontin puut, 1: ympäröivä metsä, 2: kaukainen tausta
function growTree(t, B, F, rnd) {
  const { x, z, H, dbh, kind, lod } = t;
  const y0 = heightAt(x, z) - 0.2;
  // matalalatvuksiset puut peittäisivät näkymän: ne merkitään negatiivisella varauksella
  const low = kind !== 'pine';
  const base = [x, z, low ? -t.margin : t.margin];
  const seed = rnd() * 31;
  const species = { pine: 0, youngPine: 0, birch: 1, aspen: 2, rowan: 2, spruce: 3, alder: 4, juniper: 0 }[kind];
  const tint0 = TINT[kind === 'youngPine' ? 'pine' : kind];
  const vary = () => {
    const k = 0.82 + rnd() * 0.36;
    return [tint0[0] * k * (0.96 + rnd() * 0.08), tint0[1] * k, tint0[2] * k * (0.94 + rnd() * 0.12)];
  };

  // runko: hieman kallellaan ja mutkalla
  const leanA = rnd() * TAU, lean = (kind === 'birch' || kind === 'alder' ? 0.05 : 0.025) * rnd() * H;
  const swayA = rnd() * TAU, sway = H * 0.012 * rnd();
  const trunkAt = (u) => [
    x + Math.cos(leanA) * lean * u * u + Math.cos(swayA) * sway * Math.sin(u * 5.3),
    y0 + H * u,
    z + Math.sin(leanA) * lean * u * u + Math.sin(swayA) * sway * Math.sin(u * 5.3),
  ];
  const taper = kind === 'pine' ? 0.72 : 0.9;
  const radiusAt = (u) => Math.max((dbh / 2) * (1 - taper * Math.pow(u, 1.15)) * (u < 0.02 ? 1.35 : u < 0.06 ? 1.12 : 1), 0.012);
  if (kind !== 'juniper') {
    const n = lod === 0 ? (H > 10 ? 8 : 5) : lod === 1 ? 4 : 2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i === 0 ? 0 : i === 1 && lod === 0 ? 0.05 : Math.pow(i / n, 1.15);
      pts.push({ p: trunkAt(u), r: radiusAt(u), h: u });
    }
    B.tube(pts, lod === 0 ? (dbh > 0.2 ? 7 : 5) : lod === 1 ? 5 : 4, species, seed, base);
  }

  // lehvätupsu: vaakakortti ja pystykortit ristissä
  const clump = (c, size, tileIndex, from, flat, shadeK = 1) => {
    const tn = vary().map((v) => v * shadeK);
    const a = rnd() * TAU;
    const tilt = (rnd() - 0.5) * 0.5;
    const h = size * 0.5;
    if (flat > 0) {
      F.card(c, [Math.cos(a) * h, Math.sin(tilt) * h * 0.4, Math.sin(a) * h], [-Math.sin(a) * h, (rnd() - 0.5) * 0.3 * h, Math.cos(a) * h], tileIndex, tn, base, from);
    }
    const nv = lod === 0 ? 2 : 1;
    for (let i = 0; i < nv; i++) {
      const b = a + 0.6 + (i * Math.PI) / nv + rnd() * 0.4;
      const vh = h * (flat > 0 ? 0.62 : 1);
      F.card([c[0], c[1] - (flat > 0 ? 0 : vh * 0.25), c[2]], [Math.cos(b) * h, 0, Math.sin(b) * h], [0, vh, 0], tileIndex, tn, base, from);
    }
  };

  const branch = (u, az, len, rise, r0) => {
    const p0 = trunkAt(u);
    const dx = Math.cos(az), dz = Math.sin(az);
    const p1 = [p0[0] + dx * len * 0.55, p0[1] + rise * len * 0.5, p0[2] + dz * len * 0.55];
    const p2 = [p0[0] + dx * len, p0[1] + rise * len * 0.8, p0[2] + dz * len];
    if (lod === 0) B.tube([{ p: p0, r: r0, h: u }, { p: p1, r: r0 * 0.6, h: u }, { p: p2, r: 0.012, h: u }], 4, species, seed, base);
    return [p1, p2];
  };

  if (kind === 'pine' || kind === 'youngPine') {
    const young = kind === 'youngPine';
    const cb = young ? 0.18 + rnd() * 0.2 : 0.5 + rnd() * 0.2; // latvuksen alaraja
    const Rc = young ? H * (0.2 + rnd() * 0.06) : H * (0.12 + rnd() * 0.05);
    const from = trunkAt(cb + (1 - cb) * 0.45);
    const nb = lod === 0 ? (young ? 7 : 11 + Math.floor(rnd() * 6)) : lod === 1 ? 5 : 2;
    let az = rnd() * TAU;
    for (let k = 0; k < nb; k++) {
      const v = (k + 0.3 + rnd() * 0.5) / nb;
      const u = cb + (1 - cb) * v * 0.93;
      az += 2.2 + rnd() * 0.9;
      const shape = young ? 1 - v * 0.75 : v < 0.3 ? 0.7 + v : 1 - 0.7 * Math.pow((v - 0.3) / 0.7, 1.4);
      const len = Rc * shape * (0.7 + rnd() * 0.5);
      const rise = young ? 0.25 + v * 0.5 : -0.12 + v * 0.75 + rnd() * 0.2;
      const [p1, p2] = branch(u, az, len, rise, radiusAt(u) * 0.42);
      const size = Math.min(Math.max(len * 0.75 + 0.55, 0.8), young ? 1.9 : 2.9) * (lod === 2 ? 1.7 : lod === 1 ? 1.3 : 1);
      clump(p2, size, 0, from, young ? 0 : 1, 0.78 + 0.22 * v);
      if (lod === 0 && len > 1.7) clump(p1, size * 0.8, 0, from, 1, 0.72 + 0.2 * v);
    }
    const tp = trunkAt(0.985);
    clump([tp[0], tp[1] - Rc * 0.1, tp[2]], Rc * (young ? 0.9 : 1.15) * (lod ? 1.4 : 1), 0, from, 1);
    // kuolleet oksantyngät elävän latvuksen alla
    if (lod === 0 && !young) {
      const stubs = 3 + Math.floor(rnd() * 4);
      for (let i = 0; i < stubs; i++) {
        const u = 0.22 + rnd() * (cb - 0.24), a = rnd() * TAU, len = 0.3 + rnd() * 1.1;
        const p0 = trunkAt(u);
        B.tube([{ p: p0, r: 0.022, h: 0.05 }, { p: [p0[0] + Math.cos(a) * len, p0[1] - len * (0.05 + rnd() * 0.3), p0[2] + Math.sin(a) * len], r: 0.008, h: 0.05 }], 3, 3, seed, base);
      }
    }
  } else if (kind === 'birch' || kind === 'alder' || kind === 'aspen' || kind === 'rowan') {
    const tileIndex = kind === 'birch' ? 1 : 2;
    const cb = kind === 'aspen' ? 0.45 + rnd() * 0.12 : kind === 'rowan' ? 0.3 : 0.32 + rnd() * 0.14;
    const Rc = H * (kind === 'aspen' ? 0.13 : kind === 'rowan' ? 0.26 : 0.17) * (0.9 + rnd() * 0.3);
    const from = trunkAt(cb + (1 - cb) * 0.5);
    const nb = lod === 0 ? 9 + Math.floor(rnd() * 5) : lod === 1 ? 5 : 2;
    let az = rnd() * TAU;
    for (let k = 0; k < nb; k++) {
      const v = (k + 0.3 + rnd() * 0.5) / nb;
      const u = cb + (1 - cb) * v * 0.9;
      az += 2.3 + rnd() * 0.8;
      const shape = Math.sin(Math.PI * (0.18 + 0.72 * v));
      const len = Rc * shape * (0.75 + rnd() * 0.5);
      const [, p2] = branch(u, az, len, 0.5 + rnd() * 0.5, radiusAt(u) * 0.4);
      const size = Math.min(Math.max(len * 1.1 + 0.7, 1.0), 3.2) * (lod === 2 ? 1.7 : lod === 1 ? 1.3 : 1);
      clump(p2, size, tileIndex, from, kind === 'birch' ? 0 : 1, 0.8 + 0.2 * v);
      if (lod === 0 && kind !== 'birch') clump([(p2[0] + from[0]) / 2, p2[1], (p2[2] + from[2]) / 2], size * 0.8, tileIndex, from, 0, 0.75);
    }
    const tp = trunkAt(0.97);
    clump(tp, Rc * 1.3, tileIndex, from, kind === 'birch' ? 0 : 1);
  } else if (kind === 'spruce') {
    // oksakerrokset: alhaalla leveät, latvassa kapeat
    const tiers = lod === 0 ? Math.max(4, Math.round(H / 0.9)) : 3;
    const Rb = H * (0.2 + rnd() * 0.05);
    const from = trunkAt(0.4);
    for (let j = 0; j < tiers; j++) {
      const v = j / tiers;
      const u = 0.1 + 0.88 * v;
      const R = Rb * Math.pow(1 - v, 0.85) + 0.12;
      const hgt = (H * 0.9) / tiers * (lod === 0 ? 1.55 : 1.3);
      const p = trunkAt(u);
      const a = rnd() * TAU;
      const tn = vary().map((c) => c * (0.75 + 0.25 * v));
      const nc = lod === 0 ? 3 : 2;
      for (let i = 0; i < nc; i++) {
        const b = a + (i * Math.PI) / nc;
        F.card([p[0], p[1] + hgt * 0.12, p[2]], [Math.cos(b) * R, 0, Math.sin(b) * R], [0, hgt * 0.5, 0], 3, tn, base, from);
      }
    }
  } else if (kind === 'juniper') {
    const from = [x, y0 + H * 0.4, z];
    const a = rnd() * TAU;
    for (let i = 0; i < 3; i++) {
      const b = a + (i * Math.PI) / 3;
      F.card([x, y0 + H * 0.5 + 0.1, z], [Math.cos(b) * H * 0.24, 0, Math.sin(b) * H * 0.24], [0, H * 0.5, 0], 0, vary(), base, from);
    }
  }
}

// Puiden paikat: tontti, ympäröivä metsä ja kaukainen tausta.
function placeTrees(rnd) {
  const trees = [];
  const groves = [[-27, -38], [24, -4]]; // haaparyhmät
  const add = (x, z, lod) => {
    const d = inland(x, z);
    if (d < 6.5 || heightAt(x, z) < 0.35) return;
    const dry = dryness(x, z);
    const grove = groves.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 7);
    const r = rnd();
    let kind;
    if (lod === 2) kind = r < 0.85 ? 'pine' : 'spruce';
    else if (d < 15) kind = r < 0.3 ? 'alder' : r < 0.6 ? 'birch' : r < 0.85 ? 'pine' : 'youngPine';
    else if (grove) kind = r < 0.75 ? 'aspen' : r < 0.9 ? 'rowan' : 'youngPine';
    else if (r < 0.44) kind = 'pine';
    else if (r < 0.68) kind = 'youngPine';
    else if (r < 0.79) kind = 'birch';
    else if (r < 0.88) kind = dry < 0.5 ? 'spruce' : 'juniper';
    else if (r < 0.93) kind = dry > 0.45 ? 'juniper' : 'rowan';
    else if (r < 0.96) kind = 'aspen';
    else kind = 'pine';
    const t = { x, z, kind, lod };
    const q = rnd();
    if (kind === 'pine') {
      t.H = 15 + q * 9; t.dbh = 0.24 + q * 0.2 + rnd() * 0.05; t.margin = 3.2; t.litter = 2.4 + q * 1.4; t.litterAmount = 0.95;
    } else if (kind === 'youngPine') {
      t.H = 2.2 + q * 7.5; t.dbh = 0.04 + q * 0.13; t.margin = 2.6 + t.H * 0.2; t.litter = 0.8 + q; t.litterAmount = 0.6;
    } else if (kind === 'birch') {
      t.H = 9 + q * 10; t.dbh = 0.1 + q * 0.18; t.margin = 3.2 + q; t.litter = 1.4; t.litterAmount = 0.45;
    } else if (kind === 'alder') {
      t.H = 6 + q * 6; t.dbh = 0.09 + q * 0.12; t.margin = 3.2; t.litter = 1.2; t.litterAmount = 0.4;
    } else if (kind === 'aspen') {
      t.H = 12 + q * 8; t.dbh = 0.14 + q * 0.16; t.margin = 3.2; t.litter = 1.6; t.litterAmount = 0.5;
    } else if (kind === 'rowan') {
      t.H = 2.5 + q * 3.5; t.dbh = 0.04 + q * 0.05; t.margin = 3; t.litter = 0;
    } else if (kind === 'spruce') {
      t.H = 1.8 + q * 6.5; t.dbh = 0.04 + q * 0.12; t.margin = 2.4 + t.H * 0.22; t.litter = 1 + q; t.litterAmount = 0.7;
    } else {
      t.H = 0.8 + q * 1.8; t.dbh = 0; t.margin = 1.5; t.litter = 0;
    }
    trees.push(t);
  };
  const zone = (x0, x1, z0, z1, cell, density, lod, skip) => {
    for (let gz = z0; gz < z1; gz += cell) {
      for (let gx = x0; gx < x1; gx += cell) {
        const x = gx + (0.15 + 0.7 * rnd()) * cell, z = gz + (0.15 + 0.7 * rnd()) * cell;
        if (skip(x, z)) continue;
        const thick = 0.55 + 0.9 * fbm(x / 14, z / 14, 2, 7);
        if (rnd() < density * thick) add(x, z, lod);
      }
    }
  };
  const inPlot = (x, z) => x > SITE.x0 && x < SITE.x1 && inland(x, z) < SITE.depth;
  const inRing = (x, z) => x > SITE.x0 - 42 && x < SITE.x1 + 42 && inland(x, z) < SITE.depth + 44;
  zone(SITE.x0, SITE.x1, -78, 46, 3.3, 0.31, 0, (x, z) => !inPlot(x, z));
  zone(SITE.x0 - 42, SITE.x1 + 42, -122, 46, 3.8, 0.36, 1, (x, z) => inPlot(x, z) || !inRing(x, z));
  zone(-230, 230, -260, 46, 7, 0.5, 2, (x, z) => inRing(x, z));
  return trees;
}

// --- kivet ---
function placeBoulders(rnd) {
  const list = [];
  const add = (x, z, r, sink) => list.push({ x, z, r, sink, seed: rnd() * 97 });
  // isot siirtolohkareet ja niiden seuralaiset
  const big = [[-21, 21], [16, 30], [31, -22], [-33, -8], [9, -44], [-12, -64], [37, 12]];
  for (const [x, z] of big) {
    const r = 0.8 + rnd() * 0.9;
    add(x, z, r, 0.32);
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = r * (1.1 + rnd() * 1.3);
      add(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.2 + rnd() * 0.35, 0.4);
    }
  }
  // keskikokoisia kiviä siellä täällä
  for (let i = 0; i < 26; i++) {
    const x = SITE.x0 + 3 + rnd() * (SITE.x1 - SITE.x0 - 6), z = -70 + rnd() * 108;
    if (inland(x, z) < 9) continue;
    add(x, z, 0.22 + rnd() * rnd() * 0.6, 0.45);
  }
  // mukulakivet vesirajassa
  for (let i = 0; i < 70; i++) {
    const x = SITE.x0 - 10 + rnd() * (SITE.x1 - SITE.x0 + 20);
    const cluster = vnoise(x / 9, 3.7, 13);
    if (cluster < 0.45) continue;
    const z = shoreZ(x) - 1.6 + rnd() * 3.2;
    add(x, z, 0.07 + rnd() * rnd() * 0.3, 0.5);
  }
  return list;
}

function boulderGeometry(list) {
  const pos = [], nor = [], base = [], idx = [];
  const proto = [mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('uv').deleteAttribute('normal')), mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('uv').deleteAttribute('normal')), mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('uv').deleteAttribute('normal'))];
  for (const b of list) {
    const g = proto[b.r > 0.7 ? 0 : b.r > 0.2 ? 1 : 2].clone();
    const p = g.attributes.position;
    const sy = 0.62 + ((b.seed * 0.37) % 1) * 0.25, sx = 0.85 + ((b.seed * 0.71) % 1) * 0.4, sz = 0.85 + ((b.seed * 0.13) % 1) * 0.4;
    const yaw = b.seed;
    const y0 = heightAt(b.x, b.z) + b.r * sy * (1 - 2 * b.sink);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      // lohkare: iso muoto, taitteet ja pieni karheus
      const n1 = fbm(x * 1.3 + y * 0.9 + b.seed, z * 1.3 - y * 0.7 + b.seed, 2, 3) - 0.5;
      const n2 = vnoise(x * 3.1 + y * 2.3 + b.seed, z * 3.1 + y * 1.9, 5) - 0.5;
      const facet = Math.abs(vnoise(x * 1.7 - y + b.seed, z * 1.7 + y, 9) - 0.5);
      const r = b.r * (1 + n1 * 0.55 + n2 * 0.12 - facet * 0.25);
      const lx = x * r * sx, lz = z * r * sz;
      p.setXYZ(i, b.x + lx * Math.cos(yaw) - lz * Math.sin(yaw), y0 + y * r * sy, b.z + lx * Math.sin(yaw) + lz * Math.cos(yaw));
    }
    g.computeVertexNormals();
    const start = pos.length / 3;
    pos.push(...p.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < p.count; i++) base.push(b.x, b.z, b.r * 1.1);
    for (const i of g.index.array) idx.push(i + start);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('base', new THREE.Float32BufferAttribute(base, 3));
  out.setIndex(idx);
  return out;
}

// --- materiaalit ---
// näkyvyys: 0 jos kasvin tyvi on mökin jalanjäljen sisällä (varauksen verran reunasta)
const visibleAt = (base) => footprintDistance(base.xy).greaterThan(base.z).toFloat();
// Puut väistyvät lisäksi pihapiiristä, ja matalat puut (varaus negatiivinen) järvinäkymän linjalta.
const treeVisibleAt = (base) => footprintDistance(base.xy).greaterThan(base.z.abs()).toFloat()
  .mul(yardDistance(base.xy).greaterThan(0).toFloat())
  .mul(base.z.greaterThan(0).or(viewDistance(base.xy).greaterThan(0)).toFloat());

function barkMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const base = attribute('base', 'vec3');
  const bark = attribute('bark', 'vec3');
  m.positionNode = positionLocal.mul(treeVisibleAt(base));
  const P = positionWorld;
  const sp = bark.x, h = bark.y, sd = bark.z;
  const is = (id) => sp.greaterThan(id - 0.5).and(sp.lessThan(id + 0.5));
  const furrow = noise3(vec3(P.x.mul(9), P.y.mul(2.1), P.z.mul(9)).add(sd));
  const fine = noise3(vec3(P.x.mul(31), P.y.mul(9), P.z.mul(31)).add(sd));
  const band = noise3(vec3(P.x.mul(5), P.y.mul(55), P.z.mul(5)).add(sd));
  // mänty: alhaalla harmaanruskea kilpikaarna, ylempänä oranssi hilseilevä kaarna
  const plate = smoothstep(-0.35, 0.3, furrow.x.add(fine.x.mul(0.3)));
  const pineLow = mix(vec3(0.06, 0.047, 0.04), vec3(0.27, 0.215, 0.18), plate);
  const pineHigh = mix(vec3(0.3, 0.12, 0.035), vec3(0.56, 0.27, 0.085), furrow.y.mul(0.5).add(0.5)).mul(fine.y.mul(0.15).add(1));
  const pine = mix(pineLow, pineHigh, smoothstep(0.3, 0.55, h.add(furrow.z.mul(0.07))));
  // koivu: valkea tuohi, mustat korkkihuokosjuovat ja tumma rosoinen tyvi
  const marks = smoothstep(0.42, 0.62, band.x.add(furrow.x.mul(0.25)));
  const birch = mix(mix(vec3(0.74, 0.72, 0.66), vec3(0.03, 0.03, 0.03), marks.mul(0.9)), vec3(0.045, 0.04, 0.038), smoothstep(0.04, 0.16, h.add(furrow.y.mul(0.05))).oneMinus());
  // haapa: sileä harmaanvihreä, tyvellä tumma
  const aspen = mix(mix(vec3(0.3, 0.33, 0.24), vec3(0.06, 0.06, 0.05), smoothstep(0.5, 0.7, band.y.add(furrow.x.mul(0.3)))), vec3(0.07, 0.065, 0.055), smoothstep(0.05, 0.2, h).oneMinus());
  const spruce = mix(vec3(0.06, 0.045, 0.038), vec3(0.17, 0.13, 0.11), plate);
  const alder = mix(vec3(0.04, 0.04, 0.038), vec3(0.14, 0.135, 0.125), plate);
  m.colorNode = select(is(SPECIES.pine), pine, select(is(SPECIES.birch), birch, select(is(SPECIES.aspen), aspen, select(is(SPECIES.spruce), spruce, alder))));
  m.roughnessNode = float(0.9);
  m.metalnessNode = float(0);
  return m;
}

function foliageMaterial(atlas) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const base = attribute('base', 'vec3');
  m.positionNode = positionLocal.mul(treeVisibleAt(base));
  const texel = texture(atlas, uv());
  // reunat pehmenevät monilla näytteillä (alpha to coverage); varjokartassa raja on kova
  m.opacityNode = texel.a;
  m.alphaTest = 0.4;
  m.alphaToCoverage = true;
  m.maskShadowNode = texel.a.greaterThan(0.42);
  m.colorNode = texel.rgb.mul(attribute('tint', 'vec3'));
  m.roughnessNode = float(0.78);
  m.metalnessNode = float(0);
  // pyöreän latvuksen normaali kortin omasta suunnasta riippumatta
  m.normalNode = transformNormalToView(normalize(normalLocal));
  return m;
}

function boulderMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const base = attribute('base', 'vec3');
  m.positionNode = positionLocal.mul(visibleAt(base));
  const P = positionWorld;
  const big = noise3(P.mul(1.4));
  const mid = noise3(P.mul(6.5));
  const fine = noise3(P.mul(38));
  // graniitti: harmaa, hieman punertava, rakeinen
  const granite = mix(vec3(0.25, 0.24, 0.225), vec3(0.36, 0.31, 0.28), big.x.mul(0.5).add(0.5)).mul(fine.x.mul(0.2).add(1)).mul(fine.y.mul(0.1).add(1));
  // rupijäkälä laikkuina, sammal lohkareen laella ja varjopuolella tummaa
  const crust = smoothstep(0.05, 0.4, mid.x.add(big.y.mul(0.6)));
  const lichen = mix(vec3(0.42, 0.44, 0.38), vec3(0.2, 0.22, 0.2), mid.y.mul(0.5).add(0.5));
  const up = normalWorld.y;
  const moss = smoothstep(0.45, 0.8, up.add(mid.z.mul(0.35)).add(big.z.mul(0.3)).sub(0.15));
  const rock = mix(granite, lichen, crust.mul(0.6));
  const col = mix(rock, mix(vec3(0.045, 0.07, 0.02), vec3(0.1, 0.13, 0.03), mid.w.mul(0.5).add(0.5)), moss.mul(0.85));
  m.colorNode = col.mul(mix(float(0.55), float(1), smoothstep(-0.6, 0.3, up)));
  m.roughnessNode = float(0.88);
  m.metalnessNode = float(0);
  return m;
}

// --- varvikko ---
// Mättäät ovat ristikkäisiä kortteja, yksi piirtokutsu aluetta kohti. Jokaisella mättäällä on
// paikka ja koko (ip) sekä kierto, kuvaruutu ja korkeussuhde (iq).
// lajit: puolukka, mustikka, kanerva, metsälauha; tile = kuvaruudut, w = mättään leveys (m)
const TUFT = [
  { tile: [0, 4], w: [0.42, 0.58] },
  { tile: [1, 5], w: [0.45, 0.62] },
  { tile: [2, 6], w: [0.45, 0.65] },
  { tile: [3, 7], w: [0.42, 0.6] },
];

function tuftChunks(rnd, atlas, quality) {
  const cards = quality === 'mobile' ? 2 : 3;
  const pos = [], uvs = [], idx = [];
  for (let c = 0; c < cards; c++) {
    const a = (c * Math.PI) / cards, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5, s = c * 4;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const ip = attribute('ip', 'vec4');
  const iq = attribute('iq', 'vec4');
  const local = positionLocal;
  const rx = local.x.mul(iq.x).sub(local.z.mul(iq.y)), rz = local.x.mul(iq.y).add(local.z.mul(iq.x));
  const dist = length(ip.xyz.sub(cameraPosition));
  const range = uniform(60);
  const far = smoothstep(range.mul(0.65), range, dist).oneMinus();
  const shown = footprintDistance(ip.xz).greaterThan(0.15).toFloat().mul(far);
  // tuuli ei puhalla: kortit seisovat paikallaan, latva hieman kallellaan
  m.positionNode = vec3(rx, local.y.mul(iq.w), rz).mul(ip.w).mul(shown).add(ip.xyz);
  const tileIndex = floor(iq.z);
  // kortti näyttää ruudun alaosan kasvin korkeuden verran, joten kuva ei veny
  const tv = uv().y.oneMinus().mul(iq.w).oneMinus();
  const tuv = vec2(uv().x.mul(0.992).add(0.004).add(tileIndex.mod(4)).mul(0.25), tv.mul(0.99).add(0.005).add(floor(tileIndex.div(4))).mul(0.5));
  const texel = texture(atlas, tuv);
  // mättään ääriviiva on kupu, ei kortin suorakaide
  const dome = length(vec2(uv().x.mul(2).sub(1), uv().y.oneMinus())).smoothstep(0.72, 1.02).oneMinus();
  m.maskNode = texel.a.mul(dome).greaterThan(0.4);
  const vary = noise3(vec3(ip.x.mul(0.9), 2.5, ip.z.mul(0.9)));
  m.colorNode = texel.rgb.mul(vary.x.mul(0.14).add(0.68)).mul(mix(float(0.55), float(1), smoothstep(0, 0.5, uv().y.oneMinus())));
  m.roughnessNode = float(0.75);
  m.metalnessNode = float(0);
  // mätäs varjostuu kuten maa sen alla
  m.normalNode = normalize(cameraViewMatrix.transformDirection(vec3(0, 1, 0)));

  const cell = 15, step = quality === 'mobile' ? 0.52 : 0.44;
  const chunks = [];
  let total = 0;
  for (let cz = -78; cz < 46; cz += cell) {
    for (let cx = SITE.x0; cx < SITE.x1; cx += cell) {
      const ipA = [], iqA = [];
      for (let gz = cz; gz < cz + cell - 1e-6; gz += step) {
        for (let gx = cx; gx < cx + cell - 1e-6; gx += step) {
          const x = gx + rnd() * step, z = gz + rnd() * step;
          const d = inland(x, z);
          if (d < 5 || d > SITE.depth) continue;
          const cover = coverAt(x, z);
          if (rnd() > Math.pow(cover, 1.2) * 1.05 + 0.02) continue;
          if (sandAt(x, z) > 0.45) continue;
          const dry = dryness(x, z) + (rnd() - 0.5) * 0.25;
          const r = rnd();
          const kind = dry > 0.62 ? (r < 0.62 ? 2 : r < 0.88 ? 0 : 3) : dry > 0.36 ? (r < 0.6 ? 0 : r < 0.76 ? 1 : r < 0.87 ? 2 : 3) : (r < 0.64 ? 1 : r < 0.85 ? 0 : 3);
          const T = TUFT[kind];
          const w = T.w[0] + rnd() * (T.w[1] - T.w[0]);
          const ratio = TUFT_HEIGHT[kind];
          const a = rnd() * TAU;
          ipA.push(x, heightAt(x, z) - 0.02, z, w);
          iqA.push(Math.cos(a), Math.sin(a), T.tile[rnd() < (kind === 2 ? 0.42 : 0.6) ? 0 : 1], ratio);
        }
      }
      if (!ipA.length) continue;
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.setAttribute('ip', new THREE.InstancedBufferAttribute(new Float32Array(ipA), 4));
      g.setAttribute('iq', new THREE.InstancedBufferAttribute(new Float32Array(iqA), 4));
      g.instanceCount = ipA.length / 4;
      const centre = new THREE.Vector3(cx + cell / 2, heightAt(cx + cell / 2, cz + cell / 2), cz + cell / 2);
      g.boundingSphere = new THREE.Sphere(centre, cell * 0.75 + 2);
      const mesh = new THREE.Mesh(g, m);
      mesh.layers.set(1);
      mesh.receiveShadow = true;
      mesh.userData.centre = centre;
      chunks.push(mesh);
      total += g.instanceCount;
    }
  }
  return { chunks, total, cards, range };
}

export function createForest({ quality }) {
  const rnd = mulberry32(5150);
  const trees = placeTrees(rnd);
  const near = { B: new Bark(), F: new Foliage() };
  const far = { B: new Bark(), F: new Foliage() };
  for (const t of trees) {
    const into = t.lod === 0 ? near : far;
    growTree(t, into.B, into.F, rnd);
  }
  const foliageAtlas = createFoliageAtlas();
  const bark = barkMaterial();
  const foliage = foliageMaterial(foliageAtlas);
  const group = new THREE.Group();
  group.name = 'metsä';
  let triangles = 0;
  const addMesh = (geo, mat, layer, cast) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    if (layer) mesh.layers.set(layer);
    group.add(mesh);
    triangles += geo.index.count / 3;
    return mesh;
  };
  addMesh(near.B.geometry(), bark, 0, true);
  addMesh(near.F.geometry(), foliage, 1, true);
  addMesh(far.B.geometry(), bark, 0, false);
  addMesh(far.F.geometry(), foliage, 1, false);

  const boulders = placeBoulders(rnd);
  addMesh(boulderGeometry(boulders), boulderMaterial(), 0, true);

  const tufts = tuftChunks(rnd, createTuftAtlas(), quality);
  for (const c of tufts.chunks) group.add(c);

  // Varvikko piirretään vain kameran lähellä. Jos laite ei pysy tahdissa, etäisyyttä lyhennetään.
  let level = 0;
  const update = (camera) => {
    const reach = [72, 46, 28][level];
    for (const c of tufts.chunks) c.visible = c.userData.centre.distanceTo(camera.position) < reach;
  };
  const shed = () => {
    if (level >= 2) return false;
    level++;
    tufts.range.value = [60, 38, 22][level];
    return true;
  };

  return {
    group, trees, boulders, update, shed, level: () => level,
    stats: { trees: trees.filter((t) => t.lod === 0).length, forest: trees.length, boulders: boulders.length, tufts: tufts.total, treeTriangles: triangles, tuftTriangles: tufts.total * tufts.cards * 2 },
  };
}
