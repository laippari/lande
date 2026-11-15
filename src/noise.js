// Kohina: sama satunnaishila sekä varjostimelle (3D-tekstuuri) että JavaScriptille.

import * as THREE from 'three/webgpu';
import { floor, texture3D } from 'three/tsl';
import { mulberry32 } from './log/hewing.js';

const N = 32;
let tex = null;

function noiseTexture() {
  if (tex) return tex;
  const rnd = mulberry32(20261115);
  const data = new Uint8Array(N * N * N * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Pehmeä arvokohina varjostimessa: tekstuurin tekselit ovat hilapisteitä, ja koordinaatin murto-osa
// pehmennetään ennen hakua, jolloin lineaarinen suodatus antaa sileän kohinan. Neljä riippumatonta
// kohinaa yhdellä haulla, arvot −1…1.
export const noise3 = (p) => {
  const i = floor(p);
  const f = p.sub(i);
  return texture3D(noiseTexture(), i.add(f.mul(f).mul(f.mul(-2).add(3))).add(0.5).div(N)).mul(2).sub(1);
};

// --- JavaScript-puoli: 2D-arvokohina maaston muotoon ja kasvien sijoitteluun ---

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// arvo 0…1
export function vnoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// useamman taajuuden summa, arvo noin 0…1
export function fbm(x, y, octaves = 3, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, y, seed + o * 17) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}
