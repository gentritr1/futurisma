/**
 * The atlas claims, shared by the two rendered-pixel proofs.
 *
 *   scripts/visual/dreamisland/atlas-proof.mjs          - the SHEET proof:
 *     isolate the shipped mesh, render it unlit, and compare the pixels against
 *     all four quadrants of the served texture in normalised chromaticity.
 *   scripts/visual/dreamisland/atlas-quadrant-proof.mjs - the QUADRANT-ID proof:
 *     the same isolation with the whole sheet replaced by four flat, maximally
 *     separated colours, so a chromatically adjacent pair (sand road against
 *     limestone block, frond against blossom shrub) cannot be ambiguous.
 *
 * The list lives here so the two cannot drift apart about what is being claimed.
 */
// `at` is the progress window the claim's geometry is actually in front of the
// camera. A
// claim isolated where its geometry is behind the camera measures the clear
// colour and proves nothing, which is what the first run of this script did.
export const CLAIMS=[
 {id:'surge-core',mesh:'DI_POWER_core_surge',role:'emissive',cell:'lamp-disc',at:[.04,.05],
  is:'The sunburst core and matching mount lamp draw the warm lamp disc.'},
 {id:'shield-core',mesh:'DI_POWER_core_shield',role:'emissive',cell:'shallows-glow',at:[.20,.21],
  is:'The tide-bell core and matching mount lamp draw the cyan shallows glow.'},
 {id:'surge-plate',mesh:'DI_POWER_plate_surge',role:'concrete',cell:'road-sand',at:[.04,.05],
  is:'The amber pickup target retains the concrete road cell.'},
 {id:'shield-plate',mesh:'DI_POWER_plate_shield',role:'concrete',cell:'road-sand',at:[.20,.21],
  is:'The cyan pickup target retains the concrete road cell.'},
 {id:'kit-cage-lattice',mesh:'DI_POWER_DI_MAT_metal',role:'metal',cell:'clock-ring-hands',at:[.04,.05],
  is:'The cage and lattice retain the shared clock metal cell.'},
 {id:'kit-capacitors',mesh:'DI_POWER_DI_MAT_metal',role:'metal',cell:'gate-lamp-post',at:[.04,.05],
  is:'The four capacitor cylinders draw the gate-post metal cell.'},
 {id:'kit-crown',mesh:'DI_POWER_DI_MAT_metal',role:'metal',cell:'rail',at:[.20,.21],
  is:'The bronze crown draws the rail cell beneath its measured tint.'},
 {id:'kit-petals',mesh:'DI_POWER_petals',role:'metal',cell:'rail',at:[.20,.21],
  is:'The hinged petal instances retain their rail-cell UVs.'},
 {id:'kit-surge-mount',mesh:'DI_POWER_DI_MAT_concrete',role:'concrete',cell:'kerb-cyan',at:[.04,.05],
  is:'The Surge mount draws the cyan-striped concrete cell.'},
 {id:'kit-shield-mount',mesh:'DI_POWER_DI_MAT_concrete',role:'concrete',cell:'causeway-paving',at:[.20,.21],
  is:'The Shield mount draws the concrete paving cell.'},
 {id:'kit-moss-joints',mesh:'DI_POWER_DI_MAT_concrete',role:'concrete',cell:'wall-block',at:[.20,.21],
  is:'The moss joints tint the existing wall-block cell.'},
 {id:'kit-pier-support',mesh:'DI_POWER_DI_MAT_concrete',role:'concrete',cell:'road-sand',at:[.71,.72],
  is:'The REEF outrigger draws the same concrete road cell as its plate.'},
 {id:'clock-hour-hand',mesh:'clock_hour_hand',role:'metal',cell:'clock-ring-hands',at:[.55,.60],
  is:'The independently moving hour hand retains its clock metal UVs.'},
 {id:'clock-minute-hand',mesh:'clock_minute_hand',role:'metal',cell:'clock-ring-hands',at:[.55,.60],
  is:'The independently moving minute hand retains its clock metal UVs.'},
 {id:'road-deck',mesh:'dreamisland_blockout_road',role:'concrete',cell:'road-sand',at:[.03,.06],
  is:'The road ribbon draws the sand road surface.'},
 {id:'kerb',mesh:'dreamisland_blockout_road',role:'concrete',cell:'kerb-cyan',at:[.06,.09],
  is:'The kerbs draw the cyan-striped kerb stone.'},
 {id:'foam',mesh:'dreamisland_foam',role:'water',cell:'foam-gradient',uniform:true,at:[.09,.115],
  is:'The foam line draws the foam gradient.'},
 {id:'sea',mesh:'dreamisland_sea',role:'water',cell:'cobalt-facets',uniform:true,at:[.13,.16],
  is:'The open sea draws the cobalt facet swell.'},
 {id:'palm-bark',mesh:'DI_STATIC_DI_MAT_jungle',role:'jungle',cell:'bark',at:[.17,.20],
  is:'The palm trunks draw the segmented bark.'},
 {id:'frond-card',mesh:'DI_STATIC_DI_MAT_jungle-card',role:'jungle-card',cell:'frond',at:[.21,.24],
  is:'The palm crowns draw the frond sprite.'},
 {id:'sand-verge',mesh:'DI_STATIC_DI_MAT_jungle',role:'jungle',cell:'sand',at:[.25,.28],
  is:'The verge draws the beach sand.'},
 {id:'gate-markers',mesh:'dreamisland_blockout_markers',role:'metal',cell:'rail',at:[.36,.39],
  is:'The gate and strip markers draw the galvanised rail.'},
 {id:'causeway-paving',mesh:'DI_STATIC_DI_MAT_concrete',role:'concrete',cell:'causeway-paving',at:[.42,.47],
  is:'The causeway deck and the clock plinth draw the paving.'},
 // Phase C: the clock face left `painted.glb` with the rest of the clock tower.
 // The claim follows the geometry - the static emissive batch is now only the
 // gate-furniture lamp discs, and pointing a "the clock face draws the lit face"
 // claim at a lamp is how a proof starts passing for the wrong reason.
 {id:'clock-face',mesh:'DI_HERO_clock-tower_DI_MAT_emissive',role:'emissive',cell:'clock-face',at:[.55,.60],
  is:'The clock face draws the lit face.'},
 {id:'shallows',mesh:'dreamisland_shallows',role:'water',cell:'caustic-shallows',uniform:true,at:[.70,.76],
  is:'The shallows draw the caustic web.'},
 {id:'wall-block',mesh:'DI_STATIC_DI_MAT_concrete',role:'concrete',cell:'wall-block',at:[.88,.93],
  is:'The cut walls and the sea stacks draw the limestone wall block.'},
 {id:'signage-plate',mesh:'DI_STATIC_DI_MAT_signage',role:'signage',cell:'plate-dream-island',at:[.975,.995],
  is:'The place plate draws the DREAM ISLAND plate.'},
 // Phase C, one cell per hero as the phase brief asks. The clock face above is
 // the first; this is the second, and between them they cover both of the two
 // binding facts about a hero: that its material name reached the shared atlas
 // at all, and that its authored UVs address the rect it names on that sheet.
 {id:'watchtower-drum',mesh:'DI_HERO_watchtower-ruin_DI_MAT_concrete',role:'concrete',cell:'wall-block',at:[.32,.35],
  is:'The hero watchtower drum draws the limestone wall block.'},
];
