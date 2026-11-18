# 06 — Продолжение Run-а после перезапуска: тот же id, Wait дальше, Resume и Discard

Type: task
Status: open
Blocked by: 01, 02, 04, 16
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Решения по реализации» → «Продолжение Run-а»; «Вопросы владельцу», Q3 и Q4
(оба — (а), решено без владельца, подтвердить); [critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md),
возражения 1 и 2; «Решения по test-ам», Contract, Recovery invariants, e2e; «Риски», 2, 3, 6, 8

Кто: агент.

Не платформенный Ticket (main process и renderer). Глубина ревью — `high`; снимок экрана строки Autopilot.

## Что происходит

- Нынешнее поведение после SIGKILL посреди Wave закреплено e2e test-ом: при старте Orchestrator-у не уходит ничего,
  Run history показывает старый Run «no stop in the Journal», кнопка начинает новый Run
  (`test/e2e/autopilot-faults.spec.ts:36`; строка — `src/renderer/flight-recorder/RunHistoryView.tsx:75`).
- Каждая Wave после первой уже уходит в новую Session Orchestrator-а с `wave-brief`, когда Orchestrator свободен
  (`src/main/autopilot/run.ts:14–21`; `waveBriefText` — `src/main/actions/launch.ts:139`). Ticket-ы оборванной Wave
  идут в ней как продолженные (`resumedTickets`, `src/shared/actions/render-template.ts:98`) — путь Force stop из
  ADR-0050.
- На Codex старт отказывает, пока hook-и Harness не одобрены (`CODEX_HOOKS_REFUSAL`,
  `src/main/vendors/codex/harness-hooks.ts:45`).
- Строки статуса Autopilot — таблица `docs/features/autopilot.md`, например `waiting for limits · resumes 14:20`
  (`:113`).

## Что делаем

1. `Autopilot` (`src/main/autopilot/run.ts`) получает вход `continueRun(checkpoint)` (checkpoint — Ticket 02):
   восстанавливает Run и ведёт тот же цикл (`src/shared/autopilot/cycle.ts`) тем же id, в тот же Journal; пишет
   `run-continued {after}`. Причина — из `run-suspended`, после падения `crash`; `update` Ticket 08 берёт из
   `restart.json`.
2. Восстановленный Wait (Limits, Start window, budget) ждёт дальше со своим `until`. Иначе следующая Wave уходит сразу:
   новая Session Orchestrator-а с `waveBriefText`, Ticket-ы оборванной Wave в работе — продолженные.
3. Проверка внешних вызовов функцией Ticket-а 16 — до Wave. Ticket, у implementer-а которого есть вызов без
   результата, в Wave не идёт и сам не продолжается: остаётся в `work`. Метку и toast добавляет Ticket 07.
4. Что делать с транскриптом, оборванным посреди вызова, — по «Итогу» spike-а 01.
5. Занятый Orchestrator — Wait `orchestrator-busy`, как при любом старте. На Codex без одобренных hook-ов — тот же
   отказ, что у старта.
6. Правило часа и cap: старше часа или третье продолжение за час (по строкам `run-continued`) — строка
   `cut off by restart · 14:05` с кнопками Resume и Discard (`src/renderer/canvas/actions/AutopilotAction.tsx`) и toast.
   Discard пишет `run-stopped` с `discarded` (Ticket 02).
7. Linked machine: Resume и Discard — только с Full access, как Start Autopilot (ADR-0066); с Read only строка видна,
   кнопок нет.
8. Замки оборванной Wave: кто держит замок worktree и e2e-замок после продолжения; замки оборванных Session-ов
   снимаются (риск 6).
9. Recovery invariants (`test/autopilot-invariants.ts`): И1 не меняется (команда оборванной Wave снова не уходит); И4 —
   продолженный Run несёт `run-continued`; И6 — после перезапуска тот же Run продолжается в своём Journal-е, новый
   Journal — только после Discard или остановки. На странице Feature правил уже девять (I1–I9,
   `docs/features/autopilot-faults.md:265–279`); I9 не меняется.
10. Английские страницы `docs/features/autopilot.md` (строка `cut off by restart`, Resume, Discard) и
    `docs/features/autopilot-faults.md` (продолжение после перезапуска, I4, I6); перевод — Ticket 14.

## Готово, когда

- [ ] Contract test (`faultRun()`): выход посреди Wave, старт → тот же id, `run-continued`, одна новая команда Wave с
      продолженными Ticket-ами; команда оборванной Wave снова не ушла.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-restart.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Contract test: падение без `run-suspended` → то же, `run-continued {after: crash}`.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-restart.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Contract test: выход в Wait Limits → после старта Wait идёт до своего `until`, команда раньше не уходит.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-restart.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Contract test: третий старт за час → продолжения нет, строка `cut off by restart`; Resume продолжает, Discard
      пишет `run-stopped` с `discarded`.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-restart.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Contract test: implementer Ticket-а держал `gh pr merge` без результата → после старта Ticket не в Wave.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-restart.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Contract test: Read only на Linked machine — кнопок Resume и Discard нет.
  - evidence: test-run pass · `pnpm test test/unit/autopilot-cut-off-line.test.tsx test/unit/link-access.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] Recovery invariants И1, И4, И6 обновлены и зелёные во всех Fault scenario-ах.
  - evidence: test-run pass · `pnpm test test/unit/autopilot-invariants.test.ts test/contract/autopilot-faults-restart.test.ts test/contract/autopilot-faults-quit.test.ts` exit 0 · mac - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] e2e test `test/e2e/autopilot-faults.spec.ts:36` меняет ожидание: после SIGKILL и старта уходит ровно одна новая
      команда Wave — 01 как продолженный и 02.
- [ ] Английские страницы `autopilot.md` и `autopilot-faults.md` описывают продолжение Run-а.
  - evidence: commit pass · worfy-continuity/06: continue an Autopilot Run after a restart of worfy · - - · f3d1184508c0a837cf969601f0adaae9d8dc4f5c
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Contract рядом с `test/contract/autopilot-faults-setup.ts`; `test/autopilot-invariants.ts`;
  `test/e2e/autopilot-faults.spec.ts`. Каждый test сначала красный. Строку Run history с Wait-ом `restart` проверяет
  Ticket 09.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/shared/autopilot/cycle.ts`
- `src/main/ipc/autopilot.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `test/autopilot-invariants.ts`
- `test/contract/` (новые сценарии)
- `test/e2e/autopilot-faults.spec.ts`
- `docs/features/autopilot.md`, `docs/features/autopilot-faults.md`

Только читать: `src/shared/autopilot/checkpoint.ts` (Ticket 02), `src/shared/agent/unknown-side-effects.ts` (Ticket 16),
`src/main/actions/launch.ts`, `src/shared/actions/render-template.ts`, `harness/skills/epic-wave/SKILL.md`.

## Вне скоупа

- Session-ы без Run-а — Ticket 05; метка «unknown side effects» и «Checked, include» — Ticket 07; причина `update` и
  "Restart now" во время работы — Ticket 08; Span `restart` в Run history — Ticket 09; Run-ы других Machine.
