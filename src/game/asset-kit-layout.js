/**
 * Sparse fallback dressing made from the accepted Phase 1 kit. These props do
 * not participate in collision or navigation; Greenwater's JSON remains the
 * gameplay authority until the final authored environment arrives.
 */
export const ASSET_KIT_PROP_PLACEMENTS = [
  { name: "PROP_cable_bundle", distance: 781.239, lateral: -8.5, yaw: -0.5, scale: 1 },
  { name: "PROP_cable_bundle", distance: 1278.982, lateral: 9, yaw: 0.65, scale: 1 },

  { name: "PROP_plant_reeds", distance: 445, lateral: -16, yaw: 0.1, scale: 1.15 },
  { name: "PROP_plant_reeds", distance: 485, lateral: -18, yaw: -0.35, scale: 1.3 },
  { name: "PROP_plant_reeds", distance: 525, lateral: -15.5, yaw: 0.55, scale: 1.05 },
  { name: "PROP_plant_reeds", distance: 565, lateral: -19, yaw: -0.7, scale: 1.35 },

  { name: "PROP_plant_frond", distance: 1138, lateral: -20, yaw: 0.2, scale: 1.2 },
  { name: "PROP_plant_frond", distance: 1195, lateral: 18, yaw: -0.45, scale: 1.1 },
  { name: "PROP_plant_frond", distance: 1260, lateral: -22, yaw: 0.8, scale: 1.35 },
  { name: "PROP_plant_frond", distance: 1335, lateral: 20, yaw: -0.15, scale: 1.25 },
  { name: "PROP_plant_frond", distance: 1400, lateral: -19, yaw: 0.5, scale: 1.15 },
  { name: "PROP_plant_frond", distance: 1470, lateral: 23, yaw: -0.8, scale: 1.4 },

  { name: "PROP_plant_broadleaf", distance: 1165, lateral: 24, yaw: 0.6, scale: 1.35 },
  { name: "PROP_plant_broadleaf", distance: 1230, lateral: -17, yaw: -0.25, scale: 1.2 },
  { name: "PROP_plant_broadleaf", distance: 1300, lateral: 25, yaw: 0.05, scale: 1.45 },
  { name: "PROP_plant_broadleaf", distance: 1370, lateral: -24, yaw: -0.65, scale: 1.3 },
  { name: "PROP_plant_broadleaf", distance: 1440, lateral: 18, yaw: 0.4, scale: 1.15 },
  { name: "PROP_plant_broadleaf", distance: 1525, lateral: -22, yaw: -0.1, scale: 1.4 },

  { name: "PROP_repair_unit", distance: 600, lateral: 17, yaw: Math.PI, scale: 1 },
  { name: "PROP_repair_unit", distance: 1740, lateral: -20, yaw: 0.35, scale: 1 },
];

export const ASSET_KIT_REQUIRED_PROP_NAMES = [
  ...new Set(ASSET_KIT_PROP_PLACEMENTS.map((placement) => placement.name)),
];
