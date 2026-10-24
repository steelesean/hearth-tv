// Loads the game headless, orders the Shermans to the farm, fast-forwards, and screenshots.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, '') === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, '')); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(8777);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8777/game/'); await p.waitForFunction(() => window.__game, null, { timeout: 20000 }); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, 'play-0.png') });
  const plan = await p.evaluate(() => {
    const g = window.__game, obj = [-193, 83];
    const ts = g.units.filter((u) => u.kind === 'tank');
    ts.forEach((t, i) => g.order(t, obj[0] + i * 8, obj[1] + 10));
    return ts.map((t) => (t.path ? t.path.length : 'no path'));
  });
  console.log('paths', plan);
  for (const [label, secs] of [['play-1', 25], ['play-15', 15], ['play-2', 20]]) {
    const st = await p.evaluate((secs) => {
      const g = window.__game;
      for (let i = 0; i < secs * 20; i++) g.update(0.05);
      const ts = g.units.filter((u) => u.kind === 'tank'), cx = ts.reduce((a, u) => a + u.x, 0) / ts.length, cy = ts.reduce((a, u) => a + u.y, 0) / ts.length;
      const q = g.proj(cx, cy, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; g.draw();
      return { radio: (window.__radio||[]), tanks: ts.map((u) => [Math.round(u.x), Math.round(u.y), u.hp]), germans: g.units.filter((u) => u.kind === 'inf' && u.hp > 0).map((u) => u.state).join(',') };
    }, secs);
    console.log(label, JSON.stringify(st));
    await p.waitForTimeout(800); await p.screenshot({ path: path.join(__dirname, label + '.png') });
  }
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
