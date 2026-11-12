'use strict';
// Inlines src/ into one self-contained file: dist/padel.html
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');

let html = read('index.template.html');
const parts = {
  '/*__STYLE__*/': read('style.css'),
  '/*__SCHEDULER__*/': safeJs(read('scheduler.js')),
  '/*__APP__*/': safeJs(read('app.js')),
};
for (const [marker, content] of Object.entries(parts)) {
  if (!html.includes(marker)) throw new Error(`Marker ${marker} missing in index.template.html`);
  html = html.split(marker).join(content);
}

const out = path.join(__dirname, 'dist', 'padel.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(__dirname, out)} (${(html.length / 1024).toFixed(1)} KB)`);
