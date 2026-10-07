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

**Status** / **State**
`Status` is the line in the file as a person wrote it: "done", "Выкачено", "claimed", "blocked",
sometimes with a tail ("выкачено 2026-08-23, PR #27"). The LAST occurrence in the whole file wins:
the field is written both in the header and in the footer.
`State` folds `Status` into one of five values: `done`, `work`, `blocked`, `open`, `none` (no
field). The fold is the only place where eight spellings become five values, and it lives in
`epic-status`, in one copy.

**Stage**
Where the epic is in the process: `/to-spec`, `/wayfinder`, `/to-tickets`, `/implement`, `closed`. It is derived from the ticket states and from whether `spec.md`/`map.md` exist, and is
stored nowhere. It is a different axis from `State`: `Stage` is about the epic, `State` about a
ticket.

**Blocked by**
A ticket field. It is parsed into numbers only if EVERY item of the list starts with digits
("12, 14, 15", "01 — Каркас") or the whole value is a negation word ("none", "—", "None — can start
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
