// Mökin rungon suunnitelma: mitkä hirret, missä, minkä kokoisina ja miten ne liittyvät nurkissa.
//
// Koordinaatisto (metreinä): x kulkee pitkien seinien suuntaan, z on syvyys ja y ylös.
// Etuseinä on +z-puolella; pulpettikatto nousee sitä kohti.
//
// Seinä on pino hirsikerroksia. Kerrosten väliset saumat eivät ole viivasuoria: hirsi on
// tyvestä paksumpi kuin latvasta, joten sauma viettää hieman ja tyvet vuorottelevat
// kerroksittain. Päätyseinien kerrokset ovat puoli kerrosta ylempänä kuin pitkien seinien,
// ja nurkassa hirret lomittuvat lohenpyrstötapein.

import { mulberry32 } from '../log/hewing.js';

export const DIM = {
  width: 14, // ulkomitta x-suunnassa
  depth: 6, // ulkomitta z-suunnassa
  wall: 0.2, // hirren paksuus
  overhang: 0.035, // tapin pää ulkonee ristiin tulevan seinän pinnasta
  plinth: 0.3, // sokkelin korkeus
  height: 4.0, // sisäkorkeus matalalla seinällä
  course: 0.285, // hirsikerran keskikorkeus
  dovetail: 0.15, // lohenpyrstön tasojen kaltevuus
};

// Katon kaltevuudet ovat samat kuin talo-projektissa: pulpetti 14 %, harja 1:2.
export const ROOF = { monoSlope: 0.14, gableSlope: 0.5 };

const HW = DIM.wall / 2;
const lerp = (a, b, t) => a + (b - a) * t;

export function planCabin({ roofType = 'mono', seed = 7 } = {}) {
  const rnd = mulberry32(seed * 7919 + 13);
  const X0 = -DIM.width / 2, X1 = DIM.width / 2;
  const Z0 = -DIM.depth / 2, Z1 = DIM.depth / 2;
  const Y0 = DIM.plinth;
  const span = DIM.depth - DIM.wall; // seinälinjojen väli

  // Katon alapinnan korkeus kohdassa z. Pulpetti nousee takaseinältä etuseinälle,
  // harjakaton harja kulkee pitkien seinien suuntaan.
  const roofY = roofType === 'mono'
    ? (z) => Y0 + DIM.height + ROOF.monoSlope * (z - (Z0 + HW))
    : (z) => Y0 + DIM.height + ROOF.gableSlope * (span / 2 - Math.abs(z));
  const roofMax = roofType === 'mono' ? roofY(Z1 + HW) : roofY(0);

  // --- kerrosten korkeudet ---
  // Takaseinän kerrokset täyttävät sisäkorkeuden tasan; pulpettikatossa etuseinä jatkuu
  // siitä ylöspäin nousun verran.
  const heights = [];
  const fill = (total, count) => {
    const w = [];
    for (let i = 0; i < count; i++) w.push(1 + (rnd() - 0.5) * 0.3);
    const sum = w.reduce((a, b) => a + b, 0);
    for (const v of w) heights.push((v / sum) * total);
  };
  const nLow = Math.round(DIM.height / DIM.course);
  fill(DIM.height, nLow);
  const rise = roofType === 'mono' ? ROOF.monoSlope * span : 0;
  const nRise = Math.round(rise / DIM.course);
  if (nRise > 0) fill(rise, nRise);
  const nFront = nLow + nRise;
  const nBack = nLow;
  // kuvitteelliset jatkokerrokset päätykolmioita varten
  while (Y0 + heights.reduce((a, b) => a + b, 0) < roofMax + 0.6) heights.push(DIM.course * (1 + (rnd() - 0.5) * 0.24));
  const base = [Y0];
  for (const h of heights) base.push(base[base.length - 1] + h);

  // --- pitkien seinien saumat ---
  // sauma k on kerroksen k alapinta; alin ja ylin sauma ovat vaakasuorassa
  const makeSeams = (count) => {
    const seams = [];
    for (let k = 0; k <= count; k++) {
      const level = k === 0 || k === count;
      const tilt = level ? 0 : (k % 2 ? 1 : -1) * (0.005 + 0.009 * rnd());
      const a1 = level ? 0 : 0.0025 * rnd(), k1 = 1.2 + rnd() * 1.4, p1 = rnd() * 6.28;
      const a2 = level ? 0 : 0.0015 * rnd(), k2 = 3.1 + rnd() * 2, p2 = rnd() * 6.28;
      const y0 = base[k];
      seams.push((x) => y0 + tilt * (x / DIM.width) + a1 * Math.sin(k1 * x + p1) + a2 * Math.sin(k2 * x + p2));
    }
    return seams;
  };
  const seamFront = makeSeams(nFront);
  const seamBack = makeSeams(nBack);
  // pitkän seinän sauma k nurkassa x; seinän yläpuolella käytetään kuvitteellista jatkoa
  const seamAt = (seams, k, x) => (k < seams.length ? seams[k](x) : base[k]);

  // --- nurkat ---
  // O on nurkan ulkokärki, dirA osoittaa pitkää seinää pitkin sisään ja dirB päätyseinää pitkin.
  // I[i] ovat tappien välisten tasojen korkeudet nurkan keskellä: parillinen taso on
  // päätyhirren (alla) ja pitkän seinän hirren (päällä) välissä, pariton toisin päin.
  const makeCorner = (x, z, seams, count) => {
    const I = [];
    for (let k = 0; k < count; k++) {
      const a = seams[k](x), h = seams[k + 1](x) - a;
      I.push(a + 0.25 * h, a + 0.75 * h);
    }
    return { O: [x, z], dirA: [x < 0 ? 1 : -1, 0], dirB: [0, z < 0 ? 1 : -1], I, nA: count };
  };
  const corners = {
    backLeft: makeCorner(X0, Z0, seamBack, nBack),
    backRight: makeCorner(X1, Z0, seamBack, nBack),
    frontLeft: makeCorner(X0, Z1, seamFront, nFront),
    frontRight: makeCorner(X1, Z1, seamFront, nFront),
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

  // --- pitkät seinät: kolme hirttä peräkkäin, jatkokset limittäin ---
  const longWall = (name, zc, seams, count, cornerL, cornerR) => {
    let prev = [];
    for (let k = 0; k < count; k++) {
      let joints;
      for (let tries = 0; tries < 40; tries++) {
        joints = [lerp(-3.4, -1.3, rnd()), lerp(1.3, 3.4, rnd())];
        if (joints.every((j) => prev.every((p) => Math.abs(p - j) > 0.7))) break;
      }
      prev = joints;
      const cuts = [X0, ...joints, X1];
      for (let i = 0; i < cuts.length - 1; i++) {
        const first = i === 0, last = i === cuts.length - 2;
        const s0 = first ? X0 + DIM.wall : cuts[i] + 0.001;
        const s1 = last ? X1 - DIM.wall : cuts[i + 1] - 0.001;
        const yb = seams[k], yt = seams[k + 1];
        const tenon = (corner) => ({ type: 'tenon', corner, role: 'A', bot: { i: 2 * k }, top: { i: 2 * k + 1 } });
        pieces.push({
          wall: name, axis: 'x', c: zc, course: k, s0, s1, yb, yt,
          start: first ? tenon(cornerL) : { type: 'butt' },
          end: last ? tenon(cornerR) : { type: 'butt' },
          ...wood(yb, yt, s0, s1),
        });
      }
    }
  };
  longWall('front', Z1 - HW, seamFront, nFront, corners.frontLeft, corners.frontRight);
  longWall('back', Z0 + HW, seamBack, nBack, corners.backLeft, corners.backRight);

  // --- päätyseinät: yksi hirsi kerrosta kohti, leikataan katon kaltevuuteen ---
  const endWall = (name, xc, cornerBack, cornerFront) => {
    const xCorner = cornerBack.O[0];
    // sauma j on kerroksen j alapinta: pitkän seinän kerroksen puoliväli kummassakin nurkassa
    const seam = (j) => {
      if (j < 0) return () => Y0;
      const yBack = (seamAt(seamBack, j, xCorner) + seamAt(seamBack, j + 1, xCorner)) / 2;
      const yFront = (seamAt(seamFront, j, xCorner) + seamAt(seamFront, j + 1, xCorner)) / 2;
      const a = 0.003 * rnd(), ph = rnd() * 6.28, kk = 1.5 + rnd() * 2;
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
      for (let i = 0; i <= 240; i++) zs.push(lerp(Z0 - DIM.overhang, Z1 + DIM.overhang, i / 240));
      const inside = zs.filter(under);
      if (!inside.length) break;
      const zA = inside[0], zB = inside[inside.length - 1];
      if (zB - zA < 0.12) continue;
      const tenon = (corner) => {
        if (j >= corner.nA) return null;
        return {
          type: 'tenon', corner, role: 'B',
          bot: j < 0 ? { flat: Y0 } : { i: 2 * j + 1 },
          top: j === corner.nA - 1 ? { flat: true } : { i: 2 * j + 2 },
        };
      };
      const tb = zA <= Z0 ? tenon(cornerBack) : null;
      const tf = zB >= Z1 ? tenon(cornerFront) : null;
      const s0 = tb ? Z0 + DIM.wall : zA;
      const s1 = tf ? Z1 - DIM.wall : zB;
      pieces.push({
        wall: name, axis: 'z', c: xc, course: j, s0, s1, yb, yt,
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
    roofY,
    roofMax,
    bounds: { X0, X1, Z0, Z1, Y0 },
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
