// Hirren verkko: runko (veistetyt kyljet, selkä, varaus) ja lohenpyrstötapit molemmissa päissä.

import * as THREE from 'three/webgpu';
import { L, HW, TENON_LEN, GROOVE, topY, bottomY, grooveDepth, tenonPlanes } from './shape.js';
import { SURF } from './wood.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.surf = [];
    this.idx = [];
  }

  // Ruudukko (nu+1) × (nv+1). row(a) palauttaa funktion b → [x, y, z]; a ja b ovat välillä 0…1.
  // hint on suunta, johon pinnan ulkopuoli osoittaa; normal on valmis normaali (muuten lasketaan).
  grid(nu, nv, row, { surf, hint, normal = null }) {
    const base = this.pos.length / 3;
    const w = nv + 1;
    const P = new Float64Array((nu + 1) * w * 3);
    for (let i = 0; i <= nu; i++) {
      const col = row(i / nu);
      for (let j = 0; j <= nv; j++) P.set(col(j / nv), (i * w + j) * 3);
    }
    const at = (i, j) => (Math.min(Math.max(i, 0), nu) * w + Math.min(Math.max(j, 0), nv)) * 3;
    const cross = (i0, i1, j0, j1) => {
      const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
      const vx = P[j1] - P[j0], vy = P[j1 + 1] - P[j0 + 1], vz = P[j1 + 2] - P[j0 + 2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    const mid = cross(at(nu >> 1, nv >> 1), at((nu >> 1) + 1, nv >> 1), at(nu >> 1, nv >> 1), at(nu >> 1, (nv >> 1) + 1));
    const flip = mid[0] * hint[0] + mid[1] * hint[1] + mid[2] * hint[2] < 0;
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const k = at(i, j);
        this.pos.push(P[k], P[k + 1], P[k + 2]);
        if (normal) {
          this.nor.push(normal[0], normal[1], normal[2]);
        } else {
          const n = cross(at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1));
          const len = Math.hypot(n[0], n[1], n[2]) || 1;
          const sgn = flip ? -1 : 1;
          this.nor.push((sgn * n[0]) / len, (sgn * n[1]) / len, (sgn * n[2]) / len);
        }
        this.surf.push(surf);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = base + i * w + j;
        const b = a + w;
        const c = b + 1;
        const d = a + 1;
        if (flip) this.idx.push(a, c, b, a, d, c);
        else this.idx.push(a, b, c, a, c, d);
      }
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 1));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// faces: { 1: HewnFace(+z), -1: HewnFace(−z) }. detail skaalaa verkon tiheyttä.
export function buildLogGeometry(faces, detail = 1) {
  const B = new Builder();
  const T = TENON_LEN;
  const seg = (len, step, min = 2) => Math.max(min, Math.round(len / (step / detail)));

  const sideZ = (x, y, s) => s * (HW - faces[s].depth(x, y));

  // Särmä, jossa veistetty kylki kohtaa selän, ja huuli, jossa se kohtaa varauksen.
  const meet = (x, s, surface) => {
    let z = s * HW;
    let y = 0;
    for (let k = 0; k < 4; k++) {
      y = surface(x, z);
      z = sideZ(x, y, s);
    }
    return { y, z };
  };
  const arris = (x, s) => meet(x, s, topY);
  const lip = (x, s) => meet(x, s, bottomY);

  const grooveY = (x, z, lipL, lipR) => {
    const t = clamp01((z - lipL.z) / (lipR.z - lipL.z));
    return lerp(lipL.y, lipR.y, t) + grooveDepth(x) * (1 - Math.abs(2 * t - 1) ** GROOVE.power);
  };

  // --- runko -------------------------------------------------------------------
  const x0 = T;
  const x1 = L - T;
  const bodyLen = x1 - x0;

  for (const s of [1, -1]) {
    B.grid(seg(bodyLen, 0.006), seg(0.3, 0.0065), (a) => {
      const x = lerp(x0, x1, a);
      const lo = lip(x, s);
      const hi = arris(x, s);
      return (b) => {
        const y = lerp(lo.y, hi.y, b);
        return [x, y, sideZ(x, y, s)];
      };
    }, { surf: SURF.HEWN, hint: [0, 0, s], normal: [0, 0, s] });
  }

  B.grid(seg(bodyLen, 0.01), seg(0.22, 0.0055), (a) => {
    const x = lerp(x0, x1, a);
    const l = arris(x, -1);
    const r = arris(x, 1);
    return (b) => {
      const z = lerp(l.z, r.z, b);
      const y = b === 0 ? l.y : b === 1 ? r.y : topY(x, z);
      return [x, y, z];
    };
  }, { surf: SURF.TOP, hint: [0, 1, 0] });

  B.grid(seg(bodyLen, 0.02), seg(0.2, 0.008), (a) => {
    const x = lerp(x0, x1, a);
    const l = lip(x, -1);
    const r = lip(x, 1);
    return (b) => {
      const z = lerp(l.z, r.z, b);
      return [x, grooveY(x, z, l, r), z];
    };
  }, { surf: SURF.GROOVE, hint: [0, -1, 0] });

  // --- tapit ---------------------------------------------------------------------
  for (const end of [0, 1]) {
    const xOf = (u) => (end === 0 ? u : L - u);
    const out = end === 0 ? -1 : 1; // hirren pään suunta x-akselilla
    const planes = tenonPlanes(end);
    const xs = xOf(T); // olkapään kohta
    const lipL = lip(xs, -1);
    const lipR = lip(xs, 1);

    // Kohta, jossa tapin taso kohtaa veistetyn kyljen.
    const planeEdge = (plane, u, s) => {
      const x = xOf(u);
      let z = s * HW;
      let y = 0;
      for (let k = 0; k < 4; k++) {
        y = plane(u, z);
        z = sideZ(x, y, s);
      }
      return { y, z };
    };

    // tapin kyljet jatkavat veistettyä pintaa
    for (const s of [1, -1]) {
      B.grid(seg(T, 0.006), seg(0.2, 0.0065), (a) => {
        const u = a * T;
        const x = xOf(u);
        const lo = planeEdge(planes.bottom, u, s);
        const hi = planeEdge(planes.top, u, s);
        return (b) => {
          const y = lerp(lo.y, hi.y, b);
          return [x, y, sideZ(x, y, s)];
        };
      }, { surf: SURF.HEWN, hint: [0, 0, s], normal: [0, 0, s] });
    }

    // tapin ylä- ja alataso
    for (const [plane, up] of [[planes.top, 1], [planes.bottom, -1]]) {
      B.grid(seg(T, 0.01), seg(0.2, 0.01), (a) => {
        const u = a * T;
        const x = xOf(u);
        const l = planeEdge(plane, u, -1);
        const r = planeEdge(plane, u, 1);
        return (b) => {
          const z = lerp(l.z, r.z, b);
          return [x, plane(u, z), z];
        };
      }, { surf: SURF.NOTCH, hint: [0, up, 0] });
    }

    // Poikkileikkauspinta kohdassa u: y-rajat lower(z) … upper(z), sivuilla veistetyt kyljet.
    const crossCut = (u, lower, upper, nv) => {
      const x = xOf(u);
      B.grid(seg(0.2, 0.007), nv, (a) => (b) => {
        let z = lerp(-HW, HW, a);
        let y = 0;
        for (let k = 0; k < 5; k++) {
          y = lerp(lower(z), upper(z), b);
          z = lerp(sideZ(x, y, -1), sideZ(x, y, 1), a);
        }
        return [x, y, z];
      }, { surf: SURF.END, hint: [out, 0, 0], normal: [out, 0, 0] });
    };

    // tapin pää
    crossCut(0, (z) => planes.bottom(0, z), (z) => planes.top(0, z), seg(0.2, 0.007));
    // olkapäät tapin ylä- ja alapuolella
    crossCut(T, (z) => planes.top(T, z), (z) => topY(xs, z), seg(0.11, 0.007));
    crossCut(T, (z) => grooveY(xs, z, lipL, lipR), (z) => planes.bottom(T, z), seg(0.09, 0.007));
  }

  return B.build();
}

// Varauksen huulten korkeus kohdassa x (alin kohta, jolla hirsi lepää alustallaan).
export function lipHeight(faces, x) {
  let y = Infinity;
  for (const s of [1, -1]) {
    let z = s * HW;
    let yy = 0;
    for (let k = 0; k < 4; k++) {
      yy = bottomY(x, z);
      z = s * (HW - faces[s].depth(x, yy));
    }
    y = Math.min(y, yy);
  }
  return y;
}
