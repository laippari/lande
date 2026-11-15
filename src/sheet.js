// Alapaneeli (bottom sheet): valikkopainike avaa sen, ja välilehdet jakavat säätimet ryhmiin.
// Paneelin voi sulkea sulkupainikkeesta, Esc-näppäimellä tai vetämällä sitä alas kahvasta.
// Viimeksi avattu välilehti muistetaan tässä selaimessa.

const $ = (id) => document.getElementById(id);
const KEY = 'lande-tab';

export function createSheet({ onChange = () => {} } = {}) {
  const sheet = $('sheet');
  const menu = $('menu');
  const tabs = [...sheet.querySelectorAll('[data-tab]')];
  let open = false;
  let current = null;

  const remember = (tab) => {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      // ei muistia, ei haittaa
    }
  };
  const recall = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };

  const select = (tab) => {
    current = tab;
    for (const t of tabs) {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`p-${t.dataset.tab}`).hidden = !on;
    }
    remember(tab);
    onChange({ open, tab });
  };

  const setOpen = (value) => {
    open = value;
    document.body.classList.toggle('sheet-open', open);
    menu.setAttribute('aria-expanded', String(open));
    sheet.style.transform = '';
    onChange({ open, tab: current });
  };

  menu.addEventListener('click', () => setOpen(!open));
  $('sheetClose').addEventListener('click', () => setOpen(false));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });
  for (const t of tabs) t.addEventListener('click', () => select(t.dataset.tab));
  // nuolinäppäimet välilehtien välillä
  sheet.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.dataset.tab === current);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(next.dataset.tab);
    next.focus();
  });

  // vetäminen alas kahvasta sulkee paneelin
  const grip = sheet.querySelector('.grip');
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, dy: 0 };
    grip.setPointerCapture(e.pointerId);
    sheet.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheet.style.transform = `translateY(${drag.dy}px)`;
  });
  const end = () => {
    if (!drag) return;
    sheet.classList.remove('dragging');
    const close = drag.dy > 60;
    drag = null;
    if (close) setOpen(false);
    else sheet.style.transform = '';
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);

  const first = recall();
  select(tabs.some((t) => t.dataset.tab === first) ? first : tabs[0].dataset.tab);

  return {
    open: (tab) => {
      if (tab) select(tab);
      setOpen(true);
    },
    close: () => setOpen(false),
    isOpen: () => open,
    tab: () => current,
  };
}
