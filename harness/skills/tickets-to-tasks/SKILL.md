---
name: tickets-to-tasks
description: Import the markdown tickets produced by /to-tickets or /wayfinder into native Claude Code Tasks, preserving their blocking edges so the task list enforces ordering. Use after /to-tickets has published tickets, or when the user says "залей тикеты в таски", "import tickets", or asks why the task list is empty for an epic.
---

# Tickets -> native Tasks

`/to-tickets` writes markdown files. Native Tasks enforce ordering: a task with
unresolved `blockedBy` cannot be claimed. This skill moves the first into the
second so nobody has to police the sequence by hand.

## Before you start

Tasks are session-scoped unless a task list ID is set. For an epic spanning
several sessions, every session must start with the same ID:

```
CLAUDE_CODE_TASK_LIST_ID=atakama-<slug> claude
```

If the current session was not started that way, say so before importing —
otherwise the tasks vanish with the session. Check `~/.claude/tasks/` for a
directory named after the slug to confirm which list is live.

## Procedure

### 1. Scan

```
node ~/.claude/atakama/bin/tickets.mjs scan
```

Optionally pass a repo path or an `issues` directory; with no argument it picks
the most recently modified `.scratch/<slug>/issues/` across the three repos.

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

```
node ~/.claude/atakama/bin/tickets.mjs link <slug> 01=<id> 02=<id> …
```

This writes `~/.claude/atakama/epics/<slug>/task-map.json`, outside the repo, so
a later session can tell which tickets are already imported.

Then record the epic as active:

```
echo <slug> > ~/.claude/atakama/state/active-epic
```

`SessionStart` reads that file and loads the epic map into every new session.

### 6. Report the frontier

Call `TaskList` and tell the user which tasks are claimable right now — pending,
unowned, empty `blockedBy`. That is where work starts. If nothing is claimable
the edges are wrong: a cycle, or every ticket blocked by something outside the
set. Say so instead of picking one arbitrarily.

## Rules

- **Never edit the ticket files.** `/to-tickets` owns them; this skill is a
  one-way import. Corrections belong in the tickets, then re-run the scan.
- **Never write into the team repositories.** The map lives under
  `~/.claude/atakama/`. `.scratch/` is excluded per-clone via
  `.git/info/exclude`, not via `.gitignore`.
- **Do not start implementing during the import.** Finish the import, report the
  frontier, and let the user decide what gets picked up.
