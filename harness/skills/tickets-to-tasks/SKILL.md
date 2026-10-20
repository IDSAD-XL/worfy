---
name: tickets-to-tasks
description: Import the markdown tickets produced by /mattpocock-skills:to-tickets or /mattpocock-skills:wayfinder into native Claude Code Tasks, preserving their blocking edges so the task list enforces ordering. Use after /mattpocock-skills:to-tickets has published tickets, or when the user says "залей тикеты в таски", "import tickets", or asks why the task list is empty for an epic.
---

# Tickets -> native Tasks

`/mattpocock-skills:to-tickets` writes markdown files. Native Tasks enforce ordering: a task with
unresolved `blockedBy` cannot be claimed. This skill moves the first into the
second so nobody has to police the sequence by hand.

## Before you start

The tool, the task-list ID and where tickets are looked for are project facts.
They come from the project profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`, contract in
`~/.claude/profiles/README.md`), field `tasks`. Run from the repo or workspace
the tickets belong to — pass it with `-C` if the session sits elsewhere:

```bash
T="$("${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field tasks.tool)"; echo "EXIT=$?"
case "$T" in "~/.claude/bin/"*) T="${CLAUDE_PLUGIN_ROOT}/bin/${T#\~/.claude/bin/}" ;; esac # schema 1 value: plugin bin
T="${T/#\~/$HOME}"; echo "tool: $T"
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field tasks.list_id
```

- Exit `3`: the directory is not a registered project (or has no profile).
  Exit `4`: the project does not import tickets into native Tasks.
  Either way, stop and tell the user — do not guess a tool.
- `$T` below is that tool; `tasks.list_id` is the list-ID template, e.g.
  `acme-<slug>`.
- A `tasks.tool` value that starts with `~/.claude/bin/` (schema 1) is read as `${CLAUDE_PLUGIN_ROOT}/bin/` plus the rest;
  the `case` line of the block does that, then `~` is expanded to `$HOME`.

Tasks are session-scoped unless a task list ID is set. For an epic spanning
several sessions, every session must start with the same ID — the template with
`<slug>` filled in:

```
CLAUDE_CODE_TASK_LIST_ID=<tasks.list_id with the slug> claude
```

If the current session was not started that way, say so before importing —
otherwise the tasks vanish with the session. Check `~/.claude/tasks/` for a
directory named after the slug to confirm which list is live.

## Procedure

### 1. Scan

```bash
node "$T" scan
```

Optionally pass a repo path or an `issues` directory; with no argument it picks
the most recently modified `.scratch/<slug>/issues/` under the profile's
`tasks.scan_root` (for a multi-repo project, its `.scratch` or the repos below it).

The JSON gives you `slug`, one entry per ticket (`number`, `title`,
`whatToBuild`, `blockedBy`, `acceptance`, `taskId`), and `warnings`.

**Stop and resolve warnings before creating anything.** A `blockedByUnresolved`
warning means the ticket names its blockers by title instead of number — read
that ticket and map the titles to numbers yourself. An unknown-blocker warning
means the ticket set is inconsistent; tell the user rather than guessing.

### 2. Skip what already exists

Any ticket with a non-null `taskId` was imported before. Call `TaskList` and
confirm it is still there. Re-importing produces duplicates that the ordering
logic cannot tell apart — never create a second task for the same ticket.

`scan` nulls every `taskId` and emits a stale-map warning when the stored IDs
belong to a different task list than the current session — the normal case when
the epic was imported under `CLAUDE_CODE_TASK_LIST_ID` and this session was
started without it. Stale IDs mean re-create and re-link, not skip.

### 3. Create tasks in number order

For each ticket, lowest number first, call `TaskCreate`:

- **subject** — `<NN> — <title>`, verbatim from the ticket. The number keeps the
  task list readable in the same order as the ticket files.
- **description** — the ticket's `whatToBuild`, then the acceptance criteria as
  a checklist, then the line `Ticket file: <file>`. A teammate that claims this
  task gets no conversation history, so the description must stand alone.
- **activeForm** — present continuous, e.g. `Building the policy import path`.

Record each returned task ID against its ticket number as you go.

### 4. Wire the blocking edges

Only after every task exists, for each ticket with a non-empty `blockedBy`:

```
TaskUpdate(taskId: <this ticket's id>, addBlockedBy: [<ids of its blockers>])
```

Use `addBlockedBy` on the blocked task rather than `addBlocks` on the blocker —
one call per ticket, and it reads the same direction as the ticket file.

### 5. Persist the mapping

```bash
node "$T" link <slug> 01=<id> 02=<id> …
```

This writes `<profile dir>/epics/<slug>/task-map.json` (`profile --dir`),
outside the repo, so a later session can tell which tickets are already imported.

Then record the epic as active:

```bash
D="$("${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --dir)" && mkdir -p "$D/state" && echo <slug> > "$D/state/active-epic"
```

`hooks/session-start.mjs` reads that file and, for a profile with
`session.inject_rules: true`, loads `<profile dir>/epics/<slug>/map.md` into every
new session.

### 6. Report the frontier

Call `TaskList` and tell the user which tasks are claimable right now — pending,
unowned, empty `blockedBy`. That is where work starts. If nothing is claimable
the edges are wrong: a cycle, or every ticket blocked by something outside the
set. Say so instead of picking one arbitrarily.

## Rules

- **Never edit the ticket files.** `/mattpocock-skills:to-tickets` owns them; this skill is a
  one-way import. Corrections belong in the tickets, then re-run the scan.
- **Never write into the team repositories.** The map lives in the profile
  folder (`~/.claude/profiles/<name>/`). If `.scratch/` sits inside a clone, it
  is excluded per-clone via `.git/info/exclude`, not via `.gitignore`.
- **Do not start implementing during the import.** Finish the import, report the
  frontier, and let the user decide what gets picked up.
