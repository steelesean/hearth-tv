// The open card's orders float above it without moving other cards; the top counters are clickable
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => { const b = await chromium.launch(), errs = [];
  for (const [w, h] of [[1440, 820], [1280, 720]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://localhost:${srv.address().port}/game/?time=day&quiet=1`); await p.waitForFunction(() => window.__game); await p.waitForTimeout(900);
    const pos = () => p.evaluate(() => [].map.call(document.querySelectorAll('#cards [data-card]'), (c) => c.getAttribute('data-card') + ':' + Math.round(c.getBoundingClientRect().top)).join(' '));
    await p.click('#cards [data-card="Able"]'); await p.waitForTimeout(250); const a = await pos();
    await p.click('#cards [data-card="Bazooka"]'); await p.waitForTimeout(250); const z = await pos();
    const pop = await p.evaluate(() => { const o = document.querySelector('#cards .orders').getBoundingClientRect(); return { top: Math.round(o.top), bottom: Math.round(o.bottom), left: Math.round(o.left), right: Math.round(o.right) }; });
    await p.screenshot({ path: path.join(__dirname, 'u6-' + w + '.png') });
    await p.click('#res button[data-cmd="arty"]'); await p.waitForTimeout(200);
    const hot = await p.evaluate(() => !!document.querySelector('#res button[data-cmd="arty"].hot'));
    await p.mouse.click(w / 2, h / 2); await p.waitForTimeout(200);
    const left = await p.evaluate(() => document.querySelector('#res button[data-cmd="arty"]').textContent);
    console.log(w + 'x' + h, JSON.stringify({ ableOpen: a, bazookaOpen: z, popup: pop, artyHot: hot, artyLeftAfterMapClick: left }));
    await p.close(); }
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close(); })();
