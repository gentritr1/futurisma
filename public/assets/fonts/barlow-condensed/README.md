# Barlow Condensed (subset: latin)

Six faces used by the HUD and menus: 500, 600, 700, 800 upright and 700, 800 italic.
Self-hosted so the game keeps working offline and `style-src 'self'` needs no change.

Source: Google Fonts (`fonts.gstatic.com`), latin subset only, fetched 2026-09-09.
Licence: SIL Open Font License 1.1 — see `OFL.txt`. Designer: Jeremy Tribby.

The fallback stack is `'Barlow Condensed', 'Arial Narrow', Inter, sans-serif`. Every
Barlow rule in `style.css` carries the Arial Narrow step, deliberately: the design
prototype only applied it to five numerals, which would have let a font failure
reflow the rest of the HUD.
