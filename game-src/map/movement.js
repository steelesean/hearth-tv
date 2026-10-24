// Movement test: tanks don't overlap, demolition opens a gap, a tank crashes through a hedge, infantry climb a bank.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const port = srv.address().port, b = await chromium.launch(), errs = [];
  async function scene(name, js) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(`http://localhost:${port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1500);
    const out = await p.evaluate(`(function(){ var g = window.__game; g.units.filter(function(u){return u.side==='axis';}).forEach(function(u){u.gone=true;});
      function step(s, f){ for (var i = 0; i < s * 20; i++) { g.update(0.05); if (f) f(); } }
      function look(x, y){ var q = g.proj(x, y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; }
      ${js} })()`);
    await p.waitForTimeout(1500); await p.evaluate(() => { document.getElementById('end').style.display = 'none'; window.__game.draw(); });
    await p.screenshot({ path: path.join(__dirname, 'm-' + name + '.png') }); console.log(name, JSON.stringify(out)); await p.close();
  }
  if (!process.env.ONLY) await scene('together', `
    var ts = g.units.filter(function (u) { return u.kind === 'tank'; }), min = 99;
    // both to exactly the same spot, one at a time, so they must sort themselves out
    ts.forEach(function (t) { g.order(t, -150, 150); });
    step(40, function () { var d = Math.sqrt((ts[0].x-ts[1].x)*(ts[0].x-ts[1].x)+(ts[0].y-ts[1].y)*(ts[0].y-ts[1].y)); if (d < min) min = d; });
    look(ts[0].x, ts[0].y); g.select(ts);
    return { closest: +min.toFixed(1), where: ts.map(function (t) { return [Math.round(t.x), Math.round(t.y)]; }) };`);
  if (!process.env.ONLY) await scene('demo', `
    var sq = g.units.filter(function (u) { return u.kit === 'us'; }), gr = g.grid(), G = 360;
    // the nearest hedge cell to the squad
    var c = sq[0], best = null, bd = 1e9;
    for (var r = 0; r < G; r++) for (var k = 0; k < G; k++) if (gr.kind[r*G+k] === 1) { var x = k*2+1-360, y = 360-(r*2+1), d = (x-c.x)*(x-c.x)+(y-c.y)*(y-c.y); if (d > 200 && d < bd) { bd = d; best = [x, y]; } }
    g.select(sq); g.plantCharge(best[0], best[1]); step(45);
    look(best[0], best[1]); var cell = gr.kind[Math.floor((360-best[1])/2)*G + Math.floor((best[0]+360)/2)];
    return { at: best, kindNow: cell, radio: window.__radio.slice(-4) };`);
  await scene('crash', `
    var t = g.units[0], other = g.units[1];
    var gr = g.grid(), G = 360, tgt = null, info = [];
    for (var a = 0; a < 6.28 && !tgt; a += 0.2) {
      var x = t.x + Math.cos(a) * 45, y = t.y + Math.sin(a) * 45, k = Math.floor((x+360)/2), r = Math.floor((360-y)/2);
      if (gr.tank[r*G+k]) continue;
      t.crash = false; g.order(t, x, y); var plain = t.path ? t.path.length : 0;
      t.crash = true; g.order(t, x, y); var withCrash = t.path ? t.path.length : 0;
      info.push([plain, withCrash]);
      if (withCrash && (!plain || withCrash < plain - 2)) tgt = [x, y];
    }
    if (!tgt) return { none: info.slice(0, 8) };
    var climbed = 0, log = []; step(50, function () { if (t.climbing) climbed++; });
    look(t.x, t.y); g.select([t]);
    return { target: tgt.map(Math.round), reached: Math.round(Math.sqrt((t.x-tgt[0])*(t.x-tgt[0])+(t.y-tgt[1])*(t.y-tgt[1]))), secondsClimbing: climbed / 20, wait: t.wait, path: t.path && t.path.length };`);
  if (!process.env.ONLY) await scene('climb', `
    var sq = g.units.filter(function (u) { return u.kit === 'us'; }), m = sq[0], gr = g.grid(), G = 360, tgt = null;
    for (var a = 0; a < 6.28 && !tgt; a += 0.15) { var x = m.x + Math.cos(a) * 30, y = m.y + Math.sin(a) * 30; g.order(m, x, y); if (m.path) { var crosses = m.path.some(function (w) { var k = Math.floor((w[0]+360)/2), r = Math.floor((360-w[1])/2); return gr.kind[r*G+k] === 1; }); if (crosses) tgt = [x, y]; } }
    g.select(sq); g.orderGroup(sq, tgt[0], tgt[1]); var crossing = 0; step(12, function () { crossing = Math.max(crossing, sq.filter(function (u) { return u.state === 'crossing'; }).length); });
    look(m.x, m.y);
    return { target: tgt.map(Math.round), mostCrossingAtOnce: crossing };`);
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
