// Sets up particular moments and screenshots each: a smoke screen, a knocked-out Sherman with its crew bailing out,
// a damaged tank, gunfire heard but not seen.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
const step = (secs) => { const g = window.__game; for (let i = 0; i < secs * 20; i++) g.update(0.05); };
(async () => {
  const port = srv.address().port, b = await chromium.launch();
  const errs = [];
  async function scene(name, time, setup) {
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(`http://localhost:${port}/game/?time=${time}&quiet=1&plan=farm,mg-crossroads,noreserve,noarmour,centre,massed,nofeint`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1200);
    const out = await p.evaluate(`(function(){ var step = ${step.toString()}; var g = window.__game; ${setup} })()`);
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__game.draw());
    await p.screenshot({ path: path.join(__dirname, 'f-' + name + '.png') });
    console.log(name, JSON.stringify(out)); await p.close();
  }
  // smoke: Able fires a smoke bomb 70 m towards the farm; does it block the line of sight?
  await scene('smoke', 'day', `
    var t = g.units[0], dir = null;
    for (var a = 0; a < 6.28 && !dir; a += 0.1) if (g.see(t.x, t.y, t.x + Math.cos(a) * 110, t.y + Math.sin(a) * 110)) dir = a;
    if (dir === null) return { noClearLine: true };
    var ex = t.x + Math.cos(dir) * 110, ey = t.y + Math.sin(dir) * 110, x = t.x + Math.cos(dir) * 60, y = t.y + Math.sin(dir) * 60;
    var before = g.see(t.x, t.y, ex, ey);
    g.select([t]); g.fireSmoke(x, y); step(7);
    var after = g.see(t.x, t.y, ex, ey);
    var q = g.proj(x, y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
    return { clearBefore: before, clearAfter: after, smokeLeft: t.smoke };`);
  // a knock-out from the side: crew bail and run, the wreck burns
  await scene('bailout', 'day', `
    var t = g.units[1]; g.knockOut(t, 'side'); step(6);
    var crew = g.units.filter(function (u) { return u.role === 'crew'; });
    var q = g.proj(t.x, t.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
    g.select(crew.filter(function (u) { return u.hp > 0; }));
    return { crewOut: crew.length, running: crew.filter(function (u) { return u.state === 'retreat'; }).length, tally: g.tally };`);
  await scene('rescue', 'day', `
    var t = g.units[1]; g.knockOut(t, 'front'); step(40);
    return { tally: g.tally, radio: window.__radio.slice(-3) };`);
  // two hits that don't kill: what breaks?
  await scene('damage', 'day', `
    var t = g.units[0], from = { x: t.x + Math.cos(t.h) * 30, y: t.y + Math.sin(t.h) * 30 };
    g.hitTank(t, from); g.hitTank(t, { x: t.x - Math.sin(t.h) * 30, y: t.y + Math.cos(t.h) * 30 });
    step(1); var q = g.proj(t.x, t.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; g.select([t]);
    return { hp: t.hp, dmg: t.dmg, radio: window.__radio.slice(-2) };`);
  // heard, not seen: a German fires from behind a hedge
  await scene('heard', 'day', `
    var s = g.units.filter(function (u) { return u.side === 'axis'; })[0]; s.seenT = -99;
    g.hear(s, 'rifle'); g.hear(s, 'pf'); step(0.6);
    var q = g.proj(s.x, s.y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
    return { heard: g.heard().length, radio: window.__radio.slice(-2) };`);
  await scene('mg42', 'day', `
    var mg = g.units.filter(function (u) { return u.role === 'mg'; })[0], sq = g.units.filter(function (u) { return u.squad === '1st Squad'; });
    var spot = null;
    for (var d = 70; d > 30 && !spot; d -= 5) for (var a = -0.6; a <= 0.6 && !spot; a += 0.1) { var x = mg.x + Math.cos(mg.h + a) * d, y = mg.y + Math.sin(mg.h + a) * d; if (g.see(mg.x, mg.y, x, y)) spot = [x, y]; }
    if (!spot) return { noSpot: true };
    sq.forEach(function (u, i) { u.x = spot[0] + (i % 4) * 2.5; u.y = spot[1] + Math.floor(i / 4) * 2.5; u.path = null; });
    var dbg = []; for (var i = 0; i < 200; i++) { g.update(0.05); if (i % 40 === 0) dbg.push([Math.round(mg.setup*10)/10, Math.round(mg.shot*10)/10, mg.pose, mg.state, !!mg.path, mg.retreating, sq.filter(function(u){return g.see(mg.x,mg.y,u.x,u.y);}).length, Math.round(sq[0].supp)]); }
    var q = g.proj((mg.x + spot[0]) / 2, (mg.y + spot[1]) / 2, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540;
    return { range: Math.round(Math.sqrt((mg.x-spot[0])*(mg.x-spot[0])+(mg.y-spot[1])*(mg.y-spot[1]))), pinned: sq.filter(function (u) { return u.pinned && u.hp > 0; }).length, dead: sq.filter(function (u) { return u.hp <= 0; }).length, moraleAvg: Math.round(sq.reduce(function (a, u) { return a + u.morale; }, 0) / sq.length), mgPose: mg.pose, dbg: dbg };`);
  await scene('mist', 'mist', `step(20); return { sight: Math.round(g.sight()) };`);
  await scene('dusk', 'dusk', `var ts = g.units.filter(function (u) { return u.kind === 'tank'; }); g.orderGroup(ts, -193, 93); step(30); return { sight: g.sight() };`);
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
