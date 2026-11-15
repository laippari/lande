// Mökin hirsien puumateriaali: mallihirren (src/log/wood.js) kevyt versio.
//
// Sama ajatus kuin mallihirressä: väri lasketaan pikselin paikasta rungon sisällä, ja piiluiskun
// kouru siirtää tätä paikkaa pari milliä syvemmälle, joten aallot leikkaavat vuosirenkaita.
// Kevennykset:
//   - iskut ja oksat arvotaan varjostimessa hirren siemenestä (ei hirsikohtaisia tekstuureja,
//     joten kaikki hirret jakavat yhden materiaalin ja yhden piirtokutsun)
//   - kohina luetaan yhdestä pienestä 3D-tekstuurista (neljä kohinaa yhdellä haulla)
//   - veistetty pinta on verkossa tasainen; aallot ovat varjostuksessa ja puun kuviossa
//   - kaukaa katsottaessa hienoin rakenne jätetään laskematta
//
// Hirsikohtainen vaihtelu tulee kärkien mukana: wood = (siemen, säde tyvellä, säde latvassa,
// pituus). Siemen muuttaa iskut, oksat, renkaiden leveydet, sydänpuun osuuden ja sävyn.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, float, vec2, vec3, vec4, attribute, property, normalLocal, texture3D, mix, smoothstep, clamp, max, abs,
  sign, floor, fract, sin, cos, length, dot, normalize, pow, exp, fwidth, select, transformNormalToView,
} from 'three/tsl';
import { COL, SURF, hash11, noise1 } from '../log/wood.js';
import { mulberry32 } from '../log/hewing.js';
import { DIM } from './plan.js';

const N = 32; // kohinatekstuurin sivu
const PITCH = 0.092; // piiluiskujen keskimääräinen väli (m)
const WHORL = 0.48; // oksakiehkuroiden väli (m)

function noiseTexture() {
  const rnd = mulberry32(20261115);
  const data = new Uint8Array(N * N * N * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// neljä satunnaislukua yhdestä luvusta
const hash41 = Fn(([n]) => {
  const p = fract(vec4(n).mul(vec4(0.1031, 0.103, 0.0973, 0.1099))).toVar();
  p.addAssign(dot(p, p.wzxy.add(33.33)));
  return fract(p.xxyz.add(p.yzzw).mul(p.zywx));
});

export function createCabinWoodMaterial() {
  const tex = noiseTexture();
  // Pehmeä arvokohina: tekstuurin tekselit ovat hilapisteitä, ja koordinaatin murto-osa
  // pehmennetään ennen hakua, jolloin lineaarinen suodatus antaa sileän kohinan. Arvot −1…1.
  const noise3 = (p) => {
    const i = floor(p);
    const f = p.sub(i);
    return texture3D(tex, i.add(f.mul(f).mul(f.mul(-2).add(3))).add(0.5).div(N)).mul(2).sub(1);
  };

  const outRoughness = property('float', 'woodRoughness');
  const outNormal = property('vec3', 'woodNormal');

  const surface = Fn(() => {
    const P = attribute('lp', 'vec3');
    const W = attribute('wood', 'vec4');
    const yaw = attribute('yaw', 'vec2');
    const surf = attribute('surf', 'float');
    // Siemen pyöristetään: kärjestä pikseliin interpoloitu luku heittää hieman, ja satunnaisfunktio
    // tekisi heitosta kohinaa.
    const seed = floor(W.x.mul(16).add(0.5)).div(16).toVar();
    const rButt = W.y, rTop = W.z, len = W.w;

    // hirren oma kanta maailmassa ja pinnan normaali siinä
    const X = vec3(yaw.x, 0, yaw.y);
    const Z = vec3(yaw.y.negate(), 0, yaw.x);
    const nW = normalize(normalLocal);
    const nl = vec3(dot(nW, X), nW.y, dot(nW, Z)).toVar();
    const is = (id) => surf.greaterThan(id - 0.5).and(surf.lessThan(id + 0.5));
    const isHewn = is(SURF.HEWN);
    const side = sign(nl.z).toVar();

    // pikselin koko hirren pinnalla: kaukaa hienoin rakenne jätetään pois
    const foot = max(fwidth(P.x), length(fwidth(P.yz))).toVar();
    const near = foot.lessThan(0.006);

    // --- piilutus: kolmen lähimmän iskun syvin kohta ---
    const pos = vec3(P).toVar();
    const grad = vec2(0).toVar();
    const strokeSeed = float(0).toVar();
    If(isHewn, () => {
      const c = P.x.div(PITCH).add(seed.mul(7.3));
      const c0 = floor(c);
      const y = P.y;
      // veistäjän ote vaihtelee hirren matkalla
      const bite = clamp(sin(P.x.mul(1.35).add(seed.mul(3.1))).mul(0.36).add(sin(P.x.mul(3.1).add(seed)).mul(0.2)).add(0.74), 0.42, 1.3);
      const best = float(0).toVar();
      Loop(3, ({ i }) => {
        const j = c0.add(float(i)).sub(1);
        const r = hash41(j.add(seed.mul(61.7)));
        const D = mix(0.0019, 0.0031, r.y).mul(bite);
        const tilt = r.z.sub(0.5).mul(0.3).sub(side.mul(0.13));
        const bow = mix(0.8, 1.6, r.w).mul(side);
        const ph = y.mul(21).add(r.x.mul(6.28));
        // etäisyys iskun keskilinjasta; terä on kallellaan ja kupera, ja harja elää hieman
        const a = c.sub(j.add(0.5).add(r.x.sub(0.5).mul(0.5))).mul(PITCH).sub(tilt.mul(y)).sub(bow.mul(y).mul(y)).sub(sin(ph).mul(0.009));
        const iRa = D.div((0.6 * PITCH) ** 2);
        const h = D.sub(a.mul(a).mul(iRa)).sub(y.mul(y).mul(0.04));
        If(h.greaterThan(best), () => {
          best.assign(h);
          const dady = tilt.negate().sub(bow.mul(y).mul(2)).sub(cos(ph).mul(0.189));
          grad.assign(vec2(a.mul(iRa).mul(-2), a.mul(iRa).mul(-2).mul(dady).sub(y.mul(0.08))));
          strokeSeed.assign(r.x);
        });
      });
      pos.z.assign(P.z.sub(side.mul(best)));
    });

    // --- puun rakenne ---
    const x = pos.x;
    const wander = vec2(
      sin(x.mul(0.9).add(seed.mul(2.3))).mul(0.012).add(sin(x.mul(2.3).add(seed)).mul(0.004)),
      sin(x.mul(0.62).add(seed.mul(1.7))).mul(0.006),
    );
    const q = pos.yz.sub(wander).toVar();
    const r = length(q).toVar();
    const R0 = mix(rButt, rTop, clamp(x.div(len), 0, 1)).toVar();
    const rho = clamp(r.div(R0), 0, 1.2).toVar();
    const so = vec3(seed.mul(3.7), seed.mul(1.3), seed.mul(2.9));
    const n1 = noise3(vec3(x.mul(1.3), q.mul(9)).add(so)).toVar(); // x: pitkä aaltoilu, y: sydänpuun raja, z: läikät
    const n2 = noise3(vec3(x.mul(4.7), q.mul(6.5)).add(so.yzx)).toVar(); // x: rungon suuntainen lainehdinta
    const n3 = noise3(vec3(x.mul(3), q.mul(38)).add(so.zxy)).toVar(); // x: renkaiden värinä, y: leveät syyjuovat

    // hirren oma luonne
    const who = hash41(seed.mul(13.7).add(0.5)).toVar();
    const heartShare = who.x.mul(0.1).add(0.5);
    const rings = rButt.mul((96 / 0.189)).mul(who.y.mul(0.4).add(0.8));

    // oksat: kiehkura joka jaksossa, kolme oksaa, jotka nousevat latvaa kohti
    const bulge = float(0).toVar();
    const knotIn = float(0).toVar();
    const knotRad = float(0).toVar();
    If(near, () => {
      const kc = x.div(WHORL).add(seed.mul(3.1));
      const cell = floor(kc);
      const hw = hash41(cell.add(seed.mul(29.3)));
      const xk = kc.sub(cell).sub(hw.x.mul(0.2).add(0.18)).mul(WHORL); // matka kiehkurasta
      Loop(3, ({ i }) => {
        const hj = hash41(cell.mul(3).add(float(i)).add(seed.mul(17.3)).add(0.5));
        const alpha = float(i).add(hj.x.mul(0.7)).mul(2.094).add(hw.y.mul(6.28));
        const sinB = hj.y.mul(0.26).add(0.3);
        const cosB = float(1).sub(sinB.mul(sinB)).sqrt();
        const dir = vec3(sinB, cosB.mul(sin(alpha)), cosB.mul(cos(alpha)));
        const v = vec3(xk, q);
        const s = dot(v, dir);
        const dist = length(v.sub(dir.mul(s)));
        const rk = hj.z.mul(0.05).add(0.06).mul(max(s, 0)).add(0.0015);
        const sEnd = select(hj.w.lessThan(0.7), float(0.4), fract(hj.w.mul(7)).mul(0.09).add(0.05));
        // joka neljännessä jaksossa ei ole kiehkuraa, ja kolmas oksa puuttuu puolesta kiehkuroista
        const present = hw.z.greaterThan(0.25).and(float(i).lessThan(2).or(hw.w.greaterThan(0.5))).toFloat();
        const alive = smoothstep(0.0, 0.012, s).mul(smoothstep(sEnd.sub(0.006), sEnd.add(0.006), s).oneMinus()).mul(present);
        const inside = smoothstep(rk.sub(0.001), rk.add(0.001), dist).oneMinus().mul(alive);
        const env = smoothstep(-0.005, 0.02, s).mul(smoothstep(sEnd, sEnd.add(0.06), s).mul(0.85).oneMinus()).mul(present);
        bulge.addAssign(rk.mul(1.2).add(0.003).mul(exp(dist.div(rk.mul(2.2).add(0.004)).pow(2).negate())).mul(env));
        If(inside.greaterThan(knotIn), () => {
          knotIn.assign(inside);
          knotRad.assign(dist.div(rk));
        });
      });
    });

    // Renkaat aaltoilevat rungon sisällä, mutta kuoren alla ne seuraavat pintaa. Ne kulkevat
    // rungon pinnan suuntaisesti, joten kapeneva runko piirtää kylkeen liekkikuvion.
    const inner = smoothstep(0.72, 1.0, rho).oneMinus();
    const warp = n1.x.mul(0.006).add(n2.x.mul(0.0048)).mul(inner).add(n3.x.mul(0.001));
    const rRef = r.add(warp).sub(bulge).add(rButt.sub(R0)).toVar();
    const u0 = pow(clamp(rRef.div(rButt), 0, 1.3), 1.25).mul(rings);
    const u = u0
      .add(noise1(u0.mul(0.16).add(3.7).add(seed.mul(5))).x.mul(1.0))
      .add(noise1(u0.mul(0.7).add(11.3).add(seed.mul(9))).x.mul(0.12))
      .toVar();
    const fw = clamp(fwidth(u), 0, 4).toVar();
    const ringId = floor(u);
    const phase = u.sub(ringId);
    const h1 = hash11(ringId.add(0.5).add(seed));
    const h2 = hash11(ringId.add(41.5).add(seed));
    const late = h1.mul(0.12).add(0.15).add(smoothstep(0.55, 1, rho).mul(0.06));
    const edge = late.oneMinus();
    const aa = clamp(fw, 0, 0.5);
    const sharp = smoothstep(edge.sub(0.14).sub(aa), edge.add(aa.mul(0.5)), phase)
      .mul(0.86)
      .add(phase.mul(0.14))
      .mul(smoothstep(max(aa.mul(1.5), 0.03).oneMinus(), 1, phase).oneMinus());
    const density = mix(sharp, late.mul(0.86).add(0.12), smoothstep(0.4, 1.1, fw)).toVar();

    const heartEdge = rButt.mul(heartShare).add(n1.y.mul(0.014));
    // sydänpuun ja pintapuun ero pidetään mökissä maltillisena, ettei seinä raidoitu kaukaa
    const heart = smoothstep(heartEdge.sub(0.012), heartEdge.add(0.012), rRef).oneMinus().mul(0.6);

    // --- väri ---
    const early = mix(COL.sapEarly, COL.heartEarly, heart);
    const lateCol = mix(COL.sapLate, COL.heartLate, heart).mul(h2.mul(0.24).add(0.88));
    const col = mix(early, lateCol, density).toVar();
    const fiber = float(0).toVar();
    If(near, () => {
      fiber.assign(noise3(vec3(x.mul(14), q.mul(520)).add(so)).x.mul(smoothstep(0.0004, 0.0016, foot).oneMinus()));
    });
    col.mulAssign(fiber.mul(0.06).add(n3.y.mul(0.04)).add(n1.z.mul(0.06)).add(1));
    // hirsien väliset sävyerot: toinen vaaleampi, toinen punertavampi
    col.mulAssign(mix(vec3(1.0, 1.0, 1.0), vec3(1.04, 0.98, 0.9), who.z).mul(who.w.mul(0.14).add(0.92)));

    const knotShade = sin(knotRad.mul(knotRad).mul(30)).mul(0.08).add(0.08)
      .add(smoothstep(0.7, 1, knotRad).mul(0.6))
      .add(smoothstep(0, 0.2, knotRad).oneMinus().mul(0.35));
    col.assign(mix(col, col.mul(vec3(0.95, 0.85, 0.74)), clamp(bulge.mul(28), 0, 0.4)));
    col.assign(mix(col, mix(COL.knot, COL.knotDark, clamp(knotShade, 0, 1)), knotIn));
    col.assign(mix(col, COL.pith, smoothstep(0.0012, 0.0032, r).oneMinus()));

    // --- pinnan viimeistely työkalun mukaan ---
    const endGrain = is(SURF.END).toFloat();
    const endTone = pow(col, vec3(1.1)).mul(density.mul(-0.3).add(0.93));
    col.assign(mix(col, mix(endTone, vec3(dot(endTone, vec3(0.3, 0.6, 0.1))), 0.14), endGrain));

    const rough = float(0.58).toVar();
    If(isHewn, () => {
      // kirveen jäljiltä pinta on sileä; terän kolot piirtävät iskun suuntaisia naarmuja
      const sc = P.x.mul(0.45).add(P.y.mul(0.89).mul(side));
      const n = noise1(sc.mul(900).add(strokeSeed.mul(37)));
      const fade = smoothstep(0.0003, 0.0011, foot).oneMinus();
      const slope = n.y.mul(900 * 0.00002).mul(fade);
      nl.assign(normalize(vec3(grad.x.add(slope.mul(0.45)), grad.y.add(slope.mul(0.89).mul(side)), side)));
      rough.assign(float(0.42).sub(density.mul(0.08)).add(fade.oneMinus().mul(0.06)));
    })
      .ElseIf(is(SURF.END), () => {
        rough.assign(float(0.84).sub(density.mul(0.06)));
      })
      .ElseIf(is(SURF.TOP), () => {
        rough.assign(float(0.54).sub(density.mul(0.08)));
      });
    rough.assign(mix(rough, 0.34, knotIn.mul(endGrain.oneMinus()).mul(0.8)));

    outRoughness.assign(clamp(rough, 0.08, 1));
    outNormal.assign(X.mul(nl.x).add(vec3(0, 1, 0).mul(nl.y)).add(Z.mul(nl.z)));
    return col;
  });

  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = surface();
  material.roughnessNode = outRoughness;
  material.metalnessNode = float(0);
  material.normalNode = transformNormalToView(outNormal);
  material.userData.thickness = DIM.wall;
  return material;
}
