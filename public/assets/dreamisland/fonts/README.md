# Dream Island — the two self-hosted faces

Phase F round 2, item 2. Both are SIL Open Font License 1.1; `OFL.txt` beside
this file is the licence text with both copyright lines.

| file | family | source | bytes | sha256 |
|---|---|---|---:|---|
| `michroma-latin-v21.woff2` | Michroma 400 | Google Fonts `css2?family=Michroma&display=swap`, latin subset, requested with a Chrome user agent so the API returns woff2 | 11,620 | `b12098180dae0e6c6fed94c13fcf7a12a9d3c19b499ca3fbed118f19cc7756cf` |
| `share-tech-mono-latin-v16.woff2` | Share Tech Mono 400 | the same request, `family=Share+Tech+Mono` | 7,408 | `73b87eb7b02dfec4cb1ddfabad6e625d9c77b3c81015064420de88d8dd04816c` |

**Latin subset only.** The HUD writes upper-case ASCII, a middle dot and a plus
or minus sign; every one is inside `U+0000-00FF` plus the `U+2000-206F` block
the latin subset carries. The latin-ext subsets were not taken, so the two files
are 19,028 B rather than the 30 KB the full families would be.

The `@font-face` rules live in `src/game/style-dreamisland.css` and nowhere
else, with `font-display: swap`, so a slow font never blanks the HUD and the
shell references neither file. `scripts/validate-build.mjs` pins the served
bytes.

Downloaded 2026-09-12 with:

```
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Michroma&family=Share+Tech+Mono&display=swap"
curl -s -A "$UA" -o michroma-latin-v21.woff2 <the latin woff2 url that CSS names>
curl -s -A "$UA" -o share-tech-mono-latin-v16.woff2 <the latin woff2 url that CSS names>
```
