"""
Renders the Sherman. Usage:
  python render.py hero  OUT.png [samples] [width height]     a low, cinematic three-quarter shot
  python render.py sprites OUTDIR [samples] [size]            game sprites: 16 headings, isometric
  python render.py field OUT.png [samples]                    two tanks on a Normandy lane, game camera
"""
import bpy, math, sys, os, random
from mathutils import Vector

args = sys.argv[1:]
mode, out = args[0], os.path.abspath(args[1])
samples = int(args[2]) if len(args) > 2 else 64
here = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("MODEL", "sherman")   # or "stug"
bpy.ops.wm.open_mainfile(filepath=os.path.join(here, MODEL + ".blend"))
scene = bpy.context.scene
tank = bpy.data.objects["StuG" if MODEL == "stug" else "Sherman"]

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.35


def node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        n.inputs[k].default_value = v
    return n


# ---------------------------------------------------------------- sky and sun: overcast, smoky, late afternoon
world = bpy.data.worlds.new("sky"); scene.world = world; world.use_nodes = True
wn = world.node_tree; bg = wn.nodes["Background"]
bg.inputs["Color"].default_value = (0.40, 0.42, 0.45, 1); bg.inputs["Strength"].default_value = 0.55
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(68), math.radians(0), math.radians(-115)))
sun = bpy.context.object; sun.data.energy = 4.2; sun.data.color = (1.0, 0.82, 0.62); sun.data.angle = math.radians(4)


# ---------------------------------------------------------------- ground: wet churned mud with tyre ruts and grass at the edges
def ground(size=60, lane=True):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.object; g.name = "ground"
    sub = g.modifiers.new("sub", "SUBSURF"); sub.subdivision_type = "SIMPLE"; sub.levels = 7; sub.render_levels = 8
    mat = bpy.data.materials.new("mud"); mat.use_nodes = True; nt = mat.node_tree; L = nt.links
    bsdf = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    big = node(nt, "ShaderNodeTexNoise", Scale=0.35, Detail=8.0); L.new(coord.outputs["Object"], big.inputs["Vector"])
    mid = node(nt, "ShaderNodeTexNoise", Scale=3.0, Detail=12.0); L.new(coord.outputs["Object"], mid.inputs["Vector"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 6.0; L.new(coord.outputs["Object"], vor.inputs["Vector"])
    # lane mask: a band along X, plus two ruts where the tracks run
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); L.new(coord.outputs["Object"], sep.inputs[0])
    wob = nt.nodes.new("ShaderNodeMath"); wob.operation = "MULTIPLY_ADD"; L.new(big.outputs["Fac"], wob.inputs[0]); wob.inputs[1].default_value = 3.0; L.new(sep.outputs["Y"], wob.inputs[2])
    ab = nt.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"; L.new(wob.outputs[0], ab.inputs[0])
    lanem = nt.nodes.new("ShaderNodeMapRange"); L.new(ab.outputs[0], lanem.inputs["Value"]); lanem.inputs[1].default_value = 4.8; lanem.inputs[2].default_value = 2.2
    if not lane:
        lanem.inputs[1].default_value = 999; lanem.inputs[2].default_value = 998
    rut = nt.nodes.new("ShaderNodeMath"); rut.operation = "PINGPONG"; L.new(wob.outputs[0], rut.inputs[0]); rut.inputs[1].default_value = 1.2
    rutm = nt.nodes.new("ShaderNodeMapRange"); L.new(rut.outputs[0], rutm.inputs["Value"]); rutm.inputs[1].default_value = 0.0; rutm.inputs[2].default_value = 0.35
    # colours
    def mixc(fac, a, b):
        m = nt.nodes.new("ShaderNodeMix"); m.data_type = "RGBA"
        L.new(fac, [s for s in m.inputs if s.identifier == "Factor_Float"][0])
        for ident, v in (("A_Color", a), ("B_Color", b)):
            sk = [s for s in m.inputs if s.identifier == ident][0]
            if isinstance(v, tuple): sk.default_value = v
            else: L.new(v, sk)
        return m.outputs[2]
    grass = mixc(mid.outputs["Fac"], (0.10, 0.12, 0.04, 1), (0.20, 0.20, 0.08, 1))
    mud = mixc(vor.outputs["Distance"], (0.07, 0.05, 0.03, 1), (0.17, 0.13, 0.08, 1))
    col = mixc(lanem.outputs[0], grass, mud)
    puddle = nt.nodes.new("ShaderNodeMapRange"); L.new(mid.outputs["Fac"], puddle.inputs["Value"]); puddle.inputs[1].default_value = 0.62; puddle.inputs[2].default_value = 0.68
    pm = nt.nodes.new("ShaderNodeMath"); pm.operation = "MULTIPLY"; L.new(puddle.outputs[0], pm.inputs[0]); L.new(lanem.outputs[0], pm.inputs[1])
    col = mixc(pm.outputs[0], col, (0.05, 0.045, 0.035, 1))
    L.new(col, bsdf.inputs["Base Color"])
    rough = nt.nodes.new("ShaderNodeMapRange"); L.new(pm.outputs[0], rough.inputs["Value"]); rough.inputs[3].default_value = 0.92; rough.inputs[4].default_value = 0.3
    L.new(rough.outputs[0], bsdf.inputs["Roughness"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    # height: ruts, lumps of churned mud, grass tussocks
    h = nt.nodes.new("ShaderNodeMath"); h.operation = "MULTIPLY"; L.new(rutm.outputs[0], h.inputs[0]); L.new(lanem.outputs[0], h.inputs[1])
    h2 = nt.nodes.new("ShaderNodeMath"); h2.operation = "MULTIPLY_ADD"; L.new(mid.outputs["Fac"], h2.inputs[0]); h2.inputs[1].default_value = 0.6; L.new(h.outputs[0], h2.inputs[2])
    disp = nt.nodes.new("ShaderNodeDisplacement"); disp.inputs["Scale"].default_value = 0.16; disp.inputs["Midlevel"].default_value = 0.3
    L.new(h2.outputs[0], disp.inputs["Height"]); L.new(disp.outputs[0], nt.nodes["Material Output"].inputs["Displacement"])
    try: mat.displacement_method = "BOTH"
    except Exception: pass
    g.data.materials.append(mat)
    return g


def camera(loc, look, lens=35, ortho=None):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    d = Vector(look) - Vector(loc); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"; cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    scene.camera = cam
    return cam


def hedge(x0, y0, x1, y1, h=2.2, seed=1):
    random.seed(seed)
    mat = bpy.data.materials.get("hedge")
    if not mat:
        mat = bpy.data.materials.new("hedge"); mat.use_nodes = True; nt = mat.node_tree; b = nt.nodes["Principled BSDF"]
        n = node(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=10.0)
        ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.color_ramp.elements[0].color = (0.015, 0.025, 0.008, 1); ramp.color_ramp.elements[1].color = (0.09, 0.12, 0.035, 1)
        nt.links.new(n.outputs["Fac"], ramp.inputs[0]); nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.8
        bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.9; nt.links.new(n.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs[0], b.inputs["Normal"])
    n = int(math.hypot(x1 - x0, y1 - y0) / 0.9)
    for i in range(n):
        t = i / max(1, n - 1)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=random.uniform(0.9, 1.5), location=(x0 + (x1 - x0) * t + random.uniform(-.3, .3), y0 + (y1 - y0) * t + random.uniform(-.4, .4), h * random.uniform(0.35, 0.55)))
        o = bpy.context.object; o.scale = (1, 1, random.uniform(0.8, 1.2))
        d = o.modifiers.new("d", "DISPLACE"); tex = bpy.data.textures.new("leaf", "CLOUDS"); tex.noise_scale = 0.18; tex.noise_depth = 4; d.texture = tex; d.strength = 0.9
        o.data.materials.append(mat)
        for p in o.data.polygons: p.use_smooth = True


if mode == "hero":
    w, h = (int(args[3]), int(args[4])) if len(args) > 4 else (1920, 1080)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    ground(80)
    tank.rotation_euler = (0, 0, math.radians(-18))
    hedge(-22, 9, 22, 8, seed=2); hedge(-22, -10, 22, -9.5, seed=3)
    cam = camera((7.2, 5.0, 0.85), (0.9, -0.2, 1.55), lens=28)
    cam.data.dof.use_dof = True; cam.data.dof.focus_distance = 7.6; cam.data.dof.aperture_fstop = 5.6
    # haze: a thin volume in a box around the scene, so distance falls back into grey smoke
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 6)); hz = bpy.context.object; hz.scale = (70, 70, 12)
    hm = bpy.data.materials.new("haze"); hm.use_nodes = True; hnt = hm.node_tree
    hnt.nodes.remove(hnt.nodes["Principled BSDF"]); pv = hnt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Density"].default_value = 0.006; pv.inputs["Color"].default_value = (0.8, 0.78, 0.74, 1)
    hnt.links.new(pv.outputs[0], hnt.nodes["Material Output"].inputs["Volume"]); hz.data.materials.append(hm)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)

elif mode == "sprites":
    size = int(args[3]) if len(args) > 3 else 384
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = True
    bpy.ops.mesh.primitive_plane_add(size=40); g = bpy.context.object; g.is_shadow_catcher = True   # flat: only the shadow shows
    cam = camera((14.0, 0, 11.4), (0, 0, 0.9), ortho=8.6)            # 39 degrees down, like Blitzkrieg's view
    os.makedirs(out, exist_ok=True)
    for k in range(16):
        tank.rotation_euler = (0, 0, k * math.pi / 8)
        scene.render.filepath = os.path.join(out, MODEL + "_%02d.png" % k)
        bpy.ops.render.render(write_still=True)

elif mode == "field":
    scene.render.resolution_x, scene.render.resolution_y = (1920, 1080)
    ground(90)
    tank.rotation_euler = (0, 0, math.radians(8)); tank.location = (-3.0, -0.6, 0)
    hedge(-40, 7.5, 40, 6.5, seed=5); hedge(-40, -8.5, 40, -7.8, seed=6); hedge(9, -8, 13, -30, seed=7); hedge(-14, 7, -18, 30, seed=8)
    # a second tank further up the lane, from a linked copy
    t2 = tank.copy(); scene.collection.objects.link(t2)
    for c in tank.children:
        cc = c.copy(); scene.collection.objects.link(cc); cc.parent = t2; cc.matrix_parent_inverse = c.matrix_parent_inverse.copy()
    t2.location = (-12.5, 0.9, 0); t2.rotation_euler = (0, 0, math.radians(-4))
    camera((16.0, -15.0, 22.0), (-4.0, 0.0, 0.0), ortho=34)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
