# 27 — Разбить `src/main/agent/session.ts` на связные модули, без изменения поведения

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен») по долгу из `HANDOFF.md` («Сейчас в работе»,
`worfy-week`: «долг: `src/main/agent/session.ts` 1077 строк»); файл перерос 1000 строк в
[PR #345](https://github.com/IDSAD-XL/worfy/pull/345) (`worfy-week` 20).

## Что происходит

- `src/main/agent/session.ts` — 1077 строк на main `274c7eb`. Gate печатает предупреждение для файла,
  который diff перевёл через 1000 строк (`harness/hooks/gate.mjs:17-22`, `FILE_LINES_MAX` — `:347`).
  Вердикт оно не меняет, но каждый следующий Ticket, который трогает `session.ts`, читает и правит
  файл целиком.
- В файле пять разных частей:
  - типы границы с SDK — `AccountInfoLike`, `ModelInfoLike`, `ClaudeCodeProcess`, `QueryHandle`,
    `QueryRequest`, `QueryFactory`, `EventSink`, `SessionInfo`, `SessionControls` (`:91-193`);
  - модели и настройки — `modelOptions`, `mergeSettings`, `USER_MODEL_FALLBACK` (`:195-219`);
  - `InputQueue` — async iterable, в который Session кладёт сообщения (`:220-258`);
  - процесс Claude Code — `STDERR_KEEP`, `HALT_TURN_MS`, `EXIT_WAIT_MS`, `KILL_EXIT_MS`, `exitOf`,
    `within`, `Run`, `pushSettings` (`:260-336`);
  - класс `Session` (`:338-967`) и `SessionRegistry` (`:968-1077`).
- Из `session.ts` импортируют 31 файл в `src/` и `test/` (`grep -rln "from '.*agent/session'" src test`).
- Рядом уже есть `src/main/agent/session-settings.ts` (режим attended/unattended) — новые имена с ним
  не должны совпасть.

## Что делаем

1. **Вынести части без поведения** в свои модули в папке `src/main/agent/session/`: типы границы с
   SDK, модели и настройки, `InputQueue`, помощники процесса, `SessionRegistry`. Имена файлов —
   выбор исполнителя; каждая часть — одна тема.
2. **`session.ts` остаётся точкой входа**: класс `Session` и реэкспорт всего, что импортируют 31
   файл. Импорты в `src/` и `test/` не меняются (или меняются механически, одним commit-ом).
3. **Ни одной правки логики.** Перенос строк как есть; комментарии переезжают вместе с кодом.
   Комментарий в начале `session.ts` (`:1-54`) остаётся в нём, к новым модулям — по 1–3 строки.
4. **Цель по размеру:** каждый файл папки и `session.ts` — меньше 1000 строк; gate fast на ветке
   не печатает `[gate] warning: file over 1000 lines` для `session.ts`.

## Готово, когда

- [ ] `wc -l src/main/agent/session.ts src/main/agent/session/*.ts` — каждый меньше 1000.
- [ ] Ни одного изменения ожиданий в `test/`: `git diff origin/main -- test/` пуст или содержит только
      пути импортов.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [ ] В «Итог» — таблица «что куда переехало» со строками до и после.

## Тесты

Новых test-ов нет: поведение не меняется. Доказательство — существующие contract test-ы Session
(`test/contract/agent-session.test.ts`, `agent-controls.test.ts`, `agent-events.test.ts`,
`agent-context-usage.test.ts`, `agent-autocompact.test.ts`, `orchestrator.test.ts`,
`orchestrator-relaunch.test.ts`, `permissions.test.ts`) зелёные без правок ожиданий.

## Где в коде

- `src/main/agent/session.ts`
- `src/main/agent/session/`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): файлы, которые импортируют
`session.ts`, если реэкспорт сохраняет их импорты.

## Вне скоупа

- Любая правка поведения Session, даже очевидная. Найденное — строкой в «Итог», отдельным Ticket-ом.
- Другие большие файлы (`src/renderer/session/session.css` — 1105 строк, предупреждение gate в
  `worfy-ui` 09).

## Итог

—
