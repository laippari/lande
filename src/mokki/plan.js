// Mökin rungon suunnitelma: mitkä hirret, missä, minkä kokoisina ja miten ne liittyvät nurkissa.
//
// Mökin oma koordinaatisto (metreinä): x kulkee pitkien seinien suuntaan, z on syvyys ja y ylös.
// y = 0 on alimman hirren alapinta eli perustuspalkkien yläpinta. Etuseinä on +z-puolella;
// pulpettikatto nousee sitä kohti.
//
// Seinä on pino hirsikerroksia. Jokainen hirsi kapenee tyvestä latvaan, joten kerros on toisesta
// päästä paksumpi kuin toisesta, ja seuraava kerros veistetään sen selkään. Tyvet vuorottelevat,
// jotta seinä pysyy keskimäärin vaakasuorassa; saumat mutkittelevat sen ympärillä muutaman sentin.
// Päätyseinien kerrokset ovat puoli kerrosta ylempänä kuin pitkien seinien, ja nurkassa hirret
// lomittuvat lohenpyrstötapein.

import { mulberry32 } from '../log/hewing.js';

export const DIM = {
  width: 12, // ulkomitta x-suunnassa
  depth: 8, // ulkomitta z-suunnassa
  wall: 0.2, // hirren paksuus
  overhang: 0.035, // tapin pää ulkonee ristiin tulevan seinän pinnasta
  floor: 0.33, // lattian pinta alimman hirren alapinnasta (rossipohjan palkit ja laudat)
  height: 3.0, // sisäkorkeus lattiasta matalan seinän yläpäähän
  course: 0.31, // hirsikerran keskikorkeus
  dovetail: 0.15, // lohenpyrstön tasojen kaltevuus
};

// Etuseinän ikkunat: neljä metrin levyistä ja 2,5 m korkeaa ikkunaa kahtena parina keskellä
// seinää, alareuna lattian rajassa.
export const WINDOWS = { width: 1.0, height: 2.5, mullion: 0.1, gap: 1.2 };

// Katon kaltevuudet ovat samat kuin talo-projektissa: pulpetti 14 %, harja 1:2.
export const ROOF = { monoSlope: 0.14, gableSlope: 0.5 };

const HW = DIM.wall / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Paloittain lineaarinen funktio pisteiden (x, y) kautta.
const polyline = (xs, ys) => (x) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return lerp(ys[i - 1], ys[i], (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
  return ys[ys.length - 1];
};

export function windowOpenings() {
  const pair = 2 * WINDOWS.width + WINDOWS.mullion;
  const y0 = DIM.floor, y1 = DIM.floor + WINDOWS.height;
  return [
    { x0: -WINDOWS.gap / 2 - pair, x1: -WINDOWS.gap / 2, y0, y1 },
    { x0: WINDOWS.gap / 2, x1: WINDOWS.gap / 2 + pair, y0, y1 },
  ];
}

export function planCabin({ roofType = 'mono', seed = 7 } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  const X0 = -DIM.width / 2, X1 = DIM.width / 2;
  const Z0 = -DIM.depth / 2, Z1 = DIM.depth / 2;
  const span = DIM.depth - DIM.wall; // seinälinjojen väli
  const low = DIM.floor + DIM.height; // matalan seinän yläpää

  // Katon alapinnan korkeus kohdassa z. Pulpetti nousee takaseinältä etuseinälle,
  // harjakaton harja kulkee pitkien seinien suuntaan.
  const roofY = roofType === 'mono'
    ? (z) => low + ROOF.monoSlope * (z - (Z0 + HW))
    : (z) => low + ROOF.gableSlope * (span / 2 - Math.abs(z));
  const roofMax = roofType === 'mono' ? roofY(Z1 + HW) : roofY(0);

  // --- kerrosten tavoitekorkeudet ---
  // Hirsiä on eri paksuisia: useimmat 27–34 cm, joukossa muutama järeä.
  const heights = [];
  const fill = (total, count) => {
    const w = [];
    for (let i = 0; i < count; i++) w.push(rnd() < 0.18 ? 1.2 + rnd() * 0.12 : 0.86 + rnd() * 0.26);
    const sum = w.reduce((a, b) => a + b, 0);
    for (const v of w) heights.push((v / sum) * total);
  };
  const nLow = Math.round(low / DIM.course);
  fill(low, nLow);
  const rise = roofType === 'mono' ? ROOF.monoSlope * span : 0;
  const nRise = Math.round(rise / DIM.course);
  if (nRise > 0) fill(rise, nRise);
  const nFront = nLow + nRise;
  const nBack = nLow;
  // kuvitteelliset jatkokerrokset päätykolmioita varten
  while (heights.reduce((a, b) => a + b, 0) < roofMax + 0.6) heights.push(DIM.course * (0.9 + rnd() * 0.25));
  const base = [0];
  for (const h of heights) base.push(base[base.length - 1] + h);

  const openings = { front: windowOpenings(), back: [], left: [], right: [] };

  // --- pitkät seinät: saumat ja jatkokset ---
  // Jokaisessa kerroksessa hirret kapenevat päästä toiseen 2–6 cm, ja paksu pää on eri puolella
  // kuin alemmassa kerroksessa. Ylin sauma on vaakasuorassa.
  const makeLongWall = (count, holes) => {
    const seams = [() => 0];
    const joints = [];
    let prev = [];
    let sign = rnd() < 0.5 ? 1 : -1;
    for (let k = 0; k < count; k++) {
      const below = seams[k];
      // aukkojen korkeudella hirsi katkeaa aukkoihin; aukon ala- ja yläpuolinen hirsi jatketaan
      // aukkojen välisen pielen kohdalta, ei aukon päältä
      const yMid = base[k] + heights[k] / 2;
      const band = holes.length && yMid > holes[0].y0 && yMid < holes[0].y1;
      const edge = holes.length && !band && (Math.abs(base[k + 1] - holes[0].y0) < 0.45 || Math.abs(base[k] - holes[0].y1) < 0.45);
      let js = [];
      if (!band) {
        for (let tries = 0; tries < 60; tries++) {
          js = edge
            ? [(rnd() - 0.5) * 0.7]
            : rnd() < 0.35
              ? [(rnd() - 0.5) * 1.6]
              : [lerp(-0.34, -0.12, rnd()) * DIM.width, lerp(0.12, 0.34, rnd()) * DIM.width];
          if (js.every((j) => prev.every((p) => Math.abs(p - j) > 0.6))) break;
        }
      }
      prev = js;
      joints.push(js);
      if (k === count - 1) {
        seams.push(() => base[count]);
        continue;
      }
      const xs = [X0, ...js, X1];
      sign = -sign;
      const hs = xs.map((x, i) => {
        const swing = (i % 2 ? -1 : 1) * sign * (0.01 + rnd() * 0.017);
        return clamp(heights[k] + swing - 0.7 * (below(x) - base[k]) + (rnd() - 0.5) * 0.012, 0.225, 0.42);
      });
      const h = polyline(xs, hs);
      seams.push((x) => below(x) + h(x));
    }
    return { seams, joints, count, holes };
  };
  const front = makeLongWall(nFront, openings.front);
  const back = makeLongWall(nBack, openings.back);
  // pitkän seinän sauma k kohdassa x; seinän yläpuolella käytetään kuvitteellista jatkoa
  const seamAt = (wall, k, x) => (k <= wall.count ? wall.seams[k](x) : base[k]);

  // --- nurkat ---
  // O on nurkan ulkokärki, dirA osoittaa pitkää seinää pitkin sisään ja dirB päätyseinää pitkin.
  // I[i] ovat tappien välisten tasojen korkeudet nurkan keskellä: parillinen taso on
  // päätyhirren (alla) ja pitkän seinän hirren (päällä) välissä, pariton toisin päin.
  const makeCorner = (x, z, wall) => {
    const I = [];
    for (let k = 0; k < wall.count; k++) {
      const a = wall.seams[k](x), h = wall.seams[k + 1](x) - a;
      I.push(a + 0.25 * h, a + 0.75 * h);
    }
    return { O: [x, z], dirA: [x < 0 ? 1 : -1, 0], dirB: [0, z < 0 ? 1 : -1], I, nA: wall.count };
  };
  const corners = {
    backLeft: makeCorner(X0, Z0, back),
    backRight: makeCorner(X1, Z0, back),
    frontLeft: makeCorner(X0, Z1, front),
    frontRight: makeCorner(X1, Z1, front),
  };

  const pieces = [];
  let serial = 0;
  // Hirren puu: siemen ja rungon säteet tyvellä ja latvassa. Kyljen korkeus määrää, kuinka
  // paksusta rungosta hirsi on vähintään veistetty.
  const wood = (yb, yt, s0, s1) => {
    const hA = yt(s0) - yb(s0), hB = yt(s1) - yb(s1);
    const flip = hB > hA ? true : hA > hB ? false : rnd() < 0.5; // tyvi paksumpaan päähän
    const len = Math.abs(s1 - s0);
    const thick = Math.hypot(HW, Math.max(hA, hB) / 2 + 0.012);
    const thin = Math.hypot(HW, Math.min(hA, hB) / 2 + 0.012);
    const rTop = thin * (1 + rnd() * 0.05);
    return {
      seed: Math.round((1 + ((serial++ * 7.31 + rnd() * 40) % 48)) * 16) / 16, // 1/16:n tarkkuudella, ks. wood.js
      flip,
      rTop,
      rButt: Math.max(thick, rTop + len * (0.007 + rnd() * 0.004)),
      pithY: (rnd() - 0.5) * 0.03,
      pithZ: (rnd() - 0.5) * 0.024,
    };
  };

  // Aukot katkaisevat hirren tai loveavat sitä: aukon korkeudella hirsi puuttuu aukon kohdalta,
  // aukon alla ja päällä siitä jää jäljelle osa.
  const spansFor = (s0, s1, yb, yt, holes) => {
    let spans = [{ s0, s1, yb, yt }];
    for (const hole of holes) {
      const next = [];
      for (const sp of spans) {
        const a = Math.max(sp.s0, hole.x0), b = Math.min(sp.s1, hole.x1);
        if (b - a < 0.01) {
          next.push(sp);
          continue;
        }
        const m = (a + b) / 2, cb = sp.yb(m), ct = sp.yt(m);
        if (ct <= hole.y0 + 0.012 || cb >= hole.y1 - 0.012) {
          next.push(sp);
          continue;
        }
        if (sp.s0 < a - 0.01) next.push({ ...sp, s1: a });
        if (cb < hole.y0 - 0.03) next.push({ s0: a, s1: b, yb: sp.yb, yt: (x) => Math.min(sp.yt(x), hole.y0) });
        else if (ct > hole.y1 + 0.03) next.push({ s0: a, s1: b, yb: (x) => Math.max(sp.yb(x), hole.y1), yt: sp.yt });
        if (sp.s1 > b + 0.01) next.push({ ...sp, s0: b });
      }
      spans = next;
    }
    return spans;
  };

  const longWall = (name, zc, wall, cornerL, cornerR) => {
    for (let k = 0; k < wall.count; k++) {
      const cuts = [X0, ...wall.joints[k], X1];
      for (let i = 0; i < cuts.length - 1; i++) {
        const first = i === 0, last = i === cuts.length - 2;
        const s0 = first ? X0 + DIM.wall : cuts[i] + 0.001;
        const s1 = last ? X1 - DIM.wall : cuts[i + 1] - 0.001;
        const yb = wall.seams[k], yt = wall.seams[k + 1];
        const tenon = (corner) => ({ type: 'tenon', corner, role: 'A', bot: { i: 2 * k }, top: { i: 2 * k + 1 } });
        pieces.push({
          wall: name, axis: 'x', c: zc, course: k, s0, s1, yb, yt,
          spans: spansFor(s0, s1, yb, yt, wall.holes),
          start: first ? tenon(cornerL) : { type: 'butt' },
          end: last ? tenon(cornerR) : { type: 'butt' },
          ...wood(yb, yt, s0, s1),
        });
      }
    }
  };
  longWall('front', Z1 - HW, front, corners.frontLeft, corners.frontRight);
  longWall('back', Z0 + HW, back, corners.backLeft, corners.backRight);

  // --- päätyseinät: yksi hirsi kerrosta kohti, leikataan katon kaltevuuteen ---
  const endWall = (name, xc, cornerBack, cornerFront) => {
    const xCorner = cornerBack.O[0];
    // sauma j on kerroksen j alapinta: pitkän seinän kerroksen puoliväli kummassakin nurkassa
    const seam = (j) => {
      if (j < 0) return () => 0;
      const yBack = (seamAt(back, j, xCorner) + seamAt(back, j + 1, xCorner)) / 2;
      const yFront = (seamAt(front, j, xCorner) + seamAt(front, j + 1, xCorner)) / 2;
      const a = 0.004 * rnd(), ph = rnd() * 6.28, kk = 1.2 + rnd() * 1.6;
      return (z) => {
        const t = (z - Z0) / DIM.depth;
        return lerp(yBack, yFront, t) + a * Math.sin(kk * z + ph) * Math.sin(Math.PI * t);
      };
    };
    for (let j = -1; j < base.length - 2; j++) {
      const yb = seam(j), yt = seam(j + 1);
      // osa, jossa hirsi on katon alla
      const under = (z) => roofY(z) - yb(z) > 0.02;
      const zs = [];
      for (let i = 0; i <= 320; i++) zs.push(lerp(Z0 - DIM.overhang, Z1 + DIM.overhang, i / 320));
      const inside = zs.filter(under);
      if (!inside.length) break;
      const zA = inside[0], zB = inside[inside.length - 1];
      if (zB - zA < 0.12) continue;
      const tenon = (corner) => {
        if (j >= corner.nA) return null;
        return {
          type: 'tenon', corner, role: 'B',
          bot: j < 0 ? { flat: 0 } : { i: 2 * j + 1 },
          top: j === corner.nA - 1 ? { flat: true } : { i: 2 * j + 2 },
        };
      };
      const tb = zA <= Z0 ? tenon(cornerBack) : null;
      const tf = zB >= Z1 ? tenon(cornerFront) : null;
      const s0 = tb ? Z0 + DIM.wall : zA;
      const s1 = tf ? Z1 - DIM.wall : zB;
      pieces.push({
        wall: name, axis: 'z', c: xc, course: j, s0, s1, yb, yt,
        spans: spansFor(s0, s1, yb, yt, openings[name]),
        start: tb || { type: 'cut' },
        end: tf || { type: 'cut' },
        ...wood(yb, yt, s0, s1),
      });
    }
  };
  endWall('left', X0 + HW, corners.backLeft, corners.frontLeft);
  endWall('right', X1 - HW, corners.backRight, corners.frontRight);

  return {
    roofType,
    pieces,
    openings,
    roofY,
    roofMax,
    bounds: { X0, X1, Z0, Z1 },
    counts: { front: nFront, back: nBack },
  };
}

// Nurkan tapin tason korkeus kohdassa (x, z). Parillinen taso nousee pitkän seinän suuntaan
// ja laskee päätyseinän suuntaan, pariton päinvastoin: tapit kiilautuvat toisiinsa.
export function interfaceY(corner, i, x, z) {
  const dx = x - corner.O[0], dz = z - corner.O[1];
  const p = dx * corner.dirA[0] + dz * corner.dirA[1];
  const q = dx * corner.dirB[0] + dz * corner.dirB[1];
  return corner.I[i] + (i % 2 === 0 ? 1 : -1) * DIM.dovetail * (p - q);
}
