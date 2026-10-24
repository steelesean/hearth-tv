// Puts a soldier just behind each of the hamlet's houses and a tank behind a hedge, then screenshots up close.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(8778);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8778/game/?time=day&quiet=1'); await p.waitForFunction(() => window.__game, null, { timeout: 20000 });
  await p.evaluate(() => {
    const g = window.__game, L = [-193, 83];
    const inf = g.units.filter((u) => u.kind === 'inf');
    // a line of soldiers marching west to east straight across the hamlet, so some stand behind buildings
    inf.forEach((u, i) => { u.x = L[0] - 30 + (i % 5) * 12; u.y = L[1] - 40 + Math.floor(i / 5) * 30; u.path = null; u.hp = 100; });
    g.units.filter((u) => u.kind === 'tank').forEach((t) => { t.hp = 0.01; t.x = 1e4; });   // out of the way so nobody moves
    const q = g.proj(L[0], L[1], 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
  });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const g = window.__game; const c = g.clock(); g.units.forEach((u, i) => { if (u.kind === 'inf') { u.last = { x: u.x, y: u.y, h: u.h, pose: 'aim' }; u.seenT = i % 2 ? c - 6 : 1e9; if (i % 2) { u.x += 15; } } }); g.draw(); });
  await p.screenshot({ path: path.join(__dirname, 'occl.png'), clip: { x: 560, y: 240, width: 800, height: 600 } });
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
