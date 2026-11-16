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
const themeJs = { name: theme.name || 'generic', clubName: theme.clubName || '', title: theme.title || '', logos: theme.logos || {} };
const title = theme.title || require('./src/strings.js').t('app.title');

let html = read('index.template.html');
const parts = {
  '/*__TITLE__*/': escHtml(title),
  '/*__STYLE__*/': read('style.css'),
  '/*__THEME_CSS__*/': themeCss ? `:root {\n${themeCss}\n}` : '',
  '/*__THEME__*/': safeJs(`window.THEME = ${JSON.stringify(themeJs)};`),
  '/*__STRINGS__*/': safeJs(read('strings.js')),
  '/*__SCHEDULER__*/': safeJs(read('scheduler.js')),
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
