
  // ------------------------------------------------------------------ scattered paratroopers
  // The 101st Airborne dropped all over the Cotentin on the night of 5 June, and for days afterwards small groups were
  // still out in the bocage: hiding in a hedge, cut off and fighting, carrying their wounded, or taken prisoner. Find
  // one and it joins you. You can't see them until you do; get close and you may hear the click of their toy
  // crickets, the drop-night recognition signal. In the campaign they stay with you, in place of most replacements.
  var STRAYS = [];   // one entry a group: { name, kind, x, y, men, found, guards }
  var STRAY_WHY = {
    hidden: 'lying up in a hedgerow since the drop',
    wounded: 'carrying their wounded, out of morphine',
    surrounded: 'cut off and fighting',
    captive: 'held prisoner by the Germans' };
  function airborneName() {
    var n = 0; Object.keys(ROSTER.squads).concat(STRAYS.map(function (g) { return g.name; })).forEach(function (k) { var m = /^Airborne (\d+)/.exec(k); if (m) n = Math.max(n, +m[1]); });
    return 'Airborne ' + (n + 1);
  }
  function nearHedge(c) {
    // an open cell with a hedge beside it: where a man would lie up
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) { var r = c[1] + dr, cc = c[0] + dc; if (r >= 0 && cc >= 0 && r < G && cc < G && hedgeCell[r * G + cc]) return true; }
    return false;
  }
  function pickSpot(ok, hedge) {
    // a random open spot meeting `ok`, preferring one tucked against a hedge
    var spare = null;
    for (var i = 0; i < 600; i++) {
      var x = (Math.random() - .5) * HALF * 1.7, y = (Math.random() - .5) * HALF * 1.7, c = cellOf(x, y);
      if (blocked(block, c[0], c[1])) continue;
      var w = centre(c[0], c[1]), p = { x: w[0], y: w[1] };
      if (!ok(p)) continue;
      if (!hedge || nearHedge(c)) return p;
      spare = spare || p;
    }
    return spare;
  }
  function farFrom(p, list, r) { return list.every(function (q) { return dist(p, q) > r; }); }
  function placeStrays(kinds) {
    // kinds: which groups this mission has. They go out beyond your start line, away from the German positions,
    // except the cut-off group, which is close to the Germans and needs help soon.
    var mine = team('allies'), germans = team('axis'), start = mine[0] || { x: 0, y: 0 };
    kinds.forEach(function (kind) {
      var p = null, n = kind === 'captive' ? 3 : kind === 'surrounded' ? 5 : 4;
      if (kind === 'surrounded') p = pickSpot(function (q) { var g = germans.filter(function (s) { return dist(s, q) < 75; }); return g.length && farFrom(q, germans, 45) && dist(q, start) > 120 && farFrom(q, mine, 90); }, true);
      else if (kind === 'captive') {
        var hs = LEVEL.houses.map(function (h) { return { x: h[0], y: h[1] }; }).filter(function (h) { return dist(h, start) > 140 && farFrom(h, OBJS, 80) && farFrom(h, mine, 100); });
        var h = hs[Math.floor(Math.random() * hs.length)];
        if (h) { var hc = nearestOpen(block, cellOf(h.x, h.y)); if (hc) { var hw = centre(hc[0], hc[1]); p = { x: hw[0], y: hw[1] }; } }
      } else p = pickSpot(function (q) { return dist(q, start) > 110 && dist(q, start) < 260 && farFrom(q, germans, 90) && farFrom(q, mine, 90) && farFrom(q, STRAYS, 80); }, true);
      if (!p) return;
      var g = { name: airborneName(), kind: kind, x: p.x, y: p.y, men: [], found: false, guards: [] };
      for (var k = 0; k < n; k++) {
        var c = nearestOpen(block, cellOf(p.x + (k % 3) * 1.6 - 1.6, p.y + Math.floor(k / 3) * 1.6)) || cellOf(p.x, p.y), w = centre(c[0], c[1]);
        var e = newMan(k === 0 ? (Math.random() < 0.5 ? 'Sgt.' : 'Cpl.') : 'Pvt.', ROSTER); e.para = true;
        var u = soldier(w[0], w[1], 'allies', 'para', g.name, e.rank === 'Sgt.' ? 'nco' : 'rifle');
        u.man = e; u.stray = g; u.lowAmmo = true; u.heart = Math.min(100, u.heart + 8); u.morale = u.heart * 0.8; u.vet = 1;   // they've been fighting for days
        if (kind === 'hidden' || kind === 'wounded') { u.hold = true; u.pose = 'prone'; }
        if (kind === 'wounded' && k > 0 && k < 3) { u.hp = 45; u.wounded = true; }
        if (kind === 'captive') { u.captive = true; u.pose = 'idle'; }
        units.push(u); g.men.push(u);
      }
      if (kind === 'captive') {
        // two guards on them, at the door
        for (var j = 0; j < 2; j++) {
          var gc = nearestOpen(block, cellOf(p.x + 4 + j * 2, p.y - 3)) || cellOf(p.x, p.y), gw = centre(gc[0], gc[1]);
          var s = soldier(gw[0], gw[1], 'axis', 'rifle', 'Wache ' + g.name.split(' ')[1], j ? 'rifle' : 'nco'); s.h = Math.atan2(p.y - s.y, p.x - s.x); units.push(s); g.guards.push(s);
        }
      }
      STRAYS.push(g);
    });
  }
  function straysUpdate() {
    STRAYS.forEach(function (g) {
      if (g.found) return;
      var men = g.men.filter(alive); if (!men.length) { g.found = true; g.lost = true; return; }
      var c = men[0], finders = team('allies').filter(function (a) { return !a.stray && !a.riding; });
      var near = finders.filter(function (a) { var d = dist(a, c); return d < 25 || (d < (a.role === 'scout' ? 60 : 40) && seeLine(a.x, a.y, c.x, c.y)); })[0];   // close enough to call out to
      var guarded = g.guards.some(function (s) { return alive(s) && !s.broken && dist(s, c) < 40; });
      if (near && !guarded) return foundStrays(g, men, near);
      // within earshot: they click their crickets to see if you're friendly
      var ear = finders.filter(function (a) { return dist(a, c) < 100; })[0];
      if (ear && !guarded && clock - (g.clickT || -99) > 7 + Math.random() * 4) {
        g.clickT = clock; sound.cricket(c.x, c.y);
        heard.push({ x: c.x + (Math.random() - .5) * 16, y: c.y + (Math.random() - .5) * 16, t: clock, kind: 'cricket' });
        if (!g.heardSaid) { g.heardSaid = true; say('A cricket clicking out ' + compass(c.x - ear.x, c.y - ear.y) + ' of ' + (isTank(ear) ? ear.name : squadName(ear)) + '. Paratroopers? Go and find them.'); }
      }
    });
  }
  function foundStrays(g, men, by) {
    g.found = true;
    men.forEach(function (u) { u.stray = null; u.captive = false; u.hold = false; u.arrive = true; });
    var sgt = men.filter(function (u) { return u.role === 'nco'; })[0] || men[0];
    say((isTank(by) ? by.name : squadName(by)) + ' has found ' + words(men.length).toLowerCase() + ' men of the 101st Airborne, ' + STRAY_WHY[g.kind] + '. '
      + manLabel(sgt.man) + ' and his men will fight with you as ' + g.name + ', but they’re short of ammunition: the rally point or a Sherman can top them up.');
    toast('Paratroopers found', men[0].x, men[0].y);
    tally.parasFound = (tally.parasFound || 0) + men.length;
    intelEvent('para', men[0]);
  }
  function rearmMen(u) {
    // paratroopers short of ammunition get it from the rally point, or from a halted Sherman's stowage close by
    if (!u.lowAmmo || u.stray) return;
    var at = dist(u, RALLY) < 28 || team('allies').some(function (t) { return isTank(t) && !t.path && dist(t, u) < 7; });
    if (!at) { u.ammoT = 0; return; }
    u.ammoT = (u.ammoT || 0) + 1 / 20;
    if (u.ammoT > 4) { u.lowAmmo = false; if (!squadOf(u).some(function (m) { return m.lowAmmo; })) say(u.squad + ' has ammunition again.'); }
  }
  function spawnAirborne(at) {
    // in the campaign: the paratroopers who joined you in an earlier battle
    Object.keys(ROSTER.squads).filter(function (k) { return /^Airborne/.test(k) && ROSTER.squads[k].length; }).forEach(function (k, i) {
      spawnSquadAt(k, function (m) { return at(i, m); });
    });
  }
  function airborneJoin(notes) {
    // after a won battle: the groups you found, and who's left of them, join the roster
    var joined = 0;
    STRAYS.forEach(function (g) {
      if (!g.found || g.lost) return;
      var left = g.men.filter(function (u) { return u.hp > 0; }); if (!left.length) return;
      ROSTER.squads[g.name] = left.map(function (u) { u.man.vet = u.vet; u.man.kills = u.kills; u.man.missions++; return u.man; });
      joined += left.length;
    });
    if (joined) notes.airborne = joined;
    return joined;
  }
