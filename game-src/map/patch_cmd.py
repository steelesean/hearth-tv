def P(f, a, b, n=1):
    f = f if f.startswith('game/') or f.startswith('../') or '/' in f else 'parts/' + f
    s = open(f).read(); c = s.count(a)
    assert c == n, (f, c, a[:90]); open(f, 'w').write(s.replace(a, b))
# forced-plan keys that don't collide
P('o_commander.js', "      mg: pickW({ crossroads: 1.2, farm: 1 }, f({ crossroads: 1, farm: 1 }) && f({ crossroads: 1, farm: 1 }).replace(/^/, '')),\n      reserve: pickW({ none: 1, reserve: d === 'easy' ? 0.5 : 1.2 }, f({ none: 1, reserve: 1 })),",
  "      mg: pickW({ crossroads: 1.2, farm: 1 }, f({ 'mg-crossroads': 1, 'mg-farm': 1 }) && f({ 'mg-crossroads': 1, 'mg-farm': 1 }).slice(3)),\n      reserve: pickW({ none: 1, reserve: d === 'easy' ? 0.5 : 1.2 }, f({ reserve: 1 }) ? 'reserve' : f({ noreserve: 1 }) ? 'none' : null),")
P('o_commander.js', "{ none: 0.3, counter: 0.4, overwatch: 0.3 }, f({ none: 1, counter: 1, overwatch: 1 })),",
  "{ none: 0.3, counter: 0.4, overwatch: 0.3 }, f({ noarmour: 1 }) ? 'none' : f({ counter: 1, overwatch: 1 })),")
P('build.sh'.replace('build.sh', '../map/build.sh'), 'parts/n_paras.js parts/m_hud.js', 'parts/n_paras.js parts/o_commander.js parts/m_hud.js')

# Hedgerows set-up: the commander places the Germans
P('i_mission.js', """    LEVEL.squads.slice(0, 2).forEach(function (p, si) {
      for (var k = 0; k < 5; k++) {
        var a = k * 1.26, x = p[0] + Math.cos(a) * 4, y = p[1] + Math.sin(a) * 4, c = cellOf(x, y);
        if (blocked(block, c[0], c[1])) { x = p[0]; y = p[1]; }
        units.push(soldier(x, y, 'axis', 'rifle', 'Gruppe ' + (si + 1), k < 2 ? 'pf' : k === 4 ? 'nco' : 'rifle'));
      }
    });
""", "")
P('i_mission.js', """    // the gun goes where it has the longest views up the lanes from the farm side
    var site = siteGun({ x: xw[0], y: xw[1] }, OBJ, 28);
    for (var j = 0; j < 2; j++) {
      var mc = nearestOpen(block, cellOf(site.x - Math.cos(site.h) * j * 1.8, site.y - Math.sin(site.h) * j * 1.8 + j)), mw = centre(mc[0], mc[1]);
      var gu = soldier(mw[0], mw[1], 'axis', j ? 'rifle' : 'mg42', 'MG 1', j ? 'loader' : 'mg'); gu.h = site.h; gu.setup = 3; units.push(gu);
    }
    for (var n = 0; n < 4; n++) {
      var gc = nearestOpen(block, cellOf(xw[0] + Math.cos(n * 1.6) * 8, xw[1] + Math.sin(n * 1.6) * 8)), gw = centre(gc[0], gc[1]);
      units.push(soldier(gw[0], gw[1], 'axis', 'rifle', 'Gruppe 4', n === 0 ? 'pf' : n === 3 ? 'nco' : 'rifle'));
    }
""", """    // the German commander decides how the farm and the crossroads are held
    germanHedgerows({ x: xw[0], y: xw[1] });
""")
P('i_mission.js', """  function hedgerowsUpdate(dt) {
    captureUpdate(dt);""", """  function hedgerowsUpdate(dt) {
    captureUpdate(dt);
    commanderUpdate();""")
P('i_mission.js', """  function counterAttack() {
    // two rifle squads and an MG42 team come in along the lane from the east; 2nd Squad comes up the lane behind you
    var target = function (i) { var a = OBJS.filter(function (o) { return o.owner === 'allies'; }); return (a.length ? a : OBJS)[i % (a.length || OBJS.length)]; };
    ['Gruppe 5', 'Gruppe 6', 'Gruppe 7'].slice(0, DIFF.waves).forEach(function (name, si) {
      var goal = target(si), via = si % 2 ? flankPoint(ENTRY, goal) : null;   // every other squad comes round the flank
      for (var k = 0; k < 5; k++) {
        var c = nearestOpen(block, cellOf(ENTRY.x - si * 14 - k * 2.5, ENTRY.y + (k % 2) * 3)), w = centre(c[0], c[1]);
        var s = soldier(w[0], w[1], 'axis', 'rifle', name, k === 0 ? 'pf' : k === 4 ? 'nco' : 'rifle');
        s.goal = { x: goal.x + (Math.random() - .5) * 16, y: goal.y + (Math.random() - .5) * 16 }; s.via = via; units.push(s); order(s, (via || s.goal).x, (via || s.goal).y);
      }
    });
    var cr = OBJS[1], spot = mgSpot(cr, ENTRY);""", """  function counterAttack() {
    // the commander's counter-attack: rifle squads and an MG42 team by the way in he chose, the main effort at the
    // point his men saw held more thinly; all at once or in two waves. 2nd Squad comes up the lane behind you.
    var cp = counterPlan(); ENTRY = cp.entry;
    var main = OBJS[cp.main], goals = [main, OBJS[1 - cp.main]];
    var names = ['Gruppe 5', 'Gruppe 6', 'Gruppe 7'].slice(0, Math.max(1, DIFF.waves - (PLAN && PLAN.reserve === 'reserve' ? 1 : 0)));
    if (PLAN && PLAN.tempo === 'echelon' && names.length > 1) { PLAN.second = names.slice(1); PLAN.secondEntry = ENTRY; PLAN.secondGoal = goals; PLAN.echelonAt = clock + 60; names = names.slice(0, 1); }
    counterWave(names, ENTRY, goals);
    var cr = main, spot = mgSpot(cr, ENTRY);""")
P('i_mission.js', """    // the StuG: on Normal it waits at the end of the lane for the infantry to go in first; on Hard it comes straight on
    var dn = params.diff || prefs.difficulty || 'normal', sg = dn !== 'easy' && spawnStug(OBJS[1]); if (sg && dn === 'normal') sg.wait0 = clock + 100;""",
"""    // the StuG, if the plan brings it up with the counter-attack: on Normal it waits at the end of the lane for the
    // infantry to go in first; on Hard it comes straight on
    var sg = PLAN && PLAN.armour === 'counter' && spawnStug(main); if (sg && diffName() === 'normal') sg.wait0 = clock + 100;""")
P('i_mission.js', """  function bringUpSecond() {""", """  function counterWave(names, entry, goals) {
    names.forEach(function (name, si) {
      var goal = goals[si % goals.length], via = si % 2 ? flankPoint(entry, goal) : null;   // every other squad comes round the flank
      for (var k = 0; k < 5; k++) {
        var c = nearestOpen(block, cellOf(entry.x - si * 14 - k * 2.5, entry.y + (k % 2) * 3)), w = centre(c[0], c[1]);
        var s = soldier(w[0], w[1], 'axis', 'rifle', name, k === 0 ? 'pf' : k === 4 ? 'nco' : 'rifle');
        s.goal = { x: goal.x + (Math.random() - .5) * 16, y: goal.y + (Math.random() - .5) * 16 }; s.via = via; units.push(s); order(s, (via || s.goal).x, (via || s.goal).y);
      }
    });
  }
  function bringUpSecond() {""")

# the overwatch StuG: hard to see while dug in, holds fire until your armour is close
P('k_ai.js', "    if (isTank(t)) k = 1.3;", "    if (isTank(t)) k = t.dugIn && !t.path && !firing ? 0.5 : 1.3;   // a dug-in assault gun is low and hard to pick out")
P('e_update.js', "var tg = armr[0] && dist(u, armr[0]) < 700 ? armr[0] :", "var tg = armr[0] && dist(u, armr[0]) < (u.engage || 700) ? armr[0] :")
P('e_update.js', "    if (!u.path) u.backing = false;\n    separate(u);", "    if (!u.path) u.backing = false;\n    if (moving) u.dugIn = false;\n    separate(u);")

# battle intelligence
P('e_update.js', "      if (isTank(s) && !s.spotted) { s.spotted = true;", "      if (s.role === 'mg') intelEvent('mg', s);\n      if (isTank(s) && !s.spotted) { s.spotted = true; intelEvent('stug');")
P('e_update.js', "sq.forEach(function (s) { s.gone = true; if (close) tally.prisoners++; else tally.withdrew++; });", "sq.forEach(function (s) { s.gone = true; if (close) tally.prisoners++; else tally.withdrew++; });\n            if (close) intelEvent('pow');")
P('n_paras.js', "    tally.parasFound = (tally.parasFound || 0) + men.length;", "    tally.parasFound = (tally.parasFound || 0) + men.length;\n    intelEvent('para', men[0]);")

# Bloody Gulch: a main axis and a first wave from the other side to draw you
P('l_campaign.js', """    WAVES = [{ t: 20, squads: n, mg: 1, stug: sg[0] }, { t: 210, squads: n + 1, mg: 1, stug: sg[1] }, { t: 390, squads: n + 1, mg: 1, stug: sg[2] }];""",
"""    var mainSide = Math.random() < 0.5 ? 'west' : 'south', other = mainSide === 'west' ? 'south' : 'west';
    PLAN = { main: mainSide, log: [] };
    WAVES = [{ t: 20, squads: n, mg: 1, stug: sg[0], side: other }, { t: 210, squads: n + 1, mg: 1, stug: sg[1], side: mainSide }, { t: 390, squads: n + 1, mg: 1, stug: sg[2], side: mainSide }];
    gulchIntel(mainSide);""")
P('l_campaign.js', """    var e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)]; ENTRY = e;""",
"""    var pool = ENTRIES.filter(function (x) { return !w.side || x.side === w.side; }); if (!pool.length) pool = ENTRIES;
    var e = pool[Math.floor(Math.random() * pool.length)]; ENTRY = e;""")

# start screen, the in-game file, and the debrief
P('l_campaign.js', """    el('brief').textContent = MISSION.brief;""", """    el('brief').textContent = MISSION.brief;
    el('intelStart').innerHTML = INTEL.length ? '<b class="small">Intelligence</b>' + intelHTML() : '';""")
P('l_campaign.js', """    document.getElementById('debrief').innerHTML = html;""", """    var plan = planReveal(); if (plan) html = '<p><b class="small">The German plan</b>' + plan + '</p>' + html;
    document.getElementById('debrief').innerHTML = html;""")
P('l_campaign.js', "find them and they’ll join you. The Germans have Panzerfausts, an MG42 and, they say, an assault gun.',", "find them and they’ll join you. Read the intelligence below, but don’t trust all of it.',")
P('m_hud.js', "['objs', 'clock', 'ticker', 'res', 'cards', 'log', 'helpov']", "['objs', 'clock', 'ticker', 'res', 'cards', 'log', 'helpov', 'intel']")
P('m_hud.js', """      + '<button class="chip btn" data-cmd="log" title="Radio log (L)">Radio</button>'""",
"""      + '<button class="chip btn' + (INTEL.length > intelSeen ? ' hot' : '') + '" data-cmd="intel" title="Intelligence file (I)">Intel</button>'
      + '<button class="chip btn" data-cmd="log" title="Radio log (L)">Radio</button>'""")
P('m_hud.js', """    if (c === 'findfoe') {""", """    if (c === 'intel') { showIntel(); return; }
    if (c === 'findfoe') {""")
P('m_hud.js', """  function toggleBox(k) {""", """  function showIntel() { toggleBox('intel'); intelSeen = INTEL.length; ui.intel.innerHTML = '<b>Intelligence</b>' + intelHTML() + '<span class="dim">Click to close</span>'; }
  function toggleBox(k) {""")
P('m_hud.js', """  ui.helpov.addEventListener('click', function () { toggleBox('helpov'); });""", """  ui.helpov.addEventListener('click', function () { toggleBox('helpov'); });
  ui.intel.addEventListener('click', function () { toggleBox('intel'); });""")
P('h_ui.js', "    else if (k === 'l') doCommand('log');", "    else if (k === 'i') showIntel();\n    else if (k === 'l') doCommand('log');")
P('game/index.html', """<div id="log"></div>""", """<div id="log"></div><div id="intel"></div>""")
P('game/index.html', """  #log b { font: 500 16px Georgia, serif; display: block; margin-bottom: 4px; }""",
"""  #log b { font: 500 16px Georgia, serif; display: block; margin-bottom: 4px; }
  #intel { right: 14px; top: 56px; display: none; width: 420px; max-height: 60%; overflow: auto; background: rgba(28,26,20,.95); border: 1px solid rgba(226,178,90,.35); border-radius: 12px; padding: 12px 16px; font-size: 13px; line-height: 1.45; cursor: pointer; }
  #intel b { font: 500 17px Georgia, serif; display: block; margin-bottom: 6px; }
  .intel { margin: 0 0 9px; }
  .intel .src { display: block; font-size: 11px; color: #CFC9B8; letter-spacing: .02em; }
  #intelStart { text-align: left; font-size: 14px; max-width: 620px; margin: 6px auto 4px; }
  #intelStart .intel { margin: 6px 0; }""")
P('game/index.html', """  <p id="brief"></p>""", """  <p id="brief"></p>
  <div id="intelStart"></div>""")
P('game/index.html', """    <tr><td>Game</td><td>P pause · + double speed · M sound · L radio log · ? this help · arrows scroll</td></tr>""",
"""    <tr><td>Game</td><td>P pause · + double speed · M sound · L radio log · I intelligence · ? this help · arrows scroll</td></tr>""")
print('ok')
