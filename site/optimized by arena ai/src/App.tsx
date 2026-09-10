import { createElement, Fragment, memo, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { getProfile } from './lib/tier';
import type { DeviceProfile } from './lib/tier';
import { createGoldShader } from './lib/goldShader';
import { createExperience } from './lib/experience';
import { createWonders } from './lib/wonders';
import { initSmooth } from './lib/smooth';
import type { SmoothHandle } from './lib/smooth';
import './lib/dither';
import './polish.css';

function getSerial() {
  try {
    const saved = sessionStorage.getItem('asheo-serial');
    if (saved && /^ASH-01-[A-F0-9]{4}-\d{3}$/.test(saved)) return saved;
  } catch { /* The viewing still works with storage disabled. */ }
  const hex = Math.floor(Math.random() * 65536).toString(16).padStart(4, '0').toUpperCase();
  const serial = `ASH-01-${hex}-${String(Math.floor(Math.random() * 400) + 1).padStart(3, '0')}`;
  try { sessionStorage.setItem('asheo-serial', serial); } catch { /* Optional persistence. */ }
  return serial;
}

function useLocalTime() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => {
      try { setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
      catch { setTime(''); }
    };
    update();
    const id = window.setInterval(update, 20000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

const CHAPTERS = [
  ['top', 'I', 'OVERTURE'], ['kit', 'II', 'THE KIT'], ['how', 'III', 'METHOD'],
  ['ledger', 'IV', 'LEDGER'], ['download', 'V', 'ACCESS'], ['architect', 'VI', 'ARCHITECT'],
];
const RING_LINES = [
  <>Not just an extension &mdash; <b>it&apos;s your edge</b></>,
  <>Faster &middot; Cleaner &middot; <b>Unstoppable</b></>,
  <>Zero telemetry, <b>by design</b></>, <>Two megabytes of <b>intent</b></>,
  <>Built for the ones who <b>ship</b></>, <><b>Edition 01</b> &middot; numbered build</>,
  <>Handcrafted <b>in the dark</b></>, <>Your data stays <b>yours</b></>,
  <>No bloat &middot; No noise &middot; <b>Just speed</b></>, <>Chromium <b>MV3</b> native</>,
  <><b>40k+</b> early adopters</>, <>Early to it. <b>Always.</b></>,
];
const VOICES: Array<[string, string]> = [
  ['It replaced three extensions the day I installed it.', 'Mara — QA engineer'],
  ['The only tool I open before standup.', 'Devon — Frontend lead'],
  ['Sub-millisecond isn\u2019t marketing. I timed it.', 'Priya — Perf nerd'],
  ['No account. No tracking. No notes.', 'Jonas — Security reviewer'],
  ['My toolbar finally makes sense.', 'Alba — Indie hacker'],
  ['Edition 01 feels like holding a coin.', 'Rook — Collector'],
];
const FAQS: Array<[string, string]> = [
  ['Is it actually free?', 'Yes — the full kit, no trial clock and no card. If a paid tier ever exists, Edition 01 holders keep everything they have today.'],
  ['Which browsers work?', 'Any current Chromium: Chrome, Edge, Brave, Arc and Opera. One install, fully synced — no separate builds to keep straight.'],
  ['Why is there no account?', 'Because there is nothing to sync to a server. Everything runs and stays on your device, so an account would only add risk.'],
  ['How do I install the offline .zip?', 'Extract it somewhere permanent, open chrome://extensions, enable Developer mode, then Load unpacked and pick the folder. Thirty seconds, tops.'],
  ['Who built this?', 'ASH — solo. Every gateway, fallback and pixel, broken and rebuilt by hand until it felt instant.'],
];

function Mark({ size = 20, stroke = 6, dark = false }: { size?: number; stroke?: number; dark?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M22 74 L50 22 L78 74" stroke={dark ? '#584618' : '#C9A86A'} strokeWidth={stroke} strokeLinecap="round" />
    <path d="M36 58 H64" stroke={dark ? '#87713F' : '#FFF3D6'} strokeWidth={stroke} strokeLinecap="round" />
  </svg>;
}

function Arrow({ direction = 'down', size = 16 }: { direction?: 'down' | 'up' | 'left' | 'right'; size?: number }) {
  const path = direction === 'left' ? 'M15 18l-6-6 6-6' : direction === 'right' ? 'M9 6l6 6-6 6' : direction === 'up' ? 'M12 19V5M5 12l7-7 7 7' : 'M12 5v14M5 12l7 7 7-7';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={path} /></svg>;
}

function ChromeIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M12 12L20.5 7A10 10 0 0 0 3.5 7Z" fill="#EA4335" />
    <path d="M12 12L3.5 7A10 10 0 0 0 12 22Z" fill="#34A853" />
    <path d="M12 12L12 22A10 10 0 0 0 20.5 7Z" fill="#FBBC05" />
    <circle cx="12" cy="12" r="4.2" fill="#fff" /><circle cx="12" cy="12" r="3.3" fill="#4285F4" />
  </svg>;
}

/** Vault preloader. rAF-driven via refs — zero React re-renders until it opens. */
function Preloader({ onReady, reduced }: { onReady: () => void; reduced: boolean }) {
  const [done, setDone] = useState(false);
  const [visible, setVisible] = useState(!reduced);
  const completed = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const numRef = useRef<HTMLElement>(null);
  const stateRef = useRef<HTMLSpanElement>(null);
  const tumRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (completed.current) return;
    if (reduced) {
      completed.current = true;
      setVisible(false);
      onReadyRef.current();
      return;
    }
    document.body.classList.add('locked');
    const started = performance.now();
    const DURATION = 1150;
    const code = 'ASHEO01';
    const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const tumblers = tumRef.current ? Array.from(tumRef.current.querySelectorAll('b')) : [];
    let raf = 0;
    let lastTum = 0;
    let finishTimer = 0;
    let hideTimer = 0;

    const finish = () => {
      if (completed.current) return;
      completed.current = true;
      for (let i = 0; i < tumblers.length; i++) tumblers[i].textContent = code[i] || '';
      if (stateRef.current) stateRef.current.textContent = 'Open';
      setDone(true);
      document.body.classList.remove('locked');
      onReadyRef.current();
      hideTimer = window.setTimeout(() => setVisible(false), 1500);
    };
    const frame = (now: number) => {
      const p = Math.min(1, (now - started) / DURATION);
      rootRef.current?.style.setProperty('--pre', p.toFixed(3));
      if (ringRef.current) ringRef.current.style.transform = `rotate(${(p * 620).toFixed(1)}deg)`;
      if (numRef.current) numRef.current.textContent = String(Math.floor(p * 100)).padStart(3, '0');
      if (stateRef.current) stateRef.current.textContent = p > 0.92 ? 'Unlocking' : 'Aligning';
      if (now - lastTum > 70) {
        lastTum = now;
        const locked = Math.floor(p * code.length);
        for (let i = 0; i < tumblers.length; i++) {
          tumblers[i].textContent = i < locked ? code[i] : glyphs[(Math.random() * glyphs.length) | 0];
        }
      }
      if (p < 1) raf = requestAnimationFrame(frame);
      else finishTimer = window.setTimeout(finish, 220);
    };
    raf = requestAnimationFrame(frame);
    const failsafe = window.setTimeout(finish, 3500);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(finishTimer);
      window.clearTimeout(hideTimer);
      window.clearTimeout(failsafe);
      document.body.classList.remove('locked');
    };
  }, [reduced]);

  if (!visible) return null;
  return <div className={`pre${done ? ' done' : ''}`} id="pre" aria-hidden="true" ref={rootRef}>
    <div className="pre-door l" /><div className="pre-door r" />
    <div className="pre-core">
      <div className="dial"><svg viewBox="0 0 132 132" fill="none">
        <circle cx="66" cy="66" r="62" stroke="rgba(201,168,106,.22)" />
        <circle cx="66" cy="66" r="52" stroke="rgba(201,168,106,.4)" strokeDasharray="2 7" />
        <g className="dial-ring" ref={ringRef}>
          <circle cx="66" cy="14" r="3" fill="#FFF3D6" /><path d="M66 30 L66 44" stroke="#C9A86A" strokeWidth="1.5" />
        </g>
        <path d="M46 88 L66 44 L86 88" stroke="#C9A86A" strokeWidth="3" strokeLinecap="round" />
        <path d="M55 74 H77" stroke="#FFF3D6" strokeWidth="3" strokeLinecap="round" />
      </svg></div>
      <div className="dial-tumblers" ref={tumRef}>{'ASHEO01'.split('').map((_, i) => <span className="tum" key={i}><b>0</b></span>)}</div>
      <div className="pre-bar" />
      <div className="pre-meta"><span>Vault <b ref={numRef}>000</b></span><span>Edition <b>01</b></span><span ref={stateRef}>Aligning</span></div>
    </div>
  </div>;
}

const Atmosphere = memo(function Atmosphere({ profile }: { profile: DeviceProfile }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) return createGoldShader(canvas.current, profile);
  }, [profile]);
  return <>
    <div className="atmosphere-fallback" aria-hidden="true" /><canvas id="gl" ref={canvas} aria-hidden="true" />
    <div className="plumb" aria-hidden="true" /><div className="spot" aria-hidden="true" />
    <div className="aura aura-a" aria-hidden="true" /><div className="aura aura-b" aria-hidden="true" />
    <div className="scroll-glow" id="scrollGlow" aria-hidden="true" />
    <div className="vignette" aria-hidden="true" /><div className="noise" aria-hidden="true" /><div className="scan" aria-hidden="true" />
  </>;
});

const Nav = memo(function Nav() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('asheo:menu', { detail: open }));
    if (!open) return;
    const first = document.querySelector<HTMLElement>('.mmenu a');
    const t = window.setTimeout(() => first?.focus({ preventScroll: true }), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => { if (innerWidth > 1000) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.dispatchEvent(new CustomEvent('asheo:menu', { detail: false }));
      btnRef.current?.focus({ preventScroll: true });
    };
  }, [open ]);
  return <>
    <nav className="rail" aria-label="Chapters"><span className="rail-spine" aria-hidden="true"><i id="railSpineFill" /></span>{CHAPTERS.map(([id, numeral, title]) => <a href={`#${id}`} data-rail={id} key={id}><i />{numeral} &middot; {title}</a>)}</nav>
    <nav className="nav" id="nav" aria-label="Main navigation"><div className="wrap nav-in">
      <a href="#top" className="nav-left" data-mag aria-label="ASHEO home"><span className="mono-mark"><Mark /></span><span className="logo-wordmark">ASHEO<span>&reg;</span></span></a>
      <div className="nav-links" id="navLinks"><span className="nav-ind" id="navInd" />
        <a href="#kit" data-rail="kit">The Kit</a><a href="#how" data-rail="how">Method</a><a href="#ledger" data-rail="ledger">Ledger</a><a href="#architect" data-rail="architect">Architect</a>
      </div>
      <div className="nav-right"><button className="icon-btn" id="sound" aria-label="Turn sound on" aria-pressed="false" title="Sound (S)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 9v6h3l5 4V5L7 9H4z" /><path d="M17 9a5 5 0 0 1 0 6" /></svg>
      </button><a href="#download" className="nav-cta" data-mag>Acquire<Arrow size={14} /></a><button ref={btnRef} className="menu-btn" aria-expanded={open} aria-controls="mmenu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(v => !v)}><span /></button></div>
    </div></nav>
    <div className={`mmenu${open ? ' open' : ''}`} id="mmenu" aria-hidden={!open} onClick={e => { if ((e.target as Element).closest('a')) setOpen(false); }}>
      {CHAPTERS.map(([id, numeral, title]) => <a key={id} href={`#${id}`} tabIndex={open ? 0 : -1}><small>{numeral}</small>{title.charAt(0) + title.slice(1).toLowerCase()}</a>)}
      <a href="#palette" tabIndex={open ? 0 : -1} onClick={e => { e.preventDefault(); setOpen(false); window.setTimeout(() => window.dispatchEvent(new Event('asheo:palette')), 140); }}><small>⌘K</small>Search everything</a>
      <div className="mmenu-foot">ASHEO &middot; Edition 01 &middot; {open ? 'Where to?' : ''}</div>
    </div>
  </>;
});

function Split({ text }: { text: string }) {
  return <>{text.split('').map((character, i) => <span key={i} className="ch" style={{ transitionDelay: `${i * 0.028}s`, '--i': i } as CSSProperties}>{character}</span>)}</>;
}

function Flap({ digits, prefix = '', suffix, dot = false, index }: { digits: string; prefix?: string; suffix: string; dot?: boolean; index: number }) {
  const label = prefix + (dot ? `${digits[0]}.${digits.slice(1)}` : digits) + suffix;
  return <div className="flap" aria-label={label}>
    {prefix && <span className="fx" aria-hidden="true">{prefix}</span>}
    {digits.split('').map((digit, i) => <Fragment key={i}>
      {dot && i === 1 && <span className="fx" aria-hidden="true">.</span>}
      <span className="col" aria-hidden="true"><b style={{ '--digit': Number(digit), transitionDelay: `${index * 0.12 + i * 0.09}s` } as CSSProperties}>
        {Array.from({ length: 10 }, (_, n) => <span key={n}>{n}</span>)}
      </b></span>
    </Fragment>)}
    <span className="fx" aria-hidden="true">{suffix}</span>
  </div>;
}

const Artifact = memo(function Artifact({ serial, secondary = false }: { serial: string; secondary?: boolean }) {
  const lidContent = <div className="lid-in"><div className="artifact-heading"><div className="artifact-icon"><Mark /></div><div><div className="artifact-title">ASHEO</div><div className="artifact-meta">v1.5.2 &bull; 1.8MB &bull; MV3</div></div></div><span className="artifact-badge"><i />Live</span></div>;
  return <div className="artifact" id={secondary ? 'artifact2' : 'artifact'}>
    <div className="artifact-shadow" />
    {!secondary && <div className="orbit" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => {
      const random = (n: number) => { const value = Math.sin((i + 1) * n) * 43758.5453; return value - Math.floor(value); };
      return <span className="shard" key={i} style={{ transform: `rotateY(${i / 16 * 360}deg) translateZ(262px) translateY(${(random(127.1) - 0.5) * 280}px) rotateX(${random(311.7) * 90}deg)`, opacity: 0.3 + random(74.7) * 0.55 }} />;
    })}</div>}
    <div className="frame"><span className="frame-spin" /><div className="artifact-card">
      <div className="artifact-glare" />
      {secondary ? <div className="lid static-lid">{lidContent}</div> : <button type="button" className="lid" aria-expanded="false" aria-label="Open or close the ASHEO case" title="Open">
        {lidContent}<span className="lid-hint"><i />Click to open the case</span>
      </button>}
      <div className="artifact-body">
        <div className="compat d1">{['Chrome', 'Edge', 'Brave', 'Arc'].map(browser => <span key={browser}><i />{browser}</span>)}</div>
        <button className="primary-cta d3" data-cta="store" data-mag><ChromeIcon />Add to Chrome &mdash; It&apos;s Free</button>
        <button className="secondary-cta d2" data-cta="offline" data-mag><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12l7 7 7-7" /><path d="M4 21h16" /></svg>Download .zip (offline)</button>
        <div className="artifact-foot d1"><span>Free forever</span><span className="separator">&mdash;</span><span>1-click install</span><span className="separator">&mdash;</span><span>No account</span></div>
        {!secondary && <div className="artifact-trust d1"><span className="stars" role="img" aria-label="Rated 5 out of 5 stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span><span>Loved by builders &amp; testers worldwide</span></div>}
        <div className="serialbar">Build serial <span>{serial}</span></div>
      </div>
    </div></div>
    {!secondary && <span className="drag-hint">Drag to rotate &middot; click the lid to open</span>}
  </div>;
});

const Hero = memo(function Hero({ serial }: { serial: string }) {
  return <section className="hero scene" data-visible="true" data-chapter="top" aria-label="Introduction">
    <div>
      <div className="exhibit-tag"><span className="exhibit-line" /><span className="exhibit-txt">Exhibit I &mdash; Now on view &bull; v1.5.2</span></div>
      <div className="h1-stage"><h1 className="h1" id="h1" aria-label="THE WAIT IS OVER. ASHEO is here.">
        <span className="ln" aria-hidden="true"><Split text="THE WAIT" /></span>
        <span className="ln" aria-hidden="true"><b><Split text="IS " /></b><span className="x3d"><span className="x3d-face">OVER.</span>{Array.from({ length: 15 }, (_, n) => {
          const i = 15 - n, k = i / 15;
          return <span className="x3d-layer" key={i} style={{ transform: `translateZ(${-i * 2.3}px)`, color: `rgb(${Math.round(146 - 96 * k)},${Math.round(118 - 78 * k)},${Math.round(66 - 46 * k)})` }}>OVER.</span>;
        })}</span></span>
        <span className="ln" aria-hidden="true"><em><Split text="ASHEO is here." /></em></span>
      </h1></div>
      <p className="hero-sub rv" style={{ transitionDelay: '.55s' }}>Not just an extension. <strong>It&apos;s your edge.</strong><br />For the ones who do more &mdash; faster, cleaner, unstoppable.</p>
      <p className="hero-copy rv" style={{ transitionDelay: '.63s' }}>Custom payment gateways, BIN tools and integrity checks &mdash; packed into a clean 2MB MV3 artifact. No bloat, no telemetry, no account. Your data stays yours. Period.</p>
      <div className="hero-stats rv" style={{ transitionDelay: '.71s' }}>
        <div className="stat"><Flap digits="40" suffix="k+" index={0} /><div className="stat-label">Early adopters</div></div>
        <div className="stat"><Flap digits="2" prefix="<" suffix="MB" index={1} /><div className="stat-label">Zero bloat</div></div>
        <div className="stat"><Flap digits="49" dot suffix="/5" index={2} /><div className="stat-label">Rated excellence</div></div>
      </div>
    </div>
    <div className="artifact-wrap rv" style={{ transitionDelay: '.78s' }}><Artifact serial={serial} /></div>
    <div className="scroll-cue" aria-hidden="true"><span>Scroll</span><i /></div>
  </section>;
});

function SectionHeading({ name, numeral, children, lede }: { name: string; numeral: string; children: ReactNode; lede?: string }) {
  return <div className="rv"><div className="sec-eyebrow">{name}<span className="sec-num">&mdash; Exhibit {numeral}</span></div><h2 className="sec-h2">{children}</h2>{lede && <p className="sec-lede">{lede}</p>}</div>;
}

const FEATURES = [
  { n: '01', type: 'PERFORMANCE', name: 'Lightning Fast', body: 'Sub-millisecond execution inside two megabytes. Nothing idles, nothing polls, nothing waits on a server. Your tabs never feel it — you do.', tag: '<2MB · MV3 · Instant', icon: <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" /> },
  { n: '02', type: 'PRIVACY', name: 'Privacy First', body: 'Local-only by architecture, not by promise. No trackers, no analytics, no account wall. Your data never leaves the device that made it.', tag: 'Zero telemetry', icon: <><path d="M12 3l7 3v5c0 4.2-3 7.3-7 8-4-.7-7-3.8-7-8V6l7-3z" /><path d="M9 12l2 2 4-4" /></> },
  { n: '03', type: 'COMPATIBILITY', name: 'Works Everywhere', body: 'Chrome, Edge, Brave, Arc, Opera. One install, every Chromium engine, fully synced — and no separate builds to keep straight.', tag: '5 engines', icon: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /><path d="M2 12h2M20 12h2M12 2v2M12 20v2" /></> },
  { n: '04', type: 'CRAFT', name: 'OG Design', body: 'Pure dark, obsessively spaced, keyboard-first. Every shortcut sits where your hand already is. An interface as sharp as it feels.', tag: 'Keyboard-native', icon: <path d="M12 3l2.5 5.1L20 9l-4 4 1 5.8L12 16l-5 2.8 1-5.8L4 9l5.5-.9L12 3z" /> },
];

const Kit = memo(function Kit() {
  return <section className="sec-pad scene" id="kit" data-chapter="kit">
    <SectionHeading name="The Kit" numeral="II" lede="Four pillars, obsessively crafted — not forty half-finished features. Take hold of the ring and turn it; the piece in focus comes to you.">Everything you need.<br /><b>Nothing</b> <i>you don&apos;t.</i></SectionHeading>
    <div className="orb-stage rv" id="orbStage" data-speed="0.12" role="region" aria-label="The four pillars of ASHEO. Use left and right arrows to browse." aria-roledescription="carousel" tabIndex={0}>
      <div className="orb-glow" aria-hidden="true" />
      <div className="orb">{FEATURES.map((feature, i) => <article className={`orb-card${i === 0 ? ' front' : ''}`} key={feature.n} aria-label={`${i + 1} of 4: ${feature.name}`} aria-hidden={i !== 0}>
        <div className="orb-num">{feature.n} &mdash; {feature.type}</div>
        <div className="orb-icon"><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{feature.icon}</svg></div>
        <h3>{feature.name}</h3><p>{feature.body}</p><span className="orb-tag">{feature.tag}</span>
      </article>)}</div>
      <div className="orb-hint" aria-hidden="true"><span>Drag&nbsp;·&nbsp;swipe to spin</span></div>
    </div>
    <div className="orb-ctrl rv"><button className="orb-btn" data-prev aria-label="Previous feature"><Arrow direction="left" /></button><div className="orb-dots">{FEATURES.map((feature, i) => <button className={`orb-dot${i === 0 ? ' on' : ''}`} key={feature.n} aria-label={`Show ${feature.name}`} aria-pressed={i === 0} />)}</div><button className="orb-btn" data-next aria-label="Next feature"><Arrow direction="right" /></button><div className="orb-progress" aria-hidden="true"><i /></div></div>
    <div className="quote-wrap rv"><div className="quote-text" data-speed="0.12">&ldquo;Faster. Cleaner.<br /><i>Unstoppable.</i>&rdquo;</div><div className="quote-side"><p>We removed everything that slows you down. What remains is pure signal &mdash; payment rules that actually route, BINs that actually generate, protection that actually protects.</p><div className="quote-attr"><span className="mono-mark small-mark"><Mark size={15} stroke={7} /></span><div><strong>Asheo Team</strong><br /><em>Engineering &middot; 2026</em></div></div></div></div>
  </section>;
});

const Method = memo(function Method() {
  return <section className="sec-pad scene" id="how" data-chapter="how">
    <SectionHeading name="The Method" numeral="III">Three steps.<br /><i>Twenty seconds.</i></SectionHeading>
    <div className="method"><svg className="method-svg" data-speed="0.3" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="mg" x1="0" x2="1"><stop offset="0" stopColor="#6B5731" /><stop offset=".5" stopColor="#C9A86A" /><stop offset="1" stopColor="#FFF3D6" /></linearGradient></defs>
      <path id="methodPath" d="M120,40 C300,140 420,-40 600,40 C780,120 900,-30 1080,40" fill="none" stroke="url(#mg)" strokeWidth="1.4" strokeLinecap="round" />
    </svg><div className="method-grid">
      <div className="step rv"><div className="step-no">01</div><h3>Download</h3><p>Hit the button. No sign-up, no email wall, no credit card. Just the file.</p></div>
      <div className="step rv" style={{ transitionDelay: '.11s' }}><div className="step-no">02</div><h3>Add to Browser</h3><p>One click to confirm. ASHEO pins to your toolbar &mdash; configured and ready.</p></div>
      <div className="step rv" style={{ transitionDelay: '.22s' }}><div className="step-no">03</div><h3>Go OG</h3><p>Open any tab. Feel the difference instantly. That is the whole onboarding.</p></div>
    </div></div>
  </section>;
});

const Voices = memo(function Voices() {
  return <section className="voices scene" aria-label="What early adopters say">
    <div className="wrap">
      <div className="rv"><div className="sec-eyebrow">Word of mouth</div><h2 className="sec-h2">Loud in <i>private.</i></h2></div>
    </div>
    <div className="marquee rv" role="marquee" aria-label="Early adopter quotes">
      <div className="marquee-track">
        {[0, 1].map(copy => <div className="marquee-group" key={copy} aria-hidden={copy === 1}>
          {VOICES.map(([quote, author]) => <figure className="voice" key={quote}>
            <blockquote>&ldquo;{quote}&rdquo;</blockquote>
            <figcaption>{author}</figcaption>
          </figure>)}
        </div>)}
      </div>
    </div>
  </section>;
});

function Coin() {
  return <div className="coin-stage" data-speed="0.25"><div className="coin">
    <div className="coin-face front"><div className="coin-content"><svg width="74" height="74" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M24 74 L50 24 L76 74" stroke="#584618" strokeWidth="7" strokeLinecap="round" /><path d="M37 57 H63" stroke="#87713F" strokeWidth="7" strokeLinecap="round" /></svg><div className="coin-txt">Asheo<br />Edition 01</div></div><div className="coin-shine" /></div>
    <div className="coin-face back"><div className="coin-txt">Certified<br />No Telemetry<br />1.5.2</div><div className="coin-shine" /></div>
    {Array.from({ length: 48 }, (_, i) => <span className="coin-rim" key={i} style={{ width: `${2 * Math.PI * 98 / 48 + 1.5}px`, transform: `translate(-50%,-50%) rotateY(${i * 7.5}deg) translateZ(98px)` }} />)}
  </div></div>;
}

const Ledger = memo(function Ledger({ serial }: { serial: string }) {
  const specifications = [
    ['Version', '1.5.2 — Edition 01'], ['Manifest', 'Chromium MV3'], ['Package size', '1.8 MB'],
    ['Network calls', 'None'], ['Trackers / analytics', 'Zero'], ['Account required', 'No'],
    ['Storage', 'Local device only'], ['Supported engines', 'Chrome · Edge · Brave · Arc · Opera'], ['Price', 'Free, forever'],
  ];
  return <section className="ledger scene" id="ledger" data-chapter="ledger"><div className="ledger-grain" /><div className="gold-leaf" id="goldLeaf" />
    <div className="wrap ledger-in"><div className="rv"><div className="ledger-eyebrow">The Ledger &mdash; Exhibit IV</div><h2 className="ledger-h2">Every claim,<br /><i>on the record.</i></h2><p className="ledger-lede">No marketing fog. These are the actual numbers behind the build, printed like a spec sheet &mdash; because that is exactly what they are.</p><div className="spec">{specifications.map(([key, value]) => <div className="spec-row" key={key}><span>{key}</span><span>{value}</span></div>)}</div></div>
      <div className="cert rv" style={{ transitionDelay: '.12s' }}><div className="cert-head">Certificate of Authenticity</div><div className="cert-title">ASHEO <i>Edition 01</i></div><div className="cert-rule" /><p className="cert-body">This build was assembled, broken and rebuilt by hand. It carries no telemetry, no third-party payload and no obligation.</p>
        <Coin />
        <div className="stamp-zone" id="stampZone"><button className="stamp-btn" id="stampBtn">Press to seal your copy</button><span className="wax-shock" id="waxShock" />
          <svg className="wax" id="wax" viewBox="0 0 120 120" aria-hidden="true"><defs><radialGradient id="waxg" cx="35%" cy="28%"><stop offset="0" stopColor="#C4544A" /><stop offset="55%" stopColor="#96322C" /><stop offset="100%" stopColor="#5E1C18" /></radialGradient></defs><path d="M60 4c14 6 24-4 34 8s2 24 8 34-14 20-14 34-16 14-28 14-22 6-32-4-6-22-14-32S4 40 14 30 34 24 44 14 46-2 60 4z" fill="url(#waxg)" /><circle cx="60" cy="62" r="34" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.5" /><path d="M44 78 L60 42 L76 78" stroke="rgba(255,235,225,.85)" strokeWidth="5" strokeLinecap="round" fill="none" /><path d="M52 66 H68" stroke="rgba(255,235,225,.85)" strokeWidth="5" strokeLinecap="round" /></svg>
          <span className="stamped-note">Sealed &middot; <b>{serial}</b></span>
        </div>
        <div className="cert-foot"><div>Serial<div className="cert-sign serial-sign">{serial}</div></div><div className="signature">Signed<div className="cert-sign">Ash</div></div></div>
      </div>
    </div>
  </section>;
});

const Access = memo(function Access({ serial }: { serial: string }) {
  return <section className="final rv scene" id="download" data-chapter="download"><div className="corridor" data-speed="0.5" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <div className="corr-ring" key={i} style={{ width: 420 + i * 44, height: 420 + i * 44, margin: `${-(420 + i * 44) / 2}px 0 0 ${-(420 + i * 44) / 2}px`, animationDelay: `${-i * 1.07}s` }} />)}</div>
    <div><div className="sec-eyebrow">Access<span className="sec-num">&mdash; Exhibit V</span></div><h2 className="final-h2">Ready to<br /><i>go OG?</i></h2><p className="final-lede">Free forever. Two megabytes. Zero excuses left. The extension the top 1% already use &mdash; now it&apos;s your turn.</p><p className="access-meta mono">Asheo v1.5.2 &bull; Chromium MV3 &bull; Tested on 40k+ installs</p></div>
    <div className="artifact-wrap" style={{ padding: 0 }}><Artifact serial={serial} secondary /></div>
  </section>;
});

function Portrait() {
  const element = useRef<HTMLElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [source, setSource] = useState('/assets/dev-cutout.png');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    const failed = () => { setMissing(true); setError('Add the supplied PNG to restore the original artwork.'); };
    const loaded = () => { setMissing(false); setError(''); };
    host.addEventListener('artwork-error', failed);
    host.addEventListener('artwork-load', loaded);
    return () => { host.removeEventListener('artwork-error', failed); host.removeEventListener('artwork-load', loaded); };
  }, []);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  return <div className="dev-ash-right">
    {createElement('dither-bg', {
      ref: element, id: 'dither-dev', src: source, 'pixel-size': '2.0', levels: '4', spread: '0.68', brightness: '-0.01', contrast: '1.24',
      monochrome: '1', invert: '0', dark: '#050508', light: '#f5f2eb', wobble: '0.06', speed: '0.4', role: 'img', 'aria-label': 'ASH artwork rendered with the original dot-dither shader',
    })}
    {missing && <div className="artwork-missing"><Mark size={42} stroke={4} /><p>{error}</p><label className="artwork-picker">Choose dev-cutout.png<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Choose a PNG, JPEG, or WebP under 10 MB.'); return; }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(file);
      setSource(objectUrl.current);
      setError('Loading your artwork...');
    }} /></label><small>Local preview only. Nothing is uploaded.</small></div>}
  </div>;
}

const Architect = memo(function Architect() {
  const boasts = [
    ['01', 'Built solo, not outsourced', 'Every line, every bypass, every edge case — written, broken and fixed by ASH alone.'],
    ['02', 'Privacy is the foundation', 'Local-only. No trackers. No analytics. No account wall. Your data never leaves your device.'],
    ['03', '2MB that hits harder than 200MB', 'Sub-millisecond execution, under two megabytes. ASH made it feel instant.'],
    ['04', 'For the ones who ship', 'Not for everyone. Built for the people who test, break and stay early.'],
  ];
  return <section className="dev-arch rv scene" id="architect" data-chapter="architect" aria-label="ASH, The Architect">
    <div className="dev-arch-head" data-speed="0.2"><div className="dev-arch-kicker"><span />The Architect &mdash; ASH &middot; Exhibit VI</div><h2 className="dev-arch-title">Built by <i>ASH.</i><br />Obsessed beyond reason.</h2><p className="dev-arch-sub">No team. No funding. No shortcuts. Just ASH, who refused to ship mediocrity.</p></div>
    <div className="dev-ash-grid"><div className="dev-ash-left"><div className="dev-card"><h3 className="dev-name">ASH</h3><p className="dev-role">Solo Builder &bull; Architect of ASHEO &bull; MV3 Engineer</p><div className="dev-stats"><div><b>40k+</b><span>Early adopters</span></div><div><b>1.5.2</b><span>Shipped</span></div><div><b>&lt;2MB</b><span>Zero bloat</span></div></div><p className="dev-bio">ASH hand-tuned every gateway, every fallback, every pixel. If ASHEO feels effortless, it&apos;s because the hard part was obsessed over for months. This isn&apos;t a side project &mdash; it&apos;s ASH&apos;s craft.</p><div className="dev-actions"><a href="#download" className="dev-btn" data-mag>Get ASHEO &mdash; Free</a><a href="#follow" data-info="Follow ASH" className="dev-btn dev-btn--ghost" data-mag>Follow ASH</a></div></div>
      <div className="dev-boasts">{boasts.map(([number, title, body]) => <article className="boast" key={number}><span className="boast-num">{number}</span><h4>{title}</h4><p>{body}</p></article>)}<div className="dev-quote"><p>&ldquo;Not just an extension. It&apos;s your edge &mdash; so I built it like one.&rdquo;</p><span>&mdash; ASH, Architect of ASHEO</span></div></div>
    </div><Portrait /></div>
  </section>;
});

const Faq = memo(function Faq() {
  return <section className="faq scene" id="faq" aria-label="Frequently asked questions">
    <div className="rv"><div className="sec-eyebrow">Fine print, plainly</div><h2 className="sec-h2">Asked, <i>answered.</i></h2></div>
    <div className="faq-list rv">
      {FAQS.map(([question, answer]) => <details className="faq-item" key={question}>
        <summary><span>{question}</span><span className="faq-plus" aria-hidden="true">+</span></summary>
        <div className="faq-body"><div><p>{answer}</p></div></div>
      </details>)}
    </div>
  </section>;
});

const Footer = memo(function Footer() {
  return <footer className="scene"><div className="footer-grid"><div className="footer-brand"><a href="#top" className="footer-logo"><span className="mono-mark small-mark"><Mark size={16} stroke={7} /></span><span>ASHEO</span></a><p>ASHEO &mdash; Made for the future. Custom payment gateways, BIN tools and integrity checks as a clean, private MV3 extension.</p></div>
    <div className="footer-links"><div className="footer-col"><h4>Product</h4><a href="#kit">The Kit</a><a href="#how">Method</a><a href="#ledger">The Ledger</a><a href="#download">Download</a></div><div className="footer-col"><h4>Connect</h4>{['X / Twitter', 'Discord', 'GitHub'].map(name => <a href="#connect" data-info={name} key={name}>{name}</a>)}</div><div className="footer-col"><h4>Legal</h4>{['Privacy', 'Terms', 'Changelog'].map(name => <a href={`#${name.toLowerCase()}`} data-info={name} key={name}>{name}</a>)}</div></div>
  </div><div className="footer-bottom"><span>&copy; 2026 ASHEO. All rights reserved.</span><span className="egg">Type <b>ASH</b> anywhere &middot; press <b>/</b> to jump</span><span>Built OG. No tracking. No bloat.</span></div><div className="wm-stage"><div className="wm" id="wm"><span className="wm-face">ASHEO</span></div></div></footer>;
});

function Palette() {
  return <div className="palette-backdrop" id="palette" hidden>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Quick navigation">
      <input id="paletteInput" type="text" placeholder="Jump to a chapter, or try “sound”…" aria-label="Search chapters and actions" autoComplete="off" spellCheck={false} />
      <div className="palette-list" id="paletteList" role="listbox" aria-label="Results">
        <button role="option" data-goto="top"><span>Overture — back to the top</span><kbd>1</kbd></button>
        <button role="option" data-goto="kit"><span>The Kit — four pillars</span><kbd>2</kbd></button>
        <button role="option" data-goto="how"><span>The Method — twenty seconds</span><kbd>3</kbd></button>
        <button role="option" data-goto="ledger"><span>The Ledger — on the record</span><kbd>4</kbd></button>
        <button role="option" data-goto="download"><span>Access — get ASHEO</span><kbd>5</kbd></button>
        <button role="option" data-goto="architect"><span>The Architect — meet ASH</span><kbd>6</kbd></button>
        <button role="option" data-act="sound"><span>Toggle sound — glass &amp; brass</span><kbd>S</kbd></button>
        <button role="option" data-act="seal"><span>Seal your copy in wax</span><kbd>W</kbd></button>
        <button role="option" data-act="collector"><span>Collector mode — gold rain</span><kbd>A</kbd></button>
      </div>
      <div className="palette-hint"><span>&uarr;&darr; move</span><span>&crarr; open</span><span>esc close</span></div>
    </div>
  </div>;
}

function Information({ topic, close }: { topic: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.querySelector<HTMLButtonElement>('button')?.focus(); }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,[tabindex="0"]');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', keyboard);
    return () => {
      dialog.removeEventListener('keydown', keyboard);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [close]);
  const install = topic === 'install' || topic === 'offline';
  const title = install ? topic === 'offline' ? 'Your offline copy.' : 'ASHEO, in your browser.' : topic;
  return <dialog ref={ref} className="info-dialog" aria-labelledby="info-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  }}><button className="dialog-close" onClick={close} aria-label="Close dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button><div className="sec-eyebrow">ASHEO &middot; Edition 01</div><h2 id="info-title">{title}</h2>
    {install ? <><p>The original source didn&apos;t include a Chrome Web Store link or the extension archive. No extension has been installed or downloaded.</p><p className="dialog-note">Once you have the official .zip:</p><ol><li>Extract the archive into a folder you can keep.</li><li>Open <code>chrome://extensions</code> and enable Developer mode.</li><li>Choose Load unpacked and select the extracted folder.</li></ol><button className="secondary-cta" onClick={async () => {
      try {
        await navigator.clipboard.writeText('chrome://extensions');
        if (ref.current?.isConnected) { setCopied(true); setCopyError(false); }
      } catch { if (ref.current?.isConnected) setCopyError(true); }
    }}>{copied ? 'Copied browser address' : 'Copy chrome://extensions'}</button>{copyError && <p className="dialog-fine" role="status">Clipboard access isn&apos;t available. Select and copy the address above.</p>}<p className="dialog-fine">Desktop Chromium browsers only. Edge uses edge://extensions.</p></>
    : topic === 'Privacy' ? <><p>This website does not run analytics, collect payment information, or send data to an extension backend.</p><p>Session storage remembers your viewing serial and wax seal. A sound preference is saved on this device only. Artwork selected in this preview stays on your device. Fonts are requested from Google Fonts.</p><p className="dialog-fine">The extension itself is not included in this preview. Its privacy claims have not been independently verified here.</p></>
    : topic === 'Terms' ? <><p>This page is a preview of the supplied ASHEO design. The extension, its license, and production terms were not supplied.</p><p>Use any development or testing tools only on systems and data you are authorized to work with.</p></>
    : topic === 'Changelog' ? <><p>Website restoration &middot; Edition 01</p><ul><li>Original typography, layout, and copy restored.</li><li>Original Bayer8 dither shader reinstated.</li><li>Visibility-aware rendering and resource cleanup.</li><li>Corrected case, carousel, sound, and counter behavior.</li><li>Word of mouth, FAQ and command palette added.</li></ul></>
    : <><p>The original source contains a placeholder for this link, but no destination.</p><p>ASH&apos;s official {topic === 'Follow ASH' ? 'profile' : topic} URL needs to be connected before this link can take you there.</p></>}
  </dialog>;
}

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState(getProfile);
  const [serial] = useState(getSerial);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [information, setInformation] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const time = useLocalTime();
  const finish = useCallback(() => setReady(true), []);
  const openInformation = useCallback((topic: string) => setInformation(topic), []);
  const closeInformation = useCallback(() => setInformation(null), []);
  const notify = useCallback((message: string) => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => { setToast(''); toastTimer.current = null; }, 2800);
  }, []);

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setProfile(getProfile());
    if (query.addEventListener) query.addEventListener('change', update);
    else query.addListener(update);
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', update);
      else query.removeListener(update);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('tier-0', 'tier-1', 'tier-2');
    document.documentElement.classList.add(`tier-${profile.tier}`);
    return () => document.documentElement.classList.remove(`tier-${profile.tier}`);
  }, [profile]);

  const smoothRef = useRef<SmoothHandle | null>(null);
  useEffect(() => {
    if (!ready || !root.current) return;
    const smooth = initSmooth(profile);
    smoothRef.current = smooth;
    const dispose = createExperience(root.current, profile, serial, notify, openInformation, smooth);
    const disposeWonders = createWonders(root.current, profile, smooth);
    return () => { dispose(); disposeWonders(); smooth.destroy(); smoothRef.current = null; };
  }, [ready, profile, serial, notify, openInformation]);

  return <div className={`asheo-root${ready ? ' ready' : ''}`} ref={root}>
    <a className="skip-link" href="#kit">Skip introduction</a>
    <Preloader onReady={finish} reduced={profile.reduced} />
    <div className="curtain" id="curtain" aria-hidden="true"><svg className="curtain-mark" width="54" height="54" viewBox="0 0 100 100" fill="none"><path d="M22 74 L50 22 L78 74" stroke="#C9A86A" strokeWidth="5" strokeLinecap="round" /><path d="M36 58 H64" stroke="#FFF3D6" strokeWidth="5" strokeLinecap="round" /></svg></div>
    <div className="chapter-card" id="chapterCard" aria-hidden="true"><div className="cc-bar cc-top" /><div className="cc-mid"><span className="cc-num">I</span><span className="cc-rule" /><span className="cc-col"><span className="cc-name">Overture</span><span className="cc-sub">Exhibit I</span></span></div><div className="cc-bar cc-bot" /></div>
    <Atmosphere profile={profile} /><div className="prog" aria-hidden="true" />
    <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite"><i /><span>{toast}</span></div>
    <div className="plate">Numbered edition<b>{serial} / 500</b>{time && <i>{time} local</i>}</div>
    <button id="toTop" className="to-top" aria-label="Back to top"><Arrow direction="up" size={18} /></button>
    <Nav />
    <main className="shell" id="top"><div className="skewer">
      <div className="wrap"><Hero serial={serial} /></div>
      <div className="ring-band rv scene" aria-hidden="true"><div className="ring">{RING_LINES.map((line, i) => <div className="ring-panel" key={i} style={{ transform: `rotateY(${i * 30}deg) translateZ(var(--ring-radius))` }}>{line}</div>)}</div></div>
      <div className="wrap"><div className="ledgerbar rv"><span>Asheo&reg; &mdash; Custom gateways, BIN tools &amp; integrity checks</span><span style={{ opacity: .35 }}>&middot;</span><span className="ledgerbar-end">Chromium MV3 &middot; Made for the future &middot; No tracking, ever.</span></div><Kit /><Method /></div>
      <Voices />
      <Ledger serial={serial} /><div className="wrap"><Access serial={serial} /></div><Architect /><div className="wrap"><Faq /><Footer /></div>
    </div></main>
    <Palette />
    {information && <Information topic={information} close={closeInformation} />}
  </div>;
}
