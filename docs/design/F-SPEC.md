# Direction F — "Native frame, Graphite instrument"

The user picked a merge of A (Graphite) and E (Native). Rules of the merge:

- **Chrome from E**: macOS window with traffic lights, unified toolbar with a Canvas / Session segmented control, translucent-looking sidebar, macOS popovers (slash autocomplete), segmented controls, toggles, pill badges, SF-Symbols-like inline stroke icons. Read E files for this: project/E-canvas.dc.html, project/E-session.dc.html.
- **Density and data typography from A**: compact 28px rows, 12–13px UI text, monospace for every id / path / number / branch / model / cost (tabular numbers), 12-segment epic progress bar, subagent tree drawn with tree lines, status chips that are compact rectangles (not big pills), hairline 1px borders. Read A files for this: project/A-canvas.dc.html, project/A-session.dc.html.
- **Content**: exactly the shared content in BRIEF.md, with ONE correction: done tickets are 01–06, so epic progress is **6/12** everywhere (sidebar, epic frame, burndown "12 → 6 remaining"). Burndown intermediate values: 12, 11, 10, 9, 7, 6.

## Typography (both themes)
- UI: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`.
- Data/mono: `ui-monospace, "SF Mono", Menlo, monospace` with `font-variant-numeric: tabular-nums`.
- No Google Fonts. Sizes: 11 (captions), 12 (chips, meta), 13 (body/rows), 15 (node titles), 20 (section/epic titles).

## Shape
- Window radius 10px; popovers 10px; nodes 8px; chips 4px; buttons 6px. Spacing on a 4/8px grid.
- Light: nodes have soft layered shadow `0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.06)` + 1px border. Dark: NO shadows, 1px borders only.

## Tokens

| role | LIGHT (from E) | DARK (from A) |
|---|---|---|
| window / canvas ground | #F7F7F9, canvas dots #D0D0D6 | #121110, canvas #0F0E0D, dots #2C2926 |
| sidebar | #E9E9EC (semi-translucent look) | #161513 |
| toolbar | #F2F2F5 with bottom border #DCDCE0 | #181715 with bottom border #2E2B28 |
| surface (node) | #FFFFFF | #1B1A18 |
| surface raised / hover row | #F2F2F5 | #22201E |
| selected row | #E1ECFB | #2A2825 |
| border | #E2E2E6 (strong #CFCFD4) | #2E2B28 (strong #3B3834) |
| text | #1D1D1F | #ECE8E1 |
| secondary text | #48484A | #C2BCB2 |
| muted / captions | #636366 | #9C968D |
| primary action (Run wave, Ship ticket, Allow) | fill #0071E3, text #FFFFFF | fill #C8F25A, text #121110 |
| link / accent text | #0062CC | #C8F25A |
| ready (wave ready, gate green, VERIFIED, live) | text #146B4B on #E4F4EC, dot #30B07E | text #C8F25A on #23281A, dot #C8F25A |
| working (claimed, running, CI running, busy) | text #0062CC on #E6F0FC, dot #0071E3 | text #5E9BFF on #1A2233, dot #5E9BFF |
| blocked | text #A84B00 on #FFF0DE, ring #FF9F0A | text #FFAE5C on #2E2216, ring #FFAE5C |
| done | text #636366 + check icon, surface #F2F2F5 | text #9C968D + check icon, surface #1B1A18 |
| terminal node | bg #1D1D1F text #E5E5EA | bg #0B0A09 text #ECE8E1 |

Always pair status color with a text label or icon. Contrast ≥ 4.5:1 for text.

## Light/dark pairing rule
Write the LIGHT file first. The DARK file must have the IDENTICAL markup structure, positions and copy — only token values differ (and light shadows removed in dark). Someone comparing the two should see the same screen in two appearances.
