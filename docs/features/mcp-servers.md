# MCP servers of a Session

One Feature. The **MCP servers of a Session** are the servers whose tools the agent of a running Session gets: the
user's own (from the user's config, a Project's `.mcp.json` or claude.ai connectors) and worfy's (`worfy-canvas`,
`worfy-browser`, `worfy-mind-map` and the Harness plugin's server). This page covers the chip «MCP n/m» in the bar under
a Session's input field, its popover, the actions on a server, taking in a server added while the Session runs, the servers the Project
does not allow, the same status in Project settings, and the Integrations a Project turns on there. Which servers a Session gets at its start is on
[Sessions](sessions.md#how-it-works); Claude Code and Codex are on [Vendors](vendors.md). New to the terms: start with
[Concepts](concepts.md).

## MCP servers of a Session

### Behaviour

#### The chip and its popover

- The chip «MCP n/m» stands in the bar under the input field of the Session view, on the hint line just left of the
  context meter, for a Claude Code and a Codex Session alike, in an Orchestrator and a Session Node. It moved there from
  the Session header, which had grown too crowded. n are the servers that are connected, m all the servers of the Session except those not allowed in the Project. While
  a server has failed, needs a sign-in or was not started, the chip takes the blocked colours and a warning icon. It is absent while main
  has no data, for a Session with no server, and in a Product Session. Its tooltip says the count in words, then how many
  failed, need auth or were not started, then how many more are not allowed: "3 of 4 MCP servers connected: 1 failed.
  2 more not allowed in this Project".
- A click opens a popover above the chip, over the input field, titled "MCP servers" with "n/m connected". It stays
  inside the window: its height is at most what fits above the chip, and its rows scroll past that. Each server has a row: its name,
  shown whole (a name too long for the row wraps to a second line; the row's buttons go under the name rather than
  squeeze it), its status (connected, failed, needs auth, pending, disabled, not allowed, not started), the number of its tools when the Vendor
  gave it, the error in the Vendor's words, and its source: claude.ai, user config, Project or worfy. A source worfy does
  not know by name (`managed`, `enterprise`, `agent` or a new one) shows as user config, with the Vendor's word in the
  tooltip. A status Claude Code reports that worfy does not know shows as disabled, with Claude Code's word in the
  error. A claude.ai connector's name drops the leading "claude.ai " that its source already says ("claude.ai Example
  Notebook" shows as "Example Notebook"); the full name is the name's tooltip, for every row.
- The servers that were not started stand in a group of their own under the Session's servers. Its heading says once
  why: "Allowed in this Project, but Claude Code did not start them in this Session." ("it" for one server), and has
  one "Restart Session" at the right end, whose tooltip says that it keeps the conversation. The group's rows have
  their name, status and source, and no button. A row has no error line either, unless a Restart would not start it:
  then its own reason stands under it (see "Servers not allowed in the Project" below).
- The servers not allowed in the Project stand in a group of their own below, "Not allowed in this Project".
- While two rows or more of that group offer Allow, its heading has "Allow all" at the right end. With one such row
  there is no "Allow all": the row's own Allow does the same. "Allow all" is the one primary button of the popover;
  each row's Allow is a secondary button.
- A row has a button for each action main offers for it; the window adds none of its own. A row of worfy's own
  servers (`worfy-canvas`, `worfy-browser`, `worfy-mind-map`) has no Turn off for this Session; a failed one still
  offers Reconnect. While an action runs, the
  buttons of its row wait, and "Allow all" and "Restart Session" wait too. A refused action shows a toast that names the action, the server and the reason, and the
  reason stays in the row ("Allow failed: …") until the next action there succeeds; the rows after an action come with
  its answer. A refused "Allow all" or "Restart Session" stays under its group's heading instead.
- Esc closes the popover and does not interrupt the turn. A press outside it, a resize of the window and the window
  losing focus close it too.

#### Actions

| Button | On which row | What it does |
|---|---|---|
| Reconnect | failed; needs auth on Claude Code, and on Codex where Sign in is not offered | Reconnects the server in the running process. On needs auth it is for after a sign-in done elsewhere. |
| Sign in | needs auth, when the Vendor can start the sign-in | Opens the server's sign-in page in the system browser and waits for the sign-in. |
| Turn off for this Session | connected, Claude Code, a person at the Session, not one of worfy's own servers | Restarts the Session with the same conversation without the server. Its row stays, disabled, with Turn on. |
| Turn on | turned off for this Session | Restarts the Session with the same conversation with the server back. |
| Allow | not allowed, Claude Code | Puts the server on the Profile's list and restarts the Session with the same conversation. |
| Allow all | the heading of "Not allowed in this Project", while two rows or more offer Allow | Puts every server of the group on the Profile's list with one write and restarts the Session once. |
| Restart Session | the heading of the not started group, Claude Code, a person at the Session | Restarts the Session with the same conversation, once for the whole group, so Claude Code starts again with the list. |

- **Restart with the same conversation.** Turn off, Turn on, Allow, Allow all and Restart Session end the Session's process and start a new one that
  resumes the same conversation, in the same Session. A turn that runs is interrupted first, as Interrupt does, and the
  queue is held. The Session is `starting` meanwhile, and what is sent to it waits for the new process. After a turn has
  run the Session keeps its id; before the first turn there is no conversation to resume, so the new process starts a new
  one under a new id. Only the not started group has a Restart button of its own, in its heading.
- **Not while background tasks run.** Ending the process would end the Session's background tasks too (commands and
  agents the Session started in the background). In a Session with a person at it, while any of them runs, Turn off,
  Turn on, Allow, Allow all and Restart Session change nothing: no turn is interrupted, nothing is written to the Profile, and
  the answer is the reason ("1 background task of this Session is still running, and a Restart would end it. Try again
  once it finishes."), shown as any refused action is. A task that starts while the running turn is being interrupted,
  or while Allow writes the Profile, keeps the process too; that turn stays interrupted, and a list Allow wrote by then
  stays written. Once the tasks end, the same button works, with no new read of the rows. An Autopilot Session is not
  touched by this rule: Allow there writes the list with no Restart, as described below.
- **Turn off for this Session** changes neither the Profile nor the user's config: a new Session gets the server again.
  worfy's own servers (`worfy-canvas`, `worfy-browser`, `worfy-mind-map`) are never turned off: their rows offer no Turn
  off, and main refuses a Turn off of such a server asked for all the same, before anything restarts. A server of a
  plugin the user installed shows the source worfy too, and keeps Turn off.
- **Allow** writes the Profile through the Harness, as Edit profile does. A Profile with no list gets the default list
  with the name added. The Allows of one Project take turns, whichever of its folders the Session runs in: each reads
  the list after the write before it, so Allow pressed on many servers at once writes them all. When a write from
  elsewhere (Edit profile, an agent, an editor) changed the list between Allow's read and its write, Allow reads the
  list again and adds the name to that, three tries in all. When the write is refused (the list changed on every try,
  the Profile is busy, or the Harness is too old), the row and a toast give the reason and the Session stays as it
  was. While the Restart of another Allow is starting the process, Allow waits for that start and restarts again only
  when the new process lacks the server. After the Restart the answer waits, 10 seconds at most, until the server has
  left pending, so the popover shows it without another turn. When the new process still does not have the server, the
  answer is an error: the name is on the list, but Claude Code did not start the server in this Session.
- **Allow all** sends the names of the group's rows that offer Allow in one call. main writes them with one write of the
  Profile, in the same turn-taking of the Project as Allow, adding the names the list lacks in their order; then it
  restarts the Session once, whatever the number of names, and waits for the servers as Allow does. While it runs, the
  rows' Allow buttons wait. A refused write gives the reason in a toast and in a line under the group's heading ("Allow
  all failed: …"), which stays through new rows until the next Allow all answers; the Session stays as it was. When the
  new process lacks some of the servers, the error names them. In an Autopilot Session it writes the Profile without a
  Restart.
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
- The inventory lists claude.ai connectors too, and keeps the address of each remote server (http, sse, a claude.ai
  connector) in main, never in a row, a log or the Journal. Claude Code allows a server by name only when the name has
  nothing but letters, digits, `_` and `-`, and a connector's name (`claude.ai <name>`) has a dot and a space. So a
  Session starts with every allowed remote server the inventory's last answer knows in the list by its address, the other
  servers by name. The address is written as its exact origin and path, followed by `?*` when it has a query, so no token
  reaches the arguments of the Claude Code process. A server turned off for the Session is denied by its name as well.
- A row "not started" is a server the list names that the inventory finds but that the Session does not have: Claude
  Code left it out (a remote server found after the Session started, or one connected after the process started). It
  stands in the not started group, counts in m, and has the blocked status chip as failed has; in an attended Session the
  group's heading offers Restart Session. Its reason says when Restart helps: "Found after this Session started:
  restart the Session to start it." A server Claude Code can allow neither by its name nor by an address (a connector the
  inventory gave no address for) says so and offers no Restart. The popover shows such a reason under the row's name
  when the row offers no Restart and the reason is not the heading's own words; the reason of a row Restart helps is
  not repeated under it, as the heading and its Restart Session say it.
- The group ends with a line: "A claude.ai connector missing here: add its name to MCP servers in Project settings (Edit
  profile)." A connector the inventory finds is in the group already; the line is for one it does not.
- A Session outside every Project has no list: it runs no inventory and has no such rows.

#### In Autopilot

The set of servers of an Autopilot Session is fixed when the Session starts, for the Wave. It takes in no new server, and
its rows offer no Turn off; Turn off, Turn on and a Restart are refused. Reconnect and Sign in work, since they do not
change the set. Allow and Allow all write the Profile without a Restart, and the servers join from the next Wave. In the
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
- An Integration of the Project (one account of a service worfy signs in to) reaches Codex through the same endpoint
  on `127.0.0.1` as `worfy-canvas`, under its server name; the service's token stays in worfy. Its row shows the
  Integration's label as the name, the server name in the tooltip, and the source `worfy integration`. When the service refused the sign-in the row needs a
  sign-in and says "Sign-in needed: <label>"; it offers Reconnect, never Codex's Sign in, which would sign in to
  worfy's endpoint rather than to the service. An Integration that signs in through the service's page also offers
  worfy's own Sign in (see Integrations below). An Integration whose server name is a server of the user's `config.toml`
  replaces that server in the Session, and its row says so under it. An unattended Session gets only the Integrations
  «Available to Autopilot».

#### In Project settings

Edit profile shows, under the field "MCP servers", each name of the list with its status in the Session of the Project
on this Machine, its Orchestrator or a Session Node, whose rows reached this window last. A name that Session does not
have shows without a status; with no Session, nothing shows. The form is on [Projects](projects.md).

#### Integrations

An **Integration** is an account of a service (Jira and Confluence, Linear, GitHub, a custom MCP server…) that worfy
signs in to and keeps on this Machine; the Sessions of a Project that turns it on get it as a server of worfy's, whose
row in the chip shows its label and the source `worfy integration`. Claude Code and Codex never see the token.

- **Project settings → Integrations** (a tab beside General) lists the Project's Integrations under «worfy
  integrations»: the label, the service and the site, the status (`Signed in`, `Sign-in needed` with Sign in, `Error`
  with the service's text, `Checking`), the tools and their size, the Tools filter, the ticks Enabled and Autopilot, and
  a «…» menu with Test, Rename, Re-sign in (for an Integration that signs in through the service's page), Sign out,
  Disable in this Project and Remove from Machine. Changes go to main at once; the tab has Close, not Save.
- **Sign in** of an Integration that signs in through the service's page (OAuth) opens the service's sign-in page in a
  worfy window; the row reads `Checking`, then `Signed in` with the site (or the server's address: the sign-in names no
  account), its tools and their size. A sign-in that does not finish leaves the row needing one, with the reason under
  the section.
- **The size of the tools** («12 of 41 tools · ~3k tokens») is counted after the Project's Tools filter: worfy's
  server lists only the tools the filter lets through, so that is what each request of the Project's Sessions carries.
- **Tools filter**: All (the default), Read only (the tools the service marks read-only; not offered for a service that
  marks none, with the reason), or Choose… for a list of names.
- **Available to Autopilot** is off for a new Integration.
- **Add integration** opens the catalogue (no Slack); an Integration of this Machine the Project does not use yet shows
  on top as «Use in this Project», which turns it on without a second sign-in. A service's form takes a Label unique on
  the Machine and its token (Atlassian: the e-mail and the API token; GitHub: a token or the one of the Project's gh
  account, with its scopes shown). A custom server takes an `https://` address (`http://` only on this computer) or a
  command worfy starts, whose variables marked Secret go to the secret store. After the token worfy checks the sign-in
  and lists the tools. A service that signs in through its page (Atlassian, Linear, Notion, Sentry, Figma, a custom server that can)
  also offers «Sign in with <service>»: no token field; saving adds the Integration and opens the sign-in window, then
  lists the tools. The token is the way picked when the form opens; Figma has the sign-in page only.
- **From Claude Code** under it lists the servers and claude.ai connectors of Claude Code, as Edit profile does, with
  Allow; a Profile with no list shows the default one (`plugin_worfy_qmd`, `worfy-canvas`) as allowed, as Sessions get
  it. When one of them is a service of the catalogue whose Integration this Project has on, the row warns that the
  Sessions get two tool sets of it, possibly of different accounts, and offers to turn the server off in this Project.
  «Add as integration» opens Add integration on that service; the Profile's list does not change by itself.
- **Settings → Integrations** lists every Integration of the Machine, its status and the Projects that use it, with
  Sign out and Remove; an Integration that signs in through the service's page and needs a sign-in has Sign in too,
  through the first Project that uses it. Sign out of such an Integration also asks the service to revoke its tokens and
  clears its sign-in window's cookies; Remove signs it out first. One no Project uses shows «Not used in any Project».
  Entries a Project still keeps of an Integration the Machine no longer has (a Remove cut short) are named in one line
  with Clean up. When the Machine's list could not be read (its file damaged or of another version, and set aside) a
  line names the set-aside file and says Clean up waits: every entry would look removed.
- **In the chip** of a running Session an Integration's row says what worfy found: when the service refused the sign-in
  it needs a sign-in with «Sign-in needed: <label>», and Sign in of an Integration that signs in through the service's
  page opens worfy's sign-in window — never Claude Code's or Codex's sign-in. An Integration the Project turned on after
  the Session started stands in the group «Enabled in this Project after this Session started.», whose Restart Session
  restarts the Session with the same conversation and gives it the Integration.
- **Autopilot**: an unattended Session gets only the Integrations «Available to Autopilot», read when it starts; a
  change of the Project during the Wave does not reach it, and its rows offer no Restart. A refused sign-in is never
  mended by Autopilot: the tool answers «Sign-in needed: <label>…», no sign-in window opens, and Health check gets a row.
- **Health check** has a non-critical row per enabled Integration of each Project whose sign-in the service refused or
  that failed: «Integration: <label>», «<label>: sign-in needed» (or the service's text, tokens hidden), with Sign in for
  one that signs in through the service's page and where to put a new token for the others. A sign-in that works again
  takes the row back to OK.
- **On a Linked machine** with read-only access the section shows the list and the status, and every control is
  inactive. With full access the ticks, the filter, Rename and Sign in work — the sign-in window opens on the Project's
  machine; Add integration, the token, Sign out and Remove stay on the Project's machine, because a token never crosses
  the link.

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
- **The inventory leaves no Session on the Canvas.** Its Claude Code runs in worfy's own folder
  (`<WORFY_DATA_DIR>/terminal-ai`, as the Limits probe does), keeps no transcript, and so is no Session of the Project
  and no Session Node. The Session's folder is its project config root (`--project-config-root`): Claude Code reads the
  Project's `.mcp.json`, settings and plugins there, and starts the Project's stdio servers in that folder with
  `CLAUDE_PROJECT_DIR` set to it, as for the Session. The Project's record in the user's `.claude.json` is the one thing
  that flag does not move, so worfy reads it under the key Claude Code gives the Session's folder: the main checkout's
  root for a worktree, the bare repository's folder for a worktree of a bare one, and on Windows with forward slashes
  (`D:/work/proj`). Its local servers are handed to the query and keep their rows. Of the servers turned off there
  with `/mcp`, a server of the Project's `.mcp.json` is not started; a user server or a claude.ai connector turned off
  only in this Project still connects for the inventory's few seconds, since Claude Code reads that setting from its
  own folder's record alone.
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
| The MCP inventory and the rows not allowed | `src/main/vendors/claude/mcp-inventory.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/project-mcp.ts` |
| Codex: rows, Reconnect, Sign in | `src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/session.ts` |
| Restart, Turn off, Turn on, Allow | `src/main/agent/session.ts`, `src/main/vendors/claude/options.ts` |
| Allow's write of the Profile | `src/main/ipc/profile-edit.ts` |
| Channels `agent.mcp`, `agent.mcpAction`, `agent.mcpAllowAll` and their handlers | `src/shared/ipc/agent.ts`, `src/main/ipc/agent.ts` |
| The chip, the popover, the status in Edit profile | `src/renderer/session/McpChip.tsx`, `src/renderer/session/mcp-chip.css`, `src/renderer/session/header-facts.ts`, `src/renderer/session/store.ts`, `src/renderer/projects/EditProfile.tsx` |
| The chip's place in the bar under the input field | `src/renderer/session/composer/McpServers.tsx`, `src/renderer/session/product-session.ts` |
| The test agent's MCP answers | `src/main/agent/fake-query.ts` |
| Integrations in Project settings and in Settings | `src/renderer/integrations/IntegrationsSection.tsx`, `src/renderer/integrations/AddIntegrationDialog.tsx`, `src/renderer/integrations/ClaudeServers.tsx`, `src/renderer/integrations/cost.ts`, `src/renderer/settings/IntegrationsSection.tsx` |
| Their channels | `src/shared/ipc/integrations.ts`, `src/main/ipc/integrations.ts` |

**Data flow.** The driver of the Session's Vendor sends its rows as an `mcp` event. The Session adds the rows of the
servers turned off for it and sends only a change on `agent.event`; the renderer store keeps the latest rows of each
Session apart from the transcript. The chip asks `agent.mcp` once when it has no rows yet, and with `pickUp` each time the
popover opens. A button calls `agent.mcpAction`, which answers the rows after the action, or the Vendor's error; "Allow
all" calls `agent.mcpAllowAll` with the names, which answers the same way. `agent.mcp` is a read channel, `agent.mcpAction`
and `agent.mcpAllowAll` write channels, so read-only access on a Linked machine may read but not act.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/mcp-status-row.test.ts` | The source of each SDK word, the rows of a recorded answer, no Turn off for worfy's own servers while a plugin's server keeps it. |
| `test/unit/mcp-chip.test.tsx` | The count of the chip, its warning, the popover's rows and groups, the buttons, "Allow all", the not started group and its "Restart Session", names shown whole, the popover opening upward, the ask with `pickUp` on opening. |
| `test/unit/session-view.test.tsx` | The chip in the bar under the input field, not in the header, and none in a Product Session. |
| `test/unit/edit-profile.test.tsx` | The status beside each name of the MCP servers list in Edit profile, none without a Session, none for a Project of a Linked machine. |
| `test/unit/codex-mcp-row.test.ts` | The rows of Codex: each status, Sign in only for an HTTP server, the tools, the source, never not allowed; an Integration's row with its label, a refused sign-in, no Sign in. |
| `test/contract/claude-mcp-status.test.ts` | The `mcp` event of a Claude Code Session over the fake agent, `agent.mcp`, Reconnect and the order of answers. |
| `test/contract/claude-mcp-pickup.test.ts` | Taking in a new server between turns only, and nothing in an Autopilot Session. |
| `test/contract/claude-mcp-turn-off.test.ts` | Restart with the same conversation after the old process exits, Turn off and Turn on, no Turn off of worfy's own server, Restart before the first turn. |
| `test/contract/claude-mcp-inventory.test.ts` | The query of the inventory, run outside the Project with the Session's folder as its config root, the rows not allowed, and the rows not started of servers only the inventory finds. |
| `test/unit/claude-project-mcp.test.ts` | The Project's record in `.claude.json` the inventory reads: by the main checkout's root, local servers as written, the turned-off ones; its key on Windows, in a linked worktree, a bare repository and a nested one. |
| `test/unit/mcp-addresses.test.ts` | The entries of the list: a name Claude Code takes, an address and its pattern without the query, the addresses of an answer of the inventory, an empty list. |
| `test/contract/claude-mcp-addresses.test.ts` | The addresses kept in main only, a Session's start taking them, the list by address, the reason of a row not started. |
| `test/contract/claude-mcp-allow.test.ts` | Allow and Allow all through a stub `bin/profile-set`: two Allows at once, a list changed in between, a refused write, a server the restarted process does not have, the queue key of a worktree, a Turn off of worfy-canvas refused over IPC. |
| `test/contract/claude-mcp-sign-in.test.ts` | Sign in, the claude.ai connector, nothing logged, a Claude Code without the sign-in. |
| `test/contract/codex-mcp-status.test.ts` | A Codex Session on the fake app-server: notifications, the list, Reconnect, Sign in, the refused actions. |
| `test/contract/integrations-codex.test.ts` | The Integrations of a Codex Session on the fake app-server: their keys in `thread/start`, two on one address answering each with its own data, the tools filter on `tools/list` and `tools/call` of the endpoint, Autopilot, outside a Project, their rows, the service's token nowhere Codex or a log sees it. |
| `test/contract/sdk-compat.test.ts` | The SDK still has the sign-in method worfy calls. |
| `test/e2e/session-mcp.spec.ts` | The chip under the input field and the popover above it in the built app, Reconnect, Allow in the same Session, the not started group with its Restart Session; shots of the popover in both themes. |
| `test/unit/integrations-section.test.tsx` | The rows of each status, the Tools filter and its price, the ticks, the «…» menu, Remove's confirmation, «two tool sets» and «Add as integration», a Linked machine. |
| `test/unit/add-integration-dialog.test.tsx` | The catalogue without Slack, «Use in this Project», the unique Label, the token fields, a custom server over http and stdio. |
| `test/contract/integrations-screen.test.ts` | The channels of the screen: the tools before the filter and the price after it, Sign out, the Machine's list with orphans and Clean up, Remove from Settings, the gh account's token. |
| `test/e2e/integrations.spec.ts` | Add integration on a stub server in the built app, the row signed in, two Projects on one address each with its own data, the Integration in the chip of a new Session; Sign in with OAuth in worfy's window on the OAuth stub, Restart giving a running Session the Integration, and a refused refresh as «Sign-in needed» in the row, the chip and Settings → Health; shots in both themes. |
| `test/contract/integrations-autopilot.test.ts` | Autopilot gets only the Integrations «Available to Autopilot», its set fixed for the Wave; a refused sign-in answers «Sign-in needed», makes the Health check row and opens no window. |
| `test/contract/integrations-health.test.ts` | The Health check rows of the Integrations: non-critical, one per Integration of each Project that has it on, Sign in for OAuth, no token in the text, back to OK after a sign-in. |
| `test/contract/integrations-linked-machine.test.ts` | What a Linked machine may do with the Integrations: read only, full access with Sign in on the Project's machine, and the channels never open to it. |
| `test/unit/settings-integrations.test.tsx` | Settings → Integrations: the line of a set-aside list, Sign in through a Project that uses the Integration. |
| `test/unit/sign-in-windows.test.ts` | An Autopilot confirmation and the app's events go to worfy's windows, never to a sign-in window; every list of windows in main leaves the sign-in windows out. |
