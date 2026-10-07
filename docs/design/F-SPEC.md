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

## Autopilot (Epic frame)
Describes what is built (worfy-daily tickets 04, 05, 29, 32). Reference look in both themes: the e2e `test/e2e/autopilot.spec.ts` shoots the Epic frame's header as `autopilot-idle`, `autopilot-running`, `autopilot-stopped`, `autopilot-waiting` and `autopilot-background-tasks`, each as `-light` and `-dark` (test output, not committed).

- **Place**: the Epic frame's header (56px tall), in the actions slot after "Run wave". "Run wave" is the primary action; "Autopilot" is a plain action button, never primary.
- **Labels**: "Autopilot" when the Project has no run, or its run is over another Epic; "Stop autopilot" while this Epic's run is running or waiting.
- **Button**: the shared action button — 20px tall, 8px side padding, 1px border (border), radius 6px (buttons), surface raised fill, text 12px in text. Hover on an active button: border turns secondary text.
  - Inactive: transparent fill, border, muted text. It stays focusable and keeps its tooltip, which says why.
  - Refused by the app: border turns blocked text, and the tooltip shows the reason until the next click.
  - While a click is in flight the button is inactive.
- **When "Autopilot" is active**: when "Run wave" of the same Epic would be (the same verdict, plus one condition: the Run wave template names the Wave's Tickets, `{tickets}`), and the Project has no run. "Stop autopilot" is active whenever shown.
- **Tooltips**:
  - active: "Run the Waves of <epic> one after another, without a person. The display stays on until the run ends";
  - another Epic's run: "Autopilot is running Epic <epic>";
  - otherwise inactive: the reason "Run wave" gives, or that the template must name the Wave's Tickets;
  - "Stop autopilot": "Stop Autopilot over <epic> after this step".
- **Status line**: above the button, out of the header's row so it takes no width from the Epic title; right-aligned to the button, 2px above it, inside the header. 11px, line height 14px, secondary text, one line, at most 220px wide, cut with an ellipsis. Only this Epic's run has a line; a run over another Epic shows none here.
- **Status line text** (`Wave N` counts the Waves this run has sent, from 1 — not the Wave number in the Epic's plan):
  - `starting` — running, no Wave sent yet;
  - `Wave 3 · running`;
  - `Wave 3 · 4 background tasks`, `Wave 1 · 1 background task` — running, and the Orchestrator's background tasks are live;
  - `waiting for limits`, `waiting for limits · resumes 14:20` — waiting for the Limits to reset; time is 24-hour local;
  - `stopped: <reason>` — the last run's stop reason, dashes as spaces: `stopped: no ready wave`, `stopped: blocked tickets`, `stopped: no progress`, `stopped: wave unfinished`, `stopped: session error`, `stopped: turn error`, `stopped: interrupted`, `stopped: session closed`, `stopped: send failed`, `stopped: workflow error`, `stopped: limits timeout`, `stopped: background stalled`, `stopped: user stop`, `stopped: app quit`.
- **Status line tooltip**: the run's error message when it has one; else, while running or waiting, the line plus ". The display stays on until the run ends" (the visible line never says it: 220px is taken by its longest forms); else the line itself.
- **Visible when**: the Epic has "Run wave" (hidden only when the Epic has Tickets and all of them are done; an Epic with no Tickets shows an inactive button with "No ready wave"), or this Epic's run is running or waiting, or this Epic's last run has a stop reason. Otherwise neither button nor line is drawn.
- **Themes**: only roles from the Tokens table (surface raised, border, text, secondary text, muted, blocked); no colors of its own. State is always in words — the label and the status line; the blocked border after a refusal comes with the reason in the tooltip.

## Light/dark pairing rule
Write the LIGHT file first. The DARK file must have the IDENTICAL markup structure, positions and copy — only token values differ (and light shadows removed in dark). Someone comparing the two should see the same screen in two appearances.
