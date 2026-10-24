// Speed check at the busiest moment (the counter-attack), with the processor slowed six times to stand in for the Fire TV Stick.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { const g = window.__game; const ts = g.units.filter((u) => u.kind === 'tank'), s = g.units.filter((u) => u.squad === '1st Squad'), o = g.objs()[0];
    g.orderGroup(ts, o.x + 30, o.y + 40); g.orderGroup(s, o.x + 40, o.y + 50); for (let i = 0; i < 20 * 520; i++) g.update(0.05);   // past the counter-attack
    const q = g.proj(o.x, o.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; });
  const cdp = await p.context().newCDPSession(p);
  const measure = async () => p.evaluate(() => { const g = window.__game; let t0 = performance.now(); for (let i = 0; i < 60; i++) g.update(1 / 60); const u = (performance.now() - t0) / 60;
    t0 = performance.now(); for (let i = 0; i < 20; i++) g.draw(); const d = (performance.now() - t0) / 20;
    return { units: g.units.filter((x) => x.hp > 0 && !x.gone).length, phase: g.phase(), updateMs: +u.toFixed(2), drawMs: +d.toFixed(1) }; });
  console.log('normal  ', JSON.stringify(await measure()));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  console.log('6x slow ', JSON.stringify(await measure()));
  // where does the slowed frame's own JavaScript time go (not counting drawing images, which the TV's graphics chip does)?
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 30; i++) { g.update(1 / 60); g.draw(); } });
  const { profile } = await cdp.send('Profiler.stop'); const ids = {}; profile.nodes.forEach((n) => ids[n.id] = n); const self = {};
  for (let i = 0; i < profile.samples.length; i++) { const n = ids[profile.samples[i]]; const k = n.callFrame.functionName || '(anon)'; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0); }
  console.log('top:', Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + ' ' + (v / 1000 / 30).toFixed(1) + 'ms').join(', '));
  await b.close(); srv.close();
})();
