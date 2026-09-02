import { createHash } from "node:crypto";
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

for (const [map, spec] of Object.entries(LIVING_WORLD_SPECS)) {
  const world = buildLivingWorld(spec);
  const byZone = new Map();
  for (const batch of world.batches) {
    for (const card of batch.cards) {
      const list = byZone.get(card.motionId) ?? [];
      list.push(canonicalCard(card));
      byZone.set(card.motionId, list);
    }
  }
  console.log(`### ${map}: ${world.drawCalls} calls / ${world.cards} cards / ${world.triangles} tris`);
  for (const [id, cards] of byZone) {
    const digest = createHash("sha256").update(cards.join("\n")).digest("hex").slice(0, 16);
    console.log(`  ${id} ${cards.length} ${digest}`);
  }
}
