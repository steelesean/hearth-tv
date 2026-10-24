import re
def P(f, a, b, n=1):
    s = open(f).read(); c = s.count(a)
    assert c == n, (f, c, a[:70]); open(f, 'w').write(s.replace(a, b))

# ---- c_units: the StuG, carbines, armour by model and weapon, hits from either side
P('c_units.js', """      he: HE_LOAD, smoke: SMOKE_LOAD, heMode: 'auto', target: null, kills: 0, vet: 0, dmg: {}, repair: 0, crew: 5 };
  }""", """      he: HE_LOAD, smoke: SMOKE_LOAD, heMode: 'auto', target: null, kills: 0, vet: 0, dmg: {}, repair: 0, crew: 5, model: 'sherman' };
  }
  function stug(x, y, name) {
    // the StuG III: a German assault gun. Low, thick in front, no turret: it turns the whole vehicle to lay its gun
    return { kind: 'tank', model: 'stug', side: 'axis', name: name, x: x, y: y, h: 0, hp: 100, path: null, gun: 3, mg: 0, state: 'halted',
      he: 12, ap: 24, target: null, kills: 0, vet: 0, dmg: {}, repair: 0, crew: 4, seenT: -99 };
  }""")
P('c_units.js', """                 mg42: { range: 250, every: [1.2, 2.0], acc: 0.16 } };""",
"""                 mg42: { range: 250, every: [1.2, 2.0], acc: 0.16 },     // MG42, fired in bursts: see mgUpdate
                 para: { range: 120, every: [1.3, 2.4], acc: 0.17 },     // M1A1 carbine, the paratroopers' folding-stock carbine
                 bazooka: { range: 120, every: [1.3, 2.4], acc: 0.17 } }; // the bazooka team's own carbines""")
P('c_units.js', """  function armour(tk, from) {
    // where the Panzerfaust strikes: the Sherman's front is thick, its sides and rear much less so
    var a = Math.abs(Math.atan2(Math.sin(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h), Math.cos(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h)));
    return a < 0.8 ? ['front', 40] : a < 2.3 ? ['side', 65] : ['rear', 100];
  }""", """  // how much a hit takes off: by the face it strikes, for each vehicle against a Panzerfaust; then, for each weapon,
  // how that compares (front, side, rear). The Sherman's 75 mm barely scratches a StuG's 80 mm front past 300 m;
  // the StuG's long 75 goes through a Sherman almost anywhere. The bazooka is weaker than the Panzerfaust.
  var ARMOUR = { sherman: [40, 65, 100], stug: [30, 65, 100] };
  var PEN = { pf: [1, 1, 1], bazooka: [0.75, 0.9, 1], ap75: [0.5, 1.3, 1], ap48: [1.75, 1.6, 1] };
  var WNAME = { pf: 'a Panzerfaust', bazooka: 'a bazooka', ap75: 'a Sherman', ap48: 'a StuG' };
  function armour(tk, from, wpn) {
    var a = Math.abs(Math.atan2(Math.sin(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h), Math.cos(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h)));
    var f = a < 0.8 ? 0 : a < 2.3 ? 1 : 2, base = ARMOUR[tk.model] || ARMOUR.sherman, pen = PEN[wpn || 'pf'];
    var dmg = base[f] * pen[f] * (f === 0 && wpn === 'ap75' && dist(tk, from) > 300 ? 0.5 : 1);
    return [['front', 'side', 'rear'][f], Math.round(dmg)];
  }""")
P('c_units.js', """  function hitTank(t, from) {
    t.hitFrom = { x: from.x, y: from.y, t: clock };
    var arm = t.climbing ? ['belly', 100] : armour(t, from);   // nose-up on a hedge bank, the thin belly is showing
    t.hp -= arm[1];
    if (t.hp <= 0) { knockOut(t, arm[0]); return; }""", """  function hitTank(t, from, wpn) {
    t.hitFrom = { x: from.x, y: from.y, t: clock };
    var arm = t.climbing ? ['belly', 100] : armour(t, from, wpn);   // nose-up on a hedge bank, the thin belly is showing
    if (arm[1] < 20 && Math.random() < 0.6) { say((t.side === 'axis' ? 'The shot bounced off the ' + t.name + '’s front.' : t.name + ': hit in the front, but it bounced off.')); fx.push({ t: 0, life: .3, x: t.x, y: t.y, kind: 'spark' }); return; }
    t.hp -= arm[1];
    if (t.hp <= 0) { knockOut(t, arm[0], from, wpn); return; }""")
P('c_units.js', """    say(t.name + ' hit in the ' + arm[0] + ': ' + what + '.' + (lost ? ' ' + words(lost) + ' of the men riding on it killed.' : ''));
  }
  function knockOut(t, where) {""", """    say((t.side === 'axis' ? 'Hit the ' : '') + t.name + (t.side === 'axis' ? ' in the ' : ' hit in the ') + arm[0] + ': ' + what + '.' + (lost ? ' ' + words(lost) + ' of the men riding on it killed.' : ''));
  }
  function knockOut(t, where, from, wpn) {""")
P('c_units.js', """    tally.crewOut += out;
    say(t.name + ' knocked out by a Panzerfaust to the ' + where + '. ' + (out ? words(out) + ' of the crew getting out.' : 'No one got out.'));""",
"""    if (from && alive(from)) { from.kills++; promote(from); }
    if (t.side === 'axis') { say(t.name + ' knocked out! ' + (from ? (isTank(from) ? from.name : squadName(from)) + ' hit it in the ' + where + '.' : '')); toast('StuG knocked out', t.x, t.y); }
    else { tally.crewOut += out;
      say(t.name + ' knocked out by ' + (WNAME[wpn] || WNAME.pf) + ' to the ' + where + '. ' + (out ? words(out) + ' of the crew getting out.' : 'No one got out.')); }""")

# ---- e_update: crews of either side, StuG update, Shermans fight armour, bazooka
P('e_update.js', """      var m = soldier(w[0], w[1], 'allies', 'tanker', p.tank.name, 'crew');
      units.push(m); order(m, RALLY.x + (Math.random() - .5) * 8, RALLY.y + (Math.random() - .5) * 8); m.retreating = true;""",
"""      if (p.tank.side === 'axis') {   // a StuG's crew run back the way they came
        var gm = soldier(w[0], w[1], 'axis', 'rifle', p.tank.name, 'crew'); units.push(gm); gm.retreating = true;
        order(gm, ENTRY.x + (Math.random() - .5) * 8, ENTRY.y + (Math.random() - .5) * 8); return false;
      }
      var m = soldier(w[0], w[1], 'allies', 'tanker', p.tank.name, 'crew');
      units.push(m); order(m, RALLY.x + (Math.random() - .5) * 8, RALLY.y + (Math.random() - .5) * 8); m.retreating = true;""")
P('e_update.js', """    axis.forEach(function (s) { if (sees(s)) { s.seenT = clock; s.last = { x: s.x, y: s.y, h: s.h, pose: s.pose }; } });""",
"""    axis.forEach(function (s) { if (sees(s)) { s.seenT = clock; s.last = { x: s.x, y: s.y, h: s.h, pose: s.pose };
      if (isTank(s) && !s.spotted) { s.spotted = true; toast('StuG!', s.x, s.y); var nb = allies.slice().sort(function (a, b) { return dist(a, s) - dist(b, s); })[0];
        say('Enemy armour! A StuG assault gun ' + (nb ? compass(s.x - nb.x, s.y - nb.y) + ' of ' + (isTank(nb) ? nb.name : squadName(nb)) : 'in sight') + '. Bazooka and Shermans: take it from the side.'); } } });""")
P('e_update.js', """      if (u.kind === 'tank') { if (alive(u)) updateTank(u, dt, axis, R); else updateWreck(u, dt); }""",
"""      if (u.kind === 'tank') { if (!alive(u)) updateWreck(u, dt); else if (u.side === 'axis') updateStug(u, dt, allies); else updateTank(u, dt, axis, R); }""")
P('e_update.js', """    var tanksLost = units.filter(function (u) { return isTank(u) && u.hp <= 0; }).length;""",
"""    var tanksLost = units.filter(function (u) { return isTank(u) && u.side === 'allies' && u.hp <= 0; }).length;
    var stugs = units.filter(function (u) { return isTank(u) && u.side === 'axis'; }), stugsOut = stugs.filter(function (u) { return u.hp <= 0; }).length;""")
P('e_update.js', """      + (tally.crewOut ? ', crew saved: ' + tally.crewSaved + ' of ' + tally.crewOut + ' who got out' : '') + '. Riflemen lost: ' + riflesLost + ' of ' + rifles.length + '.';""",
"""      + (tally.crewOut ? ', crew saved: ' + tally.crewSaved + ' of ' + tally.crewOut + ' who got out' : '') + '. Riflemen lost: ' + riflesLost + ' of ' + rifles.length + '.'
      + (stugs.length ? ' StuGs knocked out: ' + stugsOut + ' of ' + stugs.length + '.' : '');""")
# track marks shared
P('e_update.js', """    u.state = moving ? 'move' : 'halted';
    if (moving) {
      // two track marks every couple of metres, and dust off the lane
      if (!u.lastMark || Math.sqrt((u.x - u.lastMark[0]) * (u.x - u.lastMark[0]) + (u.y - u.lastMark[1]) * (u.y - u.lastMark[1])) > 2) {
        if (u.lastMark) mark({ kind: 'track', ax: u.lastMark[0], ay: u.lastMark[1], bx: u.x, by: u.y, h: u.h });
        u.lastMark = [u.x, u.y];
      }
      if (Math.random() < dt * 6) fx.push({ t: 0, life: 2.6, x: u.x - Math.cos(u.h) * 3.5 + Math.random() - .5, y: u.y - Math.sin(u.h) * 3.5 + Math.random() - .5, size: 2.5, kind: 'dust' });
    } else u.lastMark = null;
    resupply(u, dt);""", """    u.state = moving ? 'move' : 'halted';
    trackMarks(u, moving, dt);
    resupply(u, dt);""")
P('e_update.js', """    if (u.target && (!alive(u.target) || clock - u.target.seenT > 5)) u.target = null;
    var seen = axis.filter(function (s) { return canSee(u, s); });
    seen.sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var onTarget = u.target && seen.indexOf(u.target) >= 0;
    if (seen.length && u.mg <= 0) {""", """    if (u.target && (!alive(u.target) || clock - u.target.seenT > 5)) u.target = null;
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
    if (seen.length && u.mg <= 0) {""")
P('e_update.js', """  function updateWreck(u, dt) {""", """  function trackMarks(u, moving, dt) {
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
    var seen = foes.filter(function (a) { return canSee(u, a); }).sort(function (a, b) { return dist(u, a) - dist(u, b); });
    var armr = seen.filter(isTank), men = seen.filter(function (a) { return !isTank(a) && !a.riding; });
    if (seen.length) u.contact = clock;
    var tg = armr[0] && dist(u, armr[0]) < 700 ? armr[0] : men[0] && dist(u, men[0]) < 260 ? men[0] : null;
    var close = men.filter(function (m) { return dist(u, m) < 30; })[0];
    if (close && !u.backing && speed > 0) {
      var ba = Math.atan2(u.y - close.y, u.x - close.x), bc = nearestOpen(tankBlock, cellOf(u.x + Math.cos(ba) * 30, u.y + Math.sin(ba) * 30));
      if (bc) { var bw = centre(bc[0], bc[1]); if (order(u, bw[0], bw[1])) { u.backing = true; if (clock - u.seenT < 2) say('The ' + u.name + ' is backing off.'); } }
    }
    if (tg && !u.backing) u.path = null;   // halt and fight
    else if (!u.path && !u.backing && clock - (u.contact || -99) > 8 && u.goal && dist(u, u.goal) > 14) order(u, u.goal.x, u.goal.y);
    var moving = !!u.path && speed > 0 && move(u, speed * (u.backing ? 0.5 : 1), 0.7, dt, !!u.backing);
    if (!u.path) u.backing = false;
    separate(u);
    u.state = moving ? 'move' : 'halted';
    trackMarks(u, moving, dt);
    if (moving && clock - u.seenT > 3 && Math.random() < dt * 0.2) hear(u, 'tracks');   // you hear tracks before you see it
    if (u.dmg.track && !foes.some(function (a) { return dist(u, a) < 80 && canSee(a, u); })) {
      u.repair += dt / 40; if (u.repair >= 1) { u.dmg.track = false; u.repair = 0; }
    }
    if (u.hp < 50 && Math.random() < dt * 1.5) boom(u.x, u.y, 1.5, true);
    if (!tg || moving) return;
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
    if (!u.path && dist(u, RALLY) < 28 && u.rockets < 8 && clock - (u.rearmT || 0) > 6) { u.rearmT = clock; u.rockets++; if (u.rockets === 8) say(u.squad + ': rockets topped up.'); }
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
      if (Math.random() < 0.8 * Math.max(0.2, 1 - d / 130) * (tg.state === 'move' ? 0.7 : 1) * vetAcc(u) * (1 - u.supp / 250)) { boom(tg.x, tg.y, 3, false); hitTank(tg, u, 'bazooka'); }
      else { boom(tg.x + (Math.random() - .5) * 10, tg.y + (Math.random() - .5) * 10, 2, false); say(u.squad + ': missed the ' + tg.name + '.'); }
    } else blast(tg.x + (Math.random() - .5) * 3, tg.y + (Math.random() - .5) * 3, u, 0.8);
    if (!u.rockets) say(u.squad + ': out of rockets. Send them back to the rally point for more.'); else if (u.rockets === 2) say(u.squad + ': two rockets left.');
    return true;
  }

  function updateWreck(u, dt) {""")
P('e_update.js', """    } else if (u.role === 'mg' && mgUpdate(u, dt, tgt)) {
      // down behind the gun""", """    } else if (u.role === 'mg' && mgUpdate(u, dt, tgt)) {
      // down behind the gun
    } else if (u.role === 'bazooka' && bazooka(u, dt, vis)) {
      // the bazooka is on something""")
P('e_update.js', """      if (u.assault && tgt && inRange && u.shot <= 0) rifleShot(u, tgt);""", """      if (u.assault && tgt && inRange && u.shot <= 0 && !isTank(tgt)) rifleShot(u, tgt);""")
P('e_update.js', """      if (u.shot <= 0 && inRange && !u.pf) rifleShot(u, tgt);""", """      if (u.shot <= 0 && inRange && !u.pf && !isTank(tgt)) rifleShot(u, tgt);""")
P('e_update.js', """    if (u.role === 'crew' && dist(u, RALLY) < 16) {""", """    if (u.role === 'crew' && u.side === 'axis') { u.gone = true; return; }   // a StuG crew got away
    if (u.role === 'crew' && dist(u, RALLY) < 16) {""")
P('e_update.js', """    say((kind === 'pf' ? 'Panzerfaust fired' : kind === 'mg' ? 'MG42 fire' : 'Rifle fire') + ' from the hedges ' + compass(s.x - near.x, s.y - near.y) + ' of ' + (isTank(near) ? near.name : squadName(near)) + '.');""",
"""    var what = { pf: 'Panzerfaust fired from the hedges', mg: 'MG42 fire from the hedges', gun: 'A heavy gun firing', tracks: 'Tracks squealing out' }[kind] || 'Rifle fire from the hedges';
    say(what + ' ' + compass(s.x - near.x, s.y - near.y) + ' of ' + (isTank(near) ? near.name : squadName(near)) + '.');""")
P('e_update.js', """    if (clock - (hear.said || -99) < 15 && kind !== 'pf') return;""", """    if (clock - (hear.said || -99) < 15 && kind !== 'pf' && kind !== 'gun') return;""")
# threat: enemy armour first
P('e_update.js', """    var seen = team('axis').filter(function (s) { return clock - s.seenT < 8 && dist(s, t) < 180; }).sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];""",
"""    var armr = team('axis').filter(function (s) { return isTank(s) && clock - s.seenT < 8 && dist(s, t) < 700; }).sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];
    if (armr) return armr;
    var seen = team('axis').filter(function (s) { return clock - s.seenT < 8 && dist(s, t) < 180; }).sort(function (a, b) { return dist(a, t) - dist(b, t); })[0];""")
# PF stalk: pass the weapon
P('e_update.js', """hitTank(tk, u); else say('Panzerfaust missed ' + tk.name + '!');""", """hitTank(tk, u, 'pf'); else say('Panzerfaust missed ' + tk.name + '!');""")

# ---- k_ai: order friction for the bazooka team; crews don't counter-attack
P('k_ai.js', """|| men[0].role === 'scout' || men[0].role === 'crew';""", """|| men[0].role === 'scout' || men[0].role === 'crew' || men[0].squad === 'Bazooka';""")
P('k_ai.js', """s.role !== 'mg' && s.role !== 'loader') (squads""", """s.role !== 'mg' && s.role !== 'loader' && s.role !== 'crew') (squads""")
print('ok')
