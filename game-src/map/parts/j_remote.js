
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
