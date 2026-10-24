const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h] of [[1280, 720], [1700, 900]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1&mode=battle`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1000);
    await p.evaluate(() => { window.__game.select(window.__game.units.filter((u) => u.kind === 'tank')); });
    // click every marker: the flags, the clock, a counter; nothing should get a move order
    for (const sel of ['#objs .chip', '#clock .chip', '#res .chip']) { const el = await p.$(sel); if (el) await el.click(); await p.waitForTimeout(150); }
    const moved = await p.evaluate(() => window.__game.units.filter((u) => u.kind === 'tank').some((u) => u.path));
    // do any of the top markers overlap?
    const boxes = await p.evaluate(() => ['objs', 'clock', 'ticker', 'res'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.left, r.top, r.right, r.bottom, r.width > 0]; }));
    const overlap = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a[5] && c[5] && a[1] < c[3] && c[1] < a[3] && a[2] < c[4] && c[2] < a[4]) overlap.push(a[0] + '/' + c[0]); }
    await p.screenshot({ path: path.join(__dirname, 'ui3-' + w + '.png') });
    console.log(w + 'x' + h, JSON.stringify({ movedByClickingMarkers: moved, overlaps: overlap }));
    await p.close();
  }
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
