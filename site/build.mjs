/* ASHEO static build: _shell.html + pages/* + _theatrics.html -> static site.
 *
 * Usage:  node site/build.mjs <out-dir>      (needs `marked`: npm i marked)
 *
 * Root-hosted output (Netlify / Vercel / any static host): each route is a
 * real directory with an index.html, so /download, /docs etc. resolve with
 * no redirect rules. Asset refs are rewritten to root-absolute (/assets/*).
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

let marked;
try {
  ({ marked } = await import('marked'));
} catch {
  console.error('missing dependency: run `npm i marked` in the repo root first.');
  process.exit(1);
}

const SITE = dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) { console.error('usage: node site/build.mjs <out-dir>'); process.exit(1); }
const OUT = resolve(process.argv[2]);
const read = p => readFileSync(join(SITE, p), 'utf8');

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const PAGES = {
  index:     { src: 'pages/index.html',     title: 'ASHEO — Edition 01', desc: 'ASHEO Edition 01 — a developer and QA browser extension, presented as a numbered artefact.', scripts: ['dither-bg.js', 'app.js'], theatrics: true, home: '', bodyclass: '' },
  download:  { src: 'pages/download.html',  title: 'Asheo — Download',   desc: 'Download Asheo Edition 01 for Chromium browsers.', scripts: ['page.js', 'download.js'], home: '/' },
  changelog: { src: 'pages/changelog.html', title: 'Asheo — Changelog',  desc: 'Every numbered Asheo release, newest first.', scripts: ['page.js', 'changelog.js'], home: '/' },
  status:    { src: 'pages/status.html',    title: 'Asheo — Status',     desc: 'Live status of the Asheo license service and gateways.', scripts: ['page.js', 'status.js'], home: '/' },
  tutorials: { src: 'pages/tutorials.html', title: 'Asheo — Tutorials',  desc: 'Video tutorials for getting the most out of Asheo.', scripts: ['page.js', 'tutorials.js'], home: '/' },
  premium:   { src: 'pages/premium.html',   title: 'Asheo Premium',      desc: 'Asheo Premium — early access builds and priority gateways.', scripts: ['page.js'], home: '/' },
  docs:      { src: 'pages/docs.md',        md: true, scripts: ['page.js'], home: '/' },
  privacy:   { src: 'pages/privacy.md',     md: true, scripts: ['page.js'], home: '/' },
};

function mdToHtml(src) {
  let md = read(src);
  let title = 'Asheo', desc = '';
  const fm = md.match(/<!--\s*title:\s*(.+?)\n\s*description:\s*(.+?)\s*-->/s);
  if (fm) { title = fm[1].trim(); desc = fm[2].replace(/\s+/g, ' ').trim(); md = md.replace(fm[0], ''); }
  md = md.replace(/\{\{include:\s*([^}]+)\}\}/g, (_, inc) => {
    try { return read(inc.trim()); }
    catch {
      return `\n\n> **Note** — the \`${inc.trim()}\` disclosure file is supplied at deploy time and is not part of this snapshot.\n\n`;
    }
  });
  return { title, desc, html: `<div class="wrap"><div class="prose">\n${marked.parse(md)}\n</div></div>` };
}

function assemble(body, { title, desc, scripts, theatrics, home, bodyclass, canon }) {
  const tags = scripts.map(s => `<script src="/assets/${s}" defer></script>`).join('\n');
  return read('_shell.html')
    .replaceAll('{{TITLE}}', title)
    .replace('{{BODY}}', body)
    .replace('{{THEATRICS}}', theatrics ? read('_theatrics.html') : '')
    .replace('{{FONTS}}', FONTS)
    .replace('{{CSS_HREF}}', '/assets/app.css')
    .replace('{{SCRIPTS}}', tags)
    .replace('{{DITHER}}', '')
    .replace('{{BODYCLASS}}', bodyclass)
    .replaceAll('{{HOME}}', home)
    .replaceAll('{{DESCRIPTION}}', desc)
    .replaceAll('{{CANONICAL}}', canon)
    .replace('{{OGIMAGE}}', '/assets/img/asheo-mark.webp')
    .replace(/((?:src|href|content)=")assets\//g, '$1/assets/');
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [name, cfg] of Object.entries(PAGES)) {
  let body = '', title = cfg.title, desc = cfg.desc;
  if (cfg.md) ({ title, desc, html: body } = mdToHtml(cfg.src));
  else body = read(cfg.src);
  const out = assemble(body, {
    title, desc, scripts: cfg.scripts, theatrics: !!cfg.theatrics,
    home: cfg.home, bodyclass: cfg.bodyclass ?? 'sub',
    canon: 'https://asheobypasser.net/' + (name === 'index' ? '' : name),
  });
  if (out.includes('{{')) throw new Error(`unreplaced placeholder in ${name}`);
  const dest = name === 'index' ? join(OUT, 'index.html') : join(OUT, name, 'index.html');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  console.log('built', dest);
}

writeFileSync(join(OUT, '404.html'), assemble(
  '<div class="wrap"><div class="prose"><h1>404</h1><p>That exhibit does not exist. <a href="/">Return to the gallery &rarr;</a></p></div></div>',
  { title: 'Asheo — Not found', desc: 'Page not found.', scripts: ['page.js'], home: '/', bodyclass: 'sub', canon: 'https://asheobypasser.net/404' }
));

cpSync(join(SITE, 'assets'), join(OUT, 'assets'), { recursive: true });
writeFileSync(join(OUT, 'netlify.toml'), `# Served as-is (manual deploy / Netlify Drop). Pretty URLs come free:
# each route is a real directory with an index.html, so no redirects needed.
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
`);
console.log('done ->', OUT);
