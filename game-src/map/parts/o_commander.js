
  // ------------------------------------------------------------------ the German commander
  // Every battle the German side makes a plan: how to hold the ground, where the MG42 goes, whether to keep a
  // reserve, where and how the counter-attack comes in, and what to do with any armour. Each choice is one a German
  // company commander could sensibly make, weighted for the ground, so no two defences are the same but every one
  // makes sense. It only knows what its own men have seen, and it reconsiders when something important happens.
  // You get an intelligence file drawn from the plan: mostly right, often vague, sometimes wrong.
  var PLAN = null, INTEL = [], intelSeen = 0;
  function pickW(w, forced) {
    // a weighted choice; ?plan=forward (etc.) on the address forces any option, for testing
    if (forced && w[forced] !== undefined) return forced;
    var keys = Object.keys(w).filter(function (k) { return w[k] > 0; }), tot = 0;
    keys.forEach(function (k) { tot += w[k]; });
    var r = Math.random() * tot;
    for (var i = 0; i < keys.length; i++) { r -= w[keys[i]]; if (r <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  function forcedPlan() { var f = {}; (params.plan || '').split(',').forEach(function (k) { if (k) f[k] = k; }); return function (w) { for (var k in w) if (f[k]) return k; return null; }; }
  function diffName() { return params.diff || prefs.difficulty || 'normal'; }
  function placeSquad(name, at, n, pfs, facing) {
    // a squad dug in around a spot, in cover where there is any: n men, the first pfs carrying Panzerfausts, the last the NCO
    var out = [];
    for (var k = 0; k < n; k++) {
      var a = k * 6.28 / n, c = nearestOpen(block, cellOf(at.x + Math.cos(a) * 4, at.y + Math.sin(a) * 4)) || cellOf(at.x, at.y), w = centre(c[0], c[1]);
      var s = soldier(w[0], w[1], 'axis', 'rifle', name, k < pfs ? 'pf' : k === n - 1 ? 'nco' : 'rifle');
      if (facing !== undefined) s.h = facing; units.push(s); out.push(s);
    }
    return out;
  }
  function placeMG(name, near, toward, reach) {
    var site = siteGun(near, toward, reach || 28);
    for (var j = 0; j < 2; j++) {
      var mc = nearestOpen(block, cellOf(site.x - Math.cos(site.h) * j * 1.8, site.y - Math.sin(site.h) * j * 1.8 + j)), mw = centre(mc[0], mc[1]);
      var gu = soldier(mw[0], mw[1], 'axis', j ? 'rifle' : 'mg42', name, j ? 'loader' : 'mg'); gu.h = site.h; gu.setup = 3; units.push(gu);
    }
    return site;
  }
  function overwatchSite(objs, from) {
    // where an assault gun would dig in: open to a vehicle, behind the points as seen from your side, with the
    // longest clear views over the ground you have to cross
    var best = null, bs = -1;
    for (var i = 0; i < 500; i++) {
      var o = objs[i % objs.length], a = Math.random() * 6.28, d = 70 + Math.random() * 110, x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d, c = cellOf(x, y);
      if (blocked(tankBlock, c[0], c[1]) || dist({ x: x, y: y }, from) < dist(o, from) + 30) continue;
      var w = centre(c[0], c[1]), sc = 0;
      for (var t = 0; t <= 1; t += 0.2) { var px = o.x + (from.x - o.x) * t, py = o.y + (from.y - o.y) * t; if (seeLine(w[0], w[1], px, py)) sc++; }
      if (sc > bs) { bs = sc; best = { x: w[0], y: w[1] }; }
    }
    return best;
  }
  function eastEntries(to) {
    // ways in along the east edge that reach the crossroads: north, centre and south
    var out = [];
    for (var y = -300; y <= 300; y += 50) {
      var c = nearestOpen(block, cellOf(345, y)); if (!c) continue;
      var w = centre(c[0], c[1]); if (path(block, w, [to.x, to.y])) out.push({ x: w[0], y: w[1] });
    }
    if (!out.length) return { north: ENTRY, centre: ENTRY, south: ENTRY };
    out.sort(function (a, b) { return a.y - b.y; });
    var mid = out.slice().sort(function (a, b) { return Math.abs(a.y - ENTRY.y) - Math.abs(b.y - ENTRY.y); })[0];
    return { north: out[0], centre: mid, south: out[out.length - 1] };
  }

  // ---- Hedgerows: the farm and the crossroads
  function germanHedgerows(xroads) {
    var f = forcedPlan(), d = diffName(), start = { x: RALLY.x, y: RALLY.y };
    var P = PLAN = {
      posture: pickW({ farm: 1, forward: 1, depth: 1 }, f({ farm: 1, forward: 1, depth: 1 })),
      mg: pickW({ crossroads: 1.2, farm: 1 }, f({ 'mg-crossroads': 1, 'mg-farm': 1 }) && f({ 'mg-crossroads': 1, 'mg-farm': 1 }).slice(3)),
      reserve: pickW({ none: 1, reserve: d === 'easy' ? 0.5 : 1.2 }, f({ reserve: 1 }) ? 'reserve' : f({ noreserve: 1 }) ? 'none' : null),
      axis: pickW({ north: 1, centre: 1.3, south: 1 }, f({ north: 1, centre: 1, south: 1 })),
      tempo: pickW({ massed: 1, echelon: 1 }, f({ massed: 1, echelon: 1 })),
      feint: f({ feint: 1 }) ? true : f({ nofeint: 1 }) ? false : Math.random() < 0.4,
      armour: pickW(d === 'easy' ? { none: 1 } : d === 'hard' ? { counter: 1, overwatch: 1 } : { none: 0.3, counter: 0.4, overwatch: 0.3 }, f({ noarmour: 1 }) ? 'none' : f({ counter: 1, overwatch: 1 })),
      entries: eastEntries(xroads), log: [] };
    var farmToStart = Math.atan2(start.y - OBJ.y, start.x - OBJ.x);
    // the farm garrison: two squads, by posture
    var g1 = OBJ, g2 = OBJ;
    if (P.posture === 'forward') g1 = pickSpot(function (q) { return dist(q, OBJ) > 45 && dist(q, OBJ) < 90 && dist(q, start) < dist(OBJ, start) - 25 && dist(q, start) > 110; }, true) || OBJ;
    if (P.posture === 'depth') g2 = pickSpot(function (q) { return dist(q, OBJ) > 35 && dist(q, OBJ) < 75 && dist(q, start) > dist(OBJ, start) + 10; }, true) || OBJ;
    var sq = LEVEL.squads;
    placeSquad('Gruppe 1', g1 === OBJ ? { x: sq[0][0], y: sq[0][1] } : g1, 5, 2, farmToStart);
    placeSquad('Gruppe 2', g2 === OBJ ? { x: sq[1][0], y: sq[1][1] } : g2, 5, 2, farmToStart);
    P.g1 = g1; P.g2 = g2;
    // the crossroads: a smaller squad, and the MG42 at whichever point gets it
    placeSquad('Gruppe 4', xroads, 4, 1);
    P.mgSite = P.mg === 'farm' ? placeMG('MG 1', OBJ, start, 30) : placeMG('MG 1', xroads, OBJ, 28);
    // a reserve held back behind the crossroads, out of sight; it goes in when a point is lost
    if (P.reserve === 'reserve') {
      var rs = pickSpot(function (q) { return dist(q, xroads) > 45 && dist(q, xroads) < 110 && dist(q, start) > dist(xroads, start) + 30; }, true);
      if (rs) { P.reserveAt = rs; placeSquad('Gruppe 3', rs, 4, 1).forEach(function (s) { s.reserve = true; }); } else P.reserve = 'none';
    }
    // an assault gun dug in to cover the approaches, holding its fire until your tanks come within 350 m
    if (P.armour === 'overwatch') {
      var ow = overwatchSite(OBJS, start);
      if (ow) { var s = stug(ow.x, ow.y, 'StuG 1'); spawnStug.n = 1; s.h = Math.atan2(start.y - ow.y, start.x - ow.x); s.dugIn = true; s.engage = 350; s.goal = null; units.push(s); P.stugAt = ow; }
      else P.armour = 'counter';
    }
    hedgerowsIntel(P, xroads, start);
  }
  function counterPlan() {
    // at the moment of the counter-attack: the commander puts the main effort against whichever point his men have
    // seen held more thinly, coming in by the way in nearest it, unless his plan already named a way in
    var P = PLAN; if (!P) return { entry: ENTRY, main: 0 };
    var seen = team('allies').filter(function (a) { return clock - (a.seenByAxis || -99) < 120; });
    var held = OBJS.map(function (o) { return seen.filter(function (a) { return dist(a, o) < 70; }).length + (o.owner === 'allies' ? 0 : -5); });
    var main = held[0] <= held[1] ? 0 : 1, entry = P.entries[P.axis] || ENTRY;
    P.log.push('The counter-attack went in ' + (P.tempo === 'echelon' ? 'in two waves ' : '') + 'from the ' + (P.axis === 'centre' ? 'east, along the lane' : P.axis + '-east') + ', its main effort at the ' + OBJS[main].name + (seen.length ? ', which his men had seen held more thinly' : '') + '.');
    return { entry: entry, main: main };
  }
  function feint() {
    // a few men from another way in open fire on the far flank just before the real attack, to draw your eye
    var P = PLAN; if (!P || !P.feint || P.feinted) return; P.feinted = true;
    var other = P.axis === 'north' ? P.entries.south : P.entries.north, o = OBJS[P.axis === 'north' ? 1 : 0];
    if (!other) return;
    var spot = mgSpot(o, other);
    for (var k = 0; k < 3; k++) {
      var c = nearestOpen(block, cellOf(other.x - k * 2.5, other.y + k)), w = centre(c[0], c[1]);
      var s = soldier(w[0], w[1], 'axis', 'rifle', 'Gruppe 8', k === 0 ? 'nco' : 'rifle'); s.engaged = true;
      s.goal = { x: spot.x + k * 2, y: spot.y }; units.push(s); order(s, s.goal.x, s.goal.y);
    }
    P.log.push('A few men opened fire from the other flank first, to draw your attention.');
  }
  function commanderUpdate() {
    // reconsidering: these are the moments a commander changes his plan
    var P = PLAN; if (!P || MISSION.id !== 'hedgerows') return;
    if (phase === 'warning' && P.feint) feint();
    if (P.echelonAt && clock > P.echelonAt) { P.echelonAt = 0; counterWave(P.second, P.secondEntry, P.secondGoal); say('More Germans coming in from the east!'); }
    // the overwatch gun opens up early if your armour drives into its arc, and keeps still otherwise
    // a point lost: the reserve goes in at once
    if (!P.reserveIn && P.reserve === 'reserve' && OBJS.some(function (o) { return o.owner === 'allies'; })) {
      P.reserveIn = true; var o = OBJS.filter(function (x) { return x.owner === 'allies'; })[0];
      units.forEach(function (s) { if (s.reserve && alive(s)) { s.reserve = false; s.goal = { x: o.x + (Math.random() - .5) * 14, y: o.y + (Math.random() - .5) * 14 }; order(s, s.goal.x, s.goal.y); } });
      P.log.push('His reserve, held back behind the crossroads, went straight in when you took the ' + o.name + '.');
    }
    // the farm garrison badly hurt before the counter-attack: what's left pulls back to the crossroads
    if (!P.pulledBack && phase === 'attack') {
      var farm = units.filter(function (s) { return s.side === 'axis' && /^Gruppe [12]$/.test(s.squad); }), left = farm.filter(alive);
      if (farm.length && left.length <= 3 && left.length > 0 && OBJS[1].owner !== 'allies') {
        P.pulledBack = true; left.forEach(function (s) { s.retreating = true; s.fallback = true; s.goal = null; order(s, OBJS[1].x + (Math.random() - .5) * 16, OBJS[1].y + (Math.random() - .5) * 16); });
        P.log.push('When the farm garrison was down to ' + words(left.length).toLowerCase() + ' men, he pulled them back to the crossroads.');
        if (left.some(function (s) { return clock - s.seenT < 3; })) say('The Germans are pulling back from the farm towards the crossroads.');
      }
    }
  }

  // ---- the intelligence file: drawn from the plan, filtered and fuzzed
  var SOURCES = { air: 'Air reconnaissance, last evening', patrol: 'Patrol report, 0400', civ: 'French civilian', div: 'Divisional intelligence summary', para: 'Paratroopers you found', pow: 'Prisoners', scouts: 'Your scouts' };
  function intel(src, text, sure) { INTEL.push({ src: src, text: text, sure: sure || 'unconfirmed', t: started ? clock : null }); }
  function strengthWords(n) {
    // never a count: a range around it, in the words a report would use
    var lo = Math.max(2, Math.round(n * (0.6 + Math.random() * 0.2))), hi = Math.round(n * (1.2 + Math.random() * 0.4));
    return (n >= 9 ? 'about a platoon' : n >= 5 ? 'a reinforced section' : 'a section') + ', perhaps ' + lo + ' to ' + hi + ' men';
  }
  function hedgerowsIntel(P, xroads, start) {
    var farmMen = units.filter(function (s) { return s.side === 'axis' && dist(s, OBJ) < 110; }).length;
    var lie = function (p) { return Math.random() < p; };
    intel('div', 'The enemy holds the farm and the crossroads east of it, in ' + strengthWords(farmMen + 6) + ' in all.', 'probable');
    intel(P.posture === 'forward' ? 'patrol' : 'air',
      P.posture === 'forward' ? 'Movement seen in the hedges on the near side of the farm. Some of the garrison may be holding forward of the buildings.'
        : P.posture === 'depth' ? 'Fresh digging seen behind the farm, towards the crossroads. The position may have some depth.'
          : 'Slit trenches seen around the farmhouse and its outbuildings. The enemy appears dug in at the buildings.', P.posture === 'forward' ? 'fairly reliable' : 'probable');
    var mgReal = P.mg, mgSaid = lie(0.25) ? (mgReal === 'farm' ? 'crossroads' : 'farm') : mgReal;
    intel('patrol', 'An MG42 was heard firing from the direction of the ' + mgSaid + ' during the night.', 'unconfirmed');
    if (P.reserve === 'reserve' && !lie(0.4)) intel('civ', 'Germans seen resting in an orchard beyond the crossroads yesterday. They may be a reserve.', 'doubtful');
    intel('div', 'Expect a counter-attack from the east once you are on the objectives.', 'probable');
    var ax = lie(0.4) ? ['north', 'centre', 'south'][Math.floor(Math.random() * 3)] : P.axis;
    if (Math.random() < 0.6) intel('civ', 'Troops seen gathering ' + (ax === 'centre' ? 'along the lane to the east' : 'to the ' + ax + '-east') + ' this morning.', 'doubtful');
    if (P.armour === 'counter') intel(lie(0.3) ? 'civ' : 'patrol', 'Tracked vehicles heard moving east of the crossroads last night.', 'unconfirmed');
    else if (P.armour === 'overwatch') { if (!lie(0.4)) intel('air', 'A possible assault gun position behind the objectives. It may cover the open ground.', 'unconfirmed'); }
    else if (lie(0.3)) intel('civ', 'A tank seen on the road to the east two days ago.', 'doubtful');   // a false alarm
    intel('div', 'Elements of the 101st Airborne are believed to be cut off in this area since the drop.', 'probable');
  }
  function gulchIntel(main) {
    intel('div', 'The enemy is expected to attack towards Carentan today with infantry and assault guns.', 'probable');
    var said = Math.random() < 0.35 ? (main === 'west' ? 'south' : 'west') : main;
    intel('air', 'Columns seen moving up on the ' + said + ' side at first light.', 'fairly reliable');
    intel('div', 'Small groups of our paratroopers may still be cut off beyond your lines.', 'probable');
  }
  // things learned during the battle
  function intelEvent(kind, u) {
    if (kind === 'mg' && !intelEvent.mg) { intelEvent.mg = true; var near = OBJS.slice().sort(function (a, b) { return dist(a, u) - dist(b, u); })[0]; intel('scouts', 'Confirmed: an MG42 near the ' + near.name + '.', 'confirmed'); }
    if (kind === 'stug' && !intelEvent.stug) { intelEvent.stug = true; intel('scouts', 'Confirmed: a StuG assault gun is in the area.', 'confirmed'); }
    if (kind === 'para') {
      // the paratroopers have been watching for days: they know where something is
      var foes = team('axis').filter(function (s) { return clock - s.seenT > 20 && (s.role === 'mg' || isTank(s) || s.role === 'nco'); });
      foes.sort(function (a, b) { return dist(a, u) - dist(b, u); });
      var f = foes[0]; if (!f) return;
      var what = isTank(f) ? 'an assault gun dug in' : f.role === 'mg' ? 'a machine gun' : 'Germans dug in';
      var o = OBJS.slice().sort(function (a, b) { return dist(a, f) - dist(b, f); })[0];
      intel('para', 'They say there is ' + what + ' ' + compass(f.x - o.x, f.y - o.y) + ' of the ' + o.name + '. They have watched it for two days.', 'fairly reliable');
      heard.push({ x: f.x + (Math.random() - .5) * 20, y: f.y + (Math.random() - .5) * 20, t: clock, kind: 'cricket' });
      say('The paratroopers report ' + what + ' ' + compass(f.x - o.x, f.y - o.y) + ' of the ' + o.name + '. Added to the intelligence file.');
    }
    if (kind === 'pow' && PLAN && !intelEvent.pow) {
      intelEvent.pow = true; var P = PLAN;
      var t = MISSION.id === 'hedgerows' ? (phase === 'attack' ? 'the counter-attack will come from the ' + (P.axis === 'centre' ? 'east along the lane' : P.axis + '-east') : '') + (P.armour !== 'none' && (!started || phase === 'attack') ? (phase === 'attack' ? ', and ' : '') + 'there is an assault gun with them' : '')
        : 'the main attack is coming from the ' + P.main;
      if (t) { intel('pow', 'Prisoners say ' + t + '.', 'fairly reliable'); say('Prisoners say ' + t + '. Added to the intelligence file.'); }
    }
  }
  function intelHTML() {
    var sure = { confirmed: '#9FC2E6', 'fairly reliable': '#CFC9B8', probable: '#CFC9B8', unconfirmed: '#E2B25A', doubtful: '#E0A84A' };
    return INTEL.map(function (r) {
      return '<div class="intel"><span class="src">' + SOURCES[r.src] + (r.t !== null ? ' · ' + mmss(r.t) : '') + ' · <i style="color:' + (sure[r.sure] || '#CFC9B8') + '">' + r.sure + '</i></span>' + r.text + '</div>';
    }).join('');
  }
  function planReveal() {
    // after the battle: what the German commander actually did
    var P = PLAN; if (!P) return '';
    var t = [];
    if (MISSION.id === 'hedgerows') {
      t.push({ farm: 'He held both farm squads at the buildings.', forward: 'He put one squad forward in the hedges on your side of the farm, the other at the buildings.', depth: 'He held the farm with one squad and put the other behind it, towards the crossroads.' }[P.posture]);
      t.push('His MG42 was at the ' + P.mg + '.');
      if (P.reserve === 'reserve') t.push('He kept a reserve squad behind the crossroads.');
      t.push({ none: 'He had no armour.', counter: 'His assault gun came up with the counter-attack.', overwatch: 'His assault gun was dug in behind the objectives from the start.' }[P.armour]);
    } else t.push('His main effort came from the ' + P.main + '; the first wave from the ' + (P.main === 'west' ? 'south' : 'west') + ' was meant to draw you that way.');
    return t.concat(P.log).join(' ');
  }
