'use strict';
// Inlines src/ into one self-contained file: dist/padel.html
// With --theme also a hostable PWA in dist/site/: index.html, manifest.webmanifest, sw.js, icon-192/512.png
// Usage: node build.js [--theme=<name>]   (theme/<name>.json; no theme = neutral generic build)
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Theme ----
const themeArg = process.argv.slice(2).find(a => a.startsWith('--theme='));
const themeName = themeArg ? themeArg.slice('--theme='.length) : '';
let theme = {};
if (themeName) {
  if (!/^[\w-]+$/.test(themeName)) throw new Error(`Invalid theme name "${themeName}"`);
  const file = path.join(__dirname, 'theme', themeName + '.json');
  if (!fs.existsSync(file)) throw new Error(`Theme not found: ${path.relative(__dirname, file)}`);
  theme = JSON.parse(fs.readFileSync(file, 'utf8'));
}
// colors: {brand, brandContrast, group1, ...} → :root { --brand; --brand-contrast; --group-1; ... }
const cssName = k => '--' + k.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const themeCss = Object.entries(theme.colors || {}).map(([k, v]) => {
  if (!/^#[0-9a-f]{3,8}$/i.test(v)) throw new Error(`Theme colour ${k} must be a hex colour, got "${v}"`);
  return `  ${cssName(k)}: ${v};`;
}).join('\n');
// Logos: data-URI, or a file next to the theme JSON (inlined as data-URI). Missing file → no logo (title text).
const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const logos = {};
for (const [k, v] of Object.entries(theme.logos || {})) {
  if (/^data:/.test(v)) { logos[k] = v; continue; }
  const f = path.join(__dirname, 'theme', v);
  const mime = MIME[path.extname(f).toLowerCase()];
  if (!mime) throw new Error(`Logo ${k}: unsupported file type "${v}"`);
  if (!fs.existsSync(f)) { console.warn(`Warning: logo ${k} not found: theme/${v} (built without it)`); continue; }
  logos[k] = `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`;
}
const hex = v => /^#[0-9a-f]{3,8}$/i.test(v);
const palette = theme.compactPalette || [];
if (!Array.isArray(palette) || !palette.every(hex)) throw new Error('compactPalette must be a list of hex colours');
// floorplan: {rows, cols, numbering: 'bottom-left-rows', reception: 'bottom', tags: {courtNo: {badge, edge}},
//             courtColors: {courtNo: hex}}
// Presentation only (no effect on scheduling). Missing → Compact view only.
const fp = theme.floorplan || null;
if (fp) {
  if (!(Number.isInteger(fp.rows) && fp.rows > 0 && Number.isInteger(fp.cols) && fp.cols > 0)) throw new Error('Theme floorplan needs integer rows and cols');
  if (fp.numbering && fp.numbering !== 'bottom-left-rows') throw new Error(`Unsupported floorplan numbering "${fp.numbering}"`);
  for (const [c, tag] of Object.entries(fp.tags || {})) {
    if (tag.edge && !hex(tag.edge)) throw new Error(`Floorplan court ${c} edge must be a hex colour`);
  }
  for (const [c, v] of Object.entries(fp.courtColors || {})) {
    if (!hex(v)) throw new Error(`Floorplan court ${c} colour must be a hex colour`);
  }
}
const themeJs = { name: theme.name || 'generic', clubName: theme.clubName || '', title: theme.title || '', logos, floorplan: fp, compactPalette: palette };
const title = theme.title || require('./src/strings.js').t('app.title');

let html = read('index.template.html');
const parts = {
  '/*__TITLE__*/': escHtml(title),
  '/*__STYLE__*/': read('style.css'),
  '/*__THEME_CSS__*/': themeCss ? `:root {\n${themeCss}\n}` : '',
  '/*__THEME__*/': safeJs(`window.THEME = ${JSON.stringify(themeJs)};`),
  '/*__STRINGS__*/': safeJs(read('strings.js')),
  '/*__SCHEDULER__*/': safeJs(read('scheduler.js')),
  '/*__NAMES__*/': safeJs(read('names.js')),
  '/*__RANKING__*/': safeJs(read('ranking.js')),
  '/*__APP__*/': safeJs(read('app.js')),
};
for (const [marker, content] of Object.entries(parts)) {
  if (!html.includes(marker)) throw new Error(`Marker ${marker} missing in index.template.html`);
  html = html.split(marker).join(content);
}

const PWA_MARKER = '<!--__PWA_HEAD__-->';
const out = path.join(__dirname, 'dist', 'padel.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html.replace(PWA_MARKER, ''));
console.log(`Built ${path.relative(__dirname, out)} (${(html.length / 1024).toFixed(1)} KB, theme: ${themeJs.name})`);

// ---- Hostable PWA (themed builds only): dist/site/ ----
if (themeName) {
  const crypto = require('crypto');
  const png = require('./tools/png.js');
  const site = path.join(__dirname, 'dist', 'site');
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  // Colours: theme, else the generic defaults in src/style.css :root.
  const cssDefault = name => (read('style.css').match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`)) || [])[1];
  const col = (k, css) => (theme.colors || {})[k] || cssDefault(css);
  const brand = col('brand', 'brand'), accent = col('accent', 'accent'), bg = col('bg', 'bg') || col('surface', 'surface');

  // Icons from the ring logo (PNG); otherwise a ring drawn in the theme colours.
  let ring = null;
  const m = /^data:image\/png;base64,(.+)$/.exec(logos.ring || '');
  if (m) {
    try { ring = png.decode(Buffer.from(m[1], 'base64')); } catch (e) { console.warn(`Warning: ring logo not usable for icons (${e.message})`); }
  } else console.warn('Warning: no PNG ring logo; icons use a drawn ring in the theme colours');
  const icons = {};
  for (const size of [192, 512]) {
    // Logo with an opaque background (corner pixel): use that colour around it, else the brand colour.
    const corner = ring && ring.data[3] === 255 ? '#' + Array.from(ring.data.slice(0, 3), v => v.toString(16).padStart(2, '0')).join('') : brand;
    icons[size] = png.encode(ring ? png.iconFromImage(ring, size, corner) : png.ringIcon(size, brand, accent));
    fs.writeFileSync(path.join(site, `icon-${size}.png`), icons[size]);
  }

  const appName = theme.title || title;
  const manifest = JSON.stringify({
    name: appName, short_name: theme.clubName || appName, start_url: './', scope: './', display: 'standalone',
    orientation: 'any', background_color: bg, theme_color: brand,
    icons: [192, 512].map(s => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any maskable' })),
  }, null, 2);
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), manifest);

  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="icon-192.png">',
    `<meta name="theme-color" content="${brand}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    `<meta name="apple-mobile-web-app-title" content="${escHtml(theme.clubName || appName)}">`,
    "<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js'));</script>",
  ].join('\n');
  const index = html.replace(PWA_MARKER, head);
  fs.writeFileSync(path.join(site, 'index.html'), index);

  // Service worker: VERSION = hash of everything it caches, so every changed build replaces the cache.
  const files = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
  const version = crypto.createHash('sha256').update(index).update(manifest).update(icons[192]).update(icons[512]).digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(site, 'sw.js'), `'use strict';
// Generated by build.js. Offline: cache-first for the app shell; a new build has a new VERSION.
const VERSION = '${version}';
const CACHE = 'padel-americano-' + VERSION;
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('padel-americano-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const nav = e.request.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(c => c.match(nav ? 'index.html' : e.request, { ignoreSearch: true })
    .then(hit => hit || fetch(e.request))));
});
`);
  console.log(`Built dist/site/ (index.html, manifest.webmanifest, sw.js v${version}, icon-192.png, icon-512.png)`);
}
