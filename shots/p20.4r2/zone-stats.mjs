// P20.4 round-2 review harness (not part of the shipped game).
//
// Re-derives the numbers validate-living-world.mjs pins, so a re-author can be
// measured before the pins are rewritten instead of after. Prints, for the
// Bitterpan set: the P20.4 zone digests, the corridor census with the max peak
// alpha on each side of the corridor line, and the PAN_SCUD_NEAR placement
// histogram the round-2 brief specifies.
import { createHash } from "node:crypto";
import {
  ALPHA_ENVELOPES,
  LIVING_WORLD_SPECS,
  buildLivingWorld,
} from "../../src/game/living-world-zones.js";

const CORRIDOR_LATERAL_METRES = 5.8;
const CORRIDOR_HEIGHT_METRES = 6;

function canonicalCard(card) {
  return JSON.stringify([
    card.motionId, card.kind, card.batch, card.distance, card.side,
    card.lateral, card.base, card.width, card.height, card.phase, card.speed,
    card.tint, card.seed, card.amplitude ?? null, card.hang ?? null,
    card.alphaKind ?? null, card.alphaInitial ?? null,
    card.rect.x, card.rect.y, card.rect.size, card.rect.sheetSize,
  ]);
}

function reachableLateral(card) {
  if (card.kind === "cross" || card.kind === "devil") {
    return card.lateral - (card.amplitude ?? 0);
  }
  if (card.kind === "mist") return card.lateral - card.speed * 9;
  return card.lateral;
}

const peakAlpha = (card) => card.alphaKind
  ? ALPHA_ENVELOPES[card.alphaKind][1]
  : (card.alphaInitial ?? 1);

for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  const world = buildLivingWorld(spec);
  const byZone = new Map();
  for (const batch of world.batches) {
    for (const card of batch.cards) {
      if (!byZone.has(card.motionId)) byZone.set(card.motionId, []);
      byZone.get(card.motionId).push(canonicalCard(card));
    }
  }
  console.log(`\n=== ${map}: ${world.drawCalls} batches / ${world.cards} cards`);
  for (const zone of spec.zones) {
    const cards = byZone.get(zone.id) ?? [];
    const digest = createHash("sha256").update(cards.join("\n")).digest("hex").slice(0, 16);
    console.log(`  ${zone.id.padEnd(24)} ${cards.length.toString().padStart(3)}  ${digest}`);
  }
}

const bp = buildLivingWorld(LIVING_WORLD_SPECS.bitterpan);
const all = bp.batches.filter((b) => !b.spec.lamps).flatMap((b) => b.cards);
let corridor = 0;
let maxIn = 0;
let maxOut = 0;
const inIds = new Map();
for (const card of all) {
  const reach = reachableLateral(card);
  const inside = reach <= CORRIDOR_LATERAL_METRES && card.base < CORRIDOR_HEIGHT_METRES;
  if (inside) {
    corridor += 1;
    maxIn = Math.max(maxIn, peakAlpha(card));
    inIds.set(card.motionId, (inIds.get(card.motionId) ?? 0) + 1);
  } else {
    maxOut = Math.max(maxOut, peakAlpha(card));
  }
}
console.log(`\ncorridor-reaching cards: ${corridor}`);
console.log(`  by zone: ${[...inIds].map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`  max peak alpha inside corridor : ${maxIn.toFixed(3)} (cap 0.35)`);
console.log(`  max peak alpha outside, whole map: ${maxOut.toFixed(3)}`);
// The 0.62 ceiling is a P20.4 NEAR-FIELD rule. PAN_SKY_HAZE is 1300-1500 m out
// at a constant 0.75 and was accepted in round 1; the accepted P9/P12/P18 zones
// carry their own ceilings. So the number the round-2 brief asks for is the max
// over the four near zones outboard of the corridor.
const NEAR_ZONES = ["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD", "BRINE_HAZE_LOW"];
const nearOut = all.filter((c) => NEAR_ZONES.includes(c.motionId)
  && !(reachableLateral(c) <= CORRIDOR_LATERAL_METRES && c.base < CORRIDOR_HEIGHT_METRES));
console.log(
  `  max peak alpha outside corridor, P20.4 near zones: `
    + `${Math.max(...nearOut.map(peakAlpha)).toFixed(3)} (cap 0.62, `
    + `${nearOut.length} cards)`,
);

const scud = all.filter((c) => c.motionId === "PAN_SCUD_NEAR");
const within = scud.filter((c) => c.lateral >= 2 && c.lateral <= 8);
console.log(`\nPAN_SCUD_NEAR ${scud.length} cards`);
console.log(`  lateral 2-8 m : ${within.length} / ${scud.length} (brief: >= 25)`);
const rng = (f) => {
  const v = scud.map(f);
  return `${Math.min(...v).toFixed(2)}..${Math.max(...v).toFixed(2)}`;
};
console.log(`  lateral ${rng((c) => c.lateral)}  width ${rng((c) => c.width)}`);
console.log(`  height  ${rng((c) => c.height)}  base  ${rng((c) => c.base)}`);
const shoulders = scud.filter((c) => c.alphaKind === "scudShoulder");
console.log(`  shoulder tier ${shoulders.length}, sides ${[...new Set(shoulders.map((c) => c.side))].sort().join("/")}`);
const inner = scud.filter((c) => c.alphaKind === "rise");
console.log(`  inner tier    ${inner.length}, sides ${[...new Set(inner.map((c) => c.side))].sort().join("/")}`);

const near = bp.batches.flatMap((b) => b.cards)
  .filter((c) => ["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD",
    "BRINE_HAZE_LOW", "PAN_SKY_HAZE"].includes(c.motionId)
    && reachableLateral(c) <= 14 && c.base < 12);
console.log(`\nP20.4 cards within 14 m / under 12 m: ${near.length}`);
