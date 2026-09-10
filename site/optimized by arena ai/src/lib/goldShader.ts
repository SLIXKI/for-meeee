import { onFrame, onQualityScale, getQualityScale } from './frames';
import type { DeviceProfile } from './tier';
import { getQuality } from './tier';
import { makeProgram, makeTriangle } from './webgl';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
function frag(octaves: number) {
  return `precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float S; uniform float uMood;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x),
             mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<${octaves};i++){ s += a*noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*R) / min(R.x, R.y);
  vec2 m = (M - 0.5*R) / min(R.x, R.y);
  vec2 q = uv*1.35 + vec2(0.0, S*0.6);
  float w1 = fbm(q*1.1 + vec2(T*0.028, -T*0.018));
  float w2 = fbm(q*1.9 + w1*1.6 + vec2(-T*0.02, T*0.03));
  float silk = fbm(q + w2*1.25);
  float band = 0.5 + 0.5*sin(silk*7.5 - T*0.22 + uv.x*1.4);
  float metal = pow(clamp(silk*1.28, 0.0, 1.0), 2.6) * (0.55 + 0.45*band);
  vec3 deep = vec3(0.020,0.020,0.028);
  vec3 gold = vec3(0.788,0.659,0.416);
  vec3 hi = vec3(1.000,0.953,0.839);
  vec3 col = mix(deep, gold, metal);
  col = mix(col, hi, pow(metal, 4.5)*0.85);
  float d = length(uv - m*0.9);
  col += gold * exp(-d*3.4) * 0.34;
  col += hi * exp(-d*9.0) * 0.10;
  col += vec3(0.36,0.20,0.62) * exp(-length(uv - vec2(-0.7,0.55))*2.6) * (0.10 + 0.16*uMood);
  // Aurora chapters: the whole atmosphere leans violet-ember as you descend.
  col += mix(vec3(0.0), vec3(0.055,0.028,0.10), uMood) * (0.35 + 0.65*metal);
  float g = (hash(gl_FragCoord.xy + T) - 0.5) * 0.028;
  col += g;
  col *= 1.0 - smoothstep(0.55, 1.35, length(uv)*0.95);
  gl_FragColor = vec4(col, 1.0);
}`;
}

// Living gold background. Animates on EVERY tier (still image only for
// reduced-motion). Resolution + FBM cost adapt to device + live FPS, and the
// palette breathes with the chapter you're in (aurora chapters).
export function createGoldShader(canvas: HTMLCanvasElement, profile: DeviceProfile) {
  const q = getQuality(profile);
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let stop: (() => void) | null = null;
  let resizePaint: (() => void) | null = null;
  let resizeTimer: number | null = null;
  let offQuality: (() => void) | null = null;
  let time = Math.random() * 40;
  let mx = innerWidth / 2;
  let my = innerHeight / 2;
  let rx = mx;
  let ry = my;
  let progress = 0;
  let width = 0;
  let height = 0;
  let scale = q.shaderScale;
  let uR: WebGLUniformLocation | null = null;
  let uT: WebGLUniformLocation | null = null;
  let uM: WebGLUniformLocation | null = null;
  let uS: WebGLUniformLocation | null = null;
  let uMood: WebGLUniformLocation | null = null;
  let mood = 0;
  let moodTarget = 0;
  let lastActive = performance.now();
  let tickN = 0;
  const MOODS: Record<string, number> = { top: 0, kit: 0.22, how: 0.4, ledger: 0.55, download: 0.45, architect: 1 };

  function release() {
    stop?.();
    stop = null;
    if (gl) { gl.deleteBuffer(buffer); gl.deleteProgram(program); }
    buffer = program = null;
  }

  function build() {
    try {
      const discrete = profile.tier === 2 && profile.hover && !profile.coarse;
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: discrete ? 'high-performance' : 'low-power', depth: false, stencil: false, failIfMajorPerformanceCaveat: false });
      if (!gl) return false;
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const src = frag(q.octaves);
      program = makeProgram(gl, VERT, precision?.precision ? src : src.replace('precision highp', 'precision mediump'));
      gl.useProgram(program);
      buffer = makeTriangle(gl, program, 'p');
      uR = gl.getUniformLocation(program, 'R');
      uT = gl.getUniformLocation(program, 'T');
      uM = gl.getUniformLocation(program, 'M');
      uS = gl.getUniformLocation(program, 'S');
      uMood = gl.getUniformLocation(program, 'uMood');
      return true;
    } catch { release(); return false; }
  }

  function draw() {
    if (!gl || !program || gl.isContextLost()) return;
    gl.useProgram(program);
    gl.uniform2f(uR, width, height);
    gl.uniform1f(uT, time);
    gl.uniform2f(uM, rx * scale, (innerHeight - ry) * scale);
    gl.uniform1f(uS, progress);
    gl.uniform1f(uMood, mood);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function resize() {
    if (!gl) return;
    cacheDoc();
    const dynamic = getQualityScale();
    const budget = q.shaderBudget * dynamic;
    scale = Math.min(q.shaderScale, Math.sqrt(budget / Math.max(innerWidth * innerHeight, 1)));
    width = Math.max(1, Math.round(innerWidth * scale));
    height = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    draw();
  }

  function onResize() {
    if (resizePaint) return;
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      resizePaint = onFrame(() => { resizePaint = null; resize(); return false; });
    }, 120);
  }

  function pointer(event: PointerEvent) { mx = event.clientX; my = event.clientY; lastActive = performance.now(); }
  // scrollHeight forces layout — cache it, refresh on geometry changes only.
  let docH = 1;
  const cacheDoc = () => { docH = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
  function scroll() {
    progress = scrollY / docH;
    lastActive = performance.now();
  }
  function chapter(event: Event) {
    const id = (event as CustomEvent<string>).detail;
    if (typeof id === 'string' && id in MOODS) moodTarget = MOODS[id];
    lastActive = performance.now();
  }

  function start() {
    stop?.();
    stop = null;
    if (!program) return;
    canvas.style.opacity = '1';
    resize();
    // Idle stride: state advances every tick (no jumps), but pixels redraw
    // every 4th frame after 4s idle — silk barely moves, GPU rests ~75%.
    stop = onFrame((_now, delta) => {
      time += delta / 1000;
      const blend = 1 - Math.pow(0.94, delta / 16.667);
      rx += (mx - rx) * blend;
      ry += (my - ry) * blend;
      mood += (moodTarget - mood) * (1 - Math.pow(0.96, delta / 16.667));
      tickN++;
      if (performance.now() - lastActive > 4000 && tickN % 4 !== 0) return;
      draw();
    }, q.shaderFps, 20);
  }

  function lost(event: Event) {
    event.preventDefault();
    stop?.();
    stop = null;
    canvas.style.opacity = '0';
  }

  function restored() { release(); if (build()) start(); }

  canvas.style.opacity = '0';
  if (build()) {
    if (profile.reduced) {
      // One beautiful still frame for reduced-motion users.
      resize();
      canvas.style.opacity = '1';
    } else {
      start();
    }
  }
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  window.addEventListener('resize', onResize, { passive: true });
  if (!profile.reduced) {
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('scroll', scroll, { passive: true });
  }
  window.addEventListener('asheo:chapter', chapter);
  offQuality = onQualityScale(() => resize());

  // The Ledger (cream) and Architect (#000) sections are fully opaque — when
  // either covers the viewport the shader is invisible, so park the loop and
  // hide the canvas to skip compositing entirely. Zero visual difference.
  let covered = false;
  let coverIO: IntersectionObserver | null = null;
  const applyCover = () => {
    if (covered) {
      stop?.();
      stop = null;
      canvas.style.visibility = 'hidden';
    } else if (program && !profile.reduced && !stop && !gl?.isContextLost()) {
      canvas.style.visibility = '';
      start();
    } else {
      canvas.style.visibility = '';
    }
  };
  if (!profile.reduced && 'IntersectionObserver' in window) {
    const ratios = new Map<string, number>();
    coverIO = new IntersectionObserver(entries => {
      for (const entry of entries) ratios.set((entry.target as HTMLElement).id, entry.intersectionRatio);
      const next = (ratios.get('ledger') ?? 0) >= 0.8 || (ratios.get('architect') ?? 0) >= 0.8;
      if (next !== covered) { covered = next; applyCover(); }
    }, { threshold: [0, 0.8, 1] });
    for (const id of ['ledger', 'architect']) {
      const el = document.getElementById(id);
      if (el) coverIO.observe(el);
    }
  }

  return () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizePaint?.();
    offQuality?.();
    coverIO?.disconnect();
    coverIO = null;
    release();
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', pointer);
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('asheo:chapter', chapter);
    canvas.width = canvas.height = 1;
  };
}
