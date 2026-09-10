import { observeVisible, onFrame, clamp, damp } from './frames';
import type { DeviceProfile } from './tier';
import type { SmoothHandle } from './smooth';

/**
 * Seamless infinite marquee, driven by ONE writer at native display rate.
 *
 * Rules that keep it glitch-free:
 *  - ONE transform per frame (translate + lean in the same string), wrapped
 *    modulo half-width. The wrap point is exact at any lean angle, and no
 *    other system touches the track (scroll skew + wonders nudge were
 *    removed) — the seam can never jump.
 *  - Vertical scroll only ADDS forward energy (never reverses: reversals
 *    read as glitches) and leans the river; both decay smoothly.
 *  - Hover/focus eases the whole drive (base + push + lean) to a stop, and
 *    the loop sleeps until the next event — zero cost when settled.
 *  - The loop runs only while visible, at native refresh rate, and never
 *    under reduced-motion (the row becomes a static swipe strip).
 */
export function createMarquee(root: HTMLElement, profile: DeviceProfile, smooth: SmoothHandle) {
  const track = root.querySelector<HTMLElement>('.marquee-track');
  const marquee = root.querySelector<HTMLElement>('.marquee');
  if (!track || !marquee || profile.reduced) return () => {};

  const BASE = profile.tier === 0 ? 26 : 42; // px per second
  let half = 1;
  let x = 0;
  let vel = 0;
  let lean = 0;
  let speed = 1;
  let speedTarget = 1;
  let visible = false;
  let stop: (() => void) | null = null;
  let resizeTimer = 0;
  let lastT = '';

  function measure() {
    // Track holds two identical groups: half its scrollWidth is one loop.
    const next = Math.max(track!.scrollWidth / 2, 1);
    if (Math.abs(next - half) > 1) {
      // Preserve loop phase across re-measures so resizes never jump.
      const phase = half > 1 ? ((-x % half) + half) % half / half : 0;
      half = next;
      x = -phase * half;
    }
  }

  function frame(_time: number, delta: number) {
    if (!visible) { stop = null; return false; }
    const dt = Math.min(delta, 64) / 1000;
    speed += (speedTarget - speed) * damp(0.12, delta);
    if (Math.abs(speed - speedTarget) < 0.004) speed = speedTarget;
    vel *= Math.pow(0.88, dt * 60);
    if (Math.abs(vel) < 0.02) vel = 0;
    // Forward-only energy: vertical scroll pushes the river faster but can
    // never stall or reverse it. Lean keeps the sign for directional feel.
    const push = Math.min(Math.abs(vel) * 2.2, 64);
    lean += (clamp(vel * 0.045, -4.5, 4.5) * speed - lean) * damp(0.2, delta);
    if (Math.abs(lean) < 0.01 && vel === 0) lean = 0;
    const drive = (BASE + push) * speed;
    x -= drive * dt;
    // Wrap into (-half, 0]. x === -half renders identically to 0 (the two
    // halves are clones), so the wrap is invisible by construction.
    if (half > 1 && drive !== 0) {
      x = (x % half + half) % half;
      if (x > 0) x -= half;
    }
    const next = `translate3d(${x.toFixed(1)}px,0,0)` +
      (Math.abs(lean) > 0.05 ? ` skewX(${lean.toFixed(2)}deg)` : '');
    if (next !== lastT) { lastT = next; track!.style.transform = next; }
    // Sleep when fully settled; any event below re-wakes the loop.
    if (speed === 0 && vel === 0 && lean === 0) { stop = null; return false; }
  }

  function wake() {
    if (!stop && visible) stop = onFrame(frame, 120, 12);
  }

  const offSmooth = smooth.onScroll((_y, v) => {
    vel = clamp(vel * 0.55 + v * 0.45, -60, 60);
    wake();
  });
  const pause = () => { speedTarget = 0; wake(); };
  const play = () => { speedTarget = 1; wake(); };
  marquee.addEventListener('pointerenter', pause);
  marquee.addEventListener('pointerleave', play);
  marquee.addEventListener('focusin', pause);
  marquee.addEventListener('focusout', play);

  function resize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(measure, 140);
  }
  window.addEventListener('resize', resize, { passive: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(measure).catch(() => {});
  }
  const unobserve = observeVisible(marquee, value => {
    visible = value;
    if (visible) { measure(); wake(); }
    else { stop?.(); stop = null; }
  }, '80px');
  measure();

  return () => {
    stop?.();
    stop = null;
    offSmooth();
    window.clearTimeout(resizeTimer);
    window.removeEventListener('resize', resize);
    unobserve();
    marquee.removeEventListener('pointerenter', pause);
    marquee.removeEventListener('pointerleave', play);
    marquee.removeEventListener('focusin', pause);
    marquee.removeEventListener('focusout', play);
    if (track) track.style.transform = '';
  };
}
