// Scattered paratroopers: where they're placed, the cricket, finding each kind, and carrying them into Bloody Gulch.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const base = `http://localhost:${srv.address().port}/game/`;
  await p.goto(base + '?quiet=1'); await p.evaluate(() => localStorage.clear()); await p.goto(base + '?quiet=1&diff=normal');
  await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(800);
  await p.click('#go'); await p.waitForTimeout(300);
  const m1 = await p.evaluate(() => {
    const g = window.__game, S = g.strays(), step = (s) => { for (let i = 0; i < s * 20; i++) g.update(0.05); };
    const r = { placed: S.map((s) => s.kind + ' ' + s.name + ' x' + s.men.length + ' @' + Math.round(s.x) + ',' + Math.round(s.y)), groupsBefore: g.groups().length };
    // walk the Scouts up to the hidden group: a cricket first, then found
    const hid = S.filter((s) => s.kind === 'hidden')[0], sc = g.units.filter((u) => u.squad === 'Scouts');
    g.units.forEach((u) => { if (u.side === 'axis' && !/^Wache/.test(u.squad)) u.hp = 0; });   // a quiet field for this
    sc.forEach((u, i) => { u.x = hid.x + 85 + i * 2; u.y = hid.y; u.path = null; });
    step(15); r.cricketHeard = g.heard().filter((h) => h.kind === 'cricket').length;
    sc.forEach((u, i) => g.order(u, hid.x + 20 + i * 2, hid.y)); step(40);
    r.hiddenFound = hid.found; r.scoutDist = Math.round(Math.hypot(sc[0].x - hid.x, sc[0].y - hid.y)); r.groupsAfter = g.groups().map((x) => x.key);
    // the captives: not found while the guards are there; found once they're dead
    const cap = S.filter((s) => s.kind === 'captive')[0];
    if (cap) { const t = g.units[0]; t.x = cap.x + 20; t.y = cap.y; t.path = null; step(3); r.captiveWhileGuarded = cap.found;
      cap.guards.forEach((s) => { s.hp = 0; }); step(3); r.captiveFreed = cap.found; r.captiveCanFight = cap.men.every((u) => !u.captive); }
    r.lowAmmo = hid.men.filter((u) => u.lowAmmo).length;
    r.log = g.log().filter((l) => /cricket|Airborne|paratroop/i.test(l)).slice(-4);
    g.end('Held until relieved', 'test', true); return r; });
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => ({ debrief: document.getElementById('debrief').innerText, end: document.getElementById('endText').textContent, roster: Object.keys(JSON.parse(localStorage.getItem('hedgerows.campaign')).roster.squads) }));
  await p.screenshot({ path: path.join(__dirname, 'p-debrief.png') });
  await p.click('#endButtons button[data-end="next"]');
  await p.waitForFunction(() => window.__game && window.__game.mission() === 'gulch', null, { timeout: 30000 }); await p.waitForTimeout(1500);
  const m2 = await p.evaluate(() => { const g = window.__game;
    return { groups: g.groups().map((x) => x.key + ':' + x.units.length + (x.units[0].kit === 'para' ? '(para)' : '')), newStrays: g.strays().map((s) => s.kind + ' ' + s.name) }; });
  console.log(JSON.stringify({ m1, debrief: d.debrief, end: d.end, roster: d.roster, m2 }, null, 1));
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
