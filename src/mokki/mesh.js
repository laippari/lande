// Puuosien verkko: hirret, laudat ja palkit yhdessä kevyessä verkossa ja yhdessä materiaalissa.
//
// Hirsi on tässä vain muutama taso: veistetyt kyljet, pyöristetty olka ja selkä, tapit ja
// päädyt. Piilutuksen aallot, vuosirenkaat ja oksat lasketaan varjostimessa pikseleittäin
// (wood.js), joten verkkoon ei tarvita niitä varten yhtään kolmiota.
//
// Jokainen kärki kantaa mukanaan kappaleen omat koordinaatit (lp), joista varjostin laskee puun:
// x tyvestä latvaan, y ylös ja z poikittain, ytimestä mitattuna.

import * as THREE from 'three/webgpu';
import { DIM, interfaceY } from './plan.js';
import { SURF } from '../log/wood.js';

const HW = DIM.wall / 2;
const ARRIS = 0.022; // kyljen ja olan välinen särmä jää tämän verran sauman alle
const STEP = { x: 0.5, z: 0.25 };

export class Timber {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.lp = [];
    this.wood = [];
    this.surf = [];
    this.yaw = [];
    this.tint = [];
    this.idx = [];
    this.logs = 0;
    this.boards = 0;
    this.serial = 0;
  }

  // Monikulmio (3 tai useampi piste), jonka ulkopuoli osoittaa suuntaan hint. vertex lisää kärjen.
  face(vertex, pts, hint, kind, exact = null) {
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
      if (flip) this.idx.push(ids[0], ids[i + 1], ids[i]);
      else this.idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }

  // Hirsi suunnitelmasta (plan.js).
  addLog(piece, plan) {
    const { roofY } = plan;
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
      this.pos.push(x, y, z);
      this.nor.push(n[0], n[1], n[2]);
      this.lp.push(lx, y - (pyButt + (pyTop - pyButt) * (lx / len)), dx * Zl[0] + dz * Zl[1] - piece.pithZ);
      this.wood.push(piece.seed, piece.rButt, piece.rTop, len);
      this.surf.push(kind);
      this.yaw.push(X[0], X[1]);
      this.tint.push(1, 1, 1);
      return this.pos.length / 3 - 1;
    };
    const face = (pts, hint, kind, exact) => this.face(vertex, pts, hint, kind, exact);
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

    // Hirsi voi olla useassa osassa (aukot katkaisevat tai loveavat sen); puu jatkuu osasta toiseen.
    piece.spans.forEach((span, si) => {
      // Poikkileikkaus kohdassa s: alahuuli, kylki, olka, selkä ja sama toisella puolella.
      // Katon yläpuolelle jäävä osa leikataan pois.
      const profile = (s) => {
        const yb = span.yb(s), yt = Math.max(span.yt(s), yb);
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
      const n = Math.max(1, Math.ceil((span.s1 - span.s0) / STEP[piece.axis]));
      const rows = [];
      for (let i = 0; i <= n; i++) rows.push(profile(span.s0 + ((span.s1 - span.s0) * i) / n));
      for (let i = 0; i < n; i++) {
        for (let e = 0; e < 8; e++) {
          const [hint, kind, exact] = edges[e];
          face([rows[i][e], rows[i][e + 1], rows[i + 1][e + 1], rows[i + 1][e]], hint, kind, exact);
        }
      }

      // päät: päätypinta ja mahdollinen lohenpyrstötappi
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
      const cut = { type: 'cut' };
      finish(si === 0 ? piece.start : cut, span.s0, sA, -1);
      finish(si === piece.spans.length - 1 ? piece.end : cut, span.s1, sB, 1);
    });
    this.logs++;
  }

  // Sahattu puutavara: suorakulmainen kappale pisteestä a pisteeseen b. w on leveys suunnassa
  // side ja t paksuus suunnassa up (molemmat kohtisuorassa akselia vastaan). tint sävyttää puun
  // (esimerkiksi ruskeaksi käsitelty terassilauta).
  addBoard({ a, b, w, t, up = [0, 1, 0], tint = [1, 1, 1], seed = null, ends = true }) {
    const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(ax[0], ax[1], ax[2]);
    if (len < 1e-6) return;
    const X = ax.map((v) => v / len);
    // up kohtisuoraan akseliin nähden
    const d = up[0] * X[0] + up[1] * X[1] + up[2] * X[2];
    let U = [up[0] - d * X[0], up[1] - d * X[1], up[2] - d * X[2]];
    const ul = Math.hypot(U[0], U[1], U[2]);
    U = U.map((v) => v / ul);
    const S = [X[1] * U[2] - X[2] * U[1], X[2] * U[0] - X[0] * U[2], X[0] * U[1] - X[1] * U[0]];
    const id = this.serial++;
    const sd = seed ?? Math.round((1 + ((id * 5.37) % 47)) * 16) / 16;
    // sahatavara on rungon sivusta: ydin on kappaleen ulkopuolella
    const py = -0.07 - ((id * 0.618) % 1) * 0.06, pz = (((id * 0.381) % 1) - 0.5) * 0.08;
    const vertex = (x, y, z, n, kind) => {
      const dx = x - a[0], dy = y - a[1], dz = z - a[2];
      this.pos.push(x, y, z);
      this.nor.push(n[0], n[1], n[2]);
      this.lp.push(dx * X[0] + dy * X[1] + dz * X[2], dx * U[0] + dy * U[1] + dz * U[2] - py, dx * S[0] + dy * S[1] + dz * S[2] - pz);
      this.wood.push(sd, 0.2, 0.19, len);
      this.surf.push(kind);
      this.yaw.push(1, 0);
      this.tint.push(tint[0], tint[1], tint[2]);
      return this.pos.length / 3 - 1;
    };
    const P = (e, u, s) => [
      (e ? b[0] : a[0]) + U[0] * u * t * 0.5 + S[0] * s * w * 0.5,
      (e ? b[1] : a[1]) + U[1] * u * t * 0.5 + S[1] * s * w * 0.5,
      (e ? b[2] : a[2]) + U[2] * u * t * 0.5 + S[2] * s * w * 0.5,
    ];
    const neg = (v) => v.map((c) => -c);
    this.face(vertex, [P(0, 1, -1), P(0, 1, 1), P(1, 1, 1), P(1, 1, -1)], U, SURF.SAWN);
    this.face(vertex, [P(0, -1, -1), P(0, -1, 1), P(1, -1, 1), P(1, -1, -1)], neg(U), SURF.SAWN);
    this.face(vertex, [P(0, -1, 1), P(0, 1, 1), P(1, 1, 1), P(1, -1, 1)], S, SURF.SAWN);
    this.face(vertex, [P(0, -1, -1), P(0, 1, -1), P(1, 1, -1), P(1, -1, -1)], neg(S), SURF.SAWN);
    if (ends) {
      this.face(vertex, [P(0, -1, -1), P(0, -1, 1), P(0, 1, 1), P(0, 1, -1)], neg(X), SURF.END);
      this.face(vertex, [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], X, SURF.END);
    }
    this.boards++;
  }

  // Lauta, jonka ääriviiva on monikulmio vaakatasossa (esimerkiksi paljun ympäri sahattu
  // terassilauta). poly: [[x, z], …], yTop: yläpinta, t: paksuus. Syyt kulkevat x-suuntaan.
  addPlank(poly, yTop, t, { tint = [1, 1, 1] } = {}) {
    const id = this.serial++;
    const sd = Math.round((1 + ((id * 5.37) % 47)) * 16) / 16;
    const py = -0.07 - ((id * 0.618) % 1) * 0.06, pz = (((id * 0.381) % 1) - 0.5) * 0.08;
    const o = poly[0];
    let len = 0, cx = 0, cz = 0;
    for (const p of poly) {
      len = Math.max(len, Math.abs(p[0] - o[0]));
      cx += p[0] / poly.length;
      cz += p[1] / poly.length;
    }
    const vertex = (x, y, z, n, kind) => {
      this.pos.push(x, y, z);
      this.nor.push(n[0], n[1], n[2]);
      this.lp.push(x - o[0], y - yTop + t / 2 - py, z - o[1] - pz);
      this.wood.push(sd, 0.2, 0.19, Math.max(len, 0.1));
      this.surf.push(kind);
      this.yaw.push(1, 0);
      this.tint.push(tint[0], tint[1], tint[2]);
      return this.pos.length / 3 - 1;
    };
    const top = poly.map((p) => [p[0], yTop, p[1]]);
    const bot = poly.map((p) => [p[0], yTop - t, p[1]]);
    this.face(vertex, top, [0, 1, 0], SURF.SAWN);
    this.face(vertex, bot, [0, -1, 0], SURF.SAWN);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const dx = poly[j][0] - poly[i][0], dz = poly[j][1] - poly[i][1];
      if (Math.hypot(dx, dz) < 1e-5) continue;
      const hint = [(poly[i][0] + poly[j][0]) / 2 - cx, 0, (poly[i][1] + poly[j][1]) / 2 - cz];
      this.face(vertex, [top[i], top[j], bot[j], bot[i]], hint, Math.abs(dz) > Math.abs(dx) ? SURF.END : SURF.SAWN);
    }
    this.boards++;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('lp', new THREE.Float32BufferAttribute(this.lp, 3));
    g.setAttribute('wood', new THREE.Float32BufferAttribute(this.wood, 4));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 1));
    g.setAttribute('yaw', new THREE.Float32BufferAttribute(this.yaw, 2));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, triangles: this.idx.length / 3, logs: this.logs, boards: this.boards };
  }
}
