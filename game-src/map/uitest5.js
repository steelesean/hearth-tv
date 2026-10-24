// Right-click on the interface, and a Mac Control-click on the map
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game); await p.waitForTimeout(1000);
  const r = {};
  await p.click('#cards [data-card="1st Squad"]', { button: 'right' }); await p.waitForTimeout(300);
  r.cardRightClickSelects = await p.evaluate(() => window.__game.selected().every((u) => u.squad === '1st Squad') && window.__game.selected().length > 0);
  r.ordersOpen = await p.locator('#cards .orders button').count();
  await p.click('#cards .orders button[data-cmd="hold"]', { button: 'right' }); await p.waitForTimeout(300);
  r.orderRightClickRuns = await p.evaluate(() => window.__game.selected().every((u) => u.hold));
  const v0 = await p.evaluate(() => window.__game.view.x + ',' + window.__game.view.y);
  await p.click('#objs [data-obj="crossroads"]', { button: 'right' }); await p.waitForTimeout(300);
  r.flagRightClickCentres = v0 !== await p.evaluate(() => window.__game.view.x + ',' + window.__game.view.y);
  // a Mac Control-click on the map: mousedown with ctrlKey, then contextmenu. The wheel, no move order.
  await p.evaluate(() => window.__game.select(window.__game.units.filter((u) => u.kind === 'tank' && u.side === 'allies')));
  await p.mouse.move(700, 450); await p.keyboard.down('Control'); await p.mouse.down(); await p.mouse.up(); await p.keyboard.up('Control');
  await p.dispatchEvent('#c', 'contextmenu', { clientX: 700, clientY: 450 }); await p.waitForTimeout(300);
  r.ctrlClick = await p.evaluate(() => ({ moving: window.__game.selected().some((u) => u.path), wheel: !!window.__game.remote.menu }));
  console.log(JSON.stringify(r), 'errors:', errs.join(' | ') || 'none'); await b.close(); srv.close(); })();
