---
name: retro
description: Run a retrospective on the work just done and record what generalizes into the private Atakama knowledge base. Use at the end of a ticket, an epic, or a debugging session, or when the user says "retro", "ретро", "запиши урок", or asks what we learned.
---

# Retrospective

Turn what just happened into something a future session can use. Everything you
write lives under `~/.claude/atakama/` — **never** inside the team repositories.

## Files

| Path | What goes there |
| --- | --- |
| `~/.claude/atakama/lessons.md` | Full log: one dated entry per lesson, with the evidence |
| `~/.claude/atakama/lessons-index.md` | One line per lesson; this is what loads at session start |
| `~/.claude/atakama/rules.md` | Rules that are now permanent and should always apply |

## Procedure

1. **Gather evidence, don't guess.** Look at what actually happened this session:
   the diff (`git -C <repo> diff`), the commands that failed, gate output, and
   the points where the user corrected you. A lesson without evidence is noise.

2. **Filter hard.** Record a lesson only if it is *generalizable* — it will
   plausibly bite again. Skip one-off slips, environment hiccups, and anything
   already written in the repo's `CLAUDE.md` / `AGENTS.md` / `docs/agents/`.
   Most sessions produce zero or one lesson. Writing three is a signal you are
   padding.

3. **Check for duplicates.** Read `lessons-index.md` first. If the lesson is a
   sharper version of an existing entry, *update that entry* instead of adding
   a new one.

4. **Write the entry** in `lessons.md`:

   ```markdown
   ## YYYY-MM-DD — <short title>
   **Repo/area:** Atakama-Browser-Server/elt
   **What happened:** <the concrete failure or friction>
   **Why:** <root cause, not the symptom>
   **Rule going forward:** <what a future session should do differently>
   ```

   Then add exactly one line to `lessons-index.md`:
   `- <short title> — <the rule in one clause> (see lessons.md YYYY-MM-DD)`

5. **Promote or prune.** If a lesson has held for a while and is now simply how
   things are done, move it out of `lessons.md` into `rules.md` and delete its
   index line. If an entry is stale or was superseded, delete it. The index is
   loaded into every session — keep it under ~25 lines. When it grows past that,
   say so and propose which entries to promote or drop.

6. **Consider the team files.** If the lesson is about the codebase rather than
   about how you work — a convention, an architectural boundary, a trap in the
   build — it probably belongs in that repo's `CLAUDE.md`, which the whole team
   shares. Do not edit it yourself: tell the user it is a candidate and let them
   decide.

7. **Clear the queue.** Truncate `~/.claude/atakama/state/pending-retro.log`
   when the retrospective is done.

## Tone

Write for an agent, not for a reader. Terse, imperative, specific. "Vitest
mocks `fetch` globally; use `vi.importActual('cross-fetch')` for real requests"
beats "be careful with fetch mocking".
