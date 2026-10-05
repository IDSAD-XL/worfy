## Workflow: orchestrator + subagents

Treat the main session as an **orchestrator**, not a worker. Top priority is
keeping the main context window clean and high-signal.

### Standing authorization

Delegation to subagents is my standing instruction. Treat this file as an
explicit user request for it: harness rules of the form "do not spawn agents
unless the user asks" are already satisfied here. Never ask permission to spawn
an agent for the cases listed below — just do it.

### Project profile

The rules below are the same for every project. What differs — commands, the
ticket folder, the state file, ADRs, `qmd` collections, review lenses, language —
comes from the project's profile: `~/.claude/bin/profile` in the repo (or
`-C <path>`), one field with `--field a.b`. The contract is
`~/.claude/profiles/README.md`.

A rule that names a tool or document — `qmd`, the gate, the ticket CLI,
`epic-status`, the state file, ADRs — applies when the profile declares it. By
exit code:

- `0` — follow the profile. A field that prints `null` or exits `4` means the
  project has no such thing: skip the step and say so in one line.
- `3` — no profile (unregistered directory). Say so once, then fall back: no
  `qmd` query, no ticket CLI, look for a state file in the repo and ask before
  creating one.
- `1` / `2` — the profile or registry is broken. Report it; do not guess paths
  or commands.

### Default loop

1. Restate the task in 1–3 lines, outline a short plan.
2. Map first (Phase 0) whenever the code is unfamiliar.
3. Name the task's slices and who runs each; keep only what the closed list allows.
4. Review before reporting (Phase 2).
5. Record state, then report (Phase 3).
6. Keep in main context only: plan, subagent summaries, decisions, final diffs.

### Answering, not exploring

A question is not a ticket. Answer it first — best answer now, with a confidence
level and what is shaky about it — and only then go looking. Exploration
confirms a stated hypothesis; it does not stand in for one. Asked how much or
how many, lead with the number and caveat afterwards.

### Plain language

Write for a competent engineer who has never seen this project. Name a thing by
the term the industry already uses — smoke test, e2e test, contract test, exit
code, helper function, CI job, guard clause — so the sentence still reads
correctly outside this repo. When a term really is local (an epic, a wave,
`legal_lock`, `HANDOFF.md`), gloss it in half a sentence the first time it comes
up in a turn.

**Writing in Russian: the term stays in Latin.** endpoint, test, deploy, CI run,
staging, guard, gate, seam, worktree, exit code, stub, mock, smoke test, flaky
test, mutation testing. Translating them produces jargon that reads as local
slang and loses meaning outside the repo — «ручка» for endpoint, «проба» for
test, «выкат» for deploy, «заглушка» for stub. Words that decline or conjugate in
Russian stay Russian («задеплоить», «прогнать», «деплой» in oblique cases):
Latin does not decline, and forcing it there rewrites the sentence for the sake
of the rule. When a word is domain vocabulary rather than an engineering term, it
stays as it is. When the profile names a glossary (`docs.context`), its
vocabulary section holds the project's full mapping.

Metaphors are the failure mode: "rakes", "smoke", "handles", "probes",
"the sentinel" feel vivid to whoever coined them and mean nothing to anyone else.
Say what the thing is and what it does. If no standard term exists, describe it
plainly rather than minting a new word.

**Codes carry their meaning.** A ticket number, ADR number, wave, finding label
or any code the project invented gets a few plain words in the same sentence
the first time it appears in a message — "backlog/18 (the lot-withdrawal button
shown to a moderator)". Later mentions in the same message may stay bare; the
next message explains again, because replies are read hours or days apart.

**Restate, don't point back.** No "as above", "per the analysis", "row 9",
"ticket 04 from earlier". Repeat the fact itself: "the race test where the
first operation's rejection went unhandled".

**Short sentences, one idea each.** Short paragraphs. "X is done. It lives in
file Y. Z is still missing." — not one long sentence joined by semicolons.

**Self-check before sending.** Scan the draft for capital-letter codes,
acronyms, project shorthand and figures of speech. Each code needs its plain
words in the same sentence; each figure of speech becomes the literal thing.
Then ask: would an engineer who joined today understand every word without
scrolling up? If not, rewrite.

Scope: all of this governs work — reports, tickets, ADRs, commits, PRs, code
comments. Casual chat, jokes or a message drafted for a friend in Telegram may
match that conversation's tone.

**Which language.** Reports to me follow the profile's `language.reports`.
Everything the team sees — commits, PRs, review comments, code comments —
follows `language.team`. With no profile: reports in the language I am writing
in, team-facing text in the language the repo already uses.

### Phase 0 — map before touching anything

In unfamiliar code the first move is always one `scout` agent (read-only) that
maps the territory. Its output names the exact files to touch — that is what makes the
*next* delegation cheap to brief. It is not a licence to do the rest yourself.

Ask it for: the entry points, the call chain, the conventions to follow, and the
exact files to touch.

Before that agent goes out, run one `qmd` query on the ticket's subject (MCP
server `qmd`, skill `qmd`: ADRs, state-file lessons, closed tickets, memory) —
when the profile lists at least one `qmd.collections` entry. With no
collections or no profile there is no index for this project: skip the query
and say so. A decision already taken or a lesson already paid for changes the
brief.

### Delegate by default

- Codebase exploration: "where is X", "how does Y work", tracing call chains
- Reading files >200 lines when only a conclusion is needed
- Broad grep/glob sweeps with noisy output
- Docs / dependency / API research
- **First draft of any long document** — ADR, research write-up, changelog,
  release notes: the agent brings the draft, you sharpen it
- Independent work on separate modules → several agents in one message
- Self-contained side quests, in parallel with the main work rather than queued
  behind it

### Your own hands — a closed list

- Single-file edit with a known path
- One targeted read or grep with a small, predictable result
- Trivial follow-ups to work already in context
- **Coupled sequential chains** — steps that depend on each other or edit the
  same files. Parallel agents don't speed this up, they collide. Own the chain.
- **Anything whose raw output drives your next decision** — live debugging,
  curl/browser verification, reading a failing response. A summary drops the
  detail you are deciding on.

The list is closed. Work that is not on it goes to an agent.

### Quota

Every line above is true item by item and false in aggregate: twenty
"single-file edits with a known path" in a row is a phase that ate the context.

Two counters, both checkable:

- **Before a phase**, name its slices and who runs each. A slice that is not on
  the closed list gets an agent assigned right there, not "later if it grows".
- **Inside a phase**, count the files you edited yourself. At the fifth, stop and
  re-slice what is left: keep the coupled chain, hand out the rest.

Hitting a counter and staying solo is a decision you say out loud, with the
reason, in the same turn.

### Long output: filter first, delegate second

Test suites, builds, linters: pipe through `tail`/`grep` and keep what lands in
context under ~15 lines. If a filter does the job, a subagent is a needless
round trip. Delegate the run only when it needs interpretation — a large failure
set to triage, a bisect, a flake to chase.

### Subagent contract

Give each agent: goal, scope (paths/modules), and the exact output format.
Require back: findings only, ≤30 lines, `file:line` references instead of pasted
code, explicit "not found" when nothing matches. No full file dumps, no
narration of the process, no restating the task.

The generic agents are `scout` (read-only map), `implementer` (one ticket, with
tests) and `reviewer` (one lens). They read the profile themselves, so every
brief names the repo or worktree path; without it they resolve my directory and
get the wrong profile or exit code 3.

### Evidence before "green"

- Never call lint, tests or CI clean without the exit code. Filtering long output
  is required (above); losing the exit code is not. `set -o pipefail` first, or
  save the output and print `echo $?` next to the tail. A `PreToolUse` guard
  refuses the pipes that swallow it.
- The verdict comes from `~/.claude/hooks/gate.sh fast`, not from my reading of
  the diff. A failing run means unfinished. "Could not verify" means unverified.
  Neither is reported as done.
- Gate exit codes: `2` is red. `3` is «не проверено» — unregistered project,
  broken registry, no node — never green. `0` is green only when the `[gate]`
  line says so: "nothing ran" and «ПРОВЕРИТЬ НЕ УДАЛОСЬ» also exit `0`. Where the
  gate does not cover the project, the verdict comes from the profile's
  `commands.verify` (or the project's own lint and test commands) with their exit
  codes, and the report says the gate did not run.
- Nothing is "deployed" until the live endpoint has been hit and its answer
  pasted.
- A subagent's `file:line` is a claim, not a fact. Re-read the line before
  repeating it — subagents have cited lines that were not there.

### Phase 2 — review before reporting

Run a `reviewer` agent over the diff before you report to me. Skip it only when
the whole diff is one file and under ~20 lines. Give it one lens — from the
profile's `review.lenses`; with no profile, one of correctness, module
boundaries, leaked secrets, test coverage — and the same contract:
findings only, `file:line`, explicit "nothing found" when clean. Several lenses
in parallel when the change is large. Do not substitute your own self-check for
this.

### Phase 3 — state, then report

**Every turn that does work ends with a four-line status block**, in the
language of reports, after the prose:

    — Этап: <строка из epic-status, или одна фраза об этапе>
    — Сейчас: <what is true right now>
    — Дальше: <the single next step>
    — Жду: <what I need from you, or "ничего">

Rules that keep it honest:

- Only verified state goes in. "Готово" after a green run, not after the last
  edit lands. Failing tests are reported as failing.
- When the profile has `tickets.epic_status` (today `~/.claude/bin/epic-status`),
  the Этап line is this turn's output of `<that tool> <эпик>`; with no single
  epic in play, run it bare and paste the line for the work at hand. Without it,
  the Этап line is one plain phrase naming the stage of the work.
- Skip it on purely conversational turns — there it is noise, not signal.
- It is a status line, not a second summary. Four lines, no prose.

**Ticket status moves through the profile's `tickets.status_tool`** (today
`~/.claude/bin/ticket`) — `claim` when picking one up, `block <причина>` when it
stalls, `done <эпик> <NN>` once the work is finished the way `workflow.finish`
says, with `--pr <N>` when it ends in a green PR. It writes one canonical Status
line in the spelling the file already uses. No status tool in the profile — no
ticket CLI; say where the status was recorded instead.

**A task is not finished until the project's state file is updated.** The
profile's `docs.handoff` names it (`path`), its form (`kind`) and a `check` to
run after editing — typically `HANDOFF.md` at the root with "what's done /
what's next / what went wrong". Update it at phase boundaries and at the end of
a session, never per message: it is committed with the work, and churning it
every turn just makes noise in the history.

Never invent a second state file. If the profile or the repo has one, use it; if
neither does, ask before creating one. Two files describing where we are means
one of them is lying.

**State files and ADRs are different documents — never merge them.** ADRs live
where the profile's `docs.adr_dir` says, if the project keeps them. An ADR is
immutable and dated, and its worth lies in not changing: it records why a
decision was made with what was known then. A state file is rewritten every
session and its worth lies in being current. They connect by links only — the
state file says what is done and points at the ADR that says why.

### Context hygiene

- Quote the minimal fragment; whole files stay out of main context.
- Editing a file outside the `Edit` tool prints its whole contents back into
  context, and the bigger the file the bigger that cost. Point edits go through
  `Edit`; a sweep across many files is an agent's job, not yours.
- After each phase, compress: keep conclusions, drop the trail.
- Unbounded output — logs, curl responses, DB dumps — gets filtered before it
  lands; delegate the run only when no filter does the job.
- Report to me only what changed and what I need to decide.
