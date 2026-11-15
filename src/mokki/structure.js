// Rossipohja, pilariperustus ja ikkunat.
//
// Rossipohja on tuulettuva puurakenteinen alapohja: mökki seisoo pilarien päällä, ja lattian alla
// on avoin ryömintätila. Rakenne alhaalta ylös (mitat tyypillisiä, ks. README):
//   - betoniharkkopilarit 300 × 300 mm, harkkokerros 200 mm, anturat maassa
//   - bitumikaista pilarin ja puun välissä
//   - perustuspalkit pilarilinjoilla (seinien alla ja keskellä), yläpinta y = 0
//   - lattiapalkit palkkien päällä 600 mm välein, välissä eriste, alla tuulensuojalevy
//   - lattialaudat 28 mm, pinta y = DIM.floor
// Alin hirsi lepää perustuspalkin päällä, ja lattian pinta on ensimmäisen hirsikerran yläreunan
// tasolla. Lattiapalkit ja eriste jäävät laudoituksen ja tuulensuojalevyn väliin piiloon.

import * as THREE from 'three/webgpu';
import { float, vec3, positionLocal, fract, smoothstep, mix, abs } from 'three/tsl';
import { DIM, WINDOWS } from './plan.js';

const HW = DIM.wall / 2;
export const BEAM = { width: 0.18, depth: 0.315 };
export const PILLAR = { size: 0.3, course: 0.2, footing: 0.6, clearance: 0.5 };
const PINE = [1, 1, 1];
const FIBRE = [0.42, 0.36, 0.29]; // tuulensuojalevy: ruskea puukuitulevy

// Pilarien paikat mökin koordinaatistossa: jokaisen nurkan alla, seinälinjoilla ja keskilinjalla
// noin 2,3 m välein.
export function pillarSpots() {
  const spots = [];
  const xs = [];
  const n = 5;
  for (let i = 0; i <= n; i++) xs.push(-DIM.width / 2 + HW + ((DIM.width - DIM.wall) * i) / n);
  const zLines = [-DIM.depth / 2 + HW, 0, DIM.depth / 2 - HW];
  for (const z of zLines) for (const x of xs) spots.push([x, z]);
  for (const x of [xs[0], xs[n]]) for (const z of [-DIM.depth / 4, DIM.depth / 4]) spots.push([x, z]);
  return spots;
}

// Lattia ja perustuspalkit puuosien verkkoon.
export function addFloor(timber) {
  const x0 = -DIM.width / 2 + DIM.wall, x1 = DIM.width / 2 - DIM.wall;
  const z0 = -DIM.depth / 2 + DIM.wall, z1 = DIM.depth / 2 - DIM.wall;
  // lattialaudat pitkien seinien suuntaan
  const bw = 0.12, n = Math.round((z1 - z0) / bw);
  const w = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * w;
    timber.addBoard({ a: [x0, DIM.floor - 0.014, z], b: [x1, DIM.floor - 0.014, z], w: w - 0.002, t: 0.028, tint: PINE, ends: false });
  }
  // tuulensuojalevy lattiapalkkien alla
  timber.addBoard({ a: [x0, 0.011, 0], b: [x1, 0.011, 0], w: z1 - z0, t: 0.022, tint: FIBRE, ends: false });
  // perustuspalkit: pitkien seinien alla ja keskellä sekä päätyseinien alla
  const by = -BEAM.depth / 2;
  const bx0 = -DIM.width / 2 + 0.01, bx1 = DIM.width / 2 - 0.01;
  for (const z of [-DIM.depth / 2 + HW, 0, DIM.depth / 2 - HW]) {
    timber.addBoard({ a: [bx0, by, z], b: [bx1, by, z], w: BEAM.width, t: BEAM.depth });
  }
  for (const x of [-DIM.width / 2 + HW, DIM.width / 2 - HW]) {
    timber.addBoard({ a: [x, by, -DIM.depth / 2 + HW + BEAM.width / 2], b: [x, by, DIM.depth / 2 - HW - BEAM.width / 2], w: BEAM.width, t: BEAM.depth });
  }
}

// Ikkunat: mäntykarmi aukon ympärillä, välikarmi parin keskellä, lasi ja ulkopuolen vuorilaudat.
// Palauttaa lasiruutujen nelikulmiot.
export function addWindows(timber, plan) {
  const zc = DIM.depth / 2 - HW;
  const f = 0.06, depth = 0.16;
  const glass = [];
  for (const o of plan.openings.front) {
    const { x0, x1, y0, y1 } = o;
    const xm = (x0 + x1) / 2;
    const jamb = (x, w) => timber.addBoard({ a: [x, y0, zc], b: [x, y1, zc], w, t: depth, up: [0, 0, 1] });
    jamb(x0 + f / 2, f);
    jamb(x1 - f / 2, f);
    jamb(xm, WINDOWS.mullion);
    for (const y of [y0 + f / 2, y1 - f / 2]) timber.addBoard({ a: [x0 + f, y, zc], b: [x1 - f, y, zc], w: depth, t: f });
    // vuorilaudat ulkopinnassa peittävät karmin ja hirsien päiden välisen raon
    const zf = DIM.depth / 2 + 0.011, cw = 0.095;
    for (const x of [x0 - cw / 2 + 0.02, x1 + cw / 2 - 0.02]) timber.addBoard({ a: [x, y0, zf], b: [x, y1 + cw - 0.02, zf], w: cw, t: 0.022, up: [0, 0, 1] });
    timber.addBoard({ a: [x0 - cw + 0.02, y1 + cw / 2 - 0.02, zf], b: [x1 + cw - 0.02, y1 + cw / 2 - 0.02, zf], w: 0.022, t: cw });
    for (const [a, b] of [[x0 + f, xm - WINDOWS.mullion / 2], [xm + WINDOWS.mullion / 2, x1 - f]]) {
      glass.push([[a, y0 + f, zc], [b, y0 + f, zc], [b, y1 - f, zc], [a, y1 - f, zc]]);
    }
  }
  return glass;
}

export function glassGeometry(quads) {
  const pos = [], nor = [];
  for (const q of quads) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...q[i]);
      nor.push(0, 0, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// Lasi: ohut heijastava pinta. Ikkunasta näkyy sisään, ja taivas ja metsä heijastuvat siitä.
export function createGlassMaterial() {
  return new THREE.MeshStandardNodeMaterial({
    color: 0x9fb0b8, roughness: 0.03, metalness: 1, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
  });
}

// Betoni: harkkopilarin saumat 200 mm välein.
export function createConcreteMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const joint = smoothstep(0.0, 0.012, abs(fract(positionLocal.y.div(PILLAR.course)).sub(0.5)).mul(PILLAR.course));
  m.colorNode = mix(vec3(0.13, 0.13, 0.125), vec3(0.3, 0.295, 0.285), joint);
  m.roughnessNode = float(0.92);
  return m;
}

// Pilarit ja anturat. list: [{ x, z, top, size }] mökin koordinaatistossa (top = pilarin yläpinta),
// groundAt(x, z): maanpinnan korkeus samassa koordinaatistossa. Rinteessä alarinteen pilarit
// ovat pidempiä.
export function pillarGeometry(list, groundAt) {
  const parts = [];
  for (const { x, z, top, size } of list) {
    const h = size / 2;
    const g = Math.min(groundAt(x - h, z - h), groundAt(x + h, z - h), groundAt(x - h, z + h), groundAt(x + h, z + h), groundAt(x, z));
    const bottom = g - 0.25;
    const height = Math.max(top - bottom, 0.05);
    const box = new THREE.BoxGeometry(size, height, size);
    box.translate(x, bottom + height / 2, z);
    parts.push(box);
    // antura näkyy rinteessä alarinteen puolelta
    const pad = new THREE.BoxGeometry(size * 2, 0.2, size * 2);
    pad.translate(x, g - 0.07, z);
    parts.push(pad);
    // bitumikaista pilarin päällä
    const strip = new THREE.BoxGeometry(size + 0.004, 0.006, size + 0.004);
    strip.translate(x, top + 0.003, z);
    parts.push(strip);
  }
  return mergeBoxes(parts);
}

function mergeBoxes(parts) {
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of parts) {
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
