const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;
const FRAG = `
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
  static observedAttributes = [
    "src","pixel-size","levels","spread","brightness","contrast",
    "monochrome","invert","dark","light","wobble","speed"
  ];
  connectedCallback() {
    this.canvas = document.createElement("canvas");
    Object.assign(this.canvas.style, { width: "100%", height: "100%", display: "block" });
    this.appendChild(this.canvas);
    this.gl = this.canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!this.gl) return this.fallback();
    this.build();
    this.loadImage(this.getAttribute("src"));
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this);
  }
  disconnectedCallback() {
    this.ro?.disconnect();
    cancelAnimationFrame(this.raf);
  }
  attributeChangedCallback(name, _old, val) {
    if (!this.gl) return;
    if (name === "src") this.loadImage(val);
    else this.draw();
  }
  num(name, fallback) {
    const v = parseFloat(this.getAttribute(name));
    return Number.isFinite(v) ? v : fallback;
  }
  rgb(name, fallback) {
    const hex = (this.getAttribute(name) || fallback).replace("#", "");
    const n = parseInt(hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  build() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    this.prog = gl.createProgram();
    gl.attachShader(this.prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.prog);
    if(!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog));
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const k of ["uImage","uResolution","uImageSize","uPixelSize","uLevels","uSpread","uBrightness","uContrast","uMonochrome","uInvert","uDark","uLight","uTime","uWobble"])
      this.u[k] = gl.getUniformLocation(this.prog, k);
  }
  loadImage(src) {
    if (!src) return;
    const img = new Image();
    if(location.protocol !== 'file:') img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const gl = this.gl;
      this.tex ??= gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.imgSize = [img.naturalWidth, img.naturalHeight];
      this.resize();
      this.start();
    };
    img.onerror = () => { console.warn('[dither-bg] load fail', src); };
    img.src = src;
    if(img.complete && img.naturalWidth) img.onload();
  }
  resize() {
    // pixel-size scales by dpr, so a 2x buffer draws four times the fragments to
    // land the SAME cell size in CSS pixels — detail the dithering throws away
    // anyway. Rendering at 1x and letting the browser upscale is visually
    // equivalent here and quarters the per-frame GPU work on retina displays.
    const dpr = 1;
    const w = Math.max(1, Math.round(this.clientWidth  * dpr));
    const h = Math.max(1, Math.round(this.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    this.dpr = dpr;
    this.draw();
  }
  start() {
    this.stop();
    // respect prefers-reduced-motion
    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wobble = prefersReduced ? 0 : this.num("wobble", 0);
    if (wobble <= 0) { this.draw(); return; }

    // A full-screen fragment shader that keeps drawing while nobody is looking is
    // the most expensive thing on this page: this element lives below the fold, so
    // the loop used to run forever, off-screen, in background tabs included. Now it
    // only runs while intersecting the viewport AND the tab is visible, and it
    // draws at 30fps because the drift (wobble 0.06 at speed 0.4) is far too slow
    // for 60 to be distinguishable.
    const FRAME_MS = 1000 / 30;
    const t0 = performance.now();
    let last = -Infinity;
    const tick = (t) => {
      this.raf = requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;      // keep the loop, skip the draw
      last = t;
      this.draw((t - t0) / 1000 * this.num("speed", 1));
    };
    this._tick = tick;
    this._onScreen = true;

    this._sync = () => {
      if (document.hidden || !this._onScreen) this.stop();
      else if (!this.raf) this.raf = requestAnimationFrame(this._tick);
    };
    document.addEventListener('visibilitychange', this._sync);
    if ('IntersectionObserver' in window) {
      this._io = new IntersectionObserver((entries) => {
        this._onScreen = entries.some((e) => e.isIntersecting);
        this._sync();
      }, { rootMargin: '120px' });
      this._io.observe(this);
    }
    this._sync();
  }
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  disconnectedCallback() {
    this.stop();
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._sync) { document.removeEventListener('visibilitychange', this._sync); this._sync = null; }
  }
  draw(time = 0) {
    const gl = this.gl;
    if (!gl || !this.tex || !this.canvas.width) return;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uImage, 0);
    gl.uniform2f(this.u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.uImageSize, this.imgSize[0], this.imgSize[1]);
    gl.uniform1f(this.u.uPixelSize, Math.max(1, this.num("pixel-size", 4) * (this.dpr||1)));
    gl.uniform1f(this.u.uLevels,     this.num("levels", 2));
    gl.uniform1f(this.u.uSpread,     this.num("spread", 1));
    gl.uniform1f(this.u.uBrightness, this.num("brightness", 0));
    gl.uniform1f(this.u.uContrast,   this.num("contrast", 1));
    gl.uniform1f(this.u.uMonochrome, this.num("monochrome", 1));
    gl.uniform1f(this.u.uInvert,     this.num("invert", 0));
    gl.uniform3fv(this.u.uDark,  this.rgb("dark",  "#0b0b0f"));
    gl.uniform3fv(this.u.uLight, this.rgb("light", "#f2f2f2"));
    gl.uniform1f(this.u.uTime, time);
    gl.uniform1f(this.u.uWobble, this.num("wobble", 0));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  fallback() {
    this.canvas.remove();
    const img = document.createElement("img");
    img.src = this.getAttribute("src");
    Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated", filter: "grayscale(1) contrast(1.4)" });
    this.appendChild(img);
  }
}
customElements.define("dither-bg", DitherBG);
