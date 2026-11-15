// Mökin rungon verkko: kaikki hirret yhdessä kevyessä verkossa.
//
// Hirsi on tässä vain muutama taso: veistetyt kyljet, pyöristetty olka ja selkä, tapit ja
// päädyt. Piilutuksen aallot, vuosirenkaat ja oksat lasketaan varjostimessa pikseleittäin
// (wood.js), joten verkkoon ei tarvita niitä varten yhtään kolmiota.
//
// Jokainen kärki kantaa mukanaan hirren omat koordinaatit (lp), joista varjostin laskee puun:
// x tyvestä latvaan, y ylös ja z poikittain, ytimestä mitattuna.

import * as THREE from 'three/webgpu';
import { DIM, interfaceY } from './plan.js';
import { SURF } from '../log/wood.js';

const HW = DIM.wall / 2;
const ARRIS = 0.022; // kyljen ja olan välinen särmä jää tämän verran sauman alle
const STEP = { x: 0.5, z: 0.25 };

export function buildFrameGeometry(plan) {
  const pos = [], nor = [], lp = [], wood = [], surf = [], yaw = [], idx = [];
  const { roofY } = plan;

  for (const piece of plan.pieces) {
    const alongX = piece.axis === 'x';
    const ad = alongX ? [1, 0] : [0, 1]; // hirren suunta (x, z)
    const td = alongX ? [0, 1] : [1, 0]; // poikittaissuunta
    const world = (s, t) => (alongX ? [s, piece.c + t] : [piece.c + t, s]);
    const reach = DIM.wall + DIM.overhang;
    const sA = piece.start.type === 'tenon' ? piece.s0 - reach : piece.s0;
    const sB = piece.end.type === 'tenon' ? piece.s1 + reach : piece.s1;
    const len = sB - sA;

    // hirren oma koordinaatisto: x tyvestä latvaan
    const X = piece.flip ? [-ad[0], -ad[1]] : ad;
    const Zl = [-X[1], X[0]];
    const O = world(piece.flip ? sB : sA, 0);
    const mid = (s) => (piece.yb(s) + piece.yt(s)) / 2 + piece.pithY;
    const pyButt = mid(piece.flip ? piece.s1 : piece.s0);
    const pyTop = mid(piece.flip ? piece.s0 : piece.s1);

    const vertex = (x, y, z, n, kind) => {
      const dx = x - O[0], dz = z - O[1];
      const lx = dx * X[0] + dz * X[1];
      pos.push(x, y, z);
      nor.push(n[0], n[1], n[2]);
      lp.push(lx, y - (pyButt + (pyTop - pyButt) * (lx / len)), dx * Zl[0] + dz * Zl[1] - piece.pithZ);
      wood.push(piece.seed, piece.rButt, piece.rTop, len);
      surf.push(kind);
      yaw.push(X[0], X[1]);
      return pos.length / 3 - 1;
    };

    // Monikulmio (3 tai useampi piste), jonka ulkopuoli osoittaa suuntaan hint.
    const face = (pts, hint, kind, exact = null) => {
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return;
      const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
      const s = flip ? -1 / l : 1 / l;
      const n = exact || [nx * s, ny * s, nz * s];
      const ids = pts.map((p) => vertex(p[0], p[1], p[2], n, kind));
      for (let i = 1; i < ids.length - 1; i++) {
        if (flip) idx.push(ids[0], ids[i + 1], ids[i]);
        else idx.push(ids[0], ids[i], ids[i + 1]);
      }
    };

    // Poikkileikkaus kohdassa s: alahuuli, kylki, olka, selkä ja sama toisella puolella.
    // Katon yläpuolelle jäävä osa leikataan pois.
    const profile = (s) => {
      const yb = piece.yb(s), yt = piece.yt(s);
      const arris = Math.max(yb, yt - ARRIS);
      const raw = [
        [-HW + 0.035, yb + 0.006], [-HW, yb], [-HW, arris], [-HW + 0.028, yt + 0.003], [0, yt + 0.012],
        [HW - 0.028, yt + 0.003], [HW, arris], [HW, yb], [HW - 0.035, yb + 0.006],
      ];
      return raw.map(([t, y]) => {
        const [x, z] = world(s, t);
        return [x, Math.min(y, roofY(z)), z];
      });
    };

    // --- runko ---
    const n = Math.max(1, Math.ceil((piece.s1 - piece.s0) / STEP[piece.axis]));
    const rows = [];
    for (let i = 0; i <= n; i++) rows.push(profile(piece.s0 + ((piece.s1 - piece.s0) * i) / n));
    const out = (t, y) => [td[0] * t, y, td[1] * t];
    const edges = [
      [out(0, -1), SURF.GROOVE, null],
      [out(-1, 0), SURF.HEWN, out(-1, 0)],
      [out(-0.5, 1), SURF.TOP, null],
      [out(-0.2, 1), SURF.TOP, null],
      [out(0.2, 1), SURF.TOP, null],
      [out(0.5, 1), SURF.TOP, null],
      [out(1, 0), SURF.HEWN, out(1, 0)],
      [out(0, -1), SURF.GROOVE, null],
    ];
    for (let i = 0; i < n; i++) {
      for (let e = 0; e < 8; e++) {
        const [hint, kind, exact] = edges[e];
        face([rows[i][e], rows[i][e + 1], rows[i + 1][e + 1], rows[i + 1][e]], hint, kind, exact);
      }
    }

    // --- päät: päätypinta ja mahdollinen lohenpyrstötappi ---
    const finish = (end, sBody, sTip, sign) => {
      const outward = [ad[0] * sign, 0, ad[1] * sign];
      face(profile(sBody), outward, SURF.END);
      if (end.type !== 'tenon') return;
      const at = (s, t) => {
        const [x, z] = world(s, t);
        let bot = typeof end.bot.flat === 'number' ? end.bot.flat : interfaceY(end.corner, end.bot.i, x, z);
        let top = end.top.flat ? piece.yt(sBody) : interfaceY(end.corner, end.top.i, x, z);
        top = Math.min(top, roofY(z));
        bot = Math.min(bot, top);
        return { bot: [x, bot, z], top: [x, top, z] };
      };
      const tipL = at(sTip, -HW), tipR = at(sTip, HW), bodyL = at(sBody, -HW), bodyR = at(sBody, HW);
      face([tipL.bot, bodyL.bot, bodyL.top, tipL.top], out(-1, 0), SURF.HEWN, out(-1, 0));
      face([tipR.bot, bodyR.bot, bodyR.top, tipR.top], out(1, 0), SURF.HEWN, out(1, 0));
      face([tipL.top, tipR.top, bodyR.top, bodyL.top], [0, 1, 0], SURF.NOTCH);
      face([tipL.bot, tipR.bot, bodyR.bot, bodyL.bot], [0, -1, 0], SURF.NOTCH);
      face([tipL.bot, tipR.bot, tipR.top, tipL.top], outward, SURF.END);
    };
    finish(piece.start, piece.s0, sA, -1);
    finish(piece.end, piece.s1, sB, 1);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('lp', new THREE.Float32BufferAttribute(lp, 3));
  g.setAttribute('wood', new THREE.Float32BufferAttribute(wood, 4));
  g.setAttribute('surf', new THREE.Float32BufferAttribute(surf, 1));
  g.setAttribute('yaw', new THREE.Float32BufferAttribute(yaw, 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, triangles: idx.length / 3, logs: plan.pieces.length };
}
