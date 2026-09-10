/* ASHEO · <dither-bg> — a portrait rendered in dithered light.
   Halftone edition: the image is quantised through an analytic Bayer8 matrix
   and re-drawn as soft glowing dots (contain-fit, monochrome by default).
   The frame loop runs at 30fps while the wobble is alive and the element is
   on screen — identical motion to the original, engineered underneath:
   single complete teardown, idempotent start/stop (no duplicate rAF chains
   or listeners), shared image cache, src race guards, resize hysteresis,
   synchronous redraw after every resize (never a transparent flash frame),
   coalesced hover redraws, and survival across GPU context loss. */
const DITHER_VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;
const DITHER_FRAG = `
precision highp float;
uniform sampler2D uImage;
uniform vec2  uResolution;
uniform vec2  uImageSize;
uniform float uPixelSize;
uniform float uLevels;
uniform float uSpread;
uniform float uBrightness;
uniform float uContrast;
uniform float uMonochrome;
uniform float uInvert;
uniform vec3  uDark;
uniform vec3  uLight;
uniform float uTime;
uniform float uWobble;
float Bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
#define Bayer4(a) (Bayer2(0.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(0.5 * (a)) * 0.25 + Bayer2(a))
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 cell    = floor(gl_FragCoord.xy / uPixelSize);
  vec2 center  = (cell + 0.5) * uPixelSize;
  vec2 snapped = center;
  float s     = min(uResolution.x / uImageSize.x, uResolution.y / uImageSize.y);
  vec2  drawn = uImageSize * s;
  vec2  uv    = (snapped - 0.5 * (uResolution - drawn)) / drawn;
  uv.y = 1.0 - uv.y;
  uv += uWobble * 0.01 * vec2(sin(uTime + cell.y * 0.15), cos(uTime + cell.x * 0.15));
  // contain: show all image, letterbox stays pure background
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ gl_FragColor = vec4(uDark, 1.0); return; }
  vec4 tex = texture2D(uImage, clamp(uv, 0.0, 1.0));
  // DEBUG: if texture missing, show diagnostic grid
  // transparent -> dark, but ensure we still see center
  vec3 src;
  float a = tex.a;
  if(a < 0.05){
    // keep as dark, but don't return — let dither decide
    src = uDark;
    a = 0.0;
  } else {
    src = tex.rgb;
  }
  vec3 c = mix(src, vec3(lum(src)), uMonochrome);
  c = (c - 0.5) * uContrast + 0.5 + uBrightness;
  c = mix(c, 1.0 - c, uInvert);
  float steps = max(uLevels - 1.0, 1.0);
  float t     = (Bayer8(cell) - 0.5) * uSpread;
  vec3  q     = clamp(floor(c * steps + t + 0.5) / steps, 0.0, 1.0);
  // if no image loaded yet (imgSize 0), show test pattern so we know shader runs
  if(uImageSize.x < 1.0){
    float test = step(0.5, fract(cell.x * 0.5 + cell.y * 0.5));
    gl_FragColor = vec4(mix(uDark, uLight, test), 1.0);
    return;
  }
  // tiny soft dot — ensure visible even for mid-tones
  float qLum = lum(q);
  // force at least some dots for cutout: if a==0 (transparent) force 0, else keep q
  if(a < 0.05) qLum = 0.0;
  float dist = length(gl_FragCoord.xy - center);
  float baseR = uPixelSize * 0.28;
  float dotR = baseR * (0.38 + 0.82 * qLum);
  float edge = 1.2;
  float alpha = 1.0 - smoothstep(dotR - edge, dotR + edge, dist);
  alpha *= step(0.25, qLum);
  float glowR = dotR + 1.6;
  float glow = (1.0 - smoothstep(dotR, glowR, dist)) * 0.25 * qLum;
  vec3 col = mix(uDark, uLight, alpha);
  col += uLight * glow * 0.4;
  gl_FragColor = vec4(col, 1.0);
}
`;
class DitherBG extends HTMLElement {
  static get observedAttributes() {
    return ['src','pixel-size','levels','spread','brightness','contrast',
      'monochrome','invert','dark','light','wobble','speed'];
  }
  constructor(){
    super();
    this._u = {};
    this._raf = 0; this._running = false;
    this._watching = false; this._onScreen = true;
    this._tex = null; this._img = null; this._imgW = 0; this._imgH = 0;
    this._srcToken = 0;
    this._flushQueued = false;
    this._resizeTimer = 0;
    this._lastW = 0; this._lastH = 0;
    this._lost = false;
    this._t0 = 0; this._lastDraw = -Infinity;
    this._boundSync = () => this._sync();
    this._boundResize = () => this._scheduleResize();
    this._boundLost = (e) => { e.preventDefault(); this._lost = true; this._tex = null; this._stop(); };
    this._boundRestored = () => { this._lost = false; this._rebuild(); };
    this._tick = (t) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(this._tick);
      if (t - this._lastDraw < 1000/30) return;   // keep the loop, skip the draw
      this._lastDraw = t;
      this._draw((t - this._t0)/1000 * this._num('speed', 1));
    };
  }
  static _imgCache = new Map();
  _loadShared(src){
    if (DitherBG._imgCache.has(src)) return DitherBG._imgCache.get(src);
    const p = new Promise((res, rej) => {
      const img = new Image();
      if (location.protocol !== 'file:') img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
      if (img.complete && img.naturalWidth) res(img);
    });
    // A rejected cached promise would poison every later instance — evict it.
    p.catch(() => { DitherBG._imgCache.delete(src); });
    DitherBG._imgCache.set(src, p);
    return p;
  }
  _num(name, fallback){
    const v = parseFloat(this.getAttribute(name));
    return Number.isFinite(v) ? v : fallback;
  }
  _rgb(name, fallback){
    const hex = (this.getAttribute(name) || fallback).replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
    return [(n >> 16 & 255)/255, (n >> 8 & 255)/255, (n & 255)/255];
  }
  connectedCallback(){
    // Fresh canvas on every connect: after a context loss + disconnect the old
    // canvas is permanently dead, and a re-inserted element must come back alive.
    if (this._canvas){ this._canvas.remove(); this._canvas = null; }
    if (this._fallbackImg){ this._fallbackImg.remove(); this._fallbackImg = null; }
    this._gl = null; this._tex = null; this._lost = false;
    this._canvas = document.createElement('canvas');
    // Light DOM on purpose: page CSS (#dither-dev canvas) styles this node,
    // which shadow DOM would seal off.
    Object.assign(this._canvas.style, { width:'100%', height:'100%', display:'block' });
    this.appendChild(this._canvas);
    const gl = this._canvas.getContext('webgl', { antialias:false, alpha:false, depth:false, stencil:false, powerPreference:'low-power' });
    if (!gl){ this._fallback(); return; }
    this._gl = gl;
    try { this._build(); } catch(e){ this._fallback(); return; }
    this._canvas.addEventListener('webglcontextlost', this._boundLost);
    this._canvas.addEventListener('webglcontextrestored', this._boundRestored);
    this._resize();
    const src = this.getAttribute('src');
    if (src) this._loadSrc(src);
    addEventListener('resize', this._boundResize);
    if ('ResizeObserver' in window){
      // contentRect is the *layout* box — ancestor transforms (the page skew
      // while scrolling) never touch it, so scroll can never flap the size.
      // It also arrives with the callback: no extra layout read required.
      this._ro = new ResizeObserver(es => {
        const r = es[0] && es[0].contentRect;
        this._resize(r && r.width, r && r.height);
      });
      this._ro.observe(this);
    }
    this._beginWatch();
  }
  disconnectedCallback(){
    // A single, complete teardown: every listener, observer, timer and frame
    // this element owns is released here — safe to remove and re-insert.
    this._stop();
    removeEventListener('resize', this._boundResize);
    this._clearTimeout();
    if (this._watching){
      this._watching = false;
      document.removeEventListener('visibilitychange', this._boundSync);
      if (this._io){ this._io.disconnect(); this._io = null; }
    }
    if (this._ro){ this._ro.disconnect(); this._ro = null; }
    if (this._canvas){
      this._canvas.removeEventListener('webglcontextlost', this._boundLost);
      this._canvas.removeEventListener('webglcontextrestored', this._boundRestored);
    }
    try {
      const lose = this._gl && this._gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch(e){}
    this._gl = null; this._tex = null; this._img = null;
  }
  attributeChangedCallback(name, _o, v){
    if (!this._gl || this._lost) return;
    if (name === 'src'){ if (v) this._loadSrc(v); return; }
    this._requestDraw();
  }
  _requestDraw(){
    // The 30fps loop picks attribute changes up on its next frame by itself,
    // so a running loop needs no direct draws at all. A static instance
    // (wobble 0 / reduced motion) still redraws — once per microtask, so a
    // hover scrub setting four attributes costs one draw, not four.
    if (this._running || this._flushQueued) return;
    this._flushQueued = true;
    queueMicrotask(() => { this._flushQueued = false; this._draw(0); });
  }
  _loadSrc(src){
    // Race guard: a slow first image must not overwrite a newer src.
    const token = ++this._srcToken;
    this._loadShared(src).then(img => {
      if (!this.isConnected || !this._gl || this._lost || token !== this._srcToken) return;
      this._img = img;
      this._imgW = img.naturalWidth || img.width || 0;
      this._imgH = img.naturalHeight || img.height || 0;
      this._upload();
      this._resize();
      this._maybeStart();
    }).catch(() => {});
  }
  _upload(){
    const gl = this._gl;
    if (!gl || this._lost || !this._img) return;
    this._tex = this._tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  _build(){
    const gl = this._gl;
    let fs = DITHER_FRAG;
    try {
      const prec = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      if (!prec || !prec.precision) fs = fs.replace('precision highp float', 'precision mediump float');
    } catch(e){}
    const compile = (type, src) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader alloc failed');
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, DITHER_VERT);
    const fss = compile(gl.FRAGMENT_SHADER, fs);
    this._prog = gl.createProgram();
    if (!this._prog) throw new Error('program alloc failed');
    gl.attachShader(this._prog, vs); gl.attachShader(this._prog, fss);
    gl.linkProgram(this._prog);
    gl.deleteShader(vs); gl.deleteShader(fss);
    if (!gl.getProgramParameter(this._prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this._prog));
    gl.useProgram(this._prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this._prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    // Locations are resolved once; every draw reuses them.
    for (const k of ['uImage','uResolution','uImageSize','uPixelSize','uLevels','uSpread',
      'uBrightness','uContrast','uMonochrome','uInvert','uDark','uLight','uTime','uWobble'])
      this._u[k] = gl.getUniformLocation(this._prog, k);
  }
  _resize(w, h){
    if (!this._gl || this._lost) return;
    if (w === undefined || h === undefined){ w = this.clientWidth; h = this.clientHeight; }
    // DPR 1 on purpose: the buffer matches CSS pixels and the browser upscales
    // with image-rendering:pixelated. A 2x buffer would draw 4x the fragments
    // to land the same dot grid the dithering resolves anyway.
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    // Hysteresis: sub-pixel size flaps (fractional zoom, rounding) must never
    // reallocate the canvas — every realloc clears it, which reads as a flash.
    if (Math.abs(w - this._lastW) <= 1 && Math.abs(h - this._lastH) <= 1 &&
        this._canvas.width === this._lastW && this._canvas.height === this._lastH) return;
    this._lastW = w; this._lastH = h;
    this._canvas.width = w; this._canvas.height = h;
    this._gl.viewport(0, 0, w, h);
    // Redraw synchronously: a resized canvas is transparent until the next
    // draw, and one transparent frame is exactly one visible flicker.
    this._draw(this._now());
  }
  _now(){
    return this._running ? (performance.now() - this._t0)/1000 * this._num('speed', 1) : 0;
  }
  _scheduleResize(){
    this._clearTimeout();
    this._resizeTimer = setTimeout(() => { this._resizeTimer = 0; this._resize(); }, 120);
  }
  _clearTimeout(){
    if (this._resizeTimer){ clearTimeout(this._resizeTimer); this._resizeTimer = 0; }
  }
  _beginWatch(){
    // Idempotent: start paths run more than once (src changes, restores),
    // but the listeners below must exist exactly once.
    if (this._watching) return;
    this._watching = true;
    document.addEventListener('visibilitychange', this._boundSync);
    if ('IntersectionObserver' in window){
      this._io = new IntersectionObserver(entries => {
        this._onScreen = entries.some(e => e.isIntersecting);
        this._sync();
      }, { rootMargin: '120px' });
      this._io.observe(this);
    }
    this._sync();
  }
  _sync(){
    if (document.hidden || !this._onScreen) this._stop();
    else this._maybeStart();
  }
  _maybeStart(){
    if (!this._gl || this._lost || !this._img) return;
    if (document.hidden || !this._onScreen){ this._stop(); return; }
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wobble = reduced ? 0 : this._num('wobble', 0);
    if (wobble <= 0){ this._stop(); this._draw(0); return; }
    this._start();
  }
  _start(){
    if (this._running || !this._gl || this._lost || !this._img) return;
    if (document.hidden || !this._onScreen) return;
    this._running = true;
    this._t0 = performance.now();
    this._lastDraw = -Infinity;
    this._raf = requestAnimationFrame(this._tick);
  }
  _stop(){
    if (!this._running && !this._raf) return;
    this._running = false;
    if (this._raf){ cancelAnimationFrame(this._raf); this._raf = 0; }
  }
  _draw(time){
    const gl = this._gl;
    if (!gl || this._lost || !this._tex || !this._canvas.width || this._imgW < 1) return;
    gl.useProgram(this._prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    // Uniforms are read fresh from attributes every draw — hover tweaks apply
    // on the very next frame with no loop restart and no extra bookkeeping.
    gl.uniform1i(this._u.uImage, 0);
    gl.uniform2f(this._u.uResolution, this._canvas.width, this._canvas.height);
    gl.uniform2f(this._u.uImageSize, this._imgW, this._imgH);
    gl.uniform1f(this._u.uPixelSize, Math.max(1, this._num('pixel-size', 4)));
    gl.uniform1f(this._u.uLevels,     this._num('levels', 2));
    gl.uniform1f(this._u.uSpread,     this._num('spread', 1));
    gl.uniform1f(this._u.uBrightness, this._num('brightness', 0));
    gl.uniform1f(this._u.uContrast,   this._num('contrast', 1));
    gl.uniform1f(this._u.uMonochrome, this._num('monochrome', 1));
    gl.uniform1f(this._u.uInvert,     this._num('invert', 0));
    gl.uniform3fv(this._u.uDark,  this._rgb('dark',  '#0b0b0f'));
    gl.uniform3fv(this._u.uLight, this._rgb('light', '#f2f2f2'));
    gl.uniform1f(this._u.uTime, time);
    gl.uniform1f(this._u.uWobble, this._num('wobble', 0));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _rebuild(){
    if (!this.isConnected || !this._gl) return;
    try {
      this._build();
      this._upload(); this._resize(); this._sync();
    } catch(e){ this._stop(); }
  }
  _fallback(){
    if (this._fallbackImg) return;
    if (this._canvas){ this._canvas.remove(); this._canvas = null; }
    this._gl = null;
    const img = document.createElement('img');
    img.src = this.getAttribute('src') || '';
    img.alt = '';
    Object.assign(img.style, { width:'100%', height:'100%', objectFit:'cover', imageRendering:'pixelated', filter:'grayscale(1) contrast(1.4)' });
    this.appendChild(img);
    this._fallbackImg = img;
  }
}
customElements.define('dither-bg', DitherBG);
