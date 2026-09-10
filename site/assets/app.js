(() => {
'use strict';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine   = matchMedia('(hover:hover) and (pointer:fine)').matches;
const touch  = matchMedia('(pointer:coarse)').matches;
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

/* ═══ SERIAL / EDITION NUMBER ═══ */
const serial = 'ASH-01-' + Math.random().toString(16).slice(2,6).toUpperCase() +
               '-' + String(Math.floor(Math.random()*400)+1).padStart(3,'0');
document.querySelectorAll('[data-serial]').forEach(el => el.textContent = serial);
document.getElementById('plateSerial').textContent = serial + ' / 500';

/* ═══ CHAR SPLIT ═══ */
document.querySelectorAll('[data-split]').forEach(el => {
  const txt = el.textContent, frag = document.createDocumentFragment();
  [...txt].forEach((c,i) => {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = c;
    s.style.transitionDelay = (i*0.028).toFixed(3)+'s';
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
let glOK = false, glDraw = null;
(function initGL(){
  if (lowPower || reduce) { document.documentElement.classList.add('no-gl'); return; }
  const gl = glCanvas.getContext('webgl', {antialias:false, alpha:true, powerPreference:'high-performance'});
  if (!gl) { document.documentElement.classList.add('no-gl'); return; }

  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const FS = `precision highp float;
  uniform vec2 R; uniform float T; uniform vec2 M; uniform float S;
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

    /* violet counter-light, bottom-left */
    col += vec3(0.36,0.20,0.62) * exp(-length(uv - vec2(-0.7,0.55))*2.6) * 0.10;

    /* fine dither + vignette */
    float g = (hash(gl_FragCoord.xy + T) - 0.5) * 0.028;
    col += g;
    col *= 1.0 - smoothstep(0.55, 1.35, length(uv)*0.95);

    gl_FragColor = vec4(col, 1.0);
  }`;

  const mk = (t,src) => { const s = gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { document.documentElement.classList.add('no-gl'); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog,'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uR = gl.getUniformLocation(prog,'R'), uT = gl.getUniformLocation(prog,'T'),
        uM = gl.getUniformLocation(prog,'M'), uS = gl.getUniformLocation(prog,'S');
  const SCALE = 0.62;
  function size(){
    const w = Math.round(innerWidth*SCALE), h = Math.round(innerHeight*SCALE);
    glCanvas.width = w; glCanvas.height = h;
    gl.viewport(0,0,w,h); gl.uniform2f(uR, w, h);
  }
  size(); addEventListener('resize', size);
  let gmx = 0, gmy = 0;
  glDraw = (t, mx, my, s) => {
    gmx = lerp(gmx, mx*SCALE, .06); gmy = lerp(gmy, (innerHeight-my)*SCALE, .06);
    gl.uniform1f(uT, t); gl.uniform2f(uM, gmx, gmy); gl.uniform1f(uS, s);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  glOK = true;
})();

/* ═══ INERTIAL SMOOTH SCROLL (Lenis-class) ═══ */
const skewer = document.getElementById('skewer');
let skewIdle = false;
let vel = 0, lastY = scrollY;
const smoothOn = false;   // kept as a flag: other effects read it for scroll velocity
addEventListener('scroll', () => {
  const y = scrollY;
  vel = vel * .6 + (y - lastY) * .4;   // smoothed, for the skew and the ring
  lastY = y;
}, { passive: true });                 // passive: never blocks the compositor
// Anchor links keep the curtain wipe, but the jump itself is native.
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href === '#') return;
    const el = document.querySelector(href);
    if (!el) return;
    e.preventDefault();
    wipe(e.clientX || innerWidth/2, e.clientY || innerHeight/2, () => {
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });
});

/* ═══ CURTAIN WIPE ═══ */
const curtain = document.getElementById('curtain');
function wipe(x, y, mid){
  if (reduce){ mid && mid(); return; }
  curtain.style.setProperty('--cx', x+'px');
  curtain.style.setProperty('--cy', y+'px');
  curtain.classList.add('in');
  chime(392,.05);
  setTimeout(() => { mid && mid(); }, 620);
  setTimeout(() => curtain.classList.remove('in'), 900);
}

/* ═══ MASTER LOOP ═══ */
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

  if (glOK) glDraw(t, mouseX, mouseY, (scrollY/Math.max(1,document.body.scrollHeight-innerHeight)));
  if (mouseDirty){
    // On :root these invalidate style for every element referencing them; .spot is
    // the only consumer, so scope the write to it.
    const sp = spotEl || (spotEl = document.querySelector('.spot'));
    if (sp){ sp.style.setProperty('--mx', mouseX+'px'); sp.style.setProperty('--my', mouseY+'px'); }
    mouseDirty = false;
  }
  drawDust();
  orbFrame();
  cursorFrame();
  flushLedgerLeaf();
  flushDither();
  requestAnimationFrame(loop);
}

/* ═══ CURSOR + GOLD DUST TRAIL ═══ */
const cur = document.getElementById('cur'), curRing = document.getElementById('curRing');
let mouseX = innerWidth/2, mouseY = innerHeight/2, rx = mouseX, ry = mouseY, mvx = 0, mvy = 0;
const dustC = document.getElementById('dust'), dctx = dustC.getContext('2d');
let motes = [], ddpr = 1;
function sizeDust(){
  ddpr = Math.min(devicePixelRatio||1, 1.75);
  dustC.width = innerWidth*ddpr; dustC.height = innerHeight*ddpr;
  dctx.setTransform(ddpr,0,0,ddpr,0,0);
}
sizeDust(); addEventListener('resize', sizeDust);
let mouseDirty = false, spotEl = null;
addEventListener('pointermove', e => {
  mvx = e.clientX - mouseX; mvy = e.clientY - mouseY;
  mouseX = e.clientX; mouseY = e.clientY;
  // NOT written here: these are :root custom properties, so each write invalidates
  // style for every element that reads them. A fast mouse fires many events per
  // frame; the master loop flushes them once instead.
  mouseDirty = true;
  const nx = mouseX/innerWidth - .5, ny = mouseY/innerHeight - .5;
  const h1 = document.getElementById('h1');
  if (h1 && fine) h1.style.transform = `rotateY(${nx*10}deg) rotateX(${-ny*7}deg) translateZ(34px)`;
  const wm = document.getElementById('wm');
  if (wm && fine) wm.style.transform = `rotateY(${nx*14}deg) rotateX(${-ny*7}deg)`;
  if (fine && !reduce && Math.hypot(mvx,mvy) > 6 && motes.length < 160){
    for (let i=0;i<2;i++) motes.push({
      x: mouseX + (Math.random()-.5)*10, y: mouseY + (Math.random()-.5)*10,
      vx: mvx*.06 + (Math.random()-.5)*.6, vy: mvy*.06 + (Math.random()-.5)*.6 - .25,
      s: Math.random()*1.7+.5, life: 1, dec: .012+Math.random()*.02
    });
  }
}, {passive:true});
let dustPainted = false;
function drawDust(){
  if (!motes.length){
    // Clear once on the way down, then stop touching the canvas.
    if (dustPainted) { dctx.clearRect(0,0,innerWidth,innerHeight); dustPainted = false; }
    return;
  }
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
  cur.style.transform = `translate(${mouseX-2.5}px,${mouseY-2.5}px)`;
  curRing.style.transform = `translate(${rx-18}px,${ry-18}px)`;
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

/* ═══ MAGNETIC + LIQUID BUTTONS ═══ */
if (fine && !reduce) document.querySelectorAll('[data-mag]').forEach(el => {
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - r.left - r.width/2)/r.width, dy = (e.clientY - r.top - r.height/2)/r.height;
    el.style.transform = `translate3d(${dx*9}px,${dy*7}px,26px)`;
    el.style.setProperty('--bx', ((e.clientX-r.left)/r.width*100)+'%');
    el.style.setProperty('--by', ((e.clientY-r.top)/r.height*100)+'%');
  });
  el.addEventListener('pointerleave', () => el.style.transform = '');
});

/* ═══ PRELOADER · TUMBLERS ═══ */
const pre = document.getElementById('pre'), preNum = document.getElementById('preNum');
const preState = document.getElementById('preState'), tumblers = document.getElementById('tumblers');
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
    document.getElementById('dialRing').style.transform = `rotate(${p*6.2}deg)`;
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
    el.innerHTML = '';
    if (pfx){ const s = document.createElement('span'); s.className='fx'; s.innerHTML = pfx; el.appendChild(s); }
    [...digits].forEach((d, i) => {
      if (dot && i === 1){ const s = document.createElement('span'); s.className='fx'; s.textContent='.'; el.appendChild(s); }
      const col = document.createElement('span'); col.className = 'col';
      const strip = document.createElement('b');
      strip.innerHTML = Array.from({length:11},(_,k)=>`<span style="display:block;height:30px;line-height:30px">${k%10}</span>`).join('');
      strip.style.height = 'auto';
      col.appendChild(strip); el.appendChild(col);
      requestAnimationFrame(() => {
        strip.style.transitionDelay = (n*.12 + i*.09)+'s';
        strip.style.transform = `translateY(-${(10 + Number(d))*30 - 300}px)`;
      });
      setTimeout(() => strip.style.transform = `translateY(-${Number(d)*30}px)`, 30);
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

/* ═══ KINETIC RING (scroll-reactive) ═══ */
const ringEl = document.getElementById('ring');
const RING = ['Not just an extension — <b>it\'s your edge</b>','Faster · Cleaner · <b>Unstoppable</b>','Zero telemetry, <b>by design</b>',
 'Two megabytes of <b>intent</b>','Built for the ones who <b>ship</b>','<b>Edition 01</b> · numbered build','Handcrafted <b>in the dark</b>',
 'Your data stays <b>yours</b>','No bloat · No noise · <b>Just speed</b>','Chromium <b>MV3</b> native','<b>40+</b> gateways supported','Early to it. <b>Always.</b>'];
let ringRot = 0;
// Twelve panels of ~250px text need more arc than a phone has: at any radius that
// fits the screen they overlap into an unreadable pile. The band is decorative — the
// same taglines appear in the hero and the ledger bar — so below 680px it is not
// built at all, which also saves 12 nodes and the per-frame rotation.
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

/* ═══ ORBITAL GALLERY · TRUE DEPTH OF FIELD ═══ */
const orbStage = document.getElementById('orbStage'), orbEl = document.getElementById('orb');
const cards = [...document.querySelectorAll('.orb-card')];
const dots = document.getElementById('orbDots');
let rot = 0, spinV = .055, dragging = false, lastX = 0, radius = 360, idx = -1;
let orbFlat = false;
function layoutOrb(){
  radius = clamp(innerWidth*.31, 250, 380);
  // Each .orb-card is 312px wide and absolutely positioned, swinging +/-radius on a
  // 3D ring. The radius floor is 250, so the ring needs roughly 880px of stage to
  // separate the cards. Below that it does not degrade gracefully — the cards simply
  // land on top of each other, which is the H3-over-H3 and P-over-P overlap seen on
  // a 432px phone. Under 680px, abandon the ring and let CSS stack them.
  const flat = innerWidth < 680;
  if (flat === orbFlat) return;
  orbFlat = flat;
  orbStage.classList.toggle('orb-flat', flat);
  if (flat) {
    // orbFrame writes inline transform/filter every frame, and inline styles beat
    // any stylesheet — so they have to be cleared, not overridden.
    cards.forEach((c) => {
      c.style.transform = ''; c.style.filter = ''; c.style.zIndex = ''; c.style.opacity = '';
      c.classList.remove('front');
    });
    if (ringEl) ringEl.style.transform = '';
  }
}
layoutOrb(); addEventListener('resize', layoutOrb);
cards.forEach(() => { const b = document.createElement('span'); b.className = 'orb-dot'; dots.appendChild(b); });
const dotEls = [...dots.children];
let orbOnScreen = true;
function orbFrame(){
  if (!cards.length || !orbOnScreen || orbFlat) return;
  if (!dragging && !reduce){ rot += spinV; spinV = lerp(spinV, .055, .045); }
  ringRot += .06 + (smoothOn ? clamp(vel*.004,-.3,.3) : 0);
  if (ringEl) ringEl.style.transform = `rotateY(${ringRot}deg)`;
  const step = 360/cards.length;
  cards.forEach((c,i) => {
    const a = (i*step + rot) * Math.PI/180;
    const z = Math.cos(a)*radius, x = Math.sin(a)*radius;
    const depth = (z + radius)/(radius*2);           // 0 back → 1 front
    c.style.transform = `translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${(Math.sin(a)*38).toFixed(1)}deg) scale(${(.82+depth*.22).toFixed(3)})`;
    const bq = Math.round((1-depth)*6/2)*2;              // 0 | 2 | 4 | 6 only
    if (c._bq !== bq){ c.style.filter = bq ? `blur(${bq}px)` : ''; c._bq = bq; }
    c.style.opacity = (.24 + depth*.76).toFixed(2);
    const zi = Math.round(depth*100);
    if (c._zi !== zi){ c.style.zIndex = zi; c._zi = zi; }
  });
  const cu = ((Math.round(-rot/step) % cards.length) + cards.length) % cards.length;
  if (cu !== idx){
    idx = cu;
    cards.forEach((c,i) => c.classList.toggle('front', i === idx));
    dotEls.forEach((d,i) => d.classList.toggle('on', i === idx));
    chime(523 + idx*66, .028);
  }
}
if (orbStage){
  const dStart = x => { dragging = true; lastX = x; orbStage.classList.add('grabbing'); };
  const dMove  = x => { if(!dragging) return; const d = x - lastX; lastX = x; rot += d*.3; spinV = d*.3; };
  const dEnd   = () => { dragging = false; orbStage.classList.remove('grabbing'); };
  orbStage.addEventListener('pointerdown', e => dStart(e.clientX));
  addEventListener('pointermove', e => dMove(e.clientX));
  addEventListener('pointerup', dEnd);
  orbStage.addEventListener('touchstart', e => dStart(e.touches[0].clientX), {passive:true});
  orbStage.addEventListener('touchmove',  e => dMove(e.touches[0].clientX),  {passive:true});
  orbStage.addEventListener('touchend', dEnd);
  document.getElementById('orbPrev').onclick = () => { spinV = 0; rot += 360/cards.length; };
  document.getElementById('orbNext').onclick = () => { spinV = 0; rot -= 360/cards.length; };
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
  let held = false, hx = 0, hy = 0, sX = 0, sY = 0, moved = 0;
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
    if (e.target.closest('button')) return;
    held = true; moved = 0; hx = e.clientX; hy = e.clientY; a.classList.add('held');
  });
  addEventListener('pointermove', e => {
    if (!held) return;
    const dx = e.clientX-hx, dy = e.clientY-hy;
    moved += Math.abs(dx)+Math.abs(dy);
    sY += dx*.5; sX = clamp(sX - dy*.35, -42, 42);
    hx = e.clientX; hy = e.clientY;
    a.style.transform = `rotateY(${sY}deg) rotateX(${sX}deg) translateZ(24px)`;
  });
  addEventListener('pointerup', () => {
    if (!held) return;
    held = false; a.classList.remove('held'); sX = sY = 0;
    a.style.transition = 'transform 1.1s cubic-bezier(.16,1,.3,1)';
    a.style.transform = '';
    setTimeout(() => a.style.transition = '', 1100);
  });
  const lid = a.querySelector('#lid');
  if (lid) lid.addEventListener('click', () => {
    if (moved > 12) return;
    a.classList.toggle('opened');
    chime(a.classList.contains('opened') ? 587 : 330, .07);
  });
});
setTimeout(() => document.getElementById('artifact')?.classList.add('opened'), 4200);

/* ═══ NAV · LIQUID INDICATOR · SCROLL STATE ═══ */
const nav = document.getElementById('nav'), navLinks = document.getElementById('navLinks'), navInd = document.getElementById('navInd');
navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('pointerenter', () => {
    navInd.style.opacity = '1';
    navInd.style.width = a.offsetWidth+'px';
    navInd.style.transform = `translateX(${a.offsetLeft}px)`;
  });
});
navLinks.addEventListener('pointerleave', () => navInd.style.opacity = '0');

let progEl = null;
const methodPath = document.getElementById('methodPath');
let pathLen = 0;
if (methodPath){ pathLen = methodPath.getTotalLength(); methodPath.style.strokeDasharray = pathLen; methodPath.style.strokeDashoffset = pathLen; }
function onScroll(){
  nav.classList.toggle('scrolled', scrollY > 12);
  const h = document.body.scrollHeight - innerHeight;
  // Scoped to the progress bar: it is the only thing reading --sp, and on :root the
  // write invalidated style across the document.
  const pr = progEl || (progEl = document.querySelector('.prog'));
  if (pr) pr.style.setProperty('--sp', (h>0 ? scrollY/h : 0).toFixed(4));
  if (methodPath){
    const r = methodPath.ownerSVGElement.getBoundingClientRect();
    const k = clamp((innerHeight*.9 - r.top)/(innerHeight*.7), 0, 1);
    methodPath.style.strokeDashoffset = pathLen*(1-k);
  }
}
addEventListener('scroll', onScroll, {passive:true}); onScroll();

const railLinks = [...document.querySelectorAll('.rail a')];
const railIO = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) railLinks.forEach(a => a.classList.toggle('on', a.dataset.rail === e.target.id));
}), {threshold:.14, rootMargin:'-28% 0px -50% 0px'});
['top','kit','how','ledger','download','architect'].forEach(id => {
  const el = document.getElementById(id); if (el) railIO.observe(el);
});

/* ═══ REVEAL + ENTRY CHIME ═══ */
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
}), {threshold:.1, rootMargin:'0px 0px -6% 0px'});
document.querySelectorAll('.rv').forEach(el => io.observe(el));
const chimeIO = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) chime(440 + Math.random()*180, .035);
}), {threshold:.35});
document.querySelectorAll('section[id]').forEach(s => chimeIO.observe(s));

/* ═══ GOLD LEAF · LEDGER ═══ */
const leaf = document.getElementById('goldLeaf');
// Rect cached: reading it inside pointermove forced a synchronous layout on every
// mouse move. It only changes on resize/scroll, so recompute it there instead.
let ledgerRect = null, leafX = 0, leafY = 0, leafDirty = false;
const ledgerEl = document.getElementById('ledger');
const invalidateLedgerRect = () => { ledgerRect = null; };
addEventListener('resize', invalidateLedgerRect);
addEventListener('scroll', invalidateLedgerRect, { passive: true });
function flushLedgerLeaf(){
  if (!leafDirty || !leaf) return;
  leafDirty = false;
  leaf.style.setProperty('--lx', leafX+'px');
  leaf.style.setProperty('--ly', leafY+'px');
}
ledgerEl?.addEventListener('pointermove', e => {
  if (!ledgerRect) ledgerRect = ledgerEl.getBoundingClientRect();
  const r = ledgerRect;
  leafX = e.clientX - r.left; leafY = e.clientY - r.top; leafDirty = true;
});

/* ═══ WAX SEAL ═══ */
const stampBtn = document.getElementById('stampBtn'), wax = document.getElementById('wax');
const waxShock = document.getElementById('waxShock'), stampZone = document.getElementById('stampZone');
stampBtn?.addEventListener('click', () => {
  wax.classList.add('on'); waxShock.classList.add('on'); stampZone.classList.add('done');
  chime(147,.12); setTimeout(()=>chime(220,.06),90);
  const r = wax.getBoundingClientRect();
  burst(r.left + r.width/2, r.top + r.height/2, 40, ['#96322C','#C4544A','#C9A86A','#FFF3D6']);
  toastMsg('Sealed — copy ' + serial + ' is yours.');
});

/* ═══ SOUND ENGINE ═══ */
let audioOn = false, actx = null, master = null;
const soundBtn = document.getElementById('sound');
soundBtn.addEventListener('click', () => {
  audioOn = !audioOn;
  soundBtn.classList.toggle('on', audioOn);
  if (audioOn){ ensureCtx(); chime(659,.09); toastMsg('Sound on — glass & brass.'); }
});
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
  const d = Math.min(devicePixelRatio||1, 2);
  cvs.width = innerWidth*d; cvs.height = innerHeight*d;
  ctx.setTransform(d,0,0,d,0,0);
}
sizeC(); addEventListener('resize', sizeC);
const GOLD = ['#C9A86A','#FFF3D6','#EADFC6','#F5F2EB','#A98A4F','#ffffff'];
function burst(x, y, n, palette){
  const pal = palette || GOLD, N = n || (innerWidth < 640 ? 80 : 145);
  for (let i=0;i<N;i++){
    const ang = -Math.PI/2 + (Math.random()-.5)*2.4, sp = 5 + Math.random()*14;
    parts.push({ x, y, z: Math.random()*440-140,
      vx: Math.cos(ang)*sp + (Math.random()-.5)*2, vy: Math.sin(ang)*sp, vz: (Math.random()-.5)*8,
      w: 4+Math.random()*10, h: 1.6+Math.random()*5,
      rot: Math.random()*6.28, vr: (Math.random()-.5)*.5, ph: Math.random()*6.28,
      col: pal[(Math.random()*pal.length)|0], life: 1, dec: .005+Math.random()*.007 });
  }
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
  raf = parts.length ? requestAnimationFrame(tickC) : (ctx.clearRect(0,0,innerWidth,innerHeight), null);
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
let keys = '';
addEventListener('keydown', e => {
  keys = (keys + e.key).slice(-6).toLowerCase();
  if (keys.endsWith('ash')){
    keys = '';
    ensureCtx();
    for (let i=0;i<9;i++) setTimeout(() => burst(Math.random()*innerWidth, -30, 34), i*130);
    [523,659,784,1046].forEach((f,i) => setTimeout(() => chime(f,.07), i*130));
    toastMsg('Collector mode — ' + serial + ' / 500.');
  }
});

/* ═══ DITHER HOVER (unchanged) ═══ */
const ditherEl = document.getElementById('dither-dev');
let flushDither = () => {};
if (ditherEl){
  const w = ditherEl.closest('.dev-ash-right');
  const bp = parseFloat(ditherEl.getAttribute('pixel-size')) || 2.0;
  const bc = parseFloat(ditherEl.getAttribute('contrast')) || 1.24;

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
    setAttr('pixel-size', clamp(bp - (.55-d)*.55, 1.6, 2.6).toFixed(2));
    setAttr('contrast', (bc + (.5-d)*.12).toFixed(2));
    setAttr('brightness', ((.5-d)*.04).toFixed(3));
    setAttr('light', d < .32 ? '#fff4d6' : '#f5f2eb');
  };
  flushDither = () => {
    if (dPending === null) return;
    const d = dPending; dPending = null;
    applyDither(d);
  };

  w?.addEventListener('mousemove', e => {
    if (!w) return;
    if (!dRect) dRect = w.getBoundingClientRect();
    const r = dRect;
    const nx = (e.clientX-r.left)/r.width - .5, ny = (e.clientY-r.top)/r.height - .5;
    dPending = Math.hypot(nx, ny);
  });
  w?.addEventListener('mouseleave', () => {
    dPending = null;
    ditherEl.setAttribute('pixel-size', String(bp));
    ditherEl.setAttribute('contrast', String(bc));
    ditherEl.setAttribute('brightness', '-0.01');
    ditherEl.setAttribute('light', '#f5f2eb');
  });
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
