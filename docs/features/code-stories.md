# Code stories

A **Code story** is a short account of a finished change, written for the person who is responsible for the code. It
is made of **steps** (Story step): a key fragment of the diff with its key lines marked, what the code does, why it is
there, what breaks without it, the requirement it answers, and what the tests leave out. There are three kinds: the
**PR story**, which the implementer of a Ticket writes into its own PR; the **Epic story**, which a Subagent of the
Orchestrator writes before the last PR with code of an Epic merges; and the **story by the button**, which worfy builds
on request for a PR or an Epic that has none. worfy shows every kind in the **Story view**, where a person can ask about lines,
check their understanding and see which steps they have read. Terms are explained in [Concepts](concepts.md). The
Ticket card, the Epic frame and how worfy reads an Epic are on [Workflow](workflow.md); the story lies next to the
[Evidence](evidence.md) of a Ticket. The plan and the reasons are in the spec of the Epic,
[worfy-code-stories](../../.scratch/worfy-code-stories/spec.md).

A step is not a Card: a Card is a Node of the Canvas ([Cards](cards.md)), and a step is a part of a story.

## Code story

### Behaviour

**The file.** A story is Markdown that a person reads on GitHub and worfy reads in the Story view:

````markdown
# Code story — orders-export 04: Totals in cents

Kind: pr · Epic: orders-export · Ticket: 04 · PR: #212 · Language: en

## 1. What was wrong
…
- Requirement: [What happens](../issues/04-totals-in-cents.md#what-happens)

## 2. The total is summed in cents
Code: `src/cart.ts:12-19` · key lines: 15, 16
```ts
…
```
- What it does: …
- Why here: …
- Without it: not recorded
- Requirement: [What we do, item 1](../issues/04-totals-in-cents.md#what-we-do)
- Risks and test gaps: …
````

- **The title** is `Code story — <epic> <NN>: <title>` for a Ticket's PR, `Code story — PR #<N>: <title>` for a PR
  outside a Ticket, and `Code story — <epic>` for an Epic.
- **The header** has the fields `Kind:` (`pr` or `epic`), `Epic:`, `Ticket:` (two digits at least), `PR:`
  (`#<N>`, or `-` while the PR is not open) and `Language:`, the code of the Profile's `language.reports`. A story
  committed to a branch names no commit. A PR story made by the button has `Commit:`, the head of its PR; an Epic story made by the
  button names the head of each chapter's PR instead.
- **A code step** has one fragment, the line `` Code: `<path>:<from>-<to>` · key lines: <n> `` and those lines of the
  file copied exactly, and five fields, each a list item `- <label>: <text>`: **What it does**, **Why here**, **Without it**, **Requirement** (a link to a
  section of the Ticket or the spec) and **Risks and test gaps**. A field whose reason nobody wrote down says
  `not recorded`, never a guess.
- **A frame step** is text under a fixed title: **What was wrong** (first, with a Requirement), **What was deliberately
  not changed**, **How it was checked**, **What review found and what remains** (last), and in an Epic story **Seams
  between tickets**. Only the review step quotes fragments.
- **The order** is the order of explanation, not of files: what was wrong first, then the code steps, then what was
  not changed and how it was checked, and the review step last.
- **Check yourself** at the end is optional: two or three questions, each with an `Answer:` and the `Lines:` it rests
  on. Nothing depends on the answers.
- **The language.** With `Language: ru` the labels are Russian, with any other language English. `Code:`,
  `key lines:`, `done:` and `Ready:` stay English in every language.
- **The size** is a guide for the author: one to three code steps for a small PR, up to ten for a large one, five to
  ten main steps for an Epic. Nothing refuses a story by its size.

**An Epic story** has the sections `Start` (what the Epic set out to fix, with a link to its `spec.md`), one chapter per
PR headed `## PR #<N> · <NN> — <ticket title>`, the step `Seams between tickets`, `Summary` and `Check`. Its steps are
numbered through the whole story. A chapter whose PR is not merged has `PR -` in its heading and only
`Ready: no — <why>`. The Seams step lists what the Tickets handed to each other, one item per hand-off:
`- <NN> → <NN>: <what> · done: yes`, or `· done: no — <why>` for one nobody did.

**The three kinds.**

| Kind | Who writes it | When | Where |
|---|---|---|---|
| PR story | The implementer of the Ticket | The last step before `gh pr create`, after the Evidence lines | `<tickets root>/<epic>/stories/<NN>-<slug>.md`, in the same PR |
| Epic story | A Subagent of the Orchestrator, seen on the Canvas like any other | Before `land` merges the Epic's last PR with code | `<tickets root>/<epic>/story.md`, in the documents PR of that merge |
| Story by the button | An invisible request of worfy | Whenever a person presses **Code story** where there is no story file | `stories.json` in worfy's data folder of the Project, on the Project's Machine |

The implementer is asked for decisions and the evidence for them, not for a log of its reasoning. **Why here** holds
only what the Ticket, the spec, an ADR or the diff records: when the Ticket lists the file among its files, the step
says so, and the reason for a rule stays `not recorded` unless something records it. Who else calls the code, and a
motive, are never guessed.

**Full mode and Silent mode** ([Projects](projects.md)).

- **Full mode.** The PR story is committed in the Ticket's PR. Right after `gh pr create` the PR's description gets
  the section `## Code story` with the story's path and a link to it on the branch. The Epic story reaches the main
  branch in the documents PR, so in Full mode it reads on GitHub, on a phone too.
- **Silent mode.** The stories lie in the Workflow folder, and the branch gets nothing. The PR's description gets no
  link. `land` does not append the review step; the Orchestrator appends it in the Workflow folder. `land` copies an
  Epic story into the Workflow folder.

**`story-check`.** The Harness's script checks a story before it is committed and before a merge:

```text
story-check [--head <commit>] [--pr-head <N>=<commit>]... [--repo <dir>] <story>...
```

- It checks the title and header, the numbering of steps, one fragment and every field of each code step, that a
  Requirement is a link or `not recorded`, the order of an Epic story's sections and the form of each hand-off, and
  each fragment line by line against the code. It also looks for personal data with the rules of the privacy check of
  [Evidence](evidence.md#privacy-check), such as a host name, a user name in a path, an email or a token. Every line it
  prints is masked.
- **The code it compares with.** `--head` names that commit for every fragment. Without it, a story not committed yet
  is read against the working tree, and a committed one against `HEAD`. `--pr-head <N>=<commit>` reads chapter
  `## PR #<N>` of an Epic story against that commit, one per chapter.
- Without `--head` it refuses to run on the main branch: a story is checked against the head of its PR, so on the main
  branch that head is named with `--head`, as `land` does. It also refuses a committed
  story whose quoted file has changes that are not committed: "commit the code first, then check the story".
- **Output.** One line per problem, `<story>:<step>: <what is wrong>`, then `<story>: <N> fragments checked against
  <anchor>`, then `<story>: ok` or `<story>: <N> problems`. Exit 0 is green, 2 red with the list, 1 means it could not
  check (the reason on stderr) or a usage error.

**The switch `code_stories.pr`.** The PR story is on by default: the Profile field `code_stories.pr` is `"on"` or
`"off"`, and a Profile without it, or with `null`, reads as on; any other value reads as on, with a warning. In
**Project settings…** the switch **Code stories for PRs** writes the field at once, not with Save ("The implementer
writes a short step-by-step story of each ticket's PR. Saved in the Project's Profile at once; applies to the next
ticket."). How the switch writes the Profile is on [Projects](projects.md). Off, the implementer says "Code story
skipped: code_stories.pr is off" and `land` asks for no story. With the finish `local-green` there is no PR and no
story.

**The merge guard.** With the switch on, `land` does not merge a PR of its state file that names an Epic and a Ticket
unless its head holds exactly one story of that Ticket and `story-check --repo <repo> --head <head>` is green on it.

| What `land` finds | What happens |
|---|---|
| No story at the head | The PR waits red: `no Code story of ticket <epic> <NN>: <dir>/<NN>-<slug>.md is not in the head <short sha> (code_stories.pr is on)`; in Silent mode `is not in the tickets folder` |
| Two stories of the Ticket | The PR waits red: `ticket <epic> <NN> has <n> Code stories` |
| `story-check` exits 2 | The PR waits red with the first problem |
| The Profile cannot be read (`bin/profile` exit 1), or `story-check` cannot check | The PR waits, never merged |
| The checkout has no Profile (`bin/profile` exit 3) | No story is asked for |
| A PR without a Ticket; a documents PR | Not checked |

The story is read from the head of the PR, never from the working tree of the checkout; in Silent mode, from the
folder `ticket root` prints. In Full mode a story green at a head is not checked again for that head.

**The verifier.** The reviewer's lens on the implementer's report treats the story as a claim too: every statement of
it holds in the code, `story-check --repo <the PR's worktree> --head <head>` exits 0, and no field gives a reason in place of `not recorded` that
the Ticket, the spec, the diff and the report do not hold. A false statement is a finding of the same weight as a
defect in the code.

**What review found and what remains.** After the merge the documents PR of `land` appends this step last to the PR
story in the main branch, from the verdict file the Orchestrator gives it (`prs[].verdict`), without a model: the verdict
quoted as it is, and for each `path:<line>` it names, those lines of the merged head where they still hold what review
verified. A fragment with personal data is not quoted. A story without a verdict, one that has the step already, and
one already red at the merged head get nothing. Then `story-check --head <merged head>` runs on the story; red, the
documents PR waits red. In Silent mode `land` prints `review step of #N is the orchestrator's (tickets outside the
repository)`, and the Orchestrator appends the step in the Workflow folder.

**The Epic story and `land`.** `land` merges a PR, opens its documents PR and merges that in one run, so the
Orchestrator asks first: `land <state file> --epic-story` merges and writes nothing and prints, per Epic,
`epic story of <epic> is due: #N (<epic> NN) is its last PR with code`, or `is not due: tickets with code still open:
NN, NN`; exit 3 means the Tickets could not be read, and `land` then runs without the story. A Ticket with code is any
Ticket but one whose first `Who:` line names the owner (an owner's acceptance).
When it is due, a Subagent of the Orchestrator reads the PR stories, the spec, the verdicts and the heads of the PRs,
writes the story and checks it with `story-check --pr-head <N>=<head>…`. A PR merged before its Epic wrote stories
comes from its diff, and `Start` says so. The Orchestrator gives the green file to the Epic's last PR with code in the
field `prs[].files` of the state file. `land` copies it to `<epic>/story.md` in the same documents PR as the Ticket's `Status: done`,
before the privacy check `evidence-check`, which keeps the documents PR red on a finding. The story waits while
another PR of the Epic in the state file is not merged. A different `story.md` already there, or a symbolic link on
the path, is never overwritten: the documents PR waits red.

### How it works

- **The author writes it while the decisions are in context.** The implementer writes the story as its last step
  before the PR. The instruction asks for decisions and evidence, because the API refuses a request for a log of how
  the model thinks (`reasoning_extraction`).
- **Five rules keep the story honest.** Decisions and evidence instead of reasoning; `story-check` compares the
  fragments with the code; the verifier checks the statements; review's step is appended from the verdict; fixes after
  review go into the same branch, with the story updated and checked again.
- **A committed story names no commit.** It is committed in the PR it describes, so it cannot know its own commit;
  fixes after review change it, and a squash merge leaves the PR's head out of the main branch. Its fragments are
  checked against the head of the PR. On the main branch the commit is the one that added the story:
  `git log --first-parent --follow --diff-filter=A --format=%H -1 <main> -- <story path>`.
- **The guard is in `land`, not in the gate.** The gate runs on every head of a branch, also before the implementer
  has written the story; `land` is the one place a Ticket's PR merges, it knows the PR's Epic, Ticket and head, and it
  reads the switch itself, so the Orchestrator cannot forget it (Ticket 05 of the Epic).
- **The switch is a field of the Profile.** The Harness reads only the Profile; worfy's own settings of a Project do
  not reach it.
- **worfy only reads the stories.** The files are the workflow's, and worfy writes none of them
  ([ADR-0002](../adr/0002-worfy-is-a-view-over-the-workflow.md)); what it builds itself stays in its own data folder
  ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).

### Implementation

| What | Where |
|---|---|
| The format, the anchor, a Ticket with code | `harness/bin/TICKETS.md`, sections "Code story", "Story anchor" and "Ticket with code" |
| The shared cases of the format | `harness/bin/tests/fixtures/code-story/` |
| The check | `harness/bin/story-check`, with the rules of `harness/lib/privacy.cjs` |
| The implementer's step | `harness/skills/ship-ticket/story-pr.md`; named by `harness/agents/implementer.md`, `harness/skills/ship-ticket/implementer-finish.md`, `harness/skills/ship-ticket/implementer-silent-mode.md` |
| The section `## Code story` of the PR's description | `harness/skills/ship-ticket/step-8-pr-and-ci.md` |
| The field `code_stories.pr` | `harness/bin/profile`, `harness/profiles/draft.schema.json` |
| The switch in Project settings | `src/renderer/shell/ProjectSettings.tsx`, `src/main/ipc/code-stories-setting.ts`, `src/shared/ipc/code-stories-setting.ts` |
| The guard, the review step, `--epic-story`, `prs[].files` | `harness/bin/land` |
| The verifier's item | `harness/agents/reviewer.md` |
| The Epic story's agent and the Silent review step | `harness/skills/epic-wave/SKILL.md` |
| The eval of the implementer's story | `harness/evals/implementer-story/` |

**Data flow.** The implementer writes the story, runs `story-check` and commits it in its PR; step 8 links it from the
PR's description. The verifier checks it with the code. `land` checks it again before the merge, appends the review
step in the documents PR and, for the Epic's last PR with code, copies the Epic story there. worfy reads the files
from the main branch, or from the Workflow folder in Silent mode.

**Main tests.**

- `harness/bin/tests/story-check.test.sh`: every check of the format, a fragment that does not match, the anchors,
  `--pr-head`, the refusals on the main branch and for a quoted file not committed, personal data masked.
- `harness/bin/tests/land-story.test.sh`: the guard (on, off, no story, red, Silent, no Profile, an unreadable one) and
  the review step.
- `harness/bin/tests/land-epic-story.test.sh`: `--epic-story`, `prs[].files` byte for byte, the privacy check, a
  different story not overwritten, Silent mode.
- `harness/bin/tests/profile.test.sh`, `harness/bin/tests/profile-set.test.sh`, `test/contract/code-stories-setting.test.ts`,
  `test/unit/project-settings-shell.test.tsx`: the field, its default, the switch and its UI, read-only included.
- `harness/evals/implementer-story/`, run by hand and not in CI: an implementer on a training Ticket writes a story that
  passes `story-check`, invents no reason and is not refused by the API; `test/contract/harness-evals-story.test.ts`
  holds its form.

## Story view

### Behaviour

**Where it opens.** The Story view takes the whole main area of the window, as Run history does
([Flight Recorder](flight-recorder.md)). Esc goes back to the Canvas, and so does picking another Project in the
sidebar. With no story open it says "No Code story is open. A story opens from an Epic, a Ticket or a pull request."

**The entries.**

| Where | What it does |
|---|---|
| **Code story** on the Epic frame, beside the button of its archived Sessions | Opens the Epic's `story.md`; without one, builds the story of the Epic so far by the button |
| **Code story** in the Epic frame's **⋯** | Opens `story.md`; only while the Epic has one |
| **Code story** on a Ticket card, right of **Open PR** | Opens the story of the Ticket's PR; without one and with a `PR:` line, builds it by the button. Inactive, with the reason, on a done Ticket that names no PR; absent on a Ticket that is not done and has neither a PR nor a story |
| **Code story** of a pull request in [Pull requests](pr-inbox.md) | Opens the story of the PR's Ticket when the Tickets root has one; otherwise builds the PR's story by the button, or opens the one kept before. **Rebuild story**, once one is kept, builds it again |
| **Open code story** in the Command palette (group View) | A row per Epic with `story.md` and per Ticket with a PR story |
| The toast "The Code story of Epic <epic> is ready" with **Open** | Opens the Epic's story |

The toast comes the first time worfy sees an Epic's `story.md`, once per Epic, and stays until it is closed. The Epics
it was shown for are kept in the window's local storage, so a restart shows none again. The first time worfy reads a
Project it only notes the stories already there. A PR story gives no toast. When the story cannot be read, **Open**
shows the reason in an error toast.

**Screens.** A story shows one step per screen.

- A bar of segments on top has one segment per screen, current, read or unread; a click on a segment goes to that
  screen.
- A click on the right half of the screen goes forward, on the left half back. A click on a link, a button, a tab of the fields, the code
  block, the diagram of the Seams step or "Check yourself" does not turn the screen, nor does a click that ends a
  selection of text.
- The arrow keys turn screens too, and so do the edge buttons **Previous screen** and **Next screen**. The hint reads
  "← → · Esc Canvas".
- 760 px wide and more, the code is on the left and the text on the right; narrower, one column with the text first.

**A code step** shows its code block and its fields in the story's language: What it does under the title, the other
four as tabs. The code block numbers its lines and marks the key lines with a bold number and a bar at the edge, so the
mark is not a colour alone. There is no syntax highlighting. The code comes from git when the step is shown:

- **Where the code is read.** For a committed story in Full mode, the commit that added the story to the main branch
  (`HEAD` of the Tickets folder when origin's main branch does not resolve). In Silent mode, the merge commit of the
  story's PR, or its head before the merge; a story whose header still says `PR -` takes its PR from the Ticket's
  `PR:` line. For a story made by the button, the head of its PR, or the head of each chapter.
- The fragment is looked for by its code in that commit, nearest to the story's line numbers, and shown with that
  commit's line numbers.
- When the commit no longer holds the fragment in this form, the view shows the story's own code: "The code of the PR
  head: the main branch no longer holds it in this form." When git cannot read that commit: "The code as the story
  quotes it: git cannot read the code at this story's commit." When the read fails: "The code could not be read
  (<error>): shown as the story quotes it."

**An Epic story** has a row of chapters above the screens: Start, a chapter per PR (`#<N>`, or `PR -` for one not
ready), Seams between tickets, Summary, Check, and Check yourself when the story has questions. A chapter that is not
ready is one screen, "Not ready", with `Ready: no` and its reason.

**Seams between tickets** shows a small diagram: a box per Ticket the hand-offs name and an arrow per hand-off, forward
ones above the boxes and backward ones below. A hand-off nobody did is a red dashed arrow. The diagram has no pan and no
zoom. Under it the hand-offs are listed, each ending in "done" or "dropped — <why>".

**The story by the button.** Where there is no story file, **Code story** builds one.

- **What it is built from.** For a PR: its diff and its text, read with `gh`; the file of its Ticket when a Ticket's
  `PR:` line names the PR; and the review verdicts of the Project's own GitHub account (of the login of Pull requests when the Project names
  none), the last 20. For an Epic before
  its end: its spec and, per Ticket in order, the story of its merged PR with that PR's head; a Ticket without a PR or
  without a story is a chapter that is not ready, and `Start` ends with the list of those Tickets. An empty diff is
  refused: `PR #N changes nothing: its diff is empty.`
- **The progress bar.** On the Canvas it is a panel under the button, over the frame and the cards; in Pull requests it
  takes the button's place. It shows "Building story…", the last three lines of what the agent reads ("Starting…"
  before the first) and **Stop**. A build ends as "Stopped" ("No story was written."), "Not available" with the
  Vendor's reason, or "Failed" with the reason; **Close** clears the bar. On the Canvas Esc stops a build in
  progress; leaving the screen stops it anywhere. When it is done the Story view opens on the story.
- **Kept.** The story is kept in `stories.json` of the Project's data folder, by `owner/name#N` for a PR and
  `epic:<name>` for an Epic. Pressing **Code story** again opens it with no request. A stopped or failed build keeps
  nothing.
- **A colleague's PR.** The agent reads the colleague's text in its request, and worfy keeps none of it: not the PR's
  text, its comments or its title, which becomes `PR #<N>`. The PR is the user's own when its author is the login of
  [Pull requests](pr-inbox.md), or the Project's account when that login is unknown; an unknown author counts as a
  colleague.
- **On a Codex Project** the build does not start: the bar shows the reason "One-off requests (the Project profile
  draft, Terminal AI, a Code story) run on Claude Code only." ([Vendors](vendors.md)).

**A question about lines.** Lines selected with the mouse in a code block, or the whole fragment with **Ask a
question**, open a field after them: "Question about line N" or "Question about lines A–B", with **Cancel** and
**Ask** (⌘↩ or Ctrl+↩). Esc closes the field; the view stays.

- While the agent answers, a progress bar with "Answering…", its last lines and **Stop** stands in the field's place.
- The answer shows after the last line asked about: the question, what the answer rests on — **Code**, **Story**,
  **PR text**, **Review verdict**, or "no support" in the story's words — the agent's text, and the lines it quotes as
  `path:line`, with the commit in the tooltip.
- The agent gets the story, the PR's diff, its text and verdicts, the Ticket's file, the selected lines and the
  question, at most 2,000 characters. What cannot be read is left out, and the question goes on without it.
- Answers are kept in `stories.json` with the story and show again when it is opened. One asked about an earlier text
  of the story is marked "Asked about an earlier text of the story". A stopped or failed question keeps nothing. On a
  Codex Project a question does not start either.

**Check yourself.** A story with questions ends with the screen "Check yourself", marked "Optional": "Nothing depends
on the answers." Each question has a field for an answer in the person's own words, **I don't know** and **Check**
(⌘↩ or Ctrl+↩). The right answer stays hidden until one of them is given, then shows with the lines it rests on; a line that a
step of the story shows opens that step. A story without questions has no such screen.

**Read marks.** Every screen shown is marked read in the bar of segments. With a Project the marks and the answers of
"Check yourself" are kept in `stories.json` of worfy's data, never in the repository, so after a restart the story opens
with its read screens marked. A step's mark names its Ticket and its number in that Ticket's chapter, so a chapter of
an Epic story that becomes ready later moves no mark. Nothing depends on the marks.

#### On a Linked machine

A window that shows a Project of a Linked machine ([Link](link.md)) sends every call of the Story view to that Machine:
the stories, `stories.json`, `gh`, the Vendor and the checkout are its. Opening and reading a story, its code, its
answers and its marks are reading, open with read-only access. Building a story, asking about lines, keeping a read mark
or an answer of "Check yourself" and Stop are writing: with read-only access the link refuses them. The build buttons
are then inactive with the reason, and so is the switch **Code stories for PRs**, which still shows the value.

### How it works

- **The invisible agent is a `oneShot` of the Project's Vendor**, not a Session
  ([ADR-0094](../adr/0094-vendor-seam.md)). It runs in worfy's own folder outside every Project,
  `<WORFY_DATA_DIR>/terminal-ai`: a request whose working folder is inside a Project would become a Session of it and a
  Session Node on the Canvas. It keeps no transcript, reads the PR's checkout as an extra folder with Read, Glob and
  Grep only (the Claude driver refuses a read outside it and its own folder), cannot run git, so the diff comes in its text, and runs
  without the Harness plugin. Its answer has a JSON Schema; each line of what it does feeds the progress bar.
- **The material is not instructions.** The diff, the PR's text and the verdicts come from whoever wrote the PR; the
  request names them as what to explain, and reads nothing outside the checkout and its own folder.
- **A colleague's words are not kept.** Of a colleague's PR, `stories.json` holds the agent's story with its fragments
  of code, and not the PR's text, its comments or its title, as the PR inbox keeps no text of colleagues on disk
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md)).
- **One file per Project.** `stories.json` holds the stories made by the button, the answers, the read marks and the
  answers of "Check yourself". Each entry is read on its own, so one this build cannot read is kept but not shown; every
  write is atomic. The answers and the marks are kept by what the story names — its file, or its PR or Epic — so an
  edit of the story or a new build keeps them.

### Implementation

| What | Where |
|---|---|
| Reading the stories with the Epic | `src/main/workflow/watch.ts`, `src/main/workflow/reader.ts`, `src/shared/workflow/types.ts` |
| Parsing the format, the labels of both languages, the agent's answer | `src/shared/stories/parse.ts`, `src/shared/stories/labels.json`, `src/shared/stories/schema.ts` |
| The code of a fragment from git | `src/main/stories/code.ts` |
| `stories.json` | `src/main/stories/store.ts` |
| The invisible agent | `src/main/stories/one-shot.ts`, on `src/main/vendors/one-shot.ts` and the Claude driver's `src/main/vendors/claude/one-shot.ts`; the Codex refusal reason in `src/main/vendors/codex/capabilities.ts` |
| The story by the button | `src/main/stories/by-button.ts`, `src/main/stories/not-ready.json` |
| A question about lines | `src/main/stories/ask.ts`, `src/renderer/stories/LineQuestion.tsx`, `src/renderer/stories/story-answers.ts` |
| The channels | `src/shared/ipc/stories.ts`, `src/main/ipc/stories.ts` |
| The view, its screens and the Seams diagram | `src/renderer/shell/AppShell.tsx` (mounts the view), `src/renderer/stories/StoryView.tsx`, `src/renderer/stories/JunctionsDiagram.tsx`, `src/renderer/stories/stories.css`, `src/renderer/stories/open.ts` |
| The code block | `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/markdown.css` |
| The entries and the toast | `src/renderer/canvas/actions/EpicStory.tsx`, `src/renderer/canvas/actions/TicketStory.tsx`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/stories/story-toast.ts`, `src/renderer/stories/use-story-toasts.ts` |
| The build button and its progress bar | `src/renderer/stories/StoryBuildButton.tsx`, `src/renderer/stories/StoryProgress.tsx`, `src/renderer/stories/story-build.ts` |
| Check yourself and the read marks | `src/renderer/stories/SelfCheck.tsx`, `src/renderer/stories/story-marks.ts` |

**Data flow.** The watcher lets an Epic's `story.md` and `stories/*.md` through, and the reader lists them with the
Epic: where each is and a hash of its text. An entry opens the file through `stories.read`, which parses it; the view
asks `stories.code` for the code of each step it shows. **Code story** without a file calls `stories.make`: main reads
the material, runs the `oneShot`, keeps the answer and returns it, and the view opens it. A question goes through
`stories.ask`, a read mark through `stories.markRead`, an answer of "Check yourself" through `stories.selfCheck`, all
kept in `stories.json`.

**Main tests.**

- `test/unit/story-parse.test.ts` and `test/contract/workflow-reader.test.ts`, on the shared cases of the Harness:
  parsing, both languages, the reasons a file does not fit; the stories listed with the Epic.
- `test/unit/tickets-watch.test.ts`: which story files the watcher lets through.
- `test/contract/story-code.test.ts`: the code of a fragment in real git repositories, Full and Silent mode, a changed
  fragment and no anchor.
- `test/contract/story-one-shot.test.ts`: the invisible build — no Session Node, its folder, no transcript, read-only
  tools, Codex unavailable.
- `test/contract/story-by-button.test.ts`, `test/contract/stories-handler.test.ts`, `test/contract/story-store.test.ts`:
  the material of a PR and an Epic, a colleague's PR, a kept story and a rebuild, Stop, the folders a build may read,
  `stories.json`.
- `test/contract/story-ask.test.ts`, `test/unit/story-ask.test.ts`, `test/unit/line-question.test.tsx`: a question
  about lines.
- `test/unit/story-view.test.tsx`, `test/unit/story-entries.test.tsx`, `test/unit/story-toast.test.ts`,
  `test/unit/story-progress.test.tsx`, `test/unit/story-self-check.test.tsx`, `test/unit/markdown.test.tsx`,
  `test/unit/palette-commands.test.tsx`: the view, the entries, the toast, the progress bar, Check yourself and the
  read marks, the code block, the palette rows.
- `test/unit/link-access.test.ts`: which channels a Linked machine reaches with read-only access.
- `test/e2e/code-story.spec.ts` with a fake agent, and `test/e2e/a11y.spec.ts`: the view on a fixture Epic, every
  entry, a question about a line and the marks after a restart, a story by the button with no new Session Node.

## What is not there

- **A story of changes without a PR.** worfy builds a story only for a PR or an Epic: changes that are not in a PR yet
  get none.
- **"Ask the author".** There is no button that resumes the implementer to answer a question. A measurement asked five
  questions about lines of PR stories: a new request scored 19 of 20 and the resumed implementer 19 of 20, so the author
  was not better ([the measurement](../../.scratch/worfy-code-stories/measure-ask-author.md)). A question goes to a new
  request.
- **Read marks as a condition.** No acceptance asks for them.
- **A story in an app on the phone.** In Full mode the Epic story reads on GitHub.
- **Publishing a colleague's story.** It stays in `stories.json`; nothing of it goes to GitHub.
- **Syntax highlighting and a code editor.**
- **A story by the button or a question on a Codex Project.**
