"""Game data for the test: a 2 m grid of what blocks movement and sight, start positions, sprites at game size."""
from PIL import Image
import numpy as np, json, math, os, collections

base = os.path.dirname(os.path.abspath(__file__))
here = os.environ.get("MAPDIR", base)                      # the map's folder: section.png, layout.json, masks
out = os.environ.get("OUT", os.path.join(base, "game")); os.makedirs(out, exist_ok=True)
a = np.asarray(Image.open(os.path.join(here, "section.png")).convert("RGB")).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]; lum = (r + g + b) / 3
N = a.shape[0]; CELL = 2; G = N // CELL

hedge = (lum >= 45) & (lum < 105) & (g >= b + 6)
building = (lum < 40) & ((g - b) < 8)
L = json.load(open(os.path.join(here, "layout.json")))
lane = np.asarray(Image.open(os.path.join(here, "mask_lane.png"))) > 128


def down(m):
    """Any blocked metre makes its 2 m cell blocked."""
    return m[:G * CELL, :G * CELL].reshape(G, CELL, G, CELL).any(axis=(1, 3))


def erode(m, n):
    for _ in range(n):
        o = m.copy(); o[1:] &= m[:-1]; o[:-1] &= m[1:]; o[:, 1:] &= m[:, :-1]; o[:, :-1] &= m[:, 1:]; m = o
    return m


# hedges are drawn about 8 m wide; the real bank and growth is about 4 m, so trim the edges
hedge1 = erode(hedge, 1)
block = down(hedge1)
hedges = block.copy()
# buildings: their footprints, as Blender built them
yy, xx = np.mgrid[0:G, 0:G]
for h in L["houses"]:
    cx, cy = (h["x"] + N / 2) / CELL, (N / 2 - h["y"]) / CELL
    ca, sa = math.cos(-h["ang"]), math.sin(-h["ang"])
    dx, dy = xx - cx, yy - cy
    u, v = dx * ca - dy * sa, dx * sa + dy * ca
    block |= (np.abs(u) <= h["len"] * 0.46 / CELL + 0.5) & (np.abs(v) <= h["wid"] * 0.43 / CELL + 0.5)
houses_m = block & ~hedges                                     # 2 m cells that are buildings, not hedge
# Where a Sherman (3 m wide) can go: its centre at least 1.75 m from any blocked metre, measured at 1 m.
# Grow the 1 m blocked mask by a disc of that radius, then sample each 2 m cell's centre.
full = hedge1.copy()
hy, hx = np.mgrid[0:N, 0:N]
for h in L["houses"]:
    cx, cy = h["x"] + N / 2, N / 2 - h["y"]; ca, sa = math.cos(-h["ang"]), math.sin(-h["ang"])
    u, v = (hx - cx) * ca - (hy - cy) * sa, (hx - cx) * sa + (hy - cy) * ca
    full |= (np.abs(u) <= h["len"] * 0.46 + 1) & (np.abs(v) <= h["wid"] * 0.43 + 1)
grown = full.copy()
for dy in range(-2, 3):
    for dx in range(-2, 3):
        if dx * dx + dy * dy <= 1.75 ** 2 + 0.5:
            grown |= np.roll(np.roll(full, dy, 0), dx, 1)
tankfree = ~grown[CELL // 2::CELL, CELL // 2::CELL][:G, :G] & ~block
lanes = down(lane) & ~block

# Germans hold the hamlet: the cluster of buildings nearest the middle of the map's west half.
houses = sorted(L["houses"], key=lambda h: (h["x"] + 140) ** 2 + (h["y"] - 60) ** 2)[:4]
hx = sum(h["x"] for h in houses) / len(houses); hy = sum(h["y"] for h in houses) / len(houses)
to_cell = lambda x, y: (int((x + N / 2) / CELL), int((N / 2 - y) / CELL))
to_world = lambda c, r_: (c * CELL + CELL / 2 - N / 2, N / 2 - (r_ * CELL + CELL / 2))

# Shermans start on the lanes, as far from the hamlet as the lanes allow within about 260 m.
start = to_cell(hx, hy)
dist = {}; q = collections.deque()
best = min(((abs(c - start[0]) + abs(r_ - start[1]), (c, r_)) for r_, c in zip(*np.nonzero(lanes))))[1]
dist[best] = 0; q.append(best)
while q:
    c, r_ = q.popleft()
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (c + dc, r_ + dr)
        if 0 <= n[0] < G and 0 <= n[1] < G and lanes[n[1], n[0]] and n not in dist:
            dist[n] = dist[(c, r_)] + 1; q.append(n)
cand = [k for k, d in dist.items() if 110 <= d <= 130]          # 220 to 260 m along the lanes
far = max(cand, key=lambda k: (k[0] - start[0]) ** 2 + (k[1] - start[1]) ** 2)
# a second spot a few cells back along the lane, for the second tank
near = sorted([k for k in dist if abs(dist[k] - dist[far]) in (6, 7)], key=lambda k: (k[0] - far[0]) ** 2 + (k[1] - far[1]) ** 2)[0]
shermans = [to_world(*far), to_world(*near)]

# German squads: around the hamlet's buildings, on open cells
squads = []
for h in houses[:3]:
    c, r_ = to_cell(h["x"], h["y"])
    for rad in range(4, 20):
        found = None
        for ang in range(0, 360, 20):
            cc, rr = int(c + rad * math.cos(math.radians(ang))), int(r_ + rad * math.sin(math.radians(ang)))
            if 0 <= cc < G and 0 <= rr < G and not block[rr, cc]:
                found = (cc, rr); break
        if found:
            squads.append(to_world(*found)); break

# grid: 0 open, 1 hedgerow (infantry can climb it, a tank can crash through it), 2 building
kind = np.where(houses_m, 2, np.where(hedges, 1, 0))
grid = "".join(str(v) for v in kind.flatten())
tankgrid = "".join("0" if v else "1" for v in tankfree.flatten())
print("tank-free cells", int(tankfree.sum()), "infantry-free", int((~block).sum()))
# for missions: the buildings, and any orchard (the map's green fields), in world metres
green = (g > r + 12) & (g > b + 12) & (lum > 70) & (lum < 170)
orchard = None
if green.sum() > 2000:
    gy, gx = np.nonzero(green); orchard = [float(gx.mean() - N / 2), float(N / 2 - gy.mean()), float(np.sqrt(green.sum() / math.pi))]
print("orchard", orchard)
json.dump({"cell": CELL, "size": G, "world": N, "grid": grid, "tankgrid": tankgrid, "houses": [[h["x"], h["y"], h["len"], h["wid"], h["ang"]] for h in L["houses"]], "orchard": orchard, "shermans": shermans, "squads": squads,
           "objective": [hx, hy]}, open(os.path.join(out, "level.json"), "w"))
print("shermans", shermans, "squads", squads, "objective", (hx, hy), "blocked", int(block.sum()), "of", G * G)

if os.environ.get("MAPDIR"): raise SystemExit(0)   # another map: the sprites are shared, already built
# Sprites at game scale: 0.078 m a pixel on screen, from renders at 0.0224 m a pixel.
k = 0.0224 / 0.078
tank = [Image.open(os.path.join(base, "..", "tank", "sprites", "sherman_%02d.png" % i)) for i in range(16)]
ts = round(384 * k)
sheet = Image.new("RGBA", (ts * 16, ts))
for i, im in enumerate(tank):
    sheet.paste(im.resize((ts, ts), Image.LANCZOS), (i * ts, 0))
sheet.save(os.path.join(out, "sherman.png"))
stug = os.path.join(base, "..", "tank", "stugsprites")
if os.path.isdir(stug):   # the German StuG III, same camera and scale
    sheet = Image.new("RGBA", (ts * 16, ts))
    for i in range(16):
        sheet.paste(Image.open(os.path.join(stug, "stug_%02d.png" % i)).resize((ts, ts), Image.LANCZOS), (i * ts, 0))
    sheet.save(os.path.join(out, "stug.png"))
poses = ["idle"] + ["walk%d" % i for i in range(6)] + ["aim", "fire", "prone"]
isz = round(128 * k)
kits = {"rifle": "rifleman.png", "us": "us.png", "tanker": "tanker.png", "mg42": "mg42.png", "para": "para.png", "bazooka": "bazooka.png"}   # German rifleman, US rifleman, Sherman crewman, MG42 gunner, paratrooper, bazooka gunner
for kit, name in kits.items():
    sheet = Image.new("RGBA", (isz * len(poses), isz * 8))
    for d in range(8):
        for i, p in enumerate(poses):
            im = Image.open(os.path.join(base, "..", "infantry", "sprites", "%s_%s_%d.png" % (kit, p, d)))
            sheet.paste(im.resize((isz, isz), Image.LANCZOS), (i * isz, d * isz))
    sheet.save(os.path.join(out, name))
json.dump({"tank": ts, "infantry": isz, "poses": poses, "kits": kits, "tankLookZ": 0.9, "infantryLookZ": 0.75, "spritePx": 0.0224 / k},
          open(os.path.join(out, "sprites.json"), "w"))
print("sprite sizes", ts, isz)
