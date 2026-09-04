import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";

// One unbanked coast loop. Height changes are broad ramps; only the two
// authored flight spans omit their road mesh, while keeping a guided path.
const controls = [
  [-300, -24, -210], [-100, -24, -390], [130, -20, -400],
  [340, 5, -260], [430, 5, -40], [400, 12, 180],
  [280, 44, 370], [50, 36, 450], [-180, 14, 410],
  [-380, 45, 260], [-440, 20, 40], [-400, -14, -160],
].map(p => new THREE.Vector3(...p));
const path = new THREE.CatmullRomCurve3(controls, true, "centripetal");
path.arcLengthDivisions = 8000;
const length = path.getLength();
const count = Math.ceil(length / 3);
const flightArcs = [
  { id: "SKYLIFT", name: "SKYLIFT CROSSING", from: .47, to: .645 },
  { id: "PELAGIC", name: "PELAGIC LEAP", from: .75, to: .875 },
];
const districts = [
  { id: "REACTOR", name: "THE DROWNED REACTOR", from: 0, color: "#55d0cb" },
  { id: "LOCK", name: "LANTERN LOCK", from: .18, color: "#70cfcb" },
  { id: "DOCKS", name: "PORT AFTERLIGHT", from: .275, color: "#edb471" },
  { id: "SKYLIFT", name: "SKYLIFT CROSSING", from: .47, color: "#72d7e2" },
  { id: "BREAKWATER", name: "THE PELAGIC SPAN", from: .645, color: "#acbedd" },
  { id: "REENTRY", name: "THE BLUE DESCENT", from: .875, color: "#69bdb5" },
];
function modeAt(progress, height) {
  if (flightArcs.some(arc => progress >= arc.from && progress < arc.to)) return "air";
  return height < -2 ? "submerged" : "surface";
}
const stations = [];
for (let i = 0; i < count; i++) {
  const progress = i / count;
  const p = path.getPointAt(progress), t = path.getTangentAt(progress).normalize();
  const sector = districts.findLast(d => progress >= d.from).id;
  const mode = modeAt(progress, p.y);
  const before = path.getTangentAt((progress - .0008 + 1) % 1);
  const after = path.getTangentAt((progress + .0008) % 1);
  const a = new THREE.Vector3(before.x, 0, before.z).normalize();
  const b = new THREE.Vector3(after.x, 0, after.z).normalize();
  const curvature = Math.atan2(a.clone().cross(b).y, a.dot(b)) / (length * .0016);
  stations.push({ d: progress * length, p: p.toArray(), t: t.toArray(),
    curvature, width: mode === "air" ? 20 : 24, sector, mode });
}
for (const arc of flightArcs) {
  arc.length = (arc.to - arc.from) * length;
  const points = stations.filter(s => s.d / length >= arc.from && s.d / length <= arc.to);
  arc.maximumHeight = Math.max(...points.map(s => s.p[1]));
}
const data = { name: "Tideline", length, count, waterLevel: 0,
  districts, flightArcs, checkpoints: [0, .12, .26, .385, .54, .655, .80, .91], stations };
const out = new URL("../src/game/data/tideline/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("route.json", out), JSON.stringify(data));
console.log(`Tideline ${length.toFixed(1)}m; ${count} stations; min radius${Math.min(...stations.map(s => 1 / Math.abs(s.curvature))).toFixed(1)}m; pitch${Math.max(...stations.map(s => Math.abs(Math.asin(s.t[1]))))*180/Math.PI}deg.`);
console.log(flightArcs);
console.log(districts.map(d=>({...d, height:path.getPointAt(d.from).y})));
