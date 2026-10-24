// Plays the whole mission with scripted orders and reports each stage, with screenshots.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, 'game'), PRE = process.env.SHOTS || 'ms';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/game/, ''); const f = path.join(root, u === '/' ? 'index.html' : u); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); r.end(b); }); }).listen(0);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${srv.address().port}/game/?time=${process.env.TIME || "day"}&quiet=1&diff=${process.env.DIFF || "normal"}`); await p.waitForFunction(() => window.__game, null, { timeout: 30000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const g = window.__game;
    window.T = { g, step: (s) => { for (let i = 0; i < s * 20 && !document.getElementById('end').style.display.includes('flex'); i++) g.update(0.05); },
      tanks: () => g.units.filter((u) => u.kind === 'tank' && u.side === 'allies'), sq: (n) => g.units.filter((u) => u.squad === n && u.hp > 0 && !u.gone),
      look: (x, y) => { const q = g.proj(x, y, 0); g.view.x = q[0] - 960; g.view.y = q[1] - 540; },
      state: () => ({ t: Math.round(g.clock()), phase: g.phase(), objs: g.objs().map((o) => o.label + ':' + (o.owner || '-') + ':' + o.prog.toFixed(2)),
        tanks: T.tanks().map((u) => u.name + ':' + Math.max(0, Math.round(u.hp))), sq1: T.sq('1st Squad').length, sq2: T.sq('2nd Squad').length,
        axis: g.units.filter((u) => u.side === 'axis' && u.hp > 0 && !u.gone).length, riders: T.tanks().map((t) => g.riders(t).length), stug: g.units.filter((u) => u.model === 'stug').map((u) => Math.round(u.hp) + ' ap' + u.ap + ' kills' + u.kills + ' @' + Math.round(u.x) + ',' + Math.round(u.y)), paras: g.strays().map((x) => x.kind + (x.found ? '+' : '')), plan: (() => { const P = g.plan(); return P && [P.posture, P.mg, P.reserve, P.axis, P.tempo, P.feint ? 'feint' : '', P.armour].join(' '); })() }) };
  });
  const stage = async (label, js) => {
    const st = await p.evaluate('(function(){ try { return ' + js + '; } catch (e) { return { err: e.stack }; } })()'); console.log(label, JSON.stringify(st));
    await p.evaluate(() => { document.getElementById('end').style.display === 'flex' || window.__game.draw(); window.__game.draw(); });
    await p.waitForTimeout(600); await p.screenshot({ path: path.join(__dirname, PRE + '-' + label + '.png') });
  };
  if (process.env.STRAT === 'careful') {
  await stage('c1-shell', `(function(){ var g = T.g, ts = T.tanks(), o = g.objs()[0], s = T.sq('1st Squad');
      var dx = ts[0].x - o.x, dy = ts[0].y - o.y, l = Math.sqrt(dx*dx+dy*dy); g.orderGroup(ts, o.x + dx/l*70, o.y + dy/l*70);
      g.orderGroup(s, o.x + dx/l*95, o.y + dy/l*95); T.step(75); T.look(o.x, o.y); return T.state(); })()`);
  await stage('c2-farm', `(function(){ var g = T.g, o = g.objs()[0], s = T.sq('1st Squad'), ts = T.tanks(); g.orderGroup(ts, o.x + 15, o.y + 25); T.step(10); g.orderGroup(s, o.x, o.y); T.step(60); T.look(o.x, o.y); return T.state(); })()`);
  await stage('c3-cross', `(function(){ var g = T.g, x = g.objs()[1], o = g.objs()[0], s = T.sq('1st Squad'), ts = T.tanks();
      g.callArty(x.x, x.y, 'he'); g.select(ts); var dx = o.x - x.x, dy = o.y - x.y, l = Math.sqrt(dx*dx+dy*dy);
      g.orderGroup(ts, x.x + dx/l*70, x.y + dy/l*70); T.step(30); g.callArty(x.x + dx/l*30, x.y + dy/l*30, 'smoke');
      g.orderGroup(s, x.x + dx/l*45, x.y + dy/l*45); T.step(60); s = T.sq('1st Squad'); s.forEach(function(m){ m.assault = true; }); g.orderGroup(s, x.x, x.y); T.step(70); T.look(x.x, x.y); return T.state(); })()`);
  await stage('c4-hold', `(function(){ var g = T.g, o = g.objs()[0], x = g.objs()[1]; T.step(Math.max(0, 500 - g.clock())); var s2 = T.sq('2nd Squad'); if (s2.length) g.orderGroup(s2, o.x, o.y);
      T.step(140); T.look(x.x + 50, x.y - 30); return T.state(); })()`);
  await stage('c5-end', `(function(){ var g = T.g; T.step(300); return Object.assign(T.state(), { end: document.getElementById('endTitle').textContent + ' / ' + document.getElementById('endText').textContent }); })()`);
  } else {
  await stage('1-mount', `(function(){ var g = T.g, s = T.sq('1st Squad'); g.select(s); g.mount(s); T.step(10); var a = T.tanks()[0]; T.look(a.x, a.y); g.select([a]); return T.state(); })()`);
  await stage('2-ride', `(function(){ var g = T.g, ts = T.tanks(), o = g.objs()[0]; g.orderGroup(ts, o.x + 25, o.y + 30); T.step(25); T.look(ts[0].x, ts[0].y); return T.state(); })()`);
  await stage('3-farm', `(function(){ var g = T.g, s = T.sq('1st Squad'), o = g.objs()[0]; g.select(s); g.doCommand('ride'); T.step(1); g.orderGroup(s, o.x, o.y); T.step(40); T.look(o.x, o.y); return T.state(); })()`);
  await stage('4-arty', `(function(){ var g = T.g, x = g.objs()[1], s = T.sq('1st Squad'), ts = T.tanks();
      g.orderGroup(ts, x.x - 60, x.y + 40); T.step(30); g.callArty(x.x, x.y, 'he'); T.step(24); T.look(x.x, x.y); return T.state(); })()`);
  await stage('5-cross', `(function(){ var g = T.g, x = g.objs()[1], s = T.sq('1st Squad'), ts = T.tanks();
      g.orderGroup(ts, x.x - 20, x.y + 10); g.orderGroup(s, x.x, x.y); T.step(150); T.look(x.x, x.y); return T.state(); })()`);
  await stage('6-counter', `(function(){ var g = T.g; T.step(Math.max(0, 1) * 60); var x = g.objs()[1]; T.look(x.x + 60, x.y - 40); return T.state(); })()`);
  await stage('7-hold', `(function(){ var g = T.g; var s2 = T.sq('2nd Squad'), o = g.objs()[0]; if (s2.length) g.orderGroup(s2, o.x, o.y); T.step(420); return Object.assign(T.state(), { end: document.getElementById('endTitle').textContent + ' / ' + document.getElementById('endText').textContent }); })()`);
  }
  const radio = await p.evaluate(() => window.__radio);
  console.log('radio:\n  ' + radio.join('\n  '));
  console.log('errors:', errs.join(' | ') || 'none'); await b.close(); srv.close();
})();
