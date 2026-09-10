import Lenis from 'lenis';
import { onFrame } from './frames';
import type { DeviceProfile } from './tier';

export interface SmoothHandle {
  scrollTo(target: string | number | HTMLElement, offset?: number): void;
  stop(): void;
  start(): void;
  onScroll(fn: (y: number, velocity: number) => void): () => void;
  destroy(): void;
  readonly native: boolean;
}

// Buttery inertial scrolling a la award sites. Falls back to native smooth
// scroll when reduced-motion is on or Lenis fails to boot. Pure-touch
// devices (no fine pointer) stay native too: mobile browsers already scroll
// on the compositor thread, and a second JS smoothing layer only adds input
// lag, battery drain and a permanent 60fps rAF loop. Hybrids keep Lenis.
export function initSmooth(profile: DeviceProfile): SmoothHandle {
  const listeners = new Set<(y: number, velocity: number) => void>();
  const emit = (y: number, v: number) => listeners.forEach(fn => fn(y, v));

  if (profile.reduced || (profile.coarse && !profile.hover)) {
    let lastY = scrollY;
    const onNative = () => {
      const y = scrollY;
      emit(y, y - lastY);
      lastY = y;
    };
    window.addEventListener('scroll', onNative, { passive: true });
    return {
      native: true,
      scrollTo(target) {
        if (typeof target === 'number') window.scrollTo({ top: target, behavior: 'auto' });
        else {
          const el = typeof target === 'string' ? document.querySelector(target) : target;
          (el as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      },
      stop() {}, start() {},
      onScroll(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      destroy() { window.removeEventListener('scroll', onNative); listeners.clear(); },
    };
  }

  let lenis: Lenis | null = null;
  let stopJob: (() => void) | null = null;
  try {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1,
      lerp: 0.11,
    });
    lenis.on('scroll', (e: { scroll: number; velocity: number }) => emit(e.scroll, e.velocity));
    // Priority -10 at native rate: the scroll driver runs before every
    // painter, every display frame — no 60fps stepping on 120Hz screens.
    stopJob = onFrame((time) => { lenis?.raf(time); }, 120, -10);
  } catch {
    lenis = null;
  }

  if (!lenis) {
    let lastY = scrollY;
    const onNative = () => {
      const y = scrollY;
      emit(y, (y - lastY) * 0.5);
      lastY = y;
    };
    window.addEventListener('scroll', onNative, { passive: true });
    return {
      native: true,
      scrollTo(target, offset = 0) {
        if (typeof target === 'number') window.scrollTo({ top: target, behavior: 'smooth' });
        else {
          const el = (typeof target === 'string' ? document.querySelector(target) : target) as HTMLElement | null;
          if (!el) return;
          const top = el.getBoundingClientRect().top + scrollY + offset;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      },
      stop() {}, start() {},
      onScroll(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      destroy() { window.removeEventListener('scroll', onNative); listeners.clear(); },
    };
  }

  const api: SmoothHandle = {
    native: false,
    scrollTo(target, offset = 0) {
      try {
        if (typeof target === 'number') lenis?.scrollTo(target, { duration: 1.4 });
        else lenis?.scrollTo(target as never, { offset, duration: 1.4 });
      } catch {
        const el = (typeof target === 'string' ? document.querySelector(target) : target) as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth' });
      }
    },
    stop() { lenis?.stop(); },
    start() { lenis?.start(); },
    onScroll(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    destroy() {
      stopJob?.();
      stopJob = null;
      listeners.clear();
      try { lenis?.destroy(); } catch { /* noop */ }
      lenis = null;
    },
  };
  return api;
}
