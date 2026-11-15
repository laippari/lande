// Käyttöliittymä: näkymäpainikkeet ja valon säätimet.

const $ = (id) => document.getElementById(id);

export function createUI({ views, onView, onSun, backend }) {
  const nav = $('views');
  const buttons = {};
  for (const [key, view] of Object.entries(views)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = view.name;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onView(key));
    nav.appendChild(b);
    buttons[key] = b;
  }

  $('badge').textContent = backend;

  // Paneelit (valo, katto): painike, jolla on data-panel, avaa ja sulkee oman paneelinsa.
  const toggles = [...document.querySelectorAll('[data-panel]')];
  const show = (id) => {
    for (const t of toggles) {
      const open = t.dataset.panel === id;
      $(t.dataset.panel).hidden = !open;
      t.setAttribute('aria-expanded', String(open));
    }
  };
  for (const t of toggles) t.addEventListener('click', () => show($(t.dataset.panel).hidden ? t.dataset.panel : null));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') show(null);
  });
  const az = $('az');
  const el = $('el');
  const emit = () => onSun(Number(az.value), Number(el.value));
  az.addEventListener('input', emit);
  el.addEventListener('input', emit);

  const hint = $('hint');
  const dismiss = () => hint.classList.add('gone');
  setTimeout(dismiss, 9000);
  $('viewer').addEventListener('pointerdown', dismiss);

  return {
    setView(key) {
      for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(k === key));
    },
    setSun(azimuth, elevation) {
      const a = ((Math.round(azimuth) % 360) + 360) % 360;
      az.value = a;
      el.value = Math.round(elevation);
      $('azOut').textContent = `${a}°`;
      $('elOut').textContent = `${Math.round(elevation)}°`;
    },
  };
}
