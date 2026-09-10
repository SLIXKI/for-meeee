/* ─── ASHEO MOTION CORE ───
 * One rAF loop drives every continuous animation, in deterministic priority
 * order (drivers first, painters last). Jobs are snapshotted before each tick
 * so subscribe/unsubscribe mid-frame can never skip or double-run a system.
 *
 * AXIS OWNERSHIP (the rule that ends scroll-vs-carousel wars):
 *  - Entrance/reveal owns `transform + opacity + filter` on `.rv` elements.
 *  - Vertical scroll owns ONLY the independent `translate` property
 *    (composes with `transform`, never overwrites it) + CSS vars.
 *  - Horizontal/orbital systems own `transform` on their own cards.
 *  - Pointer tilt owns `transform` on its own targets; ambient float uses
 *    the independent `translate` property so both compose.
 * No two systems ever write the same property on the same element.
 */
type Frame = (time: number, delta: number) => boolean | void;
type Job = { draw: Frame; interval: number; last: number; pri: number };

const jobs = new Set<Job>();
let raf = 0;
let listening = false;
let suspended = false;
let lastTick = 0;

// ── FPS monitor + dynamic quality scaler (like big studios do) ──
// Measures TRUE inter-tick delta; sustained jank steps the global quality
// scale down (shaders/particles read it). Motion never stops, pixels just
// get cheaper until the device breathes again.
let emaDelta = 16.667;
let framesSinceCheck = 0;
let goodStreak = 0;
let qualityScale = 1;
const qualitySubs = new Set<(scale: number) => void>();

function noteFrame(delta: number) {
  if (!(delta > 0) || delta > 250) return;
  emaDelta += (Math.min(delta, 100) - emaDelta) * 0.06;
  framesSinceCheck++;
  if (framesSinceCheck < 90) return;
  framesSinceCheck = 0;
  const fps = 1000 / Math.max(emaDelta, 1);
  if (fps < 42 && qualityScale > 0.55) {
    qualityScale = Math.max(0.55, qualityScale - 0.2);
    goodStreak = 0;
    qualitySubs.forEach(fn => { try { fn(qualityScale); } catch { /* noop */ } });
  } else if (fps > 57 && qualityScale < 1) {
    goodStreak++;
    if (goodStreak >= 4) {
      goodStreak = 0;
      qualityScale = Math.min(1, qualityScale + 0.15);
      qualitySubs.forEach(fn => { try { fn(qualityScale); } catch { /* noop */ } });
    }
  } else {
    goodStreak = 0;
  }
}

export function getQualityScale() { return qualityScale; }
export function onQualityScale(fn: (scale: number) => void) {
  qualitySubs.add(fn);
  return () => { qualitySubs.delete(fn); };
}

function pause() {
  suspended = true;
  cancelAnimationFrame(raf);
  raf = 0;
}

function resume() {
  suspended = false;
  emaDelta = 16.667;
  lastTick = 0;
  for (const job of jobs) job.last = 0;
  schedule();
}

function visibility() {
  if (document.hidden) pause();
  else resume();
}

function detach() {
  if (jobs.size || !listening) return;
  cancelAnimationFrame(raf);
  raf = 0;
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('pagehide', pause);
  window.removeEventListener('pageshow', resume);
  listening = false;
}

let orderCache: Job[] = [];
let orderDirty = true;

function tick(time: number) {
  raf = 0;
  if (lastTick) noteFrame(time - lastTick);
  lastTick = time;
  // Snapshot + priority: drivers (negative pri) paint before painters, and
  // jobs added/removed mid-tick can't corrupt this frame. The sorted order is
  // cached — rebuilt only when the job set changes, not 60×/second.
  if (orderDirty) {
    orderCache = [...jobs].sort((a, b) => a.pri - b.pri);
    orderDirty = false;
  }
  for (const job of orderCache) {
    if (!jobs.has(job)) continue;
    const elapsed = job.last ? time - job.last : job.interval;
    if (elapsed + 0.5 < job.interval) continue;
    job.last = time;
    try {
      if (job.draw(time, Math.min(elapsed, 64)) === false) jobs.delete(job);
    } catch (error) {
      jobs.delete(job);
      console.warn('ASHEO: stopped an unavailable visual effect.', error);
    }
  }
  detach();
  schedule();
}

function schedule() {
  if (!raf && jobs.size && !document.hidden && !suspended) raf = requestAnimationFrame(tick);
}

// All JS animations share this clock; an empty or hidden page does no frame work.
// `pri` orders jobs within a tick: drivers (scroll engine) run before painters.
export function onFrame(draw: Frame, fps = 60, pri = 0): () => void {
  const job: Job = { draw, interval: 1000 / fps, last: 0, pri };
  jobs.add(job);
  orderDirty = true;
  if (!listening) {
    suspended = document.hidden;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    listening = true;
  }
  schedule();
  return () => { jobs.delete(job); detach(); };
}

export function observeVisible(element: Element, change: (visible: boolean) => void, margin = '0px') {
  if (!('IntersectionObserver' in window)) {
    change(true);
    return () => {};
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) change(entry.isIntersecting);
  }, { rootMargin: margin, threshold: 0 });
  observer.observe(element);
  return () => observer.disconnect();
}

export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent damping factor (0..1). Higher = snappier. */
export const damp = (rate: number, delta: number) => 1 - Math.pow(rate, delta / 16.667);

/** Critically-damped-ish spring step. Returns [value, velocity]. */
export function spring(
  current: number, target: number, velocity: number,
  stiffness: number, damping: number, dt: number,
): [number, number] {
  const dtS = Math.min(dt, 64) / 1000;
  const force = (target - current) * stiffness - velocity * damping;
  velocity += force * dtS;
  current += velocity * dtS;
  return [current, velocity];
}

/** Smoothed scroll/pointer velocity tracker (px per frame, exponentially decayed). */
export function createVelocity(smoothing = 0.12) {
  let last = 0;
  let vel = 0;
  let has = false;
  return {
    push(value: number) {
      if (!has) { last = value; has = true; return 0; }
      const instant = value - last;
      last = value;
      vel += (instant - vel) * smoothing;
      return vel;
    },
    decay(amount = 0.9) { vel *= amount; return vel; },
    get() { return vel; },
    reset() { has = false; vel = 0; },
  };
}

export class Scope {
  private cleanups: Array<() => void> = [];
  private timers = new Set<number>();
  private disposed = false;

  add(cleanup: () => void) { this.cleanups.push(cleanup); }

  after(callback: () => void, delay: number) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) callback();
    }, delay);
    this.timers.add(id);
    return id;
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.cleanups.length = 0;
  }
}
