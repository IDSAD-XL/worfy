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
Describes what is built (worfy-daily tickets 04, 05, 29, 32; worfy-week tickets 17, 18). Reference look in both themes: the e2e `test/e2e/autopilot.spec.ts` shoots the Epic frame's header as `autopilot-idle`, `autopilot-running`, `autopilot-stopping`, `autopilot-stopped`, `autopilot-waiting`, `autopilot-waiting-stopping`, `autopilot-background-tasks`, `autopilot-stopped-tasks`, `stop-before`, `stop-stopping` and `stop-stopped`, and the header with the open "⋯" menu as `autopilot-menu` and `force-stop-pending-menu`, each as `-light` and `-dark` (test output, not committed; kept as `.scratch/worfy-week/evidence/17-*.png` for Force stop and `18-*.png` for the graceful Stop and the menu).

Two ways to stop a run (worfy-week ticket 18, ADR-0051): **Stop** ("Stop autopilot") is graceful — the run takes no new Ticket, tells the Orchestrator so, and the Tickets in work finish (merge or blocked); **Force stop**, the one item of the "⋯" menu, interrupts the Orchestrator and its background tasks at once (worfy-week ticket 17, ADR-0050).

- **Place**: the Epic frame's header (56px tall), in the actions slot after "Run wave". "Run wave" is the primary action; "Autopilot" is a plain action button, never primary. While this Epic's run goes on, "⋯" sits right of "Stop autopilot", 4px apart.
- **Labels**: "Autopilot" when the Project has no run, or its run is over another Epic; "Stop autopilot" while this Epic's run is running or waiting; "Stopping…" while the run is stopping (from the click on "Stop autopilot" until the run ends — as long as the Tickets in work take, up to an hour and more), and from the choice of Force stop until the app answers (Force stop interrupts the Orchestrator's turn and waits for it up to 15 s). "Stopping…" is inactive and takes no click.
- **More menu (⋯)**: shown while this Epic's run is running or waiting, stopping included; a stopped run has none (Force stop has nothing to interrupt).
  - Button: the shared action button as a 20×20 square, no side padding, text "⋯" centred. Accessible name "More Autopilot actions for <epic>", `aria-haspopup="menu"`, `aria-expanded` while open. Refused by the app: border turns blocked text, and its tooltip shows the reason, as any action button.
  - Menu: the look of the Canvas menu — surface fill, 1px border, radius 10px (popover), node shadow, 4px padding, at least 180px wide, rows of the shared row (13px text). It is drawn over everything, out of the Canvas (it does not scale with zoom and the frame does not cut it), 4px under "⋯" with its right edge on the button's. `role="menu"`, accessible name "Autopilot over <epic>". One item: "Force stop"; inactive (muted text) while a Force stop is on its way.
  - Keys and closing: on open the focus goes to the first item; the arrows move between items. Esc, a click outside, the wheel outside it, the window losing focus and choosing an item close it; the focus then goes back to "⋯". The Esc that closes the menu does nothing else (the done stack stays open).
- **Button**: the shared action button — 20px tall, 8px side padding, 1px border (border), radius 6px (buttons), surface raised fill, text 12px in text. Hover on an active button: border turns secondary text.
  - Inactive: transparent fill, border, muted text. It stays focusable and keeps its tooltip, which says why.
  - Refused by the app: border turns blocked text, and the tooltip shows the reason until the next click.
  - While a click is in flight the button is inactive.
- **When "Autopilot" is active**: when "Run wave" of the same Epic would be (the same verdict, plus one condition: the Run wave template names the Wave's Tickets, `{tickets}`), and the Project has no run. After a Force stop over this Epic, the Tickets of the Wave it interrupted that are still in work count as ready too: "Autopilot" is active for them, and the next run's first Wave takes them along. After the graceful Stop nothing is taken along: a Ticket left in work is the person's. "Stop autopilot" is active whenever shown.
- **Tooltips**:
  - active: "Run the Waves of <epic> one after another, without a person. The display stays on until the run ends";
  - another Epic's run: "Autopilot is running Epic <epic>"; while that run is stopping: "Autopilot is stopping Epic <epic>";
  - otherwise inactive: the reason "Run wave" gives, or that the template must name the Wave's Tickets;
  - "Stop autopilot": "Stop Autopilot over <epic>: takes no new Tickets; the Tickets in work finish (merge or blocked)";
  - "Stopping…" while the run is stopping: "Autopilot over <epic> is stopping: no new Tickets; it waits for the Tickets in work. Force stop is under ⋯";
  - "Stopping…" while Force stop is on its way: "Stopping Autopilot: the Orchestrator's turn is being interrupted";
  - "⋯": "More Autopilot actions";
  - "Force stop": "Stop Autopilot over <epic> now: interrupts the Orchestrator and its background tasks; worktrees stay. The next Autopilot takes the interrupted Tickets first".
- **Status line**: above the button, out of the header's row so it takes no width from the Epic title; right-aligned to the button, 2px above it, inside the header. 11px, line height 14px, secondary text, one line, at most 220px wide, cut with an ellipsis. Only this Epic's run has a line; a run over another Epic shows none here.
- **Status line text** (`Wave N` counts the Waves this run has sent, from 1 — not the Wave number in the Epic's plan):
  - `starting` — running, no Wave sent yet;
  - `Wave 3 · running`;
  - `Wave 3 · 4 background tasks`, `Wave 1 · 1 background task` — running, and the Orchestrator's background tasks are live;
  - `stopping · 2 tickets in work`, `stopping · 1 ticket in work` — running and stopping, with the Wave's Tickets in work; `stopping` when none is (the run waits for the Orchestrator's turn or its background tasks);
  - `waiting for limits`, `waiting for limits · resumes 14:20` — waiting for the Limits to reset, stopping or not (a Stop during the wait goes to the Orchestrator with the continuation); time is 24-hour local;
  - `stopped: <reason>` — the last run's stop reason, dashes as spaces: `stopped: no ready wave`, `stopped: blocked tickets`, `stopped: no progress`, `stopped: wave unfinished`, `stopped: session error`, `stopped: turn error`, `stopped: interrupted`, `stopped: session closed`, `stopped: send failed`, `stopped: workflow error`, `stopped: limits timeout`, `stopped: background stalled`, `stopped: user stop` (the graceful Stop), `stopped: user force stop`, `stopped: app quit`.
- **Status line tooltip**: the run's error message when it has one; else, while running or waiting, the line plus ". The display stays on until the run ends" (the visible line never says it: 220px is taken by its longest forms); else the line itself.
- **Visible when**: the Epic has "Run wave" (hidden only when the Epic has Tickets and all of them are done; an Epic with no Tickets shows an inactive button with "No ready wave"), or this Epic's run is running or waiting, or this Epic's last run has a stop reason. Otherwise neither button nor line is drawn.
- **Harness chip** (worfy-harness ticket 21): when the Harness in worfy's main is newer than the running build's (packaged builds over worfy's own repository), the shared chip (`w-chip w-chip--open`: 18px, radius 4px, 12px secondary text, 1px border on surface raised) "Harness in main is newer than the Stable copy" stands left of the button, 4px apart, under the status line, while a run goes on and when none does; its tooltip: "<main> has N commits in harness/ that this build (<version>) has not. Rebuild the Stable copy with pnpm install:stable between runs". The e2e `test/e2e/packaged.spec.ts` shoots the header as `harness-behind-header` (test output, not committed).
- **Themes**: only roles from the Tokens table (surface raised, border, text, secondary text, muted, blocked); no colors of its own. State is always in words — the label and the status line; the blocked border after a refusal comes with the reason in the tooltip.

## Done stack (Epic frame)
Describes what is built (worfy-week ticket 15). Reference look in both themes: the e2e `test/e2e/done-stack.spec.ts` shoots the Canvas as `done-stack-toggle-folded` and `done-stack-toggle-open`, each `light` and `dark` (test output, not committed; crops of the Done column are kept as `.scratch/worfy-week/evidence/15-стопка-done-*.png`).

- **What it is**: the Done column of an Epic frame. Folded, it is one card 204×120 in the column's place: a check icon, "N done" and the Tickets' numbers. Open, the card is gone and the done Tickets stand in the column as Ticket Nodes.
- **Toggle — place**: the Done column's label row ("Done N"), at its right end, in both states: a click in the same place opens and folds the stack.
- **Toggle — labels**: folded — a chevron pointing down and "Expand", aria-label "Expand done tickets of <epic>", `aria-expanded="false"`; open — a chevron pointing up and "Collapse", aria-label "Collapse done tickets of <epic>", `aria-expanded="true"`. The chevron is the same 12px stroke icon as the frame's collapse chevron in the header.
- **Toggle — button**: the shared action button (as in Autopilot) — 20px tall, 1px border (border), radius 6px (buttons), surface raised fill, text 12px in text, regular weight; 6px side padding, 4px between icon and label. Hover: border turns secondary text. Keyboard focus: a 2px accent outline, 1px off the button — the toggle's own; the other action buttons do not change.
- **Folded card**: stays a button that opens the stack; its name is "<N> done tickets of <epic>", `aria-expanded="false"`. After it opens the stack the focus moves to "Collapse".
- **Open stack backdrop**: a dashed 1px outline (border), radius 8px (nodes), no fill, decorative (`aria-hidden`), from 6px above the Done column's label to 6px below its last Ticket, 6px wider than the column on each side. No shadow in either theme.
- **Esc**: folds the stack opened last in the Project, one stack per press, only when nothing else takes the press: no text field has the focus, nothing on the Canvas is selected (the first Esc takes the selection off, the next one folds), no dialog or menu is open (the first Esc closes it). Collapsing the frame folds its stack too.
- **Not a ⌘Z step**: opening and folding are a state of the view, like the viewport (worfy-week ticket 08); ⌘Z undoes the change before them. A stack folded by mistake opens again by "Expand" in the same place.
- **Not saved**: which stacks are open lives only in the window's memory; after a restart every stack is folded.
- **Themes**: only roles from the Tokens table (surface raised, border, text, secondary text, accent, done); no colors of its own.

## Light/dark pairing rule
Write the LIGHT file first. The DARK file must have the IDENTICAL markup structure, positions and copy — only token values differ (and light shadows removed in dark). Someone comparing the two should see the same screen in two appearances.
