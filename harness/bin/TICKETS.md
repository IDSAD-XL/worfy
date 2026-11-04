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
- `PR: #<N>` — `ticket done … --pr N` (Full mode; Silent mode has no `--pr`).
- `Branch:`, `Repo:`, `Type:`, `Blocked by:`, `Source:` — as before.
- `Roles: <role>, <role>` — optional: the roles whose Browser checks the ticket needs (for example
  `Roles: admin, user`); a role is the name of a Browser profile. No script reads it: skill
  `epic-wave` copies it into the brief's `Browser roles` line, and without it the brief says
  `Default`.
`Blocked reason:`, `Waits:` and `PR:` are read only in the header: up to the first `## ` heading after
the Status line. A `PR: <url>` line of a result section is not the ticket's PR.

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
- `kind`: `commit`, `test-run`, `ci-check`, `gate`, `review`, `screenshot`, `owner-check`. `verdict`: `pass` or
  `fail`, for every kind; a reviewer's `VERIFIED` is written `pass`, `REJECTED` — `fail`.
- `ref`: free text without ` · ` and on one line: a command with its exit code, `PR #N`, a URL, a path in
  backticks relative to the ticket file.
- `platform`: `mac`, `windows`, `linux`, `ci` — the platform, never a host name. `copy`: `stable`, `installed`,
  `dev`, `ci`, or `-` when no app was run. `commit` and `review` always have `- -`; `screenshot` and
  `owner-check` name the copy.
- `sha`: 7 to 40 hex digits, the commit the fact is bound to. `scrub: <date>`: a person checked the pixels of a
  screenshot.
- `- needs: <platform> [<copy>]` — optional, the item's requirement, written by the ticket's author.

Every checkbox item of the section, at any depth, gets a number in file order from 1; an Evidence or needs line
belongs to the nearest checkbox item above it. Code blocks are not read. The state of an item:
`failed` — its last Evidence line says `fail`; `verified` — a `pass` line of any kind but `review` (for a
manual item only `owner-check` or `screenshot`) that matches `needs`, if there is one, by platform and copy;
`not-verified` — the rest, with the reason: `no evidence`, `review only`, `needs <p> <c>, got <p> <c>`,
`manual item needs owner-check or screenshot`, `unreadable evidence line`.

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
  - exit 1 — the privacy check (`bin/evidence-check`) found something in a file that a path in backticks
    of `--ref` leads to (taken from the ticket's folder); its output, values masked, goes to stderr. Also
    with `-n`. The repository is the one that holds the tickets root, whatever the working directory; a
    tickets root outside any git work tree (Silent mode) is not checked, and the line is written.
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
