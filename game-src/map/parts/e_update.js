
  // ------------------------------------------------------------------ the simulation
  var OBJ, RALLY;   // the farm the Germans hold, and the spot back down the lane where your crews are safe
  function update(dt) {
    clock += dt;
    var allies = team('allies'), axis = team('axis'), R = sightRange();
    // spotting: a German is on your screen only while one of your men or tanks can see him
    var sees = function (s) { return allies.some(function (a) { return !a.stray && canSee(a, s); }); };
    axis.forEach(function (s) { if (sees(s)) { s.seenT = clock; s.last = { x: s.x, y: s.y, h: s.h, pose: s.pose };
      if (s.role === 'mg') intelEvent('mg', s);
      if (isTank(s) && !s.spotted) { s.spotted = true; intelEvent('stug'); toast('StuG!', s.x, s.y); var nb = allies.filter(function (a) { return !a.stray; }).sort(function (a, b) { return dist(a, s) - dist(b, s); })[0];
        say('Enemy armour! A StuG assault gun ' + (nb ? compass(s.x - nb.x, s.y - nb.y) + ' of ' + (isTank(nb) ? nb.name : squadName(nb)) : 'in sight') + '. Bazooka and Shermans: take it from the side.'); } } });
    units.forEach(function (s) { if (s.side === 'axis' && s.hp <= 0 && !s.bodySeen && (clock - s.seenT < 0.5 || sees(s))) s.bodySeen = true; });
    // crews climbing out of knocked-out tanks
    pendingCrew = pendingCrew.filter(function (p) {
      if (clock < p.t) return true;
      var a = Math.random() * 6.28, c = nearestOpen(block, cellOf(p.tank.x + Math.cos(a) * 2.5, p.tank.y + Math.sin(a) * 2.5)) || cellOf(p.tank.x, p.tank.y), w = centre(c[0], c[1]);
      if (p.tank.side === 'axis') {   // a StuG's crew run back the way they came
        var gm = soldier(w[0], w[1], 'axis', 'rifle', p.tank.name, 'crew'); units.push(gm); gm.retreating = true;
        order(gm, ENTRY.x + (Math.random() - .5) * 8, ENTRY.y + (Math.random() - .5) * 8); return false;
      }
      var m = soldier(w[0], w[1], 'allies', 'tanker', p.tank.name, 'crew');
      units.push(m); order(m, RALLY.x + (Math.random() - .5) * 8, RALLY.y + (Math.random() - .5) * 8); m.retreating = true;
      return false;
    });
    allies = team('allies');
    units.forEach(function (u) {
      if (u.kind === 'tank') { if (!alive(u)) updateWreck(u, dt); else if (u.side === 'axis') updateStug(u, dt, allies); else updateTank(u, dt, axis, R); }
      else if (alive(u)) updateMan(u, dt, u.side === 'axis' ? allies : axis, R);
    });
    squadOrders(allies);
    burnFuses();
    runOrders();
    tracker.tick();
    MISSION.update(dt);
    straysUpdate();
    artyUpdate();
    clouds.forEach(function (cl) { if (cl.kind === 'smoke') { cl.x += WIND[0] * dt; cl.y += WIND[1] * dt; } });
    clouds = clouds.filter(function (cl) { return clock - cl.t0 < cl.life; });
    heard = heard.filter(function (h) { return clock - h.t < 4; });
    fx = fx.filter(function (f) { f.t += dt; return f.t < f.life; });
    if (!over) {
      var foes = team('axis'), fighting = team('allies').filter(function (u) { return u.role !== 'crew' && !u.stray; });
      if (!fighting.length) end('Beaten back', 'You have no tanks or riflemen left in the fight. ' + summary(), false);
    }
  }
  function summary() {
    var dead = units.filter(function (u) { return u.side === 'axis' && u.hp <= 0; }).length;
    var tanksLost = units.filter(function (u) { return isTank(u) && u.side === 'allies' && u.hp <= 0; }).length;
    var paras = units.filter(function (u) { return u.kit === 'para' && !u.stray && u.man && u.man.para && !u.fromRoster; }), parasLost = paras.filter(function (u) { return u.hp <= 0; }).length;
    var stugs = units.filter(function (u) { return isTank(u) && u.side === 'axis'; }), stugsOut = stugs.filter(function (u) { return u.hp <= 0; }).length;
    var rifles = units.filter(function (u) { return u.kit === 'us'; }), riflesLost = rifles.filter(function (u) { return u.hp <= 0; }).length;
    return 'Germans killed: ' + dead + (tally.prisoners ? ', taken prisoner: ' + tally.prisoners : '') + (tally.withdrew ? ', slipped away: ' + tally.withdrew : '') + '. Shermans lost: ' + tanksLost + ' of 2'
      + (tally.crewOut ? ', crew saved: ' + tally.crewSaved + ' of ' + tally.crewOut + ' who got out' : '') + '. Riflemen lost: ' + riflesLost + ' of ' + rifles.length + '.'
      + (STRAYS.length ? ' Paratroopers found: ' + paras.length + (paras.length ? ', of whom ' + (paras.length - parasLost) + ' came through' : '') + '.' : '')
      + (stugs.length ? ' StuGs knocked out: ' + stugsOut + ' of ' + stugs.length + '.' : '');
  }

  function updateTank(u, dt, axis, R) {
    var speed = u.dmg.track ? 0 : u.dmg.engine ? 2.5 : 5.0;
    if (u.dmg.track) u.path = null;
    var other = u.path && tankAhead(u);
    if (other) {
      // a tank in the way: wait for it to move on; if it's halted or knocked out, go round it
      u.wait = (u.wait || 0) + dt; speed = 0;
      if (u.wait > 1 && alive(other) && !other.path && !other.dmg.track && makeWay(other, u)) u.wait = 0;
      else if (u.wait > 2.5 && (other.hp <= 0 || !other.path)) { if (!routeAround(u, other) && u.wait > 6) { u.path = null; say(u.name + ': can’t get past ' + other.name + '.'); } else u.wait = 0; }
    } else u.wait = 0;
    // keep the thick front armour towards the danger: swing the hull to face it when halted, and back away from it
    // in reverse (at under half speed) rather than turn tail, when the move is a short one
    var threat = tankThreat(u), reverse = false;
    if (threat && u.path) {
      var dest = u.path[u.path.length - 1], away = Math.atan2(dest[1] - u.y, dest[0] - u.x), toT = Math.atan2(threat.y - u.y, threat.x - u.x);
      var L = pathLength(u), straight = Math.sqrt((dest[0] - u.x) * (dest[0] - u.x) + (dest[1] - u.y) * (dest[1] - u.y));
      reverse = Math.abs(Math.atan2(Math.sin(away - toT), Math.cos(away - toT))) > 1.9 && L < 80 && straight > L * 0.75;   // short and fairly direct
    }
    u.reversing = reverse;
    var moving = !!u.path && speed > 0 && move(u, speed * (reverse ? 0.45 : 1), u.dmg.engine ? 0.6 : 0.9, dt, reverse);
    if (!moving && threat && !u.dmg.track && !u.climbing) turnTo(u, Math.atan2(threat.y - u.y, threat.x - u.x), 0.5, dt);
    if (!moving) u.climbing = false;
    separate(u);
    if (u.climbing && (!u.lastBreach || dist(u, u.lastBreach) > 1.5)) { breach(u.x, u.y, 2.4); u.lastBreach = { x: u.x, y: u.y }; }
    u.state = moving ? 'move' : 'halted';
    trackMarks(u, moving, dt);
    resupply(u, dt);
    if (u.dmg.engine && Math.random() < dt * 2) boom(u.x - Math.cos(u.h) * 3, u.y - Math.sin(u.h) * 3, 1.2, true);
    if (u.hp < 50 && Math.random() < dt * 1.5) boom(u.x, u.y, 1.5, true);
    // a broken track: the crew climb out and fix it, as long as nothing hostile is in sight within 60 m
    if (u.dmg.track && !axis.some(function (s) { return clock - s.seenT < 3 && dist(u, s) < 60; })) {
      u.repair += dt / 40;
      if (u.repair >= 1) { u.dmg.track = false; u.repair = 0; say(u.name + ': track repaired, ready to move.'); }
    }
    var aim = (moving ? 0.6 : 1) * (u.dmg.gunner ? 0.6 : 1) * vetAcc(u);   // firing on the move is far less accurate
    u.gun -= dt; u.mg -= dt;
    if (u.climbing) return;                         // nose in the air on a hedge bank: no shooting
    if (u.area && clock > u.area.until) u.area = null;
    if (u.area && seeLine(u.x, u.y, u.area.x, u.area.y)) { areaFire(u, axis); return; }
    if (u.target && (!alive(u.target) || clock - u.target.seenT > 5)) u.target = null;
    var all = axis.filter(function (s) { return canSee(u, s); });
    all.sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var armr = all.filter(isTank), seen = all.filter(function (s) { return !isTank(s); });
    // armour first: armour-piercing at a StuG, yours to point at or the nearest one in sight
    if (armr.length && !u.dmg.gun && u.gun <= 0) {
      var ak = u.target && armr.indexOf(u.target) >= 0 ? u.target : armr[0], ad = dist(u, ak);
      u.gun = 5.5 * (u.dmg.gunner ? 1.5 : 1) * (1 - 0.1 * u.vet);
      tracer(u, ak, 'rgba(255,240,200,1)'); muzzle(u, true); sound.gun(u); u.lastFired = clock;
      fx.push({ t: 0, life: 1.8, x: u.x + Math.cos(u.h) * 5.5, y: u.y + Math.sin(u.h) * 5.5, size: 2.2, kind: 'smoke' });
      if (Math.random() < 0.8 * Math.max(0.25, 1 - ad / 800) * aim * (ak.state === 'move' ? 0.75 : 1)) hitTank(ak, u, 'ap75');
      else fx.push({ t: 0, life: .4, x: ak.x + (Math.random() - .5) * 8, y: ak.y + (Math.random() - .5) * 8, size: 1.2, kind: 'dust' });
    }
    var onTarget = u.target && seen.indexOf(u.target) >= 0;
    if (seen.length && u.mg <= 0) {                 // bow and coax MGs: bursts at the target or the nearest, pinning those around it
      var t = onTarget ? u.target : seen[0]; u.mg = 0.9; tracer(u, t, 'rgba(255,215,120,.9)'); sound.mg(u);
      axis.forEach(function (s) { var d = dist(s, t); if (d < 5) suppress(s, d < 1 ? 22 : 8, u); });
      if (t.role === 'mg' && dist(u, t) < 150) t.relocate = t.relocate || Math.random() < 0.25;   // a Sherman's MG on it: time to move
      if (Math.random() < Math.max(0.08, 0.4 - dist(u, t) / 400) * aim * exposure(t, u, 'bullet')) killed(t, u);
    }
    // 76 mm high explosive: on its own at whatever it sees, unless you've told it to hold; always at a target you've given it
    if (u.he > 0 && !u.dmg.gun && u.gun <= 0 && (onTarget || (u.heMode === 'auto' && seen.length))) {
      var mgs = seen.filter(function (s) { return s.role === 'mg'; });   // a machine gun is always worth a shell
      var tg = onTarget ? u.target : mgs[0] || seen[Math.floor(Math.random() * Math.min(3, seen.length))];
      u.gun = 5.5 * (u.dmg.gunner ? 1.5 : 1) * (1 - 0.1 * u.vet); u.he--;
      var sc = (moving ? 6 : 2) * (u.dmg.gunner ? 1.6 : 1) / vetAcc(u), ang = Math.random() * 6.28, r = sc * Math.random();
      var bx = tg.x + Math.cos(ang) * r, by = tg.y + Math.sin(ang) * r;
      tracer(u, { x: bx, y: by, kind: 'inf' }, 'rgba(255,240,200,1)'); muzzle(u, true); sound.gun(u);
      fx.push({ t: 0, life: 1.8, x: u.x + Math.cos(u.h) * 5.5, y: u.y + Math.sin(u.h) * 5.5, size: 2.2, kind: 'smoke' });
      blast(bx, by, u, 1);
      if (u.he === 5) say(u.name + ': five rounds of HE left.'); else if (!u.he) say(u.name + ': out of HE. Machine guns only now.');
    }
  }

  function trackMarks(u, moving, dt) {
    // two track marks every couple of metres, and dust off the lane
    if (!moving) { u.lastMark = null; return; }
    if (!u.lastMark || Math.sqrt((u.x - u.lastMark[0]) * (u.x - u.lastMark[0]) + (u.y - u.lastMark[1]) * (u.y - u.lastMark[1])) > 2) {
      if (u.lastMark) mark({ kind: 'track', ax: u.lastMark[0], ay: u.lastMark[1], bx: u.x, by: u.y, h: u.h });
      u.lastMark = [u.x, u.y];
    }
    if (Math.random() < dt * 6) fx.push({ t: 0, life: 2.6, x: u.x - Math.cos(u.h) * 3.5 + Math.random() - .5, y: u.y - Math.sin(u.h) * 3.5 + Math.random() - .5, size: 2.5, kind: 'dust' });
  }

  function updateStug(u, dt, foes) {
    // The StuG comes in behind its infantry and fights from a halt, front on: it turns the whole vehicle to lay the
    // gun, so a target off to the side takes it a few seconds. Armour-piercing at a Sherman, high explosive at men.
    // Infantry getting within 30 m make it back off: it has one machine gun and can't see much close in.
    var speed = u.dmg.track ? 0 : u.dmg.engine ? 2 : 4.2;
    if (u.dmg.track) u.path = null;
    u.gun -= dt; u.mg -= dt;
    var seen = foes.filter(function (a) { return !a.captive && canSee(u, a); }).sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var armr = seen.filter(isTank), men = seen.filter(function (a) { return !isTank(a) && !a.riding; });
    if (seen.length) u.contact = clock;
    var tg = armr[0] && dist(u, armr[0]) < (u.engage || 700) ? armr[0] : men[0] && dist(u, men[0]) < 260 ? men[0] : null;
    var close = men.filter(function (m) { return dist(u, m) < 30; })[0];
    if (close && !u.backing && speed > 0) {
      var ba = Math.atan2(u.y - close.y, u.x - close.x), bc = nearestOpen(tankBlock, cellOf(u.x + Math.cos(ba) * 30, u.y + Math.sin(ba) * 30));
      if (bc) { var bw = centre(bc[0], bc[1]); if (order(u, bw[0], bw[1])) { u.backing = true; if (clock - u.seenT < 2) say('The ' + u.name + ' is backing off.'); } }
    }
    if (tg && !u.backing) u.path = null;   // halt and fight
    else if (!u.path && !u.backing && clock > (u.wait0 || 0) && clock - (u.contact || -99) > 8 && u.goal && dist(u, u.goal) > 14) order(u, u.goal.x, u.goal.y);
    var moving = !!u.path && speed > 0 && move(u, speed * (u.backing ? 0.5 : 1), 0.7, dt, !!u.backing);
    if (!u.path) u.backing = false;
    if (moving) u.dugIn = false;
    separate(u);
    u.state = moving ? 'move' : 'halted';
    trackMarks(u, moving, dt);
    if (moving && clock - u.seenT > 3 && Math.random() < dt * 0.2) hear(u, 'tracks');   // you hear tracks before you see it
    if (u.dmg.track && !foes.some(function (a) { return dist(u, a) < 80 && canSee(a, u); })) {
      u.repair += dt / 40; if (u.repair >= 1) { u.dmg.track = false; u.repair = 0; }
    }
    if (u.hp < 50 && Math.random() < dt * 1.5) boom(u.x, u.y, 1.5, true);
    if (tg !== u.tg) { u.tg = tg; u.react = clock + 2 + Math.random() * 2; }   // a few seconds for the crew to pick up a new target
    if (!tg || moving || clock < u.react) return;
    var want = Math.atan2(tg.y - u.y, tg.x - u.x), off = speed > 0 ? turnTo(u, want, 0.45, dt) : Math.abs(Math.atan2(Math.sin(want - u.h), Math.cos(want - u.h)));
    var d = dist(u, tg);
    // the MG behind its shield covers the front
    if (men.length && u.mg <= 0 && off < 0.5 && dist(u, men[0]) < 200) {
      var mt = men[0]; u.mg = 1.1; tracer(u, mt, 'rgba(255,215,120,.9)'); sound.mg(u);
      foes.forEach(function (s) { if (!isTank(s) && dist(s, mt) < 5) suppress(s, 10, u); });
      if (Math.random() < Math.max(0.06, 0.3 - dist(u, mt) / 500) * germanAcc(u) * exposure(mt, u, 'bullet')) killed(mt, u);
    }
    if (off > 0.09 || u.gun > 0 || u.dmg.gun) return;   // the gun only traverses a few degrees either side
    var acc = (u.dmg.gunner ? 0.6 : 1) * germanAcc(u);
    if (isTank(tg)) {
      if (u.ap <= 0) return; u.ap--; u.gun = 7;
      tracer(u, tg, 'rgba(255,240,200,1)'); muzzle(u, true); sound.gun(u);
      if (Math.random() < 0.75 * Math.max(0.25, 1 - d / 900) * (tg.state === 'move' ? 0.75 : 1) * acc) hitTank(tg, u, 'ap48');
      else fx.push({ t: 0, life: .4, x: tg.x + (Math.random() - .5) * 8, y: tg.y + (Math.random() - .5) * 8, size: 1.2, kind: 'dust' });
    } else {
      if (u.he <= 0) return; u.he--; u.gun = 6.5;
      var sc = 3 / acc, ang = Math.random() * 6.28, r = sc * Math.random(), bx = tg.x + Math.cos(ang) * r, by = tg.y + Math.sin(ang) * r;
      tracer(u, { x: bx, y: by, kind: 'inf' }, 'rgba(255,240,200,1)'); muzzle(u, true); sound.gun(u); blast(bx, by, u, 1);
    }
    fx.push({ t: 0, life: 1.8, x: u.x + Math.cos(u.h) * 5, y: u.y + Math.sin(u.h) * 5, size: 2.2, kind: 'smoke' });
    u.lastFired = clock; u.engaged = true;
    if (clock - u.seenT > 1.5) hear(u, 'gun');
  }

  function bazooka(u, dt, vis) {
    // The bazooka team: a rocket at armour within 110 m, best from the side, or at an MG42 you point it at. The
    // gunner needs a moment to aim and the loader to wire up the next round; without him it takes twice as long.
    // In ambush he waits until the StuG is within 60 m. Rockets come up again at the rally point.
    if (!u.path && dist(u, RALLY) < 28 && u.rockets < 8 && clock - (u.lastFired || -99) > 30 && clock - (u.rearmT || 0) > 6) { u.rearmT = clock; u.rockets++; if (u.rockets === 8) say(u.squad + ': rockets topped up.'); }
    if (u.rockets <= 0 || u.path) { u.aiming = false; return false; }
    var tk = vis.filter(isTank).sort(function (a, b) { return dist(u, a) - dist(u, b); })[0];
    var tg = tk && dist(u, tk) < 110 ? tk : u.target && alive(u.target) && u.target.role === 'mg' && vis.indexOf(u.target) >= 0 && dist(u, u.target) < 120 ? u.target : null;
    if (!tg) { u.aiming = false; return false; }
    var d = dist(u, tg);
    if (u.hold && d > 60) { u.pose = 'prone'; return true; }
    u.pose = 'aim'; turnTo(u, Math.atan2(tg.y - u.y, tg.x - u.x), 4, dt);
    if (!u.aiming) { u.aiming = true; u.shot = Math.max(u.shot, 1.5 + Math.random()); }
    if (u.shot > 0) return true;
    if (u.hold) springAmbush(u);
    var loader = units.some(function (v) { return v !== u && v.squad === u.squad && alive(v) && dist(v, u) < 6; });
    u.rockets--; u.aiming = false; u.shot = loader ? 4 : 8; u.fired = 0.25; u.pose = 'fire'; u.lastFired = clock; u.engaged = true;
    tracer(u, tg, 'rgba(255,170,90,1)'); muzzle(u, true); sound.pf(u, tg);
    fx.push({ t: 0, life: 2.2, x: u.x - Math.cos(u.h) * 2, y: u.y - Math.sin(u.h) * 2, size: 2, kind: 'dust' });   // back-blast
    if (isTank(tg)) {
      if (Math.random() < 0.9 * Math.max(0.3, 1 - d / 160) * (tg.state === 'move' ? 0.7 : 1) * vetAcc(u) * (1 - u.supp / 400)) { boom(tg.x, tg.y, 3, false); hitTank(tg, u, 'bazooka'); }
      else { boom(tg.x + (Math.random() - .5) * 10, tg.y + (Math.random() - .5) * 10, 2, false); say(u.squad + ': missed the ' + tg.name + '.'); }
    } else blast(tg.x + (Math.random() - .5) * 3, tg.y + (Math.random() - .5) * 3, u, 0.8);
    if (!u.rockets) say(u.squad + ': out of rockets. Send them back to the rally point for more.'); else if (u.rockets === 2) say(u.squad + ': two rockets left.');
    return true;
  }

  function updateWreck(u, dt) {
    // a knocked-out Sherman burns for two minutes, and more often than not its ammunition goes up
    var age = clock - (u.burnT || 0);
    if (age < 120) {
      if (Math.random() < dt * 9) fx.push({ t: 0, life: 0.6, x: u.x + (Math.random() - .5) * 2.4, y: u.y + (Math.random() - .5) * 2.4, size: 1 + Math.random() * (age < 60 ? 1.4 : 0.6), kind: 'fire' });
      if (Math.random() < dt * 4) fx.push({ t: 0, life: 6, x: u.x, y: u.y, size: 3 + Math.random() * 2, kind: 'black' });
    } else if (Math.random() < dt * 1.2) boom(u.x, u.y, 2, true);
    if (u.cook && clock > u.cook) {
      u.cook = 0; say(u.name + '’s ammunition has cooked off.');
      blast(u.x, u.y, null, 1.5);
      for (var i = 0; i < 6; i++) fx.push({ t: 0, life: 1.2, x: u.x + (Math.random() - .5) * 3, y: u.y + (Math.random() - .5) * 3, size: 3, kind: 'fire' });
    }
  }

  function updateMan(u, dt, foes, R) {
    if (u.captive) { u.pose = 'idle'; return; }   // a prisoner: sitting under guard until you get him out
    u.shot -= dt; u.anim += dt;
    if (u.side === 'allies') rearmMen(u);
    if (clock - u.suppT > 2) u.supp = Math.max(0, u.supp - 12 * dt);
    if (u.supp >= 75) u.pinned = true; else if (u.supp < 35) u.pinned = false;
    // morale: pinned men lose heart; quiet moments, and a sergeant close by, bring it back
    var sgt = u.role !== 'nco' && units.some(function (v) { return v.role === 'nco' && alive(v) && v.squad === u.squad && dist(v, u) < 30; });
    if (u.pinned) u.morale -= 3 * dt; else if (u.supp < 10) u.morale += (1.5 + (sgt ? 1.5 : 0)) * dt;
    u.morale = Math.max(0, Math.min(u.heart, u.morale));
    var vis = foes.filter(function (a) { return !a.captive && canSee(u, a); });
    if (u.side === 'axis') vis.forEach(function (a) { a.seenByAxis = clock; });
    vis.sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var men = vis.filter(function (a) { return a.kind === 'inf'; });
    var tgt = u.target && vis.indexOf(u.target) >= 0 ? u.target : men[0] || vis[0];
    var w = WEAPON[u.kit], inRange = tgt && dist(u, tgt) < Math.min(w.range, holdRange(u)), st = null;
    if (u.hold && tgt && dist(u, tgt) < 40) springAmbush(u);
    if (u.area && clock > u.area.until) u.area = null;
    if (u.riding) { rideUpdate(u, dt, tgt, inRange); return; }
    if (u.boardTo && !u.pinned) {
      if (boardUpdate(u)) return;
      u.pose = 'walk'; move(u, 3.0, 6, dt); separate(u); u.state = 'move'; return;
    }
    // Germans with somewhere to be (the counter-attack) push on, but stop and fight when they meet you
    if (u.side === 'axis' && u.goal && !u.retreating && !u.task) {
      if (u.via && dist(u, u.via) < 12) u.via = null;   // round the flank: now head in
      if (tgt) {
        u.contact = clock; if (u.path && !u.pf && u.role !== 'mg' && u.role !== 'loader') u.path = null;
        if (!coverAgainst(u, tgt) && dist(u, tgt) < 120) germanSmoke(squadOf(u), tgt);   // caught in the open: smoke
      } else if (!u.path && clock - (u.contact || -99) > 10 && dist(u, u.via || u.goal) > 10) order(u, (u.via || u.goal).x, (u.via || u.goal).y);
    }
    if (u.task && !u.pinned) {
      sapper(u, dt);
    } else if (u.retreating && u.path) {
      // running back: not stopping for anything
      u.pose = 'walk'; move(u, 3.2, 6, dt); u.aiming = false;
      if (!u.path) arrived(u);
    } else if (u.pinned) {
      u.pose = 'prone';                               // heads down: no moving, no firing
    } else if (u.role === 'mg' && mgUpdate(u, dt, tgt)) {
      // down behind the gun
    } else if (u.role === 'bazooka' && bazooka(u, dt, vis)) {
      // the bazooka is on something
    } else if (u.side === 'axis' && u.pf && (st = stalk(u, dt, foes))) {
      // the Panzerfaust man is hunting
    } else if (u.path) {
      u.pose = 'walk'; u.aiming = false; move(u, (u.assault ? 3.4 : u.role === 'crew' ? 3.0 : u.role === 'scout' ? 2.8 : 2.2) * (u.wounded ? 0.55 : 1), 6, dt);
      if (u.assault && tgt && inRange && u.shot <= 0 && !isTank(tgt)) rifleShot(u, tgt);   // an assault fires from the hip on the run
      if (!u.path) arrived(u);
    } else if (u.area && !tgt && seeLine(u.x, u.y, u.area.x, u.area.y)) {
      u.pose = 'aim'; turnTo(u, Math.atan2(u.area.y - u.y, u.area.x - u.x), 4, dt);
      if (u.shot <= 0) areaFire(u, foes);
    } else if (tgt) {
      // under threat: get a hedge between you and them first, then return fire
      if (!coverAgainst(u, tgt) && clock - u.sought > 12 && u.role !== 'crew' && !u.hold) {
        u.sought = clock; var cw = findCover(u, tgt, 14);
        if (cw) { u.path = path(block, [u.x, u.y], cw); if (u.path) u.path = u.path.slice(1); }
      }
      u.pose = 'aim'; turnTo(u, Math.atan2(tgt.y - u.y, tgt.x - u.x), 4, dt);
      if (u.shot <= 0 && inRange && !u.pf && !isTank(tgt)) rifleShot(u, tgt);
    } else u.pose = 'idle';
    if (u.fired > 0) { u.fired -= dt; if (u.fired > 0.1 && !u.pinned) u.pose = 'fire'; }
    if (!u.path) u.climbing = false;
    separate(u);
    var threat = tgt || foes[0];
    u.state = u.hold && !u.path ? 'ambush' : u.climbing ? 'crossing' : u.retreating && u.path ? 'retreat' : u.pinned ? 'pinned' : st === 'assault' || (u.assault && u.path) ? 'assault' : u.path ? 'move'
      : threat && coverAgainst(u, threat) ? 'cover' : 'exposed';
  }
  function arrived(u) {
    if (u.retreating) { u.retreating = false; if (u.broken) { u.broken = false; u.morale = Math.max(u.morale, 45); } }
    if (u.role === 'crew' && u.side === 'axis') { u.gone = true; return; }   // a StuG crew got away
    if (u.role === 'crew' && dist(u, RALLY) < 16) {
      u.gone = true; tally.crewSaved++; tally.savedBy[u.squad] = (tally.savedBy[u.squad] || 0) + 1;
      say('One of ' + u.squad + '’s crew is safe behind the line (' + tally.crewSaved + ' so far).');
      return;
    }
    // at the end of a move, get into cover facing the nearest German you know about
    if (u.arrive && u.side === 'allies') {
      u.arrive = false;
      var known = team('axis').filter(function (s) { return clock - s.seenT < 30 && dist(u, s.last || s) < 160; });
      known.sort(function (a, b) { return dist(u, a.last) - dist(u, b.last); });
      if (known.length) { var cw = findCover(u, known[0].last, 8); if (cw) { u.path = path(block, [u.x, u.y], cw); if (u.path) u.path = u.path.slice(1); } }
    }
  }
  function stalk(u, dt, foes) {
    // the Panzerfaust man goes after a tank he can see, or one he can hear: a moving Sherman is loud within 120 m
    var known = foes.filter(function (a) { return a.kind === 'tank' && (canSee(u, a) || (a.state === 'move' && dist(u, a) < 120)); });
    if (!known.length) { u.hold = false; return null; }
    known.sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var tk = known[0], d = dist(u, tk), see = canSee(u, tk) || (d < 40 && seeLine(u.x, u.y, tk.x, tk.y));
    var closing = tk.state === 'move' && d < (u.lastTkD || 1e9) - 0.02; u.lastTkD = d;
    if (d > 38 || !see) {
      // a tank coming this way: lie still in the hedge and let it come. Otherwise go round to its side or rear.
      if (closing && d < 110 && clock - u.seenT > 2 && coverAgainst(u, tk)) { u.path = null; u.hold = true; u.pose = 'prone'; return 'ambush'; }
      u.hold = false;
      var sprint = see && d < 80;
      if (!u.path || u.repath <= 0) {
        var back = tk.h + Math.PI, side = Math.sin(Math.atan2(u.y - tk.y, u.x - tk.x) - tk.h) > 0 ? 1 : -1, a = back - side * 0.9;
        var gx = tk.x + Math.cos(a) * 30, gy = tk.y + Math.sin(a) * 30, fc = cellOf(gx, gy);
        if (blocked(block, fc[0], fc[1]) || tk.state === 'move') { gx = tk.x; gy = tk.y; }
        order(u, gx, gy); u.repath = 3;
      }
      u.repath -= dt; u.pose = 'walk'; u.aiming = false; move(u, sprint ? 3.4 : 2.6, 6, dt);
      return sprint ? 'assault' : 'stalk';
    }
    u.hold = false;
    u.path = null; u.pose = 'aim'; turnTo(u, Math.atan2(tk.y - u.y, tk.x - u.x), 4, dt);
    if (!u.aiming) { u.aiming = true; u.shot = 1.2 + Math.random(); }   // a moment to aim
    if (u.shot <= 0) {
      u.pf = 0; u.fired = 0.25; u.pose = 'fire'; u.aiming = false; u.shot = 2;
      tracer(u, tk, 'rgba(255,160,80,1)'); boom(tk.x, tk.y, 3, false); muzzle(u, true); sound.pf(u, tk);
      fx.push({ t: 0, life: 2.2, x: u.x - Math.cos(u.h) * 2, y: u.y - Math.sin(u.h) * 2, size: 2, kind: 'dust' });   // the back-blast kicks up dirt
      if (clock - u.seenT > 1.5) hear(u, 'pf');
      u.lastFired = clock; u.engaged = true;
      if (Math.random() < 0.85 * (tk.state === 'move' ? 0.8 : 1) * (1 - u.supp / 300) * Math.min(1.1, germanAcc(u))) hitTank(tk, u, 'pf'); else say('Panzerfaust missed ' + tk.name + '!');
    }
    return 'aim';
  }
  function hear(s, kind) {
    // you hear what you can't see: a rough marker where the shot came from. At dusk the flash gives him away more precisely.
    var j = TIME === 'dusk' ? 4 : 12;
    heard.push({ x: s.x + (Math.random() - .5) * 2 * j, y: s.y + (Math.random() - .5) * 2 * j, t: clock, kind: kind });
    if (heard.length > 40) heard.shift();
    if (clock - (hear.said || -99) < 15 && kind !== 'pf' && kind !== 'gun') return;
    var near = team('allies').filter(function (a) { return !a.stray; }).sort(function (a, b) { return dist(a, s) - dist(b, s); })[0]; if (!near) return;
    hear.said = clock;
    var what = { pf: 'Panzerfaust fired from the hedges', mg: 'MG42 fire from the hedges', gun: 'A heavy gun firing', tracks: 'Tracks squealing out' }[kind] || 'Rifle fire from the hedges';
    say(what + ' ' + compass(s.x - near.x, s.y - near.y) + ' of ' + (isTank(near) ? near.name : squadName(near)) + '.');
  }

  function squadOrders(allies) {
    // German commander: squads under fire with no Panzerfaust left fall back to the farm; squads whose morale
    // breaks run for it, and if they break again at the farm they give up. Your squad can break too.
    var squads = {};
    units.forEach(function (s) { if (s.kind === 'inf' && alive(s)) (squads[s.squad] = squads[s.squad] || []).push(s); });
    Object.keys(squads).forEach(function (k) {
      var sq = squads[k], m = 0, seen = sq.some(function (s) { return clock - s.seenT < 3; });
      sq.forEach(function (s) { m += s.morale / sq.length; });
      if (sq[0].side === 'axis') {
        var threatened = allies.some(function (a) { return sq.some(function (s) { return dist(a, s) < 35; }); });
        if (m < 22 && !sq[0].broken) {
          if (sq[0].brokeOnce) {
            // broken a second time: they give up if your men are close, otherwise they slip away for good
            var close = allies.some(function (a) { return sq.some(function (s) { return dist(a, s) < 70; }); }), n = words(sq.length).toLowerCase();
            sq.forEach(function (s) { s.gone = true; if (close) tally.prisoners++; else tally.withdrew++; });
            if (close) intelEvent('pow');
            say(close ? 'Germans coming out with their hands up: ' + n + (sq.length === 1 ? ' prisoner.' : ' prisoners.') : 'A broken German squad has slipped away across the fields.');
          } else {
            // broken once: they abandon the position and fall back, away from whoever is pressing them
            var cx = 0, cy = 0; sq.forEach(function (s) { cx += s.x / sq.length; cy += s.y / sq.length; });
            var foe = allies.slice().sort(function (a, b) { return dist(a, { x: cx, y: cy }) - dist(b, { x: cx, y: cy }); })[0];
            var ax = foe ? cx - foe.x : cx - RALLY.x, ay = foe ? cy - foe.y : cy - RALLY.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
            var fc = nearestOpen(block, cellOf(cx + ax / al * 60, cy + ay / al * 60)) || cellOf(cx, cy), fw = centre(fc[0], fc[1]);
            sq.forEach(function (s) { s.broken = s.brokeOnce = s.fallback = s.retreating = true; s.goal = s.via = null; order(s, fw[0] + (Math.random() - .5) * 14, fw[1] + (Math.random() - .5) * 14); });
            germanSmoke(sq, foe);
            if (seen) say('A German squad is breaking and falling back!');
          }
        } else if (threatened && !sq.some(function (s) { return s.pf; }) && !sq[0].fallback) {
          var fb = fallbackPoint(sq[0]);
          germanSmoke(sq, allies.slice().sort(function (a, b) { return dist(a, sq[0]) - dist(b, sq[0]); })[0]);
          sq.forEach(function (s) { s.fallback = s.retreating = true; s.goal = null; order(s, fb.x + (Math.random() - .5) * 20, fb.y + (Math.random() - .5) * 20); });
          if (seen) say('German squad falling back to the farm.');
        }
      } else if (fieldPromotion(sq), sq[0].role !== 'crew' && m < 25 && !sq[0].broken) {
        sq.forEach(function (s) { s.broken = s.retreating = true; s.assault = false; order(s, RALLY.x + (Math.random() - .5) * 10, RALLY.y + (Math.random() - .5) * 10); });
        say(k + ' has had enough and is falling back down the lane!');
      }
    });
  }

  function fireSmoke(x, y) {
    // the Sherman's 2-inch smoke mortar: a bomb lands up to 140 m away and makes a wall of smoke for about 50 seconds
    var ts = selected.filter(function (u) { return isTank(u) && alive(u) && u.smoke > 0; });
    if (!ts.length) { say('No smoke left on the tanks you have selected.'); return; }
    var p = { x: x, y: y }; ts.sort(function (a, b) { return dist(a, p) - dist(b, p); });
    var t = ts[0];
    if (dist(t, p) > 140) { say(t.name + ': that’s too far for the smoke mortar. 140 m at most.'); return; }
    t.smoke--; sound.thunk(t);
    var puffs = []; for (var i = 0; i < 10; i++) puffs.push({ a: Math.random() * 6.28, d: Math.sqrt(Math.random()), s: Math.random() });
    clouds.push({ x: x, y: y, r: 12, t0: clock + 1.2, life: 50, kind: 'smoke', puffs: puffs });
    say(t.name + ': smoke on the way. ' + t.smoke + ' left.');
  }

  function areaFire(u, foes) {
    // firing at a position you can't see into: a hedge where you heard shots. Pins whoever's there, and sometimes hits.
    var a = u.area, spot = { x: a.x + (Math.random() - .5) * 6, y: a.y + (Math.random() - .5) * 6, kind: 'inf' };
    var hit = function (r, pin, kill) { foes.forEach(function (s) { if (s.kind !== 'inf') return; var d = dist(s, a); if (d < r) { suppress(s, pin); if (Math.random() < kill * exposure(s, u, 'bullet')) killed(s, u); } }); };
    if (isTank(u)) {
      if (u.mg <= 0) { u.mg = 0.9; tracer(u, spot, 'rgba(255,215,120,.9)'); sound.mg(u); hit(6, 15, 0.04); }
      if (u.he > 0 && !u.dmg.gun && u.gun <= 0) {
        u.gun = 5.5 * (u.dmg.gunner ? 1.5 : 1) * (1 - 0.1 * u.vet); u.he--;
        var r = (u.state === 'move' ? 6 : 3) * Math.random(), an = Math.random() * 6.28;
        tracer(u, spot, 'rgba(255,240,200,1)'); muzzle(u, true); sound.gun(u); blast(a.x + Math.cos(an) * r, a.y + Math.sin(an) * r, u, 1);
        if (u.he === 5) say(u.name + ': five rounds of HE left.'); else if (!u.he) say(u.name + ': out of HE. Machine guns only now.');
      }
    } else {
      var w = WEAPON[u.kit]; u.shot = w.every[0] + Math.random() * (w.every[1] - w.every[0]); u.fired = 0.2;
      tracer(u, spot, 'rgba(215,232,255,.55)'); muzzle(u); sound.rifle(u); hit(4, 6, 0.02);
    }
  }
  function sapper(u, dt) {
    // blowing a gap: get to the hedge, set the charge (8 s), run, and it goes 10 s later
    var t = u.task;
    if (t.state === 'go') {
      if (u.path) { u.pose = 'walk'; move(u, 2.6, 6, dt); return; }
      if (dist(u, t) > 6) { say('Couldn’t reach the hedge to set the charge.'); u.task = null; charges[u.squad]++; return; }
      t.state = 'set'; t.until = clock + 8; say('Setting the charge…');
    }
    if (t.state === 'set') {
      u.pose = 'prone';
      if (clock > t.until) {
        t.state = 'run'; t.fuse = clock + 10; say('Charge set! Take cover!'); fuses.push(t);
        var a = Math.atan2(u.y - t.y, u.x - t.x);
        squadOf(u).forEach(function (m) { if (dist(m, t) < 20) { order(m, t.x + Math.cos(a) * 24 + (Math.random() - .5) * 6, t.y + Math.sin(a) * 24 + (Math.random() - .5) * 6); m.retreating = true; } });
        u.task = null;
      }
    }
  }
  var fuses = [];
  function burnFuses() {
    fuses = fuses.filter(function (t) {
      if (clock < t.fuse) return true;
      blast(t.x, t.y, null, 1.3); breach(t.x, t.y, 4.5);
      say('The charge has blown a gap in the hedge, wide enough for a Sherman.');
      return false;
    });
  }
  function plantCharge(x, y) {
    var men = selected.filter(function (u) { return alive(u) && u.kit === 'us' && !u.broken; });
    if (!men.length) { say('Select 1st Squad to blow a gap.'); return; }
    if (!charges[men[0].squad]) { say(men[0].squad + ' has no demolition charges left.'); return; }
    // the nearest hedge cell to where you clicked
    var c0 = cellOf(x, y), best = null, bd = 1e9;
    for (var dr = -3; dr <= 3; dr++) for (var dc = -3; dc <= 3; dc++) { var c = c0[0] + dc, r = c0[1] + dr; if (c >= 0 && r >= 0 && c < G && r < G && hedgeCell[r * G + c] && dc * dc + dr * dr < bd) { bd = dc * dc + dr * dr; best = centre(c, r); } }
    if (!best) { say('Click on a hedgerow to blow a gap in it.'); return; }
    var p = { x: best[0], y: best[1] }; men.sort(function (a, b) { return dist(a, p) - dist(b, p); });
    var u = men[0]; if (dist(u, p) > 120) { say('That hedge is too far away. Move 1st Squad closer first.'); return; }
    charges[u.squad]--;
    u.task = { state: 'go', x: p.x, y: p.y }; u.path = path(block, [u.x, u.y], [p.x, p.y]); if (u.path) u.path = u.path.slice(1);
    say('A man from ' + u.squad + ' is going forward with a charge. ' + charges[u.squad] + ' left.');
  }

  function makeWay(t, u) {
    // a halted Sherman in the way pulls over to one side, or failing that backs up, to let the other through
    var s = Math.sin(u.h), c = Math.cos(u.h);
    var spots = [[t.x - s * 8, t.y + c * 8], [t.x + s * 8, t.y - c * 8], [t.x + c * 14 - s * 6, t.y + s * 14 + c * 6], [t.x + c * 14 + s * 6, t.y + s * 14 - c * 6], [t.x - c * 12, t.y - s * 12]];
    for (var i = 0; i < spots.length; i++) {
      var q = cellOf(spots[i][0], spots[i][1]);
      if (blocked(tankBlock, q[0], q[1]) || dist({ x: spots[i][0], y: spots[i][1] }, u) < 8) continue;
      if (order(t, spots[i][0], spots[i][1]) && t.path.length < 6) { if (clock - (makeWay.said || -99) > 10) { makeWay.said = clock; say(t.name + ' pulling over to let ' + u.name + ' past.'); } return true; }
    }
    t.path = null;
    return false;
  }

  function fallbackPoint(s) {
    // fall back to the nearest point the Germans still hold, or else out east the way the counter-attack came
    var mine = OBJS.filter(function (o) { return o.owner === 'axis'; }).concat([ENTRY]);
    mine.sort(function (a, b) { return dist(a, s) - dist(b, s); });
    return mine[0];
  }

  function tankThreat(t) {
    // the danger a tank should face: the nearest German anyone can see within 180 m, or where it was last hit from,
    // or a Panzerfaust or MG42 heard close by
    var armr = team('axis').filter(function (s) { return isTank(s) && clock - s.seenT < 8 && dist(s, t) < 700; }).sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];
    if (armr) return armr;
    var seen = team('axis').filter(function (s) { return clock - s.seenT < 8 && dist(s, t) < 180; }).sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];
    if (seen) return seen;
    if (t.hitFrom && clock - t.hitFrom.t < 25) return t.hitFrom;
    var h = heard.filter(function (e) { return e.kind !== 'rifle' && dist(e, t) < 150; })[0];
    return h || null;
  }
  function pathLength(u) {
    var L = 0, x = u.x, y = u.y;
    (u.path || []).forEach(function (w) { L += Math.sqrt((w[0] - x) * (w[0] - x) + (w[1] - y) * (w[1] - y)); x = w[0]; y = w[1]; });
    return L;
  }
