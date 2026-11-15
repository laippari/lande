// Männyn puuaines tilavuustekstuurina.
//
// Väri lasketaan jokaiselle pikselille sen todellisesta paikasta rungon sisällä: etäisyys
// ytimestä kertoo vuosirenkaan, ja rengas kertoo, ollaanko vaaleassa kevätpuussa vai tummassa
// kesäpuussa. Siksi piiluiskun kouru, joka painuu pari milliä syvemmälle puuhun, leikkaa
// renkaita oikeasta kohdasta ja piirtää pintaan saarekkeita ja liekkikuvioita itsestään.
//
// Veistetyn kyljen pinta lasketaan iskuista (hewing.js) pikselin tarkkuudella, joten harjat
// pysyvät terävinä läheltäkin.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, int, vec2, vec3, ivec2, attribute, property, positionLocal, normalLocal,
  textureLoad, mix, smoothstep, clamp, max, abs, sign, floor, fract, sin, cos, atan, length, dot,
  normalize, cross, pow, exp, fwidth, select, step, vec4, mx_noise_float, transformNormalToView,
} from 'three/tsl';

import { HW } from './shape.js';
import { BIN, N_BINS } from './hewing.js';
import { KNOT_BIN, KNOT_TEX_W } from './knots.js';

// Pinnan laji kertoo, millä työkalulla pinta on tehty.
export const SURF = { HEWN: 0, TOP: 1, GROOVE: 2, END: 3, NOTCH: 4, SAWN: 5 };

const srgb = (hex) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};

// Tuoreen männyn värit: pintapuu on kermanvaaleaa, sydänpuu hieman punertavampaa.
export const COL = {
  sapEarly: srgb('#f2e0b6'),
  sapLate: srgb('#d2a25f'),
  heartEarly: srgb('#ebc998'),
  heartLate: srgb('#c4874c'),
  knot: srgb('#a9703f'),
  knotDark: srgb('#553319'),
  pith: srgb('#6a4628'),
};

function dataTexture({ data, width, height }) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const emptyStrokes = () => ({ data: new Float32Array(4 * 7 * 4).fill(-1), width: 4, height: 7, binRows: 1, endSoft: 1 });
const emptyKnots = () => ({ data: new Float32Array(KNOT_TEX_W * 4).fill(-1), width: KNOT_TEX_W, height: 1 });

// --- apufunktiot ---------------------------------------------------------------

export const hash11 = Fn(([p]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.mulAssign(q.add(33.33));
  q.mulAssign(q.add(q));
  return fract(q);
});

// Pehmeä yksiulotteinen kohina: x = arvo välillä −1…1, y = derivaatta.
export const noise1 = Fn(([t]) => {
  const i = floor(t);
  const f = t.sub(i);
  const a = hash11(i);
  const b = hash11(i.add(1));
  const s = f.mul(f).mul(f.mul(-2).add(3));
  const ds = f.mul(f.oneMinus()).mul(6);
  return vec2(mix(a, b, s).mul(2).sub(1), b.sub(a).mul(ds).mul(2));
});

const sumSin = (terms, x) => {
  let s = float(0);
  for (const [a, k, p] of terms) s = s.add(sin(x.mul(k).add(p)).mul(a));
  return s;
};

// --- materiaali ------------------------------------------------------------------

// shape: rungon muoto (ks. shape.js: logShape). strokeData ja knotData ovat valinnaisia.
// tint: värin kerroin, gray: harmaantuminen (0…1) vanhalle, säässä olleelle puulle.
export function createWoodMaterial({ shape, strokeData = emptyStrokes(), knotData = emptyKnots(), tint = [1, 1, 1], gray = 0 }) {
  const strokeTex = dataTexture(strokeData);
  const knotTex = dataTexture(knotData);
  const { binRows, endSoft } = strokeData;
  const { length: LEN, rButt, rTop, flare, rings, ringExp, heart: heartShare } = shape;

  const radius0 = (x) => {
    let r = float(rTop).add(x.div(LEN).oneMinus().mul(rButt - flare - rTop));
    if (flare > 0) r = r.add(exp(x.div(-0.6)).mul(flare));
    return r;
  };
  const ovality = (x, theta) => {
    let s = float(0);
    for (const [a, m, k, p] of shape.oval) s = s.add(sin(theta.mul(m).add(x.mul(k)).add(p)).mul(a));
    return s;
  };

  const outRoughness = property('float', 'woodRoughness');
  const outNormal = property('vec3', 'woodNormal');

  // Oksat: x = renkaiden kiertymä (m), y = ollaanko oksan sisällä, z = etäisyys oksan
  // akselista suhteessa sen säteeseen (kokonaisosaan on pakattu oksan tummuus).
  const knotField = Fn(([p]) => {
    const out = vec3(0).toVar();
    const dark = float(0).toVar();
    const angle = float(0).toVar();
    const bin = clamp(floor(p.x.div(KNOT_BIN)), 0, KNOT_TEX_W - 1).toInt();
    const info = textureLoad(knotTex, ivec2(bin, int(0)));
    If(info.x.greaterThan(0.5), () => {
      const row = info.x.toInt();
      Loop({ start: int(0), end: info.y.toInt(), type: 'int', condition: '<' }, ({ i }) => {
        const A = textureLoad(knotTex, ivec2(i.mul(3), row));
        const Bv = textureLoad(knotTex, ivec2(i.mul(3).add(1), row));
        const C = textureLoad(knotTex, ivec2(i.mul(3).add(2), row));
        const dir = vec3(Bv.x, Bv.y.mul(sin(A.w)), Bv.y.mul(cos(A.w)));
        const v = p.sub(A.xyz);
        const s = dot(v, dir);
        const perp = v.sub(dir.mul(s));
        const dist = length(perp);
        // kulma oksan akselin ympäri: reuna ei ole täysi ympyrä, ja halkeamat lähtevät keskeltä
        const e1 = normalize(vec3(dir.y.negate(), dir.x, 0));
        const ang = atan(dot(perp, cross(dir, e1)), dot(perp, e1));
        const wobble = sin(ang.mul(2).add(C.z)).mul(0.05).add(sin(ang.mul(5).add(C.z.mul(2.3))).mul(0.02)).add(1);
        const rk = Bv.w.add(Bv.z.mul(max(s, 0))).mul(wobble);
        const sEnd = C.x;
        const alive = smoothstep(0.0, 0.012, s).mul(smoothstep(sEnd.sub(0.006), sEnd.add(0.006), s).oneMinus());
        const inside = smoothstep(rk.sub(0.0008), rk.add(0.0008), dist).oneMinus().mul(alive);
        // Rungon renkaat nousevat oksaa pitkin; umpeen kasvaneen oksan jälkeen ne oikenevat.
        const env = smoothstep(-0.005, 0.02, s).mul(smoothstep(sEnd, sEnd.add(0.06), s).mul(0.85).oneMinus());
        const reach = rk.mul(2.2).add(0.004);
        const bulge = rk.mul(1.2).add(0.003).mul(exp(dist.div(reach).pow(2).negate())).mul(env);
        out.x.addAssign(bulge);
        If(inside.greaterThan(out.y), () => {
          out.y.assign(inside);
          out.z.assign(dist.div(rk));
          dark.assign(C.y);
          angle.assign(ang);
        });
      });
    });
    return vec4(out.x, out.y, out.z.add(dark.mul(8).floor().mul(4)), angle);
  });

  const surface = Fn(() => {
    const P = positionLocal;
    const surf = attribute('surf', 'float');
    const nGeo = normalize(normalLocal);
    const is = (id) => surf.greaterThan(id - 0.5).and(surf.lessThan(id + 0.5));
    const isHewn = is(SURF.HEWN);

    // --- veistetty kylki: iskujen syvin kohta ---
    const pos = vec3(P).toVar();
    const grad = vec2(0).toVar(); // pinnan kaltevuus (dh/dx, dh/dy)
    const stria = vec3(1, 0, 0).toVar(); // naarmujen suunta ja iskun siemen
    const side = sign(nGeo.z).toVar();

    If(isHewn, () => {
      const rowBase = select(side.greaterThan(0), int(0), int(3));
      const binRow0 = select(side.greaterThan(0), int(6), int(6 + binRows));
      const bin = clamp(floor(P.x.div(BIN)), 0, N_BINS - 1).toInt();
      const best = float(0).toVar();
      Loop(binRows, ({ i }) => {
        const id = textureLoad(strokeTex, ivec2(bin, binRow0.add(i))).x;
        If(id.greaterThan(-0.5), () => {
          const k = id.toInt();
          const A = textureLoad(strokeTex, ivec2(k, rowBase));
          const Bv = textureLoad(strokeTex, ivec2(k, rowBase.add(1)));
          const C = textureLoad(strokeTex, ivec2(k, rowBase.add(2)));
          const d = P.xy.sub(A.xy);
          const e = A.zw;
          const b = dot(d, e);
          const a = d.x.mul(e.y).sub(d.y.mul(e.x)).sub(Bv.w.mul(b).mul(b));
          const over = max(abs(b).sub(C.x), 0);
          const h = Bv.x.sub(a.mul(a).mul(Bv.y)).sub(b.mul(b).mul(Bv.z)).sub(over.mul(over).mul(endSoft));
          If(h.greaterThan(best), () => {
            best.assign(h);
            const ga = vec2(e.y, e.x.negate()).sub(e.mul(Bv.w.mul(b).mul(2)));
            const gb = b.mul(Bv.z).mul(-2).sub(over.mul(2 * endSoft).mul(sign(b)));
            grad.assign(ga.mul(a.mul(Bv.y).mul(-2)).add(e.mul(gb)));
            stria.assign(C.yzw);
          });
        });
      });
      pos.z.assign(side.mul(float(HW).sub(best)));
    });

    // --- puun rakenne paikassa pos ---
    const px = pos.x;
    const q = vec2(pos.y.sub(sumSin(shape.pithY, px)), pos.z.sub(sumSin(shape.pithZ, px))).toVar();
    const r = length(q).toVar();
    const theta = atan(q.x, q.y);
    const R0 = radius0(px).toVar();
    const ov = ovality(px, theta).toVar();
    const rho = clamp(r.div(R0.mul(ov.add(1))), 0, 1.2).toVar();

    const knot = knotField(pos).toVar();
    const knotIn = knot.y;
    const knotDark = floor(knot.z.div(4)).div(8);
    const knotRad = knot.z.sub(floor(knot.z.div(4)).mul(4));

    // Renkaat eivät ole täydellisiä lieriöitä: pitkä aaltoilu, rungon suuntainen lainehdinta
    // ja hieno värinä. Juuri nämä tekevät kylkeen epäsäännölliset saarekkeet.
    // Kuoren alla renkaat seuraavat rungon pintaa, joten aaltoilu häipyy pintaa kohti.
    const inner = smoothstep(0.72, 1.0, rho).oneMinus();
    const warp = mx_noise_float(vec3(px.mul(1.3), q.mul(9)))
      .mul(0.003)
      .add(mx_noise_float(vec3(px.mul(4.7), q.mul(6))).mul(0.0024))
      .add(mx_noise_float(vec3(px.mul(11), q.mul(17))).mul(0.0008))
      .mul(inner)
      .add(mx_noise_float(vec3(px.mul(3), q.mul(38))).mul(0.0007))
      .add(mx_noise_float(vec3(px.mul(7), q.mul(115))).mul(0.00022));
    // Renkaat kulkevat rungon pinnan suuntaisesti, joten kapeneva runko leikkaa niitä
    // veistetyllä kyljellä ja piirtää liekkikuvion.
    const rRef = r
      .add(warp)
      .sub(knot.x)
      .add(float(rButt).sub(R0))
      .sub(R0.mul(ov).mul(pow(rho, 1.5)))
      .toVar();
    const u0 = pow(clamp(rRef.div(rButt), 0, 1.3), ringExp).mul(rings);
    // Hyvät ja huonot kasvuvuodet: renkaiden leveys vaihtelee. Kertoimet on valittu niin, että
    // u kasvaa aina ulospäin (kohinan derivaatta on enintään 3: 1,0·0,16·3 + 0,12·0,7·3 < 1).
    const u = u0
      .add(noise1(u0.mul(0.16).add(3.7)).x.mul(1.0))
      .add(noise1(u0.mul(0.7).add(11.3)).x.mul(0.12))
      .toVar();
    const fw = clamp(fwidth(u), 0, 4).toVar();
    const ringId = floor(u);
    const phase = u.sub(ringId);
    const h1 = hash11(ringId.add(0.5));
    const h2 = hash11(ringId.add(41.5));
    // Kesäpuun osuus renkaasta; kapeissa ulkorenkaissa se on suurempi.
    const late = h1.mul(0.12).add(0.15).add(smoothstep(0.55, 1, rho).mul(0.06));
    const edge = late.oneMinus();
    const aa = clamp(fw, 0, 0.5);
    const band = smoothstep(edge.sub(0.14).sub(aa), edge.add(aa.mul(0.5)), phase);
    const sharp = band
      .mul(0.86)
      .add(phase.mul(0.14))
      .mul(smoothstep(max(aa.mul(1.5), 0.03).oneMinus(), 1, phase).oneMinus());
    // Kun renkaat ovat pikseliä kapeampia, käytetään keskiarvoa, ettei kuvio väreile.
    const density = mix(sharp, late.mul(0.86).add(0.12), smoothstep(0.4, 1.1, fw)).toVar();

    const heartEdge = float(rButt * heartShare).add(mx_noise_float(vec3(px.mul(1.5), q.mul(7))).mul(0.012));
    const heart = smoothstep(heartEdge.sub(0.009), heartEdge.add(0.009), rRef).oneMinus().toVar();

    // --- väri ---
    const early = mix(COL.sapEarly, COL.heartEarly, heart);
    const lateCol = mix(COL.sapLate, COL.heartLate, heart).mul(h2.mul(0.24).add(0.88));
    const col = mix(early, lateCol, density).toVar();

    // Syyt: hienoja pitkittäisiä juovia, jotka häivytetään kaukaa katsottaessa.
    const foot = length(fwidth(q)).add(fwidth(px).mul(0.03)).toVar();
    const fiberFade = smoothstep(0.0004, 0.0016, foot).oneMinus();
    const fineFade = smoothstep(0.00012, 0.0005, foot).oneMinus();
    const fiber = mx_noise_float(vec3(px.mul(14), q.mul(520))).mul(fiberFade);
    const fine = mx_noise_float(vec3(px.mul(30), q.mul(1900))).mul(fineFade);
    const fiber2 = mx_noise_float(vec3(px.mul(3.1), q.mul(140)));
    const blotch = mx_noise_float(vec3(px.mul(0.8), q.mul(11)));
    col.mulAssign(fiber.mul(0.045).add(fine.mul(0.06)).add(fiber2.mul(0.03)).add(blotch.mul(0.045)).add(1));

    // Oksat: punaruskea ydin, omat renkaat ja tumma reuna; ympärillä punertava kehä.
    const knotRings = sin(knotRad.mul(knotRad).mul(30).add(knotDark.mul(9))).mul(0.5).add(0.5);
    // kuivuessaan oksa halkeaa säteittäin
    const ka = knot.w.add(knotDark.mul(17.3));
    const spoke = (a, len, width) => {
      const d = abs(sin(ka.add(a).add(knotRad.mul(0.6)).mul(0.5))).mul(knotRad); // etäisyys halkeamasta
      return smoothstep(0.0, width, d).oneMinus().mul(smoothstep(len - 0.3, len, knotRad).oneMinus());
    };
    const checks = max(spoke(0, 0.9, 0.035), spoke(2.5, 0.55, 0.025).mul(step(0.55, knotDark)));
    const knotShade = knotRings
      .mul(0.16)
      .add(smoothstep(0.7, 1, knotRad).mul(knotDark).mul(0.9))
      .add(smoothstep(0, 0.2, knotRad).oneMinus().mul(0.35))
      .add(checks.mul(0.65))
      .add(fiber2.mul(0.1));
    const knotCol = mix(COL.knot, COL.knotDark, clamp(knotShade, 0, 1));
    col.assign(mix(col, col.mul(vec3(0.95, 0.85, 0.74)), clamp(knot.x.mul(28), 0, 0.4)));
    col.assign(mix(col, knotCol, knotIn));
    col.assign(mix(col, COL.pith, smoothstep(0.0012, 0.0032, r).oneMinus()));

    // --- pinnan viimeistely työkalun mukaan ---
    // sahanjäljet poikkileikkauspinnoissa
    const sawDir = vec2(0.94, 0.34);
    const tc = dot(pos.yz, sawDir);
    const sawN = noise1(tc.mul(650).add(px.mul(7)));
    const sawFade = smoothstep(0.0004, 0.0014, fwidth(tc)).oneMinus();
    // Päätypuu imee valoa: hieman tummempi ja kylläisempi kuin syiden suuntainen pinta.
    const endGrain = smoothstep(0.5, 0.95, abs(nGeo.x));
    const endTone = pow(col, vec3(1.1)).mul(density.mul(-0.3).add(0.93)).mul(sawN.x.mul(sawFade).mul(0.05).add(1));
    const endCol = mix(endTone, vec3(dot(endTone, vec3(0.3, 0.6, 0.1))), 0.14);
    col.assign(mix(col, endCol, endGrain));

    const rough = float(0.5).toVar();
    const nrm = vec3(nGeo).toVar();

    // Veistetty kylki: kirves jättää kiiltävän pinnan ja iskun suuntaisia naarmuja.
    const sp = vec2(stria.y.negate(), stria.x); // kohtisuoraan iskun suuntaa vastaan
    const sc = dot(P.xy, sp);
    const sFoot = length(fwidth(P.xy));
    const n1 = noise1(sc.mul(900).add(stria.z.mul(13.7)));
    const n2 = noise1(sc.mul(2300).add(stria.z.mul(5.1)));
    const n3 = noise1(sc.mul(105).add(stria.z.mul(3.3)));
    const sFade = smoothstep(0.0003, 0.0011, sFoot).oneMinus();
    const cFade = smoothstep(0.003, 0.009, sFoot).oneMinus();
    const patchy = smoothstep(-0.2, 0.5, mx_noise_float(vec3(P.xy.mul(9), stria.z)));
    const sSlope = n1.y.mul(900 * 0.00002).add(n2.y.mul(2300 * 0.000007)).mul(sFade).mul(patchy.mul(0.7).add(0.3)).add(n3.y.mul(105 * 0.00012).mul(cFade).mul(patchy));
    const hewnNormal = normalize(vec3(grad.x.add(sp.x.mul(sSlope)), grad.y.add(sp.y.mul(sSlope)), side));
    const hewnRough = float(0.4).sub(density.mul(0.08)).add(n1.x.mul(0.04)).add(sFade.oneMinus().mul(0.07));

    // Sahattu pinta: hienot sahanjäljet. Päädyssä ne kulkevat poikkileikkauksen yli,
    // sahatavaran kyljessä syiden poikki.
    const sawSlope = sawN.y.mul(650 * 0.0001).mul(sawFade);
    const endNormal = normalize(vec3(nGeo.x, sawDir.x.mul(sawSlope).negate(), sawDir.y.mul(sawSlope).negate()));
    const ripN = noise1(px.mul(520).add(pos.y.mul(40)));
    const ripFade = smoothstep(0.0005, 0.0018, fwidth(px)).oneMinus();
    const sawnNormal = normalize(nGeo.sub(vec3(ripN.y.mul(520 * 0.00009).mul(ripFade), 0, 0)));

    If(isHewn, () => {
      nrm.assign(hewnNormal);
      rough.assign(hewnRough);
    })
      .ElseIf(is(SURF.END), () => {
        nrm.assign(endNormal);
        rough.assign(float(0.84).sub(density.mul(0.06)));
      })
      .ElseIf(is(SURF.TOP), () => {
        rough.assign(float(0.52).sub(density.mul(0.08)));
      })
      .ElseIf(is(SURF.GROOVE), () => {
        rough.assign(0.66);
      })
      .ElseIf(is(SURF.NOTCH), () => {
        rough.assign(float(0.6).sub(density.mul(0.05)));
      })
      .ElseIf(is(SURF.SAWN), () => {
        nrm.assign(sawnNormal);
        rough.assign(0.82);
      });

    // Oksa on kovaa ja pihkaista: sileämpi kuin ympäröivä puu.
    rough.assign(mix(rough, 0.34, knotIn.mul(endGrain.oneMinus()).mul(0.8)));

    // Säässä ollut puu harmaantuu.
    if (gray > 0) {
      const lum = dot(col, vec3(0.3, 0.6, 0.1));
      col.assign(mix(col, vec3(lum).mul(vec3(1.0, 0.99, 0.97)), gray));
    }
    col.mulAssign(vec3(...tint));

    outRoughness.assign(clamp(rough, 0.08, 1));
    outNormal.assign(nrm);
    return col;
  });

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = surface();
  material.roughnessNode = outRoughness;
  material.metalnessNode = float(0);
  material.normalNode = transformNormalToView(outNormal);
  material.userData.textures = [strokeTex, knotTex];
  return material;
}
