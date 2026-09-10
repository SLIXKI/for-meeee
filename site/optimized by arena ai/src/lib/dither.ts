import { getProfile, getQuality } from './tier';
import { observeVisible, onFrame } from './frames';
import { makeProgram, makeTriangle } from './webgl';

export const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;

// The supplied shader is retained: contain fit, Bayer8, dot radius, and glow.
export const FRAG = `
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
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ gl_FragColor = vec4(uDark, 1.0); return; }
  vec4 tex = texture2D(uImage, clamp(uv, 0.0, 1.0));
  vec3 src;
  float a = tex.a;
  if(a < 0.05){
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
  if(uImageSize.x < 1.0){
    float test = step(0.5, fract(cell.x * 0.5 + cell.y * 0.5));
    gl_FragColor = vec4(mix(uDark, uLight, test), 1.0);
    return;
  }
  float qLum = lum(q);
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

const UNIFORMS = ['uImage', 'uResolution', 'uImageSize', 'uPixelSize', 'uLevels', 'uSpread', 'uBrightness', 'uContrast', 'uMonochrome', 'uInvert', 'uDark', 'uLight', 'uTime', 'uWobble'] as const;

export class DitherBG extends HTMLElement {
  static observedAttributes = ['src', 'pixel-size', 'levels', 'spread', 'brightness', 'contrast', 'monochrome', 'invert', 'dark', 'light', 'wobble', 'speed'];

  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private image: HTMLImageElement | null = null;
  private fallbackImage: HTMLImageElement | null = null;
  private uniforms: Partial<Record<typeof UNIFORMS[number], WebGLUniformLocation | null>> = {};
  private resizeObserver: ResizeObserver | null = null;
  private unobserve: (() => void) | null = null;
  private cancelLoop: (() => void) | null = null;
  private cancelPaint: (() => void) | null = null;
  private media: MediaQueryList | null = null;
  private visible = false;
  private loading = false;
  private generation = 0;
  private time = 0;
  private dpr = 1;
  private dirty = true;

  connectedCallback() {
    if (this.canvas) return;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.width = this.canvas.height = 1;
    this.appendChild(this.canvas);
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.media = matchMedia('(prefers-reduced-motion: reduce)');
    if (this.media.addEventListener) this.media.addEventListener('change', this.restart);
    else this.media.addListener(this.restart);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this);
    } else window.addEventListener('resize', this.resize, { passive: true });
    this.unobserve = observeVisible(this, visible => {
      this.visible = visible;
      if (visible && !this.image && !this.loading) this.loadImage();
      this.restart();
    }, '120px');
  }

  disconnectedCallback() {
    this.generation++;
    this.cancelLoop?.();
    this.cancelPaint?.();
    this.cancelLoop = this.cancelPaint = null;
    this.unobserve?.();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    if (this.media?.removeEventListener) this.media.removeEventListener('change', this.restart);
    else this.media?.removeListener(this.restart);
    if (this.image) { this.image.onload = null; this.image.onerror = null; }
    this.canvas?.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.contextRestored);
    this.release();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
    this.canvas?.remove();
    this.fallbackImage?.remove();
    this.canvas = this.image = this.fallbackImage = null;
    this.loading = this.visible = false;
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value || !this.canvas) return;
    this.dirty = true;
    if (name === 'src') {
      this.cancelLoop?.();
      this.cancelPaint?.();
      this.cancelLoop = this.cancelPaint = null;
      this.generation++;
      if (this.image) { this.image.onload = null; this.image.onerror = null; }
      this.image = null;
      this.loading = false;
      if (this.visible) this.loadImage();
    } else if (name === 'wobble' || name === 'speed') this.restart();
    else this.requestPaint();
  }

  private num(name: string, fallback: number) {
    const value = parseFloat(this.getAttribute(name) || '');
    return Number.isFinite(value) ? value : fallback;
  }

  private rgb(name: string, fallback: string) {
    let hex = (this.getAttribute(name) || fallback).replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  private build() {
    if (!this.canvas) return false;
    try {
      this.gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
      if (!this.gl) return false;
      const gl = this.gl;
      const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const fragment = precision?.precision ? FRAG : FRAG.replace('precision highp', 'precision mediump');
      this.program = makeProgram(gl, VERT, fragment);
      gl.useProgram(this.program);
      this.buffer = makeTriangle(gl, this.program, 'aPos');
      this.texture = gl.createTexture();
      if (!this.texture) throw new Error('Texture allocation failed');
      for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(this.program, name);
      return true;
    } catch {
      this.release();
      return false;
    }
  }

  private loadImage() {
    const source = this.getAttribute('src');
    if (!source) return;
    const generation = ++this.generation;
    const image = new Image();
    this.image = image;
    this.loading = true;
    image.decoding = 'async';
    if (location.protocol !== 'file:') image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!this.isConnected || generation !== this.generation) return;
      image.onload = image.onerror = null;
      this.loading = false;
      this.dispatchEvent(new CustomEvent('artwork-load', { bubbles: true }));
      if (!this.program && !this.build()) { this.fallback(); return; }
      this.upload();
    };
    image.onerror = () => {
      if (!this.isConnected || generation !== this.generation) return;
      image.onload = image.onerror = null;
      this.loading = false;
      this.image = null;
      this.cancelLoop?.();
      this.cancelLoop = null;
      this.dispatchEvent(new CustomEvent('artwork-error', { bubbles: true }));
    };
    image.src = source;
  }

  private upload() {
    const gl = this.gl;
    if (!gl || !this.image || !this.texture) return;
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.dirty = true;
      this.resize();
      this.restart();
    } catch { this.fallback(); }
  }

  private resize = () => {
    if (!this.canvas || !this.gl) return;
    this.dpr = matchMedia('(pointer: coarse)').matches ? 1 : getProfile().dpr;
    const width = Math.max(1, Math.round(this.clientWidth * this.dpr));
    const height = Math.max(1, Math.round(this.clientHeight * this.dpr));
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.dirty = true;
    }
    this.requestPaint();
  };

  private restart = () => {
    this.cancelLoop?.();
    this.cancelLoop = null;
    this.dirty = true;
    if (!this.visible || !this.texture || this.loading || !this.image?.naturalWidth) return;
    const profile = getProfile();
    if (!profile.reduced && this.num('wobble', 0) > 0) {
      const speed = this.num('speed', 1);
      this.cancelLoop = onFrame((_time, delta) => {
        this.time += delta / 1000 * speed;
        this.draw();
      }, getQuality(profile).ditherFps);
    } else this.requestPaint();
  };

  private requestPaint() {
    if (this.cancelLoop || this.cancelPaint || !this.visible) return;
    this.cancelPaint = onFrame(() => {
      this.cancelPaint = null;
      this.draw();
      return false;
    });
  }

  private draw() {
    const gl = this.gl;
    const canvas = this.canvas;
    const image = this.image;
    if (!gl || !canvas || !image?.naturalWidth || !this.program || !this.texture || !this.visible || gl.isContextLost()) return;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const u = this.uniforms;
    if (this.dirty) {
      gl.uniform1i(u.uImage!, 0);
      gl.uniform2f(u.uResolution!, canvas.width, canvas.height);
      gl.uniform2f(u.uImageSize!, image.naturalWidth, image.naturalHeight);
      gl.uniform1f(u.uPixelSize!, Math.max(1, this.num('pixel-size', 4) * this.dpr));
      gl.uniform1f(u.uLevels!, this.num('levels', 2));
      gl.uniform1f(u.uSpread!, this.num('spread', 1));
      gl.uniform1f(u.uBrightness!, this.num('brightness', 0));
      gl.uniform1f(u.uContrast!, this.num('contrast', 1));
      gl.uniform1f(u.uMonochrome!, this.num('monochrome', 1));
      gl.uniform1f(u.uInvert!, this.num('invert', 0));
      gl.uniform3fv(u.uDark!, this.rgb('dark', '#0b0b0f'));
      gl.uniform3fv(u.uLight!, this.rgb('light', '#f2f2f2'));
      gl.uniform1f(u.uWobble!, this.media?.matches ? 0 : this.num('wobble', 0));
      this.dirty = false;
    }
    gl.uniform1f(u.uTime!, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private fallback() {
    this.cancelLoop?.();
    this.cancelLoop = null;
    this.fallbackImage?.remove();
    if (!this.image?.naturalWidth) return;
    this.fallbackImage = this.image.cloneNode() as HTMLImageElement;
    this.fallbackImage.alt = '';
    this.fallbackImage.className = 'dither-fallback';
    this.appendChild(this.fallbackImage);
  }

  private release() {
    if (this.gl) {
      this.gl.deleteTexture(this.texture);
      this.gl.deleteBuffer(this.buffer);
      this.gl.deleteProgram(this.program);
    }
    this.program = this.buffer = this.texture = null;
    this.uniforms = {};
  }

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.cancelLoop?.();
    this.cancelPaint?.();
    this.cancelLoop = this.cancelPaint = null;
    this.fallback();
  };

  private contextRestored = () => {
    this.release();
    if (this.build()) {
      this.fallbackImage?.remove();
      this.fallbackImage = null;
      this.upload();
    }
  };
}

if (typeof customElements !== 'undefined' && !customElements.get('dither-bg')) customElements.define('dither-bg', DitherBG);