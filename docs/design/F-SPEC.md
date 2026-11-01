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
| terminal node | bg #1D1D1F text #E5E5EA, colour 8 (dimmed output, Terminal AI Suggestion) #8E8E93 | bg #0B0A09 text #ECE8E1, colour 8 #9C968D |
| kind-orchestrator (Orchestrator, purple) | band #A0527F, tint #F6EAF1 | band #CC79A7, tint #2D2028 |
| kind-session (Session, sky blue) | band #2B8BC6, tint #E6F2FA | band #56B4E9, tint #1B2730 |
| kind-subagent (Subagent) | = kind-session, outline only (no fill, no tint) | = kind-session, outline only (no fill, no tint) |
| kind-epic (Epic frame, ochre / yellow) | band #9A7A00, tint #F6F0D9 | band #F0E442, tint #2A2716 |

Always pair status color with a text label or icon. Contrast ≥ 4.5:1 for text.

**Kind colours (`kind-*`, ADR-0077).** Each coloured Node kind has a `band` (saturated) and a `tint` (pale header ground) per theme. Use them only for: the 4px band in a Node's header, the kind icon, the minimap (`minimapColor`; the Epic frame's rectangle there too). Never use them for status text or a status chip, a Node's body, or Edges: status stays on ready, working, blocked and done, always with a word. A finished Session is shown by opacity (about 60 %) and the word in its chip, not by a hue. Ticket, Card, Note, Terminal and HANDOFF are neutral (surface); a new Node kind is neutral unless a new ADR gives it a colour with the same checks. The values pass the checks of `test/unit/kind-tokens.test.ts`: band ≥ 3:1 to surface and surface raised, text, secondary and muted text ≥ 4.5:1 on tint, every pair of kind colours ΔE (CIE76) ≥ 15 under protanopia, deuteranopia and tritanopia (Machado 2009), and each band ΔE ≥ 15 from the ready, working and blocked colours. Known trade-off: under protanopia the dark Epic yellow and the dark ready lime are close (ΔE about 8); acceptable, since Epic colour is never a status.

## Node header
The kind of a Node shows in its header (worfy-canvas ticket 05, ADR-0077). Only roles of the Tokens table; no colours of their own. Built in `src/renderer/canvas/kind-icons.tsx`; reference look in both themes: the e2e `test/e2e/node-kinds.spec.ts` shoots Session, Orchestrator, Subagent, Epic frame and a Ticket side by side as `node-kinds` (test output, not committed).

- **Band**: 4px along the top edge of the header, full width of the Node, in the kind's `band`; the Node's rounded corners cut it. Orchestrator (`kind-orchestrator`), Session (`kind-session`), Epic frame (`kind-epic`, across the whole frame). Subagent: a dashed band in `kind-subagent` (the Session's colour). Ticket, Card, Note, Terminal and HANDOFF: no band.
- **Header ground**: the kind's `tint` under the header — Orchestrator, Session and the Epic frame (the frame's top 56px, the whole frame when collapsed). Subagent: none (outline only). Header text keeps text, secondary and muted on it (≥ 4.5:1, `kind-tokens.test.ts`).
- **Icon**: stroke icon in the kind's `band`, first in the header row, before the title: 14px on Orchestrator, Session and Subagent; 12px inside the Epic frame's "Epic" tag, before the word, 4px apart. Orchestrator — a hub with three spokes; Session — the prompt `>_`; Subagent — a branch with an arrow; Epic frame — a frame with its header row. The icon is `aria-hidden`; the Node names its kind in its accessible name: "Orchestrator", "Session <title>", "Subagent <name>", "Epic <epic>".
- **Orchestrator border**: double, 3px (border strong), so the kind shows not only by colour; selected, it takes the accent colour like any Node.
- **Status chip and status text** never take a kind colour: they stay on ready, working, blocked and done, with the word.
- **Orchestrator border** applies on the Canvas; a focus tile draws its own frame.
- **Finished Session**: on the Canvas the whole Node at 60 % opacity, the chip says "finished" (done); no change of hue. Hovering the Node or selecting it gives it full opacity back; a focus tile shows it at full opacity. No other Node changes opacity on hover.

## Zoom
At every zoom of the Canvas, from its lowest (0.2, `ZOOM_MIN`) up, each Node is drawn whole, only scaled by the Canvas transform: no part of a Node is hidden, replaced or redrawn by zoom, and nothing in it changes size, so a Terminal keeps its rows and columns and its shell gets no resize. Epic frames and Ticket cards keep all their text too. The one exception is older than this rule: below zoom 0.4 a Card is its title in a frame instead of its running page (`LIVE_ZOOM_MIN`, `src/renderer/canvas/nodes/CardNode.tsx`), unless it is pinned or shown in a focus tile. A long Card title ends with "…" on one line; the whole title is in its tooltip. Checked by the e2e `test/e2e/zoom-whole-nodes.spec.ts`.

The semantic zoom of worfy-canvas ticket 06 (a Node as its header alone from 0.3 to 0.6, as a block of its kind colour below 0.3, the Epic frame's header at a constant screen size) is turned off by the owner's decision of 2026-10-21 (worfy-canvas ticket 20): the switch of view, with text disappearing as the Canvas zooms out, made the Canvas worse to use.

## Autopilot (Epic frame)
Describes what is built (worfy-daily tickets 04, 05, 29, 32; worfy-week tickets 17, 18; worfy-link ticket 15). Reference look in both themes: the e2e `test/e2e/autopilot.spec.ts` shoots the Epic frame's header as `autopilot-idle`, `autopilot-running`, `autopilot-stopping`, `autopilot-stopped`, `autopilot-waiting`, `autopilot-waiting-stopping`, `autopilot-background-tasks`, `autopilot-stopped-tasks`, `stop-before`, `stop-stopping` and `stop-stopped`, and the header with the open "⋯" menu as `autopilot-menu` and `force-stop-pending-menu`, each as `-light` and `-dark` (test output, not committed; kept as `.scratch/worfy-week/evidence/17-*.png` for Force stop and `18-*.png` for the graceful Stop and the menu). The e2e `test/e2e/linked-autopilot.spec.ts` shoots the header with the chips under it as `15-this-machine`, `15-other-machine` and `15-start-anyway`, `-light` and `-dark` (kept as `.scratch/worfy-link/evidence/15-*.png`).

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
- **Visible when**: the Epic has "Run wave" (hidden only when the Epic has Tickets and all of them are done; an Epic with no Tickets shows an inactive button with "No ready wave"), or this Epic's run is running or waiting, or this Epic's last run has a stop reason, or a start of this Epic stands refused because it runs on another Machine (below). Otherwise neither button nor line is drawn.
- **Machine chips and "Start anyway"** (worfy-link ticket 15, ADR-0053 Q13: one Autopilot per Epic and origin across the Linked machines). They stand in the chip row under the button, right-aligned to it, in the 18px of the header below the button, like the Harness chip (which goes last when both show): out of the header's row, they take no width from the Epic title.
  - "on <Machine>": the shared chip `w-chip w-chip--working` while this Epic's run is running or waiting and its Machine has Linked machines (a Machine without any shows none). Tooltip: "<Machine> runs Autopilot over <epic>", plus ". Could not ask <Machines> whether they run it" when the start could not ask some Linked machines.
  - After a start refused because the Epic of the same repository (the same remote `origin`) runs or starts on another Machine, or in another Project of this one: the button shows the refusal as any action button (blocked border, the reason "Autopilot is already running Epic <epic> of this repository on <Machine>" in the tooltip); the chip `w-chip w-chip--blocked` "running on <Machine>" with the same reason as tooltip; and right of it "Start anyway" — the shared action button at 18px tall (line height 16px), active when "Autopilot" would be. Its tooltip: "Start Autopilot over <epic> here although <Machine> runs it: both runs take the same Tickets". It starts the run with the override; the app asks the Linked machines again, and the run's journal records the override only when the start did go past a run. The refusal, its chip and "Start anyway" stay until the next start of the Project or a run of it.
  - Each button keeps its own refusal: "Stop autopilot" after "Start anyway" shows none.
- **Harness chip** (worfy-harness ticket 21): when the Harness in worfy's main is newer than the running build's (packaged builds over worfy's own repository), the shared chip (`w-chip w-chip--open`: 18px, radius 4px, 12px secondary text, 1px border on surface raised) "Harness in main is newer than the Stable copy" stands under the button, right-aligned to it, in the 18px of the header below the button (out of the header's row, like the status line above: it takes no width from the Epic title and is never cut), while a run goes on and when none does; its tooltip: "<main> has N commits in harness/ that this build (<version>) has not. Rebuild the Stable copy with pnpm install:stable between runs". The e2e `test/e2e/packaged.spec.ts` shoots the header as `harness-behind-header` (test output, not committed).
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

## Done shelf (Epic frames)
Describes what is built (worfy-canvas ticket 02, ADR-0075 point 5). Reference look in both themes: the e2e `test/e2e/done-shelf.spec.ts` shoots the Canvas as `done-shelf`, `light` and `dark` (test output, not committed).

- **Who is on it**: an Epic with Tickets, every one of them done, whose frame is collapsed — by the user or by default (a done Epic starts collapsed). Its frame is not in the strip of frames, and it takes no column there. An Epic without Tickets, an Epic with a Ticket not done, and an opened frame of a done Epic stay in the strip. No Epic on it: no shelf is drawn.
- **Place**: the strip's left edge, 48px (the gap between frames) under the strip's tallest column, counted with every done stack open, so opening a stack never runs into the shelf. As wide as the strip, at least 520px. The strip's place on the plane is found for the frames and the shelf together. It is not dragged; it moves with the strip.
- **Shelf**: radius 10px (window), a dashed 1px border (border strong), the frame's ground (surface at 55 %). 12px padding. A label row 24px tall: "Done" 12px semibold in secondary text, then the number of Epics on the shelf in monospace, muted.
- **Chip**: a `<button>` 24px tall under the label row, in the strip's order (the order of the Layout's arrangement record, then the Epics it lacks by name), left to right, a new row when the next one does not fit the shelf's width, 8px apart in both directions. Inside: a 12px check icon (stroke), the Epic's name in 12px monospace (text), the count "N/N" in 12px monospace. 1px border (border), radius 4px (chip), fill and count in the done role (done text on done surface); 8px side padding, 6px between the parts. Its width comes from its text in monospace, so it is the same on every screen; a name too long for the shelf is cut with an ellipsis.
- **Chip — name and tooltip**: aria-label "Expand <epic>, N of N done"; tooltip "<epic>: every Ticket is done. Expand the frame".
- **Chip — states**: hover — the border turns secondary text; keyboard focus — a 2px accent outline, 1px off the chip. Tab reaches each chip, Enter or Space opens the frame.
- **Click**: opens the frame (`collapsed = false`, the same Layout change as the frame's collapse button) and puts the Epic last in the strip's order; together one step of ⌘Z, so ⌘Z puts the Epic back on the shelf. Collapsing the frame again sends it back to the shelf and takes it out of the strip's order, in the same step of ⌘Z: undone, the frame is back at the place it had. On a read-only screen of a Linked machine the chip stays, inactive, with the read-only hint as tooltip.
- **Themes**: only roles from the Tokens table (surface, border, border strong, text, secondary text, muted, done, accent); no colors of its own. Done is always shown with the check icon and the count, never by color alone.
- **Not saved**: which stacks are open lives only in the window's memory; after a restart every stack is folded.
- **Themes**: only roles from the Tokens table (surface raised, border, text, secondary text, accent, done); no colors of its own.

## First run
Describes what is built (worfy-harness tickets 19 and 30, question Q22 of the epic). Reference look in both themes: the e2e `test/e2e/first-run.spec.ts` shoots the window as `first-run` (the first start: one check failed, two warnings), `first-run-ready` (every check ok), `first-run-no-project` (GitHub sign-in as a command to copy), `first-run-dependency-missing` (the Harness plugin installed without its dependency: both rows failed, "Install…" on Plugin dependencies) and `first-run-dependency-installed` (after that install), each `light` and `dark` (test output, not committed; kept as `.scratch/worfy-harness/evidence/19-*.png` and `30-*.png`).

- **What it is**: a screen over the window that lists what worfy and the Harness need on this Mac (on Windows, this PC), and the actions that set it up. The checks only read; an action runs only after its dialog's "Confirm".
- **Place**: a dialog over the whole window, centered, on a backdrop of black at 25% (as the move form of the old Harness). 720px wide (at most the window less 32px), at most the window's height less 48px; surface fill, 1px border, radius 10px (popover), node shadow (none in dark). Three parts:
  - **Header**: the title "First run" (20px, semibold), under it one line in 12px secondary text, never wrapped (cut with an ellipsis in a narrow window): "worfy checks this Mac for itself and the Harness. Nothing changes until you confirm it." (on Windows "this PC") Right of the title, the summary chip: "Checking…" (working), "N failed · M warnings" (the fail colors when anything failed, else the warning colors), "Everything is ready" (ready). 1px border under the header.
  - **Body**: scrolls. Six groups in this order, each with its name as a caption (11px, semibold, muted): **Claude Code** — Sign-in, Claude Code in the terminal; **Command-line tools** — git, gh, node, jq; **GitHub** — GitHub accounts; **worfy** — worfy version, only where Update is on (the packaged Stable copy, or `WORFY_UPDATE=1`; a group without rows is not shown); **Harness** — Harness plugin, Plugin dependencies, Old Harness in ~/.claude; **qmd** — qmd, qmd models, qmd collections. On Windows one more group and four more rows (below): Claude Code gets Limits from terminal after Claude Code in the terminal; **Windows** — Windows version, Architecture, PowerShell — comes second; Command-line tools gets Git Bash after git.
  - **Footer**: 1px border above. Left, the result of the last action in 12px: secondary text for a note, blocked text for an error. Right, "Check again" (the shared action button) and "Close" (the shared action button, primary).
- **Row**: 28px line, 1px border under it: the status chip (64px wide, centered label), the check's name (13px, 190px), what was found (mono 12px secondary text, one line, cut with an ellipsis; the whole text in the tooltip), the row's buttons at the right end (the shared action button, 4px apart). When there is something to do, a second line under the name: the hint (12px secondary text) and the command to run (mono 12px on surface raised, 1px border, radius 4px) with "Copy" (the shared action button; "Copied" after a click).
- **Status chips** — the shared chip's shape (18px, radius 4px, 12px), always with a word, colors only from the Tokens table:
  - "OK" — ready text on ready;
  - "Warning" — blocked text on surface raised, 1px border;
  - "Failed" — blocked text on blocked, 1px blocked ring;
  - "Running…" — working text on working: the row whose action runs (Harness plugin and Plugin dependencies share one action, so both show it when both offer it).
- **Buttons of the rows**: "Install" / "Update" / "Replace" / "Retry" (Harness plugin: not installed, an older version, the same version from another build, an error), "Show log" (worfy version after a failed Update build: opens its build log, no dialog), "Install…" (Plugin dependencies: a dependency is missing; the same action as the Harness plugin's button), "Move…" (opens the move form of the old Harness), "Install…" (qmd), "Download…" and "Skip…" (qmd models), "Set up…" (qmd collections), "Sign in…" (GitHub accounts). While an action or a check runs, every button is inactive (muted, no fill) and the Close button waits for the action.
- **What each check says**: missing git, gh, node or jq — "Failed" with `brew install <tool>` to copy (worfy installs none of them); node older than 22 — "Failed" with `brew install node`; `claude --version` older than the Claude Code worfy carries — "Warning" with `claude update`; no `claude` — "Warning" that says to install Claude Code (no command: `claude update` needs a `claude`); no Claude login — "Failed", "Run claude in a Terminal Node, then /login"; gh signed in nowhere — "Failed" with "Sign in…" and `gh auth login` to copy; worfy version (worfy-update ticket 08) — "OK" with "<version>, up to date", "Failed" with "<version> available" while an Update waits, with "update failed", the last line of the build log and "Show log" after a failed build, and with "<tool> not found" and its install command when the build did not find git, node or pnpm; the Harness not installed — "Failed"; an older version — "Failed" with "Update"; the same version from another build — "Warning" with "Replace", and "Failed" with "Update" once GitHub says the installed one is behind this build; Plugin dependencies (the plugins the Harness plugin needs to load, read from the same `claude plugin list`) — "OK" with each name and version, "Failed" with "not installed", a hint that names the missing one, and "Install…" when the Harness plugin is installed without one (its own row then reads "error at dependency install" with "Retry"), "Warning" with "checked when the Harness plugin is installed" and no button while the Harness plugin is not installed (nothing is listed before that); the old Harness in ~/.claude — "Warning"; qmd, its models and collections only warn (without them the Harness searches with grep); qmd needs node 22.14 or newer (23.6 or newer on the 23 line), so with a missing or older node its row warns with the command that installs node (`brew install node`, on Windows `winget install OpenJS.NodeJS.LTS`), and `qmd-mcp` starts no server and says why in one line. A failed action makes its row "Failed" with "The last attempt failed: <error>" until the next attempt.
- **On Windows** (worfy-windows ticket 13): the tools are looked for on the PATH of the environment worfy builds for a Session (not a login shell), so a missing one reads "not found on the PATH"; each command to copy is `winget install <id>` instead of `brew install`: git — `winget install Git.Git`, gh — `winget install GitHub.cli`, node (missing or older than 22) — `winget install OpenJS.NodeJS.LTS`, jq — `winget install jqlang.jq`. jq missing is "Warning", not "Failed": skill steps that call jq do not work without it, installing the Harness does not need it. The extra rows:
  - **Git Bash** — "OK" with its path (bash.exe of Git for Windows, found as the Sessions find it); missing — "Failed" with `winget install Git.Git`. C:\Windows\System32\bash.exe starts WSL and does not count.
  - **Windows version** — "OK" with "Windows 11, build 22631" or "Windows 10, build 19045"; a build older than 19044 — "Failed", "Windows 10 21H2 or newer is required: update Windows".
  - **Architecture** — "OK" for x64; anything else — "Warning": worfy is built for x64, arm64 comes later, x64 under emulation is not tested.
  - **PowerShell** — the shell a Terminal Node starts: "OK" with the path of pwsh.exe; only Windows PowerShell — "Warning", "Terminal uses Windows PowerShell", with `winget install Microsoft.PowerShell`.
  - **Claude Code in the terminal** finds claude.exe and npm's claude.cmd.
  - **Limits from terminal** — "OK" when statusLine in ~/.claude/settings.json runs the Limits bridge of this build; otherwise "Warning" ("no statusLine in settings.json", "statusLine does not run the worfy bridge", "statusLine runs the bridge of another build") with "Set up…". Its dialog: "Send the Limits of Claude Code in a terminal to worfy?", the detail names settings.json and statusLine.command now and new (`node 'C:/…/resources/statusline-bridge.mjs' '<the command before>'`); "Confirm" changes only the statusLine key. A development build has no bridge of its own: "Warning" without the button.
- **Confirm dialog**: the native message box of macOS on the window, title "worfy first run", buttons "Confirm" (default) and "Cancel". Its message asks the question ("Install qmd 2.8.3?", "Download the qmd models (2.4 GiB)?", "Skip the qmd models?", "Set up qmd collections for <names>?", "Sign in to GitHub in a Terminal?", the installer's own "Install the worfy Harness <version>?" or, with only a dependency missing, "Install <name> for the worfy Harness?"); its detail names the command, the folder and the download (the models: each with its size). The Harness install is one dialog: when a dependency is missing it names the dependency's commands first and that Claude Code downloads it from GitHub (anthropics/claude-plugins-official) and records the marketplace and the plugin in its settings, then the Harness commands; "Nothing is downloaded: the copy comes from this build." closes the detail only when no dependency is installed. Only "Confirm" runs anything. After an action the checks run again.
- **GitHub sign-in**: with a Project, "Sign in…" → "Confirm" puts a Terminal Node (560×340) on the active Project's Canvas, near the top left of the view, types `gh auth login` into its new shell, shows the Canvas centered on it and closes the screen; the user answers gh there. Without a Project there is no Canvas: the row has no "Sign in…", its hint adds "No Project is connected yet, so run it in a terminal", and `gh auth login` is a command to copy. **Decided without the owner, confirm.**
- **When it opens**: at start, when worfy's data folder has no mark that the screen was closed once (`first-run.json`); at start, when a check fails that did not fail when the screen was last closed (a failure the user already saw and closed does not open it again at every start; a "Warning" never opens it); always from the command palette ("First-run checks", group View). **Decided without the owner, confirm.** "Failed" of worfy version and of the Harness plugin behind this build never opens it (`opensFirstRun: false`; worfy-update spec R9): their signal at the start is a toast. Closing the screen — "Close", Esc, or the GitHub sign-in — writes the mark with the checks failing at that moment, except those two, so a later "Failed" of the same row for another cause (the Harness not installed, an installer error) still opens it.
- **Keys**: the dialog takes the focus when it opens; Esc closes it (not while the move form is open over it).
- **Themes**: only roles from the Tokens table (surface, surface raised, border, text, secondary text, muted, ready, working, blocked, primary); no colors of its own.

## Settings → Machines
Describes only what worfy-link ticket 18 (ADR-0066) needs: the access level of each Linked machine. Reference look in both themes: the e2e `test/e2e/linked-machines.spec.ts` shoots it as `18-settings-machines-read-only` and `18-settings-machines-full-access`, each `light` and `dark` (kept as `.scratch/worfy-link/evidence/18-*.png`).

- **Rows, top to bottom**: the switch "Linked machines can work with my Projects" with its hint "Work already started from a Linked machine keeps running"; one row per Linked machine; the switch "Keep this computer awake while linked machines are connected". Every row is the shared Settings row (`SettingRow`): the label and its hint on the left, the control on the right.
- **Row of a Linked machine**: the label is the Machine's name; the control is the shared Select, accessible name "Access of <Machine> to my Projects", with three options: "Off", "Read only", "Full access". The hint under the name says what the chosen level means:
  - Off — "Cannot see or change your Projects";
  - Read only — "Sees your Projects, Sessions and notifications, not Terminal output, and changes nothing. Read only still means trust: a Session transcript can show a secret";
  - Full access — "Works with your Projects as you do: Sessions, Terminal, Autopilot".
- **A newly linked Machine** shows Off.
- **While the access switch is off**: every level row is disabled and dimmed (as the keep-awake row), shows Off whatever is kept for the Machine, and its Select has the tooltip `Turn on "Linked machines can work with my Projects" first`. Switched on again, each row shows the level kept for it.
- **A choice** calls main; the field shows the new level once main answers. A refusal of main is shown under the rows in blocked text, as for the switches.
- **Themes**: only roles from the Tokens table; no colors of its own.

## Read-only screen of a Linked machine
Describes only what worfy-link ticket 25 (ADR-0066) needs: the screen of a Linked machine that gives this Machine the level Read only. Reference look in both themes: the e2e `test/e2e/linked-read-only.spec.ts` shoots it as `25-sidebar-read-only` and `25-canvas-read-only`, each `light` and `dark` (kept as `.scratch/worfy-link/evidence/25-*.png`).

- **The hint**, one text everywhere: "<Machine> gives this Machine read-only access", <Machine> being the name of the Machine of the Project.
- **Write actions stay on screen, inactive**: dimmed to 50 % opacity, the `not-allowed` cursor, `aria-disabled="true"` (not `disabled`, so the tooltip shows), the hint as their tooltip; a click does nothing. This covers "New session", Interrupt, Close, Resume, Hide and Remove of a Session Node, Allow / Always allow / Deny of a permission request, "New conversation", Run wave, Ship ticket, Autopilot and its Stop and Force stop, the collapse button of an Epic frame, the items of the Canvas menu, Restore in the Trash, "Remove binding", "Remove from list" of a Project row, Resume in the Sessions history and Show where it would put a Node on the Canvas.
- **Fields**: the message field of the Session view is off (as with no Session running) with the hint as its placeholder; the field of a Session Node and a note are read-only, the hint as their placeholder or tooltip; the model and permission pickers are off with the hint as their tooltip. Dialogs (Project settings, "Plan first epic") show the hint as a line of secondary text under the content; their main button is disabled.
- **Canvas**: Nodes do not move or resize (no resize handles), panning and zooming work. The notice at the top centre of the Canvas — the surface with its border and the control shadow, secondary 12 px text, at most 640 px wide — shows the hint. A Terminal Node is drawn as its header ("Terminal") over the terminal colours, with the hint and "Terminal output is not shared with it." in the middle: its shell is not opened.
- **Sidebar**: beside the green "Online" chip of the Machine, the chip "Read only" — the surface raised, its border, secondary text — with the hint as its tooltip. In "Add project" the Machine cannot be chosen and shows the hint as its reason.
- **Themes**: only roles from the Tokens table; no colors of its own.

## worfy Guide
The worfy Guide (Epic worfy-guide, ADR-0090) is a modal window drawn like the Settings window and in its layer. Its diagrams follow the Living Canvas style of `.scratch/worfy-guide/spec.md`. Two exceptions to this spec hold inside the Guide only, and nowhere else in worfy:

- **Kind colours on its diagrams.** A block of a diagram may take a `kind-*` band as the colour of its group: the dot, the tinted header (`color-mix` of the band and the surface) and, while highlighted, its outline and its Edges. The rule of "Kind colours" above — never for status, never for an Edge — stays for the Canvas. A diagram never shows a status by colour alone, and every text on it keeps 4.5:1.
- **Larger type.** The Topic title is 22 px / 650 and the text of a Topic 14 / 21 px, for reading rather than scanning. The sizes of "Typography" stay for the rest of the window, the Guide's list, header and tables included.

Reference look in both themes and both languages: the e2e `test/e2e/guide.spec.ts` shoots the window as `guide-en` and `guide-ru`, each `light` and `dark` (kept as `.scratch/worfy-guide/evidence/03-guide-*.png`).

## Run history
The Run history screen (Epic worfy-flight-recorder, `src/renderer/flight-recorder/`) takes the whole main area instead of the Canvas: the header of the Run, the summary strip, the Wait and Orchestrator lanes, then the tree on the left and the bars on one time axis on the right. It has no tab in the toolbar; Esc goes back to the Canvas. One exception to this spec holds on this screen only, and nowhere else in worfy:

- **Span colours.** A bar takes the colour of its span kind from the `span-*` tokens below, so the eye finds the implementers, the CI runs and the gate runs of a long night. The rule of "Kind colours" above stays for the Canvas. An outcome is never a colour alone: it is written as a word in the row (`FAILED`, `BLOCKED`, `CUT-OFF`…), and a bar of a failed span adds a bottom edge in `span-problem`. A work kind fills its bar with its band and writes its label in `span-label`; Run, Wave and Stage fill with their tint and outline with the band; a Wait fills with stripes of its tint and stripe colours. A block is a `span-problem` mark «!» with its reason and `Waits:`, and the row is hatched with `span-hatch` after it; a span whose source is gone is hatched the same way and labelled («transcript deleted»…); a cut-off span ends in a zigzag that fades.
- **Labels never cross bars.** A label sits whole inside its bar after a 4 px padding, or right of the bar's end on the ground of the row; with room for neither it is not drawn and stays in the tooltip (`label-layout.ts`).

The values pass the checks of `test/unit/flight-recorder-span-tokens.test.ts`: `span-label` ≥ 4.5:1 on every work band; text and secondary text ≥ 4.5:1 on every tint and on the Wait stripe; every band and `span-hatch` ≥ 3:1 to the window ground, surface and surface raised; `span-problem` ≥ 4.5:1 on them, as it is text; every pair of work bands ΔE (CIE76) ≥ 15 under protanopia, deuteranopia and tritanopia (Machado 2009), and `span-problem` ΔE ≥ 15 from each work band. A Wait is told apart by its stripes and its lane, not by its hue.

| role | LIGHT | DARK |
|---|---|---|
| span-label (text on a work band) | text #FFFFFF | text #121110 |
| span-ticket (Ticket) | band #4E3FFA | band #8A6AF7 |
| span-implementer (agent: implementer) | band #3175CD | band #6079CF |
| span-verifier (agent: verifier) | band #6336C3 | band #BE9FFF |
| span-agent (agent: other) | band #647182 | band #95B0BA |
| span-ci (CI run) | band #986800 | band #E0A020 |
| span-gate (gate run) | band #147B3B | band #2CD168 |
| span-script (script) | band #344F85 | band #39A2C6 |
| span-orchestrator (Orchestrator turn) | band #A6205A | band #DB668D |
| span-run (Run) | band #5A6476, tint #E8EAEE | band #8F99AD, tint #25282F |
| span-wave (Wave) | band #6C7890, tint #ECEEF3 | band #7D889D, tint #21242B |
| span-stage (Stage) | band #71869E, tint #E6ECF3 | band #6A83A3, tint #1D232C |
| span-wait (Wait) | band #B25A17, tint #FBEEE4, stripe #F5DCC8 | band #E0874A, tint #2C1F15, stripe #3F2A1A |
| span-problem (block mark, failed edge) | text #C4262E | text #FF6B70 |
| span-hatch (after a block, lost source) | band #86868B | band #77726B |

## Light/dark pairing rule
Write the LIGHT file first. The DARK file must have the IDENTICAL markup structure, positions and copy — only token values differ (and light shadows removed in dark). Someone comparing the two should see the same screen in two appearances.
