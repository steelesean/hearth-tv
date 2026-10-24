const { chromium, devices } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13 landscape'] }); const p = await ctx.newPage();
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game); await p.waitForTimeout(1000);
  await p.screenshot({ path: path.join(__dirname, 'mob-1.png') });
  // a tap on a tank, then a tap on the ground, then a swipe
  const q = await p.evaluate(() => { const g = window.__game, t = g.units[0], c = document.getElementById('c').getBoundingClientRect(), s = g.proj(t.x, t.y, 1); return { x: c.left + (s[0] - g.view.x) * c.width / 1920, y: c.top + (s[1] - g.view.y) * c.height / 1080, vx: g.view.x }; });
  await p.touchscreen.tap(q.x, q.y); await p.waitForTimeout(200);
  const sel = await p.evaluate(() => window.__game.selected().map((u) => u.name || u.squad).join(','));
  await p.touchscreen.tap(q.x + 60, q.y + 10); await p.waitForTimeout(200);
  const moving = await p.evaluate(() => window.__game.selected().some((u) => u.path));
  console.log(JSON.stringify({ tapSelected: sel, tapMoved: moving, canvas: await p.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }) }));
  await b.close(); srv.close(); })();
