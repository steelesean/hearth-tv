
  // ------------------------------------------------------------------ the panels
  function moraleWord(men) {
    var m = 0; men.forEach(function (u) { m += u.morale / men.length; });
    return men.some(function (u) { return u.broken; }) ? 'broken' : m > 60 ? 'steady' : m > 38 ? 'shaken' : 'close to breaking';
  }

  function doCommand(c) {
    var sel = selected.filter(alive), ts = sel.filter(isTank), men = sel.filter(function (u) { return !isTank(u); });
    if (c === 'smoke') command = command === 'smoke' || !ts.length ? null : 'smoke';
    else if (c === 'area') command = command === 'area' || !sel.length ? null : 'area';
    else if (c === 'arty') command = command === 'arty' ? null : 'arty';
    else if (c === 'artysmoke') command = command === 'artysmoke' ? null : 'artysmoke';
    else if (c === 'pause') paused = !paused;
    else if (c === 'speed') { gameSpeed = gameSpeed === 1 ? 2 : 1; say(gameSpeed === 2 ? 'Double speed.' : 'Normal speed.'); }
    else if (c === 'hold' && men.length) {
      var hv = !men[0].hold; men.forEach(function (m) { m.hold = hv; if (hv) m.path = null; });
      say(squadName(men[0]) + (hv ? ': ambush. Holding fire until they’re within 40 m.' : ': fire at will.'));
    }
    else if (c === 'log') toggleBox('log');
    else if (c === 'helpov' || c === 'help') toggleBox('helpov');
    else if (c === 'ride') {
      var tr = ts.filter(function (t) { return riders(t).length; });
      if (men.length && men[0].riding) { men.forEach(function (m) { dismount(m, false); }); say(squadName(men[0]) + ' off the tank.'); }
      else if (men.length && men[0].role !== 'crew') mount(men.filter(function (m) { return !m.broken; }));
      else if (tr.length) tr.forEach(function (t) { riders(t).forEach(function (m) { dismount(m, false); }); say('Riders off ' + t.name + '.'); });
    }
    else if (c === 'demo') command = command === 'demo' || !men.some(function (u) { return u.kit === 'us'; }) ? null : 'demo';
    else if (c === 'crash' && ts.length) {
      var cr = !ts[0].crash; ts.forEach(function (t) { t.crash = cr; });
      say(cr ? ts.map(function (t) { return t.name; }).join(' and ') + ' will crash through hedges where it saves a long way round. Slow, no firing, and the belly is exposed.' : 'Keeping to the gaps.');
    }
    else if (c === 'he' && ts.length) {
      var m = ts[0].heMode === 'auto' ? 'hold' : 'auto'; ts.forEach(function (t) { t.heMode = m; });
      say(m === 'hold' ? 'Holding HE: machine guns only, unless you give them a target.' : 'HE: fire at will.');
    } else if (c === 'halt') sel.forEach(function (u) { if (!u.broken) { u.path = null; u.assault = false; } });
    else if (c === 'assault' && men.length && men[0].role !== 'crew') {
      var on = !men[0].assault; men.forEach(function (u) { u.assault = on; });
      say(squadName(men[0]) + (on ? ': assault. The next move goes in at the run, firing.' : ': steady advance.'));
    } else if (c === 'retreat' && men.length) {
      men.forEach(function (u) { u.retreating = true; u.assault = false; order(u, RALLY.x + (Math.random() - .5) * 10, RALLY.y + (Math.random() - .5) * 10); });
    } else if (c === 'mute') sound.toggle();
  }

  // ------------------------------------------------------------------ input: select, order, target, scroll
  var drag = null, keys = {};
  function toCanvas(e) { var b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * VW / b.width, (e.clientY - b.top) * VH / b.height]; }
  function unitAt(px, py) {
    var best = null, bd = 1e9;
    units.forEach(function (u) {
      if (u.side !== 'allies' || !alive(u) || u.riding || u.stray) return;
      var p = proj(u.x, u.y, isTank(u) ? 1 : 0.9), d = Math.sqrt((p[0] - view.x - px) * (p[0] - view.x - px) + (p[1] - view.y - py) * (p[1] - view.y - py));
      if (d < (isTank(u) ? 40 : 18) && d < bd) { bd = d; best = u; }
    });
    return best;
  }
  function enemyAt(px, py) {
    var best = null, bd = 20;
    units.forEach(function (u) {
      if (u.side !== 'axis' || !alive(u) || clock - u.seenT > 1.5) return;
      var p = proj(u.x, u.y, 0.9), d = Math.sqrt((p[0] - view.x - px) * (p[0] - view.x - px) + (p[1] - view.y - py) * (p[1] - view.y - py));
      if (d < bd) { bd = d; best = u; }
    });
    return best;
  }
  cv.addEventListener('contextmenu', function (e) {
    // right-click: the command wheel for whatever's selected, at that spot
    e.preventDefault(); if (!started || over) return;
    if (remote.menu) { remote.menu = null; return; }
    var p = toCanvas(e); remote.x = p[0]; remote.y = p[1]; remoteOk();
  });
  cv.addEventListener('mousedown', function (e) {
    if (e.button === 2 || e.ctrlKey) return;   // Control-click on a Mac is a right-click: the wheel, not a move order
    if (remote.menu && !remote.menu.pause) {
      var m = remote.menu, i = wheelPick(m, toCanvas(e)[0], toCanvas(e)[1]); remote.menu = null;
      if (i >= 0) m.items[i].run();
      return;
    }
    var p = toCanvas(e); drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], vx: view.x, vy: view.y, moved: false, box: e.shiftKey }; });
  window.addEventListener('mousemove', function (e) {
    var p = toCanvas(e); hover = p;
    if (remote.menu && !remote.menu.pause) { var wi = wheelPick(remote.menu, p[0], p[1]); if (wi >= 0) remote.menu.i = wi; }
    if (!drag) return; drag.x1 = p[0]; drag.y1 = p[1];
    if (Math.abs(p[0] - drag.x0) + Math.abs(p[1] - drag.y0) > 8) drag.moved = true;
    if (drag.moved && !drag.box && !unitAt(drag.x0, drag.y0)) { view.x = drag.vx - (p[0] - drag.x0); view.y = drag.vy - (p[1] - drag.y0); clampView(); }
    else if (drag.moved && unitAt(drag.x0, drag.y0)) drag.box = true;
  });
  window.addEventListener('mouseup', function () {
    if (!drag || !started) { drag = null; return; }
    var d = drag; drag = null;
    if (d.box && d.moved) {
      var x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      var inBox = units.filter(function (u) { if (u.side !== 'allies' || !alive(u) || u.stray) return false; var p = proj(u.x, u.y, 1); return p[0] - view.x > x0 && p[0] - view.x < x1 && p[1] - view.y > y0 && p[1] - view.y < y1; });
      if (inBox.length) { selected = inBox; command = null; }
      return;
    }
    if (d.moved) return;
    if (command) {
      var gs = unproj(d.x0 + view.x, d.y0 + view.y), cmd = command; command = null;
      if (cmd === 'smoke') fireSmoke(gs[0], gs[1]);
      else if (cmd === 'demo') plantCharge(gs[0], gs[1]);
      else if (cmd === 'area') areaAt(gs[0], gs[1]);
      else if (cmd === 'arty') callArty(gs[0], gs[1], 'he');
      else if (cmd === 'artysmoke') callArty(gs[0], gs[1], 'smoke');
      return;
    }
    var u = unitAt(d.x0, d.y0);
    if (u) { selected = isTank(u) ? [u] : squadOf(u); return; }
    var foe = enemyAt(d.x0, d.y0);
    if (foe && selected.length) {
      selected.forEach(function (s) { if (alive(s)) s.target = foe; });
      say('Target marked. ' + (selected.some(isTank) ? 'HE on him as soon as they can see him.' : 'Concentrating fire on him.'));
      return;
    }
    if (selected.length) { var g = unproj(d.x0 + view.x, d.y0 + view.y); orderGroup(selected.filter(alive), g[0], g[1]); }
  });
  window.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = 1;
    if (!started) return;
    if (k === 'f') doCommand('smoke'); else if (k === 'h') doCommand('he'); else if (k === ' ') { doCommand('halt'); e.preventDefault(); }
    else if (k === 'g') doCommand('assault'); else if (k === 'r') doCommand('retreat'); else if (k === 'm') doCommand('mute');
    else if (k === 't') doCommand('area'); else if (k === 'b') doCommand('demo'); else if (k === 'c') doCommand('crash');
    else if (k === 'x') doCommand('hold'); else if (k === '=' || k === '+') doCommand('speed');
    else if (k === 'v') doCommand('arty'); else if (k === 'n') doCommand('artysmoke'); else if (k === 'u') doCommand('ride'); else if (k === 'p') doCommand('pause');
    else if (k === 'Escape') { command = null; if (remote.menu) { if (remote.menu.pause) paused = false; remote.menu = null; } }
    else if (k === 'i') showIntel();
    else if (k === 'l') doCommand('log'); else if (k === '?' || k === '/') doCommand('helpov');
  });
  window.addEventListener('keyup', function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = 0; });
  function clampView() { view.x = Math.max(0, Math.min(CAM.W - VW, view.x)); view.y = Math.max(0, Math.min(CAM.H - VH, view.y)); }

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    var sp = 900 * dt;
    if (keys.ArrowLeft || keys.a) view.x -= sp; if (keys.ArrowRight || keys.d) view.x += sp;
    if (keys.ArrowUp || keys.w) view.y -= sp; if (keys.ArrowDown || keys.s) view.y += sp;
    clampView();
    if (started && !over && !paused) for (var sp2 = 0; sp2 < gameSpeed; sp2++) update(dt);   // double speed: two steps a frame
    units.forEach(function (u) { if (isTank(u)) sound.engine(u); });
    draw(); panel();
    requestAnimationFrame(frame);
  }
  function end(t, s, won) { over = true; document.getElementById('endTitle').textContent = t; document.getElementById('endText').textContent = s; document.getElementById('end').style.display = 'flex'; debrief(!!won); }

  // ------------------------------------------------------------------ start
  function begin(t) {
    TIME = t === 'mist' || t === 'dusk' ? t : 'day'; started = true;
    DIFF = DIFFS[params.diff || prefs.difficulty] || DIFFS.normal; arty = { he: DIFF.arty[0], smoke: DIFF.arty[1] };
    units.forEach(function (u) { if (u.side === 'axis') { u.heart = Math.max(30, u.heart + DIFF.heart); u.morale = u.heart; } });
    document.getElementById('start').style.display = 'none';
    sound.start();
    say(MISSION.intro[TIME]);
    if (!prefs.seenHelp && !params.quiet) { prefs.seenHelp = true; savePrefs(); toggleBox('helpov'); }   // the first game: how to play
    tracker.start();
  }
  Promise.all([get(MAPP + 'level.json'), get('camera.json'), get('sprites.json'), get(MAPP + 'tiles/tiles.json'), maybe(MAPP + 'tiles_dusk/tiles.json'), image('sherman.png'), image('stug.png')]).then(function (r) {
    LEVEL = r[0]; CAM = r[1]; SPR = r[2]; TILES = r[3]; TILES_DUSK = r[4]; imgTank = r[5]; imgStug = r[6];
    return Promise.all(Object.keys(SPR.kits).map(function (k) { return image(SPR.kits[k]).then(function (im) { sheets[k] = im; }); }));
  }).then(function () {
    G = LEVEL.size; CELL = LEVEL.cell; HALF = LEVEL.world / 2;
    // the ground: 0 open, 1 hedgerow, 2 building (3 will be a wreck). tankgrid: where a 3 m-wide Sherman fits, measured at 1 m.
    kindGrid = new Uint8Array(G * G); block = new Uint8Array(G * G); hedgeCell = new Uint8Array(G * G); tankBlock = new Uint8Array(G * G); tankSoft = new Uint8Array(G * G);
    for (var i = 0; i < G * G; i++) { kindGrid[i] = LEVEL.grid.charCodeAt(i) - 48; block[i] = kindGrid[i] ? 1 : 0; hedgeCell[i] = kindGrid[i] === 1 ? 1 : 0; tankBlock[i] = LEVEL.tankgrid.charCodeAt(i) === 49 ? 1 : 0; }
    // a tank can crash through what's only blocked by hedge: anywhere not within 4 m of a building
    for (var rr = 0; rr < G; rr++) for (var cc = 0; cc < G; cc++) {
      if (!tankBlock[rr * G + cc]) continue;
      var bld = 0; for (var dr = -2; dr <= 2 && !bld; dr++) for (var dc = -2; dc <= 2 && !bld; dc++) { var r2 = rr + dr, c2 = cc + dc; if (r2 >= 0 && c2 >= 0 && r2 < G && c2 < G && kindGrid[r2 * G + c2] === 2) bld = 1; }
      tankSoft[rr * G + cc] = bld ? 0 : 1;
    }
    MISSION.setup();
    for (var q = 0; q < 80; q++) mistPatches.push({ x: (Math.random() - .5) * 760, y: (Math.random() - .5) * 760, r: 18 + Math.random() * 30 });
    document.getElementById('loading').style.display = 'none';
    window.__game = { clock: function () { return clock; }, units: units, update: update, draw: function () { draw(); }, order: order, orderGroup: orderGroup,
      proj: proj, view: view, selected: function () { return selected; }, select: function (l) { selected = l; }, fireSmoke: fireSmoke, doCommand: doCommand,
      begin: begin, tally: tally, end: end, mission: function () { return MISSION.id; }, roster: function () { return ROSTER; }, see: seeLine, spot: spotRange, hitTank: hitTank, knockOut: knockOut, objs: function () { return OBJS; }, phase: function () { return phase; }, callArty: callArty, mount: mount, riders: riders, remoteKey: function (k) { window.hearthKey(k); }, remote: remote, paused: function () { return paused; }, breach: breach, plantCharge: plantCharge, grid: function () { return { block: block, tank: tankBlock, kind: kindGrid }; }, hear: hear, log: function () { return log; }, plan: function () { return PLAN; }, intel: function () { return INTEL; }, intelHTML: intelHTML, planReveal: planReveal, strays: function () { return STRAYS; }, groups: function () { return groupsOfMine(); }, stug: stug, spawnStug: spawnStug, armour: armour, sight: sightRange, rally: function () { return RALLY; }, clouds: function () { return clouds; }, heard: function () { return heard; } };
    if (params.time) begin(params.time);
    else if (params.go) startGame();
    else { startScreen(); document.getElementById('start').style.display = 'flex'; }
    requestAnimationFrame(frame);
  });
  function showDiff() { [].forEach.call(document.querySelectorAll('#start button[data-diff]'), function (b) { b.className = b.getAttribute('data-diff') === (prefs.difficulty || 'normal') ? 'pick' : ''; }); }
  [].forEach.call(document.querySelectorAll('#start button[data-diff]'), function (b) {
    b.addEventListener('click', function () { prefs.difficulty = b.getAttribute('data-diff'); savePrefs(); DIFF = DIFFS[prefs.difficulty]; showDiff(); });
  });
  showDiff();
})();
