# Next design review — research complete, external critique pending

2026-09-12. Starting revision `aad5942`, with the previous map-polish follow-up still uncommitted. This document is Codex's provisional design judgement. **Fable has not reviewed or endorsed it.**

## Files added / changed

- This brief: feature shortlist, a playable paper trial, map priorities, and tool/skill findings.
- `fable-review.json`: failed Claude authentication response, despite the filename; it contains no design review.
- `fable-prompt.txt`: the bounded, read-only request prepared for the exact requested model.
- No production code, assets, registrations, physics, schedules, or budgets changed in this research pass. Previous city optical changes remain in the working tree.

## What the game needs next

VERIFIED by reading `PRODUCT.md`, `README.md`, `src/game/race-modes.ts`, `src/game/save-schema.js`, `src/game/result-presentation.js`, and `src/game/ui.ts`: existing race formats, fixed rival tiers, powers, drafting, clean gates, near passes, records, and supported-map ghosts already provide substantial moment-to-moment play. They should not be advertised as new features. The inspected result/save flow has no championship standings or contract progression.

DESIGN HYPOTHESIS: the largest opportunity is giving players a reason to carry a result into the next circuit. The current maps already supply variety; a short championship could make that variety matter. The proposals below are untested, and their ranking is editorial rather than a measured result.

| Priority | Feature and player loop | What makes it worth testing | Implementation risk / evidence needed |
|---|---|---|---|
| First | **Grand Tour:** enter a cup, race a fixed sequence, carry standings forward, decide whether to protect a lead or chase a rival. | Adds stakes between existing races; gives unfamiliar maps a purpose. | Stable racer identities, finish ingestion, duplicate-finish protection, reload/resume and save migration. Keep rival pace fixed. Test whether players voluntarily continue after a poor opening result. |
| Next | **Circuit contracts:** select one optional driving goal before launch, see its verdict after the race. | Makes an existing mechanic worth practising without changing the vehicle. Start with a goal supported by an existing result statistic. | A draft-then-pass sequence needs event order and rival identity; aggregate drafting time cannot prove it. Thresholds must come from observed human runs. Test whether the goal changes an intentional driving decision and remains understandable without audio. |
| Later | **Rival duels:** nominate an existing rival for a series and compare finishes. | Gives the field a remembered opponent and makes overtakes personal. | Depends on stable identity and cup records. No rubber-banding. Test whether players recognise and deliberately pursue the rival without extra HUD clutter. |
| Later | **Circuit mastery passport:** record meaningful feats involving each map's existing mechanics, with cosmetic recognition. | Encourages learning the tide route, gravity choice, launch or power timing. | Those feats need explicit observers; neither a best time nor a screenshot proves them. Avoid vehicle-stat rewards and arbitrary grinding. Test whether players learn the map rather than farm a counter. |
| Optional | **Race postcards:** save a composed image from the actual game after a finish. | Rewards enjoying the environments and makes runs shareable. | A photo feature is not a replay system. Requires capture/UI work and accessible controls. Use genuine game renders; generated promotional footage is a separate deliverable. |

## Playable paper trial: Grand Tour

This is ready for a person to try with the current build, without installing anything. These are **authored prototype rules**, not measured balance values or approved production requirements.

1. Race Greenwater, then Night Shift, then Dream Island in Field Race, Works tier, using each course's standard race length. Keep the same vehicle/livery and controls. Do not pin Dream Island's lighting or alter its schedule.
2. Award four points for first, three for second, two for third, and one for fourth. Record the full displayed classification after each round. Use stable displayed racer names; if identity differs between courses, stop the standings test and record that mismatch rather than silently matching positions to names.
3. Carry each racer's score forward. Do not replay an unfavourable finish. Highest total wins; break a tie by the final round's finishing order. A technical interruption can restart the unfinished round and earns no duplicate points.
4. After the opening race, write down who leads and what you intend to do differently next. After the final race, record whether the standings affected any driving decision and whether you want another cup.

| Racer (copy displayed identity) | Greenwater points | Night Shift points | Dream Island points | Total |
|---|---|---|---|---|
| Player | | | | |
| Rival | | | | |
| Rival | | | | |
| Rival | | | | |

Observe comprehension, whether a setback motivates a comeback, and whether the next-map transition loses interest. Do not treat completing the itinerary as proof of fun. If carrying standings adds no interesting decision, revise the cup before adding persistence or more content.

For a later implementation, `GameUI.showResult` already receives position and standings, whereas `RaceModes.recordFinish`'s result summary does not contain the full classification. An explicit adapter around the existing result seam is worth investigating; do not scrape rendered text or extend frozen `game.ts` to conceal that missing contract. A cup controller would need to record a finish exactly once, resume without awarding twice, and keep ordinary records valid. The initial bundle must pass the existing gate before shipping; lazy loading alone does not establish that it fits.

## Map art priorities

VERIFIED visual basis: inspected the previous pass's [contact sheet](../map-polish-review/contact-sheet.jpg). These are stationary samples, not new captures or complete event coverage. Qualitative proposals below are UNVERIFIED until seen at driving speed.

| Map | Observed opportunity | Focused art experiment |
|---|---|---|
| Greenwater | Isolated vegetation and sparse verges weaken its humid industrial identity. | Test a coherent verge cluster around existing infrastructure. Preserve negative space and course edges; no corridor intrusion. |
| Bitterpan | The open salt landscape reads clearly but has little close landmark detail. | Test one memorable maintenance/survey structure at an existing focal area. Preserve the emptiness that differentiates the course. |
| Night Shift | Repeated window grids and similarly shaped facades flatten district identity. | Replace a selected facade treatment with a distinctive service-bay silhouette or industrial frontage, using the current material language. |
| Polarity | Gravity structures read, while broad architectural faces are plain. | Resolve the existing draw-budget gap before additive art. Prefer replacement/merging and clearer landmark silhouettes. |
| Tideline | Enclosures and materials are distinctive; dark passages warrant player feedback. | Observe recognition at speed before changing brightness. Any later adjustment needs matched-frame measurements. |
| Ascension | Long approaches have bare terrain and little foreground scale. | Test an approach landmark tied to launch infrastructure, preserving launch clearance and sightlines. |
| Dream Island | Strongest day/night contrast in these views, with its approved landmark kit present. | Human playtest only for the closed E4 items. No new generation or controller work on this map. |

## Higgsfield: documented capability versus local access

VERIFIED documentation: [Higgsfield's Blender page](https://higgsfield.ai/plugins/blender) describes editable scene building, image insertion, and Meshy-based 3D generation. Its regular MCP generates assets; a separate Bridge connects the agent to the Blender add-on and open scene. The local Blender version is within the page's supported range. This establishes a possible workflow, not tested mesh quality.

UNVERIFIED local access: the connector installation request was confirmed but returned `completed: false`; no Higgsfield tools became callable. No matching local Blender add-on or Higgsfield MCP configuration was found in the inspected locations. No generation was run and no credits were spent through Higgsfield by this task.

Suggested first art trial after connection: one Greenwater industrial verge landmark, based on actual game frames and existing materials. Establish the scale, pivot, placement and available scene budget first. Use the output as a candidate for Blender cleanup or manual reconstruction; remap to the game's atlas/material contracts, inspect shadow cost and corridor clearance, and compare the rendered result at the same camera pose. Require a known-cell atlas proof for each new consumer. Keep the approved colour/lighting treatment until measurements justify a change. A generated mesh is not accepted merely because it imports successfully.

Use video generation for a clearly labelled concept or promotional shot only if wanted. It cannot validate gameplay, performance, collision or a playable event.

## GitHub skills inspected

These are source-reviewed candidates, **not installed skills or a security audit of their repositories**. No third-party hooks or executable helpers were enabled. The registry search command failed with a network lookup error; direct GitHub source inspection supplied the findings.

| Skill | Useful part for FUTURISMA | Adaptation needed |
|---|---|---|
| [Game design — saschb2b/skills](https://github.com/saschb2b/skills/blob/main/skills/productivity/game-design/SKILL.md) | Structured examination of player loops, patterns and tradeoffs. | Apply engine-neutral reasoning; framework names and precedent are not proof that a feature is fun here. |
| [Create game assets — gamedev-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/create-game-assets/SKILL.md) | Style consistency, technical constraints, asset families and in-game inspection. | Bind the workflow to this repository's existing atlas, scale, render and evidence contracts. |
| [Game feel — gamedev-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-feel/SKILL.md) | Feedback tied to meaningful events, followed by actual play verification. | Reject generic hitstop, knockback and large camera-shake recipes for this frozen, readability-first racer. Suggested values are not calibrated values. |

A narrow selection is preferable to loading a whole game-development pack: these cover decisions, assets and feedback without introducing an unrelated engine workflow.

## Fable 5.1 advisor

VERIFIED: Claude Code is installed. The exact model identifier `claude-fable-5-1` is listed in [Anthropic's documentation](https://platform.claude.com/docs/en/models/fable-5-1/overview). The read-only request was attempted with that identifier, safe mode, Read tools only, and no session persistence.

BLOCKED: the network-enabled attempt returned `Failed to authenticate: OAuth session expired and could not be refreshed`. The result records empty model usage and zero billed cost. The CLI also warned that its model recogniser did not recognise the identifier; account access and successful execution remain unverified until an authenticated request completes. No substitute model was used.

After the user signs in through Claude Code `/login`, retry the saved request and verify the returned model usage. Then give Fable this concrete brief for a second critique: what should be cut, what the player actually decides, and which proposed asset improves recognition in the captured frame. Preserve its actual responses and any disagreements. Reconsult it after a real prototype or render exists. Its taste can inform choices; player observations and this repository's instruments still decide whether the result works.

## Numbers this pass measured for the first time

No new gameplay, rendering, colour, audio or timing measurements were made in this research pass. Local capability probes observed Claude Code `2.1.251` and Blender `5.2`; the failed Claude result reports zero input/output tokens and zero billed cost. The paper-trial scoring and course count above are explicitly authored choices, not instrument readings.

## Budget before / after, validation and open gaps

The following numbers are carried forward from [the preceding measured report](../map-polish-review/README.md), not fresh measurements. This research pass changes no runtime inputs, so it does not claim a new build or soak.

| Instrument / metric | Last measured | Change this research pass | Existing ceiling |
|---|---:|---|---:|
| `validate-build.mjs`: initial shell gzip | 283,639 B | No runtime change | 283,648 B |
| `validate-build.mjs`: initial JS gzip | 271,472 B | No runtime change | 272,384 B |
| `neon-race-review.mjs`: Polarity combined draw peak | 149 | No scene change | 145 |
| Approved Dream Island worst-tier evidence: combined draws / triangles | 105 / 162,334 | No map change | 110 / 180,000 |

Registration/asset checklist: no new registered assets, placements, atlas consumers or materials. Therefore no new atlas-cell, collision, rendered-pixel or audio claim. `test:code` and city soaks passed in the prior report, with the Polarity draw exception explicitly open; they were not rerun for this documentation-only addition. No new p95 or lap table is asserted here.

Left undone: Fable critique requires renewed Claude authentication; live Higgsfield/Blender testing requires completed connections; feature fun requires a human trial. Production feature implementation and generated asset acceptance remain unstarted, with the frozen game/physics rules and unchanged ceilings still binding. Dream Island E4 remains closed by ruling. Nothing committed.
