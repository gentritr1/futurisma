"""Dream Island phase B — the painted world.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python \
      art/blender/build_dreamisland_painted.py

Reads `src/game/data/dreamisland/route.json` (never edits it) and
`public/assets/dreamisland/atlas-manifest.json`, authors every focal asset on
the six painted atlas roles plus the magenta-key card sheet, lays them out along
the accepted route, batches the statics by material and writes:

    public/assets/dreamisland/painted.glb
    public/assets/dreamisland/painted.json
    public/assets/dreamisland/signage-manifest.json

Structure mirrors `art/blender/build_ascension_painted.py`: one `Asset` per
focal asset, `save(asset, features)` records EXACTLY five named silhouette
features per asset, `place()` copies an asset into the world and records the
placement, and the final pass merges every static mesh by material so the whole
island costs one draw per role.

MAQUETTES: none. `docs/briefs/DREAM-ISLAND-LEVEL.md` §7 supersedes the concept
doc's maquette line - the two orthographic sheets (`s5_clock_tower_ortho.png`,
`s6_watchtower_ortho.png`) are better modelling reference than a normalised
Tripo lift. `painted.json` therefore carries `maquettes: []` and asserts
`maquettesRemovedBeforeWorldExport: true`, and the script asserts no object
named for one ever existed.

TARGET METRES are named per asset in `TARGETS` below, measured off the exported
bounds and written into `painted.json`, because "model from the sheet" without a
metre target is exactly how the Tideline gantry drifted.
"""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).parent))
from dreamisland_mesh import Asset,coord,empty,triangles

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/assets/dreamisland'
# Polish writes its own build record; earlier phase evidence remains untouched,
# because a later revision overwriting an earlier phase's evidence is the
# residual this directory split exists to close.
EVIDENCE=ROOT/'art/evidence/dreamisland-v1/polish/build'
EVIDENCE.mkdir(parents=True,exist_ok=True)
route=json.loads((ROOT/'src/game/data/dreamisland/route.json').read_text())
atlas=json.loads((OUT/'atlas-manifest.json').read_text())
LENGTH=route['length'];COUNT=route['count']

# --- Atlas rects, taken from the manifest so geometry and manifest cannot drift.
rects={}
for role,cells in atlas['roles'].items():
 rects[role]={}
 for cell,entry in cells.items():
  if 'plate' in entry:rects[role][cell]=entry['plate']['uv']
  elif 'sprite' in entry:rects[role][cell]=entry['sprite']['uv']
  else:rects[role][cell]=entry['uv']
for digit in atlas['roles']['signage']['plate-gate-numbers']['plate']['digits']:
 rects['signage']['plate-gate-'+str(digit['digit'])]=digit['uv']
LETTERING=atlas['roles']['signage']

# --- Six painted roles plus the keyed card sheet.
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
ROLES=['concrete','metal','jungle','water','signage','emissive']
materials={}
for role in ROLES+['jungle-card']:
 source=OUT/'jungle-card.png' if role=='jungle-card' else OUT/'textures'/(role+'.jpg')
 material=bpy.data.materials.new('DI_MAT_'+role);material.use_nodes=True
 shader=material.node_tree.nodes.get('Principled BSDF')
 shader.inputs['Roughness'].default_value=1;shader.inputs['Metallic'].default_value=0
 texture=material.node_tree.nodes.new('ShaderNodeTexImage')
 texture.image=bpy.data.images.load(str(source));texture.image.pack()
 colour=material.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Color'
 multiply=material.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY'
 multiply.inputs[0].default_value=1
 material.node_tree.links.new(texture.outputs['Color'],multiply.inputs[1])
 material.node_tree.links.new(colour.outputs['Color'],multiply.inputs[2])
 material.node_tree.links.new(multiply.outputs[0],shader.inputs['Base Color'])
 if role=='emissive':
  material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Emission Color'])
  shader.inputs['Emission Strength'].default_value=.7
 materials[role]=material

library={};details={};placements=[];signs=[];measured={}
# Target metres, named BEFORE modelling. The measured bounds land beside them in
# painted.json, because "model from the sheet" with no metre target is exactly
# how the Tideline gantry drifted in scale and had to be recalibrated.
TARGETS={
 'clock-tower':{'heightMetres':14.,'plinthMetres':8.,'source':'sheets/s5_clock_tower_ortho.png'},
 'watchtower-ruin':{'heightMetres':24.,'widthMetres':16.,'boreWidthMetres':14.,'boreHeightMetres':8.,
  'boreDepthMetres':16.,'source':'sheets/s6_watchtower_ortho.png'},
 'waterfall-cliff':{'dropMetres':16.},
 'palm-upright':{'heightMetres':8.6},'palm-lean':{'heightMetres':7.2},'palm-tall':{'heightMetres':11.},
 'undergrowth-card-set':{'heightMetres':2.1},
 'goldfish-orange':{'lengthMetres':6.6,'maximumTriangles':200},
 'goldfish-white':{'lengthMetres':6.6,'maximumTriangles':200},
 'goldfish-red':{'lengthMetres':6.6,'maximumTriangles':200},
 'goldfish-gold':{'lengthMetres':6.6,'maximumTriangles':200},
 'stone-causeway-module':{'roadLengthMetres':20.},
 'reef-pier-module':{'roadLengthMetres':26.},
 'sea-stack':{'heightMetres':24.,'placedRangeMetres':[18.,40.]},
 'mossy-block-wall-module':{'lengthMetres':12.,'blockMetres':[2.,3.]},
 'gate-furniture':{'lampHeightMetres':5.2},
 'sand-verge':{'widthMetres':17.,'skipSectors':['BASIN','REEF']},
 'signage-plates':{'letterCapMetres':.59},
}
def bounds(root):
 points=[(o.matrix_local@v.co) for o in root.children_recursive if o.type=='MESH' for v in o.data.vertices]
 if not points:return None
 low=[min(p[i] for p in points) for i in range(3)];high=[max(p[i] for p in points) for i in range(3)]
 # Blender is Z-up here: X is the game's X, Y is the game's -Z, Z is the game's Y.
 return {'widthMetres':round(high[0]-low[0],3),'depthMetres':round(high[1]-low[1],3),
  'heightMetres':round(high[2]-low[2],3),'baseMetres':round(low[2],3),'topMetres':round(high[2],3)}
def save(asset,features):
 assert len(features)==5,asset.root.name+' must record exactly five silhouette features'
 root=asset.finish();library[asset.root.name]=root;details[asset.root.name]=features
 measured[asset.root.name]={'target':TARGETS.get(asset.root.name,{}),'measured':bounds(root),
  'triangles':triangles(root)}
 return root

MOSS=(.62,.80,.52,1);IVY=(.48,.72,.44,1);DARK=(.18,.20,.20,1)

# --------------------------------------------------------------------------
# Focal assets. Every metre below is the target the brief names, and the
# measured bounds go into painted.json beside it.
# --------------------------------------------------------------------------

# 1. Clock tower: 14 m tall on an 8 m square stepped plinth, from s5.
a=Asset('clock-tower',materials,rects)
for width,height,base in [(8,.5,0),(7.1,.5,.5),(6.2,.6,1.)]:
 a.box((0,base+height/2,0),(width,height,width),'concrete','causeway-paving')
 a.grid((0,base+height,0),width,width,'concrete','causeway-paving',metres=2.6)
a.tint=MOSS;a.box((0,5.9,0),(4.4,8.6,4.4),'concrete','wall-block');a.tint=(1,1,1,1)
a.stair((0,1.6,0),2.9,7.4,.85,13,'concrete','causeway-paving',tread=1.15,parapet=.45)
# Roof: a four-sided pitch to 12.6 m, then the finial to the 14 m target.
apex=(0,12.6,0);eave=2.7
corners=[(-eave,10.2,-eave),(eave,10.2,-eave),(eave,10.2,eave),(-eave,10.2,eave)]
for index in range(4):
 a.geometry([corners[index],corners[(index+1)%4],apex],[(0,1,2)],'concrete','wall-block')
a.cylinder((0,13.3,0),.34,1.4,'metal','rail',sides=8)
a.cylinder((0,13.75,0),.16,.5,'metal','rail',sides=6)
# The face, its bronze ring and two plain hands, on the road side (-Z).
a.cylinder((0,8.4,-2.24),1.45,.14,'emissive','clock-face',sides=16,axis=(0,0,1),tile=1)
a.cylinder((0,8.4,-2.32),1.72,.16,'metal','clock-ring-hands',sides=16,axis=(0,0,1),caps=False,tile=1)
a.box((0,8.85,-2.36),(.14,1.05,.09),'metal','clock-ring-hands',tile=1)
a.box((.42,8.4,-2.36),(.95,.13,.09),'metal','clock-ring-hands',tile=1)
save(a,['stepped plinth','square mossy shaft','round white face with two plain hands',
 'pitched roof with finial','winding side stair with parapet'])

# 2. Watchtower ruin: 24 m tall, 16 m across, 14 x 8 m bore through 16 m of depth.
a=Asset('watchtower-ruin',materials,rects)
for side in (-1,1):
 a.box((side*7.5,4,0),(1,8,16),'concrete','wall-block')          # bore pier
 a.box((side*7.85,4,0),(.3,8,15.2),'jungle','moss-blossom')      # ivy lower third
 # The ivy shoulder sits ON the bore pier, never over it: the bore is 14 m wide
 # and the corridor probe fails on anything inside +/-7 m below 7.4 m.
 a.tint=IVY;a.box((side*7.8,7.6,0),(.4,.8,15.6),'jungle','moss-blossom');a.tint=(1,1,1,1)
a.box((0,8.4,0),(16,.8,16),'concrete','wall-block')              # bore lintel
for course_index in range(4):
 low=8.4+course_index*3.05;radius=8-course_index*.35
 a.cylinder((0,low+1.525,0),radius,3.05,'concrete','wall-block',sides=14,top_radius=radius-.35,caps=course_index==3)
a.merlons((0,20.6,0),6.6,3.4,12,{2,3,9},'concrete','wall-block')
# Two arched windows: dark recesses in the drum, with a rounded head.
for side in (-1,1):
 a.tint=DARK
 a.box((side*3.1,14.4,-6.9),(1.9,3.2,.5),'concrete','wall-block',tile=1)
 a.cylinder((side*3.1,16.0,-6.9),.95,.5,'concrete','wall-block',sides=10,axis=(0,0,1),tile=1)
 a.tint=(1,1,1,1)
# Two tunnel lamps on the pier faces, inside the bore.
for z in (-5,5):
 a.cylinder((-6.9,6.4,z),.55,.18,'emissive','lamp-disc',sides=10,axis=(1,0,0),tile=1)
save(a,['tapered drum','crenellations with three missing merlons','two arched windows',
 'through-tunnel','ivy lower third'])

# 3. Waterfall and its stacked block cliff: a 16 m drop.
a=Asset('waterfall-cliff',materials,rects)
for course_index in range(8):
 y=10-course_index*2;length=18-course_index*.7
 a.blocks((0,y-1,0),(7,2,0),length,'concrete','wall-block',block=2.8)
 a.tint=MOSS;a.grid((0,y,0),7,length,'jungle','moss-blossom',metres=2.8);a.tint=(1,1,1,1)
for x in (-6.4,1.2,6.8):                                          # block ledges
 a.box((x,2.4-abs(x)*.2,3.9),(3.2,.7,2.4),'concrete','wall-block')
for index in range(4):                                            # the white sheet
 a.card((-2.7+index*1.8,-6,3.62),1.9,16,'water','waterfall')
for angle in range(0,360,24):                                     # plunge-pool foam ring
 t=math.radians(angle)
 a.card((math.cos(t)*6.2,-6.1,3.62+math.sin(t)*6.2),2.2,1.1,'water','foam-gradient',yaw=t)
for x,z,scale in [(-8.2,3.7,1.),(7.9,3.7,.85),(-4.1,3.7,.7),(4.6,3.7,.8)]:
 a.crossed_cards((x,1.2-abs(x)*.18,z),2.6*scale,2.2*scale,'jungle-card','blossom-shrub')
save(a,['stacked block cliff','white sheet','plunge-pool foam ring','block ledges','blossom clumps'])

# 4. Palms: three trunk-lean variants between 7 and 11 m, from s2.
# (name, overall target height in metres, lean, frond count, coconuts). The
# trunk is the target MINUS the crown the fronds add, so the measured silhouette
# height is the target and not the target plus a crown.
CROWN=1.95
PALM=[('palm-upright',8.6,.0,9,False),('palm-lean',7.2,.30,7,True),('palm-tall',11.0,.16,11,False)]
for name,height,lean,fronds,coconuts in PALM:
 a=Asset(name,materials,rects)
 trunk=height-CROWN;segments=5
 for index in range(segments):
  low=trunk*index/segments;high=trunk*(index+1)/segments
  drift=lean*trunk*(index/segments)**1.6;drift_next=lean*trunk*((index+1)/segments)**1.6
  # Caps only at the two ends: 290 palms make the inner caps the single largest
  # triangle line item on the island.
  a.cylinder(((drift+drift_next)/2,(low+high)/2,0),.42-index*.036,high-low,'jungle','bark',
   sides=6,axis=(drift_next-drift,high-low,0),caps=index in (0,segments-1))
 top=Vector((lean*trunk,trunk,0))
 for index in range(fronds):
  angle=index*math.tau/fronds
  a.card((top.x+math.cos(angle)*1.35,top.y-.55,math.sin(angle)*1.35),3.4,CROWN+.55,'jungle-card','frond',yaw=angle)
 if coconuts:
  for index in range(4):
   angle=index*math.tau/4
   a.cylinder((top.x+math.cos(angle)*.42,top.y-.5,math.sin(angle)*.42),.24,.4,'jungle','bark',sides=6,tile=1)
 save(a,['segmented trunk','three lean variants','frond crown',
  'coconut cluster on one variant','double-sided cards drawn in one pass per batch'])

# 5. Understory card set: four kinds, anchored at the card's foot.
a=Asset('undergrowth-card-set',materials,rects)
a.crossed_cards((0,0,0),2.2,1.9,'jungle-card','fern')
a.crossed_cards((2.6,0,.7),2.6,2.1,'jungle-card','blossom-shrub')
a.leaf_clump((-2.4,0,.5),2.8,2.0,'jungle','leaf-fill',yaw=.5)
a.leaf_clump((-2.4,0,.5),2.8,2.0,'jungle','leaf-fill',yaw=.5+math.pi/2)
a.card((.9,0,-2.3),2.4,1.7,'jungle-card','frond',yaw=1.1)
save(a,['four card kinds','batched in one draw per material','anchor at card bottom',
 'verge placement','no card over the road'])

# 6. Goldfish: four liveries, chunky facets, under 200 triangles each.
LIVERIES=[('goldfish-orange',(1.0,.62,.24,1)),('goldfish-white',(1.0,.94,.86,1)),
 ('goldfish-red',(.94,.36,.26,1)),('goldfish-gold',(1.0,.82,.34,1))]
for name,livery in LIVERIES:
 a=Asset(name,materials,rects);a.tint=livery
 # Authored at 4.6 m and scaled to the 6.6 m target rather than re-typed: the
 # target was named before modelling and the model is what moves to meet it.
 a.scale=6.6/4.6
 a.cylinder((0,0,0),.95,2.6,'jungle','sand',sides=7,axis=(0,0,1),top_radius=.42,tile=1)
 a.cylinder((0,0,-1.9),.42,1.2,'jungle','sand',sides=7,axis=(0,0,1),top_radius=.1,tile=1)
 for sign in (-1,1):                                              # hard-edged fins
  a.geometry([(sign*.75,.15,.4),(sign*2.1,-.35,-.35),(sign*.7,-.35,-.7)],[(0,1,2)],'jungle','sand')
 a.geometry([(0,.9,.2),(0,2.0,-.9),(0,.55,-1.1)],[(0,1,2)],'jungle','sand')
 a.geometry([(0,-.3,-2.4),(0,1.05,-3.3),(0,-1.05,-3.3)],[(0,1,2)],'jungle','sand')
 a.tint=(.08,.07,.07,1)
 for sign in (-1,1):a.cylinder((sign*.7,.34,1.02),.19,.1,'jungle','sand',sides=8,axis=(0,0,1),tile=1)
 a.tint=(1,1,1,1)
 a.cylinder((0,-.72,-.2),.34,1.9,'emissive','shallows-glow',sides=6,axis=(0,0,1),tile=1)
 save(a,['chunky faceted body','painted round eye','four liveries','hard-edged fins',
  'at most 200 triangles'])

# 7. Stone causeway module: 20 m of road across the waterfall pool.
a=Asset('stone-causeway-module',materials,rects)
a.box((0,-.32,0),(24,.6,20),'concrete','causeway-paving')
a.grid((0,-.02,0),24,20,'concrete','causeway-paving',metres=2.9)  # paving deck
for side in (-1,1):
 a.blocks((side*11.4,.35,0),(1.2,1.4,0),20,'concrete','wall-block',block=2.5)  # low parapet
 a.beam((side*11.4,1.5,-10),(side*11.4,1.5,10),.16,'metal','rail')
 for z in (-6.5,0,6.5):
  a.box((side*11.4,-4.5,z),(2.2,8,2.6),'concrete','wall-block')   # piers into the pool
for side,z in ((-1,-5),(1,5)):
 a.cylinder((side*11.4,2.9,z),.15,2.6,'metal','gate-lamp-post',sides=8)
 a.cylinder((side*11.4,4.35,z),.34,.5,'emissive','lamp-disc',sides=8,tile=1)
save(a,['paving deck','low parapet','block piers into the pool','rail','lamp posts'])

# 8. Reef pier module: 26 m of low pier over the shallows.
a=Asset('reef-pier-module',materials,rects)
a.box((0,-.3,0),(29,.5,26),'concrete','road-sand')
a.grid((0,-.04,0),29,26,'concrete','road-sand',metres=6.5)        # flat pier deck
for index in range(8):
 a.geometry([(-1.2,-.02,-13+index*3.25),(1.2,-.02,-13+index*3.25),
  (1.2,-.02,-13+(index+1)*3.25),(-1.2,-.02,-13+(index+1)*3.25)],[(0,3,2,1)],
  'metal','chevron-strip',tile=1)                                 # chevron launch strip
for side in (-1,1):
 a.blocks((side*13.9,.05,0),(1.2,.5,0),26,'concrete','kerb-cyan',block=3.2)   # kerb both sides
 for z in (-9,0,9):
  a.cylinder((side*12.4,-3.6,z),.8,7,'concrete','wall-block',sides=8)  # piles below water
save(a,['flat pier deck','chevron launch strip','kerb both sides','pier piles visible below water',
 'no parapet: the shallows glow is the night edge cue'])

# 9. Sea stack: one tapered 24 m stack, scaled per placement between 18 and 40 m.
a=Asset('sea-stack',materials,rects)
a.cylinder((0,10,0),7.2,20,'concrete','wall-block',sides=9,top_radius=3.6)
a.cylinder((0,21.55,0),3.7,3.1,'concrete','wall-block',sides=9,top_radius=3.2)
a.tint=MOSS;a.cylinder((0,23.55,0),3.3,.9,'jungle','moss-blossom',sides=9,top_radius=2.6);a.tint=(1,1,1,1)
a.box((-4.6,4.5,2.2),(3.2,2.4,2.6),'concrete','wall-block')
a.box((4.3,12.0,-1.9),(2.6,2.0,2.2),'concrete','wall-block')
save(a,['tapered stack','block texture','moss cap','varied heights','silhouette against the sky'])

# 10. Mossy block wall module: 12 m of the cut's wall.
a=Asset('mossy-block-wall-module',materials,rects)
for level,(base,height,length) in enumerate([(0.,3.,12.),(3.,2.6,10.4),(5.6,2.2,8.6)]):
 a.blocks((0,base+height/2,0),(2.6-level*.3,height,0),length,'concrete','wall-block',block=2.6)
 a.tint=MOSS
 a.grid((0,base+height,0),2.6-level*.3,length,'jungle','moss-blossom',metres=2.6)
 a.tint=(1,1,1,1)
for z in (-4.2,.6,4.4):                                            # fern cards in the joints
 a.crossed_cards((1.3,2.9,z),1.6,1.3,'jungle-card','fern')
for z in (-2.4,3.1):                                               # blossoms in the joints
 a.crossed_cards((1.35,5.5,z),1.5,1.2,'jungle-card','blossom-shrub')
save(a,['2 to 3 m blocks','stepped stacking','moss tops','fern cards','blossoms in joints'])

# 11. Kerb, launch strip and gate furniture, with its signage plate.
a=Asset('gate-furniture',materials,rects)
a.box((0,.22,0),(.8,.44,7),'concrete','kerb-cyan')
a.box((0,.03,-3.2),(1.6,.06,3.2),'metal','chevron-strip')
a.cylinder((0,2.4,0),.17,4.8,'metal','gate-lamp-post',sides=8)
a.cylinder((0,4.9,0),.38,.62,'emissive','lamp-disc',sides=8,tile=1)
a.box((0,3.4,-.12),(1.4,.62,.07),'signage','plate-beach')
save(a,['cyan-striped kerb','chevron launch strip','gate post','caged lamp head','signage plate'])

# --------------------------------------------------------------------------
# The world: laid out from the accepted route, which is never edited here.
# --------------------------------------------------------------------------
world=empty('dreamisland_painted_world')
UP=Vector((0,1,0))
def station(u):return route['stations'][int(u*COUNT)%COUNT]
def frame(u):
 s=station(u);p=Vector(s['p']);t=Vector(s['t'])
 return p,t,t.cross(UP).normalized(),s
def beside(u,offset,rise=0.):
 p,t,right,s=frame(u);return p+right*offset+UP*rise
def yaw_at(u):
 _,t,_,_=frame(u);return math.atan2(-t.x,-t.z)
# --- Phase C. Four focal assets now ship as separate hero GLBs built by
# `art/blender/build_dreamisland_heroes.py` and loaded at runtime by
# `src/game/dreamisland-painted-environment.ts`. Their placements stay HERE and
# stay in `painted.json` - the placement list is the source of truth for where
# they stand - but their geometry is no longer copied into the batched world, or
# the island would carry both versions of every one of them. Each such placement
# is tagged `hero` with the GLB and, for the sea stacks, the named child of the
# set to instance and the scale that reproduces the height this layout was
# authored at.
HERO_GLB={'clock-tower':'clock-tower.glb','watchtower-ruin':'watchtower.glb',
 'waterfall-cliff':'waterfall-cliff.glb','sea-stack':'sea-stack-set.glb'}
# The hero set carries four stacks at exactly these heights; the painted layout
# asked for six heights via `scale` on one 24 m stack. Each placement takes the
# nearest hero silhouette and a scale that keeps the height the layout chose,
# so the reef horizon does not move when the silhouettes get better.
HERO_STACK_HEIGHTS={'sea_stack_18m':18.,'sea_stack_26m':26.,'sea_stack_32m':32.,'sea_stack_40m':40.}
SEA_STACK_AUTHORED_HEIGHT=24.
def hero_for(asset,scale):
 if asset not in HERO_GLB:return None
 record={'glb':'heroes/'+HERO_GLB[asset]}
 if asset=='sea-stack':
  wanted=SEA_STACK_AUTHORED_HEIGHT*scale
  child=min(HERO_STACK_HEIGHTS,key=lambda name:abs(HERO_STACK_HEIGHTS[name]-wanted))
  record.update({'child':child,'wantedHeightMetres':round(wanted,3),
   'childHeightMetres':HERO_STACK_HEIGHTS[child],
   'heroScale':round(wanted/HERO_STACK_HEIGHTS[child],5)})
 else:record['heroScale']=scale
 return record
def place(asset,position,yaw=0.,scale=1.,sector='BEACH',dynamic=False,group='STATIC'):
 hero=hero_for(asset,scale)
 if hero is not None:
  placements.append({'asset':asset,'position':[round(v,3) for v in position],'yaw':round(yaw,5),
   'scale':scale,'sector':sector,'dynamic':dynamic,'batch':'HERO','hero':hero})
  return None
 source=library[asset];root=source.copy();root.name=asset+'_'+str(len(placements))
 bpy.context.collection.objects.link(root);root.parent=world
 root.location=coord(tuple(position));root.rotation_euler.z=yaw
 root.scale=(scale,scale,scale);root['sector']=sector;root['dynamic']=dynamic;root['batch']=group
 def copy_children(src,dst):
  for child in src.children:
   o=child.copy();bpy.context.collection.objects.link(o);o.parent=dst;copy_children(child,o)
 copy_children(source,root)
 placements.append({'asset':asset,'position':[round(v,3) for v in position],'yaw':round(yaw,5),
  'scale':scale,'sector':sector,'dynamic':dynamic,'batch':group})
 return root

def sector_at(u):return station(u)['sector']
def half_width(u):return station(u)['width']/2

# The watchtower straddles the road on the POINT centreline; the bore is the corner.
#
# PHASE C, MEASURED. The hero drum is 28.5 m DEEP, so the road passes through
# 28.5 m of a 137 m radius curve inside a bore that decision 5 fixed at 14 m -
# exactly the road's own width there. Over that depth the road's two edges sweep
# an envelope 14.778 m wide (measured off route.json in the bore's local frame),
# so a 14 m bore cannot contain it at ANY placement: the best centring anywhere
# in POINT still buries 0.39 m of road edge in masonry, and the flattest station
# in the district (.2975, curvature .0029) still misses by 0.112 m because bore
# width and road width are equal to begin with.
#
# The placement therefore carries two numbers that decision 5 did not:
#   BORE_LATERAL 0.38 m - the offset that centres the swept envelope in the bore
#                         (the road bows to ONE side of the tangent, so the
#                         correction is a shift, not a rotation: the best yaw
#                         correction measured 0.000 rad).
#   BORE_SCALE   1.10   - the smallest uniform scale in 0.02 steps that leaves a
#                         real margin. 1.06 is the first that clears at all and
#                         it clears by 22 mm, which is not a margin; 1.10 leaves
#                         0.302 m. A uniform scale keeps decision 5's rule that
#                         the opening take no more than half the footprint width
#                         (15.4 m of bore in a 30.8 m drum).
# This is a deliberate deviation from decision 5's literal metres and it is
# flagged in painted.json for review. `scripts/validate-dreamisland-painted.mjs`
# asserts the containment directly, because a vertical ray cannot see a road
# buried in a wall: with no floor or ceiling inside solid masonry there is
# nothing above the ray to hit.
BORE_U=.3375
BORE_LATERAL=.38
BORE_SCALE=1.10
p,t,right,s=frame(BORE_U)
place('watchtower-ruin',beside(BORE_U,BORE_LATERAL),yaw_at(BORE_U),scale=BORE_SCALE,sector='POINT')
# The clock tower stands off the inside of the Clock Court sweep, face to the road.
TOWER_U=.5345
place('clock-tower',beside(TOWER_U,26,-1.4),yaw_at(TOWER_U)+math.pi,sector='COURT',scale=18/14)
# The waterfall drops into the basin pool on the left of the causeway.
FALL_U=.4875
place('waterfall-cliff',beside(FALL_U,-46,-3.),yaw_at(FALL_U)-math.pi*.75,sector='BASIN')

# Causeway modules across the basin, pier modules over the reef shallows.
# Both runs stop one module short of their district's exit taper: the road grows
# from 20 m to 24 m over the 40 m either side of the BASIN/COURT seam, and a
# fixed-width parapet placed inside that taper puts stone in the corridor. The
# corridor validator caught exactly that at station 413.
for distance in range(950,1215,20):
 u=distance/LENGTH;place('stone-causeway-module',beside(u,0,-.1),yaw_at(u),sector='BASIN')
for distance in range(1585,2030,26):
 u=distance/LENGTH;place('reef-pier-module',beside(u,0,-.1),yaw_at(u),sector='REEF')
# Mossy block walls down both sides of the cut.
for distance in range(2046,2400,12):
 u=distance/LENGTH
 for side in (-1,1):
  place('mossy-block-wall-module',beside(u,side*(half_width(u)+3.4)),
   yaw_at(u),sector='CUT')
# Sea stacks on the reef horizon, four heights between 18 and 40 m.
for u,offset,scale in [(.68,150,.78),(.72,-190,1.65),(.76,210,1.1),(.80,-80,1.35),(.84,75,.95)]:
 place('sea-stack',beside(u,offset,-6),u*7.3,sector='REEF',scale=scale)
for u,offset,scale in [(.30,-130,1.2)]:
 place('sea-stack',beside(u,offset,-24),u*11.,sector='POINT',scale=scale)

# Palms: dense down the grove, sparser along the beach, none over the road.
PALM_NAMES=[name for name,_,_,_,_ in PALM]
for index,distance in enumerate(range(6,2400,17)):
 u=distance/LENGTH;sector=sector_at(u)
 if sector in ('BASIN','REEF'):continue
 density=2 if sector=='GROVE' else 1
 for side in (-1,1):
  for slot in range(density):
   # Leave a clear view of the face during the COURT-entry clock moment.
   if sector=='COURT' and side==1 and abs(u-TOWER_U)<.024:continue
   if sector=='GROVE':
    # The taller variants root in the raised bank. Their card feet stay above
    # the open corridor plus the additional two-metre canopy clearance.
    offset=side*(half_width(u)+3.2+slot*4.2)
    scale=.90+.05*((index+slot)%3)
    place('palm-tall',beside(u,offset,3.5),yaw_at(u)+(math.pi if side>0 else 0),sector=sector,scale=scale)
   else:
    offset=side*(half_width(u)+5.5+slot*6.2+(index%3)*1.7)
    place(PALM_NAMES[(index+slot+(0 if side<0 else 1))%3],beside(u,offset,-.2),
     (index*1.7+slot)%math.tau,sector=sector)
# Understory along every verge, always outside the kerb.
for index,distance in enumerate(range(12,2400,23)):
 u=distance/LENGTH;sector=sector_at(u)
 if sector=='REEF':continue
 for side in (-1,1):
  count=2 if sector in ('GROVE','CUT') else 1
  for slot in range(count):
   position=beside(u,side*(half_width(u)+4.8+slot*3.4),3.5 if sector=='GROVE' else -.15)
   if slot:position+=frame(u)[1]*8
   place('undergrowth-card-set',position,(index*2.3+slot*.9)%math.tau,sector=sector)

# The goldfish. Phase B placed eight in one batch, static and at rest. Phase C
# splits them into TWO named shoals, because decision 3's ambience is two
# authored closed paths - a figure-eight over the basin pool and a long loop over
# the reef shallows - and a single batch can only ever be moved as one body.
#
# Every resting position comes from `src/game/data/dreamisland/fish-paths.json`,
# which is also what `src/game/dreamisland-fish.ts` reads at runtime and what
# `scripts/validate-dreamisland-runtime.mjs` asserts against. One file: the
# geometry the world exports and the drift the runtime plays cannot disagree
# about where a shoal starts.
FISH_PATHS=json.loads((ROOT/'src/game/data/dreamisland/fish-paths.json').read_text())
for shoal in FISH_PATHS['shoals']:
 for fish in shoal['fish']:
  place(fish['livery'],beside(fish['progress'],fish['lateral'],fish['rise']),
   fish['yaw']%math.tau,sector=shoal['sector'],group=shoal['batch'])

# The sand verge. The road is otherwise a ribbon over open water and every palm
# and fern stands on nothing. It is authored as one route-following ribbon on the
# jungle sand quadrant and joins that material's batch, so it costs no draw. It
# is skipped where the road IS over water: the basin causeway and the reef pier.
verge=Asset('sand-verge',materials,rects);verge.metric=False
VERGE_STEP=4;VERGE_INNER=.9;VERGE_OUTER=17.;VERGE_TILE=6.
for index in range(0,COUNT,VERGE_STEP):
 u=index/COUNT;sector=sector_at(u)
 if sector in ('BASIN','REEF'):continue
 next_u=min(index+VERGE_STEP,COUNT)/COUNT
 p0,t0,r0,s0=frame(u);p1,t1,r1,s1=frame(next_u)
 for side in (-1,1):
  # Raised grove banks place the canopy over the road without low cards
  # crossing the corridor. Elsewhere the shore descends gently to the swell.
  bands=[(.9,-.15),(2.8,3.5),(9,3.5),(17,-.35)] if sector=='GROVE' else [(.9,-.15),(8.95,-.25),(17,-.35)]
  for (inner,inner_y),(outer,outer_y) in zip(bands,bands[1:]):
   corners=[p0+r0*(side*(s0['width']/2+inner))+UP*inner_y,
    p0+r0*(side*(s0['width']/2+outer))+UP*outer_y,
    p1+r1*(side*(s1['width']/2+outer))+UP*outer_y,
    p1+r1*(side*(s1['width']/2+inner))+UP*inner_y]
   order=(0,1,2,3) if side>0 else (3,2,1,0)
   verge.geometry([tuple(c) for c in corners],[order],'jungle','sand',tile=1)
save(verge,['continuous sand shoulder','two stepped bands falling away from the kerb',
 'skipped where the road is over water','one sand tile per band segment',
 'ground for the palms and the understory'])
place('sand-verge',(0,0,0),0.,sector='ALL')

# A short sand shoulder bridges the deck tint to the wider beach. It sits below
# the collision datum and joins the existing concrete batch.
shoulder=Asset('road-sand-shoulder',materials,rects);shoulder.metric=False
for index in range(0,COUNT,4):
 u=index/COUNT
 if sector_at(u) in ('BASIN','REEF'):continue
 p0,t0,r0,s0=frame(u);p1,t1,r1,s1=frame((index+4)/COUNT)
 # Match the road tint selected by the rendered BEACH calibration.
 linear=(.42,.53,1)
 for side in (-1,1):
  for band in range(3):
   inner=-.1+band*.8;outer=inner+.8
   amount=(band+.5)/3
   shoulder.tint=tuple(v*(1-amount)+.86*amount for v in linear)+(1,)
   corners=[p0+r0*(side*(s0['width']/2+inner))+UP*(-.06-band*.04),
    p0+r0*(side*(s0['width']/2+outer))+UP*(-.10-band*.04),
    p1+r1*(side*(s1['width']/2+outer))+UP*(-.10-band*.04),
    p1+r1*(side*(s1['width']/2+inner))+UP*(-.06-band*.04)]
   shoulder.geometry([tuple(c) for c in corners],[(0,1,2,3) if side>0 else (3,2,1,0)],'concrete','road-sand',tile=1)
save(shoulder,['below-deck sand transition','three tint bands','follows the accepted route',
 'skips causeway and reef water','merged into the existing concrete batch'])
place('road-sand-shoulder',(0,0,0),0.,sector='ALL')


# Gate furniture on both sides of every ordered gate, plus the two launch strips.
GATE_PLATES=['plate-dream-island','plate-gate-1','plate-gate-2','plate-gate-3',
 'plate-gate-4','plate-gate-5','plate-gate-6','plate-beach']
for index,u in enumerate(route['checkpoints']):
 for side in (-1,1):
  root=place('gate-furniture',beside(u,side*(half_width(u)+2.6)),yaw_at(u),sector=sector_at(u))
  root['gate']=index

# --------------------------------------------------------------------------
# Signage. Environmental letters cap at 0.59 m; the plate height that produces
# that cap is MEASURED off the atlas, not chosen.
# --------------------------------------------------------------------------
PLATE_HEIGHT=.62
SIGN_PLAN=[(.002,-1,'plate-dream-island','BEACH'),(.002,1,'plate-07','BEACH'),
 (.010,-1,'plate-beach','BEACH'),(.125,1,'plate-gate-1','GROVE'),
 (.283,-1,'plate-gate-2','POINT'),(.392,1,'plate-gate-3','BASIN'),
 (.517,-1,'plate-gate-4','COURT'),(.658,1,'plate-gate-5','REEF'),
 (.750,-1,'plate-gate-6','REEF'),(.850,1,'plate-beach','CUT')]
signage=Asset('signage-plates',materials,rects);signage.metric=False
for progress,side,cell,sector in SIGN_PLAN:
 plate=LETTERING['plate-gate-numbers']['plate'] if cell.startswith('plate-gate-') else LETTERING[cell]['plate']
 lettering=plate['lettering']
 fraction=lettering['glyphFractionOfPlate']
 # A gate digit is one sixth of the strip wide but the full strip tall, so the
 # glyph fraction of the plate it is cut from is the number that governs it.
 letters=PLATE_HEIGHT*fraction
 assert letters<=.59+1e-9,cell+' would ship %.3f m letters'%letters
 p,t,right,s=frame(progress)
 lateral=side*(s['width']/2+2.6)
 position=p+right*lateral+UP*3.4
 width=PLATE_HEIGHT*(2.9 if cell=='plate-dream-island' else 1.0 if cell=='plate-07'
  else 1.0 if cell.startswith('plate-gate-') else 2.15)
 # The plate's width runs ALONG the road so its face looks across it.
 signage.card((position.x,position.y,position.z),width,PLATE_HEIGHT,
  'signage',cell,yaw=math.atan2(t.z,t.x),anchor='centre')
 signs.append({'id':cell+'@'+format(progress,'.3f'),'tile':cell,'progress':progress,
  'side':'left' if side<0 else 'right','sector':sector,
  'position':[round(v,3) for v in position],
  'plateHeightMetres':PLATE_HEIGHT,'plateWidthMetres':round(width,3),
  'letterHeightMetres':round(letters,4),
  'letterCapMetres':.59,'gameplaySizeException':False,
  'roadHalfWidthMetres':round(s['width']/2,3),
  'roadFaceClearanceMetres':round(abs(lateral)-s['width']/2-width/2*0,3),
  'deckClearanceMetres':round(abs(lateral)-(s['width']/2-2.05),3),
  'heightAboveDeckMetres':3.4})
save(signage,['DREAM ISLAND place plate','07 map number','six gate number plates',
 'BEACH district plate','every letter under the 0.59 m environmental cap'])
# The plates are authored in world space, so their bounding box is the span of
# the lap and says nothing about a silhouette. Record the plate itself instead.
measured['sand-verge']['measured']={'innerMetres':VERGE_INNER,'outerMetres':VERGE_OUTER,
 'note':'Authored in world space along the whole lap; a bounding box over it is the lap, not a silhouette.'}
measured['signage-plates']['measured']={'plateHeightMetres':PLATE_HEIGHT,
 'maximumLetterHeightMetres':round(max(s['letterHeightMetres'] for s in signs),4),
 'plates':len(signs),'note':'Authored in world space; a bounding box over all ten plates is the lap, not a silhouette.'}
place('signage-plates',(0,0,0),0.,sector='ALL')

# --------------------------------------------------------------------------
# Batch every static mesh by material: the island costs one draw per role.
# --------------------------------------------------------------------------
bpy.context.view_layer.update()
groups={}
for root in list(world.children):
 if root.get('dynamic'):continue
 for o in root.children_recursive:
  if o.type=='MESH':groups.setdefault((root.get('batch') or 'STATIC',o.data.materials[0].name),[]).append(o)
for (batch,material_name),objects in groups.items():
 vertices=[];faces=[];uvs=[];colours=[]
 for obj in objects:
  base=len(vertices);vertices.extend(obj.matrix_world@v.co for v in obj.data.vertices)
  faces.extend(tuple(base+i for i in p.vertices) for p in obj.data.polygons)
  uvs.extend(tuple(v.uv) for v in obj.data.uv_layers.active.data)
  colours.extend(tuple(v.color) for v in obj.data.color_attributes['Color'].data)
 mesh=bpy.data.meshes.new('DI_'+batch+'_'+material_name)
 mesh.from_pydata(vertices,[],faces);mesh.materials.append(bpy.data.materials[material_name]);mesh.update()
 uv=mesh.uv_layers.new(name='Atlas UV0')
 colour=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 for i,value in enumerate(uvs):uv.data[i].uv=value;colour.data[i].color=colours[i]
 combined=bpy.data.objects.new(mesh.name,mesh);bpy.context.collection.objects.link(combined)
 combined.parent=world
 for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
for root in list(world.children):
 if root.type=='EMPTY' and not root.children:bpy.data.objects.remove(root,do_unlink=True)
for name in [o.name for o in library.values()]:
 source=bpy.data.objects.get(name)
 if source is None:continue
 for child in list(source.children_recursive):bpy.data.objects.remove(child,do_unlink=True)
 bpy.data.objects.remove(source,do_unlink=True)

assert not any('tripo' in o.name.lower() or 'maquette' in o.name.lower() for o in bpy.data.objects)
bpy.ops.object.select_all(action='DESELECT');world.select_set(True)
for o in world.children_recursive:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE/'dreamisland_painted.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'painted.glb'),export_format='GLB',use_selection=True,
 export_yup=True,export_vertex_color='ACTIVE',export_extras=True)

# --- Phase C. What `painted.json` records for a hero-backed asset must describe
# what SHIPS, not the placeholder this script still authors and no longer
# places. The five silhouette features, the target metres, the measured bounds
# and the triangle count are therefore taken from the hero build's own record.
HERO_ASSET={'clock-tower':'clock-tower','watchtower-ruin':'watchtower',
 'waterfall-cliff':'waterfall-cliff','sea-stack':'sea-stack-set'}
HERO_TARGET={
 'clock-tower':{'heightMetres':14.,'widthMetres':8.},
 'watchtower-ruin':{'heightMetres':30.,'widthMetres':28.,'boreWidthMetres':14.,
  'boreSpringHeightMetres':8.,'boreCrownHeightMetres':10.,'minimumFlankMetres':7.,
  'placedScale':BORE_SCALE,'placedLateralOffsetMetres':BORE_LATERAL,
  'placedHeightMetres':round(30.*BORE_SCALE,3),'placedBoreWidthMetres':round(14.*BORE_SCALE,3),
  'deviation':'Decision 5 fixes the drum at 28 x 30 m and the bore at 14 x 8 m. At scale 1 that bore cannot contain the 14 m road across its own 28.5 m depth on this route: the swept envelope is 14.778 m. Placed at scale 1.10 with a 0.38 m lateral offset, which leaves 0.302 m of measured lateral clearance. Flagged for review; the asset itself is unmodified.'},
 'waterfall-cliff':{'dropMetres':16.},
 'sea-stack':{'heightMetres':40.,'stackHeightsMetres':[18.,26.,32.,40.]},
}
heroes_record=json.loads((OUT/'heroes/heroes.json').read_text())
for asset,hero_name in HERO_ASSET.items():
 record=heroes_record['assets'][hero_name]
 size=record['bounds']['size']
 details[asset]=list(record['features'])
 assert len(details[asset])==5,asset+' hero record must carry exactly five features'
 measured[asset]={'target':HERO_TARGET[asset],
  'measured':{'widthMetres':round(size[0],3),'heightMetres':round(size[1],3),
   'depthMetres':round(size[2],3),'baseMetres':round(record['bounds']['min'][1],3),
   'topMetres':round(record['bounds']['max'][1],3)},
  'triangles':record['triangles'],
  'source':'public/assets/dreamisland/heroes/'+record['file'],
  'sha256':record['sha256'],
  'note':'Built by art/blender/build_dreamisland_heroes.py and loaded at runtime; not inside painted.glb.'}

meshes=[o for o in world.children_recursive if o.type=='MESH']
per_mesh={o.name:sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes}
total=sum(per_mesh.values())
manifest={'script':'art/blender/build_dreamisland_painted.py','phase':'B painted world',
 'roles':ROLES,'cardSheet':{'material':'DI_MAT_jungle-card','texture':'jungle-card.png',
  'discard':'min(r,b)-g > .025 before shared lighting, fog and tone mapping'},
 'atlasManifest':'public/assets/dreamisland/atlas-manifest.json',
 'route':{'revision':route['revision'],'lengthMetres':LENGTH,'stations':COUNT},
 'meshes':len(meshes),'triangles':total,'trianglesPerMesh':per_mesh,
 'heroes':{'note':'These assets are NOT in painted.glb. They ship as separate GLBs under public/assets/dreamisland/heroes/ and are placed at the positions recorded below with batch "HERO". Removing them from the batch is what stops the island carrying two of each.',
  'assets':HERO_GLB,'placements':len([p for p in placements if p['batch']=='HERO'])},
 'assets':measured,
 'placements':placements,'features':details,
 'fishPaths':{'file':'src/game/data/dreamisland/fish-paths.json',
  'shoals':[{'id':shoal['id'],'batch':shoal['batch'],'fish':len(shoal['fish']),
    'rest':shoal['rest'],'periodSeconds':shoal['periodSeconds']} for shoal in FISH_PATHS['shoals']],
  'note':'Resting placements are read from that file; the runtime drives the same shoals along the paths in it.'},
 'maquettes':[],'maquettesRemovedBeforeWorldExport':True,
 'maquetteNote':'None lifted. DREAM-ISLAND-LEVEL.md section 7 supersedes the concept doc: the two orthographic sheets are the modelling reference.'}
(OUT/'painted.json').write_text(json.dumps(manifest,indent=1))
(EVIDENCE/'model-build.json').write_text(json.dumps(manifest,indent=1))
signage_manifest={'script':'art/blender/build_dreamisland_painted.py',
 'letterCapMetres':.59,'source':'public/assets/dreamisland/textures/signage.jpg',
 'measurement':'Letter height = plate height x the glyph fraction measured in scripts/prepare-dreamisland-atlases.py letter_band().',
 'signs':signs,'count':len(signs),
 'maximumLetterHeightMetres':max(s['letterHeightMetres'] for s in signs),
 'minimumRoadFaceClearance':min(s['roadFaceClearanceMetres'] for s in signs),
 'minimumDeckClearance':min(s['deckClearanceMetres'] for s in signs),
 'flightArcsClear':len(route['flightArcs'])==0,
 'flightArcsNote':'Dream Island authors no flight arcs, so no sign can intersect one.',
 'gameplaySizeExceptions':[s['id'] for s in signs if s['gameplaySizeException']]}
(OUT/'signage-manifest.json').write_text(json.dumps(signage_manifest,indent=1))
print(json.dumps({'meshes':len(meshes),'triangles':total,'placements':len(placements),
 'assets':len(details),'signs':len(signs),
 'maximumLetterHeightMetres':signage_manifest['maximumLetterHeightMetres']},indent=1))
