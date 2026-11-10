# Pull requests

The **PR inbox** of a Project: the user's open pull requests (PRs) and the review requests to the user in the
Project's repositories, grouped by whose move it is, with the review threads and their last comments. The UI calls it
**Pull requests**. It only reads GitHub; nothing in it posts, resolves or marks anything there
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

- **CI dot**: green — passing, orange — failing, an empty blue ring — running, an empty grey ring — no CI. Its text is
  the tooltip.
- **Age**: for Needs my review, the age of the PR; elsewhere, of its last comment or review. The tooltip has the time.
- **Ticket chip**: the Ticket whose `PR:` line names this PR, else the Ticket whose branch is the PR's (its `Branch:`
  line, or `<epic>/<NN>`).
- **N new since you looked**: comments of others newer than the user's last look at the PR.

**An open row.** A click on the row opens it, a second click closes it. Open, it shows:

- **Open on GitHub**, and the PR's branch;
- the review threads, open ones first, then resolved ones dimmed. Each has its file and line, a link to the comment on
  GitHub, which shows that code line, `Outdated` when the code moved on, and its last three comments with the author and
  their age. A deleted account is `ghost`, as on GitHub;
- **Conversation**: the last comments of the PR's conversation tab, when it has any;
- **Mark seen**, active while the row has new comments.

Opening a row and **Mark seen** both record that the user has looked: "N new since you looked" goes. Closing a row
records nothing. Links open in the system's browser, never in the window.

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
Project's PR inbox, the view says so at once, and the sidebar leaves it out. The switch applies on Save, like the other
fields of the window.

#### On a Linked machine

A window on a Linked machine shows the inbox of that Machine's Project, as that Machine read it; it never asks GitHub
itself. With Read only access the rows open, but nothing is marked seen, **Mark seen** is inactive with the read-only
hint, and the switch of Project settings is inactive. Links open on the Machine where they are clicked.

### How it works

- Main reads GitHub, by Project, with the Project's GitHub account, only the Project's repositories: a search every 5
  minutes, then the details of the PRs that moved. It computes the groups and the counts and sends the view a snapshot
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md), point 1). The view only draws it.
- The words of colleagues stay in main's memory. What the user has seen goes to the Project's data folder as ids, a
  commit and a time, never a text ([ADR-0005](../adr/0005-worfy-own-state-inventory.md), amended by ADR-0105).
- The renderer keeps one copy of each Project's inbox for the view and the section. It asks main again when main says
  the inbox changed, and when the Project's settings change, so the switch shows at once.
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
| The channels `prInbox.get`, `prInbox.markSeen`, `prInbox.changed` | `src/shared/ipc/pr-inbox.ts`, `src/main/ipc/pr-inbox.ts` |
| The reader and the groups | `src/main/github/inbox.ts`, `src/main/github/inbox-groups.ts` |
| What the user has seen; the switch as main reads it | `src/main/projects/pr-inbox-state.ts` |

Tests: `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-open.test.tsx`, `test/e2e/pr-inbox.spec.ts`; the reader
in `test/contract/pr-inbox.test.ts` and `test/unit/pr-inbox-groups.test.ts`.
