
  // ------------------------------------------------------------------ units
  var CALL = ['Able', 'Baker'];
  var HE_LOAD = 15, SMOKE_LOAD = 6, SQUAD_SIZE = 8;   // a US rifle squad was twelve men; eight keeps it manageable   // high-explosive rounds kept for this fight, and bombs for the turret's 2-inch smoke mortar
  function tank(x, y, i) {
    return { kind: 'tank', side: 'allies', name: CALL[i], x: x, y: y, h: 0, hp: 100, path: null, gun: 2, mg: 0, state: 'halted',
      he: HE_LOAD, smoke: SMOKE_LOAD, heMode: 'auto', target: null, kills: 0, vet: 0, dmg: {}, repair: 0, crew: 5, model: 'sherman' };
  }
  function stug(x, y, name) {
    // the StuG III: a German assault gun. Low, thick in front, no turret: it turns the whole vehicle to lay its gun
    return { kind: 'tank', model: 'stug', side: 'axis', name: name, x: x, y: y, h: 0, hp: 100, path: null, gun: 3, mg: 0, state: 'halted',
      he: 12, ap: 24, target: null, kills: 0, vet: 0, dmg: {}, repair: 0, crew: 4, seenT: -99 };
  }
  // kit: 'rifle' (German), 'us' (American rifleman) or 'tanker' (a Sherman's crew). role: 'rifle', 'pf', 'nco' or 'crew'.
  function soldier(x, y, side, kit, squad, role) {
    var heart = { nco: 88, pf: 74, rifle: 68, crew: 42, mg: 80, loader: 70, scout: 72 }[role] + Math.random() * 14 + (side === 'axis' && started ? DIFF.heart : 0);   // reinforcements arriving mid-game get the difficulty too
    return { kind: 'inf', side: side, kit: kit, role: role, squad: squad, x: x, y: y, h: Math.random() * 6.28, hp: 100, path: null,
      shot: 1 + Math.random() * 3, anim: Math.random(), pose: 'idle', fired: 0, pf: role === 'pf' ? 1 : 0, state: 'exposed',
      seenT: -99, supp: 0, suppT: -9, pinned: false, sought: -99, morale: heart, heart: heart, kills: 0, vet: role === 'nco' ? 1 : 0,
      assault: false, retreating: false, broken: false };
  }
  // how each small arm behaves: effective range, seconds between shots, hit chance at point-blank
  var WEAPON = { rifle: { range: 150, every: [2.4, 4.4], acc: 0.2 },     // Kar98k, bolt action
                 us: { range: 150, every: [1.5, 2.8], acc: 0.2 },        // M1 Garand, semi-automatic
                 tanker: { range: 55, every: [0.8, 1.6], acc: 0.15 },    // M3 grease gun
                 mg42: { range: 250, every: [1.2, 2.0], acc: 0.16 },     // MG42, fired in bursts: see mgUpdate
                 para: { range: 120, every: [1.3, 2.4], acc: 0.17 },     // M1A1 carbine, the paratroopers' folding-stock carbine
                 bazooka: { range: 120, every: [1.3, 2.4], acc: 0.17 } }; // the bazooka team's own carbines   // MG42, fired in bursts: see mgUpdate
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function alive(u) { return u.hp > 0 && !u.gone; }
  function team(s) { return units.filter(function (u) { return u.side === s && alive(u); }); }
  function isTank(u) { return u.kind === 'tank'; }
  function squadOf(u) { return units.filter(function (v) { return v.kind === 'inf' && v.squad === u.squad && alive(v); }); }
  function squadName(u) { return u.role === 'crew' ? u.squad + '’s crew' : u.squad; }

  function order(u, x, y) {
    // infantry will climb a hedgerow bank if it saves a long way round; a tank only crashes through one if told to
    var p = u.kind === 'tank' ? path(tankBlock, [u.x, u.y], [x, y], u.crash ? tankSoft : null, 10)
                              : path(block, [u.x, u.y], [x, y], hedgeCell, 8);
    u.path = p ? p.slice(1) : null; u.wait = 0;
    return !!p;
  }
  function orderGroup(list, x, y) {
    var tanks = list.filter(isTank), men = list.filter(function (u) { return !isTank(u); });
    tanks.forEach(function (t, i) {
      if (t.dmg.track) { say(t.name + ' can’t move: the track is broken.'); return; }
      if (!i) { if (!order(t, x, y)) toast('No way through for ' + t.name, x, y); return; }
      // the second tank pulls up beside the first if there's room, otherwise behind it
      var a = Math.atan2(y - tanks[0].y, x - tanks[0].x), s = Math.sin(a), c = Math.cos(a);
      var spots = [[x - s * 8, y + c * 8], [x + s * 8, y - c * 8], [x - c * 12, y - s * 12], [x - c * 20, y - s * 20]];
      for (var k = 0; k < spots.length; k++) { var q = cellOf(spots[k][0], spots[k][1]); if (!blocked(tankBlock, q[0], q[1])) { order(t, spots[k][0], spots[k][1]); return; } }
      if (!order(t, x - c * 12, y - s * 12)) toast('No way through for ' + t.name, x, y);
    });
    if (!men.length) return;
    men.forEach(function (m) { if (m.riding) dismount(m, true); m.boardTo = null; });   // a move order gets them off the tank first
    if (men.some(function (m) { return m.broken; })) { say(squadName(men[0]) + ' won’t go. They’re shaken and pulling back.'); toast('Shaken: won’t move', x, y); men = men.filter(function (m) { return !m.broken; }); }
    if (men.length) delayOrder(men, x, y);
  }
  function moveMen(men, x, y) {
    // the squad spreads out in a line across the direction of travel, 3 m apart, and takes cover when it gets there
    var cx = 0, cy = 0, ok = 0; men.forEach(function (m) { cx += m.x / men.length; cy += m.y / men.length; });
    var a = Math.atan2(y - cy, x - cx), nx = -Math.sin(a), ny = Math.cos(a);
    men.forEach(function (m, i) { var o = (i - (men.length - 1) / 2) * 3; if (order(m, x + nx * o, y + ny * o)) ok++; m.arrive = true; m.retreating = false; });
    if (!ok) toast('No way through there', x, y);
  }

  function turnTo(u, ang, rate, dt) {
    var d = Math.atan2(Math.sin(ang - u.h), Math.cos(ang - u.h));
    var s = Math.max(-rate * dt, Math.min(rate * dt, d)); u.h += s;
    return Math.abs(d - s);
  }
  function move(u, speed, turn, dt, reverse) {
    // reverse: travel towards the waypoint with the hull pointing the other way (a tank backing off, front to the enemy)
    if (!u.path || !u.path.length) { u.path = null; return false; }
    var w = u.path[0], dx = w[0] - u.x, dy = w[1] - u.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1.2) { u.path.shift(); if (!u.path.length) u.path = null; return true; }
    var off = turnTo(u, Math.atan2(dy, dx) + (reverse ? Math.PI : 0), turn, dt), slow = terrain(u);
    u.climbing = slow < 1;
    if (off < 0.6) { var k = Math.min(d, speed * slow * dt * (1 - off / 0.6 * 0.5)); u.x += dx / d * k; u.y += dy / d * k; }
    return true;
  }
  function terrain(u) {
    // over a hedgerow bank: a soldier scrambles at a third of his pace; a Sherman grinds through at about a metre a second
    var c = cellOf(u.x, u.y), i = c[1] * G + c[0];
    if (c[0] < 0 || c[1] < 0 || c[0] >= G || c[1] >= G) return 1;
    return u.kind === 'tank' ? (tankBlock[i] ? 0.2 : 1) : (block[i] ? 0.35 : 1);
  }
  function separate(u) {
    // nobody shares space: tanks keep about a tank's width apart, soldiers step out of a tank's way and off each other's toes
    if (u.riding) return;
    units.forEach(function (o) {
      if (o === u || o.gone || o.riding || (o.kind === 'inf' && o.hp <= 0)) return;
      var gap = isTank(u) && isTank(o) ? 6 : isTank(u) || isTank(o) ? 3.4 : 0.9, d = dist(u, o);
      if (d >= gap || d < 0.01) return;
      if (isTank(u) && !isTank(o)) return;                        // soldiers get out of a tank's way, not the other way round
      {
        var push = (gap - d) * ((isTank(o) && !isTank(u)) || o.hp <= 0 ? 1 : 0.5), nx = u.x + (u.x - o.x) / d * push, ny = u.y + (u.y - o.y) / d * push, c = cellOf(nx, ny);
        if (!blocked(isTank(u) ? tankBlock : block, c[0], c[1])) { u.x = nx; u.y = ny; }
      }
    });
  }
  function tankAhead(u) {
    // another tank (or a wreck) within 9 m, more or less dead ahead
    return units.filter(function (o) {
      if (o === u || !isTank(o) || dist(u, o) > 9) return false;
      var a = Math.atan2(o.y - u.y, o.x - u.x); return Math.abs(Math.atan2(Math.sin(a - u.h), Math.cos(a - u.h))) < 0.7;
    })[0];
  }
  function routeAround(u, other) {
    // a halted tank or a wreck in the way: find a route that keeps clear of it
    var tmp = tankBlock.slice(), c0 = cellOf(other.x, other.y);
    for (var dr = -3; dr <= 3; dr++) for (var dc = -3; dc <= 3; dc++) { var c = c0[0] + dc, r = c0[1] + dr; if (c >= 0 && r >= 0 && c < G && r < G && dc * dc + dr * dr <= 9) tmp[r * G + c] = 1; }
    var end = u.path[u.path.length - 1], p = path(tmp, [u.x, u.y], end, u.crash ? tankSoft : null, 10);
    if (p) { u.path = p.slice(1); return true; }
    return false;
  }

  // ------------------------------------------------------------------ changing the ground: gaps in hedges, wrecks in lanes
  function rebuildTank(c0, R) {
    // after the ground changes, work out again where a tank fits nearby
    for (var dr = -R; dr <= R; dr++) for (var dc = -R; dc <= R; dc++) {
      var c = c0[0] + dc, r = c0[1] + dr; if (c < 1 || r < 1 || c >= G - 1 || r >= G - 1) continue;
      var any = 0, bld = 0;
      for (var y = -1; y <= 1; y++) for (var x = -1; x <= 1; x++) { var k = kindGrid[(r + y) * G + c + x]; if (k) any = 1; if (k >= 2) bld = 1; }
      tankBlock[r * G + c] = any; tankSoft[r * G + c] = any && !bld ? 1 : 0;
    }
  }
  function breach(x, y, r) {
    // open a gap: the hedge cells go, the height map there is flattened, and the picture gets torn earth over the hedge
    var c0 = cellOf(x, y), R = Math.ceil(r / CELL), changed = false;
    for (var dr = -R; dr <= R; dr++) for (var dc = -R; dc <= R; dc++) {
      var c = c0[0] + dc, rr = c0[1] + dr; if (c < 0 || rr < 0 || c >= G || rr >= G || dc * dc + dr * dr > R * R) continue;
      var i = rr * G + c; if (kindGrid[i] === 1) { kindGrid[i] = 0; block[i] = 0; hedgeCell[i] = 0; changed = true; }
    }
    if (!changed) return false;
    rebuildTank(c0, R + 2);
    var f = { x: x, y: y, r: r }; flats.push(f); flatten(f); mark({ kind: 'breach', x: x, y: y, r: r, seed: Math.random() * 1000 });
    return true;
  }
  function flatten(f) {
    // every pixel the gap's bushes covered, from the ground up to 7 m, now shows ground: nothing there to hide behind
    for (var gx = -f.r; gx <= f.r; gx += 0.5) for (var gy = -f.r; gy <= f.r; gy += 0.5) {
      if (gx * gx + gy * gy > f.r * f.r) continue;
      var p0 = proj(f.x + gx, f.y + gy, 0), p1 = proj(f.x + gx, f.y + gy, 7), X = Math.floor(p0[0]);
      for (var Y = Math.floor(p1[1]); Y <= Math.ceil(p0[1]); Y++) {
        var T = TILES.size, t = heights[Math.floor(X / T) + '_' + Math.floor(Y / T)];
        if (t && t.data) t.data[((Y % T) * t.w + (X % T)) * 4] = 0;
      }
    }
  }
  function wreckBlocks(t) {
    // a knocked-out Sherman is 30 tons of steel in the lane
    var c0 = cellOf(t.x, t.y);
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) { var c = c0[0] + dc, r = c0[1] + dr; if (c >= 0 && r >= 0 && c < G && r < G) { kindGrid[r * G + c] = 3; block[r * G + c] = 1; hedgeCell[r * G + c] = 0; } }
    rebuildTank(c0, 3);
  }

  // ------------------------------------------------------------------ effects
  function mark(m) { marks.push(m); paintMark(m); }   // craters, track marks and gaps stay on the ground
  function boom(x, y, size, smoke) { fx.push({ t: 0, life: smoke ? 3 : 0.7, x: x, y: y, size: size, kind: smoke ? 'smoke' : 'boom' }); }
  function tracer(a, b, col) { fx.push({ t: 0, life: 0.12, ax: a.x, ay: a.y, az: a.kind === 'tank' ? 2.2 : 1.4, bx: b.x, by: b.y, bz: b.kind === 'tank' ? 1.2 : 1.0, col: col, kind: 'line' }); }
  function muzzle(u, big) { fx.push({ t: 0, life: big ? 0.12 : 0.07, x: u.x + Math.cos(u.h) * (u.kind === 'tank' ? 5.5 : 0.8), y: u.y + Math.sin(u.h) * (u.kind === 'tank' ? 5.5 : 0.8), z: u.kind === 'tank' ? 2.3 : 1.3, size: big ? 1.6 : 0.5, kind: 'flash' }); }
  var radio = [], log = window.__radio = [];
  function say(t) { log.push(Math.round(clock) + 's ' + t); radio.unshift({ t: clock, text: t }); radio = radio.slice(0, 3); }
  function compass(dx, dy) { return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]; }
  function words(n) { return ['No one', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][n] || String(n); }

  // ------------------------------------------------------------------ states: how exposed a unit is
  // Infantry: exposed (standing in the open), moving, in cover (a hedgerow bank between them and the
  // shooter), pinned (suppressed, face down), assault (sprinting at the enemy) and retreat.
  // Each changes how likely incoming fire is to hit. Tanks: halted or moving, plus armour facing.
  var EXPOSE = { exposed: 1, move: 1.15, cover: 1, pinned: 1, assault: 1.4, retreat: 0.85, crossing: 1.6, riding: 1.8 };   // crossing: up on a hedgerow bank, against the sky
  function coverAgainst(u, from) {
    // a hedge or wall within 5 m of the soldier, on the line towards whoever is shooting
    var dx = from.x - u.x, dy = from.y - u.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    for (var i = 1; i <= 5; i++) { var c = cellOf(u.x + dx / d * i, u.y + dy / d * i); if (blocked(block, c[0], c[1])) return true; }
    return false;
  }
  function exposure(t, from, weapon) {
    var m = EXPOSE[t.state] || 1;
    if (t.pinned) m *= weapon === 'bullet' ? 0.5 : 0.7;               // face down in the dirt
    if (coverAgainst(t, from)) m *= weapon === 'bullet' ? 0.35 : 0.6; // bocage banks stop bullets better than blast
    return m;
  }
  function suppress(t, amt, from) {
    t.supp = Math.min(100, t.supp + amt * (t.state === 'assault' ? 0.5 : 1)); t.suppT = clock; t.engaged = true;
    if (from) t.suppFrom = { x: from.x, y: from.y, t: clock };
    if (t.hold) springAmbush(t);   // shot at: the ambush is blown
  }
  function findCover(u, threat, reach) {
    // nearest open cell within reach that puts a hedge between this soldier and the threat
    var c0 = cellOf(u.x, u.y), best = null, bd = 1e9, R = Math.round((reach || 14) / CELL);
    for (var dr = -R; dr <= R; dr++) for (var dc = -R; dc <= R; dc++) {
      if (blocked(block, c0[0] + dc, c0[1] + dr) || dc * dc + dr * dr > R * R) continue;
      var w = centre(c0[0] + dc, c0[1] + dr);
      if (coverAgainst({ x: w[0], y: w[1] }, threat) && dc * dc + dr * dr < bd) { bd = dc * dc + dr * dr; best = w; }
    }
    return best;
  }
  // how much a hit takes off: by the face it strikes, for each vehicle against a Panzerfaust; then, for each weapon,
  // how that compares (front, side, rear). The Sherman's 75 mm barely scratches a StuG's 80 mm front past 300 m;
  // the StuG's long 75 goes through a Sherman almost anywhere. The bazooka is weaker than the Panzerfaust.
  var ARMOUR = { sherman: [40, 65, 100], stug: [30, 65, 100] };
  var PEN = { pf: [1, 1, 1], bazooka: [0.75, 1.15, 1], ap75: [0.5, 1.3, 1], ap48: [1.75, 1.6, 1] };
  var WNAME = { pf: 'a Panzerfaust', bazooka: 'a bazooka', ap75: 'a Sherman', ap48: 'a StuG' };
  function armour(tk, from, wpn) {
    var a = Math.abs(Math.atan2(Math.sin(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h), Math.cos(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h)));
    var f = a < 0.8 ? 0 : a < 2.3 ? 1 : 2, base = ARMOUR[tk.model] || ARMOUR.sherman, pen = PEN[wpn || 'pf'];
    var dmg = base[f] * pen[f] * (f === 0 && wpn === 'ap75' && dist(tk, from) > 300 ? 0.5 : 1);
    return [['front', 'side', 'rear'][f], Math.round(dmg)];
  }
  function vetAcc(u) { return 1 + 0.12 * (u.vet || 0); }

  // ------------------------------------------------------------------ casualties, morale and experience
  function killed(v, by) {
    v.hp = 0;
    if (by && alive(by)) { by.kills++; promote(by); }
    tracker.death(v);
    if (v.kind !== 'inf') return;
    if (v.role === 'nco' && v.side === 'allies' && v.man) say(manLabel(v.man) + ' is down! ' + v.squad + ' has lost its sergeant.');
    // everyone nearby on his side sees him fall; losing the sergeant shakes the whole squad
    units.forEach(function (w) {
      if (w === v || w.kind !== 'inf' || !alive(w) || w.side !== v.side) return;
      if (v.role === 'nco' && w.squad === v.squad) w.morale -= 25;
      else if (dist(w, v) < 25) w.morale -= 15;
    });
    if (v.role === 'nco' && v.side === 'axis' && clock - v.seenT < 2) say('German NCO down. His squad is wavering.');
  }
  function promote(u) {
    var lv = u.kind === 'tank' ? (u.kills >= 7 ? 2 : u.kills >= 3 ? 1 : 0) : (u.kills >= 5 ? 2 : u.kills >= 2 ? 1 : u.vet);
    if (lv <= u.vet) return;
    u.vet = lv; if (u.kind === 'inf') u.heart = Math.min(100, u.heart + 10);
    if (u.side === 'allies') say((u.kind === 'tank' ? u.name + '’s crew are' : u.man ? manLabel(u.man) + ' (' + u.squad + ') is' : 'A man in ' + squadName(u) + ' is') + (lv === 2 ? ' veterans now.' : ' finding their feet.'));
  }

  function rifleShot(s, t) {
    // a rifle or SMG shot at whoever he can see; at a tank it just sparks off the armour
    var w = WEAPON[s.kit], d = dist(s, t);
    s.fired = 0.2; s.shot = (w.every[0] + Math.random() * (w.every[1] - w.every[0])) * (s.lowAmmo ? 1.8 : 1); s.lastFired = clock; s.engaged = true;
    tracer(s, t, s.side === 'axis' ? 'rgba(255,220,150,.55)' : 'rgba(215,232,255,.55)'); muzzle(s); sound.rifle(s);
    if (s.side === 'axis' && clock - s.seenT > 1.5) hear(s, 'rifle');
    if (t.kind === 'tank') { fx.push({ t: 0, life: .15, x: t.x, y: t.y, kind: 'spark' }); return; }
    suppress(t, 7, s);
    units.forEach(function (o) { if (o !== t && o.kind === 'inf' && o.side === t.side && alive(o) && dist(o, t) < 4) suppress(o, 3); });
    var p = w.acc * Math.max(0.15, 1 - d / w.range) * vetAcc(s) * germanAcc(s) * (s.assault && s.path ? 0.5 : 1) * (s.riding ? 0.5 : 1) * (clock < (s.volley || 0) ? 1.6 : 1) * exposure(t, s, 'bullet');
    if (Math.random() < p) killed(t, s);
  }
  function blast(x, y, by, power) {
    // high explosive: kills close in, pins and frightens further out. It doesn't care whose side you're on.
    boom(x, y, 6 * power, false); mark({ kind: 'crater', x: x, y: y, r: (1.6 + Math.random() * .6) * power }); sound.boom(x, y, power > 1.2);
    units.forEach(function (s) {
      if (s.kind !== 'inf' || !alive(s)) return;
      var d = Math.sqrt((s.x - x) * (s.x - x) + (s.y - y) * (s.y - y));
      if (d < 14 * power) { suppress(s, 70 - d * 3 / power); s.morale -= 8; if (s.role === 'mg') s.relocate = true; }
      if (d < 7 * power && Math.random() < (0.6 - d / (12 * power)) * exposure(s, by || { x: x + 1, y: y }, 'blast')) killed(s, by);
    });
  }
  function hitTank(t, from, wpn) {
    t.hitFrom = { x: from.x, y: from.y, t: clock };
    var arm = t.climbing ? ['belly', 100] : armour(t, from, wpn);   // nose-up on a hedge bank, the thin belly is showing
    if (arm[1] < 20 && Math.random() < 0.6) { say((t.side === 'axis' ? 'The shot bounced off the ' + t.name + '’s front.' : t.name + ': hit in the front, but it bounced off.')); fx.push({ t: 0, life: .3, x: t.x, y: t.y, kind: 'spark' }); return; }
    t.hp -= arm[1];
    if (t.hp <= 0) { knockOut(t, arm[0], from, wpn); return; }
    // short of a kill, something inside breaks
    var r = Math.random(), what;
    if (r < 0.35 && !t.dmg.track) { t.dmg.track = true; t.repair = 0; t.path = null; what = 'a track is broken'; }
    else if (r < 0.55 && !t.dmg.gun) { t.dmg.gun = true; what = 'the main gun is out'; }
    else if (r < 0.8 && !t.dmg.gunner) { t.dmg.gunner = true; what = 'the gunner is wounded'; }
    else { t.dmg.engine = true; what = 'the engine is damaged'; }
    var lost = throwRiders(t, 0.25);
    say((t.side === 'axis' ? 'Hit the ' : '') + t.name + (t.side === 'axis' ? ' in the ' : ' hit in the ') + arm[0] + ': ' + what + '.' + (lost ? ' ' + words(lost) + ' of the men riding on it killed.' : ''));
  }
  function knockOut(t, where, from, wpn) {
    // a penetration kills some of the five crew; the rest bail out over the next few seconds and run for it
    t.hp = 0; t.burnT = clock; tracker.death(t); t.cook = Math.random() < 0.6 ? clock + 8 + Math.random() * 17 : 0; t.path = null;
    var lost = where === 'front' ? (Math.random() < .5 ? 0 : 1) : where === 'side' ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
    var out = Math.max(0, t.crew - lost);
    for (var i = 0; i < out; i++) pendingCrew.push({ t: clock + 1.2 + i * 0.8 + Math.random() * 0.5, tank: t });
    clouds.push({ x: t.x, y: t.y, r: 4, t0: clock, life: 150, kind: 'wreck' });
    wreckBlocks(t); throwRiders(t, 0.5);
    if (from && alive(from)) { from.kills++; promote(from); }
    if (t.side === 'axis') { say(t.name + ' knocked out! ' + (from ? (isTank(from) ? from.name : squadName(from)) + ' hit it in the ' + where + '.' : '')); toast('StuG knocked out', t.x, t.y); }
    else { tally.crewOut += out;
      say(t.name + ' knocked out by ' + (WNAME[wpn] || WNAME.pf) + ' to the ' + where + '. ' + (out ? words(out) + ' of the crew getting out.' : 'No one got out.')); }
    sound.boom(t.x, t.y, true);
    selected = selected.filter(alive);
  }
