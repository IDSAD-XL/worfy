---
name: retro
description: Run a retrospective on the work just done and record what generalizes where the project's profile keeps its lessons — a private folder in ~/.claude/profiles/<name>/lessons/ or a lessons folder inside the repo. Use at the end of a ticket, an epic, or a debugging session, or when the user says "retro", "ретро", "запиши урок", or asks what we learned.
---

# Retrospective

Turn what just happened into something a future session can use. Where lessons
go is a project fact, so it comes from the project profile
(`${CLAUDE_PLUGIN_ROOT}/bin/profile`, contract in `~/.claude/profiles/README.md`), field
`lessons`.

## Where to write

Run from the repo (or workspace) the work happened in — pass it with `-C` if the
session sits elsewhere:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --name; echo "EXIT=$?"
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --field lessons; echo "EXIT=$?"
"${CLAUDE_PLUGIN_ROOT}/bin/profile" -C <repo> --dir
```

- Exit `3` (unregistered project or no profile) or `4` (no `lessons` field):
  there is no agreed place. Show the lesson to the user and ask where it goes;
  do not invent a folder.
- `lessons: "profile"` — private lessons, outside every repo. **Never write
  anything into the team repositories.** Files, with `<dir>` = `profile --dir`:

  | Path | What goes there |
  | --- | --- |
  | `<dir>/lessons/lessons.md` | Full log: one dated entry per lesson, with the evidence |
  | `<dir>/lessons/lessons-index.md` | One line per lesson; loaded at session start when the profile has `session.inject_rules: true` |
  | `<dir>/rules.md` | Rules that are now permanent and should always apply |
  | `<dir>/state/pending-retro.log` | Sessions that ended without a retro (written by `hooks/session-end.sh`) |

- `lessons: "repo:<path>"` — lessons live in the repo at `<path>` (Auction:
  `docs/lessons/<topic>.md`, grouped by topic, not by ticket). Follow
  `<path>/README.md` for the format when it exists — it overrides the entry
  format below. A lesson there is a change to the repo: make it in the current
  branch or worktree together with the work, never as a direct commit on the
  main branch. There is no index file and no pending-retro log in this mode.
  **Silent mode** (`profile -C <repo> --field _resolved.mode` prints `silent`):
  a relative `<path>` is taken from the Workflow folder
  (`profile -C <repo> --field _resolved.workflow_folder`), not from the repo.
  The lesson is written there and never into the repository or its branches;
  when the Workflow folder is a git repository of its own, commit it there
  locally (`git -C <Workflow folder> add -A . && git -C <Workflow folder>
  commit -m "lesson: <title>"`), without push.

## Procedure

1. **Gather evidence, don't guess.** Look at what actually happened this session:
   the diff (`git -C <repo> diff`), the commands that failed, gate output, and
   the points where the user corrected you. A lesson without evidence is noise.

2. **Filter hard.** Record a lesson only if it is *generalizable* — it will
   plausibly bite again. Skip one-off slips, environment hiccups, and anything
   already written in the repo's `CLAUDE.md` / `AGENTS.md` / agent docs or in
   the profile's `rules.md`. Most sessions produce zero or one lesson. Writing
   three is a signal you are padding.

3. **Check for duplicates.** Read the existing lessons first — the index
   (`lessons-index.md`) in profile mode, the topic files in repo mode. If the
   lesson is a sharper version of an existing entry, *update that entry* instead
   of adding a new one.

4. **Write the entry.** Profile mode, in `lessons.md`:

   ```markdown
   ## YYYY-MM-DD — <short title>
   **Repo/area:** <repo>/<package or area>
   **What happened:** <the concrete failure or friction>
   **Why:** <root cause, not the symptom>
   **Rule going forward:** <what a future session should do differently>
   ```

   Then add exactly one line to `lessons-index.md`:
   `- <short title> — <the rule in one clause> (see lessons.md YYYY-MM-DD)`

   Repo mode: the format of `<path>/README.md`, in the topic file it names.

5. **Promote or prune.** If a lesson has held for a while and is now simply how
   things are done, move it into the permanent rules — the profile's `rules.md`
   in profile mode — and delete its index line. If an entry is stale or was
   superseded, delete it. The index is loaded into every session — keep it under
   ~25 lines. When it grows past that, say so and propose which entries to
   promote or drop.

6. **Consider the team files.** If the lesson is about the codebase rather than
   about how you work — a convention, an architectural boundary, a trap in the
   build — it probably belongs in that repo's `CLAUDE.md`, which the whole team
   shares. Do not edit it yourself: tell the user it is a candidate and let them
   decide.

7. **Clear the queue** (profile mode). Truncate `<dir>/state/pending-retro.log`
   when the retrospective is done: `: > "<dir>/state/pending-retro.log"`.

## Tone

Write for an agent, not for a reader. Terse, imperative, specific. "Vitest
mocks `fetch` globally; use `vi.importActual('cross-fetch')` for real requests"
beats "be careful with fetch mocking".
