'use strict';
// Local static server for dist/site (Node built-ins only). Usage: node tools/serve.js [port]
// Service workers need http://localhost (or https), not file://.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'dist', 'site');
const port = +process.argv[2] || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving dist/site on http://localhost:${port}/`));
