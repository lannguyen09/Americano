'use strict';
// Inlines src/ into one self-contained file: dist/padel.html
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

const out = path.join(__dirname, 'dist', 'padel.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(__dirname, out)} (${(html.length / 1024).toFixed(1)} KB, theme: ${themeJs.name})`);
