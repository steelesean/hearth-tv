const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), c = {};
  for (let i = 0; i < 30; i++) { const p = await b.newPage(); await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game);
    const k = await p.evaluate(() => window.__game.plan().posture); c[k] = (c[k] || 0) + 1; await p.close(); }
  console.log(c); await b.close(); srv.close(); })();
