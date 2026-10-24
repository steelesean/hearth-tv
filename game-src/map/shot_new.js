const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1600, height: 900 } }); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game); await p.waitForTimeout(1000);
  console.log(await p.evaluate(() => { const g = window.__game, a = g.units[0];
    g.units.forEach((u) => { if (u.side === 'axis') u.hp = 0, u.bodySeen = false; });
    let best = null; for (let r = 90; r > 50 && !best; r -= 10) for (let an = 0; an < 6.28 && !best; an += 0.1) { const x = a.x + Math.cos(an) * r, y = a.y + Math.sin(an) * r; if (g.see(a.x, a.y, x, y)) best = [x, y, an]; }
    const s = g.stug(best[0], best[1], 'StuG 1'); s.h = best[2] + Math.PI + 0.6; s.ap = 0; s.he = 0; g.units.push(s);
    const bz = g.units.filter((u) => u.squad === 'Bazooka'); bz.forEach((u, i) => { u.x = a.x + Math.cos(best[2] + 1) * 25 + i * 2; u.y = a.y + Math.sin(best[2] + 1) * 25; u.path = null; });
    const hid = g.strays()[0]; hid.men.forEach((u, i) => { u.x = a.x - 14 + i * 2; u.y = a.y + 10; });
    for (let i = 0; i < 30; i++) g.update(0.05);
    g.select(bz); const q = g.proj((a.x + s.x) / 2, (a.y + s.y) / 2, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; g.draw(); return g.log().slice(-3).join(' / '); }));
  await p.waitForTimeout(400); await p.screenshot({ path: path.join(__dirname, 'n-stug.png') }); await b.close(); srv.close(); })();
