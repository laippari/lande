// Terassi, pergola ja kasvihuone sekä palju tai poreallas.
//
// Malli on talo-projektin pienempi terassi sovitettuna tämän mökin mittoihin: 150 mm laudoista
// tehty terassi kulkee etuseinän päästä päähän ja on 4,4 m syvä. Toisessa päässä on pergola
// (150 × 150 mm puuta, lasikatto, kallistus 5 % sivulle), ja se jatkuu terassin ulkoreunan yli
// 2,6 m kasvihuoneena. Pergolan ulkosivulla on laudoitettu seinäke, päädyssä ja terassin puolella
// liukulasit. Palju (Ø 1,95 m) tai poreallas (2,2 × 2,2 m) on upotettu terassiin pergolan alle.
// Terassi seisoo omilla betoniharkkopilareillaan (240 × 240 mm).
//
// Mitat ovat pergolan omassa koordinaatistossa: px seinää pitkin pergolan päädystä, py seinästä
// ulospäin. Peilaus vaihtaa pergolan mökin toiseen päähän.

import * as THREE from 'three/webgpu';
import { DIM } from './plan.js';

export const TERRACE = {
  depth: 4.4, // terassin syvyys seinästä
  green: 2.6, // kasvihuoneen jatke terassin ulkoreunasta
  pergola: 3.3, // pergolan leveys: mahtuu mökin nurkan ja ikkunoiden väliin
  level: DIM.floor - 0.08, // terassin pinta hieman lattiaa alempana
  board: 0.145,
  gap: 0.006,
  tub: [1.65, 1.6], // altaan keskipiste
  tubR: 0.975,
  spaH: 1.1,
  spaR: 0.32,
};

const DECK = [0.8, 0.7, 0.58]; // terassilauta: hieman tummunutta mäntyä
const FRAME = [0.74, 0.63, 0.5]; // pergolan runko: astetta tummempi
const CLAD = [0.92, 0.86, 0.76]; // seinäkkeen laudoitus
const THERMO = [0.5, 0.36, 0.25]; // lämpöpuu
const SOIL = [0.16, 0.12, 0.09];
const CAP = [0.16, 0.16, 0.17];

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// pyöristetyn neliön ääriviiva: puolimitta h, nurkan säde r, k pistettä nurkkaa kohti
function roundedSquare(h, r, k) {
  const pts = [];
  for (let c = 0; c < 4; c++) {
    const cx = (c === 0 || c === 3 ? 1 : -1) * (h - r), cy = (c < 2 ? 1 : -1) * (h - r);
    for (let i = 0; i <= k; i++) {
      const a = (c + i / k) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

// altaan puolileveys etäisyydellä dy sen keskilinjasta, gr = varaus ympärillä
function tubHalf(type, dy, gr) {
  dy = Math.abs(dy);
  if (type === 'spa') {
    const A = TERRACE.spaH + gr, r = TERRACE.spaR + gr, q = dy - (A - r);
    return dy >= A ? 0 : q <= 0 ? A : A - r + Math.sqrt(Math.max(0, r * r - q * q));
  }
  const R = TERRACE.tubR + gr;
  return dy >= R ? 0 : Math.sqrt(R * R - dy * dy);
}

function frameOf(opts) {
  const s = opts.side === 'right' ? -1 : 1;
  const W = DIM.width;
  return {
    s, W,
    X: (px) => s * (px - W / 2),
    Z: (py) => DIM.depth / 2 + py,
    PD: TERRACE.depth, GL: TERRACE.green, PE: TERRACE.depth + TERRACE.green, PW: TERRACE.pergola, yD: TERRACE.level,
  };
}

// Jalanjälki mökin koordinaatistossa: [keski-x, keski-z, puolileveys, puolisyvyys].
export function footprintBoxes(opts) {
  const m = 0.25;
  if (!opts.on) return [[0, 0, DIM.width / 2 + m, DIM.depth / 2 + m], [0, 0, 0, 0]];
  const f = frameOf(opts);
  const z1 = DIM.depth / 2 + f.PD + m;
  return [
    [0, (z1 - DIM.depth / 2 - m) / 2, DIM.width / 2 + m, (z1 + DIM.depth / 2 + m) / 2],
    [f.X(f.PW / 2), f.Z(f.PD + f.GL / 2), f.PW / 2 + m, f.GL / 2 + m],
  ];
}

const mats = {};
function materials() {
  if (mats.steel) return mats;
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness, ...extra });
  mats.black = std(0x101112, 0.55, 0.3);
  mats.steel = std(0x9a9c9e, 0.35, 0.9);
  mats.liner = std(0x15181a, 0.6, 0, { side: THREE.DoubleSide });
  mats.rim = std(0x5e4230, 0.6);
  mats.water = std(0x0c2a2c, 0.04);
  mats.spaWater = std(0x2f9aa6, 0.04);
  mats.acryl = std(0xe9ebea, 0.22, 0, { side: THREE.DoubleSide });
  mats.pillow = std(0x1c1d1f, 0.8);
  return mats;
}

// Rakentaa terassin puuosat verkkoon (timber) ja palauttaa lasit, muut osat ja pilarien paikat.
export function buildTerrace(timber, opts) {
  const f = frameOf(opts);
  const { X, Z, PD, GL, PE, PW, W, yD, s } = f;
  const T = TERRACE;
  const hasTub = opts.tub === 'palju' || opts.tub === 'spa';
  const tc = T.tub;
  const board = (o) => timber.addBoard(o);
  const pitch = T.board + T.gap;

  // --- terassilaudat seinän suuntaan, altaan kohdalta sahattuna sen muotoon ---
  const row = (py0, py1, pxa, pxb) => {
    const rect = (a, b) => timber.addPlank([[X(a), Z(py0)], [X(b), Z(py0)], [X(b), Z(py1)], [X(a), Z(py1)]], yD, 0.028, { tint: DECK });
    const dy = tc[1] < py0 ? py0 - tc[1] : tc[1] > py1 ? tc[1] - py1 : 0;
    const reach = (opts.tub === 'spa' ? T.spaH : T.tubR) + 0.02;
    if (!hasTub || dy >= reach || pxa > tc[0]) return rect(pxa, pxb);
    const N = 6, ys = [];
    for (let i = 0; i <= N; i++) ys.push(py0 + ((py1 - py0) * i) / N);
    const hh = (y) => tubHalf(opts.tub, y - tc[1], 0.02);
    const left = [[pxa, py0], ...ys.map((y) => [Math.max(pxa, tc[0] - hh(y)), y]), [pxa, py1]];
    const right = [[pxb, py0], [pxb, py1], ...ys.slice().reverse().map((y) => [Math.min(pxb, tc[0] + hh(y)), y])];
    for (const poly of [left, right]) {
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (Math.abs(area) / 2 > 0.004) timber.addPlank(poly.map(([px, py]) => [X(px), Z(py)]), yD, 0.028, { tint: DECK });
    }
  };
  for (let py = 0.05; py < PD - 0.01; py += pitch) row(py, Math.min(PD, py + T.board), 0, W);
  for (let py = PD + T.gap; py < PE - 0.01; py += pitch) row(py, Math.min(PE, py + T.board), 0, PW);

  // --- runko: koolaus 600 mm välein, kannatinpalkit ja otsalaudat ---
  const yJ = yD - 0.028 - 0.0865, yB = yD - 0.028 - 0.173 - 0.099;
  const tubR = opts.tub === 'spa' ? T.spaH : T.tubR;
  for (let px = 0.06; px < W; px += (W - 0.12) / 20) {
    const end = px < PW ? PE : PD;
    const piece = (a, b) => board({ a: [X(px), yJ, Z(a)], b: [X(px), yJ, Z(b)], w: 0.048, t: 0.173, tint: FRAME, ends: false });
    if (hasTub && Math.abs(px - tc[0]) < tubR + 0.03) {
      const h = tubHalf(opts.tub, px - tc[0], 0.03);
      piece(0.03, tc[1] - h);
      piece(tc[1] + h, end - 0.03);
    } else piece(0.03, end - 0.03);
  }
  const rows = [[0.2, 0, W], [2.72, 0, W], [PD - 0.2, 0, W], [PD + GL / 2 + 0.1, 0, PW], [PE - 0.2, 0, PW]];
  const pillars = [];
  const top = yB - 0.099 - 0.006;
  for (const [py, a, b] of rows) {
    board({ a: [X(a + 0.03), yB, Z(py)], b: [X(b - 0.03), yB, Z(py)], w: 0.098, t: 0.198, tint: FRAME });
    const n = b - a > 6 ? 5 : 1;
    for (let i = 0; i <= n; i++) pillars.push({ x: X(a + 0.16 + ((b - a - 0.32) * i) / n), z: Z(py), top, size: 0.24 });
  }
  const fascia = (ax, ay, bx, by) => {
    const nx = ay === by ? 0 : 1; // otsalauta kiertää reunan ulkopuolella
    board({ a: [X(ax), yD - 0.13, Z(ay)], b: [X(bx), yD - 0.13, Z(by)], w: 0.028, t: 0.195, up: [0, 1, 0], tint: DECK, ends: !nx });
  };
  fascia(PW, PD + 0.014, W + 0.028, PD + 0.014);
  fascia(W + 0.014, 0, W + 0.014, PD);
  fascia(-0.014, 0, -0.014, PE);
  fascia(-0.028, PE + 0.014, PW + 0.028, PE + 0.014);
  fascia(PW + 0.014, PD + 0.028, PW + 0.014, PE);

  // --- pergola: palkit, katto-orret ja pylväät ---
  const zt = (px) => yD + 2.6 - 0.05 * (PW - px); // orsien alapinta: katto viettää pergolan päätyyn
  const zTop = (px) => zt(px) - 0.15; // palkkien alapinta
  for (const xb of [0.075, PW - 0.075]) {
    board({ a: [X(xb), zt(xb) - 0.075, Z(0.02)], b: [X(xb), zt(xb) - 0.075, Z(PE + 0.2)], w: 0.15, t: 0.15, tint: FRAME });
  }
  for (let i = 0; i * 0.6 <= PE + 0.001; i++) {
    const yr = clamp(i * 0.6, 0.05, PE - 0.05);
    board({ a: [X(-0.12), zt(-0.12) + 0.075, Z(yr)], b: [X(PW + 0.12), zt(PW + 0.12) + 0.075, Z(yr)], w: 0.1, t: 0.15, tint: FRAME });
  }
  const post = (px, py, w) => {
    const y = clamp(py - w / 2, 0, PE - w) + w / 2;
    board({ a: [X(px), yD, Z(y)], b: [X(px), zTop(px), Z(y)], w, t: w, up: [0, 0, 1], tint: FRAME });
  };
  const bays = Math.round(PE / 0.9), M = PE / bays;
  for (let i = 1; i < bays; i++) post(0.08, i * M, 0.1);
  post(0.08, PE, 0.15);
  post(PW - 0.075, PE, 0.15);
  post(PW - 0.075, PE / 2, 0.15);
  post(PW - 0.075, 0.1, 0.1);
  // päädyn vaakajuoksu, jonka alla liukulasit kulkevat
  const yE = PE - 0.075, zRail = zTop(0.08), eXa = 0.155, eXb = PW - 0.15;
  board({ a: [X(eXa), zRail - 0.035, Z(yE)], b: [X(eXb), zRail - 0.035, Z(yE)], w: 0.1, t: 0.07, tint: FRAME });

  // seinäke pergolan ulkosivulla: pystylaudoitus rungon molemmin puolin
  const clad = (px, py0, py1, y0, y1) => {
    const n = Math.round((py1 - py0) / 0.148), bw = (py1 - py0) / n;
    for (let i = 0; i < n; i++) {
      const py = py0 + (i + 0.5) * bw;
      board({ a: [X(px), y0, Z(py)], b: [X(px), y1, Z(py)], w: bw - 0.003, t: 0.022, up: [1, 0, 0], tint: CLAD });
    }
  };
  clad(0.011, 0, PE, yD - 0.03, zTop(0.011));
  clad(0.144, 0.003, PE - 0.15, yD - 0.005, zTop(0.144));

  // kasvihuoneen istutuslaatikot seinäkkeen vieressä ja päädyssä
  const bed = (ax, ay, bx, by) => {
    const along = Math.abs(bx - ax) > Math.abs(by - ay);
    for (let k = 0; k < 3; k++) {
      const y = yD + 0.075 + k * 0.148;
      if (along) {
        for (const py of [ay, by]) board({ a: [X(ax), y, Z(py)], b: [X(bx), y, Z(py)], w: 0.028, t: 0.145, tint: DECK });
        for (const px of [ax, bx]) board({ a: [X(px), y, Z(ay)], b: [X(px), y, Z(by)], w: 0.028, t: 0.145, tint: DECK });
      } else {
        for (const px of [ax, bx]) board({ a: [X(px), y, Z(ay)], b: [X(px), y, Z(by)], w: 0.028, t: 0.145, tint: DECK });
        for (const py of [ay, by]) board({ a: [X(ax), y, Z(py)], b: [X(bx), y, Z(py)], w: 0.028, t: 0.145, tint: DECK });
      }
    }
    board({ a: [X(ax), yD + 0.4, Z((ay + by) / 2)], b: [X(bx), yD + 0.4, Z((ay + by) / 2)], w: Math.abs(by - ay) - 0.03, t: 0.02, tint: SOIL, ends: false });
  };
  bed(0.2, PD + 0.25, 0.85, PE - 0.95);
  bed(0.2, PE - 0.85, PW - 0.9, PE - 0.2);

  // --- näkösuoja terassin toisessa päässä ---
  if (opts.screen) {
    const xo = W - 0.011, xi = W - 0.159, xm = W - 0.085, y1 = yD + 2.5;
    clad(xo, 0, PD - 0.15, yD - 0.03, y1 - 0.15);
    clad(xi, 0, PD - 0.15, yD - 0.03, y1 - 0.15);
    board({ a: [X(xm), yD - 0.2, Z(PD - 0.075)], b: [X(xm), y1, Z(PD - 0.075)], w: 0.15, t: 0.17, up: [1, 0, 0], tint: FRAME });
    board({ a: [X(xm), y1 - 0.075, Z(0)], b: [X(xm), y1 - 0.075, Z(PD - 0.15)], w: 0.17, t: 0.15, tint: FRAME });
    board({ a: [X(xm), y1 + 0.0175, Z(-0.02)], b: [X(xm), y1 + 0.0175, Z(PD + 0.02)], w: 0.21, t: 0.035, tint: CAP });
  }

  // --- lasit ---
  const V = (px, py, y) => [X(px), y, Z(py)];
  const glass = [];
  const sliding = [];
  // katto
  const g0 = -0.14, g1 = PW + 0.14;
  glass.push([V(g0, -0.02, zt(g0) + 0.156), V(g1, -0.02, zt(g1) + 0.156), V(g1, PE + 0.25, zt(g1) + 0.156), V(g0, PE + 0.25, zt(g0) + 0.156)]);
  // päädyn kiinteä kiila juoksun ja katon välissä
  glass.push([V(eXa, yE, zRail), V(eXb, yE, zRail), V(eXb, yE, zTop(eXb)), V(eXa, yE, zTop(eXa))]);
  // liukulasit: viisi lasia kussakin aukossa omilla kiskoillaan
  const NP = 5;
  const xT = PW - 0.075, yTop = zTop(xT) - 0.025;
  for (const [a, b] of [[0.15, PE / 2 - 0.075], [PE / 2 + 0.075, PE - 0.15]]) {
    for (let k = 0; k < NP; k++) {
      const xk = xT - 0.03 + k * 0.015, p0 = a + ((b - a) * k) / NP, p1 = a + ((b - a) * (k + 1)) / NP + 0.02;
      sliding.push([V(xk, p0, yD + 0.02), V(xk, Math.min(p1, b), yD + 0.02), V(xk, Math.min(p1, b), yTop), V(xk, p0, yTop)]);
    }
  }
  for (let k = 0; k < NP; k++) {
    const yk = yE - 0.03 + k * 0.015, p0 = eXa + ((eXb - eXa) * k) / NP, p1 = Math.min(eXb, p0 + (eXb - eXa) / NP + 0.02);
    sliding.push([V(p0, yk, yD + 0.02), V(p1, yk, yD + 0.02), V(p1, yk, zRail - 0.07), V(p0, yk, zRail - 0.07)]);
  }

  // --- allas ---
  const parts = new THREE.Group();
  const m = materials();
  const cx = X(tc[0]), cz = Z(tc[1]);
  const put = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parts.add(mesh);
    return mesh;
  };
  const base = yD - 0.75;
  // lämpöpuiset kyljet: pystyrimat ääriviivaa pitkin
  const staves = (outline, y0, y1) => {
    const n = outline.length;
    for (let i = 0; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const k = Math.max(1, Math.round(len / 0.095));
      const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len; // ulospäin (ääriviiva kiertää vastapäivään)
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const px = a[0] + (b[0] - a[0]) * t - nx * 0.015, pz = a[1] + (b[1] - a[1]) * t - nz * 0.015;
        board({ a: [cx + s * px, y0, cz + pz], b: [cx + s * px, y1, cz + pz], w: len / k - 0.002, t: 0.03, up: [s * nx, 0, nz], tint: THERMO });
      }
    }
  };
  if (opts.tub === 'palju') {
    const R = T.tubR, rim = yD + 0.5;
    const ring = [];
    for (let i = 0; i < 64; i++) ring.push([R * Math.cos((i / 64) * Math.PI * 2), R * Math.sin((i / 64) * Math.PI * 2)]);
    staves(ring, base, rim);
    put(new THREE.RingGeometry(R - 0.065, R + 0.012, 48), m.rim, cx, rim + 0.003, cz).rotation.x = -Math.PI / 2;
    put(new THREE.CylinderGeometry(R - 0.065, R - 0.065, 1.0, 40, 1, true), m.liner, cx, rim - 0.5, cz);
    put(new THREE.CircleGeometry(R - 0.066, 40), m.water, cx, rim - 0.17, cz).rotation.x = -Math.PI / 2;
    for (const y of [rim - 0.13, rim - 0.39]) put(new THREE.CylinderGeometry(R + 0.004, R + 0.004, 0.04, 48, 1, true), m.steel, cx, y, cz);
    // kamina paljun ulkopuolella seinäkkeen puolella, savupiippu lasikaton läpi
    const spx = tc[0] - (R + 0.24), sx = X(spx), sz = cz;
    put(new THREE.CylinderGeometry(0.2, 0.2, 0.65, 24), m.black, sx, yD + 0.325, sz);
    put(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 24), m.black, sx, yD + 0.665, sz);
    const roofY = zt(spx) + 0.16, cTop = roofY + 0.75;
    put(new THREE.BoxGeometry(0.3, 0.008, 0.3), m.black, sx, roofY + 0.006, sz);
    put(new THREE.CylinderGeometry(0.085, 0.1, 0.12, 16), m.black, sx, roofY + 0.065, sz);
    put(new THREE.CylinderGeometry(0.055, 0.055, cTop - yD - 0.68, 12), m.black, sx, (yD + 0.68 + cTop) / 2, sz);
    put(new THREE.CylinderGeometry(0.11, 0.07, 0.07, 12), m.black, sx, cTop + 0.03, sz);
    for (const y of [0.18, 0.48]) put(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 10), m.steel, X(tc[0] - R - 0.08), yD + y, sz).rotation.z = Math.PI / 2;
  } else if (opts.tub === 'spa') {
    const A = T.spaH, RC = T.spaR, K = 6, rim = yD + 0.2;
    staves(roundedSquare(A, RC, K), base, rim - 0.04);
    // rengas kahden ääriviivan välissä tai umpinainen pinta
    const loft = (rings, mat, cap) => {
      const mlen = 4 * (K + 1), pos = [], idx = [];
      for (const [h, r, dy] of rings) for (const p of roundedSquare(h, r, K)) pos.push(cx + s * p[0], rim + dy, cz + p[1]);
      for (let j = 0; j + 1 < rings.length; j++) {
        for (let i = 0; i < mlen; i++) {
          const a = j * mlen + i, b = j * mlen + ((i + 1) % mlen);
          idx.push(a, b, a + mlen, b, b + mlen, a + mlen);
        }
      }
      if (cap) {
        const last = (rings.length - 1) * mlen, ci = pos.length / 3;
        pos.push(cx, rim + rings[rings.length - 1][2], cz);
        for (let i = 0; i < mlen; i++) idx.push(last + i, last + ((i + 1) % mlen), ci);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parts.add(mesh);
      return mesh;
    };
    const frame = new THREE.MeshStandardNodeMaterial({ color: 0x5e4230, roughness: 0.6, side: THREE.DoubleSide });
    loft([[A + 0.012, RC + 0.012, -0.03], [A + 0.012, RC + 0.012, 0], [A - 0.132, RC - 0.1, 0], [A - 0.132, RC - 0.1, -0.03]], frame, false);
    loft([[A - 0.125, 0.2, -0.042], [A - 0.14, 0.19, -0.05], [A - 0.152, 0.18, -0.072], [A - 0.157, 0.18, -0.11], [A - 0.21, 0.17, -0.42], [A - 0.24, 0.17, -0.47],
      [A - 0.28, 0.18, -0.49], [A - 0.52, 0.2, -0.505], [A - 0.55, 0.21, -0.53], [A - 0.565, 0.21, -0.58], [A - 0.58, 0.22, -0.84], [A - 0.68, 0.24, -0.9]], m.acryl, true);
    const water = new THREE.MeshStandardNodeMaterial({ color: 0x2f9aa6, roughness: 0.04, side: THREE.DoubleSide });
    loft([[A - 0.158, 0.18, -0.13]], water, true);
    for (const [qx, qz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const d = 1.23 / Math.SQRT2;
      const pillow = put(new THREE.SphereGeometry(1, 16, 10), m.pillow, cx + qx * d, rim - 0.015, cz + qz * d);
      pillow.scale.set(0.13, 0.04, 0.065);
      pillow.rotation.y = Math.atan2(qx, qz) + Math.PI / 2;
    }
  }
  if (hasTub) for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) pillars.push({ x: cx + dx, z: cz + dz, top: base, size: 0.24 });

  return { glass, sliding, parts, pillars };
}

// Maasta riippuvat osat: portaat terassin ulkoreunalta maahan ja kaide, jos pudotusta on yli
// puoli metriä. groundAt(x, z): maanpinta mökin koordinaatistossa.
export function buildGroundworks(timber, opts, groundAt) {
  const f = frameOf(opts);
  const { X, Z, PD, PW, W, yD } = f;
  const board = (o) => timber.addBoard(o);
  const going = 0.28;
  const pxc = PW + (W - PW) / 2, half = 0.8;
  // askelmien määrä: viimeinen nousu päättyy maahan
  let n = 1;
  for (; n < 16; n++) if (yD - n * 0.175 <= groundAt(X(pxc), Z(PD + n * going)) + 0.03) break;
  const foot = groundAt(X(pxc), Z(PD + n * going));
  const rise = clamp((yD - foot) / n, 0.12, 0.2);
  for (let k = 1; k < n; k++) {
    const y = yD - k * rise;
    for (const off of [0.075, 0.222]) {
      const py = PD + (k - 1) * going + 0.03 + off;
      board({ a: [X(pxc - half), y - 0.014, Z(py)], b: [X(pxc + half), y - 0.014, Z(py)], w: 0.14, t: 0.028, tint: DECK });
    }
  }
  for (const px of [pxc - half + 0.06, pxc + half - 0.06]) {
    board({ a: [X(px), yD - 0.17, Z(PD + 0.03)], b: [X(px), yD - n * rise - 0.17, Z(PD + 0.03 + n * going)], w: 0.048, t: 0.22, tint: FRAME });
  }

  // kaide
  let drop = 0;
  for (let px = PW; px <= W; px += 0.5) drop = Math.max(drop, yD - groundAt(X(px), Z(PD + 0.2)));
  for (let py = 0; py <= PD; py += 0.5) drop = Math.max(drop, yD - groundAt(X(W + 0.2), Z(py)));
  if (drop > 0.5) {
    const rail = (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.3) return;
      const n2 = Math.max(1, Math.ceil(len / 1.4));
      for (let i = 0; i <= n2; i++) {
        const t = i / n2, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        board({ a: [X(px), yD, Z(py)], b: [X(px), yD + 1.0, Z(py)], w: 0.07, t: 0.07, up: [0, 0, 1], tint: FRAME });
      }
      board({ a: [X(ax), yD + 1.02, Z(ay)], b: [X(bx), yD + 1.02, Z(by)], w: 0.12, t: 0.04, tint: FRAME });
      for (const y of [0.2, 0.42, 0.64, 0.86]) board({ a: [X(ax), yD + y, Z(ay)], b: [X(bx), yD + y, Z(by)], w: 0.022, t: 0.095, tint: DECK });
    };
    const e = PD - 0.045;
    rail(PW + 0.2, e, pxc - half - 0.05, e);
    rail(pxc + half + 0.05, e, W - 0.045, e);
    if (!opts.screen) rail(W - 0.045, 0.1, W - 0.045, e);
  }
}
