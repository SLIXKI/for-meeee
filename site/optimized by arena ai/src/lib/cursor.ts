import { onFrame, clamp, spring } from './frames';
import type { DeviceProfile } from './tier';

interface Trail {
  trail(x: number, y: number, dx: number, dy: number): void;
}

/**
 * Offbrand-style cursor: instant dot, spring-physics ring with velocity
 * stretch, blend-mode lens (zero backdrop-filter cost). Runs on every
 * fine-pointer device — never gated by tier.
 */
export function createCursor(root: HTMLElement, profile: DeviceProfile, particles: Trail) {
  if (!profile.hover || profile.reduced) return () => {};
  const cursor = document.createElement('div');
  cursor.className = 'cur';
  cursor.id = 'cur';
  const ring = document.createElement('div');
  ring.className = 'cur-ring';
  ring.id = 'curRing';
  cursor.setAttribute('aria-hidden', 'true');
  ring.setAttribute('aria-hidden', 'true');
  document.body.append(cursor, ring);

  const spot = root.querySelector<HTMLElement>('.spot');
  const headline = root.querySelector<HTMLElement>('#h1');
  const headlineScene = headline?.closest('.scene');
  const wordmark = root.querySelector<HTMLElement>('#wm');
  const wordmarkScene = wordmark?.closest('.scene');
  const leaf = root.querySelector<HTMLElement>('#goldLeaf');
  const ledger = root.querySelector<HTMLElement>('#ledger');
  const portrait = root.querySelector<HTMLElement>('#dither-dev');
  const portraitFrame = portrait?.parentElement ?? null;

  let x = innerWidth / 2;
  let y = innerHeight / 2;
  let rx = x, ry = y, vx = 0, vy = 0;
  let px = x, py = y;
  let sampled = false;
  let pressed = false;
  let shown = false;
  let job: (() => void) | null = null;
  let target: Element | null = null;
  let lastPortrait = 0;
  let lastD = -1;
  let ringState = '';
  let ledgerRect: DOMRect | null = null;
  let ledgerCacheAt = 0;
  // Cached style strings: identical values skip DOM writes entirely, so a
  // settled cursor costs zero style recalc (the #1 cursor-frame cost).
  let lastDot = '', lastRingT = '', lastSpotT = '', lastHead = '', lastWord = '';
  let sAng = 0, sStr = 1;
  // State scale is owned AND eased in JS (never CSS `scale` transitions):
  // a single transform string means hover morphs can't fight the spring.
  let zoneScale = 1, curScale = 1;
  const allowLens = profile.tier === 2;

  function wake() {
    if (!job) job = onFrame(frame, 120);
  }

  function frame(_time: number, delta: number) {
    // Springy trailing ring — the signature buttery feel.
    const s1 = spring(rx, x, vx, 180, 22, delta);
    rx = s1[0]; vx = s1[1];
    const s2 = spring(ry, y, vy, 180, 22, delta);
    ry = s2[0]; vy = s2[1];
    const speed = Math.min(Math.hypot(vx, vy) / 1600, 1);
    // Stable orientation: freeze direction at low speed (atan2 noise jitters
    // near zero) and ease stretch toward identity — no threshold popping, ever.
    if (speed > 0.06) {
      let d = Math.atan2(vy, vx) - sAng;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      sAng += d * Math.min(1, delta / 90);
    }
    sStr += ((1 + speed * 0.35) - sStr) * Math.min(1, delta / 90);
    curScale += (zoneScale - curScale) * Math.min(1, delta / 110);
    if (Math.abs(curScale - zoneScale) < 0.002) curScale = zoneScale;
    const sInv = 1 / Math.sqrt(Math.max(sStr, 0.001));
    const dotT = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;
    if (dotT !== lastDot) { lastDot = dotT; cursor.style.transform = dotT; }
    const ringT = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0) translate(-50%,-50%) rotate(${sAng.toFixed(3)}rad) scale(${(sStr * curScale).toFixed(3)},${(sInv * curScale).toFixed(3)})`;
    if (ringT !== lastRingT) { lastRingT = ringT; ring.style.transform = ringT; }
    if (sampled) {
      sampled = false;
      if (!shown) { shown = true; cursor.style.opacity = '1'; ring.style.opacity = '1'; }
      if (spot) {
        const spotT = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
        if (spotT !== lastSpotT) { lastSpotT = spotT; spot.style.transform = spotT; }
      }
      const nx = x / innerWidth - 0.5;
      const ny = y / innerHeight - 0.5;
      if (headline && headlineScene?.getAttribute('data-visible') === 'true') {
        const headT = `rotateY(${(nx * 10).toFixed(2)}deg) rotateX(${(-ny * 7).toFixed(2)}deg) translateZ(34px)`;
        if (headT !== lastHead) { lastHead = headT; headline.style.transform = headT; }
      }
      if (wordmark && wordmarkScene?.getAttribute('data-visible') === 'true') {
        const wordT = `rotateY(${(nx * 14).toFixed(2)}deg) rotateX(${(-ny * 7).toFixed(2)}deg)`;
        if (wordT !== lastWord) { lastWord = wordT; wordmark.style.transform = wordT; }
      }
      if (Math.hypot(x - px, y - py) > 7) {
        particles.trail(x, y, x - px, y - py);
        px = x;
        py = y;
      }
      if (target && ledger && leaf && ledger.contains(target)) {
        const now = performance.now();
        if (now - ledgerCacheAt > 350 || !ledgerRect) {
          ledgerRect = ledger.getBoundingClientRect();
          ledgerCacheAt = now;
        }
        leaf.style.transform = `translate3d(${(x - ledgerRect.left).toFixed(1)}px,${(y - ledgerRect.top).toFixed(1)}px,0)`;
      }
      if (portrait && target?.closest('.dev-ash-right')) {
        const now = performance.now();
        if (now - lastPortrait > 110) {
          const rect = portrait.getBoundingClientRect();
          if (rect.width > 0) {
            const d = Math.hypot((x - rect.left) / rect.width - 0.5, (y - rect.top) / rect.height - 0.5);
            if (Math.abs(d - lastD) > 0.04) {
              lastD = d;
              lastPortrait = now;
              portrait.setAttribute('pixel-size', clamp(2 - (0.55 - d) * 0.55, 1.6, 2.6).toFixed(2));
              portrait.setAttribute('contrast', (1.24 + (0.5 - d) * 0.12).toFixed(2));
              portrait.setAttribute('brightness', ((0.5 - d) * 0.04).toFixed(3));
              portrait.setAttribute('light', d < 0.32 ? '#fff4d6' : '#f5f2eb');
            }
          }
        }
      }
      let zone = target?.closest('.dev-ash-right,.coin-stage,.wm-stage')
        ? ' lens'
        : target?.closest('.orb-stage,.artifact')
          ? ' drag'
          : target?.closest('a,button,summary,[data-mag]')
            ? ' big'
            : '';
      // Difference-blend lens only on tier-2 desktops; elsewhere it degrades
      // to a big ring (same affordance, none of the fullscreen blend cost).
      if (zone === ' lens' && !allowLens) {
        zone = target?.closest('a,button,summary,[data-mag]') ? ' big' : '';
      }
      const next = `cur-ring${zone}${pressed ? ' press' : ''}`;
      if (next !== ringState) { ringState = next; ring.className = next; }
      const want = (zone === ' lens' ? 3.4 : zone === ' drag' ? 2.35 : zone === ' big' ? 1.9 : 1) * (pressed ? 0.82 : 1);
      if (want !== zoneScale) { zoneScale = want; wake(); }
    }
    if (!sampled && Math.abs(rx - x) + Math.abs(ry - y) < 0.15 && Math.abs(vx) + Math.abs(vy) < 4 && Math.abs(curScale - zoneScale) < 0.005) {
      job = null;
      return false;
    }
  }

  const pointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    x = event.clientX;
    y = event.clientY;
    target = event.target as Element | null;
    if (!shown) { rx = x; ry = y; px = x; py = y; vx = vy = 0; }
    sampled = true;
    wake();
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pressed = true;
    sampled = true;
    wake();
  };
  const up = () => {
    if (!pressed) return;
    pressed = false;
    sampled = true;
    wake();
  };
  const hide = () => {
    shown = false;
    cursor.style.opacity = '0';
    ring.style.opacity = '0';
    if (job) { job(); job = null; }
  };
  const leave = (event: MouseEvent) => { if (!event.relatedTarget) hide(); };
  const blur = () => hide();
  const resetPortrait = () => {
    lastD = -1;
    portrait?.setAttribute('pixel-size', '2.0');
    portrait?.setAttribute('contrast', '1.24');
    portrait?.setAttribute('brightness', '-0.01');
    portrait?.setAttribute('light', '#f5f2eb');
  };

  window.addEventListener('pointermove', pointer, { passive: true });
  window.addEventListener('pointerdown', down, { passive: true });
  window.addEventListener('pointerup', up, { passive: true });
  window.addEventListener('pointercancel', up, { passive: true });
  window.addEventListener('blur', blur);
  document.addEventListener('mouseout', leave);
  portraitFrame?.addEventListener('pointerleave', resetPortrait);

  return () => {
    if (job) { job(); job = null; }
    cursor.remove();
    ring.remove();
    window.removeEventListener('pointermove', pointer);
    window.removeEventListener('pointerdown', down);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('blur', blur);
    document.removeEventListener('mouseout', leave);
    portraitFrame?.removeEventListener('pointerleave', resetPortrait);
    if (headline) headline.style.transform = '';
    if (wordmark) wordmark.style.transform = '';
  };
}
