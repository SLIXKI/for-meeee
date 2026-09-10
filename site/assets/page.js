// server/vps/site/assets/page.js
// The light script for pages that are not the landing page.
//
// app.js is 31 KB and reaches for the landing page's theatrics — #pre, #gl, #dust,
// #curtain, the orb carousel. Loading it on a prose page means paying for all of
// that and risking null dereferences for markup that isn't there. These pages need
// three small things instead.

(() => {
  const nav = document.getElementById('nav');

  /* nav: solid once scrolled, same 12px threshold as the landing page */
  if (nav) {
    const prog = document.querySelector('.prog');
    const onScroll = () => {
      nav.classList.toggle('scrolled', scrollY > 12);
      const h = document.body.scrollHeight - innerHeight;
      // Scoped to the bar itself: on :root the write invalidated style
      // across the whole document on every scroll frame.
      if (prog) prog.style.setProperty('--sp', (h > 0 ? scrollY / h : 0).toFixed(4));
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* mobile menu — same behavior as the landing page, minus the vault */
  const menuBtn = document.getElementById('menuBtn');
  const mmenu = document.getElementById('mmenu');
  if (menuBtn && mmenu) {
    const setMenu = (open) => {
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      mmenu.classList.toggle('open', open);
      mmenu.setAttribute('aria-hidden', String(!open));
      document.body.classList.toggle('locked', open);
      if (open) { const f = mmenu.querySelector('a'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 120); }
    };
    menuBtn.addEventListener('click', () => setMenu(!mmenu.classList.contains('open')));
    mmenu.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) setMenu(false); });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mmenu.classList.contains('open')) { setMenu(false); menuBtn.focus({ preventScroll: true }); }
    });
    addEventListener('resize', () => { if (innerWidth > 1000 && mmenu.classList.contains('open')) setMenu(false); }, { passive: true });
  }

  /* the landing template's [data-cta] buttons only drew a ripple; make them go */
  document.querySelectorAll('[data-cta][data-href]').forEach((b) => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => { location.href = b.getAttribute('data-href'); });
  });

  /* click-to-copy: <code data-copy> and anything with data-copy */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-copy]');
    if (!el) return;
    const text = el.getAttribute('data-copy') || el.textContent.trim();
    navigator.clipboard?.writeText(text).then(() => {
      const prev = el.dataset.label || el.textContent;
      el.dataset.label = prev;
      el.classList.add('copied');
      el.textContent = 'copied';
      setTimeout(() => { el.textContent = prev; el.classList.remove('copied'); }, 1100);
    }).catch(() => {});
  });

  /* eco tier for subpages: same software-GL probe as the landing page, on a
     throwaway context that is released immediately after asking. */
  try {
    const probe = document.createElement('canvas').getContext('webgl');
    if (probe) {
      const dbg = probe.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(probe.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      if (/swiftshader|llvmpipe|softpipe|software rasterizer|basic render/i.test(renderer))
        document.documentElement.classList.add('eco');
      const lose = probe.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) {}

  document.body.classList.add('ready');
})();
