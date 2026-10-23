// Hedgerows near Carentan: a first test. Two Shermans against a German rifle platoon in the bocage.
// Everything happens in world metres (x east, y north); the screen is the same orthographic view
// Blender rendered the map and sprites with, so a unit drawn at project(x, y) sits where it should.
// Plain ES5 so it can later run in the Fire TV's older WebView.
(function () {
  'use strict';
  var cv = document.getElementById('c'), ctx = cv.getContext('2d');
  var VW = 1920, VH = 1080;
  var LEVEL, CAM, SPR, TILES, imgTank, imgInf, tiles = {}, heights = {};
  var oc = document.createElement('canvas'), octx = oc.getContext('2d');   // scratch canvas for hiding parts of units
  var units = [], fx = [], marks = [], selected = [], over = false, lastT = 0, clock = 0;
  var view = { x: 0, y: 0 };                         // top-left of the screen, in background pixels
  var block, tankBlock, G, CELL, HALF;

  function fit() {
    var k = Math.min(window.innerWidth / VW, window.innerHeight / VH);
    cv.style.width = (VW * k) + 'px'; cv.style.height = (VH * k) + 'px';
  }
  window.addEventListener('resize', fit); fit();

  function get(url) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest(); x.open('GET', url); x.onload = function () { x.status < 300 ? ok(JSON.parse(x.responseText)) : no(url); }; x.onerror = function () { no(url); }; x.send();
    });
  }
  function image(url) { return new Promise(function (ok) { var i = new Image(); i.onload = function () { ok(i); }; i.src = url; }); }

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
    for (var i = 4; i < n - 4; i++) {
      var t = i / n, c = cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (blocked(block, c[0], c[1])) return false;
    }
    return true;
  }
  function path(grid, from, to) {
    // A* over 2 m cells, eight directions, no corner cutting.
    var s = nearestOpen(grid, cellOf(from[0], from[1])), e = cellOf(to[0], to[1]);
    if (!s) return null;
    if (blocked(grid, e[0], e[1])) {              // a blocked target: aim for the nearest open cell
      var best = null, bd = 1e9;
      for (var rr = -6; rr <= 6; rr++) for (var cc = -6; cc <= 6; cc++) if (!blocked(grid, e[0] + cc, e[1] + rr) && cc * cc + rr * rr < bd) { bd = cc * cc + rr * rr; best = [e[0] + cc, e[1] + rr]; }
      if (!best) return null; e = best;
    }
    var key = function (c, r) { return r * G + c; };
    var open = [[0, s[0], s[1]]], g = {}, came = {}, closed = {};
    g[key(s[0], s[1])] = 0;
    var h = function (c, r) { var dx = Math.abs(c - e[0]), dy = Math.abs(r - e[1]); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    var steps = 0;
    while (open.length && steps++ < 40000) {
      var bi = 0; for (var i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      var cur = open.splice(bi, 1)[0], c = cur[1], r = cur[2], k = key(c, r);
      if (closed[k]) continue; closed[k] = 1;
      if (c === e[0] && r === e[1]) {
        var out = [], kk = k;
        while (kk !== undefined) { out.unshift(centre(kk % G, Math.floor(kk / G))); kk = came[kk]; }
        return smooth(grid, out);
      }
      for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        var nc = c + dc, nr = r + dr;
        if (blocked(grid, nc, nr) || (dc && dr && (blocked(grid, c + dc, r) || blocked(grid, c, r + dr)))) continue;
        var nk = key(nc, nr), ng = g[k] + (dc && dr ? 1.414 : 1);
        if (g[nk] === undefined || ng < g[nk]) { g[nk] = ng; came[nk] = k; open.push([ng + h(nc, nr), nc, nr]); }
      }
    }
    return null;
  }
  function nearestOpen(grid, c) {
    if (!blocked(grid, c[0], c[1])) return c;
    for (var rad = 1; rad < 8; rad++) for (var dr = -rad; dr <= rad; dr++) for (var dc = -rad; dc <= rad; dc++)
      if (!blocked(grid, c[0] + dc, c[1] + dr)) return [c[0] + dc, c[1] + dr];
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
  function tank(x, y) { return { kind: 'tank', side: 'allies', x: x, y: y, h: 0, hp: 100, path: null, gun: 2, mg: 0, smoke: 0, name: 'Sherman', state: 'halted' }; }
  function soldier(x, y, squad, at) { return { kind: 'inf', side: 'axis', x: x, y: y, h: Math.random() * 6.28, hp: 100, path: null, squad: squad, at: at, shot: 1 + Math.random() * 3, anim: 0, pose: 'idle', fired: 0, pf: at ? 1 : 0, home: [x, y], state: 'exposed', seenT: -99, supp: 0, suppT: -9, pinned: false, sought: -99 }; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function alive(u) { return u.hp > 0; }
  function enemies(u) { return units.filter(function (v) { return v.side !== u.side && alive(v); }); }

  function order(u, x, y) {
    var p = path(u.kind === 'tank' ? tankBlock : block, [u.x, u.y], [x, y]);
    u.path = p ? p.slice(1) : null;
  }

  function turnTo(u, ang, rate, dt) {
    var d = Math.atan2(Math.sin(ang - u.h), Math.cos(ang - u.h));
    var s = Math.max(-rate * dt, Math.min(rate * dt, d)); u.h += s;
    return Math.abs(d - s);
  }
  function move(u, speed, turn, dt) {
    if (!u.path || !u.path.length) { u.path = null; return false; }
    var w = u.path[0], dx = w[0] - u.x, dy = w[1] - u.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1.2) { u.path.shift(); return true; }
    var off = turnTo(u, Math.atan2(dy, dx), turn, dt);
    if (off < 0.6) { var k = Math.min(d, speed * dt * (1 - off / 0.6 * 0.5)); u.x += dx / d * k; u.y += dy / d * k; }
    return true;
  }

  function mark(m) { marks.push(m); if (marks.length > 500) marks.shift(); }   // craters and track marks stay on the ground
  function boom(x, y, size, smoke) { fx.push({ t: 0, life: smoke ? 3 : 0.7, x: x, y: y, size: size, kind: smoke ? 'smoke' : 'boom' }); }
  function tracer(a, b, col) { fx.push({ t: 0, life: 0.12, ax: a.x, ay: a.y, az: a.kind === 'tank' ? 2.2 : 1.4, bx: b.x, by: b.y, bz: b.kind === 'tank' ? 1.2 : 1.0, col: col, kind: 'line' }); }
  var radio = [], log = window.__radio = []; function say(t) { log.push(Math.round(clock) + 's ' + t); radio.unshift({ t: clock, text: t }); radio = radio.slice(0, 3); }

  // ------------------------------------------------------------------ states: how exposed a unit is
  // Infantry: exposed (standing in the open), moving, in cover (a hedgerow bank between them and the
  // shooter), pinned (suppressed, face down), assault (sprinting at the enemy) and retreat.
  // Each changes how likely incoming fire is to hit. Tanks: halted or moving, plus armour facing.
  var EXPOSE = { exposed: 1, move: 1.15, cover: 1, pinned: 1, assault: 1.4, retreat: 0.85 };
  function coverAgainst(u, from) {
    // a hedge or wall within 5 m of the soldier, on the line towards whoever is shooting
    var dx = from.x - u.x, dy = from.y - u.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    for (var i = 1; i <= 5; i++) { var c = cellOf(u.x + dx / d * i, u.y + dy / d * i); if (blocked(block, c[0], c[1])) return true; }
    return false;
  }
  function exposure(t, from, weapon) {
    var m = EXPOSE[t.state] || 1;
    if (t.pinned) m *= weapon === 'mg' ? 0.5 : 0.7;               // face down in the dirt
    if (coverAgainst(t, from)) m *= weapon === 'mg' ? 0.35 : 0.6; // bocage banks stop bullets better than blast
    return m;
  }
  function suppress(t, amt) { t.supp = Math.min(100, t.supp + amt * (t.state === 'assault' ? 0.5 : 1)); t.suppT = clock; }
  function findCover(u, threat) {
    // nearest open cell within 14 m that puts a hedge between this soldier and the threat
    var c0 = cellOf(u.x, u.y), best = null, bd = 1e9;
    for (var dr = -7; dr <= 7; dr++) for (var dc = -7; dc <= 7; dc++) {
      if (blocked(block, c0[0] + dc, c0[1] + dr) || dc * dc + dr * dr > 49) continue;
      var w = centre(c0[0] + dc, c0[1] + dr);
      if (coverAgainst({ x: w[0], y: w[1] }, threat) && dc * dc + dr * dr < bd) { bd = dc * dc + dr * dr; best = w; }
    }
    return best;
  }
  function armour(tk, from) {
    // where the Panzerfaust strikes: the Sherman's front is thick, its sides and rear much less so
    var a = Math.abs(Math.atan2(Math.sin(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h), Math.cos(Math.atan2(from.y - tk.y, from.x - tk.x) - tk.h)));
    return a < 0.8 ? ['front', 40] : a < 2.3 ? ['side', 65] : ['rear', 100];
  }

  function update(dt) {
    clock += dt;
    var allies = units.filter(function (u) { return u.side === 'allies' && alive(u); });
    var axis = units.filter(function (u) { return u.side === 'axis' && alive(u); });
    // spotting: a German is only on your screen while a Sherman can see him, or for a moment after he fires
    var sees = function (s) { return allies.some(function (a) { return dist(a, s) < 160 && seeLine(a.x, a.y, s.x, s.y); }); };
    axis.forEach(function (s) { if (s.fired > 0 || sees(s)) { s.seenT = clock; s.last = { x: s.x, y: s.y, h: s.h, pose: s.pose }; } });
    units.forEach(function (s) { if (s.side === 'axis' && !alive(s) && !s.bodySeen && (clock - s.seenT < 0.5 || sees(s))) s.bodySeen = true; });
    units.forEach(function (u) {
      if (!alive(u)) { if (u.kind === 'tank' && Math.random() < dt * 3) boom(u.x + Math.random() - .5, u.y + Math.random() - .5, 2, true); return; }
      if (u.kind === 'tank') {
        var moving = move(u, 5.0, 0.9, dt) && !!u.path;
        u.state = moving ? 'move' : 'halted';
        if (moving) {
          // two track marks every couple of metres, and dust off the lane
          if (!u.lastMark || Math.sqrt((u.x - u.lastMark[0]) * (u.x - u.lastMark[0]) + (u.y - u.lastMark[1]) * (u.y - u.lastMark[1])) > 2) {
            if (u.lastMark) mark({ kind: 'track', ax: u.lastMark[0], ay: u.lastMark[1], bx: u.x, by: u.y, h: u.h });
            u.lastMark = [u.x, u.y];
          }
          if (Math.random() < dt * 6) fx.push({ t: 0, life: 2.6, x: u.x - Math.cos(u.h) * 3.5 + Math.random() - .5, y: u.y - Math.sin(u.h) * 3.5 + Math.random() - .5, size: 2.5, kind: 'dust' });
        } else u.lastMark = null;
        var aim = moving ? 0.6 : 1;                     // firing on the move is far less accurate
        u.gun -= dt; u.mg -= dt;
        var seen = axis.filter(function (s) { return dist(u, s) < 160 && seeLine(u.x, u.y, s.x, s.y); });
        seen.sort(function (a, b) { return dist(u, a) - dist(u, b); });
        if (seen.length && u.mg <= 0) {                 // bow and coax MGs: bursts at the nearest, pinning those around it
          var t = seen[0]; u.mg = 0.9; tracer(u, t, 'rgba(255,215,120,.9)');
          axis.forEach(function (s) { var d = dist(s, t); if (d < 5) suppress(s, d < 1 ? 22 : 8); });
          if (Math.random() < Math.max(0.08, 0.4 - dist(u, t) / 400) * aim * exposure(t, u, 'mg')) t.hp = 0;
        }
        if (seen.length && u.gun <= 0) {                // 76 mm high explosive into the thickest group
          var tg = seen[Math.floor(Math.random() * Math.min(3, seen.length))]; u.gun = 5.5;
          var sc = moving ? 6 : 2, ang = Math.random() * 6.28, bx = tg.x + Math.cos(ang) * sc * Math.random(), by = tg.y + Math.sin(ang) * sc * Math.random();
          tracer(u, { x: bx, y: by, kind: 'inf' }, 'rgba(255,240,200,1)'); boom(bx, by, 6, false); mark({ kind: 'crater', x: bx, y: by, r: 1.6 + Math.random() * .6 });
          fx.push({ t: 0, life: 1.8, x: u.x + Math.cos(u.h) * 5.5, y: u.y + Math.sin(u.h) * 5.5, size: 2.2, kind: 'smoke' });
          axis.forEach(function (s) {
            var d = Math.sqrt((s.x - bx) * (s.x - bx) + (s.y - by) * (s.y - by));
            if (d < 14) suppress(s, 70 - d * 3);
            if (d < 7 && Math.random() < (0.6 - d / 12) * exposure(s, u, 'he')) s.hp = 0;
          });
        }
        if (u.hp < 50 && Math.random() < dt * 1.5) boom(u.x, u.y, 1.5, true);
      } else {
        // German infantry
        u.shot -= dt; u.anim += dt;
        if (clock - u.suppT > 2) u.supp = Math.max(0, u.supp - 12 * dt);
        if (u.supp >= 75) u.pinned = true; else if (u.supp < 35) u.pinned = false;
        var near = allies.filter(function (a) { return seeLine(u.x, u.y, a.x, a.y) && dist(u, a) < 170; });
        near.sort(function (a, b) { return dist(u, a) - dist(u, b); });
        var tgt = near[0], assault = false;
        if (u.fallback && u.path) {
          // retreating: running for the farm, not stopping for anything
          u.pose = 'walk'; move(u, 3.2, 6, dt);
        } else if (u.pinned) {
          // pinned: heads down, no moving, no firing
          u.pose = 'aim';
        } else if (u.at && u.pf && tgt) {
          // the Panzerfaust man stalks the tank using the hedgerows, sprints the last stretch, then fires at 38 m
          if (dist(u, tgt) > 38) {
            assault = dist(u, tgt) < 80;
            if (!u.path || u.repath <= 0) { order(u, tgt.x, tgt.y); u.repath = 3; }
            u.repath -= dt; u.pose = 'walk'; move(u, assault ? 3.4 : 2.6, 6, dt);
          } else {
            u.path = null; u.pose = 'aim'; turnTo(u, Math.atan2(tgt.y - u.y, tgt.x - u.x), 4, dt);
            if (u.shot <= 0) {
              u.pf = 0; u.fired = 0.25; u.pose = 'fire'; tracer(u, tgt, 'rgba(255,160,80,1)'); boom(tgt.x, tgt.y, 3, false);
              fx.push({ t: 0, life: 2.2, x: u.x - Math.cos(u.h) * 2, y: u.y - Math.sin(u.h) * 2, size: 2, kind: 'dust' });   // the back-blast kicks up dirt
              var chance = 0.85 * (tgt.state === 'move' ? 0.8 : 1) * (1 - u.supp / 300);
              if (Math.random() < chance) {
                var arm = armour(tgt, u); tgt.hp -= arm[1];
                say(tgt.hp > 0 ? 'Panzerfaust hit the Sherman’s ' + arm[0] + ' armour!' : 'Sherman knocked out by a Panzerfaust to the ' + arm[0] + '.');
              } else say('Panzerfaust missed!');
            }
          }
        } else if (u.path) {
          u.pose = 'walk'; if (!move(u, 2.2, 6, dt)) u.pose = 'idle';
        } else if (tgt) {
          // riflemen under threat get behind a hedge first, then return fire
          if (!coverAgainst(u, tgt) && clock - u.sought > 12) {
            u.sought = clock; var cw = findCover(u, tgt);
            if (cw) { u.path = path(block, [u.x, u.y], cw); if (u.path) u.path = u.path.slice(1); }
          }
          u.pose = 'aim'; turnTo(u, Math.atan2(tgt.y - u.y, tgt.x - u.x), 4, dt);
          if (u.shot <= 0 && !u.at) { u.shot = 2.5 + Math.random() * 2; u.fired = 0.2; tracer(u, tgt, 'rgba(255,220,150,.6)'); fx.push({ t: 0, life: .15, x: tgt.x, y: tgt.y, kind: 'spark' }); }
        } else u.pose = 'idle';
        if (u.fired > 0) { u.fired -= dt; if (u.fired > 0.1) u.pose = 'fire'; }
        if (u.shot <= 0 && u.at) u.shot = 1.2;
        var threat = tgt || allies[0];
        u.state = u.fallback && u.path ? 'retreat' : u.pinned ? 'pinned' : assault ? 'assault' : u.path ? 'move'
          : threat && coverAgainst(u, threat) ? 'cover' : 'exposed';
      }
    });
    // German commander: once a tank is spotted, each squad's Panzerfaust man goes hunting; squads
    // under fire with no anti-tank weapon left fall back towards the farm.
    var squads = {};
    axis.forEach(function (s) { (squads[s.squad] = squads[s.squad] || []).push(s); });
    Object.keys(squads).forEach(function (k) {
      var sq = squads[k], hasPF = sq.some(function (s) { return s.at && s.pf; });
      var threatened = allies.some(function (a) { return sq.some(function (s) { return dist(a, s) < 35; }); });
      if (threatened && !hasPF && !sq[0].fallback) {
        sq.forEach(function (s) { s.fallback = true; order(s, LEVEL.objective[0] + (Math.random() - .5) * 20, LEVEL.objective[1] + (Math.random() - .5) * 20); });
        say('German squad falling back to the farm.');
      }
    });
    fx = fx.filter(function (f) { f.t += dt; return f.t < f.life; });
    if (!over) {
      if (!axis.length) end('Hamlet cleared', 'The farm is yours. Both commanders would like a word about those hedgerows.');
      else if (!allies.length) end('Shermans lost', 'The Panzerfausts got you in the bocage. Try the other lane, and keep your distance.');
    }
  }
  function end(t, s) { over = true; document.getElementById('endTitle').textContent = t; document.getElementById('endText').textContent = s; document.getElementById('end').style.display = 'flex'; }

  // ------------------------------------------------------------------ drawing
  function draw() {
    ctx.fillStyle = '#1b1c16'; ctx.fillRect(0, 0, VW, VH);
    var T = TILES.size;
    for (var r = Math.floor(view.y / T); r <= Math.floor((view.y + VH) / T); r++)
      for (var c = Math.floor(view.x / T); c <= Math.floor((view.x + VW) / T); c++) {
        if (c < 0 || r < 0 || c >= TILES.cols || r >= TILES.rows) continue;
        var k = c + '_' + r;
        if (!tiles[k]) { tiles[k] = new Image(); tiles[k].src = 'tiles/' + k + '.jpg'; }
        if (tiles[k].complete) ctx.drawImage(tiles[k], c * T - view.x, r * T - view.y);
        if (!heights[k]) loadHeights(k);
      }
    marks.forEach(function (m) {
      if (m.kind === 'crater') {
        var c = proj(m.x, m.y, 0), cx = c[0] - view.x, cy = c[1] - view.y, rx = m.r / CAM.mPerPx;
        if (cx < -40 || cy < -40 || cx > VW + 40 || cy > VH + 40 || heightAt(Math.floor(c[0]), Math.floor(c[1])) > 0.4) return;
        var gr = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx * 1.6);
        gr.addColorStop(0, 'rgba(28,24,18,.75)'); gr.addColorStop(0.45, 'rgba(45,38,28,.5)'); gr.addColorStop(1, 'rgba(60,50,36,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 1.6, rx * 1.6 * CAM.up[2], 0, 0, 6.3); ctx.fill();
      } else {
        var nx = -Math.sin(m.h) * 1.1, ny = Math.cos(m.h) * 1.1;
        ctx.strokeStyle = 'rgba(40,34,24,.22)'; ctx.lineWidth = 4; ctx.beginPath();
        [-1, 1].forEach(function (sd) {
          var a = proj(m.ax + nx * sd, m.ay + ny * sd, 0), b = proj(m.bx + nx * sd, m.by + ny * sd, 0);
          ctx.moveTo(a[0] - view.x, a[1] - view.y); ctx.lineTo(b[0] - view.x, b[1] - view.y);
        });
        ctx.stroke();
      }
    });
    // selection rings and routes under the units
    selected.forEach(function (u) {
      if (!alive(u)) return;
      var p = proj(u.x, u.y, 0); ctx.strokeStyle = 'rgba(159,194,230,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p[0] - view.x, p[1] - view.y, 34, 21, 0, 0, 6.3); ctx.stroke();
      if (u.path && u.path.length) {
        ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(p[0] - view.x, p[1] - view.y);
        u.path.forEach(function (w) { var q = proj(w[0], w[1], 0); ctx.lineTo(q[0] - view.x, q[1] - view.y); });
        ctx.stroke(); ctx.setLineDash([]);
      }
    });
    var list = units.slice().sort(function (a, b) { return proj(a.x, a.y, 0)[1] - proj(b.x, b.y, 0)[1]; });
    list.forEach(function (u) {
      var p;
      if (u.kind === 'tank') {
        var k = ((Math.round(u.h / (Math.PI / 8)) % 16) + 16) % 16, s = SPR.tank;
        p = proj(u.x, u.y, SPR.tankLookZ);
        if (!alive(u)) ctx.filter = 'brightness(0.35) saturate(0.3)';
        blit(imgTank, k * s, 0, s, s, p[0] - view.x - s / 2, p[1] - view.y - s / 2, s, s, proj(u.x, u.y, 0)[1], [159, 194, 230]);
        ctx.filter = 'none';
        if (alive(u)) bar(u, p, s);
      } else {
        p = proj(u.x, u.y, SPR.infantryLookZ);
        var s2 = SPR.infantry, d = ((Math.round(u.h / (Math.PI / 4)) % 8) + 8) % 8;
        var vis = 1 - (clock - u.seenT) / 1.5;
        if (vis <= 0 && alive(u)) { lastSeen(u, s2); return; }
        if (!alive(u)) { if (!u.bodySeen) return; var g = proj(u.x, u.y, 0); if (heightAt(Math.floor(g[0]), Math.floor(g[1])) > 0.4) return; ctx.fillStyle = 'rgba(30,28,22,.75)'; ctx.beginPath(); ctx.ellipse(g[0] - view.x, g[1] - view.y, 6, 3, 0, 0, 6.3); ctx.fill(); return; }
        ctx.globalAlpha = Math.min(1, vis);
        var gp = proj(u.x, u.y, 0);
        if (heightAt(Math.floor(gp[0]), Math.floor(gp[1])) < 0.4) { ctx.fillStyle = 'rgba(214,80,60,.35)'; ctx.beginPath(); ctx.ellipse(gp[0] - view.x, gp[1] - view.y, 9, 5, 0, 0, 6.3); ctx.fill(); }
        var pose = u.pose === 'walk' ? 'walk' + (Math.floor(u.anim * 9) % 6) : u.pose;
        var i = SPR.poses.indexOf(pose); if (i < 0) i = 0;
        if (u.pinned && !u.fallback) blit(imgInf, i * s2, d * s2, s2, Math.round(s2 * 0.62), p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2 + s2 * 0.38, s2, Math.round(s2 * 0.62), gp[1], [214, 80, 60]);
        else blit(imgInf, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2, gp[1], [214, 80, 60]);
        if (u.at && u.pf) { ctx.fillStyle = '#E0604A'; ctx.fillRect(p[0] - view.x - 2, p[1] - view.y - s2 / 2 - 4, 4, 4); }
        badge(u, p[0] - view.x, p[1] - view.y - s2 / 2 - 12);
        ctx.globalAlpha = 1;
      }
    });
    fx.forEach(function (f) {
      var k = f.t / f.life;
      if (f.kind === 'line') {
        var a = proj(f.ax, f.ay, f.az), b = proj(f.bx, f.by, f.bz);
        ctx.strokeStyle = f.col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(a[0] - view.x, a[1] - view.y); ctx.lineTo(b[0] - view.x, b[1] - view.y); ctx.stroke();
      } else if (f.kind === 'spark') {
        var q = proj(f.x, f.y, 1.5); ctx.fillStyle = 'rgba(255,230,160,' + (1 - k) + ')'; ctx.fillRect(q[0] - view.x - 2, q[1] - view.y - 2, 4, 4);
      } else {
        var z = f.kind === 'smoke' ? 1 + k * 8 : f.kind === 'dust' ? 0.6 + k * 1.5 : 0.5, q2 = proj(f.x, f.y, z), rad = f.size * (f.kind === 'smoke' || f.kind === 'dust' ? (0.6 + k * 1.4) : (0.4 + k * 0.8)) / CAM.mPerPx;
        var gr = ctx.createRadialGradient(q2[0] - view.x, q2[1] - view.y, 1, q2[0] - view.x, q2[1] - view.y, rad);
        if (f.kind === 'smoke') { gr.addColorStop(0, 'rgba(70,68,62,' + 0.45 * (1 - k) + ')'); gr.addColorStop(1, 'rgba(70,68,62,0)'); }
        else if (f.kind === 'dust') { gr.addColorStop(0, 'rgba(150,132,104,' + 0.32 * (1 - k) + ')'); gr.addColorStop(1, 'rgba(150,132,104,0)'); }
        else { gr.addColorStop(0, 'rgba(255,230,170,' + (1 - k) + ')'); gr.addColorStop(0.4, 'rgba(240,140,50,' + 0.8 * (1 - k) + ')'); gr.addColorStop(1, 'rgba(80,60,40,0)'); }
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(q2[0] - view.x, q2[1] - view.y, rad, 0, 6.3); ctx.fill();
      }
    });
    if (drag && drag.box) { ctx.strokeStyle = 'rgba(159,194,230,.9)'; ctx.lineWidth = 1.5; ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); }
    hud();
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
    };
    im.src = 'tiles/h_' + k + '.png';
  }
  function heightAt(X, Y) {
    var T = TILES.size, t = heights[Math.floor(X / T) + '_' + Math.floor(Y / T)];
    if (!t || !t.data) return 0;
    return t.data[((Y % T) * t.w + (X % T)) * 4] * 15.3 / 255;
  }
  function blit(img, sx, sy, sw, sh, dx, dy, dw, dh, footY, tint) {
    // footY: the unit's ground point, in background pixels. A pixel r rows above it is (footY - r) * m / up.z metres up.
    dx = Math.round(dx); dy = Math.round(dy);
    oc.width = dw; oc.height = dh; octx.clearRect(0, 0, dw, dh); octx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    var id = octx.getImageData(0, 0, dw, dh), px = id.data, k = CAM.mPerPx / CAM.up[2], hid = false;
    for (var j = 0; j < dh; j++) {
      var Y = view.y + dy + j, zu = Math.max(0, (footY - Y) * k);
      for (var i = 0; i < dw; i++) {
        var o = (j * dw + i) * 4;
        if (!px[o + 3]) continue;
        if (heightAt(Math.floor(view.x + dx + i), Math.floor(Y)) > zu + 0.4) {
          // the soft shadow baked into the sprite just disappears; the unit itself becomes an outline
          if (px[o + 3] < 120 || px[o] + px[o + 1] + px[o + 2] < 6) px[o + 3] = 0; else { px[o] = tint[0]; px[o + 1] = tint[1]; px[o + 2] = tint[2]; px[o + 3] = 100; }
          hid = true;
        }
      }
    }
    if (hid) octx.putImageData(id, 0, 0);
    ctx.drawImage(oc, dx, dy);
  }

  function lastSeen(u, s2) {
    // where you last saw him: a faded figure and a dashed ring, fading over 25 seconds. He may well have moved.
    var age = clock - u.seenT; if (!u.last || age > 25) return;
    var a = 1 - age / 25, g = proj(u.last.x, u.last.y, 0), p = proj(u.last.x, u.last.y, SPR.infantryLookZ);
    var d = ((Math.round(u.last.h / (Math.PI / 4)) % 8) + 8) % 8, i = Math.max(0, SPR.poses.indexOf(u.last.pose === 'walk' ? 'idle' : u.last.pose));
    ctx.globalAlpha = 0.28 * a;
    ctx.drawImage(imgInf, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2);
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
    else if (u.state === 'retreat') { ctx.fillStyle = 'rgba(200,196,184,.9)'; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 5, y - 3); ctx.lineTo(x - 5, y - 3); ctx.closePath(); ctx.fill(); }
  }
  function bar(u, p, s) {
    var w = 40, x = p[0] - view.x - w / 2, y = p[1] - view.y - s / 2 + 10;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y, w, 5);
    ctx.fillStyle = u.hp > 50 ? '#9FC2E6' : '#E0A84A'; ctx.fillRect(x, y, w * u.hp / 100, 5);
    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(237,232,218,.85)'; ctx.fillText(u.state === 'move' ? 'Moving' : 'Halted', x + w / 2, y - 4);
  }
  function hud() {
    var axis = units.filter(function (u) { return u.side === 'axis' && alive(u) && clock - u.seenT < 1.5; }).length;
    var tanks = units.filter(function (u) { return u.side === 'allies' && alive(u); }).length;
    var pin = units.filter(function (u) { return u.side === 'axis' && alive(u) && clock - u.seenT < 1.5 && u.state === 'pinned'; }).length;
    var cov = units.filter(function (u) { return u.side === 'axis' && alive(u) && clock - u.seenT < 1.5 && u.state === 'cover'; }).length;
    document.getElementById('hud').innerHTML = '<b>Hedgerows near Carentan</b>Clear the Germans from the hamlet.<br>Shermans: ' + tanks + ' · Germans in sight: ' + axis + '<br><span style="color:#CFC9B8">In cover ' + cov + ' · Pinned ' + pin + '</span>'
      + radio.filter(function (r) { return clock - r.t < 8; }).map(function (r) { return '<br><span style="color:#E2B25A">Radio:</span> ' + r.text; }).join('');
  }

  // ------------------------------------------------------------------ input: select, order, scroll
  var drag = null, keys = {};
  function toCanvas(e) { var b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * VW / b.width, (e.clientY - b.top) * VH / b.height]; }
  function unitAt(px, py) {
    var best = null, bd = 40;
    units.forEach(function (u) { if (u.side !== 'allies' || !alive(u)) return; var p = proj(u.x, u.y, 1); var d = Math.hypot(p[0] - view.x - px, p[1] - view.y - py); if (d < bd) { bd = d; best = u; } });
    return best;
  }
  cv.addEventListener('mousedown', function (e) { var p = toCanvas(e); drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], vx: view.x, vy: view.y, moved: false, box: e.shiftKey }; });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return; var p = toCanvas(e); drag.x1 = p[0]; drag.y1 = p[1];
    if (Math.abs(p[0] - drag.x0) + Math.abs(p[1] - drag.y0) > 8) drag.moved = true;
    if (drag.moved && !drag.box && !unitAt(drag.x0, drag.y0)) { view.x = drag.vx - (p[0] - drag.x0); view.y = drag.vy - (p[1] - drag.y0); clampView(); }
    else if (drag.moved && unitAt(drag.x0, drag.y0)) drag.box = true;
  });
  window.addEventListener('mouseup', function (e) {
    if (!drag) return; var d = drag; drag = null;
    if (d.box && d.moved) {
      var x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      selected = units.filter(function (u) { if (u.side !== 'allies' || !alive(u)) return false; var p = proj(u.x, u.y, 1); return p[0] - view.x > x0 && p[0] - view.x < x1 && p[1] - view.y > y0 && p[1] - view.y < y1; });
      return;
    }
    if (d.moved) return;
    var u = unitAt(d.x0, d.y0);
    if (u) { selected = [u]; return; }
    if (selected.length) {
      var g = unproj(d.x0 + view.x, d.y0 + view.y);
      selected.forEach(function (s, i) { if (alive(s)) order(s, g[0] + (i ? 7 : 0), g[1] + (i ? 7 : 0)); });
    }
  });
  window.addEventListener('keydown', function (e) { keys[e.key] = 1; }); window.addEventListener('keyup', function (e) { keys[e.key] = 0; });
  function clampView() { view.x = Math.max(0, Math.min(CAM.W - VW, view.x)); view.y = Math.max(0, Math.min(CAM.H - VH, view.y)); }

  function frame(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    var sp = 900 * dt;
    if (keys.ArrowLeft || keys.a) view.x -= sp; if (keys.ArrowRight || keys.d) view.x += sp;
    if (keys.ArrowUp || keys.w) view.y -= sp; if (keys.ArrowDown || keys.s) view.y += sp;
    clampView();
    if (!over) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ start
  Promise.all([get('level.json'), get('camera.json'), get('sprites.json'), get('tiles/tiles.json'), image('sherman.png'), image('rifleman.png')]).then(function (r) {
    LEVEL = r[0]; CAM = r[1]; SPR = r[2]; TILES = r[3]; imgTank = r[4]; imgInf = r[5];
    G = LEVEL.size; CELL = LEVEL.cell; HALF = LEVEL.world / 2;
    block = new Uint8Array(G * G); for (var i = 0; i < G * G; i++) block[i] = LEVEL.grid.charCodeAt(i) === 49 ? 1 : 0;
    // tanks are 3 m wide: they need a cell of clearance either side
    tankBlock = new Uint8Array(G * G);
    for (var rr = 0; rr < G; rr++) for (var cc = 0; cc < G; cc++) {
      var b = 0; for (var dr = -1; dr <= 1 && !b; dr++) for (var dc = -1; dc <= 1 && !b; dc++) if (blocked(block, cc + dc, rr + dr)) b = 1;
      tankBlock[rr * G + cc] = b;
    }
    LEVEL.shermans.forEach(function (p) { var c = nearestOpen(tankBlock, cellOf(p[0], p[1])), w = centre(c[0], c[1]); units.push(tank(w[0], w[1])); });
    // point the Shermans towards the hamlet
    units.forEach(function (u) { u.h = Math.atan2(LEVEL.objective[1] - u.y, LEVEL.objective[0] - u.x); });
    LEVEL.squads.forEach(function (p, si) {
      for (var k = 0; k < 5; k++) {
        var a = k * 1.26, x = p[0] + Math.cos(a) * 4, y = p[1] + Math.sin(a) * 4, c = cellOf(x, y);
        if (blocked(block, c[0], c[1])) { x = p[0]; y = p[1]; }
        units.push(soldier(x, y, si, k < 2));
      }
    });
    selected = units.filter(function (u) { return u.side === 'allies'; });
    var c0 = proj(LEVEL.shermans[0][0], LEVEL.shermans[0][1], 0), c1 = proj(LEVEL.objective[0], LEVEL.objective[1], 0);
    view.x = (c0[0] + c1[0]) / 2 - VW / 2; view.y = (c0[1] + c1[1]) / 2 - VH / 2; clampView();
    document.getElementById('loading').style.display = 'none';
    say('Two Shermans in the lane. Germans reported around the farm.');
    window.__game = { clock: function () { return clock; }, units: units, update: update, draw: function () { draw(); }, order: order, proj: proj, view: view, selected: function () { return selected; } };
    requestAnimationFrame(frame);
  });
})();
