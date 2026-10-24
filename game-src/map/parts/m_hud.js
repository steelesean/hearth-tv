
  // ------------------------------------------------------------------ the interface: small markers round the edges
  // Top left: a flag for each objective, with its capture bar. Top centre: the hour and what the mission needs now,
  // with the latest radio message under it for a few seconds. Top right: shells and smoke left, Germans in sight, and
  // small buttons (pause, speed, sound, radio log, help). Bottom left: a card for each of your tanks and squads; click
  // one to select it, click again to find it. Orders are on the command wheel: right-click, or OK on the remote.
  var ui = {}; ['objs', 'clock', 'ticker', 'res', 'cards', 'log', 'helpov', 'intel'].forEach(function (k) { ui[k] = document.getElementById(k); });
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
    // the counters are buttons too: artillery and smoke start a fire mission (then click the map), the eye finds a German
    setHTML('res', '<button class="chip btn' + (command === 'arty' ? ' hot' : '') + '" data-cmd="arty" title="Artillery: click, then click the map (V)">' + ICON.shell + arty.he + '</button>'
      + '<button class="chip btn' + (command === 'artysmoke' ? ' hot' : '') + '" data-cmd="artysmoke" title="Smoke shells: click, then click the map (N)">' + ICON.cloud + arty.smoke + '</button>'
      + '<button class="chip btn" data-cmd="findfoe" title="Germans in sight: click to look at the next one">' + ICON.eye + seen + '</button>'
      + '<button class="chip btn" data-cmd="pause" title="Pause (P)">' + (paused ? '▶' : '❚❚') + '</button>'
      + '<button class="chip btn" data-cmd="speed" title="Speed (+)">' + gameSpeed + '×</button>'
      + '<button class="chip btn" data-cmd="mute" title="Sound (M)">' + (sound.on() ? 'Sound' : 'Muted') + '</button>'
      + '<button class="chip btn' + (INTEL.length > intelSeen ? ' hot' : '') + '" data-cmd="intel" title="Intelligence file (I)">Intel</button>'
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
  // right-click (two-finger tap or Control-click on a Mac) on the interface: no browser menu. On a card it selects
  // that unit and opens its orders; on an order or a marker it does what a click does.
  document.getElementById('ui').addEventListener('contextmenu', function (e) {
    e.preventDefault(); if (!started || over) return;
    if (remote.menu) remote.menu = null;
    var b = e.target.closest && e.target.closest('[data-card]'), c = e.target.closest && e.target.closest('button[data-cmd]');
    if (b && !c) { var g = groupsOfMine().filter(function (x) { return x.key === b.getAttribute('data-card'); })[0]; if (g) selected = g.units; return; }
    if (e.target.click) e.target.click();
  });
  // every marker catches its own clicks, so none of them reaches the map as a move order
  ui.objs.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-obj]'); if (!c) return;
    var o = OBJS.filter(function (x) { return x.name === c.getAttribute('data-obj'); })[0]; if (o) centreOn([o]);
  });
  ui.ticker.addEventListener('click', function () { doCommand('log'); });
  ui.res.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-cmd]'); if (!b) return;
    var c = b.getAttribute('data-cmd');
    if (c === 'intel') { showIntel(); return; }
    if (c === 'findfoe') {
      var foes = team('axis').filter(function (s) { return clock - s.seenT < 1.5; }); if (!foes.length) { say('No Germans in sight just now.'); return; }
      findfoe.i = ((findfoe.i || 0) + 1) % foes.length; centreOn([foes[findfoe.i]]); return;
    }
    doCommand(c);
    if (command === c) say(c === 'arty' ? 'Artillery: click on the map where you want the shells. Esc to cancel.' : 'Smoke shells: click on the map where you want the smoke. Esc to cancel.');
  });
  function findfoe() {}
  function showIntel() { toggleBox('intel'); intelSeen = INTEL.length; ui.intel.innerHTML = '<b>Intelligence</b>' + intelHTML() + '<span class="dim">Click to close</span>'; }
  function toggleBox(k) { ui[k].style.display = ui[k].style.display === 'block' ? 'none' : 'block'; uiLast[k] = null; }
  ui.helpov.addEventListener('click', function () { toggleBox('helpov'); });
  ui.intel.addEventListener('click', function () { toggleBox('intel'); });

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
