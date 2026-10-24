import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)

rep("hp: 100, path: null, gun: 2, mg: 0, smoke: 0, name: 'Sherman' }; }",
    "hp: 100, path: null, gun: 2, mg: 0, smoke: 0, name: 'Sherman', state: 'halted' }; }")
rep("pf: at ? 1 : 0, home: [x, y] }; }",
    "pf: at ? 1 : 0, home: [x, y], state: 'exposed', supp: 0, suppT: -9, pinned: false, sought: -99 }; }")

a = s.index("  function update(dt) {"); b = s.index("    // German commander:")
s = s[:a] + r'''  // ------------------------------------------------------------------ states: how exposed a unit is
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
    units.forEach(function (u) {
      if (!alive(u)) { if (u.kind === 'tank' && Math.random() < dt * 3) boom(u.x + Math.random() - .5, u.y + Math.random() - .5, 2, true); return; }
      if (u.kind === 'tank') {
        var moving = move(u, 5.0, 0.9, dt) && !!u.path;
        u.state = moving ? 'move' : 'halted';
        var aim = moving ? 0.6 : 1;                     // firing on the move is far less accurate
        u.gun -= dt; u.mg -= dt;
        var seen = axis.filter(function (s) { return dist(u, s) < 160 && seeLine(u.x, u.y, s.x, s.y); });
        seen.sort(function (a, b) { return dist(u, a) - dist(u, b); });
        if (seen.length && u.mg <= 0) {                 // bow and coax MGs: bursts at the nearest, pinning those around it
          var t = seen[0]; u.mg = 0.9; tracer(u, t, 'rgba(255,215,120,.9)');
          axis.forEach(function (s) { var d = dist(s, t); if (d < 6) suppress(s, d < 1 ? 30 : 15); });
          if (Math.random() < Math.max(0.08, 0.4 - dist(u, t) / 400) * aim * exposure(t, u, 'mg')) t.hp = 0;
        }
        if (seen.length && u.gun <= 0) {                // 76 mm high explosive into the thickest group
          var tg = seen[Math.floor(Math.random() * Math.min(3, seen.length))]; u.gun = 5.5;
          var sc = moving ? 6 : 2, ang = Math.random() * 6.28, bx = tg.x + Math.cos(ang) * sc * Math.random(), by = tg.y + Math.sin(ang) * sc * Math.random();
          tracer(u, { x: bx, y: by, kind: 'inf' }, 'rgba(255,240,200,1)'); boom(bx, by, 6, false);
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
        if (u.supp >= 70) u.pinned = true; else if (u.supp < 30) u.pinned = false;
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
              var chance = 0.7 * (tgt.state === 'move' ? 0.75 : 1) * (1 - u.supp / 250);
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
''' + s[b:]

# drawing: pinned soldiers drawn low, and a small state badge over each German
rep("        ctx.drawImage(imgInf, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2);\n        if (u.at && u.pf) { ctx.fillStyle = '#E0604A'; ctx.fillRect(p[0] - view.x - 2, p[1] - view.y - s2 / 2 - 4, 4, 4); }",
    "        if (u.pinned && !u.fallback) ctx.drawImage(imgInf, i * s2, d * s2, s2, s2 * 0.62, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2 + s2 * 0.38, s2, s2 * 0.62);\n"
    "        else ctx.drawImage(imgInf, i * s2, d * s2, s2, s2, p[0] - view.x - s2 / 2, p[1] - view.y - s2 / 2, s2, s2);\n"
    "        if (u.at && u.pf) { ctx.fillStyle = '#E0604A'; ctx.fillRect(p[0] - view.x - 2, p[1] - view.y - s2 / 2 - 4, 4, 4); }\n"
    "        badge(u, p[0] - view.x, p[1] - view.y - s2 / 2 - 12);")
rep("  function bar(u, p, s) {",
    r'''  function badge(u, x, y) {
    // cover: a green shield; pinned: amber chevrons; assault: red arrow; retreat: grey arrow; open ground: nothing
    ctx.lineWidth = 2;
    if (u.state === 'cover') { ctx.fillStyle = 'rgba(140,190,120,.95)'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); }
    else if (u.state === 'pinned') { ctx.strokeStyle = '#E2B25A'; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x, y - 1); ctx.lineTo(x + 5, y - 5); ctx.moveTo(x - 5, y); ctx.lineTo(x, y + 4); ctx.lineTo(x + 5, y); ctx.stroke(); }
    else if (u.state === 'assault') { ctx.fillStyle = '#E0604A'; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x - 5, y + 3); ctx.closePath(); ctx.fill(); }
    else if (u.state === 'retreat') { ctx.fillStyle = 'rgba(200,196,184,.9)'; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 5, y - 3); ctx.lineTo(x - 5, y - 3); ctx.closePath(); ctx.fill(); }
  }
  function bar(u, p, s) {''')
# tanks: show halted / moving under the health bar
rep("    ctx.fillStyle = u.hp > 50 ? '#9FC2E6' : '#E0A84A'; ctx.fillRect(x, y, w * u.hp / 100, 5);",
    "    ctx.fillStyle = u.hp > 50 ? '#9FC2E6' : '#E0A84A'; ctx.fillRect(x, y, w * u.hp / 100, 5);\n"
    "    ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(237,232,218,.85)'; ctx.fillText(u.state === 'move' ? 'Moving' : 'Halted', x + w / 2, y - 4);")
# HUD: count what the Germans are doing
rep("    var pf = units.filter(function (u) { return u.side === 'axis' && alive(u) && u.at && u.pf; }).length;",
    "    var pf = units.filter(function (u) { return u.side === 'axis' && alive(u) && u.at && u.pf; }).length;\n"
    "    var pin = units.filter(function (u) { return u.side === 'axis' && alive(u) && u.state === 'pinned'; }).length;\n"
    "    var cov = units.filter(function (u) { return u.side === 'axis' && alive(u) && u.state === 'cover'; }).length;")
rep("' (Panzerfausts: ' + pf + ')'", "' (Panzerfausts: ' + pf + ')<br><span style=\"color:#CFC9B8\">In cover ' + cov + ' · Pinned ' + pin + '</span>'")
open(p, "w").write(s)
