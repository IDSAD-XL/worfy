# Step 4 of /worfy:human-review-setup — analyse the comments into research.md

Plugin root: `<plugin>` below is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/human-review-setup/analyse.md`.

The input is what `review-history fetch` wrote into the private folder (`<_resolved.dir>/state/human-review/`):
`raw/prs.jsonl`, one pull request per line, and `meta.json` with the `held_out` pull requests of step 2. The
output is `<private folder>/research.md`: sections `## R<n> — <title>`, each with numbers, shares and links to
comments. The skill that step 5 writes takes every rule from one of these sections and ends the rule with
`[R<n>]`, and `review-draft-lint --skill` checks that each such section exists — so the heading format below is
exact.

A line of `raw/prs.jsonl` has `repo`, `number`, `url`, `title`, `additions`, `deletions`, `files` (paths),
`reviews[]` (`state`, `body`, `commit_id`, `author`, `role`), `threads[]` (`path`, `line`, `is_resolved`,
`is_outdated`, `comments[]` with `body`, `url`, `diff_hunk`, `in_reply_to`, `author`, `role`) and `comments[]`
(the conversation, `body`, `url`, `author`, `role`). `role` is `team` (the voice) or `context` (an author outside
the team: read it to understand a thread, never count it as the team's voice). Bots, ignored logins and an
author's comments on their own pull request are already gone.

## 1. Prepare (this session)

1. Move an existing `research.md` to `<private folder>/previous/research-<YYYY-MM-DD>.md` first.
2. Save the mechanical numbers: `"<plugin>/bin/review-history" stats > "<private folder>/raw/stats.json"; echo "EXIT=$?"`.
   They are the lengths of substantive comments by percentile, the shares of review states, approvals without
   comments by size and by area, remarks repeated in different pull requests (`repeated_remarks`), threads
   outdated or resolved after a comment, and the reviewers' shares as labels. `stats` has no filter: its numbers
   include the `held_out` pull requests, while the numbers of the analysis (section 5) do not. research.md says so.
3. Labels instead of logins: write `raw/reviewers.json`, a map from each team login (lower case) to
   `reviewer A`, `reviewer B`, … by the count `stats` uses — every review body with text, line comment and
   conversation comment of `role` `team`, substantive or not — most comments first, a tie by login in
   alphabetical order. So the labels match `reviewers.shares` of the stats, except that reviewers with equal
   counts may swap labels, and their shares are equal anyway. Every output of this step names reviewers by these
   labels; no login leaves `raw/`.
4. Batches by area of code: the area of a pull request is its repository (when the window has several) and the
   top-level folder that holds most of its `files` (`.` for files at the root). An area with fewer than 3 pull
   requests joins one area `other`. One batch per area; an area with more than about 150 team comments splits by
   date into batches of that size. Leave out every pull request of `held_out` in `meta.json`. Write the plan to
   `raw/batches.json`: batch name, area, pull requests (`<repo>#<number>`).

All of these files lie in `raw/`, so `review-history clean` deletes them with the colleagues' words.

## 2. The Subagents

One Subagent per batch, several at a time, all in the foreground; wait for every answer. Each brief carries:

- the path of `raw/prs.jsonl` and of `raw/reviewers.json`, and the pull requests of the batch — read only these,
  never one of `held_out`;
- the tiers and the signals of sections 3 and 4 below, pasted in full (the Subagent has no other copy);
- the output file `raw/analysis/<batch>.jsonl` and its format below;
- the rules: classify every comment of `role` `team` with text — review bodies, line comments, conversation
  comments; a review with an empty body is no comment (stats counts silent approvals); `context` comments
  only explain a thread; no login in the output, reviewers by their label only.

One line per team comment:

```json
{"url": "…", "repo": "o/r", "number": 12, "area": "src/", "kind": "line", "reviewer": "reviewer B",
 "chars": 64, "tier": "nit", "theme": "naming", "insisted": ["is_resolved"], "withdrawn": false,
 "split_request": false, "phrase": "up to 12 words of the comment, as written"}
```

`chars` — the length of the comment's own text without quoted lines (`>`). `theme` — a short noun phrase of
what the remark is about (error handling, naming, tests, migration safety, a public API change…), the same
wording for the same theme across the batch. `withdrawn` — the reviewer took the remark back, or accepted the
author's pushback. `split_request` — the comment asks to split the pull request.

The answer to this session, under 300 words: the themes of the batch with their counts, the remarks the team
withdrew or that authors pushed back on successfully, kinds of change the team approves without a word, and
typical openings of each tier, as short quotes with their links.

## 3. The seven tiers

Every team comment gets exactly one:

- **let go** — the reviewer noticed something and says it can stay: "fine for now", "not worth changing".
- **nit** — a small matter of style, naming or wording; the author may ignore it; often starts with `nit`.
- **question** — asks to understand the change; no change is asked for.
- **heads-up** — tells a fact, a risk or a context the author may not know; no change in this pull request.
- **followup** — asks for a change later: a separate pull request, a ticket, a TODO.
- **argued** — asks for a change in this pull request and gives the reason, without blocking the merge.
- **blocker** — must change before the merge: a `CHANGES_REQUESTED` review, or words such as "must", "blocking".

## 4. The signals that a reviewer insisted

Record each one that holds in `insisted`; together they tell a remark the team really holds to from one it
lets slide:

- `CHANGES_REQUESTED` — the same reviewer submitted a review in this state on this pull request;
- `is_resolved` — the thread of the comment was resolved;
- `is_outdated` — a later commit changed the lines the comment is on: the code changed after the comment;
- `repeated_remarks` — the remark appears in other pull requests too (the stats' `repeated_remarks`, or the same
  theme by the team in two or more pull requests).

A signal does not set the tier by itself: a resolved nit stays a nit.

## 5. Join the results

A short Node script over `raw/analysis/*.jsonl` and `raw/stats.json` gives the numbers of research.md: comments
by tier; the median and the 90th percentile of `chars` by tier; themes by area with their counts and their share
of the area's comments; the share of each reviewer label in each tier; the comments with `withdrawn` and with
`split_request` and the sizes (`additions` + `deletions`) of the pull requests they are on; the small pull
requests (up to 50 changed lines) with a `CHANGES_REQUESTED` review or a blocker comment, by path and kind.

## 6. Write research.md

The skeleton, in this order. Sections 1–4 are required once each; the theme and do-not-touch sections repeat
for each theme and each item; a voice section for each tier with comments. Number the sections from R1 in the
order written, with no gap.

```markdown
# Research — review history of <project>

Window: <from> to <to>, <N> pull requests, <M> substantive comments of the team, <K> reviewers.
Held out for the check: <repo>#<number>, … (not analysed; the numbers marked `stats.` include them).
Reviewers: reviewer A <share>, reviewer B <share>, …

## R1 — Triage: approved without comments

## R2 — Triage: small is not safe

## R3 — Triage: requests to split a pull request

## R4 — Review states

## R5 — Theme: <area>: <theme>

## R6 — Do not touch: <what the team objects to or ignores>

## R7 — Voice: let go

## R8 — Voice: nit

## R9 — Voice: question

## R10 — Voice: heads-up

## R11 — Voice: followup

## R12 — Voice: argued

## R13 — Voice: blocker
```

What each section holds:

- **Triage: approved without comments** — the share of pull requests approved without a comment, by size and by
  area (`approved_without_comments` of the stats), and the kinds of change behind them (bumps, backports,
  generated files, text edits) with links.
- **Triage: small is not safe** — the exceptions: small pull requests that still got `CHANGES_REQUESTED` or a
  blocker comment, by path and kind.
- **Triage: requests to split a pull request** — how often the team asked to split, at what sizes; none in the
  window — say so: the written skill then uses its template's default.
- **Review states** — the shares of `APPROVED`, `COMMENTED`, `CHANGES_REQUESTED` (`review_states` of the stats),
  and what the comments look like under each: when the team approves with nits, comments only, requests changes.
- **Theme** — one per theme an area really catches: the count, its share of the area's comments, the share that
  insisted, links.
- **Do not touch** — what the team objects to when a reviewer raises it, or never comments on: withdrawn remarks,
  pushback that won, themes with silent approvals only.
- **Voice** — per tier: the median and the 90th percentile of the length, typical openings and phrases, the
  register (softeners, hedges, questions instead of orders), leanings by area, the share of each reviewer label.

Rules for every section:

- The heading is `## R<n> — <title>`: two hashes, `R` and the number, a space, an em dash, a space, the title.
- A line `Numbers:` with each number and its source — `stats.<key>` or `analysis` — and a line `Comments:` with
  up to 5 links to comments. A required section with no evidence says "No evidence in the window" and the numbers
  that show it.
- No login anywhere: reviewers are `reviewer A`, `reviewer B`, … of `raw/reviewers.json`, as shares.
- Quotes stay in the language of the history; the rest is in English.
- Within a voice section, one reviewer gives at most a third of the quoted examples when three or more people
  have comments of that tier.

## 7. Check before step 5

- Every `## R` line of research.md matches `## R<n> — <title>`, numbered from 1 with no gap.
- A short Node script finds none of the logins of `raw/reviewers.json` in research.md (case-insensitive).
- `"<plugin>/bin/evidence-check" "<private folder>/research.md"; echo "EXIT=$?"` — exit 0: no home
  folder path, host name, email or token.

Fix and check again until all three hold. Then tell the person how many comments were analysed, by tier, and
go on to step 5 of SKILL.md.
