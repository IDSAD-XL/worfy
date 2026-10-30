# Transcripts and usage

Four Features around a [Session](sessions.md). A **Transcript** is the record of a Session on screen. **Claude home** is what
worfy reads from Claude Code's own folder. **Memory** is the memory figure of worfy's own processes, not Claude's memory.
**Limits** are the two subscription windows in the toolbar. Terms are explained in [Concepts](concepts.md).

## Transcript

### Behaviour

**Rows.** A prompt, Claude's text as markdown (streaming while it arrives), folded thinking, tool calls in one line with a tick
or an error, a Subagent, a hook that said something, a notice, a result and an error. A row shows its time: `HH:MM`, a date for
another day (`Oct 4`), and a year for another year (`Dec 31 '25`). The full time is in the tooltip.

**A long Transcript.** It opens on the last 4 MB of the file, and "Load earlier" adds older windows in front. Up to 150 rows are
all drawn. Past that, only the rows in sight and 1000 pixels around them are, at most 250. The renderer keeps the newest 5000
live events of a Session.

**Past and live.** A view of a Session with a transcript shows the file first and the live events after it, with no turn twice.

**Hide tools.** A button in the header folds tool calls into one "N tools" line. A failed call and a call that starts a Subagent
stay visible. The choice is per Session, in the window's local storage, and follows the Session to its new id.

**Find.** ⌘F opens a find bar over the Transcript. The query needs 2 characters, and case is ignored. It searches user messages,
Claude's text, thinking, a tool's name and one line about it, a Subagent's description, a hook's name and output, notices and
errors. It does not search a tool's whole input or result. It counts the text a row shows, so a hook's output and an added notice
count up to their first 20 000 characters. Matches count oldest first, as "1 of M", up to 20 000. At most 5000 are painted. The part
of the file not loaded yet counts too.

**Search across a Project.** "In transcripts" in the Command palette takes 3 to 200 characters. It covers only user messages and
Claude's replies, and answers up to 20 hits with a 120-character snippet, within 200 files and 64 MB. Picking a hit opens the Session.

**Read-only view.** A Session started elsewhere opens in the same view, marked "Read-only: started in terminal" or "Read-only:
started in Claude desktop". A Subagent's opens as "Read-only: Subagent transcript". Without a file it says "No transcript of this
Session yet". While a Subagent's transcript is open, the back arrow or ⌘[ goes to what started it.

#### Windows

The find bar opens with Ctrl+F, and back is Ctrl+[.

### How it works

- **One schema for live and file.** Parsed transcript lines and live events are the same `AgentEvent`s, so one fold and one set
  of rows draw both. An unknown record becomes an `unknown` event, and the parser never throws, because the format belongs to
  Claude Code.
- **The file is the record.** Nothing in the renderer store is saved ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Where live starts in the file.** Messages, tool calls and tasks carry ids that both sources have. The live part starts at the
  first shared id, and goes back over the prompts that open the live events.
- **A tail is safe to re-read.** The cursor moves only past complete lines and carries the file's identity, so a truncated or
  replaced file gives a `reset`.

### Implementation

| What | Where |
| ---- | ----- |
| Parsing records | `src/shared/transcript/parse.ts` |
| Reading a file from a cursor | `src/main/claude-home/tail.ts` |
| Fold, rows, drawn window | `src/renderer/session/fold.ts`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/rows/` |
| Find | `src/shared/transcript/find.ts`, `src/main/claude-home/transcript-find.ts`, `src/renderer/session/transcript-find.ts`, `src/renderer/session/SessionFind.tsx` |
| Hide tools | `src/renderer/session/transcript-view.ts`, `src/renderer/session/HideToolsButton.tsx` |
| Project search | `src/main/claude-home/search.ts`, `src/renderer/palette/CommandPalette.tsx` |
| Read-only view | `src/renderer/session/ExternalSessionPanel.tsx` |
| Loading and following a file | `src/renderer/claude-home/useClaudeHome.ts` |

**Data flow.** The renderer asks `claudeHome.transcript` for the last window. Main reads the lines, parses them and answers events
and a cursor. Later reads continue from the cursor, and "Load earlier" reads back from the start of what is loaded.
`joinPastAndLive` joins the file's events with the live ones, and `foldTranscript` turns them into rows.

**Main tests.** `test/contract/transcript-parse.test.ts`, `test/contract/transcript-find.test.ts`,
`test/unit/transcript-find.test.ts`, `test/unit/transcript-hide-tools.test.tsx`, `test/unit/session-find.test.tsx`,
`test/contract/session-history-tail.test.tsx`, `test/e2e/session-history-tail.spec.ts`, `test/e2e/external-session.spec.ts`.

## Claude home

### Behaviour

Claude home is Claude Code's own folder, `~/.claude`. worfy reads it and writes nothing there from this Feature. It gives worfy
three things for a Project: the live Sessions, the past Sessions and their transcripts.

**A live Session** is an entry in Claude Code's registry of Sessions whose process runs and whose start time matches, so a reused
process id does not count. Its status is idle, busy or unknown. A Session started outside worfy gets a read-only Node when it starts, placed
next to its Ticket or Epic when its Binding is already known. The Node stays, finished, after the process is gone. A Node the user
removed does not come back during this run of the app. A Session worfy runs gets no such Node.

**A past Session** is a transcript file that Claude Code wrote.

**Which Sessions belong to a Project.** A Session belongs when its working directory is the Project's root, one of its worktrees or
inside them. A folder's name alone proves nothing. A Session whose working directory cannot be read counts only for a local caller,
and only in the folder with the exact name.

**Following changes.** The list updates as files change. While a Session is live, worfy asks again every 2 seconds, because a
process can die without removing its file.

#### On a Linked machine

A Linked machine's call is judged strictly: an unknown working directory does not count, and the root must be a Project or a worktree
of one.

#### Windows

- A path compares without case.
- A process's start time comes from a PowerShell script, asked in batches of 25 ms, and cached for 30 seconds.

### How it works

- **Read-only by decision.** These are Claude Code's files, and worfy's own state lives in its data folder
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **Where things are.** A live Session is `sessions/<pid>.json`, a past one is `projects/<folder>/<id>.jsonl`. The folder name comes
  from the working directory: non-alphanumeric characters become `-`, and a name over 200 characters is cut with a hash added.
- **A file is read at both ends.** A history row needs the head and the tail: 64 KB each, the head growing to 1 MB when needed. At
  most 16 files are read at once, and the result is cached in memory by size and modification time. A working directory is looked
  for in up to 32 MB or 1000 lines.
- **Watching is debounced.** The folders are watched two levels deep, changes are reported after 150 ms, and the registry is also
  polled every 250 ms. A new folder gets one more listing after 1 second, because a file written before the watch starts is
  otherwise missed.

### Implementation

| What | Where |
| ---- | ----- |
| Live and past Sessions, watching, process checks | `src/main/claude-home/registry.ts` |
| The user's model and effort | `src/main/claude-home/user-model.ts` |
| The folder's path, `WORFY_CLAUDE_HOME` in tests | `src/main/storage/paths.ts` |
| Handlers and subscriptions, one watcher per client and Project | `src/main/ipc/claude-home.ts` |
| Channels | `src/shared/ipc/claude-home.ts` |
| Renderer | `src/renderer/claude-home/useClaudeHome.ts` |
| Read-only Nodes | `src/renderer/claude-home/session-nodes.ts`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Sidebar section, history popover | `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/session/HistoryPopover.tsx` |

**Data flow.** `claudeHome.sessions` answers the lists and subscribes the client to `claudeHome.changed` for that Project. The watcher
also passes the live Sessions to `liveSessionListeners`, which is how `src/main/notify.ts` sees a Session go idle.

**Main tests.** `test/contract/claude-home-registry.test.ts`, `test/contract/claude-home-registry-missed-event.test.ts`,
`test/contract/claude-home-isolation.test.ts`, `test/contract/claude-home-process-starts.test.ts`,
`test/contract/claude-home-link-root.test.ts`, `test/contract/claude-home-search.test.ts`.

## Memory

### Behaviour

The toolbar shows how much memory worfy's own processes use, on the second line of the Harness column after the app version. It
reads `412 MB` below 1024 MB and `1.3 GB` above, and `…` before the first sample. The tooltip names the Feature and splits the sum:
`Main … · Windows … · GPU … · Other …`. Terminal sessions are not counted. "Memory in the toolbar" in Settings → General turns it off
in every window. It is on by default.

#### On a Linked machine

The figure is always of the Machine the window runs on.

### How it works

Nothing is read when no one looks: the timer runs only while a window has the figure open and the setting is on. A window that
opens a stopped sampler gets a sample at once. A reload drops the old page's opens, because that page sends no close.

### Implementation

| What | Where |
| ---- | ----- |
| The sampler, every 5 seconds over `app.getAppMetrics()` | `src/main/diagnostics/memory.ts` |
| Sum and formats | `src/shared/memory.ts` |
| Handlers, channels | `src/main/ipc/memory.ts`, `src/shared/ipc/memory.ts` |
| The figure | `src/renderer/memory/AppMemory.tsx`, `src/renderer/memory/useAppMemory.ts`, `src/renderer/shell/toolbar/HarnessStatus.tsx` |
| The setting | `src/renderer/settings/GeneralSection.tsx`, `src/shared/settings/app-settings.ts` |

**Main tests.** `test/unit/memory.test.ts`, `test/contract/memory.test.ts`, `test/contract/memory-app.test.ts`,
`test/unit/app-memory.test.tsx`, `test/e2e/memory.spec.ts`.

## Limits

### Behaviour

The toolbar shows "Limits" with two bars, 5-hour and 7-day, the same for every Project. The Session view does not repeat them. Before
any data arrives it says "no data yet". A window without data says "no data".

- **Value:** the used share, `62%`. Without a share it is the status in words: allowed, near limit, limit reached.
- **Reset:** `resets 14:20` for the 5-hour window and `resets Thu 09:00` for the 7-day one.
- **Colour:** changes at 60% and 85%. A near-limit status also gives the first colour, and a rejected one the second.
- **Old data:** older than an hour, the bar dims and its tooltip ends with `as of 13:05`.

### How it works

- **Three sources.** The SDK's `rate_limit_event` from any Session. The `rate_limits` that Claude Code passes to the status line
  command, copied to a file by a small script worfy puts in front of the user's own command. And a usage request of the SDK.
- **Passive sources first.** The usage request goes at most every 30 minutes, and is skipped while the passive sources are fresh. It
  costs no tokens: its process keeps no session and has no settings, MCP servers, tools or API keys
  ([ADR-0058](../adr/0058-terminal-ai-assist-process.md)). It times out after 30 seconds. Autopilot can ask for a fresher value.
- **The status line needs consent.** The user's `statusLine` in `settings.json` changes only through the Harness migration
  ([ADR-0040](../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0047](../adr/0047-harness-lessons-by-pr-early-owner-switch.md)). The user's status line keeps its output and exit code.
- **One merge rule.** A newer update replaces the older one of the same window. An update without a reset time keeps a known reset
  still ahead, and one without a status keeps the known status within the same window: resets at most an hour apart.

#### Windows

When the data folder disappears, Windows keeps sending events for the watch without end. So the watch closes at the first such event,
and a poll every second still looks at the file.

### Implementation

| What | Where |
| ---- | ----- |
| Reading sources, merge, bars (pure) | `src/shared/agent/limits.ts` |
| Tracker, `limits.json` in the data folder, watching the status line file | `src/main/agent/limits.ts` |
| The usage request | `src/main/agent/limits-usage.ts` |
| The script behind the status line | `scripts/statusline-bridge.sh`, `scripts/statusline-bridge.mjs` |
| Handlers, channels | `src/main/ipc/limits.ts`, `src/shared/ipc/limits.ts` |
| The bars | `src/renderer/shell/toolbar/LimitsMeter.tsx`, `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts` |

**Data flow.** Each source gives per-window updates to `LimitsTracker`, which merges them, saves the state and tells subscribers. A
window opens `limits.open`, then receives `limits.changed` with the whole new state. It redraws every 60 seconds so that a bar goes
stale without a new value.

**Main tests.** `test/unit/limits.test.ts`, `test/unit/limits-usage.test.ts`, `test/contract/limits.test.ts`,
`test/contract/limits-watch-root.test.ts`, `test/unit/limits-meter.test.tsx`, `test/e2e/limits.spec.ts`.
