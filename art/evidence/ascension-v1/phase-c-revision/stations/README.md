# Countdown first-frame correction

Executed: `scripts/visual/ascension/stations.mjs --phase-b --out=art/evidence/ascension-v1/phase-c-revision/stations` captured 4 frozen states × 8 districts = 32 station images, plus 4 states × 2 boards = 8 legibility images; total 40, residual zero. These are discrete poses, not a time/rate sample. All captures completed with no browser errors.

The cache now starts undefined and resets to undefined. The launch fixture's first T+00:01 update therefore draws its texture. Both live and frozen paths use the same update. Previous station sets remain intact.

Observed GPU digit checks: all 8 passed. `review.ts` projects the digit/background sample locations into the actual rendered board and reads GPU pixels after its first render. Required: at least 15 digit samples, mean digit luma >80/255, and digit-minus-background contrast >8/255. Observed contrast range 45.60–78.70/255. This checks visibility/contrast, not OCR recognition. `capture.json` records every sample count and mean.

Negative control: `scripts/visual/ascension/board-first-update.mjs` restores the original −1 sentinel in the served module only. The black launch board failed as expected (zero digit samples); production files were not modified. `negative-control.json` records that result. `npm run build` passed.
