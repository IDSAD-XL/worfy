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

Read only. The pull request is its author's code, and the shell of this session carries the person's GitHub token
(`GH_TOKEN`), so that code never runs here: no build, no test, no package manager (`npm`, `pnpm`, `go`, `cargo`,
`pip`, `make`…), no script of the repository and no hook of it. The worktree is there to be read. Besides the
commands this skill writes out, run only reading commands — `git diff`, `git show`, `git grep`, `git log` — and read
files. What only a run would show becomes a question, as step 4 says of a candidate it could not check.

## 2. Triage

Decide first whether the pull request needs comments at all, and whether to ask for a split. Small is not safe:
the exceptions below come from small pull requests this team still stopped.

{{rules: R1 — what the team approves without a comment: kinds of change (bumps, backports, generated files, text edits), sizes and areas, each with its share}}

{{rules: R2 — the exceptions: small pull requests that still got changes requested or a blocker comment, by path and kind}}

{{rules: R3 — when the team asks to split a pull request and at what size; with no such request in the window, the default: "Ask to split a pull request over 800 changed lines, or one that mixes changes of unrelated kinds (the template's default)."}}

A pull request these rules let through without a comment goes to step 6 with no candidates.

## 3. Checklist by area

What this team really catches, by area of code or by repository, with its share of the area's comments:

{{rules: one per Theme section — "<area>: <what to check> (<share> of the area's comments)"}}

Find the candidates with `/worfy:code-review`, run in the worktree of step 1 with the fixed point
`<baseRefOid>`. This checklist is one more source of standards for it: add it to the standards sources of its
step 3, and paste it in full into the brief of its Standards sub-agent, which has no other copy. The Spec axis
runs when step 1 found the linked task: that task is the spec. Paste the read-only paragraph of step 1 into the brief
of each of its sub-agents too: they run nothing of the pull request either. What `/worfy:code-review` returns are
candidates, not comments yet.

## 4. Verify and grade

Check every candidate on the head commit, `git show <headRefOid>:<path>` or the file in the worktree of step 1.
A candidate you could not confirm there becomes a question, never a claim. Drop what this team does not raise:

{{rules: one per Do not touch section — what the team objects to when a reviewer raises it, or never comments on}}

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

{{rules: one per Voice section with comments — "<tier>: median <m>, 90th percentile <p> characters; typical openings; the register (softeners, hedges, questions instead of orders); leanings by area"}}

{{rules: the language the team writes its reviews in, from the quotes of the Voice sections — the draft is written in it}}

## 6. Review state

The state is the `event` of the draft: `APPROVE`, `COMMENT` or `REQUEST_CHANGES`.

{{rules: R4 — the default state, and when the team comments only or requests changes, with the shares}}

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
"maybe" is not a "yes" either. On "yes", and only then, run two commands, one after the other. The first writes the
request body:

```bash
node -e 'const fs = require("fs"); const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], JSON.stringify(d.payload))' "<tmp>/review-<n>.json" "<tmp>/payload-<n>.json"; echo "EXIT=$?"
```

The second posts it. Keep it a command of its own: the Bash guard reads the file before the command runs, and a
file the same command writes first does not exist yet.

```bash
gh api --method POST "repos/<owner>/<repo>/pulls/<n>/reviews" --input "<tmp>/payload-<n>.json"; echo "EXIT=$?"
```

Show the link of the posted review (`html_url` of the answer). That `gh api` call is the only command of this
skill that writes to GitHub.

On "no", or to drop the draft: post nothing and say the draft was not posted.

In a session with no person to answer (an unattended run): stop at the draft. Show it, post nothing, and say the
draft waits in `<tmp>/review-<n>.json` for a person to read.
