# ship-ticket, step 7: Review agents on the diff

A WIP commit first: the reviewer's worktree takes only what is committed; it will not see an
uncommitted change and will review old code. In Silent mode its message describes the change, like any
other commit of the repository.

A reviewer is the agent `worfy:reviewer` (`subagent_type: "worfy:reviewer"`), one lens each, all
of a round in parallel. Each brief gives the path to its worktree (the agent runs
`profile -C <path>`), the lens, the branch and the base. How many reviewers a round has is set by
its review depth.

**Model and effort.** Each reviewer and sceptic gets the Agent parameters of its role:
`Agent({subagent_type: "worfy:reviewer", model: <F agents.reviewer.model>,
effort: <F agents.reviewer.effort>, …})`.
Which value wins: the owner's word in a message (`Ticket <NN> — opus`, in any language), then an
argument of the skill — each for that one ticket — then `F agents.<role>.model` and
`F agents.<role>.effort`, then the agent's frontmatter. The argument is
`/worfy:ship-ticket <epic> <NN> model <sonnet|opus> effort <low|medium|high>` (either half alone).
No field (exit 4 or `null`) and no argument — no parameter: the agent runs with the `model` and
`effort` of its frontmatter, as before. Any other value, `haiku` too, is not passed: the next source
decides, and the report names the reason. The report names them for every agent it started:
`Model: <model> (<where it came from>), effort: <effort> (<where it came from>)`, where
`<where it came from>` is `argument`, `owner's word`, `agents.<role>` or `frontmatter`.

**Review depth.** A scale, like effort: `low`, `medium`, `high`, `max`. It sets how many agents
review a round, with which lenses, how much mutation testing they do and which findings get a
sceptic (one `worfy:reviewer` agent per finding, tasked with refuting it, as in the narrow round of
`/worfy:epic-wave`, section 3). Every round has one depth.

| Depth | Agents | Lenses | Mutation testing | Refute (sceptic agents) | Cost of a round, subagent tokens |
|---|---|---|---|---|---|
| `low` | one reviewer | one: it reads the diff and runs the tests of the change (the first of `F review.ticket_lenses`) | none | none | under 0.5 million (estimate) |
| `medium` | two reviewers | the items of the previous round's report, and the tables already made (cases with inputs and expected results, from an earlier round or from the implementer) checked against the code; in a first round, which has no previous report, the first two of `F review.ticket_lenses` | changed lines only | one sceptic per `high` and `med` finding | 1–2 million (estimate); a round without `high` or `med` findings measured 0.47 million |
| `high` | three or four reviewers | `F review.ticket_lenses` (no field — two or three of `F review.lenses`, by what the change is about); one of them builds its own table of cases on the real code and compares the tests of the change with the main branch on this machine's OS (the change may have been written on another OS); a `security` lens | every code line of the change | one sceptic per finding | 5.3–6.4 million (measured 2026-10-12) |
| `max` | the agents of `high` depth, then those of `/worfy:max-review` | the lenses of `high` depth, then the two lenses of max-review on two models | as at `high` depth | as at `high` depth, then the sceptics of max-review | about 10 million (estimate) |

`max` depth is `high` depth, then `/worfy:max-review` on the whole branch: the round at `high` depth
first, then that skill with its own verdict. `max` depth runs only when the owner asks for it, by an
argument, a word in a message or the profile field. The levels of findings stay `high` / `med` /
`low`; a depth is always written with the word "depth" (`high` depth), so the two scales are not
mixed up. The project's full local check before a merge of code (`rules.md`) is outside the depth
scale: it runs at every depth.

**Which depth.** The first that applies:
1. An argument: `/worfy:ship-ticket <epic> <NN> depth <low|medium|high|max>`. The owner's word in
   a message (`review #237 — low`, in any language) is the same argument; it holds for the round
   the message asks for.
2. The agents mode: when the mode of the ticket is `eco` (paragraph "Agents mode" below:
   `F workflow.agents` `eco`, and none of the cases where `full` is required applies to the diff of
   the round), every review round of the ticket's own diff has `low` depth — one reviewer with one
   lens. The report names the source `workflow.agents: eco`.
3. The profile: the first review round of the change — `F review.depth.first_round`; a repeat
   review after rework — `F review.depth.later_rounds`.
4. No field (exit 4 or `null`) and no argument — the review of the ticket's own diff stays as it
   was, without a depth: two or three reviewers in parallel, one lens each, by
   `F review.ticket_lenses` (no field — two or three of `F review.lenses`, by what the change is
   about), and a repeat review as described below. The report says so:
   `Review depth: ticket lenses — default: the profile has no review.depth.first_round` (for a
   repeat review — `review.depth.later_rounds`). The defaults `high` depth and `medium` depth are
   only for a PR another session wrote (section "Review of a PR another session wrote").

**Agents mode.** How many subagents a ticket starts is `F workflow.agents`: `full` or `eco`.
No field (exit 4 or `null`) — `full`: the agents as before. Any other value is read as `full`, with
the reason `workflow.agents`. With `eco` every review round of the ticket's own diff has `low` depth
by item 2 of the list "Which depth". The mode is decided on the diff of the round, before its
reviewers start. `full` is required in `eco` too when
the change touches a script or a hook (the `bin/` or `hooks/` of the Harness, or a script of the
repository), when it is a platform PR (one that needs the verdict of another operating system by
the `rules.md` of the project), or when its diff deletes files, stops processes or replaces a copy
(the cases that block a merge by the review depth scale, paragraph "What blocks" below). The report
names the mode of the ticket: `Agents: eco` or `Agents: full — <reason>`, where `<reason>` is
`workflow.agents`, `default: the profile has no workflow.agents`, or the case of the list above
that applies (`script or hook`, `platform PR`, `destructive action`). Next to it goes the line
`Subagents: <number> — <names>`: every subagent started for the ticket counts — the scout, the
implementers, the verifier, the reviewers and the sceptics.

**What blocks.** What blocks a merge, at every depth: a `high` or `med` finding in the code, or a
gap in the tests that guard a destructive action (a delete, stopping a process, replacing a copy).
The other gaps go as a list into a follow-up ticket. Such a test gap belongs to Act on (below)
whatever its level; the other test gaps go to Consider or Noted.

**Two report lines.** The report of every review round names its depth and what its agents spent:

```
Review depth: <depth> — <where it came from>
Review tokens: <subagent tokens of the round> | not measured
```

`<where it came from>` is `argument`, `owner's word`, `workflow.agents: eco`, `review.depth.<field>`
or `default: the profile has no review.depth.<field>`. The tokens are the sum of the token counts the
finished agents of the round report in their results (reviewers, sceptics, the agents of
max-review); an agent whose result shows no count makes the line `Review tokens: not measured`,
never an estimate. When the round's verdict is written down (a PR comment, a `gate:` commit, a line
in the ticket file), the two lines follow the verdict and its group lines: they are never the first
line, and neither starts with `REJECTED` or `gate:`, so the counts of rounds and worfy's reading of
a PR's verdict stay as they are.

**The review mark.** The verdict is bound to the commit the reviewers saw: before the
round starts, mark that commit `review pending`; when its verdict is written down, mark the same
commit `review success` (`VERIFIED`) or `review failure` (`REJECTED`). A new commit has no mark,
so a push after the verdict sends the ticket back to review. In Full mode the mark is a commit
status on GitHub, so the commit must be pushed first; with `local-green` in Full mode and an
`origin` there is no mark — the `gate:` commit stays the record. In Silent mode, and in Full mode
with `local-green` in a repository without `origin`, the mark is a file in the Harness home
(`runs/<project>/marks/<epic>-<NN>.json`), never on GitHub: `ticket mark` picks the store itself.
The comment, the commit or the line in the ticket file stays as well: the rounds
are counted by them.

```bash
sha=$(git -C <worktree> rev-parse HEAD)                      # the commit the reviewers' worktrees are on
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> review pending --sha "$sha"); echo "EXIT=$?"
# when the verdict is written down, on the same $sha:
(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" mark <epic> <NN> review success --sha "$sha"); echo "EXIT=$?"   # REJECTED: review failure
```

A mark that fails (`EXIT=1`) changes no verdict: say so in the report and set it again on the same
SHA.

**`parallel: worktrees`.** Every reviewer has its own worktree; the orchestrator creates it before
the start:

```bash
<F worktree.reviewer>                 # <review-target> = <lens>-<NN>, <branch> — the ticket's branch
(cd <worktree> && <F commands.prepare_tree>)
git worktree remove <worktree>        # after the verdict; a "dirty" refusal means the reviewer left changes — look, no --force
```

Parallel reviewers do not share one worktree: on 16 September two reviewers worked in one, one ran
mutants, the other took a mutant for a flaky test.

**`parallel: single`.** No own worktrees: reviewers read the main checkout, only one of them runs
checks, and only after the implementer has finished.

In both modes mutations only in your own worktree or on copies in your own scratchpad subdirectory
(`<scratchpad>/<agent-name>/`), restored from the copy, not with `git checkout`. Do not run other
agents' scripts from the scratchpad: a reviewer that ran someone else's `mut.sh` hung for three
hours. Contract: findings only, `file:line`, an explicit "found nothing". Re-read every `file:line`
yourself — subagents have quoted lines that were not there.

Each reviewer's brief carries the owner's rules on evidence: an item with "not verified: …" (step
6, manual checks) is not a finding; attached evidence that does not show what is claimed is a
high-severity finding.

**Four groups of findings.** When the reviewers have answered and you have re-read every
`file:line`, sort all their findings into four groups and show the four groups to the user. The
groups are a way to show the findings, not a new scale: the levels `high` / `med` / `low` and the
verdicts `VERIFIED` / `REJECTED` of a wave's gate stay as they are. The level of a finding is its
reviewer's: you do not change it, you may only propose a change to that reviewer (below).
- **Act on** — confirmed `high` and `med` findings; they go to rework. No more than 5: a longer
  list means the selection is weak, so check every item again — is it confirmed, is it one defect
  reported twice. A finding its reviewer stands by is never moved out of Act on to fit the limit:
  if more than 5 remain, say so in the report.
- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives; they
  go to the ticket's result section as debts (step 11). A `high` finding never goes here.
- **Noted** — `low` findings that need no fix now and the `[low] debt: …` lines of a repeat review;
  one line each in the ticket's result section.
- **Dismissed** — findings you refuted, each with a one-line reason. Deciding not to fix a finding
  does not refute it: such a `med` or `low` finding belongs to Consider.

No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees
what was rejected and can overrule it. An empty group is written as "none".

**You do not take a `high` or `med` finding out of Act on alone.** A `low` finding you sort
yourself. A `high` or `med` finding that you would put into Consider, Noted or Dismissed, or whose
level you think is too high, goes back to the reviewer that raised it: before anything goes to
rework, send that reviewer your reason through `SendMessage`. Its answer decides:
- a finding the reviewer withdraws, or agrees to lower or to set aside, goes to the group it agreed
  to, and its line says "agreed by the reviewer";
- a finding the reviewer insists on stays in Act on, at the reviewer's level;
- if the reviewer cannot answer any more, the finding stays in Act on.

Write the Consider, Noted and Dismissed lines into the ticket's result section as soon as they are
sorted, not at step 11: the brief of the repeat review is built from the groups, and a session
break must not lose them.

Source: pstack, `pstack/skills/interrogate/SKILL.md` and
`pstack/skills/interrogate/references/lead-judgment.md`, commit
`ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Lauren Tan)
— the four groups, the limit of 5 and the reason to show what was dismissed. The group names are
pstack's; the rules are reworded, not copied. The exchange with the reviewer is this project's own
rule.

**A repeat review after rework** checks the rework round; it does not search everything again. The
brief gives the first round's findings — its Act on group, without the other groups — and the diff
of the rework only. Only these block: (a) a first-round finding that is neither fixed nor refuted;
(b) a defect introduced by the rework's changes; (c) a new high-severity defect. Only the Act on
group counts for (a): what the first round put into Consider, Noted or Dismissed — a `high` or
`med` finding only with its reviewer's agreement — is not ground (a). Everything else new is
`[low] debt: …`: it does not block and goes to the ticket's result section (step 11). Without this
rule fresh reviewers always find
something new, and tickets on the critical path get stuck together with their dependents. The
narrow fix round for such a ticket — skill `/worfy:epic-wave`, section 3.
