# Concepts

The terms these pages use. They are the canonical English names, the same as in the interface, and they stay in
English in the Russian translation too. The source of the terms is [CONTEXT.md](../../CONTEXT.md), a glossary in
Russian that also lists the words to avoid. This page explains the main terms for a reader without Russian and does
not replace it.

## Canvas

A **Project** is the folder of one piece of the user's work: a git repository, or a folder above several
repositories. A Project has exactly one **Canvas**, an infinite plane on which **Nodes** lie. A Node is any object on
the Canvas: a Ticket, a Session, a Card, a Terminal and so on. The position and size of the Nodes are the **Layout**,
which is worfy's own state and not part of the workflow.

A **Derived Node** is a Node whose place worfy computes from the workflow: an Epic frame, a Ticket, a tree of
Subagents. A Ticket and a tree of Subagents cannot be moved by hand, and an Epic frame moves only as a whole. An
**Edge** is a line between Nodes, of one of three kinds: Blocked by (Ticket to Ticket), Binding (Session or Subagent
to Ticket or Epic) and Subagent (Session to Subagent). A **Family** is a Node and everything connected to it through
Bindings and the tree of Subagents. It is highlighted on hover and selection, and the Nodes do not move.

A **Card** is a small HTML app that an agent built. It belongs to the Project and not to a Session, so any Session of
the Project may change it. A **Terminal** is a Node with the user's interactive shell session; agents do not use it.
A **Browser** is a Node with a built-in Chromium browser: a site or web app open under one **Browser profile**. A
Browser is either **Live**, with the page running, or **Asleep**, with the last snapshot of the page in its place and
the page itself closed until it wakes. A Browser profile is a saved sign-in for one role, the cookies and site data.
The user signs in; Sessions arrive signed in and never see the passwords. It belongs to the Project and is kept on the
Machine.

The **Done shelf** is a row of chips under the visible Epic frames: an Epic whose Tickets are all done and whose frame
is collapsed stands there as a chip with its name and count. The **Archive** holds finished Sessions that worfy took
off the Canvas by itself: in the history of their Ticket or Epic or, without a Binding, in the "Archive" popover. It
deletes nothing, has no time limit and is not a trash folder. **Limits** are the used share of the Claude subscription
windows (5 hours and 7 days) and the time they reset.

## Workflow

An **Epic** is a set of Tickets for one goal, kept in the folder `.scratch/<epic>/`. A **Ticket** is one unit of work
in an Epic (`issues/NN-slug.md`), with the status `open`, `claimed`, `blocked` or `done` and a list of the Tickets
that block it. A **Wave** is the set of Tickets of an Epic that can be taken up in parallel right now: open, with all
blockers closed and no shared files. It is computed and stored nowhere; the numbered Waves in an Epic's `spec.md` are
a forecast, and the Wave actually taken up is computed again at launch.

A **Feature** is a capability of the product that a developer uses. It outlives any Epic and several Epics change it.
A **Feature page** documents one Feature or several close ones in their current state.

A **Pipeline** is the ordered list of **Stages** that every Ticket of a Project goes through, and each Project has its
own. Without configuration it is Queued, Implementing, CI, Agent review, Gate & merge, Closing, Done. A Stage is
computed from the Ticket's status, branch, PR and check marks and is stored nowhere. A status is not a Stage: one
`claimed` spans several Stages in a row, and `blocked` is a mark on any Stage.

The files of the workflow (Epics with their Tickets, HANDOFF, ADRs, lessons) are in the Project's **Workflow folder**.
A Project runs in one of two modes. In **Full mode** the Workflow folder is the root of the repository, and the files
are visible to everyone who works with it. In **Silent mode** it is a folder outside the repository, which the user
chooses when connecting the Project. Then nothing of the workflow shows in the repository: not in files and not in
branches, commits or PRs. A Project above several repositories is always in Silent mode. **HANDOFF** is the file in the
Workflow folder with a snapshot of the current state of the work: what is in progress, what is next and what waits for
the owner.

**Autopilot** is the mode in which the Waves of an Epic run without a person. worfy keeps the Machine awake, waits for
Limits to reset and continues from the same place; any point where a person was needed counts as a defect. The **Stable
copy** is a built copy of worfy outside the repository, from which Autopilot runs the Waves of worfy itself: on macOS
`~/Applications/worfy-stable.app`, on Windows the folder `%LOCALAPPDATA%\worfy-stable`. It is updated between runs. During
a run the agents of a Wave build and test the dev build in their worktrees.

The **Gate** is the check of whether changes are ready (`gate.mjs`), with the outcome green, red or could not verify. It
is separate from CI on GitHub. **Gate full** is the complete Gate on one Machine: lint, typecheck, all tests, e2e and a
check of the built app. Gate fast is the same without e2e and the build. Since
[ADR-0083](../adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md) a PR merges when its head commit has three things: the
green `ci-ok` check of CI on GitHub, the commit status `review` with `success` (the agents' review passed), and the mark
`check/windows` with `success` (the Windows verdict below). The documents PR that closes merged Tickets needs only `ci-ok`.
Gate full is a tool for the implementer and for analysing a failure. The **Windows verdict** answers
whether the change in a PR works on Windows. For each PR it is the `windows` job within `ci-ok`. For a platform PR that
touches what the GitHub runner does not check (Terminal, windows, menus, notifications, e2e, packaging) it is Gate full
on the owner's Windows PC. A scope script decides which one is needed, and that Gate full runs on `main` after the merge
([ADR-0086](../adr/0086-pc-gate-full-once-per-wave.md)).

## Agents

A **Session** is one conversation with Claude Code: one transcript that can be continued. On the Canvas a Session is one
Node, wherever it was started (worfy, a terminal, Claude desktop). The **Orchestrator** is the main Session of a Project,
the one work spreads out from; each Project has exactly one, pinned on the Canvas. A **Subagent** is an agent that a
Session started for part of the work, for example a scout, an implementer or a reviewer. It has its own transcript and
result, belongs to the Session that started it and may start Subagents of its own.

An **Interrupted** Subagent is one whose Session process ended before the Subagent finished; this is not a failure. A
**Background task** is work that a Session started and does not wait for within its turn: a Subagent, a Bash command with
`run_in_background` or a workflow script. It lives as long as the Claude Code process of its Session, and a
task-notification reports its end and starts a new turn of the Session. A Background task is not a Ticket.

A **Binding** connects a Session or a Subagent to the Ticket or Epic it works on. It is derived from signals in the
agent's work or set by the user by hand. A Session or Subagent has at most one Binding, and a Ticket may have several
(implementation, review, rework).

The **Harness** is the set of rules, skills, agents, scripts and hooks by which Claude agents carry out the work on a
Project: Epics, Tickets, Waves, the Gate and review. It includes qmd, the search over a Project's documents and Tickets.
worfy installs and updates it. The user's other personal skills, MCP servers and memory are not part of it. There is one
Harness on a Machine, and it runs each Project by that Project's **Profile**: how to check changes, where the Tickets are,
how branches and worktrees are named, the review lenses, the MCP servers available to agents, the GitHub account and the
mode. The Profile is entirely on the user's Machine and not in the repository. **User personalization** is the user's own
settings for the Harness, outside the plugin and the Profile and the same for all of their Projects: the language of
reports and personal rules.

## App and Machines

**Settings** are the settings of worfy itself on this Machine, and the window where they change. They are worfy's own
state, apply to all Projects of the Machine and do not go into a Project's repository or Profile. **Getting started** is a
list of six steps for a new user, from the First run checks to a Ticket of the Demo project taken through review and rework
to merge. The steps tick themselves off when done, and the list can be skipped and blocks nothing. The **Demo project** is
a Project that worfy creates itself for Getting started: a small local git repository without GitHub, in Full mode, with one
Epic and one Ticket. Agents really work in it, and one command deletes it along with its Profile.

A **Machine** is a computer of the user with worfy installed. More exactly, a Machine is tied to a worfy data folder, so
two installs with different data folders on one computer, such as a dev build and the Stable copy, are two Machines. A
Project lives on exactly one Machine, where its folder is and its Sessions, worktrees and Gate run. A repository connected
on two Machines is two Projects, each with its own Canvas.

A **Linked machine** is a Machine connected to this one by a 6-digit code. The link is two-way, and either side can remove
it (Remove). If access "Linked machines can work with my Projects" is on here (it is off by default), the Linked machine
sees this Machine's Projects and works with them: it opens the Canvas, writes to a Session, types in a Terminal and starts
Autopilot. All of that runs on the Machine of the Project.

## Terminal AI

**Terminal AI** is help from a Claude model in a Terminal, and the section of Settings that turns it on and off. It is not a
Session or an agent: it has no transcript, Node or Binding, it runs nothing and only proposes text for the input line. The
user runs the command. Its requests use up Limits.

A **Suggestion** is grey text in the input line that continues what the user is typing, from their command history or from
the model. The user accepts it whole or word by word, or hides it; until accepted it is not part of the line. A **Next
command** is a Suggestion on an empty line after a finished command. A **Command request** is a request in words for what to
do in the Terminal, answered by a command placed in the input line and not run. A **Fix** is an action after a command that
ended with an error: Terminal AI places a corrected command in the input line and does not run it.
