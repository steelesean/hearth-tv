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
