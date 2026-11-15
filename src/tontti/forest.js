// Mäntykangas: puut, kivet ja varvikko.
//
// Esikuvana ovat Mäntyharjun rantatonttien metsät: tasaikäinen, hoikka ja suora männikkö, jonka
// kaarna on tyvellä harmaanruskeaa kilpikaarnaa ja muutaman metrin korkeudelta ylöspäin oranssia;
// elävä latvus on pieni ja korkealla, ja sen alla rungossa on kuolleita oksantynkiä. Seassa on
// nuoria mäntyjä, alikasvoskuusia, koivuja, haaparyhmä ja katajia. Rannassa metsä ulottuu
// vesirajaan: lepät, koivut ja pajupensaat kallistuvat veden ylle. Maassa on sammaleisia kiviä,
// muutama iso siirtolohkare ja rantaviivassa kivikkoa.
//
// Kaikki on staattista geometriaa muutamassa verkossa. Jokainen kärki tietää kasvinsa tyven
// paikan ja luonnollisen maanpinnan korkeuden: varjostin kutistaa pisteeksi ne kasvit ja kivet,
// jotka jäävät mökin jalanjäljen alle, ja nostaa tai laskee muut muotoillun maan mukana
// (ks. footprint ja pad, terrain.js). Mökkiä siirrettäessä mitään ei rakenneta uudelleen.

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, attribute, uv, texture, positionLocal, positionWorld, normalLocal, normalWorld, mix, smoothstep,
  length, normalize, cameraPosition, cameraViewMatrix, transformNormalToView, floor, select, uniform, min, fract, sin, dot,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE, naturalHeight, inland, dryness, coverAt, sandAt, footprint, footprintDistance, houseDistance, buildingDistance, cameraCleared, padWeightNode, shoreZ } from './terrain.js';
import { noise3, fbm, vnoise } from '../noise.js';
import { mulberry32 } from '../log/hewing.js';
import { createFoliageAtlas, createTuftAtlas, TUFT_HEIGHT } from './atlas.js';

const TAU = Math.PI * 2;
const SPECIES = { pine: 0, birch: 1, aspen: 2, spruce: 3, alder: 4 };
// lehvästön sävyt (kertoimia kuvan väreille)
const TINT = {
  pine: [0.95, 1.0, 0.9],
  birch: [1.0, 1.0, 0.92],
  aspen: [0.95, 1.0, 1.0],
  alder: [0.66, 0.78, 0.64],
  bush: [0.78, 0.9, 0.7],
  rowan: [0.8, 0.9, 0.66],
  spruce: [0.9, 1.0, 0.95],
  juniper: [0.86, 1.0, 1.02],
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// --- geometrian keruu ---
// base = [x, z, varaus, luonnollinen maanpinta]
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
        this.base.push(base[0], base[1], base[2], base[3]);
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
    g.setAttribute('base', new THREE.Float32BufferAttribute(this.base, 4));
    g.setAttribute('bark', new THREE.Float32BufferAttribute(this.bark, 3));
    g.setIndex(this.idx);
    return g;
  }
}

class Foliage {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.base = []; this.tint = []; this.idx = [];
  }

  // Kortti: keskipiste c, puolivektorit right (kuvan vaakasuunta) ja up. Normaalit osoittavat
  // latvuksen keskeltä (from) ulospäin, jolloin litteät kortit varjostuvat kuin pyöreä latvus.
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
      this.base.push(base[0], base[1], base[2], base[3]);
      this.tint.push(tint[0], tint[1], tint[2]);
    }
    this.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('base', new THREE.Float32BufferAttribute(this.base, 4));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// --- puut ---
// lod 0: tontin puut, 1: ympäröivä metsä, 2: kaukainen tausta
function growTree(t, B, F, rnd) {
  const { x, z, H, dbh, kind, lod } = t;
  const ground = naturalHeight(x, z);
  const y0 = ground - 0.25;
  // base: tyven paikka, kuinka lähelle rakennusta puu mahtuu, ja luonnollinen maanpinta
  const base = [x, z, t.margin, ground];
  const seed = rnd() * 31;
  const species = { pine: 0, youngPine: 0, birch: 1, aspen: 2, rowan: 2, spruce: 3, alder: 4, bush: 4, juniper: 0 }[kind];
  const tint0 = TINT[kind === 'youngPine' ? 'pine' : kind];
  const vary = (k0 = 1) => {
    const k = (0.82 + rnd() * 0.36) * k0;
    return [tint0[0] * k * (0.96 + rnd() * 0.08), tint0[1] * k, tint0[2] * k * (0.94 + rnd() * 0.12)];
  };

  // runko: mänty on suora, lehtipuut kallistuvat; rannan puut kurottavat veden ylle
  const leanA = t.leanDir ?? rnd() * TAU;
  const lean = (t.lean ?? (kind === 'pine' || kind === 'youngPine' || kind === 'spruce' ? 0.012 : 0.05) * rnd()) * H;
  const swayA = rnd() * TAU, sway = H * (kind === 'pine' ? 0.004 : 0.012) * rnd();
  const stemAt = (u, la = leanA, ln = lean, ox = 0, oz = 0) => [
    x + ox + Math.cos(la) * ln * u * u + Math.cos(swayA) * sway * Math.sin(u * 5.3),
    y0 + H * u,
    z + oz + Math.sin(la) * ln * u * u + Math.sin(swayA) * sway * Math.sin(u * 5.3),
  ];
  const trunkAt = (u) => stemAt(u);
  const taper = kind === 'pine' ? 0.7 : 0.9;
  const radiusAt = (u) => Math.max((dbh / 2) * (1 - taper * Math.pow(u, 1.2)) * (u < 0.015 ? 1.4 : u < 0.05 ? 1.14 : 1), 0.012);
  if (kind !== 'juniper' && kind !== 'bush') {
    const n = lod === 0 ? (H > 10 ? 8 : 5) : lod === 1 ? 4 : 2;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const u = i === 0 ? 0 : i === 1 && lod === 0 ? 0.045 : Math.pow(i / n, 1.15);
      pts.push({ p: trunkAt(u), r: radiusAt(u), h: u });
    }
    B.tube(pts, lod === 0 ? (dbh > 0.4 ? 9 : dbh > 0.15 ? 6 : 5) : lod === 1 ? 5 : 4, species, seed, base);
  }

  // lehtitupsu: vaakakortti ja pystykortit ristissä
  const clump = (c, size, tileIndex, from, flat, shadeK = 1) => {
    const tn = vary(shadeK);
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

  // Männyn oksa: neulasto on oksan suuntainen viuhka. Yksi kortti makaa oksan tasossa ja toinen
  // seisoo sen päällä pystyssä, joten oksa näyttää oikealta sekä alta että sivulta.
  const bough = (p0, tip, width, from, shadeK) => {
    const axis = sub(tip, p0);
    const start = add(p0, axis, 0.12), end = add(p0, axis, 1.12);
    const half = [(end[0] - start[0]) / 2, (end[1] - start[1]) / 2, (end[2] - start[2]) / 2];
    const centre = add(start, half);
    const side = unit(cross(half, [0, 1, 0]));
    const roll = (rnd() - 0.5) * 0.7;
    const up = unit(cross(side, half));
    const flat = [side[0] * Math.cos(roll) + up[0] * Math.sin(roll), side[1] * Math.cos(roll) + up[1] * Math.sin(roll), side[2] * Math.cos(roll) + up[2] * Math.sin(roll)];
    const tn = vary(shadeK);
    F.card(centre, half, [flat[0] * width, flat[1] * width, flat[2] * width], 0, tn, base, from);
    if (lod === 0 && kind === 'pine') {
      const w2 = width * 0.62;
      F.card(add(centre, up, w2 * 0.25), half, [up[0] * w2, up[1] * w2, up[2] * w2], 0, tn, base, from);
    }
  };

  const limb = (u, az, len, rise, r0, species2 = species) => {
    const p0 = trunkAt(u);
    const dx = Math.cos(az), dz = Math.sin(az);
    const mid = [p0[0] + dx * len * 0.55, p0[1] + rise * len * 0.35, p0[2] + dz * len * 0.55];
    const tip = [p0[0] + dx * len, p0[1] + rise * len, p0[2] + dz * len];
    if (lod === 0) B.tube([{ p: p0, r: r0, h: u }, { p: tip, r: 0.012, h: u }], 3, species2, seed, base);
    return [p0, mid, tip];
  };

  if (kind === 'pine' || kind === 'youngPine') {
    const young = kind === 'youngPine';
    const old = t.veteran;
    // elävän latvuksen alaraja ja latvuksen säde: vanhalla männyllä latvus on leveä ja
    // laakea, ja paksut oksat kiertyvät
    const cb = young ? 0.16 + rnd() * 0.2 : old ? 0.5 + rnd() * 0.12 : 0.62 + rnd() * 0.14;
    const Rc = young ? H * (0.19 + rnd() * 0.06) : old ? 2.6 + H * (0.06 + rnd() * 0.04) : 1.4 + H * (0.03 + rnd() * 0.035);
    const from = trunkAt(cb + (1 - cb) * 0.5);
    const nb = lod === 0 ? (young ? 9 : old ? 20 + Math.floor(rnd() * 6) : 13 + Math.floor(rnd() * 5)) : lod === 1 ? (old ? 9 : 6) : 3;
    let az = rnd() * TAU;
    for (let k = 0; k < nb; k++) {
      const v = (k + 0.3 + rnd() * 0.5) / nb;
      const u = cb + (1 - cb) * v * 0.94;
      az += 2.25 + rnd() * 0.8;
      // latvus on levein alaosastaan ja kapenee latvaan; ylimmät oksat nousevat jyrkemmin
      const shape = young ? 1 - v * 0.72 : v < 0.25 ? 0.75 + v : 1 - 0.72 * Math.pow((v - 0.25) / 0.75, 1.3);
      const len = Rc * shape * (0.72 + rnd() * 0.5) * (lod ? 1.25 : 1);
      const rise = young ? 0.3 + v * 0.6 : -0.08 + v * v * 0.95 + rnd() * 0.2;
      const [p0, , tip] = limb(u, az, len, old ? rise * 0.6 : rise, radiusAt(u) * (old ? 0.3 : 0.36));
      bough(p0, tip, Math.max(len * 0.62, 0.55) * (lod === 2 ? 1.5 : 1), from, 0.8 + 0.22 * v);
    }
    // latva: muutama pysty verso
    const top = trunkAt(0.955);
    const tops = lod === 0 ? 3 : 1;
    for (let i = 0; i < tops; i++) {
      const a = az + (i * TAU) / tops, l = Rc * 0.55;
      bough(top, [top[0] + Math.cos(a) * l * 0.45, top[1] + l * 1.05, top[2] + Math.sin(a) * l * 0.45], Math.max(l * 0.55, 0.4) * (lod ? 1.5 : 1), from, 1.05);
    }
    // kuolleet oksantyngät elävän latvuksen alla
    if (lod === 0 && !young) {
      const stubs = (old ? 9 : 5) + Math.floor(rnd() * 5);
      for (let i = 0; i < stubs; i++) {
        const u = 0.2 + rnd() * (cb - 0.2), a = rnd() * TAU, len = 0.25 + rnd() * 0.9;
        const p0 = trunkAt(u);
        B.tube([{ p: p0, r: old ? 0.035 : 0.018, h: 0.02 }, { p: [p0[0] + Math.cos(a) * len, p0[1] - len * (0.05 + rnd() * 0.35), p0[2] + Math.sin(a) * len], r: 0.006, h: 0.02 }], 3, 3, seed, base);
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
      const [, , tip] = limb(u, az, len, 0.45 + rnd() * 0.4, radiusAt(u) * 0.4);
      const size = Math.min(Math.max(len * 1.1 + 0.7, 1.0), 3.2) * (lod === 2 ? 1.7 : lod === 1 ? 1.3 : 1);
      clump(tip, size, tileIndex, from, kind === 'birch' ? 0 : 1, 0.8 + 0.2 * v);
      if (lod === 0 && kind !== 'birch') clump([(tip[0] + from[0]) / 2, tip[1], (tip[2] + from[2]) / 2], size * 0.8, tileIndex, from, 0, 0.75);
    }
    clump(trunkAt(0.97), Rc * 1.3, tileIndex, from, kind === 'birch' ? 0 : 1);
  } else if (kind === 'bush') {
    // pajupensas: muutama hento varsi samasta tyvestä, lehdet varsien yläosassa
    const stems = 3 + Math.floor(rnd() * 3);
    const from = [x, y0 + H * 0.5, z];
    for (let i = 0; i < stems; i++) {
      const la = leanA + (rnd() - 0.5) * 2.2, ln = H * (0.25 + rnd() * 0.35);
      const pts = [];
      for (let k = 0; k <= 3; k++) pts.push({ p: stemAt(k / 3, la, ln), r: Math.max(0.03 * (1 - k / 3.4), 0.008), h: 0.6 });
      B.tube(pts, 3, species, seed, base);
      clump(stemAt(0.62, la, ln), H * 0.5, 2, from, 1, 0.85);
      clump(stemAt(0.95, la, ln), H * 0.45, 2, from, 1, 1);
    }
  } else if (kind === 'spruce') {
    // oksakerrokset: alhaalla leveät, latvassa kapeat
    const tiers = lod === 0 ? Math.max(4, Math.round(H / 0.9)) : 3;
    const Rb = H * (0.2 + rnd() * 0.05);
    const from = trunkAt(0.4);
    for (let j = 0; j < tiers; j++) {
      const v = j / tiers;
      const u = 0.1 + 0.88 * v;
      const R = Rb * Math.pow(1 - v, 0.85) + 0.12;
      const hgt = ((H * 0.9) / tiers) * (lod === 0 ? 1.55 : 1.3);
      const p = trunkAt(u);
      const a = rnd() * TAU;
      const tn = vary(0.75 + 0.25 * v);
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
      F.card([x, y0 + H * 0.5 + 0.1, z], [0, H * 0.5, 0], [Math.cos(b) * H * 0.22, 0, Math.sin(b) * H * 0.22], 0, vary(), base, from);
    }
  }
}

// Puiden paikat: tontti, ympäröivä metsä, rannan lehtipuureunus ja kaukainen tausta.
function placeTrees(rnd) {
  const trees = [];
  const groves = [[-27, -38], [24, -4]]; // haaparyhmät
  const make = (x, z, kind, lod) => {
    const t = { x, z, kind, lod };
    const q = rnd();
    if (kind === 'pine') {
      if (rnd() < 0.13) {
        // Järeä vanha mänty. Kangasmetsän vanhat männyt ovat 50–80 cm paksuja; Suomen
        // suurimpien ympärysmitta on lähes 4 m (läpimitta yli metrin).
        t.veteran = true;
        t.H = 24 + q * 5; t.dbh = 0.48 + q * 0.3 + rnd() * 0.05; t.litter = 2.4 + q; t.litterAmount = 1;
      } else {
        t.H = 16.5 + q * 6.5; t.dbh = 0.17 + q * 0.11 + rnd() * 0.03; t.litter = 1.1 + q * 0.7; t.litterAmount = 0.95;
      }
      t.margin = t.dbh / 2 + 0.35;
    } else if (kind === 'youngPine') {
      t.H = 2.2 + q * 7.5; t.dbh = 0.04 + q * 0.12; t.margin = 0.5 + t.H * 0.1; t.litter = 0.6 + q * 0.6; t.litterAmount = 0.6;
    } else if (kind === 'birch') {
      t.H = 8 + q * 10; t.dbh = 0.08 + q * 0.15; t.margin = 0.9; t.litter = 0.9; t.litterAmount = 0.5;
    } else if (kind === 'alder') {
      t.H = 5 + q * 5; t.dbh = 0.08 + q * 0.1; t.margin = 0.9; t.litter = 0.8; t.litterAmount = 0.4;
    } else if (kind === 'aspen') {
      t.H = 12 + q * 8; t.dbh = 0.13 + q * 0.14; t.margin = 0.7; t.litter = 1; t.litterAmount = 0.5;
    } else if (kind === 'rowan') {
      t.H = 2.5 + q * 3.5; t.dbh = 0.04 + q * 0.05; t.margin = 0.9; t.litter = 0;
    } else if (kind === 'bush') {
      t.H = 2.2 + q * 2.6; t.dbh = 0.03; t.margin = 0.9; t.litter = 0;
    } else if (kind === 'spruce') {
      t.H = 1.6 + q * 5.5; t.dbh = 0.04 + q * 0.1; t.margin = 0.4 + t.H * 0.12; t.litter = 0.8 + q * 0.6; t.litterAmount = 0.7;
    } else {
      t.H = 0.8 + q * 1.8; t.dbh = 0; t.margin = 0.6; t.litter = 0;
    }
    trees.push(t);
    return t;
  };
  const grow = (x, z, lod) => {
    const d = inland(x, z);
    if (d < 4.5) return; // vesirajan reunus istutetaan erikseen
    const dry = dryness(x, z);
    const grove = groves.some(([gx, gz]) => Math.hypot(x - gx, z - gz) < 7);
    const r = rnd();
    let kind;
    if (lod === 2) kind = r < 0.88 ? 'pine' : 'spruce';
    else if (grove) kind = r < 0.75 ? 'aspen' : r < 0.9 ? 'rowan' : 'youngPine';
    else if (r < 0.66) kind = 'pine';
    else if (r < 0.77) kind = 'youngPine';
    else if (r < 0.85) kind = 'birch';
    else if (r < 0.93) kind = dry < 0.6 ? 'spruce' : 'juniper';
    else if (r < 0.96) kind = dry > 0.5 ? 'juniper' : 'rowan';
    else kind = 'pine';
    make(x, z, kind, lod);
  };
  const zone = (x0, x1, z0, z1, cell, density, lod, skip) => {
    for (let gz = z0; gz < z1; gz += cell) {
      for (let gx = x0; gx < x1; gx += cell) {
        const x = gx + (0.15 + 0.7 * rnd()) * cell, z = gz + (0.15 + 0.7 * rnd()) * cell;
        if (skip(x, z)) continue;
        const thick = 0.6 + 0.8 * fbm(x / 14, z / 14, 2, 7);
        if (rnd() < density * thick) grow(x, z, lod);
      }
    }
  };
  const inPlot = (x, z) => x > SITE.x0 && x < SITE.x1 && inland(x, z) < SITE.depth;
  const inRing = (x, z) => x > SITE.x0 - 42 && x < SITE.x1 + 42 && inland(x, z) < SITE.depth + 44;
  zone(SITE.x0, SITE.x1, -78, 50, 3.0, 0.4, 0, (x, z) => !inPlot(x, z));
  zone(SITE.x0 - 42, SITE.x1 + 42, -122, 50, 3.6, 0.4, 1, (x, z) => inPlot(x, z) || !inRing(x, z));
  zone(-230, 230, -260, 50, 8.5, 0.6, 2, (x, z) => inRing(x, z));

  // Rannan reunus: lepät, koivut ja pajupensaat kasvavat aivan vesirajassa ja kurottavat veden
  // ylle. Vesi on +z-suunnassa.
  for (let x = -190; x < 190; x += 1.1 + rnd() * 1.3) {
    const d = 0.9 + rnd() * 3.6;
    const z = shoreZ(x) - d;
    const r = rnd();
    const kind = r < 0.34 ? 'alder' : r < 0.58 ? 'birch' : r < 0.9 ? 'bush' : 'rowan';
    const lod = Math.abs(x) < SITE.x1 ? 0 : Math.abs(x) < SITE.x1 + 42 ? 1 : 2;
    if (lod === 2 && kind === 'bush') continue;
    const t = make(x, z, kind, lod);
    t.fringe = true;
    t.leanDir = Math.PI / 2 + (rnd() - 0.5) * 0.9;
    t.lean = 0.08 + rnd() * 0.16;
    if (kind === 'birch') t.H = 6 + rnd() * 6;
  }
  return trees;
}

// --- kivet ---
function placeBoulders(rnd) {
  const list = [];
  const put = (x, z, r, sink, flat = 1) => list.push({ x, z, r, sink, flat, seed: rnd() * 97 });
  // isot siirtolohkareet ja niiden seuralaiset
  const big = [[-21, 21], [16, 30], [31, -22], [-33, -8], [9, -44], [-12, -64], [37, 12]];
  for (let i = 0; i < 14; i++) {
    const x = SITE.x0 + 4 + rnd() * (SITE.x1 - SITE.x0 - 8), z = -74 + rnd() * 112;
    if (inland(x, z) > 6) big.push([x, z]);
  }
  for (const [x, z] of big) {
    const r = 0.8 + rnd() * 0.9;
    put(x, z, r, 0.32);
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = r * (1.1 + rnd() * 1.3);
      put(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.2 + rnd() * 0.35, 0.4);
    }
  }
  // sammaleiset maakivet: matalia, puoliksi maan sisässä, ryhminä
  for (let i = 0; i < 520; i++) {
    const x = SITE.x0 + 2 + rnd() * (SITE.x1 - SITE.x0 - 4), z = -72 + rnd() * 116;
    if (inland(x, z) < 3 || vnoise(x / 11, z / 11, 61) < 0.36) continue;
    put(x, z, 0.16 + rnd() * rnd() * 0.5, 0.5, 0.7);
  }
  // kivinen rantaviiva
  for (let x = -110; x < 110; x += 0.5 + rnd() * 1.1) {
    if (vnoise(x / 7, 3.7, 13) < 0.3) continue;
    const z = shoreZ(x) - 1.3 + rnd() * 2.5;
    put(x, z, 0.07 + rnd() * rnd() * (rnd() < 0.08 ? 0.75 : 0.32), 0.45, 0.85);
  }
  return list;
}

function boulderGeometry(list) {
  const pos = [], nor = [], base = [], idx = [];
  const ico = (detail) => mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('uv').deleteAttribute('normal'));
  const proto = [ico(3), ico(2), ico(1)];
  for (const b of list) {
    const g = proto[b.r > 0.7 ? 0 : b.r > 0.28 ? 1 : 2].clone();
    const p = g.attributes.position;
    const sy = (0.62 + ((b.seed * 0.37) % 1) * 0.25) * b.flat, sx = 0.85 + ((b.seed * 0.71) % 1) * 0.4, sz = 0.85 + ((b.seed * 0.13) % 1) * 0.4;
    const yaw = b.seed;
    const ground = naturalHeight(b.x, b.z);
    const y0 = ground + b.r * sy * (1 - 2 * b.sink);
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
    for (let i = 0; i < p.count; i++) base.push(b.x, b.z, b.r * 1.1 + 0.6, ground);
    for (const i of g.index.array) idx.push(i + start);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('base', new THREE.Float32BufferAttribute(base, 4));
  out.setIndex(idx);
  return out;
}

// --- materiaalit ---
// Kasvi tai kivi seuraa muotoiltua maata: tyven kohdalla maa on noussut tai laskenut.
const lifted = (base) => {
  const dy = footprint.pad.x.sub(base.w).mul(padWeightNode(base.xy));
  return vec3(positionLocal.x, positionLocal.y.add(dy), positionLocal.z);
};
// näkyvyys: 0 jos tyvi on mökin jalanjäljen sisällä (varauksen verran reunasta)
const visibleAt = (base) => footprintDistance(base.xy).greaterThan(base.z).toFloat();
// Puut väistyvät lisäksi pihapiiristä, ja matalat puut (varaus negatiivinen) järvinäkymän linjalta.
// Puu väistyy vain, jos sen runko osuu mökkiin, terassiin tai katon alle. Kameran ympäriltä puut
// voi lisäksi piilottaa kuvaamista varten; varjokarttaan ne jäävät.
const treeStands = (base) => buildingDistance(base.xy).greaterThan(base.z).toFloat();
const treeVisibleAt = (base) => treeStands(base).mul(cameraCleared(base.xy).not().toFloat());

function barkMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const base = attribute('base', 'vec4');
  const bark = attribute('bark', 'vec3');
  m.positionNode = lifted(base).mul(treeVisibleAt(base));
  m.castShadowPositionNode = lifted(base).mul(treeStands(base));
  const P = positionWorld;
  const sp = bark.x, h = bark.y, sd = bark.z;
  const is = (id) => sp.greaterThan(id - 0.5).and(sp.lessThan(id + 0.5));
  const furrow = noise3(vec3(P.x.mul(11), P.y.mul(2.3), P.z.mul(11)).add(sd));
  const fine = noise3(vec3(P.x.mul(37), P.y.mul(13), P.z.mul(37)).add(sd));
  const flake = noise3(vec3(P.x.mul(17), P.y.mul(29), P.z.mul(17)).add(sd));
  const band = noise3(vec3(P.x.mul(5), P.y.mul(55), P.z.mul(5)).add(sd));
  // kaukaa kaarnan kuvio sulautuu tasaiseksi sävyksi
  const barkNear = smoothstep(10, 40, length(P.sub(cameraPosition))).oneMinus();
  // mänty: tyvellä harmaanruskea kilpikaarna syvine uurteineen, muutaman metrin korkeudelta
  // ylöspäin oranssi, ohuina levyinä hilseilevä kaarna
  const plate = smoothstep(-0.3, 0.25, furrow.x.add(fine.x.mul(0.35)));
  const pineLow = mix(vec3(0.07, 0.06, 0.052), mix(vec3(0.03, 0.024, 0.02), mix(vec3(0.13, 0.105, 0.088), vec3(0.19, 0.17, 0.15), furrow.w.mul(0.5).add(0.5)), plate), barkNear);
  const pineHigh = mix(vec3(0.3, 0.15, 0.068), mix(vec3(0.2, 0.09, 0.042), vec3(0.4, 0.215, 0.095), smoothstep(-0.5, 0.5, flake.x.add(fine.y.mul(0.3)))), barkNear);
  const turn = smoothstep(0.13, 0.33, h.add(furrow.z.mul(0.06).mul(barkNear)));
  const pine = mix(pineLow, pineHigh, turn);
  // koivu: valkea tuohi, mustat korkkihuokosjuovat ja tumma rosoinen tyvi
  const marks = smoothstep(0.42, 0.62, band.x.add(furrow.x.mul(0.25)));
  const birch = mix(mix(vec3(0.74, 0.72, 0.66), vec3(0.03, 0.03, 0.03), marks.mul(0.9)), vec3(0.045, 0.04, 0.038), smoothstep(0.04, 0.16, h.add(furrow.y.mul(0.05))).oneMinus());
  // haapa: sileä harmaanvihreä, tyvellä tumma
  const aspen = mix(mix(vec3(0.3, 0.33, 0.24), vec3(0.06, 0.06, 0.05), smoothstep(0.5, 0.7, band.y.add(furrow.x.mul(0.3)))), vec3(0.07, 0.065, 0.055), smoothstep(0.05, 0.2, h).oneMinus());
  const spruce = mix(vec3(0.05, 0.04, 0.034), vec3(0.16, 0.125, 0.105), plate);
  const alder = mix(vec3(0.04, 0.04, 0.038), vec3(0.14, 0.135, 0.125), plate);
  m.colorNode = select(is(SPECIES.pine), pine, select(is(SPECIES.birch), birch, select(is(SPECIES.aspen), aspen, select(is(SPECIES.spruce), spruce, alder))));
  m.roughnessNode = float(0.9);
  m.metalnessNode = float(0);
  // kaarnan kohouma: uurteet tyvellä, hilse ylempänä (vain läheltä)
  const close = smoothstep(6, 22, length(P.sub(cameraPosition))).oneMinus();
  const relief = mix(vec2(furrow.y, furrow.w).mul(0.5), vec2(flake.y, flake.z).mul(0.22), turn).mul(close).mul(is(SPECIES.birch).toFloat().oneMinus());
  m.normalNode = transformNormalToView(normalize(normalLocal.add(vec3(relief.x, 0, relief.y))));
  return m;
}

function foliageMaterial(atlas) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const base = attribute('base', 'vec4');
  m.positionNode = lifted(base).mul(treeVisibleAt(base));
  m.castShadowPositionNode = lifted(base).mul(treeStands(base));
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
  const base = attribute('base', 'vec4');
  m.positionNode = lifted(base).mul(visibleAt(base));
  const P = positionWorld;
  const big = noise3(P.mul(1.4));
  const mid = noise3(P.mul(6.5));
  const fine = noise3(P.mul(38));
  // graniitti: harmaa, hieman punertava, rakeinen
  const granite = mix(vec3(0.2, 0.195, 0.185), vec3(0.33, 0.29, 0.26), big.x.mul(0.5).add(0.5)).mul(fine.x.mul(0.2).add(1)).mul(fine.y.mul(0.1).add(1));
  // vaalea rupijäkälä laikkuina kyljissä, sammal laella ja varjopuolella
  const crust = smoothstep(-0.1, 0.35, mid.x.add(big.y.mul(0.6)));
  const lichen = mix(vec3(0.46, 0.48, 0.42), vec3(0.24, 0.26, 0.23), mid.y.mul(0.5).add(0.5));
  const up = normalWorld.y;
  // veden äärellä kivet ovat paljaita ja märkiä, metsässä sammalen peitossa
  const dryLand = smoothstep(0.25, 0.9, P.y);
  const moss = smoothstep(0.2, 0.6, up.add(mid.z.mul(0.35)).add(big.z.mul(0.3))).mul(dryLand);
  const rock = mix(granite, lichen, crust.mul(0.65).mul(dryLand)).mul(mix(float(0.55), float(1), smoothstep(0.02, 0.25, P.y)));
  const mossCol = mix(vec3(0.07, 0.1, 0.028), vec3(0.19, 0.21, 0.05), smoothstep(-0.4, 0.5, mid.w.add(fine.z.mul(0.3))));
  const col = mix(rock, mossCol, moss.mul(0.92));
  m.colorNode = col.mul(mix(float(0.55), float(1), smoothstep(-0.6, 0.3, up)));
  m.roughnessNode = mix(float(0.88), float(0.45), smoothstep(0.02, 0.25, P.y).oneMinus());
  m.metalnessNode = float(0);
  return m;
}

// --- varvikko ---
// Mättäät ovat ristikkäisiä kortteja, yksi piirtokutsu aluetta kohti. Jokaisella mättäällä on
// paikka ja leveys (ip) sekä kierto, kuvaruutu ja korkeussuhde (iq).
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
  const range = uniform(quality === 'mobile' ? 120 : 170);
  // Kauempana piirretään vain osa mättäistä mutta isompina, joten varvikko näkyy kaukaa yhtä
  // peittävänä ja piirtäminen pysyy kevyenä.
  const pick = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))).mul(43758.5453));
  const keep = mix(float(1), float(0.1), smoothstep(range.mul(0.1), range.mul(0.7), dist));
  const grow = keep.inverseSqrt().min(3.2);
  const far = smoothstep(range.mul(0.85), range, dist).oneMinus().mul(pick.lessThan(keep).toFloat()).mul(grow);
  // ei mökin eikä terassin alla eikä sokkelin sorakaistalla
  const clear = footprintDistance(ip.xz).greaterThan(0.15).and(houseDistance(ip.xz).greaterThan(0.7)).toFloat();
  // mätäs seuraa muotoiltua maata
  const lift = footprint.pad.x.sub(ip.y).mul(padWeightNode(ip.xz));
  m.positionNode = vec3(rx, local.y.mul(iq.w), rz).mul(ip.w).mul(clear.mul(far)).add(vec3(ip.x, ip.y.add(lift), ip.z));
  const tileIndex = floor(iq.z);
  // kortti näyttää ruudun alaosan kasvin korkeuden verran, joten kuva ei veny (kaislassa venyy)
  const tv = uv().y.oneMinus().mul(min(iq.w, 1)).oneMinus();
  const tuv = vec2(uv().x.mul(0.992).add(0.004).add(tileIndex.mod(4)).mul(0.25), tv.mul(0.99).add(0.005).add(floor(tileIndex.div(4))).mul(0.5));
  const texel = texture(atlas, tuv);
  // mättään ääriviiva on kupu, ei kortin suorakaide
  const dome = length(vec2(uv().x.mul(2).sub(1), uv().y.oneMinus())).smoothstep(0.72, 1.02).oneMinus();
  m.maskNode = texel.a.mul(dome).greaterThan(0.4);
  const vary = noise3(vec3(ip.x.mul(0.9), 2.5, ip.z.mul(0.9)));
  m.colorNode = texel.rgb.mul(vary.x.mul(0.14).add(0.72)).mul(mix(float(0.55), float(1), smoothstep(0, 0.5, uv().y.oneMinus())));
  m.roughnessNode = float(0.75);
  m.metalnessNode = float(0);
  // mätäs varjostuu kuten maa sen alla
  m.normalNode = normalize(cameraViewMatrix.transformDirection(vec3(0, 1, 0)));

  const cell = 15, step = quality === 'mobile' ? 0.52 : 0.44;
  const chunks = [];
  let total = 0;
  for (let cz = -78; cz < 57; cz += cell) {
    for (let cx = SITE.x0 - 30; cx < SITE.x1 + 30; cx += cell) {
      // tontin ulkopuolella harvemmin mutta isompia mättäitä: kaukaa katsottuna sama vaikutelma
      const outside = cx < SITE.x0 || cx >= SITE.x1;
      const ipA = [], iqA = [];
      for (let gz = cz; gz < cz + cell - 1e-6; gz += step) {
        for (let gx = cx; gx < cx + cell - 1e-6; gx += step) {
          const x = gx + rnd() * step, z = gz + rnd() * step;
          const d = inland(x, z);
          if (d > SITE.depth || d < -7) continue;
          const a = rnd() * TAU;
          if (d < 0.2) {
            // järviruokoa harvakseltaan matalassa vedessä
            if (d > -0.5 || vnoise(x / 8, 9.1, 23) < 0.6 || rnd() > 0.1) continue;
            const w = 0.14 + rnd() * 0.12;
            ipA.push(x, naturalHeight(x, z) - 0.02, z, w);
            iqA.push(Math.cos(a), Math.sin(a), 3, (0.9 + rnd() * 0.8) / w);
            continue;
          }
          const shoreline = d < 2.6;
          const cover = shoreline ? 0.85 : coverAt(x, z);
          if (rnd() > (Math.pow(cover, 1.2) * 1.05 + 0.02) * (outside ? 0.4 : 1)) continue;
          if (sandAt(x, z) > 0.75) continue;
          const dry = dryness(x, z) + (rnd() - 0.5) * 0.25;
          const r = rnd();
          // rannassa heinää ja saraa; metsässä mustikkaa ja puolukkaa, kanervaa vain kuivimmilla paikoilla
          const kind = shoreline ? (r < 0.7 ? 3 : r < 0.85 ? 1 : 0)
            : dry > 0.8 ? (r < 0.45 ? 2 : r < 0.85 ? 0 : 3)
              : dry > 0.45 ? (r < 0.55 ? 0 : r < 0.85 ? 1 : r < 0.93 ? 3 : 2)
                : (r < 0.65 ? 1 : r < 0.9 ? 0 : 3);
          const T = TUFT[kind];
          const w = (T.w[0] + rnd() * (T.w[1] - T.w[0])) * (shoreline && kind === 3 ? 1.5 : 1) * (outside ? 1.5 : 1);
          ipA.push(x, naturalHeight(x, z) - 0.02, z, w);
          iqA.push(Math.cos(a), Math.sin(a), T.tile[rnd() < (kind === 2 ? 0.35 : 0.6) ? 0 : 1], TUFT_HEIGHT[kind]);
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
      const centre = new THREE.Vector3(cx + cell / 2, naturalHeight(cx + cell / 2, cz + cell / 2), cz + cell / 2);
      g.boundingSphere = new THREE.Sphere(centre, cell * 0.75 + 3);
      const mesh = new THREE.Mesh(g, m);
      mesh.layers.set(1);
      mesh.receiveShadow = true;
      mesh.userData.centre = centre;
      chunks.push(mesh);
      total += g.instanceCount;
    }
  }
  return { chunks, total, cards, range, range0: range.value, material: m, pos, uvs, idx };
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
    const reach = [tufts.range0 + 12, 72, 42][level];
    for (const c of tufts.chunks) c.visible = c.userData.centre.distanceTo(camera.position) < reach;
  };
  const shed = () => {
    if (level >= 2) return false;
    level++;
    tufts.range.value = [tufts.range0, 60, 34][level];
    return true;
  };

  // Mökin ympärille aina reilusti varvikkoa: tiheä vyöhyke sokkelin sorakaistan ulkoreunasta
  // noin yhdeksän metrin päähän, sekä terassin ympärille. Rakennetaan uudelleen, kun mökki siirtyy.
  const ring = new THREE.Mesh(new THREE.InstancedBufferGeometry(), tufts.material);
  ring.layers.set(1);
  ring.receiveShadow = true;
  ring.frustumCulled = false;
  group.add(ring);
  const surround = (place, house, boxes) => {
    const r2 = mulberry32(911);
    const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
    const ipA = [], iqA = [];
    const step = quality === 'mobile' ? 0.36 : 0.3, R = 9;
    const [hx, hz] = house;
    const minX = -hx - R, maxX = hx + R;
    let minZ = -hz - R, maxZ = hz + R;
    for (const [bx, bz, bhx, bhz] of boxes) {
      minZ = Math.min(minZ, bz - bhz - 5);
      maxZ = Math.max(maxZ, bz + bhz + 5);
    }
    for (let lz = minZ; lz < maxZ; lz += step) {
      for (let lx = minX; lx < maxX; lx += step) {
        const px = lx + r2() * step, pz = lz + r2() * step;
        // etäisyys mökistä ja terassista: vyöhyke harvenee ulospäin
        const qx = Math.abs(px) - hx, qz = Math.abs(pz) - hz;
        let dHouse = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
        for (const [bx, bz, bhx, bhz] of boxes) {
          if (!(bhx > 0)) continue;
          const ux = Math.abs(px - bx) - bhx, uz = Math.abs(pz - bz) - bhz;
          dHouse = Math.min(dHouse, Math.hypot(Math.max(ux, 0), Math.max(uz, 0)) + Math.min(Math.max(ux, uz), 0) + 0.3);
        }
        if (dHouse < 0.55 || dHouse > R) continue;
        if (r2() > 0.95 - 0.55 * (dHouse / R) ** 1.5) continue;
        const x = place.x + px * c + pz * s, z = place.z - px * s + pz * c;
        if (inland(x, z) < 3) continue;
        const dry = dryness(x, z) + (r2() - 0.5) * 0.3;
        const r = r2();
        // mustikkaa ja puolukkaa, kuivemmalla kanervaa, joukossa metsälauhaa
        const kind = dry > 0.75 ? (r < 0.4 ? 0 : r < 0.75 ? 2 : r < 0.9 ? 1 : 3) : (r < 0.48 ? 1 : r < 0.88 ? 0 : r < 0.95 ? 3 : 2);
        const T = TUFT[kind];
        const w = (T.w[0] + r2() * (T.w[1] - T.w[0])) * (0.95 + r2() * 0.25);
        const a = r2() * TAU;
        ipA.push(x, naturalHeight(x, z) - 0.02, z, w);
        iqA.push(Math.cos(a), Math.sin(a), T.tile[r2() < 0.55 ? 0 : 1], TUFT_HEIGHT[kind]);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tufts.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tufts.uvs, 2));
    g.setIndex(tufts.idx);
    g.setAttribute('ip', new THREE.InstancedBufferAttribute(new Float32Array(ipA), 4));
    g.setAttribute('iq', new THREE.InstancedBufferAttribute(new Float32Array(iqA), 4));
    g.instanceCount = ipA.length / 4;
    ring.geometry.dispose();
    ring.geometry = g;
    ring.visible = g.instanceCount > 0;
    stats.ring = g.instanceCount;
  };

  const stats = { trees: trees.filter((t) => t.lod === 0).length, forest: trees.length, boulders: boulders.length, tufts: tufts.total, ring: 0, treeTriangles: triangles, tuftTriangles: tufts.total * tufts.cards * 2 };
  return {
    group, trees, boulders, update, shed, surround, level: () => level, stats,
  };
}
