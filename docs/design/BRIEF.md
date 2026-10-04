# worfy — design brief (shared by all 5 directions)

## Product
worfy is a personal macOS desktop app (Electron). An infinite canvas per git repository ("project") that SHOWS and LAUNCHES the user's Claude Code workflow: epics → tickets (with blocking edges, computed "waves") → agent sessions bound to tickets → subagents they spawn (scout / implementer / reviewer) → gate/PR/CI results. Agents can also build small HTML mini-apps ("cards") that live on the canvas. Single local user, no login. UI copy is ENGLISH. Agent-written content (status blocks, chat text) may be Russian — that is realistic, the user writes in Russian.

Domain vocabulary (use exactly these words in UI): Project, Canvas, Node, Card, Terminal, Epic, Ticket, Wave, Gate, HANDOFF, Session, Orchestrator, Subagent, Binding, Limits. Action names: "Ship ticket", "Run wave", "Open PR", "Resume", "Allow", "Always allow", "Deny".

## Shared content (identical in every direction — so they compare fairly)

Window: macOS window with traffic lights, title "worfy — auction".

Sidebar: Projects — auction (active), worfy, atakama. Under auction: Epics list — `audit-2026-09-19` (7/12 done, 1 working), `lot-withdrawal` (done), `payments-v2` (3/9). Sessions: 3 live. ADR (120). Bottom: Settings.

Top bar: project "auction" · branch `main` · Limits: 5-hour 62% (resets 14:20), 7-day 38% (resets Thu 09:00) · Gate: green · "⌘K" command palette hint · primary action "Run wave".

### Screen 1 — Canvas (file `<X>-canvas.dc.html`)
Canvas viewport (dotted or plain ground, zoom 85%, minimap bottom-right) containing:
1. **Epic frame** "audit-2026-09-19 — Auction audit fixes", progress 7/12. Tickets laid out in columns by dependency level:
   - Done (collapsed stack): "5 done" — 01, 02, 03, 04, 05.
   - Wave 2 (ready, highlighted as "Ready wave · 3"): 07 "Rate-limit the bid endpoint" (open, Ship ticket button), 08 "Audit log for admin actions" (open, review VERIFIED on PR #409, CI green), 11 "Stale lot cache after auction close" (open).
   - In progress: 09 "Race in bid placement: unhandled rejection" (claimed — bound to subagent impl-09, PR #412, CI running, gate —), 06 "Withdraw-lot button for moderators" (done → shown done).
   - Blocked: 12 "Idempotent payment webhook" — blocked: "needs Stripe test keys from owner". Blocked by 09.
   - Dependency arrows: 09 → 12, 07 → 10 (10 "Bid throttling metrics", open, waiting).
2. **Orchestrator node** (pinned, live/busy): last status block shown verbatim:
   — Этап: audit-2026-09-19 · /implement · волна 2
   — Сейчас: impl-09 чинит гонку в ставках, PR #412 ждёт CI
   — Дальше: verify-09, затем волна 3
   — Жду: ничего
   Its subagent children connected by lines: `impl-09` (auction-implementer · sonnet · running 6m · bound to 09), `verify-08` (auction-reviewer · VERIFIED · done), `scout` (auction-scout · done, collapsed).
3. **External session node** "terminal · ~/Stuff/auction" read-only badge, idle, bound to epic payments-v2.
4. **HANDOFF node** — rendered markdown: "Сейчас в работе", "Дальше", "Ждёт владельца" (1 item: Stripe test keys), "Риски и долги".
5. **Card node** "Epic burndown" — an agent-made mini dashboard (simple bar/line chart drawn with divs or inline SVG, 12 → 5 remaining over 6 days).
6. **Terminal node** small, showing `$ pnpm test --filter bids` with a few lines and exit 0.

### Screen 2 — Session (file `<X>-session.dc.html`)
Focused view of the Orchestrator session (canvas dimmed/hidden behind or full-window panel):
- Header: "Orchestrator · auction", status busy, model "Opus 5.5", effort "high", permissions "bypass", cost this session "$4.12", Interrupt button.
- Transcript: user message (Russian) "прогони волну 2 эпика audit-2026-09-19"; assistant text; collapsed tool calls (`Bash epic-status --json` ✓, `Read spec.md`); subagent launch rows (impl-07, impl-08, impl-11 launched → status); a hook result row "Stop hook · gate fast · зелено (12 tests)"; a task-notification row "verify-08 finished · VERIFIED".
- A **permission request** card inline: Bash `git push origin fix/09-bid-race` — buttons Allow / Always allow / Deny.
- Composer at bottom: text "/ship" with slash autocomplete open listing `/ship-ticket`, `/epic-wave`, `/retro`, `/qmd`; attachment button; a queued message chip "1 queued".
- Right rail: Binding (epic audit-2026-09-19), Subagent tree with live statuses, Limits mini bars.

## Hard format rules (the artifact renderer fails silently otherwise)
Each file is ONE self-contained Design Component page:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Graphite — Canvas</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap">
<style>
body{margin:0}
a{color:#...}a:hover{color:#...}
</style>
</helmet>
<div style="...root...">
  ... ALL markup here ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1440,"height":900}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
```

Rules:
- Keep `<script src="./support.js"></script>` EXACTLY. Close every non-void element, quote every attribute.
- Styling: put visual styles INLINE (`style="..."`) on elements. `<helmet><style>` only for page basics: `body{margin:0}`, `a`/`a:hover` colors, font-face via Google Fonts `css2` `<link>` in `<helmet>` (the ONLY network allowed). No other external resources, no images/`<img>` files, no `data:` URIs, no `<iframe>`, `<object>`, `<embed>`, no emoji.
- Icons: inline stroke `<svg>` (small, currentColor). Window traffic lights are fine.
- This is a desktop app screen → root is FLUID: `width:100%; min-height:900px; box-sizing:border-box`; no fixed px width on the root. Sidebar + main: a `display:flex; flex-wrap:wrap` row, sidebar `flex: 1 1 240px; max-width: 260px`, main `flex: 999 1 560px; min-width:0`. The canvas viewport is a box `position:relative; height: 760px (or similar px); overflow:hidden` and nodes inside are `position:absolute` with px left/top — that is fine. Heights in px, never `%`.
- `{{hole}}` is a dotted lookup only. Simplest: write everything as literal markup and return `{}` from `renderVals()`. If you add tweaks, max 1–2 meaningful ones (e.g. `"accent"` color with `"editor":"color"`), never for copy.
- `data-props` is a single-quoted attribute holding JSON; must include `"$preview":{"width":1440,"height":900}`.
- No `<sc-for>` needed; if you use it, set `hint-placeholder-count`.
- Accessible markup: real `<button>` / `<a href="#">` / `<input>` with `<label>`, `aria-label` on icon-only buttons. Text contrast ≥ 4.5:1 (captions too). Status colors must differ in LIGHTNESS, not only hue; prefer blue/orange over red/green, and always pair color with a text label or icon.
- Craft: no lorem ipsum, no invented stats beyond the shared content above, no AI tropes (gradient washes, left-border accent cards, emoji, Inter/Roboto/Arial). 1–3 typefaces, a ground, 0–2 accents. Make it DETAILED and believable: real spacing system, consistent radii, hover-less static states clearly drawn, dense but legible like a real pro tool.
- Do NOT copy the look of any existing product (Linear, Figma, tldraw, Morphy, etc.). Original.
