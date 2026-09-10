import { observeVisible, onFrame, clamp } from './frames';
import type { DeviceProfile } from './tier';

// Cinematic orbital gallery — full-bleed stage, responsive radius, soft edge
// fade overlays (no mask → true 3D preserved), back-face culling, inertia +
// snap, resume-delay autoplay and a rotation progress hairline.
//
// Drag paints are SCHEDULED onto the shared frame (priority 10, after the
// scroll driver) — never synchronous inside pointermove — so horizontal card
// writes batch with, and never interleave, vertical scroll reads.
export function createGallery(stage: HTMLElement, profile: DeviceProfile, chime: (frequency: number, level?: number) => void) {
  const cards = Array.from(stage.querySelectorAll<HTMLElement>('.orb-card'));
  const controls = stage.nextElementSibling!;
  const dots = Array.from(controls.querySelectorAll<HTMLButtonElement>('.orb-dot'));
  const previous = controls.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = controls.querySelector<HTMLButtonElement>('[data-next]')!;
  const progressFill = controls.querySelector<HTMLElement>('.orb-progress i');
  if (!cards.length) return () => {};

  // Radius follows the *stage* width (full-bleed) minus card half-width, so
  // the front card always fits and side cards peek symmetrically.
  const cardHalf = () => (cards[0]?.offsetWidth || 312) / 2;
  let stageHalf = 600;
  const measure = () => {
    const w = Math.max(stage.clientWidth, 320);
    stageHalf = w / 2;
    const room = w / 2 - cardHalf() - 28;
    const want = w < 640 ? 178 : w * 0.3;
    radius = clamp(Math.min(want, Math.max(room, 120)), 120, 380);
  };
  let radius = 300;
  measure();

  let rotation = 0;
  let target: number | null = null;
  let velocity = 0.055;
  let visible = false;
  let dragging = false;
  let paused = false;
  let resumeAt = 0;
  let touched = false;
  let lastX = 0;
  let lastT = 0;
  let originX = 0;
  let originY = 0;
  let active = -1;
  let stop: (() => void) | null = null;
  let resizeTimer = 0;
  let dofTimer = 0;
  let scrubbing = false;
  const step = 360 / cards.length;
  const animate = !profile.reduced;
  const useBlur = !profile.reduced && profile.tier === 2 && profile.hover;

  const tx = new Array<string>(cards.length).fill('');
  const op = new Array<string>(cards.length).fill('');
  const vis = new Array<boolean>(cards.length).fill(true);
  let lastProgress = -1;

  function paint(time: number) {
    const current = ((Math.round(-rotation / step) % cards.length) + cards.length) % cards.length;
    const bob = Math.sin(time / 900) * 4;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const angle = (i * step + rotation) * Math.PI / 180;
      const sin = Math.sin(angle);
      const z = Math.cos(angle) * radius;
      const depth = (z + radius) / (2 * radius);
      // Cull cards facing fully away — saves paint, kills mirrored-text peeks.
      const show = depth > 0.1;
      if (show !== vis[i]) { vis[i] = show; card.style.visibility = show ? 'visible' : 'hidden'; }
      if (!show) continue;
      const lift = bob * depth;
      const px = sin * radius;
      const t = `translate3d(${px.toFixed(1)}px,${lift.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${(sin * 38).toFixed(1)}deg) scale(${(0.78 + depth * 0.26).toFixed(3)})`;
      if (t !== tx[i]) { tx[i] = t; card.style.transform = t; }
      // Edge dissolve: cards melt into the live background near the stage
      // rim instead of clipping behind solid slabs — theme-matched at any
      // scroll position because nothing is painted over them.
      const edge = 1 - clamp((Math.abs(px) / stageHalf - 0.62) / 0.36, 0, 1);
      const o = ((0.22 + depth * 0.78) * (0.12 + 0.88 * edge)).toFixed(3);
      if (o !== op[i]) { op[i] = o; card.style.opacity = o; }
      // No z-index writes: preserve-3d sorts by real Z depth. Integer z-index
      // quantizes depth (visible pops) and forces stacking recalcs per frame.
    }
    if (progressFill) {
      const p = (((-rotation % 360) + 360) % 360) / 360;
      if (Math.abs(p - lastProgress) > 0.002) {
        lastProgress = p;
        progressFill.style.transform = `scaleX(${p.toFixed(3)})`;
      }
    }
    if (current !== active) {
      active = current;
      for (let i = 0; i < cards.length; i++) {
        const back = ((i - active + cards.length) % cards.length);
        cards[i].classList.toggle('front', i === active);
        cards[i].classList.toggle('is-mid', back === 1 || back === cards.length - 1);
        cards[i].classList.toggle('is-far', back !== 0 && back !== 1 && back !== cards.length - 1);
        cards[i].setAttribute('aria-hidden', String(i !== active));
        cards[i].style.pointerEvents = i === active ? 'auto' : 'none';
      }
      dots.forEach((dot, i) => {
        dot.classList.toggle('on', i === active);
        dot.setAttribute('aria-pressed', String(i === active));
      });
    }
  }

  function frame(time: number, delta: number) {
    if (!visible) { stop = null; return false; }
    const dt = delta / 16.667;
    if (target !== null) {
      rotation += (target - rotation) * (1 - Math.pow(0.78, dt));
      if (Math.abs(target - rotation) < 0.08) { rotation = target; target = null; }
    } else if (!dragging && !paused && animate && time >= resumeAt) {
      rotation += velocity * dt;
      velocity += (0.055 - velocity) * (1 - Math.pow(0.955, dt));
    }
    paint(time);
    if (target === null && (!animate || paused)) { stop = null; return false; }
    if (target === null && !dragging && time < resumeAt) return;
  }

  // Always native display rate: four transform writes are trivial for the
  // CPU, and tier-capped fps visibly judders on 90/120Hz screens.
  function wake() {
    if (stop || !visible) return;
    stop = onFrame(frame, 120, 10);
  }

  function go(direction: number) {
    const base = target ?? Math.round(rotation / step) * step;
    target = base + direction * step;
    velocity = 0;
    resumeAt = performance.now() + 2500;
    if (!animate) { rotation = target; target = null; paint(performance.now()); }
    else wake();
    chime(523 + ((Math.round(-base / step) % cards.length + cards.length) % cards.length) * 66, 0.028);
  }
  const prevClick = () => go(1);
  const nextClick = () => go(-1);
  previous.addEventListener('click', prevClick);
  next.addEventListener('click', nextClick);
  const dotClicks = dots.map((dot, i) => {
    const listener = () => {
      let delta = -i * step - rotation;
      delta = ((delta + 540) % 360) - 180;
      target = rotation + delta;
      resumeAt = performance.now() + 2500;
      if (!animate) { rotation = target; target = null; paint(performance.now()); }
      else wake();
      chime(523 + i * 66, 0.028);
    };
    dot.addEventListener('click', listener);
    return listener;
  });

  function down(event: PointerEvent) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragging = true;
    target = null;
    originX = lastX = event.clientX;
    originY = event.clientY;
    lastT = performance.now();
    velocity = 0;
    if (!touched) { touched = true; stage.classList.add('touched'); }
  }

  function move(event: PointerEvent) {
    if (!dragging) return;
    if (event.pointerType === 'touch' && Math.abs(event.clientY - originY) > Math.abs(event.clientX - originX) + 8) {
      up();
      return;
    }
    const now = performance.now();
    const dt = Math.max(now - lastT, 1);
    const delta = event.clientX - lastX;
    lastX = event.clientX;
    lastT = now;
    rotation += delta * 0.3;
    // Flick velocity in deg/frame for buttery inertia release.
    velocity = clamp((delta * 0.3 * 16.667) / dt, -3, 3);
    if (Math.abs(event.clientX - originX) > 6) {
      try {
        if (!stage.hasPointerCapture(event.pointerId)) stage.setPointerCapture(event.pointerId);
      } catch { /* Capture is best-effort. */ }
      stage.classList.add('grabbing');
    }
    // Scheduled, never synchronous: drag writes batch with scroll reads.
    wake();
    if (useBlur && !scrubbing) {
      scrubbing = true;
      stage.classList.add('scrubbing');
    }
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('grabbing');
    if (!animate) {
      rotation = Math.round(rotation / step) * step;
      paint(performance.now());
    } else if (Math.abs(velocity) > 0.12) {
      // Inertia: glide then settle on nearest card.
      target = Math.round((rotation + velocity * 22) / step) * step;
    } else {
      target = Math.round(rotation / step) * step;
    }
    velocity = 0;
    resumeAt = performance.now() + 2200;
    if (scrubbing) {
      scrubbing = false;
      window.clearTimeout(dofTimer);
      dofTimer = window.setTimeout(() => stage.classList.remove('scrubbing'), 160);
    }
    wake();
  }

  function key(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    go(event.key === 'ArrowLeft' ? 1 : -1);
  }

  // Touch pointers fire enter/leave around taps — only hover pointers pause.
  function enter(event: PointerEvent) { if (event.pointerType !== 'touch') paused = true; }
  function leave() { paused = false; up(); resumeAt = performance.now() + 1200; wake(); }
  function focusIn() { paused = true; }
  function focusOut(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && (stage.contains(event.relatedTarget) || controls.contains(event.relatedTarget))) return;
    paused = false;
    resumeAt = performance.now() + 1200;
    wake();
  }
  function resize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measure();
      paint(performance.now());
    }, 120);
  }
  // Fonts/layout shifts change card width — re-measure once settled.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => { measure(); paint(performance.now()); }).catch(() => {});
  }
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move, { passive: true });
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('lostpointercapture', up);
  stage.addEventListener('pointerenter', enter);
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('keydown', key);
  controls.addEventListener('keydown', key as EventListener);
  stage.addEventListener('focusin', focusIn);
  stage.addEventListener('focusout', focusOut);
  controls.addEventListener('focusin', focusIn);
  controls.addEventListener('focusout', focusOut as EventListener);
  window.addEventListener('resize', resize, { passive: true });
  const unobserve = observeVisible(stage, value => {
    visible = value;
    if (visible) wake();
    else { stop?.(); stop = null; }
  });
  paint(performance.now());

  return () => {
    stop?.();
    unobserve();
    window.clearTimeout(resizeTimer);
    window.clearTimeout(dofTimer);
    previous.removeEventListener('click', prevClick);
    next.removeEventListener('click', nextClick);
    dots.forEach((dot, i) => dot.removeEventListener('click', dotClicks[i]));
    stage.removeEventListener('pointerdown', down);
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointercancel', up);
    stage.removeEventListener('lostpointercapture', up);
    stage.removeEventListener('pointerenter', enter);
    stage.removeEventListener('pointerleave', leave);
    stage.removeEventListener('keydown', key);
    controls.removeEventListener('keydown', key as EventListener);
    stage.removeEventListener('focusin', focusIn);
    stage.removeEventListener('focusout', focusOut);
    controls.removeEventListener('focusin', focusIn);
    controls.removeEventListener('focusout', focusOut as EventListener);
    window.removeEventListener('resize', resize);
  };
}
