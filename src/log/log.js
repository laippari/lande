// Kokoaa hirren: piiluiskut, oksat, verkko ja puumateriaali.

import * as THREE from 'three/webgpu';
import { HewnFace, buildStrokeData } from './hewing.js';
import { generateKnots, buildKnotData } from './knots.js';
import { buildLogGeometry, lipHeight } from './geometry.js';
import { createWoodMaterial } from './wood.js';
import { logShape } from './shape.js';

export function createLog({ seed = 1907, detail = 1 } = {}) {
  const faces = { 1: new HewnFace(1, seed + 11), [-1]: new HewnFace(-1, seed + 23) };
  const whorls = generateKnots(seed + 5);
  const geometry = buildLogGeometry(faces, detail);
  const material = createWoodMaterial({
    shape: logShape,
    strokeData: buildStrokeData([faces[1], faces[-1]]),
    knotData: buildKnotData(whorls),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    mesh,
    faces,
    whorls,
    lipHeight: (x) => lipHeight(faces, x),
    stats: {
      triangles: geometry.index.count / 3,
      strokes: faces[1].strokes.length + faces[-1].strokes.length,
      knots: whorls.reduce((n, w) => n + w.branches.length, 0),
    },
  };
}
