// The German commander: each forced plan sets up sensibly; random plans vary; intelligence is written; the
// counter-attack follows the plan; the reserve commits; the plan is revealed after the battle.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), errs = [], port = srv.address().port;
  async function run(q, js) {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } }); p.on('pageerror', (e) => errs.push(q + ': ' + e.message));
    await p.goto(`http://localhost:${port}/game/?${q}&quiet=1`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(500);
    const r = await p.evaluate(`(function(){ var g = window.__game, step = function (s) { for (var i = 0; i < s * 20; i++) g.update(0.05); }; ${js} })()`);
    return { p, r };
  }
  const setup = `var P = g.plan(), ax = g.units.filter(function (u) { return u.side === 'axis' && u.hp > 0; }), o = g.objs();
    var near = function (pt) { return ax.filter(function (u) { return Math.hypot(u.x - pt.x, u.y - pt.y) < 30; }).length; };
    return { posture: P.posture, mg: P.mg, reserve: P.reserve, axis: P.axis, tempo: P.tempo, feint: P.feint, armour: P.armour, germans: ax.length,
      atFarm: near(o[0]), atXroads: near(o[1]), mgNear: g.units.filter(function (u) { return u.role === 'mg'; }).map(function (u) { return Math.round(Math.hypot(u.x - o[0].x, u.y - o[0].y)) + 'm from farm'; })[0],
      stug: g.units.filter(function (u) { return u.model === 'stug'; }).map(function (u) { return Math.round(u.x) + ',' + Math.round(u.y) + (u.dugIn ? ' dug in' : ''); }), intel: g.intel().length };`;
  for (const plan of ['farm', 'forward', 'depth', 'mg-farm,reserve,overwatch', 'mg-crossroads,noreserve,counter']) {
    const { p, r } = await run('time=day&diff=normal&plan=' + plan, setup); console.log('plan=' + plan, JSON.stringify(r)); await p.close(); }
  // variety: ten random plans
  const seen = {};
  for (let i = 0; i < 10; i++) { const { p, r } = await run('time=day&diff=normal', setup); seen[[r.posture, r.mg, r.reserve, r.axis, r.tempo, r.feint ? 'feint' : '', r.armour].join(' ')] = 1; await p.close(); }
  console.log('distinct plans in 10 games:', Object.keys(seen).length, Object.keys(seen));
  // the counter-attack follows the plan: forced north, echelon; and the reserve commits when a point falls
  { const { p, r } = await run('time=day&diff=hard&plan=north,echelon,reserve,feint', `
      var o = g.objs(), P = g.plan(); g.units.forEach(function (u) { if (u.side === 'axis' && Math.hypot(u.x - o[0].x, u.y - o[0].y) < 70 && !u.reserve) u.hp = 0; });
      var sq = g.units.filter(function (u) { return u.squad === '1st Squad'; }); sq.forEach(function (u) { u.x = o[0].x + (Math.random() - .5) * 6; u.y = o[0].y + (Math.random() - .5) * 6; u.path = null; });
      step(30); var reserveMoving = g.units.filter(function (u) { return u.squad === 'Gruppe 3' && u.path; }).length;
      step(600);
      var c = g.units.filter(function (u) { return /^Gruppe [567]$/.test(u.squad); }), f = g.units.filter(function (u) { return u.squad === 'Gruppe 8'; });
      return { farm: o[0].owner, phase: g.phase(), reserveMoving: reserveMoving, counterSquads: [...new Set(c.map(function (u) { return u.squad; }))], entry: P.entries.north && [Math.round(P.entries.north.x), Math.round(P.entries.north.y)], feintMen: f.length,
        log: P.log, reveal: g.planReveal(), radio: g.log().filter(function (l) { return /More Germans|pulling back/.test(l); }) };`); console.log('counter', JSON.stringify(r, null, 1)); await p.close(); }
  // the start screen shows the file; the Intel button opens it; Bloody Gulch gets a plan too
  { const { p, r } = await run('m=gulch&diff=normal', `return { main: g.plan().main, intel: g.intel().map(function (x) { return x.text; }) };`);
    const start = await p.evaluate(() => document.getElementById('intelStart').innerText.slice(0, 400)); console.log('gulch', JSON.stringify(r), '\nstart screen:', start); await p.close(); }
  { const { p } = await run('time=day', `return 1;`); await p.click('#res button[data-cmd="intel"]'); await p.waitForTimeout(300);
    console.log('intel box open:', await p.evaluate(() => getComputedStyle(document.getElementById('intel')).display), await p.evaluate(() => document.getElementById('intel').innerText.slice(0, 600)));
    await p.screenshot({ path: path.join(__dirname, 'cmd-intel.png') }); await p.close(); }
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
