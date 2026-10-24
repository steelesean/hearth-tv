"""
A StuG III Ausf. G assault gun, as the 17th SS Panzergrenadier Division had them at Carentan, June 1944.
Units are metres. X is forward, Y is left, Z is up; it sits on the ground at z = 0.

Reference: hull 5.4 m long (6.8 m with the gun), 2.95 m wide over the side skirts, 2.16 m high. Six small road
wheels a side, three return rollers, the drive sprocket at the front. A low casemate with the 75 mm StuK 40 L/48 in
the cast "Saukopf" (pig's head) mantlet, a commander's cupola and the loader's MG shield on the roof, Zimmerit
anti-magnetic paste on the plates, and Schürzen side skirts, one panel lost. Dunkelgelb with olive and red-brown.

Run:  python build_stug.py   ->  writes stug.blend
"""
import bpy, bmesh, math, random, os
from mathutils import Vector

random.seed(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TANK = []
here = os.path.dirname(os.path.abspath(__file__))

# The Sherman's material and part helpers (socket, mix, paint, plain, finish, box, cyl, sphere, prism), shared.
src = open(os.path.join(here, "build.py")).read()
exec(src[src.index("def socket("):src.index("OD = paint(")])
exec(src[src.index("def finish("):src.index("# ---------------------------------------------------------------- hull")])


def camo(name, rough=0.7, zimmerit=0.0):
    """Dunkelgelb with olive green and red-brown stripes, mud low down, crevice grime, worn edges; optional Zimmerit."""
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; n = nt.nodes; L = nt.links; bsdf = n["Principled BSDF"]
    geo = n.new("ShaderNodeNewGeometry"); sep = n.new("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Position"], sep.inputs[0])
    def noise(scale, detail=3.0, w=0.0):
        t = n.new("ShaderNodeTexNoise"); t.inputs["Scale"].default_value = scale; t.inputs["Detail"].default_value = detail
        mp = n.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1.0, 1.0, 0.6); mp.inputs["Location"].default_value = (w, w * 2, 0)
        L.new(geo.outputs["Position"], mp.inputs["Vector"]); L.new(mp.outputs[0], t.inputs["Vector"]); return t
    def band(tex, lo, hi):
        r = n.new("ShaderNodeMapRange"); L.new(tex.outputs["Fac"], r.inputs["Value"]); r.inputs[1].default_value = lo; r.inputs[2].default_value = hi; return r.outputs[0]
    col = mix(nt, 0.0, (0.52, 0.38, 0.14, 1), (0.52, 0.38, 0.14, 1))
    col = mix(nt, band(noise(0.9, 2.0, 3.1), 0.50, 0.53), col, (0.035, 0.065, 0.02, 1))      # olive stripes
    col = mix(nt, band(noise(1.0, 2.0, 7.7), 0.53, 0.56), col, (0.12, 0.04, 0.015, 1))        # red-brown stripes
    fade = band(noise(2.0, 6.0, 1.3), 0.3, 0.8)
    col = mix(nt, fade, col, (0.50, 0.42, 0.26, 1), "MIX")                                       # sun-faded patches
    h = n.new("ShaderNodeMapRange"); L.new(sep.outputs["Z"], h.inputs["Value"]); h.inputs[1].default_value = 1.2; h.inputs[2].default_value = 0.25
    mm = n.new("ShaderNodeMath"); mm.operation = "MULTIPLY"; L.new(h.outputs[0], mm.inputs[0]); L.new(noise(1.6, 8.0, 5.0).outputs["Fac"], mm.inputs[1])
    mc = n.new("ShaderNodeMapRange"); L.new(mm.outputs[0], mc.inputs["Value"]); mc.inputs[1].default_value = 0.25; mc.inputs[2].default_value = 0.6
    col = mix(nt, mc.outputs[0], col, (0.17, 0.13, 0.08, 1))
    ao = n.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.25; ao.samples = 8
    inv = n.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0; L.new(ao.outputs["AO"], inv.inputs[1])
    gk = n.new("ShaderNodeMath"); gk.operation = "MULTIPLY"; L.new(inv.outputs[0], gk.inputs[0]); gk.inputs[1].default_value = 0.75
    col = mix(nt, gk.outputs[0], col, (0.06, 0.05, 0.035, 1))
    pt = n.new("ShaderNodeMapRange"); L.new(geo.outputs["Pointiness"], pt.inputs["Value"]); pt.inputs[1].default_value = 0.52; pt.inputs[2].default_value = 0.62
    wk = n.new("ShaderNodeMath"); wk.operation = "MULTIPLY"; L.new(pt.outputs[0], wk.inputs[0]); wk.inputs[1].default_value = 0.45
    col = mix(nt, wk.outputs[0], col, (0.22, 0.20, 0.16, 1))
    L.new(col, bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = rough; bsdf.inputs["Metallic"].default_value = 0.1
    bump = n.new("ShaderNodeBump"); L.new(bump.outputs[0], bsdf.inputs["Normal"])
    if zimmerit:
        # Zimmerit: paste combed into close vertical ridges
        wave = n.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 14.0; wave.inputs["Distortion"].default_value = 1.5
        wave.bands_direction = "X"; L.new(geo.outputs["Position"], wave.inputs["Vector"])
        bump.inputs["Strength"].default_value = zimmerit; L.new(wave.outputs["Fac"], bump.inputs["Height"])
    else:
        bump.inputs["Strength"].default_value = 0.1; L.new(noise(40.0, 6.0).outputs["Fac"], bump.inputs["Height"])
    return mat


YEL = camo("dunkelgelb"); ZIM = camo("dunkelgelb, Zimmerit", zimmerit=0.35); CAST = camo("cast mantlet", rough=0.8)
STEEL = paint("track steel", (0.10, 0.09, 0.08, 1), rough=0.45, metal=0.7, mud=1.2, wear=0.9, grime=0.9)
RUBBER = plain("rubber", (0.035, 0.033, 0.03), rough=0.8)
GUNMETAL = plain("gunmetal", (0.06, 0.06, 0.055), rough=0.35, metal=0.9)
BLACK = plain("black", (0.02, 0.02, 0.02), rough=0.6)
WOOD = paint("wood", (0.16, 0.11, 0.06, 1), rough=0.9, metal=0.0, mud=0.3, wear=0.2)

# ---------------------------------------------------------------- hull: a box with a sloped nose and a raised engine deck
HL, HW = 5.40, 2.10
prism("lower hull", [(2.55, 0.45), (2.70, 0.95), (2.25, 1.35), (-2.55, 1.35), (-2.70, 1.10), (-2.62, 0.45)], HW, ZIM, bevel=0.02)
prism("track guards", [(2.75, 1.33), (2.75, 1.38), (-2.70, 1.38), (-2.70, 1.33)], 2.95, YEL, bevel=0.005)
box("bolted front plate", (0.06, HW - 0.1, 0.34), (2.43, 0, 1.18), ZIM, rot=(0, math.radians(-12), 0), bevel=0.01)
box("engine deck", (1.75, 1.90, 0.12), (-1.70, 0, 1.43), YEL, bevel=0.015)
for k in range(2):
    box("engine hatch", (0.70, 0.70, 0.04), (-1.30 - k * 0.85, 0.40, 1.51), YEL, bevel=0.01)
    box("engine hatch", (0.70, 0.70, 0.04), (-1.30 - k * 0.85, -0.40, 1.51), YEL, bevel=0.01)
box("exhaust muffler", (0.20, 1.50, 0.22), (-2.80, 0, 0.95), GUNMETAL, bevel=0.03)
for s in (1, -1):
    cyl("tail light", 0.04, 0.05, (-2.70, s * 0.85, 1.25), BLACK, rot=(0, math.pi / 2, 0), verts=12)
    cyl("tow hook", 0.06, 0.12, (2.72, s * 0.75, 0.55), STEEL, rot=(math.pi / 2, 0, 0), verts=12)
    cyl("tow cable", 0.025, 2.6, (-0.55, s * 1.05, 1.40), STEEL, rot=(0, math.pi / 2, 0), verts=8)

# ---------------------------------------------------------------- the casemate: low, sloped all round, Zimmerit on the plates
prism("casemate", [(1.85, 1.38), (1.35, 1.98), (-0.95, 1.98), (-1.15, 1.38)], 1.80, ZIM, bevel=0.02)
for s in (1, -1):
    prism("casemate side", [(1.80, 1.38), (1.32, 1.96), (-0.93, 1.96), (-1.12, 1.38)], 0.08, ZIM, y=s * 0.93, bevel=0.01)
box("roof", (2.25, 1.70, 0.05), (0.20, 0, 2.00), YEL, bevel=0.01)
# the gun: Saukopf mantlet, 3.6 m barrel, double-baffle muzzle brake
GX, GZ = 1.70, 1.62
sphere("Saukopf mantlet", 0.42, (GX + 0.10, 0.05, GZ), CAST, scale=(1.15, 0.85, 0.82))
cyl("mantlet collar", 0.20, 0.30, (GX + 0.55, 0.05, GZ), CAST, rot=(0, math.pi / 2, 0), verts=32, r2=0.13)
cyl("barrel", 0.065, 3.30, (GX + 2.25, 0.05, GZ), GUNMETAL, rot=(0, math.pi / 2, 0), verts=24)
cyl("muzzle brake", 0.10, 0.34, (GX + 4.0, 0.05, GZ), GUNMETAL, rot=(0, math.pi / 2, 0), verts=24, bevel=0.01)
for k in (-0.08, 0.08):
    box("brake baffle", (0.06, 0.26, 0.20), (GX + 4.0 + k, 0.05, GZ), GUNMETAL, bevel=0.01)
box("gunner's sight hood", (0.20, 0.16, 0.12), (1.05, 0.45, 2.06), YEL, bevel=0.02)
# commander's cupola at the rear left, with periscopes, and the loader's MG34 behind its shield at the rear right
cyl("cupola", 0.32, 0.22, (-0.45, 0.48, 2.12), YEL, verts=32, bevel=0.015)
for k in range(7):
    a = k * 2 * math.pi / 7
    box("cupola periscope", (0.07, 0.05, 0.06), (-0.45 + 0.30 * math.cos(a), 0.48 + 0.30 * math.sin(a), 2.15), BLACK, rot=(0, 0, a), bevel=0.005)
cyl("cupola hatch", 0.27, 0.04, (-0.45, 0.48, 2.25), YEL, verts=32)
box("MG shield", (0.06, 0.62, 0.42), (-0.10, -0.42, 2.25), YEL, rot=(0, math.radians(-8), 0), bevel=0.01)
for s in (1, -1):
    box("MG shield wing", (0.32, 0.05, 0.38), (-0.25, -0.42 + s * 0.31, 2.23), YEL, bevel=0.01)
cyl("MG34", 0.025, 1.20, (0.30, -0.42, 2.38), GUNMETAL, rot=(0, math.pi / 2, 0), verts=10)
box("loader's hatch", (0.55, 0.60, 0.04), (-0.55, -0.42, 2.04), YEL, bevel=0.01)
# a spare road wheel and a track-link rack on the deck, a crate and a rolled tarpaulin
cyl("spare road wheel", 0.26, 0.12, (-1.95, 0.55, 1.58), STEEL, verts=28)
for k in range(5):
    box("spare track link", (0.14, 0.42, 0.04), (2.08 - k * 0.15, 0, 1.40 + k * 0.01), STEEL, rot=(0, math.radians(-30), 0), bevel=0.005)
box("ammunition crate", (0.55, 0.32, 0.22), (-2.25, -0.50, 1.62), WOOD, bevel=0.01)
cyl("tarpaulin", 0.13, 1.30, (-1.15, 0.0, 2.10), camo("tarp", rough=0.95), rot=(math.pi / 2, 0, 0), verts=14, bevel=0.04)

# ---------------------------------------------------------------- running gear: six road wheels, sprocket at the front
TRACK_Y = 1.20; WHEEL_R = 0.26
WHEELS = [2.0 - i * 0.70 for i in range(6)]
SPROCKET = (2.55, 0.75, 0.30); IDLER = (-2.55, 0.72, 0.28); RETURNS = (1.55, 0.25, -1.05)
for s in (1, -1):
    for wx in WHEELS:
        for dy in (-0.11, 0.11):
            cyl("road wheel", WHEEL_R, 0.10, (wx, s * TRACK_Y + dy, 0.30), STEEL, rot=(math.pi / 2, 0, 0), verts=36, bevel=0.01)
            cyl("tyre", WHEEL_R + 0.01, 0.09, (wx, s * TRACK_Y + dy, 0.30), RUBBER, rot=(math.pi / 2, 0, 0), verts=36, bevel=0.02)
        cyl("hub", 0.08, 0.30, (wx, s * TRACK_Y, 0.30), YEL, rot=(math.pi / 2, 0, 0), verts=16)
        box("torsion arm", (0.36, 0.08, 0.08), (wx - 0.14, s * (TRACK_Y - 0.22), 0.40), YEL, rot=(0, math.radians(-25), 0), bevel=0.01)
    for dy in (-0.1, 0.1):
        cyl("sprocket", SPROCKET[2], 0.09, (SPROCKET[0], s * TRACK_Y + dy, SPROCKET[1]), STEEL, rot=(math.pi / 2, 0, 0), verts=21, bevel=0.012)
        cyl("idler", IDLER[2], 0.09, (IDLER[0], s * TRACK_Y + dy, IDLER[1]), STEEL, rot=(math.pi / 2, 0, 0), verts=32, bevel=0.012)
    for rx in RETURNS:
        cyl("return roller", 0.09, 0.18, (rx, s * TRACK_Y, 1.05), RUBBER, rot=(math.pi / 2, 0, 0), verts=20)

    # the track: one mesh of links laid round the loop (no modifiers to bake)
    loop = [(IDLER[0] + 0.1, 0.03), (WHEELS[-1], 0.035), (WHEELS[0], 0.035)]
    for i in range(10):
        a = -math.radians(70) + i * math.radians(175) / 9; loop.append((SPROCKET[0] + (SPROCKET[2] + 0.03) * math.cos(a), SPROCKET[1] + (SPROCKET[2] + 0.03) * math.sin(a)))
    loop += [(RETURNS[0], 1.17), (RETURNS[1], 1.15), (RETURNS[2], 1.17)]
    for i in range(10):
        a = math.radians(100) + i * math.radians(150) / 9; loop.append((IDLER[0] + (IDLER[2] + 0.03) * math.cos(a), IDLER[1] + (IDLER[2] + 0.03) * math.sin(a)))
    bm = bmesh.new()
    for i in range(len(loop)):
        (x0, z0), (x1, z1) = loop[i], loop[(i + 1) % len(loop)]
        seg = math.hypot(x1 - x0, z1 - z0); n_ = max(1, int(seg / 0.125)); ang = math.atan2(z1 - z0, x1 - x0)
        for j in range(n_):
            t = (j + 0.5) / n_; cx, cz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            r = bmesh.ops.create_cube(bm, size=1.0)
            for v in r["verts"]:
                lx, lz = v.co.x * 0.11, v.co.z * 0.045
                v.co = Vector((cx + lx * math.cos(ang) - lz * math.sin(ang), s * TRACK_Y + v.co.y * 0.40, cz + lx * math.sin(ang) + lz * math.cos(ang)))
    me = bpy.data.meshes.new("track"); bm.to_mesh(me); bm.free()
    trk = bpy.data.objects.new("track", me); scene.collection.objects.link(trk); finish(trk, STEEL, bevel=0.006, smooth=False)

    # Schürzen: 5 mm plates hung from a rail along the side, slightly bent, one lost somewhere in the bocage
    box("skirt rail", (4.6, 0.04, 0.05), (0.0, s * 1.47, 1.43), YEL, bevel=0.005)
    for k in range(5):
        if s == 1 and k == 3: continue
        px = 1.85 - k * 0.92
        box("Schürze", (0.88, 0.012, 0.88), (px, s * (1.47 + random.uniform(-0.01, 0.03)), 0.98), YEL,
            rot=(s * random.uniform(-0.06, 0.02), 0, random.uniform(-0.02, 0.02)), bevel=0.003)
        for hz in (1.36,):
            box("hanger", (0.06, 0.05, 0.08), (px - 0.30, s * 1.47, hz), YEL, bevel=0.005)
            box("hanger", (0.06, 0.05, 0.08), (px + 0.30, s * 1.47, hz), YEL, bevel=0.005)

# a division sign and a number, and some branches tucked in for camouflage
for k in range(5):
    cyl("branch", 0.018, random.uniform(0.6, 1.1), (random.uniform(-1.0, 1.2), random.uniform(-0.8, 0.8), 2.12), WOOD,
        rot=(random.uniform(-0.4, 0.4), random.uniform(1.2, 1.9), random.uniform(0, 3)), verts=6)

root = bpy.data.objects.new("StuG", None); scene.collection.objects.link(root)
for o in TANK:
    if o.parent is None:
        mw = o.matrix_world.copy(); o.parent = root; o.matrix_world = mw
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, "stug.blend"))
print("parts:", len(TANK))
