# Tideline — MAP 05 / Tide revision 3

A 2,073.8 m continuous road through a sealed underwater air chamber and a working port. Water remains outside the glazing; road caustics are transmitted light, and particulate is placed beyond the chamber walls. The former two air spans, Pelagic Crown and floating corridor beacons are removed from the playable map. There are eight ordered gates, a three-lap default, a 24 m main road and no authored roll. The steepest main-road pitch is 5.54 degrees. Existing `edition=foundry` links open this rebuilt map.

## The published tide

| Lap | Level | Racing effect |
|---|---:|---|
| 1 | 0 m | Reactor flooded. A seeded, visibly lit current lane returns nitro at 1.85× normal recharge. |
| 2 | −15 m | A five-second drain lowers the exterior water. Condensation leaves a damp chamber deck. Exposed reactor grip is 0.70, or 0.82 on the cleaner center. The still-pressurized chamber road and the port retain normal grip. |
| 3+ | −27 m | The pump-hall sluices lift and the shortcut opens. Exposed reactor grip recovers to 0.94. Extra laps stay drained. |

The menu and HUD publish `1 FLOODED → 2 SLICK → 3 PUMP HALL`. The default three-lap format includes all phases; sprint finishes after the ebb. Space/Shift use nitro and E deploys Surge or Shield. There are no gravity transfers on Tideline.

`tideline-tide.js` owns the schedule. Water interpolation is driven by the 120 Hz ability clock, with no wall-clock randomness. Pause freezes the water, lamps and steam; reset restores lap one. Drain changes sound once per transition. The ambience field adds steel hull creaks, drips, water and pump throb; the pumps rise as the water falls. World light emission follows the waterline. Reduced motion freezes decorative water/lamp motion and hides exterior particulate, drainage sheets and steam while preserving the tide state.

## A real shortcut

The branch leaves at progress .055 and rejoins at .270. Its 422.7 m physical road replaces 445.9 m of main route, saving 23.2 m. It is 20 m wide, follows an enclosed pump hall and opens on lap three. Both paths cross the same ordered gates; neither bypasses a checkpoint. Recoveries return to the last valid main-road gate.

Lap-one/two projection stays on the main road. Painted retractable rails mark both closed mouths; they lower in two seconds on lap three, before the craft arrives. Two sluices sit deeper in the separated hall and lift over five seconds, clear of the main road on every lap. Lap three chooses the nearby physical branch using a bounded progress hint. The main road stays valid throughout. Pickup capsules and phase fields sit outside the fork interval, so a branch driver cannot collect or strike devices through the other road's walls. Fleet interaction distances use the actual lateral separation from the main road; drafting, cushion contact and close-pass rewards are suppressed on the separated branch. AI rivals currently remain on the main road.

The minimap caches both routes, dims the closed branch and highlights it in amber when open. The player marker follows the actual chosen road. The demo driver follows the chosen branch’s tangent and lateral center line, rather than correcting back toward the wider road.

## Art and assets

[The painted-art handoff](TIDELINE-FOUNDRY.md) covers the six role atlases, Blender rebuild and side-by-side acceptance. The map uses warm concrete, oxidized steel, swamp green and sodium amber. Painted texture detail carries the age; fog carries depth. No bloom or PBR detail maps are added.

## Tide revision 3: visible water, working lights

The pressure-glass roof, structural ribs and dark panel gaskets share the same profile. A sampled union mask keeps the outside water surface out of both road chambers and their shared mouths. The flooded view has exterior shafts, suspended particulate and projected caustics. After the drain, the cloudy refinery horizon appears through the same glass. Historic wet/algae bands mark the retaining walls; a shaped mud bed, remaining pools and a stranded workboat emerge outside.

Four reusable point lights illuminate the nearest lamps, with preference for lamps ahead. The road now uses the Lambert lighting path. Painted road pools, wall cones and puddle reflections extend the light without increasing the real-light count. The reflections are painted approximations, not mirror or ray-traced reflections. Macro wear, concrete repair patches, skid marks and worn gate arrows interrupt tiling.

Two Blender crane booms slew, suspended cables sway, steam pulses on the pump rhythm, exterior sluice sheets accompany the five-second drain, a ferry crosses the deep channel on the final lap, and gulls circle the quay. All motion uses the race clock and obeys pause/reduced motion. Existing ambient audio and private music remain on their existing buses.

[Three matched camera pairs](../../art/evidence/tideline-v3/tide-phase-pairs.png) and the [saved hero/model comparison](../../art/evidence/tideline-v3/gantry-hero-versus-model.png) survive without a server. The stale reference PNG is regenerated by the Blender builder. The legacy prototype manifest explicitly points to the active Foundry manifest, whose Crown and flight-lens counts are zero.

The fixed-camera lamp measurement uses the same seed, lap, station, camera and 24 × 24 road patches. Rec.709 luma was 108.18 under / 103.86 between lamps before (1.04×). The post-baseline target is 1.65× or higher; the revised result is 60.53 / 29.58 (2.05×). Lower ambient creates darker gaps. This isolates road lighting and excludes the transparent roof and water; it is not a claim about every pixel of a gameplay frame. See the saved measurement contract and frame hashes in `art/evidence/tideline-v3`.

## Checks and practical limits

- `validate:tideline`: continuous geometry, height-independent projection, ordered gates, recovery and deterministic rival pace at 60/120/240 Hz.
- `validate:tideline-runtime`: published schedule, monotonic drains, both routes, exposed grip, current recharge, power timing, pause/reset and equal fixed-tick outcomes.
- `validate:tideline-driving`: the production demo controller and handling functions drive the full separate hall from −3, 0 and +3 m entry offsets with no edge contacts. Without traffic or powers, the section takes 6.383–6.392 seconds through the hall versus 6.658 seconds on the main road, a 0.267–0.275 second advantage.
- `validate:tideline-foundry`: exported geometry and triangle-interior clearance against both routes, embedded atlases and render budgets.
- `validate:tideline-environment`: varied/broken ribs, absent air landmarks, actual water and lamp shaders, reduced motion and continuous chamber/water clipping and cleanup for all four partial-load failure orders.

Revision 2 baseline browser checks, 5 September 2026, seed 3868938316, Works field: all three laps completed in 27.492 / 25.117 / 25.867 seconds, with zero missed gates or recoveries and 4.175–4.183 seconds on the separated pump-hall road. No browser console errors or warnings were recorded. The 95th-percentile frame time was 9.2–9.3 ms on the test machine. Three impacts were recorded outside the shortcut. Traffic and lap conditions make this a completion check, not an isolated shortcut speed comparison. All six ambience buses were active and the private Rob Playford mix was playing. The final sluice placement was separately checked across its full width against the main road; music balance still benefits from listening on the player's setup.

Ghost playback is disabled here because its existing format cannot record the tide phase and branch. Local records remain available. Powers are replayable and the tide schedule is deterministic, but online sessions and a shared multiplayer race clock are not implemented. AI branch selection is also future work.

Revision 3 production-browser run: all three laps finished in 27.492 / 25.117 / 25.867 seconds, zero missed gates or recoveries, three impacts outside the separate branch, and 4.183 seconds on the pump-hall shortcut. No browser errors or warnings were recorded; p95 was 10.1 ms on this machine. The environment reported 98,248 triangles, below its 100,000-triangle cap. `production-race.json` contains the raw DOM diagnostics. A final flooded-road bounce/caustic adjustment was subsequently checked for shader errors at all five fixed stations; it changes neither geometry nor simulation.

The independent first blind review classified all ten saved frames correctly, with tentative answers on the open-port pair. Follow-up visual reviews and their qualifications are preserved in `independent-review.md`; the port is less decisive in isolation than the underwater chamber. The gantry's five shared visible details passed independently. These are visual findings, separate from the passing code gate.
