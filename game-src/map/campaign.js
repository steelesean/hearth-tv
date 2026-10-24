// Campaign flow: start a fresh campaign from the start screen, win mission 1 (forced), check the debrief and roster,
// go on to Bloody Gulch with the same men, and let it play out undefended for a while.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text()); });
  const base = `http://localhost:${srv.address().port}/game/`;
  await p.goto(base + '?quiet=1'); await p.evaluate(() => localStorage.clear()); await p.goto(base + '?quiet=1');
  await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(__dirname, 'cp-start.png') });
  const s0 = await p.evaluate(() => ({ title: document.getElementById('missionTitle').textContent, row: document.getElementById('missionRow').textContent }));
  await p.click('#go'); await p.waitForTimeout(300);
  const m1 = await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 20 * 60; i++) g.update(0.05);
    const sq = g.units.filter((u) => u.squad === '1st Squad'); sq[1].hp = 0; sq[2].hp = 0;   // two men lost
    g.end('Held until relieved', 'test', true); return { mission: g.mission(), started: g.clock() > 0 }; });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, 'cp-debrief.png') });
  const d = await p.evaluate(() => ({ debrief: document.getElementById('debrief').innerText, buttons: [].map.call(document.querySelectorAll('#endButtons button'), (b) => b.textContent),
    saved: JSON.parse(localStorage.getItem('hedgerows.campaign')) }));
  await p.click('#endButtons button[data-end="next"]');
  await p.waitForFunction(() => window.__game && window.__game.clock() >= 0, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  const m2 = await p.evaluate(() => { const g = window.__game; const sq1 = g.units.filter((u) => u.squad === '1st Squad');
    const r = { mission: g.mission(), firstSquad: sq1.length, names: sq1.map((u) => u.man && (u.man.rank + ' ' + u.man.name)).slice(0, 3) };
    for (let i = 0; i < 20 * 240; i++) g.update(0.05);
    r.after4min = { axis: g.units.filter((u) => u.side === 'axis' && u.hp > 0 && !u.gone).length, objs: g.objs().map((o) => o.label + ':' + o.owner) };
    const ax = g.units.filter((u) => u.side === 'axis' && u.hp > 0)[0]; if (ax) { const q = g.proj(ax.x, ax.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; } g.draw();
    return r; });
  await p.screenshot({ path: path.join(__dirname, 'cp-gulch.png') });
  console.log(JSON.stringify({ s0, m1, debrief: d.debrief.slice(0, 300), buttons: d.buttons, savedNext: d.saved && d.saved.next, squad1Left: d.saved && d.saved.roster.squads['1st Squad'].length, m2 }, null, 1));
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
