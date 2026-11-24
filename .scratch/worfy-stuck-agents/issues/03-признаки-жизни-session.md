# 03 — Признаки жизни Session: время последнего признака и тишина хода

Type: task
Status: done 2026-11-17T07:49Z
PR: #1948
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решения по реализации» → «Признаки жизни Session и тишина», пункты
«Время последнего признака жизни», «Что не тишина», «Пороги»; «Решено без владельца», 1, 7 и 12

Кто: агент.

Не платформенный Ticket (main process и driver-ы, без Terminal, окон и меню). Глубина ревью — `medium`.

## Что происходит

- Session не помнит время последнего события: `onEvent` (`src/main/agent/session.ts:1094`) только переводит состояние и
  раздаёт событие. У событий есть `at` (`src/shared/agent/events.ts:76–79`), в том числе у `task_activity`
  (`events.ts:295`).
- Работа, которую worfy не показывает, событий не даёт:
  - Claude: `hook_started`, `hook_progress` и `thinking_tokens` отбрасываются (`QUIET_SYSTEM`,
    `src/shared/vendors/claude/events.ts:162–165`);
  - Codex: `hookStarted` сообщает только о Stop hook (`src/main/vendors/codex/items.ts:346–350`).
- Источники «ещё работает» вне событий уже читаются: output file background task-а (`src/main/autopilot/task-output.ts`),
  вывод gate-а `.run-<tag>-<pid>.out` (`harness/hooks/gate.mjs:727`) в папке состояния (`src/main/gate/state.ts`), e2e
  lock (`readE2eLock`, `src/main/workflow/stages.ts:98`).
- Слово `silent` занято термином Silent mode (CONTEXT.md); в коде и UI — `quiet`.

## Что делаем

1. Session хранит `lastSignAt` — время последнего признака жизни: любое событие агента, в том числе скрытое.
2. Скрытые признаки жизни, без строки в транскрипте:
   - Claude: `hook_started`, `hook_progress`, `thinking_tokens` дают внутреннее событие признака жизни (или прямой вызов
     в Session), которое renderer не показывает;
   - Codex: начало и конец любого hook run-а, не только Stop.
3. Чистая функция `quietFor(now, facts)` (новый модуль в `src/shared/agent/`): сколько минут ход без признаков жизни.
   Ноль, если Session не `busy`, если открыт запрос разрешения (`needs_permission`), если hook начат и не кончен, если
   за порог вырос output file живой background task-и Session, если вырос `.run-*.out` gate-а worktree Session-а, если
   e2e lock занят живым holder-ом.
4. Константа порога пометки — `QUIET_MARK_MS` = 10 минут в `src/shared/agent/quiet.ts` (её берут Ticket-ы 04 и 06;
   порог `turn-hung` заводит Ticket 09); test-ы передают свой порог.
5. Поле тишины доходит до renderer-а: `quietSince` (время начала тишины или `null`) в состоянии Session, которое main
   шлёт по IPC (`src/shared/agent/events.ts`, `src/shared/ipc/agent.ts`). Main не шлёт его чаще раза в минуту.

## Готово, когда

- [ ] Unit test `quietFor`: `busy` без признаков 11 минут — тишина 11 минут; `idle` — ноль; `needs_permission` — ноль;
      начатый и не кончившийся hook — ноль; выросший output file background task-и — ноль; выросший `.run-*.out` gate-а —
      ноль; e2e lock с живым holder-ом — ноль, с мёртвым — не ноль.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx vitest run test/unit/session-quiet.test.ts` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: test-run pass · `pnpm test` (gate fast) exit 0 · mac - · b70dce1896e53978b3031970b91e2f2b3f0a61b8
  - evidence: review pass · PR #1948 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test `test/unit/claude-events.test.ts`: `hook_started`, `hook_progress`, `thinking_tokens` дают признак
      жизни и не дают строки транскрипта.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx vitest run test/unit/claude-events.test.ts` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: test-run pass · `pnpm test` (gate fast) exit 0 · mac - · b70dce1896e53978b3031970b91e2f2b3f0a61b8
  - evidence: review pass · PR #1948 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test `test/unit/codex-items.test.ts`: hook run не-Stop hook-а даёт признак жизни.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx vitest run test/unit/codex-items.test.ts` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: review pass · PR #1948 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test `test/contract/agent-session.test.ts`: Session на fake agent, ход молчит дольше порога test-а —
      `quietSince` приходит в renderer-канал; событие агента его сбрасывает в `null`.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx vitest run test/contract/agent-session.test.ts` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: test-run pass · `pnpm test` (gate fast) exit 0 · mac - · b70dce1896e53978b3031970b91e2f2b3f0a61b8
  - evidence: review pass · PR #1948 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract test `test/contract/codex-session.test.ts`: то же на fake app-server Codex.
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 npx vitest run test/contract/codex-session.test.ts` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: test-run pass · `pnpm test` (gate fast) exit 0 · mac - · b70dce1896e53978b3031970b91e2f2b3f0a61b8
  - evidence: review pass · PR #1948 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a1d1c61599c9b34a6836dcb240d8f05b41254758
  - evidence: gate pass · `gate fast` exit 0 · mac - · b70dce1896e53978b3031970b91e2f2b3f0a61b8
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44036963313/job/133895449993 · ci - · c2541c1223dd7506aef1bfa09debbe0d20c3e51f

## Тесты

- Новый `test/unit/session-quiet.test.ts` (функция `quietFor`), `test/unit/claude-events.test.ts`,
  `test/unit/codex-items.test.ts`, `test/contract/agent-session.test.ts`, `test/contract/codex-session.test.ts` — пункты
  выше, каждый test сначала красный.

## Где в коде

- `src/main/agent/session.ts`
- `src/shared/agent/quiet.ts` (новый)
- `src/shared/agent/events.ts`
- `src/shared/ipc/agent.ts`
- `src/shared/vendors/claude/events.ts`
- `src/main/vendors/codex/items.ts`
- `test/unit/session-quiet.test.ts` (новый)
- `test/unit/claude-events.test.ts`
- `test/unit/codex-items.test.ts`
- `test/contract/agent-session.test.ts`
- `test/contract/codex-session.test.ts`

Только читать: `src/main/autopilot/task-output.ts`, `src/main/gate/state.ts`, `src/main/workflow/stages.ts`,
`harness/hooks/gate.mjs`.

## Вне скоупа

- Chip, hint line, Restart — Ticket 06. Страницу `docs/features/sessions.md` правит Ticket 06: до него поле не видно
  человеку.
- Тишина Subagent-а — Ticket 04; `turn-hung` в Autopilot — Ticket 09.

## Итог

- shortcut: на Windows gate запускает команды через `cmd.exe` (`throughCmd`, `harness/hooks/gate.mjs`) и их вывод
  читает из pipe-а; файл `.run-<tag>-<pid>.out` пишет только `captured()` для команд без `cmd.exe` (`.exe`, `.com`).
  `pnpm` — это `.cmd`, поэтому на Windows признак «вырос вывод gate-а» почти никогда не срабатывает: ход с долгим
  gate-ом без событий агента там может получить `quiet`. Комментарий `shortcut:` — у `gateOutputAt` в
  `src/main/agent/session/quiet-signs.ts`.
