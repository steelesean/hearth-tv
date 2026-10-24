const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(); let res = [];
  for (let k = 0; k < 8; k++) { const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game);
  res.push(await p.evaluate(() => { var g = window.__game;
    var bz = g.units.filter(function (u) { return u.role === 'bazooka'; })[0];
    g.units.forEach(function (u) { if (u.side === 'axis') u.hp = 0; if (u.model === 'sherman') u.gone = true; });
    var best = null; for (var a = 0; a < 6.28 && !best; a += 0.2) { var x = bz.x + Math.cos(a) * 50, y = bz.y + Math.sin(a) * 50; if (g.see(bz.x, bz.y, x, y)) best = [x, y, a]; }
    var s = g.stug(best[0], best[1], 'StuG 1'); s.h = best[2] + Math.PI / 2; s.ap = 0; s.he = 0; g.units.push(s); bz.hold = true;
    var ev = []; var r0 = bz.rockets;
    for (var i = 0; i < 600; i++) { g.update(0.05); if (bz.rockets < r0) { ev.push('t' + g.clock().toFixed(1) + ' supp' + Math.round(bz.supp) + ' d' + Math.round(Math.hypot(bz.x - s.x, bz.y - s.y)) + ' hp' + s.hp + ' pose' + bz.pose); r0 = bz.rockets; } }
    return ev.join(' | ') + ' || ' + g.log().slice(-4).join(' / '); }));
  await p.close(); }
  console.log(res.join('\n')); await b.close(); srv.close(); })();
