---
name: continuous-audit
description: Run on the words "audit", "scan the codebase", "file tickets for the findings" (in Russian «аудит», «просканируй кодовую базу», «заведи тикеты по находкам») and in scheduled runs. Works in any registered project; takes the lenses, paths and `qmd` collections from the profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`).
---

# Codebase audit: from reading to tickets

The result is the epic `<tickets root>/audit-<date>/` (the root is `F tickets.root`): findings with a `file:line` address and evidence,
tickets the size of one PR, a split into waves. The rule of this skill: **a finding stays a claim until
a second agent has reproduced it**. A ticket written from a single line someone read is wrong in roughly a third
of its statements (that is what the review of 67 Auction tickets showed, write-up `.scratch/ui-triage/triage-27-41.md`
in its repository).

Arguments: `--lenses a,c,i` narrows the set of lenses (default: all lenses of the profile), `--live` turns on
the pass over the running dev stack. A scheduled run goes without questions: anything disputed goes into `map.md`.

## Project profile

Everything project-specific — lenses, branch base, tickets root, `qmd` collections, dev stack, ADR folder — comes
from the profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`, contract — `~/.claude/profiles/README.md`). Below, `F <field>` is
shorthand for `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field <field>`, run in the project root or in the audit
worktree (the profile is found by repository; a worktree is recognised the same way). In the bash blocks below it is
declared as a function on the first line: shell state does not persist between calls.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --name; echo "EXIT=$?"
```

- `0` — work by the profile.
- `3` — the project is not registered or has no profile. **Stop**: say "project `<path>` is not
  registered — there is no profile, nothing to audit against" and offer to create a profile
  (`~/.claude/profiles/README.md`, section on a new project). Do not guess lenses or paths. In a
  scheduled run — the same line as the answer, no epic.
- `1`, `2` — the registry or the profile is broken: stop, the message from stderr goes into the answer.

A missing field (`F` returned exit code 4 or printed `null`) turns off the step that depends on it, and
this is said in words ("the dev stack pass is skipped: the profile has no `dev_stack`"). Without `audit_lenses`
the audit does not run at all — stop with the same wording. Project facts that did not fit into fields are in
`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --rules`; read it once before the briefs. The text of `spec.md`, `map.md` and the tickets is
in the language the project's existing tickets are written in (none exist — `F language.reports`);
the report to the user — `F language.reports`; the ticket template headings — exactly as in the template below.

## 0. Orientation

**Silent mode** — `F _resolved.mode` prints `silent` (contract: `profiles/README.md`, "Full mode and Silent
mode"). The audit epic is a set of workflow files, so it lives in the Workflow folder
(`F _resolved.workflow_folder`) and never in the repository: the tickets root is `ticket root` (a relative
`tickets.root` is taken from the Workflow folder), there is no audit branch, no worktree is created for it
and no PR is opened. The code is read from the main checkout at the audit commit (`git -C <repo> worktree add
--detach <scratchpad>/audit-tree "$BASE"` when a separate read-only tree is needed — it is the "Tree" of the
briefs, and nothing is committed in it). The blocks below are for Full mode; in Silent mode `T` is
`$(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" root)/` and `A` is the epic name chosen in the first block
(`audit-<date>`, a repeat gets `-2`), and phase 4 ends with the local commit described there.

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
BASE=$(F worktree.base) && [ "$BASE" != null ] || BASE=$(git symbolic-ref -q --short refs/remotes/origin/HEAD)
T=$(F tickets.root)                      # root of the epics, e.g. .scratch/
A=audit-$(date +%F); { git show-ref -q "refs/heads/$A" || [ -d "$T$A" ]; } && A=$A-2   # epic = branch = worktree; a repeat on the same day gets the suffix -2, -3, …
git fetch origin --prune && git log --oneline -1 "$BASE"   # the audit commit — into the spec.md header
git worktree add "../$A" -b "$A" "$BASE" && cd "../$A"
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status"; find "${T%/}" -maxdepth 1 -type d -name 'audit-*' | sort | tail -1   # all epics; the previous audit (not `ls audit-*/`: in zsh an empty glob is an error)
```

The path `../$A` is the audit worktree; it goes into every brief below as "Tree". The name `$A` is both the
epic and the worktree branch: in later blocks it is derived again with `git branch --show-current` in the
audit worktree (shell state does not persist between calls). Below, `$T$A` is `<tickets.root><audit
epic>`, for example `.scratch/audit-2026-10-05/`.

One `qmd` call (skill `worfy:qmd`), `intent` "lessons of past audits": `vec` «прошлые аудиты кода и ложные
находки», `lex` `аудит находк ложн`. Search the whole index: `F qmd.collections` (what they hold — `F qmd.covers`)
is a hint about where to expect the answer, not a filter for the `collections` parameter. A lesson already paid for changes the briefs
before they go out.

From the `spec.md` of the previous audit, list the findings per lens with the ticket path and its `state` from
`epic-status --json`; the list goes into the lens brief, and the agent answers `fixed | still | regressed` for each one.
Every `regressed` of any severity goes to phase 2 together with HIGH; a confirmed one becomes a new ticket with
`Source:` pointing at the old one. `still` with an open ticket — a reminder in `spec.md`. For the first audit the list is empty.

## 1. Lenses — parallel agents, read-only

A lens is one review topic with its own `worfy:scout` agent (read-only, answer up to 30 lines with
`path:line`); all lenses go out in one message. The lens table comes from the profile, one row per lens:

```bash
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
F audit_lenses | jq -r '.[] | "| \(.id) — \(.title) | \(.where | map("`\(.)`") | join(", ")) | \(.finding) |"'
```

Columns: `| Lens | Where to look | What counts as a finding |`. `--lenses` selects rows by `id`.

The brief of each lens — verbatim:

> Tree: `<audit worktree path>` — run the profile with `-C` on it.
> Lens `<id>`: `<table row>`. Commit `<hash>`.
> Old findings of the lens: `<list>` — for each, answer `fixed | still | regressed` with `file:line`.
> One finding per line, JSON without line breaks:
> `{"lens","severity":"HIGH|MED|LOW","file","line","evidence_command","claim","suggested_fix","acceptance"}`.
> `evidence_command` — a command that shows the defect (`sed -n`, `grep -n`, a project command from the
> profile's `commands`); `acceptance` — a checkable "done when" condition. A statement without
> `file:line` or command output does not go into the report. Nothing found — write exactly that: "nothing found".
> More than 30 findings — keep the highest by severity and add the line `dropped: N`.

**The dev stack pass** (`--live`) is run by the main session, not by a lens. The stack is up when every command from
`F dev_stack.check` answers as expected (the database in the container list, a listener on port
`F dev_stack.web_port`); only `preview_start` starts the server, pages are read with `read_page` and
screenshots. A screenshot is not a measurement: performance on a dev server does not go into the report; list what was not checked
item by item. No `dev_stack` — the pass is skipped, and this is written into `spec.md`.

## 2. Cross-check

Every HIGH finding and every `regressed` gets a `worfy:reviewer` agent with a brief to refute it: tree —
`<audit worktree path>`; run `evidence_command`, re-read `file:line` ±20 lines, look for a
check further up the call chain. Grouped by lens, up to 8 findings per agent; a lens's author does not check
its own findings. The answer is one line per finding, `confirmed | not-reproduced | moved <file:line>`, with the reason, and
a line "what I ran, exit code". `not-reproduced` drops out; `moved` is confirmed at the new address.

The result of the phase is a table in `spec.md`, which is also the lens quality summary:
`| Lens | checked | confirmed | dropped | false share |`. A lens with a false share above one third
gets a note in the brief of the next audit. The remaining MED and LOW go into tickets only after
`file:line` is re-read in phase 4.

## 3. Deduplication

The sources are the project's tickets where `tickets.path` points (the skill does not query other trackers)
and the decisions: the MCP server `qmd`, where `F qmd.collections` and `F qmd.covers` hint at where to expect the answer
(tickets on the main branch, ADRs, the state file, the glossary). Some tickets live only on branches not yet
merged into the main one: the open tickets of branches with commits in the last 14 days are collected by the loop below (like
`epic-board`, but without HTML):

```bash
git for-each-ref refs/remotes/origin --format='%(refname:short) %(committerdate:unix)' \
  | awk -v t="$(( $(date +%s) - 14 * 86400 ))" '$2>t{print $1}' \
  | while read -r b; do "${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json --ref "$b"; done \
  | jq -c '.tickets[]|select(.state!="done")|[.ref,.epic,.num,.slug,.title]' | tr -d '\r' > "${TMPDIR:-/tmp}/live-tickets.jsonl"
```

The agent per lens is `worfy:scout`: it has the `qmd` tools (`query`, `get`), and the `qmd` rules are written for the
MCP form (`searches`, `intent`, `minScore`). The brief carries the audit tree and the path to `live-tickets.jsonl`.
HIGH and MED findings; for each, one `query` call over the whole index (the profile's collections are a hint, not a
filter), `intent` — the lens topic, two sub-queries: `lex` of 2–4 word stems plus an identifier from the code (the name of a
function, flag or file without its path), `vec` — the `claim` in your own words.
A hit with score ≥ 0.6 is read through `get` before the verdict. Over `live-tickets.jsonl` — `grep` by file
and by the words of the defect; the ticket body — `git show <ref>:<ticket path by tickets.path>`. Verdicts:

- **duplicate** — a ticket in `state` `open | work | blocked` whose body names the same file and the same
  defect. In `spec.md`, a line "already in work: `<epic>/<NN>`", no ticket.
- **regression** — a `done` ticket, the defect confirmed in phase 2. A new ticket, `Source:` pointing at the old one.
- **decided** — an ADR took a decision against `suggested_fix`, and its premise still holds. In `map.md` under
  "decision taken", no ticket. The premise is gone — a `Type: grilling` ticket for a new ADR: the old one stays
  unchanged, a revision is written under a new number.
- **new** — no hits ≥ 0.6, or every hit that was read is about something else.

The agent's answer is a table `finding | verdict | path or ADR`, without retelling the documents.

## 4. Tickets

The epic `$T$A/` is three things:

- `spec.md`: `Status: ready-for-agent`, the audit commit, the lenses; per topic — findings with `file:line`,
  `evidence_command` and the phase 2 verdict; the false-findings table; the deduplication table; the list of
  what the dev stack pass did not check.
- `map.md`: every finding gets an address — **fix queue** (ticket here), **decision** (mine — a
  `Type: grilling` ticket; the client's — a question into the batch for the client), **docs edit** (a `Type: task` ticket),
  **future phase** (a pointer in `<tickets.root>roadmap`). The map is closed when no finding is left
  without an address.
- `issues/NN-<slug>.md`, numbered from `01` in wave order, the template verbatim (`<adr_dir>` — `F docs.adr_dir`;
  no ADR folder — the ADR link in `Source:` is removed):

```markdown
# NN — <Title: what changes, not what is broken>

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), section «<topic>», finding <lens>-<N>; [ADR-NNNN](../../../<adr_dir>/NNNN-….md)

## Что делаем
<the defect with file:line at the audit commit; what replaces it; the boundaries of the change>

## Готово, когда
- [ ] <checkable condition from acceptance>

## Тесты
- `<path to the test file>` — criteria 1, 2 (new | extend)

## Где в коде
- `<path>` — <what is there>
```

The headings of this template are the ticket format the tooling reads (worfy parses `## Где в коде`): keep them as written,
whatever language the ticket text is in.

`Type` — from the repository's glossary: `task | research | grilling`; a decision ticket is `Type: grilling` with
`## Question` and `## Решение владельца` instead of `## Что делаем` (a model — any such ticket of the project:
`grep -l '^Type: grilling' "$("${CLAUDE_PLUGIN_ROOT}/bin/profile" --field tickets.root)"*/issues/*.md | head -1`). `Blocked by` — `—` or numbers of this epic
separated by commas (`01, 03`); anything else `epic-status` counts as unparsed.

Size — one PR: one module, one test file, up to five paths in `## Где в коде`. A finding spanning two modules
is cut into two tickets linked by `Blocked by`. At most one migration per ticket (if the project has
migrations: `F numbering.migrations` is not `null`).

Before the commit, one agent re-reads every `file:line` from `issues/` (the brief carries the audit tree) and
returns the mismatches; the mismatches are fixed. Then:

```bash
cd <audit worktree path>
F() { "${CLAUDE_PLUGIN_ROOT}/bin/profile" --field "$1"; }
T=$(F tickets.root); A=$(git branch --show-current)          # worktree branch = audit epic name
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" --json | jq --arg a "$A" '.tickets[]|select(.epic==$a and .blockedParsed==false)'  # empty
"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" "$A"                    # e.g. "/to-tickets · audit-… 0/N · ticket 01 — …"
git add "$T$A" && git commit -m "docs: audit $A — N tickets" && gh pr create --fill   # merge — by hand
```

How CI treats a PR that contains only ticket files is in the profile's `rules.md`, if it says so there.

In Silent mode there is no commit in the repository and no PR: the epic is already in the Workflow folder.
When the Workflow folder is a git repository of its own, it gets a local commit, without push:
`git -C <Workflow folder> add -A . && git -C <Workflow folder> commit -m "audit $A — N tickets"`. The
"Сейчас" line of the status block then names that commit instead of a PR.

## 5. Waves, report, status

A wave is the tickets that can be worked in parallel: no `Blocked by` on tickets not yet shipped and no shared
paths in `## Где в коде`. Two tickets with a shared file go either into different waves or into one ticket. At most one ticket with a
migration per wave: all sessions share the migration number. The table goes into `spec.md`, section "Waves",
one row per ticket; the columns `| Ticket | Files from «Где в коде» | Migration (yes/no) | Wave |` are the contract
for the skill `worfy:epic-wave`; a single ticket is carried by the skill from `F workflow.ticket_skill` (a bare schema 1
value such as `ship-ticket` means the plugin skill `worfy:ship-ticket`). In a project without
migrations the "Migration" column is "no" everywhere.

A one-page HTML report — through an Artifact, last, and only when a human will read it (skipped in a
scheduled run): topics, under each the findings with a link to the ticket, the verdict and the severity;
the false-findings table; the list of what was not checked.

The answer ends with a block of four lines (the labels are what worfy parses; the values are in `F language.reports`):

    — Этап: <the epic-status $A line>
    — Сейчас: <N findings, M dropped by the check, K duplicates, T tickets, PR #…>
    — Дальше: merge the PR and the first wave
    — Жду: <decisions from map.md, or "nothing">

Boundaries: a human merges the PR; other tickets' statuses (the `ticket` tool included), old tickets, and the `spec.md` and `map.md`
of other epics stay untouched.
