# The update of /worfy:human-review-setup — `--refresh`

Plugin root: `<plugin>` below is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/human-review-setup/refresh.md`.

A reviewer built and kept by the first run lies in the private folder (`<_resolved.dir>/state/human-review/`):
`.claude/skills/human-review/SKILL.md` and `voice-examples.md`, `research.md`, `lint.json`, `check/` and
`meta.json`. The team has reviewed more pull requests since. This update reads only those, analyses them together
with the `research.md` of before, writes a new skill as a draft beside the installed one, shows the person which
rules it adds, changes and removes, checks the draft on 5 of the new pull requests, and replaces the installed
files only when the person accepts. Until then everything new lies in `raw/`, and nothing else of the private
folder changes but the record `review-history fetch --since` keeps in `meta.json` itself.

What it costs and who sees what are the same as for the first run (SKILL.md, the opening section): GitHub API
points only until the person says "yes" to the estimate, then the texts of the new comments go to the vendor of
the model. The exit codes of `review-history` and what to do on 1 or 3 are those of SKILL.md too.

## 1. What there is, and the date

Step 1 of SKILL.md has given `_resolved.dir` and the private folder. Then:

- No `<private folder>/.claude/skills/human-review/SKILL.md`: there is no reviewer to update. Say so, offer the
  first run, `/worfy:human-review-setup` without `--refresh`, and stop.
- The date the update reads from is the later of two dates of `meta.json`: `analysed_through`, which the last
  update the person accepted wrote (step 8), and `fetched_at`, the last whole read of the history, which a first
  run or a whole build again analysed. Compare them: a whole build after an update keeps the older
  `analysed_through` in `meta.json`, and reading from it would count the comments between the two dates twice.
  With neither date, or a `meta.json` that does not read, there is no date to read from: say so, offer the first
  run, and stop.

Tell the person the date: "pull requests updated since <date>".

## 2. Read the new pull requests and ask

- **Fetch.** Run `"<plugin>/bin/review-history" fetch --since <date> --passes 2; echo "EXIT=$?"`. It reads, as
  the first run's fetch does, only pull requests updated since `<date>` into `raw/`, and records this slice in
  `meta.json` under `update`, leaving the history's counts as they were.
- **Estimate.** Run `"<plugin>/bin/review-history" estimate --passes 2; echo "EXIT=$?"` and
  `"<plugin>/bin/review-history" stats; echo "EXIT=$?"`: numbers and links of the slice, no text of a comment.
  Do not open, read or search anything in `raw/` yourself before the person's "yes" below.
- **New comments.** The slice holds every pull request updated since `<date>`, and one reviewed before it and
  merged after it is there too, with old comments only: the counts of `estimate` are of whole pull requests. What
  is new is a comment of the team written after `<date>`. Count them with a short Node script over
  `raw/prs.jsonl` that reads only `repo`, `number`, the `role`, the date (`submitted_at` of `reviews[]`,
  `created_at` of `threads[].comments[]` and of `comments[]`) and the length of `body` — the length only: it prints
  no text. It prints the comments of `role` `team` with text dated after `<date>`, those of them at least 20
  characters long, and the pull requests that have one; write them to `raw/refresh/new.json`
  (`{"comments": N, "substantive": S, "prs": ["<repo>#<number>", …]}`).
- **Nothing new.** On `"comments": 0` in `raw/refresh/new.json` tell the person "No new pull request with a review
  of the team since <date>; the reviewer stays as it is", run `"<plugin>/bin/review-history" clean; echo "EXIT=$?"`
  and stop: no model reads anything, no token is spent. `pull requests: 0` in the estimate is the same case.
- **The voice line.** The last line of the estimate, `voice: no (N of 30)` or `voice: yes`, is of the slice alone
  and does not stop an update: the voice was found by the first run. Show it as it is.
- **The question.** Show the person what step 2 of SKILL.md shows before its question: the output of `estimate`
  as it is, with the new comments of `raw/refresh/new.json` beside it — the analysis reads only those, so the token
  estimate is an upper bound — the content of `ignore.json`, and that the texts of the new comments go to the vendor of the model and
  stay on this machine afterwards in the private folder only. Then ask whether to read and analyse them, and wait
  for an explicit "yes". A question back gets its answer, then ask again.
- **No.** On "no", on no answer, or in a session that has no person to answer, run
  `"<plugin>/bin/review-history" clean; echo "EXIT=$?"`, tell the person nothing was read by a model and nothing
  changes, and stop: the skill, `research.md` and `lint.json` stay as they were.

## 3. Hold out 5 new pull requests

After the "yes", before the analysis, hold 5 pull requests of the new slice out of it for the check of step 7, by
the rules and with the script over `raw/prs.jsonl` that step 2 of SKILL.md gives for the first run, but counting
only the new comments of step 2 — those of the team dated after `<date>`: the newest pull requests with a new
comment of the team at least 20 characters long, from different areas, one with a `CHANGES_REQUESTED` review of
the team submitted after `<date>` when the slice has one; with fewer than 15 such pull requests a third of them,
rounded down, and say so. A pull request whose team comments are all from before `<date>` is never held out: the
first run analysed them. The script reads the dates too, still no text. `commit_id` of a held-out pull request is
the commit the first review of the team after `<date>` saw, and step 7 counts only the team's comments after
`<date>` as the team's remarks.

Write them to `raw/refresh/held_out.json`, in the format of `held_out`, not into `meta.json`: a rejected update
leaves the held-out pull requests of the installed skill as they are. In this run, wherever analyse.md, write.md
or check.md read `held_out` of `meta.json`, read `raw/refresh/held_out.json`.

## 4. Analyse the new pull requests together with research.md

Read `<plugin>/skills/human-review-setup/analyse.md` and follow it, with these changes:

- Its section 1, item 1 does not apply: `research.md` stays where it is. Copy it to
  `raw/refresh/research-before.md`.
- The team comments of the slice dated after `<date>` are the input, on the pull requests of `prs` in
  `raw/refresh/new.json`: a review with `submitted_at`, or a comment with `created_at`, before `<date>` was analysed
  by an earlier run, or was held out by it, and is left out — a pull request updated
  since may carry old comments too.
- Section 6 writes `raw/refresh/research.md` instead of `<private folder>/research.md`, starting from a copy of
  `raw/refresh/research-before.md`: every section keeps its number and its title — never renumber a section, the
  rules of the installed skill point at those numbers. A count of a section becomes the old count plus the new one,
  and a share is computed again from the counts; a median or a percentile of a length becomes the mean of the old
  and the new value weighted by their comment counts, marked `(merged)`. A theme or a do-not-touch item that only
  the new comments show gets a new section numbered after the last one. The header line `Window:` names both: the
  window of before and `since <date>`.
- Section 7 checks `raw/refresh/research.md`.

## 5. Write the draft

Read `<plugin>/skills/human-review-setup/write.md` and follow its sections 1 to 5 with `raw/refresh/research.md`
in place of `research.md`: the draft is built in `raw/skill/` and checked there with `review-draft-lint --skill`.
The `forbidden` words of `lint.json` are those of the installed `<private folder>/lint.json`. Its section 6, the
install, does not run now: the files are put in place only on **Accept** of step 8.

## 6. The diff of the rules

A short Node script compares the rules of `<private folder>/.claude/skills/human-review/SKILL.md`, the installed
skill, with those of `raw/skill/SKILL.md`, the draft. A rule is a list item under a `## ` heading, ending with
one `[R<n>]` or several. Pair the rules step by step (the `## ` heading of each), in three rounds, each over the
rules still without a pair: first the same set of `[R<n>]` and the same text; then the same set; then sets that
share at least one `[R<n>]`, the pair sharing the most first — so a rule whose `[R3]` became `[R3] [R12]` is one
changed rule, not a removed one and an added one. Within a round, several candidates go in their order. Then:

- **Added** — a rule of the draft with no pair in the installed skill;
- **Changed** — a pair whose text differs;
- **Removed** — a rule of the installed skill with no pair in the draft.

Each line names the step, the rule as written, its `[R<n>]` (for a changed rule both sets, before → now), and for
each number of the rule "before → now": the number in the installed rule and in the draft for a changed rule; for an added or a removed rule, the numbers of
its sections in `raw/refresh/research-before.md` and in `raw/refresh/research.md`. Add the count of the rules that
stay as they were, and the sections of `research.md` that are new. Write the result to `raw/refresh/diff.md` and
run `"<plugin>/bin/evidence-check" "<private folder>/raw/refresh/diff.md"; echo "EXIT=$?"`: no home folder path,
host name, email or token; and the Node script of write.md, section 5, finds none of the logins of
`raw/reviewers.json` in it. A finding — fix and check again.

## 7. Check the draft on the held-out pull requests

Read `<plugin>/skills/human-review-setup/check.md` and follow it, with these changes:

- the pull requests are those of `raw/refresh/held_out.json`;
- the skill each Subagent gets is the draft, `raw/skill/SKILL.md` and `raw/skill/voice-examples.md`, never the
  installed one, and its `lint.json` is `raw/skill/lint.json`;
- the pages go to `raw/refresh/check/<PR>.md` instead of `check/<PR>.md`, and the record of its section 6 goes to
  `raw/refresh/check.json` instead of the key `check` of `meta.json`.

With none held out, say the draft could not be checked on pull requests it has not seen, and go on.

## 8. The person decides

Show the person the diff of `raw/refresh/diff.md` — the **Added**, **Changed** and **Removed** rules with their
`[R<n>]` and their numbers before → now — and the check of step 7: the line of each pull request, the total with
the words "a rough measure", and the paths of the pages in `raw/refresh/check/`. Then ask: accept the update, or
reject it.

- **Accept** — first move the installed files aside, into `<private folder>/previous/` (create it with
  `mkdir -p`), with the suffix `<stamp>` of this run, `YYYY-MM-DDTHH-MM-SS`: `.claude/skills/human-review/SKILL.md`
  to `previous/SKILL-<stamp>.md`, `voice-examples.md` to `previous/voice-examples-<stamp>.md`, `research.md` to
  `previous/research-<stamp>.md`, `lint.json` to `previous/lint-<stamp>.json`, and the folder `check/`, when there is
  one, to `previous/check-<stamp>/`, so its pages of the skill before do not mix with the new ones. Then copy `raw/skill/SKILL.md` and
  `raw/skill/voice-examples.md` into `.claude/skills/human-review/`, `raw/refresh/research.md` to `research.md`,
  `raw/skill/lint.json` to `lint.json`, and the pages of `raw/refresh/check/` into `check/`. Record in `meta.json`,
  changing only these keys: `held_out` — the content of `raw/refresh/held_out.json`; `check` — the content of
  `raw/refresh/check.json`; `analysed_through` — `update.fetched_at` of `meta.json`, the time of this run's fetch,
  where the next update starts; `analysed_pull_requests` — the pull requests the reviewer now stands on: the
  value of before when `analysed_through` was later than `fetched_at`, else `counts.pull_requests`, plus the count
  of `prs` in `raw/refresh/new.json`, which worfy shows beside the date; `kept_at` — the date now (ISO), which
  dates the reviewer in worfy; `decision` —
  `{"choice": "accept update", "at": "<ISO date>"}`. Then run `"<plugin>/bin/review-history" clean; echo "EXIT=$?"`
  and tell the person that `/human-review` changes in new Claude Code sessions of this project.
- **Reject** — run `"<plugin>/bin/review-history" clean; echo "EXIT=$?"`, which deletes `raw/` with the draft, the
  diff and the check. `SKILL.md`, `voice-examples.md`, `research.md`, `lint.json`, `check/` and the keys of
  `meta.json` above stay as they were; the next update reads from the same date again. Say so.

Without an answer, do what **Reject** does: the colleagues' raw words never outlive the run.
