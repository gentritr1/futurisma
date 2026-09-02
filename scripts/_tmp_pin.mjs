// Scratch: rewrite the P20.4 digest placeholders in validate-living-world.mjs
// from the current authoring. Deleted before the phase commits.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildLivingWorld, LIVING_WORLD_SPECS } from "../src/game/living-world-zones.js";

function canonicalCard(card) {
  return JSON.stringify([
    card.motionId, card.kind, card.batch, card.distance, card.side, card.lateral,
    card.base, card.width, card.height, card.phase, card.speed, card.tint,
    card.seed, card.amplitude ?? null, card.hang ?? null, card.alphaKind ?? null,
    card.alphaInitial ?? null, card.rect.x, card.rect.y, card.rect.size,
    card.rect.sheetSize,
  ]);
}

const world = buildLivingWorld(LIVING_WORLD_SPECS.bitterpan);
const byZone = new Map();
for (const batch of world.batches) {
  for (const card of batch.cards) {
    const list = byZone.get(card.motionId) ?? [];
    list.push(canonicalCard(card));
    byZone.set(card.motionId, list);
  }
}
const path = new URL("./validate-living-world.mjs", import.meta.url);
const ids = ["PAN_SCUD_NEAR", "PAN_SCUD_CROSSING", "SALT_DEVIL_ROAD",
  "BRINE_HAZE_LOW", "PAN_SKY_HAZE"];
const lines = readFileSync(path, "utf8").split("\n");
for (const id of ids) {
  const digest = createHash("sha256")
    .update(byZone.get(id).join("\n")).digest("hex").slice(0, 16);
  let hit = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(`{ id: "${id}", map: "bitterpan"`)) continue;
    lines[i] = lines[i].replace(/digest: "[^"]*"/, `digest: "${digest}"`);
    hit += 1;
  }
  console.log(id, byZone.get(id).length, digest, hit === 1 ? "" : `HIT=${hit}`);
}
writeFileSync(path, lines.join("\n"));
console.log(`bitterpan ${world.drawCalls} calls / ${world.cards} cards / ${world.triangles} tris`);
