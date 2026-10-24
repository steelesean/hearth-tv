"""
A German rifleman, Normandy 1944, built and animated in Blender, rendered as game sprites.
Feldgrau M43-style tunic and trousers, M35 helmet, marching boots, belt and Y-straps, K98 pouches,
bread bag, canteen, ribbed gas-mask canister, entrenching tool and a Kar98k.

The body is a chain of joints (empties); each part hangs off one, so poses are just joint angles.
  python soldier.py OUTDIR [samples]   ->  OUTDIR/rifle_<pose>_<dir>.png, 8 directions
Poses: idle, walk0..walk5, aim, fire.  Same camera angle, scale and sun as the Sherman's sprites.
"""
import bpy, math, os, sys
from mathutils import Vector

out = os.path.abspath(sys.argv[1]); samples = int(sys.argv[2]) if len(sys.argv) > 2 else 32
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- materials
def mat(name, rgb, rough=0.8, metal=0.0, noise=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if noise:
        n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 40; n.inputs["Detail"].default_value = 6
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"
        nt.links.new(n.outputs["Fac"], [s for s in mx.inputs if s.identifier == "Factor_Float"][0])
        [s for s in mx.inputs if s.identifier == "A_Color"][0].default_value = tuple(c * (1 - noise) for c in rgb) + (1,)
        [s for s in mx.inputs if s.identifier == "B_Color"][0].default_value = tuple(min(1, c * (1 + noise)) for c in rgb) + (1,)
        nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    else:
        b.inputs["Base Color"].default_value = rgb + (1,)
    return m


FELDGRAU = mat("feldgrau", (0.060, 0.066, 0.050), noise=0.35)
TROUSERS = mat("trousers", (0.052, 0.056, 0.045), noise=0.3)
HELMET = mat("helmet", (0.045, 0.050, 0.040), rough=0.55, metal=0.3, noise=0.25)
LEATHER = mat("leather", (0.012, 0.010, 0.008), rough=0.5)
BOOTS = mat("boots", (0.015, 0.012, 0.010), rough=0.45)
SKIN = mat("skin", (0.42, 0.24, 0.16), rough=0.6)
CANVAS = mat("bread bag", (0.11, 0.10, 0.07), noise=0.3)
STEEL = mat("steel", (0.05, 0.05, 0.05), rough=0.4, metal=0.8)
WOOD = mat("rifle wood", (0.16, 0.08, 0.035), rough=0.55)
FLASH = bpy.data.materials.new("muzzle flash"); FLASH.use_nodes = True
fn = FLASH.node_tree.nodes; fe = fn.new("ShaderNodeEmission"); fe.inputs["Color"].default_value = (1.0, 0.75, 0.35, 1); fe.inputs["Strength"].default_value = 30
FLASH.node_tree.links.new(fe.outputs[0], fn["Material Output"].inputs["Surface"])


# ---------------------------------------------------------------- building blocks
def joint(name, parent, loc):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    e.parent = parent; e.location = loc; e.empty_display_size = 0.05
    return e


def part(kind, parent, loc, size, material, rot=(0, 0, 0), sub=1, verts=16):
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1, vertices=verts)
    else:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, segments=24, ring_count=12)
    o = bpy.context.object
    o.scale = size; bpy.ops.object.transform_apply(scale=True)
    o.parent = parent; o.location = loc; o.rotation_euler = rot
    if sub and kind != "sphere":
        bv = o.modifiers.new("b", "BEVEL"); bv.width = min(size) * 0.3; bv.segments = 2
    for p in o.data.polygons: p.use_smooth = True
    o.data.materials.append(material)
    return o


# ---------------------------------------------------------------- the skeleton: X forward, Z up, metres
root = bpy.data.objects.new("Soldier", None); scene.collection.objects.link(root)
pelvis = joint("pelvis", root, (0, 0, 0.95))
spine = joint("spine", pelvis, (0, 0, 0.08))
neck = joint("neck", spine, (0, 0, 0.52))
legs, arms = {}, {}
for s, side in ((1, "L"), (-1, "R")):
    hip = joint("hip" + side, pelvis, (0, s * 0.10, -0.02))
    knee = joint("knee" + side, hip, (0, 0, -0.44))
    ankle = joint("ankle" + side, knee, (0, 0, -0.44))
    legs[side] = (hip, knee, ankle)
    sh = joint("shoulder" + side, spine, (0, s * 0.21, 0.44))
    el = joint("elbow" + side, sh, (0, 0, -0.29))
    wr = joint("wrist" + side, el, (0, 0, -0.27))
    arms[side] = (sh, el, wr)

# ---------------------------------------------------------------- the body and kit
part("box", pelvis, (0, 0, 0.02), (0.22, 0.34, 0.18), TROUSERS)
part("box", spine, (0, 0, 0.24), (0.24, 0.40, 0.56), FELDGRAU)                 # tunic
part("box", spine, (0, 0, 0.50), (0.20, 0.30, 0.08), FELDGRAU)                 # collar line
part("box", spine, (0.0, 0, 0.0), (0.26, 0.42, 0.06), LEATHER)                 # belt
for s in (1, -1):
    part("box", spine, (0.125, s * 0.07, 0.25), (0.012, 0.03, 0.50), LEATHER, rot=(s * 0.12, 0, 0), sub=0)   # Y-straps
    part("box", spine, (-0.125, s * 0.07, 0.25), (0.012, 0.03, 0.50), LEATHER, rot=(-s * 0.12, 0, 0), sub=0)
    for k in range(3):
        part("box", spine, (0.14, s * (0.07 + k * 0.055), 0.03), (0.05, 0.05, 0.08), LEATHER)               # cartridge pouches
part("box", spine, (-0.04, -0.20, -0.03), (0.16, 0.08, 0.14), CANVAS)          # bread bag on the right hip
part("cyl", spine, (-0.09, -0.21, 0.02), (0.08, 0.08, 0.15), FELDGRAU)         # canteen
gm = part("cyl", spine, (-0.18, 0.04, 0.02), (0.11, 0.11, 0.26), FELDGRAU, verts=24)   # gas-mask canister
for k in range(5):
    part("cyl", spine, (-0.18, 0.04, -0.08 + k * 0.05), (0.118, 0.118, 0.012), FELDGRAU, verts=24, sub=0)
part("box", spine, (-0.15, 0.17, -0.02), (0.06, 0.12, 0.22), LEATHER)          # entrenching tool carrier
part("cyl", neck, (0, 0, 0.04), (0.10, 0.10, 0.10), SKIN)                      # neck
part("sphere", neck, (0.01, 0, 0.16), (0.19, 0.17, 0.22), SKIN)                # head
# M35 helmet: dome plus the flared skirt that gives the German silhouette
part("sphere", neck, (-0.005, 0, 0.21), (0.27, 0.25, 0.22), HELMET)
bpy.ops.mesh.primitive_cone_add(radius1=0.165, radius2=0.12, depth=0.08, vertices=32)
skirt = bpy.context.object; skirt.parent = neck; skirt.location = (-0.01, 0, 0.145); skirt.scale = (1.06, 1.0, 1.0)
skirt.data.materials.append(HELMET); [setattr(p, "use_smooth", True) for p in skirt.data.polygons]
for s, side in ((1, "L"), (-1, "R")):
    hip, knee, ankle = legs[side]
    part("box", hip, (0, 0, -0.22), (0.15, 0.15, 0.46), TROUSERS)
    part("box", knee, (0, 0, -0.23), (0.12, 0.12, 0.44), BOOTS)                # marching boots to mid-calf
    part("box", knee, (0, 0, -0.04), (0.13, 0.13, 0.08), TROUSERS)
    part("box", ankle, (0.05, 0, -0.03), (0.26, 0.11, 0.07), BOOTS)
    sh, el, wr = arms[side]
    part("box", sh, (0, 0, -0.14), (0.10, 0.10, 0.30), FELDGRAU)
    part("box", el, (0, 0, -0.13), (0.09, 0.09, 0.28), FELDGRAU)
    part("sphere", wr, (0, 0, -0.04), (0.08, 0.07, 0.09), SKIN)

# Kar98k, held across the body; it hangs off the right wrist so it follows the arms.
rifle = joint("rifle", arms["R"][2], (0.0, 0.0, -0.05))
part("box", rifle, (0.10, 0, 0), (0.80, 0.04, 0.06), WOOD)                     # stock and fore-end
part("box", rifle, (-0.33, 0, -0.03), (0.22, 0.045, 0.11), WOOD)               # butt
part("cyl", rifle, (0.55, 0, 0.025), (0.018, 0.018, 0.55), STEEL, rot=(0, math.pi / 2, 0), sub=0)   # barrel
part("cyl", rifle, (0.02, 0.03, 0.045), (0.012, 0.012, 0.06), STEEL, rot=(math.pi / 2, 0, 0), sub=0) # bolt handle
flash = part("sphere", rifle, (0.88, 0, 0.025), (0.22, 0.12, 0.12), FLASH)
flash.hide_render = True


# ---------------------------------------------------------------- poses
def rot(o, x=0.0, y=0.0, z=0.0):
    o.rotation_euler = (x, y, z)


def pose(name, t=0.0):
    flash.hide_render = name != "fire"
    for o in [pelvis, spine, neck] + [j for v in legs.values() for j in v] + [j for v in arms.values() for j in v] + [rifle]:
        o.rotation_euler = (0, 0, 0)
    pelvis.location = (0, 0, 0.95)
    if name.startswith("walk"):
        ph = t * 2 * math.pi
        for s, side in ((1, "L"), (-1, "R")):
            hip, knee, ankle = legs[side]
            sw = math.sin(ph + (0 if s > 0 else math.pi))
            rot(hip, y=-0.45 * sw)                                         # thigh swing
            rot(knee, y=0.15 + 0.55 * max(0.0, math.cos(ph + (0 if s > 0 else math.pi))))   # knee bends on the recovery
            rot(ankle, y=0.2 * sw)
        pelvis.location = (0, 0, 0.95 - 0.03 * abs(math.cos(ph)))
        rot(spine, y=0.12)                                                 # leaning into the advance
    if name in ("aim", "fire"):
        # rifle shouldered: kneel-less standing aim, left hand forward under the fore-end
        rot(spine, y=0.06)
        rot(arms["R"][0], y=-1.25, x=0.25); rot(arms["R"][1], y=-1.2)
        rot(arms["L"][0], y=-1.45, x=-0.35); rot(arms["L"][1], y=-0.35)
        rot(rifle, y=1.25 + 1.2, x=-0.25, z=0.0)       # undo the arm's swing so the rifle lies level, pointing forward
        rifle.location = (0.0, 0.0, -0.05)
        if name == "fire":
            rot(spine, y=0.0)                                              # recoil rocks him back
    else:
        # port arms: rifle diagonal across the chest
        rot(arms["R"][0], y=-0.55, x=0.15); rot(arms["R"][1], y=-1.35)
        rot(arms["L"][0], y=-0.9, x=-0.35); rot(arms["L"][1], y=-1.25)
        rot(rifle, x=0.0, y=-0.95, z=0.35)


# ---------------------------------------------------------------- render setup: matches the Sherman sprites
scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = samples; scene.cycles.use_denoising = True
scene.view_settings.view_transform = "AgX"; scene.view_settings.look = "AgX - Medium High Contrast"; scene.view_settings.exposure = -0.35
scene.render.film_transparent = True
world = bpy.data.worlds.new("sky"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.40, 0.42, 0.45, 1); world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(68), 0, math.radians(-115)))
sun = bpy.context.object; sun.data.energy = 4.2; sun.data.color = (1.0, 0.82, 0.62); sun.data.angle = math.radians(4)
bpy.ops.mesh.primitive_plane_add(size=20); bpy.context.object.is_shadow_catcher = True
PX = 0.0224                                   # metres per pixel, the same as the tank sprites
SIZE = 128
scene.render.resolution_x = scene.render.resolution_y = SIZE
look = Vector((0, 0, 0.75)); el = math.radians(37)
loc = look + Vector((math.cos(el), 0, math.sin(el))) * 12
bpy.ops.object.camera_add(location=loc); cam = bpy.context.object
cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
cam.data.type = "ORTHO"; cam.data.ortho_scale = PX * SIZE; scene.camera = cam

if len(sys.argv) > 3 and sys.argv[3] == "debug":
    # a close look at the poses, larger and from a lower angle
    scene.render.resolution_x, scene.render.resolution_y = 1200, 600
    cam.data.ortho_scale = 3.2
    look = Vector((0, 0, 0.9)); loc = look + Vector((math.cos(0.35) * math.cos(0.9), math.cos(0.35) * math.sin(0.9), math.sin(0.35))) * 12
    cam.location = loc; cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
    for name, t in (("idle", 0), ("walk1", 1 / 6), ("walk4", 4 / 6), ("aim", 0), ("fire", 0)):
        pose(name, t); bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out, "debug_%s.png" % name); bpy.ops.render.render(write_still=True)
    sys.exit(0)
poses = [("idle", 0)] + [("walk%d" % i, i / 6) for i in range(6)] + [("aim", 0), ("fire", 0)]
for d in range(8):
    root.rotation_euler = (0, 0, d * math.pi / 4)
    for name, t in poses:
        pose(name, t)
        bpy.context.view_layer.update()
        scene.render.filepath = os.path.join(out, "rifle_%s_%d.png" % (name, d))
        bpy.ops.render.render(write_still=True)
print("done")
