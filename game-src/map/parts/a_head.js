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

