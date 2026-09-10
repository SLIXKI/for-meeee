import { onFrame, clamp, lerp, observeVisible } from './frames';
import type { DeviceProfile } from './tier';
import type { SmoothHandle } from './smooth';

const CHAPTER_CARD: Record<string, [string, string, string]> = {
  top: ['I', 'Overture', 'Exhibit I'],
  kit: ['II', 'The Kit', 'Exhibit II'],
  how: ['III', 'The Method', 'Exhibit III'],
  ledger: ['IV', 'The Ledger', 'Exhibit IV'],
  download: ['V', 'Access', 'Exhibit V'],
  architect: ['VI', 'The Architect', 'Exhibit VI'],
};

/**
 * Single scroll authority: progress bar, nav state, chapter rail, method line,
 * lerped parallax, scroll-velocity styling, back-to-top and chapter cards.
 *
 * Core-architecture rules:
 *  - ZERO layout reads per frame. Element offsets are cached on recalc
 *    (resize/load/fonts); each frame only does math + compositor writes.
 *  - Vertical parallax owns ONLY the independent `translate` property, so it
 *    composes with (never clobbers) reveal `transform`s and orbital 3D.
 *  - Hero fade targets the inner `.artifact`, never the `.rv` wrapper whose
 *    opacity belongs to the reveal system.
 *  - Chapter changes broadcast `asheo:chapter` so the gold aurora can follow.
 */
export function createScrollManager(root: HTMLElement, profile: DeviceProfile, smooth: SmoothHandle) {
  const nav = root.querySelector<HTMLElement>('#nav');
  const progress = root.querySelector<HTMLElement>('.prog');
  const path = root.querySelector<SVGPathElement>('#methodPath');
  const toTop = root.querySelector<HTMLElement>('#toTop');
  const hero = root.querySelector<HTMLElement>('.hero');
  const h1Stage = root.querySelector<HTMLElement>('.h1-stage');
  const heroArt = root.querySelector<HTMLElement>('.hero .artifact-wrap');
  const heroArtifact = root.querySelector<HTMLElement>('.hero .artifact-wrap .artifact');
  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-rail]'));
  const parallaxEls = Array.from(root.querySelectorAll<HTMLElement>('[data-speed]'));
  const skewEls = Array.from(root.querySelectorAll<HTMLElement>('.ring-band'));
  const navInd = root.querySelector<HTMLElement>('#navInd');
  const navLinks = root.querySelector<HTMLElement>('#navLinks');
  const card = root.querySelector<HTMLElement>('#chapterCard');
  const cardNum = card?.querySelector<HTMLElement>('.cc-num') ?? null;
  const cardName = card?.querySelector<HTMLElement>('.cc-name') ?? null;
  const cardSub = card?.querySelector<HTMLElement>('.cc-sub') ?? null;

  let pathLength = 1200;
  if (path) {
    try { pathLength = path.getTotalLength() || 1200; } catch { /* Hidden SVG in some browsers. */ }
    path.style.strokeDasharray = String(pathLength);
    path.style.strokeDashoffset = profile.reduced ? '0' : String(pathLength);
  }

  let max = 1;
  let y = scrollY;
  let vel = 0;
  let smoothVel = 0;
  let smoothY = scrollY;
  let methodVisible = false;
  let heroVisible = true;
  let heroBottom = innerHeight;
  let methodDocTop = 0;
  let spots: Array<{ el: HTMLElement; speed: number; top: number; h: number }> = [];
  let paint: (() => void) | null = null;
  let loop: (() => void) | null = null;
  let resizeTimer = 0;
  let activeChapter = '';
  let lastVelVar = '';
  let lastRingP = -1;
  let lastProg = '';
  let lastCardAt = 0;
  let cardPending: string | null = null;
  let cardTimer = 0;
  let chapterTops: Array<{ id: string; top: number }> = [];
  const parallax = !profile.reduced;

  function setChapter(id: string) {
    if (id === activeChapter) return;
    activeChapter = id;
    for (const link of links) link.classList.toggle('on', link.dataset.rail === id);
    window.dispatchEvent(new CustomEvent('asheo:chapter', { detail: id }));
    // Nav indicator follows the journey — unless the visitor is using the nav.
    if (navInd && navLinks && !navLinks.matches(':hover, :focus-within')) {
      const link = navLinks.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`);
      if (link) {
        navInd.style.opacity = '1';
        navInd.style.width = `${link.offsetWidth}px`;
        navInd.style.transform = `translateX(${link.offsetLeft}px)`;
      } else {
        navInd.style.opacity = '0';
      }
    }
    // Cinematic chapter card — fires only after the chapter HOLDS 350ms.
    // Boundary flapping during continuous scroll used to strobe it; the
    // dwell guarantees one clean card per deliberate arrival.
    window.clearTimeout(cardTimer);
    cardPending = id;
    if (card && cardNum && cardName && !profile.reduced && !document.hidden && y > 40) {
      const pending = id;
      cardTimer = window.setTimeout(() => {
        if (cardPending !== pending || activeChapter !== pending) return;
        if (performance.now() - lastCardAt <= 2200) return;
        fireCard(pending);
      }, 350);
    }
  }

  function fireCard(id: string) {
    if (!card || !cardNum || !cardName || document.hidden) return;
    {
      const meta = CHAPTER_CARD[id];
      if (meta) {
        lastCardAt = performance.now();
        cardNum.textContent = meta[0];
        cardName.textContent = meta[1];
        if (cardSub) cardSub.textContent = meta[2];
        try {
          card.getAnimations({ subtree: true }).forEach(a => { try { a.cancel(); } catch { /* noop */ } });
        } catch { /* noop */ }
        card.style.visibility = 'visible';
        try {
          const anims: Animation[] = [];
          card.querySelectorAll<HTMLElement>('.cc-bar').forEach(bar => {
            anims.push(bar.animate(
              [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)', offset: 0.2 }, { transform: 'scaleY(1)', offset: 0.7 }, { transform: 'scaleY(0)' }],
              { duration: 1900, easing: 'cubic-bezier(.65,0,.35,1)' },
            ));
          });
          const mid = card.querySelector<HTMLElement>('.cc-mid');
          if (mid) {
            const keys: Keyframe[] = profile.tier === 2
              ? [{ opacity: 0, transform: 'translateY(30px)', filter: 'blur(10px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)', offset: 0.28 }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)', offset: 0.68 }, { opacity: 0, transform: 'translateY(-20px)', filter: 'blur(8px)' }]
              : [{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'translateY(0)', offset: 0.28 }, { opacity: 1, transform: 'translateY(0)', offset: 0.68 }, { opacity: 0, transform: 'translateY(-22px)' }];
            anims.push(mid.animate(keys, { duration: 1900, easing: 'cubic-bezier(.22,1,.36,1)' }));
          }
          const rule = card.querySelector<HTMLElement>('.cc-rule');
          if (rule) {
            anims.push(rule.animate(
              [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.3 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.68 }, { transform: 'scaleX(1)', opacity: 0 }],
              { duration: 1900, easing: 'cubic-bezier(.22,1,.36,1)' },
            ));
          }
          const stamp = lastCardAt;
          const tail = anims[anims.length - 1];
          if (tail) {
            tail.onfinish = () => { if (lastCardAt === stamp) card.style.visibility = 'hidden'; };
            tail.oncancel = () => {};
          } else {
            card.style.visibility = 'hidden';
          }
        } catch {
          window.setTimeout(() => { card.style.visibility = 'hidden'; }, 1950);
        }
      }
    }
  }

  function frame(_time: number, delta: number) {
    const k = 1 - Math.pow(0.12, delta / 16.667);
    smoothY = lerp(smoothY, y, k);
    smoothVel = lerp(smoothVel, vel, 1 - Math.pow(0.08, delta / 16.667));
    vel *= Math.pow(0.9, delta / 16.667);
    const vh = innerHeight;

    if (nav) nav.classList.toggle('scrolled', y > 12);
    if (progress) {
      const px = Math.min(1, y / max).toFixed(4);
      if (px !== lastProg) { lastProg = px; progress.style.transform = `scaleX(${px})`; }
    }
    if (toTop) {
      toTop.classList.toggle('show', y > vh * 1.4);
      const p = Math.min(1, y / max);
      if (Math.abs(p - lastRingP) > 0.02) {
        lastRingP = p;
        toTop.style.setProperty('--p', p.toFixed(3));
      }
    }

    // Scroll velocity drives ring skew — the "alive" feeling.
    const v = clamp(smoothVel * 0.35, -14, 14).toFixed(2);
    if (v !== lastVelVar) {
      lastVelVar = v;
      for (const el of skewEls) el.style.setProperty('--vel', v);
    }

    // Position-based chapter trigger (backup to the IntersectionObserver):
    // deterministic from cached offsets, immune to observer quirks — the
    // episode card always fires. setChapter dedupes, so both can coexist.
    if (chapterTops.length) {
      const probe = y + vh * 0.45;
      let current = chapterTops[0].id;
      for (const c of chapterTops) {
        if (c.top <= probe) current = c.id;
        else break;
      }
      if (current !== activeChapter) setChapter(current);
    }

    // Method line from cached document offset — no layout reads.
    if (path && methodVisible) {
      const top = methodDocTop - y;
      const p = clamp((vh * 0.9 - top) / (vh * 0.7), 0, 1);
      path.style.strokeDashoffset = (pathLength * (1 - p)).toFixed(1);
    }

    if (parallax && heroVisible) {
      const t = clamp(smoothY / Math.max(heroBottom, 1), 0, 1);
      // Independent `translate`: composes with reveal transforms, never fights.
      if (h1Stage) h1Stage.style.translate = t > 0 ? `0 ${(t * 90).toFixed(1)}px` : '';
      if (heroArt && heroArt.classList.contains('in')) {
        heroArt.style.translate = t > 0 ? `0 ${(t * -60).toFixed(1)}px` : '';
        if (heroArtifact) heroArtifact.style.opacity = t > 0.82 ? String(Math.max(0.05, 1 - (t - 0.82) * 5)) : '';
      }
    }

    if (parallax) {
      for (const s of spots) {
        if (s.top + s.h < y - 200 || s.top > y + vh + 200) continue;
        const center = ((s.top + s.h / 2) - (y + vh / 2)) / vh;
        s.el.style.translate = `0 ${(-center * s.speed * 120).toFixed(1)}px`;
      }
    }
  }

  // Single wake path: reduced-motion paints synchronously once per event,
  // otherwise one continuous loop runs until every lerped value settles.
  // Native display rate: the writes are pure compositor math, and 60fps
  // lerps visibly step on 90/120Hz screens.
  function wake() {
    if (profile.reduced) {
      if (paint) return;
      paint = onFrame((t, d) => { paint = null; frame(t, d); return false; }, 120, 5);
      return;
    }
    if (loop) return;
    loop = onFrame((t, d) => {
      frame(t, d);
      if (Math.abs(smoothY - y) < 0.4 && Math.abs(smoothVel) < 0.08 && Math.abs(vel) < 0.08) {
        loop = null;
        return false;
      }
    }, 120, 5);
  }

  function recalc() {
    max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const sy = scrollY;
    if (hero) {
      const hr = hero.getBoundingClientRect();
      heroBottom = hr.height > 0 ? hr.top + sy + hr.height : innerHeight;
    }
    if (path?.ownerSVGElement) methodDocTop = path.ownerSVGElement.getBoundingClientRect().top + sy;
    spots = [];
    for (const el of parallaxEls) {
      const speed = parseFloat(el.dataset.speed || '0');
      if (!speed) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0) spots.push({ el, speed, top: r.top + sy, h: r.height });
    }
    chapterTops = [];
    for (const el of chapters) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) chapterTops.push({ id: el.dataset.chapter || 'top', top: r.top + sy });
    }
    chapterTops.sort((a, b) => a.top - b.top);
    wake();
  }

  const offSmooth = smooth.onScroll((yy, v) => { y = yy; vel = clamp(v, -60, 60); wake(); });
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(recalc, 150);
    wake();
  };
  const onLoad = () => recalc();

  let chapterIO: IntersectionObserver | null = null;
  if ('IntersectionObserver' in window) {
    chapterIO = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) setChapter((entry.target as HTMLElement).dataset.chapter || 'top');
      }
    }, { rootMargin: '-38% 0px -52% 0px', threshold: 0 });
    chapters.forEach(c => chapterIO!.observe(c));
  } else {
    setChapter('top');
  }

  const cleanups: Array<() => void> = [];
  if (path?.ownerSVGElement) {
    cleanups.push(observeVisible(path.ownerSVGElement, v => { methodVisible = v; if (v) wake(); }, '120px'));
  }
  if (hero) {
    cleanups.push(observeVisible(hero, v => {
      heroVisible = v;
      if (!v) {
        if (h1Stage) h1Stage.style.translate = '';
        if (heroArt) heroArt.style.translate = '';
        if (heroArtifact) heroArtifact.style.opacity = '';
      }
    }));
  }

  recalc();
  frame(0, 16.667);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('load', onLoad);
  window.addEventListener('orientationchange', onResize);
  // Layout shifts (FAQ accordions, font swaps, late images) move cached
  // offsets — re-measure when the document shell resizes.
  let shellRO: ResizeObserver | null = null;
  const shell = root.querySelector('.skewer');
  if (shell && typeof ResizeObserver !== 'undefined') {
    let lastH = 0;
    shellRO = new ResizeObserver(() => {
      const h = (shell as HTMLElement).offsetHeight;
      if (Math.abs(h - lastH) > 40) { lastH = h; recalc(); }
    });
    shellRO.observe(shell);
    lastH = (shell as HTMLElement).offsetHeight;
  }
  if (document.fonts?.ready) document.fonts.ready.then(() => recalc()).catch(() => {});

  return () => {
    paint?.();
    paint = null;
    loop?.();
    loop = null;
    offSmooth();
    card?.classList.remove('show');
    window.clearTimeout(resizeTimer);
    window.clearTimeout(cardTimer);
    cardPending = null;
    shellRO?.disconnect();
    shellRO = null;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    window.removeEventListener('load', onLoad);
    chapterIO?.disconnect();
    cleanups.forEach(fn => fn());
    if (h1Stage) h1Stage.style.translate = '';
    if (heroArt) heroArt.style.translate = '';
    if (heroArtifact) heroArtifact.style.opacity = '';
    for (const s of spots) s.el.style.translate = '';
  };
}
