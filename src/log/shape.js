// Hirren muoto: mitat ja poikkileikkauksen funktiot.
//
// Koordinaatisto (hirren oma, metreinä): x kulkee ydintä pitkin tyvestä (x = 0) latvaan (x = L),
// y on ylöspäin, z on seinän paksuussuunta. Ulkoseinän puoli on +z.
//
// Hirsi on tehty rungosta, jonka läpimitta on tyvellä noin 38 cm ja latvassa noin 33 cm.
// Kyljet on veistetty 20 cm:n paksuuteen, selkä on kuorittua pyöreää pintaa ja alla on varaus.
// Korkeus varauksen huulista selän harjalle on tyvellä 35 cm ja latvassa 30 cm.
//
// Samat funktiot on kirjoitettu varjostimelle tiedostossa wood.js; kertoimet tulevat täältä,
// jotta verkko ja varjostin laskevat saman pinnan.

export const L = 5.0;
export const HW = 0.1; // puolet veistetystä paksuudesta

const HEIGHT_BUTT = 0.35;
const HEIGHT_TOP = 0.3;
// R + sqrt(R² − HW²) = korkeus  →  R = (korkeus² + HW²) / (2 · korkeus)
export const R_BUTT = (HEIGHT_BUTT ** 2 + HW ** 2) / (2 * HEIGHT_BUTT);
export const R_TOP = (HEIGHT_TOP ** 2 + HW ** 2) / (2 * HEIGHT_TOP);
export const FLARE = 0.004; // tyven levenemä

// Ytimen paikka poikkileikkauksessa: Σ a · sin(k·x + φ). Runko ei ole viivasuora.
export const PITH_Y = [
  [0.011, 0.9, 0.35],
  [0.004, 2.3, 1.9],
  [0.0018, 4.3, 2.1],
];
export const PITH_Z = [
  [0.006, 0.62, -0.25],
  [0.0015, 3.1, 1.4],
];

// Rungon pinnan epäpyöreys: säde = R0(x) · (1 + Σ a · sin(m·θ + k·x + φ)).
export const OVAL = [
  [0.011, 2, 0.35, 0.9],
  [0.007, 3, -0.8, 2.2],
  [0.005, 5, 1.7, 4.0],
  [0.004, 1, 2.3, 1.0],
  [0.004, 0, 3.3, 0.5],
];

// Selän vuolujäljet: pitkät, noin 3,5 cm leveät viisteet rungon suuntaan.
export const FACET = {
  width: 0.035,
  drift: [
    [0.8, 1.3, 0.5],
    [0.5, 3.7, 2.0],
  ],
  base: 0.0003,
  baseVar: 0.0005,
};

// Varaus: ura hirren alapinnassa, syvyys huulista mitattuna.
export const GROOVE = { depth: 0.035, vary: 0.004, k: 1.1, phase: 0.3, power: 2.4 };

// Lohenpyrstötappi. Tapin ylä- ja alapinta ovat tasoja, jotka viettävät kahteen suuntaan.
export const TENON = {
  overhang: 0.035, // tapin pää ulkonee ristiin tulevan seinän pinnasta
  slopeAcross: 0.19, // tasojen kaltevuus seinän paksuussuunnassa (noin 11°)
  slopeAlong: 0.13, // ja hirren pituussuunnassa (noin 7°)
  heightButt: 0.16, // tapin korkeus loven keskellä
  heightTop: 0.14,
};
export const TENON_LEN = TENON.overhang + 2 * HW;

// Rungon muoto puumateriaalille (wood.js).
export const logShape = {
  length: L,
  rButt: R_BUTT,
  rTop: R_TOP,
  flare: FLARE,
  pithY: PITH_Y,
  pithZ: PITH_Z,
  oval: OVAL,
  rings: 96, // vuosirenkaita tyvellä: noin satavuotias mänty
  ringExp: 1.25, // renkaat ovat ytimen lähellä leveämpiä (4–5 mm) kuin pinnassa (1,6 mm)
  heart: 0.6, // sydänpuun osuus säteestä
};

const sumSin = (terms, x) => {
  let s = 0;
  for (const [a, k, p] of terms) s += a * Math.sin(k * x + p);
  return s;
};

export const pithY = (x) => sumSin(PITH_Y, x);
export const pithZ = (x) => sumSin(PITH_Z, x);

export function radius0(x) {
  return R_TOP + (R_BUTT - FLARE - R_TOP) * (1 - x / L) + FLARE * Math.exp(-x / 0.6);
}

export function ovality(x, theta) {
  let s = 0;
  for (const [a, m, k, p] of OVAL) s += a * Math.sin(m * theta + k * x + p);
  return s;
}

// Rungon (kuoritun pinnan) säde ytimestä mitattuna.
export function radiusOuter(x, theta) {
  return radius0(x) * (1 + ovality(x, theta));
}

// Vuolun viisteen syvyys kuoritun pinnan alapuolella.
export function facetDepth(x, theta) {
  const R = radius0(x);
  const dTheta = FACET.width / R;
  const f = theta / dTheta + sumSin(FACET.drift, x);
  const m = Math.round(f);
  const delta = (f - m) * dTheta;
  const base = FACET.base + FACET.baseVar * (0.5 + 0.5 * Math.sin(m * 12.9898 + x * 1.1));
  const half = dTheta / 2;
  return R - (R * Math.cos(half) - base) / Math.cos(delta);
}

// Selän pinnan säde: kuorittu pinta, josta vuolu on ottanut viisteen.
export function radiusTop(x, theta) {
  return radiusOuter(x, theta) - facetDepth(x, theta);
}

// Selän korkeus kohdassa (x, z).
export function topY(x, z) {
  const py = pithY(x);
  const dz = z - pithZ(x);
  let theta = Math.atan2(Math.sqrt(Math.max(radius0(x) ** 2 - dz * dz, 0)), dz);
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const R = radiusTop(x, theta);
    y = Math.sqrt(Math.max(R * R - dz * dz, 0));
    theta = Math.atan2(y, dz);
  }
  return py + y;
}

// Rungon alapinnan korkeus kohdassa (x, z): tästä saadaan varauksen huulet.
export function bottomY(x, z) {
  const py = pithY(x);
  const dz = z - pithZ(x);
  let theta = Math.atan2(-Math.sqrt(Math.max(radius0(x) ** 2 - dz * dz, 0)), dz);
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const R = radiusOuter(x, theta);
    y = -Math.sqrt(Math.max(R * R - dz * dz, 0));
    theta = Math.atan2(y, dz);
  }
  return py + y;
}

export function grooveDepth(x) {
  return GROOVE.depth + GROOVE.vary * Math.sin(GROOVE.k * x + GROOVE.phase);
}

// Tapin tasot. end: 0 = tyvi, 1 = latva. u = etäisyys hirren päästä, z = paksuussuunta.
export function tenonPlanes(end) {
  const hc = end === 0 ? TENON.heightButt : TENON.heightTop;
  const uc = TENON.overhang + HW;
  const sa = TENON.slopeAlong;
  const sz = TENON.slopeAcross;
  // Yläpinta viettää ulkoseinää (+z) ja hirren runkoa kohti, alapinta päinvastoin: tappi on
  // paksuimmillaan päässä ja sisäpinnan puolella, joten nurkka lukittuu.
  return {
    top: (u, z) => hc / 2 - sa * (u - uc) - sz * z,
    bottom: (u, z) => -hc / 2 + sa * (u - uc) + sz * z,
  };
}
