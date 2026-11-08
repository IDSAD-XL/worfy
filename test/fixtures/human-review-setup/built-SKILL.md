---
name: human-review
description: Draft a review of a pull request in this team's voice; nothing is posted without the user's yes. Use when the person asks to review a pull request of this project ("review PR 123", "draft a review of this pull request").
---

# Review a pull request the way this team does

This skill drafts a review of one pull request the way this project's team reviews: what it lets through
without a word, what it always checks, how long and how warm each kind of comment is, and when it requests
changes. The voice is the whole team's, never one person's. Every rule below ends with a reference `[R<n>]` to
a section of `research.md`, the evidence file in the private folder of this project: the numbers and the links
to the comments behind the rule.

The private folder is three levels up from the folder of this file, which lies in
`<private folder>/.claude/skills/human-review/`. It holds `lint.json`, the limits the draft is checked against.
`voice-examples.md` lies next to this file.

Nothing reaches GitHub without the person's explicit "yes" to the draft in this conversation. In a session with
no person to answer, the skill stops at the draft.

## 1. Load the pull request

The person names a pull request: a number, a link, or the pull request of the current branch. Read it in the
project root:

```bash
gh pr view <n> --json number,url,title,body,baseRefName,baseRefOid,headRefOid,additions,deletions,changedFiles,files,closingIssuesReferences; echo "EXIT=$?"
gh pr diff <n>; echo "EXIT=$?"
```

Keep the head commit (`headRefOid`), the base (`baseRefOid`), the size (`additions` + `deletions`) and the
paths. The linked task is an issue of `closingIssuesReferences` or one the body links; a pull request without
one is fine. When `gh` does not exit 0, show its one line and stop.

To read files at the head commit without touching the person's working tree, open a detached worktree of the
head commit in a new temporary folder (`mktemp -d`, below `<tmp>`):

```bash
git fetch origin "pull/<n>/head" "<baseRefName>"; echo "EXIT=$?"
git worktree add --detach "<tmp>/pr-<n>" "<headRefOid>"; echo "EXIT=$?"
```

Remove it when the review is over, posted or not: `git worktree remove "<tmp>/pr-<n>"`.

## 2. Triage

Decide first whether the pull request needs comments at all, and whether to ask for a split. Small is not safe:
the exceptions below come from small pull requests this team still stopped.

- Approve docs-only pull requests without a comment: a README typo fix and a docs-linter version bump both went
  through with an empty review body — 2 of 3 docs/ pull requests in the window (66.7%). src/ and migrations/
  pull requests were never approved silently (0 of 6, 0 of 3). [R1]

- Small is not safe: a 6-line src/ change still drew a CHANGES_REQUESTED review over a duplicated currency
  list, and two different 2-line migration changes each drew a CHANGES_REQUESTED review over migration safety
  — don't skip review on a pull request just because it's small. [R2]

- No request to split a pull request appeared in the window; ask to split a pull request over 800 changed
  lines, or one that mixes changes of unrelated kinds (the template's default). [R3]

A pull request these rules let through without a comment goes to step 6 with no candidates.

## 3. Checklist by area

What this team really catches, by area of code or by repository, with its share of the area's comments:

- src/: a well-isolated utility function with clear tests typically earns a short approval and no requested
  changes (23.1% of src/ comments). [R5]
- src/: missing edge-case tests — a lower-case input code, a divide-by-zero average (15.4% of src/ comments). [R6]
- src/: duplicated config or data, such as a hardcoded list that should instead be read from a config file
  (7.7% of src/ comments). [R7]
- src/: whether a log line carries enough detail to trace a request later (7.7% of src/ comments). [R8]
- src/: consistent choice of log function across a file (7.7% of src/ comments). [R9]
- src/: names spelled out in full rather than abbreviated (7.7% of src/ comments). [R10]
- src/: errors that get silently swallowed instead of surfaced (7.7% of src/ comments). [R11]
- src/: locale-specific number formats, such as a comma decimal separator (7.7% of src/ comments). [R12]
- src/: formatting choices that keep future diffs small, such as a trailing comma (7.7% of src/ comments). [R13]
- src/: a return type that doesn't match how the value is used, such as a numeric total returned as a string
  (7.7% of src/ comments). [R14]
- migrations/: a down migration that fully reverses the up migration — the most-repeated blocker in the window
  (28.6% of migrations/ comments). [R15]
- migrations/: whether an index-creating migration runs CONCURRENTLY so it doesn't lock the table during
  the deploy (14.3% of migrations/ comments). [R16]
- migrations/: other systems that read the changed column or table — export jobs, workers, sync jobs — the
  single most common migrations/ remark (42.9% of migrations/ comments). [R17]
- migrations/: whether an index's column order actually matches the query pattern it's meant to serve (14.3%
  of migrations/ comments). [R18]

Find the candidates with `/worfy:code-review`, run in the worktree of step 1 with the fixed point
`<baseRefOid>`. This checklist is one more source of standards for it: add it to the standards sources of its
step 3, and paste it in full into the brief of its Standards sub-agent, which has no other copy. The Spec axis
runs when step 1 found the linked task: that task is the spec. What `/worfy:code-review` returns are candidates,
not comments yet.

## 4. Verify and grade

Check every candidate on the head commit, `git show <headRefOid>:<path>` or the file in the worktree of step 1.
A candidate you could not confirm there becomes a question, never a claim. Drop what this team does not raise:

- Do not raise anything about docs-only edits — typo fixes, linter version bumps — the team approves these
  without a word every time it has seen one alone in the window. [R19]

Give every remaining comment exactly one tier, as the team's history does:

**let go** — the reviewer noticed something and says it can stay: "fine for now", "not worth changing".

**nit** — a small matter of style, naming or wording; the author may ignore it; often starts with `nit`.

**question** — asks to understand the change; no change is asked for.

**heads-up** — tells a fact, a risk or a context the author may not know; no change in this pull request.

**followup** — asks for a change later: a separate pull request, a ticket, a TODO.

**argued** — asks for a change in this pull request and gives the reason, without blocking the merge.

**blocker** — must change before the merge.

## 5. Voice by tier

Write each comment the way this team writes a comment of its tier. Before writing the comments of a tier, read
its examples in `voice-examples.md`: real comments of the team, with links. Match their length and their
temperature, not their words; never copy a sentence of an example, and never write as one named person.

- let go: median 26, 90th percentile 36 characters; a bare one-line approval ("LGTM", "Mostly naming, see
  inline."); no hedging; spread evenly across reviewers. [R20]
- nit: median 59, 90th percentile 59 characters; names the exact token or line and states the fix directly, no
  question mark, no softeners; mostly from one reviewer in this window. [R21]
- question: median 85, 90th percentile 96 characters; short and direct, sometimes partially answering itself;
  spread evenly across reviewers. [R22]
- heads-up: median 93, 90th percentile 104 characters; states a fact or risk as a flat statement, often
  literally prefixed "heads-up:", no question mark; spread evenly across reviewers; concentrated in
  migrations/ around downstream consumers. [R23]
- followup: median 92, 90th percentile 92 characters; phrased as a low-key, deferred nice-to-have, not a
  demand; only one example in this window. [R24]
- argued: median 90, 90th percentile 150 characters; states the problem and its concrete consequence,
  imperative or declarative, no softeners; one reviewer gives half of these in this window. [R25]
- blocker: median 115, 90th percentile 174 characters; states the broken invariant as a plain fact, not
  phrased as a request; in this window both migration-safety blockers came from the same reviewer. [R26]

- Write every draft comment in English: every quoted comment behind the Voice tiers above is in English.
  [R20] [R21] [R22] [R23] [R24] [R25] [R26]

## 6. Review state

The state is the `event` of the draft: `APPROVE`, `COMMENT` or `REQUEST_CHANGES`.

- Default to `COMMENT` when there is something to say that isn't blocking: APPROVE made up 43.8% of reviews in
  the window, COMMENTED 25.0%, and CHANGES_REQUESTED 31.3% — reserved for migration-safety and
  config-duplication blockers. [R4]

## 7. Draft

Write the draft to `<tmp>/review-<n>.json`, outside the repository. It is the request body of GitHub's
create-review call as it is, and the tier of each comment beside it:

```json
{
  "payload": {
    "commit_id": "<headRefOid>",
    "event": "COMMENT",
    "body": "…",
    "comments": [{ "path": "src/a.ts", "line": 12, "side": "RIGHT", "body": "…" }]
  },
  "tiers": ["nit"],
  "body_tier": "question"
}
```

`tiers` has one tier per comment, in the order of `payload.comments`; `body_tier` is the tier of `payload.body`
and is needed when the body is not empty. Then check the draft:

```bash
review-draft-lint "<tmp>/review-<n>.json" --rules "<private folder>/lint.json"; echo "EXIT=$?"
```

`review-draft-lint` is a script of the worfy plugin; the plugin's `bin/` is on the PATH of this session's Bash.
It finds comments longer than their tier allows, traces of the workflow, AI authorship lines and personal data.
Exit 1: fix every finding it prints, shorten or rewrite, and run it again until exit 0. Exit 2: show its line
and stop.

## 8. Show the person

Show the person the draft: the state, the body, and each comment with its `path:line` and its tier, and the
clean line of `review-draft-lint`. Ask whether to post it as it is, change it, or drop it.

Post only after an explicit "yes" to this question in this conversation. A request to change something is not a
"yes": change the draft, run `review-draft-lint` again, show it again and ask again. A question, silence or a
"maybe" is not a "yes" either. On "yes", and only then:

```bash
node -e 'const fs = require("fs"); const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], JSON.stringify(d.payload))' "<tmp>/review-<n>.json" "<tmp>/payload-<n>.json"
gh api --method POST "repos/<owner>/<repo>/pulls/<n>/reviews" --input "<tmp>/payload-<n>.json"; echo "EXIT=$?"
```

Show the link of the posted review (`html_url` of the answer). That `gh api` call is the only command of this
skill that writes to GitHub.

On "no", or to drop the draft: post nothing and say the draft was not posted.

In a session with no person to answer (an unattended run): stop at the draft. Show it, post nothing, and say the
draft waits in `<tmp>/review-<n>.json` for a person to read.
