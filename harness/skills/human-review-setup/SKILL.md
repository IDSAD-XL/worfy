---
name: human-review-setup
description: Build a private review skill that writes pull request reviews in the voice of the project's team — read the team's review history on GitHub, show how much a model would read and its token estimate, and only once the person agrees sort every comment by tier and theme into an evidence file and write the skill from it. Use when the person asks for it ("/worfy:human-review-setup", "build a reviewer in our team's style") or worfy's "Build" button sends it.
disable-model-invocation: true
---

# Build a reviewer in the team's voice

A team that has reviewed pull requests on GitHub for a long time has its own way of reviewing: what it
lets through without a word, what it always asks about, how long a nit is, when it requests changes. This
skill reads that history and writes, for this project on this machine only, a private review skill that
reviews in the same way. Every rule of that skill points at a section of an evidence file, `research.md`,
with the numbers and the links to the comments behind the rule.

The voice is the whole team's: all its human reviewers together, never one person copied. Leanings by area
of code or by repository are fine where the history shows them.

What it costs and who sees what:

- Reading GitHub costs API points only (about 160 of the 5 000 an hour for 500 pull requests); no model
  reads anything until the person says "yes" to the estimate of step 2.
- After the "yes" the texts of the colleagues' comments go to the vendor of the model, as any code of this
  session does.
- The colleagues' words stay on this machine, in the profile folder of the project, outside any git history:
  never in the project's repository, never in the repository of the plugin. The raw answers of GitHub live
  for one run and are deleted at its end.

This skill works in Claude Code sessions. In a Codex session the private folder is not attached, so the
skill it writes would not load there: say so and stop.

`review-history` (`"${CLAUDE_PLUGIN_ROOT}/bin/review-history"`, run in the project root) has these exit codes: 0 —
done, 1 — failed (the rate limit after three retries, a `gh` error), 2 — usage, 3 — not available (no
registered project, no `origin` on GitHub, no `gh`, no access to the repository). On 1 or 3 show its one
stderr line, run `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" clean; echo "EXIT=$?"` — a `raw/` an earlier
command of this run wrote is already on disk — and stop.

## 1. The profile and the private folder

Run `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --json; echo "EXIT=$?"` in the project root and take
`_resolved.dir`, the profile folder of the project. Exit 3 (no profile): the project is not connected —
suggest `/worfy:connect-project` and stop.

The private folder is `<_resolved.dir>/state/human-review/`. `review-history` creates it and writes there:

- `meta.json` — the window, the counts, the voice verdict, the dates of the runs;
- `ignore.json` — logins of bots and service accounts and the openings of texts agents post under a
  person's account; the person edits it;
- `raw/` — the answers of GitHub of this run.

This skill adds `research.md` (step 4), `lint.json` and the review skill itself in
`.claude/skills/human-review/` (step 5), and `check/`, the drafts of the check beside the team's comments
(step 6). Logins of colleagues appear in `ignore.json` and in `raw/` only.

## 2. Read the history and ask

The parts below run in this order; "step <n>" in this file always means a `## <n>.` heading.

- **Fetch.** Run `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" fetch --passes 2; echo "EXIT=$?"`. It reads the
  window — pull requests updated in the last 12 months that have a review of the team, at most 500 per
  repository — into `raw/`, drops bots, the logins and prefixes of `ignore.json` and an author's comments on
  their own pull request. `--passes 2`: the analysis Subagents read every comment once, and joining their
  results into `research.md` reads them a second time in short form.
- **Estimate.** Run `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" estimate --passes 2; echo "EXIT=$?"` and
  `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" stats; echo "EXIT=$?"`. Both are the script reading `raw/`:
  numbers and links, no text of a comment reaches this session. Do not open, read or search anything in
  `raw/` yourself before the person's "yes" below — not even to check the counts.
- **One reviewer.** `reviewers.top_share` of the stats is the share of the team's comments — every review
  body with text, line comment and conversation comment of the team, substantive or not — written by the
  reviewer with the most. If it is 0.8 or more, say it plainly: "80% or more of the team's comments come
  from one reviewer, so the voice will mostly be that person's." The voice is still built from everyone's
  numbers, and step 4 keeps one reviewer to at most a third of the examples of a tier.
- **The verdict** is the last line of the estimate. On `voice: no (N of 30)` go to step 3 (Too little
  history) below and ask nothing: no model will read anything.
- **The question**, on `voice: yes`. Show the person, in this order:
  - the output of `estimate` as it is: pull requests, reviews by state, comments by kind, substantive
    comments, reviewers, characters and the token estimate (the word "estimate" stays);
  - the content of `ignore.json` (`<private folder>/ignore.json`): the person may add logins of service
    accounts or prefixes of agent reports there; after an edit run the fetch and the estimate again;
  - that the texts of the colleagues' comments will go to the vendor of the model, as any code of this
    session does, and stay on this machine afterwards in the private folder only.

  Then ask whether to read and analyse them, and wait for an explicit "yes". A question back ("what is
  ignore.json?") gets its answer, then ask again; do not read on silence, on a question or on a "maybe".
- **No.** On "no", on no answer, or in a session that has no person to answer, run
  `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" clean; echo "EXIT=$?"`, which deletes `raw/`, tell the person
  nothing was read by a model, and stop.

After the "yes", before the analysis, hold 5 pull requests out of it for the check of step 6, so the check
does not grade the skill on answers it has already seen:

- the newest pull requests of the window with a comment of the team at least 20 characters long (the
  length `review-history` takes for a substantive comment), from different areas of code (top-level
  folders, or repositories when there are several), and at least one with a `CHANGES_REQUESTED` review of
  the team when the window has one;
- with fewer than 15 such pull requests, hold out a third of them, rounded down, and say so;
- pick them with a short Node script over `raw/prs.jsonl` that reads only `repo`, `number`, `updated_at`,
  `files`, `reviews[].state`, `reviews[].role`, `reviews[].commit_id`, and the `role` and the length of
  `body` of `reviews[]`, `threads[].comments[]` and `comments[]` — the length only: it prints no text;
- record them in `meta.json` under the key `held_out`: `[{"repo": "<owner>/<name>", "number": <n>,
  "commit_id": "<sha>"}]`, where `commit_id` is the commit the first review of the team saw. Change only
  this key; `review-history` keeps the keys of other writers.

## 3. Too little history

The verdict `voice: no (N of 30)`: fewer than 30 substantive comments of the team's people in the window.

1. Tell the person, with the numbers of the estimate: "The team's voice cannot be built: N substantive
   comments of people over M pull requests, 30 are needed." Use the words N of 30 as they are.
2. Offer `/worfy:code-review` instead: a review against the repository's documented standards, without a
   team voice.
3. Run `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" clean; echo "EXIT=$?"`. The private folder keeps only
   `meta.json` with the counts, which `fetch` already wrote — no text of a comment. Write nothing else there.
4. Stop.

## 4. Analyse the comments into research.md

Read `${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/analyse.md` at this step and follow it: Subagents read
`raw/prs.jsonl` in batches by area of code, skip the pull requests of `held_out`, sort every comment of the
team by tier and theme, and the results with the numbers of `review-history stats` become
`<private folder>/research.md`.

## 5. Write the skill

Read `${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/write.md` at this step and follow it: fill the template
`${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/template/` from `research.md`, every rule ending with `[R<n>]`,
check it with `review-draft-lint --skill` until it is clean, then write `SKILL.md` and `voice-examples.md` into
`<private folder>/.claude/skills/human-review/` and `lint.json` next to `research.md`. A skill written before
moves to `previous/` first.

## 6. Check it on the held-out pull requests

Read `${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/check.md` at this step and follow it: one Subagent per
pull request of `held_out` gets the new skill as its brief and drafts a review at the commit the first review of
the team saw, posting nothing; the draft's remarks are paired with the team's by file and lines, a judge Subagent
confirms each pair, and each pull request gets a page `<private folder>/check/<PR>.md` and the line "matched K of
N remarks of the team, M extra", recorded in `meta.json`.

## 7. The person decides

Show the person what the run produced: the rules of the written skill by step, each with its `[R<n>]`, the
section headings of `research.md`, and the check of step 6 — the line of each pull request, the total with the
words "a rough measure", and the paths of the pages in `<private folder>/check/`, which put the draft beside what
the team really said. A check that could not run says so. Then ask: keep, build again, or refuse.

- **Keep** — run `"${CLAUDE_PLUGIN_ROOT}/bin/review-history" clean; echo "EXIT=$?"` to delete `raw/`, and
  record the date in `meta.json` under the key `kept_at` (ISO date; change only this key).
- **Build again** — take the person's remarks on the rules and on the pages of the check, and run steps 5 and 6
  again with them: in step 5 the remarks are one more input — a rule the person rejects is dropped, a change they
  ask for is made, as long as every rule still ends with `[R<n>]` of a section of `research.md` that supports
  it. The check of step 6 then runs on the same pull requests, which the person has already read: show its result
  marked "after the person saw these PRs", as `check.md` writes it. Then this step again.
- **Refuse** — delete the private folder and nothing else, with one command and its literal path:
  `rm -rf "<_resolved.dir>/state/human-review"`, with `<_resolved.dir>` written out in full as step 1 printed it,
  not a shell variable, and nothing after the path. Say what was deleted.

Record the choice in `meta.json` under the key `decision`: `{"choice": "keep" | "build again", "at": "<ISO
date>"}` (change only this key); after **Refuse** there is no `meta.json` left to record it in.

Without an answer, do what **Keep** does for `raw/` (run `clean`) and leave the rest as it is: the
colleagues' raw words never outlive the run.
