// Perustus, lattia ja ikkunat.
//
// Mökki seisoo valetun betonisokkelin päällä: yhtenäinen kehä seinien alla, näkyvissä noin 35 cm.
// Sokkelin sisällä on tuulettuva ryömintätila (rossipohja), jota tuuletetaan sokkelin luukuista.
// Lattiapalkit, eriste ja tuulensuojalevy jäävät lattialautojen ja sokkelin taakse piiloon;
// lattian pinta on 33 cm sokkelin yläpinnasta eli ensimmäisen hirsikerran yläreunan tasolla.
// Sokkelin ympärillä on puolen metrin kaista tummaa soraa (maaston varjostimessa), ja maa on
// muotoiltu mökin kohdalta tasaiseksi (ks. tontti/terrain.js).
//
// Terassi seisoo matalilla betoniharkoilla.

import * as THREE from 'three/webgpu';
import { float, vec3, positionLocal, fract, smoothstep, mix, abs } from 'three/tsl';
import { noise3 } from '../noise.js';
import { DIM, WINDOWS } from './plan.js';

const HW = DIM.wall / 2;
export const PLINTH = { height: 0.34, thickness: 0.24, inset: 0.02, depth: 1.0 };
const PINE = [1, 1, 1];

// Lattialaudat pitkien seinien suuntaan.
export function addFloor(timber) {
  const x0 = -DIM.width / 2 + DIM.wall, x1 = DIM.width / 2 - DIM.wall;
  const z0 = -DIM.depth / 2 + DIM.wall, z1 = DIM.depth / 2 - DIM.wall;
  const bw = 0.12, n = Math.round((z1 - z0) / bw);
  const w = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + (i + 0.5) * w;
    timber.addBoard({ a: [x0, DIM.floor - 0.014, z], b: [x1, DIM.floor - 0.014, z], w: w - 0.002, t: 0.028, tint: PINE, ends: false });
  }
}

// Valettu sokkeli: kehä seinien alla, yläpinta y = 0, ja tuuletusluukut kyljissä.
export function plinthGeometry() {
  const parts = [];
  const X = DIM.width / 2 - PLINTH.inset, Z = DIM.depth / 2 - PLINTH.inset, t = PLINTH.thickness, h = PLINTH.depth;
  const box = (w, d, x, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, -h / 2, z);
    parts.push(g);
  };
  box(2 * X, t, 0, Z - t / 2);
  box(2 * X, t, 0, -Z + t / 2);
  box(t, 2 * Z - 2 * t, X - t / 2, 0);
  box(t, 2 * Z - 2 * t, -X + t / 2, 0);
  return mergeBoxes(parts);
}

export function ventGeometry() {
  const parts = [];
  const X = DIM.width / 2 - PLINTH.inset, Z = DIM.depth / 2 - PLINTH.inset;
  const vent = (x, z, alongX) => {
    const g = new THREE.BoxGeometry(alongX ? 0.3 : 0.012, 0.1, alongX ? 0.012 : 0.3);
    g.translate(x, -0.15, z);
    parts.push(g);
  };
  for (const x of [-4, 0, 4]) for (const z of [-Z, Z]) vent(x, z, true);
  for (const z of [-2, 2]) for (const x of [-X, X]) vent(x, z, false);
  return mergeBoxes(parts);
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

// Betoni. Harkoissa saumat 200 mm välein; valetussa sokkelissa näkyvät muottilautojen jäljet.
// Sävy on tumma, jotta perustus ei erotu metsänpohjasta.
export function createConcreteMaterial({ cast = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  if (cast) {
    const board = abs(fract(positionLocal.y.div(0.11)).sub(0.5)).mul(0.11);
    const line = smoothstep(0.0, 0.006, board);
    const n = noise3(positionLocal.mul(vec3(2.3, 9, 2.3)));
    const fine = noise3(positionLocal.mul(47));
    m.colorNode = mix(vec3(0.085, 0.085, 0.082), vec3(0.165, 0.163, 0.155), line).mul(n.x.mul(0.12).add(1)).mul(fine.x.mul(0.1).add(1));
  } else {
    const joint = smoothstep(0.0, 0.012, abs(fract(positionLocal.y.div(BLOCK.course)).sub(0.5)).mul(BLOCK.course));
    m.colorNode = mix(vec3(0.05, 0.05, 0.048), vec3(0.115, 0.113, 0.108), joint);
  }
  m.roughnessNode = float(0.92);
  return m;
}

export const BLOCK = { course: 0.2 };

// Harkkopilarit. list: [{ x, z, top, size }] mökin koordinaatistossa (top = pilarin yläpinta),
// groundAt(x, z): maanpinnan korkeus samassa koordinaatistossa. Antura jää maan alle.
export function pillarGeometry(list, groundAt) {
  const parts = [];
  for (const { x, z, top, size } of list) {
    const h = size / 2;
    const g = Math.min(groundAt(x - h, z - h), groundAt(x + h, z - h), groundAt(x - h, z + h), groundAt(x + h, z + h), groundAt(x, z));
    const bottom = g - 0.3;
    const height = Math.max(top - bottom, 0.05);
    const box = new THREE.BoxGeometry(size, height, size);
    box.translate(x, bottom + height / 2, z);
    parts.push(box);
    // bitumikaista harkon päällä
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
