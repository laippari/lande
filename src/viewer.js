import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, packNormalToRGB, unpackRGBToNormal, sample, screenUV, rtt, builtinAOContext, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import SSAAPassNode from 'three/addons/tsl/display/SSAAPassNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createUI } from './ui.js';

const params = new URLSearchParams(location.search);
const num = (key, fallback) => (params.has(key) ? Number(params.get(key)) : fallback);

// Selaimen istuntomuisti voi olla estetty, joten sitä käytetään varoen.
const session = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ei muistia, ei poistettavaa
    }
  },
};

// SSAA-kierros, joka käyttää samaa varjostusyhteyttä (AO) kuin tavallinen kierros.
class StillPassNode extends SSAAPassNode {
  updateBefore(frame) {
    const { renderer } = frame;
    const previous = renderer.contextNode;
    if (this.contextNode !== null) renderer.contextNode = this._getContextNode(renderer);
    super.updateBefore(frame);
    renderer.contextNode = previous;
  }
}

const ease = (t) => t * t * (3 - 2 * t);

// Käynnistää katselun. Sivu antaa näkymät ja build-funktion, joka rakentaa sisällön ja ympäristön:
//
//   views: { avain: { name, pos, target, sun: [atsimuutti, korkeus], fit?, tall? } }
//   build({ renderer, scene, Q, params, num }) → { env, fitCorners, focusTargets, info }
//
// Palauttaa kahvan, jolla sivu voi pyytää uuden kuvan (invalidate), kun sisältö muuttuu.
export async function startViewer({ views: VIEWS, defaultView, build, maxDistance = 16, aoRadius = 0.3, sunDefault = [152, 27], far = 600, portraitFov = null, maxPolar = 0.497 }) {
  const container = document.getElementById('viewer');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const quality = params.get('q') || (coarse ? 'mobile' : 'desktop');
  const Q = quality === 'mobile'
    ? { shadow: 2048, stillLevel: 2, maxPixelRatio: 2, motionPixelRatio: 1.5, aoScale: 0.5 }
    : { shadow: 4096, stillLevel: 3, maxPixelRatio: 2, motionPixelRatio: 2, aoScale: 1 };

  // Jos WebGPU antoi tällä laitteella virheen, sivu on ladattu uudelleen WebGL 2 -varatilaan
  // (ks. alla). ?webgpu kokeilee WebGPU:ta uudelleen.
  if (params.has('webgpu')) session.remove('lande-fallback');
  const fallbackReason = session.get('lande-fallback');
  const forceWebGL = params.has('webgl') || fallbackReason !== null;

  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, powerPreference: 'high-performance' });
  renderer.toneMapping = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping }[params.get('tm') || 'neutral'];
  const baseExposure = num('exp', 0.5);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  document.documentElement.dataset.backend = backend;

  // WebGPU-toteutukset eroavat selaimittain. Jos laite hylkää jotain käynnistyksen aikana,
  // sivu ladataan uudelleen WebGL 2 -varatilaan, jossa sama koodi toimii.
  if (renderer.backend.isWebGPUBackend && !params.has('offscreen')) {
    const device = renderer.backend.device;
    const started = performance.now();
    const fallBack = (reason) => {
      if (performance.now() - started > 20000) return;
      if (session.set('lande-fallback', String(reason || 'tuntematon virhe').slice(0, 240))) location.reload();
    };
    device.addEventListener('uncapturederror', (e) => fallBack(e.error && e.error.message));
    device.lost.then((info) => {
      if (info.reason !== 'destroyed') fallBack(`laite katosi: ${info.message}`);
    });
    // jotkin selaimet ilmoittavat kadonneesta laitteesta vain hylättyinä lupauksina
    addEventListener('unhandledrejection', (e) => {
      const text = String((e.reason && e.reason.message) || e.reason);
      if (/GPU|popErrorScope|Instance dropped|device/i.test(text)) fallBack(text);
    });
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(num('fov', 32), 1, 0.03, far);
  camera.layers.enable(1); // kerros 1: kasvillisuus ja vesi, joita ei piirretä AO:n esikierrokseen

  const t0 = performance.now();
  const content = await build({ renderer, scene, quality, Q, params, num });
  const buildMs = performance.now() - t0;
  const env = content.env;

  // --- kamera ja ohjaus ---
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.14;
  controls.maxDistance = maxDistance;
  controls.maxPolarAngle = Math.PI * maxPolar; // maastossa kamera saa katsoa myös ylöspäin
  controls.zoomToCursor = true;

  // Näkymän kamera tälle kuvasuhteelle. Kokonaisnäkymässä (fit) kamera vetäytyy niin kauas,
  // että kohde mahtuu kuvaan reunoineen.
  // Sisältö voi sijoittaa näkymät itse (resolveView), esimerkiksi siirrettävän mökin mukaan.
  const resolve = (v) => (content.resolveView ? content.resolveView(v) : v);
  const poseFor = (view) => {
    const corners = typeof content.fitCorners === 'function' ? content.fitCorners() : content.fitCorners;
    const tall = camera.aspect < 0.8 && view.tall;
    const src = resolve(tall ? view.tall : view);
    const target = new THREE.Vector3().fromArray(src.target);
    const pos = new THREE.Vector3().fromArray(src.pos);
    // pystynäytöllä lähikuvat otetaan hieman kauempaa, jotta kohde mahtuu kapeaan kuvaan
    if (camera.aspect < 0.8 && !view.tall) pos.sub(target).multiplyScalar(1.45).add(target);
    if (view.fit) {
      const dir = pos.clone().sub(target).normalize();
      const probe = camera.clone();
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const tanH = tanV * camera.aspect;
      const margin = tall ? (view.tall.margin || 0.8) : 0.86;
      let d = 1.5;
      for (; d < 90; d += 0.1) {
        probe.position.copy(target).addScaledVector(dir, d);
        probe.lookAt(target);
        probe.updateMatrixWorld();
        const inv = probe.matrixWorldInverse;
        if (corners.every((c) => {
          const v = c.clone().applyMatrix4(inv);
          return v.z < 0 && Math.abs(v.x / -v.z) < tanH * margin && Math.abs(v.y / -v.z) < tanV * margin;
        })) break;
      }
      pos.copy(target).addScaledVector(dir, d);
    }
    return { pos, target };
  };

  let dirty = true;
  let stillDone = false;
  let lastMotion = 0;
  let move = null; // käynnissä oleva siirtymä näkymästä toiseen
  let currentView = null;
  let envStale = 0;

  const applySun = (az, el, final) => {
    env.setSun(az, el, { environment: final });
    renderer.toneMappingExposure = baseExposure * env.exposure();
    ui.setSun(az, el);
    dirty = true;
  };

  const goTo = (key, { instant = false, keepSun = false } = {}) => {
    const view = VIEWS[key];
    if (!view) return;
    currentView = key;
    ui.setView(key);
    const to = poseFor(view);
    const sunTo = resolve(view).sun;
    if (instant) {
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      controls.update();
      if (!keepSun) applySun(sunTo[0], sunTo[1], true);
      dirty = true;
      return;
    }
    // atsimuutti kiertää lyhintä reittiä
    const az0 = env.state.azimuth;
    const az1 = az0 + ((((sunTo[0] - az0) % 360) + 540) % 360) - 180;
    move = {
      t: 0,
      dur: 1.25,
      from: { pos: camera.position.clone(), target: controls.target.clone() },
      to,
      sun: [az0, env.state.elevation, az1, sunTo[1]],
    };
    controls.enabled = false;
  };

  const ui = createUI({
    views: VIEWS,
    backend,
    onView: (key) => goTo(key),
    onSun: (az, el) => {
      applySun(az, el, false);
      envStale = performance.now();
    },
  });

  // --- jälkikäsittely ---
  // Esikierros piirtää vain syvyyden ja normaalit kevyellä materiaalilla; niistä lasketaan
  // ambient occlusion, joka himmentää ainoastaan taivaan valoa (ei auringon suoraa valoa).
  const prePass = pass(scene, camera);
  prePass.overrideMaterial = new THREE.MeshBasicNodeMaterial();
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
  const solid = new THREE.Layers();
  solid.set(0);
  prePass.setLayers(solid);
  prePass.getTexture('output').type = THREE.UnsignedByteType;
  const preNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const preDepth = prePass.getTextureNode('depth');

  const aoPass = ao(preDepth, preNormal, camera);
  aoPass.resolutionScale = Q.aoScale;
  aoPass.radius.value = num('aor', aoRadius);
  aoPass.samples.value = 16;
  aoPass.scale.value = 1.0;
  aoPass.thickness.value = 1.2;
  // Kohina suodatetaan omaan tekstuuriinsa, josta materiaalit lukevat sen ruudun koordinaateilla.
  const aoClean = rtt(denoise(aoPass.getTextureNode(), preDepth, preNormal, camera));
  const aoNode = params.has('noao') ? null : aoClean.sample(screenUV).r;
  // AO-ketju liitetään kuvan solmuverkkoon ennen näkymän kierrosta, jotta se päivittyy ensin.
  // Kuvan alfa pidetään täytenä: pehmeäreunaiset lehvästöt kirjoittavat reunoilleen osittaista
  // alfaa, joka muuten päästäisi sivun taustan kuultamaan kanvaasin läpi.
  const withAO = (scenePass) => {
    if (!aoNode) return vec4(scenePass.rgb, 1);
    scenePass.contextNode = builtinAOContext(aoNode);
    return vec4(aoNode.mul(0).add(scenePass).rgb, 1);
  };

  const fastPass = pass(scene, camera, { samples: num('msaa', 4) });
  const fastPipeline = new THREE.RenderPipeline(renderer);
  fastPipeline.outputNode = withAO(fastPass);

  const stillPass = new StillPassNode(scene, camera);
  stillPass.sampleLevel = num('ssaa', Q.stillLevel);
  stillPass.unbiased = true;
  const stillPipeline = new THREE.RenderPipeline(renderer);
  stillPipeline.outputNode = withAO(stillPass);

  // --- koko ja tarkkuus ---
  const maxPixelRatio = Math.min(window.devicePixelRatio || 1, num('pr', Q.maxPixelRatio));
  let pixelRatio = maxPixelRatio;
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pystynäytöllä laajempi kuvakulma, jotta leveä kohde mahtuu kuvaan lähempää
    if (portraitFov && !params.has('fov')) camera.fov = camera.aspect < 0.8 ? portraitFov : 32;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  controls.addEventListener('change', () => {
    dirty = true;
  });
  controls.addEventListener('start', () => {
    if (currentView) {
      currentView = null;
      ui.setView(null);
    }
  });
  addEventListener('resize', () => {
    resize();
    // kuvasuhteen muuttuessa näkymä rajataan uudelleen, mutta valoon ei kosketa
    if (currentView && !move) goTo(currentView, { instant: true, keepSun: true });
  });
  resize();

  if (params.has('cam')) {
    const c = params.get('cam').split(',').map(Number);
    camera.position.fromArray(c.slice(0, 3));
    controls.target.fromArray(c.slice(3, 6));
    controls.update();
    applySun(num('az', sunDefault[0]), num('el', sunDefault[1]), true);
  } else {
    goTo(VIEWS[params.get('view')] ? params.get('view') : defaultView, { instant: true });
    if (params.has('az') || params.has('el')) applySun(num('az', env.state.azimuth), num('el', env.state.elevation), true);
  }

  // Kaksoisnapautus tarkentaa osoitettuun kohtaan.
  const raycaster = new THREE.Raycaster();
  let lastTap = 0;
  let tapAt = null;
  const focus = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(content.focusTargets(), false)[0];
    if (!hit) return;
    const dist = Math.max(0.4, camera.position.distanceTo(hit.point) * 0.42);
    const dir = camera.position.clone().sub(hit.point).normalize();
    move = {
      t: 0,
      dur: 0.9,
      from: { pos: camera.position.clone(), target: controls.target.clone() },
      to: { pos: hit.point.clone().addScaledVector(dir, dist), target: hit.point.clone() },
      sun: null,
    };
    controls.enabled = false;
    currentView = null;
    ui.setView(null);
  };
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const now = performance.now();
    // napautus on lyhyt painallus, joka ei liiku; veto tai nipistys ei kelpaa
    const tap = down && now - down.t < 300 && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 8;
    down = null;
    if (!tap) {
      lastTap = 0;
      return;
    }
    // sisältö voi käyttää napautuksen itse (mökin siirto)
    if (content.onTap) {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      if (content.onTap(raycaster)) {
        lastTap = 0;
        dirty = true;
        return;
      }
    }
    const near = tapAt && Math.hypot(ev.clientX - tapAt.x, ev.clientY - tapAt.y) < 24;
    if (now - lastTap < 340 && near) {
      focus(ev);
      lastTap = 0;
    } else {
      lastTap = now;
      tapAt = { x: ev.clientX, y: ev.clientY };
    }
  });

  // Liikkeessä tarkkuus mukautuu laitteen nopeuteen; pysähtyessä piirretään täysi kuva.
  let motionRatio = Math.min(maxPixelRatio, Q.motionPixelRatio);
  let ceiling = maxPixelRatio;
  let sinceRaise = 1000;
  let slow = 0;
  let fast = 0;
  let sinceShed = 1000;
  const adapt = (dt) => {
    // tavoite on yli 40 kuvaa sekunnissa
    if (dt > 0.025) {
      slow++;
      fast = 0;
    } else if (dt < 0.019) {
      fast++;
      slow = Math.max(0, slow - 1);
    }
    if (slow > 4 && motionRatio <= 1 && content.shed && sinceShed > 90) {
      // tarkkuus on jo alimmillaan: sisältö keventää itseään (esimerkiksi varvikon piirtoetäisyyttä)
      content.shed();
      sinceShed = 0;
      slow = 0;
    }
    sinceShed++;
    if (slow > 4 && motionRatio > 1) {
      // jos tarkkuus jouduttiin laskemaan pian noston jälkeen, sitä ei enää nosteta yhtä ylös
      if (sinceRaise < 240) ceiling = Math.max(1, motionRatio - 0.25);
      motionRatio = Math.max(1, motionRatio - 0.25);
      slow = 0;
    } else if (fast > 150 && motionRatio < ceiling) {
      motionRatio = Math.min(ceiling, motionRatio + 0.25);
      fast = 0;
      sinceRaise = 0;
    }
    sinceRaise++;
  };
  const setRatio = (r) => {
    if (pixelRatio === r) return;
    pixelRatio = r;
    resize();
  };

  // ?mittari (tai #mittari): hirsi pyörii itsestään ja otsikon alla näkyy ruutuaika liikkeessä.
  const meterOn = params.has('mittari') || location.hash === '#mittari';
  const meter = document.getElementById('meter');
  let meterMs = 0;
  let meterAt = 0;
  if (meterOn) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
  }
  const showMeter = (dt, now) => {
    meterMs = meterMs ? meterMs * 0.92 + dt * 80 : dt * 1000;
    if (now - meterAt < 300) return;
    meterAt = now;
    meter.hidden = false;
    const rate = 1000 / meterMs;
    meter.textContent = `${meterMs.toFixed(1)} ms · ${rate < 10 ? rate.toFixed(1) : Math.round(rate)} kuvaa/s · tarkkuus ${pixelRatio}×`
      + (fallbackReason ? ` · varatila: ${fallbackReason}` : '');
  };

  const ready = () => {
    window.__info = { backend, quality, buildMs: Math.round(buildMs), ...content.info() };
    window.__ready = true;
    document.body.classList.add('ready');
  };

  const offscreen = params.has('offscreen');
  let last = performance.now();
  let frames = 0;
  let streak = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    const dt = Math.min(0.1, elapsed);
    last = now;

    if (move) {
      move.t = Math.min(1, move.t + dt / move.dur);
      const k = ease(move.t);
      camera.position.lerpVectors(move.from.pos, move.to.pos, k);
      controls.target.lerpVectors(move.from.target, move.to.target, k);
      if (move.sun) {
        const [a0, e0, a1, e1] = move.sun;
        applySun(a0 + (a1 - a0) * k, e0 + (e1 - e0) * k, move.t === 1);
      }
      if (move.t === 1) {
        move = null;
        controls.enabled = true;
      }
      dirty = true;
    }
    // valon säätimen jälkeen ympäristökartta päivitetään, kun säätö pysähtyy
    if (envStale && now - envStale > 180) {
      env.updateEnvironment();
      envStale = 0;
      dirty = true;
    }
    controls.update();
    const floor = content.groundY ? content.groundY(camera.position.x, camera.position.z) : 0.04;
    if (camera.position.y < floor) camera.position.y = floor;
    if (content.onFrame && (dirty || offscreen)) content.onFrame(camera, controls);

    if (offscreen) {
      // testitila: kanvaasille ei piirretä, kuvat luetaan __capture-funktiolla
      if (++frames === 2) ready();
      return;
    }
    if (dirty) {
      // peräkkäiset liikeruudut: edellisen ruudun kesto kertoo laitteen nopeuden
      if (streak++ > 0) {
        adapt(dt);
        if (meterOn) showMeter(elapsed, now);
      }
      setRatio(motionRatio);
      fastPipeline.render();
      dirty = false;
      stillDone = false;
      lastMotion = now;
      if (++frames === 1) ready();
    } else {
      streak = 0;
      if (!stillDone && now - lastMotion > 280 && !params.has('nostill')) {
        setRatio(maxPixelRatio);
        dirty = false;
        stillPipeline.render();
        stillDone = true;
      }
    }
  });

  const handle = {
    views: VIEWS,
    goTo,
    env,
    scene,
    camera,
    controls,
    renderer,
    content,
    backend,
    isMoving: () => move !== null,
    currentView: () => currentView,
    invalidate: () => {
      dirty = true;
    },
  };
  window.__viewer = handle;

  // Testikaappaus: kuva luetaan renderöintikohteesta (headless-selain ei näytä WebGPU-kanvaasia).
  window.__capture = async ({ still = false } = {}) => {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const rt = new THREE.RenderTarget(w, h);
    if (content.onFrame) content.onFrame(camera, controls);
    renderer.setRenderTarget(rt);
    (still ? stillPipeline : fastPipeline).render();
    renderer.setRenderTarget(null);
    const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
    rt.dispose();
    const stride = px.length / h;
    const flip = !renderer.backend.isWebGPUBackend;
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (flip ? h - 1 - y : y) * stride;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };

  return handle;
}

export function showError(e) {
  window.__error = String(e && e.stack ? e.stack : e);
  console.error(e);
  const box = document.getElementById('error');
  if (box) {
    box.hidden = false;
    box.textContent = 'Renderöinti ei käynnistynyt: ' + (e && e.message ? e.message : e);
  }
  document.body.classList.add('ready');
}
