/**
 * LIVING WORLD — atlas B zones. Append-ready fragment for
 * `src/game/data/../living-world-zones.js`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO RULES THIS FRAGMENT OBEYS, BOTH TAKEN FROM THE FILE IT APPENDS TO
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Every zone below APPENDS after the last existing zone in its spec —
 *    after RUNWAY_MIST_DRIFT for Greenwater, after LOADOUT_TOWER_BEACON for
 *    Bitterpan. Nothing is inserted or reordered, so the shared
 *    `seededRandom` stream that pins the 155 accepted Greenwater cards is
 *    untouched and `scripts/validate-living-world.mjs` still passes on them
 *    field by field.
 * 2. A batch is a draw call. These zones cannot ride in an existing batch
 *    because they need a different texture, so they declare new batches and
 *    pay for them honestly: Greenwater +2 calls, Bitterpan +1.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RUNTIME HOOK THIS NEEDS (a code change, for the implementer)
 * ─────────────────────────────────────────────────────────────────────────
 * `LivingBatchSpec.texture` is currently typed `"motion" | "jungle" |
 * "emissive"`. Add `"motionB"` to that union and map it in `living-world.ts`
 * to `/assets/greenwater/textures/greenwater_motion_b_512.png`. That is the
 * whole integration: one union member and one URL. Everything else here is
 * data the existing `buildLivingWorld` already knows how to author.
 */

/** Slot indices into `atlasRect(512, 4, slot)` on greenwater_motion_b_512. */
export const MOTION_B_RECTS = Object.freeze({
  birdsA: atlasRect(512, 4, 0),
  birdsB: atlasRect(512, 4, 1),
  birdsC: atlasRect(512, 4, 2),
  gull: atlasRect(512, 4, 3),
  devilWispA: atlasRect(512, 4, 4),
  devilWispB: atlasRect(512, 4, 5),
  flickerFull: atlasRect(512, 4, 6),
  flickerHalf: atlasRect(512, 4, 7),
  flickerDead: atlasRect(512, 4, 8),
  wreckFuselage: atlasRect(512, 4, 9),
  wreckTailfin: atlasRect(512, 4, 10),
  wreckNacelle: atlasRect(512, 4, 11),
  wreckGantry: atlasRect(512, 4, 12),
  dustScud: atlasRect(512, 4, 13),
  vaporThin: atlasRect(512, 4, 14),
  crateStack: atlasRect(512, 4, 15),
});

// ===========================================================================
// GREENWATER — two new batches, appended to GREENWATER_BATCHES
// ===========================================================================

export const GREENWATER_BATCHES_B = Object.freeze([
  {
    // Air-suspended cards on the new sheet: birds and low scud. Same treatment
    // as the accepted `air` batch, different texture.
    id: "airB",
    meshName: "GW_LIVING_AIR_B",
    texture: "motionB",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
  {
    // Ground-standing silhouettes. This is the only living-world batch that
    // writes depth and alpha-tests, because a wreck sitting on the shoulder
    // has to occlude the mist behind it or it reads as a decal in the air.
    id: "silhouette",
    meshName: "GW_LIVING_SILHOUETTE",
    texture: "motionB",
    blending: "normal",
    depthWrite: true,
    fog: true,
    alphaTest: 0.5,
    lamps: false,
  },
]);

export const GREENWATER_ZONES_B = Object.freeze([
  {
    /**
     * The served-machinery line off the left shoulder of RUNWAY_START.
     *
     * This is the far-field half of the wreck brief; the four hero pieces are
     * geometry and are specified separately. Everything here sits 34-78 m out,
     * which at Greenwater's 650 m far plane and the opening's fog is past the
     * distance where a card and a mesh are distinguishable. They exist to give
     * the eye something that is not gray fog on the outside of the opening
     * straight, and to establish before T1 that this field is a place where
     * airframes are taken apart.
     *
     * `shear` at 0.4 deg is deliberately almost-static. These are not alive.
     * The tiny lean is there so they settle with the same air the mist does
     * rather than sitting perfectly rigid against a moving world.
     */
    id: "OPENING_WRECK_LINE",
    batch: "silhouette",
    from: 28,
    to: 206,
    cards: 14,
    card: (distance, _side, index, next) => {
      const kinds = [
        MOTION_B_RECTS.wreckFuselage,
        MOTION_B_RECTS.wreckTailfin,
        MOTION_B_RECTS.wreckNacelle,
        MOTION_B_RECTS.crateStack,
        MOTION_B_RECTS.wreckGantry,
      ];
      const rect = kinds[index % kinds.length];
      const scale = rect === MOTION_B_RECTS.wreckFuselage ? 1.55
        : rect === MOTION_B_RECTS.wreckGantry ? 1.2
          : rect === MOTION_B_RECTS.crateStack ? 0.62 : 0.95;
      return {
        kind: "shear",
        distance,
        side: -1,
        lateral: 34 + next() * 44,
        base: 0,
        width: (11 + next() * 5) * scale,
        height: (9 + next() * 4) * scale,
        phase: next() * Math.PI * 2,
        speed: Math.PI * 2 / 9.4,
        amplitude: 0.4 * (Math.PI / 180),
        rect,
        tint: 0x6c7a70,
        seed: next(),
      };
    },
  },
  {
    /**
     * A flock over the wetland, crossing the opening straight.
     *
     * The sheet holds three wingbeat frames. The card system fixes one rect
     * per card, so the frames are used as VARIATION ACROSS the flock rather
     * than animation within a card — nine birds, wings at three different
     * points, rocking on `shear`. At 30-60 m that reads as a flock beating,
     * which is the whole ask, and it costs no new card kind.
     */
    id: "OPENING_BIRD_FLOCK",
    batch: "airB",
    from: 44,
    to: 212,
    cards: 9,
    card: (distance, side, index, next) => ({
      kind: "shear",
      distance,
      side,
      lateral: 22 + next() * 30,
      base: 13 + next() * 15,
      width: 7 + next() * 6,
      height: 4.5 + next() * 3.5,
      phase: next() * Math.PI * 2,
      speed: Math.PI * 2 / (1.4 + next() * 0.5),
      amplitude: 6.5 * (Math.PI / 180),
      rect: [MOTION_B_RECTS.birdsA, MOTION_B_RECTS.birdsB,
        MOTION_B_RECTS.birdsC, MOTION_B_RECTS.gull][index % 4],
      tint: 0x4d564e,
      seed: next(),
    }),
  },
  {
    /**
     * Dry scud lifting off the deck, low and wide, the whole sector.
     *
     * The opening is currently gray fog at every height. This puts something
     * moving at ankle height where the eye is already looking — at the racing
     * line — without putting anything in front of it.
     */
    id: "OPENING_DECK_SCUD",
    batch: "airB",
    from: 6,
    to: 218,
    cards: 8,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 13 + next() * 12,
      base: 0.5 + next() * 1.1,
      width: 15 + next() * 13,
      height: 1.6 + next() * 1.2,
      phase: next() * Math.PI * 2,
      speed: 0.62,
      rect: MOTION_B_RECTS.dustScud,
      tint: 0xc3c2b4,
      seed: next(),
      alphaKind: "mist",
      alphaInitial: ALPHA_ENVELOPES.mist[0],
    }),
  },
]);

// ===========================================================================
// BITTERPAN — one new batch, appended to BITTERPAN_BATCHES
// ===========================================================================

export const BITTERPAN_BATCHES_B = Object.freeze([
  {
    id: "airB",
    meshName: "BP_LIVING_AIR_B",
    texture: "motionB",
    blending: "normal",
    depthWrite: false,
    fog: true,
    alphaTest: 0,
    lamps: false,
  },
]);

export const BITTERPAN_ZONES_B = Object.freeze([
  {
    /**
     * The salt devils get their own shape.
     *
     * SALT_DUST_DEVILS currently borrows `MOTION_RECTS.steam` — a soft round
     * water-vapour puff — for a dry column of lifted crust. This zone runs
     * the same four stations with the authored devil wisp instead: a narrow
     * leaning column, dense and granular at the base, thinning as it climbs.
     * The accepted zone is left in place and untouched; this layers over it,
     * so the review can compare and the older zone can be retired later
     * without disturbing the seeded stream in the meantime.
     */
    id: "SALT_DEVIL_CORE",
    batch: "airB",
    from: 340,
    to: 2290,
    cards: 8,
    card: (_distance, _side, index, next) => ({
      kind: "devil",
      distance: 340 + Math.floor(index / 2) * 640 + (index % 2) * 8,
      side: Math.floor(index / 2) % 2 === 1 ? 1 : -1,
      lateral: 56 + (index % 2) * 4,
      base: 1 + (index % 2) * 8,
      width: 7 + (index % 2) * 2.5,
      height: 13 + (index % 2) * 5,
      phase: (index % 2) * 1.1 + Math.floor(index / 2) * 0.4,
      speed: Math.PI * 2 / 7.5,
      amplitude: 3.1 + (index % 2) * 1.2,
      hang: 11,
      rect: index % 2 === 0 ? MOTION_B_RECTS.devilWispA : MOTION_B_RECTS.devilWispB,
      tint: 0xe4dcc6,
      seed: next(),
    }),
  },
  {
    /**
     * Crust scud across the long pan. Wider and lower than the heat shimmer
     * it sits under, so the two do not read as one effect at two opacities.
     */
    id: "PAN_CRUST_SCUD",
    batch: "airB",
    from: 180,
    to: 2100,
    cards: 10,
    card: (distance, side, _index, next) => ({
      kind: "mist",
      distance,
      side,
      lateral: 24 + next() * 40,
      base: 0.3 + next() * 0.9,
      width: 26 + next() * 22,
      height: 2 + next() * 1.6,
      phase: next() * Math.PI * 2,
      speed: 0.5,
      rect: MOTION_B_RECTS.dustScud,
      tint: 0xf0e9d8,
      seed: next(),
      alphaKind: "shimmer",
      alphaInitial: ALPHA_ENVELOPES.shimmer[0],
    }),
  },
]);
