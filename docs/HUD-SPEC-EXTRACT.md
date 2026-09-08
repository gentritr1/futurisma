# FUTURISMA in-race HUD — visual spec (extracted from prototype)

Source: `FUTURISMA UI Prototype.dc.html` (the `showHud` block, lines ~68–204) plus
corroborating text in the sibling `HANDOFF.md` in the same folder. All pixel values
below are the prototype's **base/unscaled design values** — the whole HUD is scaled
as one unit by `hudZoom` (see §8). Colors are authored in `oklch()`; hex is used only
for a handful of one-off accents that were never migrated to oklch.

Ignored per instructions: Worker timer, simulated race-state (`PRESETS`, `BASE`),
review-state toolbar/harness, viewport switcher, pause/launch/controls/results/options
menu screens (only their `--menu-scale` mechanism is relevant, captured in §8).

---

## 1. Design tokens

### 1.1 Color object (`const C`, all in prototype JS)

```js
C.ink     = "oklch(0.93 0.015 205)"      // primary text/numerals
C.muted   = "oklch(0.72 0.025 205)"      // secondary text
C.dim     = "oklch(0.55 0.025 205)"      // tertiary / mono labels, empty pips
C.acid    = "oklch(0.89 0.22 123)"       // ACCENT 1 — lime/acid green
C.acidInk = "oklch(0.12 0.025 125)"      // ink-on-acid (dark, for text on acid fill)
C.cyan    = "oklch(0.86 0.13 210)"       // ACCENT 2 — cyan
C.cyanInk = "oklch(0.12 0.02 210)"       // ink-on-cyan
C.warning = "oklch(0.7 0.2 38)"          // ACCENT 3 — warning orange/red
C.line    = "oklch(0.42 0.035 205 / 0.7)"// borders / dividers
C.plate   = "oklch(0.16 0.016 205)"      // device slot dark plate fill
C.lavender= "#dabaff"                    // ACCENT 4 — device held-charge fill (hex, not oklch)
C.amber   = "#ffb47c"                    // ACCENT 5 — Polarity lower-deck bar (hex, not oklch)
C.upper   = "#82eee6"                    // Polarity upper-deck bar (cyan-family, NOT in the 5-accent list per HANDOFF)
C.tide    = "#9eecdc"                    // Tideline deck/travel color (NOT in the 5-accent list)
C.gust    = "oklch(0.88 0.15 78)"        // track-event "GUST" label color
C.salt    = "oklch(0.82 0.16 46)"        // track-event "SALT" label color
```

Per `HANDOFF.md` §2: *"Colour: existing five accents only, as solid surfaces where
they carry meaning"* — the five are **acid, cyan, warning, lavender, amber**. `upper`,
`tide`, `gust`, `salt` are additional one-off hues layered on top for Polarity/Tideline
deck bars and track-event chips; treat them as a secondary, non-canonical palette.

### 1.2 Backgrounds / plates seen in the HUD (not the pause/menu screens)

| Use | Value |
|---|---|
| Standing "lap" dark plate | `oklch(0.11 0.014 205 / 0.9)` |
| Gate-strip track background | `oklch(0.09 0.012 205 / 0.55)` |
| Nav-cue background (normal) | `oklch(0.1 0.014 205 / 0.9)` |
| Nav-cue background (urgent turn) | `oklch(0.12 0.03 38 / 0.94)` |
| Alert (safety) background | `oklch(0.12 0.03 38 / 0.94)` |
| Banner (reward) background | `oklch(0.1 0.014 205 / 0.92)` |
| Drive-cluster backing gradient | `linear-gradient(90deg, oklch(0.09 0.012 205 / 0.76), oklch(0.09 0.012 205 / 0.68) 80%, oklch(0.09 0.012 205 / 0) 100%)` |
| Device / gravity slot dark plate (empty) | `oklch(0.13 0.014 205 / 0.85)` (device) / `oklch(0.16 0.016 205 / 0.9)` (gravity, always this — gravity slot backing never changes) |
| Device plate when live | `C.plate` = `oklch(0.16 0.016 205)` |
| Minimap plate | `oklch(0.1 0.014 205 / 0.72)` |
| Global vignette (screen-wide, not a HUD block but sits under it) | `radial-gradient(circle at 50% 48%, transparent 46%, oklch(0.04 0.01 210 / 0.42) 100%)` |
| Boost-active wash (screen-wide) | `radial-gradient(ellipse at 50% 60%, transparent 55%, oklch(0.86 0.13 210 / 0.16) 85%, oklch(0.89 0.22 123 / 0.2))`, opacity 0→1 via `boostWashOpacity` |

### 1.3 Opacity values

- HUD root: `opacity: 1` racing, `0.75` on the pause screen (`hudOpacity`).
- Header block: `opacity: 0.6` racing, `1` on pause (`headerOpacity`).
- Drift lip on reserve meter: `opacity: 1` if `driftCharge >= 0.5`, else `0.35`.
- Soundtrack header text color carries its own alpha: `oklch(0.97 0 0 / 0.7)`.

---

## 2. Typography

Two font families only:

- **Barlow Condensed** (Google Fonts weights loaded: 500, 600, 700, 800 regular + 700, 800 italic) — all "hero" numerals, labels, and short action words.
- **Mono** — `SFMono-Regular, Consolas, monospace` — every precise/live value and every small caps label. (HANDOFF calls this "the repo mono"; there is no webfont load for it, it's a system stack.)

Fallback stack is **inconsistent in the prototype**: most Barlow Condensed rules use
`'Barlow Condensed', Inter, sans-serif`; five specific big/reflow-prone numerals
additionally chain through `'Arial Narrow'` before Inter:
`'Barlow Condensed', 'Arial Narrow', Inter, sans-serif'` — used only for the **speed
numeral**, the **boost %**, the **device name**, the **transfer action word**, and the
**resume countdown**. Flag this to the engineer as worth normalizing (probably every
Barlow Condensed HUD numeral should get the Arial Narrow fallback, per HANDOFF §1's
"fixed button heights keep layout intact if the font fails" note, which was clearly
intended HUD-wide).

### 2.1 Per-role sizes (exact, unscaled px)

| Role | Family | Weight/style | Size | Letter-spacing | Line-height | Extras |
|---|---|---|---|---|---|---|
| Position/TA tab numeral (`P2`/`TA`) | Barlow Condensed | 800 italic | 62px | −0.02em | 1 | counter-skewed span inside skewed plate |
| Lap word ("LAP"/"FINAL") | mono | 400 | 10px | 0.16em | — | color `C.dim` |
| Lap number | Barlow Condensed | 700 | 40px | — | 0.9 (row) | color varies (ink/acid) |
| Lap "/total" | Barlow Condensed | 500 | 22px | — | 0.9 (row) | color `C.muted` |
| Gap label (standing) | mono | 400 | 14px | 0.08em (parent) | — | tabular-nums |
| Ladder rows (pos/name/gap) | mono | 400 | 12px | 0.08em (parent) | 20px | tabular-nums |
| Timing tag ("RACE TIME"/"LAP TIME") | mono | 400 | 10px | 0.16em | — | on cyan plate |
| Time primary (36px clock) | mono | 600 | 36px | −0.02em | 1 | color `C.ink` |
| "VS BEST" label | mono | 400 | 11px | 0.14em | — | color `C.dim` |
| TA delta value | Barlow Condensed | 700 | 34px | — | 1 | color by tone |
| Gate sector delta | mono | 400 | 12px | 0.1em | — | color by tone |
| Time secondary line | mono | 400 | 12px | 0.1em | — | color `C.muted` |
| Gate/sector/finish row | mono | 400 | 12px | 0.1em (parent) | — | white-space nowrap |
| Sector name | mono | 400 | 11px | 0.14em | — | color `C.acid` |
| Nav cue label | mono | 400 | 14px | 0.1em | — | color `C.ink` |
| Nav distance | Barlow Condensed | 700 | 26px | — | 1 | tabular-nums, color by state |
| Alert text | mono | 600 | 14px | 0.1em | — | color `C.ink`, centered |
| Banner headline | Barlow Condensed | 700 | 24px | 0.04em | 1 | color `bannerColor` |
| Banner detail | mono | 400 | 12px | 0.08em | — | tabular-nums, color `C.muted` |
| Speed numeral (hero) | Barlow Condensed | 800 italic | **92px** | −0.02em | **0.82** | tabular-nums, `kickAnim` |
| "KM/H" unit label | mono | 400 | 11px | 0.12em (parent) | — | color `C.dim` |
| Drive-state label | mono | 400 | 13px | 0.12em (parent) | — | color `driveColor` |
| Boost label | mono | 400 or 700 (locked) | 11px | 0.14em | — | color `boostColor` |
| Boost % | Barlow Condensed | 700 | 24px | — | 1 | tabular-nums |
| Slipstream/track-event chip text | mono | 400 (600 for event) | 12px | 0.14em | — | |
| Device name | Barlow Condensed | 700 | 22px | 0.02em | 1 | |
| Device strength ("N% CHARGE") | mono | 400 | 11px | 0.1em | — | |
| Device state line | mono | 400 | **11.5px** | 0.1em | 1.35 | |
| Device/gravity key tab glyph | mono | 400 | 11px | 0.1em | — | on skewed chip |
| Gravity mid label (cooldown/junction/depth) | mono | 600 | 10px | 0.04em | — | |
| Deck tag ("UPPER EXPRESS · SUPPLY A") | mono | 400 | 10px | 0.14em | — | |
| Transfer action word | Barlow Condensed | 700 | 22px | 0.02em | 1 | |
| Transfer reason line | mono | 400 | 11.5px | 0.1em | 1.35 | max-width 268px |
| Resume countdown ("3"/"2"/"1") | Barlow Condensed | 800 italic | **160px** | — | 1 | skewed −7deg block, glow shadow |
| Header brand "FUTURISMA" | **Inter**, sans-serif (not mono, not Barlow) | 800 | 11px | 0.14em | — | only non-mono/non-Barlow HUD text |
| Header course name / status / lamp row | mono | 400 | 11px | 0.12em | — | color `C.muted`, text-shadow `0 0 4px oklch(0.09 0.012 205)` |

HANDOFF's own summary (§3) confirms the size *set*: **"Four HUD type sizes, all
`calc(N px * var(--hud-scale))`: 11–12 px mono label, 13–14 px mono body, 36 px mono
time, 62/92 px condensed numerals."** — i.e. treat 11–12px/13–14px/36px/62px&92px as
the four canonical tiers even though the table above shows finer per-element variance
(10, 10.5, 11.5, 14, 22, 24, 26, 34, 40, 160 all exist too — the handoff's "four sizes"
is a simplification, not exhaustive).

---

## 3. The parallelogram plate treatment

Core recipe, used everywhere a filled plate/tab/chip appears in the HUD (position tab,
lap plate, timing tag, key tabs, boost meter, slipstream bar):

```css
.plate      { transform: skewX(-10deg); }   /* on the filled/background element */
.plate > * { transform: skewX(10deg); }     /* counter-skew wrapper so the CONTENT stays upright */
```

- Skew angle is **exactly −10deg** on every plate in the HUD (also reused on menu
  buttons/tabs, same value, so it's a single global constant, not per-block).
- **Chamfer** (cut corner) treatment, used on the nav cue and reward banner instead of
  a skew, is done with `clip-path`:
  `polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)`
  — an 8px diagonal cut top-left and bottom-right. HANDOFF confirms: *"8 px chamfer on
  dark plates."*
- The minimap and the device/gravity slot SVGs draw the **same chamfer shape** as a
  polygon instead of clip-path, at their own coordinate scale:
  - Device/gravity slot (72×72 viewBox, rendered 56×56): `polygon(10,0 72,0 72,62 62,72 0,72 0,10)` — a 10-unit cut, which at 56/72 render scale ≈ 7.8px ≈ the "8px chamfer" spec.
  - Minimap (132×140 viewBox): `polygon(10,0 132,0 132,130 122,140 0,140 0,10)` — same 10-unit chamfer at native scale (minimap isn't downscaled the same way, so this reads closer to 10px).
- Padding on skewed plates: position tab `0 18px 0 16px` (asymmetric — more right pad
  than left); lap plate `0 18px 0 16px`; timing tag `3px 10px`; key tabs `2px 6px`.
- Box shadow: position tab only, `0 2px 0 oklch(0.3 0.05 205 / 0.5)` (a small drop
  ledge under the acid/cyan tab).
- Boost meter and slipstream bar are also skewed −10deg as a whole (the track, not
  just a label chip): `transform: skewX(-10deg)` on the 300×14 and 300×3 bars — their
  fill children are NOT counter-skewed (the diagonal stays on the fill too, it's a
  track/fill pair, not a text plate).

---

## 4. Per-block geometry

All coordinates below are children of the HUD root:
`position:absolute; left:0; top:0; width:hudW; height:hudH; zoom:hudZoom; pointer-events:none;`
(hudW/hudH = viewport size ÷ hudZoom, see §8 — i.e. these numbers are the *pre-zoom*
design canvas, always authored against a 1280×720-equivalent frame).

### 4.0 Header (top bar, not one of the 9 named blocks but part of the HUD)
- `position:absolute; top:0; left:0; width:100%; box-sizing:border-box; padding:12px 28px;`
- `display:flex; justify-content:space-between; align-items:center;`
- Left group: `display:flex; gap:12px; align-items:baseline;` → "FUTURISMA" (Inter 800) + course name (mono).
- Right group: `display:flex; gap:14px; align-items:center;` → optional soundtrack text, then a `display:flex; gap:8px; align-items:center;` status group: a 7×7px square lamp (`background:lampColor`) + status text.

### 4.1 `.hud-standing` — top-left, anchor `left:34px; top:48px`
- Outer: `display:flex; flex-direction:column; gap:10px;`
- **Row 1** (tab + lap plate + pips): `display:flex; gap:7px; align-items:stretch; height:66px;`
  - Position/TA tab: skewed plate, `padding:0 18px 0 16px`, background = acid (race) or cyan (time attack).
  - Lap plate: skewed plate, `display:flex; align-items:center; gap:14px; padding:0 18px 0 16px; background:oklch(0.11 0.014 205 / 0.9);`
    - Lap word/number column: `gap:2px`.
    - Lap number row: `display:flex; align-items:baseline; gap:3px; line-height:0.9;`.
    - Pips column: `display:flex; flex-direction:column; gap:4px; padding-top:14px;` each pip `width:10px; height:6px;` (filled = acid, empty = `oklch(0.42 0.035 205 / 0.7)`).
- **Row 2** (gap + ladder): `display:flex; flex-direction:column; gap:5px; padding-left:4px;` mono, `letter-spacing:0.08em; font-variant-numeric:tabular-nums;` double text-shadow `0 0 3px oklch(0.09 0.012 205), 0 0 8px oklch(0.09 0.012 205 / 0.8)`.
  - Gap label: `font-size:14px`.
  - Ladder grid (only when a field exists, i.e. not time attack): `display:grid; grid-template-columns:4px 28px 120px 56px; gap:0 10px; align-items:center; font-size:12px; line-height:20px;` — columns are: colored bar (4×12px), position ("P2"), name, gap (right-aligned).

### 4.2 `.hud-timing` — top-right, anchor `right:34px; top:48px`
- `display:flex; flex-direction:column; align-items:flex-end; gap:6px; text-align:right; font-variant-numeric:tabular-nums;`
- Time-label tag: skewed plate, `padding:3px 10px; background:cyan;`.
- Time primary (36px mono, weight 600).
- TA-only delta row (`display:flex; align-items:baseline; gap:10px; margin-top:2px;`): "VS BEST" + 34px delta value, optional gate/sector delta line below.
- Time secondary line (12px mono).

### 4.3 `.hud-gate` — top-center, anchor `left:50%; top:50px; width:500px; transform:translateX(-50%);`
- Row: `display:flex; justify-content:space-between; align-items:baseline; gap:20px; font-size:12px; white-space:nowrap;`
  - Left cluster: `display:flex; gap:12px; align-items:baseline;` → gate label, sector name (11px, acid), optional "CLEAN ×N" chain label.
  - Right: finish distance/name, `flex-shrink:0`.
- Track: `position:relative; height:4px; margin-top:7px; background:oklch(0.09 0.012 205 / 0.55);`
  - Fill: `height:100%; width:{progress%}; background:cyan;`
  - End marker (finish tick): `position:absolute; right:0; top:-3px; width:3px; height:10px; background:acid;`

### 4.4 `.hud-cue` (nav) — anchor `left:50%; top:136px; transform:translateX(-50%);`
- `display:flex; align-items:center; gap:16px; padding:8px 18px 8px 14px;` chamfered clip-path (8px, see §3), `white-space:nowrap;` background swaps to warning-tinted when the turn is urgent.
- Arrow (CSS triangle, turn mode): `border-top:9px solid transparent; border-bottom:9px solid transparent; border-left:14px solid warning;` rotated 180deg (LEFT) or 0deg (RIGHT).
- Diamond (finish mode, mutually exclusive with the arrow): `width:12px; height:12px; background:acid; transform:rotate(45deg);`
- Label (14px mono) + distance (26px Barlow Condensed 700).

### 4.5 `.hud-alert` / `.hud-banner` — shared anchor `left:50%; top:196px; transform:translateX(-50%);`
- Alert: `min-width:320px; padding:9px 18px; display:flex; flex-direction:column; gap:7px; text-align:center; white-space:nowrap;` border-left `6px solid warning`; background `oklch(0.12 0.03 38 / 0.94)` overlaid with a diagonal hazard tint (see §5c). Optional progress bar: track `height:4px; background:warning/0.25`, fill same warning solid.
- Banner: `min-width:260px; padding:9px 18px; display:flex; flex-direction:column; align-items:center; gap:3px;` same 8px chamfer clip-path as the nav cue; `border-top:2px solid bannerColor` (cyan); background `oklch(0.1 0.014 205 / 0.92)`.
- Only one of these ever renders (mutually exclusive, priority-gated — alert wins).

### 4.6 `.hud-drive` — bottom-left, `position:absolute; left:0; bottom:0; width:414px;`
- `box-sizing:border-box; padding:14px 40px 20px 34px;` background = left-to-right fade (opaque → transparent, see §1.2). `display:flex; flex-direction:column; gap:6px;`
- **Fixed 414px footprint = 34px left pad + 340px instrument column + 40px right fade pad** (verbatim from the prototype's own comment and HANDOFF §1).
- Chips column (conditional): `width:300px; gap:5px; margin-bottom:4px;` (see §7).
- Speed row: `display:flex; align-items:flex-end; gap:12px; width:340px;` — 92px speed numeral + unit/drive-state column (`gap:5px; padding-bottom:5px;`).
- Boost label/% row: `display:flex; justify-content:space-between; align-items:baseline; width:300px; margin-top:6px;`
- Reserve meter: `position:relative; width:300px; height:14px;` (see §5).
- Ability rows (device + gravity, conditional on `hasAbility`): `display:flex; flex-direction:column; gap:12px; margin-top:12px; width:340px;` each row `display:grid; grid-template-columns:56px 1fr; align-items:center; gap:16px;`.

### 4.7 `.hud-device` and `.hud-gravity` — see §6 for the 56px slot; text column is `display:flex; flex-direction:column; gap:4px (device) / 3px (gravity); min-width:0;`.

### 4.8 `.minimap` — anchor `right:34px; top:50%; transform:translateY(-50%);`, fixed `132×140` SVG, `viewBox="0 0 132 140"`.
- Chamfered backing polygon `10,0 132,0 132,130 122,140 0,140 0,10` fill `oklch(0.1 0.014 205 / 0.72)`.
- Track: rounded rect `x22 y16 width88 height108 rx30`, stroke `oklch(0.55 0.025 205)` width 2.5, no fill (outline only).
- Finish tick: rect `x63 y118 width6 height12` fill acid.
- Player dot: circle `cx52 cy123 r3` fill ink.
- Two rival dots (static in this prototype, not data-driven): `cx108 cy70 r3` and `cx106 cy48 r3`, both fill muted.

### 4.9 Resume countdown overlay (not in the 9-block list but a HUD-layer element)
- `position:absolute; left:50%; top:42%; transform:translate(-50%,-50%) skewX(-7deg);` — note the **different skew angle** (−7deg, not the standard −10deg).
- 160px Barlow Condensed 800 italic, `text-shadow:0 0 12px oklch(0.86 0.13 210 / 0.38)` (cyan glow).

---

## 5. The reserve (boost) meter

Track element: `position:relative; width:300px; height:14px; transform:skewX(-10deg);`

### 5a. Idle/ready background (the "acid dashed band")
```css
background: repeating-linear-gradient(90deg,
  oklch(0.8 0.02 210 / 0.16) 0 22px,
  transparent 22px 25px);
```
→ **22px dash, 3px gap, 25px pitch, horizontal (90deg), very low-alpha cyan-grey**
(this is the empty-track texture, not the fill).

### 5b. Fill (the actual dashed acid/cyan band that reads as charge)
Built by `SEG(color) = repeating-linear-gradient(90deg, ${color} 0 22px, transparent 22px 25px)` — **identical 22px/3px/25px dash geometry as the track**, just opaque and colored:
- Ready: `SEG(acid)`.
- Active (boost discharging): `SEG(cyan)`, plus `box-shadow: 0 0 10px oklch(0.86 0.13 210 / 0.5)` glow and the `ad-ignite` animation (brightness flash, see §9).
- Locked: **solid** warning fill (no dash pattern) — `background: warning` flat, not `SEG()`.

Fill element: `position:absolute; left:0; top:0; height:100%; width:{boostPct}%;`

### 5c. Lockout hazard stripe (replaces the track background entirely when locked)
```css
background: repeating-linear-gradient(135deg,
  warning 0 6px,
  oklch(0.2 0.05 38) 6px 13px);
```
→ **6px warning stripe, 7px dark stripe, 13px pitch, diagonal 135deg.** The same
diagonal hazard motif (different color/pitch) also tints the safety alert panel background:
```css
background-image: repeating-linear-gradient(135deg,
  oklch(0.7 0.2 38 / 0.18) 0 6px,
  transparent 6px 14px);
```
(6px band, 8px gap, 14px pitch, low-alpha, layered over the alert's solid `oklch(0.12 0.03 38 / 0.94)` background.)

Per the prototype's own preset notes: *"Lockout is carried by the TRACK: the whole
meter wears the hazard stripe... while the actual 3% reserve is still drawn truthfully
as solid warning fill."* — i.e. the stripe replaces the background/track, and the fill
width still honestly reflects the numeric reserve %, just recolored/de-dashed to
warning-solid.

### 5d. Drift lip
`position:absolute; left:0; top:-6px; height:3px; width:{driftChargePct}%; background:acid;`
- `opacity:1` once `driftCharge >= 0.5`, else `opacity:0.35`.
- `box-shadow:0 0 6px oklch(0.86 0.18 130 / 0.8)` glow, **only** once armed (`>=0.5`), else `none`.
- Sits 6px above the meter's top edge (a "lip" floating over the track), 3px tall vs the track's 14px.
- Per HANDOFF: *"Reserve and bank never merge"* — this is a structurally separate bar overlapping the meter, not a stacked segment inside it.

---

## 6. Device slot and gravity slot (the 56px slots)

Both are `position:relative; width:56px; height:56px;` containing an
`<svg width="56" height="56" viewBox="0 0 72 72">` (i.e. drawn in a 72-unit design
space and scaled down to 56px — a 0.778× scale factor baked into the SVG, not CSS).

### 6.1 Shared chamfer polygon
`points="10,0 72,0 72,62 62,72 0,72 0,10"` — the outer plate/mask shape used by both
slots (10-unit cut top-left between (10,0) and (0,10); 10-unit cut bottom-right
between (72,62) and (62,72)).

### 6.2 Device slot structure (SVG, in draw order)
1. `<mask>` containing: the chamfer polygon in white (visible area) + the glyph path in black with `fill-rule="evenodd"` (cuts the glyph shape out as a hole).
2. `<rect 0,0,72,72>` fill = `devicePlate` (dark plate color, live vs empty), masked by #1.
3. `<rect 0,0,72,72>` fill = `deviceFillColor`, `transform-origin:50% 100%; transform:scaleY({deviceFill})`, masked by #1 — **the charge fill grows upward from the bottom edge** (scaleY on a bottom-anchored origin).
4. The glyph path again, drawn on top, `fill:none; stroke:{deviceGlyphStroke}; stroke-width:1.5;` — an **outline redraw of the glyph so it stays legible even with zero fill** (per HANDOFF: *"Draw each twice: as the mask cut and as a 1.5 px outline on top, so identity survives an empty fill."*).
5. The chamfer polygon again, `fill:none; stroke:{deviceStroke}; stroke-width:2.5;` with an optional `ad-pulse` animation on the outline when a device is actively running.
6. Optional key tab (only when a device is held and ready to deploy): `position:absolute; right:-10px; bottom:-7px; padding:2px 6px;` skewed −10deg chip showing the deploy key.

**Glyph paths** (authored in the 72×72 space, confirmed identical in both the
prototype JS and HANDOFF §3):
```
SURGE:        M14,18 L26,18 L40,36 L26,54 L14,54 L28,36 Z M34,18 L46,18 L60,36 L46,54 L34,54 L48,36 Z
PHASE SHIELD: M36,10 L58,23 L58,49 L36,62 L14,49 L14,23 Z M36,21 L49,28.5 L49,43.5 L36,51 L23,43.5 L23,28.5 Z
```
(SHIELD is a ring: outer hexagon minus an inner hexagon, drawn with `fill-rule="evenodd"`.)

Colors:
- `devicePlate`: `C.plate` (`oklch(0.16 0.016 205)`) when a device is live, else `oklch(0.13 0.014 205 / 0.85)` (darker/dimmer empty plate).
- `deviceFillColor`: `C.ink` while a device is **active** (running), `C.lavender` (`#dabaff`) while merely **held** (charged, not yet deployed).
- `deviceGlyphStroke`: `C.ink` normally, `C.acid` when a "perfect" deploy window is live, `C.dim` when the slot has no live device.
- `deviceStroke` (outer chamfer outline): `C.acid` (perfect-ready) > `C.ink` (active & live) > `oklch(0.42 0.035 205 / 0.9)` (live, idle) > `oklch(0.42 0.035 205 / 0.5)` (empty) — priority in that order.
- Key tab background: `C.acid` if perfect-ready else `C.ink`; text color the inverse ink (`C.acidInk` or near-black).

### 6.3 Gravity slot structure (SVG, in draw order — no mask, simpler)
1. Chamfer polygon, static fill `oklch(0.16 0.016 205 / 0.9)` (background plate, does not change state).
2. Upper deck bar: `rect x=12 y=12 width=48 height=8` fill/stroke depend on whether the upper deck is active (`C.upper`/dim-stroke) — `stroke-width:1.5`.
3. Lower deck bar: `rect x=12 y=52 width=48 height=8`, same treatment with `C.amber` (Polarity) or `C.tide` (Tideline).
4. Arrow polygon indicating transfer direction: points are either `"36,48 46,36 26,36"` (pointing down, on upper deck) or `"36,24 46,36 26,36"` (pointing up, on lower deck) — filled/stroked with `C.ink` only when a transfer is actually ready, otherwise outline-only in dim.
5. Mid-label text (10px mono 600) centered at `top:21px` over the SVG — shows cooldown seconds, junction distance, or depth, depending on state.
6. Optional key tab (transfer-ready only): `position:absolute; right:-14px; bottom:-7px;` (note: **offset further right than the device tab's -10px**, and background is plain `C.ink` / text is near-black — not acid — the gravity tab never uses the "perfect" acid treatment).

Both slots' bars are 48×8px rectangles inset by 12px on the sides, 12px from top / 12px from bottom (i.e. `y=12` and `y=52=72-12-8`), leaving a 32px gap between them for the arrow+label.

---

## 7. Chips

### 7.1 Slipstream chip (drive cluster, conditional)
```
display:flex; flex-direction:column; gap:4px;
label span (12px mono, 0.14em tracking)
bar track: display:block; height:3px; background:oklch(0.8 0.02 210 / 0.16); transform:skewX(-10deg);
bar fill:  display:block; width:{slipstreamPct}%; height:100%; background:cyan;
```
Color: cyan when "locked" (`slipstream >= 0.75`), else muted. Label text switches
between "SLIPSTREAM" and "SLIPSTREAM · LOCK".

### 7.2 Track-event chip (drive cluster, conditional, sits above the slipstream chip)
Plain text span, no bar: 12px mono, `font-weight:600`, color keyed by event
(`GUST` → `C.gust`, `SALT` → `C.salt`, anything else → `C.cyan`).

### 7.3 Soundtrack "chip" (header, conditional)
Not a plate/chip visually — plain inline text in the header's right group:
`color:oklch(0.97 0 0 / 0.7)`, inherits the header's 11px mono / 0.12em tracking.
Hidden whenever a safety alert is showing (held, per the priority gate).

Both drive-cluster chips share an outer wrapper: `width:300px; gap:5px;
margin-bottom:4px;` at 12px mono / 0.14em letter-spacing.

---

## 8. The scale system (`--hud-scale` / `--menu-scale`)

The prototype does **not** use CSS custom properties at runtime — it computes a
single JS number and applies it via the CSS `zoom` property on the whole HUD
container (and separately on each menu panel). HANDOFF §6 states the intended
production form as CSS variables; both are given below since they must match
numerically.

### 8.1 HUD scale
```js
hudZoom = { S: 0.88, M: 1, L: 1.2 }[hudScale]
        * Math.min(1.35, Math.max(1, Math.sqrt(viewportHeight / 720)));
```
- User setting (`S`/`M`/`L`) is a flat multiplier: 0.88 / 1 / 1.2.
- It's then multiplied by a **viewport-height compensation factor**: `sqrt(vpH/720)`,
  clamped to `[1, 1.35]`. At 720p this factor is 1 (no-op). At 900p ≈1.118×. At
  1080p ≈1.2247× (not clamped — 1.35 is only reached above ~1310px height, i.e. never
  at the four listed viewports). Purpose per the prototype's own comment: *"1080p is
  not a 720p HUD stretched 1.5×"* — i.e. only partially compensates for the extra
  vertical space rather than scaling linearly with it.
- Application: `hudW = round(vpW / hudZoom); hudH = round(vpH / hudZoom);` then the
  whole HUD div gets `zoom: hudZoom`. Because CSS `zoom` scales layout *and* box
  sizing together, every absolute-position offset and every font-size documented in
  §2–§7 (all authored against the `hudW × hudH` pre-zoom canvas) scales uniformly.
- **Design-intent note (HANDOFF §3, §6):** the production implementation is meant to
  use `calc(N px * var(--hud-scale))` per-property (explicitly: the four type-size
  tiers, the 340px instrument column, and the 300px meter width) rather than a
  blanket `zoom`/`transform:scale` on a whole subtree. A CSS `zoom`-based reimplementation
  is not guaranteed identical to a per-property `calc()` one wherever both approaches
  coexist with elements outside the scaled subtree (e.g. `pointer-events:none` regions,
  SVG stroke-width, or anything the engineer chooses not to wrap) — flag this as a
  decision point for whoever reimplements it, since the prototype's own `zoom` approach
  is explicitly a shortcut, not the specified end state.

### 8.2 Menu scale (pause/launch/controls/results/options — out of scope for the race HUD itself, included for completeness since it shares the mechanism)
```js
menuZoom = { S: 0.9, M: 1, L: 1.15 }[menuScale];
```
No viewport compensation. Applied via `zoom: menuZoom` on each menu panel's root div only.

### 8.3 Settings persistence
Per HANDOFF §5.5/§3: `save.updateSettings({ hudScale, menuScale })`, values
`"s"|"m"|"l"`, default `"m"`, written live to `--hud-scale`/`--menu-scale` on `<body>`.
Both take effect immediately (no reload) — verified by the prototype's toolbar/System-Options chips writing straight to state.

---

## 9. Keyframe animations

```css
@keyframes ad-ignite { 0% { filter: brightness(2.4); } 100% { filter: brightness(1); } }
@keyframes ad-kick   { 0% { color: oklch(0.86 0.13 210); transform: translateX(10px); }
                       100% { color: oklch(0.93 0.015 205); transform: translateX(0); } }
@keyframes ad-drain  { from { transform: scaleY(1); } to { transform: scaleY(0); } }  /* defined but UNUSED anywhere in the markup — dead code, do not port */
@keyframes ad-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
```

Usage:
- **`ad-kick`** — `520ms cubic-bezier(0.23, 1, 0.32, 1) both`, applied to the **92px speed numeral** whenever `boostActive` is true (a red/cyan streak-in-from-the-right + color settle, playing once per activation, not looping).
- **`ad-ignite`** — `520ms ease-out both`, applied to the **reserve-meter fill span** whenever `boostActive` (a camera-flash brightness pop that decays to normal).
- **`ad-pulse`** — `800ms ease-in-out 3` (3 iterations, not infinite), applied to the **device slot's outer chamfer stroke** only while a device is actively running (`ab.active && liveKind`) — a breathing opacity pulse on the outline only, not the fill.
- **`ad-drain`** — present in the stylesheet but not referenced by any element in the current markup; do not implement, likely a leftover from an earlier iteration.

A "reverse" modifier is appended to any of these when the prototype's internal
`play` toggle is odd (`{name} {dur} reverse`) — this is prototype review-harness
plumbing (re-triggering the animation for the toolbar's replay control) and should
**not** be ported; the production trigger is simply "an activation edge occurred this
frame," not a manual replay.

### Reduced motion
```js
const anim = (name, dur) => reducedMotion ? "none" : `${name} ${dur}${alt ? " reverse" : ""}`;
```
When reduced motion is on, **all three used animations become `none`** — no other
property changes. Confirmed by HANDOFF §1: *"Reduced motion keeps the same values and
removes only the outline pulse and the boost ignite/kick."* I.e.:
- Device charge/remaining-time numbers, fill widths, and colors are computed exactly
  the same either way — only the `ad-kick`, `ad-ignite`, and `ad-pulse` animations are
  suppressed.
- No CSS transitions exist anywhere in this HUD (verified: no `transition:` property
  appears in the HUD block at all) — every visual change is a discrete style/attribute
  swap driven by state, except these three keyframe animations. This matters for the
  reimplementation: don't add transitions where the source has none (e.g. the boost
  meter fill width changes instantly, it does not animate/tween).

---

## Open items for the implementing engineer (not fully resolved by the source)

1. **Arial Narrow fallback inconsistency** (§2) — only 5 of ~15 Barlow Condensed rules
   include it; likely should be applied uniformly but the prototype doesn't, so this
   spec reports the inconsistency rather than "fixing" it silently.
2. **`zoom` vs `calc(var(--hud-scale))`** (§8.1) — the prototype's literal mechanism
   (whole-subtree `zoom`) and HANDOFF's stated production mechanism (per-property
   `calc()`) are not proven equivalent for every element; pick one and verify at HUD
   SCALE L + 1280×720 per HANDOFF §7.4 (lower-left cluster must stay ≤497px wide and
   never overlap the standing block).
3. **Two rival dots on the minimap are hardcoded**, not data-driven, in this
   prototype — confirm with the real game whether the production minimap is meant to
   show live rival positions (almost certainly yes; this prototype simply never wired
   it since minimap data isn't in `HudFrame` here).
4. **RESUME_COUNTDOWN_SECONDS**: the prototype uses 3.0s; HANDOFF §8a explicitly says
   the real game constant is **2.7s** (`game.ts:171`) — use 2.7s, not the prototype's
   number, if timing the countdown.
