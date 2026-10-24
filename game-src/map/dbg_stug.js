const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game);
  console.log(await p.evaluate(() => { var g = window.__game, a = g.units[0]; g.units[1].gone = true;
    var best = null; for (var r = 220; r > 100 && !best; r -= 20) for (var an = 0; an < 6.28 && !best; an += 0.1) { var x = a.x + Math.cos(an) * r, y = a.y + Math.sin(an) * r; if (g.see(a.x, a.y, x, y)) best = [x, y, an, r]; }
    var s = g.stug(best[0], best[1], 'StuG 1'); s.h = best[2] + Math.PI; g.units.push(s);
    var out = [];
    for (var i = 0; i < 200; i++) { g.update(0.05); if (i % 40 === 0) out.push({ t: g.clock().toFixed(1), seeLineBack: g.see(s.x, s.y, a.x, a.y), spot: Math.round(g.spot(s, a)), d: Math.round(Math.hypot(s.x - a.x, s.y - a.y)), h: s.h.toFixed(2), gun: s.gun.toFixed(1), path: !!s.path, st: s.state }); }
    return JSON.stringify(out); }));
  await b.close(); srv.close(); })();
