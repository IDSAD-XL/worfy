# Step 6 of /worfy:human-review-setup — check the skill on the held-out pull requests

Plugin root: `<plugin>` below is the plugin folder, the one that holds `bin/` and `skills/`: the path you read this file from, without `/skills/human-review-setup/check.md`.

The skill step 5 wrote reviews pull requests it has never seen. This step lets it review the pull requests of
`held_out` in `meta.json` — the ones step 2 kept out of the analysis — at `commit_id`, the commit
the first review of the team saw, and puts each draft next to what the team really said on that commit. The
number of remarks the draft shares with the team is a rough measure: a draft can be good with few matches, and a
match can be luck. The pages it writes are for the person to read before step 7.

The input is in the private folder (`<_resolved.dir>/state/human-review/`): `meta.json` with `held_out`
(`[{"repo": "<owner>/<name>", "number": <n>, "commit_id": "<sha>"}]`), `raw/prs.jsonl` with the comments of those
pull requests, `raw/reviewers.json`, `lint.json`, and the new skill in `.claude/skills/human-review/`. The output:

```text
<private folder>/
  check/<PR>.md        one page per pull request: the team's comments beside the draft
  meta.json            the key `check`: the counts of each pull request and the total
  raw/check/           the drafts and the judge's answers of this run; `review-history clean` deletes them
```

`<PR>` is the repository name without the owner, a dash and the number: `web-412`. A page of an earlier run of
the same pull request is replaced.

With no `held_out` in `meta.json`, or an empty list (the window had fewer than 3 pull requests to hold out), there
is nothing to check: tell the person the skill could not be checked on pull requests it has not seen, and go on to
step 7 of SKILL.md.

## 1. Prepare each pull request

Run everything in the checkout of the pull request's repository: the project root, or, in a project of several
repositories, the folder of that repository. A repository with no checkout on this machine: skip its pull requests
and say so. For each pull request of `held_out`:

```bash
gh pr view <n> --repo <owner>/<name> --json number,url,title,body,baseRefName,mergeCommit,closingIssuesReferences; echo "EXIT=$?"
git fetch origin "pull/<n>/head" "+refs/heads/<baseRefName>:refs/remotes/origin/<baseRefName>"; echo "EXIT=$?"
git cat-file -e "<commit_id>^{commit}"; echo "EXIT=$?"
```

The base branch is fetched with a refspec of its own: a clone made by `git clone --depth 1` tracks one branch only,
and a bare `<baseRefName>` would leave `origin/<baseRefName>` missing. When the commit is still missing (the branch was force-pushed after the review), `git fetch origin "<commit_id>"`
once more; still missing, skip this pull request and say so. A merged pull request has `mergeCommit`
(`mergeCommit.oid`, below `<mergeCommit>`); check it is here the same way and fetch it by its sha when it is not.

**The base** is the commit the pull request branched from, as it stood when the reviewer saw `commit_id`. One rule
for every pull request:

- merged — by a merge commit, a squash or a rebase: `git merge-base "<mergeCommit>^1" "<commit_id>"`. The first
  parent of `<mergeCommit>` does not hold `commit_id`: after a merge commit it is the base branch just before the
  merge, and a squash or a rebase writes new commits instead of the pull request's own;
- not merged (open, or closed without a merge): `git merge-base "origin/<baseRefName>" "<commit_id>"`.

Step 2 of SKILL.md made a shallow clone whole before the analysis. A `git merge-base` that still exits non-zero —
1, no common history, or 128, a commit or a branch missing: this pull request goes into `skipped` of section 6 with
the reason "no common history" or the last line of git, and the person hears it.

Never the merge base of `origin/<baseRefName>` and `commit_id` for a merged pull request: after a merge by a merge
commit, `commit_id` is itself an ancestor of `origin/<baseRefName>`, the merge base is `commit_id`, and the diff is
empty. Call the result `<base>`. Then check that the diff is not empty:

```bash
git merge-base --is-ancestor "<commit_id>" "<base>"; echo "EXIT=$?"
git diff --quiet "<base>" "<commit_id>"; echo "EXIT=$?"
```

The first exit 0 (`commit_id` lies in its own base), or the second exit 0 (no change between them): this pull
request stops here. No draft, no judge, no page: it goes into `skipped` of section 6 with the reason "empty diff",
and the person hears it. An empty draft is never graded. Otherwise the code the reviewer saw is:

- the diff: `git diff "<base>" "<commit_id>"`, and its size with `--shortstat`;
- a file: `git show "<commit_id>:<path>"`.

That is no checkout and no worktree: the person's working tree stays as it is. The diff is not `gh pr diff`: that
is the pull request today, after the changes the team asked for.

## 2. One draft per pull request

One Subagent per pull request, several at a time, all in the foreground; wait for every answer. The session that
runs this step started before the skill existed, so `/human-review` is not loaded in it, and a Subagent would not
load it either: the brief carries the skill instead. Each brief has:

- the text of `<private folder>/.claude/skills/human-review/SKILL.md` and of
  `<private folder>/.claude/skills/human-review/voice-examples.md`, pasted in full, and the path of the private
  folder, which that skill otherwise finds three levels up from its own file;
- what step 1 gave: the repository, the number, the title, the body, the linked task, `<base>`, `commit_id`, and
  the commands of the item "only reading" below with both shas written out;
- the output file `<private folder>/raw/check/<PR>-draft.json`;
- the changes to the skill below, and these rules: the Subagent never reads `raw/` (it holds what the team said
  on this pull request) and never reads `check/`; it writes only its output file.
- only reading: the Subagent runs nothing but `git diff "<base>" "<commit_id>"` (with `--stat` or `--shortstat` too),
  `git show "<commit_id>:<path>"`, `git grep -n <pattern> "<commit_id>"` (with `-- <path>` too), and
  `review-draft-lint` of step 7; besides those it only reads files — the files of the repository's standards
  (`CLAUDE.md`, `AGENTS.md`) and the brief. It never runs the code of the repository: no build, no test, no package
  manager (`npm`, `go`, `cargo`, `pip`, `make`…), no script of the repository, no checkout and no worktree. A
  draft is a reading of the change; what only a run would show becomes a question, as step 4 of the skill says of a
  candidate it could not check.
- no history after `commit_id`: the later commits of the pull request — the ones that address the review — hold
  the answer. Its git commands are those of "only reading", with `<base>` and `commit_id` as given: no `git log`
  (not `git log <commit_id>..` either), no `FETCH_HEAD`, no `pull/<n>/head`, no `origin/<baseRefName>` and no other
  commit.

The Subagent follows the skill with these changes:

- step 1: instead of loading the pull request it uses the brief; `commit_id`, not `headRefOid`: `commit_id` stands
  wherever the skill says `headRefOid`, and `<base>` wherever it says `baseRefOid`; no `gh` command at all — the brief
  has what step 1 read, and `gh pr view` with `reviews`, `comments` or `latestReviews`, or `gh pr diff`, would show
  the answers;
- step 3: instead of `/worfy:code-review`, which needs a worktree, it reads the diff and the files at `commit_id`
  against the checklist of that step and the repository's own standards (`CLAUDE.md`, `AGENTS.md`);
- step 7: the draft goes to the output file, with `payload.commit_id` set to `commit_id`, and passes
  `review-draft-lint` with `<private folder>/lint.json`, as the skill says;
- step 8: it stops at the draft, as in a session with no person. It posts nothing: no `gh api` call at all, and no
  `gh` command that writes.

Its answer to this session, under 100 words: the state of the draft, the number of comments by tier, and the
exit code of `review-draft-lint`.

## 3. Pair the comments

The remarks of the team on `commit_id`, the code the draft saw: every comment of `role` `team` in `raw/prs.jsonl`
with at least 20 characters of its own text (quoted lines `>` left out), of these kinds:

- the body of a review whose `commit_id` is the held-out `commit_id`;
- the first comment of a thread (a reply, with `in_reply_to`, belongs to its thread) whose own `commit_id`, the
  commit it was written on, is the held-out `commit_id`. Its place is its `path` and its `original_line`: the line
  in the file at that commit, the same file the draft places its lines in. Never the thread's `line`, which is a
  line of the pull request's head today, and empty for an outdated thread. A first comment with no
  `original_line` (a comment on a whole file) is a general one;
- a conversation comment written no later than the last review of the team on `commit_id` (`created_at` against
  `submitted_at`).

N is their count. Review bodies and conversation comments are general comments, with no line. The comments of the
team on later commits — a review or a thread on another `commit_id`, a conversation comment after the last review
on `commit_id` — are about code the draft never saw: they are not remarks, are not in N, and the page lists them
apart (section 5). The draft's remarks: each item of `payload.comments` at its `path` and `line`, and
`payload.body` when it is not empty, a general one.

A short Node script over `raw/prs.jsonl` and the drafts writes `raw/check/<PR>-pairs.json`: the remarks of both
sides with their text, tier (the draft's own), length and place, and the candidate pairs:

- two line comments are a candidate pair when they are on the same file and their lines — the team's
  `original_line`, the draft's `line` — are at most 10 lines apart (±10); two line comments on different files or
  further apart are never a match;
- a pair where either comment is general, with no line, is always a candidate: only the judge compares those.

## 4. The judge

One judge Subagent per pull request, in the foreground. Its brief: the path of `raw/check/<PR>-pairs.json`, the
seven tiers of `<plugin>/skills/human-review-setup/analyse.md` section 3 pasted in full, the output file
`raw/check/<PR>-verdicts.json`, and the rule that no login goes into the output. It answers two things, for the
candidate pairs and the remarks of the team:

- for each candidate pair: are the two comments about the same problem — the same defect, risk or request, not the
  same words or the same place;
- for each remark of the team: its tier, by those seven tiers (the analysis never saw these pull requests), or
  `approval` for a plain approval of that section.

```json
{"pairs": [{"team": 0, "draft": 2, "same": true}], "team_tiers": ["nit", "question"]}
```

A remark of the team the judge marks `approval` is not a remark: it leaves N and every pair. Then a short Node
script matches one to one: each remark of the team keeps at most one draft remark and each
draft remark at most one of the team, a line pair before a general one and the nearer lines first. K is the
remarks of the team with a match; M is the draft remarks with none. Every pull request checked gets its line, and
all of them together the total:

```text
<repo>#<number>: matched K of N remarks of the team, M extra
Total: matched K of N remarks of the team, M extra — a rough measure
```

The counts are given per pull request and in total; the words "a rough measure" stay with the total wherever it
is shown.

A check run after **Build again** of step 7 runs on the same pull requests, which the person has read by then, and
whose remarks may have shaped the new rules: every line and the total of that run end with "(after the person saw
these PRs)".

## 5. The page of each pull request

Write `<private folder>/check/<PR>.md`: its line of section 4 at the top, then one table, the team's comments on
the left and the draft on the right:

```markdown
# <owner>/<repo>#<number> at <commit_id, 7 characters>

matched K of N remarks of the team, M extra — a rough measure

| The team | The draft |
| --- | --- |
| nit, 64 chars, [link](<url>), `src/a.ts:12`<br>> the comment's own text | nit, 58 chars, `src/a.ts:14`<br>> the draft's text |
| question, 120 chars, [link](<url>), general<br>> … | (none) |
| (none) | argued, 210 chars, `src/b.ts:40`<br>> … |
```

A matched pair shares a row; a remark with no match has `(none)` on the other side. Each cell: the tier, the
length, the link (the team's side) and the place, then the text as a quote, its line breaks as `<br>` and a `|`
as `\|`. Under the table, the state of the draft and of the team's first review, then a section
`## Later rounds`: the comments of the team on later commits (section 3), each with its length, link, place and
the first 7 characters of its commit — not paired and not counted. No login anywhere: a reviewer, if named at all,
is a label of `raw/reviewers.json`, and a mention in a quote becomes `@someone`. Then check each page:

```bash
"<plugin>/bin/evidence-check" "<private folder>/check/<PR>.md"; echo "EXIT=$?"
```

and a short Node script finds none of the logins of `raw/reviewers.json` (case-insensitive) in the pages. A
finding — fix the page and check again.

## 6. Record

Write the result into `meta.json` under the key `check`: `{"at": "<ISO date>", "prs": [{"repo": "<owner>/<name>",
"number": <n>, "commit_id": "<sha>", "base": "<sha>", "matched": K, "team": N, "extra": M, "later": L}],
"total": {"matched": K, "team": N, "extra": M}, "seen": false,
"skipped": [{"repo": "<owner>/<name>", "number": <n>, "reason": "…"}]}`. `base` is `<base>` of section 1;
`later` is the count of the comments on later commits; `seen` is `true` for a run after **Build again**. Change
only this key; `review-history` keeps the keys of other writers.

Then go on to step 7 of SKILL.md.
