const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1600, height: 900 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=${process.env.TIME || 'mist'}&quiet=1&mode=battle&m=${process.env.M || 'hedgerows'}`);
  await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 20 * 25; i++) g.update(0.05); });
  await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, 'ui2-play.png') });
  // click the 1st Squad card, then right-click on the map for the wheel
  await p.click('#cards [data-card="1st Squad"]'); await p.waitForTimeout(200);
  const box = await p.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  await p.mouse.click(box[0] + box[2] * 0.55, box[1] + box[3] * 0.45, { button: 'right' }); await p.waitForTimeout(150);
  await p.mouse.move(box[0] + box[2] * 0.55 + 10, box[1] + box[3] * 0.45 - 120); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(__dirname, 'ui2-wheel.png') });
  const st = await p.evaluate(() => ({ sel: window.__game.selected().length, menu: window.__game.remote.menu && window.__game.remote.menu.items.map((i) => i.label), hi: window.__game.remote.menu && window.__game.remote.menu.i }));
  await p.mouse.click(box[0] + box[2] * 0.55 + 10, box[1] + box[3] * 0.45 - 120); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ menu: !!window.__game.remote.menu, moving: window.__game.selected().some((u) => u.path || u.orderWait) }));
  await p.keyboard.press('?'); await p.waitForTimeout(300); await p.screenshot({ path: path.join(__dirname, 'ui2-help.png') });
  console.log(JSON.stringify({ st, after }), 'errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
