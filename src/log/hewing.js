// Piilutus: kylkien veistojälki piilukirveen iskuina.
//
// Jokainen isku on matala kouru. Terän suunta (e) on lähes pystyssä, joten kourujen väliset
// harjat kulkevat hirren poikki; kourun pohja kaartuu terän kuperan muodon mukaan. Veistetty
// pinta on kaikkien iskujen syvin kohta: h(x, y) = max_k h_k(x, y), missä
//
//   a = (p − c) · n,  b = (p − c) · e
//   h_k = D − (a − κ·b²)² · iRa − b² · iRb − loppu(|b| − terän puolikas)
//
// Iskut tallennetaan tekstuuriin, josta varjostin laskee saman pinnan pikselin tarkkuudella.

import { L, HW, topY, bottomY } from './shape.js';

export const BIN = 0.02; // lokeron leveys x-suunnassa (m)
export const N_BINS = Math.round(L / BIN);
export const TEX_W = 256;
const END_SOFT = 1 / (2 * 0.02); // terän pään jälkeen isku loppuu noin sentin matkalla

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function generateStrokes(side, seed) {
  const rnd = mulberry32(seed);
  const strokes = [];
  // Veistäjä etenee hirttä pitkin; terän kallistus pysyy lähes samana, mutta elää.
  const leanBase = side > 0 ? -0.16 : 0.13;
  const striaSign = side > 0 ? 1 : -1;
  let x = -0.06;
  let lean = leanBase;
  while (x < L + 0.06) {
    let pitch = lerp(0.07, 0.112, rnd());
    const r = rnd();
    if (r < 0.08) pitch *= 0.62;
    else if (r > 0.93) pitch *= 1.28;
    x += pitch;
    const xc = Math.min(Math.max(x, 0), L);
    const yb = bottomY(xc, side * HW);
    const yt = topY(xc, side * HW);
    const hf = yt - yb;
    const q = rnd();
    const rows = hf > 0.27 ? (q < 0.72 ? 2 : 3) : q < 0.8 ? 2 : 1;
    lean = lerp(lean, leanBase + (rnd() - 0.5) * 0.3, 0.6);
    // Veistäjän ote vaihtelee hirren matkalla: välillä kirves puree syvään, välillä vain silittää.
    const bite = Math.min(Math.max(0.74 + 0.36 * Math.sin(1.35 * x + 0.6 + side) + 0.2 * Math.sin(3.1 * x + 2.0), 0.42), 1.3);
    const depth0 = lerp(0.0019, 0.0031, rnd()) * bite;
    const ridge = lerp(0.5, 0.64, rnd()); // pienempi luku = terävämpi harja
    for (let row = 0; row < rows; row++) {
      const cy = yb + (hf * (row + 0.5)) / rows + (rnd() - 0.5) * 0.03;
      const cx = x + (rnd() - 0.5) * 0.022 + (row - (rows - 1) / 2) * 0.012 * (rnd() - 0.3);
      const phi = lean + (rnd() - 0.5) * 0.1;
      const D = depth0 * lerp(0.72, 1.18, rnd());
      const Ra = (ridge * pitch) ** 2 / (2 * D) * lerp(0.85, 1.2, rnd());
      const Rb = lerp(1.6, 3.6, rnd());
      const Re = lerp(0.3, 0.6, rnd()); // terän kuperuus piirtää harjan kaarelle
      const halfLen = Math.max(0.108, (hf / rows) * 0.5 + 0.03) * lerp(0.95, 1.1, rnd());
      // Terän pienet kolot piirtävät iskun suuntaisia naarmuja.
      const psi = striaSign * lerp(0.75, 1.15, rnd());
      strokes.push({
        cx,
        cy,
        ex: Math.sin(phi),
        ey: Math.cos(phi),
        D,
        iRa: 1 / (2 * Ra),
        iRb: 1 / (2 * Rb),
        kappa: (1 / (2 * Re)) * (side > 0 ? 1 : -1),
        halfLen,
        sx: Math.cos(psi),
        sy: -Math.sin(psi),
        seed: rnd() * 97,
      });
    }
  }
  strokes.sort((p, q2) => p.cx - q2.cx);
  return strokes;
}

function strokeDepth(s, x, y) {
  const dx = x - s.cx;
  const dy = y - s.cy;
  const b = dx * s.ex + dy * s.ey;
  const a = dx * s.ey - dy * s.ex - s.kappa * b * b;
  const over = Math.max(Math.abs(b) - s.halfLen, 0);
  return s.D - a * a * s.iRa - b * b * s.iRb - over * over * END_SOFT;
}

export class HewnFace {
  constructor(side, seed) {
    this.side = side;
    this.strokes = generateStrokes(side, seed);
    if (this.strokes.length > TEX_W) throw new Error('liikaa iskuja tekstuuriin');
    this.bins = this.buildBins();
    this.maxPerBin = this.bins.reduce((m, b) => Math.max(m, b.length), 0);
  }

  // Lokeroon kuuluvat iskut, jotka ovat jossain sen kohdassa syvimpiä.
  buildBins() {
    const bins = [];
    const strokes = this.strokes;
    for (let i = 0; i < N_BINS; i++) {
      const x0 = i * BIN;
      const near = [];
      for (let k = 0; k < strokes.length; k++) {
        if (Math.abs(strokes[k].cx - (x0 + BIN / 2)) < 0.22) near.push(k);
      }
      const used = new Set();
      for (let ix = 0; ix <= 10; ix++) {
        const x = x0 + (BIN * ix) / 10;
        for (let iy = 0; iy <= 80; iy++) {
          const y = -0.2 + (0.4 * iy) / 80;
          let best = 0;
          let bestK = -1;
          for (const k of near) {
            const h = strokeDepth(strokes[k], x, y);
            if (h > best) {
              best = h;
              bestK = k;
            }
          }
          if (bestK >= 0) used.add(bestK);
        }
      }
      bins.push([...used].sort((p, q) => p - q));
    }
    return bins;
  }

  // Veistetyn pinnan syvyys nimellistason (z = ±HW) sisäpuolella.
  depth(x, y) {
    const i = Math.min(Math.max(Math.floor(x / BIN), 0), N_BINS - 1);
    let best = 0;
    const strokes = this.strokes;
    for (const k of this.bins[i]) {
      const h = strokeDepth(strokes[k], x, y);
      if (h > best) best = h;
    }
    return best;
  }
}

// Molempien kylkien iskut ja lokerot yhteen float-tekstuuriin.
//   rivit 0–2: kylki +z, isku i sarakkeessa i (3 tekseliä per isku)
//   rivit 3–5: kylki −z
//   sen jälkeen lokerot: binRows riviä per kylki, rivillä n lokeron n:s isku (−1 = tyhjä)
export function buildStrokeData(faces) {
  const binRows = Math.max(...faces.map((f) => f.maxPerBin));
  const height = 6 + 2 * binRows;
  const data = new Float32Array(TEX_W * height * 4);
  const put = (col, row, v) => data.set(v, (row * TEX_W + col) * 4);
  faces.forEach((face, f) => {
    face.strokes.forEach((s, i) => {
      put(i, f * 3, [s.cx, s.cy, s.ex, s.ey]);
      put(i, f * 3 + 1, [s.D, s.iRa, s.iRb, s.kappa]);
      put(i, f * 3 + 2, [s.halfLen, s.sx, s.sy, s.seed]);
    });
    for (let b = 0; b < TEX_W; b++) {
      const list = face.bins[b] || [];
      for (let r = 0; r < binRows; r++) put(b, 6 + f * binRows + r, [r < list.length ? list[r] : -1, 0, 0, 0]);
    }
  });
  return { data, width: TEX_W, height, binRows, endSoft: END_SOFT };
}
