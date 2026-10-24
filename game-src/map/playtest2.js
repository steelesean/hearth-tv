// Headless playtest: starts the game at a chosen hour, sends the Shermans and 1st Squad at the farm,
// fast-forwards, and reports what happened with screenshots along the way.
//   TIME=day|mist|dusk SHOTS=prefix node playtest2.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game'), TIME = process.env.TIME || 'day', PRE = process.env.SHOTS || 'pt';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const port = srv.address().port;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`http://localhost:${port}/game/?time=${TIME}&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const g = window.__game, obj = [-193, 83];
    const ts = g.units.filter((u) => u.kind === 'tank');
    g.select(ts); g.orderGroup(ts, obj[0], obj[1] + 10);
    const sq = g.units.filter((u) => u.kit === 'us'); g.select(sq); g.orderGroup(sq, obj[0] + 30, obj[1] + 40);
    g.select(ts);
  });
  const report = async (label, secs) => {
    const st = await p.evaluate((secs) => {
      const g = window.__game;
      for (let i = 0; i < secs * 20; i++) g.update(0.05);
      const mine = g.units.filter((u) => u.side === 'allies' && u.hp > 0 && !u.gone);
      const cx = mine.reduce((a, u) => a + u.x, 0) / mine.length, cy = mine.reduce((a, u) => a + u.y, 0) / mine.length;
      const q = g.proj(cx, cy, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; g.draw();
      const ax = g.units.filter((u) => u.side === 'axis');
      return { t: Math.round(g.clock()), tanks: g.units.filter((u) => u.kind === 'tank').map((u) => u.name + ':' + Math.max(0, Math.round(u.hp)) + ' he' + u.he + (Object.keys(u.dmg).length ? ' ' + Object.keys(u.dmg).join('+') : '')),
        us: g.units.filter((u) => u.kit === 'us' && u.hp > 0).map((u) => u.state + '/' + Math.round(u.morale)).join(','),
        crew: g.units.filter((u) => u.role === 'crew' && u.hp > 0 && !u.gone).length,
        axis: ax.filter((u) => u.hp > 0 && !u.gone).length + ' alive, ' + ax.filter((u) => u.hp <= 0).length + ' dead', tally: g.tally,
        clouds: g.clouds().length, heard: g.heard().length };
    }, secs);
    console.log(label, JSON.stringify(st));
    await p.waitForTimeout(700); await p.screenshot({ path: path.join(__dirname, PRE + '-' + label + '.png') });
  };
  await report('a', 20); await report('b', 20); await report('c', 30); await report('d', 60);
  const radio = await p.evaluate(() => window.__radio);
  console.log('radio:\n  ' + radio.join('\n  '));
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
