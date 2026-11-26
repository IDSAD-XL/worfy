---
name: orchestrator-rules
description: The orchestrator rules a main session needs at one moment, not every turn — Quota (before a phase, and at the fifth file it edits itself), Long output (before a test suite, build, linter or `land` run, and before reading agent output), Ticket status (before `claim`, `block` or `done`), State file (at a phase boundary and at session end) and State file vs ADR. Use when the orchestrator rules name one of these sections.
---

# Orchestrator rules for their moment

The orchestrator rules that reach every main session keep what governs every turn. Each section
below is named there by one line that says when to read it; the rule here is as binding as the
lines there.

## Quota

Every line of the closed list is true item by item and false in aggregate: twenty "single-file
edits with a known path" in a row is a phase that ate the context. Two counters, both checkable:

- **Before a phase**, name its slices and who runs each. A slice that is not on the closed list
  gets an agent assigned right there, not "later if it grows".
- **Inside a phase**, count the files you edited yourself. At the fifth, stop and re-slice what is
  left: keep the coupled chain, hand out the rest.

Hitting a counter and staying solo is a decision you say out loud, with the reason, in the same
turn.

## Long output: filter first, delegate second

Test suites, builds, linters: pipe through `tail`/`grep` and keep what lands in context under
~15 lines. If a filter does the job, a subagent is a needless round trip. Delegate the run only
when it needs interpretation — a large failure set to triage, a bisect, a flake to chase.

Read `land` and agent output as a summary: one line per PR and the verdict. The log stays in its
file, opened by path, never whole into context.

## Ticket status

**Ticket status moves through `${CLAUDE_PLUGIN_ROOT}/bin/ticket`** when the project keeps tickets
(`tickets.path`) — `claim` when picking one up, `block <reason>` when it stalls (with
`--waits <owner|team|agent|machine>` when it waits for someone), `done <epic> <NN>` once the work is
finished the way `workflow.finish` says, with `--pr <N>` when it ends in a green PR. It writes the
header one fact per line (`Status: <word> <time>`, `Blocked reason:`, `Waits:`, `PR:` —
`bin/TICKETS.md`); a ticket with the old header is moved once with `ticket migrate`.
No tickets in the profile — no ticket CLI; say where the status was recorded instead.

## State file

**A task is not finished until the project's state file is updated.** The profile's
`docs.handoff` names it (`path`), its form (`kind`) and a `check` to run after editing — typically
`HANDOFF.md` at the root: a snapshot of what is in progress, what waits for the owner, the risks
that affect the next steps, the next step, and where the rest lives. Update it at phase
boundaries and at session end, never per message: it is committed with the work, and per-turn
churn is noise in the history. A documents PR rewrites only the lines of
its own epic and appends no block per wave; details go into the tickets' result sections (rules —
skill `worfy:ship-ticket`, step 11).

Never invent a second state file. If the profile or the repo has one, use it; if neither does, ask
before creating one. Two files describing where we are means one of them is lying.

The decision log of a wave that runs without a human (`decisions.tsv`, skill `worfy:epic-wave`) is
not a state file. The state file says where the work stands; the log says why one run decided what
it did. The log is not committed and is not read when work resumes.

## State file vs ADR

**State files and ADRs are different documents — never merge them.** ADRs live where the
profile's `docs.adr_dir` says, if the project keeps them. An ADR is immutable and dated: it records
why a decision was made with what was known then. A state file is rewritten every session; its
worth lies in being current. They connect by links only —
the state file says what is done and points at the ADR that says why.
