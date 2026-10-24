
  // ------------------------------------------------------------------ the mission: take the farm and the crossroads, then hold them
  // Infantry take a point by standing on it with no Germans close; it takes about 12 seconds. Once both are yours
  // (or eight minutes have gone), the Germans counter-attack from the east with two squads and an MG42, 2nd Squad
  // comes up to help, and you have to hold both points for four minutes until relieved.
  var OBJS = [], phase = 'attack', phaseT = 0, holdUntil = 0, ENTRY, reinforced = false;
  function captureUpdate(dt) {
    // infantry take a point by standing on it with nobody from the other side close
    OBJS.forEach(function (o) {
      var mine = units.filter(function (u) { return u.kind === 'inf' && u.side === 'allies' && alive(u) && !u.riding && u.role !== 'crew' && dist(u, o) < o.r; }).length;
      var theirs = units.filter(function (u) { return u.kind === 'inf' && u.side === 'axis' && alive(u) && dist(u, o) < o.r; }).length;
      var was = o.owner;
      if (mine && !theirs) o.prog = Math.min(1, o.prog + dt / 12);
      else if (theirs && !mine) o.prog = Math.max(-1, o.prog - dt / 12);
      o.contested = !!(mine && theirs);
      if (o.prog >= 1) o.owner = 'allies'; else if (o.prog <= -1) o.owner = 'axis'; else if (Math.abs(o.prog) < 0.02) o.owner = null;
      if (o.owner === 'allies') o.everOurs = true;
      if (o.owner !== was && o.owner) { say(o.owner === 'allies' ? 'The ' + o.name + ' is ours.' : 'The Germans have taken back the ' + o.name + '!'); if (o.owner === 'allies') gegenstoss(o); }
    });
  }
  function hedgerowsUpdate(dt) {
    captureUpdate(dt);
    commanderUpdate();
    var held = OBJS.every(function (o) { return o.owner === 'allies'; });
    if (!reinforced && (OBJS[0].owner === 'allies' || clock > 300)) bringUpSecond();
    if (phase === 'attack' && clock > 360 && !hedgerowsUpdate.warned && !held) { hedgerowsUpdate.warned = true; say('Two minutes until the Germans are expected to counter-attack. Take the ' + OBJS.filter(function (o) { return o.owner !== 'allies'; }).map(function (o) { return o.name; }).join(' and the ') + ' before then.'); }
    if (phase === 'attack' && (held || clock > 480 || !team('axis').length)) {
      phase = 'warning'; phaseT = clock + 30;
      say('Engine noise and movement to the east: the Germans are counter-attacking. Dig in at the farm and the crossroads.');
    } else if (phase === 'warning' && clock > phaseT) {
      phase = 'counter'; holdUntil = clock + 240; counterAttack();
    } else if (phase === 'counter' && !over) {
      if (clock > holdUntil) {
        if (held) end('Held until relieved', 'Both the farm and the crossroads are still yours when the relief comes up the lane. ' + summary(), true);
        else { var miss = OBJS.filter(function (o) { return o.owner !== 'allies'; }), never = miss.filter(function (o) { return !o.everOurs; });
          end('Pushed back', (never.length ? 'You hadn’t taken the ' + never.map(function (o) { return o.name; }).join(' or the ') + ' when the relief arrived. ' : 'When the relief arrives, the Germans have the ' + miss.map(function (o) { return o.name; }).join(' and the ') + ' back. ') + summary(), false); }
      } else if (!team('axis').filter(function (s) { return !/^Wache/.test(s.squad); }).length && held) end('Counter-attack beaten off', 'Every German who came at you is dead, captured or gone, and both points are yours. ' + summary(), true);
    }
  }
  function counterAttack() {
    // the commander's counter-attack: rifle squads and an MG42 team by the way in he chose, the main effort at the
    // point his men saw held more thinly; all at once or in two waves. 2nd Squad comes up the lane behind you.
    var cp = counterPlan(); ENTRY = cp.entry;
    var main = OBJS[cp.main], goals = [main, OBJS[1 - cp.main]];
    var names = ['Gruppe 5', 'Gruppe 6', 'Gruppe 7'].slice(0, Math.max(1, DIFF.waves - (PLAN && PLAN.reserve === 'reserve' ? 1 : 0)));
    if (PLAN && PLAN.tempo === 'echelon' && names.length > 1) { PLAN.second = names.slice(1); PLAN.secondEntry = ENTRY; PLAN.secondGoal = goals; PLAN.echelonAt = clock + 60; names = names.slice(0, 1); }
    counterWave(names, ENTRY, goals);
    var cr = main, spot = mgSpot(cr, ENTRY);
    for (var j = 0; j < 2; j++) {
      var c2 = nearestOpen(block, cellOf(ENTRY.x - 30 - j * 2, ENTRY.y)), w2 = centre(c2[0], c2[1]);
      var g = soldier(w2[0], w2[1], 'axis', j ? 'rifle' : 'mg42', 'MG 2', j ? 'loader' : 'mg');
      g.goal = { x: spot.x + j * 1.5, y: spot.y + j * 1.5 }; units.push(g); order(g, g.goal.x, g.goal.y);
    }
    // the StuG, if the plan brings it up with the counter-attack: on Normal it waits at the end of the lane for the
    // infantry to go in first; on Hard it comes straight on
    var sg = PLAN && PLAN.armour === 'counter' && spawnStug(main); if (sg && diffName() === 'normal') sg.wait0 = clock + 100;
    if (!reinforced) bringUpSecond();
    say('Hold the farm and the crossroads for four minutes.');
  }
  function counterWave(names, entry, goals) {
    names.forEach(function (name, si) {
      var goal = goals[si % goals.length], via = si % 2 ? flankPoint(entry, goal) : null;   // every other squad comes round the flank
      for (var k = 0; k < 5; k++) {
        var c = nearestOpen(block, cellOf(entry.x - si * 14 - k * 2.5, entry.y + (k % 2) * 3)), w = centre(c[0], c[1]);
        var s = soldier(w[0], w[1], 'axis', 'rifle', name, k === 0 ? 'pf' : k === 4 ? 'nco' : 'rifle');
        s.goal = { x: goal.x + (Math.random() - .5) * 16, y: goal.y + (Math.random() - .5) * 16 }; s.via = via; units.push(s); order(s, (via || s.goal).x, (via || s.goal).y);
      }
    });
  }
  function bringUpSecond() {
    // 2nd Squad: more riflemen up the lane from the rally point
    spawnSquadAt('2nd Squad', function (m) { return [RALLY.x + (m % 4) * 2, RALLY.y + Math.floor(m / 4) * 2]; });
    charges['2nd Squad'] = 1; reinforced = true;
    say('2nd Squad has come up the lane behind you, at the rally point.');
  }
  function siteGun(near, toward, reach) {
    // where a gun crew would set up: the open spot within reach of `near` with the longest clear views towards `toward`
    var c0 = cellOf(near.x, near.y), R = Math.round(reach / CELL), best = null, bestScore = -1;
    var base = Math.atan2(toward.y - near.y, toward.x - near.x);
    for (var dr = -R; dr <= R; dr += 2) for (var dc = -R; dc <= R; dc += 2) {
      if (dc * dc + dr * dr > R * R || blocked(block, c0[0] + dc, c0[1] + dr)) continue;
      var w = centre(c0[0] + dc, c0[1] + dr), score = 0, bestA = base, bestD = 0;
      for (var a = -0.8; a <= 0.81; a += 0.16) {
        var d = 10; while (d < 200 && seeLine(w[0], w[1], w[0] + Math.cos(base + a) * d, w[1] + Math.sin(base + a) * d)) d += 10;
        score += d; if (d > bestD) { bestD = d; bestA = base + a; }
      }
      if (score > bestScore) { bestScore = score; best = { x: w[0], y: w[1], h: bestA }; }
    }
    return best || { x: near.x, y: near.y, h: base };
  }
  function mgSpot(obj, from) {
    // somewhere 70 to 110 m out from the objective, towards where the gun comes from, that can see the objective
    var dx = from.x - obj.x, dy = from.y - obj.y, l = Math.sqrt(dx * dx + dy * dy); dx /= l; dy /= l;
    for (var d = 110; d >= 50; d -= 6) for (var s = -20; s <= 20; s += 10) {
      var x = obj.x + dx * d - dy * s, y = obj.y + dy * d + dx * s, c = cellOf(x, y);
      if (!blocked(block, c[0], c[1]) && seeLine(x, y, obj.x, obj.y)) return { x: x, y: y };
    }
    return { x: obj.x + dx * 60, y: obj.y + dy * 60 };
  }
  function drawObjectives() {
    OBJS.forEach(function (o) {
      var q = proj(o.x, o.y, 0), X = q[0] - view.x, Y = q[1] - view.y, rx = o.r / CAM.mPerPx, ry = rx * CAM.up[2];
      if (X < -rx || X > VW + rx || Y < -ry - 80 || Y > VH + ry) return;
      var col = o.owner === 'allies' ? '120,170,230' : o.owner === 'axis' ? '214,80,60' : '220,215,200';
      ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(' + col + ',.7)';
      ctx.beginPath(); ctx.ellipse(X, Y, rx, ry, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      // a flag on a pole, and how far the capture has gone
      var top = proj(o.x, o.y, 5)[1] - view.y;
      ctx.strokeStyle = 'rgba(237,232,218,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, top); ctx.stroke();
      ctx.fillStyle = 'rgba(' + col + ',.95)'; ctx.beginPath(); ctx.moveTo(X, top); ctx.lineTo(X + 26, top + 7); ctx.lineTo(X, top + 14); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(X - 30, top - 14, 60, 5);
      ctx.fillStyle = o.prog >= 0 ? '#9FC2E6' : '#E0604A'; ctx.fillRect(o.prog >= 0 ? X : X + o.prog * 30, top - 14, Math.abs(o.prog) * 30, 5);
      ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(237,232,218,.95)';
      ctx.fillText((o.contested ? 'Contested: ' : '') + o.label, X, top - 20);
    });
  }
  function hedgerowsText() {
    var s = OBJS.map(function (o) { return o.label + ' ' + (o.contested ? 'contested' : o.owner === 'allies' ? 'yours' : o.owner === 'axis' ? 'German' : 'no one’s'); }).join(' · ');
    if (phase === 'attack') return 'Take the farm and the crossroads. ' + s;
    if (phase === 'warning') return 'Counter-attack coming in ' + Math.ceil(phaseT - clock) + ' s. ' + s;
    var left = Math.max(0, holdUntil - clock);
    return 'Hold both until relieved: ' + Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2) + '. ' + s;
  }

  // ------------------------------------------------------------------ the MG42
  // A two-man team. It can only fire once it's down behind the gun (three seconds to set up after stopping), but then it
  // fires 20 rounds a second, pinning everything in a long stretch of hedge. Without the loader it fires much less.
  function mgUpdate(u, dt, tgt) {
    if (u.path) { u.setup = 0; return false; }
    u.setup = (u.setup || 0) + dt;
    if (u.setup < 3) { u.pose = 'prone'; if (tgt) turnTo(u, Math.atan2(tgt.y - u.y, tgt.x - u.x), 2, dt); return true; }
    u.pose = 'aim';
    if (u.relocate) { mgMove(u, 'under fire'); return true; }   // shells or a tank's MG close: get out before the next one
    if (!tgt) return true;
    turnTo(u, Math.atan2(tgt.y - u.y, tgt.x - u.x), 1.5, dt);
    if (u.shot > 0) return true;
    var loader = units.some(function (v) { return v.role === 'loader' && v.squad === u.squad && alive(v) && dist(v, u) < 8; });
    u.shot = (1.2 + Math.random() * 0.8) * (loader ? 1 : 1.8); u.fired = 0.35; u.lastFired = clock; u.engaged = true;
    u.bursts = (u.bursts || 0) + 1;
    if (u.relocate || u.bursts > 7 + Math.random() * 5) { mgMove(u, u.relocate ? 'under fire' : ''); return true; }
    tracer(u, tgt, 'rgba(255,200,120,.85)'); muzzle(u); sound.mg42(u);
    if (clock - u.seenT > 1.5) hear(u, 'mg');
    if (tgt.kind === 'tank') { fx.push({ t: 0, life: .2, x: tgt.x, y: tgt.y, kind: 'spark' }); return true; }
    var d = dist(u, tgt);
    units.forEach(function (o) {
      if (o.kind !== 'inf' || o.side === u.side || !alive(o)) return;
      var e = dist(o, tgt);
      if (e < 7) { suppress(o, e < 1 ? 38 : 20, u); if (Math.random() < 0.16 * DIFF.acc * Math.max(0.25, 1 - d / 300) * (e < 1 ? 1 : 0.35) * exposure(o, u, 'bullet')) killed(o, u); }
    });
    return true;
  }

  // ------------------------------------------------------------------ artillery: 105 mm, a few fire missions per game
  // Someone has to be able to see the spot. A ranging round lands first, wide; then six rounds for effect over eight
  // seconds. Smoke missions lay four big smoke shells. Shells don't care whose men are underneath.
  var arty = { he: 3, smoke: 2 }, missions = [];
  function callArty(x, y, kind) {
    if (!arty[kind]) { say('No ' + (kind === 'he' ? 'artillery' : 'smoke') + ' fire missions left.'); return; }
    var p = { x: x, y: y }, reach = sightRange() + 120;   // binoculars: a little further than you can pick out men
    var eyes = team('allies').filter(function (u) { return u.role !== 'crew' && dist(u, p) < reach && seeLine(u.x, u.y, x, y); });
    var wide = eyes.length ? 1 : 2;   // nobody watching to correct the fall of shot: fired off the map, twice as scattered
    arty[kind]--;
    var m = { x: x, y: y, kind: kind, t: clock, shells: [], wide: wide };
    if (kind === 'he') { m.shells.push({ t: clock + 14, spread: 30 * wide }); for (var i = 0; i < 6; i++) m.shells.push({ t: clock + 21 + i * 1.4 + Math.random() * 0.5, spread: 15 * wide }); }
    else for (var j = 0; j < 4; j++) m.shells.push({ t: clock + 15 + j * 0.8, spread: 18 * wide });
    missions.push(m);
    var close = team('allies').some(function (u) { return dist(u, p) < 45; });
    say((kind === 'he' ? 'Fire mission: 105 mm on the way, about 20 seconds.' : 'Smoke mission on the way, about 15 seconds.') + (wide > 1 ? ' Nobody can see the spot, so it’s off the map and will scatter.' : '') + (close ? ' Danger close!' : '') + ' ' + arty[kind] + ' left.');
  }
  function artyUpdate() {
    missions.forEach(function (m) {
      m.shells.forEach(function (s) {
        if (!s.whistled && clock > s.t - 1.1) { s.whistled = true; sound.whistle(m.x, m.y); }
        if (s.done || clock < s.t) return;
        s.done = true;
        var a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * s.spread, x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
        if (m.kind === 'he') blast(x, y, null, 1.45);
        else {
          var puffs = []; for (var i = 0; i < 10; i++) puffs.push({ a: Math.random() * 6.28, d: Math.sqrt(Math.random()), s: Math.random() });
          clouds.push({ x: x, y: y, r: 14, t0: clock, life: 60, kind: 'smoke', puffs: puffs }); boom(x, y, 2, true); sound.boom(x, y, false);
        }
      });
    });
    missions = missions.filter(function (m) { return m.shells.some(function (s) { return !s.done; }); });
    // in the counter-attack, a German mortar drops rounds near your men every 20 to 30 seconds
    if (MISSION.mortar() && clock > (artyUpdate.mortar || 0)) {
      artyUpdate.mortar = clock + 20 + Math.random() * 10;
      var known = team('allies').filter(function (u) { return team('axis').some(function (s) { return dist(s, u) < sightRange() && seeLine(s.x, s.y, u.x, u.y); }); });
      if (known.length) { var k = known[Math.floor(Math.random() * known.length)]; missions.push({ x: k.x, y: k.y, kind: 'he', t: clock, enemy: true, shells: [{ t: clock + 2.5, spread: 18 }, { t: clock + 4.5, spread: 18 }] }); }
    }
  }
  function drawMissions() {
    missions.forEach(function (m) {
      if (m.enemy) return;   // you don't get told where theirs will land
      var q = proj(m.x, m.y, 0), X = q[0] - view.x, Y = q[1] - view.y, r = (m.kind === 'he' ? 20 : 16) * m.wide / CAM.mPerPx;
      var next = m.shells.filter(function (s) { return !s.done; })[0], left = next ? Math.max(0, Math.ceil(next.t - clock)) : 0;
      ctx.setLineDash([4, 6]); ctx.lineWidth = 2; ctx.strokeStyle = m.kind === 'he' ? 'rgba(240,110,80,.85)' : 'rgba(235,235,225,.85)';
      ctx.beginPath(); ctx.ellipse(X, Y, r, r * CAM.up[2], 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(237,232,218,.95)'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((m.kind === 'he' ? 'Shells' : 'Smoke') + (left ? ' in ' + left + ' s' : ' falling'), X, Y - r * CAM.up[2] - 6);
    });
  }

  // ------------------------------------------------------------------ riding on the Shermans
  // Up to six men climb on the engine deck. They move at the tank's speed and can fire from it, badly; but they're
  // terribly exposed, and if the tank is hit most of them are thrown off or killed.
  var DECK = [[-1.4, 0.75], [-1.4, -0.75], [-2.4, 0.75], [-2.4, -0.75], [-0.5, 1.0], [-0.5, -1.0]];
  function riders(t) { return units.filter(function (u) { return u.riding === t && alive(u); }); }
  function mount(men) {
    var c = { x: 0, y: 0 }; men.forEach(function (m) { c.x += m.x / men.length; c.y += m.y / men.length; });
    var tanks = team('allies').filter(function (t) { return isTank(t) && dist(t, c) < 90 && riders(t).length < DECK.length; });
    if (!tanks.length) { say('No Sherman close enough to climb on (within 90 m).'); return; }
    tanks.sort(function (a, b) { return dist(a, c) - dist(b, c); });
    var t = tanks[0], room = DECK.length - riders(t).length;
    men.slice(0, room).forEach(function (m) { m.boardTo = t; m.retreating = false; m.assault = false; order(m, t.x, t.y); });
    say(squadName(men[0]) + ' climbing on to ' + t.name + (men.length > room ? '; there’s only room for ' + room + '.' : '.'));
  }
  function dismount(u, scatter) {
    var t = u.riding; if (!t) return;
    u.riding = null; u.boardTo = null;
    var a = Math.random() * 6.28, c = nearestOpen(block, cellOf(t.x + Math.cos(a) * 3.5, t.y + Math.sin(a) * 3.5)) || cellOf(t.x, t.y), w = centre(c[0], c[1]);
    u.x = w[0]; u.y = w[1]; u.path = null; u.arrive = !scatter;
    if (!scatter) arrived(u);
  }
  function rideUpdate(u, dt, tgt, inRange) {
    var t = u.riding;
    if (!alive(t)) { dismount(u, true); return; }
    var i = riders(t).indexOf(u), o = DECK[Math.max(0, i)], c = Math.cos(t.h), s = Math.sin(t.h);
    u.x = t.x + o[0] * c - o[1] * s; u.y = t.y + o[0] * s + o[1] * c;
    u.pose = tgt ? 'aim' : 'idle'; u.h = tgt ? Math.atan2(tgt.y - u.y, tgt.x - u.x) : t.h;
    if (tgt && inRange && u.shot <= 0 && !u.pinned) rifleShot(u, tgt);
    if (u.fired > 0) { u.fired -= dt; if (u.fired > 0.1) u.pose = 'fire'; }
    u.state = 'riding';
  }
  function boardUpdate(u) {
    var t = u.boardTo;
    if (!alive(t) || riders(t).length >= DECK.length) { u.boardTo = null; u.path = null; return false; }
    if (dist(u, t) < 5) { u.riding = t; u.boardTo = null; u.path = null; return true; }
    if (!u.path || clock - (u.boardPath || 0) > 2) { u.boardPath = clock; order(u, t.x, t.y); }
    return false;
  }
  function throwRiders(t, deadly) {
    // the tank is hit: riders are blown off, many of them killed
    var n = 0;
    riders(t).forEach(function (r) { if (Math.random() < deadly) { killed(r, null); n++; } else { dismount(r, true); suppress(r, 95); r.morale -= 20; } });
    return n;
  }

  function setupHedgerows() {
    OBJ = { x: LEVEL.objective[0], y: LEVEL.objective[1] };
    LEVEL.shermans.forEach(function (p, i) { var c = nearestOpen(tankBlock, cellOf(p[0], p[1])), w = centre(c[0], c[1]); var t = tank(w[0], w[1], i); crewFromRoster(t, i); t.h = Math.atan2(OBJ.y - t.y, OBJ.x - t.x); units.push(t); });
    // 1st Squad waits behind the rear tank; the rally point, where crews are safe, is further back down the lane
    var back = units[1], bx = back.x - OBJ.x, by = back.y - OBJ.y, bl = Math.sqrt(bx * bx + by * by); bx /= bl; by /= bl;
    var rc = nearestOpen(block, cellOf(back.x + bx * 28, back.y + by * 28)), rw = centre(rc[0], rc[1]); RALLY = { x: rw[0], y: rw[1] };
    spawnSquadAt('1st Squad', function (k) { return [back.x + bx * (10 + (k % 2) * 3) - by * (k - 3.5) * 1.6, back.y + by * (10 + (k % 2) * 3) + bx * (k - 3.5) * 1.6, Math.atan2(-by, -bx)]; });
    // two German squads hold the farm
    // two scouts with binoculars, out on the flank of 1st Squad: they see further and are hard to spot, but avoid a fight
    spawnSquadAt('Scouts', function (sk) { return [back.x + bx * 6 + by * (12 + sk * 2), back.y + by * 6 - bx * (12 + sk * 2), Math.atan2(-by, -bx)]; });
    spawnSquadAt('Bazooka', function (k) { return [back.x + bx * 16 - by * (k * 2 - 6), back.y + by * 16 + bx * (k * 2 - 6), Math.atan2(-by, -bx)]; });
    arty = { he: DIFF.arty[0], smoke: DIFF.arty[1] };
    // the second objective, the crossroads, held by a squad and an MG42 covering the lane from the farm;
    // and the lane at the east edge where the counter-attack comes in
    var xc = nearestOpen(block, cellOf(82, 82)), xw = centre(xc[0], xc[1]), ec = nearestOpen(block, cellOf(350, -20)), ew = centre(ec[0], ec[1]);
    ENTRY = { x: ew[0], y: ew[1] };
    OBJS = [{ name: 'farm', label: 'Farm', x: OBJ.x, y: OBJ.y, r: 22, owner: 'axis', prog: -1 }, { name: 'crossroads', label: 'Crossroads', x: xw[0], y: xw[1], r: 20, owner: 'axis', prog: -1 }];
    // the German commander decides how the farm and the crossroads are held
    germanHedgerows({ x: xw[0], y: xw[1] });
    spawnAirborne(function (i, m) { return [back.x + bx * (20 + i * 4) - by * (m * 2 - 4), back.y + by * (20 + i * 4) + bx * (m * 2 - 4), Math.atan2(-by, -bx)]; });
    placeStrays((params.diff || prefs.difficulty || 'normal') === 'easy' ? ['hidden', 'surrounded', 'captive', 'wounded'] : ['hidden', 'surrounded', 'captive']);
    selected = units.filter(isTank);
    var c0 = proj(LEVEL.shermans[0][0], LEVEL.shermans[0][1], 0), c1 = proj(OBJ.x, OBJ.y, 0);
    view.x = (c0[0] + c1[0]) / 2 - VW / 2; view.y = (c0[1] + c1[1]) / 2 - VH / 2; clampView();
  }
