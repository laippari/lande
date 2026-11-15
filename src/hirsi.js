// Mallihirsi: yksi täyslaatuinen piiluhirsi aluspuiden päällä. Mökin kevyet hirret
// (src/mokki) on johdettu tästä.

import * as THREE from 'three/webgpu';
import { startViewer, showError } from './viewer.js';
import { createLog } from './log/log.js';
import { L } from './log/shape.js';
import { createEnvironment, BEARER } from './scene.js';

// Valmiit näkymät: kameran paikka ja kohde maailman koordinaateissa sekä auringon suunta
// (atsimuutti hirren suunnasta, korkeus). tall on pystynäytön kamera.
const VIEWS = {
  koko: { name: 'Koko hirsi', pos: [-1.9, 1.55, 4.3], target: [2.45, 0.28, 0], tall: { pos: [-2.0, 1.25, 1.55], target: [2.3, 0.26, 0] }, sun: [152, 27], fit: true },
  tyvi: { name: 'Tyvipää', pos: [-0.95, 0.62, 1.0], target: [0.2, 0.3, 0], sun: [152, 27] },
  piilutus: { name: 'Piilutus', pos: [0.75, 0.47, 0.62], target: [2.2, 0.32, 0.1], sun: [171, 16] },
  latva: { name: 'Latvapää', pos: [5.85, 0.66, 0.95], target: [4.85, 0.3, 0], sun: [28, 27] },
};

startViewer({
  views: VIEWS,
  defaultView: 'koko',
  build({ renderer, scene, Q, num }) {
    // hirsi aluspuiden päällä
    const log = createLog({ detail: num('detail', 1) });
    const holder = new THREE.Group();
    holder.add(log.mesh);
    const [xa, xb] = BEARER.at;
    const ya = log.lipHeight(xa);
    const yb = log.lipHeight(xb);
    holder.rotation.z = -Math.atan2(yb - ya, xb - xa); // huulet vaakasuoraan aluspuiden päälle
    holder.position.y = BEARER.size - (ya * Math.cos(holder.rotation.z) + xa * Math.sin(holder.rotation.z));
    scene.add(holder);

    const env = createEnvironment(renderer, scene, { shadowSize: Q.shadow });
    const fitCorners = [];
    for (const x of [-0.05, L + 0.05]) for (const y of [0.1, 0.52]) for (const z of [-0.12, 0.12]) fitCorners.push(new THREE.Vector3(x, y, z));
    return { env, fitCorners, focusTargets: () => [log.mesh], info: () => log.stats };
  },
}).catch(showError);
