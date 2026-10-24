// German armour and the bazooka: a StuG against a Sherman head-on, a bazooka ambush from the flank,
// armour sums, and a Bloody Gulch run with StuGs in the waves.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
const step = (secs) => { const g = window.__game; for (let i = 0; i < secs * 20; i++) g.update(0.05); };
(async () => {
  const port = srv.address().port, b = await chromium.launch(), errs = [];
  async function scene(name, q, setup, shot) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(`http://localhost:${port}/game/?${q}&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(800);
    const out = await p.evaluate(`(function(){ var step = ${step.toString()}; var g = window.__game; ${setup} })()`);
    if (shot) { await p.evaluate(() => window.__game.draw()); await p.screenshot({ path: path.join(__dirname, 'a-' + name + '.png') }); }
    console.log(name, JSON.stringify(out)); await p.close();
  }
  await scene('sums', 'time=day', `
    var s = g.stug(0, 0, 'S'), sh = g.units[0]; sh.x = 0; sh.y = 0; sh.h = 0;
    var o = {}; [['front', 50, 0], ['side', 0, 50], ['rear', -50, 0]].forEach(function (f) {
      ['bazooka', 'ap75', 'pf'].forEach(function (w) { o['stug ' + f[0] + ' ' + w] = g.armour(s, { x: f[1], y: f[2] }, w)[1]; });
      o['sherman ' + f[0] + ' ap48'] = g.armour(sh, { x: f[1], y: f[2] }, 'ap48')[1]; });
    o['stug front ap75 at 400m'] = g.armour(s, { x: 400, y: 0 }, 'ap75')[1]; return o;`);
  // head-on: a StuG appears 220 m in front of Able
  await scene('duel', 'time=day', `
    var a = g.units[0]; g.units[1].gone = true; g.units.forEach(function (u) { if (u.side === 'axis') u.hp = 0; });
    var best = null; for (var r = 220; r > 100 && !best; r -= 20) for (var an = 0; an < 6.28 && !best; an += 0.1) { var x = a.x + Math.cos(an) * r, y = a.y + Math.sin(an) * r; if (g.see(a.x, a.y, x, y)) best = [x, y, an, r]; }
    var s = g.stug(best[0], best[1], 'StuG 1'); s.h = best[2] + Math.PI; g.units.push(s); a.h = best[2] + 1.2;
    var see = g.see(a.x, a.y, s.x, s.y); step(40);
    return { range: best[3], lineOfSight: see, able: a.hp, ableDmg: a.dmg, ableFacingOff: +(Math.abs(Math.atan2(Math.sin(a.h - best[2]), Math.cos(a.h - best[2])))).toFixed(2), stug: s.hp, stugAp: s.ap, stugSeen: g.clock() - s.seenT < 2, stugDmg: s.dmg, log: g.log().slice(-8) };`, true);
  // a bazooka in ambush 50 m off a StuG's flank
  await scene('flank', 'time=day', `
    var bz = g.units.filter(function (u) { return u.role === 'bazooka'; })[0], mate = g.units.filter(function (u) { return u.squad === 'Bazooka' && u !== bz; })[0];
    g.units.forEach(function (u) { if (u.side === 'axis') u.hp = 0; if (u.model === 'sherman') u.gone = true; });
    var s = null, best = null;
    for (var a = 0; a < 6.28 && !best; a += 0.2) { var x = bz.x + Math.cos(a) * 50, y = bz.y + Math.sin(a) * 50; if (g.see(bz.x, bz.y, x, y)) best = [x, y, a]; }
    s = g.stug(best[0], best[1], 'StuG 1'); s.h = best[2] + Math.PI / 2; s.ap = 0; s.he = 0; g.units.push(s);
    bz.hold = true; mate.hold = true; step(30);
    var q = g.proj(s.x, s.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
    return { stugHp: s.hp, rockets: bz.rockets, dmg: s.dmg, bazookaKills: bz.kills, crewOut: g.units.filter(function (u) { return u.squad === 'StuG 1'; }).length, bzPinned: bz.pinned, bzSupp: Math.round(bz.supp), mate: mate.hp, log: g.log().slice(-8) };`, true);
  // Bloody Gulch on Normal, nobody given orders, seven and a half minutes
  if (process.env.QUICK) { console.log('errors', errs.length ? errs : 'none'); await b.close(); srv.close(); return; }
  await scene('gulch', 'm=gulch&diff=normal&time=day', `
    step(450);
    var st = g.units.filter(function (u) { return u.model === 'stug'; });
    return { stugs: st.length, alive: st.filter(function (u) { return u.hp > 0; }).length, where: st.map(function (u) { return Math.round(u.x) + ',' + Math.round(u.y) + ' hp' + u.hp + ' ap' + u.ap + ' he' + u.he; }),
      shermans: g.units.filter(function (u) { return u.model === 'sherman'; }).map(function (u) { return u.hp; }), over: document.getElementById('end').style.display };`, true);
  console.log('errors', errs.length ? errs : 'none'); await b.close(); srv.close();
})();
