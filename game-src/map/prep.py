"""Reads the map section and writes what Blender needs: ground masks, hedge points, building footprints.
One upscaled pixel is one metre, so the section is 720 m across."""
from PIL import Image
import numpy as np, json, math, random

random.seed(3)
a = np.asarray(Image.open("section.png").convert("RGB")).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
lum = (r + g + b) / 3
N = a.shape[0]

building = (lum < 40) & ((g - b) < 8)
hedge = (lum >= 45) & (lum < 105) & (g >= b + 6)
red = (r > g + 40) & (r > 90) & (g < 80)
field = (r > g + 18) & (r - b > 30) & (lum > 80) & (lum < 150) & ~red
road = (np.abs(r - g) < 10) & (np.abs(g - b) < 14) & (lum > 120) & (lum < 205) & ~field


def dilate(m, n):
    out = m.copy()
    for _ in range(n):
        o = out.copy()
        o[1:] |= out[:-1]; o[:-1] |= out[1:]; o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]
        out = o
    return out


def erode(m, n):
    return ~dilate(~m, n)


lanes = dilate(road | red, 3) & ~building
fields = dilate(erode(field, 1), 1)
from PIL import ImageFilter
def smooth(m, radius, cut):
    """Blur then cut, so blotchy pixel masks become continuous shapes with soft edges."""
    im = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
    v = np.asarray(im) / 255.0
    return np.clip((v - cut) / 0.25, 0, 1)
lanes_s = smooth(dilate(road | red, 2), 3.0, 0.22)
Image.fromarray((smooth(fields, 1.5, 0.35) * 255).astype(np.uint8)).save("mask_field.png")
Image.fromarray((lanes_s * 255).astype(np.uint8)).save("mask_lane.png")
Image.fromarray((smooth(dilate(red, 4), 2.5, 0.3) * 255).astype(np.uint8)).save("mask_main.png")
lanes = lanes_s > 0.5

# Hedge bushes: every few metres along the hedge bands, jittered.
pts = []
core = erode(hedge, 2)                     # the middle of each drawn band: real hedgerows are 2 to 3 m wide
ys, xs = np.nonzero(core)
taken = set()
for y, x in zip(ys, xs):
    k = (x // 2, y // 2)
    if k in taken:
        continue
    taken.add(k)
    pts.append([float(x - N / 2 + random.uniform(-1, 1)), float(N / 2 - y + random.uniform(-1, 1))])

# Buildings: connected blobs, each turned into an oriented rectangle from its spread (PCA).
seen = np.zeros_like(building)
houses = []
for y0 in range(N):
    for x0 in range(N):
        if not building[y0, x0] or seen[y0, x0]:
            continue
        stack, blob = [(y0, x0)], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop(); blob.append((x, y))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < N and 0 <= xx < N and building[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; stack.append((yy, xx))
        if len(blob) < 12:
            continue
        p = np.array(blob, float); c = p.mean(0); q = p - c
        w, v = np.linalg.eigh(np.cov(q.T)); ax = v[:, 1]
        ang = math.atan2(ax[1], ax[0])
        u = q @ v[:, 1]; t = q @ v[:, 0]
        L, W = float(u.max() - u.min() + 1), float(t.max() - t.min() + 1)
        houses.append({"x": float(c[0] - N / 2), "y": float(N / 2 - c[1]), "len": max(L, 6), "wid": max(min(W, 14), 5), "ang": -ang})

json.dump({"size": N, "hedge": pts, "houses": houses}, open("layout.json", "w"))
print("hedge points", len(pts), "houses", len(houses))

# Two tank positions on the lane nearest the hamlet, each lined up with the lane's direction.
spots = []
lys, lxs = np.nonzero(lanes & ~dilate(red, 3))
for tx, ty in ((250, 300), (205, 330)):
    d = (lxs - tx) ** 2 + (lys - ty) ** 2
    i = int(np.argmin(d)); cx, cy = lxs[i], lys[i]
    near = (np.abs(lxs - cx) < 14) & (np.abs(lys - cy) < 14)
    q = np.stack([lxs[near] - cx, lys[near] - cy], 1).astype(float)
    w, v = np.linalg.eigh(np.cov(q.T)); ax = v[:, 1]
    spots.append({"x": float(cx - N / 2), "y": float(N / 2 - cy), "ang": float(math.atan2(-ax[1], ax[0]))})
data = json.load(open("layout.json")); data["tanks"] = spots
data["houses"] = [h for h in data["houses"] if h["len"] <= 60]
json.dump(data, open("layout.json", "w"))
print("tanks", spots)
