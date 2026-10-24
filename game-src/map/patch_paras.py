def P(f, a, b, n=1):
    f = 'parts/' + f; s = open(f).read(); c = s.count(a)
    assert c == n, (f, c, a[:80]); open(f, 'w').write(s.replace(a, b))
P('../build.sh', 'parts/l_campaign.js parts/m_hud.js', 'parts/l_campaign.js parts/n_paras.js parts/m_hud.js')
# update: strays don't spot for you (no radio) and don't count as your fighting strength
P('e_update.js', "var sees = function (s) { return allies.some(function (a) { return canSee(a, s); }); };", "var sees = function (s) { return allies.some(function (a) { return !a.stray && canSee(a, s); }); };")
P('e_update.js', "fighting = team('allies').filter(function (u) { return u.role !== 'crew'; });", "fighting = team('allies').filter(function (u) { return u.role !== 'crew' && !u.stray; });")
P('e_update.js', "    MISSION.update(dt);\n", "    MISSION.update(dt);\n    straysUpdate();\n")
P('e_update.js', """  function updateMan(u, dt, foes, R) {
    u.shot -= dt; u.anim += dt;""", """  function updateMan(u, dt, foes, R) {
    if (u.captive) { u.pose = 'idle'; return; }   // a prisoner: sitting under guard until you get him out
    u.shot -= dt; u.anim += dt;
    if (u.side === 'allies') rearmMen(u);""")
P('e_update.js', "    var vis = foes.filter(function (a) { return canSee(u, a); });\n    if (u.side === 'axis') vis.forEach", "    var vis = foes.filter(function (a) { return !a.captive && canSee(u, a); });\n    if (u.side === 'axis') vis.forEach")
P('e_update.js', "var seen = foes.filter(function (a) { return canSee(u, a); }).sort(function (a, b) { return dist(u, a) - dist(b, a); });".replace("dist(b, a)", "dist(u, b)"),
  "var seen = foes.filter(function (a) { return !a.captive && canSee(u, a); }).sort(function (a, b) { return dist(u, a) - dist(u, b); });")
P('e_update.js', "move(u, u.assault ? 3.4 : u.role === 'crew' ? 3.0 : u.role === 'scout' ? 2.8 : 2.2, 6, dt);", "move(u, (u.assault ? 3.4 : u.role === 'crew' ? 3.0 : u.role === 'scout' ? 2.8 : 2.2) * (u.wounded ? 0.55 : 1), 6, dt);")
P('e_update.js', """    var stugs = units.filter""", """    var paras = units.filter(function (u) { return u.kit === 'para' && !u.stray && u.man && u.man.para && !u.fromRoster; }), parasLost = paras.filter(function (u) { return u.hp <= 0; }).length;
    var stugs = units.filter""")
P('e_update.js', """      + (stugs.length ? ' StuGs knocked out: '""", """      + (STRAYS.length ? ' Paratroopers found: ' + paras.length + (paras.length ? ', of whom ' + (paras.length - parasLost) + ' came through' : '') + '.' : '')
      + (stugs.length ? ' StuGs knocked out: '""")
# small arms: short of ammunition, they fire sparingly
P('c_units.js', "s.fired = 0.2; s.shot = w.every[0] + Math.random() * (w.every[1] - w.every[0]);", "s.fired = 0.2; s.shot = (w.every[0] + Math.random() * (w.every[1] - w.every[0])) * (s.lowAmmo ? 1.8 : 1);")
# you can't pick or box-select men you haven't found
P('h_ui.js', "if (u.side !== 'allies' || !alive(u) || u.riding) return;", "if (u.side !== 'allies' || !alive(u) || u.riding || u.stray) return;")
P('h_ui.js', "if (u.side !== 'allies' || !alive(u)) return false; var p = proj(u.x, u.y, 1);", "if (u.side !== 'allies' || !alive(u) || u.stray) return false; var p = proj(u.x, u.y, 1);")
P('m_hud.js', "var mine = team('allies'), out = [];", "var mine = team('allies').filter(function (u) { return !u.stray; }), out = [];")
P('g_draw.js', "    if (u.gone) return;\n    var vis = enemy", "    if (u.gone || u.stray) return;   // paratroopers out there you haven't found yet\n    var vis = enemy")
P('g_draw.js', "col = h.kind === 'pf' ? '240,120,80' : '226,178,90';", "col = h.kind === 'pf' ? '240,120,80' : h.kind === 'cricket' ? '159,194,230' : '226,178,90';")
# the cricket
P('f_sound.js', "    function hush() {", """    function cricket(x, y) {
      // the paratroopers' toy clicker, the drop-night recognition signal: click-clack
      if (!live()) return; var pl = where(x, y), t = A.currentTime + pl.delay, d = chain(pl, 0.6);
      [[0, 3400], [0.11, 2500]].forEach(function (c) { var o = A.createOscillator(), e = A.createGain(); o.type = 'square'; o.frequency.value = c[1];
        e.gain.setValueAtTime(0.0001, t + c[0]); e.gain.exponentialRampToValueAtTime(0.5, t + c[0] + 0.002); e.gain.exponentialRampToValueAtTime(0.0001, t + c[0] + 0.035);
        o.connect(e); e.connect(d); o.start(t + c[0]); o.stop(t + c[0] + 0.05); hiss(d, t + c[0], 0.03, 'bandpass', 4200, 4); });
    }
    function hush() {""")
P('f_sound.js', "whistle: whistle };", "whistle: whistle, cricket: cricket };")
# guards stay with their prisoners
P('k_ai.js', "s.role !== 'loader' && s.role !== 'crew') (squads", "s.role !== 'loader' && s.role !== 'crew' && !/^Wache/.test(s.squad)) (squads")
P('i_mission.js', "} else if (!team('axis').length && held) end(", "} else if (!team('axis').filter(function (s) { return !/^Wache/.test(s.squad); }).length && held) end(")
# missions: placing them
P('i_mission.js', """    selected = units.filter(isTank);
    var c0 = proj(LEVEL.shermans[0][0]""", """    spawnAirborne(function (i, m) { return [back.x + bx * (20 + i * 4) - by * (m * 2 - 4), back.y + by * (20 + i * 4) + bx * (m * 2 - 4), Math.atan2(-by, -bx)]; });
    placeStrays((prefs.difficulty || 'normal') === 'easy' ? ['hidden', 'surrounded', 'captive', 'wounded'] : ['hidden', 'surrounded', 'captive']);
    selected = units.filter(isTank);
    var c0 = proj(LEVEL.shermans[0][0]""")
P('l_campaign.js', """    spawnSquadAt('Bazooka', function (k) { return [ow[0] - 14 + k * 2, ow[1] - 12, -2.4]; });""", """    spawnSquadAt('Bazooka', function (k) { return [ow[0] - 14 + k * 2, ow[1] - 12, -2.4]; });
    spawnAirborne(function (i, m) { return [fw[0] - 12 + (m % 4) * 2, fw[1] + 14 + i * 4 + Math.floor(m / 4) * 2, -2.4]; });
    placeStrays((prefs.difficulty || 'normal') === 'hard' ? ['hidden'] : ['hidden', 'wounded']);""")
P('l_campaign.js', """      if (bz) u.rockets = 8;""", """      if (bz) u.rockets = 8;
      if (e.para) u.fromRoster = true;""")
# the campaign: found paratroopers join, in place of most replacements
P('l_campaign.js', """    // replacements: green privates, the squads with the most gaps first
    var n = { easy: 8, normal: 5, hard: 3 }[prefs.difficulty || 'normal'] || 5;""", """    // paratroopers you found join the company; replacements: green privates, the squads with the most gaps first,
    // but fewer of them when the paratroopers have filled the ranks
    var joined = airborneJoin(notes), n = { easy: 8, normal: 5, hard: 3 }[prefs.difficulty || 'normal'] || 5;
    n = Math.max(joined ? 1 : 0, n - joined);""")
P('l_campaign.js', "return [k, (TEAM_SIZE[k] || SQUAD_SIZE) - ROSTER.squads[k].length]; })", "return [k, /^Airborne/.test(k) ? 0 : (TEAM_SIZE[k] || SQUAD_SIZE) - ROSTER.squads[k].length]; })")
P('l_campaign.js', """      if (notes.replacements) html += '<p>' + notes.replacements + ' replacements have come up to fill the gaps.</p>';""",
"""      if (notes.airborne) html += '<p><b class="small">Airborne</b>' + words(notes.airborne) + ' paratroopers you found have joined the company for good' + (notes.replacements ? ', so only ' + words(notes.replacements).toLowerCase() + (notes.replacements === 1 ? ' replacement' : ' replacements') + ' came up.' : '.') + '</p>';
      else if (notes.replacements) html += '<p>' + notes.replacements + ' replacements have come up to fill the gaps.</p>';""")
# dates and briefs
P('l_campaign.js', """title: 'Hedgerows near Carentan', date: '12 June 1944', hour: 'mist',
      brief: 'Two Shermans, 1st Squad and two scouts have to take a farm and a crossroads in the bocage, then hold both when the Germans counter-attack. The Germans have Panzerfausts and an MG42, and the hedges are thick.',""",
"""title: 'Hedgerows near Carentan', date: '8 June 1944', hour: 'mist',
      brief: 'Two days after the landings. Two Shermans, 1st Squad, two scouts and a bazooka team have to take a farm and a crossroads in the bocage, then hold both when the Germans counter-attack. Paratroopers of the 101st are still scattered through these fields from the drop: find them and they’ll join you. The Germans have Panzerfausts, an MG42 and, they say, an assault gun.',""")
P('l_campaign.js', """      intro: { mist: 'Dawn. Mist lying on the fields, and you won’t see much past 50 m until it lifts. Germans reported around the farm.',""",
"""      intro: { mist: 'Dawn. Mist lying on the fields, and you won’t see much past 50 m until it lifts. Germans reported around the farm, and paratroopers somewhere out there: listen for their crickets.',""")
P('l_campaign.js', """  // Two battles near Carentan, June 1944.""", """  // Two battles near Carentan, June 1944: the push inland on 8 June, then the German counter-attack on the 13th.""")
print('ok')
