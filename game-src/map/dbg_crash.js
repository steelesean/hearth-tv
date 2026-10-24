const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch();
  for (let k = 0; k < 12; k++) { const p = await b.newPage();
    await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1&diff=normal`); await p.waitForFunction(() => window.__game);
    const r = await p.evaluate(() => { const g = window.__game; try { const ts = g.units.filter((u) => u.kind === 'tank'), o = g.objs()[0], s = g.units.filter((u) => u.squad === '1st Squad');
      const dx = ts[0].x - o.x, dy = ts[0].y - o.y, l = Math.hypot(dx, dy); g.orderGroup(ts, o.x + dx / l * 70, o.y + dy / l * 70); g.orderGroup(s, o.x + dx / l * 95, o.y + dy / l * 95);
      for (let i = 0; i < 75 * 20; i++) g.update(0.05); return 'ok ' + g.strays().map((x) => x.kind + (x.found ? '+' : '')).join(','); } catch (e) { return e.stack; } });
    if (r.slice(0, 2) !== 'ok') { console.log(r); break; } else console.log(r);
    await p.close(); }
  await b.close(); srv.close(); })();
