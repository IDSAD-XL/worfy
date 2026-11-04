# Vendors

One Feature. A **Vendor** is the maker of the agent a [Session](sessions.md) runs on: Claude Code (Anthropic) or Codex
(OpenAI). This page covers how the user picks a Vendor and signs in to it, what a Codex Session offers and lacks, how the
Orchestrator, Subagents, Binding and the Harness work on Codex, and how worfy runs each agent behind one seam. The Session itself (states, queue, Resume, history) is on [Sessions](sessions.md),
the Limits panel on [Transcripts and usage](transcripts-and-usage.md). Terms are explained in [Concepts](concepts.md).

## Vendors

### Behaviour

**Two Vendors.** Claude Code is required: the first-run checks need its sign-in ([Onboarding](onboarding.md)). Codex is
optional. A user who never signs in to Codex sees no error anywhere, and a build without Codex works the same, with Codex
named absent in Settings → Vendors. worfy signs in to each Vendor only by its subscription: Codex by a ChatGPT account. An
API key is never asked for, and Codex signed in with an API key counts as not signed in.

**Picking the Vendor.** "New session" in the sidebar opens a list, "New session on", with every Vendor this build runs: the
Project's default Vendor first, marked `default`, then the others. A Vendor nobody is signed in to stays in the list,
inactive, and its tooltip gives the reason, `Sign in to Codex in Settings → Vendors`. A pick starts the Session on that
Vendor; Esc or a click outside closes the list. Each time the list opens, main checks the sign-in of every Vendor it has not
yet found signed in. A Linked machine on a build without the list starts the Session on its Project's default Vendor at
once. "New session" in the Command palette uses the default Vendor too. The default Vendor is "Default vendor" in
[Project settings](projects.md), and Claude Code while none is chosen. A Session that "Ship ticket" starts always runs on
Claude Code. One Project holds Sessions of both Vendors side by side.

**The Orchestrator and Autopilot on Codex.** The Project's Orchestrator runs on the default Vendor too, read at its next
start: "New conversation", or the next start of worfy. It keeps that Vendor while it runs, and so do the new Sessions
Autopilot starts for its Waves. A saved Session of the other Vendor is not resumed: a new one starts, and the old one stays
in the history ([Sessions, Orchestrator](sessions.md#behaviour)). Autopilot drives a Codex Orchestrator the way it drives a
Claude Code one, unattended, in the preset Full access. It weighs the budget by the Codex windows, waits for a used-up
Codex window to reset, and stops with `vendor-quota` when Codex refuses a turn while no window is used up. A run on Codex
is refused while the Harness's hooks are not approved in Codex's `/hooks`. The details are in
[Autopilot](autopilot.md#during-a-run).

**Signing in to a Vendor.** Settings → Vendors has one row per Vendor this build runs, Claude Code marked `required` and
Codex `optional`. A signed-in row shows `Signed in: <email> · <plan>`, as the first-run sign-in check does. A Vendor nobody
is signed in to has "Sign in to <Vendor>". For Codex, main starts the ChatGPT sign-in and opens its page in the browser;
the row says "Finish the sign-in in your browser…", offers "Cancel", and then shows the account the sign-in ended with. A
sign-in left open is cancelled after 10 minutes, and when worfy quits. For Claude Code the row names the command to run in
a Terminal Node, `claude`, and offers "Check again". A Vendor this build does not carry says `Codex is not part of this
build of worfy.` and offers nothing. A check or a sign-in that fails is a line in its row; nothing pops up. worfy keeps no
tokens: each Vendor keeps its sign-in in its own home folder.

**Vendor badge.** The Vendor shows as its name beside its logo, drawn in the text colour (Claude's starburst for Claude Code,
the OpenAI mark for Codex): on a live Session Node before its folder, short (`Claude`, `Codex`, the whole name in the
tooltip); in the Session view's header after the title; in the rail's first block, "Vendor"; in the Vendor list of "New
session". The Limits panel and the rows of "In transcripts" show the logo alone, with the name in the tooltip. The
Orchestrator has no badge. The agent's messages in the transcript are labelled with the Vendor's name, `claude` or `codex`;
the Orchestrator's stay `orch`.

**A Codex Session's chat.** It works as a Claude Code Session does ([Sessions](sessions.md)). A message sent during a turn
waits in the Session's queue and goes after the turn's result. Interrupt cancels the open approval requests and stops the
turn. Closing, a crash and Resume behave as for Claude Code; Resume continues the same Codex thread. Codex's
thinking shows as the summary Codex gives of it.

**Model, effort and permissions of a Codex Session.** The three pickers under the input field offer what Codex offers.

- Model: the models the running Codex lists, first "Default (<model>)", the model Codex marks as its default. A change holds
  from the next turn on.
- Effort: the levels the picked model lists, lowest first.
- Permissions: three presets in Codex's words, with the description as the tooltip of each row.

| Preset | Description |
| ------ | ----------- |
| Read only | Codex reads files and asks before it edits a file or runs a command. |
| Auto | Codex edits files and runs commands in the project folder; it asks before anything outside it. |
| Full access | Codex edits any file and runs any command, with network access, without asking. |

A new Codex Session takes the saved choice in Codex's terms: Bypass permissions, the default, is Full access; Accept edits is
Auto; Ask before tools and Plan only are Read only. Claude Code's `max` effort is the model's default. The choice is saved
per Node, as for Claude Code.

**Permission requests of a Codex Session.** Codex asks before a command or a file change, and the same card as for Claude
Code appears in the transcript, headed "Permission request". A command shows whole, with the folder it runs in, `in
<folder>`; a file change shows its files, one per line. The answers are Codex's, in its order:

- Accept: this one request.
- Accept for this Session: this request and the same command or files again, until the Session ends.
- Decline: refuses this request, and the turn goes on.
- Decline and stop the turn: refuses it and stops the turn.

A request whose command or files worfy cannot name offers no "Accept for this Session". Interrupt, closing the Session and a
crash cancel an open request.

**Slash menu of a Codex Session.** "/" opens the same menu as for Claude Code. It lists two commands the app server of Codex
runs, `/compact` and `/review`, then the Codex skills that are enabled, each with its description. `/review` reviews the
uncommitted changes, or follows the instructions typed after it. `/compact` and `/review` run only between turns: sent
during one, they come back as a notice to send again once the turn ends. A message that starts with a skill's name calls
that skill. The last line of the menu, "Not every command is listed", is inactive; its tooltip says that the other Codex
commands work only in its own terminal.

**Subagents of a Codex Session.** Codex keeps each Subagent as a thread of its own, and worfy builds the Session's tree of
Subagents from those threads. They show on the Canvas and in the rail as Claude Code's do ([Sessions,
Subagent](sessions.md#subagent)), with the name and type the model gave them, the model, the first line of the thread's
preview and a status:

| Status | When |
| ------ | ---- |
| `running` | Codex reports the agent started, busy or still starting |
| `done` | Codex reports it completed or shut down |
| `interrupted` | Codex reports it interrupted, or it was still running when the Session's last turn was interrupted |
| `error` | Codex reports it errored or not found, its spawn failed, or its thread ended in a system error |

The children Codex starts by itself (a review, a compaction, the memory consolidation, the guardian) are not shown, and
neither is anything under them. A Codex Subagent has no transcript worfy reads, so its Node opens none. While one of
them runs, the window asks for the tree again every 5 seconds, and each ask starts a short-lived Codex process.

**Binding of a Codex Session.** A Codex Session binds to a Ticket by the same rules as a Claude Code Session
([Workflow, Binding](workflow.md#binding)). Its signals come from the commands of its Codex thread: the last
`ticket claim`, the folder of the last command (else the thread's own folder), and the branch checked out in that folder
now. An edit of a Ticket's file binds nothing, as for Claude Code. Skills and Subagents of a Codex Session give no
signal. The "ticket done" rule of the automatic Archive reaches a Codex Session the same way.

**The Harness in Codex.** The one installer of the Harness, the toolbar's and First run's, also installs it into Codex
as a Codex plugin, and writes its three agents `worfy-implementer`, `worfy-reviewer` and `worfy-scout` into Codex's agents
folder. Codex keeps the hooks of a new or updated plugin off until the user approves them in `/hooks`, and the toolbar
shows how. The install, the approval and how each guarantee of the workflow holds on Codex are on
[Harness](harness.md#in-codex).

**What a Codex Session does not have.** worfy emulates nothing a Vendor lacks. The capability `hooks` is off for Codex,
with the reason "worfy does not run hooks in Codex yet."; the Harness's hooks are run by Codex itself, once approved.
One-off requests, the Project profile draft and [Terminal AI](terminal.md) run on Claude Code only.

**Limits per Vendor.** The Limits panel of the toolbar has a section per Vendor: Claude Code's 5-hour and 7-day windows, and
while the user is signed in to Codex, the windows its plan reports, labelled by their length (`5h`, `weekly`). The details
are in [Limits](transcripts-and-usage.md#limits).

**Codex Sessions on the Canvas.** The Codex threads of the Project, started in worfy or in a terminal, are in the Session
history as `worfy · Codex` or `terminal · Codex`. A thread started outside worfy that changed in the last 10 minutes gets a
read-only Node by itself, with its transcript read from Codex, and Resume continues it on a live Node. The details are in
[Sessions](sessions.md).

**worfy's tools in Codex.** A Codex Session in a Project gets the same MCP servers as a Claude Code Session, `worfy-canvas`
(Canvas, and Cards with `worfy.ask`) and `worfy-browser`, over HTTP on `127.0.0.1` with a token of its own process. The
details are in [Cards](cards.md) and [Browser](browser.md).

**Search.** "In transcripts" in the Command palette searches the Project's Codex threads together with Claude Code's
transcripts ([App shell](app-shell.md)).

**Getting started.** While Codex is in this build, the Getting started panel has the optional link "Use Codex too", which
opens Settings → Vendors ([Onboarding](onboarding.md)).

### How it works

- **One neutral model.** The rest of worfy speaks only worfy's types: the events of a Session (`AgentEvent`), the entries of
  a transcript, the Limits windows (`LimitWindow`) and the capabilities. Each Vendor's driver translates its agent into them.
  Why: a third Vendor is a new driver, not a change across the app ([ADR-0094](../adr/0094-vendor-seam.md)).
- **Capabilities, not names.** The interface never checks which Vendor a Session runs on. It reads the capabilities of the
  Session's Vendor: yes-or-no flags (Subagents, hooks, MCP in the app's process, the canvas tools, steer, resume, a list of
  past Sessions, a stable model change, a one-off request without tools, a complete slash menu, the Harness), where Limits
  come from, the permission presets and the effort levels. Every missing flag carries the reason a tooltip shows. A Session
  whose capabilities main cannot give is taken for a Claude Code Session, as a Node saved without a Vendor is.
- **A driver in parts.** Each Vendor's driver has the same parts, and `harnessHooks` is optional:

  | Part | What it gives | Claude Code | Codex |
  | ---- | ------------- | ----------- | ----- |
  | capabilities | Flags and lists | Static, with the models of a live Session | Static, with the models of a live Session |
  | session | Start and resume a Session | Agent SDK `query()` | `thread/start`, `thread/resume`, `turn/start` |
  | account | Who is signed in; the sign-in | `accountInfo()` | `account/read`, `account/login/start` |
  | limits | Limits windows | `rate_limit_event`, the status line, the usage request | `account/rateLimits/read`, `account/rateLimits/updated` |
  | history | Past Sessions and their transcripts | JSONL files in `~/.claude/projects` | `thread/list`, `thread/read` |
  | commands | The slash menu | `supportedCommands()` | `skills/list` and two built-in commands |
  | mcp | worfy's MCP servers | In the app's process | HTTP on `127.0.0.1` |
  | oneShot | A one-off request | `query()` | Refused |
  | harnessHooks | Whether the Vendor runs the Harness's hooks now | None: Claude Code runs a plugin's hooks without an approval | `hooks/list` |

- **Only the Claude Code driver imports the Agent SDK.** Nothing else in worfy imports it, so the SDK's messages never reach
  the Session layer or the renderer.
- **Codex runs as `codex app-server`.** worfy talks to it in JSON-RPC over stdin and stdout. Each Session has its own
  process. Every check of the account, poll of the Limits and read of the history starts a short-lived process of its own
  and closes it after the answer; these run in worfy's own empty folder, not in a Project. The handshake names the client
  `worfy` and asks for no experimental API, so worfy cannot lean on experimental methods: the server refuses them. Each
  incoming message is checked against the JSON Schema of the pinned Codex; one that fails becomes an `unknown` event and a
  line in the log, not a crash.
- **Codex's items become worfy's events.** Streamed text gives `delta`, a finished agent message `text`, a reasoning summary
  `thinking`. Commands, file changes and MCP tool calls give `tool_use` and `tool_result`. The end of a turn gives `result`,
  token use gives `context`, and an approval request gives `permission_request` with Codex's four answers. The events of
  other threads of the process, a Subagent's, are not shown in the Session's transcript: the tree of Subagents is read from
  the threads (`thread/list`, `thread/read`) in a short-lived process of its own. In a thread read back from the history,
  Codex's items about Subagents become `subagent` events, so the Session's history shows a row per Subagent.
- **The queue is worfy's.** A Codex Session queues messages in main as a Claude Code Session does. Codex's own queue is an
  experimental method. The driver can steer a running turn (`turn/steer`), but the Session hands it a message only between
  turns.
- **A pinned Codex.** worfy runs the Codex version it ships, never one the user installed: `@openai/codex` 0.166.0, an exact
  version in `package.json`. The protocol types and JSON Schema in the repository are generated by that version, and lint
  checks that they match it. Codex is Apache-2.0: its LICENSE and NOTICE go into the build's resources, in a folder `codex`.
- **Codex's home is the user's.** Codex keeps its sign-in and threads in `CODEX_HOME`, else `.codex` in the home folder.
  worfy only looks whether that folder exists: without it Codex counts as not signed in, and no Codex process starts for the
  account, the Limits or the history.

#### Windows

The binary is `codex.exe` from the package of the platform, x64 or arm64. The process starts without a shell. A thread's folder is compared with the Project root with either separator and in any case.

### Implementation

| What | Where |
| ---- | ----- |
| Vendor ids, labels, logos, the sign-in hint | `src/shared/vendors/vendor.ts` |
| Capabilities and Claude Code's | `src/shared/vendors/capabilities.ts` |
| The driver interface and its parts | `src/main/vendors/driver.ts`, `src/main/vendors/session.ts`, `src/main/vendors/account.ts`, `src/main/vendors/limits.ts`, `src/main/vendors/history.ts`, `src/main/vendors/commands.ts`, `src/main/vendors/mcp.ts`, `src/main/vendors/one-shot.ts`, `src/main/vendors/harness-hooks.ts` |
| The driver of a Vendor | `src/main/vendors/registry.ts` |
| The Claude Code driver | `src/main/vendors/claude/`; the translation of SDK messages `src/shared/vendors/claude/events.ts` |
| The Codex driver | `src/main/vendors/codex/index.ts`, one file per part: `capabilities.ts`, `session.ts`, `account.ts`, `limits.ts`, `history.ts`, `commands.ts`, `mcp.ts`, `one-shot.ts`, `harness-hooks.ts` |
| Codex process, JSON-RPC client, schema check | `src/main/vendors/codex/launch.ts`, `src/main/vendors/codex/app-server.ts`, `src/main/vendors/codex/rpc.ts`, `src/main/vendors/codex/schema.ts` |
| Codex items to events, approvals | `src/main/vendors/codex/items.ts`, `src/main/vendors/codex/approvals.ts` |
| The pinned binary | `src/main/vendors/codex/binary.ts`, `electron-builder.yml`, `build/codex/` |
| Generated protocol types and schema | `src/main/vendors/codex/protocol/`, `scripts/codex-protocol.mjs` |
| The Vendor of a Session and "New session" | `src/main/agent/node-sessions.ts`, `src/main/agent/app-registry.ts` |
| Vendor picker and badge | `src/renderer/session/NewSessionVendor.tsx`, `src/renderer/session/VendorBadge.tsx`, `src/renderer/session/rail/VendorRail.tsx` |
| Settings → Vendors | `src/renderer/settings/VendorsSection.tsx`, `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts` |
| Pickers, permission card and slash menu by capabilities | `src/renderer/session/useCapabilities.ts`, `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/SlashMenu.tsx` |
| Codex Sessions of the Project | `src/main/vendors/codex/sessions-on-canvas.ts` |
| Subagents of a Codex Session | `src/main/vendors/codex/subagents.ts`, `src/main/ipc/claude-home.ts`, `src/renderer/claude-home/subagents.ts` |
| Binding signals of a Codex Session | `src/main/vendors/codex/binding.ts`, `src/main/ipc/bindings.ts`, `src/main/layout/archive.ts` |
| The Vendor of the Orchestrator, the refusal of a Codex run | `src/main/agent/app-orchestrators.ts`, `src/main/agent/orchestrator.ts`, `src/shared/ipc/orchestrator.ts` |
| The Harness in Codex | `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts`, `src/renderer/harness/CodexHooksStep.tsx` |

**Data flow.** "New session" with a Vendor goes to main, which checks the sign-in through the Vendor's account part and
starts the Session on its driver. The Session takes `AgentEvent`s from the driver's SessionHandle, whatever the Vendor, and
sends them to every window. The renderer asks `agent.capabilities` for the Session's capabilities and draws the pickers, the
permission card and the slash menu from them.

**The fake Codex.** Tests never start the real Codex, never sign in and never read the developer's `~/.codex`. Under
`WORFY_CODEX=fake` the driver starts `test/fixtures/codex-app-server/fake-app-server.mjs` under worfy's own executable
instead of the binary. The fake plays a script of `test/fixtures/codex-scripts/` step by step: `WORFY_CODEX_SCRIPT` names
it (`turn` by default), `WORFY_CODEX_LOG` is the file where the fake writes worfy's requests, and `WORFY_CODEX_HOME` keeps
its threads. The fake also runs the hooks of a plugin installed in its `CODEX_HOME` by the rules of the pinned Codex
(`test/fixtures/codex-app-server/hook-runner.mjs`): a hook runs only once it is approved with the right hashes,
`PreToolUse` can deny a tool, `Stop` and `SubagentStop` can hold a turn, and `SessionEnd` gets 3 s at most. It answers
`hooks/list` from that plugin. It keeps a thread's sandbox: `read-only` refuses a file change and a command that writes,
and no sandbox lets a file change reach outside the thread's folder. `WORFY_CODEX=absent` stands for a build without Codex. Under vitest the real binary refuses to start even
without `WORFY_CODEX`. `test/setup-contract.ts` and `test/e2e/launch-env.ts` set `WORFY_CODEX=fake` and a `CODEX_HOME` in a
temporary folder for every run.

**The compatibility suite.** `test/contract/codex-compat.test.ts` ties the tests to the pinned Codex. The recordings of the
live app-server in `test/fixtures/codex-messages/` must be of the pinned version, every recorded message must pass its JSON
Schema, and every step of the fake's scripts must have a kind, key paths and types the recordings have, or an exception that
names why. The owner takes the recordings with `scripts/codex-capture.mjs --use-my-login`, which runs the pinned Codex with
a `CODEX_HOME` in a temporary folder; it refuses without that flag and under CI.

**Main tests.**

- The seam: `test/contract/vendor-sdk-imports.test.ts` (only the Claude Code driver imports the SDK),
  `test/contract/vendor-imports.test.ts`, `test/unit/vendor-driver-types.test.ts`, `test/contract/session-vendor-parts.test.ts`.
- The Codex driver: `test/unit/codex-capabilities.test.ts`, `test/unit/codex-items.test.ts`, `test/unit/codex-rpc.test.ts`,
  `test/unit/codex-binary.test.ts`, `test/unit/codex-in-build.test.ts`, `test/unit/codex-protocol.test.ts`,
  `test/unit/codex-limits.test.ts`, `test/unit/codex-history.test.ts`, `test/contract/codex-app-server.test.ts`,
  `test/contract/codex-session.test.ts`, `test/contract/codex-account.test.ts`, `test/contract/codex-history.test.ts`,
  `test/contract/codex-session-limits.test.ts`, `test/contract/codex-session-mcp.test.ts`, `test/contract/codex-fake.test.ts`,
  `test/contract/codex-fake-hooks.test.ts` (the fake's hooks and sandbox).
- Subagents and Binding: `test/contract/codex-subagents.test.ts`, `test/unit/subagent-trees.test.tsx`,
  `test/e2e/codex-subagents.spec.ts`, `test/contract/codex-binding.test.ts`.
- The Orchestrator and the Harness on Codex: `test/contract/codex-orchestrator.test.ts`,
  `test/contract/app-orchestrators.test.ts`, `test/contract/codex-harness-hooks.test.ts`,
  `test/contract/harness-codex-install.test.ts`, `test/contract/codex-parity.test.ts`, `test/e2e/codex-hooks-step.spec.ts`.
- The interface: `test/contract/sessions-vendor.test.ts`, `test/contract/vendors-ipc.test.ts`,
  `test/unit/settings-vendors.test.tsx`, `test/unit/vendor-badge.test.tsx`, `test/unit/permission-card.test.tsx`,
  `test/e2e/vendor-picker.spec.ts`, `test/e2e/codex-session.spec.ts` (presets, the slash menu and an approval on the fake),
  `test/e2e/onboarding-codex.spec.ts`, `test/e2e/limits-vendors.spec.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts`,
  `test/e2e/codex-transcript-search.spec.ts`.
