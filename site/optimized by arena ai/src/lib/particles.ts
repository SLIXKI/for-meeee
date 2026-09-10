import { onFrame } from './frames';
import type { DeviceProfile } from './tier';
import { getQuality } from './tier';

const GOLD = ['#C9A86A', '#FFF3D6', '#EADFC6', '#F5F2EB', '#A98A4F', '#ffffff'];
const DIM = ['#8a7346', '#C9A86A', '#6b5a35'];
type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; w: number; h: number; rotation: number; spin: number; phase: number; color: string; life: number; decay: number };

const COARSE = matchMedia('(pointer: coarse)').matches;

function pool(id: string, capacity: number, trail: boolean, dprCap: number) {
  const particles: Particle[] = Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, w: 0, h: 0, rotation: 0, spin: 0, phase: 0, color: '', life: 0, decay: 0 }));
  // Ribbon: flowing head-trail history drawn as one tapering stroke.
  const ribbon: Array<{ x: number; y: number; life: number }> = [];
  let count = 0;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let stop: (() => void) | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    if (!canvas || !ctx) return;
    width = innerWidth;
    height = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, dprCap);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onResize() { if (count > 0 || ribbon.length) resize(); }

  function drawRibbon(dt: number) {
    if (!ctx || ribbon.length < 2) return;
    // Fade history.
    for (let i = ribbon.length - 1; i >= 0; i--) {
      ribbon[i].life -= 0.055 * dt;
      if (ribbon[i].life <= 0) ribbon.splice(i, 1);
    }
    const n = ribbon.length;
    if (n < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Tapered segments, head bright → tail transparent.
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const a = t * t * 0.55 * ribbon[i].life;
      if (a < 0.01) continue;
      ctx.strokeStyle = t > 0.75 ? `rgba(255,243,214,${a.toFixed(3)})` : `rgba(201,168,106,${a.toFixed(3)})`;
      ctx.lineWidth = 0.6 + t * 2.6;
      ctx.beginPath();
      ctx.moveTo(ribbon[i - 1].x, ribbon[i - 1].y);
      const mx = (ribbon[i - 1].x + ribbon[i].x) / 2;
      const my = (ribbon[i - 1].y + ribbon[i].y) / 2;
      ctx.quadraticCurveTo(ribbon[i - 1].x, ribbon[i - 1].y, mx, my);
      ctx.lineTo(ribbon[i].x, ribbon[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(_now: number, delta: number) {
    if (!ctx) return false;
    const dt = Math.min(2.5, delta / 16.667);
    ctx.clearRect(0, 0, width, height);
    if (trail) drawRibbon(dt);
    // Batch by color to minimize fillStyle state churn.
    let lastColor = '';
    for (let i = count - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += (trail ? 0.012 : 0.3) * dt;
      p.vx *= Math.pow(trail ? 0.985 : 0.993, dt);
      p.vz *= Math.pow(0.99, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rotation += p.spin * dt;
      p.phase += 0.21 * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.y > height + 100) {
        count--;
        particles[i] = particles[count];
        particles[count] = p;
        continue;
      }
      if (trail) {
        const c = p.life > 0.6 ? '#FFF3D6' : '#C9A86A';
        if (c !== lastColor) { lastColor = c; ctx.fillStyle = c; }
        ctx.globalAlpha = p.life * 0.75;
        // Occasional diamond sparkle for twinkle variety.
        if (p.w > 1.8) {
          const s = p.w * 0.9;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
        } else {
          ctx.fillRect(p.x, p.y, p.w, p.w);
        }
      } else {
        const k = 640 / Math.max(240, 640 + p.z);
        const flick = 0.5 + 0.5 * Math.abs(Math.sin(p.phase));
        const sx = k * (Math.cos(p.phase) * 0.55 + 0.75);
        const cos = Math.cos(p.rotation);
        const sin = Math.sin(p.rotation);
        if (p.color !== lastColor) { lastColor = p.color; ctx.fillStyle = p.color; }
        ctx.globalAlpha = p.life * flick * Math.min(1, k);
        // Manual matrix instead of save/translate/rotate/scale — far cheaper.
        ctx.setTransform(dpr * sx * cos, dpr * sx * sin, dpr * -k * sin, dpr * k * cos, dpr * p.x, dpr * p.y);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
    }
    // Constellation: link the newest trail motes with hairlines.
    if (trail && count >= 4 && count <= 70 && ctx) {
      const n = Math.min(count, 22);
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = particles[i];
        for (let j = i + 1; j < n; j++) {
          const b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 8100) continue;
          const alpha = (1 - Math.sqrt(d2) / 90) * 0.22 * Math.min(a.life, b.life);
          if (alpha < 0.015) continue;
          ctx.strokeStyle = `rgba(201,168,106,${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    if (count === 0 && ribbon.length < 2) {
      stop = null;
      ribbon.length = 0;
      if (canvas) canvas.width = canvas.height = 1;
      return false;
    }
  }

  function ensure() {
    if (canvas) return !!ctx;
    canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) { canvas = null; return false; }
    document.body.appendChild(canvas);
    resize();
    window.addEventListener('resize', onResize, { passive: true });
    return true;
  }

  function emit(x: number, y: number, amount: number, colors = GOLD, vx = 0, vy = 0) {
    if (document.hidden || !ensure()) return;
    if (count === 0 && ribbon.length < 2) resize();
    if (trail) {
      ribbon.push({ x, y, life: 1 });
      if (ribbon.length > 16) ribbon.shift();
    }
    for (let i = 0, n = Math.min(amount, capacity - count); i < n; i++) {
      const p = particles[count++];
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = 5 + Math.random() * 14;
      p.x = x + (trail ? (Math.random() - 0.5) * 10 : 0);
      p.y = y + (trail ? (Math.random() - 0.5) * 10 : 0);
      p.z = trail ? 0 : Math.random() * 440 - 140;
      p.vx = trail ? vx * 0.06 + (Math.random() - 0.5) * 0.6 : Math.cos(angle) * speed;
      p.vy = trail ? vy * 0.06 + (Math.random() - 0.5) * 0.6 - 0.25 : Math.sin(angle) * speed;
      p.vz = (Math.random() - 0.5) * 8;
      const sparkle = trail && Math.random() < 0.18;
      p.w = trail ? (sparkle ? 1.9 + Math.random() * 1.2 : 0.5 + Math.random() * 1.3) : 4 + Math.random() * 10;
      p.h = 1.6 + Math.random() * 5;
      p.rotation = Math.random() * Math.PI * 2;
      p.spin = (Math.random() - 0.5) * 0.5;
      p.phase = Math.random() * Math.PI * 2;
      p.color = colors[(Math.random() * colors.length) | 0];
      p.life = 1;
      p.decay = trail ? 0.012 + Math.random() * 0.02 : 0.005 + Math.random() * 0.007;
    }
    if (!stop) stop = onFrame(draw);
  }

  // Slow rising mote for idle fireflies — drifts up, long life.
  function rise(x: number, y: number) {
    if (document.hidden || !ensure() || count >= capacity) return;
    if (count === 0 && ribbon.length < 2) resize();
    const p = particles[count++];
    p.x = x; p.y = y; p.z = 0;
    p.vx = (Math.random() - 0.5) * 0.35;
    p.vy = -(0.35 + Math.random() * 0.7);
    p.vz = 0;
    p.w = 1 + Math.random() * 1.6;
    p.h = 2;
    p.rotation = 0; p.spin = 0;
    p.phase = Math.random() * Math.PI * 2;
    p.color = DIM[(Math.random() * DIM.length) | 0];
    p.life = 1;
    p.decay = 0.004 + Math.random() * 0.004;
    if (!stop) stop = onFrame(draw);
  }

  function destroy() {
    stop?.();
    stop = null;
    window.removeEventListener('resize', onResize);
    if (canvas) { canvas.width = canvas.height = 1; canvas.remove(); }
    canvas = ctx = null;
    count = 0;
    ribbon.length = 0;
    particles.length = 0;
  }
  return { emit, rise, destroy };
}

export function createParticles(profile: DeviceProfile) {
  const q = getQuality(profile);
  // Tier-0 phones render particles at 1x: identical look, quarter the fill.
  const cap = profile.tier === 0 ? 1 : COARSE ? 1.15 : 1.5;
  const dust = pool('dust', q.trail, true, cap);
  const foil = pool('confetti', q.confetti, false, cap);
  return {
    trail(x: number, y: number, dx: number, dy: number) {
      if (!profile.reduced && profile.hover) dust.emit(x, y, 2, GOLD, dx, dy);
    },
    rise(x: number, y: number) {
      if (!profile.reduced) dust.rise(x, y);
    },
    burst(x: number, y: number, amount = q.burst, colors = GOLD) {
      if (!profile.reduced) foil.emit(x, y, amount, colors);
    },
    destroy() { dust.destroy(); foil.destroy(); },
  };
}
