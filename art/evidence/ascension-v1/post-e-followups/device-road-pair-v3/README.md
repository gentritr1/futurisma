# Device road comparison and Shield signal proposal

## Executed and observed

`scripts/visual/ascension/device-review.mjs` uses private headless Chrome on port 5200. The fixture loads the production Ascension road, environment, fog, lighting, tone mapping and current device GLB. The device is translated at its original scale to the Tank Farm road edge for inspection. No production asset or gameplay rule is changed.

The close inspection uses a 1.6 m eye height, 2.35 m horizontal stand-off and 62-degree vertical field of view. The whole device must remain inside the frame; the capture script asserts this from projected mesh vertices. This replaces the earlier high, isolated asset card. The generated hero has no camera metadata: its physical distance cannot be recovered, so the three-quarter framing is a manual approximation, not an exact matched-camera claim. Backgrounds still differ because the hero is a concept image while the new model capture uses the real course.

The second comparison uses the same measured camera and target for both conditions, on the actual road curve, 120 m horizontally from the device and 2.4 m above the road. Both use the production fog and tone mapping. The marker prototype's materials participate in both. The existing sky retains its approved horizon-haze treatment. There is no fog bypass or bloom added to the device or marker.

Four expected frames, four posted, count residual zero. Static station captures have no sampling-rate window. The private key also holds the complete camera records; its SHA-256 commitment is public. Neither the earlier phase classification key nor station-pair key has been opened or scored.

## Proposed signal — not an acceptance claim

Retain **cyan emissive glass as the Shield-specific functional colour**. Keep sodium amber for the facility lamps. Pair colour with a **closed shield outline**, so identification does not depend on distinguishing cyan from amber alone.

At 120 m the small machine and its lamp are insufficient as the sole cue. Proposed cradle hardware carries a 2.4 m wide, 3.2 m high marker: a broad off-white shield border around cyan glass on a dark olive backing, centred 4.2 m above the road. It shares the device's shield symbol and colour. It is steady, with no pulse, shake or flicker in either motion setting. This preserves the existing Shield convention and adds a shape cue, rather than substituting another generic amber light. The hero's amber functional lamp is therefore superseded as a proposal detail; the first pair remains a construction comparison.

The second pair previews this cue through the actual fog. The marker is an unshipped review fixture, not finished cradle art. Recognition at 120 m, support construction, safe final placement, at-speed readability and the eventual production draw cost remain unproved. No reduction of the road width or live collision change is proposed. If selected, the supports belong outside the driving corridor and the finished hardware needs its usual clearance/budget checks.

The generated hero previews were already visible, so this is not claimed to be an independently source-blind test. A/B assignments and per-frame source records nevertheless remain withheld until the user's answers. Review preference and confidence can be recorded in `index.html`.

## Other status

The user independently accepted the restored STAGE1/STAGE2/v1.0 archive checks. Gap 9 is closed for those three; the seven other provenance inputs remain missing as listed in the recovery report. The shared HUD edits were preserved. No pull, rebase, main merge or next-level work was performed during this follow-up. TypeScript was checked; no full `test:code` pass is claimed while the HUD validation fix is pending.
