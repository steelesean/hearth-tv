
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
    if (isTank(t)) k = t.dugIn && !t.path && !firing ? 0.5 : 1.3;   // a dug-in assault gun is low and hard to pick out
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
