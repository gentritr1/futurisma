// P20.4 round-2 review harness (not part of the shipped game).
//
// A card only reaches the frame in a narrow depth window: too close and its
// lateral offset carries it outside a ~35 deg half-frame, too far and it is a
// smudge on the horizon. This lists, per review station, how many P20.4 near
// cards fall inside that window ahead of the camera — which is the number that
// decides whether the layer can read at that station at all, before any
// question of tint or alpha.
import { LIVING_WORLD_SPECS, buildLivingWorld } from "../../src/game/living-world-zones.js";

const STATIONS = [150, 310, 574, 830, 1080, 1343, 1600, 1784, 2050, 2300, 2512, 2660, 2900];
const NEAR = new Set(["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD", "BRINE_HAZE_LOW"]);
const LAP = 3050;
const [MIN_AHEAD, MAX_AHEAD] = [15, 150];

const bp = buildLivingWorld(LIVING_WORLD_SPECS.bitterpan);
const cards = bp.batches.flatMap((b) => b.cards).filter((c) => NEAR.has(c.motionId));

console.log(`${"station".padStart(8)}  in-window cards (15-150 m ahead)`);
for (const station of STATIONS) {
  const hits = cards.filter((c) => {
    const ahead = ((c.distance - station) % LAP + LAP) % LAP;
    return ahead >= MIN_AHEAD && ahead <= MAX_AHEAD;
  });
  const detail = hits
    .map((c) => `${c.motionId.replace("PAN_SCUD_", "").replace("_", "")}@`
      + `${Math.round(((c.distance - station) % LAP + LAP) % LAP)}m/${c.side > 0 ? "R" : "L"}`)
    .join(" ");
  console.log(`${String(station).padStart(8)}  ${String(hits.length).padStart(2)}  ${detail}`);
}
