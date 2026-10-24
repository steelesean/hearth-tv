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
