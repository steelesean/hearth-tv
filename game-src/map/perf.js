const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const g = window.__game, ts = g.units.filter((u) => u.kind === 'tank'), sq = g.units.filter((u) => u.kit === 'us');
    g.orderGroup(ts, -193, 93); g.orderGroup(sq, -170, 120);
    for (let i = 0; i < 400; i++) g.update(0.05);       // get into the fight
    let t0 = performance.now(); for (let i = 0; i < 200; i++) g.update(0.05); const upd = (performance.now() - t0) / 200;
    t0 = performance.now(); for (let i = 0; i < 60; i++) g.draw(); const drw = (performance.now() - t0) / 60;
    const parts = {}; ['drawMarks','units','fx','clouds'].forEach(() => {}); return { updateMs: +upd.toFixed(2), drawMs: +drw.toFixed(2), units: g.units.filter(u => u.hp > 0).length, fx: 0 };
  });
  console.log(JSON.stringify(r)); await b.close(); srv.close();
})();
