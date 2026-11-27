# Assistant

The **Assistant** is worfy's own agent: one per Machine, over every Project of that Machine. It notices that work stands
or waits for the user, says why, and prepares the next step. By itself it does only a short closed list of internal
steps of worfy, such as continuing a Session after the Limits reset; everything else it proposes, and the user decides.
It writes no code, queues no Epic and posts nothing outside worfy. Each time it wakes it is a new Claude Code Session
outside every Project, with no Node on the Canvas. It is off until the user turns it on, for a new user and for one who
updated worfy alike ([ADR-0114](../adr/0114-assistant-app-session.md)). It is neither the Orchestrator, the main Session
of one Project, nor Terminal AI. Terms are explained in [Concepts](concepts.md).

## Turning it on and the introduction

### Behaviour

**The switch.** Settings → Assistant → General has the switch "Assistant on this Mac". Its description says the state:

- off: "Off. worfy runs no part of it: no wake, no check of a source.";
- on: "On. Only worfy’s own duties work until you turn a source on below." Next to the switch: "On since today, 09:12",
  "On since yesterday", the weekday within the last week, else the date ("On since 3 Nov"). An Assistant turned on
  before this line existed shows none until it is turned on again.

While it is off, nothing of it runs and nothing is spent: no wake, no check of a source, no Session, no card and no
system notification. Its section still lists what waits, and its box to write says "Assistant is off on this machine".

**The offer.** worfy offers the Assistant once per Machine, while the offer stands: the Assistant is off, has never
introduced itself, and the user has neither turned it on nor refused it.

- A new user meets it on the page "Meet Assistant" of [First run](onboarding.md#first-run), after the welcome page, with
  "Turn on and meet" and "Not now". Either answer goes on to the checks of First run.
- An existing user gets one notice in the corner: "New: Assistant, worfy’s own agent, tells you what waits across your
  Projects and why. It is off until you turn it on.", with "Meet Assistant" and "Not now". "Not now" refuses the offer
  for good. "Meet Assistant" opens the Assistant's section. A notice closed any other way does not come back.
- While the offer stands, a card "Meet Assistant" heads the Assistant's section, above the list, with "Turn on and meet"
  and "Not now".

The offer lists what the Assistant does (lists what waits, with the reason; continues Sessions after the Limits reset;
checks Slack and Jira in the work hours; answers questions about worfy) and what it never does (writes code or queues
Epics; posts outside worfy; changes settings without the user's Apply; starts a Session the user has not read). It says
that the Assistant uses the user's Claude Limits and that its share is at the foot of its section, as an estimate. It
names no price and no number of tokens.

**The introduction.** The first time the Assistant is turned on, by the offer or in Settings, it introduces itself in
its Chat, in the language of the Guide:

1. who it is: worfy's own agent on this Machine, over all its Projects, reading the Projects of a Linked machine only;
   what it tells of, what it does by itself, and that it answers questions about worfy from its feature pages;
2. which of Slack and Jira it sees connected in claude.ai, and for the others where to connect them (claude.ai →
   Settings → Connectors). It reads them only through those connectors and never asks for a token. When the connectors
   cannot be read, it says so;
3. a question about the work hours.

A «before → after» card "Set up Assistant" follows the last message: the work hours Monday to Friday, 09:00–18:00 in
this Machine's zone (unless the user chose them already) and the check of each source connected in claude.ai turned on.
Nothing changes until Apply. worfy writes the introduction itself, without a model, so it costs no tokens. An Assistant
that was on before the introduction existed is not introduced. If worfy closed after the Assistant was turned on and
before the introduction was written, it comes at the next start.

### How it works

The switch starts and stops the whole Assistant: the decision to wake it, the closed list of actions and the checks of
sources. The attention core, which collects the items, runs whether the Assistant is on or not, so the list is ready
when it is turned on. Turning it off stops a Session that is running and drops the wakes in the queue
([ADR-0114](../adr/0114-assistant-app-session.md)).

### Implementation

| What | Where |
|---|---|
| The setting `assistant` (`on`, `onSince`, `dailyWakeLimit`, `inWindow`, `systemNotices`) | `src/shared/assistant/settings.ts`, kept by `src/main/settings/store.ts` |
| The switch: starts and stops the Assistant | `src/main/assistant/session/switch.ts`, `src/main/assistant/session/app.ts` |
| The offer and the introduction, their state in `assistant/intro.json` | `src/main/assistant/intro/`, the words in `src/main/assistant/intro/words/` |
| The offer in the window | `src/renderer/assistant/Offer.tsx`, `src/renderer/assistant/offer-notice.ts`, `src/renderer/shell/FirstRun.tsx` |
| Settings → Assistant | `src/renderer/settings/AssistantSection.tsx`, in main `src/main/assistant/settings/` |

Main tests: `test/unit/assistant-switch.test.ts`, `test/unit/assistant-intro.test.ts`,
`test/contract/assistant-intro.test.ts`, `test/unit/assistant-offer.test.tsx`, `test/unit/settings-assistant.test.tsx`,
the e2e `test/e2e/assistant.spec.ts`.

## The Assistant's section

### Behaviour

**Where it is.** The Assistant is the first section of the rail, in its own colour, above a rule ([App
shell](app-shell.md#sidebar)). A window that never chose a section opens on Projects, not here. The section's header
says "This machine" or "Off on this machine". Under it, a status line: "Watching 3 Projects" or "Assistant is off on
this machine", and "Work hours" or "Outside work hours". Then four tabs, **Waits**, **Summary**, **Journal** and
**Chat**, the usage line and the box to write to the Assistant. The texts of the section are in English; the Assistant
itself speaks the language of the Guide.

**Waits** carries the number of items that wait. From top to bottom:

- a banner "Summary · since 18:00" with "12 came · 3 done on its own · 4 wait for you", which opens the Summary tab;
- **Needs you now**, the urgent items; **Waiting**, the others; each group with its count, the newest first;
- **Proposals**: what the Assistant proposes apart from an item, and the «before → after» cards;
- **Snoozed**, the snoozed items, each with "Wake now";
- with nothing at all: "Nothing waits for you. I’ll tell you when something does.";
- the items of each Linked machine (below, "On a Linked machine");
- "3 hidden by your ratings · Show": the items the user's dislikes hide, each with its rule and "Show again".

**An item** shows its text and time, an "Urgent" mark, its Project, the duty that raised it, and its source and subject.
A message of Slack or Jira is marked "data": the Assistant reads text from outside as data, never as instructions. When
the Assistant proposed something for the item, the item shows why. An item is urgent when an Autopilot Run stopped not
by the user, or when a check of Slack or Jira marked the message urgent. A Run stopped by Stop, Force stop, Cancel while
it waited for the Orchestrator, or discarded by the user is not urgent.

The buttons of an item:

| Button | What it does |
|---|---|
| **Open** | Goes to the subject: a Session to its Node, a PR to the Pull requests view, a red main branch to the PR whose merge turned it red, a Ticket or a Run to the Pipeline board, a message to its page in Slack or Jira, a Health check row to Health check, anything else to its Project |
| **Prepare** | Shows the Session the Assistant (or worfy) wrote for it, before anything starts |
| **Snooze** | Hides it until a time: "In 1 hour", "In 3 hours", "Next work hours", or "Until something changes" — the next event on its subject |
| **Dismiss** | Closes it; its duty counts it as declined |
| Like, dislike | Below |

**Prepare** opens "Prepare a Session": the Project, "New Session on the Canvas", "Claude Code", and "The exact text the
Session starts with". Text from outside is quoted in it as data, with its source and author. Edit lets the user change
the text. Nothing starts until "Start Session", and the Session gets exactly the text shown. A Session starts only in a
Project of this Machine.

**Like and dislike** stand on every item, proposal, journal row, message and summary. A like of an item says "Noted.
I’ll keep showing items like this from Work stands." A dislike of an item, or of a journal row it caused, removes the
item and says so: "Removed “…”. I won’t show items like this from Work stands. New rule in my memory: …", with Undo. The
rule hides the items of the same duty, source and kind in that Project; the Memory tab of Settings → Assistant lists the
rules, each with Delete. Taking a rating back undoes what it counted. Ratings of messages, proposals and summaries are
kept, and count for no duty.

**A «before → after» card** is a proposal to change the Assistant's settings: its title, why, and one row per setting
with its value now and its value after. "Nothing changes until you press Apply.", with "Not now" and "Apply". After
Apply the card says "Applied at 14:20.", with Dismiss and Undo. Undo puts each setting back as it was before Apply, and
the card shows Apply again; the journal gets a row "Undid the settings change" by You. When a setting of the card
changed since Apply, Undo changes nothing and names it: "Changed since Apply, so Undo would overwrite it: Slack
interval. Change it in Settings → Assistant". A card applied before Undo existed says "Change it back in Settings →
Assistant." instead.

A card may name the work hours, each check (on or off, its interval, whether it sleeps outside the work hours), the
daily limit of wakes, and for a duty whether it is on, its threshold and the mode of each action. It may not turn the
Assistant on or off, change the number that pauses a duty, or the Projects of a duty: those are the user's, in Settings.
A change that can never apply, such as a mode an action may not have, is refused when the Assistant proposes it, and
again on Apply.

**Summary** counts the last 16 hours over the Projects of this Machine, by worfy itself, without the model: how many
items came, how many things were done on their own, how many Runs stopped, how many items wait. Below: the morning
summary, the text the Assistant wrote on its morning wake; "By Project", one line per Project; "What to take first", the
first three items, each with Prepare or Open; and "Was this summary useful?" with like and dislike.

**Journal** lists what was done, newest first: the time, who ("worfy · no model", "Assistant" or "You"), what, and
"caused by" with the item that caused it. A click on that item shows it in Waits while it still waits. Filters: "All",
"Done on its own", "Your actions". The tab shows the last 200 rows; the journal keeps 14 days.

**Chat** is the conversation. The user writes at any moment in the box at the foot ("Ask Assistant, or tell it what to
change…"); Enter sends, Shift+Enter starts a new line. The answer comes when the Assistant's Session ends; until then
three dots show that it is writing. What the Assistant wrote on its own wakes (morning, batch, urgent) joins the
conversation too. The Assistant's messages here and its morning summary in Summary are rendered as Markdown, as a
Session's answers are: bold, code, lists, headings, tables and links that open in the browser. Raw HTML stays text and
images are not loaded. An http(s) link of a quoted Slack or Jira message opens in the browser too; when its text is not
its own address, the host it opens stands beside it, muted ("Approve (evil.example)"). Links of other kinds and file
links open nothing. The user's own messages stay plain text. The
user can ask it to change a setting: it proposes a «before → after» card, which stands among the
Proposals of Waits. The user can ask how worfy works: the Assistant answers from the feature pages bundled in worfy,
with a link to the page, may name a topic of the Guide (Help ▸ worfy Guide), and says it does not know when no page
describes it.

**The usage line** at the foot: "Today 25.8k tokens", the Assistant's share of the 5-hour window and of the week, and
the mark "estimate" (see "Wakes, the daily limit and usage").

#### On a Linked machine

A window that shows a Linked machine's Projects shows in this section only "Assistant works with the Projects of its own
machine. Open it there."

Waits of this Machine shows, for each Linked machine, a group "On PC · read-only": what its own Assistant shows now,
each item with its text, time, Urgent mark, Project, duty and source, and the mark "Read-only". The items have no
buttons: that Machine's Assistant keeps them. When the Machine gives nothing, a line says why: it is offline, its access
is off, or its build does not offer it to Linked machines. These items count nowhere else: not in Needs you now, the
summary, the tab's number, the cards or the system notifications. A Linked machine reads the items with the Read only
access level as well as with Full access, and not with Off ([Link](link.md)). It never gets the items of a local-only
Project such as the Demo project, or the items of no Project, such as the Limits.

### How it works

**Items.** The attention core in main turns events into Attention items: Sessions (a question, a permission, an error,
silence), Tickets that wait for a person or are blocked, PRs that need the user, the journal of Autopilot Runs, Health
check rows, the Limits, the CI of the main branch, the rules of Projects, and the checks of Slack and Jira. A repeated
event does not add an item, and the events of one subject on one day are glued into one item. "Nothing happened" is an
item too: a Session that ended its turn and stays silent 15 minutes. An item closes when its cause is gone (the user
answered the Session, the Ticket no longer waits, the PR left the groups that need the user). Items survive a restart of
worfy and are deleted 14 days after their last event. Each item belongs to the duty that shows it; an item no duty shows
is not in the list.

**The view.** main builds the whole view from the core, the duties, the proposals, the journal and the usage ledger; the
window only draws it and sends every click back to main. An item counts as shown to its duty only when the window really
shows it: in the open section on Waits, or on the speech card, and only while the Assistant is on. Snoozes, ratings,
the conversation (its last 200 messages) and what the speech card told of when it was last closed are in the section's
own file. Nothing here runs a model or sends anything out
of worfy. Every channel `assistant.*` is local to this Machine, except `assistant.waiting`, which a Linked machine reads
([ADR-0066](../adr/0066-read-only-access-for-a-linked-machine.md)).

### Implementation

| What | Where |
|---|---|
| The attention core: items, gluing, "nothing happened", states, storage | `src/main/assistant/core/`, the types in `src/shared/assistant/attention.ts` |
| The view and every click | `src/main/assistant/window/view.ts`, `src/main/assistant/window/app.ts`, the section's file `src/main/assistant/window/store.ts` |
| The proposals | `src/main/assistant/proposals/book.ts`, `src/shared/assistant/proposals.ts` |
| The «before → after» change, its rows, Apply and Undo | `src/shared/assistant/settings-change.ts`, `src/main/assistant/settings/panel.ts` |
| What waits on a Linked machine | `src/main/assistant/window/linked.ts`, `src/shared/assistant/linked.ts` |
| Channels | `src/shared/ipc/assistant.ts`, `src/main/ipc/assistant.ts` |
| The section in the window | `src/renderer/shell/sidebar/AssistantSection.tsx`, `src/renderer/assistant/` |
| Answers about worfy from the feature pages | `src/main/assistant/help/feature-pages.ts` |

Main tests: `test/unit/assistant-attention-core.test.ts`, `test/unit/assistant-attention-sources.test.ts`,
`test/unit/assistant-window.test.ts`, `test/unit/assistant-window-app.test.ts`, `test/unit/assistant-panel.test.tsx`,
`test/unit/assistant-linked-waits.test.ts`, `test/contract/assistant-two-machines.test.ts`,
`test/contract/feature-pages-in-build.test.ts`.

## Duties and Action modes

### Behaviour

A **Duty** decides what the Assistant shows and what it may do about it. The built-in duties:

| Duty | Its items | Threshold | Actions, mode by default |
|---|---|---|---|
| **Work stands** | A Session that is silent, waits or failed; an Autopilot Run that stopped, finished, set a Ticket aside, or hit an error or the Limits; a blocked Ticket; the Limits | 15 min | Open the item (Leave to me); Wake the Orchestrator, Continue the Session, Start Autopilot again (Ask me) |
| **CI of the main branch is red** | The main branch of a repository of the Project is red | 30 min | Prepare a Session that fixes the CI (Ask me); Open the item (Leave to me) |
| **Waits for you** | A question or a permission request of a Session, a Ticket that waits for a person, a PR that needs the user, a Health check row | 15 min | Open the item (Leave to me); Fix checks, Resolve conflicts or Address comments (Ask me) |
| **Morning summary** | The summary of the night | — | Write the morning summary (On its own) |
| **Slack**, **Jira** | The messages their checks bring | — | Open the item (Leave to me) |

The threshold is how long a Session stays silent or waits for an answer, or the main branch stays red, before the item
is shown. The process of one Project is not a duty of the code but a rule in that Project's settings: after a background
task whose description holds a given text ended, or after an item of a given source, kind or text, nothing on the same
subject for a number of minutes raises an item ("land finished, and the Orchestrator sleeps"). No screen edits these
rules yet.

**Action modes.** Each action of a duty has one mode:

| Mode | In Settings | What happens |
|---|---|---|
| `self` | On its own | worfy does it by itself and writes a journal row |
| `pre-approved` | Pre-approved | The same: choosing this mode is the user's "yes" given in advance |
| `ask` | Ask me | Nothing by itself: the item waits for the user, and the Assistant may propose the step |
| `hand-over` | Leave to me | The item is the user's; nothing is done or proposed |

Fix checks, Resolve conflicts and Address comments start a Session that works on the user's PR ([Pull
requests](pr-inbox.md)). They have only Ask me and Leave to me: the user always starts them. Every other action has all
four modes.

**What the actions of the closed list do.**

- **Continue the Session.** While the Assistant is on, a Session on the Canvas whose turn the Limits refused — not an
  Orchestrator and not a Session an Autopilot Run owns — waits for their reset, and its chat says "worfy: waiting for
  the Limits, they reset at 06:02". A message from the user ends the wait. With On its own or Pre-approved, worfy sends
  the Session a fixed text once the reset has passed ("Continue from where you stopped: the Limits refused your previous
  turn, and they have reset."). An Orchestrator is continued by Auto-continue instead ([Orchestrator
  modes](orchestrator-modes.md)).
- **Wake the Orchestrator.** With On its own or Pre-approved, an Orchestrator that is idle, has no background task
  alive, is not owned by a Run, is not waited for by Auto-continue, and whose Limits allow work gets a fixed text from
  worfy: the Limits allow work now; check the Subagents that stopped and continue each by SendMessage to the same agent.
  One Orchestrator is woken at most 6 times in 24 hours this way. When it stands again without starting a Subagent and
  without anyone writing to it, the closed list did not help, and the item wakes the Assistant at once, one time per
  item.
- **Start Autopilot again** only opens the Start Autopilot dialog; the user confirms or cancels it.
- **Prepare a Session that fixes the CI** gives the item a Prepare with a text worfy wrote. It starts only on Start.

**Settings → Assistant → Duties.** Each duty has its switch, its sources, its threshold ("After 15 min"), its counters
(Shown, Accepted, Dismissed, Ignored, Liked, Disliked) and the mode of each action, offering only the modes the action
may have. Work stands, CI of the main branch is red and Waits for you have "Projects": "All Projects", or a button per
Project of this Machine. A duty narrowed to some Projects does not show the items of other Projects, or of no Project;
when every Project it named is gone from worfy, it covers all Projects again. Unpicking the last Project goes back to
"All Projects".

**The pause.** After 5 ignored proposals or dislikes in a row a duty pauses ("Pause a duty after": the screen offers 3,
5, 10 or 20 in a row), and its items are not shown: "Paused at 14:20: its suggestions were ignored too many times in a
row. Its items are not shown.", with Resume. Only the user resumes it. A proposal is ignored when its item is still open
a day after it was first shown, with no reaction. A like, an Open, a Start or a Dismiss breaks the run. Dismiss counts
as declined.

**Memory.** Settings → Assistant → Memory lists the rules the Assistant wrote from dislikes: "It follows them; delete
one and its items show again."

### How it works

The closed list is code of main with no model. Every request, from main's own pass, from the Assistant or from the user,
goes through one door that checks, in order: the action is in the list; the item's duty shows it and proposes the
action; the mode lets this asker do it (On its own and Pre-approved anyone, Ask me only the user, Leave to me nobody);
the Session is alive, idle and not owned by a Run; the Limits do not refuse; the limit of wakes. It sends only its own
text, never one the Assistant wrote. Each call that does something, and each refusal the Assistant or the user asked
for, is a journal row with its item. main's own pass looks after every change of the items, the Limits, the waits and
the Mac's wake, and once a minute. Mode rules are checked where a mode is chosen, where the memory file is read, where a
change is proposed and applied, and where an action is run ([ADR-0114](../adr/0114-assistant-app-session.md), point 4).

### Implementation

| What | Where |
|---|---|
| The duties, their actions, modes and allowed modes | `src/shared/assistant/duties.ts` |
| Duties in main: what each shows and proposes, counters, pause, ratings, memory file `assistant/memory.json` | `src/main/assistant/duties/` |
| The rules of a Project (`assistantRules` of its settings) | `src/main/assistant/duties/rules.ts`, `src/main/projects/settings.ts` |
| The closed list, its texts, its journal `assistant/journal.json` | `src/shared/assistant/actions.ts`, `src/main/assistant/actions/` |
| The wait for the Limits of a Session on the Canvas | `src/main/assistant/actions/limits-waits.ts` |

Main tests: `test/unit/assistant-duties.test.ts`, `test/unit/assistant-closed-list.test.ts`,
`test/unit/assistant-settings-panel.test.ts`, `test/contract/assistant-settings.test.ts`.

## Checks of sources

### Behaviour

A **Check** reads a source on a schedule; what it finds becomes items. Settings → Assistant → General → Checks has one
row per source: its interval (5 minutes to a day), "Sleeps outside work hours" or "Keeps checking", and its switch.
"Each source is off until you turn it on. Slack and Jira are read through your claude.ai connectors." An Assistant that
is off checks nothing.

| Check | Interval by default | Outside work hours |
|---|---|---|
| Slack | 10 min | sleeps |
| Jira | 1 hour | sleeps |
| CI of the main branch | 10 min | keeps checking |

- **Slack**, through the claude.ai connector "claude.ai Slack": the messages since the last check that concern the user
  — a direct or group direct message, a mention of the user or their group, a reply in a thread the user started or
  wrote in, a message that names their Project. The user's own messages do not count. Urgent: a request for today, a
  deadline within the day, an outage, a red deploy, a blocker.
- **Jira**, through a claude.ai connector whose name holds "Atlassian" or "Jira": the changes since the last check in
  issues where the user is the assignee, the reporter or a watcher, and comments that mention the user. One item per
  change: a new issue, a comment, a change of status, assignee, priority, due date or another field. The user's own
  changes are not reported. Urgent: the issue blocks others or has the highest priority, or the change asks the user for
  something today. Open goes to the issue.
- **CI of the main branch**, of every repository of each Project on github.com, read with the GitHub account the Project
  reads its PRs with. It runs only while its switch and the duty "CI of the main branch is red" are both on. The branch
  is as red or green as its newest commit with a result; cancelled runs and the marks of agents (`review`, `check/*`,
  `deploy`) do not count. Once it has been red for the duty's threshold, an item comes; it closes when a check reads the
  branch green.

**Work hours.** General has "Work days", "Work hours" from and to, in half hours, and "Time zone" ("This Mac's zone" or
any zone). By default: Monday to Friday, 09:00–18:00 in the Machine's zone. Up to four windows are kept; the screen
edits the first and shows the others as text. A window that ends before it starts runs past midnight and belongs to the
day it starts. "Checks that sleep wait outside work hours. Urgent items still reach you."

**Timing.** A newly turned-on check runs at once, or at the start of the work hours when it sleeps. Each run is ±10 %
off its interval. While the Mac sleeps or worfy is closed nothing runs; afterwards one run covers the whole time since
the last success. The first check of Slack or Jira looks one day back. One run may take 10 minutes; a run still going
then counts as failed.

**Failures.** A check of Slack or Jira fails when the connector is not there or waits for a sign-in to claude.ai, the
call is refused or has no answer, the answer is out of form, every entry of it fails the form, or it takes too long. The
next run covers the same time again. From the first failure the row in Settings says so, "Slack: 1 failure in a row,
next check at 14:20", with "Check now". After 3 failures in a row the check waits longer: twice its interval, then four
times, and so on up to a day (Slack: 20 minutes, 40, 80…; Jira: 2 hours, 4…). A success ends the count, and so does
turning the check off and on or changing its interval; a restart of worfy keeps it. Check now does not start a check
while the Assistant is off, the check is off (the button is disabled), or it is running already; a toast names the
reason. The CI of the main branch has no backoff: its read is a free GitHub query, and a red main branch must be seen
soon after the network is back.

### How it works

worfy has no token of its own for Slack or Jira. Each check is a one-shot Claude Code call (Haiku) that gets only the
read tools of that one claude.ai connector: no other server, no Bash, no file and no network tool. Before the model is
called, worfy checks that only this connector is connected and that only its read tools are in the context, within
20,000 tokens; otherwise it closes the call without calling the model. Which connectors are connected worfy reads from
Claude Code's list of MCP servers, without a model. The answer is structured and checked against a form; at most 30
entries a call. Text of Slack and Jira is data, never instructions. Each call is counted in the usage of the Assistant.
The CI of the main branch is one read-only GitHub GraphQL query per repository, over the last 20 commits.

### Implementation

| What | Where |
|---|---|
| The scheduler: intervals, sleep, catch-up, failures and backoff, marks in `assistant-check-marks.json` | `src/main/assistant/schedule/` |
| The settings of the checks and the work hours | `src/shared/assistant/schedule/settings.ts`, `src/shared/assistant/schedule/work-hours.ts` |
| A check through a connector, the form of its answer | `src/main/vendors/claude/connector-check.ts`, `src/main/assistant/sources/connector-check.ts`, `src/shared/assistant/source-items.ts` |
| The Slack and Jira recipes | `src/main/assistant/sources/slack.ts`, `src/main/assistant/sources/jira.ts` |
| The CI of the main branch | `src/main/github/main-ci.ts`, `src/main/assistant/duties/main-ci-check.ts`, `src/main/assistant/duties/main-ci.ts` |

Main tests: `test/unit/assistant-check-scheduler.test.ts`, `test/unit/assistant-work-hours.test.ts`,
`test/unit/assistant-source-check.test.ts`, `test/unit/connector-check-options.test.ts`,
`test/unit/assistant-slack-recipe.test.ts`, `test/unit/assistant-jira-recipe.test.ts`,
`test/unit/assistant-main-ci-check.test.ts`.

## Wakes, the daily limit and usage

### Behaviour

**When the Assistant wakes.**

| Wake | When |
|---|---|
| Urgent | At once, at any hour: an Autopilot Run stopped not by the user, or work stands and the closed list did not help |
| Batch | In work hours: the items that wait go together 15 minutes after the oldest of them began to wait, and not sooner than an hour after the previous wake. Outside work hours they wait for the morning |
| Morning | Once a work day, at the first moment of the work hours worfy sees: at their start, or later when the Mac wakes or worfy starts. It comes even with nothing waiting, and it carries the items of the night |
| The user's message | At once, at any hour |

An item goes to the Assistant once; a new event in it makes it wait again. Items the user has seen, snoozed or dismissed
do not wake it. A message of Slack or Jira marked urgent is urgent in the list and in the notifications, but it waits
for the batch.

**The checks before a wake.** Before each wake that is not the user's message, worfy asks the Limits and the daily
limit. A wake that is not urgent waits while the 5-hour window is used above 80 % or a window warns; an urgent one waits
only while the Limits refuse. At most 20 wakes a local day are automatic ("Daily limit of automatic wakes", 1 to 200),
urgent ones included; the user's messages do not count. A held wake goes by itself when the window resets or at local
midnight. A wake counts once it goes, also when its Session fails to start.

**Settings → Assistant → Usage and limits**, for "Today" or "This week": the tokens, every call counted; the share of
each Limits window, marked "estimate", with how much of the window is used; rows for the checks of each source, the
wakes and the conversation; for today, each wake with its time, "urgent" or "batched" and its tokens; and the daily
limit, "Today: 3 of 20. Your own messages do not count."

### How it works

**The Session.** Each wake and each message of the user is a new Session of Claude Code, one at a time: a wake during a
Session waits for its end. It runs with the model `opus`, at most 40 turns and 15 minutes, in a folder outside every
Project, without `CLAUDE.md` and without the settings of a Project or of the user, and keeps no transcript. Its only
tools are those of the MCP server `worfy-app`: reading what waits (Projects, items, the workflow, PR threads, the tail
of a Session, Autopilot Runs, the Limits), searching and reading the feature pages, proposals, `action_run` for the
closed list and Start Autopilot, and notes in its memory. Its first message, written by main, names the reason, the
short record of each item handed over (at most 20; the others by id), its memory and the user's message.

**Reading the items.** `items_list` answers one page at a time: 20 short records by default, at most 50, urgent first,
then the newest, this Machine's items before the Linked machines'. A short record is the item's id, Project, source,
kind, state, urgency, duty, times, its subject (a PR's number, a Session's id) and its title cut to 300 characters. Each
answer carries `total` and `nextCursor`. The filters are `ids` (up to 50), `project`, `kind` and `state` (open by
default). With `ids` and `full: true` it answers the whole items: their text, link and the text of each action; `ids`
also finds an item no duty shows, such as a Session that ended its turn. An answer stays under 20 000 characters, well
below the 50 000 characters over which Claude Code saves a tool's result to a file and shows the model only its start:
the Assistant has no Read tool to open such a file. Its memory is the duties as the user set them, the rules from dislikes,
the open proposals, its commitments and the user's answers. Every answer of `worfy-app` has secrets removed. The Harness
gives this Session its own rules (`harness/hooks/rules/assistant.md`; [Skills, agents and
hooks](skills-agents-and-hooks.md)). The Assistant runs on Claude Code only, not on Codex.

**The estimate.** worfy sees only how much of a Limits window is used, never one call's part. It notes the cost of every
call of the Assistant and estimates its share as the window's use times the Assistant's part of the cost of all turns
worfy noted since the window began. The other turns are every turn worfy runs on Claude Code besides the Assistant's
own: the Orchestrator, Session Nodes, Autopilot's Sessions, Product Sessions and their narrator, Terminal AI, the
profile draft and Code stories. Each turn is noted once, at what it cost: a resumed conversation goes on from the cost
Claude Code restores for it, after a crash, a relaunch or a restart of worfy alike. The estimate errs high by Claude
used outside worfy, and by a Linked machine on the same Claude account: each Machine counts only its own turns. It errs
low when worfy counts a conversation's past again: when it is resumed after more than 8 days without a turn, or when
Claude Code restored only part of its total.

### Implementation

| What | Where |
|---|---|
| The decision to wake, its file `assistant/wake.json` | `src/main/assistant/wake/` |
| The check before a wake | `src/main/assistant/budget/wake-gate.ts`, `src/main/agent/limits-gate.ts` |
| The usage ledger `assistant/usage.json`, the estimate | `src/main/assistant/budget/ledger.ts`, `src/shared/assistant/budget.ts` |
| The cost of the other turns, noted once each | `src/main/agent/turn-cost.ts` |
| The Session of the Assistant | `src/main/vendors/claude/assistant-session.ts`, `src/main/assistant/session/` |
| The MCP server `worfy-app` and its rules | `src/main/mcp/app-server.ts`, `src/shared/assistant/app-tools.ts`, `src/main/mcp/agent-instructions-app.md` |

Main tests: `test/unit/assistant-wake-planner.test.ts`, `test/unit/assistant-wake-loop.test.ts`,
`test/unit/assistant-wake-gate.test.ts`, `test/unit/assistant-usage-ledger.test.ts`,
`test/unit/assistant-session.test.ts`, `test/unit/assistant-session-options.test.ts`,
`test/contract/assistant-session-claude.test.ts`, `test/contract/worfy-app-tools.test.ts`.

## Notifications

### Behaviour

The Assistant's notifications are its own, apart from worfy's toasts at the right edge and its usual system
notifications ([Notifications](notifications.md)). Both kinds come only while the Assistant is on.

- **In the window**, a speech card next to the Assistant's rail icon, at the left edge, in its colour: an item with
  Open, Prepare, Snooze, like and dislike. One card at a time; the icon shows how many more wait ("+2"), or without a
  card how many items wait. No card while the section is in front. Settings → Assistant → General → Notifications →
  "In the window": "Urgent and batched" (by default), "Urgent only" or "None: the list only". The number on the icon
  and the list stay with any choice. Open, Prepare, Snooze, like and dislike act on the item shown and count as seeing
  it: the card goes on to the next item that is new since its last Close, or closes.
- **Close** (×) closes the card as a whole. Every item it would tell of then counts as told by the card, as the card
  showed it; the items stay in the list in their state, and the icon still counts them — Close is not Dismiss. The
  card shows again only for what comes after: a new item, a new event on an item (one that came while the card was on
  screen too), or an item that turns urgent. What the card told of is kept in the section's own file, so a restart or
  an update does not bring the backlog back. Escape closes the card the same way, but only with the keyboard focus in
  the card or on the Assistant's rail button; anywhere else Escape stays with the Canvas, Focus mode or the field. A
  click outside the card leaves it as it is.
- **The backlog line.** Until the card is closed for the first time, a backlog of several items is one line, "N
  waiting in Assistant", with the link to the section, not its oldest item; one Close clears it. An urgent item is
  never folded into the line: the card tells of the first urgent one, with "N more in Assistant" under it.
- **System notifications**, while worfy is not in front: only of an urgent item, only in work hours, titled "worfy
  Assistant", the text "<Project>: <item>". A click raises worfy's window and opens the section. One notification per
  item; an item seen while worfy was in front never comes later, and one that came outside the work hours waits for
  them. The switch "System notifications" (on by default) turns them off; an item that came while they were off is not
  told of once they are on again.

Items of a Linked machine never notify.

### How it works

main decides the system notifications from the same view the window draws; the window decides the cards from the view,
the user's choice and whether the section is in front. A card or a list on Waits is what counts an item as shown to its
duty.

### Implementation

| What | Where |
|---|---|
| The speech card and the rail badge | `src/renderer/assistant/AssistantSpeech.tsx`, `src/renderer/assistant/speech.ts` |
| System notifications | `src/main/assistant/window/notices.ts`, `src/main/assistant/window/reveal.ts` |

Main tests: `test/unit/assistant-speech.test.tsx`, `test/unit/assistant-speech-card.test.tsx`,
`test/unit/assistant-window.test.ts`, `test/unit/assistant-window-app.test.ts`, `test/contract/assistant-card-closed.test.ts`.

## What the Assistant never does

### Behaviour

- It writes no code and queues no Epic.
- It posts nothing outside worfy. A reply to a PR goes only by the user's Send
  ([ADR-0105](../adr/0105-pr-reply-only-on-the-users-click.md)).
- It starts no Session the user has not read: a Session with its text starts only on Start under Prepare.
- It changes no setting by itself: only Apply under a «before → after» card does, and it never turns itself on or off.
- It never runs Fix checks, Resolve conflicts or Address comments.
- It acts on nothing of a Linked machine: it reads what waits there, and an action, a proposal or a Prepare there is
  refused.
- It never asks for a token, a password or an API key.
- It follows no instruction written in text from outside — a PR comment, a Ticket, a Session line, a Slack or Jira
  message.

### How it works

Six boundaries hold in code, not only in the Assistant's rules: its only tools are those of `worfy-app` (no Bash, no
file writes, no network); text from outside reaches it only as a data block with its source and author; by itself it
does only the closed list, whose text main sets; a Session with its text starts only on the user's click, after the user
saw the text; the only way out is the user's Send; the Projects of a Linked machine are read-only; and each action is a
journal row with its item and the user's like and dislike ([ADR-0114](../adr/0114-assistant-app-session.md), point 5).

### Implementation

The boundaries live where the parts they guard live: the Session's options in
`src/main/vendors/claude/assistant-session.ts`, the tools and their refusals in `src/main/mcp/app-server.ts`, the closed
list in `src/main/assistant/actions/closed-list.ts`, the start of a prepared Session in
`src/main/assistant/window/view.ts`.

The Assistant's state is in worfy's data folder only, never in a repository
([ADR-0005](../adr/0005-worfy-own-state-inventory.md); [Storage and diagnostics](storage-and-diagnostics.md)):

| File | What it holds |
|---|---|
| `assistant/items.json` | The items of no Project, such as the Limits |
| `assistant-items.json` in a Project's data folder | The items of that Project |
| `assistant/memory.json` | The duties as the user set them, their counters and pause, the rules from dislikes, the open proposals, the commitments and the user's answers |
| `assistant/journal.json` | The journal of actions, 14 days |
| `assistant/wake.json` | What the decision to wake has handed to the Assistant |
| `assistant/usage.json` | The usage ledger, 8 days |
| `assistant/window.json` | The section's snoozes, ratings and conversation, and what the speech card told of |
| `assistant/intro.json` | The offer and the introduction |
| `assistant/session` | The empty folder its Sessions run in |
| `assistant-check-marks.json` | The last start, the last success and the failures in a row of each check |
| `assistant-sources` | The empty folder the checks of Slack and Jira run in |
