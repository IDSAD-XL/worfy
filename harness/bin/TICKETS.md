# Glossary of tickets and epics

The language of `epic-status`, `epic-board` and `ticket`. It lives here, not in a repository's
`CONTEXT.md`: `CONTEXT.md` is the glossary of the product domain (`Lot`, `Bid`, `Deal`), and
`Ticket` would stand there next to `Lot` as an equal, which it is not. This is the language of the
process, not of the product.

**Ticket**
A unit of work. The file `<repo>/.scratch/<epic>/issues/NN-slug.md`.
A ticket's identity is the pair `(epic, number)`; the slug is not part of it, so renaming the file
in a branch does not create a second ticket. Two files with one number in one epic are not a
duplicate ticket but a data error: two places took one number.
_Avoid:_ issue, task

**Epic**
The ticket folder `.scratch/<epic>/`, sometimes with a `spec.md` or `map.md`. Not the same as a
product epic: it is the folder that holds a coherent batch of work.

**Header**
The lines at the top of a ticket file, one fact per line, no bold. `bin/ticket` is the only writer
of the status lines; `epic-status` is their reader.

```text
Type: task
Status: blocked 2026-10-17T09:41Z
Blocked reason: waits for the Stripe test keys
Waits: owner
PR: #412
Branch: checkout-flow/05
Repo: api
Blocked by: 03, 04
Source: …
```

- `Status: <open|claimed|blocked|done> <time>` — the time is ISO 8601 UTC to the minute. A migrated
  ticket keeps a date without a time (`2026-10-16`, read as 00:00 UTC); `open` may have no time.
  The first Status line outside a code block, and the only one in the file.
- `Blocked reason: <text>` — only while `blocked`; `ticket block <epic> <NN> <reason>` writes it.
- `Waits: owner | team | agent | <machine name>` — who the ticket waits for (`team` — other people,
  for example reviewers). `ticket block … --waits <who>` writes it; `claim`, `open` and `done`
  remove it together with `Blocked reason:`.
- `PR: #<N>` — `ticket done … --pr N` (Full mode; Silent mode has no `--pr`), or `ticket pr <epic> <NN> #N` when
  the PR is open.
- `Branch:`, `Repo:`, `Type:`, `Blocked by:`, `Source:` — as before. `ticket claim … --branch B --repo R` writes
  `Branch:` and `Repo:`; the name of a repository comes from `_resolved.repos` of the profile.
- `Roles: <role>, <role>` — optional: the roles whose Browser checks the ticket needs (for example
  `Roles: admin, user`); a role is the name of a Browser profile. No script reads it: skill
  `epic-wave` copies it into the brief's `Browser roles` line, and without it the brief says
  `Default`.
`Blocked reason:`, `Waits:`, `PR:`, `Release:` and `Repo:` are read only in the header: up to the first `## `
heading after the Status line. A `PR: <url>` line of a result section is not the ticket's PR.

**Ticket of several repositories**
A ticket of a project of several repositories that changes more than one of them: a library and its
consumer, for example. Its header names each repository on a `Repo:` line; the ticket of one repository, or of none
named, keeps the lines above as they are, byte for byte.

```text
Status: claimed 2026-11-10T09:00Z
PR: lib#41
PR: app#118
Release: lib tag lib-v1.4.0
Branch: fix/lot-withdraw-flag
Repo: lib
Repo: app
```

- `Repo:` — a line per repository, a name from `_resolved.repos` of the profile. The order of the lines is the
  order of merge: the library first, its consumers after it. `ticket claim <epic> <NN> --repo lib --repo app`
  writes them in the order of the arguments; a later claim with `--repo` replaces the set. A name given twice is
  refused.
- `Branch:` — one line: one branch name in every repository of the ticket.
- `PR: <repo>#N` — a line per PR, with the name of its repository: PR numbers of two repositories may be equal.
  `ticket pr <epic> <NN> <repo>#N` writes it when the PR is open, and replaces the line of that repository where it
  stands. A bare `#N`, or a repository that is not a `Repo:` line of the ticket, is exit 2 and nothing is written.
  `ticket pr` does not touch the Status line.
- `Release: <repo> tag <tag>` or `Release: <repo> package <name>@<version>` — what a consumer waits for: a tag of
  the library repository, or a published version of its package. `ticket release <epic> <NN> <repo> tag <tag>`
  (or `… <repo> package <name>@<version>`) writes it; there may be several lines, and the same line is written once.
  `<repo>` is a `Repo:` line of the ticket. These two kinds are the only ones: any other kind, a tag git would refuse
  as a name, or a package without `@<version>` is exit 2 and nothing is written.
- `ticket done <epic> <NN> --pr <repo>#N` — `--pr` once per PR. `done` writes `Status: done` only when every
  `Repo:` line has its `PR:` line — given in this call or written before by `ticket pr`; otherwise exit 2, the
  missing repositories named, and nothing written. A bare `--pr N`, two PRs of one repository, or a repository
  outside the `Repo:` lines are exit 2 as well. There is no status of its own for a ticket merged in some of its
  repositories: it stays `claimed` until the last PR is merged.
- `claim`, `open` and `block` keep every `PR:` and `Release:` line. The group lines stand after Status in the order
  `Blocked reason:`, `Waits:`, `PR:`, `Release:`; `Branch:` and `Repo:` stay where they are.
- `ticket evidence … --repo R [--sha S]` binds an Evidence line to a commit of repository R, a `Repo:` line of the
  ticket: the ref starts with `[R] `, and without `--sha` the sha is the HEAD of R's checkout (`_resolved.repos`), not
  of the working directory. The grammar of the line is the same (below): the repository is part of the ref.
- `ticket mark` puts a commit status into the repository whose checkout holds the marked commit; a commit of
  none of them is refused. In Silent mode a mark goes to the marks file, as for a ticket of one repository.
- Paths in the trail section of the ticket (the heading `tickets.trail_section` of the profile) start with the name
  of the repository: `app/src/lots.ts`. Otherwise `src/index.ts` of two repositories looks like one shared file.

The header may stand before the title or after it. The title is the first H1 on any line: `#`, a space
or a tab, then the text, with trailing spaces and tabs dropped. Lines inside ```` ``` ```` and `~~~`
code blocks do not count, nor do `##` and `#word` lines; a byte order mark at the start of the file is
skipped. A code block opens with three or more `` ` `` or `~` and closes only with a line of the same
character, at least as long, with nothing after it: a `~~~` line inside a ```` ``` ```` block is text of
the block. The same code blocks hide `Status:` and the other header lines; `ticket` and `epic-status`
take them from one rule, `lib/code-fence.cjs`. A file without an H1 has an empty title, and worfy's card shows the slug of the file name
instead. worfy reads the H1 of `spec.md` by the same rule; both readers are tested on the files of
`bin/tests/fixtures/ticket-title`.

**Evidence**
What proves an item of the ticket's "done" section and where it was checked: a nested list item under the
item, one fact per line. The section is the heading `tickets.done_section` of the profile (`## Done when`
without one), the manual mark `tickets.manual_mark` (`manual`); the old Russian heading and mark are read too,
for one release. `lib/evidence.cjs` holds the grammar and the state rules; `bin/ticket` is the only writer.

```text
- [x] Unit test of the chat command
  - evidence: test-run pass · `pnpm test test/unit/chat.test.ts` exit 0 · mac dev · 3f2a1b9c
  - evidence: review pass · PR #1190 · - - · 3f2a1b9c
- [ ] (manual) The canvas on the PC
  - needs: windows stable
  - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
```

- `- evidence: <kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <YYYY-MM-DD>]`, the fields split
  by ` · `.
- `kind`: `commit`, `test-run`, `ci-check`, `gate`, `review`, `screenshot`, `video`, `owner-check`. `verdict`: `pass` or
  `fail`, for every kind; a reviewer's `VERIFIED` is written `pass`, `REJECTED` — `fail`.
- `ref`: free text without ` · ` and on one line: a command with its exit code, `PR #N`, a URL, a path in
  backticks relative to the ticket file.
- `platform`: `mac`, `windows`, `linux`, `ci` — the platform, never a host name. `copy`: `stable`, `installed`,
  `dev`, `ci`, or `-` when no app was run. `commit` and `review` always have `- -`; `screenshot`, `video` and
  `owner-check` name the copy.
- `sha`: 7 to 40 hex digits, the commit the fact is bound to. `scrub: <date>`: a person checked the pixels of a
  screenshot, or every frame of the contact sheet of a video.
- A `video` is a clip, `.scratch/<epic>/evidence/<NN>-<what>.webm` (or `.mp4`), its path in backticks in `ref`:
  no longer than 60 s, no bigger than 8 MB (8 × 1024 × 1024 bytes), without sound. Next to it lies its contact
  sheet `<NN>-<what>.sheet.png`: one PNG, a frame for every second, which is what is checked by eye before
  `scrub:`; the clip is watched when the sheet raises a question. `bin/evidence-check` reads every element and box
  of the container but the frames (webm and mkv; mp4, mov and m4v — all five are clips to it) and finds text in
  them (in UTF-8 and UTF-16, joined across neighbouring elements), a track of sound, a track of subtitles or data,
  metadata compressed inside the clip, a clip over 8 MB, over 60 s, with no duration in its header, or one whose
  container does not read to its end; a clip a branch adds needs a `video` line with `scrub:` (a `screenshot` line does not mark
  it) and its sheet, a PNG, added by the same branch. The video line covers the sheet (the names compared in lower
  case). A symbolic link is checked as its text, the way git publishes it; one that points outside the
  repository is a finding.
- `- needs: <platform> [<copy>]` — optional, the item's requirement, written by the ticket's author.

Every checkbox item of the section, at any depth, gets a number in file order from 1; an Evidence or needs line
belongs to the nearest checkbox item above it. Code blocks are not read. The state of an item:
`failed` — its last Evidence line says `fail`; `verified` — a `pass` line of any kind but `review` (for a
manual item only `owner-check`, `screenshot` or `video`) that matches `needs`, if there is one, by platform and
copy; `not-verified` — the rest, with the reason: `no evidence`, `review only`, `needs <p> <c>, got <p> <c>`,
`manual item needs owner-check, screenshot or video`, `unreadable evidence line`.

- `ticket evidence <epic> <NN>` prints the matrix: `<n>. <state> <reason?> — <text>` per item, its lines
  under it, and last `evidence: N of M verified` (M counts the items without lines). Exit 0.
- `ticket evidence <epic> <NN> <item> <kind> <pass|fail> --ref "<text>" [--platform P] [--copy C] [--sha S]
  [--scrub YYYY-MM-DD] [-n]` writes one line after the last line of item `<item>`. The platform defaults to
  this system's (`ci` under GitHub Actions), the sha to `git rev-parse HEAD`, the copy to `-`. A line the
  grammar refuses, or an item outside the section, is exit 2 and nothing is written; `-n` prints the line only.
  More refusals, all with nothing written:
  - exit 2 — `--ref`, `--platform`, `--copy` or `--scrub` with no value, or with a flag as its value (`-n`
    or anything that starts with `--`; a plain `-` is a value);
  - exit 2 — a `screenshot` whose `--ref` has a path in backticks and no `--scrub <date>`: "a screenshot
    needs --scrub <date>: check the pixels by eye first";
  - exit 2 — a `video` without `--scrub <date>`, always: "a video needs --scrub <date>: check every frame of
    its contact sheet first"; a `video` whose `--ref` has no path in backticks, whose first path is not a
    `.webm` or `.mp4` file (from the ticket's folder; `.mov`, `.m4v`, `.mkv` are refused — convert them) in
    `<epic>/evidence/` of the tickets root, whose clip or sheet is a symbolic link, or whose clip has no
    `<name>.sheet.png` that is a PNG next to it ("no contact sheet next to the clip: <path>", "the contact sheet
    is not a PNG: <path>"). These are checked in Silent mode too and with `-n`;
  - exit 1 — the privacy check (`bin/evidence-check`) found something in a file that a path in backticks
    of `--ref` leads to (taken from the ticket's folder), or in the contact sheet of a `video`; its output,
    values masked, goes to stderr. Also
    with `-n`. The repository is the one that holds the tickets root, whatever the working directory.
    Not checked, and the line is written: a project in Silent mode by its profile (`_resolved.mode`,
    read from the working directory; its Workflow folder may be a git work tree of its own), and,
    when no profile can be read, a tickets root outside any git work tree.
- `ticket done` prints `evidence: N of M verified` and each unverified or failed item to stderr; its exit
  code stays 0.

**Old header**
Any other Status line: `**Status:**`, a tail after the word (`done — 2026-08-27, [PR #N](…)`,
`blocked — <reason>`), a second Status line in the footer. `epic-status` gives it `state: none` and
`statusError: "old header"`, not a guess; `bin/ticket` refuses to write such a file ("run ticket migrate
first"). `ticket migrate [--epic E] [-n]` moves every ticket of the tickets root once: the word folds
into four the way `epic-status` folded it (`in-progress` → `claimed`, the Russian words for blocked
and shipped → `blocked` and `done`), the tail
becomes `Blocked reason:` and `PR:`, a footer that says the same word goes, a free-text note of a
`done` line is dropped and named. It does not guess `Waits:`: it lists the `blocked` tickets without
it. A line it does not understand — an unknown word, a footer that disagrees with the header, two
dates or two PRs — is a refusal, and then no file is written at all. `-n` prints the diff only.

**Status** / **State**
`Status` is the word of the Status line. `State` folds it into one of five values: `done`, `work`
(`claimed`), `blocked`, `open`, `none` (no Status line, or an old header). The fold lives in
`epic-status`, in one copy; `--json` gives the header facts next to it as `statusAt`, `statusError`,
`blockedReason`, `waits` and `pr`.

**Stage**
Where the epic is in the process: `/to-spec`, `/wayfinder`, `/to-tickets`, `/implement`, `closed`. It is derived from the ticket states and from whether `spec.md`/`map.md` exist, and is
stored nowhere. It is a different axis from `State`: `Stage` is about the epic, `State` about a
ticket.

**Spec status** / **Accepted**
The `Status:` line of an epic's `spec.md`: the first such line in the first paragraph after the
leading headings, with the lines after it in that paragraph up to the next field (`Source:`), joined
by spaces and cut to 300 characters. `epic-status --json` gives it as `specStatus` of an epic that
has a `spec.md` (null without the line), next to `acceptedAt`: the first `YYYY-MM-DD` of the line
when the line says the owner accepted the spec, otherwise null. What counts as "accepted" are the
words of `lib/input-words.json` a line starts with (`specAccepted`, or `specAcceptedDecisions` with
a word of `specAcceptedDecisionsWord` anywhere in the line); a line with such words and no date is not
accepted. The line is the project's text, not a header `bin/ticket` writes: a project writes it in
its own language, and its canonical form is the project's rule. The Stage line does not use it.

**Blocked by**
A ticket field. It is parsed into numbers only if EVERY item of the list starts with digits
("12, 14, 15", "01 — scaffold") or the whole value is a negation word ("none", "—", "None — can start
immediately"). Otherwise the value is declared unparsed.
`blockedParsed` is kept apart from the list on purpose: "no blockers" and "the reader did not
understand" both give an empty list of numbers but mean opposite things.
Today six of ninety-eight on `main` are unparsed — and that is a list to sort out, not a defect of
the reader.

**Unblocked**
Derived: the blockers are parsed, every blocker in the same epic is shipped, and the ticket itself
is not shipped. It answers "what can be taken right now" — the only question the `epic-status` line
does not answer.

**Ahead**
The ticket's state in a branch DIFFERS from its state on `main`. Exactly "differs", not "is further
along": `blocked` and `claimed` are not comparable on one scale; the domain has no order between
them.

**Base and promise**
`main` is what really exists; a branch is a promise. So the `main` status always wins, and the
branch is added as a mark. If "the furthest along" won, `done` from a branch that will never be
merged would hide the ticket from the work list forever.

**Live branch**
Not merged into `main` and with activity in the last 14 days (`--days`). A branch is not a unit of
display: the unit of display is a ticket, and branches become its marks. Otherwise one ticket of
the `deepening/NN` family collects sixty identical chips.

## Wayfinding operations

The tracker of the planning skills — `worfy:wayfinder`, `worfy:to-spec`, `worfy:to-tickets`,
`worfy:code-review` — is the ticket folder of the project's profile, in the language of this file.
Their text speaks of a generic issue tracker: issues, labels, `resolved`, `GLOSSARY.md`. Read those
words through this section; there is no other tracker, and nothing is written into `CLAUDE.md`,
`AGENTS.md` or `docs/agents/` of the project. `${CLAUDE_PLUGIN_ROOT}` below is the plugin root, the
folder that holds this file's `bin/`.

- **Tracker**: the tickets root — `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field tickets.root`;
  `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" root` prints its absolute path (the Workflow folder in Silent
  mode). A project without a profile has no tracker yet: suggest `/worfy:connect-project`.
- **Spec**: `<tickets root>/<epic>/spec.md`, the epic being a new folder named by the effort.
  "Publish to the issue tracker" means write that file.
- **Map**: `<tickets root>/<epic>/map.md` — the Destination, Notes, Decisions-so-far and Not yet
  specified body of the map. A map is not labelled: `epic-status` sees the file and shows the epic's
  Stage as `/wayfinder`.
- **Ticket of the map**: `<tickets root>/<epic>/issues/NN-slug.md`, numbered from `01`, with the
  header of this file (`Type:`, `Status:`, `Blocked by:`, `Source:`) and the question in the body.
  The ticket type is the `Type:` line — `research`, `prototype`, `grilling` or `task` — in place of a
  `wayfinder:<type>` label; a ticket that `worfy:to-tickets` or `worfy:to-spec` writes has
  `Type: task`. A new ticket is `Status: open`.
- **Blocking**: the `Blocked by: NN, NN` line, parsed as **Blocked by** above.
- **Frontier**: the **Unblocked** tickets of the epic in `open` state, first by number wins:
  `"${CLAUDE_PLUGIN_ROOT}/bin/epic-status" <epic>` lists them (`--json` for every field).
- **Claim**: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" claim <epic> <NN>` before any work; it writes the
  Status line, which no one edits by hand. The claim is the Status line, not an assignee.
- **Resolve**: write the answer under an `## Answer` heading of the ticket, then
  `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" done <epic> <NN>` — the word is `done`, not `resolved` or
  closed — then append the context pointer (gist and link) to Decisions-so-far in `map.md`. A ticket
  ruled out of scope is resolved the same way, its answer saying so.
- **Comments**: append to the ticket file under a `## Comments` heading.
- **Labels**: none. worfy tickets carry no labels: no triage labels (`needs-triage`,
  `ready-for-agent`, …) and no `wayfinder:` labels. An instruction to apply a triage label is
  ignored, and its word never goes into the Status line, which holds only `open`, `claimed`,
  `blocked` or `done`: `ticket migrate` would read an unknown word there as a refusal or fold it
  into another state. A ticket waiting for an agent is simply `open` and **Unblocked**.
- **Glossary**: the file `docs.context` of the profile
  (`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field docs.context.path`) is the glossary a skill calls
  `GLOSSARY.md`; ADRs live in `docs.adr_dir`. A profile without `docs.context` has no glossary yet:
  create one only when the user agrees, and name it in the profile through `/worfy:connect-project`.

In a Product Session the tracker of the map is the topic folder `docs/product/<topic>/` (in Silent
mode `<Workflow folder>/product/<topic>/`): the map is its `map.md`, the tickets of the map are its
`issues/NN-slug.md`, and the operations are the same. One exception: a Product Session runs no
`bin/ticket`, which knows only the tickets root, so it writes the `Status:` line of a ticket of the
map itself, in the form of **Header**, and reads the frontier from the files. A spec it writes is an
epic draft, `drafts/<epic>.md` of the topic, not `<tickets root>/<epic>/spec.md`.
