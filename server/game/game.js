// Hedgerows near Carentan: a test of the WW2 game. Two Shermans and a US rifle squad against a German
// rifle platoon in the bocage.
// Everything happens in world metres (x east, y north); the screen is the same orthographic view
// Blender rendered the map and sprites with, so a unit drawn at project(x, y) sits where it should.
// Plain ES5 so it can later run in the Fire TV's older WebView.
(function () {
  'use strict';
  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  var VW = 1920, VH = 1080;
  var LEVEL, CAM, SPR, TILES, TILES_DUSK, imgTank, imgStug, sheets = {}, tiles = {}, heights = {};
  var oc = document.createElement('canvas'), octx = oc.getContext('2d');   // scratch canvas for hiding parts of units
  var units = [], fx = [], marks = [], clouds = [], heard = [], pendingCrew = [], selected = [];
  var over = false, started = false, lastT = 0, clock = 0;
  var view = { x: 0, y: 0 };                         // top-left of the screen, in background pixels
  var block, kindGrid, hedgeCell, tankBlock, tankSoft, G, CELL, HALF, rally;
  var charges = { '1st Squad': 2 };   // demolition charges for blowing gaps in hedgerows
  var flats = [];                     // breaches in hedges: where the height map has to be flattened
  var tally = { crewOut: 0, crewSaved: 0, prisoners: 0, withdrew: 0, savedBy: {} };
  var params = {}; location.search.replace(/[?&](\w+)=?([^&]*)/g, function (_, k, v) { params[k] = v || '1'; });
  var TIME = 'day';            // 'mist', 'day' or 'dusk': chosen on the start screen
  var command = null;          // 'smoke', 'demo' or 'area' while waiting for the player to click where
  var WIND = [0.35, 0.12];     // metres a second; smoke and mist drift with it
  var mistPatches = [];
  // what the player has chosen to hide (the help box, the order buttons, the remote's hints), kept between games
  var prefs = { help: true, orders: true, hints: true };
  try { var saved = JSON.parse(localStorage.getItem('hedgerows.prefs') || '{}'); for (var pk in saved) prefs[pk] = saved[pk]; } catch (e) {}
  function savePrefs() { try { localStorage.setItem('hedgerows.prefs', JSON.stringify(prefs)); } catch (e) {} }

  function fit() {
    // the picture keeps its shape; the interface layer sits exactly over it, so nothing lands on the black bars
    var k = Math.min(window.innerWidth / VW, window.innerHeight / VH), u = document.getElementById('ui');
    cv.style.width = (VW * k) + 'px'; cv.style.height = (VH * k) + 'px';
    if (u) { u.style.width = (VW * k) + 'px'; u.style.height = (VH * k) + 'px'; u.style.left = (window.innerWidth - VW * k) / 2 + 'px'; u.style.top = (window.innerHeight - VH * k) / 2 + 'px'; }
  }
  window.addEventListener('resize', fit); fit();

  function get(url) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open('GET', url); x.onload = function () { x.status < 300 ? ok(JSON.parse(x.responseText)) : no(url); }; x.onerror = function () { no(url); }; x.send();
    });
  }
  function maybe(url) { return get(url).then(null, function () { return null; }); }
  function image(url) { return new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { ok(null); }; i.src = url; }); }

  // ------------------------------------------------------------------ the hour and the weather
  // Morning mist limits sight to about 55 m and burns off over four minutes; dusk is 110 m; a clear day 160 m.
  function sightRange() {
    if (TIME === 'mist') return 55 + Math.min(1, clock / 240) * 105;
    if (TIME === 'dusk') return 110;
    return 160;
  }
  function mistLeft() { return TIME === 'mist' ? Math.max(0, 1 - clock / 240) : 0; }
  function hourText() {
    var start = { mist: 6 * 60 + 10, day: 13 * 60 + 5, dusk: 21 * 60 + 15 }[TIME], m = Math.floor(start + clock / 60);
    var hh = Math.floor(m / 60) % 24, mm = m % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function weatherText() {
    if (TIME === 'mist') return mistLeft() > 0.05 ? 'ground mist, you can see about ' + Math.round(sightRange()) + ' m' : 'the mist has lifted';
    if (TIME === 'dusk') return 'dusk, light fading';
    return 'clear';
  }
  function cloudR(cl) {
    // smoke billows out over five seconds, hangs, then thins over its last ten
    var a = clock - cl.t0; if (a < 0) return 0;
    return cl.r * Math.min(1, a / 5) * (a > cl.life - 10 ? Math.max(0, (cl.life - a) / 10) : 1);
  }

  // ------------------------------------------------------------------ projection
  function proj(x, y, z) {
    var R = CAM.right, U = CAM.up, m = CAM.mPerPx;
    return [CAM.W / 2 + (x * R[0] + y * R[1] + z * R[2]) / m, CAM.H / 2 - (x * U[0] + y * U[1] + z * U[2]) / m];
  }
  function unproj(px, py) {                          // background pixel -> ground point (z = 0)
    var R = CAM.right, U = CAM.up, m = CAM.mPerPx;
    var a = (px - CAM.W / 2) * m, b = -(py - CAM.H / 2) * m;
    var det = R[0] * U[1] - R[1] * U[0];
    return [(a * U[1] - b * R[1]) / det, (R[0] * b - U[0] * a) / det];
  }

  // ------------------------------------------------------------------ the grid: what blocks movement and sight
  function cellOf(x, y) { return [Math.floor((x + HALF) / CELL), Math.floor((HALF - y) / CELL)]; }
  function centre(c, r) { return [c * CELL + CELL / 2 - HALF, HALF - (r * CELL + CELL / 2)]; }
  function blocked(grid, c, r) { return c < 0 || r < 0 || c >= G || r >= G || grid[r * G + c] === 1; }
  function seeLine(ax, ay, bx, by) {
    // Hedgerows and buildings block sight; the first and last few metres don't count (you can see out of your own hedge).
    var d = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), n = Math.ceil(d);
    for (var i = 4; i <= n - 4; i++) {   // the same points whichever end you look from
      var t = i / n, c = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (blocked(block, c[0], c[1])) return false;
    }
    // so does smoke, unless you're almost on top of each other
    if (d > 8) for (var k = 0; k < clouds.length; k++) {
      var cl = clouds[k], r = cloudR(cl); if (r < 1) continue;
      var f = Math.max(0, Math.min(1, ((cl.x - ax) * (bx - ax) + (cl.y - ay) * (by - ay)) / (d * d)));
      var px = ax + (bx - ax) * f - cl.x, py = ay + (by - ay) * f - cl.y;
      if (px * px + py * py < r * r) return false;
    }
    return true;
  }
  function path(grid, from, to, soft, cost) {
    // A* over 2 m cells, eight directions, no corner cutting. Cells marked in soft (hedgerows) can be crossed, but
    // each counts as `cost` cells of open ground, so a route only goes over a hedge when it saves a long way round.
    var pass = function (c, r) { if (c < 0 || r < 0 || c >= G || r >= G) return 0; var i = r * G + c; return !grid[i] ? 1 : soft && soft[i] ? cost : 0; };
    var s = cellOf(from[0], from[1]); if (!pass(s[0], s[1])) s = nearestOpen(grid, s);
    var e = cellOf(to[0], to[1]);
    if (!s) return null;
    if (pass(e[0], e[1]) !== 1) {                   // a blocked target: aim for the nearest open cell
      var best = null, bd = 1e9;
      for (var rr = -6; rr <= 6; rr++) for (var cc = -6; cc <= 6; cc++) if (pass(e[0] + cc, e[1] + rr) === 1 && cc * cc + rr * rr < bd) { bd = cc * cc + rr * rr; best = [e[0] + cc, e[1] + rr]; }
      if (!best) return null; e = best;
    }
    var heap = [], g = {}, came = {}, closed = {};
    function push(f, k) { heap.push([f, k]); var i = heap.length - 1; while (i) { var p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m; } }
      return top;
    }
    var h = function (c, r) { var dx = Math.abs(c - e[0]), dy = Math.abs(r - e[1]); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    var k0 = s[1] * G + s[0]; g[k0] = 0; push(h(s[0], s[1]), k0);
    var steps = 0;
    while (heap.length && steps++ < 60000) {
      var k = pop()[1]; if (closed[k]) continue; closed[k] = 1;
      var c = k % G, r = Math.floor(k / G);
      if (c === e[0] && r === e[1]) {
        var out = [], kk = k;
        while (kk !== undefined) { out.unshift(centre(kk % G, Math.floor(kk / G))); kk = came[kk]; }
        return smooth(grid, out);
      }
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        var nc = c + dc, nr = r + dr, w = pass(nc, nr);
        if (!w || (dc && dr && (!pass(c + dc, r) || !pass(c, r + dr)))) continue;
        var nk = nr * G + nc, ng = g[k] + w * (dc && dr ? 1.414 : 1);
        if (g[nk] === undefined || ng < g[nk]) { g[nk] = ng; came[nk] = k; push(ng + h(nc, nr), nk); }
      }
    }
    return null;
  }
  function nearestOpen(grid, c) {
    if (!blocked(grid, c[0], c[1])) return c;
    for (var rad = 1; rad < 30; rad++) for (var dr = -rad; dr <= rad; dr++) for (var dc = -rad; dc <= rad; dc++)
      if ((Math.abs(dr) === rad || Math.abs(dc) === rad) && !blocked(grid, c[0] + dc, c[1] + dr)) return [c[0] + dc, c[1] + dr];   // ring by ring, out to 60 m
    return null;
  }
  function clearLine(grid, a, b) {
    var d = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])), n = Math.ceil(d);
    for (var i = 0; i <= n; i++) { var c = cellOf(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); if (blocked(grid, c[0], c[1])) return false; }
    return true;
  }
  function smooth(grid, pts) {                       // drop waypoints you can drive straight past
    var out = [pts[0]], i = 0;
    while (i < pts.length - 1) {
      var j = pts.length - 1;
      while (j > i + 1 && !clearLine(grid, pts[i], pts[j])) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }

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

  // ------------------------------------------------------------------ difficulty
  // Easy, Normal or Hard, chosen on the start screen: how well the Germans shoot, how long they hold on, how many
  // come in the counter-attack, and how much artillery you get.
  var DIFFS = {
    easy:   { label: 'Easy',   acc: 0.75, heart: -12, waves: 1, arty: [4, 3], counter: 0 },
    normal: { label: 'Normal', acc: 1.0,  heart: 0,   waves: 2, arty: [3, 2], counter: 1 },
    hard:   { label: 'Hard',   acc: 1.2,  heart: 8,   waves: 3, arty: [2, 1], counter: 2 } };
  var DIFF = DIFFS[prefs.difficulty] || DIFFS.normal;
  function germanAcc(s) { return s.side === 'axis' ? DIFF.acc : 1; }

  // ------------------------------------------------------------------ seeing and being seen
  // Both sides spot by the same rules. You're easiest to see moving or firing; still and in cover you're hard to pick
  // out; still, in cover and holding your fire (an ambush), you're very hard to see until they're close. Tanks are big.
  // Scouts with binoculars see further. Within 25 m you see anything with a clear line.
  function spotRange(o, t) {
    var R = sightRange() * (o.role === 'scout' ? 1.35 : o.model === 'stug' && !isTank(t) ? 0.8 : isTank(o) ? 1.1 : 1);   // a buttoned-up StuG sees men poorly
    var k = 1, still = !t.path && !t.riding, firing = clock - (t.lastFired || -99) < 3;
    if (isTank(t)) k = 1.3;
    else if (firing) k = 1.2;
    else if (still) {
      var cover = coverAgainst(t, o);
      k = t.hold || (t.side === 'axis' && !t.engaged && !t.goal) ? (cover ? 0.35 : 0.6) : cover ? 0.6 : t.pinned ? 0.75 : 0.9;
      if (t.role === 'scout') k = Math.min(k, 0.5);
    }
    return Math.max(25, R * k);
  }
  function canSee(o, t) { return dist(o, t) < spotRange(o, t) && seeLine(o.x, o.y, t.x, t.y); }
  function holdRange(u) {
    // when a man is allowed to open fire: an ambush waits until they're within 40 m; German defenders who haven't been
    // spotted wait until you're within 90 m (the MG42 opens up at whatever it can see); scouts only shoot back
    if (u.hold) return 40;
    if (u.role === 'scout') return u.engaged ? 999 : 0;
    if (u.side === 'axis' && !u.engaged && !u.goal && u.role !== 'mg') return 90;
    return 999;
  }
  function springAmbush(u) {
    // the first shot from an ambush: the whole squad opens up together, and the first volley is deadly
    squadOf(u).forEach(function (m) { if (m.hold) { m.hold = false; m.volley = clock + 3; m.shot = Math.min(m.shot, Math.random() * 0.4); } });
    if (u.side === 'allies') say(squadName(u) + ': ambush! Open fire!');
  }

  // ------------------------------------------------------------------ German tactics
  // Counter-attack at once: lose a point and the nearest German squad not already fighting comes straight back for it,
  // one squad going round the flank. MG42 teams fire a few bursts and move before your HE finds them. Squads falling
  // back or crossing open ground under fire lay smoke.
  function gegenstoss(o) {
    var squads = {};
    team('axis').forEach(function (s) { if (s.kind === 'inf' && !s.broken && !s.retreating && s.role !== 'mg' && s.role !== 'loader' && s.role !== 'crew' && !/^Wache/.test(s.squad)) (squads[s.squad] = squads[s.squad] || []).push(s); });
    var free = Object.keys(squads).map(function (k) { return squads[k]; }).filter(function (sq) {
      return !sq.some(function (s) { return clock - (s.contact || -99) < 15; }) && dist(sq[0], o) < 260;
    }).sort(function (a, b) { return dist(a[0], o) - dist(b[0], o); }).slice(0, 1 + DIFF.counter);
    free.forEach(function (sq, i) {
      var via = i % 2 ? flankPoint(sq[0], o) : null;
      sq.forEach(function (s) { s.goal = { x: o.x + (Math.random() - .5) * 14, y: o.y + (Math.random() - .5) * 14 }; s.via = via; s.fallback = false; order(s, (via || s.goal).x, (via || s.goal).y); });
    });
    if (free.length) say('Germans are forming up to counter-attack the ' + o.name + '. Get ready.');
  }
  function flankPoint(from, o) {
    // a point 50 m off to one side of the straight line in, so the attack comes from an unexpected direction
    var dx = o.x - from.x, dy = o.y - from.y, l = Math.sqrt(dx * dx + dy * dy) || 1, s = Math.random() < 0.5 ? 1 : -1;
    var c = nearestOpen(block, cellOf(o.x - dx / l * 40 - dy / l * 50 * s, o.y - dy / l * 40 + dx / l * 50 * s));
    if (!c) return null; var w = centre(c[0], c[1]); return { x: w[0], y: w[1] };
  }
  function mgMove(u, why) {
    // shoot and scoot: a new spot 12 to 35 m away with a view towards the enemy, and the loader follows
    var foe = team('allies').filter(function (a) { return clock - (a.seenByAxis || -99) < 20; }).sort(function (a, b) { return dist(a, u) - dist(b, u); })[0] || { x: u.x + Math.cos(u.h) * 50, y: u.y + Math.sin(u.h) * 50 };
    var site = siteGun(u, foe, 35);
    if (dist(site, u) < 12) { var a = Math.random() * 6.28, c = nearestOpen(block, cellOf(u.x + Math.cos(a) * 20, u.y + Math.sin(a) * 20)); if (c) { var w = centre(c[0], c[1]); site = { x: w[0], y: w[1], h: site.h }; } }
    u.bursts = 0; u.setup = 0; u.relocate = false; u.goal = { x: site.x, y: site.y }; order(u, site.x, site.y);
    units.forEach(function (v) { if (v.role === 'loader' && v.squad === u.squad && alive(v)) { v.goal = { x: site.x - 1.5, y: site.y + 1 }; order(v, v.goal.x, v.goal.y); } });
    if (clock - u.seenT < 3) say('The MG42 is moving' + (why ? ' (' + why + ')' : '') + '.');
  }
  function germanSmoke(sq, towards) {
    // smoke candles: once per squad, between them and you
    if (sq[0].smoked || !towards) return;
    sq.forEach(function (s) { s.smoked = true; });
    var cx = 0, cy = 0; sq.forEach(function (s) { cx += s.x / sq.length; cy += s.y / sq.length; });
    var dx = towards.x - cx, dy = towards.y - cy, l = Math.sqrt(dx * dx + dy * dy) || 1, puffs = [];
    for (var i = 0; i < 8; i++) puffs.push({ a: Math.random() * 6.28, d: Math.sqrt(Math.random()), s: Math.random() });
    clouds.push({ x: cx + dx / l * 10, y: cy + dy / l * 10, r: 9, t0: clock + 1, life: 35, kind: 'smoke', puffs: puffs });
    if (sq.some(function (s) { return clock - s.seenT < 3; })) say('The Germans are laying smoke.');
  }

  // ------------------------------------------------------------------ command friction and resupply
  // Orders to a squad go through its sergeant. With him alive they're under way in half a second; without him the men
  // take two to four seconds to sort themselves out. Tanks on the radio are immediate.
  var pendingOrders = [];
  function delayOrder(men, x, y) {
    var nco = men.some(function (m) { return m.role === 'nco' && alive(m); }) || men[0].role === 'scout' || men[0].role === 'crew' || men[0].squad === 'Bazooka';
    var wait = nco ? 0.5 : 2 + Math.random() * 2;
    men.forEach(function (m) { m.orderWait = clock + wait; });
    pendingOrders.push({ men: men, x: x, y: y, t: clock + wait });
    if (!nco) say(squadName(men[0]) + ' has lost its sergeant: slow to get going.');
  }
  function runOrders() {
    pendingOrders = pendingOrders.filter(function (p) {
      if (clock < p.t) return true;
      var men = p.men.filter(alive); if (men.length) moveMen(men, p.x, p.y);
      return false;
    });
  }
  function resupply(t, dt) {
    // a Sherman halted at the rally point takes on HE and smoke bombs from the supply truck
    if (t.path || dist(t, RALLY) > 28) { t.supplying = false; return; }
    if (t.he >= HE_LOAD && t.smoke >= SMOKE_LOAD) return;
    if (!t.supplying) { t.supplying = true; t.supplyT = clock; say(t.name + ' re-arming at the rally point.'); }
    if (clock - t.supplyT > 5) { t.supplyT = clock; if (t.he < HE_LOAD) t.he++; else t.smoke++; }
  }

  // ------------------------------------------------------------------ feedback
  var toasts = [];
  function toast(text, x, y) { toasts.push({ text: text, x: x, y: y, t: clock, real: Date.now() }); }
  function drawToasts() {
    toasts = toasts.filter(function (o) { return Date.now() - o.real < 2600; });
    toasts.forEach(function (o) {
      var q = proj(o.x, o.y, 1), a = 1 - (Date.now() - o.real) / 2600, X = q[0] - view.x, Y = q[1] - view.y - 20 - (1 - a) * 16;
      ctx.globalAlpha = Math.min(1, a * 2); ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center';
      var w = ctx.measureText(o.text).width + 16; ctx.fillStyle = 'rgba(60,20,16,.85)'; ctx.fillRect(X - w / 2, Y - 16, w, 22);
      ctx.fillStyle = '#F2D6CF'; ctx.fillText(o.text, X, Y); ctx.globalAlpha = 1;
    });
  }
  function pinMark(u, x, y) {
    // a pinned man shows where the fire is coming from: a short red tick pointing towards it
    var f = u.suppFrom; if (!f || clock - f.t > 6) return;
    var a = Math.atan2(proj(f.x, f.y, 0)[1] - proj(u.x, u.y, 0)[1], proj(f.x, f.y, 0)[0] - proj(u.x, u.y, 0)[0]);
    ctx.strokeStyle = 'rgba(230,90,70,.9)'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24); ctx.stroke();
  }
  var gameSpeed = 1;

  // ------------------------------------------------------------------ the simulation
  var OBJ, RALLY;   // the farm the Germans hold, and the spot back down the lane where your crews are safe
  function update(dt) {
    clock += dt;
    var allies = team('allies'), axis = team('axis'), R = sightRange();
    // spotting: a German is on your screen only while one of your men or tanks can see him
    var sees = function (s) { return allies.some(function (a) { return !a.stray && canSee(a, s); }); };
    axis.forEach(function (s) { if (sees(s)) { s.seenT = clock; s.last = { x: s.x, y: s.y, h: s.h, pose: s.pose };
      if (isTank(s) && !s.spotted) { s.spotted = true; toast('StuG!', s.x, s.y); var nb = allies.filter(function (a) { return !a.stray; }).sort(function (a, b) { return dist(a, s) - dist(b, s); })[0];
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
    var tg = armr[0] && dist(u, armr[0]) < 700 ? armr[0] : men[0] && dist(u, men[0]) < 260 ? men[0] : null;
    var close = men.filter(function (m) { return dist(u, m) < 30; })[0];
    if (close && !u.backing && speed > 0) {
      var ba = Math.atan2(u.y - close.y, u.x - close.x), bc = nearestOpen(tankBlock, cellOf(u.x + Math.cos(ba) * 30, u.y + Math.sin(ba) * 30));
      if (bc) { var bw = centre(bc[0], bc[1]); if (order(u, bw[0], bw[1])) { u.backing = true; if (clock - u.seenT < 2) say('The ' + u.name + ' is backing off.'); } }
    }
    if (tg && !u.backing) u.path = null;   // halt and fight
    else if (!u.path && !u.backing && clock > (u.wait0 || 0) && clock - (u.contact || -99) > 8 && u.goal && dist(u, u.goal) > 14) order(u, u.goal.x, u.goal.y);
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
    var cr = OBJS[1], spot = mgSpot(cr, ENTRY);
    for (var j = 0; j < 2; j++) {
      var c2 = nearestOpen(block, cellOf(ENTRY.x - 30 - j * 2, ENTRY.y)), w2 = centre(c2[0], c2[1]);
      var g = soldier(w2[0], w2[1], 'axis', j ? 'rifle' : 'mg42', 'MG 2', j ? 'loader' : 'mg');
      g.goal = { x: spot.x + j * 1.5, y: spot.y + j * 1.5 }; units.push(g); order(g, g.goal.x, g.goal.y);
    }
    // the StuG: on Normal it waits at the end of the lane for the infantry to go in first; on Hard it comes straight on
    var dn = params.diff || prefs.difficulty || 'normal', sg = dn !== 'easy' && spawnStug(OBJS[1]); if (sg && dn === 'normal') sg.wait0 = clock + 100;
    if (!reinforced) bringUpSecond();
    say('Hold the farm and the crossroads for four minutes.');
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
    LEVEL.squads.slice(0, 2).forEach(function (p, si) {
      for (var k = 0; k < 5; k++) {
        var a = k * 1.26, x = p[0] + Math.cos(a) * 4, y = p[1] + Math.sin(a) * 4, c = cellOf(x, y);
        if (blocked(block, c[0], c[1])) { x = p[0]; y = p[1]; }
        units.push(soldier(x, y, 'axis', 'rifle', 'Gruppe ' + (si + 1), k < 2 ? 'pf' : k === 4 ? 'nco' : 'rifle'));
      }
    });
    // the second objective, the crossroads, held by a squad and an MG42 covering the lane from the farm;
    // and the lane at the east edge where the counter-attack comes in
    var xc = nearestOpen(block, cellOf(82, 82)), xw = centre(xc[0], xc[1]), ec = nearestOpen(block, cellOf(350, -20)), ew = centre(ec[0], ec[1]);
    ENTRY = { x: ew[0], y: ew[1] };
    OBJS = [{ name: 'farm', label: 'Farm', x: OBJ.x, y: OBJ.y, r: 22, owner: 'axis', prog: -1 }, { name: 'crossroads', label: 'Crossroads', x: xw[0], y: xw[1], r: 20, owner: 'axis', prog: -1 }];
    // the gun goes where it has the longest views up the lanes from the farm side
    var site = siteGun({ x: xw[0], y: xw[1] }, OBJ, 28);
    for (var j = 0; j < 2; j++) {
      var mc = nearestOpen(block, cellOf(site.x - Math.cos(site.h) * j * 1.8, site.y - Math.sin(site.h) * j * 1.8 + j)), mw = centre(mc[0], mc[1]);
      var gu = soldier(mw[0], mw[1], 'axis', j ? 'rifle' : 'mg42', 'MG 1', j ? 'loader' : 'mg'); gu.h = site.h; gu.setup = 3; units.push(gu);
    }
    for (var n = 0; n < 4; n++) {
      var gc = nearestOpen(block, cellOf(xw[0] + Math.cos(n * 1.6) * 8, xw[1] + Math.sin(n * 1.6) * 8)), gw = centre(gc[0], gc[1]);
      units.push(soldier(gw[0], gw[1], 'axis', 'rifle', 'Gruppe 4', n === 0 ? 'pf' : n === 3 ? 'nco' : 'rifle'));
    }
    spawnAirborne(function (i, m) { return [back.x + bx * (20 + i * 4) - by * (m * 2 - 4), back.y + by * (20 + i * 4) + bx * (m * 2 - 4), Math.atan2(-by, -bx)]; });
    placeStrays((params.diff || prefs.difficulty || 'normal') === 'easy' ? ['hidden', 'surrounded', 'captive', 'wounded'] : ['hidden', 'surrounded', 'captive']);
    selected = units.filter(isTank);
    var c0 = proj(LEVEL.shermans[0][0], LEVEL.shermans[0][1], 0), c1 = proj(OBJ.x, OBJ.y, 0);
    view.x = (c0[0] + c1[0]) / 2 - VW / 2; view.y = (c0[1] + c1[1]) / 2 - VH / 2; clampView();
  }

  // ------------------------------------------------------------------ missions and the campaign
  // Two battles near Carentan, June 1944: the push inland on 8 June, then the German counter-attack on the 13th. Played as a campaign, your men carry over: survivors keep their experience,
  // the dead are gone, sergeants are replaced from the ranks, and a few replacements come up between missions.
  // A defeat in the campaign means trying the mission again with the same men.
  var MISSIONS = {
    hedgerows: { id: 'hedgerows', map: 'hedgerows', title: 'Hedgerows near Carentan', date: '8 June 1944', hour: 'mist',
      brief: 'Two days after the landings. Two Shermans, 1st Squad, two scouts and a bazooka team have to take a farm and a crossroads in the bocage, then hold both when the Germans counter-attack. Paratroopers of the 101st are still scattered through these fields from the drop: find them and they’ll join you. The Germans have Panzerfausts, an MG42 and, they say, an assault gun.',
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
    WAVES = [{ t: 20, squads: n, mg: 1, stug: sg[0] }, { t: 210, squads: n + 1, mg: 1, stug: sg[1] }, { t: 390, squads: n + 1, mg: 1, stug: sg[2] }];
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
    var e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)]; ENTRY = e;
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

  // ------------------------------------------------------------------ the interface: small markers round the edges
  // Top left: a flag for each objective, with its capture bar. Top centre: the hour and what the mission needs now,
  // with the latest radio message under it for a few seconds. Top right: shells and smoke left, Germans in sight, and
  // small buttons (pause, speed, sound, radio log, help). Bottom left: a card for each of your tanks and squads; click
  // one to select it, click again to find it. Orders are on the command wheel: right-click, or OK on the remote.
  var ui = {}; ['objs', 'clock', 'ticker', 'res', 'cards', 'log', 'helpov'].forEach(function (k) { ui[k] = document.getElementById(k); });
  var uiLast = {};
  function setHTML(k, html) { if (uiLast[k] !== html) { ui[k].innerHTML = html; uiLast[k] = html; } }
  function mmss(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2); }
  var ICON = {
    flag: function (c) { return '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M5 2v16" stroke="#EDE8DA" stroke-width="1.6"/><path d="M5.8 3h10l-3 3.5 3 3.5h-10z" fill="' + c + '"/></svg>'; },
    tank: '<svg viewBox="0 0 30 18" width="28" height="17"><rect x="1" y="9" width="21" height="7" rx="3" fill="currentColor"/><rect x="6" y="4" width="10" height="6" rx="2" fill="currentColor"/><path d="M15 6.5h14" stroke="currentColor" stroke-width="2.2"/></svg>',
    helmet: '<svg viewBox="0 0 22 18" width="20" height="17"><path d="M4 13a7 7 0 0 1 14 0z" fill="currentColor"/><path d="M1.5 13.5h19" stroke="currentColor" stroke-width="2"/></svg>',
    scout: '<svg viewBox="0 0 24 16" width="22" height="15"><circle cx="6.5" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.5 8h1" stroke="currentColor" stroke-width="3"/></svg>',
    crew: '<svg viewBox="0 0 22 18" width="20" height="17"><circle cx="11" cy="9" r="6" fill="currentColor"/><path d="M5 9h12" stroke="#1b1b16" stroke-width="1.5"/></svg>',
    tube: '<svg viewBox="0 0 26 16" width="24" height="15"><path d="M2 9.5l21-5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M9 9l1.5 5" stroke="currentColor" stroke-width="2"/></svg>',
    shell: '<svg viewBox="0 0 12 20" width="10" height="17"><path d="M3 18V8q3-7 6 0v10z" fill="currentColor"/><path d="M2.5 15h7" stroke="#1b1b16" stroke-width="1.2"/></svg>',
    cloud: '<svg viewBox="0 0 24 16" width="22" height="15"><circle cx="7" cy="10" r="5" fill="currentColor"/><circle cx="13" cy="7" r="6" fill="currentColor"/><circle cx="18" cy="10" r="5" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 14" width="22" height="13"><path d="M1 7q11-12 22 0q-11 12-22 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="7" r="3" fill="currentColor"/></svg>' };
  function statusText() {
    if (MISSION.id === 'gulch') return 'Hold until relieved: ' + mmss(RELIEF - clock);
    if (phase === 'attack') return 'Take both points · counter-attack in ' + mmss(480 - clock);
    if (phase === 'warning') return 'Counter-attack in ' + mmss(phaseT - clock);
    return (OBJS.every(function (o) { return o.owner === 'allies'; }) ? 'Hold both until relieved: ' : 'Take and hold both until relieved: ') + mmss(holdUntil - clock);
  }
  function hud() {
    setHTML('objs', OBJS.map(function (o) {
      var col = o.owner === 'allies' ? '#7FA9DC' : o.owner === 'axis' ? '#D6503C' : '#CFC9B8', w = Math.abs(o.prog) * 50;
      return '<div class="chip' + (o.contested ? ' hot' : '') + '" data-obj="' + o.name + '" title="Show the ' + o.name + '">' + ICON.flag(col) + '<span>' + o.label + '</span>'
        + '<i class="bar"><i style="width:' + w + '%;margin-left:' + (o.prog >= 0 ? 50 : 50 - w) + '%;background:' + (o.prog >= 0 ? '#7FA9DC' : '#D6503C') + '"></i></i></div>';
    }).join(''));
    var wx = TIME === 'mist' ? (mistLeft() > 0.05 ? 'mist, ' + Math.round(sightRange()) + ' m' : 'clearing') : TIME === 'dusk' ? 'dusk' : 'clear';
    setHTML('clock', '<div class="chip"><span class="dim">' + hourText() + ' · ' + wx + '</span><span class="sep"></span>' + statusText() + (paused ? '<span class="sep"></span>Paused' : gameSpeed > 1 ? '<span class="sep"></span>2×' : '') + '</div>');
    var r = radio[0];
    setHTML('ticker', r && clock - r.t < 8 ? '<div class="chip line"><b>Radio</b> ' + r.text + '</div>' : '');
    var seen = team('axis').filter(function (u) { return clock - u.seenT < 1.5; }).length;
    setHTML('res', '<div class="chip" title="Artillery fire missions (V)">' + ICON.shell + arty.he + '</div><div class="chip" title="Smoke-shell missions (N)">' + ICON.cloud + arty.smoke + '</div>'
      + '<div class="chip" title="Germans in sight">' + ICON.eye + seen + '</div>'
      + '<button class="chip btn" data-cmd="pause" title="Pause (P)">' + (paused ? '▶' : '❚❚') + '</button>'
      + '<button class="chip btn" data-cmd="speed" title="Speed (+)">' + gameSpeed + '×</button>'
      + '<button class="chip btn" data-cmd="mute" title="Sound (M)">' + (sound.on() ? 'Sound' : 'Muted') + '</button>'
      + '<button class="chip btn" data-cmd="log" title="Radio log (L)">Radio</button>'
      + '<button class="chip btn" data-cmd="helpov" title="Help (?)">?</button>');
    if (ui.log.style.display === 'block') setHTML('log', '<b>Radio log</b>' + log.slice(-14).reverse().map(function (l) { return '<div>' + l.replace(/^(\d+)s /, function (_, s) { return '<span class="dim">' + mmss(+s) + '</span> '; }) + '</div>'; }).join(''));
  }
  function groupsOfMine() {
    var mine = team('allies').filter(function (u) { return !u.stray; }), out = [];
    mine.filter(isTank).forEach(function (t) { out.push({ key: t.name, units: [t], kind: 'tank' }); });
    var seen = {};
    mine.forEach(function (u) {
      if (isTank(u) || seen[u.squad]) return; seen[u.squad] = 1;
      out.push({ key: u.squad, units: mine.filter(function (v) { return !isTank(v) && v.squad === u.squad; }), kind: u.role === 'crew' ? 'crew' : u.role === 'scout' ? 'scout' : TEAM_SIZE[u.squad] ? 'team' : 'squad' });
    });
    return out;
  }
  function panel() {
    // one card per tank or squad: what it is, how it's doing, and whether it's in trouble
    var groups = groupsOfMine(), first = groups.filter(function (g) { return g.units.every(function (u) { return selected.indexOf(u) >= 0; }); })[0];
    var html = groups.map(function (g) {
      var sel = g.units.every(function (u) { return selected.indexOf(u) >= 0; }), u0 = g.units[0], line = '', flags = [];
      if (g.kind === 'tank') {
        line = '<i class="hp"><i style="width:' + Math.max(0, u0.hp) + '%;background:' + (u0.hp > 50 ? '#9FC2E6' : '#E0A84A') + '"></i></i>HE ' + u0.he + ' · smoke ' + u0.smoke;
        if (u0.dmg.track) flags.push('track'); if (u0.dmg.gun) flags.push('gun out'); if (u0.dmg.gunner) flags.push('gunner hit'); if (u0.dmg.engine) flags.push('engine');
        if (riders(u0).length) flags.push(riders(u0).length + ' riding'); if (u0.heMode === 'hold') flags.push('holding HE'); if (u0.crash) flags.push('crash');
      } else {
        var m = 0; g.units.forEach(function (v) { m += v.morale / g.units.length; });
        var mc = g.units.some(function (v) { return v.broken; }) ? '#D6503C' : m > 60 ? '#9FC2E6' : m > 38 ? '#E2B25A' : '#E0604A';
        line = g.units.map(function () { return '<i class="dot" style="background:' + mc + '"></i>'; }).join('');
        if (g.units.some(function (v) { return v.pinned; })) flags.push('pinned');
        if (g.units.some(function (v) { return v.broken; })) flags.push('broken');
        var bzk = g.units.filter(function (v) { return v.role === 'bazooka'; })[0];
        if (bzk) flags.push(bzk.rockets ? bzk.rockets + ' rockets' : 'no rockets');
        if (u0.hold) flags.push('ambush'); if (u0.riding) flags.push('riding'); if (u0.assault) flags.push('assault');
        if (!g.units.some(function (v) { return v.role === 'nco'; }) && g.kind === 'squad') flags.push('no sergeant');
      }
      var ic = g.kind === 'tank' ? ICON.tank : g.kind === 'scout' ? ICON.scout : g.kind === 'crew' ? ICON.crew : g.key === 'Bazooka' ? ICON.tube : ICON.helmet;
      var sgt = g.units.filter(function (v) { return v.role === 'nco' && v.man; })[0];
      return '<div class="card' + (sel ? ' sel' : '') + (flags.some(function (f) { return /pinned|broken|track|gun|engine/.test(f); }) ? ' warn' : '') + '" data-card="' + g.key + '">'
        + (g === first ? cardOrders(g) : '')   // only the first selected card opens up
        + '<div class="head"><span class="ic">' + ic + '</span><span class="tx"><b>' + (g.kind === 'crew' ? g.key + '’s crew' : g.key) + '</b>' + (sel && sgt ? ' <span class="dim">' + manLabel(sgt.man) + '</span>' : '')
        + '<span class="ln">' + line + '</span>' + (flags.length ? '<span class="fl">' + flags.join(' · ') + '</span>' : '') + '</span></div></div>';
    }).join('');
    setHTML('cards', html);
  }
  function cardOrders(g) {
    // the selected card opens upwards into that unit's orders: instant ones act at once, the ones that need a place
    // light up and wait for a click on the map
    var u = g.units[0], O = [];
    var add = function (cmd, label, key, on) { O.push('<button data-cmd="' + cmd + '"' + (on ? ' class="on"' : '') + '>' + label + (key ? ' <kbd>' + key + '</kbd>' : '') + '</button>'); };
    if (g.kind === 'tank') {
      add('area', 'Fire at a spot', 'T', command === 'area');
      if (u.smoke > 0) add('smoke', 'Smoke (' + u.smoke + ')', 'F', command === 'smoke');
      add('he', u.heMode === 'auto' ? 'Hold HE' : 'HE at will', 'H', u.heMode === 'hold');
      add('crash', 'Crash through hedges', 'C', u.crash);
      if (riders(u).length) add('ride', 'Riders off', 'U');
    } else if (g.kind !== 'crew') {
      add('assault', 'Assault', 'G', u.assault);
      add('hold', 'Ambush', 'X', u.hold);
      add('area', 'Fire at a spot', 'T', command === 'area');
      if (charges[u.squad]) add('demo', 'Blow a gap (' + charges[u.squad] + ')', 'B', command === 'demo');
      add('ride', u.riding ? 'Get off the tank' : 'Ride a Sherman', 'U');
    }
    add('arty', 'Artillery (' + arty.he + ')', 'V', command === 'arty');
    add('artysmoke', 'Smoke shells (' + arty.smoke + ')', 'N', command === 'artysmoke');
    if (g.kind !== 'tank') add('retreat', 'Back down the lane', 'R');
    add('halt', 'Halt', 'Space');
    return '<div class="orders">' + O.join('') + (command ? '<span class="hint">Now click on the map. Esc to cancel</span>' : '<span class="hint">Click the ground to move · right-click for the wheel</span>') + '</div>';
  }
  ui.cards.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('button[data-cmd]'); if (c) { doCommand(c.getAttribute('data-cmd')); return; }
    var b = e.target.closest && e.target.closest('[data-card]'); if (!b) return;
    var g = groupsOfMine().filter(function (x) { return x.key === b.getAttribute('data-card'); })[0]; if (!g) return;
    var already = g.units.every(function (u) { return selected.indexOf(u) >= 0; });
    selected = g.units; if (already) centreOn(g.units);   // a second click finds them
  });
  // every marker catches its own clicks, so none of them reaches the map as a move order
  ui.objs.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-obj]'); if (!c) return;
    var o = OBJS.filter(function (x) { return x.name === c.getAttribute('data-obj'); })[0]; if (o) centreOn([o]);
  });
  ui.ticker.addEventListener('click', function () { doCommand('log'); });
  ui.res.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('button[data-cmd]'); if (b) doCommand(b.getAttribute('data-cmd')); });
  function toggleBox(k) { ui[k].style.display = ui[k].style.display === 'block' ? 'none' : 'block'; uiLast[k] = null; }
  ui.helpov.addEventListener('click', function () { toggleBox('helpov'); });

  // ------------------------------------------------------------------ the command wheel
  // The orders for the selected units at that spot, round a ring. Mouse: hover and click (right-click or Escape to
  // close). Remote: the arrows go round the ring, OK gives the order, Back closes it.
  var WHEEL_ICON = {
    move: function (c) { c.moveTo(-9, 0); c.lineTo(7, 0); c.moveTo(2, -6); c.lineTo(8, 0); c.lineTo(2, 6); },
    assault: function (c) { c.moveTo(-9, -6); c.lineTo(-3, 0); c.lineTo(-9, 6); c.moveTo(-1, -6); c.lineTo(5, 0); c.lineTo(-1, 6); c.moveTo(6, -6); c.lineTo(10, 0); c.lineTo(6, 6); },
    area: function (c) { c.arc(0, 0, 7, 0, 6.3); c.moveTo(-11, 0); c.lineTo(-4, 0); c.moveTo(4, 0); c.lineTo(11, 0); c.moveTo(0, -11); c.lineTo(0, -4); c.moveTo(0, 4); c.lineTo(0, 11); },
    target: function (c) { c.arc(0, 0, 8, 0, 6.3); c.moveTo(0, -3); c.arc(0, 0, 2.5, 0, 6.3); },
    smoke: function (c) { c.arc(-5, 2, 4.5, 0, 6.3); c.moveTo(5, -2); c.arc(1, -2, 5, 0, 6.3); c.moveTo(11, 3); c.arc(6.5, 3, 4.5, 0, 6.3); },
    demo: function (c) { for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, r = i % 2 ? 5 : 11; c[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); },
    hold: function (c) { c.moveTo(-10, 0); c.quadraticCurveTo(0, -10, 10, 0); c.quadraticCurveTo(0, 10, -10, 0); c.moveTo(-8, 8); c.lineTo(8, -8); },
    ride: function (c) { c.rect(-10, 1, 18, 6); c.rect(-4, -4, 8, 5); c.moveTo(4, -2); c.lineTo(11, -2); },
    he: function (c) { c.moveTo(-3, 9); c.lineTo(-3, -1); c.quadraticCurveTo(0, -11, 3, -1); c.lineTo(3, 9); c.closePath(); },
    crash: function (c) { c.moveTo(-10, 6); c.lineTo(-4, -2); c.lineTo(0, 3); c.lineTo(5, -5); c.lineTo(10, 6); c.moveTo(-10, -8); c.lineTo(10, -8); },
    arty: function (c) { c.moveTo(-4, 9); c.lineTo(-4, -2); c.quadraticCurveTo(0, -12, 4, -2); c.lineTo(4, 9); c.closePath(); c.moveTo(-9, 9); c.lineTo(9, 9); },
    artysmoke: function (c) { c.arc(-4, 3, 4.5, 0, 6.3); c.moveTo(6, 0); c.arc(2, 0, 5, 0, 6.3); c.moveTo(0, -6); c.lineTo(0, -11); },
    retreat: function (c) { c.moveTo(9, 0); c.lineTo(-7, 0); c.moveTo(-2, -6); c.lineTo(-8, 0); c.lineTo(-2, 6); },
    halt: function (c) { c.rect(-7, -7, 14, 14); },
    select: function (c) { c.arc(0, 0, 9, 0, 6.3); c.moveTo(3, 0); c.arc(0, 0, 3, 0, 6.3); },
    pause: function (c) { c.rect(-6, -7, 4, 14); c.rect(2, -7, 4, 14); } };
  function iconFor(label) {
    var L = label.toLowerCase();
    return /^select/.test(L) ? 'select' : /^target/.test(L) ? 'target' : /^move/.test(L) ? 'move' : /^assault/.test(L) ? 'assault' : /^fire at this/.test(L) ? 'area'
      : /^smoke here/.test(L) ? 'smoke' : /gap/.test(L) ? 'demo' : /ambush|fire at will/.test(L) ? 'hold' : /tank|sherman|riders/.test(L) ? 'ride' : /^he:/.test(L) ? 'he'
      : /crash|gaps/.test(L) ? 'crash' : /^artillery/.test(L) ? 'arty' : /^smoke shells/.test(L) ? 'artysmoke' : /back down/.test(L) ? 'retreat' : /^halt/.test(L) ? 'halt' : /^pause/.test(L) ? 'pause' : 'move';
  }
  function wheelGeom(m) {
    var R = Math.max(96, 22 + m.items.length * 9);
    return { R: R, x: Math.max(R + 40, Math.min(VW - R - 40, m.x)), y: Math.max(R + 40, Math.min(VH - R - 40, m.y)) };
  }
  function wheelPick(m, px, py) {
    // which segment the mouse is over (or -1 near the middle)
    var w = wheelGeom(m), dx = px - w.x, dy = py - w.y;
    if (dx * dx + dy * dy < 44 * 44 || dx * dx + dy * dy > (w.R + 40) * (w.R + 40)) return -1;
    var a = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2 + Math.PI / m.items.length) % (Math.PI * 2);
    return Math.floor(a / (Math.PI * 2 / m.items.length)) % m.items.length;
  }
  function drawWheel(m) {
    var w = wheelGeom(m), n = m.items.length;
    ctx.fillStyle = 'rgba(14,14,10,.55)'; ctx.beginPath(); ctx.arc(w.x, w.y, w.R + 34, 0, 6.3); ctx.fill();
    m.items.forEach(function (it, i) {
      var a = -Math.PI / 2 + i * Math.PI * 2 / n, x = w.x + Math.cos(a) * w.R, y = w.y + Math.sin(a) * w.R, on = i === m.i;
      ctx.fillStyle = on ? '#EDE8DA' : 'rgba(30,30,24,.95)'; ctx.strokeStyle = on ? '#E2B25A' : 'rgba(237,232,218,.35)'; ctx.lineWidth = on ? 2.5 : 1.2;
      ctx.beginPath(); ctx.arc(x, y, 24, 0, 6.3); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.strokeStyle = on ? '#1b1b16' : '#EDE8DA'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      (WHEEL_ICON[it.icon || iconFor(it.label)] || WHEEL_ICON.move)(ctx); ctx.stroke(); ctx.restore();
    });
    // the middle: what the highlighted order is
    ctx.fillStyle = 'rgba(24,24,19,.96)'; ctx.beginPath(); ctx.arc(w.x, w.y, 58, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(237,232,218,.6)'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(m.title, w.x, w.y - 20);
    var label = m.items[m.i] ? m.items[m.i].label : '', words2 = label.split(' '), l1 = '', l2 = '';
    words2.forEach(function (wd) { if ((l1 + ' ' + wd).length <= 15 && !l2) l1 = (l1 ? l1 + ' ' : '') + wd; else l2 = (l2 ? l2 + ' ' : '') + wd; });
    ctx.fillStyle = '#EDE8DA'; ctx.font = '600 14px system-ui, sans-serif'; ctx.fillText(l1, w.x, w.y + 2); if (l2) ctx.fillText(l2, w.x, w.y + 20);
  }

  // ------------------------------------------------------------------ sound, all synthesised: no recordings to download
  // Every sound is placed in the world: quieter and duller with distance, panned left or right by where it is on
  // screen, and delayed by the speed of sound, so you see a distant shell land before you hear it. Birdsong
  // (crickets at dusk) carries on until the shooting starts, and comes back after 40 quiet seconds.
  var sound = (function () {
    var A = null, master, noise, on = !params.quiet, calm = 0, engines = {};
    function start() {
      if (A || !on) return;
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      A = new C(); master = A.createGain(); master.gain.value = 0.8; master.connect(A.destination);
      noise = A.createBuffer(1, A.sampleRate * 2, A.sampleRate);
      var d = noise.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      wind(); setTimeout(birds, 1200); setTimeout(artillery, 9000);
    }
    function toggle() { on = !on; if (on && !A) start(); if (master) master.gain.value = on ? 0.8 : 0; return on; }
    function where(x, y) {
      var L = unproj(view.x + VW / 2, view.y + VH / 2), d = Math.sqrt((x - L[0]) * (x - L[0]) + (y - L[1]) * (y - L[1]));
      var p = proj(x, y, 0);
      return { g: 1 / (1 + d / 45), pan: Math.max(-1, Math.min(1, (p[0] - view.x - VW / 2) / (VW * 0.6))), cut: Math.max(600, 16000 / (1 + d / 50)), delay: d / 340 };
    }
    function chain(pl, vol, pan) {
      // distance muffling, then volume, then left/right
      var f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = pl.cut;
      var g = A.createGain(); g.gain.value = vol * pl.g; f.connect(g);
      if (A.createStereoPanner) { var pn = A.createStereoPanner(); pn.pan.value = pan === undefined ? pl.pan : pan; g.connect(pn); pn.connect(master); } else g.connect(master);
      return f;
    }
    function hiss(dest, t, dur, type, freq, q, attack) {
      // a slice of noise through a filter, shaped by a fast attack and a decay
      var s = A.createBufferSource(); s.buffer = noise;
      var f = A.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      var e = A.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(1, t + (attack || 0.003)); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(e); e.connect(dest); s.start(t, Math.random() * 1.5, dur + 0.05);
      return f;
    }
    function thump(dest, t, f0, f1, dur, vol, type) {
      var o = A.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      var e = A.createGain(); e.gain.setValueAtTime(vol, t); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(e); e.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    }
    function cricket(x, y) {
      // the paratroopers' toy clicker, the drop-night recognition signal: click-clack
      if (!live()) return; var pl = where(x, y), t = A.currentTime + pl.delay, d = chain(pl, 0.6);
      [[0, 3400], [0.11, 2500]].forEach(function (c) { var o = A.createOscillator(), e = A.createGain(); o.type = 'square'; o.frequency.value = c[1];
        e.gain.setValueAtTime(0.0001, t + c[0]); e.gain.exponentialRampToValueAtTime(0.5, t + c[0] + 0.002); e.gain.exponentialRampToValueAtTime(0.0001, t + c[0] + 0.035);
        o.connect(e); e.connect(d); o.start(t + c[0]); o.stop(t + c[0] + 0.05); hiss(d, t + c[0], 0.03, 'bandpass', 4200, 4); });
    }
    function hush() { if (A) calm = A.currentTime + 40; }
    function live() { return A && on; }
    function rifle(u) {
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, u.kit === 'tanker' ? 0.3 : 0.5);
      hiss(d, t, 0.07, 'highpass', 1400); hiss(d, t + 0.005, 0.28, 'lowpass', 520); hush();
    }
    function mg(u) {
      // a Browning .30 burst: about eight rounds a second
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, 0.38);
      for (var i = 0; i < 6; i++) { hiss(d, t + i * 0.085, 0.045, 'highpass', 1200); hiss(d, t + i * 0.085, 0.12, 'lowpass', 420); }
      hush();
    }
    function gun(u) {
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, 1.0);
      thump(d, t, 80, 26, 0.8, 1.0); hiss(d, t, 1.1, 'lowpass', 1500); hiss(d, t, 0.06, 'highpass', 2500); hush();
    }
    function boomAt(x, y, big) {
      if (!live()) return; var pl = where(x, y), t = A.currentTime + pl.delay, d = chain(pl, big ? 1.3 : 0.85);
      thump(d, t, 60, 20, big ? 1.8 : 1.0, 1.0); hiss(d, t, big ? 2.6 : 1.3, 'lowpass', big ? 650 : 950); hush();
      if (big) for (var i = 0; i < 5; i++) hiss(d, t + 0.3 + Math.random() * 1.6, 0.15, 'bandpass', 900 + Math.random() * 900, 2);   // rounds going off inside
    }
    function pf(u, tk) {
      // the launch, a whoosh, and the strike
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, 0.7);
      thump(d, t, 120, 40, 0.3, 0.6); var w = hiss(d, t + 0.03, 0.45, 'bandpass', 500, 3, 0.05); w.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
      boomAt(tk.x, tk.y, false);
    }
    function thunk(u) {
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, 0.6);
      thump(d, t, 180, 60, 0.18, 0.7); hiss(d, t, 0.2, 'lowpass', 800);
      var pl2 = where(u.x, u.y), d2 = chain(pl2, 0.35); hiss(d2, t + 1.2, 1.4, 'lowpass', 600, 0, 0.2);   // the soft pop and hiss of the bomb
    }
    function engine(u) {
      // each Sherman has a running engine: a low growl, louder when moving, plus the squeal of the tracks
      if (!live()) return;
      var e = engines[u.name];
      if (!e) {
        e = engines[u.name] = {};
        e.f = A.createBiquadFilter(); e.f.type = 'lowpass'; e.f.frequency.value = 240;
        e.g = A.createGain(); e.g.gain.value = 0; e.f.connect(e.g);
        e.pn = A.createStereoPanner ? A.createStereoPanner() : null; if (e.pn) { e.g.connect(e.pn); e.pn.connect(master); } else e.g.connect(master);
        [31, 46.5, 62].forEach(function (hz, i) { var o = A.createOscillator(); o.type = i ? 'square' : 'sawtooth'; o.frequency.value = hz; var og = A.createGain(); og.gain.value = i ? 0.25 : 0.6; o.connect(og); og.connect(e.f); o.start(); (e.osc = e.osc || []).push(o); });
        var s = A.createBufferSource(); s.buffer = noise; s.loop = true;
        var sf = A.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2600; sf.Q.value = 7;
        e.sq = A.createGain(); e.sq.gain.value = 0; s.connect(sf); sf.connect(e.sq); e.sq.connect(e.g); s.start();
      }
      var pl = where(u.x, u.y), on2 = alive(u), mv = u.state === 'move', t = A.currentTime;
      e.g.gain.setTargetAtTime(on2 ? (mv ? 0.2 : 0.07) * pl.g * 2 : 0, t, 0.3);
      e.sq.gain.setTargetAtTime(on2 && mv ? 0.5 + 0.3 * Math.sin(t * 9) : 0, t, 0.1);
      e.osc.forEach(function (o, i) { o.frequency.setTargetAtTime([31, 46.5, 62][i] * (mv ? 1.25 : 1), t, 0.6); });
      e.f.frequency.setTargetAtTime(Math.min(pl.cut, mv ? 420 : 240), t, 0.3);
      if (e.pn) e.pn.pan.setTargetAtTime(pl.pan, t, 0.1);
    }
    function wind() {
      var s = A.createBufferSource(); s.buffer = noise; s.loop = true;
      var f = A.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      var g = A.createGain(); g.gain.value = 0.035; s.connect(f); f.connect(g); g.connect(master); s.start();
      var lfo = A.createOscillator(); lfo.frequency.value = 0.08; var lg = A.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    }
    function birds() {
      if (live() && A.currentTime > calm && !over) {
        var t = A.currentTime, pan = Math.random() * 2 - 1, d = chain({ g: 1, cut: 12000 }, 0.022, pan);
        if (TIME === 'dusk') {
          for (var i = 0; i < 8; i++) thump(d, t + i * 0.045, 4700, 4600, 0.025, 0.8);   // a cricket
        } else {
          var n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1400;
          for (var j = 0; j < n; j++) thump(d, t + j * 0.12, base, base * (1.3 + Math.random() * 0.4), 0.08, 1);
        }
      }
      setTimeout(birds, (TIME === 'dusk' ? 300 : 600) + Math.random() * 2200);
    }
    function artillery() {
      // somebody else's battle, a few miles off
      if (live() && !over) {
        var t = A.currentTime, pan = Math.random() * 1.6 - 0.8, d = chain({ g: 1, cut: 260 }, 0.22, pan), n = 2 + Math.floor(Math.random() * 3);
        for (var i = 0; i < n; i++) { thump(d, t + i * (0.5 + Math.random() * 0.5), 45, 20, 1.6, 1); hiss(d, t + i * 0.7, 2, 'lowpass', 200, 0, 0.05); }
      }
      setTimeout(artillery, 25000 + Math.random() * 45000);
    }
    function mg42(u) {
      // the MG42's rip: twenty rounds a second, too fast to hear as separate shots
      if (!live()) return; var pl = where(u.x, u.y), t = A.currentTime + pl.delay, d = chain(pl, 0.42);
      for (var i = 0; i < 16; i++) { hiss(d, t + i * 0.05, 0.04, 'highpass', 1700); hiss(d, t + i * 0.05, 0.08, 'lowpass', 520); }
      hush();
    }
    function whistle(x, y) {
      // an incoming shell, a second before it lands
      if (!live()) return; var pl = where(x, y), t = A.currentTime, d = chain({ g: Math.max(0.4, pl.g), cut: 9000, pan: pl.pan }, 0.12);
      var o = A.createOscillator(); o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(520, t + 1.05);
      var e = A.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.8, t + 0.7); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.08);
      o.connect(e); e.connect(d); o.start(t); o.stop(t + 1.1);
    }
    return { start: start, toggle: toggle, on: function () { return on; }, rifle: rifle, mg: mg, gun: gun, boom: boomAt, pf: pf, thunk: thunk, engine: engine, mg42: mg42, whistle: whistle, cricket: cricket };
  })();

  // ------------------------------------------------------------------ drawing
  var unitFilter = 'none', hover = null;
  // soft round puffs, pre-drawn once per kind: drawing these is far cheaper than a fresh gradient for every puff
  var PUFF = { smoke: [[0, '70,68,62', 1], [1, '70,68,62', 0]], black: [[0, '24,22,20', 1], [1, '24,22,20', 0]], dust: [[0, '150,132,104', 1], [1, '150,132,104', 0]],
               fire: [[0, '255,220,120', 1], [0.35, '240,120,40', 0.78], [1, '160,50,20', 0]], boom: [[0, '255,230,170', 1], [0.4, '240,140,50', 0.8], [1, '80,60,40', 0]],
               flash: [[0, '255,245,210', 1], [0.4, '255,190,90', 0.8], [1, '255,150,60', 0]], white: [[0, '214,214,206', 1], [0.6, '214,214,206', 0.52], [1, '214,214,206', 0]],
               dusksmoke: [[0, '150,146,150', 1], [0.6, '150,146,150', 0.52], [1, '150,146,150', 0]], mist: [[0, '220,222,218', 1], [0.55, '220,222,218', 0.47], [1, '220,222,218', 0]] };
  var puffs = {};
  function puff(kind) {
    if (puffs[kind]) return puffs[kind];
    var c = document.createElement('canvas'); c.width = c.height = 64; var g2 = c.getContext('2d'), gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    PUFF[kind].forEach(function (s) { gr.addColorStop(s[0], 'rgba(' + s[1] + ',' + s[2] + ')'); });
    g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    return (puffs[kind] = c);
  }
  function drawPuff(kind, X, Y, rad, alpha, squash) {
    if (alpha <= 0.01 || X < -rad || Y < -rad || X > VW + rad || Y > VH + rad) return;
    ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(puff(kind), X - rad, Y - rad * (squash || 1), rad * 2, rad * 2 * (squash || 1)); ctx.globalAlpha = 1;
  }
  var DUSK = 'brightness(0.95) saturate(0.85) sepia(0.12)';
  function draw() {
    ctx.fillStyle = '#1b1c16'; ctx.fillRect(0, 0, VW, VH);
    var T = TILES.size, dir = tileDir();
    for (var r = Math.floor(view.y / T); r <= Math.floor((view.y + VH) / T); r++)
      for (var c = Math.floor(view.x / T); c <= Math.floor((view.x + VW) / T); c++) {
        if (c < 0 || r < 0 || c >= TILES.cols || r >= TILES.rows) continue;
        var k = c + '_' + r, key = dir + k;
        if (!tiles[key]) { tiles[key] = new Image(); tiles[key].src = dir + k + '.jpg'; }
        if (pendingMarks[k] && tiles[key].complete) { var pm = pendingMarks[k]; delete pendingMarks[k]; pm.forEach(paintMark); }
        if (decals[k]) ctx.drawImage(decals[k], c * T - view.x, r * T - view.y);
        else if (tiles[key].complete) ctx.drawImage(tiles[key], c * T - view.x, r * T - view.y);
        if (!heights[k]) loadHeights(k);
      }
    if (TIME === 'dusk' && !TILES_DUSK) { ctx.fillStyle = 'rgba(30,24,50,.45)'; ctx.fillRect(0, 0, VW, VH); }
    if (TIME === 'dusk' && TILES_DUSK) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(96,80,84,.62)'; ctx.fillRect(0, 0, VW, VH); ctx.globalCompositeOperation = 'source-over'; }
    // selection rings, routes and targets under the units
    selected.forEach(function (u) {
      if (!alive(u)) return;
      var p = proj(u.x, u.y, 0), big = isTank(u); ctx.strokeStyle = 'rgba(159,194,230,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p[0] - view.x, p[1] - view.y, big ? 34 : 13, big ? 21 : 8, 0, 0, 6.3); ctx.stroke();
      if (u.path && u.path.length) {
        ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(p[0] - view.x, p[1] - view.y);
        u.path.forEach(function (w) { var q = proj(w[0], w[1], 0); ctx.lineTo(q[0] - view.x, q[1] - view.y); });
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (u.target && alive(u.target) && clock - u.target.seenT < 1.5) crosshair(u.target);
    });
    drawObjectives();
    // draw back to front; men riding a tank are drawn just after it
    var key = function (u) { var o = u.riding || u; return proj(o.x, o.y, 0)[1] + (u.riding ? 0.5 : 0); };
    var list = units.slice().sort(function (a, b) { return key(a) - key(b); });
    list.forEach(function (u) { if (isTank(u)) drawTank(u); else drawMan(u); });
    drawHeard();
    drawFx();
    drawClouds();
    drawMissions();
    if (TIME === 'mist') drawMist();
    if (TIME === 'dusk') {
      var vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VW * 0.65);
      vg.addColorStop(0, 'rgba(12,10,24,0)'); vg.addColorStop(1, 'rgba(12,10,24,.24)');
      ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
    }
    if (command === 'smoke' && hover) smokeCursor();
    if ((command === 'area' || command === 'demo') && hover) { ctx.fillStyle = 'rgba(237,232,218,.95)'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(command === 'area' ? 'Fire here' : 'Blow a gap here', hover[0], hover[1] - 16); }
    selected.forEach(function (u) {
      if (!alive(u) || !u.area) return;
      var q = proj(u.area.x, u.area.y, 0), r = 6 / CAM.mPerPx; ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(226,178,90,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(q[0] - view.x, q[1] - view.y, r, r * CAM.up[2], 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
    });
    if (drag && drag.box) { ctx.strokeStyle = 'rgba(159,194,230,.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); }
    compassRose();
    drawToasts();
    drawRemote();
    if (paused && !remote.menu) { ctx.fillStyle = 'rgba(10,10,8,.45)'; ctx.fillRect(0, 0, VW, VH); ctx.fillStyle = '#EDE8DA'; ctx.font = '400 40px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('Paused', VW / 2, VH / 2); ctx.font = '15px system-ui, sans-serif'; ctx.fillText('Press P to carry on', VW / 2, VH / 2 + 30); }
    hud();
  }

  // Ground marks (craters, track marks, gaps blown in hedges) are permanent, so each is painted once onto a layer
  // per background tile, and drawing a frame just lays those layers over the background.
  var decals = {}, pendingMarks = {};
  function tileDir() { return MAPP + (TIME === 'dusk' && TILES_DUSK ? 'tiles_dusk/' : 'tiles/'); }
  function paintMark(m) {
    var T = TILES.size, c = proj(m.kind === 'track' ? (m.ax + m.bx) / 2 : m.x, m.kind === 'track' ? (m.ay + m.by) / 2 : m.y, 0), pad = 140;
    for (var r = Math.floor((c[1] - pad - 120) / T); r <= Math.floor((c[1] + pad) / T); r++)
      for (var k = Math.floor((c[0] - pad) / T); k <= Math.floor((c[0] + pad) / T); k++) {
        if (k < 0 || r < 0 || k >= TILES.cols || r >= TILES.rows) continue;
        // the marks are painted straight into a copy of the background tile, so a frame still draws one image per tile
        var key = k + '_' + r, src = tiles[tileDir() + key];
        if (!decals[key]) {
          if (!src || !src.complete) { (pendingMarks[key] = pendingMarks[key] || []).push(m); continue; }
          decals[key] = document.createElement('canvas'); decals[key].width = src.width; decals[key].height = src.height;
          decals[key].getContext('2d').drawImage(src, 0, 0);
        }
        markOn(decals[key].getContext('2d'), m, k * T, r * T);
      }
  }
  function markOn(g2, m, ox, oy) {
    if (m.kind === 'crater') {
      var c = proj(m.x, m.y, 0), cx = c[0] - ox, cy = c[1] - oy, rx = m.r / CAM.mPerPx;
      if (heightAt(Math.floor(c[0]), Math.floor(c[1])) > 0.4) return;
      var gr = g2.createRadialGradient(cx, cy, 1, cx, cy, rx * 1.6);
      gr.addColorStop(0, 'rgba(28,24,18,.75)'); gr.addColorStop(0.45, 'rgba(45,38,28,.5)'); gr.addColorStop(1, 'rgba(60,50,36,0)');
      g2.fillStyle = gr; g2.beginPath(); g2.ellipse(cx, cy, rx * 1.6, rx * 1.6 * CAM.up[2], 0, 0, 6.3); g2.fill();
    } else if (m.kind === 'breach') {
      breachMark(g2, m, ox, oy);
    } else {
      var nx = -Math.sin(m.h) * 1.1, ny = Math.cos(m.h) * 1.1;
      g2.strokeStyle = 'rgba(40,34,24,.22)'; g2.lineWidth = 4; g2.beginPath();
      [-1, 1].forEach(function (sd) {
        var a = proj(m.ax + nx * sd, m.ay + ny * sd, 0), b = proj(m.bx + nx * sd, m.by + ny * sd, 0);
        g2.moveTo(a[0] - ox, a[1] - oy); g2.lineTo(b[0] - ox, b[1] - oy);
      });
      g2.stroke();
    }
  }

  function breachMark(g2, m, ox, oy) {
    // a gap torn through a hedge: a soft oval of churned earth over the ground and the bushes that stood there
    var g = proj(m.x, m.y, 0), top = proj(m.x, m.y, 3.0), X = g[0] - ox, Y = g[1] - oy, T = top[1] - oy, rx = m.r / CAM.mPerPx, ry = rx * CAM.up[2];
    var cy = (Y + ry + T) / 2, hy = (Y + ry - T) / 2 + ry * 0.4;
    g2.save(); g2.translate(X, cy); g2.scale(1, hy / rx);
    var gr = g2.createRadialGradient(0, 0, 0, 0, 0, rx);
    var tone = TIME === 'dusk' ? '46,38,34' : '70,57,40';
    gr.addColorStop(0, 'rgba(' + tone + ',.95)'); gr.addColorStop(0.62, 'rgba(' + tone + ',.88)'); gr.addColorStop(1, 'rgba(' + tone + ',0)');
    g2.fillStyle = gr; g2.beginPath(); g2.arc(0, 0, rx, 0, 6.3); g2.fill(); g2.restore();
    var sd = m.seed;
    for (var i = 0; i < 26; i++) {                      // clods, stones and broken roots
      sd = (sd * 9301 + 49297) % 233280; var a = sd / 233280; sd = (sd * 9301 + 49297) % 233280; var b = sd / 233280;
      g2.fillStyle = i % 3 ? 'rgba(40,32,22,.85)' : 'rgba(64,74,42,.85)';
      g2.fillRect(X + (a - .5) * rx * 1.4, cy + (b - .5) * hy * 1.4, 2 + (i % 3), 2);
    }
  }
  function drawTank(u) {
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
    var f = [];
    if (!alive(u)) f.push('brightness(0.35) saturate(0.3)');
    if (TIME === 'dusk') f.push(DUSK);
    unitFilter = f.length ? f.join(' ') : 'none';
    if (enemy && alive(u)) { var gq = proj(u.x, u.y, 0); ctx.fillStyle = 'rgba(214,80,60,.3)'; ctx.beginPath(); ctx.ellipse(gq[0] - view.x, gq[1] - view.y, 30, 17, 0, 0, 6.3); ctx.fill(); }
    blit(img, k * s, 0, s, s, p[0] - view.x - s / 2, p[1] - view.y - s / 2, s, s, proj(u.x, u.y, 0)[1], enemy ? [214, 80, 60] : [159, 194, 230]);
    unitFilter = 'none';
    if (alive(u)) bar(u, p, s);
  }

  function drawMan(u) {
    var deck = u.riding ? 1.9 : 0;   // men riding a Sherman stand on its engine deck
    var s2 = SPR.infantry, img = sheets[u.kit] || sheets.rifle, gp = proj(u.x, u.y, deck), p = proj(u.x, u.y, SPR.infantryLookZ + deck);
    var d = ((Math.round(u.h / (Math.PI / 4)) % 8) + 8) % 8, enemy = u.side === 'axis', prone = SPR.poses.indexOf('prone');
    unitFilter = TIME === 'dusk' ? DUSK : 'none';
    if (u.hp <= 0) {
      // the fallen lie where they fell; Germans only once you've seen them
      if (u.gone || (enemy && !u.bodySeen) || heightAt(Math.floor(gp[0]), Math.floor(gp[1])) > 0.4) { unitFilter = 'none'; return; }
      ctx.globalAlpha = 0.6; ctx.filter = TIME === 'dusk' ? DUSK + ' brightness(0.7)' : 'brightness(0.7) saturate(0.6)';
      ctx.drawImage(img, prone * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2);
      ctx.filter = 'none'; ctx.globalAlpha = 1; unitFilter = 'none';
      return;
    }
    if (u.gone || u.stray) return;   // paratroopers out there you haven't found yet
    var vis = enemy ? 1 - (clock - u.seenT) / 1.5 : 1;
    if (vis <= 0) { lastSeen(u, s2, img); unitFilter = 'none'; return; }
    ctx.globalAlpha = Math.min(1, vis);
    if (!deck && heightAt(Math.floor(gp[0]), Math.floor(gp[1])) < 0.4) {
      ctx.fillStyle = enemy ? 'rgba(214,80,60,.35)' : u.role === 'crew' ? 'rgba(200,220,240,.35)' : 'rgba(110,160,225,.4)';
      ctx.beginPath(); ctx.ellipse(gp[0] - view.x, gp[1] - view.y, 9, 5, 0, 0, 6.3); ctx.fill();
    }
    var pose = u.pose === 'walk' ? 'walk' + (Math.floor(u.anim * 9) % 6) : u.pose;
    var i = SPR.poses.indexOf(pose); if (i < 0) i = 0;
    blit(img, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2, gp[1], enemy ? [214, 80, 60] : [159, 194, 230]);
    unitFilter = 'none';
    if (enemy && u.pf) { ctx.fillStyle = '#E0604A'; ctx.fillRect(p[0] - view.x - 2, p[1] - view.y - s2 / 2 - 4, 4, 4); }
    badge(u, p[0] - view.x, p[1] - view.y - s2 / 2 - 12);
    if (u.pinned) pinMark(u, p[0] - view.x, p[1] - view.y);
    if (u.orderWait > clock) { ctx.fillStyle = 'rgba(237,232,218,.9)'; ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('…', p[0] - view.x, p[1] - view.y - s2 / 2 - 20); }
    if (u.vet) stripes(p[0] - view.x + 9, p[1] - view.y - s2 / 2 - 8, u.vet);
    ctx.globalAlpha = 1;
  }
  function stripes(x, y, n) {
    // veterancy: one or two gold chevrons
    ctx.strokeStyle = '#E2B25A'; ctx.lineWidth = 1.6; ctx.beginPath();
    for (var i = 0; i < n; i++) { ctx.moveTo(x - 3, y + i * 4); ctx.lineTo(x, y - 3 + i * 4); ctx.lineTo(x + 3, y + i * 4); }
    ctx.stroke();
  }
  function crosshair(t) {
    var q = proj(t.x, t.y, 0.9), x = q[0] - view.x, y = q[1] - view.y;
    ctx.strokeStyle = 'rgba(240,110,80,.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.3); ctx.moveTo(x - 16, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 16); ctx.stroke();
  }

  function drawHeard() {
    // gunfire you can hear but not see: rings pulsing out from roughly where it came from
    heard.forEach(function (h) {
      var age = (clock - h.t) / 4, q = proj(h.x, h.y, 0), x = q[0] - view.x, y = q[1] - view.y, col = h.kind === 'pf' ? '240,120,80' : h.kind === 'cricket' ? '159,194,230' : '226,178,90';
      ctx.lineWidth = 1.5;
      for (var k = 0; k < 2; k++) {
        var ph = (age * 3 + k * 0.5) % 1;
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.8 * (1 - age) * (1 - ph)).toFixed(3) + ')';
        ctx.beginPath(); ctx.ellipse(x, y, 8 + ph * 34, (8 + ph * 34) * 0.6, 0, 0, 6.3); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(' + col + ',' + (0.9 * (1 - age)).toFixed(3) + ')'; ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 4);
    });
  }

  function drawFx() {
    fx.forEach(function (f) {
      var k = f.t / f.life;
      if (f.kind === 'line') {
        var a = proj(f.ax, f.ay, f.az), b = proj(f.bx, f.by, f.bz);
        if (TIME === 'dusk') { ctx.shadowColor = f.col; ctx.shadowBlur = 10; }
        ctx.strokeStyle = f.col; ctx.lineWidth = TIME === 'dusk' ? 2.2 : 1.6; ctx.beginPath(); ctx.moveTo(a[0] - view.x, a[1] - view.y); ctx.lineTo(b[0] - view.x, b[1] - view.y); ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (f.kind === 'spark') {
        var q = proj(f.x, f.y, 1.5); ctx.fillStyle = 'rgba(255,230,160,' + (1 - k) + ')'; ctx.fillRect(q[0] - view.x - 2, q[1] - view.y - 2, 4, 4);
      } else if (f.kind === 'flash') {
        var qf = proj(f.x, f.y, f.z), rf = (f.size / CAM.mPerPx) * (TIME === 'dusk' ? 1.8 : 1) * (1 - k * 0.5);
        drawPuff('flash', qf[0] - view.x, qf[1] - view.y, rf, 1 - k);
      } else {
        var drift = f.kind === 'black' || f.kind === 'smoke' ? f.t * 2.5 : 0;
        var z = f.kind === 'smoke' ? 1 + k * 8 : f.kind === 'black' ? 2 + k * 16 : f.kind === 'dust' ? 0.6 + k * 1.5 : f.kind === 'fire' ? 0.8 + k * 2.2 : 0.5;
        var q2 = proj(f.x + WIND[0] * drift, f.y + WIND[1] * drift, z);
        var grow = f.kind === 'smoke' || f.kind === 'dust' ? (0.6 + k * 1.4) : f.kind === 'black' ? (0.7 + k * 2.4) : f.kind === 'fire' ? (1 - k * 0.6) : (0.4 + k * 0.8);
        var peak = { smoke: 0.45, black: 0.5, dust: 0.32, fire: 0.9, boom: 1 }[f.kind] || 1;
        drawPuff(f.kind, q2[0] - view.x, q2[1] - view.y, f.size * grow / CAM.mPerPx, peak * (1 - k));
      }
    });
  }

  function drawClouds() {
    // smoke screens: a cluster of soft puffs, billowing out and thinning, drifting with the wind
    clouds.forEach(function (cl) {
      if (cl.kind !== 'smoke') return;
      var r = cloudR(cl); if (r < 0.5) return;
      cl.puffs.forEach(function (pf) {
        var px = cl.x + Math.cos(pf.a) * pf.d * r * 0.7, py = cl.y + Math.sin(pf.a) * pf.d * r * 0.7, z = 1.5 + pf.s * 3 + (clock - cl.t0) * 0.03;
        var q = proj(px, py, z);
        drawPuff(TIME === 'dusk' ? 'dusksmoke' : 'white', q[0] - view.x, q[1] - view.y, r * (0.5 + pf.s * 0.35) / CAM.mPerPx, 0.5);
      });
    });
  }

  function drawMist() {
    // ground mist: an overall veil plus slow-drifting banks, both thinning as the sun burns it off
    var a = mistLeft(); if (a <= 0) return;
    ctx.fillStyle = 'rgba(205,208,204,' + (0.08 + 0.34 * a).toFixed(3) + ')'; ctx.fillRect(0, 0, VW, VH);
    mistPatches.forEach(function (m) {
      var q = proj(m.x + WIND[0] * clock, m.y + WIND[1] * clock, 1.5);
      drawPuff('mist', q[0] - view.x, q[1] - view.y, m.r / CAM.mPerPx, 0.38 * a, 0.55);
    });
  }

  function smokeCursor() {
    var g = unproj(hover[0] + view.x, hover[1] + view.y), q = proj(g[0], g[1], 0), x = q[0] - view.x, y = q[1] - view.y, r = 12 / CAM.mPerPx;
    var ts = selected.filter(function (u) { return isTank(u) && alive(u) && u.smoke > 0; }), ok = ts.some(function (t) { return dist(t, { x: g[0], y: g[1] }) <= 140; });
    ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = ok ? 'rgba(235,235,225,.9)' : 'rgba(240,110,80,.9)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * CAM.up[2], 0, 0, 6.3); ctx.stroke();
    ts.forEach(function (t) { var c = proj(t.x, t.y, 0), R = 140 / CAM.mPerPx; ctx.strokeStyle = 'rgba(235,235,225,.35)'; ctx.beginPath(); ctx.ellipse(c[0] - view.x, c[1] - view.y, R, R * CAM.up[2], 0, 0, 6.3); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(237,232,218,.95)'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(ok ? 'Smoke here' : 'Too far: 140 m at most', x, y - r * CAM.up[2] - 8);
  }

  function compassRose() {
    // north is to the right on this map
    var x = VW - 64, y = 64, n = proj(0, 1, 0), o = proj(0, 0, 0), dx = n[0] - o[0], dy = n[1] - o[1], l = Math.sqrt(dx * dx + dy * dy); dx /= l; dy /= l;
    ctx.fillStyle = 'rgba(20,20,16,.6)'; ctx.beginPath(); ctx.arc(x, y, 30, 0, 6.3); ctx.fill();
    ctx.strokeStyle = 'rgba(237,232,218,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - dx * 16, y - dy * 16); ctx.lineTo(x + dx * 16, y + dy * 16); ctx.stroke();
    ctx.fillStyle = '#EDE8DA'; ctx.beginPath(); ctx.moveTo(x + dx * 20, y + dy * 20); ctx.lineTo(x + dx * 10 - dy * 6, y + dy * 10 + dx * 6); ctx.lineTo(x + dx * 10 + dy * 6, y + dy * 10 - dx * 6); ctx.fill();
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', x + dx * 22 - dy * 12, y + dy * 22 + dx * 12 + 4);
  }

  function lastSeen(u, s2, img) {
    // where you last saw him: a faded figure and a dashed ring, fading over 25 seconds. He may well have moved.
    var age = clock - u.seenT; if (!u.last || age > 25) return;
    var a = 1 - age / 25, g = proj(u.last.x, u.last.y, 0), p = proj(u.last.x, u.last.y, SPR.infantryLookZ);
    var d = ((Math.round(u.last.h / (Math.PI / 4)) % 8) + 8) % 8, i = Math.max(0, SPR.poses.indexOf(u.last.pose === 'walk' ? 'idle' : u.last.pose));
    ctx.globalAlpha = 0.28 * a;
    ctx.drawImage(img, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2);
    ctx.globalAlpha = 0.7 * a; ctx.strokeStyle = '#D6503C'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.ellipse(g[0] - view.x, g[1] - view.y, 12, 7, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  function badge(u, x, y) {
    // cover: a green shield; pinned: amber chevrons; assault: red arrow; retreat: grey arrow; open ground: nothing
    ctx.lineWidth = 2;
    if (u.state === 'cover') { ctx.fillStyle = 'rgba(140,190,120,.95)'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); }
    else if (u.state === 'pinned') { ctx.strokeStyle = '#E2B25A'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x, y - 1); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x - 5, y); ctx.lineTo(x, y + 4); ctx.lineTo(x + 5, y); ctx.stroke(); }
    else if (u.state === 'assault') { ctx.fillStyle = '#E0604A'; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x - 5, y + 3); ctx.closePath(); ctx.fill(); }
    else if (u.state === 'ambush') { ctx.strokeStyle = 'rgba(140,190,120,.95)'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke(); }
    else if (u.state === 'crossing') { ctx.strokeStyle = '#E2B25A'; ctx.beginPath(); ctx.arc(x, y + 4, 6, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    else if (u.state === 'retreat') { ctx.fillStyle = 'rgba(200,196,184,.9)'; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 5, y - 3); ctx.lineTo(x - 5, y - 3); ctx.closePath(); ctx.fill(); }
  }
  function bar(u, p, s) {
    var w = 40, x = p[0] - view.x - w / 2, y = p[1] - view.y - s / 2 + 10;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = u.side === 'axis' ? '#D6503C' : u.hp > 50 ? '#9FC2E6' : '#E0A84A'; ctx.fillRect(x, y, w * u.hp / 100, 5);
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(237,232,218,.9)';
    ctx.fillText(u.name + ' · ' + (u.climbing ? 'Crashing through' : u.reversing && u.path ? 'Reversing' : u.wait > 0.5 ? 'Waiting' : u.state === 'move' ? 'Moving' : 'Halted'), x + w / 2, y - 4);
    if (u.vet) stripes(x + w + 8, y + 1, u.vet);
    var hurt = [];
    if (u.dmg.track) hurt.push('Track broken, repairing ' + Math.round(u.repair * 100) + '%');
    if (u.dmg.gun) hurt.push('Gun out');
    if (u.dmg.gunner) hurt.push('Gunner hit');
    if (u.dmg.engine) hurt.push('Engine damaged');
    if (hurt.length) { ctx.fillStyle = '#E0A84A'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(hurt.join(' · '), x + w / 2, y + 17); }
  }
  // ------------------------------------------------------------------ hiding units behind buildings and trees
  // The background is one flat picture, so a unit behind a farmhouse would be painted over its roof. Blender
  // also rendered a height map (h_*.png: the height of whatever the camera sees at each pixel, 0 to 15.3 m).
  // Any pixel of a unit that sits lower than the scene in front of it is hidden, and shown as a faint outline.
  function loadHeights(k) {
    heights[k] = { data: null };
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      var x = c.getContext('2d'); x.drawImage(im, 0, 0);
      heights[k] = { w: im.width, data: x.getImageData(0, 0, im.width, im.height).data };
      flats.forEach(flatten);   // gaps blown before this tile loaded
    };
    im.src = MAPP + 'tiles/h_' + k + '.png';
  }
  function heightAt(X, Y) {
    var T = TILES.size, t = heights[Math.floor(X / T) + '_' + Math.floor(Y / T)];
    if (!t || !t.data) return 0;
    return t.data[((Y % T) * t.w + (X % T)) * 4] * 15.3 / 255;
  }
  function tallest(x0, y0, w, h) {
    // a quick look at the height map under a sprite, every 4 px: is anything there taller than a man's ankles?
    var m = 0;
    for (var Y = y0; Y < y0 + h; Y += 4) for (var X = x0; X < x0 + w; X += 4) { var v = heightAt(X, Y); if (v > m) m = v; }
    return m;
  }
  function blit(img, sx, sy, sw, sh, dx, dy, dw, dh, footY, tint) {
    // footY: the unit's ground point, in background pixels. A pixel r rows above it is (footY - r) * m / up.z metres up.
    dx = Math.round(dx); dy = Math.round(dy);
    if (unitFilter !== 'none') ctx.filter = unitFilter;   // a wreck's blackening, or the dusk grade
    var bx = Math.floor(view.x + dx), by = Math.floor(view.y + dy);
    if (tallest(bx, by, dw, dh) < 0.4) { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); ctx.filter = 'none'; return; }   // nothing that could hide it
    oc.width = dw; oc.height = dh; octx.clearRect(0, 0, dw, dh); octx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    var id = octx.getImageData(0, 0, dw, dh), px = id.data, k = CAM.mPerPx / CAM.up[2], hid = false, T = TILES.size;
    for (var j = 0; j < dh; j++) {
      var Y = by + j, zu = Math.max(0, (footY - Y) * k), tile = null, tc = -1, ty = Math.floor(Y / T), row = (Y % T);
      for (var i = 0; i < dw; i++) {
        var o = (j * dw + i) * 4;
        if (!px[o + 3]) continue;
        var X = bx + i, c = Math.floor(X / T);
        if (c !== tc) { tc = c; tile = heights[c + '_' + ty]; }
        if (!tile || !tile.data) continue;
        if (tile.data[(row * tile.w + (X % T)) * 4] * (15.3 / 255) > zu + 0.4) {
          // the soft shadow baked into the sprite just disappears; the unit itself becomes an outline
          if (px[o + 3] < 120 || px[o] + px[o + 1] + px[o + 2] < 6) px[o + 3] = 0; else { px[o] = tint[0]; px[o + 1] = tint[1]; px[o + 2] = tint[2]; px[o + 3] = 100; }
          hid = true;
        }
      }
    }
    if (hid) octx.putImageData(id, 0, 0);
    ctx.drawImage(oc, dx, dy);
    ctx.filter = 'none';
  }

  // ------------------------------------------------------------------ playing with the Fire TV remote
  // The Hearth app hands the page six buttons: the four arrows, OK and Back (window.hearthKey). The arrows move a
  // cursor, faster the longer you hold them, and the view scrolls when it reaches the edge. OK on one of your units
  // selects it; OK anywhere else opens a menu of orders for that spot. Back clears the selection, or pauses.
  var remote = { on: !!params.remote, x: VW / 2, y: VH / 2, menu: null, last: 0, lastKey: '', speed: 1 };
  var paused = false;
  function tvMode() { if (!document.body.classList.contains('tv')) document.body.classList.add('tv'); }
  if (remote.on) tvMode();
  window.hearthKey = function (k) {
    remote.on = true; tvMode(); hover = [remote.x, remote.y];
    var ov = ['start', 'end'].filter(function (id) { return document.getElementById(id).style.display === 'flex'; })[0];
    if (ov) return navOverlay(ov, k);
    var m = remote.menu;
    if (m) {
      if (k === 'up' || k === 'left') m.i = (m.i + m.items.length - 1) % m.items.length;
      else if (k === 'down' || k === 'right') m.i = (m.i + 1) % m.items.length;
      else if (k === 'back') { remote.menu = null; if (m.pause) paused = false; }
      else if (k === 'ok') { var it = m.items[m.i]; remote.menu = null; if (m.pause) paused = false; it.run(); }
      return;
    }
    if (k === 'ok') return remoteOk();
    if (k === 'back') {
      if (command) { command = null; return; }
      if (selected.length) { selected = []; return; }
      return pauseMenu();
    }
    // arrows: a held button repeats about twenty times a second; the cursor speeds up while it's held
    var now = Date.now();
    remote.speed = k === remote.lastKey && now - remote.last < 180 ? Math.min(5, remote.speed + 0.25) : 1;
    remote.last = now; remote.lastKey = k;
    var step = 22 * remote.speed, dx = k === 'left' ? -step : k === 'right' ? step : 0, dy = k === 'up' ? -step : k === 'down' ? step : 0;
    remote.x += dx; remote.y += dy;
    var M = 140;   // within 140 px of the edge, the map scrolls instead
    if (remote.x < M) { view.x -= M - remote.x; remote.x = M; } if (remote.x > VW - M) { view.x += remote.x - (VW - M); remote.x = VW - M; }
    if (remote.y < M) { view.y -= M - remote.y; remote.y = M; } if (remote.y > VH - M) { view.y += remote.y - (VH - M); remote.y = VH - M; }
    clampView(); hover = [remote.x, remote.y];
  };
  function leave() { if (history.length > 1) history.back(); else location.href = '/'; }
  function navOverlay(id, k) {
    // the start and end screens: arrows move between the buttons, OK presses the one that's lit
    var bs = [].slice.call(document.querySelectorAll('#' + id + ' button')).filter(function (b) { return b.offsetParent !== null; });
    if (!bs.length) return;
    var cur = bs.indexOf(remote.focus) >= 0 ? remote.focus : document.getElementById('go') && id === 'start' ? document.getElementById('go') : bs[bs.length - 1];
    if (k === 'ok') { cur.click(); return; }
    if (k !== 'ok' && k !== 'back') {
      var r0 = cur.getBoundingClientRect(), best = null, bd = 1e9;
      bs.forEach(function (b) {
        if (b === cur) return;
        var r = b.getBoundingClientRect(), dx = r.left + r.width / 2 - (r0.left + r0.width / 2), dy = r.top + r.height / 2 - (r0.top + r0.height / 2);
        var ok = k === 'left' ? dx < -5 && Math.abs(dy) < 20 : k === 'right' ? dx > 5 && Math.abs(dy) < 20 : k === 'up' ? dy < -5 : dy > 5;
        var d = k === 'left' || k === 'right' ? Math.abs(dx) : Math.abs(dy) * 2 + Math.abs(dx) * 0.3;
        if (ok && d < bd) { bd = d; best = b; }
      });
      if (best) cur = best;
    }
    remote.focus = cur;
    bs.forEach(function (b) { b.style.outline = b === cur ? '3px solid #E2B25A' : 'none'; b.style.outlineOffset = '2px'; });
  }
  function centreOn(list) {
    if (!list.length) return;
    var x = 0, y = 0; list.forEach(function (u) { x += u.x / list.length; y += u.y / list.length; });
    var q = proj(x, y, 0); view.x = q[0] - VW / 2; view.y = q[1] - VH / 2; clampView(); remote.x = VW / 2; remote.y = VH / 2;
  }
  function openMenu(title, items, pause) { remote.menu = { title: title, items: items, i: 0, x: remote.x, y: remote.y, pause: !!pause }; }
  function pauseMenu() {
    paused = true;
    openMenu('Paused', [
      { label: 'Carry on', run: function () {} },
      { label: 'Start again', run: function () { location.reload(); } },
      { label: 'Sound ' + (sound.on() ? 'off' : 'on'), run: function () { sound.toggle(); } },
      { label: gameSpeed === 1 ? 'Double speed' : 'Normal speed', run: function () { doCommand('speed'); } },
      { label: prefs.hints ? 'Hide button hints' : 'Show button hints', run: function () { prefs.hints = !prefs.hints; savePrefs(); } },
      { label: 'Back to Hearth', run: leave }], true);
  }
  function remoteOk() {
    var sx = remote.x, sy = remote.y, g = unproj(sx + view.x, sy + view.y);
    if (command) {
      var cmd = command; command = null;
      if (cmd === 'smoke') fireSmoke(g[0], g[1]); else if (cmd === 'demo') plantCharge(g[0], g[1]);
      else if (cmd === 'area') areaAt(g[0], g[1]); else if (cmd === 'arty') callArty(g[0], g[1], 'he'); else if (cmd === 'artysmoke') callArty(g[0], g[1], 'smoke');
      return;
    }
    var u = unitAt(sx, sy);
    if (u) { selected = isTank(u) ? [u] : squadOf(u); return; }
    var sel = selected.filter(alive), ts = sel.filter(isTank), men = sel.filter(function (v) { return !isTank(v); }), foe = enemyAt(sx, sy), items = [];
    if (!sel.length) {
      // nothing selected: a menu for finding your units
      var mine = team('allies');
      [['Shermans', mine.filter(isTank)]].concat(groupsOfMine().filter(function (gr) { return gr.kind !== 'tank' && gr.kind !== 'crew'; }).map(function (gr) { return [gr.key, gr.units]; }))
       .concat([['Crews on foot', mine.filter(function (v) { return v.role === 'crew'; })]]).forEach(function (p) {
        if (p[1].length) items.push({ label: 'Select ' + p[0], run: function () { selected = p[1]; centreOn(p[1]); } });
      });
      items.push({ label: 'Artillery here (' + arty.he + ')', run: function () { callArty(g[0], g[1], 'he'); } });
      items.push({ label: 'Smoke shells here (' + arty.smoke + ')', run: function () { callArty(g[0], g[1], 'smoke'); } });
      items.push({ label: 'Pause', run: pauseMenu });
      return openMenu('Orders', items);
    }
    if (foe) items.push({ label: 'Target this German', run: function () { sel.forEach(function (s) { s.target = foe; }); say('Target marked.'); } });
    items.push({ label: 'Move here', run: function () { orderGroup(sel, g[0], g[1]); } });
    if (men.length && men[0].role !== 'crew') items.push({ label: 'Assault here', run: function () { men.forEach(function (m) { m.assault = true; }); orderGroup(sel, g[0], g[1]); } });
    items.push({ label: 'Fire at this spot', run: function () { areaAt(g[0], g[1]); } });
    if (ts.some(function (t) { return t.smoke > 0; })) items.push({ label: 'Smoke here (mortar, ' + ts[0].smoke + ')', run: function () { fireSmoke(g[0], g[1]); } });
    if (men.some(function (m) { return m.kit === 'us'; }) && charges[men[0].squad]) items.push({ label: 'Blow a gap in this hedge (' + charges[men[0].squad] + ')', run: function () { plantCharge(g[0], g[1]); } });
    if (men.length && men[0].role !== 'crew') items.push({ label: men[0].hold ? 'Fire at will' : 'Ambush: hold fire', run: function () { doCommand('hold'); } });
    if (men.length && men[0].role !== 'crew') items.push(men[0].riding ? { label: 'Get off the tank', run: function () { doCommand('ride'); } } : { label: 'Climb on a Sherman', run: function () { doCommand('ride'); } });
    if (ts.length && ts.some(function (t) { return riders(t).length; })) items.push({ label: 'Riders off', run: function () { doCommand('ride'); } });
    if (ts.length) {
      items.push({ label: 'HE: ' + (ts[0].heMode === 'auto' ? 'hold fire' : 'fire at will'), run: function () { doCommand('he'); } });
      items.push({ label: ts[0].crash ? 'Keep to the gaps' : 'Crash through hedges', run: function () { doCommand('crash'); } });
    }
    items.push({ label: 'Artillery here (' + arty.he + ')', run: function () { callArty(g[0], g[1], 'he'); } });
    items.push({ label: 'Smoke shells here (' + arty.smoke + ')', run: function () { callArty(g[0], g[1], 'smoke'); } });
    if (men.length) items.push({ label: 'Back down the lane', run: function () { doCommand('retreat'); } });
    items.push({ label: 'Halt', run: function () { doCommand('halt'); } });
    openMenu(ts.length ? ts.map(function (t) { return t.name; }).join(' and ') : squadName(men[0]), items);
  }
  function areaAt(x, y) { selected.filter(alive).forEach(function (u) { u.area = { x: x, y: y, until: clock + 20 }; u.target = null; }); say('Raking that position for 20 seconds.'); }
  function drawRemote() {
    if (remote.on && started && !remote.menu) {
      // the cursor: a ring with a dot, and what OK will do here
      var x = remote.x, y = remote.y, u = unitAt(x, y);
      ctx.strokeStyle = 'rgba(237,232,218,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.3); ctx.stroke();
      ctx.fillStyle = '#EDE8DA'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.3); ctx.fill();
      var hint = command ? { smoke: 'OK: smoke here', demo: 'OK: blow a gap here', area: 'OK: fire here', arty: 'OK: shells here', artysmoke: 'OK: smoke shells here' }[command]
        : u ? 'OK: select ' + (isTank(u) ? u.name : squadName(u)) : selected.length ? 'OK: orders' : 'OK: menu';
      ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(20,20,16,.7)';
      if (prefs.hints || command) { var w = ctx.measureText(hint).width + 14; ctx.fillRect(x + 20, y + 10, w, 22); ctx.fillStyle = '#EDE8DA'; ctx.fillText(hint, x + 27, y + 26); }
    }
    var m = remote.menu; if (!m) return;
    if (!m.pause) return drawWheel(m);
    // the pause menu: a column of choices in the middle
    var W = 330, H = 40 + m.items.length * 34, mx = m.pause ? VW / 2 - W / 2 : Math.min(VW - W - 20, m.x + 24), my = m.pause ? VH / 2 - H / 2 : Math.max(20, Math.min(VH - H - 20, m.y - 40));
    if (m.pause) { ctx.fillStyle = 'rgba(10,10,8,.5)'; ctx.fillRect(0, 0, VW, VH); }
    ctx.fillStyle = 'rgba(24,24,19,.94)'; ctx.strokeStyle = 'rgba(237,232,218,.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(mx, my, W, H); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.font = '500 17px Georgia, serif'; ctx.fillStyle = '#EDE8DA'; ctx.fillText(m.title, mx + 18, my + 27);
    m.items.forEach(function (it, i) {
      var y = my + 40 + i * 34;
      if (i === m.i) { ctx.fillStyle = '#EDE8DA'; ctx.fillRect(mx + 8, y, W - 16, 30); }
      ctx.fillStyle = i === m.i ? '#1b1b16' : '#EDE8DA'; ctx.font = '15px system-ui, sans-serif'; ctx.fillText(it.label, mx + 18, y + 20);
    });
  }
  // On a desktop, ?remote=1 turns the arrow keys, Enter and Escape into the remote, for testing
  window.addEventListener('keydown', function (e) {
    if (window.HearthNative || !remote.on) return;
    var k = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', Escape: 'back' }[e.key];
    if (k) { e.preventDefault(); e.stopImmediatePropagation(); window.hearthKey(k); }
  }, true);

  // ------------------------------------------------------------------ the panels
  function moraleWord(men) {
    var m = 0; men.forEach(function (u) { m += u.morale / men.length; });
    return men.some(function (u) { return u.broken; }) ? 'broken' : m > 60 ? 'steady' : m > 38 ? 'shaken' : 'close to breaking';
  }

  function doCommand(c) {
    var sel = selected.filter(alive), ts = sel.filter(isTank), men = sel.filter(function (u) { return !isTank(u); });
    if (c === 'smoke') command = command === 'smoke' || !ts.length ? null : 'smoke';
    else if (c === 'area') command = command === 'area' || !sel.length ? null : 'area';
    else if (c === 'arty') command = command === 'arty' ? null : 'arty';
    else if (c === 'artysmoke') command = command === 'artysmoke' ? null : 'artysmoke';
    else if (c === 'pause') paused = !paused;
    else if (c === 'speed') { gameSpeed = gameSpeed === 1 ? 2 : 1; say(gameSpeed === 2 ? 'Double speed.' : 'Normal speed.'); }
    else if (c === 'hold' && men.length) {
      var hv = !men[0].hold; men.forEach(function (m) { m.hold = hv; if (hv) m.path = null; });
      say(squadName(men[0]) + (hv ? ': ambush. Holding fire until they’re within 40 m.' : ': fire at will.'));
    }
    else if (c === 'log') toggleBox('log');
    else if (c === 'helpov' || c === 'help') toggleBox('helpov');
    else if (c === 'ride') {
      var tr = ts.filter(function (t) { return riders(t).length; });
      if (men.length && men[0].riding) { men.forEach(function (m) { dismount(m, false); }); say(squadName(men[0]) + ' off the tank.'); }
      else if (men.length && men[0].role !== 'crew') mount(men.filter(function (m) { return !m.broken; }));
      else if (tr.length) tr.forEach(function (t) { riders(t).forEach(function (m) { dismount(m, false); }); say('Riders off ' + t.name + '.'); });
    }
    else if (c === 'demo') command = command === 'demo' || !men.some(function (u) { return u.kit === 'us'; }) ? null : 'demo';
    else if (c === 'crash' && ts.length) {
      var cr = !ts[0].crash; ts.forEach(function (t) { t.crash = cr; });
      say(cr ? ts.map(function (t) { return t.name; }).join(' and ') + ' will crash through hedges where it saves a long way round. Slow, no firing, and the belly is exposed.' : 'Keeping to the gaps.');
    }
    else if (c === 'he' && ts.length) {
      var m = ts[0].heMode === 'auto' ? 'hold' : 'auto'; ts.forEach(function (t) { t.heMode = m; });
      say(m === 'hold' ? 'Holding HE: machine guns only, unless you give them a target.' : 'HE: fire at will.');
    } else if (c === 'halt') sel.forEach(function (u) { if (!u.broken) { u.path = null; u.assault = false; } });
    else if (c === 'assault' && men.length && men[0].role !== 'crew') {
      var on = !men[0].assault; men.forEach(function (u) { u.assault = on; });
      say(squadName(men[0]) + (on ? ': assault. The next move goes in at the run, firing.' : ': steady advance.'));
    } else if (c === 'retreat' && men.length) {
      men.forEach(function (u) { u.retreating = true; u.assault = false; order(u, RALLY.x + (Math.random() - .5) * 10, RALLY.y + (Math.random() - .5) * 10); });
    } else if (c === 'mute') sound.toggle();
  }

  // ------------------------------------------------------------------ input: select, order, target, scroll
  var drag = null, keys = {};
  function toCanvas(e) { var b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * VW / b.width, (e.clientY - b.top) * VH / b.height]; }
  function unitAt(px, py) {
    var best = null, bd = 1e9;
    units.forEach(function (u) {
      if (u.side !== 'allies' || !alive(u) || u.riding || u.stray) return;
      var p = proj(u.x, u.y, isTank(u) ? 1 : 0.9), d = Math.sqrt((p[0] - view.x - px) * (p[0] - view.x - px) + (p[1] - view.y - py) * (p[1] - view.y - py));
      if (d < (isTank(u) ? 40 : 18) && d < bd) { bd = d; best = u; }
    });
    return best;
  }
  function enemyAt(px, py) {
    var best = null, bd = 20;
    units.forEach(function (u) {
      if (u.side !== 'axis' || !alive(u) || clock - u.seenT > 1.5) return;
      var p = proj(u.x, u.y, 0.9), d = Math.sqrt((p[0] - view.x - px) * (p[0] - view.x - px) + (p[1] - view.y - py) * (p[1] - view.y - py));
      if (d < bd) { bd = d; best = u; }
    });
    return best;
  }
  cv.addEventListener('contextmenu', function (e) {
    // right-click: the command wheel for whatever's selected, at that spot
    e.preventDefault(); if (!started || over) return;
    if (remote.menu) { remote.menu = null; return; }
    var p = toCanvas(e); remote.x = p[0]; remote.y = p[1]; remoteOk();
  });
  cv.addEventListener('mousedown', function (e) {
    if (e.button === 2) return;
    if (remote.menu && !remote.menu.pause) {
      var m = remote.menu, i = wheelPick(m, toCanvas(e)[0], toCanvas(e)[1]); remote.menu = null;
      if (i >= 0) m.items[i].run();
      return;
    }
    var p = toCanvas(e); drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], vx: view.x, vy: view.y, moved: false, box: e.shiftKey }; });
  window.addEventListener('mousemove', function (e) {
    var p = toCanvas(e); hover = p;
    if (remote.menu && !remote.menu.pause) { var wi = wheelPick(remote.menu, p[0], p[1]); if (wi >= 0) remote.menu.i = wi; }
    if (!drag) return; drag.x1 = p[0]; drag.y1 = p[1];
    if (Math.abs(p[0] - drag.x0) + Math.abs(p[1] - drag.y0) > 8) drag.moved = true;
    if (drag.moved && !drag.box && !unitAt(drag.x0, drag.y0)) { view.x = drag.vx - (p[0] - drag.x0); view.y = drag.vy - (p[1] - drag.y0); clampView(); }
    else if (drag.moved && unitAt(drag.x0, drag.y0)) drag.box = true;
  });
  window.addEventListener('mouseup', function () {
    if (!drag || !started) { drag = null; return; }
    var d = drag; drag = null;
    if (d.box && d.moved) {
      var x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      var inBox = units.filter(function (u) { if (u.side !== 'allies' || !alive(u) || u.stray) return false; var p = proj(u.x, u.y, 1); return p[0] - view.x > x0 && p[0] - view.x < x1 && p[1] - view.y > y0 && p[1] - view.y < y1; });
      if (inBox.length) { selected = inBox; command = null; }
      return;
    }
    if (d.moved) return;
    if (command) {
      var gs = unproj(d.x0 + view.x, d.y0 + view.y), cmd = command; command = null;
      if (cmd === 'smoke') fireSmoke(gs[0], gs[1]);
      else if (cmd === 'demo') plantCharge(gs[0], gs[1]);
      else if (cmd === 'area') areaAt(gs[0], gs[1]);
      else if (cmd === 'arty') callArty(gs[0], gs[1], 'he');
      else if (cmd === 'artysmoke') callArty(gs[0], gs[1], 'smoke');
      return;
    }
    var u = unitAt(d.x0, d.y0);
    if (u) { selected = isTank(u) ? [u] : squadOf(u); return; }
    var foe = enemyAt(d.x0, d.y0);
    if (foe && selected.length) {
      selected.forEach(function (s) { if (alive(s)) s.target = foe; });
      say('Target marked. ' + (selected.some(isTank) ? 'HE on him as soon as they can see him.' : 'Concentrating fire on him.'));
      return;
    }
    if (selected.length) { var g = unproj(d.x0 + view.x, d.y0 + view.y); orderGroup(selected.filter(alive), g[0], g[1]); }
  });
  window.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = 1;
    if (!started) return;
    if (k === 'f') doCommand('smoke'); else if (k === 'h') doCommand('he'); else if (k === ' ') { doCommand('halt'); e.preventDefault(); }
    else if (k === 'g') doCommand('assault'); else if (k === 'r') doCommand('retreat'); else if (k === 'm') doCommand('mute');
    else if (k === 't') doCommand('area'); else if (k === 'b') doCommand('demo'); else if (k === 'c') doCommand('crash');
    else if (k === 'x') doCommand('hold'); else if (k === '=' || k === '+') doCommand('speed');
    else if (k === 'v') doCommand('arty'); else if (k === 'n') doCommand('artysmoke'); else if (k === 'u') doCommand('ride'); else if (k === 'p') doCommand('pause');
    else if (k === 'Escape') { command = null; if (remote.menu) { if (remote.menu.pause) paused = false; remote.menu = null; } }
    else if (k === 'l') doCommand('log'); else if (k === '?' || k === '/') doCommand('helpov');
  });
  window.addEventListener('keyup', function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = 0; });
  function clampView() { view.x = Math.max(0, Math.min(CAM.W - VW, view.x)); view.y = Math.max(0, Math.min(CAM.H - VH, view.y)); }

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    var sp = 900 * dt;
    if (keys.ArrowLeft || keys.a) view.x -= sp; if (keys.ArrowRight || keys.d) view.x += sp;
    if (keys.ArrowUp || keys.w) view.y -= sp; if (keys.ArrowDown || keys.s) view.y += sp;
    clampView();
    if (started && !over && !paused) for (var sp2 = 0; sp2 < gameSpeed; sp2++) update(dt);   // double speed: two steps a frame
    units.forEach(function (u) { if (isTank(u)) sound.engine(u); });
    draw(); panel();
    requestAnimationFrame(frame);
  }
  function end(t, s, won) { over = true; document.getElementById('endTitle').textContent = t; document.getElementById('endText').textContent = s; document.getElementById('end').style.display = 'flex'; debrief(!!won); }

  // ------------------------------------------------------------------ start
  function begin(t) {
    TIME = t === 'mist' || t === 'dusk' ? t : 'day'; started = true;
    DIFF = DIFFS[params.diff || prefs.difficulty] || DIFFS.normal; arty = { he: DIFF.arty[0], smoke: DIFF.arty[1] };
    units.forEach(function (u) { if (u.side === 'axis') { u.heart = Math.max(30, u.heart + DIFF.heart); u.morale = u.heart; } });
    document.getElementById('start').style.display = 'none';
    sound.start();
    say(MISSION.intro[TIME]);
    if (!prefs.seenHelp && !params.quiet) { prefs.seenHelp = true; savePrefs(); toggleBox('helpov'); }   // the first game: how to play
    tracker.start();
  }
  Promise.all([get(MAPP + 'level.json'), get('camera.json'), get('sprites.json'), get(MAPP + 'tiles/tiles.json'), maybe(MAPP + 'tiles_dusk/tiles.json'), image('sherman.png'), image('stug.png')]).then(function (r) {
    LEVEL = r[0]; CAM = r[1]; SPR = r[2]; TILES = r[3]; TILES_DUSK = r[4]; imgTank = r[5]; imgStug = r[6];
    return Promise.all(Object.keys(SPR.kits).map(function (k) { return image(SPR.kits[k]).then(function (im) { sheets[k] = im; }); }));
  }).then(function () {
    G = LEVEL.size; CELL = LEVEL.cell; HALF = LEVEL.world / 2;
    // the ground: 0 open, 1 hedgerow, 2 building (3 will be a wreck). tankgrid: where a 3 m-wide Sherman fits, measured at 1 m.
    kindGrid = new Uint8Array(G * G); block = new Uint8Array(G * G); hedgeCell = new Uint8Array(G * G); tankBlock = new Uint8Array(G * G); tankSoft = new Uint8Array(G * G);
    for (var i = 0; i < G * G; i++) { kindGrid[i] = LEVEL.grid.charCodeAt(i) - 48; block[i] = kindGrid[i] ? 1 : 0; hedgeCell[i] = kindGrid[i] === 1 ? 1 : 0; tankBlock[i] = LEVEL.tankgrid.charCodeAt(i) === 49 ? 1 : 0; }
    // a tank can crash through what's only blocked by hedge: anywhere not within 4 m of a building
    for (var rr = 0; rr < G; rr++) for (var cc = 0; cc < G; cc++) {
      if (!tankBlock[rr * G + cc]) continue;
      var bld = 0; for (var dr = -2; dr <= 2 && !bld; dr++) for (var dc = -2; dc <= 2 && !bld; dc++) { var r2 = rr + dr, c2 = cc + dc; if (r2 >= 0 && c2 >= 0 && r2 < G && c2 < G && kindGrid[r2 * G + c2] === 2) bld = 1; }
      tankSoft[rr * G + cc] = bld ? 0 : 1;
    }
    MISSION.setup();
    for (var q = 0; q < 80; q++) mistPatches.push({ x: (Math.random() - .5) * 760, y: (Math.random() - .5) * 760, r: 18 + Math.random() * 30 });
    document.getElementById('loading').style.display = 'none';
    window.__game = { clock: function () { return clock; }, units: units, update: update, draw: function () { draw(); }, order: order, orderGroup: orderGroup,
      proj: proj, view: view, selected: function () { return selected; }, select: function (l) { selected = l; }, fireSmoke: fireSmoke, doCommand: doCommand,
      begin: begin, tally: tally, end: end, mission: function () { return MISSION.id; }, roster: function () { return ROSTER; }, see: seeLine, spot: spotRange, hitTank: hitTank, knockOut: knockOut, objs: function () { return OBJS; }, phase: function () { return phase; }, callArty: callArty, mount: mount, riders: riders, remoteKey: function (k) { window.hearthKey(k); }, remote: remote, paused: function () { return paused; }, breach: breach, plantCharge: plantCharge, grid: function () { return { block: block, tank: tankBlock, kind: kindGrid }; }, hear: hear, log: function () { return log; }, strays: function () { return STRAYS; }, groups: function () { return groupsOfMine(); }, stug: stug, spawnStug: spawnStug, armour: armour, sight: sightRange, rally: function () { return RALLY; }, clouds: function () { return clouds; }, heard: function () { return heard; } };
    if (params.time) begin(params.time);
    else if (params.go) startGame();
    else { startScreen(); document.getElementById('start').style.display = 'flex'; }
    requestAnimationFrame(frame);
  });
  function showDiff() { [].forEach.call(document.querySelectorAll('#start button[data-diff]'), function (b) { b.className = b.getAttribute('data-diff') === (prefs.difficulty || 'normal') ? 'pick' : ''; }); }
  [].forEach.call(document.querySelectorAll('#start button[data-diff]'), function (b) {
    b.addEventListener('click', function () { prefs.difficulty = b.getAttribute('data-diff'); savePrefs(); DIFF = DIFFS[prefs.difficulty]; showDiff(); });
  });
  showDiff();
})();
