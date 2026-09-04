# Polarity / Map 04

Polarity is a late-night magnetic interchange with a 2,173.9 m lower loop and a 2,040.3 m upper route, 22 m overhead. Crown Express and Skyline Express together shorten the upper circuit by about 133 m. Cyan edge lighting and dashed minimap lines identify the upper routes; amber identifies the lower road.

The two decks now offer a deliberate tradeoff. The lower road is 24 m wide, supplies full-charge devices and grants 1.15× passive nitro recharge. The upper road is 16 m wide, takes the express bypasses and grants .55× recharge; its devices have 65% charge. Staying lower is a complete racing route. Gravity transfers are optional.

| Control | Action |
| --- | --- |
| Space / gamepad X | Request a gravity transfer at a signed Polarity junction |
| Shift / gamepad A | Hold nitro |
| E / gamepad B | Activate the held device |

There are four directed junctions per lap: Crown entry at 3.5–9%, Crown exit at 42.5–49%, Skyline entry at 54–60%, and Skyline exit at 92.5–98.5%. A junction can be used once per lap, in its marked direction. Six seconds must pass between transfer starts. Lower-to-upper transfers require the craft to be within 5.7 m of the centre, and the geometry must pass the aligned-road safety check. The HUD explains a denied transfer and shows the distance to the next appropriate junction. A player can remain on a deck instead of transferring.

Normal transfers use a 1.05-second analytic roll. In **SYSTEM OPTIONS → MOTION REDUCED** (or `?motion=reduce`), the craft and camera retain their current deck orientation until a fully opaque veil hides an instantaneous deck cut. There is no animated intermediate camera roll in that mode. The veil clears as the transfer settles. The six-second commitment remains the same in both modes.

The demo chooses one express excursion from the race seed, then repeats that route across the three laps: two transfers per lap, six per race. It does not alternate Crown and Skyline on adjacent laps, because a late Skyline exit followed by the next Crown entry would violate the six-second minimum hold. A new normal session can choose a different seed and express route.

Surge adds acceleration while thrust is held, with a 140 m/s ceiling. A full-charge device lasts three seconds; an upper-route 65%-charge device lasts about 2.79 seconds. Activating Surge inside a painted launch strip adds one second. Lower launch strips are at 10.5–12%, 52–53.8%, and 89.5–91.5%. The HUD displays **PERFECT NOW** while the held Surge can earn the bonus.

Phase Shield lasts five seconds. It permits passage through a visible orange phase field. Absorbing a field in the first 1.2 seconds after activation returns 18% nitro reserve and adds two seconds of shield duration, capped at seven seconds remaining. A later absorption returns 6% reserve. Each field rewards only once per lap; holding contact cannot repeatedly pay out. Steering around the field remains available.

Devices replenish each lap. Two seeded supply patterns alternate between laps; the rendered device kind and **SUPPLY A/B** readout match the selected pattern. Field locations do not randomly change. Pause freezes ability clocks, recovery preserves the lap's collected-device and used-junction history, and restart preserves the session's seed. The shared rules and their limits are documented in [Ability protocol](ABILITY_PROTOCOL.md).

The city, ship enhancement and collectible machines have Blender sources and saved scenes under `art/blender/`, including `polarity_station.blend`, `totem_evolution.blend` and `power_kit.blend`. The ship has a rotating rear turbine, layered exhaust, brake/reserve/gravity indicators and visible device state. Decorative motion respects reduced-motion settings. The original ship and rival asset contracts remain intact.

Night Shift and Tideline are also available alongside Greenwater and Bitterpan. Tideline uses the same power rules with gravity disabled, and adds submerged current lines and guided flight gaps. Contact shadow blobs disappear over those flight gaps for both player and rivals. Authored rival pace remains independent of the player's speed.

Music combines the user's private mixes with the original 174 BPM **Meridian Afterimage**. The shared music slider, pause, mute and radio duck remain active. Private mixes are ignored by git; the original track uses no third-party recordings or samples. `?music=synth` selects the procedural score and `?music=0` silences music.

Polarity lap records work, but ghost recording/replay remains disabled on this circuit because the existing ghost format has no deck/transfer data. Ghosts remain available on the other circuits. There is no online multiplayer implementation.

Validation exercises real route projections and both deck bases, 133 m of shortcut savings, junction and corridor clearance, keyboard/gamepad edges, committed transfers, finite cameras, the reduced-motion cut, power timing, pause/recovery/coast, minimap, rival pace and ship animation. The pure ability gate checks seeded replay, JSON snapshot continuation, invalid snapshot rejection, lap guards and six demo transfers across varied seeds and speeds. The Tideline runtime gate exercises actual 3D course samples, stable camera horizon, current/recharge agreement and flight-gap shadow visibility. Legacy archive checks remain separate from the code gate.

The final integrated production-preview race on 2026-09-04 finished three laps in 86.108 seconds with exactly six gravity transfers. Lap times were 30.000 / 27.917 / 28.192 seconds (individual rounded lap times differ from the race total by 1 ms). It recorded zero missed gates, recoveries or context losses, six pickups and activations, three perfect launches and one shield absorption. The autopilot finished fourth against Works rivals, 12.309 seconds behind the leader; this is a functional completion check, not proof of competitive route balance. Observed local 95th-percentile frame time was 9.2–9.3 ms, with no browser warnings/errors. The earlier eleven-transfer result belonged to superseded rules and is not used as current evidence.
