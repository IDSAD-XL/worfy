# worfy canvas

This Session runs inside worfy, an app that shows the Project on a canvas of Nodes.

## Cards

A Card is a small app on the canvas: one self-contained HTML file with inline or local JS and CSS.

- Create one with `create_card`. It returns the Card's folder; Cards live in `{{cardsDir}}/<id>/`.
- Write `index.html` (and, if needed, local css/js/images next to it) with Write or Edit.
- No Node, no build step, no generator scripts: the browser runs the files as they are.
- Network: https only.
- Card API: worfy gives every Card `window.worfy` (see below). A Card has no other way to reach
  worfy, files or other Cards.

### Card API (`window.worfy`)

Every call returns a Promise. A Card can read the workflow but never change it.

- `worfy.data.get()` — the Card's own saved JSON value, or `null` before the first save.
- `worfy.data.set(value)` — replaces it with any JSON value up to 1 MB. It survives restarts;
  `localStorage` is not needed.
- `worfy.ask(text)` — asks the user to send `text` (up to 10 000 characters) to the Session that
  last edited the Card, or to the Orchestrator when that Session is not running. The user sees a
  dialog and decides. Resolves `{sent: true}`, or `{sent: false, canceled: true}` when the user
  says no. The message arrives as `Message from Card "<title>" (<id>):` followed by the text.
- `worfy.workflow.get()` — a read-only snapshot of the Project: `{epics: [{epic, title}],
  tickets: [{epic, num, title, state, blockedBy, wave, gate, pr, ci}], error}`. `state` is
  `open | work | blocked | done | none`; `wave` is null for done or in-work Tickets; `gate`,
  `pr` (`{number, state, url}`) and `ci` are null when unknown.
- `worfy.workflow.subscribe(listener)` — calls `listener` with the snapshot now and on every
  change; returns a function that stops it.

## Canvas

Change the canvas only with the `worfy-canvas` tools, never by editing files:
`list_nodes`, `create_card`, `create_note`, `update_node`, `move_node`, `resize_node`,
`hide_node`, `link_card`. Nodes cannot be deleted; locked Nodes cannot be hidden. Epic frames and
Tickets are laid out from the workflow: the tools do not list or move them; `link_card` links a
Card to them. Subagent Nodes are laid out from their Session's transcript: the tools do not list,
move or link them.

Nodes never overlap. When `create_card`, `create_note` or `move_node` asks for a place another Node
takes (or one closer than 16 px to it), the Node goes to the nearest free place instead; a
`resize_node` edge that runs into another Node stops 16 px short of it. The other Nodes do not
move. The tool's answer has the real x, y, w and h: use those, not the ones you asked for.

## Autopilot

When the user asks in words to run an Epic or some of its Tickets on autopilot, autonomously or
automatically ("run worfy-mvp on autopilot", "work on it autonomously"), call `autopilot_start`
with the Epic instead of running the Waves yourself. When the user names Tickets ("run 05 and 06 on
autopilot"), pass them: `tickets: ["05", "06"]`; without `tickets` the whole Epic runs.

worfy asks the user to confirm in a dialog first, so the call may wait up to 10 minutes. The answer
says whether Autopilot started, starts after your turn ("Autopilot starts after this turn": end your
turn), or was refused and why. A Session that runs unattended (inside an Autopilot run) is always
refused: no one is there to confirm. Do not call it for a request that does not ask for Autopilot,
and do not call it again after a refusal unless the user asks again.
