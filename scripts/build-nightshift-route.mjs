import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";

// Broad boulevard, switchback above the canal, then the long way home past docks.
const controlPoints = [
  [0, 0, 200], [0, 0, 0], [0, 0, -200], [60, 0, -320],
  [200, 0, -350], [340, 2, -290], [370, 7, -140], [280, 8, -20],
  [270, 5, 120], [340, 0, 220], [300, 0, 340], [160, 0, 370], [30, 0, 320],
];
const curve = new THREE.CatmullRomCurve3(controlPoints.map(p => new THREE.Vector3(...p)), true, "centripetal");
curve.arcLengthDivisions = 6000;
const length = curve.getLength();
const count = Math.ceil(length / 3);
const up = new THREE.Vector3(0, 1, 0);
const districts = [
  { from: 0, id: "MOTEL", name: "MOTEL MILE", color: "#e56989" },
  { from: .19, id: "ARCADE", name: "CLOSED ARCADE", color: "#56bfc2" },
  { from: .36, id: "TENEMENTS", name: "NORTH TENEMENTS", color: "#e1a965" },
  { from: .50, id: "UNDERPASS", name: "THE UNDERPASS", color: "#558fb7" },
  { from: .67, id: "QUAY", name: "SERVICE QUAY", color: "#c18348" },
  { from: .84, id: "RETURN", name: "LAST EXIT", color: "#b6577c" },
];
const stations = Array.from({length:count}, (_, i) => {
  const progress = i / count;
  const point = curve.getPointAt(progress);
  const tangent = curve.getTangentAt(progress).normalize();
  const before = curve.getTangentAt(THREE.MathUtils.euclideanModulo(progress - 1/count, 1));
  const after = curve.getTangentAt((progress + 1/count) % 1);
  const angle = Math.atan2(before.clone().cross(after).dot(up), before.dot(after));
  const district = districts.findLast(d => progress >= d.from);
  return { d:progress * length, p:point.toArray(), t:tangent.toArray(),
    curvature:angle / (length / count * 2), width: district.id === "UNDERPASS" ? 23 : 26,
    sector:district.id };
});
const data = { name:"Night Shift", length, count, controlPoints, districts,
  checkpoints:[0, .12, .24, .36, .49, .62, .75, .88], stations };
const output = new URL("../src/game/data/nightshift/", import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL("route.json", output), JSON.stringify(data));
console.log(`Night Shift: ${length.toFixed(1)} m, ${count} samples, minimum radius ${Math.min(...stations.filter(s=>Math.abs(s.curvature)>.0001).map(s=>1/Math.abs(s.curvature))).toFixed(1)} m.`);
