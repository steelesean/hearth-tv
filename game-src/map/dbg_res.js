const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1&diff=hard&plan=north,echelon,reserve`); await p.waitForFunction(() => window.__game);
  console.log(await p.evaluate(() => { const g = window.__game, o = g.objs(), P = g.plan(), out = [];
    const res = () => g.units.filter((u) => u.squad === 'Gruppe 3');
    out.push('reserve at ' + JSON.stringify(P.reserveAt && [Math.round(P.reserveAt.x), Math.round(P.reserveAt.y)]) + ' men ' + res().length + ' farm ' + Math.round(o[0].x) + ',' + Math.round(o[0].y) + ' x ' + Math.round(o[1].x) + ',' + Math.round(o[1].y));
    g.units.forEach((u) => { if (u.side === 'axis' && Math.hypot(u.x - o[0].x, u.y - o[0].y) < 70 && !u.reserve) u.hp = 0; });
    g.units.filter((u) => u.squad === '1st Squad').forEach((u) => { u.x = o[0].x + (Math.random() - .5) * 6; u.y = o[0].y + (Math.random() - .5) * 6; u.path = null; });
    for (let i = 0; i < 20 * 40; i++) { g.update(0.05); if (i % 100 === 0) out.push(g.clock().toFixed(0) + 's farm ' + o[0].owner + ' ' + res().map((u) => Math.round(u.x) + ',' + Math.round(u.y) + (u.path ? 'P' : '') + (u.reserve ? 'R' : '') + (u.hp > 0 ? '' : 'dead') + (u.pinned ? 'pin' : '')).join(' ')); }
    return out.join('\n'); }));
  await b.close(); srv.close(); })();
