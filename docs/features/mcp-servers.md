# MCP servers of a Session

One Feature. The **MCP servers of a Session** are the servers whose tools the agent of a running Session gets: the
user's own (from the user's config, a Project's `.mcp.json` or claude.ai connectors) and worfy's (`worfy-canvas`,
`worfy-browser`, `worfy-mind-map` and the Harness plugin's server). This page covers the chip «MCP n/m» in the Session
header, its popover, the actions on a server, taking in a server added while the Session runs, the servers the Project
does not allow, and the same status in Project settings. Which servers a Session gets at its start is on
[Sessions](sessions.md#how-it-works); Claude Code and Codex are on [Vendors](vendors.md). New to the terms: start with
[Concepts](concepts.md).

## MCP servers of a Session

### Behaviour

#### The chip and its popover

- The chip «MCP n/m» stands in the header of the Session view, after Cost, for a Claude Code and a Codex Session alike.
  n are the servers that are connected, m all the servers of the Session except those not allowed in the Project. While
  a server has failed, needs a sign-in or was not started, the chip takes the blocked colours and a warning icon. It is absent while main
  has no data, for a Session with no server, and in a Product Session. Its tooltip says the count in words, then how many
  failed or need auth, then how many more are not allowed: "3 of 4 MCP servers connected: 1 failed. 2 more not allowed
  in this Project".
- A click opens a popover under the chip, titled "MCP servers" with "n/m connected". Each server has a row: its name,
  its status (connected, failed, needs auth, pending, disabled, not allowed, not started), the number of its tools when the Vendor
  gave it, the error in the Vendor's words, and its source: claude.ai, user config, Project or worfy. A source worfy does
  not know by name (`managed`, `enterprise`, `agent` or a new one) shows as user config, with the Vendor's word in the
  tooltip. A status Claude Code reports that worfy does not know shows as disabled, with Claude Code's word in the
  error. The servers not allowed in the Project stand in a group of their own below, "Not allowed in this Project".
- A row has a button for each action main offers for it; the window adds none of its own. While an action runs, the
  buttons of its row wait. A refused action shows a toast that names the action, the server and the reason, and the
  reason stays in the row ("Allow failed: …") until the next action there succeeds; the rows after an action come with
  its answer.
- Esc closes the popover and does not interrupt the turn. A press outside it, a resize of the window and the window
  losing focus close it too.

#### Actions

| Button | On which row | What it does |
|---|---|---|
| Reconnect | failed; needs auth on Claude Code, and on Codex where Sign in is not offered | Reconnects the server in the running process. On needs auth it is for after a sign-in done elsewhere. |
| Sign in | needs auth, when the Vendor can start the sign-in | Opens the server's sign-in page in the system browser and waits for the sign-in. |
| Turn off for this Session | connected, Claude Code, a person at the Session | Restarts the Session with the same conversation without the server. Its row stays, disabled, with Turn on. |
| Turn on | turned off for this Session | Restarts the Session with the same conversation with the server back. |
| Allow | not allowed, Claude Code | Puts the server on the Profile's list and restarts the Session with the same conversation. |
| Restart Session with the same conversation | not started, Claude Code, a person at the Session | Restarts the Session with the same conversation, so Claude Code starts again with the list. |

- **Restart with the same conversation.** Turn off, Turn on, Allow and the Restart of a not started row end the Session's process and start a new one that
  resumes the same conversation, in the same Session. A turn that runs is interrupted first, as Interrupt does, and the
  queue is held. The Session is `starting` meanwhile, and what is sent to it waits for the new process. After a turn has
  run the Session keeps its id; before the first turn there is no conversation to resume, so the new process starts a new
  one under a new id. Only a not started row has a Restart button of its own.
- **Turn off for this Session** changes neither the Profile nor the user's config: a new Session gets the server again.
  worfy's own servers can be turned off too.
- **Allow** writes the Profile through the Harness, as Edit profile does. A Profile with no list gets the default list
  with the name added. When another write changed the list between Allow's read and its write, Allow reads the list
  again and adds the name to that, three tries in all: Allow pressed on several servers one after another writes them
  all. When the write is refused (the list changed on every try, the Profile is busy, or the Harness is too old), the
  row and a toast give the reason and the Session stays as it was. After the Restart the answer waits, 10 seconds at
  most, until the server has left pending, so the popover shows it without another turn. When the new process still
  does not have the server, the answer is an error: the name is on the list, but Claude Code did not start the server
  in this Session.
- **Sign in** in a Claude Code Session opens the page Claude Code gives, only an http or https one; Claude Code itself
  takes the callback on localhost and the token, and worfy never sees it. The action ends once the server is out of
  needs auth, 10 minutes at most; a server that failed after the sign-in is reconnected once. A claude.ai connector signs
  in on claude.ai: the action ends once the page is open, and Reconnect is pressed after the sign-in. A Claude Code that
  cannot start the sign-in offers only Reconnect, and the row, unless it carries an error of its own, says where to sign
  in: "Sign in with /mcp in Claude Code in a terminal (a claude.ai connector: in its settings on claude.ai), then press
  Reconnect."

#### A server added while the Session runs

The user adds a server to the user's config (`claude mcp add`) while a Claude Code Session runs. Opening the popover
lets main take in a server the Profile's list allows, in the same process, with no Restart. It does so only between
turns and only in a Session a person is at: never during a turn, never in an Autopilot Session, and never on its own
after a turn. A server the list does not name shows in the group "Not allowed in this Project" instead. Whether the same
take-in brings in a claude.ai connector connected while the Session runs is not verified yet: it waits for the owner's
live check.

#### Servers not allowed in the Project

- A Claude Code Session in a Project gets only the servers on its Profile's list
  ([ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md)), and Claude Code does not report the ones it cut. worfy
  finds them with a query of its own, the MCP inventory: Claude Code with the user's settings, but without the Profile's
  list and without worfy's servers, and with no message, so no model is called. It runs when the Session starts and each
  time the popover opens, in an Autopilot Session too.
- A row "not allowed" is a server of the user, not worfy's or a plugin's, that the list does not name, that the Session
  does not have and that is not turned off for this Session. It offers Allow, and its number of tools, when the inventory
  knew it, says what Allow adds to each turn.
- A row "not started" is a server the list names that the inventory finds but that the Session does not have: Claude
  Code left it out (a claude.ai connector allowed by its name, or one connected after the process started). It stands
  with the Session's servers, counts in m, and offers Restart with the same conversation in an attended Session.
- The group ends with a line: "A claude.ai connector missing here: add its name to MCP servers in Project settings (Edit
  profile)." The inventory may not list claude.ai connectors, so a connector missing from the group is allowed by typing
  its name into the list.
- A Session outside every Project has no list: it runs no inventory and has no such rows.

#### In Autopilot

The set of servers of an Autopilot Session is fixed when the Session starts, for the Wave. It takes in no new server, and
its rows offer no Turn off; Turn off, Turn on and a Restart are refused. Reconnect and Sign in work, since they do not
change the set. Allow writes the Profile without a Restart, and the server joins from the next Wave. In the
Orchestrator's popover, while Autopilot of its Project runs, an Allow row says "Allow takes effect from the next Wave".

#### Codex

A Codex Session has the same chip and popover, with these differences:

- Codex shows the user's servers as they are: no row is "not allowed" and none offers Allow, since the Profile's list is
  not applied to the user's servers in Codex. A server worfy gave the Session is worfy; any other is user config, and a
  server of a Codex plugin is user config with `plugin` in the tooltip.
- Reconnect, on a failed server, asks Codex to reload its MCP servers. Sign in, on a server that needs a sign-in, is for an
  HTTP server: its page opens in the system browser, and the action ends when Codex says the sign-in is over. A failed
  sign-in shows Codex's words; one not over in 10 minutes fails. A server that needs a sign-in and is not HTTP gets Reconnect.
- There is no Turn off and no Turn on: Codex has no way to turn a server off for one thread only. Opening the popover only
  reads the list; worfy takes in nothing.

#### In Project settings

Edit profile shows, under the field "MCP servers", each name of the list with its status in the Session of the Project
on this Machine, its Orchestrator or a Session Node, whose rows reached this window last. A name that Session does not
have shows without a status; with no Session, nothing shows. The form is on [Projects](projects.md).

#### On a Linked machine

- With read-only access the chip and the popover show the rows of the Machine that runs the Session, and each action
  button is inactive, with a tooltip that says why; that Machine refuses the action too. Opening the popover still asks
  for the rows as a person does: on the Session's Machine main may take in a new server and runs the inventory.
- Sign in opens the sign-in page in the browser of the Machine that runs the Session.
- Edit profile of a Project of a Linked machine shows no status beside the names.

### How it works

- **main builds the rows, the window draws them.** The driver of each Vendor turns its answer into one shared row and
  decides which actions the row offers; the window knows nothing of the Vendor and draws a button per action, so it has
  no rule of its own for Codex.
- **When the status is read.** A Claude Code Session asks Claude Code after `system/init`, after each turn's `result`,
  after each action and when a window asks. A Codex Session takes each server's start from Codex's notification at once,
  and asks the full list, with the tools and the sign-in state, once no server is starting any more, then when a window
  asks and after each action. A failed read is "no data": the turn goes on and the chip disappears.
- **Turn off is a Restart, not Claude Code's own switch.** Claude Code's `toggleMcpServer` writes the user's
  `.claude.json`, which would turn the server off outside this Session too, so worfy never calls it. Each process of the
  Session starts without the servers turned off: their names are left out of the Profile's list it passes, worfy's own are
  not passed at all, and with no list the policy tier denies them by name.
- **One process on a conversation.** The new process of a Restart starts only after the old one has exited, as every
  relaunch does ([ADR-0064](../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)). Two Restarts at once, or a
  close or an Autopilot Stop while a Restart waits for the interrupted turn, start no second process.
- **One inventory per Project and Machine.** A Session in a worktree asks for the inventory of its Project as one in the
  main checkout does, so a Wave of Sessions in several worktrees starts one Claude Code, and an ask while one runs gets the
  running one. The inventory waits up to 10 seconds for its servers to leave pending, then reads them as they are, and
  gives up when Claude Code has not answered 40 seconds after the start. For those seconds the user's servers run once
  more, an stdio server as a process of its own. The answer is kept in main's memory until the next run, never on disk.
- **The user's servers stay on the user's screen.** A row carries no config: the server's URL and headers stay in the
  driver. When Claude Code fails to report the status, to take in a server or to run the inventory, the log gets the
  kind of the failure alone, without a server's name, and the address of a sign-in page reaches only the browser. The
  decision record of the whole Feature is the amendment of
  [ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md#amendments).

### Implementation

#### Modules

| What | Where |
| ---- | ----- |
| The row: statuses, sources, actions | `src/shared/agent/mcp-status.ts` |
| The seam of a Vendor driver: `status`, `act`, `restarts` | `src/main/vendors/mcp.ts` |
| Claude Code: status, take-in, Reconnect, Sign in | `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/session.ts`, `src/shared/vendors/claude/events.ts` |
| The MCP inventory and the rows not allowed | `src/main/vendors/claude/mcp-inventory.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts` |
| Codex: rows, Reconnect, Sign in | `src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/session.ts` |
| Restart, Turn off, Turn on, Allow | `src/main/agent/session.ts`, `src/main/vendors/claude/options.ts` |
| Allow's write of the Profile | `src/main/ipc/profile-edit.ts` |
| Channels `agent.mcp`, `agent.mcpAction` and their handlers | `src/shared/ipc/agent.ts`, `src/main/ipc/agent.ts` |
| The chip, the popover, the status in Edit profile | `src/renderer/session/McpChip.tsx`, `src/renderer/session/mcp-chip.css`, `src/renderer/session/header-facts.ts`, `src/renderer/session/store.ts`, `src/renderer/projects/EditProfile.tsx` |
| The test agent's MCP answers | `src/main/agent/fake-query.ts` |

**Data flow.** The driver of the Session's Vendor sends its rows as an `mcp` event. The Session adds the rows of the
servers turned off for it and sends only a change on `agent.event`; the renderer store keeps the latest rows of each
Session apart from the transcript. The chip asks `agent.mcp` once when it has no rows yet, and with `pickUp` each time the
popover opens. A button calls `agent.mcpAction`, which answers the rows after the action, or the Vendor's error.
`agent.mcp` is a read channel and `agent.mcpAction` a write channel, so read-only access on a Linked machine may read but
not act.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/mcp-status-row.test.ts` | The source of each SDK word and the rows of a recorded answer. |
| `test/unit/mcp-chip.test.tsx` | The count of the chip, its warning, the popover's rows and group, the buttons, the ask with `pickUp` on opening. |
| `test/unit/edit-profile.test.tsx` | The status beside each name of the MCP servers list in Edit profile, none without a Session, none for a Project of a Linked machine. |
| `test/unit/codex-mcp-row.test.ts` | The rows of Codex: each status, Sign in only for an HTTP server, the tools, the source, never not allowed. |
| `test/contract/claude-mcp-status.test.ts` | The `mcp` event of a Claude Code Session over the fake agent, `agent.mcp`, Reconnect and the order of answers. |
| `test/contract/claude-mcp-pickup.test.ts` | Taking in a new server between turns only, and nothing in an Autopilot Session. |
| `test/contract/claude-mcp-turn-off.test.ts` | Restart with the same conversation after the old process exits, Turn off and Turn on, Restart before the first turn. |
| `test/contract/claude-mcp-inventory.test.ts` | The query of the inventory and the rows not allowed. |
| `test/contract/claude-mcp-allow.test.ts` | Allow through a stub `bin/profile-set`: two Allows at once, a list changed in between, a refused write, a server the restarted process does not have. |
| `test/contract/claude-mcp-sign-in.test.ts` | Sign in, the claude.ai connector, nothing logged, a Claude Code without the sign-in. |
| `test/contract/codex-mcp-status.test.ts` | A Codex Session on the fake app-server: notifications, the list, Reconnect, Sign in, the refused actions. |
| `test/contract/sdk-compat.test.ts` | The SDK still has the sign-in method worfy calls. |
| `test/e2e/session-mcp.spec.ts` | The chip and the popover in the built app, Reconnect, Allow in the same Session. |
