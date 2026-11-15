// Kasvien kuvat: piirretään kerran kanvaasille ja käytetään läpinäkyvinä kortteina.
//
// Puiden lehvästö on neljän ruudun kartta (männyn neulaskimput, koivun riippuvat lehdet, haavan
// pyöreät lehdet, kuusen riippuva oksisto) ja varvikko kahdeksan ruudun kartta (puolukka,
// mustikka, kukkiva kanerva, metsälauha ja niiden muunnelmat). Värit ovat kasvien omia;
// kortin sävy kertoo yksilön vaihtelun.

import * as THREE from 'three/webgpu';
import { mulberry32 } from '../log/hewing.js';

// Läpinäkyvien pikselien väriksi asetetaan ruudun keskiväri, jottei reunoihin suodatu mustaa.
function finish(canvas, tilesX, tilesY) {
  const w = canvas.width, h = canvas.height;
  const img = canvas.getContext('2d').getImageData(0, 0, w, h);
  const d = img.data;
  const tw = w / tilesX, th = h / tilesY;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = ty * th; y < (ty + 1) * th; y += 2) {
        for (let x = tx * tw; x < (tx + 1) * tw; x += 2) {
          const o = (y * w + x) * 4;
          if (d[o + 3] > 200) {
            r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
          }
        }
      }
      if (!n) continue;
      r /= n; g /= n; b /= n;
      for (let y = ty * th; y < (ty + 1) * th; y++) {
        for (let x = tx * tw; x < (tx + 1) * tw; x++) {
          const o = (y * w + x) * 4;
          const a = d[o + 3] / 255;
          d[o] = d[o] * a + r * (1 - a);
          d[o + 1] = d[o + 1] * a + g * (1 - a);
          d[o + 2] = d[o + 2] * a + b * (1 - a);
        }
      }
    }
  }
  // Pienennökset tehdään itse: tavallinen keskiarvo ohentaisi neulaset ja varret näkymättömiin
  // tai rasteriksi. Jokaisen ruudun peittävyys (osuus, joka ylittää läpinäkyvyysrajan) pidetään
  // pienennöksissä samana kuin täydessä koossa.
  const CUT = 102; // 0,4
  const coverage = (data, lw, x0, y0, sw, sh, scale) => {
    let n = 0;
    for (let y = y0; y < y0 + sh; y++) for (let x = x0; x < x0 + sw; x++) if (data[(y * lw + x) * 4 + 3] * scale > CUT) n++;
    return n / (sw * sh);
  };
  const base = new Uint8Array(d.buffer.slice(0));
  const mipmaps = [{ data: base, width: w, height: h }];
  const target = [];
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) target.push(coverage(base, w, tx * tw, ty * th, tw, th, 1));
  let prev = base, pw = w, ph = h;
  while (pw > 1 || ph > 1) {
    const lw = Math.max(1, pw >> 1), lh = Math.max(1, ph >> 1);
    const out = new Uint8Array(lw * lh * 4);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const x0 = Math.min(x * 2, pw - 1), x1 = Math.min(x * 2 + 1, pw - 1), y0 = Math.min(y * 2, ph - 1), y1 = Math.min(y * 2 + 1, ph - 1);
        for (let c = 0; c < 4; c++) out[(y * lw + x) * 4 + c] = (prev[(y0 * pw + x0) * 4 + c] + prev[(y0 * pw + x1) * 4 + c] + prev[(y1 * pw + x0) * 4 + c] + prev[(y1 * pw + x1) * 4 + c] + 2) >> 2;
      }
    }
    const sw = lw / tilesX, sh = lh / tilesY;
    if (sw >= 4 && sh >= 4) {
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const want = target[ty * tilesX + tx];
          let lo = 0.5, hi = 6;
          for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (coverage(out, lw, tx * sw, ty * sh, sw, sh, mid) < want) lo = mid;
            else hi = mid;
          }
          const k = (lo + hi) / 2;
          for (let y = ty * sh; y < (ty + 1) * sh; y++) for (let x = tx * sw; x < (tx + 1) * sw; x++) out[(y * lw + x) * 4 + 3] = Math.min(255, out[(y * lw + x) * 4 + 3] * k);
        }
      }
    }
    mipmaps.push({ data: out, width: lw, height: lh });
    prev = out; pw = lw; ph = lh;
  }
  const tex = new THREE.DataTexture(base, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mipmaps;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
const shade = (c, k) => rgb(c[0] * k, c[1] * k, c[2] * k);

function tile(ctx, x, y, s, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, s - 4, s - 4);
  ctx.clip();
  ctx.translate(x, y);
  draw(s);
  ctx.restore();
}

function leaf(ctx, x, y, len, wid, ang, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(len / 2, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function createFoliageAtlas() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(4711);
  ctx.lineCap = 'round';

  // 0: männyn neulaskimput. Versot ovat pullonharjan kaltaisia: lyhyt oksa, jonka ympärillä neulaset
  // osoittavat kärkeä kohti. Versot kasautuvat ryhmiksi, joten tupsun ääriviiva on epäsäännöllinen.
  tile(ctx, 0, 0, S, (s) => {
    const green = [[38, 60, 36], [50, 76, 42], [62, 90, 48], [32, 52, 32], [76, 104, 56]];
    const groups = [];
    for (let i = 0; i < 11; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * s * 0.3;
      groups.push([s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, s * (0.09 + rnd() * 0.08)]);
    }
    for (let i = 0; i < 330; i++) {
      const g = groups[Math.floor(rnd() * groups.length)];
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * g[2];
      const x = g[0] + Math.cos(a) * r, y = g[1] + Math.sin(a) * r;
      const dir = Math.atan2(y - s / 2, x - s / 2) + (rnd() - 0.5) * 1.8;
      const col = green[Math.floor(rnd() * green.length)];
      const k = 0.78 + rnd() * 0.5;
      const len = s * (0.035 + rnd() * 0.03), nl = s * (0.02 + rnd() * 0.008);
      ctx.strokeStyle = rgb(74, 54, 36);
      ctx.lineWidth = s * 0.004;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
      ctx.lineWidth = s * 0.0034;
      const n = 13;
      for (let j = 0; j < n; j++) {
        const t = j / (n - 1), bx = x + Math.cos(dir) * len * t, by = y + Math.sin(dir) * len * t;
        ctx.strokeStyle = shade(col, k * (0.85 + 0.3 * t));
        for (const sd of [-1, 1]) {
          const b = dir + sd * (0.55 + rnd() * 0.5);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(b) * nl, by + Math.sin(b) * nl);
          ctx.stroke();
        }
      }
    }
  });

  // 1: koivun lehvästö: ohuet riippuvat oksat ja pienet vinoneliömäiset lehdet
  tile(ctx, S, 0, S, (s) => {
    const green = [[98, 134, 52], [116, 150, 60], [84, 120, 46], [132, 160, 70], [74, 108, 44]];
    for (let i = 0; i < 95; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * s * 0.4;
      let x = s / 2 + Math.cos(a) * r, y = s * 0.42 + Math.sin(a) * r * 0.85;
      let dir = Math.PI / 2 + (rnd() - 0.5) * 1.6;
      const steps = 7 + Math.floor(rnd() * 6);
      for (let j = 0; j < steps; j++) {
        const nx = x + Math.cos(dir) * s * 0.02, ny = y + Math.sin(dir) * s * 0.02;
        ctx.strokeStyle = rgb(62, 50, 38);
        ctx.lineWidth = s * 0.0028;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        const col = green[Math.floor(rnd() * green.length)];
        leaf(ctx, nx, ny, s * (0.024 + rnd() * 0.012), s * (0.017 + rnd() * 0.008), dir + (j % 2 ? 1 : -1) * (0.7 + rnd() * 0.5), shade(col, 0.8 + rnd() * 0.4));
        x = nx; y = ny;
        dir += (Math.PI / 2 - dir) * 0.25 + (rnd() - 0.5) * 0.3; // oksa kääntyy riippumaan
      }
    }
  });

  // 2: haavan (ja lepän, pihlajan) lehvästö: pyöreät lehdet pitkissä ruodeissa
  tile(ctx, 0, S, S, (s) => {
    const green = [[92, 124, 62], [108, 140, 70], [80, 112, 56], [122, 150, 80], [70, 100, 52]];
    for (let i = 0; i < 520; i++) {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * s * 0.43;
      const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r * 0.9;
      const col = green[Math.floor(rnd() * green.length)];
      const rad = s * (0.013 + rnd() * 0.009);
      ctx.fillStyle = shade(col, 0.75 + rnd() * 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.75 + rnd() * 0.25), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = rgb(70, 66, 52);
    ctx.lineWidth = s * 0.004;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.3, s / 2 + Math.sin(a) * s * 0.3);
      ctx.stroke();
    }
  });

  // 3: kuusen oksakerros: latvasta alas ja ulos riippuvat oksat, joiden reunassa on neulasripsu
  tile(ctx, S, S, S, (s) => {
    const green = [[34, 60, 36], [44, 72, 42], [28, 50, 32], [54, 84, 48]];
    for (let i = 0; i < 46; i++) {
      const side = i % 2 ? 1 : -1;
      const spread = Math.pow(rnd(), 0.8);
      let x = s / 2 + side * rnd() * s * 0.03, y = s * (0.05 + rnd() * 0.25);
      let dir = Math.PI / 2 - side * (0.15 + spread * 0.75);
      const steps = 10 + Math.floor(rnd() * 8 + spread * 6);
      const col = green[Math.floor(rnd() * green.length)];
      for (let j = 0; j < steps; j++) {
        const nx = x + Math.cos(dir) * s * 0.036, ny = y + Math.sin(dir) * s * 0.036;
        ctx.strokeStyle = shade(col, 0.8 + rnd() * 0.4);
        ctx.lineWidth = s * (0.03 - 0.014 * (j / steps));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        ctx.lineWidth = s * 0.004;
        for (let q = 0; q < 5; q++) {
          const b = dir + (rnd() - 0.5) * 2.6, l = s * (0.022 + rnd() * 0.02);
          ctx.beginPath();
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + Math.cos(b) * l, ny + Math.sin(b) * l);
          ctx.stroke();
        }
        x = nx; y = ny;
        dir += (Math.PI / 2 - dir) * 0.06 + (rnd() - 0.5) * 0.12;
        if (y > s * 0.96) break;
      }
    }
  });

  return finish(c, 2, 2);
}

// Varvikon mättäät. Ruutu vastaa puolen metrin levyistä ja korkuista alaa (noin 1 mm pikseliä
// kohti), ja kasvi on piirretty luonnollisessa koossaan ruudun alareunaan: puolukka on vain
// 10–20 cm korkea, mustikka 20–30 cm, kanerva 25–40 cm ja metsälauhan röyhyt puolimetrisiä.
export const TUFT_HEIGHT = [0.42, 0.62, 0.8, 1.0];

export function createTuftAtlas() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S * 2;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(1917);
  ctx.lineCap = 'round';

  // verso ruudun alareunasta: at(x, y, suunta, osuus) varren pisteissä
  const shoot = (s, x0, height, lean, color, width, at, steps = 12) => {
    let x = x0, y = s - 2, dir = -Math.PI / 2 + lean * 0.5;
    const step = height / steps;
    for (let j = 0; j < steps; j++) {
      const nx = x + Math.cos(dir) * step, ny = y + Math.sin(dir) * step;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * (1 - 0.5 * (j / steps));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      x = nx; y = ny;
      dir += lean * 0.05 + (rnd() - 0.5) * 0.16;
      at(x, y, dir, (j + 1) / steps);
    }
  };
  // lehti, jossa on vaaleampi keskisuoni ja kiilto
  const glossy = (x, y, len, wid, ang, col, k) => {
    leaf(ctx, x, y, len, wid, ang, shade(col, k));
    leaf(ctx, x + Math.cos(ang) * len * 0.12, y + Math.sin(ang) * len * 0.12, len * 0.62, wid * 0.36, ang, shade(col, k * 1.45));
  };
  const berry = (x, y, r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };

  // puolukka: pystyt versot, nahkeat tummanvihreät kiiltävät lehdet, punaisia marjoja
  const lingon = (count, berries, top = TUFT_HEIGHT[0]) => (s) => {
    const green = [[40, 70, 34], [52, 86, 40], [34, 60, 30], [64, 98, 46]];
    for (let i = 0; i < count; i++) {
      const x0 = s * (0.06 + 0.88 * rnd()), hgt = s * top * (0.5 + rnd() * 0.5), lean = (x0 / s - 0.5) * 1.2 + (rnd() - 0.5) * 0.9;
      shoot(s, x0, hgt, lean, rgb(92, 66, 46), s * 0.007, (x, y, dir, t) => {
        if (t < 0.2) return;
        const col = green[Math.floor(rnd() * green.length)];
        const sd = Math.round(t * 20) % 2 ? 1 : -1;
        glossy(x, y, s * (0.03 + rnd() * 0.012), s * (0.017 + rnd() * 0.006), dir + sd * (0.8 + rnd() * 0.5), col, 0.8 + rnd() * 0.4);
        if (berries && t > 0.65 && rnd() < 0.07) berry(x + (rnd() - 0.5) * s * 0.02, y + s * 0.012, s * 0.0085, rgb(176 + rnd() * 40, 26, 34));
      }, 9);
    }
  };
  // mustikka: kulmikkaat vihreät haarovat varret, ohuet kirkkaanvihreät suippokärkiset lehdet
  const bilberry = (count, autumn) => (s) => {
    const green = [[76, 112, 46], [92, 128, 54], [66, 100, 42], [108, 140, 62]];
    const red = [[138, 84, 48], [150, 100, 52]];
    for (let i = 0; i < count; i++) {
      const x0 = s * (0.08 + 0.84 * rnd()), hgt = s * TUFT_HEIGHT[1] * (0.55 + rnd() * 0.45), lean = (x0 / s - 0.5) * 1.4 + (rnd() - 0.5) * 1.0;
      shoot(s, x0, hgt, lean, rgb(86, 124, 50), s * 0.006, (x, y, dir, t) => {
        if (t < 0.28) return;
        const pal = autumn && rnd() < 0.1 ? red : green;
        const col = pal[Math.floor(rnd() * pal.length)];
        for (const sd of [-1, 1]) {
          if (rnd() < 0.3) continue;
          glossy(x, y, s * (0.034 + rnd() * 0.014), s * (0.016 + rnd() * 0.006), dir + sd * (0.7 + rnd() * 0.6), col, 0.82 + rnd() * 0.36);
        }
        if (t > 0.4 && rnd() < 0.035) berry(x + (rnd() - 0.5) * s * 0.02, y + s * 0.014, s * 0.0095, rgb(44, 52, 92));
      }, 13);
    }
  };
  // kanerva: puutuvat ruskeat varret, suomumaiset lehdet ja loppukesällä vaaleanpunaiset kukat
  const heather = (count, flowering) => (s) => {
    for (let i = 0; i < count; i++) {
      const x0 = s * (0.1 + 0.8 * rnd()), hgt = s * TUFT_HEIGHT[2] * (0.55 + rnd() * 0.45), lean = (x0 / s - 0.5) * 1.3 + (rnd() - 0.5) * 0.7;
      shoot(s, x0, hgt, lean, rgb(92, 68, 50), s * 0.006, (x, y, dir, t) => {
        if (t < 0.25) return;
        const flower = flowering && t > 0.6 && rnd() < 0.7;
        for (let q = 0; q < 4; q++) {
          const b = dir + (q % 2 ? 1 : -1) * (0.5 + rnd() * 0.7), l = s * (0.01 + rnd() * 0.012);
          ctx.strokeStyle = flower ? rgb(150 + rnd() * 30, 112 + rnd() * 24, 140 + rnd() * 26) : rgb(70 + rnd() * 26, 88 + rnd() * 24, 52 + rnd() * 14);
          ctx.lineWidth = s * (flower ? 0.0075 : 0.0055);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
          ctx.stroke();
        }
      }, 22);
    }
  };
  // metsälauha: hennot kaartuvat lehdet tuppaana ja punaruskeat harvat röyhyt
  const grass = (blades, stems) => (s) => {
    for (let i = 0; i < blades; i++) {
      const x0 = s * (0.4 + 0.2 * rnd()), hgt = s * (0.3 + rnd() * 0.4), lean = (rnd() - 0.5) * 3.4;
      shoot(s, x0, hgt, lean, rgb(112 + rnd() * 40, 136 + rnd() * 30, 66 + rnd() * 20), s * 0.0042, () => {}, 14);
    }
    for (let i = 0; i < stems; i++) {
      const x0 = s * (0.42 + 0.16 * rnd()), hgt = s * (0.7 + rnd() * 0.27), lean = (rnd() - 0.5) * 1.3;
      shoot(s, x0, hgt, lean, rgb(156, 138, 94), s * 0.003, (x, y, dir, t) => {
        if (t < 0.72) return;
        for (let q = 0; q < 7; q++) {
          ctx.fillStyle = rgb(172 + rnd() * 30, 124 + rnd() * 30, 98 + rnd() * 20);
          ctx.beginPath();
          ctx.arc(x + (rnd() - 0.5) * s * 0.075, y + (rnd() - 0.5) * s * 0.045, s * 0.0045, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 14);
    }
  };
  const both = (...fns) => (s) => fns.forEach((f) => f(s));

  const draws = [
    lingon(70, true), bilberry(40, false), both(lingon(18, false), heather(46, true)), both(lingon(22, true), grass(40, 8)),
    lingon(44, false), both(lingon(16, false), bilberry(34, true)), heather(52, false), both(bilberry(12, false), grass(28, 5)),
  ];
  draws.forEach((draw, i) => tile(ctx, (i % 4) * S, Math.floor(i / 4) * S, S, draw));
  return finish(c, 4, 2);
}

// Metsänpohjan lähirakenne: saumattomasti toistuva kuva 1,2 metrin alalta. Keskiharmaa ei muuta
// maan väriä; sammalen versot vaalentavat ja vihertävät, neulaset ja risut ruskistavat.
export function createGroundDetail() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(8128);
  ctx.fillStyle = rgb(128, 128, 128);
  ctx.fillRect(0, 0, S, S);
  ctx.lineCap = 'round';
  // piirretään myös reunojen yli, jotta kuva toistuu saumatta
  const wrapped = (x, y, reach, draw) => {
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        if (x + ox < -reach || x + ox > S + reach || y + oy < -reach || y + oy > S + reach) continue;
        draw(x + ox, y + oy);
      }
    }
  };
  // sammalen versot: pieniä tähtiä
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2.5 + rnd() * 4, k = 0.75 + rnd() * 0.6;
    const col = rnd() < 0.7 ? [132 * k, 150 * k, 96 * k] : [100 * k, 118 * k, 84 * k];
    wrapped(x, y, r, (px, py) => {
      ctx.strokeStyle = rgb(...col);
      ctx.lineWidth = 1.2;
      for (let q = 0; q < 5; q++) {
        const a = rnd() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
        ctx.stroke();
      }
    });
  }
  // männyn neulaset pareittain
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, len = 26 + rnd() * 18, k = 0.7 + rnd() * 0.6;
    const col = rnd() < 0.75 ? [168 * k, 118 * k, 70 * k] : [120 * k, 104 * k, 84 * k];
    wrapped(x, y, len, (px, py) => {
      ctx.strokeStyle = rgb(...col);
      ctx.lineWidth = 1.25;
      for (const d of [-0.09, 0.09]) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a + d) * len, py + Math.sin(a + d) * len);
        ctx.stroke();
      }
    });
  }
  // risut ja kaarnanpalat
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, len = 40 + rnd() * 120;
    wrapped(x, y, len, (px, py) => {
      ctx.strokeStyle = rgb(84, 70, 60);
      ctx.lineWidth = 2 + rnd() * 2.5;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(a + 0.3) * len * 0.5, py + Math.sin(a + 0.3) * len * 0.5, px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 12, a = rnd() * 3;
    wrapped(x, y, r * 2, (px, py) => {
      ctx.fillStyle = rgb(92 + rnd() * 30, 70 + rnd() * 20, 56);
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.6, a, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  return tex;
}
