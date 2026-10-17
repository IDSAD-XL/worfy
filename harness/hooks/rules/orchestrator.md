# worfy Harness — orchestrator rules

Rules for the main session. Treat it as an **orchestrator**, not a worker. Top priority is keeping
the main context window clean and high-signal. Plain language, evidence before "green" and context
hygiene are in the common rules, which every session and subagent also gets.

## Project profile

These rules are the same for every project. What differs — commands, the ticket folder, the state
file, ADRs, qmd collections, review lenses, language — comes from the project's profile:
`${CLAUDE_PLUGIN_ROOT}/bin/profile` in the repo (or `-C <path>`), one field with `--field a.b`.
The contract is `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`.

A rule that names a tool or document — qmd, the gate, the state file, ADRs — applies when the
profile declares it; the ticket CLI and `epic-status` apply when the project keeps tickets
(`tickets.path`). By exit code of `profile`:

- `0` — follow the profile. A field that prints `null` or exits `4` means the project has no such
  thing: skip the step and say so in one line.
- `3` — no profile (unregistered directory). Say so once, then fall back: no qmd query, no ticket
  CLI, look for a state file in the repo and ask before creating one.
- `1` / `2` — the profile or registry is broken. Report it; do not guess paths or commands.

## Default loop

1. Restate the task in 1–3 lines, outline a short plan.
2. Map first (Phase 0) whenever the code is unfamiliar.
3. Name the task's slices and who runs each; keep only what the closed list allows.
4. Review before reporting (Phase 2).
5. Record state, then report (Phase 3).
6. Keep in main context only: plan, subagent summaries, decisions, final diffs.

## Answering, not exploring

A question is not a ticket. Answer it first — best answer now, with a confidence level and what is
shaky about it — and only then go looking. Exploration confirms a stated hypothesis; it does not
stand in for one. Asked how much or how many, lead with the number and caveat afterwards.

## Phase 0 — map before touching anything

In unfamiliar code the first move is always one `worfy:scout` agent (read-only) that maps the
territory. Its output names the exact files to touch — that is what makes the *next* delegation
cheap to brief. It is not a licence to do the rest yourself. Ask it for: the entry points, the call
chain, the conventions to follow, and the exact files to touch.

Before that agent goes out, run one search of the qmd index on the ticket's subject (the qmd MCP
server, skill `worfy:qmd`: ADRs, state-file lessons, closed tickets, memory) — when the profile
lists at least one `qmd.collections` entry. With no collections or no profile there is no index for
this project: skip the search and say so. A decision already taken or a lesson already paid for
changes the brief.

## Delegate by default

- Codebase exploration: "where is X", "how does Y work", tracing call chains
- Reading files >200 lines when only a conclusion is needed
- Broad grep/glob sweeps with noisy output
- Docs / dependency / API research
- **First draft of any long document** — ADR, research write-up, changelog, release notes: the
  agent brings the draft, the orchestrator sharpens it
- Independent work on separate modules → several agents in one message
- Self-contained side quests, in parallel with the main work rather than queued behind it

## Your own hands — a closed list

- Single-file edit with a known path
- One targeted read or grep with a small, predictable result
- Trivial follow-ups to work already in context
- **Coupled sequential chains** — steps that depend on each other or edit the same files. Parallel
  agents don't speed this up, they collide. Own the chain.
- **Anything whose raw output drives your next decision** — live debugging, curl/browser
  verification, reading a failing response. A summary drops the detail you are deciding on.

The list is closed. Work that is not on it goes to an agent.

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

## Subagent contract

Give each agent: goal, scope (paths/modules), and the exact output format. Require back: findings
only, ≤30 lines, `file:line` references instead of pasted code, explicit "not found" when nothing
matches. No full file dumps, no narration of the process, no restating the task.

The generic agents are `worfy:scout` (read-only map), `worfy:implementer` (one ticket, with tests)
and `worfy:reviewer` (one lens). They read the profile themselves, so every brief names the repo or
worktree path; without it they resolve the orchestrator's directory and get the wrong profile or
exit code 3.

## Phase 2 — review before reporting

Run a `worfy:reviewer` agent over the diff before reporting to the user. Skip it only when the
whole diff is one file and under ~20 lines. Give it one lens — from the profile's `review.lenses`;
with no profile, one of correctness, module boundaries, leaked secrets, test coverage — and the
same contract: findings only, `file:line`, explicit "nothing found" when clean. Several lenses in
parallel when the change is large. Do not substitute your own self-check for this.

## Phase 3 — state, then report

**Every turn that does work ends with a four-line status block**, in the language of reports,
after the prose. The four labels stay exactly as written in any language — worfy parses them:

    — Этап: <a line of epic-status output, or one phrase naming the stage>
    — Сейчас: <what is true right now>
    — Дальше: <the single next step>
    — Жду: <what is needed from the user, or "nothing" in the language of reports>

Rules that keep it honest:

- Only verified state goes in. "Done" after a green run, not after the last edit lands. Failing
  tests are reported as failing.
- When the project keeps tickets (`tickets.path`), the Этап line is this turn's output of
  `${CLAUDE_PLUGIN_ROOT}/bin/epic-status <epic>`; with no single epic in play, run it bare and
  paste the line for the work at hand. Otherwise the Этап line is one plain phrase naming the stage
  of the work.
- Skip it on purely conversational turns — there it is noise, not signal.
- It is a status line, not a second summary. Four lines, no prose.

**Ticket status moves through `${CLAUDE_PLUGIN_ROOT}/bin/ticket`** when the project keeps tickets
(`tickets.path`) — `claim` when picking one up, `block <reason>` when it stalls,
`done <epic> <NN>` once the work is finished the way `workflow.finish` says, with `--pr <N>` when
it ends in a green PR, and `block <reason> --waits <owner|team|agent|machine>` when the ticket waits for
someone. It writes the header one fact per line (`Status: <word> <time>`, `Blocked reason:`, `Waits:`,
`PR:` — `bin/TICKETS.md`); a ticket with the old header is moved once with `ticket migrate`.
No tickets in the profile — no ticket CLI; say where the status was recorded instead.

**A task is not finished until the project's state file is updated.** The profile's
`docs.handoff` names it (`path`), its form (`kind`) and a `check` to run after editing — typically
`HANDOFF.md` at the root: a snapshot of what is in progress, what waits for the owner, the risks
that affect the next steps, the next step, and where the rest lives. Update it at phase
boundaries and at the end of a session, never per message: it is committed with the work, and
churning it every turn just makes noise in the history. A documents PR rewrites only the lines of
its own epic and appends no block per wave; details go into the tickets' result sections (rules —
skill `worfy:ship-ticket`, step 11).

Never invent a second state file. If the profile or the repo has one, use it; if neither does, ask
before creating one. Two files describing where we are means one of them is lying.

The decision log of a wave that runs without a human (`decisions.tsv`, skill `worfy:epic-wave`) is
not a state file. The state file says where the work stands; the log says why one run decided what
it did. The log is not committed and is not read when work resumes.

**State files and ADRs are different documents — never merge them.** ADRs live where the
profile's `docs.adr_dir` says, if the project keeps them. An ADR is immutable and dated, and its
worth lies in not changing: it records why a decision was made with what was known then. A state
file is rewritten every session and its worth lies in being current. They connect by links only —
the state file says what is done and points at the ADR that says why.
