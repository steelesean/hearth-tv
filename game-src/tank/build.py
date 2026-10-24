"""
An M4A3E8 (76)W "Easy Eight" Sherman, in the spirit of Fury (2014), built from primitives.
Units are metres. X is forward, Y is left, Z is up; the tank sits on the ground at z = 0.

Reference dimensions (Easy Eight): hull about 5.9 m long, 2.99 m wide over the HVSS tracks,
2.97 m high; 23 in (0.58 m) tracks; 20.5 in road wheels in pairs on three bogies a side;
13-tooth drive sprocket at the front, idler at the rear; T23 turret with the 76 mm M1A1 gun.

Run:  python build.py   ->  writes sherman.blend
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

random.seed(4)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TANK = []          # every object that belongs to the tank, parented to one root at the end


# ---------------------------------------------------------------- materials
def socket(node, ident):
    for s in node.inputs:
        if s.identifier == ident or s.name == ident:
            return s
    raise KeyError(ident)


def mix(nt, fac, a, b, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = blend
    links = nt.links
    if isinstance(fac, float): socket(m, "Factor_Float").default_value = fac
    else: links.new(fac, socket(m, "Factor_Float"))
    for ident, v in (("A_Color", a), ("B_Color", b)):
        if isinstance(v, tuple): socket(m, ident).default_value = v
        else: links.new(v, socket(m, ident))
    return m.outputs[2]


def paint(name, base, rough=0.62, metal=0.15, mud=0.9, wear=0.5, grime=0.7):
    """Olive drab with low-down mud, dust, darker crevices and worn, lighter edges."""
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; n = nt.nodes; L = nt.links
    bsdf = n["Principled BSDF"]
    geo = n.new("ShaderNodeNewGeometry"); sep = n.new("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Position"], sep.inputs[0])
    noise = n.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 1.6; noise.inputs["Detail"].default_value = 10.0
    fine = n.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 38.0; fine.inputs["Detail"].default_value = 6.0
    L.new(geo.outputs["Position"], noise.inputs["Vector"]); L.new(geo.outputs["Position"], fine.inputs["Vector"])
    # paint variation: faded patches
    var = n.new("ShaderNodeMapRange"); L.new(noise.outputs["Fac"], var.inputs["Value"]); var.inputs[1].default_value = 0.35; var.inputs[2].default_value = 0.7
    lighter = tuple(min(1, c * 1.8) for c in base[:3]) + (1,)
    col = mix(nt, var.outputs[0], base, lighter)
    # mud: strongest near the ground, broken up by noise
    h = n.new("ShaderNodeMapRange"); L.new(sep.outputs["Z"], h.inputs["Value"]); h.inputs[1].default_value = 1.55; h.inputs[2].default_value = 0.35
    mudmask = n.new("ShaderNodeMath"); mudmask.operation = "MULTIPLY"; L.new(h.outputs[0], mudmask.inputs[0]); L.new(noise.outputs["Fac"], mudmask.inputs[1])
    mudk = n.new("ShaderNodeMath"); mudk.operation = "MULTIPLY"; L.new(mudmask.outputs[0], mudk.inputs[0]); mudk.inputs[1].default_value = mud * 1.6
    mudclamp = n.new("ShaderNodeMapRange"); L.new(mudk.outputs[0], mudclamp.inputs["Value"]); mudclamp.inputs[1].default_value = 0.35; mudclamp.inputs[2].default_value = 0.75
    col = mix(nt, mudclamp.outputs[0], col, (0.19, 0.145, 0.09, 1))
    # dust on top surfaces
    dot = n.new("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Normal"], dot.inputs[0])
    dust = n.new("ShaderNodeMath"); dust.operation = "MULTIPLY"; L.new(dot.outputs["Z"], dust.inputs[0]); L.new(fine.outputs["Fac"], dust.inputs[1])
    dk = n.new("ShaderNodeMath"); dk.operation = "MULTIPLY"; L.new(dust.outputs[0], dk.inputs[0]); dk.inputs[1].default_value = 0.35
    dc = n.new("ShaderNodeClamp"); L.new(dk.outputs[0], dc.inputs[0])
    col = mix(nt, dc.outputs[0], col, (0.30, 0.26, 0.19, 1))
    # rain and oil streaks running down the sides
    mp = n.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (9.0, 9.0, 0.5)
    L.new(geo.outputs["Position"], mp.inputs["Vector"])
    st = n.new("ShaderNodeTexNoise"); st.inputs["Scale"].default_value = 4.0; st.inputs["Detail"].default_value = 4.0; L.new(mp.outputs[0], st.inputs["Vector"])
    sr = n.new("ShaderNodeMapRange"); L.new(st.outputs["Fac"], sr.inputs["Value"]); sr.inputs[1].default_value = 0.55; sr.inputs[2].default_value = 0.75; sr.inputs[4].default_value = 0.45
    col = mix(nt, sr.outputs[0], col, (0.04, 0.04, 0.025, 1))
    # crevice grime
    ao = n.new("ShaderNodeAmbientOcclusion"); ao.inputs["Distance"].default_value = 0.25; ao.samples = 8
    inv = n.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0; L.new(ao.outputs["AO"], inv.inputs[1])
    gk = n.new("ShaderNodeMath"); gk.operation = "MULTIPLY"; L.new(inv.outputs[0], gk.inputs[0]); gk.inputs[1].default_value = grime
    col = mix(nt, gk.outputs[0], col, (0.07, 0.06, 0.04, 1))
    # worn edges: sharp convex corners show lighter, scuffed paint
    pt = n.new("ShaderNodeMapRange"); L.new(geo.outputs["Pointiness"], pt.inputs["Value"]); pt.inputs[1].default_value = 0.52; pt.inputs[2].default_value = 0.62
    wk = n.new("ShaderNodeMath"); wk.operation = "MULTIPLY"; L.new(pt.outputs[0], wk.inputs[0]); wk.inputs[1].default_value = wear
    col = mix(nt, wk.outputs[0], col, (0.20, 0.19, 0.15, 1))
    L.new(col, bsdf.inputs["Base Color"])
    rmix = n.new("ShaderNodeMapRange"); L.new(mudclamp.outputs[0], rmix.inputs["Value"]); rmix.inputs[3].default_value = rough; rmix.inputs[4].default_value = 0.85
    L.new(rmix.outputs[0], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metal
    # cast-steel pitting as fine bump
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12; L.new(fine.outputs["Fac"], bump.inputs["Height"]); L.new(bump.outputs[0], bsdf.inputs["Normal"])
    return mat


def plain(name, rgb, rough=0.5, metal=0.0):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgb + (1,); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    return mat


OD = paint("olive drab", (0.085, 0.092, 0.045, 1), mud=1.3)
OD_CAST = paint("olive drab cast", (0.08, 0.087, 0.042, 1), rough=0.72, mud=1.3)
STEEL = paint("track steel", (0.11, 0.10, 0.09, 1), rough=0.45, metal=0.7, mud=1.0, wear=0.9, grime=0.9)
RUBBER = plain("rubber", (0.035, 0.033, 0.03), rough=0.8)
GUNMETAL = plain("gunmetal", (0.06, 0.06, 0.055), rough=0.35, metal=0.9)
CANVAS = paint("canvas", (0.20, 0.18, 0.11, 1), rough=0.95, metal=0.0, mud=0.4, wear=0.1, grime=0.6)
WOOD = paint("wood", (0.16, 0.11, 0.06, 1), rough=0.9, metal=0.0, mud=0.3, wear=0.2)
WHITE = plain("white paint", (0.78, 0.76, 0.68), rough=0.7)
GLASS = plain("periscope glass", (0.02, 0.03, 0.03), rough=0.05)
LAMP = plain("lamp glass", (0.6, 0.6, 0.5), rough=0.1)


# ---------------------------------------------------------------- helpers
def finish(o, mat, bevel=0.0, seg=2, smooth=True, sub=0):
    o.data.materials.append(mat)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL"); m.width = bevel; m.segments = seg; m.limit_method = "ANGLE"
    if sub:
        s = o.modifiers.new("sub", "SUBSURF"); s.levels = sub; s.render_levels = sub
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
        try:
            o.modifiers.new("wn", "WEIGHTED_NORMAL").keep_sharp = True
        except Exception:
            pass
    TANK.append(o)
    return o


def box(name, size, loc, mat, rot=(0, 0, 0), bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bevel)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.006, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object; o.name = name
    return finish(o, mat, bevel)


def sphere(name, r, loc, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=32, ring_count=16)
    o = bpy.context.object; o.name = name; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat)


def prism(name, profile, width, mat, y=0.0, bevel=0.015):
    """Extrude an (x, z) side profile across the tank's width."""
    bm = bmesh.new()
    left = [bm.verts.new((x, y + width / 2, z)) for x, z in profile]
    right = [bm.verts.new((x, y - width / 2, z)) for x, z in profile]
    bm.faces.new(left); bm.faces.new(list(reversed(right)))
    n = len(profile)
    for i in range(n):
        bm.faces.new([left[i], left[(i + 1) % n], right[(i + 1) % n], right[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    return finish(o, mat, bevel, smooth=False)


# ---------------------------------------------------------------- hull
# Upper hull side profile: rounded nose under a single sloped glacis, flat deck, sloped rear.
upper = [(2.62, 0.95), (3.0, 1.05), (2.02, 1.86), (-2.45, 1.86), (-2.95, 1.70), (-2.98, 0.98), (-2.70, 0.92)]
prism("upper hull", upper, 2.62, OD, bevel=0.025)
prism("lower hull", [(2.70, 0.48), (2.95, 0.62), (2.95, 1.0), (-2.95, 1.0), (-2.95, 0.55), (-2.70, 0.48)], 1.95, OD)
# Cast three-piece differential housing at the nose, with its bolted flanges.
nose = cyl("transmission housing", 0.36, 1.95, (2.80, 0, 0.76), OD_CAST, rot=(math.pi / 2, 0, 0), verts=48, bevel=0.02)
nose.scale = (0.75, 1.0, 1.0)
for yy in (-0.62, 0.0, 0.62):
    cyl("housing flange", 0.38, 0.05, (2.80, yy, 0.76), OD_CAST, rot=(math.pi / 2, 0, 0), verts=48).scale = (0.75, 1, 1)
    for k in range(9):
        a = math.radians(-70 + k * 20)
        cyl("flange bolt", 0.018, 0.06, (2.80 + 0.27 * math.cos(a), yy + 0.03, 0.76 + 0.37 * math.sin(a)), GUNMETAL, rot=(math.pi / 2, 0, 0), verts=8)
# Driver and co-driver hoods bulging out of the glacis, with hatches and periscopes.
gl = math.atan2(1.86 - 1.05, 3.0 - 2.02)                  # glacis angle from horizontal
for yy in (0.52, -0.52):
    box("hatch hood", (0.62, 0.66, 0.16), (2.10, yy, 1.86), OD, bevel=0.03)
    box("hatch", (0.50, 0.52, 0.05), (2.08, yy, 1.96), OD, bevel=0.015)
    box("periscope", (0.10, 0.16, 0.07), (2.36, yy + 0.16, 1.95), GUNMETAL)
    box("periscope glass", (0.012, 0.12, 0.04), (2.415, yy + 0.16, 1.95), GLASS, bevel=0)
# Bow .30 cal in its ball mount, on the co-driver's side.
gx, gz = 2.62, 1.40
sphere("bow mg ball", 0.13, (gx, -0.55, gz), OD_CAST, scale=(0.7, 1, 1))
cyl("bow mg barrel", 0.022, 0.55, (gx + 0.32, -0.55, gz - 0.08), GUNMETAL, rot=(0, math.radians(90 + 15), 0), verts=12)
# Headlights in their brush guards, and lifting eyes.
for yy in (1.05, -1.05):
    cyl("headlight", 0.09, 0.14, (2.92, yy, 1.12), OD, rot=(0, math.pi / 2, 0))
    cyl("headlight lens", 0.075, 0.02, (3.0, yy, 1.12), LAMP, rot=(0, math.pi / 2, 0))
    for d in (-0.12, 0.12):
        cyl("brush guard", 0.014, 0.36, (2.98, yy + d, 1.22), OD, rot=(0, math.radians(70), 0), verts=8)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.018, location=(2.55, yy * 1.1, 1.42), rotation=(0, math.radians(90 - math.degrees(gl)), math.pi / 2))
    finish(bpy.context.object, OD)
# Spare track blocks hung across the glacis as extra armour, as on Fury.
def track_block(name, loc, rot, mat=STEEL):
    o = box(name, (0.15, 0.58, 0.055), loc, mat, rot=rot, bevel=0.012)
    for k in (-0.17, 0.0, 0.17):
        box("grouser", (0.035, 0.12, 0.03), (loc[0], loc[1] + k, loc[2]), mat, rot=rot, bevel=0.006)
    return o
for i in range(3):
    t = 0.14 + i * 0.19
    px, pz = 3.0 - (3.0 - 2.02) * t, 1.05 + (1.86 - 1.05) * t
    for yy in (0.33, -0.33):
        if i == 0 and yy < 0: continue          # the bow gun sits here
        track_block("glacis track", (px + 0.04, yy, pz + 0.05), (0, -gl, 0))
# Sponson tops, fenders and front mud guards over the wide tracks.
for s in (1, -1):
    box("fender", (5.7, 0.30, 0.025), (-0.1, s * 1.36, 1.06), OD, bevel=0.006)
    box("front guard", (0.45, 0.30, 0.025), (2.8, s * 1.36, 0.96), OD, rot=(0, math.radians(20), 0), bevel=0.006)
    for k in range(6):
        box("fender bracket", (0.04, 0.05, 0.10), (2.2 - k * 0.95, s * 1.25, 1.02), OD, bevel=0.004)
    # tools stowed along the hull sides: pick, shovel, crowbar
    cyl("crowbar", 0.018, 1.6, (0.6, s * 1.312, 1.55), GUNMETAL, rot=(0, math.pi / 2, 0), verts=8)
    cyl("shovel haft", 0.02, 1.0, (-0.9, s * 1.315, 1.42), WOOD, rot=(0, math.pi / 2, 0), verts=8)
    box("shovel blade", (0.30, 0.02, 0.24), (-1.5, s * 1.315, 1.42), STEEL, bevel=0.01)
# Engine deck: grille doors, air intake louvres, fuel caps, and stowage piled on the back.
for k in range(14):
    box("grille slat", (0.035, 1.5, 0.03), (-1.55 - k * 0.06, 0, 1.875), GUNMETAL, bevel=0.003)
box("grille frame", (0.95, 1.6, 0.02), (-1.94, 0, 1.865), OD, bevel=0.006)
for yy in (0.7, -0.7):
    box("engine door", (1.0, 0.55, 0.03), (-0.95, yy, 1.875), OD, bevel=0.008)
    cyl("fuel cap", 0.06, 0.04, (-0.55, yy * 1.3, 1.885), OD, verts=16)
box("rear plate", (0.06, 2.4, 0.72), (-2.99, 0, 1.33), OD, rot=(0, math.radians(-12), 0), bevel=0.012)
box("exhaust deflector", (0.30, 1.9, 0.10), (-3.06, 0, 1.05), OD, rot=(0, math.radians(30), 0), bevel=0.01)
for yy in (-0.75, -0.45, 0.45, 0.75):
    box("jerry can", (0.17, 0.35, 0.47), (-3.12, yy, 1.45), OD, bevel=0.025)
cyl("tow cable", 0.03, 2.2, (-2.85, 0, 1.78), GUNMETAL, rot=(math.pi / 2, 0, 0), verts=10)
for i, (yy, r) in enumerate(((0.75, 0.17), (0.35, 0.15), (-0.1, 0.18), (-0.55, 0.16))):
    o = cyl("bedroll", r, 0.95, (-2.25 + random.uniform(-0.06, 0.06), yy, 1.86 + r), CANVAS, rot=(0, math.pi / 2, random.uniform(-0.15, 0.15)), verts=24, bevel=0)
    o.scale = (1, 1, 0.78)
    sub = o.modifiers.new("sub", "SUBSURF"); sub.levels = 1; sub.render_levels = 2
for yy in (1.0, -1.0):
    box("ammo crate", (0.55, 0.32, 0.30), (-1.7, yy * 0.95, 2.02), WOOD, bevel=0.01)
box("tarp", (0.9, 1.4, 0.20), (-1.1, 0.1, 1.97), CANVAS, bevel=0.06).modifiers.new("sub", "SUBSURF").levels = 2


# ---------------------------------------------------------------- HVSS running gear
TRACK_Y = 1.20        # centre line of each track
WHEEL_R = 0.26
BOGIES = (1.62, 0.12, -1.38)
SPROCKET = (2.55, 0.64, 0.34)
IDLER = (-2.60, 0.55, 0.30)
RETURNS = (1.95, 0.82, -0.40, -1.62)


def dual_wheel(x, z, s):
    for dy in (-0.155, 0.155):
        y = s * TRACK_Y + dy
        cyl("road wheel", WHEEL_R, 0.15, (x, y, z), STEEL, rot=(math.pi / 2, 0, 0), verts=40, bevel=0.01)
        cyl("tyre", WHEEL_R + 0.012, 0.13, (x, y, z), RUBBER, rot=(math.pi / 2, 0, 0), verts=40, bevel=0.02)
        side = y + math.copysign(0.08, dy)
        cyl("hub", 0.09, 0.04, (x, side, z), OD, rot=(math.pi / 2, 0, 0), verts=24)
        for k in range(8):
            a = k * math.pi / 4
            cyl("wheel bolt", 0.014, 0.03, (x + 0.17 * math.cos(a), side, z + 0.17 * math.sin(a)), GUNMETAL, rot=(math.pi / 2, 0, 0), verts=6)


for s in (1, -1):
    for bx in BOGIES:
        box("bogie frame", (0.62, 0.26, 0.34), (bx, s * (TRACK_Y - 0.0), 0.62), OD_CAST, bevel=0.03)
        box("bogie arm", (0.80, 0.12, 0.10), (bx, s * TRACK_Y, 0.36), OD_CAST, bevel=0.02)
        box("volute spring housing", (0.34, 0.20, 0.20), (bx, s * TRACK_Y, 0.82), OD_CAST, bevel=0.03)
        dual_wheel(bx + 0.31, 0.30, s)
        dual_wheel(bx - 0.31, 0.30, s)
        cyl("shock absorber", 0.035, 0.62, (bx + 0.05, s * (TRACK_Y + 0.17), 0.62), GUNMETAL, rot=(0, math.radians(55), 0), verts=12)
        box("bogie mount", (0.40, 0.30, 0.10), (bx, s * (TRACK_Y - 0.2), 0.97), OD, bevel=0.02)
    # 13-tooth drive sprocket (two rings) and the idler
    for dy in (-0.2, 0.2):
        cyl("sprocket hub", SPROCKET[2] - 0.08, 0.10, (SPROCKET[0], s * TRACK_Y + dy, SPROCKET[1]), OD_CAST, rot=(math.pi / 2, 0, 0), verts=40, bevel=0.015)
        for k in range(13):
            a = k * 2 * math.pi / 13
            box("sprocket tooth", (0.09, 0.08, 0.07), (SPROCKET[0] + SPROCKET[2] * 0.86 * math.cos(a), s * TRACK_Y + dy, SPROCKET[1] + SPROCKET[2] * 0.86 * math.sin(a)), STEEL, rot=(0, -a, 0), bevel=0.01)
    cyl("final drive", 0.22, 0.34, (SPROCKET[0], s * (TRACK_Y - 0.32), SPROCKET[1]), OD_CAST, rot=(math.pi / 2, 0, 0), verts=32, bevel=0.02)
    for dy in (-0.155, 0.155):
        cyl("idler", IDLER[2], 0.14, (IDLER[0], s * TRACK_Y + dy, IDLER[1]), STEEL, rot=(math.pi / 2, 0, 0), verts=40, bevel=0.012)
    for rx in RETURNS:
        for dy in (-0.15, 0.15):
            cyl("return roller", 0.11, 0.12, (rx, s * TRACK_Y + dy, 1.03), STEEL, rot=(math.pi / 2, 0, 0), verts=24)
        box("return roller bracket", (0.12, 0.30, 0.10), (rx, s * (TRACK_Y - 0.18), 1.03), OD, bevel=0.01)


def track_loop():
    """The centre line of one track, as a closed list of (x, z) points."""
    pts = []
    def arc(cx, cz, r, a0, a1, n):
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    t = 0.035                                         # half the track's thickness
    bottom = 0.0 + t
    # bottom run from the idler forward, rising to the sprocket
    pts.append((IDLER[0] + 0.15, bottom + 0.02))
    for bx in BOGIES:
        for wx in (bx + 0.31, bx - 0.31):
            pass
    pts.append((BOGIES[-1] - 0.31, bottom)); pts.append((BOGIES[0] + 0.31, bottom))
    arc(SPROCKET[0], SPROCKET[1], SPROCKET[2] + t, -math.radians(62), math.radians(110), 14)
    # top run sagging between the return rollers
    top = 1.03 + 0.11 + t
    xs = [RETURNS[0], (RETURNS[0] + RETURNS[1]) / 2, RETURNS[1], (RETURNS[1] + RETURNS[2]) / 2, RETURNS[2], (RETURNS[2] + RETURNS[3]) / 2, RETURNS[3]]
    for i, xx in enumerate(xs):
        pts.append((xx, top - (0.035 if i % 2 else 0.0)))
    arc(IDLER[0], IDLER[1], IDLER[2] + t, math.radians(95), math.radians(245), 12)
    return pts


def build_track(s):
    # path
    cu = bpy.data.curves.new("track path", "CURVE"); cu.dimensions = "3D"
    sp = cu.splines.new("POLY"); pts = track_loop(); sp.points.add(len(pts) - 1)
    for p, (xx, zz) in zip(sp.points, pts):
        p.co = (xx, s * TRACK_Y, zz, 1)
    sp.use_cyclic_u = True
    path = bpy.data.objects.new("track path", cu); scene.collection.objects.link(path); TANK.append(path)
    # one T66-style steel link with grousers and a centre guide horn, then arrayed round the path
    bm = bmesh.new()
    def add_box(cx, cy, cz, sx, sy, sz):
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r["verts"]:
            v.co = Vector((v.co.x * sx + cx, v.co.y * sy + cy, v.co.z * sz + cz))
    add_box(0, 0, 0, 0.140, 0.58, 0.05)                  # shoe
    for k in (-0.2, 0.0, 0.2):
        add_box(0, k, -0.035, 0.05, 0.14, 0.03)          # grousers on the ground side
    add_box(0, 0, 0.05, 0.06, 0.05, 0.07)                # centre guide horn
    me = bpy.data.meshes.new("track link"); bm.to_mesh(me); bm.free()
    link = bpy.data.objects.new("track", me); scene.collection.objects.link(link)
    link.location = (0, s * TRACK_Y, 0)
    arr = link.modifiers.new("array", "ARRAY"); arr.fit_type = "FIT_CURVE"; arr.curve = path
    arr.use_relative_offset = True; arr.relative_offset_displace = (1.09, 0, 0); arr.use_merge_vertices = False
    bev = link.modifiers.new("bevel", "BEVEL"); bev.width = 0.008; bev.segments = 2
    cm = link.modifiers.new("curve", "CURVE"); cm.object = path; cm.deform_axis = "POS_X"
    link.data.materials.append(STEEL)
    for p in link.data.polygons: p.use_smooth = True
    TANK.append(link)
    # The curve modifier works in the path's space: the link must sit on the path's own centre line.
    link.location = (0, 0, 0)


for s in (1, -1):
    build_track(s)
# Bake each track into plain geometry, so copies of the tank don't share (and bend along) one path.
for o in [o for o in TANK if o.name.startswith("track") and o.type == "MESH"]:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        if m.type in ("ARRAY", "CURVE"):
            bpy.ops.object.modifier_apply(modifier=m.name)
for o in [o for o in TANK if o.name.startswith("track path")]:
    TANK.remove(o); bpy.data.objects.remove(o)


# ---------------------------------------------------------------- T23 turret
TX, TZ = 0.25, 1.86           # turret ring centre
bpy.ops.mesh.primitive_cylinder_add(radius=1.12, depth=0.80, location=(TX, 0, TZ + 0.40), vertices=64)
tur = bpy.context.object; tur.name = "turret"
tur.scale = (1.0, 0.90, 1.0)
bpy.ops.object.transform_apply(scale=True)
# taper the walls and pull out the rear bustle, as on the cast T23
bm = bmesh.new(); bm.from_mesh(tur.data)
for v in bm.verts:
    local = v.co - Vector((0, 0, 0))
    top = v.co.z > 0
    if top:
        v.co.x *= 0.82; v.co.y *= 0.80
    if v.co.x < -0.2:
        v.co.x -= 0.45 * min(1, (-v.co.x - 0.2) / 0.9)            # bustle
    if v.co.x > 0.5:
        v.co.x += 0.05
bm.to_mesh(tur.data); bm.free()
finish(tur, OD_CAST, bevel=0.06, seg=3, sub=2)
box("turret ring guard", (0.10, 1.6, 0.10), (TX + 1.0, 0, TZ + 0.05), OD_CAST, bevel=0.03)
# gun mantlet and the long 76 mm M1A1 with its double-baffle muzzle brake
mx = TX + 1.08
m = cyl("mantlet", 0.42, 0.86, (mx, 0, TZ + 0.42), OD_CAST, rot=(math.pi / 2, 0, 0), verts=48, bevel=0.03)
m.scale = (0.55, 1, 1)
box("mantlet cheek", (0.22, 0.95, 0.62), (mx + 0.06, 0, TZ + 0.42), OD_CAST, bevel=0.05)
cyl("gun sleeve", 0.12, 0.65, (mx + 0.50, 0, TZ + 0.44), OD_CAST, rot=(0, math.pi / 2, 0), verts=32)
cyl("gun barrel", 0.065, 3.75, (mx + 2.55, 0, TZ + 0.44), OD, rot=(0, math.pi / 2, 0), verts=32, bevel=0.004, r2=0.058)
cyl("muzzle brake", 0.095, 0.30, (mx + 4.50, 0, TZ + 0.44), GUNMETAL, rot=(0, math.pi / 2, 0), verts=32)
for d in (-0.07, 0.07):
    box("brake baffle", (0.06, 0.22, 0.20), (mx + 4.50 + d, 0, TZ + 0.44), GUNMETAL, bevel=0.01)
cyl("coax mg", 0.02, 0.40, (mx + 0.40, 0.26, TZ + 0.42), GUNMETAL, rot=(0, math.pi / 2, 0), verts=10)
# "FURY" painted on the barrel, read from the left side as in the film
bpy.ops.object.text_add(location=(mx + 1.62, 0.068, TZ + 0.44), rotation=(math.pi / 2, 0, math.pi))
txt = bpy.context.object; txt.data.body = "FURY"; txt.data.size = 0.085; txt.data.extrude = 0.002
txt.data.align_x = "LEFT"; txt.data.align_y = "CENTER"
bpy.ops.object.convert(target="MESH")
txt = bpy.context.object; txt.data.materials.append(WHITE); TANK.append(txt)
# commander's vision cupola with six blocks, loader's hatch, ventilator, and the .50 cal
cx, cy, cz = TX - 0.25, -0.38, TZ + 0.84
cyl("cupola", 0.30, 0.22, (cx, cy, cz + 0.08), OD_CAST, verts=48, bevel=0.02)
for k in range(6):
    a = k * math.pi / 3
    box("vision block", (0.10, 0.13, 0.10), (cx + 0.29 * math.cos(a), cy + 0.29 * math.sin(a), cz + 0.10), GLASS, rot=(0, 0, a), bevel=0.01)
sphere("cupola hatch", 0.25, (cx, cy, cz + 0.20), OD_CAST, scale=(1, 1, 0.28))
bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.04, location=(TX - 0.05, 0.42, TZ + 0.84), vertices=48)
o = bpy.context.object; o.scale = (1.25, 0.95, 1); bpy.ops.object.transform_apply(scale=True); finish(o, OD_CAST, bevel=0.01)
sphere("ventilator", 0.13, (TX + 0.45, 0.0, TZ + 0.84), OD_CAST, scale=(1, 1, 0.45))
# M2 .50 calibre on its pintle at the back of the roof
px, py, pz = TX - 0.72, -0.05, TZ + 0.84
cyl("pintle", 0.03, 0.42, (px, py, pz + 0.20), GUNMETAL, verts=12)
box("m2 receiver", (0.55, 0.14, 0.17), (px + 0.05, py, pz + 0.45), GUNMETAL, bevel=0.01)
cyl("m2 jacket", 0.035, 0.40, (px + 0.50, py, pz + 0.46), GUNMETAL, rot=(0, math.pi / 2, 0), verts=16)
cyl("m2 barrel", 0.018, 1.05, (px + 0.95, py, pz + 0.46), GUNMETAL, rot=(0, math.pi / 2, 0), verts=12)
box("m2 ammo can", (0.28, 0.12, 0.20), (px + 0.05, py + 0.15, pz + 0.40), OD, bevel=0.01)
# spare track links welded to the turret cheeks, and a radio antenna on the bustle
for s in (1, -1):
    for k in range(3):
        box("turret track", (0.15, 0.05, 0.42), (TX + 0.30 - k * 0.165, s * 0.90, TZ + 0.38), STEEL, rot=(s * math.radians(-12), 0, 0), bevel=0.01)
cyl("antenna base", 0.05, 0.10, (TX - 1.05, 0.55, TZ + 0.78), OD, verts=16)
cyl("antenna", 0.006, 2.6, (TX - 1.05, 0.55, TZ + 2.05), GUNMETAL, verts=8, bevel=0)
box("bustle rack", (0.55, 1.4, 0.04), (TX - 1.22, 0, TZ + 0.70), OD, bevel=0.01)
cyl("bustle bedroll", 0.15, 1.2, (TX - 1.22, 0, TZ + 0.86), CANVAS, rot=(math.pi / 2, 0, 0), verts=24, bevel=0).scale = (1, 1, 0.8)

# ---------------------------------------------------------------- weld beads and markings
for s_ in (1, -1):
    cyl("weld", 0.016, 4.45, (-0.21, s_ * 1.31, 1.86), GUNMETAL, rot=(0, math.pi / 2, 0), verts=6, bevel=0)
bpy.ops.curve.primitive_bezier_circle_add(radius=0.3)
star = bpy.context.object
star.data.splines.clear(); sp = star.data.splines.new("POLY"); pts = []
for k in range(10):
    r = 0.30 if k % 2 == 0 else 0.12; a = math.pi / 2 + k * math.pi / 5
    pts.append((r * math.cos(a), r * math.sin(a)))
sp.points.add(9)
for p_, (u, v) in zip(sp.points, pts): p_.co = (u, v, 0, 1)
sp.use_cyclic_u = True; star.data.dimensions = "2D"; star.data.fill_mode = "BOTH"; star.data.extrude = 0.002
star.location = (0.2, 1.312, 1.45); star.rotation_euler = (math.pi / 2, 0, math.pi)
bpy.ops.object.convert(target="MESH"); star = bpy.context.object
dull = plain("faded star", (0.16, 0.155, 0.12), rough=0.9); star.data.materials.append(dull); TANK.append(star)

# ---------------------------------------------------------------- Fury-style clutter
for k, (xx, yy) in enumerate(((TX - 0.9, 0.55), (TX - 0.75, 0.75), (TX - 1.1, -0.6))):
    sphere("helmet", 0.13, (xx, yy, TZ + 0.86), OD, scale=(1.1, 1, 0.55))
for k in range(3):
    box("ammo box", (0.28, 0.14, 0.18), (-0.25 + k * 0.32, 1.12, 1.95), OD, bevel=0.01)
cyl("log", 0.14, 2.3, (-1.15, -1.05, 1.98), WOOD, rot=(0, math.pi / 2, 0.06), verts=16, bevel=0.02)
box("sandbag", (0.45, 0.30, 0.16), (2.55, 0.85, 1.38), CANVAS, rot=(0, -gl, 0.1), bevel=0.07)
box("sandbag", (0.45, 0.30, 0.16), (2.50, -0.95, 1.42), CANVAS, rot=(0, -gl, -0.08), bevel=0.07)

# ---------------------------------------------------------------- one root for the whole tank
import os
root = bpy.data.objects.new("Sherman", None); scene.collection.objects.link(root)
for o in TANK:
    if o.parent is None:
        mw = o.matrix_world.copy(); o.parent = root; o.matrix_world = mw

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(os.path.abspath(__file__)), "sherman.blend"))
print("parts:", len(TANK))
