---
name: pr-reply
description: Draft replies to the open review threads of one pull request into a file on this machine; nothing is posted. Use on "/worfy:pr-reply <owner>/<repo>#<N>", worfy's action "Draft replies", or when the person asks to draft answers to the review comments of a pull request.
---

# Draft replies to the review threads of a pull request

This skill reads one pull request, its diff and its open review threads, checks what each comment says against
the code at the head commit, and hands a draft reply for each thread that waits for an answer to
`bin/pr-reply-draft`, which checks the drafts and keeps them in a file on this machine. worfy's action
`actions.prReply` ("Draft replies") starts a Session with this skill; the person can also call it.

**Nothing is posted.** This skill never writes to GitHub, in any session, with or without a person:

- no `gh api` call with a write method (`-X`/`--method` `POST`, `PATCH`, `PUT`, `DELETE`), with `-f`, `-F`,
  `--field`, `--raw-field` or `--input` on a REST path, and no GraphQL `mutation`;
- no `gh pr comment`, `gh pr review`, `gh pr edit`, `gh pr merge`, `gh pr close`, `gh issue comment`;
- no resolving of a thread, no request of a review, no reaction, no pending review;
- no `git push`, and no `git checkout`, `git switch`, `git commit`, `git reset` or `git stash` in the person's checkout.

If the person asks in this conversation to post a reply, do not: say that this skill only drafts, and that a
reply reaches GitHub only when the person posts it themselves. In a
session with no person to answer (an unattended run), the result is the same: the draft file, and nothing else.

## 1. The pull request, the profile and the draft file

The argument names one pull request: `<owner>/<repo>#<N>`, or its link `https://github.com/<owner>/<repo>/pull/<N>`.
Without one, or with a malformed one, ask the person which pull request; with no person to answer, stop and say why.

Run in the project root:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" --json; echo "EXIT=$?"
```

Take `_resolved.dir`, the profile folder of the project, and `language.team`. Exit 3 means the project is not
connected and the drafts have nowhere to go: say so, suggest `/worfy:connect-project`, and stop.

The draft file is `<_resolved.dir>/state/pr-inbox/drafts/<owner>-<repo>-<N>.json`. It stays on this machine, in the
profile folder, outside the project's repository and outside any git history. Only `bin/pr-reply-draft` (step 6)
writes it: never write or create anything in the profile folder yourself, with a file tool, `mkdir` or a shell
redirect. It lies in the Harness home, where a Session's own write waits for a permission prompt, and a session
with no person to answer is refused. Never write a draft, a quote of a comment or a login anywhere else either: not
in the repository, not in a commit, not in a temporary file.

The checkout is the folder of the project whose `git remote get-url origin` names `<owner>/<repo>` on github.com: the
project root, or, in a project of several repositories, the repository folder below it that does. Every git
command of this skill runs as `git -C "<checkout>" …`. No such folder: stop and say the pull request is not of this
project.

## 2. Read, only read

```bash
gh pr view <N> --repo <owner>/<repo> --json number,url,title,body,author,state,isDraft,baseRefName,headRefName,headRefOid,files; echo "EXIT=$?"
gh pr diff <N> --repo <owner>/<repo>; echo "EXIT=$?"
gh api graphql -F number=<N> -f owner=<owner> -f name=<repo> -f query='query PrReplyThreads($owner: String!, $name: String!, $number: Int!) { viewer { login } repository(owner: $owner, name: $name) { pullRequest(number: $number) { headRefOid reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { id isResolved isOutdated path line originalLine comments(first: 50) { nodes { databaseId author { __typename login } body createdAt url } } latest: comments(last: 1) { nodes { databaseId author { __typename login } } } } } comments(last: 50) { nodes { databaseId author { __typename login } body createdAt url } } } } }'; echo "EXIT=$?"
```

When a command does not exit 0, show its one line and stop. Keep `headRefOid`, the head commit the drafts are about;
`viewer.login`, the person; and `author.login` of the pull request. `hasNextPage` true: the threads after the first
100 are not read; say so at the end. `comments` holds the first 50 comments of a thread, `latest` its last one.

## 3. What waits for an answer

- **A review thread** waits when `isResolved` is false and its last comment is not the viewer's. Its last comment
  is the one in `latest`, never the last of `comments`, which a long thread cuts. A resolved thread, and one whose
  last comment is the viewer's, gets no draft.
- **A comment in the conversation** of the pull request waits when it is newer than the viewer's last comment
  there, its author is not the viewer and not a bot (`__typename` `Bot`, or a login ending in `[bot]`), and it asks
  the viewer something or asks for a change. Thanks, a status line of a tool, a note to someone else: no draft.

Nothing waits: run step 6 with an empty `items` list — the drafts of an earlier run for this pull request become
`discarded`, and with no draft file nothing is written — then say there is nothing to answer, and stop.

## 4. Check, label and draft each one

Read the code the comment is about at the head commit, without touching the working tree:

```bash
git -C "<checkout>" cat-file -e "<headRefOid>^{commit}"; echo "EXIT=$?"
git -C "<checkout>" show "<headRefOid>:<path>"; echo "EXIT=$?"
```

When the commit is not there, fetch it once, `git -C "<checkout>" fetch origin "pull/<N>/head"`; when that fails too,
read the diff of step 2 only. A claim of the comment or of your reply that you could not confirm in that code
becomes a question in the reply, never a statement.

Give each one exactly one label:

- **needs code change** — it asks for a change the head commit does not have yet;
- **needs answer** — a question, or a claim that needs a reply in words;
- **FYI** — information, praise or a note that needs only an acknowledgement;
- **resolved by push** — the change it asks for is already in the head commit (such a thread is often
  `isOutdated`); the reply says where.

Then write the reply:

- Answer what the comment asks, with what the code shows; one point per sentence; no greeting, no signature.
- A change that is not made yet is never written as done: "I'll cap the retries at three" — not "Fixed".
- `fixPlan`: on the person's own pull request (`author.login` is `viewer.login`) and the label needs code change —
  a short plan for the person, the files and what changes in them. It is never posted. Otherwise `null`.
- Never name: a ticket, an epic or a decision record by its number or name, a path of the workflow files
  (`.scratch`, `HANDOFF`, the Workflow folder), worfy, this skill, a model or AI. Never put a person's home folder,
  host name or email address in a reply.

## 5. Voice

When `<_resolved.dir>/state/human-review/.claude/skills/human-review/voice-examples.md` exists, the project has a
reviewer built in its team's voice: read those examples and write in their language, matching the length and the
temperature of the tiers question, heads-up and argued. Never copy a sentence of an example and never write as one
named person. Without it, write in the language `language.team` names (English when the profile has none), short
and plain, the way a colleague on the team answers.

## 6. Hand the drafts to pr-reply-draft

Run in the project root, with the drafts as JSON between the two `JSON` lines:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/pr-reply-draft" <<'JSON'; echo "EXIT=$?"
{
  "schema": 1,
  "repo": "<owner>/<repo>",
  "pr": 118,
  "headOid": "<headRefOid>",
  "items": [
    { "kind": "thread", "threadId": "<id of the thread>", "replyTo": 4211, "label": "needs answer",
      "body": "…", "fixPlan": null, "state": "draft", "sentUrl": null },
    { "kind": "conversation", "label": "FYI", "body": "…", "fixPlan": null, "state": "draft", "sentUrl": null }
  ]
}
JSON
```

`replyTo` is the `databaseId` of the first comment of the thread: a reply goes under the top comment. A
conversation reply has no `threadId` and no `replyTo`. Every item is `"state": "draft"` with `"sentUrl": null`. Send
every reply of this run each time, never only the changed ones.

The script checks the replies with `review-draft-lint --reply` (with the limits of the team reviewer when it is
built): traces of the workflow, AI authorship lines, personal data, forbidden words, empty replies and replies over
the length limit, each named `items[<i>]`, the place of the reply in the list you sent. Exit 1: nothing was
written; rewrite or shorten each item it names and run it again, until
exit 0. Exit 2: show its line and stop.

On exit 0 it has written the draft file and printed its path. A draft file of an earlier run keeps what the person
did with it: a reply in `sent` or `discarded` stays, a reply the person edited (`"edited": true`) stays as they
wrote it while its thread still waits, and the other drafts are replaced by yours or, for a thread that no longer
waits, marked `discarded`.

## 7. Tell the person

Show each draft: the thread's `path:line` or "conversation", its label, the reply and the `fixPlan`; the path of
the draft file and the clean line of `review-draft-lint` from step 6; and the replies it kept as the person edited
them. Say that nothing was posted.

When the person asks to change a reply in this conversation, change only that item's `body` (and `fixPlan` if
asked), keep the other replies as they are, and run step 6 again with all of them. Still post nothing.
