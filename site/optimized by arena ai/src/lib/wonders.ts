import { Scope, observeVisible, onFrame, clamp, lerp } from './frames';
import type { DeviceProfile } from './tier';
import type { SmoothHandle } from './smooth';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ·—/0123456789';

/**
 * Out-of-the-box life: headline telekinesis, chapter-tinted curtain veils,
 * eyebrow descramble, portrait blinks, idle fireflies, scroll cinema, magnetic
 * rail, click shockwaves and a flippable coin. All standalone observers —
 * zero coupling to other systems, zero shared-property writes.
 */
export function createWonders(root: HTMLElement, profile: DeviceProfile, smooth: SmoothHandle) {
  const scope = new Scope();
  const reduced = profile.reduced;

  // ── 1 · HEADLINE TELEKINESIS ──
  // Hero glyphs lean away from the cursor via the independent `translate`
  // property, so the entrance `transform` is never disturbed. The glyph
  // position cache is invalidated on scroll — stale centers during vertical
  // scroll used to spray offsets at the wrong letters.
  if (profile.hover && !reduced) {
    const chars = Array.from(root.querySelectorAll<HTMLElement>('#h1 .ch'));
    const hero = root.querySelector('.hero');
    let centers: Array<{ x: number; y: number }> = [];
    let lastCache = 0;
    let heroVisible = true;
    let mx = 0, my = 0, queued = false;
    let waveJob: (() => void) | null = null;
    const waved = new Set<HTMLElement>();
    if (hero) scope.add(observeVisible(hero, v => {
      heroVisible = v;
      if (!v) { waved.forEach(el => { el.style.translate = ''; }); waved.clear(); }
    }));
    const apply = () => {
      queued = false;
      if (!heroVisible || !chars.length) return;
      const now = performance.now();
      if (now - lastCache > 200 || !centers.length) {
        centers = chars.map(el => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        lastCache = now;
      }
      const R = 190;
      for (let i = 0; i < chars.length; i++) {
        const c = centers[i];
        const el = chars[i];
        if (!c || !el) continue;
        const d = Math.hypot(mx - c.x, my - c.y);
        if (d < R) {
          const w = -13 * Math.pow(Math.cos((d / R) * Math.PI / 2), 2);
          el.style.translate = `0 ${w.toFixed(1)}px`;
          waved.add(el);
        } else if (waved.has(el)) {
          el.style.translate = '';
          waved.delete(el);
        }
      }
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      mx = event.clientX; my = event.clientY;
      if (queued) return;
      queued = true;
      waveJob = onFrame(() => { waveJob = null; apply(); return false; }, 60, 4);
    };
    const invalidate = () => { lastCache = 0; };
    window.addEventListener('pointermove', pointer, { passive: true });
    const offScroll = smooth.onScroll(invalidate);
    scope.add(() => {
      window.removeEventListener('pointermove', pointer);
      offScroll();
      waveJob?.();
      waved.forEach(el => { el.style.translate = ''; });
      waved.clear();
    });
  }

  // ── 2 · CHAPTER-TINTED VEILS ──
  // Capture phase runs before the experience's bubble handler adds `.in`.
  const curtain = root.querySelector<HTMLElement>('#curtain');
  if (curtain && !reduced) {
    let tintTimer = 0;
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = (anchor.getAttribute('href') || '').slice(1);
      window.clearTimeout(tintTimer);
      if (id === 'ledger' || id === 'architect' || id === 'download') {
        curtain.dataset.tint = id;
        tintTimer = window.setTimeout(() => curtain.removeAttribute('data-tint'), 1400);
      } else {
        curtain.removeAttribute('data-tint');
      }
    };
    document.addEventListener('click', click, true);
    scope.add(() => {
      document.removeEventListener('click', click, true);
      window.clearTimeout(tintTimer);
      curtain.removeAttribute('data-tint');
    });
  }

  // ── 3 · EYEBROW DESCRAMBLE ──
  if (!reduced && 'IntersectionObserver' in window) {
    const scramble = (el: HTMLElement) => {
      if (el.dataset.scrambled) return;
      el.dataset.scrambled = '1';
      const node = Array.from(el.childNodes).find(
        n => n.nodeType === 3 && n.textContent && n.textContent.trim().length > 3,
      ) as Text | undefined;
      if (!node?.textContent) return;
      const final = node.textContent;
      const len = final.length;
      const start = performance.now() + 250;
      const dur = 650;
      const job = onFrame(now => {
        const p = clamp((now - start) / dur, 0, 1);
        const lock = Math.floor(p * len);
        let out = '';
        for (let i = 0; i < len; i++) {
          const ch = final[i];
          out += ch === ' ' || ch === '\n' || i < lock ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        node.textContent = out;
        if (p >= 1) { node.textContent = final; return false; }
      });
      scope.add(job);
    };
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          scramble(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.4 });
    root.querySelectorAll<HTMLElement>('.sec-eyebrow,.ledger-eyebrow,.dev-arch-kicker,.exhibit-txt')
      .forEach(el => io.observe(el));
    scope.add(() => io.disconnect());
  }

  // ── 4 · PORTRAIT BLINKS ──
  const portrait = root.querySelector<HTMLElement>('#dither-dev');
  const arch = root.querySelector('#architect');
  if (portrait && arch && !reduced) {
    let vis = false, hov = false;
    scope.add(observeVisible(arch, v => { vis = v; }));
    const frame = portrait.parentElement;
    const enter = () => { hov = true; };
    const leave = () => { hov = false; };
    frame?.addEventListener('pointerenter', enter);
    frame?.addEventListener('pointerleave', leave);
    scope.add(() => {
      frame?.removeEventListener('pointerenter', enter);
      frame?.removeEventListener('pointerleave', leave);
    });
    const loop = (): void => {
      scope.after(() => {
        if (vis && !hov && !document.hidden) {
          portrait.setAttribute('brightness', '-0.30');
          scope.after(() => portrait.setAttribute('brightness', '-0.01'), 140);
        }
        loop();
      }, 5200 + Math.random() * 4200);
    };
    loop();
  }

  // ── 5 · IDLE FIREFLIES ──
  // Own featherweight canvas; only breathes when the visitor goes quiet.
  if (!reduced) {
    const cap = profile.tier === 0 ? 14 : 26;
    const motes: Array<{ x: number; y: number; vx: number; vy: number; life: number; decay: number; size: number; ph: number }> = [];
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let job: (() => void) | null = null;
    let lastActive = performance.now();
    const heroEl = root.querySelector('.hero');
    const kitEl = root.querySelector('#kit');
    const poke = () => { lastActive = performance.now(); };
    window.addEventListener('pointermove', poke, { passive: true });
    window.addEventListener('pointerdown', poke, { passive: true });
    window.addEventListener('keydown', poke);
    window.addEventListener('wheel', poke, { passive: true });
    const size = () => {
      if (!canvas || !ctx) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ensure = () => {
      if (canvas) return !!ctx;
      canvas = document.createElement('canvas');
      canvas.id = 'motes';
      canvas.setAttribute('aria-hidden', 'true');
      ctx = canvas.getContext('2d');
      if (!ctx) { canvas = null; return false; }
      document.body.appendChild(canvas);
      size();
      window.addEventListener('resize', size, { passive: true });
      return true;
    };
    const draw = (_t: number, delta: number) => {
      if (!ctx) return false;
      const dt = Math.min(2.5, delta / 16.667);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i];
        m.ph += 0.06 * dt;
        m.x += (m.vx + Math.sin(m.ph) * 0.12) * dt;
        m.y += m.vy * dt;
        m.life -= m.decay * dt;
        if (m.life <= 0 || m.y < -20) { motes.splice(i, 1); continue; }
        const tw = 0.5 + 0.5 * Math.sin(m.ph * 2.2);
        ctx.globalAlpha = Math.min(1, m.life * 1.4) * (0.25 + 0.55 * tw);
        ctx.fillStyle = '#EADFC6';
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size, 0, 6.283);
        ctx.fill();
        ctx.globalAlpha *= 0.22;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.size * 3, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!motes.length) {
        job = null;
        if (canvas) canvas.width = canvas.height = 1;
        return false;
      }
    };
    const check = (): void => {
      scope.after(() => {
        const idle = performance.now() - lastActive > 6000;
        const stageVisible = heroEl?.getAttribute('data-visible') === 'true'
          || kitEl?.getAttribute('data-visible') === 'true';
        if (idle && stageVisible && !document.hidden && motes.length < cap && ensure()) {
          if (canvas && canvas.width < 10) size();
          for (let k = 0; k < 2 && motes.length < cap; k++) {
            motes.push({
              x: Math.random() * innerWidth,
              y: innerHeight * (0.7 + Math.random() * 0.25),
              vx: (Math.random() - 0.5) * 0.3,
              vy: -(0.25 + Math.random() * 0.5),
              life: 1, decay: 0.004 + Math.random() * 0.005,
              size: 0.8 + Math.random() * 1.4, ph: Math.random() * 6.28,
            });
          }
          if (!job) job = onFrame(draw, 30, 18);
        }
        check();
      }, 2400);
    };
    check();
    scope.add(() => {
      job?.(); job = null;
      window.removeEventListener('pointermove', poke);
      window.removeEventListener('pointerdown', poke);
      window.removeEventListener('keydown', poke);
      window.removeEventListener('wheel', poke);
      window.removeEventListener('resize', size);
      if (canvas) { canvas.width = canvas.height = 1; canvas.remove(); }
      canvas = ctx = null;
      motes.length = 0;
    });
  }

  // ── 6 · SCROLL CINEMA ──
  // Velocity aura, phase-safe coin + marquee, rail spine, liquid footer fill.
  // NOTE: never transform a 3D ancestor (the old skewer tilt forced the whole
  // page — gallery included — through one giant layer every scroll frame).
  // Velocity now flows through composable properties + WAAPI playbackRate.
  const spine = root.querySelector<HTMLElement>('#railSpineFill');
  const coin = root.querySelector<HTMLElement>('.coin');
  const coinStage = root.querySelector<HTMLElement>('.coin-stage');
  const aura = root.querySelector<HTMLElement>('#scrollGlow');
  const footer = root.querySelector<HTMLElement>('footer');
  const wmFace = root.querySelector<HTMLElement>('.wm-face');
  let vel = 0, sm = 0, flip = 0, loop: (() => void) | null = null;
  let lastRate = 1;
  let lastFill = -1;
  let coinAnim: Animation | null | undefined;
  let frameCount = 0;
  let coinHover = false;
  let footerVisible = false;
  if (footer) scope.add(observeVisible(footer, v => { footerVisible = v; }, '200px'));
  if (coinStage && !reduced) {
    const coinIn = () => { coinHover = true; if (!loop) loop = onFrame(settle, 60, 6); };
    const coinOut = () => { coinHover = false; if (!loop) loop = onFrame(settle, 60, 6); };
    const coinFlip = () => {
      flip = 8;
      if (!loop) loop = onFrame(settle, 60, 6);
    };
    coinStage.addEventListener('pointerenter', coinIn);
    coinStage.addEventListener('pointerleave', coinOut);
    coinStage.addEventListener('click', coinFlip);
    scope.add(() => {
      coinStage.removeEventListener('pointerenter', coinIn);
      coinStage.removeEventListener('pointerleave', coinOut);
      coinStage.removeEventListener('click', coinFlip);
    });
  }

  const settle = (_t: number, delta: number) => {
    const k = 1 - Math.pow(0.1, delta / 16.667);
    sm = lerp(sm, vel, k);
    vel *= Math.pow(0.88, delta / 16.667);
    flip *= Math.pow(0.93, delta / 16.667);
    const a = Math.abs(sm);
    if (aura) aura.style.opacity = a > 0.4 ? Math.min(0.5, a * 0.022).toFixed(3) : '0';
    if (coin && !reduced) {
      // playbackRate keeps phase — animation-duration would jump/restart.
      // The Animation object is cached: getAnimations() forces style recalc.
      const rate = 1 + Math.min(a * 0.14, 2.6) + (coinHover ? 2.4 : 0) + flip;
      if (Math.abs(rate - lastRate) > 0.12) {
        lastRate = rate;
        if (coinAnim === undefined) {
          try { coinAnim = coin.getAnimations()[0] ?? null; } catch { coinAnim = null; }
        }
        try {
          if (coinAnim) coinAnim.playbackRate = rate;
          else coin.style.animationDuration = `${(16 / rate).toFixed(1)}s`;
        } catch { coin.style.animationDuration = `${(16 / rate).toFixed(1)}s`; }
      }
    }
    if (footerVisible && footer && wmFace) {
      // Layout read throttled to every 3rd frame; writes quantized to 2%.
      frameCount++;
      if (frameCount % 3 === 0) {
        const r = footer.getBoundingClientRect();
        const f = clamp((innerHeight * 0.95 - r.top) / (innerHeight * 0.6), 0, 1);
        if (Math.abs(f - lastFill) > 0.02) {
          lastFill = f;
          wmFace.style.setProperty('--fill', `${(f * 100).toFixed(1)}%`);
        }
      }
    }
    if (Math.abs(sm) < 0.05 && Math.abs(vel) < 0.05 && flip < 0.05) {
      if (aura) aura.style.opacity = '0';
      if (coin && lastRate !== 1) {
        lastRate = 1;
        try { for (const anim of coin.getAnimations()) anim.playbackRate = 1; } catch { /* noop */ }
      }
      loop = null;
      return false;
    }
  };
  const offSmooth = smooth.onScroll((y, v) => {
    vel = clamp(v, -60, 60);
    if (spine) {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      spine.style.transform = `scaleY(${(y / max).toFixed(4)})`;
    }
    if (!loop && !reduced) loop = onFrame(settle, 60, 6);
    else if (reduced && footerVisible && footer && wmFace) {
      const r = footer.getBoundingClientRect();
      const f = clamp((innerHeight * 0.95 - r.top) / (innerHeight * 0.6), 0, 1);
      if (Math.abs(f - lastFill) > 0.01) {
        lastFill = f;
        wmFace.style.setProperty('--fill', `${(f * 100).toFixed(1)}%`);
      }
    }
  });
  scope.add(() => {
    offSmooth();
    loop?.(); loop = null;
    if (coin) {
      try { for (const anim of coin.getAnimations()) anim.playbackRate = 1; } catch { /* noop */ }
      coin.style.animationDuration = '';
    }
    if (aura) aura.style.opacity = '0';
  });

  // ── 7 · MAGNETIC RAIL ──
  // Chapter links lean toward the cursor on Y (independent `translate`,
  // so the active underline + layout stay untouched).
  if (profile.hover && !reduced) {
    const railLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('.rail a'));
    if (railLinks.length) {
      let my = -9999, railJob: (() => void) | null = null;
      // The rail is position:fixed — centers never move on scroll, so cache
      // them once (refresh on resize) instead of reading layout per frame.
      let centers: number[] = [];
      const cacheRail = () => {
        centers = railLinks.map(link => {
          const r = link.getBoundingClientRect();
          return r.top + r.height / 2;
        });
      };
      cacheRail();
      const offsets = new Map<HTMLAnchorElement, number>();
      const render = () => {
        railJob = null;
        for (let i = 0; i < railLinks.length; i++) {
          const link = railLinks[i];
          const d = my - (centers[i] ?? -9999);
          const pull = Math.abs(d) < 130 ? d * 0.12 : 0;
          const prev = offsets.get(link) ?? -1;
          const next = Math.abs(pull) < 0.4 ? 0 : pull;
          if (next !== prev) {
            offsets.set(link, next);
            link.style.translate = next ? `0 ${next.toFixed(1)}px` : '';
          }
        }
        return false;
      };
      const move = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return;
        my = event.clientY;
        if (!railJob) railJob = onFrame(render, 60, 4);
      };
      const clear = () => {
        my = -9999;
        if (!railJob) railJob = onFrame(render, 60, 4);
      };
      const onResize = () => cacheRail();
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      document.documentElement.addEventListener('pointerleave', clear);
      scope.add(() => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('resize', onResize);
        document.documentElement.removeEventListener('pointerleave', clear);
        railJob?.(); railJob = null;
        for (const link of railLinks) link.style.translate = '';
        offsets.clear();
      });
    }
  }

  // ── 8 · CLICK SHOCKWAVE ──
  // A gold ring blooms from every click — WAAPI transform/opacity only.
  // Rings self-remove on finish/cancel; dispose sweeps stragglers.
  if (!reduced) {
    let lastShock = 0;
    const shock = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && (event as PointerEvent).detail === 0) return;
      const t = event.target as Element | null;
      if (t?.closest?.('input,textarea,select,[contenteditable="true"],dialog,.palette')) return;
      const now = performance.now();
      if (now - lastShock < 140) return;
      lastShock = now;
      const ring = document.createElement('span');
      ring.className = 'shock';
      ring.setAttribute('aria-hidden', 'true');
      ring.style.left = `${event.clientX}px`;
      ring.style.top = `${event.clientY}px`;
      document.body.appendChild(ring);
      try {
        const anim = ring.animate(
          [
            { transform: 'translate(-50%,-50%) scale(0.15)', opacity: 0.85 },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
          ],
          { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
        anim.onfinish = () => ring.remove();
        anim.oncancel = () => ring.remove();
      } catch {
        window.setTimeout(() => ring.remove(), 700);
      }
    };
    window.addEventListener('pointerdown', shock, { passive: true });
    scope.add(() => {
      window.removeEventListener('pointerdown', shock);
      document.querySelectorAll('.shock').forEach(el => el.remove());
    });
  }

  return () => scope.dispose();
}
