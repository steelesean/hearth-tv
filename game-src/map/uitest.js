const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const url = `http://localhost:${srv.address().port}/game/?time=day&quiet=1`;
  await p.goto(url); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(800);
  await p.click('#helpClose'); await p.waitForTimeout(200);
  await p.click('button[data-cmd="orders"]'); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(__dirname, 'ui-collapsed.png') });
  const a = await p.evaluate(() => ({ help: getComputedStyle(document.getElementById('help')).display, buttons: document.querySelectorAll('#panel button').length }));
  await p.reload(); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(800);
  const bb = await p.evaluate(() => ({ help: getComputedStyle(document.getElementById('help')).display, buttons: document.querySelectorAll('#panel button').length }));
  await p.click('button[data-cmd="orders"]'); await p.waitForTimeout(300); await p.click('button[data-cmd="help"]'); await p.waitForTimeout(300);
  const c = await p.evaluate(() => ({ help: getComputedStyle(document.getElementById('help')).display, buttons: document.querySelectorAll('#panel button').length }));
  console.log(JSON.stringify({ afterHiding: a, afterReload: bb, afterShowingAgain: c }), 'errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
