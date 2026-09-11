(() => {
'use strict';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine   = matchMedia('(hover:hover) and (pointer:fine)').matches;
const weak   = (navigator.hardwareConcurrency || 4) < 4;
// A phone reporting 8 cores is not a desktop: it has a fraction of the GPU and a
// thermal budget that a full-screen fragment shader will eat. Decorative effects
// gate on this, never functionality.
const lowPower = weak || matchMedia('(pointer:coarse)').matches ||
  ((navigator.deviceMemory || 8) < 4);
const root   = document.documentElement;
// Surfaced to CSS: on a phone the cost of this page is not JavaScript, it is six
// stacked full-viewport composited layers (noise, scanlines, vignette, plumb grid,
// mouse spotlight, blend-mode grain) that must be blended on every scroll frame.
if (lowPower) root.classList.add('lite');
const lerp   = (a,b,t) => a + (b-a)*t;
const clamp  = (v,a,b) => Math.max(a, Math.min(b, v));
try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch(e){}

/* Small visibility helper shared by the ambient systems. */
function watch(el, fn, margin){
  if (!el || !('IntersectionObserver' in window)){ fn(true); return; }
  const io = new IntersectionObserver(es => es.forEach(e => fn(e.isIntersecting)), { rootMargin: margin || '0px' });
  io.observe(el);
}

/* ═══ SERIAL / EDITION NUMBER ═══
   Persisted for the session so the plate, the certificate and the wax seal
   all agree with each other across reloads instead of re-rolling. */
function getSerial(){
  try {
    const sv = sessionStorage.getItem('asheo-serial');
    if (sv && /^ASH-01-[A-F0-9]{4}-\d{3}$/.test(sv)) return sv;
  } catch(e){}
  const s = 'ASH-01-' + Math.random().toString(16).slice(2,6).toUpperCase() +
            '-' + String(Math.floor(Math.random()*400)+1).padStart(3,'0');
  try { sessionStorage.setItem('asheo-serial', s); } catch(e){}
  return s;
}
const serial = getSerial();
document.querySelectorAll('[data-serial]').forEach(el => el.textContent = serial);
document.getElementById('plateSerial').textContent = serial + ' / 500';

/* ═══ CHAR SPLIT ═══ */
document.querySelectorAll('[data-split]').forEach(el => {
  const txt = el.textContent, frag = document.createDocumentFragment();
  [...txt].forEach((c,i) => {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = c;
    s.style.transitionDelay = (i*0.028).toFixed(3)+'s';
    s.style.setProperty('--i', i);
    frag.appendChild(s);
  });
  el.textContent = ''; el.appendChild(frag);
});

/* ═══ EXTRUDED TYPE ═══ */
document.querySelectorAll('[data-extrude]').forEach(el => {
  const txt = el.dataset.extrude, N = lowPower ? 0 : 15;
  for (let i = N; i >= 1; i--) {
    const s = document.createElement('span');
    s.className = 'x3d-layer'; s.textContent = txt;
    const k = i/N;
    s.style.transform = `translateZ(${-i*2.3}px)`;
    s.style.color = `rgb(${Math.round(146-96*k)},${Math.round(118-78*k)},${Math.round(66-46*k)})`;
    el.appendChild(s);
  }
});

/* ═══ WEBGL · LIQUID GOLD SHADER ═══ */
const glCanvas = document.getElementById('gl');
let glOK = false, glDraw = null, glCovered = false, lastGLDraw = 0, swGL = false;
let glActive = performance.now(), glShown = false;
let glMood = 0, glMoodTarget = 0;
const GL_MOODS = { top:0, kit:.22, how:.4, ledger:.55, download:.45, architect:1 };
addEventListener('asheo:chapter', e => {
  const v = GL_MOODS[e.detail];
  if (v !== undefined) glMoodTarget = v;
  glActive = performance.now();
});
addEventListener('pointermove', () => { glActive = performance.now(); }, { passive:true });
addEventListener('scroll', () => { glActive = performance.now(); }, { passive:true });
(function initGL(){
  if (lowPower || reduce) { document.documentElement.classList.add('no-gl'); return; }
  const gl = glCanvas.getContext('webgl', { antialias:false, alpha:false, depth:false, stencil:false, powerPreference:'high-performance' });
  if (!gl) { document.documentElement.classList.add('no-gl'); return; }
  // Software rasterizers (SwiftShader, llvmpipe, RDP sessions, "hardware
  // acceleration" off) run this shader on the CPU — full rate would pin a
  // core. Detect once, then the governor and the backing store below adapt.
  // Same animation, thumbnail raster. Nothing visual is removed.
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    swGL = /swiftshader|llvmpipe|softpipe|software rasterizer|basic render/i.test(renderer);
  } catch(e){ swGL = false; }
  try { window.__asheoRenderTier = swGL ? 'eco (software GL)' : 'full'; } catch(e){}
  if (swGL){
    document.documentElement.classList.add('eco');
    if (window.console) console.info('[asheo] software WebGL detected — eco motion engaged.');
  }

  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  let FS = `precision highp float;
  uniform vec2 R; uniform float T; uniform vec2 M; uniform float S; uniform float uMood;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x),
               mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y);
  }
  float fbm(vec2 p){
    float s = 0.0, a = 0.5;
    for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*R) / min(R.x, R.y);
    vec2 m  = (M - 0.5*R) / min(R.x, R.y);

    /* domain-warped silk */
    vec2 q = uv*1.35 + vec2(0.0, S*0.6);
    float w1 = fbm(q*1.1 + vec2(T*0.028, -T*0.018));
    float w2 = fbm(q*1.9 + w1*1.6 + vec2(-T*0.02, T*0.03));
    float silk = fbm(q + w2*1.25);

    /* molten bands */
    float band = 0.5 + 0.5*sin(silk*7.5 - T*0.22 + uv.x*1.4);
    float metal = pow(clamp(silk*1.28, 0.0, 1.0), 2.6) * (0.55 + 0.45*band);

    /* gold palette */
    vec3 deep = vec3(0.020,0.020,0.028);
    vec3 gold = vec3(0.788,0.659,0.416);
    vec3 hi   = vec3(1.000,0.953,0.839);
    vec3 col  = mix(deep, gold, metal);
    col = mix(col, hi, pow(metal, 4.5)*0.85);

    /* viewer's light */
    float d = length(uv - m*0.9);
    col += gold * exp(-d*3.4) * 0.34;
    col += hi   * exp(-d*9.0) * 0.10;

    /* violet counter-light, bottom-left — breathes with the chapter */
    col += vec3(0.36,0.20,0.62) * exp(-length(uv - vec2(-0.7,0.55))*2.6) * (0.10 + 0.16*uMood);
    /* aurora chapters: the whole atmosphere leans violet-ember as you descend */
    col += mix(vec3(0.0), vec3(0.055,0.028,0.10), uMood) * (0.35 + 0.65*metal);

    /* fine dither + vignette */
    float g = (hash(gl_FragCoord.xy + T) - 0.5) * 0.028;
    col += g;
    col *= 1.0 - smoothstep(0.55, 1.35, length(uv)*0.95);

    gl_FragColor = vec4(col, 1.0);
  }`;
  try {
    const prec = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!prec || !prec.precision) FS = FS.replace('precision highp float', 'precision mediump float');
  } catch(e){}

  let prog = null, uR = null, uT = null, uM = null, uS = null, uMood = null, SCALE = 0.62;
  function build(){
    const mk = (t,src) => {
      const s = gl.createShader(t);
      if (!s) throw new Error('shader alloc failed');
      gl.shaderSource(s,src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vs = mk(gl.VERTEX_SHADER, VS), fs = mk(gl.FRAGMENT_SHADER, FS);
    prog = gl.createProgram();
    if (!prog) throw new Error('program alloc failed');
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog,'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uR = gl.getUniformLocation(prog,'R'); uT = gl.getUniformLocation(prog,'T');
    uM = gl.getUniformLocation(prog,'M'); uS = gl.getUniformLocation(prog,'S');
    uMood = gl.getUniformLocation(prog,'uMood');
  }
  try { build(); } catch(e){ document.documentElement.classList.add('no-gl'); return; }

  function size(){
    // Pixel budget: the silk is smooth gradients under upscale, so backing
    // resolution barely matters — cap it at ~420k pixels and .5 scale.
    SCALE = Math.min(0.5, Math.sqrt(420000 / Math.max(innerWidth*innerHeight, 1)));
    if (swGL) SCALE = Math.min(SCALE, 480/Math.max(innerWidth, 1), 480/Math.max(innerHeight, 1));
    const w = Math.max(1, Math.round(innerWidth*SCALE)), h = Math.max(1, Math.round(innerHeight*SCALE));
    if (glCanvas.width !== w || glCanvas.height !== h){
      glCanvas.width = w; glCanvas.height = h;
      gl.viewport(0,0,w,h);
    }
    gl.useProgram(prog); gl.uniform2f(uR, w, h);
  }
  size(); addEventListener('resize', size);
  let gmx = 0, gmy = 0;
  glDraw = (t, mx, my, s) => {
    if (gl.isContextLost()) return;
    gmx = lerp(gmx, mx*SCALE, .06); gmy = lerp(gmy, (innerHeight-my)*SCALE, .06);
    glMood = lerp(glMood, glMoodTarget, .04);
    gl.useProgram(prog);
    gl.uniform1f(uT, t); gl.uniform2f(uM, gmx, gmy); gl.uniform1f(uS, s); gl.uniform1f(uMood, glMood);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!glShown){ glShown = true; glCanvas.style.opacity = '1'; }
  };
  glCanvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); glOK = false; glCanvas.style.opacity = '0';
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    try { build(); size(); glOK = true; } catch(e){ document.documentElement.classList.add('no-gl'); }
  });
  // The Ledger (cream) and Architect (#000) sections are fully opaque — when
  // either covers the viewport the shader is invisible, so park the loop and
  // hide the canvas to skip compositing entirely. Zero visual difference.
  if ('IntersectionObserver' in window){
    const ratios = {};
    const cio = new IntersectionObserver(es => {
      es.forEach(e => { ratios[e.target.id] = e.intersectionRatio; });
      const next = (ratios.ledger || 0) >= .8 || (ratios.architect || 0) >= .8;
      if (next !== glCovered){ glCovered = next; glCanvas.style.visibility = next ? 'hidden' : ''; }
    }, { threshold:[0,.8,1] });
    ['ledger','architect'].forEach(id => { const el = document.getElementById(id); if (el) cio.observe(el); });
  }
  glOK = true;
})();

/* ═══ SCROLL VELOCITY (native scroll, never hijacked) ═══ */
const skewer = document.getElementById('skewer');
let skewIdle = false;
let vel = 0, lastY = scrollY, lastScrollAt = 0;
addEventListener('scroll', () => {
  const y = scrollY;
  lastScrollAt = performance.now();
  vel = vel * .6 + (y - lastY) * .4;   // smoothed, for the skew and the ring
  lastY = y;
}, { passive: true });                 // passive: never blocks the compositor
// Scrollable height, cached: reading body.scrollHeight inside the frame loop
// forces a synchronous layout whenever anything dirtied it mid-frame. It only
// changes when content or the viewport does, so paintScroll() (scroll frames)
// and the resize listener below keep it fresh instead.
let scrollMax = 1;
addEventListener('resize', () => {
  scrollMax = Math.max(1, document.body.scrollHeight - innerHeight);
}, { passive: true });
// Anchor links keep the curtain wipe, but the jump itself is native.
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const el = document.querySelector(href);
    if (!el) return;
    e.preventDefault();
    wipe(e.clientX || innerWidth/2, e.clientY || innerHeight/2, () => {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      try { if (location.hash !== href) history.pushState(null, '', href); } catch(_){}
      if (e.detail === 0){ // keyboard activation: move focus to the destination
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll:true });
      }
    });
  });
});

/* ═══ CURTAIN WIPE ═══ */
const curtain = document.getElementById('curtain');
let tintTimer = 0;
function wipe(x, y, mid){
  if (reduce){ mid && mid(); return; }
  curtain.style.setProperty('--cx', x+'px');
  curtain.style.setProperty('--cy', y+'px');
  curtain.classList.add('in');
  chime(392,.05);
  setTimeout(() => { mid && mid(); }, 620);
  setTimeout(() => curtain.classList.remove('in'), 900);
}
// Chapter-tinted veils: capture phase runs before the wipe adds .in.
if (!reduce) document.addEventListener('click', e => {
  const a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
  if (!a || !curtain) return;
  const id = (a.getAttribute('href') || '').slice(1);
  clearTimeout(tintTimer);
  if (id === 'ledger' || id === 'architect' || id === 'download'){
    curtain.dataset.tint = id;
    tintTimer = setTimeout(() => curtain.removeAttribute('data-tint'), 1400);
  } else {
    curtain.removeAttribute('data-tint');
  }
}, true);

/* Assigned by the dither section below; declared early so the loop can call it. */
let flushDither = () => {};

/* ═══ MASTER LOOP ═══ */
const glowEl = document.getElementById('scrollGlow');
const ringBand = document.querySelector('.ring-band');
const coinEl = document.getElementById('coin');
const coinStage = document.querySelector('.coin-stage');
const footerEl = document.querySelector('footer');
const wmFace = document.querySelector('.wm-face');
let lastGlow = '', lastVelVar = '';
let coinHover = false, coinFlip = 0, lastRate = 1, coinAnim;
let footerVisible = false, footN = 0, lastFill = -1;
watch(footerEl, v => { footerVisible = v; }, '200px');
function setCoinRate(rate){
  try {
    if (coinAnim === undefined){
      try { coinAnim = (coinEl.getAnimations && coinEl.getAnimations()[0]) || null; }
      catch(e){ coinAnim = null; }
    }
    // playbackRate keeps phase — animation-duration would jump/restart.
    if (coinAnim) coinAnim.playbackRate = rate;
    else coinEl.style.animationDuration = (16/rate).toFixed(1)+'s';
  } catch(e){
    try { coinEl.style.animationDuration = (16/rate).toFixed(1)+'s'; } catch(_){}
  }
}
if (coinStage && !reduce){
  coinStage.addEventListener('pointerenter', () => { coinHover = true; });
  coinStage.addEventListener('pointerleave', () => { coinHover = false; });
  coinStage.addEventListener('click', () => { coinFlip = 8; }); // a flippable coin
}
let t0 = performance.now();
function loop(now){
  const t = (now - t0)/1000;

  {
    vel *= .92;                        // decay so the skew settles after scrolling stops
    // This transform applies to the whole page, so every write re-composites the
    // document. Below ~0.15px/frame of velocity the skew rounds to nothing visible;
    // write once to clear it, then leave the layer alone until motion resumes.
    const idleNow = Math.abs(vel) < .15;
    if (!idleNow || !skewIdle){
      skewer.style.transform = idleNow ? ''
        : `skewY(${clamp(vel*0.014,-1.4,1.4).toFixed(3)}deg) scaleY(${(1 - Math.min(Math.abs(vel)*0.0004,.02)).toFixed(4)})`;
      skewIdle = idleNow;
    }
  }

  // Frame governor: the silk drifts far too slowly for 60fps to be
  // distinguishable, so it never renders above 30fps; after 5s without input
  // it eases to 12fps — film-grain territory, the boil just gets cinematic.
  // Same pixels, a fraction of the GPU. Software rasterizers drop to a 10fps
  // thumbnail tier instead — still alive, roughly 1/50th the CPU.
  if (glOK && !glCovered){
    const glBudget = swGL ? 100 : (now - glActive <= 5000 ? 33.4 : 83.4);
    if (now - lastGLDraw >= glBudget){
      lastGLDraw = now;
      glDraw(t, mouseX, mouseY, (scrollY/scrollMax));
    }
  }
  if (mouseDirty){
    mouseDirty = false;
    // The spotlight is a 480px box now: one transform write, no full-screen
    // gradient repaint and no per-frame style invalidation.
    const st = `translate3d(${mouseX.toFixed(1)}px,${mouseY.toFixed(1)}px,0)`;
    if (st !== lastSpotT){ lastSpotT = st; if (spotEl) spotEl.style.transform = st; }
    if (!cursorShown){ cursorShown = true; cur.style.opacity = '1'; curRing.style.opacity = '1'; }
  }
  if (glowEl && !reduce && !lowPower){
    const ga = Math.abs(vel);
    const go = ga > .4 ? Math.min(.5, ga*.022).toFixed(3) : '0';
    if (go !== lastGlow){ lastGlow = go; glowEl.style.opacity = go; glowEl.style.visibility = go === '0' ? 'hidden' : ''; }
  }
  // Scroll velocity leans the kinetic ring — the "alive" feeling.
  if (ringBand && !reduce){
    const vv = clamp(vel*.35, -14, 14).toFixed(2);
    if (vv !== lastVelVar){ lastVelVar = vv; ringBand.style.setProperty('--vel', vv); }
  }
  if (coinEl && !reduce){
    coinFlip *= .93; if (coinFlip < .01) coinFlip = 0;
    const rate = 1 + Math.min(Math.abs(vel)*.14, 2.6) + (coinHover ? 2.4 : 0) + coinFlip;
    if (Math.abs(rate - lastRate) > .12){ lastRate = rate; setCoinRate(rate); }
  }
  if (footerVisible && wmFace && footerEl && !reduce){
    // Layout read throttled to every 3rd frame; writes quantized to 2%.
    footN++;
    if (footN % 3 === 0){
      const fr = footerEl.getBoundingClientRect();
      const ff = clamp((innerHeight*.95 - fr.top)/(innerHeight*.6), 0, 1);
      if (Math.abs(ff - lastFill) > .02){ lastFill = ff; wmFace.style.setProperty('--fill', (ff*100).toFixed(1)+'%'); }
    }
  }
  drawDust();
  orbFrame(now);
  cursorFrame();
  flushLedgerLeaf();
  flushDither();
  requestAnimationFrame(loop);
}

/* ═══ CURSOR + GOLD DUST TRAIL ═══ */
const cur = document.getElementById('cur'), curRing = document.getElementById('curRing');
const h1El = document.getElementById('h1'), wmEl = document.getElementById('wm');
const spotEl = document.getElementById('spot');
let mouseX = innerWidth/2, mouseY = innerHeight/2, rx = mouseX, ry = mouseY, mvx = 0, mvy = 0;
const dustC = document.getElementById('dust'), dctx = dustC.getContext('2d');
let motes = [], ddpr = 1;
function sizeDust(){
  ddpr = Math.min(devicePixelRatio||1, 1.75);
  dustC.width = innerWidth*ddpr; dustC.height = innerHeight*ddpr;
  dctx.setTransform(ddpr,0,0,ddpr,0,0);
}
sizeDust(); addEventListener('resize', sizeDust);
let mouseDirty = false, lastSpotT = '', cursorShown = false;
let lastDot = '', lastRingT = '';
addEventListener('pointermove', e => {
  mvx = e.clientX - mouseX; mvy = e.clientY - mouseY;
  mouseX = e.clientX; mouseY = e.clientY;
  // NOT written here: a fast mouse fires many events per frame; the master
  // loop flushes the spotlight transform once instead.
  mouseDirty = true;
  const nx = mouseX/innerWidth - .5, ny = mouseY/innerHeight - .5;
  if (h1El && fine) h1El.style.transform = `rotateY(${nx*10}deg) rotateX(${-ny*7}deg) translateZ(34px)`;
  if (wmEl && fine) wmEl.style.transform = `rotateY(${nx*14}deg) rotateX(${-ny*7}deg)`;
  if (fine && !reduce && Math.hypot(mvx,mvy) > 6 && motes.length < 160){
    for (let i=0;i<2;i++) motes.push({
      x: mouseX + (Math.random()-.5)*10, y: mouseY + (Math.random()-.5)*10,
      vx: mvx*.06 + (Math.random()-.5)*.6, vy: mvy*.06 + (Math.random()-.5)*.6 - .25,
      s: Math.random()*1.7+.5, life: 1, dec: .012+Math.random()*.02
    });
  }
}, {passive:true});
let dustPainted = false, dustHidden = false;
function drawDust(){
  if (!motes.length){
    // Clear once on the way down, then stop touching the canvas.
    if (dustPainted) { dctx.clearRect(0,0,innerWidth,innerHeight); dustPainted = false; }
    // A hidden canvas skips compositing entirely — one less fullscreen blend.
    if (!dustHidden){ dustHidden = true; dustC.style.visibility = 'hidden'; }
    return;
  }
  if (dustHidden){ dustHidden = false; dustC.style.visibility = ''; }
  dustPainted = true;
  dctx.clearRect(0,0,innerWidth,innerHeight);
  motes = motes.filter(m => m.life > 0);
  for (const m of motes){
    m.x += m.vx; m.y += m.vy; m.vy += .012; m.vx *= .985; m.life -= m.dec;
    dctx.globalAlpha = Math.max(m.life,0)*.75;
    dctx.fillStyle = m.life > .6 ? '#FFF3D6' : '#C9A86A';
    dctx.fillRect(m.x, m.y, m.s, m.s);
  }
  dctx.globalAlpha = 1;
}
function cursorFrame(){
  if (!fine) return;
  rx = lerp(rx, mouseX, .17); ry = lerp(ry, mouseY, .17);
  // Centered via translate(-50%,-50%) so every ring state (big/lens/drag)
  // stays under the pointer, and cached so a settled cursor writes nothing —
  // identical values skip DOM writes entirely.
  const d = `translate3d(${mouseX.toFixed(1)}px,${mouseY.toFixed(1)}px,0) translate(-50%,-50%)`;
  if (d !== lastDot){ lastDot = d; cur.style.transform = d; }
  const r = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0) translate(-50%,-50%)`;
  if (r !== lastRingT){ lastRingT = r; curRing.style.transform = r; }
}
if (fine && !reduce){
  document.querySelectorAll('a,button,[data-mag]').forEach(el => {
    el.addEventListener('pointerenter', () => curRing.classList.add('big'));
    el.addEventListener('pointerleave', () => curRing.classList.remove('big'));
  });
  document.querySelectorAll('.dev-ash-right,.coin-stage,.wm-stage').forEach(el => {
    el.addEventListener('pointerenter', () => curRing.classList.add('lens'));
    el.addEventListener('pointerleave', () => curRing.classList.remove('lens'));
  });
  document.querySelectorAll('.orb-stage,.artifact').forEach(el => {
    el.addEventListener('pointerenter', () => curRing.classList.add('drag'));
    el.addEventListener('pointerleave', () => curRing.classList.remove('drag'));
  });
}

/* ═══ MAGNETIC + LIQUID BUTTONS ═══
   The independent `translate` property carries the pull, so :hover transforms
   compose with it — and the d1/d2/d3 depth is preserved instead of flattened,
   which the old direct `transform` write destroyed on every hover. */
if (fine && !reduce) document.querySelectorAll('[data-mag]').forEach(el => {
  const depth = el.classList.contains('d3') ? 56 : el.classList.contains('d2') ? 36 : el.classList.contains('d1') ? 18 : 0;
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width/2)/r.width, dy = (e.clientY - r.top - r.height/2)/r.height;
    el.style.translate = depth ? `${(dx*9).toFixed(2)}px ${(dy*7).toFixed(2)}px ${depth}px`
                               : `${(dx*9).toFixed(2)}px ${(dy*7).toFixed(2)}px`;
    el.style.setProperty('--bx', ((e.clientX-r.left)/r.width*100)+'%');
    el.style.setProperty('--by', ((e.clientY-r.top)/r.height*100)+'%');
  });
  el.addEventListener('pointerleave', () => el.style.translate = '');
});

/* ═══ PRELOADER · TUMBLERS ═══ */
const pre = document.getElementById('pre'), preNum = document.getElementById('preNum');
const preState = document.getElementById('preState'), tumblers = document.getElementById('tumblers');
const dialRing = document.getElementById('dialRing');
const CODE = 'ASHEO01';
[...CODE].forEach(() => {
  const w = document.createElement('span'); w.className = 'tum';
  const b = document.createElement('b'); b.textContent = '0'; w.appendChild(b); tumblers.appendChild(w);
});
const tumEls = [...tumblers.querySelectorAll('b')];
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let p = 0, locked = 0;
function finish(){
  pre.classList.add('done');
  document.body.classList.remove('locked');
  requestAnimationFrame(() => document.body.classList.add('ready'));
  setTimeout(() => pre.remove(), 1800);
  startFlaps();
  chime(196,.09); setTimeout(()=>chime(392,.06),160);
  // Deep links: the vault locks scroll on load, so land after it opens.
  const hsh = location.hash;
  if (hsh && hsh.length > 1){
    const dest = document.getElementById(hsh.slice(1));
    if (dest) setTimeout(() => dest.scrollIntoView({ behavior:'auto', block:'start' }), 60);
  }
}
if (reduce){ preNum.textContent='100'; root.style.setProperty('--pre',1); tumEls.forEach((b,i)=>b.textContent=CODE[i]); finish(); }
else {
  const spin = setInterval(() => {
    tumEls.forEach((b,i) => { if (i >= locked) b.textContent = GLYPHS[(Math.random()*GLYPHS.length)|0]; });
  }, 55);
  const tick = setInterval(() => {
    p = Math.min(100, p + Math.random()*8 + 3.5);
    preNum.textContent = String(Math.floor(p)).padStart(3,'0');
    root.style.setProperty('--pre', (p/100).toFixed(3));
    const want = Math.floor(p/100*CODE.length);
    while (locked < want){ tumEls[locked].textContent = CODE[locked]; locked++; }
    if (dialRing) dialRing.style.transform = `rotate(${p*6.2}deg)`;
    if (p > 92) preState.textContent = 'Unlocking';
    if (p >= 100){
      clearInterval(tick); clearInterval(spin);
      tumEls.forEach((b,i) => b.textContent = CODE[i]);
      preState.textContent = 'Open';
      setTimeout(finish, 420);
    }
  }, 90);
}

/* ═══ SPLIT-FLAP ODOMETER ═══ */
function startFlaps(){
  document.querySelectorAll('[data-flap]').forEach((el, n) => {
    const digits = el.dataset.flap, dot = el.dataset.fmt === 'dot';
    const pfx = el.dataset.pre || '', sfx = el.dataset.suf || '';
    const tmp = document.createElement('span');
    tmp.innerHTML = pfx; const preT = tmp.textContent;
    tmp.innerHTML = sfx; const sufT = tmp.textContent;
    el.setAttribute('aria-label', preT + (dot ? digits[0]+'.'+digits.slice(1) : digits) + sufT);
    el.innerHTML = '';
    if (pfx){ const s = document.createElement('span'); s.className='fx'; s.innerHTML = pfx; el.appendChild(s); }
    [...digits].forEach((d, i) => {
      if (dot && i === 1){ const s = document.createElement('span'); s.className='fx'; s.textContent='.'; el.appendChild(s); }
      const col = document.createElement('span'); col.className = 'col';
      const strip = document.createElement('b');
      strip.innerHTML = Array.from({length:10},(_,k)=>`<span style="display:block;height:30px;line-height:30px">${k}</span>`).join('');
      col.appendChild(strip); el.appendChild(col);
      // The delay is set now, the transform a tick later: setting both before
      // the first paint would render the final digit with no roll at all.
      strip.style.transitionDelay = (n*.12 + i*.09)+'s';
      setTimeout(() => strip.style.transform = `translateY(${-Number(d)*30}px)`, 30);
    });
    if (sfx){ const s = document.createElement('span'); s.className='fx'; s.innerHTML = sfx; el.appendChild(s); }
  });
}

/* ═══ SCRAMBLE ═══ */
const scr = document.getElementById('scramble');
if (scr && !reduce){
  const fin = scr.dataset.final, ch = '#$%&*+=<>0123456789ABCDEF';
  let f = 0;
  const t = setInterval(() => {
    scr.textContent = [...fin].map((c,i) => i < f/2 || c === ' ' ? c : ch[(Math.random()*ch.length)|0]).join('');
    if (f/2 > fin.length){ clearInterval(t); scr.textContent = fin; }
    f++;
  }, 26);
}

/* ═══ ORBITING SHARDS ═══ */
const orbitEl = document.getElementById('orbit');
if (orbitEl && !lowPower) for (let i=0;i<16;i++){
  const s = document.createElement('span'); s.className = 'shard';
  s.style.transform = `rotateY(${i/16*360}deg) translateZ(262px) translateY(${(Math.random()-.5)*280}px) rotateX(${Math.random()*90}deg)`;
  s.style.opacity = .3 + Math.random()*.55;
  orbitEl.appendChild(s);
}

/* ═══ KINETIC RING (scroll-reactive, CSS-rotated) ═══ */
const ringEl = document.getElementById('ring');
const RING = ['Not just an extension — <b>it\'s your edge</b>','Faster · Cleaner · <b>Unstoppable</b>','Zero telemetry, <b>by design</b>',
 'Two megabytes of <b>intent</b>','Built for the ones who <b>ship</b>','<b>Edition 01</b> · numbered build','Handcrafted <b>in the dark</b>',
 'Your data stays <b>yours</b>','No bloat · No noise · <b>Just speed</b>','Chromium <b>MV3</b> native','<b>40+</b> gateways supported','Early to it. <b>Always.</b>'];
// Twelve panels of ~250px text need more arc than a phone has: at any radius that
// fits the screen they overlap into an unreadable pile. The band is decorative — the
// same taglines appear in the hero and the ledger bar — so below 680px it is not
// built at all, which also saves 12 nodes and the compositor work.
const ringNarrow = innerWidth < 680;
if (ringEl && ringNarrow) ringEl.closest('.ring-band')?.remove();
if (ringEl && !ringNarrow){
  const R = innerWidth < 720 ? 300 : 520;
  RING.forEach((t,i) => {
    const d = document.createElement('div'); d.className = 'ring-panel'; d.innerHTML = t;
    d.style.transform = `rotateY(${i*(360/RING.length)}deg) translateZ(${R}px)`;
    ringEl.appendChild(d);
  });
}
// Rotation itself is a CSS keyframe now (see ring-spin): the compositor owns it,
// and scroll velocity only leans it via --vel from the master loop.

/* ═══ ORBITAL GALLERY · TRUE DEPTH OF FIELD ═══
   Inertia + snap-to-card, keyboard arrows, clickable dots, hover/focus pause,
   back-face culling and a rim dissolve so cards melt into the background
   instead of clipping. Auto-rotation never chimes — only deliberate moves do. */
const orbStage = document.getElementById('orbStage'), orbEl = document.getElementById('orb');
const cards = [...document.querySelectorAll('.orb-card')];
const dots = document.getElementById('orbDots');
const orbPrev = document.getElementById('orbPrev'), orbNext = document.getElementById('orbNext');
const orbProg = document.getElementById('orbProgressFill');
const orbCtrl = document.querySelector('.orb-ctrl');
let rot = 0, target = null, spinV = .055, orbVel = 0;
let dragging = false, lastX = 0, lastT = 0, originX = 0, originY = 0;
let radius = 360, stageHalf = 600, idx = -1, lastProg = -1;
let orbFlat = false, orbOnScreen = true, orbPaused = false, resumeAt = 0;
let dotEls = [];
const orbStep = 360/Math.max(cards.length, 1);
const orbTx = new Array(cards.length).fill(''), orbOp = new Array(cards.length).fill(''), orbVis = new Array(cards.length).fill(true);
function measureOrb(){
  const w = Math.max(orbStage ? orbStage.clientWidth : 1200, 320);
  stageHalf = w/2;
  const room = w/2 - 156 - 28, want = w < 640 ? 178 : w*.3;
  radius = clamp(Math.min(want, Math.max(room, 120)), 120, 380);
}
function paintOrb(time){
  if (!cards.length) return;
  const current = ((Math.round(-rot/orbStep) % cards.length) + cards.length) % cards.length;
  const bob = reduce ? 0 : Math.sin(time/900)*4;
  for (let i=0;i<cards.length;i++){
    const c = cards[i], a = (i*orbStep + rot) * Math.PI/180, sin = Math.sin(a);
    const z = Math.cos(a)*radius, depth = (z + radius)/(radius*2);
    // Cull cards facing fully away — saves paint, kills mirrored-text peeks.
    const show = depth > .1;
    if (show !== orbVis[i]){ orbVis[i] = show; c.style.visibility = show ? 'visible' : 'hidden'; }
    if (!show) continue;
    const px = sin*radius, lift = bob*depth;
    const t = `translate3d(${px.toFixed(1)}px,${lift.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${(sin*38).toFixed(1)}deg) scale(${(.78+depth*.26).toFixed(3)})`;
    if (t !== orbTx[i]){ orbTx[i] = t; c.style.transform = t; }
    // Rim dissolve: cards melt into the live background near the stage edge.
    const edge = 1 - clamp((Math.abs(px)/stageHalf - .62)/.36, 0, 1);
    const o = ((.22 + depth*.78) * (.12 + .88*edge)).toFixed(3);
    if (o !== orbOp[i]){ orbOp[i] = o; c.style.opacity = o; }
    // No z-index writes: preserve-3d sorts by real Z depth. Integer z-index
    // quantizes depth (visible pops) and forces stacking recalcs per frame.
  }
  if (orbProg){
    const pr = (((-rot % 360) + 360) % 360)/360;
    if (Math.abs(pr - lastProg) > .002){ lastProg = pr; orbProg.style.transform = `scaleX(${pr.toFixed(3)})`; }
  }
  if (current !== idx){
    idx = current;
    cards.forEach((c,i) => {
      c.classList.toggle('front', i === idx);
      c.setAttribute('aria-hidden', String(i !== idx));
      c.style.pointerEvents = i === idx ? 'auto' : 'none';
    });
    dotEls.forEach((d,i) => {
      d.classList.toggle('on', i === idx);
      d.setAttribute('aria-pressed', String(i === idx));
    });
  }
}
function orbFrame(now){
  if (!cards.length || !orbOnScreen || orbFlat) return;
  if (target !== null){
    rot += (target - rot)*.22;
    if (Math.abs(target - rot) < .08){ rot = target; target = null; }
  } else if (!dragging && !orbPaused && !reduce && now >= resumeAt){
    rot += spinV; spinV += (.055 - spinV)*.045;
  }
  paintOrb(now);
}
function orbGo(dir){
  if (!cards.length || orbFlat) return;
  const base = target !== null ? target : Math.round(rot/orbStep)*orbStep;
  target = base + dir*orbStep;
  orbVel = 0; resumeAt = performance.now() + 2500;
  if (reduce){ rot = target; target = null; paintOrb(performance.now()); }
  const n = ((Math.round(-base/orbStep) % cards.length) + cards.length) % cards.length;
  chime(523 + n*66, .028);
}
function layoutOrb(){
  if (!orbStage) return;
  // Each .orb-card is 312px wide and absolutely positioned, swinging +/-radius on a
  // 3D ring. Below ~880px of stage the cards land on top of each other — the H3-over-H3
  // overlap seen on a 432px phone. Under 680px, abandon the ring and let CSS stack them.
  const flat = innerWidth < 680;
  if (flat === orbFlat) return;
  orbFlat = flat;
  orbStage.classList.toggle('orb-flat', flat);
  if (orbCtrl) orbCtrl.style.display = flat ? 'none' : '';
  if (flat) {
    // orbFrame writes inline transform/filter every frame, and inline styles beat
    // any stylesheet — so they have to be cleared, not overridden.
    cards.forEach((c) => {
      c.style.transform = ''; c.style.filter = ''; c.style.zIndex = ''; c.style.opacity = '';
      c.style.visibility = ''; c.style.pointerEvents = '';
      c.classList.remove('front'); c.removeAttribute('aria-hidden');
    });
    idx = -1;
    dotEls.forEach((d) => { d.classList.remove('on'); d.setAttribute('aria-pressed', 'false'); });
  } else {
    measureOrb(); paintOrb(performance.now());
  }
}
if (dots) cards.forEach((c,i) => {
  const b = document.createElement('button');
  b.className = 'orb-dot'; b.type = 'button';
  const name = (c.querySelector('h3') || {}).textContent || ('Feature ' + (i+1));
  b.setAttribute('aria-label', 'Show ' + name);
  b.setAttribute('aria-pressed', String(i === 0));
  b.addEventListener('click', () => {
    if (orbFlat) return;
    let d = -i*orbStep - rot;
    d = ((d + 540) % 360) - 180; // shortest path
    target = rot + d; resumeAt = performance.now() + 2500;
    if (reduce){ rot = target; target = null; paintOrb(performance.now()); }
    chime(523 + i*66, .028);
  });
  dots.appendChild(b);
});
dotEls = dots ? [...dots.children] : [];
if (orbPrev) orbPrev.addEventListener('click', () => orbGo(1));
if (orbNext) orbNext.addEventListener('click', () => orbGo(-1));
if (orbStage && cards.length){
  layoutOrb(); measureOrb();
  if (!orbFlat) paintOrb(performance.now());
  let orbRsT = 0;
  addEventListener('resize', () => {
    clearTimeout(orbRsT);
    orbRsT = setTimeout(() => { layoutOrb(); if (!orbFlat){ measureOrb(); paintOrb(performance.now()); } }, 120);
  }, { passive:true });
  // Fonts/layout shifts change card width — re-measure once settled.
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => { if (!orbFlat){ measureOrb(); paintOrb(performance.now()); } }).catch(()=>{});

  const dStart = (x, y) => {
    dragging = true; target = null;
    originX = lastX = x; originY = y; lastT = performance.now(); orbVel = 0;
    orbStage.classList.add('touched');
  };
  const dMove = (x, y, e) => {
    if (!dragging) return;
    // A vertical touch is a page scroll, not a spin — hand it back.
    if (e && e.pointerType === 'touch' && Math.abs(y - originY) > Math.abs(x - originX) + 8){ dEnd(); return; }
    const now = performance.now(), dt = Math.max(now - lastT, 1), d = x - lastX;
    lastX = x; lastT = now;
    rot += d*.3;
    orbVel = clamp((d*.3*16.667)/dt, -3, 3); // flick velocity, deg/frame
    if (Math.abs(x - originX) > 6){
      if (e && e.pointerId !== undefined){
        try { if (!orbStage.hasPointerCapture(e.pointerId)) orbStage.setPointerCapture(e.pointerId); } catch(_){}
      }
      orbStage.classList.add('grabbing');
    }
  };
  const dEnd = () => {
    if (!dragging) return;
    dragging = false; orbStage.classList.remove('grabbing');
    if (reduce){ rot = Math.round(rot/orbStep)*orbStep; paintOrb(performance.now()); }
    else if (Math.abs(orbVel) > .12) target = Math.round((rot + orbVel*22)/orbStep)*orbStep; // inertia, then settle
    else target = Math.round(rot/orbStep)*orbStep; // snap to nearest card
    orbVel = 0; resumeAt = performance.now() + 2200;
  };
  const dKey = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); orbGo(e.key === 'ArrowLeft' ? 1 : -1);
  };
  orbStage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; dStart(e.clientX, e.clientY); });
  orbStage.addEventListener('pointermove', e => dMove(e.clientX, e.clientY, e), { passive:true });
  orbStage.addEventListener('pointerup', dEnd);
  orbStage.addEventListener('pointercancel', dEnd);
  orbStage.addEventListener('lostpointercapture', dEnd);
  orbStage.addEventListener('touchstart', e => dStart(e.touches[0].clientX, e.touches[0].clientY), { passive:true });
  orbStage.addEventListener('touchmove',  e => dMove(e.touches[0].clientX, e.touches[0].clientY, null), { passive:true });
  orbStage.addEventListener('touchend', dEnd);
  orbStage.addEventListener('keydown', dKey);
  if (orbCtrl) orbCtrl.addEventListener('keydown', dKey);
  // Touch pointers fire enter/leave around taps — only hover pointers pause.
  orbStage.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') orbPaused = true; });
  orbStage.addEventListener('pointerleave', () => { orbPaused = false; dEnd(); resumeAt = performance.now() + 1200; });
  const orbFocus = out => e => {
    if (!out){ orbPaused = true; return; }
    if (e.relatedTarget && (orbStage.contains(e.relatedTarget) || (orbCtrl && orbCtrl.contains(e.relatedTarget)))) return;
    orbPaused = false; resumeAt = performance.now() + 1200;
  };
  orbStage.addEventListener('focusin', orbFocus(false));
  orbStage.addEventListener('focusout', orbFocus(true));
  if (orbCtrl){ orbCtrl.addEventListener('focusin', orbFocus(false)); orbCtrl.addEventListener('focusout', orbFocus(true)); }
}

/* ═══ 3D COIN RIM ═══ */
const coin = document.getElementById('coin');
if (coin && !lowPower){
  const N = 48, r = 98, seg = (2*Math.PI*r)/N;
  for (let i=0;i<N;i++){
    const s = document.createElement('span'); s.className='coin-rim';
    s.style.width = (seg+1.5)+'px';
    s.style.transform = `translate(-50%,-50%) rotateY(${i*(360/N)}deg) translateZ(${r}px)`;
    coin.appendChild(s);
  }
}

/* ═══ RING CORRIDOR ═══ */
const corridor = document.getElementById('corridor');
if (corridor) for (let i=0;i<7;i++){
  const d = document.createElement('div'); d.className='corr-ring';
  const s = 420 + i*44;
  d.style.width = d.style.height = s+'px';
  d.style.margin = `${-s/2}px 0 0 ${-s/2}px`;
  d.style.animationDelay = (-i*1.07).toFixed(2)+'s';
  corridor.appendChild(d);
}

/* ═══ ARTIFACT · TILT · DRAG · HINGED LID ═══ */
['artifact','artifact2'].forEach(id => {
  const a = document.getElementById(id); if (!a) return;
  const glare = a.querySelector('.artifact-glare');
  const lid = a.querySelector('#lid');
  let held = false, hx = 0, hy = 0, ox = 0, oy = 0, sX = 0, sY = 0, moved = 0;
  if (fine && !reduce){
    a.addEventListener('pointermove', e => {
      if (held) return;
      const r = a.getBoundingClientRect();
      const px = (e.clientX-r.left)/r.width, py = (e.clientY-r.top)/r.height;
      a.style.transform = `rotateY(${(px-.5)*15}deg) rotateX(${-(py-.5)*15}deg) translateZ(44px)`;
      if (glare){ glare.style.setProperty('--gx', px*100+'%'); glare.style.setProperty('--gy', py*100+'%'); }
    });
    a.addEventListener('pointerleave', () => { if(!held) a.style.transform = ''; });
  }
  a.addEventListener('pointerdown', e => {
    // The lid is a button too, but dragging may start on it — the click
    // handler below tells drags apart from taps via `moved`.
    if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target.closest && e.target.closest('button:not(.lid),a,summary'))) return;
    held = true; moved = 0; hx = ox = e.clientX; hy = oy = e.clientY; a.classList.add('held');
  });
  addEventListener('pointermove', e => {
    if (!held) return;
    // A vertical touch is a page scroll — release the case and let it go.
    if (e.pointerType === 'touch' && Math.abs(e.clientY-oy) > Math.abs(e.clientX-ox) + 8){
      held = false; a.classList.remove('held'); sX = sY = 0; a.style.transform = ''; return;
    }
    const dx = e.clientX-hx, dy = e.clientY-hy;
    moved += Math.abs(dx)+Math.abs(dy);
    if (moved > 8){ try { if (!a.hasPointerCapture(e.pointerId)) a.setPointerCapture(e.pointerId); } catch(_){} }
    sY += dx*.5; sX = clamp(sX - dy*.35, -42, 42);
    hx = e.clientX; hy = e.clientY;
    a.style.transform = `rotateY(${sY}deg) rotateX(${sX}deg) translateZ(24px)`;
  });
  const release = () => {
    if (!held) return;
    held = false; a.classList.remove('held'); sX = sY = 0;
    a.style.transition = 'transform 1.1s cubic-bezier(.16,1,.3,1)';
    a.style.transform = '';
    setTimeout(() => a.style.transition = '', 1100);
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  if (lid) lid.addEventListener('click', e => {
    if (moved > 12){ e.preventDefault(); return; } // a drag is not a tap
    a.classList.toggle('opened');
    lid.setAttribute('aria-expanded', String(a.classList.contains('opened')));
    chime(a.classList.contains('opened') ? 587 : 330, .07);
  });
});
// The invitation to open only makes sense if the case is actually on screen.
setTimeout(() => {
  const a = document.getElementById('artifact');
  if (!a) return;
  const r = a.getBoundingClientRect();
  if (r.bottom > 0 && r.top < innerHeight){
    a.classList.add('opened');
    const lid = a.querySelector('#lid');
    if (lid) lid.setAttribute('aria-expanded', 'true');
  }
}, 4200);

/* ═══ NAV · LIQUID INDICATOR · SCROLL STATE ═══ */
const nav = document.getElementById('nav'), navLinks = document.getElementById('navLinks'), navInd = document.getElementById('navInd');
navLinks.querySelectorAll('a').forEach(a => {
  const enter = () => {
    navInd.style.opacity = '1';
    navInd.style.width = a.offsetWidth+'px';
    navInd.style.transform = `translateX(${a.offsetLeft}px)`;
  };
  a.addEventListener('pointerenter', enter);
  a.addEventListener('focus', enter);
});
navLinks.addEventListener('pointerleave', () => navInd.style.opacity = '0');
navLinks.addEventListener('focusout', () => navInd.style.opacity = '0');

let progEl = null;
const spine = document.getElementById('railSpineFill');
const toTop = document.getElementById('toTop');
const methodPath = document.getElementById('methodPath');
let pathLen = 0;
if (methodPath){ pathLen = methodPath.getTotalLength(); methodPath.style.strokeDasharray = pathLen; methodPath.style.strokeDashoffset = pathLen; }
let scrollJob = false;
function onScroll(){
  // Scroll events can fire several times per frame; coalesce the whole handler
  // (style writes + layout reads) into one rAF — Firefox profiles showed the
  // direct handler restyling the document hundreds of times per scroll.
  if (scrollJob) return;
  scrollJob = true;
  requestAnimationFrame(() => { scrollJob = false; paintScroll(); });
}
function paintScroll(){
  nav.classList.toggle('scrolled', scrollY > 12);
  scrollMax = Math.max(1, document.body.scrollHeight - innerHeight);
  const h = scrollMax;
  const k = scrollY/h;
  // Scoped to the progress bar: it is the only thing reading --sp, and on :root the
  // write invalidated style across the document.
  const pr = progEl || (progEl = document.querySelector('.prog'));
  if (pr) pr.style.setProperty('--sp', k.toFixed(4));
  if (spine) spine.style.transform = `scaleY(${k.toFixed(4)})`;
  if (toTop){
    toTop.classList.toggle('show', scrollY > innerHeight*1.4);
    toTop.style.setProperty('--p', k.toFixed(3));
  }
  if (methodPath){
    const r = methodPath.ownerSVGElement.getBoundingClientRect();
    const m = clamp((innerHeight*.9 - r.top)/(innerHeight*.7), 0, 1);
    methodPath.style.strokeDashoffset = pathLen*(1-m);
  }
}
addEventListener('scroll', onScroll, {passive:true}); paintScroll();
if (toTop) toTop.addEventListener('click', () => {
  window.scrollTo({ top:0, behavior: reduce ? 'auto' : 'smooth' });
});

/* ═══ CHAPTERS · RAIL · CARDS · AURORA ═══ */
const CHAPTER_META = {
  top:['I','Overture','Exhibit I'], kit:['II','The Kit','Exhibit II'], how:['III','The Method','Exhibit III'],
  ledger:['IV','The Ledger','Exhibit IV'], download:['V','Access','Exhibit V'], architect:['VI','The Architect','Exhibit VI']
};
const railLinks = [...document.querySelectorAll('.rail a')];
let activeChapter = '', cardTimer = 0, cardPending = null, lastCardAt = 0;
function setChapter(id){
  if (id === activeChapter) return;
  activeChapter = id;
  railLinks.forEach(a => a.classList.toggle('on', a.dataset.rail === id));
  try { window.dispatchEvent(new CustomEvent('asheo:chapter', { detail:id })); } catch(e){}
  // Cinematic chapter card — fires only after the chapter HOLDS 350ms.
  // Boundary flapping during continuous scroll used to strobe it; the
  // dwell guarantees one clean card per deliberate arrival.
  clearTimeout(cardTimer); cardPending = id;
  if (!reduce && !document.hidden && scrollY > 40){
    const pending = id;
    cardTimer = setTimeout(() => {
      if (cardPending !== pending || activeChapter !== pending) return;
      if (lastCardAt && performance.now() - lastCardAt <= 2200) return;
      fireCard(pending);
    }, 350);
  }
}
function fireCard(id){
  const card = document.getElementById('chapterCard');
  if (!card || document.hidden) return;
  const meta = CHAPTER_META[id];
  if (!meta) return;
  const num = card.querySelector('.cc-num'), name = card.querySelector('.cc-name'), sub = card.querySelector('.cc-sub');
  if (!num || !name) return;
  lastCardAt = performance.now();
  num.textContent = meta[0]; name.textContent = meta[1]; if (sub) sub.textContent = meta[2];
  try { card.getAnimations({ subtree:true }).forEach(a => { try { a.cancel(); } catch(_){} }); } catch(e){}
  card.style.visibility = 'visible';
  try {
    const anims = [];
    card.querySelectorAll('.cc-bar').forEach(bar => {
      anims.push(bar.animate(
        [{ transform:'scaleY(0)' }, { transform:'scaleY(1)', offset:.2 }, { transform:'scaleY(1)', offset:.7 }, { transform:'scaleY(0)' }],
        { duration:1900, easing:'cubic-bezier(.65,0,.35,1)' }));
    });
    const mid = card.querySelector('.cc-mid');
    if (mid) anims.push(mid.animate(
      [{ opacity:0, transform:'translateY(26px)' }, { opacity:1, transform:'translateY(0)', offset:.28 },
       { opacity:1, transform:'translateY(0)', offset:.68 }, { opacity:0, transform:'translateY(-22px)' }],
      { duration:1900, easing:'cubic-bezier(.22,1,.36,1)' }));
    const rule = card.querySelector('.cc-rule');
    if (rule) anims.push(rule.animate(
      [{ transform:'scaleX(0)', opacity:1 }, { transform:'scaleX(1)', opacity:1, offset:.3 },
       { transform:'scaleX(1)', opacity:1, offset:.68 }, { transform:'scaleX(1)', opacity:0 }],
      { duration:1900, easing:'cubic-bezier(.22,1,.36,1)' }));
    const stamp = lastCardAt, tail = anims[anims.length-1];
    if (tail) tail.onfinish = () => { if (lastCardAt === stamp) card.style.visibility = 'hidden'; };
    else card.style.visibility = 'hidden';
  } catch(e){
    setTimeout(() => { card.style.visibility = 'hidden'; }, 1950);
  }
}
if ('IntersectionObserver' in window){
  const railIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) setChapter(e.target.id);
  }), { threshold:.14, rootMargin:'-28% 0px -50% 0px' });
  ['top','kit','how','ledger','download','architect'].forEach(id => {
    const el = document.getElementById(id); if (el) railIO.observe(el);
  });
}

/* ═══ REVEAL + ENTRY CHIME ═══ */
const rvEls = document.querySelectorAll('.rv');
if (!('IntersectionObserver' in window)){
  rvEls.forEach(el => el.classList.add('in'));
} else {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold:.1, rootMargin:'0px 0px -6% 0px' });
  rvEls.forEach(el => io.observe(el));
}
if ('IntersectionObserver' in window){
  const chimeIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) chime(440 + Math.random()*180, .035);
  }), { threshold:.35 });
  document.querySelectorAll('section[id]').forEach(s => chimeIO.observe(s));
}

/* ═══ GOLD LEAF · LEDGER ═══ */
const leaf = document.getElementById('goldLeaf');
// Rect cached: reading it inside pointermove forced a synchronous layout on every
// mouse move. It only changes on resize/scroll, so recompute it there instead.
let ledgerRect = null, leafX = 0, leafY = 0, leafDirty = false, lastLeafT = '';
const ledgerEl = document.getElementById('ledger');
const invalidateLedgerRect = () => { ledgerRect = null; };
addEventListener('resize', invalidateLedgerRect);
addEventListener('scroll', invalidateLedgerRect, { passive: true });
function flushLedgerLeaf(){
  if (!leafDirty || !leaf) return;
  leafDirty = false;
  // A 520px box translated under the cursor — no full-section gradient repaint.
  const t = `translate3d(${leafX.toFixed(1)}px,${leafY.toFixed(1)}px,0)`;
  if (t !== lastLeafT){ lastLeafT = t; leaf.style.transform = t; }
}
ledgerEl?.addEventListener('pointermove', e => {
  if (!ledgerRect) ledgerRect = ledgerEl.getBoundingClientRect();
  const r = ledgerRect;
  leafX = e.clientX - r.left; leafY = e.clientY - r.top; leafDirty = true;
});

/* ═══ WAX SEAL ═══ */
const stampBtn = document.getElementById('stampBtn'), wax = document.getElementById('wax');
const waxShock = document.getElementById('waxShock'), stampZone = document.getElementById('stampZone');
try {
  if (stampZone && wax && sessionStorage.getItem('asheo-sealed') === serial){
    stampZone.classList.add('done'); wax.classList.add('on');
  }
} catch(e){}
function seal(){
  if (!stampZone || !wax || stampZone.classList.contains('done')) return;
  stampZone.classList.add('done');
  wax.classList.add('on');
  if (waxShock) waxShock.classList.add('on');
  try { sessionStorage.setItem('asheo-sealed', serial); } catch(e){}
  chime(147,.12); setTimeout(()=>chime(220,.06),90);
  const r = wax.getBoundingClientRect();
  burst(r.left + r.width/2, r.top + r.height/2, 40, ['#96322C','#C4544A','#C9A86A','#FFF3D6']);
  toastMsg('Sealed — copy ' + serial + ' is yours.');
}
if (stampBtn) stampBtn.addEventListener('click', seal);

/* ═══ SOUND ENGINE ═══ */
let audioOn = false, actx = null, master = null;
const soundBtn = document.getElementById('sound');
const SOUND_KEY = 'asheo-sound';
function readSoundPref(){ try { return localStorage.getItem(SOUND_KEY) === '1'; } catch(e){ return false; } }
function writeSoundPref(on){ try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch(e){} }
function paintSound(on){
  if (!soundBtn) return;
  soundBtn.classList.toggle('on', on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
}
function toggleSound(){
  audioOn = !audioOn;
  paintSound(audioOn);
  writeSoundPref(audioOn);
  if (audioOn){ ensureCtx(); chime(659,.09); toastMsg('Sound on — glass & brass.'); }
  else toastMsg('Sound off.');
}
paintSound(readSoundPref());
if (readSoundPref()){
  // Browsers only allow audio after a gesture: arm the saved preference on the
  // first pointer or key press instead of surprising anyone with silence.
  const arm = () => {
    removeEventListener('pointerdown', arm); removeEventListener('keydown', arm);
    if (readSoundPref() && !audioOn){ audioOn = true; ensureCtx(); paintSound(true); }
  };
  addEventListener('pointerdown', arm); addEventListener('keydown', arm);
}
if (soundBtn) soundBtn.addEventListener('click', toggleSound);
function ensureCtx(){
  if (actx) return;
  try {
    actx = new (window.AudioContext||window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = .5;
    const verb = actx.createConvolver();
    const len = actx.sampleRate*1.6, buf = actx.createBuffer(2, len, actx.sampleRate);
    for (let c=0;c<2;c++){ const d = buf.getChannelData(c);
      for (let i=0;i<len;i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 2.6); }
    verb.buffer = buf;
    const wet = actx.createGain(); wet.gain.value = .35;
    master.connect(actx.destination); master.connect(verb); verb.connect(wet); wet.connect(actx.destination);
  } catch(e){ actx = null; }
}
function chime(freq, gain){
  if (!audioOn || !actx) return;
  const now = actx.currentTime;
  [1, 2.01, 3.02].forEach((mult, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = i ? 'sine' : 'triangle'; o.frequency.value = freq*mult;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain/(i+1.4), now + .012);
    g.gain.exponentialRampToValueAtTime(.0001, now + 1.4 - i*.3);
    o.connect(g).connect(master); o.start(now); o.stop(now + 1.5);
  });
}

/* ═══ 3D GOLD FOIL CONFETTI ═══ */
const cvs = document.getElementById('confetti'), ctx = cvs.getContext('2d');
let parts = [], raf = null;
function sizeC(){
  const d = Math.min(devicePixelRatio||1, 1.5);
  cvs.width = innerWidth*d; cvs.height = innerHeight*d;
  ctx.setTransform(d,0,0,d,0,0);
}
sizeC(); addEventListener('resize', sizeC);
cvs.style.visibility = 'hidden'; // shown by burst(); hidden skips compositing
const GOLD = ['#C9A86A','#FFF3D6','#EADFC6','#F5F2EB','#A98A4F','#ffffff'];
function burst(x, y, n, palette){
  if (reduce || document.hidden) return;
  const pal = palette || GOLD, N = n || (innerWidth < 640 ? 80 : 145);
  if (parts.length > 220) parts.splice(0, parts.length - 220);
  for (let i=0;i<N;i++){
    const ang = -Math.PI/2 + (Math.random()-.5)*2.4, sp = 5 + Math.random()*14;
    parts.push({ x, y, z: Math.random()*440-140,
      vx: Math.cos(ang)*sp + (Math.random()-.5)*2, vy: Math.sin(ang)*sp, vz: (Math.random()-.5)*8,
      w: 4+Math.random()*10, h: 1.6+Math.random()*5,
      rot: Math.random()*6.28, vr: (Math.random()-.5)*.5, ph: Math.random()*6.28,
      col: pal[(Math.random()*pal.length)|0], life: 1, dec: .005+Math.random()*.007 });
  }
  cvs.style.visibility = '';
  if (!raf) raf = requestAnimationFrame(tickC);
}
function tickC(){
  ctx.clearRect(0,0,innerWidth,innerHeight);
  parts = parts.filter(p => p.life > 0 && p.y < innerHeight+100);
  parts.sort((a,b) => b.z - a.z);
  for (const p of parts){
    p.vy += .3; p.vx *= .993; p.vz *= .99;
    p.x += p.vx; p.y += p.vy; p.z += p.vz; p.rot += p.vr; p.ph += .21; p.life -= p.dec;
    const k = 640/(640+p.z), flick = .5 + .5*Math.abs(Math.sin(p.ph));
    ctx.save();
    ctx.globalAlpha = Math.max(p.life,0)*flick*Math.min(1,k);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.scale(k*(Math.cos(p.ph)*.55+.75), k);
    ctx.fillStyle = p.col;
    ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
    ctx.restore();
  }
  if (!parts.length){ ctx.clearRect(0,0,innerWidth,innerHeight); raf = null; cvs.style.visibility = 'hidden'; return; }
  raf = requestAnimationFrame(tickC);
}

/* ═══ CTA · RIPPLE + TOAST ═══ */
const toast = document.getElementById('toast'), toastTxt = document.getElementById('toastTxt');
let toastTimer = null;
function toastMsg(msg){
  toastTxt.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
document.querySelectorAll('[data-cta]').forEach(btn => {
  btn.addEventListener('click', e => {
    const r = btn.getBoundingClientRect();
    const rip = document.createElement('span');
    rip.className = 'ripple';
    rip.style.left = (e.clientX-r.left)+'px'; rip.style.top = (e.clientY-r.top)+'px';
    rip.style.width = rip.style.height = '18px';
    btn.appendChild(rip); setTimeout(() => rip.remove(), 700);
    if (!reduce) burst(r.left + r.width/2, r.top + r.height/2);
    chime(880,.09); setTimeout(()=>chime(1174,.05),110);
    toastMsg('Added to Chrome — welcome to ASHEO.');
    // window.location.href = 'assets/asheo.zip';
  });
});

/* ═══ EASTER EGG · COLLECTOR MODE ═══ */
function collector(){
  for (let i=0;i<9;i++) setTimeout(() => burst(Math.random()*innerWidth, -30, 34), i*130);
  [523,659,784,1046].forEach((f,i) => setTimeout(() => chime(f,.07), i*130));
  // Gold veil flash — reuses the curtain (no new layers), guarded so it
  // never steals a navigation wipe already in flight.
  if (curtain && !reduce && !curtain.classList.contains('in')){
    curtain.dataset.tint = 'download';
    curtain.style.setProperty('--cx', Math.round(innerWidth/2)+'px');
    curtain.style.setProperty('--cy', Math.round(innerHeight*.4)+'px');
    curtain.classList.add('in');
    setTimeout(() => { curtain.classList.remove('in'); curtain.removeAttribute('data-tint'); }, 750);
  }
  toastMsg('Collector mode — ' + serial + ' / 500.');
}
let keys = '', lastKey = 0;
addEventListener('keydown', e => {
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (performance.now() - lastKey > 1600) keys = '';
  lastKey = performance.now();
  keys = (keys + e.key).slice(-6).toLowerCase();
  if (keys.endsWith('ash')){
    keys = '';
    ensureCtx();
    collector();
  }
});

/* ═══ COMMAND PALETTE (Cmd/Ctrl+K or "/") ═══ */
const pal = document.getElementById('palette'), palInput = document.getElementById('paletteInput'), palList = document.getElementById('paletteList');
if (pal && palInput && palList){
  const palItems = [...palList.querySelectorAll('button')];
  let palOpen = false, palOpener = null;
  const palFilter = () => {
    const q = palInput.value.trim().toLowerCase();
    let first = null;
    palItems.forEach(it => {
      const hit = !q || (it.textContent || '').toLowerCase().indexOf(q) >= 0;
      it.classList.toggle('hide', !hit);
      it.classList.remove('sel'); it.setAttribute('aria-selected', 'false');
      if (hit && !first) first = it;
    });
    if (first){ first.classList.add('sel'); first.setAttribute('aria-selected', 'true'); }
  };
  const openPal = () => {
    if (palOpen) return; palOpen = true; palOpener = document.activeElement;
    document.documentElement.classList.add('palette-open');
    pal.hidden = false; palInput.value = ''; palFilter();
    setTimeout(() => palInput.focus(), 30);
  };
  const closePal = () => {
    if (!palOpen) return; palOpen = false; pal.hidden = true;
    document.documentElement.classList.remove('palette-open');
    if (palOpener && palOpener.isConnected && palOpener.focus) palOpener.focus({ preventScroll:true });
  };
  const runItem = it => {
    const go = it.dataset.goto, act = it.dataset.act;
    closePal();
    if (go){
      const dest = document.getElementById(go);
      if (dest){
        dest.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block:'start' });
        try { history.pushState(null, '', '#'+go); } catch(e){}
      }
    }
    else if (act === 'sound') toggleSound();
    else if (act === 'seal'){
      const lg = document.getElementById('ledger');
      if (lg && !reduce){ lg.scrollIntoView({ behavior:'smooth', block:'start' }); setTimeout(seal, 650); }
      else seal();
    }
    else if (act === 'collector') collector();
  };
  const moveSel = d => {
    const vis = palItems.filter(i => !i.classList.contains('hide'));
    if (!vis.length) return;
    let ix = vis.findIndex(i => i.classList.contains('sel'));
    ix = ix < 0 ? (d === 1 ? 0 : vis.length-1) : (ix+d+vis.length) % vis.length;
    vis.forEach(i => { i.classList.remove('sel'); i.setAttribute('aria-selected', 'false'); });
    vis[ix].classList.add('sel'); vis[ix].setAttribute('aria-selected', 'true');
    vis[ix].scrollIntoView({ block:'nearest' });
  };
  palInput.addEventListener('input', palFilter);
  palInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown'){ e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter'){
      e.preventDefault();
      const s = palItems.find(i => i.classList.contains('sel') && !i.classList.contains('hide')) ||
                palItems.find(i => !i.classList.contains('hide'));
      if (s) runItem(s);
    }
    else if (e.key === 'Escape'){ e.preventDefault(); closePal(); }
    else if (palInput.value === '' && e.key >= '1' && e.key <= '6'){
      const s = palItems[Number(e.key)-1]; // the six chapters, in order
      if (s && !s.classList.contains('hide')) runItem(s);
    }
  });
  palList.addEventListener('click', e => {
    const it = e.target.closest ? e.target.closest('button') : null;
    if (it) runItem(it);
  });
  pal.addEventListener('click', e => { if (e.target === pal) closePal(); });
  addEventListener('keydown', e => {
    const inField = e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); palOpen ? closePal() : openPal(); }
    else if (e.key === '/' && !palOpen && !inField && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); openPal(); }
    else if (e.key === 'Escape' && palOpen){ e.preventDefault(); closePal(); }
  });
}

/* ═══ MOBILE MENU ═══ */
const menuBtn = document.getElementById('menuBtn'), mmenu = document.getElementById('mmenu');
function setMenu(open){
  if (!menuBtn || !mmenu) return;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  mmenu.classList.toggle('open', open);
  mmenu.setAttribute('aria-hidden', String(!open));
  if (open){
    document.body.classList.add('locked');
    const f = mmenu.querySelector('a');
    if (f) setTimeout(() => f.focus({ preventScroll:true }), 120);
  } else if (!document.getElementById('pre')){
    document.body.classList.remove('locked'); // the vault owns `locked` until it opens
  }
}
if (menuBtn && mmenu){
  menuBtn.addEventListener('click', () => setMenu(!mmenu.classList.contains('open')));
  mmenu.addEventListener('click', e => { if (e.target.closest && e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && mmenu.classList.contains('open')){ setMenu(false); menuBtn.focus({ preventScroll:true }); }
  });
  addEventListener('resize', () => { if (innerWidth > 1000 && mmenu.classList.contains('open')) setMenu(false); }, { passive:true });
}

/* ═══ CLICK SHOCKWAVE · gold ring bloom, WAAPI transform/opacity only ═══ */
if (!reduce){
  let lastShock = 0;
  addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && e.detail === 0) return;
    if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],dialog,.palette')) return;
    const now = performance.now();
    if (now - lastShock < 140) return;
    lastShock = now;
    const ring = document.createElement('span');
    ring.className = 'shock'; ring.setAttribute('aria-hidden', 'true');
    ring.style.left = e.clientX+'px'; ring.style.top = e.clientY+'px';
    document.body.appendChild(ring);
    try {
      const an = ring.animate(
        [{ transform:'translate(-50%,-50%) scale(0.15)', opacity:.85 },
         { transform:'translate(-50%,-50%) scale(1)', opacity:0 }],
        { duration:650, easing:'cubic-bezier(.22,1,.36,1)' });
      an.onfinish = () => ring.remove();
      an.oncancel = () => ring.remove();
    } catch(_){ setTimeout(() => ring.remove(), 700); }
  }, { passive:true });
}

/* ═══ HEADLINE TELEKINESIS · glyphs lean away via independent `translate`,
   so the entrance `transform` is never disturbed. Desktop hover only. ═══ */
if (fine && !reduce){
  const hChars = [...document.querySelectorAll('#h1 .ch')];
  const heroElT = document.querySelector('.hero');
  let hCenters = [], hCacheAt = 0, hVisible = true, hMx = 0, hMy = 0, hQueued = false;
  const hWaved = new Set();
  if (heroElT) watch(heroElT, v => {
    hVisible = v;
    if (!v){ hWaved.forEach(el => { el.style.translate = ''; }); hWaved.clear(); }
  });
  const hApply = () => {
    hQueued = false;
    if (!hVisible || !hChars.length) return;
    const now = performance.now();
    if (now - hCacheAt > 200 || !hCenters.length){
      hCenters = hChars.map(el => {
        const r = el.getBoundingClientRect();
        return { x:r.left + r.width/2, y:r.top + r.height/2 };
      });
      hCacheAt = now;
    }
    const R = 190;
    for (let i=0;i<hChars.length;i++){
      const c = hCenters[i], el = hChars[i];
      if (!c || !el) continue;
      const d = Math.hypot(hMx - c.x, hMy - c.y);
      if (d < R){
        const w = -13 * Math.pow(Math.cos((d/R)*Math.PI/2), 2);
        el.style.translate = `0 ${w.toFixed(1)}px`;
        hWaved.add(el);
      } else if (hWaved.has(el)){ el.style.translate = ''; hWaved.delete(el); }
    }
  };
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    hMx = e.clientX; hMy = e.clientY;
    if (hQueued) return; hQueued = true; requestAnimationFrame(hApply);
  }, { passive:true });
  addEventListener('scroll', () => { hCacheAt = 0; }, { passive:true }); // stale centers spray offsets
}

/* ═══ MAGNETIC RAIL · chapter links lean toward the cursor on Y ═══ */
if (fine && !reduce){
  const railAs = [...document.querySelectorAll('.rail a')];
  if (railAs.length){
    // The rail is position:fixed — centers never move on scroll, so cache them
    // once (refresh on resize) instead of reading layout per frame.
    let railMy = -9999, railJob = false;
    let railCenters = railAs.map(a => { const r = a.getBoundingClientRect(); return r.top + r.height/2; });
    const railOffsets = new Map();
    const railRender = () => {
      railJob = false;
      for (let i=0;i<railAs.length;i++){
        const a = railAs[i], d = railMy - (railCenters[i] ?? -9999);
        const pull = Math.abs(d) < 130 ? d*.12 : 0;
        const next = Math.abs(pull) < .4 ? 0 : pull;
        const prev = railOffsets.has(a) ? railOffsets.get(a) : -1;
        if (next !== prev){ railOffsets.set(a, next); a.style.translate = next ? `0 ${next.toFixed(1)}px` : ''; }
      }
    };
    addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      railMy = e.clientY;
      if (!railJob){ railJob = true; requestAnimationFrame(railRender); }
    }, { passive:true });
    addEventListener('resize', () => {
      railCenters = railAs.map(a => { const r = a.getBoundingClientRect(); return r.top + r.height/2; });
    }, { passive:true });
    document.documentElement.addEventListener('pointerleave', () => {
      railMy = -9999;
      if (!railJob){ railJob = true; requestAnimationFrame(railRender); }
    });
  }
}

/* ═══ PARALLAX · data-speed elements drift on the independent `translate`
   property, so they compose with (never clobber) reveal transforms. Offsets
   are cached — each scroll frame is math plus compositor writes only. ═══ */
const h1Stage = document.querySelector('.h1-stage');
const heroArt = document.querySelector('.hero .artifact-wrap');
const heroArtifact = document.querySelector('.hero .artifact-wrap .artifact');
const heroSec = document.querySelector('.hero');
let pxSpots = [], pxTick = false, heroVisible = true, heroBottom = innerHeight;
function recalcParallax(){
  const sy = scrollY; pxSpots = [];
  if (heroSec){
    const hr = heroSec.getBoundingClientRect();
    heroBottom = hr.height > 0 ? hr.top + sy + hr.height : innerHeight;
  }
  document.querySelectorAll('[data-speed]').forEach(el => {
    const sp = parseFloat(el.dataset.speed || '0');
    if (!sp) return;
    const r = el.getBoundingClientRect();
    if (r.height > 0) pxSpots.push({ el, sp, top:r.top + sy, h:r.height });
  });
}
function paintParallax(){
  pxTick = false;
  if (reduce) return;
  const y = scrollY, vh = innerHeight;
  if (heroVisible){
    const t = clamp(y/Math.max(heroBottom, 1), 0, 1);
    if (h1Stage) h1Stage.style.translate = t > 0 ? `0 ${(t*90).toFixed(1)}px` : '';
    if (heroArt && heroArt.classList.contains('in')){
      heroArt.style.translate = t > 0 ? `0 ${(t*-60).toFixed(1)}px` : '';
      // The INNER artifact fades: reveal owns the wrapper's opacity.
      if (heroArtifact) heroArtifact.style.opacity = t > .82 ? String(Math.max(.05, 1-(t-.82)*5)) : '';
    }
  }
  for (const s of pxSpots){
    if (s.top + s.h < y-200 || s.top > y+vh+200) continue;
    const c = ((s.top + s.h/2) - (y + vh/2))/vh;
    s.el.style.translate = `0 ${(-c*s.sp*120).toFixed(1)}px`;
  }
}
function wakeParallax(){ if (!pxTick && !reduce){ pxTick = true; requestAnimationFrame(paintParallax); } }
if (!reduce){
  recalcParallax();
  if (heroSec) watch(heroSec, v => {
    heroVisible = v;
    if (!v){ if (h1Stage) h1Stage.style.translate = ''; if (heroArt) heroArt.style.translate = ''; if (heroArtifact) heroArtifact.style.opacity = ''; }
  });
  addEventListener('scroll', wakeParallax, { passive:true });
  let pxRsT = 0;
  addEventListener('resize', () => { clearTimeout(pxRsT); pxRsT = setTimeout(() => { recalcParallax(); wakeParallax(); }, 150); }, { passive:true });
  addEventListener('load', () => { recalcParallax(); wakeParallax(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { recalcParallax(); wakeParallax(); }).catch(()=>{});
}

/* ═══ DITHER HOVER (unchanged behavior, plus a hover flag for blinks) ═══ */
const ditherEl = document.getElementById('dither-dev');
let ditherHovering = false;
if (ditherEl){
  const w = ditherEl.closest('.dev-ash-right');
  const bp = parseFloat(ditherEl.getAttribute('pixel-size')) || 2.0;
  const bc = parseFloat(ditherEl.getAttribute('contrast')) || 1.24;
  const bb = parseFloat(ditherEl.getAttribute('brightness')) || 0;
  const bl = ditherEl.getAttribute('light') || '#f5f2eb';
  ditherEl._ditherBase = { px:String(bp), co:String(bc), br:String(bb), li:bl };

  // Each setAttribute on <dither-bg> triggers attributeChangedCallback → a WebGL
  // redraw, so the old handler could force FOUR redraws per mousemove event, plus a
  // synchronous layout for the rect. Now: cache the rect, coalesce to one flush per
  // frame from the master loop, and only write an attribute whose value changed.
  let dRect = null, dPending = null;
  const invalidate = () => { dRect = null; };
  addEventListener('resize', invalidate);
  addEventListener('scroll', invalidate, { passive: true });

  const setAttr = (name, value) => {
    if (ditherEl.getAttribute(name) !== value) ditherEl.setAttribute(name, value);
  };
  const applyDither = (d) => {
    ditherEl._ditherD = d;
    // The lens breathes around the markup defaults instead of jamming to a
    // fixed range — smooth at any authored pixel-size or brightness.
    setAttr('pixel-size', clamp(bp - (.55-d)*.9, bp*.62, bp*1.25).toFixed(2));
    setAttr('contrast', (bc + (.5-d)*.12).toFixed(2));
    setAttr('brightness', (bb + (.5-d)*.04).toFixed(3));
    setAttr('light', d < .32 ? '#fff4d6' : bl);
  };
  flushDither = () => {
    if (dPending === null) return;
    const d = dPending; dPending = null;
    applyDither(d);
  };

  w?.addEventListener('mousemove', e => {
    if (!w) return;
    ditherHovering = true;
    if (!dRect) dRect = w.getBoundingClientRect();
    const r = dRect;
    const nx = (e.clientX-r.left)/r.width - .5, ny = (e.clientY-r.top)/r.height - .5;
    dPending = Math.hypot(nx, ny);
  });
  w?.addEventListener('mouseleave', () => {
    ditherHovering = false;
    dPending = null;
    ditherEl._ditherD = null;
    ditherEl.setAttribute('pixel-size', String(bp));
    ditherEl.setAttribute('contrast', String(bc));
    ditherEl.setAttribute('brightness', String(bb));
    ditherEl.setAttribute('light', bl);
  });
}

/* ═══ PORTRAIT BLINKS · the architect looks alive when unattended ═══ */
if (!reduce && ditherEl){
  let archVis = false;
  watch(document.getElementById('architect'), v => { archVis = v; });
  (function blinkLoop(){
    setTimeout(() => {
      // A blink is "unattended" ambiance: never while the pointer is over the
      // portrait, and never within 2.5s of scrolling — mid-motion the dip
      // reads as a glitch instead of a blink. The animation itself is kept.
      if (archVis && !ditherHovering && !document.hidden && performance.now() - lastScrollAt > 2500){
        ditherEl.setAttribute('brightness', '-0.30');
        setTimeout(() => {
          const base = (ditherEl._ditherBase && ditherEl._ditherBase.br) || '-0.01';
          const dd = ditherEl._ditherD;
          // If the pointer landed mid-blink, hand ownership back to the hover
          // lens at its current depth instead of stranding the dip value.
          if (ditherHovering && dd != null) ditherEl.setAttribute('brightness', (parseFloat(base) + (.5-dd)*.04).toFixed(3));
          else if (!ditherHovering) ditherEl.setAttribute('brightness', base);
        }, 140);
      }
      blinkLoop();
    }, 5200 + Math.random()*4200);
  })();
}

/* Off-screen sections stop animating. Ten infinite CSS animations run on this
   page — orbit spin, coin spin, foil sweep, float3d and friends — and the
   compositor keeps working on every one of them even when they are thousands of
   pixels away. Pausing by section is coarse but safe: nothing visible changes. */
if ('IntersectionObserver' in window) {
  const idle = new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.classList.toggle('anim-idle', !e.isIntersecting);
      if (e.target.id === 'kit') orbOnScreen = e.isIntersecting;
    }
  }, { rootMargin: '100px' });
  document.querySelectorAll('section, .dev-arch, footer').forEach((el) => idle.observe(el));
}

requestAnimationFrame(loop);
})();

/* Asheo wiring: the template's [data-cta] handler only drew a ripple, so the
   buttons navigated nowhere. Keep the ripple, add the navigation, and replace
   the hard-coded star rating with the real counter the Worker already serves
   (same /v1/downloads endpoint the download page uses). */
(function () {
  document.querySelectorAll('[data-cta][data-href]').forEach(function (b) {
    b.style.cursor = 'pointer';
    b.addEventListener('click', function () {
      var u = b.getAttribute('data-href');
      setTimeout(function () { window.location.href = u; }, 180); /* let the ripple play */
    });
  });
  var els = document.querySelectorAll('[data-dlcount]');
  if (!els.length) return;
  fetch('https://asheo-license.asheo-server-ext.workers.dev/v1/downloads').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || typeof d.total !== 'number') return;
    els.forEach(function (e) { e.textContent = d.total.toLocaleString(); });
  }).catch(function () {
    els.forEach(function (e) { var p = e.closest('.artifact-trust'); if (p) p.style.display = 'none'; });
  });
})();
