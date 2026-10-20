# Glossary of tickets and epics

The language of `epic-status`, `epic-board` and `ticket`. It lives here, not in a repository's
`CONTEXT.md`: `CONTEXT.md` is the glossary of the product domain (`Lot`, `Bid`, `Deal`), and
`Ticket` would stand there next to `Lot` as an equal, which it is not. This is the language of the
process, not of the product.

**Ticket**
A unit of work. The file `<repo>/.scratch/<эпик>/issues/NN-slug.md`.
A ticket's identity is the pair `(epic, number)`; the slug is not part of it, so renaming the file
in a branch does not create a second ticket. Two files with one number in one epic are not a
duplicate ticket but a data error: two places took one number.
_Avoid:_ issue, task

**Epic**
The ticket folder `.scratch/<эпик>/`, sometimes with a `spec.md` or `map.md`. Not the same as a
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
`Blocked reason:`, `Waits:` and `PR:` are read only in the header: up to the first `## ` heading after
the Status line. A `PR: <url>` line of a result section is not the ticket's PR.

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
