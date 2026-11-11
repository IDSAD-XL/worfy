# 48 — Gate на Stop главной Session Codex в main checkout не запускается

Type: bug
Status: claimed 2026-11-11T15:49Z
Blocked by:
Source: решение владельца 2026-11-11; tester Codex: Session «висит» после ответа; [ADR-0094](../../../docs/adr/0094-vendor-seam.md), п. 6; Ticket 36 ([36-hook-и-harness-под-codex.md](36-hook-и-harness-под-codex.md))

## Что происходит

Под Codex `harness/hooks/stop.mjs` сам запускает `gate.mjs fast` на `Stop` и на `SubagentStop` в
зарегистрированном Project-е (Ticket 36): у Codex нет `TaskCompleted` и `TeammateIdle`, на которых gate идёт под
Claude Code. На `Stop` главной Session это стоит до 900 s в конце каждого хода, который поменял дерево (в этом
репозитории — около 7 минут). Главная Session в main checkout (например, Orchestrator) сама Ticket-ов не
реализует: её ход кончается ответом, а Codex ждёт gate, и tester видит, что Session «висит» после ответа.

## Что делаем

Правило владельца 2026-11-11:

1. Под Codex на `Stop` главной Session, которая работает в main checkout Project-а (не в linked worktree), hook
   gate **не запускает**.
2. В linked worktree (implementer-ы) и на `SubagentStop` hook запускает gate, как сейчас.
3. Удержание хода по red marker (exit 2, пока последний run gate известен как red) остаётся везде как есть.
4. Под Claude Code ничего не меняется.

Main checkout от linked worktree hook отличает так же, как git: у linked worktree `git rev-parse --git-dir`
(`<common>/worktrees/<имя>`) не совпадает с `--git-common-dir`, у main checkout совпадает. Если git не ответил,
gate запускается, как до этого Ticket-а.

Платформенный PR (hook Harness): должен работать и на Windows. Глубина review — `medium`.

## Готово, когда

- [ ] Contract test `test/contract/harness-codex-hooks.test.ts`: Codex `Stop` в main checkout — gate не запускается
      (verdict-файла нет), red marker прошлого run-а по-прежнему держит ход; Codex `Stop` в linked worktree — gate
      запускается; Codex `SubagentStop` в main checkout — gate запускается; Claude Code — как было. Красный до
      исправления.
- [ ] Shell test `harness/hooks/tests/` на те же случаи — exit 0.
- [ ] Test-ы, которые гоняли Codex `Stop` с gate в main checkout (parity suite, stdin), идут в linked worktree.
- [ ] Комментарий в начале `stop.mjs`, `docs/features/gate-and-github.md`, `docs/features/harness.md`,
      `docs/features/skills-agents-and-hooks.md`, `harness/README.md` говорят новое правило; ADR-0094 — датированная
      поправка в `## Amendments`.
- [ ] Touched unit, contract и shell test-ы, `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.

## Где в коде

- `harness/hooks/stop.mjs` — запуск gate под Codex, комментарий в начале файла.
- `harness/hooks/gate-paths.mjs` — как hook узнаёт linked worktree.
- `harness/hooks/tests/` — shell test-ы Stop hook-а.
- `test/contract/harness-codex-hooks.test.ts`, `test/contract/codex-parity.test.ts`,
  `test/contract/harness-hook-stdin.test.ts` — Codex `Stop` в main checkout и в linked worktree.
- `docs/features/gate-and-github.md`, `docs/features/harness.md`, `docs/features/skills-agents-and-hooks.md`,
  `docs/features/vendors.md`, `harness/README.md` — описание gate под Codex.
- `docs/adr/0094-vendor-seam.md` — поправка в `## Amendments`.
- `.scratch/worfy-multi-vendor/issues/43-финальная-приёмка.md` — `Blocked by`.
