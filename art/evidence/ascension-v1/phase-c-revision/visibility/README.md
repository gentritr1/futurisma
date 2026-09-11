# Launch visibility revision

Executed: `scripts/visual/ascension/launch-visibility.mjs` ran the seeded Works Deluge Road demo with the normal chase camera. `frames/` and `masks/` contain one pair for every scheduled capture from T-0 through T+20. Only the persistent plume is removed for the comparison render. A pixel counts when a colour channel changes by at least 3/255; cloud glow, steam and canopy motion are unchanged between the paired renders.

Observed: 201 of 201 frames contain plume pixels (100%, requirement 60%). Simulation reconciliation is 20 s × 10 Hz + one inclusive endpoint = 201, residual zero. Actual capture wall time was 26.587 s: its equivalent 10 Hz count would be 266.87, residual −65.87. PNG encoding and the extra mask renders slow wall time; this run is not a performance benchmark. `scripts/visual/ascension/reconcile-launch.mjs` produces the reconciliation from `claim.json`.

The video is the saved simulation-clock frames at 10 Hz: 201 / 10 = 20.1 s including the final endpoint's 0.1 s hold. It has no audio; Phase D remains separate.

Calculated, not image-classified: the central column's top crosses 25° at T+0.9 s and is 74.031° above the horizon at T+3 s for this driving camera. These are world-space extent calculations, not a segmentation estimate of the visible top. The spreading plume is fixed in world space across all azimuths, with a lower cloud underside visible in forward chase views; this single driving run is not an exhaustive heading sweep. Human launch-art acceptance remains open.

Implementation: cloud-deck flame glow lasts four simulation seconds before the shared tone mapping; the canopy ripple arrives at each tree after its distance from the pad / 343 m/s. Matching audible arrival belongs to Phase D. Accepted route and trench paint are unchanged. `npm run build` passed. No solid moving geometry changed; the prior clearance evidence remains applicable to those solids.

Earlier pale/high-cloud trials are local at `/tmp/ascension-launch-trials/`; they are not this claim's inputs. The original C2 evidence remains intact.
