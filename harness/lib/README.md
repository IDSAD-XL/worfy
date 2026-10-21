# harness/lib

Modules and data that several scripts of `bin/` share. A script reaches them as `../lib/<file>`, as in
the plugin, where `lib/` lies next to `bin/` and `hooks/`.

- `pipeline.cjs` — the rules of a project's Pipeline, read by `bin/profile` and written by `bin/profile-set`.
- `old-words.cjs` — the old Russian placeholders of profile values and headings of `rules.md`, which
  `bin/profile` prints and `hooks/session-start.mjs` mixes in with their English forms for one release.
- `input-words.json` — words of the languages people write tickets and texts in, other than English. This
  is data about the input of projects, not a protocol of the Harness: the Harness itself writes and
  prints only English words, and these lists let its scripts read what people wrote in their own
  language. Each key is one list:
  - `statusDone`, `statusBlocked` — words of an old ticket header that `bin/ticket migrate` reads as
    the Status `done` and `blocked`;
  - `blockedByNone` — words that mean "no blockers" in a `Blocked by` line (`bin/epic-status`);
  - `blockedByAnd` — the word "and" between two ticket numbers in a `Blocked by` line (`bin/epic-status`);
  - `ticketWord` — the word "ticket", followed by any ending of the word and a number, that
    `bin/silent-check` finds as a ticket number in a Silent project.

  A word is matched as a whole word, as written: list each spelling (capital letter, ending) that should
  count. Adding a language is a change of this file only. The words are the only text in another
  language that the scripts of `bin/` and `hooks/` read, apart from the one-release shims marked
  `shortcut: accepts the old Russian token`.
