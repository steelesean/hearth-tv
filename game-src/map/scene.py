"""
Builds the Normandy section from layout.json and the ground masks, drops in the Sherman, and renders.
  python scene.py overview OUT.png [samples]     the whole 720 m section, from the game's angle
  python scene.py game OUT.png [samples]         what the TV would show: about 150 m, two Shermans on the lane
"""
import bpy, json, math, os, random, sys
from mathutils import Vector

mode, out = sys.argv[1], os.path.abspath(sys.argv[2])
samples = int(sys.argv[3]) if len(sys.argv) > 3 else 64
base = os.path.dirname(os.path.abspath(__file__))
here = os.environ.get("MAPDIR", base)   # the map's own folder: its masks and layout, and where camera.json goes
L = json.load(open(os.path.join(here, "layout.json")))
N = L["size"]
random.seed(9)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = samples; scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"; scene.view_settings.look = "AgX - Medium High Contrast"; scene.view_settings.exposure = -0.35
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080


def sk(node, ident):
    return [s for s in node.inputs if s.identifier == ident or s.name == ident][0]


def out_of(node, ident):
    return [o for o in node.outputs if o.identifier == ident][0]


def mixc(nt, fac, a, b):
    m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"
    nt.links.new(fac, sk(m, "Factor_Float"))
    for ident, v in (("A_Color", a), ("B_Color", b)):
        s = sk(m, ident)
        if isinstance(v, tuple): s.default_value = v
        else: nt.links.new(v, s)
    return m.outputs[2]


# ---------------------------------------------------------------- light, the same as the Sherman's renders
world = bpy.data.worlds.new("sky"); scene.world = world; world.use_nodes = True
bgn = world.node_tree.nodes["Background"]; bgn.inputs["Color"].default_value = (0.40, 0.42, 0.45, 1); bgn.inputs["Strength"].default_value = 0.55
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(68), 0, math.radians(-115)))
sun = bpy.context.object; sun.data.energy = 4.2; sun.data.color = (1.0, 0.82, 0.62); sun.data.angle = math.radians(4)
if os.environ.get("LIGHT") == "dusk":
    # dusk: the same direction as the day sun (so the units' baked shadows still agree), but low, red and weak,
    # under a cooling sky
    sun.rotation_euler = (math.radians(81), 0, math.radians(-115)); sun.data.energy = 2.6; sun.data.color = (1.0, 0.55, 0.32)
    bgn.inputs["Color"].default_value = (0.26, 0.30, 0.44, 1); bgn.inputs["Strength"].default_value = 0.42


# ---------------------------------------------------------------- ground: pasture, ploughland, lanes, the main road
def mask_tex(nt, name):
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(os.path.join(here, name)); t.image.colorspace_settings.name = "Non-Color"
    t.interpolation = "Cubic"
    return t


bpy.ops.mesh.primitive_plane_add(size=N, location=(0, 0, 0))
groundo = bpy.context.object
mat = bpy.data.materials.new("ground"); mat.use_nodes = True; nt = mat.node_tree; Ln = nt.links; bsdf = nt.nodes["Principled BSDF"]
tc = nt.nodes.new("ShaderNodeTexCoord")
fm, lm, mm = mask_tex(nt, "mask_field.png"), mask_tex(nt, "mask_lane.png"), mask_tex(nt, "mask_main.png")
for t in (fm, lm, mm): Ln.new(tc.outputs["UV"], t.inputs["Vector"])
n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 0.08; n1.inputs["Detail"].default_value = 12; Ln.new(tc.outputs["Object"], n1.inputs["Vector"])
n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 1.2; n2.inputs["Detail"].default_value = 8; Ln.new(tc.outputs["Object"], n2.inputs["Vector"])
grass = mixc(nt, n1.outputs["Fac"], (0.085, 0.105, 0.035, 1), (0.17, 0.18, 0.07, 1))
grass = mixc(nt, n2.outputs["Fac"], grass, (0.12, 0.13, 0.05, 1))
# ploughed furrows
wave = nt.nodes.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 0.9; wave.inputs["Distortion"].default_value = 1.5; Ln.new(tc.outputs["Object"], wave.inputs["Vector"])
plough = mixc(nt, wave.outputs["Fac"], (0.11, 0.075, 0.045, 1), (0.21, 0.155, 0.10, 1))
col = mixc(nt, fm.outputs["Color"], grass, plough)
mud = mixc(nt, n2.outputs["Fac"], (0.20, 0.17, 0.13, 1), (0.30, 0.26, 0.20, 1))
col = mixc(nt, lm.outputs["Color"], col, mud)
col = mixc(nt, mm.outputs["Color"], col, (0.24, 0.22, 0.19, 1))
Ln.new(col, bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 0.92; bsdf.inputs["Specular IOR Level"].default_value = 0.2
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35
hsum = nt.nodes.new("ShaderNodeMath"); hsum.operation = "ADD"; Ln.new(wave.outputs["Fac"], hsum.inputs[0]); Ln.new(n2.outputs["Fac"], hsum.inputs[1])
Ln.new(hsum.outputs[0], bump.inputs["Height"]); Ln.new(bump.outputs[0], bsdf.inputs["Normal"])
groundo.data.materials.append(mat)


# ---------------------------------------------------------------- hedgerows: bushes and the odd tree on earth banks
leaf = bpy.data.materials.new("hedge"); leaf.use_nodes = True; lt = leaf.node_tree; lb = lt.nodes["Principled BSDF"]
ln = lt.nodes.new("ShaderNodeTexNoise"); ln.inputs["Scale"].default_value = 2.5; ln.inputs["Detail"].default_value = 10
ramp = lt.nodes.new("ShaderNodeValToRGB"); ramp.color_ramp.elements[0].color = (0.012, 0.022, 0.006, 1); ramp.color_ramp.elements[1].color = (0.085, 0.115, 0.03, 1)
lt.links.new(ln.outputs["Fac"], ramp.inputs[0]); lt.links.new(ramp.outputs[0], lb.inputs["Base Color"]); lb.inputs["Roughness"].default_value = 0.8
lbump = lt.nodes.new("ShaderNodeBump"); lbump.inputs["Strength"].default_value = 1.0; lt.links.new(ln.outputs["Fac"], lbump.inputs["Height"]); lt.links.new(lbump.outputs[0], lb.inputs["Normal"])

shapes = bpy.data.collections.new("bush shapes")
for k in range(6):
    tree = k >= 4
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0, location=(0, 0, 0))
    o = bpy.context.object; o.name = "bush %d" % k
    o.scale = (1.5, 1.5, 1.6) if not tree else (3.2, 3.2, 3.0)
    bpy.ops.object.transform_apply(scale=True)
    d = o.modifiers.new("d", "DISPLACE"); tx = bpy.data.textures.new("leaf%d" % k, "CLOUDS"); tx.noise_scale = 0.6 if not tree else 1.0; tx.noise_depth = 4; d.texture = tx; d.strength = 0.7
    bpy.ops.object.modifier_apply(modifier="d")
    for v in o.data.vertices: v.co.z += (1.4 if not tree else 6.5)
    if tree:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=4.5, location=(0, 0, 2.2)); trunk = bpy.context.object
        trunk.data.materials.append(bpy.data.materials.new("bark"))
        trunk.data.materials[0].diffuse_color = (0.1, 0.08, 0.06, 1)
        bpy.ops.object.select_all(action="DESELECT"); trunk.select_set(True); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.join()
    for p in o.data.polygons: p.use_smooth = True
    o.data.materials.clear(); o.data.materials.append(leaf)
    for c in o.users_collection: c.objects.unlink(o)
    shapes.objects.link(o)

me = bpy.data.meshes.new("hedge points")
me.from_pydata([(x, y, 0) for x, y in L["hedge"]], [], [])
pts = bpy.data.objects.new("hedgerows", me); scene.collection.objects.link(pts)
ng = bpy.data.node_groups.new("scatter", "GeometryNodeTree")
ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
gi = ng.nodes.new("NodeGroupInput"); go = ng.nodes.new("NodeGroupOutput")
iop = ng.nodes.new("GeometryNodeInstanceOnPoints")
ci = ng.nodes.new("GeometryNodeCollectionInfo"); ci.inputs["Collection"].default_value = shapes; ci.inputs["Separate Children"].default_value = True; ci.inputs["Reset Children"].default_value = True
# mostly bushes: weight the index towards 0 to 3, trees about one in eight
rf = ng.nodes.new("FunctionNodeRandomValue"); rf.data_type = "FLOAT"; sk(rf, "Min_001").default_value = 0.0; sk(rf, "Max_001").default_value = 1.0
cmp = ng.nodes.new("FunctionNodeCompare"); cmp.data_type = "FLOAT"; cmp.operation = "GREATER_THAN"; ng.links.new(out_of(rf, 'Value_001'), cmp.inputs[0]); cmp.inputs[1].default_value = 0.95
sw = ng.nodes.new("GeometryNodeSwitch"); sw.input_type = "INT"
ri2 = ng.nodes.new("FunctionNodeRandomValue"); ri2.data_type = "INT"; sk(ri2, "Min_002").default_value = 0; sk(ri2, "Max_002").default_value = 3
ri3 = ng.nodes.new("FunctionNodeRandomValue"); ri3.data_type = "INT"; sk(ri3, "Min_002").default_value = 4; sk(ri3, "Max_002").default_value = 5; sk(ri3, "Seed").default_value = 3
ng.links.new(cmp.outputs[0], sw.inputs["Switch"])
ng.links.new(out_of(ri2, 'Value_002'), sw.inputs["False"]); ng.links.new(out_of(ri3, 'Value_002'), sw.inputs["True"])
rr = ng.nodes.new("FunctionNodeRandomValue"); rr.data_type = "FLOAT_VECTOR"; sk(rr, "Min").default_value = (0, 0, 0); sk(rr, "Max").default_value = (0.1, 0.1, 6.28)
rs = ng.nodes.new("FunctionNodeRandomValue"); rs.data_type = "FLOAT"; sk(rs, "Min_001").default_value = 0.8; sk(rs, "Max_001").default_value = 1.15; sk(rs, "Seed").default_value = 5
ng.links.new(gi.outputs[0], iop.inputs["Points"]); ng.links.new(ci.outputs[0], iop.inputs["Instance"])
iop.inputs["Pick Instance"].default_value = True
ng.links.new(sw.outputs[0], iop.inputs["Instance Index"])
ng.links.new(out_of(rr, 'Value'), iop.inputs["Rotation"])
ng.links.new(out_of(rs, 'Value_001'), iop.inputs["Scale"])
ng.links.new(iop.outputs[0], go.inputs[0])
pts.modifiers.new("scatter", "NODES").node_group = ng


# ---------------------------------------------------------------- the hamlet: stone farmhouses with tiled or slate roofs
stone = bpy.data.materials.new("stone"); stone.use_nodes = True; st = stone.node_tree; sb = st.nodes["Principled BSDF"]
sn = st.nodes.new("ShaderNodeTexNoise"); sn.inputs["Scale"].default_value = 6.0
sr = st.nodes.new("ShaderNodeValToRGB"); sr.color_ramp.elements[0].color = (0.25, 0.22, 0.18, 1); sr.color_ramp.elements[1].color = (0.42, 0.38, 0.31, 1)
st.links.new(sn.outputs["Fac"], sr.inputs[0]); st.links.new(sr.outputs[0], sb.inputs["Base Color"]); sb.inputs["Roughness"].default_value = 0.9
roofs = []
for rgb in ((0.32, 0.15, 0.09), (0.12, 0.12, 0.13), (0.26, 0.13, 0.08)):
    m = bpy.data.materials.new("roof"); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = rgb + (1,); b.inputs["Roughness"].default_value = 0.75; roofs.append(m)
import bmesh
for hs in L["houses"]:
    ln_, wd = hs["len"] * 0.92, hs["wid"] * 0.85
    wall_h, roof_h = random.uniform(5.0, 6.5), wd * 0.45
    bpy.ops.mesh.primitive_cube_add(size=1, location=(hs["x"], hs["y"], wall_h / 2), rotation=(0, 0, hs["ang"]))
    w = bpy.context.object; w.scale = (ln_, wd, wall_h); w.data.materials.append(stone)
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((-ln_ / 2 - .3, -wd / 2 - .5, 0), (ln_ / 2 + .3, -wd / 2 - .5, 0), (ln_ / 2 + .3, wd / 2 + .5, 0), (-ln_ / 2 - .3, wd / 2 + .5, 0), (-ln_ / 2 - .3, 0, roof_h), (ln_ / 2 + .3, 0, roof_h))]
    for f in ((0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)): bm.faces.new([v[i] for i in f])
    rme = bpy.data.meshes.new("roof"); bm.to_mesh(rme); bm.free()
    r = bpy.data.objects.new("roof", rme); scene.collection.objects.link(r)
    r.location = (hs["x"], hs["y"], wall_h); r.rotation_euler = (0, 0, hs["ang"]); r.data.materials.append(random.choice(roofs))


if mode in ("bg", "height"):
    # The game's background: the whole section at game scale (0.078 m a pixel), no units, plus the
    # camera's axes so the game can place units exactly where Blender would have drawn them.
    W, H = 9216, 5632
    scene.render.resolution_x, scene.render.resolution_y = W, H
    look = Vector((0, 0, 0)); el = math.radians(37)
    loc = look + Vector((math.cos(el), 0, math.sin(el))) * 900
    bpy.ops.object.camera_add(location=loc); cam = bpy.context.object
    cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"; cam.data.ortho_scale = W * 0.078; cam.data.clip_end = 5000; scene.camera = cam
    bpy.context.view_layer.update()
    mw = cam.matrix_world
    json.dump({"W": W, "H": H, "mPerPx": 0.078, "right": list(mw.col[0].xyz), "up": list(mw.col[1].xyz), "centre": list(look)},
              open(os.path.join(here, "camera.json"), "w"))
    if mode == "height":
        # Height map for the game's occlusion: each pixel stores the height of the first surface the camera sees,
        # 0 to 15.3 m in 8 bits. A unit's pixel is hidden wherever the scene there stands taller than that pixel does.
        hm = bpy.data.materials.new("height"); hm.use_nodes = True; nt = hm.node_tree; nt.nodes.clear()
        geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 1 / 15.3
        em = nt.nodes.new("ShaderNodeEmission"); o = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(geo.outputs["Position"], sep.inputs[0]); nt.links.new(sep.outputs["Z"], mul.inputs[0])
        nt.links.new(mul.outputs[0], em.inputs["Color"]); nt.links.new(em.outputs[0], o.inputs["Surface"])
        bpy.context.view_layer.material_override = hm
        bgn.inputs["Strength"].default_value = 0
        scene.cycles.samples = 1; scene.cycles.use_denoising = False; scene.cycles.max_bounces = 0
        scene.cycles.filter_width = 0.01; scene.render.film_transparent = False
        scene.view_settings.view_transform = "Raw"; scene.view_settings.look = "None"; scene.view_settings.exposure = 0
        scene.render.image_settings.color_mode = "BW"
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    sys.exit(0)

# ---------------------------------------------------------------- the Sherman, from its own file
with bpy.data.libraries.load(os.path.join(base, "..", "tank", "sherman.blend"), link=False) as (src, dst):
    dst.objects = src.objects
tanks = []
first = L["tanks"][0]["ang"]
for i, spot in enumerate(L["tanks"]):
    if i == 0:
        objs = [o for o in dst.objects if o is not None]
        for o in objs: scene.collection.objects.link(o)
        root = bpy.data.objects["Sherman"]
    else:
        root = bpy.data.objects["Sherman"].copy(); scene.collection.objects.link(root)
        for c in bpy.data.objects["Sherman"].children:
            cc = c.copy(); scene.collection.objects.link(cc); cc.parent = root; cc.matrix_parent_inverse = c.matrix_parent_inverse.copy()
    ang = spot["ang"]
    if math.cos(ang - first) < 0: ang += math.pi            # both facing the same way down the lane
    root.location = (spot["x"], spot["y"], 0); root.rotation_euler = (0, 0, ang)
    tanks.append(root)


def camera(look, dist, ortho):
    el, az = math.radians(37), math.radians(0)             # the sprites' angle: 37 degrees down, looking from +X
    loc = Vector(look) + Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))) * dist
    bpy.ops.object.camera_add(location=loc); cam = bpy.context.object
    cam.rotation_euler = (Vector(look) - loc).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"; cam.data.ortho_scale = ortho; cam.data.clip_end = 5000
    scene.camera = cam


if mode == "overview":
    camera((0, 0, 0), 900, N * 1.05)
else:
    t = tanks[0].location; t2 = tanks[-1].location
    camera(((t.x + t2.x) / 2, (t.y + t2.y) / 2, 0), 400, 150)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
