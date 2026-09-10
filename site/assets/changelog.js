// server/vps/site/assets/changelog.js
// Renders the changelog from releases.json — the same generated index the download
// page reads, so the two can never disagree about what shipped.
//
// Notes come from notes.json on the box, recorded at publish time by
// scripts/publish-release.mjs --notes. A release with no note still gets an entry:
// the version, date and checksum are the facts that matter.

(() => {
  const INDEX = 'https://download.asheobypasser.net/releases.json';
  const list = document.getElementById('clList');

  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
  const when = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  fetch(INDEX, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((idx) => {
      const releases = idx.releases || [];
      if (!releases.length) throw new Error('index lists no releases');
      list.innerHTML = '';

      for (const rel of releases) {
        const item = el('div', 'cl-item' + (rel.version === idx.latest ? ' is-latest' : ''));

        const head = el('div');
        head.appendChild(el('span', 'cl-ver', 'Asheo ' + rel.version));
        head.appendChild(el('span', 'cl-date', when(rel.date)));
        if (rel.version === idx.latest) head.appendChild(el('span', 'cl-badge', 'current'));
        item.appendChild(head);

        if (rel.notes) item.appendChild(el('p', 'cl-notes', rel.notes));

        const meta = el('div', 'cl-meta');
        meta.appendChild(document.createTextNode(kb(rel.bytes) + ' · sha256 '));
        const hash = el('span', 'dl-hash', rel.sha256);
        hash.setAttribute('data-copy', rel.sha256);
        meta.appendChild(hash);
        meta.appendChild(document.createTextNode(' · '));
        const link = el('a', null, rel.file);
        link.href = 'https://download.asheobypasser.net/' + rel.file;
        meta.appendChild(link);
        item.appendChild(meta);

        list.appendChild(item);
      }
    })
    .catch((e) => {
      list.innerHTML = '';
      const p = el('p', 'dl-err', 'Could not load the release index (' + e.message + '). ');
      const a = el('a', null, 'Go to the download page');
      a.href = 'https://download.asheobypasser.net/';
      p.appendChild(a);
      list.appendChild(p);
    });
})();
