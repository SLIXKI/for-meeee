import { Scope, observeVisible, onFrame, clamp, lerp } from './frames';
import { createAudio } from './audio';
import { createParticles } from './particles';
import { createGallery } from './gallery';
import { createMarquee } from './marquee';
import { createScrollManager } from './scroll';
import { createCursor } from './cursor';
import type { DeviceProfile } from './tier';
import type { SmoothHandle } from './smooth';

const SOUND_KEY = 'asheo-sound';

function readSoundPref(): boolean {
  try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}
function writeSoundPref(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* Private mode. */ }
}

/** Spring-lerped magnetic hover — buttery pull toward cursor, soft release. */
function magnets(root: HTMLElement, scope: Scope) {
  for (const element of root.querySelectorAll<HTMLElement>('[data-mag]')) {
    let rect: DOMRect | null = null;
    let cachedY = 0;
    let tx = 0, ty = 0, cx = 0, cy = 0;
    let job: (() => void) | null = null;
    let bx = 50, by = 50;
    const depth = element.classList.contains('d3') ? 56 : element.classList.contains('d2') ? 36 : element.classList.contains('d1') ? 18 : 0;

    const loop = (_t: number, delta: number) => {
      const k = 1 - Math.pow(0.16, delta / 16.667);
      cx = lerp(cx, tx, k);
      cy = lerp(cy, ty, k);
      // Independent `translate` property: composes with :hover `transform`
      // instead of overwriting it.
      element.style.translate = `${cx.toFixed(2)}px ${cy.toFixed(2)}px ${depth}px`;
      if (Math.abs(cx - tx) < 0.05 && Math.abs(cy - ty) < 0.05 && tx === 0 && ty === 0) {
        element.style.translate = depth ? `0px 0px ${depth}px` : '';
        job = null;
        return false;
      }
    };
    const wake = () => { if (!job) job = onFrame(loop); };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      rect = element.getBoundingClientRect();
      cachedY = scrollY;
      wake();
    };
    const move = (event: PointerEvent) => {
      if (!rect || event.pointerType === 'touch') return;
      if (Math.abs(scrollY - cachedY) > 4) { rect = element.getBoundingClientRect(); cachedY = scrollY; }
      const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      tx = (px - 0.5) * 10;
      ty = (py - 0.5) * 8;
      bx = px * 100;
      by = py * 100;
      element.style.setProperty('--bx', `${bx.toFixed(1)}%`);
      element.style.setProperty('--by', `${by.toFixed(1)}%`);
      wake();
    };
    const leave = () => { rect = null; tx = 0; ty = 0; wake(); };
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerleave', leave);
    scope.add(() => {
      if (job) { job(); job = null; }
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      element.style.translate = '';
    });
  }
}

/** Artifact tilt + drag with lerped motion so it glides, never snaps. */
function artifact(element: HTMLElement, profile: DeviceProfile, scope: Scope, chime: (f: number, g?: number) => void) {
  const lid = element.querySelector<HTMLButtonElement>('button.lid');
  let down = false;
  let moved = 0;
  let touched = false;
  let hovering = false;
  let originX = 0;
  let originY = 0;
  let tRX = 0, tRY = 0, cRX = 0, cRY = 0, cZ = 0, tZ = 0;
  let rect: DOMRect | null = null;
  let cachedY = 0;
  let job: (() => void) | null = null;

  const loop = (_t: number, delta: number) => {
    const k = 1 - Math.pow(0.14, delta / 16.667);
    cRX = lerp(cRX, tRX, k);
    cRY = lerp(cRY, tRY, k);
    cZ = lerp(cZ, tZ, k);
    element.style.transform = `rotateY(${cRY.toFixed(2)}deg) rotateX(${cRX.toFixed(2)}deg) translateZ(${cZ.toFixed(1)}px)`;
    if (!hovering && !down && Math.abs(cRX - tRX) < 0.02 && Math.abs(cRY - tRY) < 0.02 && Math.abs(cZ - tZ) < 0.1) {
      element.style.transform = '';
      element.classList.remove('held', 'tilting');
      job = null;
      return false;
    }
  };
  const wake = () => { if (!job && !profile.reduced) job = onFrame(loop); };

  const enter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    rect = element.getBoundingClientRect();
    hovering = true;
    element.classList.add('tilting');
    tZ = 44;
    cachedY = scrollY;
    wake();
  };
  const leave = () => {
    hovering = false;
    if (down) return;
    tRX = 0; tRY = 0; tZ = 0;
    wake();
    scope.after(() => { if (!hovering && !down) rect = null; }, 400);
  };
  const pointerDown = (event: PointerEvent) => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target as Element).closest('button:not(.lid),a,summary')) return;
    down = true;
    moved = 0;
    touched = true;
    originX = event.clientX;
    originY = event.clientY;
    rect = element.getBoundingClientRect();
    element.classList.add('held');
  };
  const pointerMove = (event: PointerEvent) => {
    if (profile.reduced || !rect) return;
    if (!down && Math.abs(scrollY - cachedY) > 4) { rect = element.getBoundingClientRect(); cachedY = scrollY; }
    if (down) {
      const dx = event.clientX - originX;
      const dy = event.clientY - originY;
      if (event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx) + 8) {
        down = false;
        element.classList.remove('held');
        tRX = 0; tRY = 0; tZ = hovering ? 44 : 0;
        wake();
        return;
      }
      moved = Math.abs(dx) + Math.abs(dy);
      if (moved > 8) {
        try {
          if (!element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId);
        } catch { /* Already released. */ }
        tRY = dx * 0.5;
        tRX = clamp(-dy * 0.35, -42, 42);
        tZ = 24;
        wake();
      }
    } else if (hovering && profile.hover) {
      const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      tRY = (px - 0.5) * 15;
      tRX = -(py - 0.5) * 15;
      element.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      element.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
      wake();
    }
  };
  const release = () => {
    if (!down) return;
    down = false;
    element.classList.remove('held');
    tRX = 0; tRY = 0; tZ = hovering ? 44 : 0;
    wake();
  };
  const toggle = (event?: MouseEvent) => {
    if (event && event.detail !== 0 && moved > 12) { event.preventDefault(); return; }
    touched = true;
    element.classList.toggle('opened');
    lid?.setAttribute('aria-expanded', String(element.classList.contains('opened')));
    chime(element.classList.contains('opened') ? 587 : 330, 0.07);
  };
  element.addEventListener('pointerenter', enter);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('pointermove', pointerMove, { passive: true });
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);
  element.addEventListener('lostpointercapture', release);
  lid?.addEventListener('click', toggle);
  if (lid && !profile.reduced) scope.after(() => {
    if (!touched && element.closest('.scene')?.getAttribute('data-visible') === 'true') toggle();
  }, 2800);
  scope.add(() => {
    if (job) { job(); job = null; }
    element.classList.remove('held', 'tilting');
    element.style.transform = '';
    element.removeEventListener('pointerenter', enter);
    element.removeEventListener('pointerleave', leave);
    element.removeEventListener('pointerdown', pointerDown);
    element.removeEventListener('pointermove', pointerMove);
    element.removeEventListener('pointerup', release);
    element.removeEventListener('pointercancel', release);
    element.removeEventListener('lostpointercapture', release);
    lid?.removeEventListener('click', toggle);
  });
}

export function createExperience(root: HTMLElement, profile: DeviceProfile, serial: string, notify: (message: string) => void, info: (key: string) => void, smooth: SmoothHandle) {
  const scope = new Scope();
  const audio = createAudio();
  const particles = createParticles(profile);
  scope.add(audio.destroy);
  scope.add(particles.destroy);
  scope.add(() => root.querySelectorAll('.ripple').forEach(element => element.remove()));

  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch { /* Older browsers. */ }
  const deepLink = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (deepLink) {
    if (smooth.native) deepLink.scrollIntoView({ block: 'start', behavior: 'auto' });
    else smooth.scrollTo(deepLink, -70);
  } else {
    window.scrollTo(0, 0);
  }

  // Pause smooth scroll while a modal dialog is open.
  const dialogs = new MutationObserver(() => {
    if (root.querySelector('dialog[open]')) smooth.stop();
    else smooth.start();
  });
  dialogs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  scope.add(() => dialogs.disconnect());

  // Mobile menu lock: overlay dispatches asheo:menu — freeze smooth scroll
  // and body scroll together so the backdrop never drifts under touch.
  const onMenu = (event: Event) => {
    const open = (event as CustomEvent<boolean>).detail === true;
    document.body.classList.toggle('locked', open);
    if (open) smooth.stop();
    else if (!root.querySelector('dialog[open]')) smooth.start();
  };
  window.addEventListener('asheo:menu', onMenu);
  scope.add(() => {
    window.removeEventListener('asheo:menu', onMenu);
    document.body.classList.remove('locked');
  });

  const scenes = root.querySelectorAll<HTMLElement>('.scene');
  for (const scene of scenes) {
    scope.add(observeVisible(scene, visible => { scene.dataset.visible = String(visible); }));
  }
  const updatePageVisibility = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
  updatePageVisibility();
  document.addEventListener('visibilitychange', updatePageVisibility);
  scope.add(() => document.removeEventListener('visibilitychange', updatePageVisibility));

  // Staggered scroll reveals with buttery expo easing (CSS handles motion).
  const reveals = root.querySelectorAll<HTMLElement>('.rv');
  if (profile.reduced || typeof IntersectionObserver === 'undefined') {
    reveals.forEach(el => el.classList.add('in'));
  } else {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          // Siblings cascade: index within parent drives stagger.
          const siblings = Array.from(el.parentElement?.querySelectorAll(':scope > .rv') ?? []);
          const idx = siblings.indexOf(el);
          if (idx > 0 && !el.style.transitionDelay) el.style.transitionDelay = `${Math.min(idx * 0.08, 0.4)}s`;
          el.classList.add('in');
          observer.unobserve(el);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(el => observer.observe(el));
    scope.add(() => observer.disconnect());
  }

  const stage = root.querySelector<HTMLElement>('#orbStage');
  if (stage) scope.add(createGallery(stage, profile, audio.chime));
  scope.add(createMarquee(root, profile, smooth));
  root.querySelectorAll<HTMLElement>('.artifact').forEach(el => artifact(el, profile, scope, audio.chime));
  if (profile.hover && !profile.reduced) magnets(root, scope);
  scope.add(createScrollManager(root, profile, smooth));
  scope.add(createCursor(root, profile, particles));

  const indicator = root.querySelector<HTMLElement>('#navInd');
  const navLinks = root.querySelector<HTMLElement>('#navLinks');
  if (indicator && navLinks) {
    for (const link of navLinks.querySelectorAll<HTMLAnchorElement>('a')) {
      const enter = () => {
        indicator.style.opacity = '1';
        indicator.style.width = `${link.offsetWidth}px`;
        indicator.style.transform = `translateX(${link.offsetLeft}px)`;
      };
      link.addEventListener('pointerenter', enter);
      link.addEventListener('focus', enter);
      scope.add(() => { link.removeEventListener('pointerenter', enter); link.removeEventListener('focus', enter); });
    }
    const clearIndicator = () => { indicator.style.opacity = '0'; };
    navLinks.addEventListener('pointerleave', clearIndicator);
    navLinks.addEventListener('focusout', clearIndicator);
    window.addEventListener('resize', clearIndicator, { passive: true });
    scope.add(() => {
      navLinks.removeEventListener('pointerleave', clearIndicator);
      navLinks.removeEventListener('focusout', clearIndicator);
      window.removeEventListener('resize', clearIndicator);
    });
  }

  const sound = root.querySelector<HTMLButtonElement>('#sound');
  const paintSound = (enabled: boolean) => {
    if (!sound) return;
    sound.classList.toggle('on', enabled);
    sound.setAttribute('aria-pressed', String(enabled));
    sound.setAttribute('aria-label', enabled ? 'Turn sound off' : 'Turn sound on');
  };
  const toggleSound = () => {
    const enabled = audio.toggle();
    paintSound(enabled);
    writeSoundPref(enabled);
    if (enabled) audio.chime(659, 0.09);
    notify(enabled ? 'Sound on. Glass & brass.' : 'Sound off.');
  };
  if (sound) {
    const pref = readSoundPref();
    paintSound(pref);
    if (pref && !audio.isEnabled()) {
      const arm = () => {
        window.removeEventListener('pointerdown', arm);
        window.removeEventListener('keydown', arm);
        if (readSoundPref() && !audio.isEnabled()) audio.toggle();
      };
      window.addEventListener('pointerdown', arm);
      window.addEventListener('keydown', arm);
      scope.add(() => {
        window.removeEventListener('pointerdown', arm);
        window.removeEventListener('keydown', arm);
      });
    }
    sound.addEventListener('click', toggleSound);
    scope.add(() => sound.removeEventListener('click', toggleSound));
  }

  const curtain = root.querySelector<HTMLElement>('#curtain');
  let navigating = false;
  function navigate(anchor: HTMLAnchorElement, event: MouseEvent) {
    const id = (anchor.getAttribute('href') || '').slice(1);
    const destination = id ? document.getElementById(id) : null;
    if (!destination) return;
    event.preventDefault();
    if (navigating) return;
    const go = () => {
      if (smooth.native) destination.scrollIntoView({ behavior: profile.reduced ? 'auto' : 'smooth', block: 'start' });
      else smooth.scrollTo(destination, -70);
      try { if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`); } catch { /* File protocol. */ }
      if (event.detail === 0) {
        if (!destination.hasAttribute('tabindex')) destination.setAttribute('tabindex', '-1');
        destination.focus({ preventScroll: true });
      }
    };
    // Curtain wipe on every device with motion — it's transform/clip only, cheap.
    if (!curtain || profile.reduced || event.detail === 0) { go(); return; }
    navigating = true;
    curtain.style.setProperty('--cx', `${event.clientX || innerWidth / 2}px`);
    curtain.style.setProperty('--cy', `${event.clientY || innerHeight / 2}px`);
    curtain.classList.add('in');
    audio.chime(392, 0.05);
    scope.after(go, 620);
    scope.after(() => { curtain.classList.remove('in'); navigating = false; }, 900);
  }

  function click(event: MouseEvent) {
    const target = event.target as Element;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const information = target.closest<HTMLElement>('[data-info]');
    if (information?.dataset.info) { event.preventDefault(); info(information.dataset.info); return; }
    const button = target.closest<HTMLButtonElement>('[data-cta]');
    if (button) {
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const cx = event.detail ? event.clientX - rect.left : rect.width / 2;
      const cy = event.detail ? event.clientY - rect.top : rect.height / 2;
      ripple.style.cssText = `left:${cx.toFixed(1)}px;top:${cy.toFixed(1)}px;width:18px;height:18px`;
      button.appendChild(ripple);
      scope.after(() => ripple.remove(), 700);
      particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2);
      audio.chime(880, 0.09);
      info(button.dataset.cta === 'offline' ? 'offline' : 'install');
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) navigate(anchor, event);
  }
  root.addEventListener('click', click);
  scope.add(() => { root.removeEventListener('click', click); curtain?.classList.remove('in'); });

  const zone = root.querySelector<HTMLElement>('#stampZone');
  const stamp = root.querySelector<HTMLButtonElement>('#stampBtn');
  const wax = root.querySelector<SVGSVGElement>('#wax');
  const shock = root.querySelector<HTMLElement>('#waxShock');
  if (zone && wax) {
    try { if (sessionStorage.getItem('asheo-sealed') === serial) { zone.classList.add('done'); wax.classList.add('on'); } } catch { /* Storage is optional. */ }
  }
  const seal = () => {
    if (!zone || !wax || zone.classList.contains('done')) return;
    zone.classList.add('done');
    wax.classList.add('on');
    shock?.classList.add('on');
    try { sessionStorage.setItem('asheo-sealed', serial); } catch { /* Storage is optional. */ }
    audio.chime(147, 0.12);
    scope.after(() => audio.chime(220, 0.06), 90);
    const rect = zone.getBoundingClientRect();
    particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 40, ['#96322C', '#C4544A', '#C9A86A', '#FFF3D6']);
    notify(`Sealed. Copy ${serial} is yours.`);
  };
  stamp?.addEventListener('click', seal);
  if (stamp) scope.add(() => stamp.removeEventListener('click', seal));

  const collector = () => {
    [523, 659, 784, 1046].forEach((frequency, i) => scope.after(() => {
      particles.burst(innerWidth * (0.2 + Math.random() * 0.6), 40, 34);
      audio.chime(frequency, 0.07);
    }, i * 130));
    // Gold veil flash — reuses the curtain (no new layers), guarded so it
    // never steals a navigation wipe already in flight.
    if (curtain && !profile.reduced) {
      curtain.dataset.tint = 'download';
      curtain.style.setProperty('--cx', `${Math.round(innerWidth / 2)}px`);
      curtain.style.setProperty('--cy', `${Math.round(innerHeight * 0.4)}px`);
      curtain.classList.add('in');
      scope.after(() => {
        if (!navigating) {
          curtain.classList.remove('in');
          curtain.removeAttribute('data-tint');
        }
      }, 750);
    }
    notify(`Collector mode. ${serial} / 500.`);
  };
  let keys = '';
  let lastKey = 0;
  const key = (event: KeyboardEvent) => {
    const el = event.target as Element | null;
    if (!el || typeof (el as Element).closest !== 'function') return;
    if ((el as Element).closest('input,textarea,select,[contenteditable="true"],dialog') || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    if (performance.now() - lastKey > 1600) keys = '';
    lastKey = performance.now();
    keys = (keys + event.key.toLowerCase()).slice(-3);
    if (keys !== 'ash') return;
    keys = '';
    collector();
  };
  window.addEventListener('keydown', key);
  scope.add(() => window.removeEventListener('keydown', key));

  for (const faq of root.querySelectorAll<HTMLDetailsElement>('.faq-item')) {
    const chimeOnOpen = () => { if (faq.open) audio.chime(660, 0.04); };
    faq.addEventListener('toggle', chimeOnOpen);
    scope.add(() => faq.removeEventListener('toggle', chimeOnOpen));
  }

  const toTop = root.querySelector<HTMLButtonElement>('#toTop');
  const goTop = () => {
    if (smooth.native) window.scrollTo({ top: 0, behavior: profile.reduced ? 'auto' : 'smooth' });
    else smooth.scrollTo(0);
  };
  toTop?.addEventListener('click', goTop);
  if (toTop) scope.add(() => toTop.removeEventListener('click', goTop));

  // Command palette (Cmd/Ctrl+K or "/").
  const palette = root.querySelector<HTMLElement>('#palette');
  const paletteInput = root.querySelector<HTMLInputElement>('#paletteInput');
  const paletteList = root.querySelector<HTMLElement>('#paletteList');
  if (palette && paletteInput && paletteList) {
    const items = Array.from(paletteList.querySelectorAll<HTMLButtonElement>('button'));
    let open = false;
    let opener: HTMLElement | null = null;
    const filter = () => {
      const q = paletteInput.value.trim().toLowerCase();
      let first: HTMLButtonElement | null = null;
      for (const item of items) {
        const hit = !q || (item.textContent || '').toLowerCase().includes(q);
        item.classList.toggle('hide', !hit);
        item.classList.remove('sel');
        item.setAttribute('aria-selected', 'false');
        if (hit && !first) first = item;
      }
      first?.classList.add('sel');
      first?.setAttribute('aria-selected', 'true');
    };
    const openPalette = () => {
      if (open) return;
      open = true;
      opener = document.activeElement as HTMLElement | null;
      smooth.stop();
      document.documentElement.classList.add('palette-open');
      palette.hidden = false;
      paletteInput.value = '';
      filter();
      scope.after(() => paletteInput.focus(), 30);
    };
    const closePalette = () => {
      if (!open) return;
      open = false;
      palette.hidden = true;
      document.documentElement.classList.remove('palette-open');
      smooth.start();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const run = (item: HTMLButtonElement) => {
      const goto = item.dataset.goto;
      const act = item.dataset.act;
      closePalette();
      if (goto) {
        const dest = document.getElementById(goto);
        if (dest) {
          if (smooth.native) dest.scrollIntoView({ behavior: profile.reduced ? 'auto' : 'smooth', block: 'start' });
          else scope.after(() => smooth.scrollTo(dest, -70), 60);
          try { history.pushState(null, '', `#${goto}`); } catch { /* File protocol. */ }
        }
      } else if (act === 'sound') toggleSound();
      else if (act === 'seal') seal();
      else if (act === 'collector') collector();
      else if (act === 'top') goTop();
    };
    const moveSel = (dir: 1 | -1) => {
      const visible = items.filter(i => !i.classList.contains('hide'));
      if (!visible.length) return;
      let idx = visible.findIndex(i => i.classList.contains('sel'));
      idx = idx < 0 ? (dir === 1 ? 0 : visible.length - 1) : (idx + dir + visible.length) % visible.length;
      visible.forEach(i => { i.classList.remove('sel'); i.setAttribute('aria-selected', 'false'); });
      visible[idx].classList.add('sel');
      visible[idx].setAttribute('aria-selected', 'true');
      visible[idx].scrollIntoView({ block: 'nearest' });
    };
    const onInput = () => filter();
    const onInputKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveSel(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveSel(-1); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        const sel = items.find(i => i.classList.contains('sel') && !i.classList.contains('hide')) || items.find(i => !i.classList.contains('hide'));
        if (sel) run(sel);
      } else if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
    };
    const onListClick = (event: MouseEvent) => {
      const item = (event.target as Element).closest('button');
      if (item) run(item);
    };
    const onBackdrop = (event: MouseEvent) => { if (event.target === palette) closePalette(); };
    const onGlobalKey = (event: KeyboardEvent) => {
      if (root.querySelector('dialog[open]')) {
        if (event.key === 'Escape' && open) closePalette();
        return;
      }
      const t = event.target as Element | null;
      const inField = !!t && typeof (t as Element).closest === 'function' && !!(t as Element).closest('input,textarea,select,[contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) closePalette(); else openPalette();
      } else if (event.key === '/' && !open && !inField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openPalette();
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        closePalette();
      }
    };
    const onPaletteEvent = () => { if (!open) openPalette(); };
    paletteInput.addEventListener('input', onInput);
    paletteInput.addEventListener('keydown', onInputKey);
    paletteList.addEventListener('click', onListClick);
    palette.addEventListener('click', onBackdrop);
    window.addEventListener('keydown', onGlobalKey);
    window.addEventListener('asheo:palette', onPaletteEvent);
    scope.add(() => {
      paletteInput.removeEventListener('input', onInput);
      paletteInput.removeEventListener('keydown', onInputKey);
      paletteList.removeEventListener('click', onListClick);
      palette.removeEventListener('click', onBackdrop);
      window.removeEventListener('keydown', onGlobalKey);
      window.removeEventListener('asheo:palette', onPaletteEvent);
      if (open) { palette.hidden = true; document.documentElement.classList.remove('palette-open'); smooth.start(); }
    });
  }

  return () => scope.dispose();
}
