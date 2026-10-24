const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`http://localhost:${srv.address().port}/game/?time=${process.env.TIME || 'day'}&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(2500);
  await p.evaluate(() => { const g = window.__game, ts = g.units.filter((u) => u.kind === 'tank'); g.orderGroup(ts, -193, 93); for (let i = 0; i < 400; i++) g.update(0.05); const q = g.proj(ts[0].x, ts[0].y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
  const ms = await p.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 60; i++) window.__game.draw(); return (performance.now() - t0) / 60; });
  const { profile } = await cdp.send('Profiler.stop');
  const self = {}, dt = {}; const ids = {}; profile.nodes.forEach((n) => ids[n.id] = n);
  for (let i = 0; i < profile.samples.length; i++) { const n = ids[profile.samples[i]]; const k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0); }
  const top = Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' ' + (v / 1000 / 60).toFixed(2) + 'ms');
  console.log('draw', ms.toFixed(1), 'ms/frame\n  ' + top.join('\n  ')); await b.close(); srv.close();
})();
