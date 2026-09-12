# The capsule's rise — why 3.8 m and not 2.2 m

§11 item 5 asks for the capsule at instance scale ×2.2 and, in a parenthetical
about collision, describes it as hovering at 2.2 m. Both together do not work,
and this is the measurement that says so rather than an opinion about it.

`capsule.glb`'s tallest node, `CAP_cap`, reaches 1.5 m below its own centre. At
×2.2 that is 3.3 m, so a 2.2 m rise puts the capsule's lowest point at
**−1.1 m**: 1.1 m of it is inside the tarmac. `dreamisland-capsules.ts` reports
the number as `capsuleLowestAboveDeckMetres`.

| frame | rise | capsule's lowest point above the deck | capsule height at 40 m |
|---|---|---:|---:|
| `at-rise-2.2m-40m-crop.png` | 2.2 m (as §11 describes the existing state) | −1.1 m | 80 px |
| `at-rise-3.8m-40m-crop.png` | **3.8 m (shipped)** | **+0.5 m** | 81 px |

The acceptance §11 sets — 70 px at 40 m — is met either way, so the move costs
nothing and buys the reference painting's silhouette: a capsule floating over
the lane with its ring on the road beneath it, rather than one sunk into it.

Item 5's instruction is "scale the capsule instances ×2.2"; the rise is not part
of it, and the 2.2 m in the parenthetical is a description of the state before
this pass, written while arguing that the corridor rule does not apply to a
thing with no collision. It still does not: the capsule has no collision either
way.
