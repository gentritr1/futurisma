import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";

const vector = ([x, z]) => new THREE.Vector3(x, 0, z);
function path(...segments) {
  const result = new THREE.CurvePath();
  for (const points of segments) result.add(new THREE.CubicBezierCurve3(...points.map(vector)));
  return result;
}
function straight(a, b) {
  return path([a, [a[0] * .667 + b[0] * .333, a[1] * .667 + b[1] * .333],
    [a[0] * .333 + b[0] * .667, a[1] * .333 + b[1] * .667], b]);
}
const launch = straight([0, 220], [0, -50]);
const switchyard = path(
  [[0, -50], [0, -110], [-74, -85], [-74, -145]],
  [[-74, -145], [-74, -205], [0, -180], [0, -240]],
  [[0, -240], [0, -250], [0, -260], [0, -270]],
);
const crown = path(
  [[0, -270], [0, -356], [69, -425], [155, -425]],
  [[155, -425], [263, -425], [350, -338], [350, -230]],
);
const spine = straight([350, -230], [350, 15]);
const bypass = path(
  [[350, 15], [350, 70], [420, 50], [420, 105]],
  [[420, 105], [420, 160], [350, 140], [350, 195]],
  [[350, 195], [350, 203], [350, 212], [350, 220]],
);
const home = path(
  [[350, 220], [350, 317], [272, 395], [175, 395]],
  [[175, 395], [78, 395], [0, 317], [0, 220]],
);
const sections = [
  { id: "LAUNCH", name: "VECTOR EXCHANGE", floor: launch, color: "#e8b06d" },
  { id: "SWITCHYARD", name: "THE SWITCHYARD", floor: switchyard, upper: straight([0, -50], [0, -270]), color: "#58d7df" },
  { id: "CROWN", name: "CAPACITOR CROWN", floor: crown, color: "#a597da" },
  { id: "SPINE", name: "MAGNETIC SPINE", floor: spine, color: "#68c8cf" },
  { id: "BYPASS", name: "SKYLINE BYPASS", floor: bypass, upper: straight([350, 15], [350, 220]), color: "#ea8d6c" },
  { id: "HOME", name: "AFTERLIGHT", floor: home, color: "#8dafb3" },
];
let length = 0;
let upperLength = 0;
for (const section of sections) {
  section.start = length;
  section.length = section.floor.getLength();
  length += section.length;
  upperLength += (section.upper ?? section.floor).getLength();
}
const count = Math.ceil(length / 3);
const stations = [], upper = [];
for (let i = 0; i < count; i++) {
  const distance = i / count * length;
  const section = sections.findLast(section => distance >= section.start);
  const local = (distance - section.start) / section.length;
  for (const lane of [0, 1]) {
    const curve = lane ? section.upper ?? section.floor : section.floor;
    const p = curve.getPointAt(local);
    const t = curve.getTangentAt(local).normalize();
    p.y = lane ? 22 : 0;
    (lane ? upper : stations).push({ d: distance, p: p.toArray(), t: t.toArray(),
      curvature: 0, width: lane ? 16 : 24, sector: section.id });
  }
}
for (const lane of [stations, upper]) {
  for (let i = 0; i < count; i++) {
    const before = lane[(i - 1 + count) % count], after = lane[(i + 1) % count];
    const a = new THREE.Vector3(...before.t), b = new THREE.Vector3(...after.t);
    const distance = new THREE.Vector3(...before.p).distanceTo(new THREE.Vector3(...after.p));
    lane[i].curvature = Math.atan2(a.clone().cross(b).y, a.dot(b)) / Math.max(.01, distance);
  }
}
const districts = sections.map(s => ({ id: s.id, name: s.name, from: s.start / length, color: s.color }));
const shortcuts = sections.filter(s => s.upper).map(s => ({
  from: s.start / length, to: (s.start + s.length) / length,
  savedMeters: s.length - s.upper.getLength(), name: s.id === "SWITCHYARD" ? "CROWN EXPRESS" : "SKYLINE EXPRESS",
}));
const data = { name: "Polarity", length, upperLength, ceilingHeight: 22, count, districts, shortcuts,
  checkpoints: [0, .115, .255, .39, .52, .66, .79, .90], stations, upper };
const output = new URL("../src/game/data/polarity/", import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("route.json", output), JSON.stringify(data));
console.log(`Polarity: ${length.toFixed(1)}m lower / ${upperLength.toFixed(1)}m upper; ${shortcuts.map(s => s.savedMeters.toFixed(1) + 'm saved').join(', ')}; min radius ${Math.min(...stations.filter(s => Math.abs(s.curvature) > .0001).map(s => 1 / Math.abs(s.curvature))).toFixed(1)}m.`);
