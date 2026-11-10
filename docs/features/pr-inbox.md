# Pull requests

The **PR inbox** of a Project: the user's open pull requests (PRs) and the review requests to the user in the
Project's repositories, grouped by whose move it is, with the review threads and their last comments. The UI calls it
**Pull requests**. It reads GitHub. The one thing it ever posts is a reply a Session drafted with skill `pr-reply`,
which the user may edit, and which goes only on the user's click on **Send**; nothing in it resolves, requests,
reviews or marks anything there
([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md)). Terms are explained in [Concepts](concepts.md); the PR
and CI badges of a Ticket are on [Gate and GitHub](gate-and-github.md).

## The Pull requests view

### Behaviour

**Where it opens.**

- **Pull requests** in the View switch of the toolbar, the fifth tab after Canvas, Session, Pipeline and Runs. Without a
  Project the tab is inactive, and its tooltip says to open one.
- The **Pull requests** row of the Command palette, group View, with a Project.
- A group of the **Pull requests** section of the sidebar: the view of that row's Project, scrolled to that group, its
  frame marked. A row of another Project selects that Project first.
- A click on a system notification of a new review request or reply opens the view on that PR, and **Open** of the
  morning digest opens it too: see [Notifications](notifications.md).

The view belongs to the active Project. Another Project shows its own inbox, and its rows start closed.

**Groups.** Five, always in this order, each with its count. A group with no PR shows its heading and 0.

| Group | Holds |
|---|---|
| Needs my review | A review is asked of the user, in person or through a team, or asked again after the user's review |
| Needs my answer | An unresolved thread whose last comment is someone else's, on the user's PR or one the user wrote in; a mention of the user newer than the user's last comment there |
| Needs a fix | The user's PR with red CI, changes requested, or a merge conflict |
| Ready | The user's PR, approved, green, without a conflict. People merge it: the group is a reminder to whoever merges |
| Waiting on others | The user's PR with no move of the user's |

Main decides the group and the order inside it: Needs my review shows the oldest PR first, the others the oldest
activity first. A PR without a Ticket is a row like any other.

**A row.** The first line: the CI dot, the title, `Draft` for a draft PR, and the age. The second line: `owner/repo#N`,
the Ticket chip (`<epic> <NN>`) when the PR is a Ticket's, the review decision (Approved, Changes requested, Review
required), the count of open threads ("2 open threads"), "N new since you looked", and "via team" when the review is asked
only of a team the user is in.

- **Title**: cut with an ellipsis when it does not fit; the whole title is its tooltip.
- **CI dot**: green — passing, orange — failing, an empty blue ring — running, an empty grey ring — no CI. Its text is
  the tooltip.
- **Age**: for Needs my review, the age of the PR; elsewhere, of its last comment or review. The tooltip has the time.
- **Ticket chip**: the Ticket whose `PR:` line names this PR, else the Ticket whose branch is the PR's (its `Branch:`
  line, or `<epic>/<NN>`). The number counts only in its repository: `PR: lib#41` names #41 of the repository
  called `lib` (or `owner/lib`), and a bare `PR: #41` names #41 of the Ticket's `Repo:` repositories, of any repository
  only when the Ticket has no `Repo:` line.
- **N new since you looked**: comments of others newer than the user's last look at the PR.

**An open row.** A click on the row opens it, a second click closes it. Open, it shows:

- **Open on GitHub**, and the PR's branch;
- the review threads, open ones first, then resolved ones dimmed. Each has its file and line, a link to the comment on
  GitHub, which shows that code line, `Outdated` when the code moved on, and its last three comments with the author and
  their age. A deleted account is `ghost`, as on GitHub;
- **Conversation**: the last comments of the PR's conversation tab, when it has any;
- **Draft replies**: a new Session that drafts replies to the open threads (below);
- **Mark seen**, active while the row has new comments.

Opening a row and **Mark seen** both record that the user has looked: "N new since you looked" goes. Closing a row
records nothing. Links open in the system's browser, never in the window.

### Draft replies and Send

**Draft replies** on an open row starts a new Session Node of the Project on Claude Code, with a person, whose first
message is the Project's "Draft replies" template filled in with the PR (`/worfy:pr-reply owner/repo#N` by default).
The skill reads the PR, its diff and its open threads, and writes a draft reply for each thread that waits for an
answer into a file on this machine, in the Profile folder (`state/pr-inbox/drafts/`). It posts nothing. The row says
"A Session drafts the replies: they appear under their threads", or why the Session did not start.

**A draft under its thread.** An open row reads its drafts when it opens, every 5 seconds while it stays open, and when
the window gets the focus. Each draft reply shows under its thread, or under **Conversation** for a reply in the PR's
conversation: its label (Needs code change, Needs answer, FYI, Resolved by push), `Edited` once the user changed it,
and the text in a field the user edits. A reply whose thread the row does not list shows under "Replies to threads not
shown here". A plan for a code change, when the skill wrote one, shows under the field; it is never posted. Buttons:

- **Send** posts the text in the field, once. It is inactive while the field is empty.
- **Discard**: the reply will not be sent, and it leaves the view.
- **Ask the Session to rewrite** sends a message to the Session that **Draft replies** started for this PR in this
  window, asking it to rewrite that one reply. Inactive when no such Session is known; when it has closed, the line
  under the replies says so. Inactive too for a reply the user has changed (`Edited`, or a text typed in the field),
  with the tooltip "You changed this reply: the Session keeps your text when it drafts again, so it cannot rewrite
  it": the skill keeps an edited reply as it is while its thread waits, so a rewrite would change nothing.

An edit is kept in the draft file when the field loses the focus, so the skill keeps the user's text when it runs
again. A text typed and not yet kept stays with its thread when the Session writes new drafts and the replies move in
the file; a reply in the conversation keeps it by the text it was typed over. A sent reply shows `Sent`, its text and
**View on GitHub**. A reply that was not sent shows why under it, and so does a refusal of the whole Send (no
account, for one); the next read of the file does not wipe it. A reply GitHub took although the draft file could not
record it shows "Posted, but the draft file does not say so: …", and its Send is inactive.

**Send all** shows when a PR has two drafts or more. It opens a dialog "Send N replies to owner/repo#N?" with every
text exactly as it goes and its place, and the buttons **Send all** and **Cancel**. The dialog keeps the texts it
opened with: a read of the file while it is open changes neither what it shows nor what goes. Cancel, Escape or a
click outside sends nothing. It is inactive while a reply is empty.

**What Send does.** The view names the reply by its thread (in the conversation: by the text it last read), never by
its place in the file alone; when the file holds neither that text nor the text shown, Send is refused with "The
drafts changed meanwhile … look at them again". Main saves the text shown into the draft file, reads the file again
and takes that text as it is. It checks it again with `review-draft-lint --reply`: traces of the workflow (Ticket and
ADR numbers, Epic names, workflow paths), AI authorship lines, personal data, and the length. A finding, or a check
that could not run, and nothing is posted: the reply stays a draft and shows "Not sent: review-draft-lint found …".
The account is the one the Profile names in `github.account`; a Profile without it gets "Not sent: the Project's
Profile names no GitHub account (github.account) …", and nothing is posted — never as the gh login of the machine.
A reply in a review thread goes only under the thread's first comment as GitHub has it; a draft that names another
comment is refused. Then the reply is marked in the file as being sent, and main posts it once, the text as the body
without a byte added: a reply in a review thread under its first comment, or a comment in the PR's conversation. The
draft file then says `sent` and the comment's URL.

- **A failure.** When GitHub or the network fails, the reply stays a draft with "GitHub did not confirm the reply:
  <reason>". worfy never posts it again by itself. Send again of such a reply — or of one still marked as being sent,
  after worfy stopped in the middle — first asks GitHub whether the account has posted this very text there; if so,
  the reply is only marked sent, so a reply whose answer was lost is not posted twice. A first Send never asks: a
  "Thanks!" the account wrote under the same thread before is posted again.
- **Send all** posts one reply after another, at most 80 a minute, GitHub's limit. The first failure of GitHub stops
  the rest; a reply the check refuses does not.
- A reply sent already is never sent again, and is neither edited nor discarded.
- A token without "Pull requests: write" (a fine-grained token) gets GitHub's refusal, shown under the reply.

**What worfy never does on GitHub**: resolve a thread, request a review, submit a review or leave a pending one, mark
a notification read, push, or post anything without the click on **Send** or **Send all** in its dialog.

**The status line** under the heading:

- "Next search in 4 min", or "Next search now" once the time has come; the tooltip has the time;
- "The last read failed: <reason>" when the last read of GitHub failed, or when the reader waits for the rate limit;
- the notice of the reader when it has one, for example "GitHub notifications unavailable for this token — checking
  every 5 minutes";
- "Mark seen failed: <reason>" when main could not record a look.

Before the first answer the view says "Reading pull requests…". A Project that reads no pull requests — the switch is off
in Project settings, or none of its repositories is on GitHub — shows one line saying so and no groups. A read without a
single PR says "No open pull requests and no review requests."

**Opening on one PR.** An entry can ask for one PR of a Project: the view of that Project opens with that PR's row
open, scrolled into sight, and marked seen. When the inbox does not hold that PR, the view opens and says "This pull
request is not in the inbox: owner/repo#N".

**The sidebar section.** **Pull requests**, under Pipeline. For each Project of the window's Machine that holds a PR:
its name, then a row per group that holds one, with the count. A Project that reads no pull requests, or holds none,
shows nothing. With nothing anywhere, the section says "No pull requests". A Project whose inbox cannot be read says why.

**The switch.** Project settings has **Read pull requests from GitHub**, on by default. Off, worfy runs no gh for that
Project's PR inbox, the view says so at once, and the sidebar leaves it out. Turned on again, the Project is read at
once, without waiting for the next search. The switch applies on Save, like the other fields of the window.

#### On a Linked machine

A window on a Linked machine shows the inbox of that Machine's Project, as that Machine read it; it never asks GitHub
itself. With Read only access the rows open, but nothing is marked seen, **Mark seen** is inactive with the read-only
hint, and the switch of Project settings is inactive. Links open on the Machine where they are clicked.

Drafts and Send stay on the machine of the Project: a window on a Linked machine shows neither the drafts nor **Draft
replies**, and the channels of drafts and Send are refused to a Linked machine at any access level.

### How it works

- Main reads GitHub, by Project, with the Project's GitHub account, only the Project's repositories: a search every 5
  minutes, then the details of the PRs that moved. It computes the groups and the counts and sends the view a snapshot
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md), point 1). The view only draws it.
- The words of colleagues stay in main's memory. What the user has seen goes to the Project's data folder as ids, a
  commit and a time, never a text ([ADR-0005](../adr/0005-worfy-own-state-inventory.md), amended by ADR-0105).
- The renderer keeps one copy of each Project's inbox for the view and the section. It asks main again when main says
  the inbox changed, and when the Project's settings change, so the switch shows at once.
- Main reads one Project at a time: the timer's reads and the read a request asks for (a Project shown for the first
  time, or turned on again) wait for each other in one queue.
- Drafts and Send: the four channels `prInbox.drafts`, `prInbox.saveDraft`, `prInbox.discard` and `prInbox.send` are
  `local`, so the link adapter refuses them to a Linked machine before any handler runs. Main writes into a draft file
  only the user's text (`edited`), a discard, the mark of a Send in flight and the reason a Send failed (both in
  `error`), and the sent mark, through a temporary file and a rename, and only while the file is still what it read —
  its text, and right before the rename its inode, size and modification time: a Session that wrote new drafts
  meanwhile is not overwritten. One change of a file at a time, so two clicks on Send post once
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md), points 2–6).
- Every entry that opens the view goes through one function. With a PR it leaves an ask; the view takes it once the
  snapshot is there, then clears it, so coming back to the view does not open that row again.

### Implementation

| What | Where |
|---|---|
| The view: groups, rows, threads, status line | `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/pr-inbox.css` |
| The renderer's copy of the inbox; the texts of a row; the Ticket of a PR | `src/renderer/pr-inbox/usePrInbox.ts` |
| Opening the view, on one PR or one group | `src/renderer/pr-inbox/open.ts` |
| The sidebar section | `src/renderer/shell/sidebar/PullRequestsSection.tsx` |
| The tab and the view in the shell | `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx` |
| The palette row | `src/renderer/palette/commands.ts` |
| The switch | `src/renderer/shell/ProjectSettings.tsx`; the `prInbox` field of `src/shared/projects/action-templates.ts` |
| The channels `prInbox.get`, `prInbox.markSeen`, `prInbox.changed`, `prInbox.drafts`, `prInbox.saveDraft`, `prInbox.discard`, `prInbox.send` | `src/shared/ipc/pr-inbox.ts`, `src/main/ipc/pr-inbox.ts` |
| Draft replies under their threads, Send, Send all and its dialog, Draft replies | `src/renderer/pr-inbox/DraftThread.tsx`, `src/renderer/pr-inbox/PrInboxView.tsx` |
| The draft file, the check again and the one POST | `src/main/github/pr-reply-send.ts` |
| The reader and the groups | `src/main/github/inbox.ts`, `src/main/github/inbox-groups.ts` |
| What the user has seen; the switch as main reads it | `src/main/projects/pr-inbox-state.ts` |

Tests: `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-open.test.tsx`, `test/e2e/pr-inbox.spec.ts`; the reader
in `test/contract/pr-inbox.test.ts` and `test/unit/pr-inbox-groups.test.ts`; drafts and Send in
`test/contract/pr-inbox-send.test.ts` and `test/unit/draft-thread.test.tsx`.
