// server/vps/site/assets/page.js
// The light script for pages that are not the landing page.
//
// app.js is 31 KB and reaches for the landing page's theatrics — #pre, #gl, #dust,
// #curtain, the orb carousel. Loading it on a prose page means paying for all of
// that and risking null dereferences for markup that isn't there. These pages need
// three small things instead.

(() => {
  const nav = document.getElementById('nav');
  const root = document.documentElement;

  /* nav: solid once scrolled, same 12px threshold as the landing page */
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', scrollY > 12);
      const h = document.body.scrollHeight - innerHeight;
      root.style.setProperty('--sp', (h > 0 ? scrollY / h : 0).toFixed(4));
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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

  document.body.classList.add('ready');
})();
