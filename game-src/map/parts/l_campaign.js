
  // ------------------------------------------------------------------ missions and the campaign
  // Two battles near Carentan, June 1944: the push inland on 8 June, then the German counter-attack on the 13th. Played as a campaign, your men carry over: survivors keep their experience,
  // the dead are gone, sergeants are replaced from the ranks, and a few replacements come up between missions.
  // A defeat in the campaign means trying the mission again with the same men.
  var MISSIONS = {
    hedgerows: { id: 'hedgerows', map: 'hedgerows', title: 'Hedgerows near Carentan', date: '8 June 1944', hour: 'mist',
      brief: 'Two days after the landings. Two Shermans, 1st Squad, two scouts and a bazooka team have to take a farm and a crossroads in the bocage, then hold both when the Germans counter-attack. Paratroopers of the 101st are still scattered through these fields from the drop: find them and they’ll join you. Read the intelligence below, but don’t trust all of it.',
      setup: function () { setupHedgerows(); }, update: function (dt) { hedgerowsUpdate(dt); }, text: function () { return hedgerowsText(); },
      mortar: function () { return phase === 'counter'; },
      intro: { mist: 'Dawn. Mist lying on the fields, and you won’t see much past 50 m until it lifts. Germans reported around the farm, and paratroopers somewhere out there: listen for their crickets.',
               day: 'Two Shermans and 1st Squad at the lane. Germans reported around the farm.',
               dusk: 'Last light. Germans reported around the farm. Watch for muzzle flashes in the hedges.' } },
    gulch: { id: 'gulch', map: 'gulch', title: 'Bloody Gulch', date: '13 June 1944', hour: 'day',
      brief: 'The Germans are counter-attacking Carentan with paratroopers and SS. Hold the farm and the orchard until the 2nd Armored Division comes up from the town, about eleven minutes. They’ll come from the south and west, but nobody knows exactly where: find them with your scouts before they find you. A few of our own paratroopers are still cut off out there, too.',
      setup: function () { setupGulch(); }, update: function (dt) { gulchUpdate(dt); }, text: function () { return gulchText(); },
      mortar: function () { return phase === 'defend' && clock > 200; },
      intro: { mist: 'Early morning, mist in the low ground. Dig in at the farm and the orchard; the Germans are coming.',
               day: 'Dig in at the farm and the orchard. The Germans are coming from the south and west.',
               dusk: 'Evening. Dig in at the farm and the orchard; they’ll use the failing light.' } }
  };
  var CAMPAIGN = ['hedgerows', 'gulch'];
  function loadCampaign() { try { return JSON.parse(localStorage.getItem('hedgerows.campaign') || 'null'); } catch (e) { return null; } }
  function saveCampaign() { try { localStorage.setItem('hedgerows.campaign', JSON.stringify(campaign)); } catch (e) {} }
  var campaign = loadCampaign();
  var MODE = params.mode || prefs.mode || 'campaign';
  if (MODE === 'campaign' && campaign && campaign.next >= CAMPAIGN.length) campaign.done = true;
  var MISSION = MISSIONS[params.m] || (MODE === 'campaign' ? MISSIONS[CAMPAIGN[campaign && !campaign.done ? campaign.next : 0]] : MISSIONS[prefs.mission]) || MISSIONS.hedgerows;
  var MAPP = 'maps/' + MISSION.map + '/';

  // ------------------------------------------------------------------ the roster: everyone has a name
  var SURNAMES = ['Kowalski', 'Brennan', 'Russo', 'Haskins', 'Delgado', 'McAllister', 'Svoboda', 'Petrakis', 'Lindqvist', 'Hollis', 'Garrity', 'Mancuso',
    'Becker', 'Walsh', 'Duffy', 'Pulaski', 'Ortega', 'Sutton', 'Haines', 'Morrow', 'Keller', 'Grady', 'Fontaine', 'Abernathy', 'Rourke', 'Tate', 'Weiss',
    'Caruso', 'Dunbar', 'Sorensen', 'Hale', 'Riggs', 'Kaminski', 'Vance', 'Pryor', 'Doyle', 'Marsh', 'Ferraro', 'Novak', 'Quinlan', 'Ritter', 'Szabo',
    'Talbot', 'Ulrich', 'Varga', 'Whitlock', 'Yates', 'Zielinski', 'Ames', 'Boone', 'Cole', 'Dempsey', 'Egan', 'Flynn', 'Gibbs', 'Hurley', 'Ingram'];
  function newMan(rank, roster) {
    var used = {}; if (roster) Object.keys(roster.squads).forEach(function (k) { roster.squads[k].forEach(function (m) { used[m.name] = 1; }); });
    var free = SURNAMES.filter(function (n) { return !used[n]; }), name = free.length ? free[Math.floor(Math.random() * free.length)] : 'Smith';
    return { name: name, rank: rank || 'Pvt.', vet: 0, kills: 0, missions: 0 };
  }
  function newRoster() {
    var r = { squads: { '1st Squad': [], '2nd Squad': [], 'Scouts': [] }, tanks: [] };
    ['1st Squad', '2nd Squad'].forEach(function (s) { for (var i = 0; i < SQUAD_SIZE; i++) r.squads[s].push(newMan(i === 0 ? 'Sgt.' : i === 1 ? 'Cpl.' : 'Pvt.', r)); });
    r.squads.Scouts.push(newMan('Cpl.', r)); r.squads.Scouts.push(newMan('Pfc.', r));
    r.squads.Bazooka = [newMan('Pfc.', r), newMan('Pvt.', r)];
    CALL.forEach(function (n) { r.tanks.push({ name: n, vet: 0, kills: 0, commander: 'Sgt. ' + newMan('Sgt.', r).name }); });
    return r;
  }
  var ROSTER = MODE === 'campaign' && campaign && !campaign.done ? campaign.roster : newRoster();
  if (!ROSTER.squads.Bazooka) ROSTER.squads.Bazooka = [newMan('Pfc.', ROSTER), newMan('Pvt.', ROSTER)];   // a campaign begun before the bazooka came
  var TEAM_SIZE = { Scouts: 2, Bazooka: 2 };
  function manLabel(m) { return m.rank + ' ' + m.name; }
  function spawnSquadAt(name, at) {
    // put a squad on the map from the roster: at(k) gives the k-th man's spot (and optionally his facing)
    var out = [];
    (ROSTER.squads[name] || []).forEach(function (e, k) {
      var p = at(k), c = nearestOpen(block, cellOf(p[0], p[1])) || cellOf(p[0], p[1]), w = centre(c[0], c[1]);
      // the bazooka team's first man carries the tube; whoever is left of the team takes it on next time
      var bz = name === 'Bazooka' && k === 0, kit = bz ? 'bazooka' : /^Airborne/.test(name) ? 'para' : 'us';
      var u = soldier(w[0], w[1], 'allies', kit, name, name === 'Scouts' ? 'scout' : bz ? 'bazooka' : e.rank === 'Sgt.' ? 'nco' : 'rifle');
      if (bz) u.rockets = 8;
      if (e.para) u.fromRoster = true;
      u.man = e; u.vet = e.vet; u.kills = e.kills; u.heart = Math.min(100, u.heart + e.vet * 6); u.morale = u.heart;
      if (p[2] !== undefined) u.h = p[2];
      units.push(u); out.push(u);
    });
    return out;
  }
  function crewFromRoster(t, i) { var r = ROSTER.tanks[i]; if (!r) return; t.vet = r.vet; t.kills = r.kills; t.commander = r.commander; t.rosterIndex = i; }
  function fieldPromotion(sq) {
    // a squad that's lost its sergeant: the most experienced man left takes over after a short while
    if (sq.some(function (m) { return m.role === 'nco'; }) || sq.length < 2 || sq[0].stray || sq[0].role === 'crew' || sq[0].role === 'scout' || TEAM_SIZE[sq[0].squad]) return;
    var lost = sq[0].ncoLostT || (sq.forEach(function (m) { m.ncoLostT = clock; }), clock);
    if (clock - lost < 20) return;
    var best = sq.slice().sort(function (a, b) { return (b.vet - a.vet) || (b.kills - a.kills); })[0];
    best.role = 'nco'; if (best.man) best.man.rank = 'Sgt.';
    say((best.man ? manLabel(best.man) : 'A corporal') + ' takes over ' + best.squad + '.');
  }

  // ------------------------------------------------------------------ Bloody Gulch: hold the farm and the orchard
  var WAVES = [], ENTRIES = [], RELIEF = 660;
  function setupGulch() {
    var orc = LEVEL.orchard ? { x: LEVEL.orchard[0], y: LEVEL.orchard[1] } : { x: 0, y: 0 };
    var hs = LEVEL.houses.filter(function (h) { return Math.sqrt((h[0] - 40) * (h[0] - 40) + (h[1] - 220) * (h[1] - 220)) < 70; });
    var fx = 40, fy = 220; if (hs.length) { fx = 0; fy = 0; hs.forEach(function (h) { fx += h[0] / hs.length; fy += h[1] / hs.length; }); }
    var fc = nearestOpen(block, cellOf(fx, fy)), fw = centre(fc[0], fc[1]), oc = nearestOpen(block, cellOf(orc.x, orc.y)), ow = centre(oc[0], oc[1]);
    OBJ = { x: fw[0], y: fw[1] };
    OBJS = [{ name: 'farm', label: 'Farm', x: fw[0], y: fw[1], r: 22, owner: 'allies', prog: 1 }, { name: 'orchard', label: 'Orchard', x: ow[0], y: ow[1], r: 24, owner: 'allies', prog: 1 }];
    var rc = nearestOpen(block, cellOf(fw[0] + 30, fw[1] + 100)), rw = centre(rc[0], rc[1]); RALLY = { x: rw[0], y: rw[1] };
    // the Shermans on the lane between the two, facing south-west, where the attack is expected
    [[0.35, 0], [0.55, 6]].forEach(function (f, i) {
      var x = fw[0] + (ow[0] - fw[0]) * f[0] + f[1], y = fw[1] + (ow[1] - fw[1]) * f[0], c = nearestOpen(tankBlock, cellOf(x, y)), w = centre(c[0], c[1]);
      var t = tank(w[0], w[1], i); crewFromRoster(t, i); t.h = Math.atan2(-1, -1); units.push(t);
    });
    spawnSquadAt('1st Squad', function (k) { return [fw[0] + Math.cos(k * 0.8) * 9, fw[1] + Math.sin(k * 0.8) * 9, -2.4]; });
    spawnSquadAt('2nd Squad', function (k) { return [ow[0] + Math.cos(k * 0.8) * 10, ow[1] + Math.sin(k * 0.8) * 10, -2.4]; });
    spawnSquadAt('Scouts', function (k) { return [ow[0] - 40 + k * 2, ow[1] - 50, -2.4]; });
    spawnSquadAt('Bazooka', function (k) { return [ow[0] - 14 + k * 2, ow[1] - 12, -2.4]; });
    spawnAirborne(function (i, m) { return [fw[0] - 12 + (m % 4) * 2, fw[1] + 14 + i * 4 + Math.floor(m / 4) * 2, -2.4]; });
    placeStrays((params.diff || prefs.difficulty || 'normal') === 'hard' ? ['hidden'] : ['hidden', 'wounded']);
    reinforced = true; charges['2nd Squad'] = 1;
    ENTRIES = edgeEntries(ow);
    var n = DIFF.waves;   // 1, 2 or 3 squads a wave, by difficulty
    // StuGs: none on Easy, one with the last wave on Normal, the last two waves on Hard
    var sg = { easy: [0, 0, 0], normal: [0, 0, 1], hard: [0, 1, 1] }[params.diff || prefs.difficulty || 'normal'] || [0, 0, 1];
    var mainSide = Math.random() < 0.5 ? 'west' : 'south', other = mainSide === 'west' ? 'south' : 'west';
    PLAN = { main: mainSide, log: [] };
    WAVES = [{ t: 20, squads: n, mg: 1, stug: sg[0], side: other }, { t: 210, squads: n + 1, mg: 1, stug: sg[1], side: mainSide }, { t: 390, squads: n + 1, mg: 1, stug: sg[2], side: mainSide }];
    gulchIntel(mainSide);
    phase = 'defend';
    var q = proj((fw[0] + ow[0]) / 2, (fw[1] + ow[1]) / 2, 0); view.x = q[0] - VW / 2; view.y = q[1] - VH / 2; clampView();
    selected = [];
  }
  function edgeEntries(to) {
    // places on the west and south edges with a way in to the orchard
    var out = [];
    for (var k = -300; k <= 300; k += 50) {
      [['west', -345, k], ['south', k, -345]].forEach(function (c) {
        var cc = nearestOpen(block, cellOf(c[1], c[2])); if (!cc) return;
        var w = centre(cc[0], cc[1]), p = path(block, w, [to.x, to.y]);
        if (p) out.push({ side: c[0], x: w[0], y: w[1] });
      });
    }
    return out.length ? out : [{ side: 'south', x: 0, y: -340 }];
  }
  function spawnWave(w) {
    // a wave comes in from one place on the edge you don't know in advance: squads for both points, one round the flank, and an MG
    var pool = ENTRIES.filter(function (x) { return !w.side || x.side === w.side; }); if (!pool.length) pool = ENTRIES;
    var e = pool[Math.floor(Math.random() * pool.length)]; ENTRY = e;
    for (var si = 0; si < w.squads; si++) {
      var goal = OBJS[si % 2], via = si % 2 ? flankPoint(e, goal) : null, name = 'Gruppe ' + (++spawnWave.n);
      for (var k = 0; k < 5; k++) {
        var c = nearestOpen(block, cellOf(e.x + (k % 3) * 2.5 + si * 6, e.y + Math.floor(k / 3) * 2.5)), cw = centre(c[0], c[1]);
        var s = soldier(cw[0], cw[1], 'axis', 'rifle', name, k === 0 ? 'pf' : k === 4 ? 'nco' : 'rifle');
        s.goal = { x: goal.x + (Math.random() - .5) * 16, y: goal.y + (Math.random() - .5) * 16 }; s.via = via; units.push(s); order(s, (via || s.goal).x, (via || s.goal).y);
      }
    }
    if (w.mg) {
      var spot = mgSpot(OBJS[Math.floor(Math.random() * 2)], e), mname = 'MG ' + (++spawnWave.m);
      for (var j = 0; j < 2; j++) {
        var c2 = nearestOpen(block, cellOf(e.x - 4 - j * 2, e.y + 3)), w2 = centre(c2[0], c2[1]);
        var g = soldier(w2[0], w2[1], 'axis', j ? 'rifle' : 'mg42', mname, j ? 'loader' : 'mg');
        g.goal = { x: spot.x + j * 1.5, y: spot.y + j * 1.5 }; units.push(g); order(g, g.goal.x, g.goal.y);
      }
    }
    if (w.stug) spawnStug(OBJS[Math.floor(Math.random() * 2)]);
    if (clock > 60) say('More movement out to the ' + (e.side === 'west' ? 'west' : 'south') + '. Another attack is coming.');
  }
  spawnWave.n = 0; spawnWave.m = 0;
  function spawnStug(goal) {
    // a StuG comes in a little behind the infantry, by a way a vehicle can actually get to the objective
    var tries = [ENTRY].concat(ENTRIES.slice().sort(function () { return Math.random() - .5; })).filter(Boolean);
    for (var i = 0; i < tries.length && i < 6; i++) {
      var c = nearestOpen(tankBlock, cellOf(tries[i].x, tries[i].y)); if (!c) continue;
      var w = centre(c[0], c[1]), p = path(tankBlock, w, [goal.x, goal.y]);
      if (!p) continue;
      var s = stug(w[0], w[1], 'StuG ' + (++spawnStug.n)); s.h = Math.atan2(goal.y - s.y, goal.x - s.x);
      // it supports from behind its infantry, overwatching the point from about 70 m back along its way in
      var L = dist(s, goal) || 1, oc = nearestOpen(tankBlock, cellOf(goal.x + (s.x - goal.x) / L * 70, goal.y + (s.y - goal.y) / L * 70)), ow = oc ? centre(oc[0], oc[1]) : [goal.x, goal.y];
      s.goal = { x: ow[0], y: ow[1] }; units.push(s);
      s.wait0 = clock + 12; return s;
    }
    return null;
  }
  spawnStug.n = 0;
  function gulchUpdate(dt) {
    captureUpdate(dt);
    WAVES.forEach(function (w) { if (!w.done && clock > w.t) { w.done = true; spawnWave(w); } });
    if (over) return;
    var held = OBJS.filter(function (o) { return o.owner === 'allies'; }).length;
    if (!held && OBJS.every(function (o) { return o.owner === 'axis'; })) {
      gulchUpdate.lostT = gulchUpdate.lostT || clock;
      if (clock - gulchUpdate.lostT > 20) end('Overrun', 'The Germans hold both the farm and the orchard. The road into Carentan is open. ' + summary(), false);
    } else gulchUpdate.lostT = 0;
    if (clock > RELIEF) {
      if (held === 2) end('Bloody Gulch held', 'The 2nd Armored Division’s Shermans come up the road from Carentan, and both the farm and the orchard are still yours. ' + summary(), true);
      else if (held === 1) end('Held, just', 'The relief arrives with one of the two points still in your hands. It’s enough: the road to Carentan is held. ' + summary(), true);
      else end('Overrun', 'When the relief arrives, the Germans hold both points. ' + summary(), false);
    }
  }
  function gulchText() {
    var s = OBJS.map(function (o) { return o.label + ' ' + (o.contested ? 'contested' : o.owner === 'allies' ? 'yours' : o.owner === 'axis' ? 'German' : 'no one’s'); }).join(' · ');
    var left = Math.max(0, RELIEF - clock);
    return 'Hold until the 2nd Armored arrives: ' + Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2) + '. ' + s;
  }

  // ------------------------------------------------------------------ the after-action report
  // Every two seconds, where everyone is; and where each man fell. At the end it's drawn over a small map of the
  // battlefield, and can be played back.
  var tracker = { frames: [], deaths: [], next: 0,
    start: function () { this.frames = []; this.deaths = []; this.next = 0; },
    tick: function () {
      if (!started || clock < this.next) return; this.next = clock + 2;
      this.frames.push({ t: clock, p: units.map(function (u) { return [Math.round(u.x), Math.round(u.y), alive(u) ? 1 : 0]; }) });
    },
    death: function (u) { this.deaths.push({ x: u.x, y: u.y, side: u.side, tank: isTank(u), t: clock }); } };
  var overview = null;
  function aarDraw(cv2, upto) {
    var c = cv2.getContext('2d'), W = cv2.width, H = cv2.height, k = W / CAM.W;
    c.fillStyle = '#1b1c16'; c.fillRect(0, 0, W, H);
    if (overview && overview.complete) c.drawImage(overview, 0, 0, W, H);
    c.fillStyle = 'rgba(15,14,10,.35)'; c.fillRect(0, 0, W, H);
    var P = function (x, y) { var q = proj(x, y, 0); return [q[0] * k, q[1] * k]; };
    OBJS.forEach(function (o) { var q = P(o.x, o.y); c.strokeStyle = 'rgba(237,232,218,.8)'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.beginPath(); c.arc(q[0], q[1], o.r / CAM.mPerPx * k, 0, 6.3); c.stroke(); c.setLineDash([]); c.fillStyle = '#EDE8DA'; c.font = '11px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(o.label, q[0], q[1] - 10); });
    var F = tracker.frames, last = upto === undefined ? F.length - 1 : Math.min(upto, F.length - 1);
    units.forEach(function (u, i) {
      c.strokeStyle = u.side === 'axis' ? 'rgba(224,96,74,.55)' : isTank(u) ? 'rgba(200,220,245,.8)' : 'rgba(120,170,235,.6)'; c.lineWidth = isTank(u) ? 2 : 1;
      c.beginPath(); var started2 = false;
      for (var f = 0; f <= last; f++) { var p = F[f].p[i]; if (!p) continue; var q = P(p[0], p[1]); if (!started2) { c.moveTo(q[0], q[1]); started2 = true; } else c.lineTo(q[0], q[1]); if (!p[2]) break; }
      c.stroke();
      if (upto !== undefined && F[last] && F[last].p[i] && F[last].p[i][2]) { var q2 = P(F[last].p[i][0], F[last].p[i][1]); c.fillStyle = u.side === 'axis' ? '#E0604A' : '#9FC2E6'; c.beginPath(); c.arc(q2[0], q2[1], isTank(u) ? 4 : 2.2, 0, 6.3); c.fill(); }
    });
    var tNow = F[last] ? F[last].t : clock;
    tracker.deaths.forEach(function (d) {
      if (d.t > tNow) return; var q = P(d.x, d.y), s = d.tank ? 5 : 3;
      c.strokeStyle = d.side === 'axis' ? '#E0604A' : '#9FC2E6'; c.lineWidth = d.tank ? 2 : 1.4;
      c.beginPath(); c.moveTo(q[0] - s, q[1] - s); c.lineTo(q[0] + s, q[1] + s); c.moveTo(q[0] + s, q[1] - s); c.lineTo(q[0] - s, q[1] + s); c.stroke();
    });
    c.fillStyle = 'rgba(237,232,218,.9)'; c.font = '12px system-ui, sans-serif'; c.textAlign = 'left';
    c.fillText(Math.floor(tNow / 60) + ':' + ('0' + Math.floor(tNow % 60)).slice(-2), 10, H - 10);
  }
  function aarReplay() {
    var cv2 = document.getElementById('aar'), f = 0;
    (function stepIt() { aarDraw(cv2, f); f++; if (f < tracker.frames.length) setTimeout(stepIt, Math.max(30, 12000 / tracker.frames.length)); })();
  }

  // ------------------------------------------------------------------ after the battle: the roster, and what next
  function campaignAfter(won) {
    var notes = { killed: [], promoted: [], vets: [], replacements: 0, tanks: [] };
    if (!won) return notes;
    Object.keys(ROSTER.squads).forEach(function (sqn) {
      ROSTER.squads[sqn].forEach(function (e) {
        var u = units.filter(function (x) { return x.man === e; })[0];
        if (!u) return;                                         // never came into this battle
        if (u.hp <= 0) { e.dead = true; notes.killed.push(manLabel(e) + ' (' + sqn + ')'); return; }
        if (u.vet > e.vet) notes.vets.push(manLabel(e) + (u.vet === 2 ? ' is a veteran' : ' is blooded'));
        e.vet = u.vet; e.kills = u.kills; e.missions++;
      });
      var sq = ROSTER.squads[sqn] = ROSTER.squads[sqn].filter(function (e) { return !e.dead; });
      if (!TEAM_SIZE[sqn] && sq.length && !sq.some(function (e) { return e.rank === 'Sgt.'; })) {
        sq.sort(function (a, b) { return (b.vet - a.vet) || (b.kills - a.kills); }); sq[0].rank = 'Sgt.'; notes.promoted.push(sq[0].name + ' is promoted to sergeant of ' + sqn);
      }
    });
    units.filter(isTank).forEach(function (t) {
      var r = ROSTER.tanks[t.rosterIndex]; if (!r) return;
      if (t.hp > 0) { r.vet = t.vet; r.kills = t.kills; return; }
      if ((tally.savedBy[t.name] || 0) >= 3) notes.tanks.push(t.name + '’s crew got out and get a new Sherman.');
      else { r.vet = 0; r.kills = 0; r.commander = 'Sgt. ' + newMan('Sgt.', ROSTER).name; notes.tanks.push('A new Sherman and a green crew replace ' + t.name + '.'); }
    });
    // paratroopers you found join the company; replacements: green privates, the squads with the most gaps first,
    // but fewer of them when the paratroopers have filled the ranks
    var joined = airborneJoin(notes), n = { easy: 8, normal: 5, hard: 3 }[prefs.difficulty || 'normal'] || 5;
    n = Math.max(joined ? 1 : 0, n - joined);
    while (n > 0) {
      var need = Object.keys(ROSTER.squads).map(function (k) { return [k, /^Airborne/.test(k) ? 0 : (TEAM_SIZE[k] || SQUAD_SIZE) - ROSTER.squads[k].length]; }).filter(function (p) { return p[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
      if (!need.length) break;
      ROSTER.squads[need[0][0]].push(newMan('Pvt.', ROSTER)); n--; notes.replacements++;
    }
    campaign.next++; campaign.results.push({ mission: MISSION.id, won: won, killed: notes.killed.length }); saveCampaign();
    return notes;
  }
  function debrief(won) {
    // the end screen: the result, the replay map, who fell, who's been promoted, and what to do next
    var inCampaign = MODE === 'campaign' && campaign && !campaign.done, notes = inCampaign ? campaignAfter(won) : null, html = '';
    if (notes && won) {
      if (notes.killed.length) html += '<p><b class="small">Killed</b>' + notes.killed.join(', ') + '</p>';
      if (notes.promoted.length) html += '<p><b class="small">Promotions</b>' + notes.promoted.join('. ') + '.</p>';
      if (notes.vets.length) html += '<p><b class="small">Experience</b>' + notes.vets.join(', ') + '.</p>';
      if (notes.tanks.length) html += '<p><b class="small">Tanks</b>' + notes.tanks.join(' ') + '</p>';
      if (notes.airborne) html += '<p><b class="small">Airborne</b>' + words(notes.airborne) + ' paratroopers you found have joined the company for good' + (notes.replacements ? ', so only ' + words(notes.replacements).toLowerCase() + (notes.replacements === 1 ? ' replacement' : ' replacements') + ' came up.' : '.') + '</p>';
      else if (notes.replacements) html += '<p>' + notes.replacements + ' replacements have come up to fill the gaps.</p>';
    } else if (notes) html += '<p>Your men are as they were before the battle. Try again.</p>';
    var plan = planReveal(); if (plan) html = '<p><b class="small">The German plan</b>' + plan + '</p>' + html;
    document.getElementById('debrief').innerHTML = html;
    var btns = '<button data-end="replay">Replay the battle</button>';
    if (inCampaign) {
      if (won && campaign.next < CAMPAIGN.length) btns += '<button data-end="next">Next: ' + MISSIONS[CAMPAIGN[campaign.next]].title + '</button>';
      else if (won) btns += '<button data-end="newcampaign">Campaign complete. Start a new one</button>';
      else btns += '<button data-end="again">Try again</button>';
    } else btns += '<button data-end="again">Play again</button>';
    btns += '<button data-end="menu">Start screen</button>';
    document.getElementById('endButtons').innerHTML = btns;
    [].forEach.call(document.querySelectorAll('#endButtons button'), function (b) { b.addEventListener('click', function () { endAction(b.getAttribute('data-end')); }); });
    overview = new Image(); overview.onload = function () { aarDraw(document.getElementById('aar')); }; overview.src = MAPP + 'overview.jpg';
    aarDraw(document.getElementById('aar'));
  }
  function endAction(a) {
    if (a === 'replay') return aarReplay();
    if (a === 'newcampaign') { campaign = { next: 0, roster: newRoster(), results: [] }; saveCampaign(); }
    if (a === 'menu') { location.href = location.pathname + (remote.on ? '?remote=1' : ''); return; }
    location.href = location.pathname + '?go=1' + (remote.on ? '&remote=1' : '');   // next, again or new: straight into the battle
  }

  // ------------------------------------------------------------------ the start screen
  function startScreen() {
    var mode = MODE, el = function (id) { return document.getElementById(id); };
    el('missionTitle').textContent = MISSION.title + ', ' + MISSION.date;
    el('brief').textContent = MISSION.brief;
    el('intelStart').innerHTML = INTEL.length ? '<b class="small">Intelligence</b>' + intelHTML() : '';
    var row = '';
    if (mode === 'campaign') {
      var n = campaign && !campaign.done ? campaign.next : 0;
      row = 'Mission ' + (n + 1) + ' of ' + CAMPAIGN.length + (campaign && !campaign.done && campaign.next ? ' · your men from the last battle' : '') + ' <button data-new="1">New campaign</button>';
    } else row = 'Battle: ' + CAMPAIGN.map(function (id) { return '<button data-mission="' + id + '"' + (id === MISSION.id ? ' class="pick"' : '') + '>' + MISSIONS[id].title + '</button>'; }).join('');
    el('missionRow').innerHTML = row;
    [].forEach.call(document.querySelectorAll('#start button[data-mode]'), function (b) { b.className = b.getAttribute('data-mode') === mode ? 'pick' : ''; b.onclick = function () { prefs.mode = b.getAttribute('data-mode'); savePrefs(); reloadStart(); }; });
    [].forEach.call(document.querySelectorAll('#start button[data-mission]'), function (b) { b.onclick = function () { prefs.mission = b.getAttribute('data-mission'); savePrefs(); reloadStart(); }; });
    [].forEach.call(document.querySelectorAll('#start button[data-new]'), function (b) { b.onclick = function () { campaign = { next: 0, roster: newRoster(), results: [] }; saveCampaign(); reloadStart(); }; });
    var hour = prefs.hour || MISSION.hour;
    [].forEach.call(document.querySelectorAll('#start button[data-time]'), function (b) { b.className = b.getAttribute('data-time') === hour ? 'pick' : ''; b.onclick = function () { prefs.hour = b.getAttribute('data-time'); savePrefs(); startScreen(); }; });
    el('go').onclick = function () { startGame(); };
  }
  function reloadStart() { location.href = location.pathname + (remote.on ? '?remote=1' : ''); }
  function startGame() {
    if (MODE === 'campaign' && (!campaign || campaign.done)) { campaign = { next: 0, roster: ROSTER, results: [] }; saveCampaign(); }
    begin(prefs.hour || MISSION.hour);
  }
