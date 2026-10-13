# worfy Harness — common rules

Rules for every session and every subagent.

## Plain language

Write for a competent engineer who has never seen this project. Name a thing by the term the
industry already uses — smoke test, e2e test, contract test, exit code, helper function, CI job,
guard clause — so the sentence still reads correctly outside this repo. When a term really is
local (an epic, a wave, `legal_lock`, `HANDOFF.md`), gloss it in half a sentence the first time it
comes up in a turn.

**Writing in Russian: the term stays in Latin.** endpoint, test, deploy, CI run, staging, guard,
gate, seam, worktree, exit code, stub, mock, smoke test, flaky test, mutation testing. Translating
them produces jargon that reads as local slang and loses meaning outside the repo — «ручка» for
endpoint, «проба» for test, «выкат» for deploy, «заглушка» for stub. Words that decline or
conjugate in Russian stay Russian («задеплоить», «прогнать», «деплой» in oblique cases): Latin does
not decline, and forcing it there rewrites the sentence for the sake of the rule. When a word is
domain vocabulary rather than an engineering term, it stays as it is. When the profile names a
glossary (`docs.context`), its vocabulary section holds the project's full mapping.

Metaphors are the failure mode: "rakes", "smoke", "handles", "probes", "the sentinel" feel vivid
to whoever coined them and mean nothing to anyone else. Say what the thing is and what it does. If
no standard term exists, describe it plainly rather than minting a new word.

**Codes carry their meaning.** A ticket number, ADR number, wave, finding label or any code the
project invented gets a few plain words in the same sentence the first time it appears in a
message — "backlog/18 (the lot-withdrawal button shown to a moderator)". Later mentions in the same
message may stay bare; the next message explains again, because replies are read hours or days
apart.

**Restate, don't point back.** No "as above", "per the analysis", "row 9", "ticket 04 from
earlier". Repeat the fact itself: "the race test where the first operation's rejection went
unhandled".

**Short sentences, one idea each.** Short paragraphs. "X is done. It lives in file Y. Z is still
missing." — not one long sentence joined by semicolons.

**Self-check before sending.** Scan the draft for capital-letter codes, acronyms, project
shorthand and figures of speech. Each code needs its plain words in the same sentence; each figure
of speech becomes the literal thing. Then ask: would an engineer who joined today understand every
word without scrolling up? If not, rewrite.

Scope: all of this governs work — reports, tickets, ADRs, commits, PRs, code comments. Casual
chat, jokes or a personal message drafted for someone may match that conversation's tone.

**Which language.** Reports to the user follow the profile's `language.reports`. Everything the
team sees — commits, PRs, review comments, code comments — follows `language.team`. With no
profile: reports in the language the user writes in, team-facing text in the language the repo
already uses.

## Evidence before "green"

- Never call lint, tests or CI clean without the exit code. Filtering long output is required; losing
  the exit code is not. `set -o pipefail` first, or save the output and print `echo "EXIT=$?"`
  next to the tail. A `PreToolUse` guard refuses the pipes that swallow it.
- The verdict comes from `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"`,
  not from reading the diff. A failing run means unfinished. "Could not verify" means unverified.
  Neither is reported as done.
- Gate exit codes: `2` is red. `3` is not verified — unregistered project, broken registry —
  never green. `0` is green only when the output has the line `[gate] зелено (…)`: "nothing
  ran" («ничего не прогналось») and "could not verify" («ПРОВЕРИТЬ НЕ УДАЛОСЬ») also exit `0`.
  Where the gate does not cover the project, the verdict comes from the profile's
  `commands.verify` (or the project's own lint and test commands) with their exit codes, and the
  report says the gate did not run.
- Nothing is "deployed" until the live endpoint has been hit and its answer pasted.
- A subagent's `file:line` is a claim, not a fact. Re-read the line before repeating it —
  subagents have cited lines that were not there.

## Context hygiene

- Quote the minimal fragment; whole files stay out of main context.
- Editing a file outside the `Edit` tool prints its whole contents back into context, and the
  bigger the file the bigger that cost. Point edits go through `Edit`; a sweep across many files
  is an agent's job, not yours.
- After each phase, compress: keep conclusions, drop the trail.
- Unbounded output — logs, curl responses, DB dumps — gets filtered before it lands; delegate the
  run only when no filter does the job.
- Report to the user only what changed and what they need to decide.
