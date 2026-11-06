# 07 — Park: ожидание владельца

Type: task
Status: claimed 2026-11-06T00:00Z
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает», п. 1; «Решено без владельца», п. 6; Q3, Q5

Глубина ревью: high.

## Что происходит

- `PermissionGate` (`src/main/agent/permissions.ts:51`) умеет держать запрос открытым и ждать ответа; unattended
  Session до него не доходит (`:26-27`).
- `notify.ts:302` уже шлёт уведомление на каждый `permission_request` Session-и, которую ведёт worfy, и на Linked
  machine-ы.
- После Ticket-а 04 исход park ведёт себя как deny (заготовка).

## Что делаем

1. Park открывает запрос на gate (`permissions.ask`) с пометкой `parked` и правилом; `allow_always` не предлагается
   (park отвечает только на один запрос). Session показывает `needs_permission`; другие Subagent-ы идут дальше.
2. Предел ожидания (`src/main/agent/auto-approve/park.ts`): по умолчанию 60 мин (Q3), потом запрос снимается с
   ответом deny-with-hint и событием `park-expired`. Остановка Run-а снимает parked запросы так же.
3. Ответ владельца на карточку — событие `park-answered` (какой вариант), строку Journal пишет `run.ts` по схеме
   Ticket-а 04.
4. Текст уведомления: «Parked: <tool> in <Project>» без команды; карточка в Session показывает правило и цель.

## Готово, когда

- [ ] Unit test: park ждёт ответа; ответ allow пропускает один запрос; второй такой же снова park.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-park.test.ts` exit 0 · mac - · 475c00080778cdc1701dd124175f89fe79712a05
- [ ] Unit test: предел ожидания — deny-with-hint и `park-expired`; остановка Run-а снимает parked запрос.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-park.test.ts` exit 0 · mac - · 475c00080778cdc1701dd124175f89fe79712a05
- [ ] Unit test: уведомление уходит один раз на запрос, без текста команды.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/auto-approve-park.test.ts` exit 0 · mac - · 475c00080778cdc1701dd124175f89fe79712a05
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/auto-approve-park.test.ts` (новый); часы — через параметр, `ms()` для timeout-ов.
- Прогнать `test/unit/permissions*.test.ts`, `test/unit/notify*.test.ts`.

## Где в коде

- `src/main/agent/auto-approve/park.ts` (новый)
- `src/main/agent/permissions.ts`
- `src/main/notify.ts`
- `test/unit/auto-approve-park.test.ts` (новый)

## Итог

Сделано в PR (ветка `worfy-auto-approve/07`) — всё из «Что делаем».

- **Park на gate.** `src/main/agent/auto-approve/park.ts`: `createParker(asker)` открывает запрос на gate Session-а
  (`PermissionGate.ask`) с пометкой `parked` (правило и цели), без варианта `allow_always`; описание карточки —
  «Parked by Auto-approval, rule <правило>: <цели>». Session показывает `needs_permission` (счётчик gate-а), другие
  Subagent-ы идут дальше: ждёт только этот tool call. Ответ владельца — `answered` с вариантом.
- **Предел ожидания** — `PARK_LIMIT_MS` = 60 мин (Q3), часы и предел — параметры. Предел, остановка Run-а, Interrupt,
  закрытие Session и отзыв запроса Vendor-ом — `expired`: агент получает отказ с `PARK_EXPIRED_HINT` (и подсказкой
  правила, если она есть, например `git-hooks`), событие `auto_approval` с `park-expired`.
- **Остановка Run-а.** Force stop идёт через `Session.halt()` → `cancelAll` gate-а. Обычный Stop отдаёт Orchestrator
  через `setUnattended(false)`; если идёт ход, `orchestrator.ts` теперь зовёт `Session.releaseParked()` — parked
  запросы снимаются, остальные открытые запросы остаются.
- **Gate** (`src/main/agent/permissions.ts`): parked запрос не отвечается списком «Always allow» Session-а, и ответ
  «Always allow» на другой запрос того же tool-а его не закрывает — park отвечает только на один запрос.
- **Драйвер Claude** (`src/main/vendors/claude/session.ts`): в On park ждёт ответа; Allow — вызов проходит, Deny —
  отказ как в attended Session, без ответа — отказ с подсказкой. События: `park`, потом `park-answered` с полем
  `answer` (`allow` / `deny`) или `park-expired`. Shadow по-прежнему ничего не park-ует.
- **Уведомление** (`src/main/notify.ts`): «Parked: <tool> in <папка Project-а>», без команды; одно на запрос.
- **Документация:** `docs/features/autopilot.md`, `docs/features/notifications.md`.

Вне списка «Где в коде» (без них park не подключить): `src/main/vendors/claude/session.ts` (драйвер),
`src/shared/agent/events.ts` (поля `parked` у `permission_request` и `answer` у `auto_approval`),
`src/main/agent/session.ts` и `src/main/agent/orchestrator.ts` (снятие при обычном Stop),
`test/contract/auto-approve-claude.test.ts` (запрос вне корней теперь ждёт ответа: test отвечает на карточку),
`test/unit/orchestrator-new-session.test.ts`.

Не сделано здесь:

1. **Какой вариант выбрал владелец, в Journal не попадает.** Событие несёт `answer`, но строку пишет `run.ts`
   (`autoApprovalLine`), а схему строки — `src/shared/autopilot/journal.ts`; оба файла этой Wave принадлежат другим
   Ticket-ам. Строка `park-answered` пишется, без поля ответа.
2. **Строка `park-expired` при остановке Run-а в Journal не проверена.** Событие приходит уже после `run-stopped`;
   пишет ли его Run в этот момент, зависит от порядка отписки в `run.ts`. Test-ы проверяют событие Session-а.
3. **Codex** park не делает — это Ticket 05 (approval-ветка Codex).
