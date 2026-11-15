// Oksat. Männyn oksat lähtevät ytimestä kiehkuroina, joita on rungossa noin 30–60 cm välein.
// Oksa on kartio, joka paksunee ulospäin ja nousee latvaa kohti. Osa oksista on kuollut ja
// jäänyt puun sisään, jolloin pinnassa näkyy vain vuosirenkaiden kiertymä.

import { L, pithY, pithZ } from './shape.js';
import { mulberry32 } from './hewing.js';

export const KNOT_BIN = 0.02;
export const KNOT_TEX_W = 256;
export const KNOT_MAX = 6; // oksia kiehkurassa enintään
const REACH_BACK = 0.07; // kiehkuran vaikutusalue tyveen päin
const REACH_FWD = 0.21; // ja latvaan päin (oksat nousevat)

const lerp = (a, b, t) => a + (b - a) * t;

export function generateKnots(seed) {
  const rnd = mulberry32(seed);
  const whorls = [];
  let x = lerp(0.3, 0.45, rnd());
  while (x < L - 0.3) {
    const count = 3 + Math.floor(rnd() * 3);
    const turn = rnd() * Math.PI * 2;
    const branches = [];
    for (let j = 0; j < count; j++) {
      const alpha = turn + ((j + (rnd() - 0.5) * 0.5) / count) * Math.PI * 2;
      const beta = lerp(0.3, 0.6, rnd()); // nousukulma kohtisuorasta latvaan päin
      const alive = rnd() < 0.7;
      branches.push({
        x0: x + (rnd() - 0.5) * 0.03,
        alpha,
        sinB: Math.sin(beta),
        cosB: Math.cos(beta),
        gamma: lerp(0.06, 0.115, rnd()), // säteen kasvu matkaa kohti
        rho0: 0.0015,
        sEnd: alive ? 0.4 : lerp(0.045, 0.14, rnd()), // kuolleen oksan pituus
        dark: lerp(0.35, 1, rnd()),
        seed: rnd() * 61,
      });
    }
    whorls.push({ x, branches });
    x += lerp(0.34, 0.62, rnd());
  }
  return whorls;
}

// Rivi 0: x-lokero → (kiehkuran rivi tai −1, oksien määrä). Rivit 1…: kiehkuran oksat,
// 3 tekseliä per oksa: (x0, y0, z0, alpha), (sinB, cosB, gamma, rho0), (sEnd, dark, seed, 0).
export function buildKnotData(whorls) {
  const height = 1 + whorls.length;
  const data = new Float32Array(KNOT_TEX_W * height * 4);
  const put = (col, row, v) => data.set(v, (row * KNOT_TEX_W + col) * 4);
  for (let b = 0; b < KNOT_TEX_W; b++) {
    const xc = (b + 0.5) * KNOT_BIN;
    let row = -1;
    let count = 0;
    whorls.forEach((w, i) => {
      if (xc > w.x - REACH_BACK && xc < w.x + REACH_FWD) {
        row = i + 1;
        count = w.branches.length;
      }
    });
    put(b, 0, [row, count, 0, 0]);
  }
  whorls.forEach((w, i) => {
    w.branches.forEach((k, j) => {
      put(j * 3, i + 1, [k.x0, pithY(k.x0), pithZ(k.x0), k.alpha]);
      put(j * 3 + 1, i + 1, [k.sinB, k.cosB, k.gamma, k.rho0]);
      put(j * 3 + 2, i + 1, [k.sEnd, k.dark, k.seed, 0]);
    });
  });
  return { data, width: KNOT_TEX_W, height };
}
