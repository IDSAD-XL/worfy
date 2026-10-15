---
name: max-review
description: Review a whole branch before a risky merge — two lenses (correctness and simplification), each optionally on two Claude models, a synthesis, sceptic agents and the four groups of findings, then one verdict with the prefix MAX-REVIEW. Use when the owner asks for it ("/worfy:max-review <branch>", "max review", "review this branch with two models") and from skill epic-wave, section 4, for a ticket whose header marks it as risky. Edits nothing, merges nothing.
---

# Max review of a branch before a risky merge

An ordinary review looks at one ticket's diff, or at one round of rework. A branch that touches the
gate, the Autopilot or a file format other programs read can break every wave after it, so before
its merge it gets a wider look: two lenses read the whole branch, each lens optionally on two Claude
models, their findings are merged, sceptic agents try to refute them, and what stands is sorted into
four groups. The review covers the whole branch, not one round of rework.

**Cost.** The mode costs 2–4 times as much as an ordinary review (an estimate, not a measurement):
four reviewers instead of one verifier, and sceptics on top. Without the mark and without a request
it does not run.

The mode edits nothing and merges nothing: its result is a report and a verdict.

Who runs it: the orchestrator (the main session), never an implementer or a reviewer: it starts
agents and waits for their answers.

`F <field>` below is `"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field <field>`. The profile
contract is `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`.

## 1. When it runs

- **On the owner's request** — `/worfy:max-review <branch> [<base>]`. Without `<base>` the base is
  `F worktree.base`, and without that field the main branch of the repository.
- **In a wave** — skill `/worfy:epic-wave`, section 4: a ticket marked as risky gets the mode after
  its gate (section 3) gave `VERIFIED` and before its merge. The mark is the line `Risk: high` in its
  header, next to `Status:` and `Blocked by:`; `epic-status` and worfy skip a header line they do not
  know. Whoever writes the ticket sets the mark; nothing sets it from the diff.

## 2. Scope and intent

```bash
git -C <repo> fetch -q origin
git -C <repo> diff --stat <base>...<branch>      # the whole branch against the merge base
git -C <repo> diff <base>...<branch>
gh pr list --head <branch> --state open --json number --jq '.[0].number'   # pr-green-ci: the PR, if any
```

State the intent of the branch in one paragraph before the reviewers start: what the branch is meant
to change, taken from the ticket's goal and acceptance items, the PR description and the commit
messages. The same paragraph goes into every brief. If the intent is unclear and a human is there,
ask; in a wave without a human, take it from the ticket and say so in the report.

## 3. The reviewers

Two lenses:
- lens `correctness` (the worfy profile calls it `корректность`): defects the branch ships —
  wrong behaviour, a broken local build or start, a leak past a feature flag, races, lost data;
- lens `simplification` (`упрощение`): what in the branch can be deleted, reused or made simpler
  while the behaviour stays; its rules are in agent `worfy:reviewer`, "Lens: simplification".

By default each lens runs on two models, so four agents `worfy:reviewer` start in one message, in
the background. The two models are chosen by the `model` field of the Agent call that starts
`worfy:reviewer`; the agent itself does not change. The first model is the orchestrator's own: start
that reviewer without the `model` field, and the agent's `model: inherit` keeps it on the
orchestrator's model. The second model is `sonnet`: `model: "sonnet"`. If the orchestrator itself runs
on `sonnet`, the second model is `opus`. One model per lens only when the owner asks for it ("max
review — one model"); then two agents start, and the report says so.

Both models of a lens get the same brief, byte for byte: the variety comes from the models, not from
different roles. The briefs of the two lenses differ only in the lens. A brief names:
- the branch, the base and the diff command `git diff <base>...<branch>`;
- the intent paragraph (section 2) and the path to the ticket, when there is one;
- the lens;
- its own worktree, `F worktree.reviewer` with `<что-ревьюишь>` = `max-<NN>-<n>` (`<NN>` — the
  ticket's number, outside a wave the branch name with `/` replaced by `-`; `<n>` — 1 to 4). The four reviewers never share a tree:
  a reviewer runs the checks itself, and two runs in one tree spoil each other;
- the rules every reviewer gets: read only, mutations only on copies in its own scratchpad
  subdirectory, no other agent's scripts from the scratchpad, the answer in the agent's own format,
  first line a verdict, `file:line` for every finding.

Names: `max-<lens>-<model>` (`max-correctness-inherit`, `max-simplification-sonnet`). Wait for all of
them; an agent that does not answer is a gap in the report, not a clean result.

## 4. Synthesis

Re-read every `file:line` of every answer yourself before using it. Then build one list:
- one finding reported in different words by several reviewers is one finding; its line names every
  reviewer that raised it;
- a finding raised by both models, or by both lenses, weighs more than a finding of one reviewer:
  mark it "both models" or "both lenses". A finding of one reviewer is still a finding: it goes on to
  the sceptics like the others;
- when one reviewer reports a defect and another says the same code is correct, write both down:
  that is the question the sceptic answers;
- the level of a finding is its reviewer's; when reviewers give one finding different levels, the
  higher level stands.

## 5. Sceptics

Then the sceptics, as in skill `/worfy:epic-wave`, section 3 (the narrow round): one `worfy:reviewer`
agent per `high` or `med` finding, tasked with refuting it. A finding that only one model raised gets
its sceptic on the other model. A sceptic only reads; if a refutation needs a run, it gets its own
worktree from `F worktree.reviewer`, not a reviewer's tree. A finding the sceptic refuted goes to
Dismissed with the sceptic's reason; a finding that stood keeps its level. `low` findings get no
sceptic.

## 6. Four groups

What stood is sorted into the four groups of skill `/worfy:epic-wave`, section 3, with the same rules:
- **Act on** — confirmed `high` and `med` findings. No more than 5: a longer list means the
  selection is weak, so check every item again. A finding its reviewer stands by is never moved out
  of Act on to fit the limit: if more than 5 remain, say so in the report.
- **Consider** — `med` and `low` findings whose fix is disputable or costs more than it gives. A
  `high` finding never goes here.
- **Noted** — `low` findings that need no fix now.
- **Dismissed** — findings the sceptics or you refuted, each with a one-line reason.

No finding is dropped silently: what goes to no other group goes to Dismissed, so the owner sees what
was rejected and can overrule it. An empty group is written as "none".

**You do not take a `high` or `med` finding out of Act on alone.** A `high` or `med` finding that you
would put into another group goes back first to the reviewer that raised it, through `SendMessage`,
with your reason; a finding it insists on stays in Act on, and if it cannot answer any more, the
finding stays in Act on.

Under the groups, one line per finding of Act on and Consider: which reviewers raised it (the map of
agreement between the models and the lenses).

## 7. The verdict

The first line of the report is `MAX-REVIEW: VERIFIED` or `MAX-REVIEW: REJECTED: <Act on>`.
`REJECTED` is given when at least one finding is left in Act on after the sceptics. The lines of the
other groups follow, as in a recorded gate verdict:

```
MAX-REVIEW: REJECTED: <Act on>
Consider: <findings>
Noted: <findings>
Dismissed: <findings, each with its reason>
```

The verdict is written where skill `/worfy:epic-wave`, section 3, writes the gate's verdicts, with the
prefix `MAX-REVIEW:`:

```bash
gh pr comment <N> --body "MAX-REVIEW: VERIFIED"             # with a PR; or "MAX-REVIEW: REJECTED: <Act on>" and the group lines
git -C <worktree> commit --allow-empty -m "gate: MAX-REVIEW: VERIFIED"   # local-green, on the ticket's branch
```

In Silent mode the branch gets no `gate:` commit: the verdict is a line at the end of the ticket file
in the Workflow folder:

```bash
f=$(ls "$(cd <repo> && "${CLAUDE_PLUGIN_ROOT}/bin/ticket" root)"/<epic>/issues/<NN>-*.md)
printf '\n%s\n' "gate: MAX-REVIEW: VERIFIED — $(date +%F)" >>"$f"    # or "gate: MAX-REVIEW: REJECTED: <Act on>"
```

The prefix keeps the verdict out of the counts of gate rounds: epic-wave counts rework rounds by the
comments that start with `REJECTED` and by the lines `^gate: REJECTED`, and `MAX-REVIEW: REJECTED`
matches neither. worfy shows a PR's verdict from the last comment that starts with `VERIFIED`,
`REJECTED` or `NARROW:`, so it keeps showing the gate's verdict. No group line starts with
`REJECTED` or `gate:`.

## 8. What the verdict does

- `MAX-REVIEW: VERIFIED` — the merge goes on as usual (skill `/worfy:epic-wave`, section 4).
- `MAX-REVIEW: REJECTED` → `ticket block`, without a rework round: the ticket has had its rounds in
  the gate. The ticket is not merged; it leaves the wave as a `blocked` row, like a ticket after a
  second gate `REJECTED`. The Act on group goes into the wave's report and into the ticket's result
  section. Whether to rework it or to merge it anyway is the owner's decision.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "max-review REJECTED, PR #<N>: <Act on>"   # local-green: without the PR
```

- **Without a human** (worfy Autopilot: a question to the owner is declined automatically) — the same,
  without a question and without waiting, plus a line in the state file's list of what waits for the
  owner: "max-review REJECTED — the owner's decision", with a link to the ticket.
- **On the owner's request outside a wave** the verdict is written the same way, with the prefix (as a
  PR comment when there is a PR). Outside a wave the verdict blocks nothing: the owner decides.

After the verdict is written, remove the reviewers' and the sceptics' worktrees
(`git worktree remove <worktree>`).

## 9. The report

The verdict line, then the four groups, then the map of agreement, then: how many findings each
model gave, how many both models gave, how many the sceptics refuted, the time from the start of the
reviewers to the verdict, and the agents that did not answer. Those numbers are the measure of what
the mode costs.

Source: Thermos, `thermos/skills/thermos/SKILL.md`, commit `ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Cursor)
— two reviewers on the same diff of the whole branch, started together, and a synthesis that weighs
findings both of them raised more heavily.
Source: pstack, `pstack/skills/interrogate/SKILL.md`, commit `ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Lauren Tan)
— one reviewer per model with the same prompt, the variety coming from the models and not from
roles, the stated intent, the agreement of two models as the strongest signal, no changes applied by
the review. The rules are reworded, not copied; the lenses, the sceptics, the `MAX-REVIEW:` prefix
and where the verdict is written are this project's own rules.
