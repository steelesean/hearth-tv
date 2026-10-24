
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
