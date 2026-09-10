// server/vps/site/assets/tutorials.js
// Renders the tutorial grid from /video/tutorials.json.
//
// Adding a video is: drop the .mp4 (and a poster .jpg) into /var/www/asheo-video/
// on the VPS, add an entry to tutorials.json there, done — no rebuild, no redeploy.
// Caddy's file_server handles range requests, so <video> seeking works without any
// streaming service.
//
// `preload="none"` matters: with a grid of clips, preloading metadata for all of
// them fires a request per video on page load. Posters carry the visual weight
// until someone actually presses play.

(() => {
  const INDEX = '/video/tutorials.json';
  const grid = document.getElementById('tutGrid');
  const empty = document.getElementById('tutEmpty');

  const showEmpty = () => { if (empty) empty.hidden = false; };

  fetch(INDEX, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((idx) => {
      const items = (idx.tutorials || []).filter((t) => t && t.file);
      if (!items.length) return showEmpty();
      items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

      for (const t of items) {
        const card = document.createElement('div');
        card.className = 'tut';

        const video = document.createElement('video');
        video.src = '/video/' + t.file;
        video.controls = true;
        video.preload = 'none';
        video.playsInline = true;
        if (t.poster) video.poster = '/video/' + t.poster;
        card.appendChild(video);

        const body = document.createElement('div');
        body.className = 'tut-body';
        const h = document.createElement('p');
        h.className = 'tut-title';
        h.textContent = t.title || t.file;
        body.appendChild(h);
        if (t.description) {
          const d = document.createElement('p');
          d.className = 'tut-desc';
          d.textContent = t.description;
          body.appendChild(d);
        }
        card.appendChild(body);
        grid.appendChild(card);
      }
    })
    .catch(showEmpty);
})();
