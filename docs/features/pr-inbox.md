# Pull requests

The **PR inbox** of a Project: the user's open pull requests (PRs) and the review requests to the user in the
Project's repositories, grouped by whose move it is, with the review threads and their last comments. The UI calls it
**Pull requests**. It reads GitHub, and its search finds any other PR the Project's account can see. It posts two
things, each only on the user's click: a reply a Session drafted with skill `pr-reply`, which the user may edit, on
**Send** ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md)), and a review of someone else's PR written in
[Review mode](#review-mode), by the user or by an Agent review, on **Submit review**
([ADR-0112](../adr/0112-pr-review-submit-only-on-the-users-click.md)). Nothing in it resolves, requests or marks
anything there. Terms are explained in [Concepts](concepts.md); the PR and CI badges of a Ticket are on
[Gate and GitHub](gate-and-github.md).

## The Pull requests view

### Behaviour

**Where it opens.**

- **Pull requests** in the View switch of the toolbar, the fifth tab after Canvas, Session, Pipeline and Runs. Without a
  Project the tab is inactive, and its tooltip says to open one.
- The **Pull requests** row of the Command palette, group View, with a Project.
- A group of the **Pull requests** section of the sidebar: the view of that row's Project, scrolled to that group, its
  heading marked and its first PR selected (not marked seen). A row of another Project selects that Project first.
- A click on a system notification of a new review request or reply opens the view on that PR, and **Open** of the
  morning digest opens it too: see [Notifications](notifications.md).

The view belongs to the active Project. Another Project shows its own inbox and starts with a selection of its own.

**Two panes.** On the left, a compact list of the PRs by group; on the right, the selected PR in full. In a window
narrower than about 720 px of content the list sits above the PR, each scrolling on its own.

**Groups.** Five, always in this order, each heading with its count. The list shows only the groups that hold a PR.

| Group | Holds |
|---|---|
| Needs my review | A review is asked of the user, in person or through a team, or asked again after the user's review |
| Needs my answer | An unresolved thread whose last comment is someone else's, on the user's PR or one the user wrote in; a mention of the user newer than the user's last comment there |
| Needs a fix | The user's PR with red CI, changes requested, or a merge conflict |
| Ready | The user's PR, approved, green, without a conflict. People merge it: the group is a reminder to whoever merges |
| Waiting on others | The user's PR with no move of the user's |

Main decides the group and the order inside it: Needs my review shows the oldest PR first, the others the oldest
activity first. A PR without a Ticket is a row like any other.

**A row of the list.** The author's avatar (two letters of the login on a colour of its own; the user's own has a ring),
the title, and under it the repository's name and number (`web#41`; the whole `owner/repo#N` is the tooltip; a long
name is cut with an ellipsis, the number stays whole, and the list never scrolls sideways), the
Ticket chip (`<epic> <NN>`) when the PR is a Ticket's, and the CI dot — with its text beside it when CI is not green.
When the line runs short, the repository name gives way first, then the Epic name in the Ticket chip (cut with an
ellipsis; its number stays whole, and `<epic> <NN> — <title>` is the chip's tooltip). `#N` and the CI text stay
whole, and nothing is drawn over anything. On
the right: the age, the count of open threads with a speech-bubble icon (orange on the user's own PR, where someone
waits for the user; "2 open threads" is the tooltip), a blue dot when there are new comments ("N new since you
looked" is the tooltip), and the approvals chip.

- **Approvals chip**: how many approvals count and how many the rule of the base branch asks for. `0/2` and `1/2` are
  neutral; `✓ 2/2` is green when GitHub says APPROVED — or, when GitHub gives no review decision at all, when the count
  is reached, no code owner is waited for, the last push needs no other approval, and the branch has no rule worfy
  cannot count — and `✓ 2` when GitHub
  approves a PR whose rule the account cannot see; `✕ 1/2` is orange on changes requested; `1/?` is grey and dashed when the rule is not visible to the
  account; a clock marks a count that is reached while code owners still hold it. A rule that asks for no approvals
  while GitHub still wants a review shows `review required`, never `0/0`. The tooltip says who approved, which code
  owners are waited for, the approvals given before the last push that the rule drops (stale), and, when the count is reached but GitHub still holds
  the PR, GitHub's word (`GitHub says: review required`, or `more rules apply — GitHub decides` when the branch has a
  rule worfy does not count). The accessible name says the chip in words (`1 of 2 required approvals`, `1 approval,
  rule not visible`). A branch with no review rule has no chip.

- **Title**: cut with an ellipsis when it does not fit; the whole title is its tooltip.
- **CI dot**: green — passing, orange — failing, an empty blue ring — running, an empty grey ring — no CI. Its text is
  the tooltip.
- **Age**: for Needs my review, the age of the PR; elsewhere, of its last comment or review. The tooltip has the time.
  Its colour says how long the PR has waited: grey under 12 hours, lighter under 3 days, orange under 14 days, red
  after.
- **Ticket chip**: the Ticket whose `PR:` line names this PR, else the Ticket whose branch is the PR's (its `Branch:`
  line, or `<epic>/<NN>`). The number counts only in its repository: `PR: lib#41` names #41 of the repository
  called `lib` (or `owner/lib`), and a bare `PR: #41` names #41 of the Ticket's `Repo:` repositories, of any repository
  only when the Ticket has no `Repo:` line.
- **N new since you looked**: comments of others newer than the user's last look at the PR.

**Selecting.** A click on a row selects its PR; **↑** and **↓** move the selection along the list, from anywhere in the
shown view except a text field, a menu or a dialog, and stop at its ends. Before the user chooses, the view selects by
itself the first PR that waits for the user's answer, else the first of the list. That choice is made once and kept: a
new search that reorders the groups does not move the pane off the PR, nor off a draft being typed there. The view
chooses again only when the selected PR leaves the inbox. With one PR, that PR is selected, and the pane has no
"↑ ↓ next PR" hint.

**The selected PR.** The right pane shows:

- the title, `owner/repo#N`, the Ticket chip, `Draft` for a draft PR, "via team" when the review is asked only of a team
  the user is in, the author, the branch, and "N new since you looked";
- **what to do next**, one strip in the colour of the PR's group, from the group, CI, review and drafts, with its main
  button: "Your review is asked" with **Start review ▾** ([Review mode](#review-mode)); "Answer N open threads" with
  **Send all (N)** when two draft replies or more are ready below (it opens the dialog of Send all, below), with
  **Draft replies** when there is none yet, and with no button for one draft, whose **Send** is under its thread;
  "CI failing", "Changes requested", "Merge conflict" or several of them ("Merge conflict and CI failing") with the
  buttons of the PR's reasons and **Open checks**; "Ready to merge" with **Open to merge**;
  "Waiting for reviewers", or "Draft PR: no review asked yet". Needs my review is blue and Needs my answer violet in the
  light theme (lime in the dark one);
- **the buttons of a PR to fix**: **Resolve conflicts** for a merge conflict (`DIRTY`), **Fix checks** for red CI,
  **Address comments** for changes requested or threads that wait for the user's answer, in that order: a PR in conflict
  runs no CI. The first reason is the strip's main button and its line says what that button does (`Fix checks hands the
  failing checks to a Session; it asks before it pushes.`); the other reasons are buttons beside it; **Open checks** stays
  a link to the Checks tab on GitHub, after them. The user's own PR in Needs my answer has these buttons beside
  **Draft replies**, usually just **Address comments**; a colleague's PR has none. A click hands the PR to a Session of
  the skill pr-fix with the Project's template: the Session of the PR's Ticket when one is live, else a new Session Node
  ([Projects](projects.md), "Project settings…", describes the templates, the route and every refusal). A short toast says
  where the text went: `Fix checks for owner/web#118: Sent to the Session of worfy-x 07`, `… Queued for the Session of …`
  while that Session's turn runs, or `… Started a Session`; a refusal of main is an error toast with its reason. A button
  that cannot run is inactive, and its tooltip says why: an empty template (`Set the Fix checks template in Project
  settings`), a read-only screen, a PR from a fork, not the user's or whose reason is gone. The buttons write nothing to
  GitHub: the Session asks before it pushes;
- four cells: **CI**; **Approvals** — the approvals chip, what it comes to (`of 2 required`, `changes requested`,
  `waiting for code owners`, `rule not visible to your account`, `GitHub says: approved`), and every reviewer with the
  state of their review: Approved, Changes requested, Commented, Requested (with `code owner` when asked as one),
  Dismissed, `Approved · stale` (before the last push, when the rule drops such approvals) and a grey `Approved · does
  not count` for a reviewer without write access; a code-owner team the account cannot see is listed as `code owners
  (hidden team)`. A branch with no review rule says `No review rule · 1 approval`. A Project machine that does not read
  approvals yet shows **Review** in its place (Approved, Changes requested, Review required, or None yet); **Merge** (Mergeable,
  Behind the base, Blocked, Checks failing, Conflicts, Draft, or Unknown, from GitHub's merge state); **Size** — the
  lines added and removed (`+184 −22`) with a bar of their shares, or `—` when GitHub gave none;
- **Open on GitHub**; **Code story**, which opens the Code story of the PR's Ticket in the Story view when the Tickets
  root has one, and otherwise builds the PR's story by the button, with a progress bar in its place, or opens the one
  kept before; **Rebuild story** once one is kept ([Workflow](workflow.md)); **Draft replies** (below; in the strip instead when it is the strip's button) and
  **Mark seen**, active while the PR has new comments;
- "Threads N open · M resolved", then the review threads, open ones first, then resolved ones dimmed. Each has its file and line, a link to the comment on
  GitHub, which shows that code line, `Outdated` when the code moved on, and its last three comments with the author and
  their age. A deleted account is `ghost`, as on GitHub;
- **Conversation**: the last comments of the PR's conversation tab, when it has any.

A comment reads as it does on GitHub: its body is GitHub-flavoured markdown — bold, italic, strikethrough, inline code,
lists (nested and numbered), quotes, code blocks (without syntax colours), tables, task lists (read-only), headings
sized for a comment, and horizontal rules; a single newline is a line break, as in a GitHub comment. A ```` ```suggestion ````
block shows under the label "Suggested change", its lines as added lines; an empty one says "Delete the lines". `@login`
and `@org/team` are links to the person or the team on GitHub, `#123` a link to that issue or PR of the PR's repository
and `owner/name#123` of that one; in code they stay text. An HTML comment `<!-- … -->` is hidden, as on GitHub. Any other
HTML is shown as text and never runs: GitHub's `<details>` or `<sub>` read as their tags. An image is not loaded: it
shows as a link with its alt text, which opens the image in the browser. The same reading applies to the comments a
draft reply answers and to the text of a sent reply; a draft's field holds its text as written.

Selecting a PR — a click, **↑** or **↓**, or an entry that names it — and **Mark seen** record that the user has looked:
"N new since you looked" goes. The PR the view selects by itself, and the first PR of a group a sidebar row asked
for, record nothing. Links open in the system's browser, never in the window.

### Search

A search bar stands under the heading: a scope menu, the field, **☆ Save** and **× Clear**, and a row of filter chips
under them. It finds any pull request the Project's GitHub account can see, not only those of the inbox.

- **The field** (`role="searchbox"`, "Search pull requests") takes words and GitHub's search qualifiers. **/** puts the
  focus in it from anywhere in the view but a text field; **Escape** takes the focus off it. **Enter** searches; typing
  alone never does. A blank field and Enter give the inbox back. Under the field the view says, before Enter, what
  GitHub would refuse: a search over 256 characters, or more than 5 `AND`, `OR` and `NOT`.
- **The scope menu**: **This Project** (the default) — the Project's repositories on GitHub; **Organizations of this
  Project** — every repository of the owners of those repositories; **All of GitHub** — everything the account can
  see. A choice searches there at once when the field holds text. A `repo:`, `org:` or `user:` typed into the field is
  the scope itself, and the view says the menu's scope was not added.
- **The filter chips**: State, Review requested, Author, Involves me, Label, Draft, Review status, Reviewed by me, Asked
  or reviewed. A chip writes its qualifier into the field (State → `is:open`, Review requested → `review-requested:@me`
  or `user-review-requested:@me`, Asked or reviewed → `review-involves:@me`, …) and searches. The field is the one source
  of truth: a chip shows the qualifier the field holds, whoever typed it, with its value (`Author: dev-ana`). Involves
  me, Reviewed by me and Asked or reviewed switch on a press; the others open a menu of their qualifiers and **Remove
  the filter**. Author offers Me and the authors of the rows shown, and **Type a login…**; Label offers **Type a
  label…**: both put `author:` or `label:` at the end of the field for the name to be typed.
- **The results** stand in the left pane in place of the groups: "Search · N results" (GitHub's count) and the name of
  the saved search it is, "Searched 3 min ago · Refresh", then the rows of the inbox's list, each with its approvals
  chip. The first result is selected by itself; **↑** and **↓** move as in the inbox; **Load more** asks GitHub for the
  next page. The results are a snapshot: no timer searches again, only Refresh. **× Clear** empties the field and gives
  the groups back. A search that finds nothing says "No pull requests match" and offers **Search All of GitHub**.
- **The selected result** opens in the same pane as a PR of the inbox. A PR of the inbox keeps its group's strip, and
  selecting it is a look, as in the inbox. A PR the inbox lacks is read in full when selected (main keeps it in memory
  while it does not move on GitHub; Refresh, and the window's focus once the read is over a minute old, read it
  again past that memory); it has no "N new since you looked", and a colleague's has the strip **Review this
  pull request**: who the author asked and how many approvals are left, and **Start review ▾**, which opens
  [Review mode](#review-mode). **Enter** on a result starts the review the same way; on a PR of your own it only
  selects it.
- **Saved searches**: the **▾** at the end of the field lists them, the two built-in ones first — "Review requested
  from me · All of GitHub" (`review-requested:@me is:open`) and "Reviewed by me · open" (`reviewed-by:@me is:open`,
  This Project) — then the user's, each with its text and scope; a choice runs it in its scope. **☆ Save** names the
  search in the field and keeps it with its scope; it reads **★ Saved** when the field and the scope are a saved search
  already. **Forget** in the same menu removes the user's own search the field is. At most 20 besides the built-in ones.
- **Notices** of section 10 of the spec stand above the results: a repository the account cannot see, a token not
  authorized for an organization's single sign-on (with **Authorize**, GitHub's link), results some organizations hide
  behind single sign-on, part of the results when GitHub timed out, the first 1,000 only, the search paused until a
  time by GitHub's rate limit (the search then runs again by itself at that time, unless another search or Clear
  comes first; a Load more it refuses keeps the pages shown), a refused sign-in (with **Open Health check**). GitHub's own words of a search it cannot
  parse (422) stand under the field instead, and the field is framed red until the text changes.

On a read-only screen of a Linked machine the search works through the Project machine, as reads do; **☆ Save** is
inactive with the hint, and Forget is not offered.

### Review mode

**Start review ▾** asks who writes the review. Its menu has **Review myself** ("You write the comments and choose the
verdict") and **Agent review** ("An agent drafts it; you edit and submit"). A click on the button itself takes the
Project's last choice on this machine, Review myself until one is made; when that choice is Agent review, the button
reads "Start review · Agent".

**The screen.** Review mode takes the place of the PR pane; the list folds into a column of 48 px with each PR's avatar
and number, and **← Inbox** (or **← Results** for a search) on top gives the list back. A PR picked in the column closes
Review mode and selects that PR. The head of the screen: `owner/repo#N` and the title, `main ← branch`, the head commit,
"N files · +a −d", the approvals chip, "Viewed N/M", **Refresh** and **Close**. Under it: **Inline** | **Side by side**,
**Wrap**, **Hide whitespace**, then the tree and the diff of [Changes](changes.md) for the PR, with the review threads
of GitHub on their lines. A file in the tree shows how many open threads and comments of the draft it has, and ✓ when
it is Viewed. **j** / **k** and **↓** / **↑** move along the files (not along the PRs), **n** / **p** along the hunks, **v**
marks the file Viewed or takes the mark off, **c** comments on the lines picked. **Escape** closes an open menu or comment first; the next one closes Review mode. The
draft stays. Another tab and back keeps the PR, its file and Show new commits. A PR that leaves the list (it left
the inbox on a read, or the search was cleared) closes Review mode, and the list takes its keys again.

**The draft.** Start review creates the review draft of the PR on its head when there is none: a file on
this machine, in the Project's Profile folder, never on GitHub. That first time main reads which files the account marked Viewed on github.com — one
GraphQL query, `viewerViewedState`, read only — and marks them Viewed in the draft, for at most the first 3,000
files. The draft waits until the files of the PR are read without an error: after a failed read (GitHub busy, a rate
limit) **Refresh** reads them and starts it. After that the marks live only in
worfy and are never written to GitHub. A mark belongs to the blob of the file's new side: a push that changes the file
shows it not Viewed again.

**Comments on lines.** The popover and the keys are those of the comments on lines of [Changes](changes.md), but the
comment goes into the review draft, not to a Session, and nothing goes to GitHub before Submit. **+** in the gutter of a
line, or **c** on the lines picked (a click picks a line, a click with Shift or a selection across lines picks a range),
opens it; the text is Markdown, **Suggest change** (new side only) adds a `suggestion` block with the text of the lines
picked, **⌘↵** saves. Images are not taken. A range covers lines of one hunk: GitHub refuses a range across hunks, so
such a pick shows a message and opens nothing. The lines are read without Hide whitespace and unfolded (a lock,
generated or too large file too). A popover with text not saved stays open on **Escape** and on a click outside; **Cancel**
closes it. A comment stands under its last line: "Pending · Edit · Delete", or "Written by the agent · Edit · Delete" for
the agent's; an edit makes the comment the person's. New comments are made only while the diff shows All changes of the
commit the draft is on: when the head moved past it, the comments are listed above the diff and stay on that commit's
lines. A comment on a line the PR's diff does not have (an agent took a wrong line), or on a range across hunks, stands in "Not on a changed line"
above the diff — GitHub would refuse it — with **Move to line** (the comment goes on the next line whose **+** is
clicked, or the lines picked with **c**) and **Delete**.

**The bar Your review** at the bottom: "Your review · 3 pending comments on 2 files", or "5 comments (5 by the agent) on
3 files" when the agent wrote some. **Discard**, inactive while the draft has no comment, asks "Discard 3 pending comments?" and then deletes the draft file and
closes Review mode; nothing was on GitHub, so nothing changes there. **Finish review** (or ⌘⇧↵) opens the dialog of
Submit review below; it is inactive while the Session of an Agent review writes ("Waits until the agent finishes or you
stop it").

**Finish review and Submit.** The dialog "Submit review to example-org/web#41" shows what will go, exactly:
- **Summary**, the text of the review as a whole;
- **Comment**, **Approve** or **Request changes**: it always starts on Comment. After an Agent review a line says "The
  agent suggests: Request changes — you choose". Approve and Request changes are inactive on your own PR; Comment and
  Request changes need a summary or a comment;
- "2 comments will be posted on 3f2a9c1, exactly as below": each comment with its file and lines and its text. A
  comment the agent wrote and the person did not edit says "by the agent". **Remove** keeps a comment out of this
  Submit;
- the check of the texts by `review-draft-lint` (workflow traces, AI signature, personal data, length): "Checked: no
  workflow traces, no AI signature, no personal data", or what it found — then Submit is inactive.

**Submit review** posts it only on a click or ⌘↵; Enter alone does not. One request goes to GitHub, as the Project's
GitHub account. When the head of the PR moved since the draft started, the dialog says "Your comments are on 3f2a9c1;
the head is 7d0e4b2." and the button becomes **Submit on 3f2a9c1**: the comments go on the lines they were written on. A
comment that is not on a changed line of that commit stops the whole Submit until it is removed or moved: GitHub would
refuse the review with it. GitHub took it: a toast "Review sent to example-org/web#41 · Approve · 2 comments", the PR is
read again (its approvals chip counts the approval), and Review mode closes; when GitHub had that review already,
the toast says "GitHub had this review of example-org/web#41 already: it is marked submitted, nothing was posted
again". Opened again, its bar says "You reviewed
this pull request · Approve" with **Open the review on GitHub** and **Start a new review**; the comments say
"Submitted · on GitHub". GitHub refused it: its reason in the dialog, the draft stays with all its comments, the
removed ones too. GitHub did not answer: the bar keeps "GitHub did not confirm the review: <reason>", and the texts that
went stay as they are — no edits, no agent, and the dialog opens on them, locked; the next Submit first looks whether
GitHub has the review. Within 5 minutes of the Submit, not finding it says "Not submitted: GitHub did not confirm the review, and it has
not listed it yet — try again in a minute"; later the same texts are posted. **Discard** still works there, and warns that the review may be on GitHub
already.

**The chip Review draft.** A PR with a draft of comments on this machine shows **Review draft** in its row of the inbox
and of the search results, with "3 pending comments, started on 3f2a9c1" in its tooltip. The draft survives quitting
worfy.

**New commits.** Review mode reads the PR again on entering, by **Refresh**, when the window gets the focus and the last
read is over a minute old, and every 2 minutes while it is shown and the window has the focus. When the head is past the
commit of the draft, a strip says "2 new commits since you started · you started on 3f2a9c1, the head is 7d0e4b2. Your
comments stay on the lines of 3f2a9c1." ("The head moved since you started" when the count of new commits is not
known.) Its comments are then listed above the diff with their lines.
**Show new commits** shows the diff since that commit (Since my review); **Show all changes** goes back. The commit of
the strip is the one the comments' lines are numbered on (`anchoredOn`, else `startedOn` of the draft).

**Agent review.** Start review → Agent review opens Review mode and starts the Session of the Agent review at once:
the Team reviewer of the Project (`/human-review`), else the review lenses of `/worfy:code-review`. Its comments appear
on their lines as it writes them. The bar at the bottom says "Agent is writing the review… · N comments so far" with
**Take over** and **Stop**; the person can read and write meanwhile. After it, the bar says "Your review · 5 comments (5
by the agent) · The agent suggests: Request changes" with **Take over**: the Session stops and its comments stay. A
person's draft has **Ask the agent to add comments** instead: a Session adds its comments and leaves the person's
comments and summary as they are.

**On a Linked machine** Start review is inactive with "Review on the machine of the Project". **View changes** opens
Review mode read only: the diff and the threads, "Read only" in the head, no Viewed, no draft, no bar, no **+**.

### Draft replies and Send

**Draft replies** on the selected PR starts a new Session Node of the Project on Claude Code, with a person, whose first
message is the Project's "Draft replies" template filled in with the PR (`/worfy:pr-reply owner/repo#N` by default).
The skill reads the PR, its diff and its open threads, and writes a draft reply for each thread that waits for an
answer into a file on this machine, in the Profile folder (`state/pr-inbox/drafts/`). It posts nothing. The row says
"A Session drafts the replies: they appear under their threads", or why the Session did not start.

**A draft under its thread.** The selected PR's drafts are read when it is selected, every 5 seconds while it stays
selected, and when the window gets the focus; no other PR's drafts are read. Each draft reply shows under its thread, or under **Conversation** for a reply in the PR's
conversation: its label (Needs code change, Needs answer, FYI, Resolved by push), `Edited` once the user changed it,
and the text in a field the user edits. A reply whose thread the PR does not list shows under "Replies to threads not
shown here". A plan for a code change, when the skill wrote one, shows under the field; it is never posted. Buttons:

- **Send** posts the text in the field, once. It is inactive while the field is empty.
- **Discard**: the reply will not be sent, and it leaves the view.
- **Ask the Session to rewrite** sends a message to the Session that **Draft replies** started for this PR in this
  window, asking it to rewrite that one reply. The message names a thread's reply by the thread's id, not only by
  its `path:line`, so two threads on the same line are told apart. Inactive when no such Session is known; when it has closed, the line
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
- "GitHub refused the sign-in: <reason>" and **Open Health check** when the read failed because GitHub refused gh's sign-in
  (no gh login for `github.account`, HTTP 401, gh without any token, an organization's SAML enforcement). The reason is the one
  of the Project's `GitHub access` row in Health check ([Gate and GitHub](gate-and-github.md#github-access)), which turns red at
  once and is checked again; the line follows the row. **Open Health check** opens Settings → Health. The next read that
  answers takes the row back to `ok`. A Project whose Profile names no `github.account` reads with gh's own account, and
  main logs why once per Project;
- the notice of the reader when it has one, for example "GitHub notifications unavailable for this token — checking
  every 5 minutes";
- "Mark seen failed: <reason>" when main could not record a look.

Before the first answer the view says "Reading pull requests…". A Project that reads no pull requests — the switch is off
in Project settings, or none of its repositories is on GitHub — shows one line saying so and no panes. A read without a
single PR shows, instead of the panes, a calm note: "No open pull requests and no review requests."

**Reading on opening.** Each time the view is shown — its toolbar tab, the palette command, a group of the sidebar
section, a notification or another entry, or another Project while the view is shown — main reads that Project from
GitHub at once instead of waiting for the next search, so a review comment left a minute ago is there without waiting
for the timer. While that read runs, the status line says "Reading pull requests…" and "Last read 3m ago" (the time of
the read before it) in place of the next search, and the rows of that read stay. To keep tab switches from spending the
rate limit, main skips that read when the Project was read less than 30 seconds ago, while its account waits for the
rate limit, while it waits after a failed read (the interval that doubles up to 30 minutes), and for a Project whose
switch is off. A read already running is not started twice: the view waits for it. The next search then comes 5
minutes after that read.

**Opening on one PR.** An entry can ask for one PR of a Project: the view of that Project opens with that PR selected,
its row scrolled into sight, and marked seen. When the inbox does not hold that PR, the view opens and says "This pull
request is not in the inbox: owner/repo#N".

**The sidebar section.** **Pull requests**, a section of the sidebar's rail. For each Project of the window's Machine that
holds a PR — of the active Project alone while the sidebar's Project switcher is on one Project:
its name, then a row per group that holds one, with the count. A Project that reads no pull requests, or holds none,
shows nothing. With nothing anywhere, the section says "No pull requests". A Project whose inbox cannot be read says why.
Its rail icon counts the pull requests that need you: Needs my review, Needs my answer and Needs a fix.

**The switch.** Project settings has **Read pull requests from GitHub**, on by default. Off, worfy runs no gh for that
Project's PR inbox, the view says so at once, and the sidebar leaves it out. Turned on again, the Project is read at
once, without waiting for the next search. The switch applies on Save, like the other fields of the window.

#### On a Linked machine

A window on a Linked machine shows the inbox of that Machine's Project, as that Machine read it; it never asks GitHub
itself. With Read only access PRs can be selected, but nothing is marked seen, **Mark seen** is inactive with the read-only
hint, **Resolve conflicts**, **Fix checks** and **Address comments** are inactive with it too, and the switch of Project
settings is inactive. Links open on the Machine where they are clicked.

Drafts and Send stay on the machine of the Project: a window on a Linked machine shows neither the drafts nor **Draft
replies**, and the channels of drafts and Send are refused to a Linked machine at any access level. So does the review
draft: Start review is inactive there, and Review mode opens read only through **View changes**.

### How it works

- Main reads GitHub, by Project, with the Project's GitHub account, only the Project's repositories: a search every 5
  minutes, then the details of the PRs that moved, their size (`additions`, `deletions`) among them. A conflict that a
  merge of another PR made, or a rerun of CI, does not move a PR on GitHub's side: such a PR is read again once its
  details are 30 minutes old, at most one page of 10 PRs per search. The same details carry the review rules of each
  PR's base branch: the PULL_REQUEST rules of its rulesets (the organization's too) and its classic branch protection,
  which GitHub shows only to an admin of the repository. From them main counts the PR's approvals: the latest approval
  of each reviewer who can push to the repository, not the author's, and not one of an older commit when the rule
  dismisses stale reviews; the number the branch asks for is the largest of its rules, unknown when GitHub gives a
  review decision but the account sees no rule. GitHub's own review decision wins over that count, and the groups
  still follow it. It computes the groups and the counts and sends the view a snapshot
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md), point 1). The view only draws it.
- The words of colleagues stay in main's memory. What the user has seen goes to the Project's data folder as ids, a
  commit and a time, never a text ([ADR-0005](../adr/0005-worfy-own-state-inventory.md), amended by ADR-0105).
- The renderer keeps one copy of each Project's inbox for the view and the section. It asks main again when main says
  the inbox changed, and when the Project's settings change, so the switch shows at once.
- Main reads one Project at a time: the timer's reads and the read a request asks for (a Project shown for the first
  time, or turned on again, or the view just opened: `prInbox.get` with `opened`) wait for each other in one queue.
- Drafts and Send: the four channels `prInbox.drafts`, `prInbox.saveDraft`, `prInbox.discard` and `prInbox.send` are
  `local`, so the link adapter refuses them to a Linked machine before any handler runs. Main writes into a draft file
  only the user's text (`edited`), a discard, the mark of a Send in flight and the reason a Send failed (both in
  `error`), and the sent mark, through a temporary file and a rename, and only while the file is still what it read —
  its text, and right before the rename its inode, size and modification time: a Session that wrote new drafts
  meanwhile is not overwritten. One change of a file at a time, so two clicks on Send post once
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md), points 2–6).
- Every entry that opens the view goes through one function. With a PR it leaves an ask; the view takes it once the
  snapshot is there, then clears it, so coming back to the view does not select that PR again.
- The pane is keyed by the PR: another PR starts with its own drafts, typed texts and scroll. The shell keeps every view
  mounted and hides the others, so **↑** and **↓** count only while this view is shown.
- The search: the view sends the field and the scope to main (`prSearch.run`); main builds GitHub's search strings
  (`is:pr`, `archived:false`, `sort:updated-desc`, and the scope's `repo:` or `org:` qualifiers, spread over several
  searches below 256 characters), searches with the Project's account and answers the rows in the shape of the inbox's,
  a row of the inbox taken from it. A result the inbox lacks is read by `prSearch.pull` when selected. The saved
  searches are `pr-searches.json` in the Project's data folder (`prSearch.saved`, `prSearch.save`, `prSearch.forget`).
  Nothing of it writes to GitHub.
- Review mode: the rows carry the PR's base branch and commit (`baseRefName`, `baseRefOid`), the subject of the diff
  with the head. Start review is `prReview.start` (`local`): a PR without a draft gets one on its head, and main reads
  the files the account marked Viewed on github.com once, with gh as the Project's account; a PR with a draft reads
  nothing. Viewed is `prReview.setViewed`; Agent review, Ask the agent to add comments, Stop and Take over are
  `prReview.agentReview` and `prReview.stopAgent`; an Agent review's writes come as `prReview.changed`. Which PR Review
  mode is open on lives in the renderer's store of the view (`review-store.ts`).
- Submit review (ADR-0112, the third write of main after ADR-0105's two): the dialog asks `prReview.check` (`local`)
  for the lint of its texts, 400 ms after they stop changing; Submit is `prReview.submit` (`local`). Main reads the
  draft file again and takes the shown texts, runs `review-draft-lint` over them (the Team reviewer's `lint.json` with
  `--untiered`, else the template's lengths), reads the PR (`GET repos/{o}/{r}/pulls/{n}`: its head, base and author), checks each
  comment against GitHub's diff of its commit (`pulls/{n}/files` at the head, else `compare/{base}...{commit}`), marks
  the draft `submitting` and sends one `POST repos/{o}/{r}/pulls/{n}/reviews` with
  `{commit_id, event, body, comments}`, `commit_id` the commit the comments are on (`anchoredOn`, else `startedOn`), as
  the Profile's `github.account`. A 4xx but 408 is GitHub's refusal; a 408, a 5xx, a lost connection or gh's timeout is "did not
  confirm", and the next Submit, before any other check, reads `GET …/reviews` for a review of that account on that
  commit with that body, given no earlier than the mark `submitting` (`submittingAt`) less 2 minutes, whose line
  comments (`GET …/reviews/{id}/comments`) are the draft's. None within 5 minutes of the mark — refused, the mark kept
  (GitHub may list a review late); none later — the same texts go through the checks and one POST, and only the mark of
  that POST replaces the old one. Main refuses changes of those texts (a comment saved or deleted, an Agent review).
  Never a review without `event` (a pending review on GitHub), never a second POST for one click.

### Implementation

| What | Where |
|---|---|
| The view: the list, the selected PR, threads, status line, ↑ / ↓ | `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/pr-inbox.css` |
| The renderer's copy of the inbox; the texts of a row; the Ticket of a PR; what to do next, the merge state and the size | `src/renderer/pr-inbox/usePrInbox.ts` |
| Opening the view, on one PR or one group | `src/renderer/pr-inbox/open.ts` |
| The sidebar section | `src/renderer/shell/sidebar/PullRequestsSection.tsx` |
| The tab and the view in the shell | `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/AppShell.tsx` |
| The palette row | `src/renderer/palette/commands.ts` |
| The switch | `src/renderer/shell/ProjectSettings.tsx`; the `prInbox` field of `src/shared/projects/action-templates.ts` |
| The channels `prInbox.get`, `prInbox.markSeen`, `prInbox.changed`, `prInbox.drafts`, `prInbox.saveDraft`, `prInbox.discard`, `prInbox.send` | `src/shared/ipc/pr-inbox.ts`, `src/main/ipc/pr-inbox.ts` |
| Draft replies under their threads, Send, Send all and its dialog, Draft replies | `src/renderer/pr-inbox/DraftThread.tsx`, `src/renderer/pr-inbox/PrInboxView.tsx` |
| Resolve conflicts, Fix checks and Address comments in the strip, and their toast | `src/renderer/pr-inbox/PrFollowButton.tsx`; whether one can run — `usePrFollowState` of `src/renderer/canvas/actions/gates.ts`; the reasons — `src/shared/actions/pr-follow.ts`; the channel `actions.prFollow` — `src/shared/ipc/actions.ts`, `src/main/actions/launch.ts` |
| The draft file, the check again and the one POST | `src/main/github/pr-reply-send.ts` |
| The reader and the groups | `src/main/github/inbox.ts`, `src/main/github/inbox-groups.ts` |
| The count of approvals; the approvals chip, its tooltip and the Approvals cell | `approvalsOf` of `src/shared/github/approvals.ts`; `src/renderer/pr-inbox/ApprovalsChip.tsx`, `src/renderer/pr-inbox/approvals-chip.css`; `approvalsChip`, `approvalsNote` and `reviewerText` of `src/renderer/pr-inbox/usePrInbox.ts` |
| What the user has seen; the switch as main reads it | `src/main/projects/pr-inbox-state.ts` |
| The search bar: the scope menu, the field, the chips, ☆ Save and the saved searches | `src/renderer/pr-inbox/SearchBar.tsx`, `src/renderer/pr-inbox/pr-search.css`; the search strings and the chips' qualifiers — `src/shared/pr-search/query.ts` |
| The results, their notices, Load more; the state of the search and the strip «Review this pull request» | `src/renderer/pr-inbox/SearchResults.tsx`; `usePrSearch` and `searchStep` of `src/renderer/pr-inbox/usePrInbox.ts` |
| The channels `prSearch.run`, `prSearch.pull`, `prSearch.saved`, `prSearch.save`, `prSearch.forget`; the search in main | `src/shared/ipc/pr-search.ts`, `src/main/ipc/pr-search.ts`, `src/main/github/pr-search.ts` |
| Start review ▾, Review mode, its column, the Project's last choice | `src/renderer/pr-review/StartReviewMenu.tsx`, `src/renderer/pr-review/ReviewMode.tsx`, `src/renderer/pr-review/review-store.ts`, `src/renderer/pr-review/pr-review.css`; the column — `src/renderer/pr-inbox/PrInboxView.tsx` |
| Comments on lines of Review mode, «Not on a changed line», the bar Your review and Discard, the chip Review draft | `src/renderer/pr-review/review-comments.tsx`, `src/renderer/pr-review/ReviewBar.tsx`, the popover — `src/renderer/changes/LineComment.tsx`; the drafts of the Project — `useReviewDrafts` of `src/renderer/pr-review/review-store.ts`; the chip — `PrListItem` of `src/renderer/pr-inbox/PrInboxView.tsx` |
| Start review in main: the draft, the files Viewed on github.com | `prReview.start` of `src/shared/ipc/pr-review.ts`, `src/main/ipc/pr-review.ts`; `viewedOnGithub` and `start` of `src/main/github/pr-review-draft.ts` |
| Finish review and Submit: the dialog, the check, the one POST | `src/renderer/pr-review/FinishReviewDialog.tsx`, `src/renderer/pr-review/ReviewBar.tsx`; `prReview.check` and `prReview.submit` of `src/shared/ipc/pr-review.ts`, `src/main/ipc/pr-review.ts`; `src/main/github/pr-review-submit.ts`; the lint — `harness/bin/review-draft-lint` |

Tests: `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-open.test.tsx`, `test/e2e/pr-inbox.spec.ts` (with the
screenshots of the two panes at 1280 and 1600 px in both themes); the reader
in `test/contract/pr-inbox.test.ts` and `test/unit/pr-inbox-groups.test.ts`; drafts and Send in
`test/contract/pr-inbox-send.test.ts` and `test/unit/draft-thread.test.tsx`; the search in `test/unit/pr-search-view.test.tsx`,
`test/e2e/pr-search.spec.ts` (with its screenshots at 1280 and 1600 px in both themes), `test/contract/pr-search.test.ts`
and `test/unit/pr-search-query.test.ts`; Review mode in `test/unit/review-mode.test.tsx`, `test/unit/review-comments.test.tsx`, `test/contract/pr-review-draft.test.ts`,
Submit review in `test/unit/finish-review-dialog.test.tsx`, `test/contract/pr-review-submit.test.ts`
and `test/e2e/pr-review.spec.ts` (with its screenshots at 1280 and 1600 px in both themes).
