# Tideline — MAP 05 / Tide revision 2

A 2,073.8 m continuous road through a drowned reactor and a working port. The former two air spans, Pelagic Crown and floating corridor beacons are removed from the playable map. There are eight ordered gates, a three-lap default, a 24 m main road and no authored roll. The steepest main-road pitch is 5.54 degrees. Existing `edition=foundry` links open this rebuilt map.

## The published tide

| Lap | Level | Racing effect |
|---|---:|---|
| 1 | 0 m | Reactor flooded. A seeded, visibly lit current lane returns nitro at 1.85× normal recharge. |
| 2 | −15 m | A five-second drain exposes slick algae. Exposed reactor grip is 0.70, or 0.82 on the cleaner center. Still-submerged road and the port retain normal grip. |
| 3+ | −27 m | The pump-hall sluices lift and the shortcut opens. Exposed reactor grip recovers to 0.94. Extra laps stay drained. |

The menu and HUD publish `1 FLOODED → 2 SLICK → 3 PUMP HALL`. The default three-lap format includes all phases; sprint finishes after the ebb. Space/Shift use nitro and E deploys Surge or Shield. There are no gravity transfers on Tideline.

`tideline-tide.js` owns the schedule. Water interpolation is driven by the 120 Hz ability clock, with no wall-clock randomness. Pause freezes the water, lamps and steam; reset restores lap one. Drain changes sound once per transition. The ambience field adds steel hull creaks, drips, water and pump throb; the pumps rise as the water falls. World light emission follows the waterline. Reduced motion freezes decorative water/lamp motion and hides bubbles and steam while preserving the tide state.

## A real shortcut

The branch leaves at progress .055 and rejoins at .270. Its 422.7 m physical road replaces 445.9 m of main route, saving 23.2 m. It is 20 m wide, follows an enclosed pump hall and opens on lap three. Both paths cross the same ordered gates; neither bypasses a checkpoint. Recoveries return to the last valid main-road gate.

Lap-one/two projection stays on the main road. Painted retractable rails mark both closed mouths; they lower in two seconds on lap three, before the craft arrives. Two sluices sit deeper in the separated hall and lift over five seconds, clear of the main road on every lap. Lap three chooses the nearby physical branch using a bounded progress hint. The main road stays valid throughout. Pickup capsules and phase fields sit outside the fork interval, so a branch driver cannot collect or strike devices through the other road's walls. Fleet interaction distances use the actual lateral separation from the main road; drafting, cushion contact and close-pass rewards are suppressed on the separated branch. AI rivals currently remain on the main road.

The minimap caches both routes, dims the closed branch and highlights it in amber when open. The player marker follows the actual chosen road. The demo driver follows the chosen branch’s tangent and lateral center line, rather than correcting back toward the wider road.

## Art and assets

[The painted-art handoff](TIDELINE-FOUNDRY.md) covers the six role atlases, Blender rebuild and side-by-side acceptance. The map uses warm concrete, oxidized steel, swamp green and sodium amber. Painted texture detail carries the age; fog carries depth. No bloom or PBR detail maps are added.

## Checks and practical limits

- `validate:tideline`: continuous geometry, height-independent projection, ordered gates, recovery and deterministic rival pace at 60/120/240 Hz.
- `validate:tideline-runtime`: published schedule, monotonic drains, both routes, exposed grip, current recharge, power timing, pause/reset and equal fixed-tick outcomes.
- `validate:tideline-driving`: the production demo controller and handling functions drive the full separate hall from −3, 0 and +3 m entry offsets with no edge contacts. Without traffic or powers, the section takes 6.383–6.392 seconds through the hall versus 6.658 seconds on the main road, a 0.267–0.275 second advantage.
- `validate:tideline-foundry`: exported geometry and triangle-interior clearance against both routes, embedded atlases and render budgets.
- `validate:tideline-environment`: varied/broken ribs, absent air landmarks, actual water and lamp shaders, reduced motion and cleanup for both partial-load failure orders.

Production-browser checks, 5 September 2026, seed 3868938316, Works field: all three laps completed in 27.492 / 25.117 / 25.867 seconds, with zero missed gates or recoveries and 4.175–4.183 seconds on the separated pump-hall road. No browser console errors or warnings were recorded. The 95th-percentile frame time was 9.2–9.3 ms on the test machine. Three impacts were recorded outside the shortcut. Traffic and lap conditions make this a completion check, not an isolated shortcut speed comparison. All six ambience buses were active and the private Rob Playford mix was playing. The final sluice placement was separately checked across its full width against the main road; music balance still benefits from listening on the player's setup.

Ghost playback is disabled here because its existing format cannot record the tide phase and branch. Local records remain available. Powers are replayable and the tide schedule is deterministic, but online sessions and a shared multiplayer race clock are not implemented. AI branch selection is also future work.
