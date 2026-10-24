"""Cuts the background into 1024 px tiles for the game (only the visible ones load)."""
import sys, os, json
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1], sys.argv[2]
W, H = 9216, 5632
im = Image.open(src).convert("RGB")
if im.size != (W, H):                     # a stand-in render at another scale: same view, so scale and centre-crop
    k = W / 0.078 * 0.078 / im.size[0]
    k = (756 / im.size[0]) / 0.078        # the overview covers 756 m across
    big = im.resize((round(im.size[0] * k), round(im.size[1] * k)), Image.LANCZOS)
    x0, y0 = (big.size[0] - W) // 2, (big.size[1] - H) // 2
    im = big.crop((x0, y0, x0 + W, y0 + H))
os.makedirs(out, exist_ok=True)
T = 1024; cols, rows = (W + T - 1) // T, (H + T - 1) // T
for r in range(rows):
    for c in range(cols):
        im.crop((c * T, r * T, min(W, c * T + T), min(H, r * T + T))).save(os.path.join(out, "%d_%d.jpg" % (c, r)), quality=86)
json.dump({"size": T, "cols": cols, "rows": rows}, open(os.path.join(out, "tiles.json"), "w"))
print(cols, rows)
