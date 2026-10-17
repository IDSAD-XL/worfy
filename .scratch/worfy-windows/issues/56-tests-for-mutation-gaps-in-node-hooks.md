# 56 — Tests for the four gaps mutation testing found in the Node hooks

Type: task
Status: open
Blocked by: —
Source: Mac review of PR #453 (Ticket 04, the Harness hooks rewritten in Node), round 1, depth high:
[review comment](https://github.com/IDSAD-XL/worfy/pull/453#issuecomment-6242822528). Mutation
testing killed 10 of 14 mutants. The four survivors are test gaps. The code itself behaves correctly.

## Что происходит

Mutation testing changes one line of code and runs the tests. A mutant that no test turns red
shows a line that no test protects. Four lines in the Node hooks have no such test (main `9d21c3d6`):

- **[med] `harness/hooks/stop.mjs:97-100`.** The Stop hook reads stdin with `JSON.parse` inside a
  `try`. No test covers "red gate marker + stdin that is not JSON → exit 2". A mutant that crashes
  there exits 0 and lets a turn end while the gate is red. The old `stop.sh` accepted such stdin.
- **[med] `harness/hooks/session-start.mjs:183`.** The hook drops a `## Sources` or `## Источники`
  section from the profile's `rules.md`. No synthetic test strips `## Источники`.
  `session-hooks.test.sh:70` checks only `## Sources`, and it sits in a block that is skipped on a
  machine without `~/.claude/gate/config.json`.
- **[low] `harness/hooks/session-end.mjs:79`.** The hook appends one line to
  `<profile>/state/pending-retro.log`. No synthetic test checks that two runs give two lines. A
  mutant that overwrites the file survives.
- **[low] `harness/hooks/gh-token-env.mjs:56-59`.** When stdin is not JSON, the hook falls back to
  the current folder. No test covers this case or checks that the hook still writes the `export`
  line.

## Что делаем

1. `harness/hooks/tests/gate-notverified.test.sh`: a case with a red gate marker for the worktree
   and stdin that is not JSON (for example `not json`). Expect exit 2 and the "quality gate is red"
   text.
2. `harness/hooks/tests/session-hooks.test.sh`: a synthetic profile case like the one near
   `session-hooks.test.sh:183` (its own `CLAUDE_GATE_CONFIG` and `CLAUDE_PROFILES_DIR`). Its
   `rules.md` has a `## Источники` section. Expect the rules in the context and no `## Источники`
   text. It must not depend on `~/.claude/gate/config.json`.
3. `harness/hooks/tests/session-hooks.test.sh`: a synthetic case that runs the SessionEnd hook twice
   and expects two lines in `pending-retro.log`.
4. `harness/hooks/tests/gh-token-env.test.sh`: a case with stdin that is not JSON, run from a folder
   whose profile names a GitHub account. Expect the `export` line in `CLAUDE_ENV_FILE`.

Tests only. The hook code does not change. This is not a platform ticket in the sense of ADR-0056:
the tests are shell tests that already run on both systems.

## Готово, когда

- [ ] Each new case is red against a mutant of the cited line and green on the code. The PR names
      each mutant and its red result.
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh`, `bash harness/hooks/tests/session-hooks.test.sh`
      and `bash harness/hooks/tests/gh-token-env.test.sh` exit 0 on macOS and in Git Bash on Windows.
- [ ] The new cases use no `jq` (Git Bash on the PC has none) and do not read the real
      `~/.claude/gate/config.json`.
- [ ] gate fast on the Mac — exit 0 and the line `[gate] зелено (fast)`.

## Тесты

- Mutants to check, one per case:
  - `stop.mjs`: drop the `try` around `JSON.parse`, so stdin that is not JSON throws;
  - `session-start.mjs:183`: the pattern matches `## Sources` only;
  - `session-end.mjs:79`: `writeFileSync` in place of `appendFileSync`;
  - `gh-token-env.mjs:56-59`: drop the `try` around `JSON.parse`, so stdin that is not JSON throws.

## Где в коде

- `harness/hooks/tests/gate-notverified.test.sh`
- `harness/hooks/tests/session-hooks.test.sh`
- `harness/hooks/tests/gh-token-env.test.sh`

## Итог

Заполняется при закрытии.
