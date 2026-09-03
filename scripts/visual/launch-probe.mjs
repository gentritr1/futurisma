// How long the player takes to reach race pace from a standing start, and how
// much distance that costs against a car already at pace. The rival launch is
// tuned against this number.
import * as physics from "../../src/game/physics.js";

const step = 1 / 120;
let speed = 0;
let distance = 0;
let time = 0;
const target = 86;
while (speed < target && time < 30) {
  speed = physics.integrateSpeed(speed, 1, 0, false, 0, step);
  distance += speed * step;
  time += step;
}
console.log(
  `player: ${target} m/s reached in ${time.toFixed(3)} s over ${distance.toFixed(1)} m; `
    + `a car already at ${target} covers ${(target * time).toFixed(1)} m, `
    + `so the launch costs ${((target * time - distance) / target).toFixed(3)} s`,
);

for (const gain of [1, 1.8, 2.4, 3, 3.6]) {
  let rivalSpeed = 0;
  let rivalDistance = 0;
  let rivalTime = 0;
  const accel = 13 * gain;
  while (rivalSpeed < target && rivalTime < 30) {
    rivalSpeed = Math.min(target * 1.3, rivalSpeed + accel * step);
    rivalDistance += rivalSpeed * step;
    rivalTime += step;
  }
  console.log(
    `rival boost accel gain ${gain}: ${rivalTime.toFixed(3)} s, `
      + `launch cost ${((target * rivalTime - rivalDistance) / target).toFixed(3)} s`,
  );
}
