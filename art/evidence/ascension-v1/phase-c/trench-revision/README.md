# Phase C first commit: review corrections

The user accepted B mangroves, crawler, platform with notes and the 110-draw budget. The B trench blind test failed 9/13. This commit addresses that failure and the requested platform and canopy notes; it does not claim a new blind pass.

`blind-review/index.html` contains thirteen shuffled, HUD-free frames regenerated with `scripts/visual/ascension/stations.mjs` and packaged by `scripts/visual/ascension/blind-pack.mjs`. The ten regular positions and three transition cameras (32 m before the boundary) are unchanged. The answer key remains outside the pack. Awaiting user classification before revealing it.

`art/blender/ascension_trench.py` uses four contiguous zones at measured distances 0, 180, 440, 700 and 906.335975720997 m. Zone lengths are 180, 260, 260 and 206.335975720997 m. These are spatial measurements, not temporal samples. The existing concrete atlas is unchanged: the scorched lining selects its dry cracked upper region instead of its algae waterline, with explicit height bands for the heat gradient. Drain covers are solid metal. One of four cage lamps survives. The floor has blackened shoulders and a pale scoured centre strip. Three portal frames have nominal 24 m clear width and an underside above 11 m.

`validate-ascension-painted-corridor.mjs` executed 15,179 spatial probes, with zero hits below 9 m. This covers the authored static GLB, not the future animated event sweep or runtime terrain. `npm run build` passed. Capture script reported no browser errors.

The rocket has olive booster paint, four smaller diagonal fins and stronger soot on its exhaust lip. Canopy paint is muted toward the Greenwater atlas and placement uses a local deterministic jitter independent of the racing RNG.

No new raster generation was needed: all six existing painted atlases and the Greenwater foliage image are unchanged. Old B evidence and unrelated Dream Island files are preserved. Full event clearance, event luma, timings, budget and reduced motion will be checked during Phase C; no dynamic-event acceptance is asserted by this commit.
