// server/vps/site/assets/status.js
// Probes each service from the visitor's own browser and paints the row.
//
// Deliberately not a stored dashboard: a status page that reports what a cron job
// saw five minutes ago is worse than none, because it lies confidently. Each row
// here reflects a request that just left the reader's machine.

(() => {
  const TIMEOUT_MS = 8000;
  const REFRESH_MS = 30000;

  const probe = async (url) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      const ms = Math.round(performance.now() - t0);
      if (!r.ok) return { up: false, ms, detail: 'HTTP ' + r.status };
      let detail = ms + ' ms';
      try {
        const j = await r.json();
        // The 3DS2 service reports its own build tag and self-hash; show them,
        // since "answering" and "running the build I published" differ.
        if (j.build) detail += ' · build ' + j.build;
        else if (j.latest) detail += ' · latest ' + j.latest;
      } catch { /* not JSON — reachability is still the signal */ }
      return { up: true, ms, detail };
    } catch (e) {
      return { up: false, ms: Math.round(performance.now() - t0), detail: e.name === 'AbortError' ? 'timed out' : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  };

  const paint = (row, res) => {
    const dot = row.querySelector('.st-dot');
    const state = row.querySelector('.st-state');
    dot.classList.toggle('up', res.up);
    dot.classList.toggle('down', !res.up);
    state.textContent = res.up ? 'operational' : 'down';
    state.style.color = res.up ? 'var(--brass)' : '#e05252';
    const sub = row.querySelector('.st-sub');
    if (!sub.dataset.base) sub.dataset.base = sub.textContent;
    sub.textContent = sub.dataset.base + ' — ' + res.detail;
  };

  const run = () => {
    document.querySelectorAll('.st-row[data-url]').forEach(async (row) => {
      paint(row, await probe(row.dataset.url));
    });
  };

  run();
  setInterval(run, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
})();
