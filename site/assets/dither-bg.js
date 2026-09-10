/* ASHEO · <dither-bg> — a portrait rendered in dithered light.
   A WebGL2 canvas that turns an image into animated Bayer dithering.
   Hardened: single callback set, no listener/observer leaks, no double rAF,
   no per-frame uniform discovery, and it survives GPU context loss. */
class DitherBG extends HTMLElement {
  static get observedAttributes() {
    return ['src','pixel-size','contrast','brightness','dark','light','speed','block-order','static','animate'];
  }
  constructor(){
    super();
    this.attachShadow({ mode:'open' });
    // Cached node refs keep uniform setters at one write each, no lookups.
    this._u = {};
    this._uniformQueue = [];
    this._bayerCache = new Map();
    this._io = null; this._ro = null;
    this._resizeTimer = 0; this._rafId = 0; this._running = false;
    this._img = null; this._tex = null;
    // Individual Image() per instance would refetch a shared src; cache promises.
    this._boundOnResize = () => this._scheduleResize();
    this._boundOnVis = () => this._onVis();
    this._boundOnLost = (e) => { e.preventDefault(); this._stop(); };
    this._boundOnRestored = () => this._rebuild();
  }
  static _imgCache = new Map();
  _loadImage(src){
    if (DitherBG._imgCache.has(src)) return DitherBG._imgCache.get(src);
    const p = new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    // A rejected cached promise would poison every later instance — evict it.
    p.catch(() => { DitherBG._imgCache.delete(src); });
    DitherBG._imgCache.set(src, p);
    return p;
  }

  connectedCallback(){
    const s = getComputedStyle(this);
    const W = parseInt(s.width)||this.clientWidth||400, H = parseInt(s.height)||this.clientHeight||400;
    this._cssW = W; this._cssH = H;
    this.shadowRoot.innerHTML = `
      <style>:host{position:absolute;inset:0;display:block;overflow:hidden}
      canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style>
      <canvas aria-hidden="true"></canvas>`;
    this._cvs = this.shadowRoot.querySelector('canvas');
    const gl = this._cvs.getContext('webgl2', { antialias:false, alpha:true, depth:false, stencil:false, powerPreference:'low-power' });
    if (!gl){
      // No WebGL2: degrade to the raw image, never to a black hole.
      const src = this.getAttribute('src');
      if (src){
        const img = document.createElement('img');
        img.src = src; img.alt = '';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
        this.shadowRoot.appendChild(img);
      }
      return;
    }
    this._gl = gl;
    this._build();
    const src = this.getAttribute('src');
    if (src) this._loadImage(src).then(img => {
      if (!this.isConnected || !this._gl) return;
      this._img = img; this._upload(); this._resize(); this._start();
    }).catch(() => {});
    // Initial size via attributes.
    this._resize();
    this._applyAttrs();
    // Wake on resize; sleep off-screen and in background tabs. Only ONE
    // observer tracks visibility — it owns both the rAF lifecycle and the
    // canvas visibility flag, so the texture never uploads for nothing.
    addEventListener('resize', this._boundOnResize);
    document.addEventListener('visibilitychange', this._boundOnVis);
    this._cvs.addEventListener('webglcontextlost', this._boundOnLost);
    this._cvs.addEventListener('webglcontextrestored', this._boundOnRestored);
    if ('IntersectionObserver' in window){
      this._io = new IntersectionObserver(es => es.forEach(e => {
        this._visible = e.isIntersecting;
        this._cvs.style.visibility = e.isIntersecting ? '' : 'hidden';
        e.isIntersecting ? this._start() : this._stop();
      }), { rootMargin:'120px' });
      this._io.observe(this);
    } else this._start();
    // Size follows the actual box, not the window — resize bursts coalesced.
    if ('ResizeObserver' in window){
      this._ro = new ResizeObserver(() => this._scheduleResize());
      this._ro.observe(this);
    }
  }
  disconnectedCallback(){
    // A single, complete teardown: every listener, observer, frame and
    // texture this element owns is released here — no leaks on SPA-style
    // removal and re-insertion.
    this._stop();
    removeEventListener('resize', this._boundOnResize);
    document.removeEventListener('visibilitychange', this._boundOnVis);
    this._cvs?.removeEventListener('webglcontextlost', this._boundOnLost);
    this._cvs?.removeEventListener('webglcontextrestored', this._boundOnRestored);
    this._io?.disconnect(); this._io = null;
    this._ro?.disconnect(); this._ro = null;
    clearTimeout(this._resizeTimer);
    try {
      const lose = this._gl?.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch(e){}
    this._gl = null; this._tex = null; this._img = null;
  }
  attributeChangedCallback(name, _o, v){
    if (!this._gl) return;
    // Upstream treats 'animate' as the master motion switch and gates the frame
    // loop on it even without prefers-reduced-motion.
    if (name === 'animate'){ v === 'false' ? this._stop() : this._start(); return; }
    if (name === 'static' && v === 'true'){ this._stop(); return; }
    if (name === 'src' && v){
      // Race guard: a slow first image must not overwrite a newer src.
      const token = (this._srcToken = (this._srcToken || 0) + 1);
      this._loadImage(v).then(img => {
        if (!this.isConnected || !this._gl || token !== this._srcToken) return;
        this._img = img; this._upload(); this._resize(); this._start();
      }).catch(() => {});
      return;
    }
    // Rapid mousemove-driven attribute writes used to redraw the canvas up to four
    // times per event. Now they only enqueue; one flush runs per frame at most.
    const map = { 'pixel-size':() => this._qUniform('1f','u_px',Math.max(parseFloat(v)||2,1)),
      'contrast':() => this._qUniform('1f','u_contrast',parseFloat(v)||1),
      'brightness':() => this._qUniform('1f','u_bright',parseFloat(v)||0),
      'speed':() => this._qUniform('1f','u_speed',(parseFloat(v)||1)*0.35),
      'dark':() => this._qUniform('3f','u_dark',...this._hex(v||'#0d0c0e')),
      'light':() => this._qUniform('3f','u_light',...this._hex(v||'#f5f2eb')),
      'block-order':() => this._qBayer(parseInt(v)||4) };
    if (map[name]) map[name]();
  }
  _applyAttrs(){
    if (!this._gl) return;
    const g = (n,d) => this.getAttribute(n) ?? d;
    // Every uniform write funnels through the queue and flushes ONCE, so the
    // dozen attribute reads at startup cost a single draw call, not twelve.
    this._qUniform('1f','u_px',Math.max(parseFloat(g('pixel-size','2.2'))||2.2,1));
    this._qUniform('1f','u_contrast',parseFloat(g('contrast','1.24'))||1.24);
    this._qUniform('1f','u_bright',parseFloat(g('brightness','-0.01'))||0);
    this._qUniform('1f','u_speed',(parseFloat(g('speed','1'))||1)*0.35);
    this._qUniform('3f','u_dark',...this._hex(g('dark','#0d0c0e')));
    this._qUniform('3f','u_light',...this._hex(g('light','#f5f2eb')));
    this._qBayer(parseInt(g('block-order','4'))||4);
    this._flushUniforms();
  }
  _hex(h){
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h||'');
    return m ? [parseInt(m[1],16)/255, parseInt(m[2],16)/255, parseInt(m[3],16)/255] : [0,0,0];
  }
  _qUniform(kind, name, ...vals){
    this._uniformQueue.push([kind, name, vals]);
    if (!this._flushQueued){
      this._flushQueued = true;
      // Microtask, not rAF: attributes set back-to-back in one event flush once.
      queueMicrotask(() => { this._flushQueued = false; this._flushUniforms(); });
    }
  }
  _flushUniforms(){
    const gl = this._gl;
    if (!gl || !this._uniformQueue.length) return;
    const q = this._uniformQueue; this._uniformQueue = [];
    gl.useProgram(this._prog);
    let drew = false;
    for (const [kind, name, vals] of q){
      // Locations are cached; a second lookup per uniform per frame was pure waste.
      let loc = this._u[name];
      if (loc === undefined){ loc = gl.getUniformLocation(this._prog, name); this._u[name] = loc; }
      if (kind === 'bayer'){ this._bindBayer(vals[0], loc); drew = true; continue; }
      if (!loc) continue;
      if (kind === '1f') gl.uniform1f(loc, vals[0]);
      else if (kind === '3f') gl.uniform3f(loc, vals[0], vals[1], vals[2]);
      else if (kind === '1i') gl.uniform1i(loc, vals[0]);
      drew = true;
    }
    if (drew && !this._running) this._draw(performance.now()/1000);
  }
  _bayer(n){
    if (this._bayerCache.has(n)) return this._bayerCache.get(n);
    let m = [[0]];
    // Iterative Kronecker expansion — the recursion is unrolled into the matrix.
    while (m.length < n){ const s = m.length, nxt = [];
      for (let y = 0; y < s*2; y++){ nxt[y] = [];
        for (let x = 0; x < s*2; x++)
          nxt[y][x] = 4*m[y%s][x%s] + [[0,2],[3,1]][(y/s)|0][(x/s)|0]; }
      m = nxt; }
    const N = n*n, out = new Uint8Array(N);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y*n+x] = (m[y][x]+.5)/N*255;
    // Cap the cache — block-order is user-settable, don't grow it unboundedly.
    if (this._bayerCache.size > 4) this._bayerCache.clear();
    this._bayerCache.set(n, out);
    return out;
  }
  _bindBayer(n, loc){
    const gl = this._gl;
    if (!this._bayerTex) this._bayerTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._bayerTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, n, n, 0, gl.RED, gl.UNSIGNED_BYTE, this._bayer(n));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    if (loc){ gl.uniform1i(loc, 1); gl.uniform1f(this._u.u_bn ?? gl.getUniformLocation(this._prog,'u_bn'), n); }
  }
  _qBayer(n){
    this._bayerN = n;
    this._uniformQueue.push(['bayer','u_bayer',[n]]);
    if (!this._flushQueued){
      this._flushQueued = true;
      queueMicrotask(() => { this._flushQueued = false; this._flushUniforms(); });
    }
  }
  _build(){
    const gl = this._gl;
    const mk = (t, src) => {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    // Full precision declaration: some drivers refuse to compile without one.
    const vs = mk(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in vec2 p; out vec2 vUv;
      void main(){ vUv = p*.5+.5; gl_Position = vec4(p,0.,1.); }`);
    const fs = mk(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D u_img; uniform sampler2D u_bayer; uniform float u_bn;
      uniform float u_px, u_time, u_contrast, u_bright, u_speed;
      uniform vec3 u_dark, u_light;
      in vec2 vUv; out vec4 o;
      void main(){
        vec2 px = floor(vUv*vec2(textureSize(u_img,0))/u_px);
        vec3 c = texelFetch(u_img, ivec2(px), 0).rgb;
        float lum = dot(c, vec3(.299,.587,.114));
        lum = clamp((lum-.5)*u_contrast+.5+u_bright, 0., 1.);
        float th = texelFetch(u_bayer, ivec2(int(mod(px.x+u_time*u_speed*8.,u_bn)), int(mod(px.y,u_bn))), 0).r;
        o = vec4(mix(u_dark, u_light, step(th,lum)), 1.);
      }`);
    this._prog = gl.createProgram();
    gl.attachShader(this._prog, vs); gl.attachShader(this._prog, fs);
    gl.linkProgram(this._prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(this._prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this._prog));
    gl.useProgram(this._prog);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Static samplers are bound once — they never change per draw.
    gl.uniform1i(gl.getUniformLocation(this._prog,'u_img'), 0);
    this._u.u_time = gl.getUniformLocation(this._prog,'u_time');
    this._u.u_speed = gl.getUniformLocation(this._prog,'u_speed');
    this._tex = gl.createTexture() || this._tex;
  }
  _upload(){
    const gl = this._gl;
    if (!gl || !this._img) return;
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this._img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._iw = this._img.naturalWidth || this._img.width;
    this._ih = this._img.naturalHeight || this._img.height;
  }
  _resize(){
    const gl = this._gl;
    if (!gl) return;
    const r = this.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || this._cssW || 400)), h = Math.max(1, Math.round(r.height || this._cssH || 400));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Round UP to u_px so texelFetch never reads past the edge — the
    // fractional remainder used to shimmer as a bright seam on the right.
    const px = Math.max(parseFloat(this.getAttribute('pixel-size')) || 2, 1);
    const W = Math.max(1, Math.ceil(w*dpr/px)*px), H = Math.max(1, Math.ceil(h*dpr/px)*px);
    if (this._cvs.width !== W || this._cvs.height !== H){ this._cvs.width = W; this._cvs.height = H; }
    gl.viewport(0, 0, W, H);
    if (!this._running) this._draw(performance.now()/1000);
  }
  _scheduleResize(){
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this._resize(), 120);
  }
  _onVis(){ document.hidden ? this._stop() : this._start(); }
  _start(){
    if (this._running || !this._gl || !this._img) return;
    if (document.hidden || this._visible === false) return;
    if (this.getAttribute('animate') === 'false' || this.getAttribute('static') === 'true') return;
    this._running = true;
    const step = () => {
      if (!this._running) return;
      this._draw(performance.now()/1000);
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }
  _stop(){
    // Guarded: stop is called from five places, and without the flag each
    // start/stop cycle leaked another rAF chain onto the page.
    if (!this._running && !this._rafId) return;
    this._running = false;
    cancelAnimationFrame(this._rafId); this._rafId = 0;
  }
  _draw(t){
    const gl = this._gl;
    if (!gl || !this._img) return;
    gl.useProgram(this._prog);
    gl.uniform1f(this._u.u_time, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  _rebuild(){
    if (!this.isConnected || !this._gl) return;
    try {
      this._build();
      this._upload(); this._resize(); this._applyAttrs(); this._start();
    } catch(e){ this._stop(); }
  }
}
customElements.define('dither-bg', DitherBG);
