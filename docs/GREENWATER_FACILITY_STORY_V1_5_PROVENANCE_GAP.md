# Greenwater Facility Story v1.5 — provenance gap

Recorded: 2026-08-28

The accepted deterministic final freeze remains present and byte-locked:

- `artifacts/GREENWATER_FACILITY_STORY_v1.5.zip`
- SHA-256 `118bc6f00f4db5d5ec18ec805d0738aa672765a849b2f2169ccb1a47ad8ca2a9`
- 185 entries / 184 manifest records
- `final_v15_freeze: true`

The exact accepted review archive is not available locally. Its historical
identity remains locked and is not re-baselined:

- `GREENWATER_FACILITY_STORY_v1.5_REVIEW.zip`
- SHA-256 `4c1b2ddd9cd5fc1fd50899c5caa5f1cc3440d6d4a824acd17c235f2e61723123`
- 185 entries / 184 manifest records

The similarly named ZIP that was later supplied is not that accepted review.
It is retained under `artifacts/quarantine/` with SHA-256
`4c1f3da466d6ffdbe58e6990f78cd74a27946aec90b0a1b3d91a29359768c955`.
Its CRC and manifest pass, and every production payload is byte-identical to
the accepted final freeze, but its packaged
`source/greenwater-facility-story.html` is the final-freeze source. It contains
the final-freeze emit path that the original review source did not contain.
It must never be presented as the accepted review.

Local validation therefore performs three explicit checks:

1. The accepted final freeze, every manifest record and every production byte
   remain locked.
2. The quarantined candidate remains locked to its rejected hash and its exact
   source defect remains demonstrable.
3. The missing accepted review hash remains recorded as unavailable, not
   silently replaced by the quarantined candidate.

Recovering the historical review requires either the exact accepted archive or
the original pre-freeze HTML bytes. Until then, the accepted final freeze is
the local runtime authority. No Greenwater asset is re-baselined by this record.
