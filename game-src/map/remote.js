// Plays with only the six remote buttons the Hearth app sends: up, down, left, right, ok, back.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await p.evaluate((k) => window.hearthKey(k), k); await p.waitForTimeout(30); } };
  await key('right'); await key('ok');                                // start screen: pick dusk, OK
  await p.waitForTimeout(300);
  const r1 = await p.evaluate(() => { const g = window.__game; return { started: g.clock() >= 0, time: document.getElementById('start').style.display, sel: g.selected().length }; });
  await key('back');                                                  // clears the selection (tanks start selected)
  // steer the cursor onto Able: work out how far it is, then press arrows
  const target = await p.evaluate(() => { const g = window.__game, a = g.units[0], q = g.proj(a.x, a.y, 1); return [q[0] - g.view.x, q[1] - g.view.y]; });
  const cur = await p.evaluate(() => [window.__game.remote.x, window.__game.remote.y]);
  const steps = (d) => Math.round(Math.abs(d) / 22);
  await key(target[0] > cur[0] ? 'right' : 'left', steps(target[0] - cur[0])); await p.waitForTimeout(250);
  await key(target[1] > cur[1] ? 'down' : 'up', steps(target[1] - cur[1])); await p.waitForTimeout(250);
  await key('ok');
  const r2 = await p.evaluate(() => window.__game.selected().map((u) => u.name || u.squad));
  await key('down', 8); await p.waitForTimeout(250); await key('ok');  // an orders menu a little way off
  await p.evaluate(() => window.__game.draw()); await p.screenshot({ path: path.join(__dirname, 'r-menu.png') });
  const menu = await p.evaluate(() => { const m = window.__game.remote.menu; return m && m.items.map((i) => i.label); });
  await key('ok');                                                    // first item: Move here
  await p.evaluate(() => { for (let i = 0; i < 40; i++) window.__game.update(0.05); });
  const r3 = await p.evaluate(() => { const a = window.__game.units[0]; return { moving: !!a.path || a.state === 'move' }; });
  await key('back'); await key('back');                              // clear selection, then pause
  const r4 = await p.evaluate(() => ({ paused: window.__game.paused(), menu: window.__game.remote.menu && window.__game.remote.menu.title }));
  await p.evaluate(() => window.__game.draw()); await p.screenshot({ path: path.join(__dirname, 'r-pause.png') });
  await key('ok');                                                    // Carry on
  const r5 = await p.evaluate(() => ({ paused: window.__game.paused() }));
  console.log(JSON.stringify({ start: r1, selected: r2, menu, afterMove: r3, back: r4, resumed: r5 }));
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
