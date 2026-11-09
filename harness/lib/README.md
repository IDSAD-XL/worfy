# harness/lib

Modules and data that several scripts of `bin/` share. A script reaches them as `../lib/<file>`, as in
the plugin, where `lib/` lies next to `bin/` and `hooks/`.

- `pipeline.cjs` — the rules of a project's Pipeline, read by `bin/profile` and written by `bin/profile-set`.
- `draft-schema.cjs` — the checker of `profiles/draft.schema.json`: `bin/project-connect` checks a whole draft
  with it, `bin/profile-set` one field of a profile, so both accept the same values.
- `old-words.cjs` — the old Russian placeholders of profile values and headings of `rules.md`, which
  `bin/profile` prints and `hooks/session-start.mjs` mixes in with their English forms for one release.
- `code-fence.cjs` — the code blocks of a ticket file: `bin/ticket`, the writer of the header, and
  `bin/epic-status`, its reader, skip the same lines as code (`bin/TICKETS.md`, "Header").
- `evidence.cjs` — the Evidence lines of a ticket's "done" section, their grammar and the state of an item, read and written by `bin/ticket` (`bin/TICKETS.md`, "Evidence").
- `privacy.cjs` — the privacy rules (home folder paths with a user name, host names, Tailscale addresses,
  UUIDs, email addresses, tokens, the personal deny list) and the masking of what they find:
  `bin/evidence-check` runs them over what a branch adds; the API is in the header of the file.
- `workflow-traces.cjs` — what a trace of the workflow is (an epic name, `<epic>/<NN>`, a ticket or ADR number, the
  Workflow folder, `.scratch`, `HANDOFF`) and the Claude attribution lines: `bin/silent-check` applies them in
  Silent mode or with `attribution: off`, `bin/review-draft-lint` to every review draft; the API is in the header of the file.
- `gate-failures/` — the subcommands of `bin/gate-failures`, one module per subcommand (`<name>.mjs`, which
  exports `run(argv, io)` and a one-line `summary`): `bin/gate-failures` finds them by name, so a new
  subcommand is a new file here. The format of the failure records, their scrubbing and their files are
  in `hooks/gate-failures.mjs`, next to the gate that writes them.
- `e2e-lock.cjs` — the e2e lock of the profile (`workflow.e2e_lock`, a directory made by mkdir, with its
  holder.json, heartbeat and takeover of a dead holder), the check of a locked screen before e2e tests and the
  release of the locks on a signal: `bin/wave-gate` and `gate-failures/rerun.mjs` take them from here.
- `qmd-common.cjs` — what `bin/qmd-mcp`, `bin/qmd-refresh`, `bin/qmd-sync-main` and `bin/qmd-collections`
  share: the folders of qmd, the node qmd runs on, which qmd to start, the lock of an index update and the
  update itself. `node qmd-common.cjs --update-job` is that update as a background process.
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
