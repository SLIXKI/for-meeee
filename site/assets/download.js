// server/vps/site/assets/download.js
// Renders the download page from releases.json so the version, size and checksum
// can never be a stale hard-coded string again (they were, in the old page).
//
// The index is generated on the box by scripts/publish-release.mjs and lists only
// builds whose digest is published — a build that is not in KV `builds:allowed`
// cannot run, so advertising one would hand people a download that fails
// verification.

(() => {
  const INDEX = 'https://download.asheobypasser.net/releases.json';
  const API = 'https://asheo-license.asheo-server-ext.workers.dev';
  const $ = (id) => document.getElementById(id);

  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
  const when = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  fetch(INDEX, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((idx) => {
      const rel = (idx.releases || []).find((r) => r.version === idx.latest) || (idx.releases || [])[0];
      if (!rel) throw new Error('index lists no releases');

      $('dlVer').textContent = 'Asheo ' + rel.version;
      $('dlSize').textContent = kb(rel.bytes);
      $('dlDate').textContent = when(rel.date);
      $('dlHash').textContent = rel.sha256;
      $('dlHash').setAttribute('data-copy', rel.sha256);
      if (rel.notes) $('dlNote').textContent = rel.notes;
      else $('dlNote').remove();

      // Direct link kept as the href so the button works without JS and so
      // right-click → copy link address gives something useful; the click handler
      // routes through the Worker, which counts the download then 302s to this file.
      const direct = 'https://download.asheobypasser.net/' + rel.file;
      $('dlBtn').setAttribute('data-href', API + '/v1/download');
      $('dlDirect').href = direct;

      const prev = (idx.releases || []).filter((r) => r.version !== rel.version);
      if (!prev.length) { $('dlPrev').remove(); return; }
      $('dlPrevBody').innerHTML = '';
      for (const p of prev) {
        const tr = document.createElement('tr');
        for (const cell of [
          `<a href="https://download.asheobypasser.net/${p.file}">${p.version}</a>`,
          kb(p.bytes),
          when(p.date),
          `<span class="dl-hash" data-copy="${p.sha256}">${p.sha256.slice(0, 12)}…</span>`,
        ]) {
          const td = document.createElement('td');
          td.innerHTML = cell;
          tr.appendChild(td);
        }
        $('dlPrevBody').appendChild(tr);
      }
      $('dlPrevCount').textContent = prev.length;
    })
    .catch((e) => {
      // Never leave the page looking like the download is gone: fall back to the
      // stable latest link, which is a symlink on the box and always current.
      const card = $('dlCard');
      if (card) {
        const p = document.createElement('p');
        p.className = 'dl-err';
        p.textContent = 'Could not load the release index (' + e.message + '). ';
        const a = document.createElement('a');
        a.href = 'https://download.asheobypasser.net/asheo-latest.zip';
        a.textContent = 'Download the latest build directly';
        p.appendChild(a);
        card.appendChild(p);
      }
      $('dlVer').textContent = 'Asheo';
    });

  fetch(API + '/v1/downloads')
    .then((r) => r.json())
    .then((d) => {
      if (!d || typeof d.total !== 'number') throw new Error('no total');
      $('dlCount').textContent = d.total.toLocaleString() + ' downloads';
    })
    .catch(() => { $('dlCount')?.remove(); });
})();
