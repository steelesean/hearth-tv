
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
