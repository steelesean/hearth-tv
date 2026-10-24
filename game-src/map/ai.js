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
    await p.screenshot({ path: path.join(__dirname, 'ai-' + name + '.png') });
    console.log(name, JSON.stringify(out)); await p.close();
  }
  await scene('gegenstoss', 'day', `
    var o = g.objs()[0], sq = g.units.filter(function (u) { return u.squad === '1st Squad'; });
    g.units.filter(function (u) { return u.side === 'axis' && Math.sqrt((u.x-o.x)*(u.x-o.x)+(u.y-o.y)*(u.y-o.y)) < 40; }).forEach(function (u) { u.x -= 70; u.y -= 30; u.path = null; });
    sq.forEach(function (u, i) { u.x = o.x + (i % 4) * 2; u.y = o.y + Math.floor(i / 4) * 2; u.path = null; });
    step(30);
    var att = g.units.filter(function (u) { return u.side === 'axis' && u.goal && Math.sqrt((u.goal.x-o.x)*(u.goal.x-o.x)+(u.goal.y-o.y)*(u.goal.y-o.y)) < 20; });
    return { farm: o.owner, counterAttackers: att.length, flanking: att.filter(function (u) { return u.via; }).length, radio: window.__radio.slice(-2) };`);
  await scene('mgmove', 'day', `
    var mg = g.units.filter(function (u) { return u.role === 'mg'; })[0], x0 = mg.x, y0 = mg.y; step(1);
    window.__game.units.push; // no-op
    var b = g.units[0]; g.callArty(mg.x + 3, mg.y, 'he'); step(30);
    return { moved: Math.round(Math.sqrt((mg.x-x0)*(mg.x-x0)+(mg.y-y0)*(mg.y-y0))), alive: mg.hp > 0, setup: Math.round(mg.setup || 0) };`);
  await scene('conceal', 'day', `
    var a = g.units.filter(function (u) { return u.squad === '1st Squad'; })[0], s = g.units.filter(function (u) { return u.side === 'axis' && u.role === 'rifle'; })[0];
    var still = g.spot(a, s); s.path = [[s.x + 10, s.y]]; var moving = g.spot(a, s); s.path = null; s.lastFired = g.clock(); var firing = g.spot(a, s);
    return { stillOrCover: Math.round(still), moving: Math.round(moving), firing: Math.round(firing) };`);
  await scene('ambush', 'day', `
    g.units.forEach(function (u) { if (u.squad === 'Bazooka') u.gone = true; });   // only 1st Squad shooting
    var sq = g.units.filter(function (u) { return u.squad === '1st Squad'; }); g.select(sq); g.doCommand('hold');
    var s = g.units.filter(function (u) { return u.side === 'axis' && u.role === 'rifle'; })[0];
    // a German walks straight at them across the open
    var m = sq[0]; s.x = m.x + 90; s.y = m.y; s.engaged = true; s.goal = { x: m.x, y: m.y }; g.order(s, m.x, m.y);
    var firstShot = null, d0 = null; for (var i = 0; i < 600 && firstShot === null; i++) { g.update(0.05); if (sq.some(function (u) { return u.fired > 0; })) { firstShot = Math.round(Math.sqrt((s.x-m.x)*(s.x-m.x)+(s.y-m.y)*(s.y-m.y))); } }
    return { firedAtRange: firstShot, holding: sq.filter(function (u) { return u.hold; }).length, germanAlive: s.hp > 0 };`);
  await scene('friction', 'day', `
    var sq = g.units.filter(function (u) { return u.squad === '1st Squad'; }), nco = sq.filter(function (u) { return u.role === 'nco'; })[0];
    g.select(sq); g.orderGroup(sq, sq[0].x - 20, sq[0].y); var withSgt = Math.round((sq[1].orderWait - g.clock()) * 10) / 10;
    step(3); nco.hp = 0; var rest = sq.filter(function (u) { return u.hp > 0; }); g.orderGroup(rest, rest[0].x + 20, rest[0].y); var without = Math.round((rest[0].orderWait - g.clock()) * 10) / 10;
    return { delayWithSergeant: withSgt, delayWithout: without };`);
  await scene('resupply', 'day', `
    var t = g.units[0], r = g.rally(); t.he = 4; g.order(t, r.x, r.y); step(60);
    return { he: t.he, distToRally: Math.round(Math.sqrt((t.x-r.x)*(t.x-r.x)+(t.y-r.y)*(t.y-r.y))) };`);
  await scene('facing', 'day', `
    var t = g.units[0], o = g.units[1]; o.x += 300;
    var s = g.units.filter(function (u) { return u.side === 'axis' && u.role === 'rifle'; })[0];
    var ang = function () { return Math.round(Math.abs(Math.atan2(Math.sin(Math.atan2(s.y - t.y, s.x - t.x) - t.h), Math.cos(Math.atan2(s.y - t.y, s.x - t.x) - t.h))) * 57); };
    // a German 80 m off to the tank's side, in plain view: does it swing to face him?
    s.x = t.x + Math.cos(t.h + 1.6) * 80; s.y = t.y + Math.sin(t.h + 1.6) * 80; s.path = null;
    var before = ang(); for (var i = 0; i < 100; i++) { s.seenT = g.clock(); s.hp = 100; g.update(0.05); } var after = ang();
    // drive 40 m towards the farm, meet a German dead ahead, and back off to where it started
    var sx = t.x, sy = t.y; s.x += 500; g.order(t, -193, 93); for (var k = 0; k < 160; k++) g.update(0.05); t.path = null;
    s.x = t.x + Math.cos(t.h) * 90; s.y = t.y + Math.sin(t.h) * 90; for (var k2 = 0; k2 < 20; k2++) { s.seenT = g.clock(); g.update(0.05); }
    g.order(t, sx, sy); var rev = false, worst = 0, log = [];
    for (var j = 0; j < 200; j++) { s.seenT = g.clock(); s.hp = 100; g.update(0.05); if (t.reversing) rev = true; worst = Math.max(worst, ang()); if (j % 20 === 0) log.push(ang() + (t.reversing ? 'R' : '') + (t.path ? 'p' + t.path.length : '')); }
    return { log: log.join(' '), reversedAway: rev, worst: worst };`);
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
