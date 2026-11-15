// Katto. Malli ja mitat ovat talo-projektista: tumma konesaumapelti, jonka pystysaumat ovat
// 0,5 m välein ja kulkevat lappeen suuntaan, otsalaudat reunoissa. Pulpettikaton kaltevuus on
// 14 % ja harjakaton 1:2.
//
// Katto on pelkkä kuori rungon päällä: sen voi piilottaa, ja pulpettikaton ylitystä edessä ja
// sivuilla voi säätää rakentamatta runkoa uudelleen.

import * as THREE from 'three/webgpu';
import { vec3, positionWorld, fract, abs, smoothstep, mix, float } from 'three/tsl';
import { DIM } from './plan.js';

const THICK = { mono: 0.16, gable: 0.14 };
const EAVE = 0.5; // räystäs takana ja harjakaton molemmilla lappeilla
const SEAM = { gap: 0.5, width: 0.028, height: 0.032 };

function makeMaterials() {
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x2e3134, roughness: 0.5, metalness: 0.1 });
  const seam = new THREE.MeshStandardNodeMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.1 });
  const trim = new THREE.MeshStandardNodeMaterial({ color: 0x26282b, roughness: 0.7, metalness: 0 });
  // räystään aluslaudoitus: vaaleaa lautaa, raot 12 cm välein
  const soffit = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  const gap = smoothstep(0.0, 0.004, abs(fract(positionWorld.x.div(0.12)).sub(0.5)).mul(0.12));
  soffit.colorNode = mix(vec3(0.2, 0.14, 0.08), vec3(0.58, 0.41, 0.22), gap);
  soffit.roughnessNode = float(0.82);
  return { steel, seam, trim, soffit };
}

// Kerää nelikulmioita yhdeksi verkoksi; ulkopuoli osoittaa suuntaan hint.
class Quads {
  constructor() {
    this.pos = [];
    this.nor = [];
  }

  add(a, b, c, d, hint) {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
    const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    const pts = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    const s = flip ? -1 : 1;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx * s, ny * s, nz * s);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

export function createRoof() {
  const mats = makeMaterials();
  const group = new THREE.Group();
  const meshes = {};
  for (const key of Object.keys(mats)) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), mats[key]);
    m.castShadow = true;
    m.receiveShadow = true;
    meshes[key] = m;
    group.add(m);
  }

  // front ja side: ylitys seinän ulkopinnasta (m). Harjakatossa räystäät ovat kiinteät ja
  // side on päätyräystään ylitys.
  function update(plan, { front, side }) {
    const { X0, X1, Z0, Z1 } = plan.bounds;
    const q = { steel: new Quads(), seam: new Quads(), trim: new Quads(), soffit: new Quads() };
    const mono = plan.roofType === 'mono';
    const th = mono ? THICK.mono : THICK.gable;
    const x0 = X0 - side, x1 = X1 + side;
    const under = (x, z) => [x, plan.roofY(z), z];
    const over = (x, z) => [x, plan.roofY(z) + th, z];

    // yksi lape z-välillä za…zb (zb on ylempi reuna)
    const slope = (za, zb) => {
      const dy = plan.roofY(zb) - plan.roofY(za), dz = zb - za;
      const up = [0, Math.abs(dz), -dy * Math.sign(dz)]; // lappeen normaali
      q.steel.add(over(x0, za), over(x1, za), over(x1, zb), over(x0, zb), up);
      q.soffit.add(under(x0, za), under(x1, za), under(x1, zb), under(x0, zb), [0, -1, 0]);
      // otsalaudat päädyissä
      q.trim.add(under(x0, za), under(x0, zb), over(x0, zb), over(x0, za), [-1, 0, 0]);
      q.trim.add(under(x1, za), under(x1, zb), over(x1, zb), over(x1, za), [1, 0, 0]);
      // pystysaumat lappeen suuntaan
      const l = Math.hypot(...up);
      const n = up.map((v) => v / l);
      const lift = (p, h) => [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
      const count = Math.floor((x1 - x0 - 0.1) / SEAM.gap);
      const off = (x1 - x0 - count * SEAM.gap) / 2;
      for (let k = 0; k <= count; k++) {
        const xc = x0 + off + k * SEAM.gap, w = SEAM.width / 2;
        const aL = over(xc - w, za), aR = over(xc + w, za), bL = over(xc - w, zb), bR = over(xc + w, zb);
        const aLt = lift(aL, SEAM.height), aRt = lift(aR, SEAM.height), bLt = lift(bL, SEAM.height), bRt = lift(bR, SEAM.height);
        q.seam.add(aL, bL, bLt, aLt, [-1, 0, 0]);
        q.seam.add(aR, bR, bRt, aRt, [1, 0, 0]);
        q.seam.add(aLt, aRt, bRt, bLt, up);
        q.seam.add(aL, aR, aRt, aLt, [0, 0, Math.sign(za - zb)]);
      }
    };
    // räystään otsalauta lappeen alareunassa (tai pulpetin yläreunassa)
    const eave = (z, outward) => q.trim.add(under(x0, z), under(x1, z), over(x1, z), over(x0, z), [0, 0, outward]);

    if (mono) {
      const zb = Z0 - EAVE, zf = Z1 + front;
      slope(zb, zf);
      eave(zb, -1);
      eave(zf, 1);
    } else {
      slope(Z0 - EAVE, 0);
      slope(Z1 + EAVE, 0);
      eave(Z0 - EAVE, -1);
      eave(Z1 + EAVE, 1);
      // harjapelti
      const y = plan.roofY(0) + th, w = 0.11;
      const a = [x0, y - 0.02, -w], b = [x1, y - 0.02, -w], c = [x1, y - 0.02, w], d = [x0, y - 0.02, w];
      const at = [x0, y + 0.1, -w], bt = [x1, y + 0.1, -w], ct = [x1, y + 0.1, w], dt = [x0, y + 0.1, w];
      q.trim.add(at, bt, ct, dt, [0, 1, 0]);
      q.trim.add(a, b, bt, at, [0, 0, -1]);
      q.trim.add(d, c, ct, dt, [0, 0, 1]);
      q.trim.add(a, d, dt, at, [-1, 0, 0]);
      q.trim.add(b, c, ct, bt, [1, 0, 0]);
    }

    let triangles = 0;
    for (const key of Object.keys(q)) {
      meshes[key].geometry.dispose();
      meshes[key].geometry = q[key].geometry();
      triangles += q[key].pos.length / 9;
    }
    return triangles;
  }

  return { group, update, eave: EAVE };
}

export const ROOF_LIMITS = { front: [0, 2.5], side: [0, 1.5], wall: DIM.wall };
