def P(f, a, b, n=1):
    s = open(f).read(); c = s.count(a)
    assert c == n, (f, c, a[:70]); open(f, 'w').write(s.replace(a, b))

# ---- roster: the bazooka team, a gunner and his loader
P('l_campaign.js', """    r.squads.Scouts.push(newMan('Cpl.', r)); r.squads.Scouts.push(newMan('Pfc.', r));""",
"""    r.squads.Scouts.push(newMan('Cpl.', r)); r.squads.Scouts.push(newMan('Pfc.', r));
    r.squads.Bazooka = [newMan('Pfc.', r), newMan('Pvt.', r)];""")
P('l_campaign.js', """  var ROSTER = MODE === 'campaign' && campaign && !campaign.done ? campaign.roster : newRoster();""",
"""  var ROSTER = MODE === 'campaign' && campaign && !campaign.done ? campaign.roster : newRoster();
  if (!ROSTER.squads.Bazooka) ROSTER.squads.Bazooka = [newMan('Pfc.', ROSTER), newMan('Pvt.', ROSTER)];   // a campaign begun before the bazooka came
  var TEAM_SIZE = { Scouts: 2, Bazooka: 2 };""")
P('l_campaign.js', """      var u = soldier(w[0], w[1], 'allies', 'us', name, name === 'Scouts' ? 'scout' : e.rank === 'Sgt.' ? 'nco' : 'rifle');""",
"""      // the bazooka team's first man carries the tube; whoever is left of the team takes it on next time
      var bz = name === 'Bazooka' && k === 0, kit = bz ? 'bazooka' : /^Airborne/.test(name) ? 'para' : 'us';
      var u = soldier(w[0], w[1], 'allies', kit, name, name === 'Scouts' ? 'scout' : bz ? 'bazooka' : e.rank === 'Sgt.' ? 'nco' : 'rifle');
      if (bz) u.rockets = 8;""")
P('l_campaign.js', """    if (sq.some(function (m) { return m.role === 'nco'; }) || sq.length < 2 || sq[0].role === 'crew' || sq[0].role === 'scout') return;""",
"""    if (sq.some(function (m) { return m.role === 'nco'; }) || sq.length < 2 || sq[0].role === 'crew' || sq[0].role === 'scout' || TEAM_SIZE[sq[0].squad]) return;""")
P('l_campaign.js', """      if (sqn !== 'Scouts' && sq.length && !sq.some""", """      if (!TEAM_SIZE[sqn] && sq.length && !sq.some""")
P('l_campaign.js', """return [k, (k === 'Scouts' ? 2 : SQUAD_SIZE) - ROSTER.squads[k].length]; })""", """return [k, (TEAM_SIZE[k] || SQUAD_SIZE) - ROSTER.squads[k].length]; })""")

# ---- the bazooka team on the map; StuGs in the Gulch waves
P('l_campaign.js', """    spawnSquadAt('Scouts', function (k) { return [ow[0] - 40 + k * 2, ow[1] - 50, -2.4]; });""",
"""    spawnSquadAt('Scouts', function (k) { return [ow[0] - 40 + k * 2, ow[1] - 50, -2.4]; });
    spawnSquadAt('Bazooka', function (k) { return [ow[0] - 14 + k * 2, ow[1] - 12, -2.4]; });""")
P('l_campaign.js', """    WAVES = [{ t: 20, squads: n, mg: 1 }, { t: 210, squads: n + 1, mg: 1 }, { t: 390, squads: n + 1, mg: 1 }];""",
"""    // StuGs: the last wave on Easy, the second and third on Normal, every wave on Hard
    var sg = { easy: [0, 0, 1], normal: [0, 1, 1], hard: [1, 1, 1] }[prefs.difficulty || 'normal'] || [0, 1, 1];
    WAVES = [{ t: 20, squads: n, mg: 1, stug: sg[0] }, { t: 210, squads: n + 1, mg: 1, stug: sg[1] }, { t: 390, squads: n + 1, mg: 1, stug: sg[2] }];""")
P('l_campaign.js', """    if (clock > 60) say('More movement out to the ' + (e.side === 'west' ? 'west' : 'south') + '. Another attack is coming.');""",
"""    if (w.stug) spawnStug(OBJS[Math.floor(Math.random() * 2)]);
    if (clock > 60) say('More movement out to the ' + (e.side === 'west' ? 'west' : 'south') + '. Another attack is coming.');""")
P('l_campaign.js', """  spawnWave.n = 0; spawnWave.m = 0;""", """  spawnWave.n = 0; spawnWave.m = 0;
  function spawnStug(goal) {
    // a StuG comes in a little behind the infantry, by a way a vehicle can actually get to the objective
    var tries = [ENTRY].concat(ENTRIES.slice().sort(function () { return Math.random() - .5; })).filter(Boolean);
    for (var i = 0; i < tries.length && i < 6; i++) {
      var c = nearestOpen(tankBlock, cellOf(tries[i].x, tries[i].y)); if (!c) continue;
      var w = centre(c[0], c[1]), p = path(tankBlock, w, [goal.x, goal.y]);
      if (!p) continue;
      var s = stug(w[0], w[1], 'StuG ' + (++spawnStug.n)); s.h = Math.atan2(goal.y - s.y, goal.x - s.x);
      s.goal = { x: goal.x + (Math.random() - .5) * 20, y: goal.y + (Math.random() - .5) * 20 }; units.push(s);
      s.wait0 = clock + 12; return s;
    }
    return null;
  }
  spawnStug.n = 0;""")

# ---- Hedgerows: a StuG with the counter-attack on Normal and Hard
P('i_mission.js', """    if (!reinforced) bringUpSecond();
    say('Hold the farm and the crossroads for four minutes.');""", """    if ((prefs.difficulty || 'normal') !== 'easy') spawnStug(OBJS[1]);
    if (!reinforced) bringUpSecond();
    say('Hold the farm and the crossroads for four minutes.');""")
P('i_mission.js', """    spawnSquadAt('Scouts', function (sk) { return [back.x + bx * 6 + by * (12 + sk * 2), back.y + by * 6 - bx * (12 + sk * 2), Math.atan2(-by, -bx)]; });""",
"""    spawnSquadAt('Scouts', function (sk) { return [back.x + bx * 6 + by * (12 + sk * 2), back.y + by * 6 - bx * (12 + sk * 2), Math.atan2(-by, -bx)]; });
    spawnSquadAt('Bazooka', function (k) { return [back.x + bx * 16 - by * (k * 2 - 6), back.y + by * 16 + bx * (k * 2 - 6), Math.atan2(-by, -bx)]; });""")

# ---- the StuG waits a moment before moving off (lets its infantry get ahead)
P('e_update.js', """    else if (!u.path && !u.backing && clock - (u.contact || -99) > 8 && u.goal && dist(u, u.goal) > 14) order(u, u.goal.x, u.goal.y);""",
"""    else if (!u.path && !u.backing && clock > (u.wait0 || 0) && clock - (u.contact || -99) > 8 && u.goal && dist(u, u.goal) > 14) order(u, u.goal.x, u.goal.y);""")

# ---- cards: the bazooka team, its rockets
P('m_hud.js', """kind: u.role === 'crew' ? 'crew' : u.role === 'scout' ? 'scout' : 'squad' });""",
"""kind: u.role === 'crew' ? 'crew' : u.role === 'scout' ? 'scout' : TEAM_SIZE[u.squad] ? 'team' : 'squad' });""")
P('m_hud.js', """        if (u0.hold) flags.push('ambush'); if (u0.riding) flags.push('riding'); if (u0.assault) flags.push('assault');""",
"""        var bzk = g.units.filter(function (v) { return v.role === 'bazooka'; })[0];
        if (bzk) flags.push(bzk.rockets ? bzk.rockets + ' rockets' : 'no rockets');
        if (u0.hold) flags.push('ambush'); if (u0.riding) flags.push('riding'); if (u0.assault) flags.push('assault');""")
P('m_hud.js', """      var ic = g.kind === 'tank' ? ICON.tank : g.kind === 'scout' ? ICON.scout : g.kind === 'crew' ? ICON.crew : ICON.helmet;""",
"""      var ic = g.kind === 'tank' ? ICON.tank : g.kind === 'scout' ? ICON.scout : g.kind === 'crew' ? ICON.crew : g.key === 'Bazooka' ? ICON.tube : ICON.helmet;""")
P('m_hud.js', """    shell: '<svg""", """    tube: '<svg viewBox="0 0 26 16" width="24" height="15"><path d="M2 9.5l21-5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M9 9l1.5 5" stroke="currentColor" stroke-width="2"/></svg>',
    shell: '<svg""")

# ---- remote: a find-your-units menu built from whatever you have
P('j_remote.js', """      [['Shermans', mine.filter(isTank)], ['1st Squad', mine.filter(function (v) { return v.squad === '1st Squad'; })], ['2nd Squad', mine.filter(function (v) { return v.squad === '2nd Squad'; })],
       ['Scouts', mine.filter(function (v) { return v.squad === 'Scouts'; })], ['Crews on foot', mine.filter(function (v) { return v.role === 'crew'; })]].forEach(function (p) {""",
"""      [['Shermans', mine.filter(isTank)]].concat(groupsOfMine().filter(function (gr) { return gr.kind !== 'tank' && gr.kind !== 'crew'; }).map(function (gr) { return [gr.key, gr.units]; }))
       .concat([['Crews on foot', mine.filter(function (v) { return v.role === 'crew'; })]]).forEach(function (p) {""")

# ---- drawing the StuG: its own sheet, hidden unless seen, a ghost where it was last seen
P('g_draw.js', """  function drawTank(u) {
    var k = ((Math.round(u.h / (Math.PI / 8)) % 16) + 16) % 16, s = SPR.tank, p = proj(u.x, u.y, SPR.tankLookZ);
    var f = [];""", """  function drawTank(u) {
    var enemy = u.side === 'axis', img = u.model === 'stug' && imgStug ? imgStug : imgTank;
    if (enemy && (alive(u) ? clock - u.seenT > 1.5 : !u.bodySeen)) {
      // out of sight: a faded outline where you last saw it, for 25 seconds
      var age = clock - u.seenT; if (!alive(u) || !u.last || age > 25) return;
      var lk = ((Math.round(u.last.h / (Math.PI / 8)) % 16) + 16) % 16, lp = proj(u.last.x, u.last.y, SPR.tankLookZ), lg = proj(u.last.x, u.last.y, 0);
      ctx.globalAlpha = 0.25 * (1 - age / 25); ctx.drawImage(img, lk * SPR.tank, 0, SPR.tank, SPR.tank, lp[0] - view.x - SPR.tank / 2, lp[1] - view.y - SPR.tank / 2, SPR.tank, SPR.tank);
      ctx.globalAlpha = 0.7 * (1 - age / 25); ctx.strokeStyle = '#D6503C'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.ellipse(lg[0] - view.x, lg[1] - view.y, 34, 20, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      return;
    }
    var k = ((Math.round(u.h / (Math.PI / 8)) % 16) + 16) % 16, s = SPR.tank, p = proj(u.x, u.y, SPR.tankLookZ);
    var f = [];""")
P('g_draw.js', """    blit(imgTank, k * s, 0, s, s, p[0] - view.x - s / 2, p[1] - view.y - s / 2, s, s, proj(u.x, u.y, 0)[1], [159, 194, 230]);""",
"""    if (enemy && alive(u)) { var gq = proj(u.x, u.y, 0); ctx.fillStyle = 'rgba(214,80,60,.3)'; ctx.beginPath(); ctx.ellipse(gq[0] - view.x, gq[1] - view.y, 30, 17, 0, 0, 6.3); ctx.fill(); }
    blit(img, k * s, 0, s, s, p[0] - view.x - s / 2, p[1] - view.y - s / 2, s, s, proj(u.x, u.y, 0)[1], enemy ? [214, 80, 60] : [159, 194, 230]);""")
P('a_head.js', """imgTank, sheets""", """imgTank, imgStug, sheets""")
P('h_ui.js', """maybe(MAPP + 'tiles_dusk/tiles.json'), image('sherman.png')]).then(function (r) {
    LEVEL = r[0]; CAM = r[1]; SPR = r[2]; TILES = r[3]; TILES_DUSK = r[4]; imgTank = r[5];""", """maybe(MAPP + 'tiles_dusk/tiles.json'), image('sherman.png'), image('stug.png')]).then(function (r) {
    LEVEL = r[0]; CAM = r[1]; SPR = r[2]; TILES = r[3]; TILES_DUSK = r[4]; imgTank = r[5]; imgStug = r[6];""")
P('h_ui.js', """    <tr><td>Points</td>""", """    <tr><td>Points</td>""", 0) if False else None
print('ok')
