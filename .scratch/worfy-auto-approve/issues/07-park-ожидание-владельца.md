# 07 — Park: ожидание владельца

Type: task
Status: open
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
- [ ] Unit test: предел ожидания — deny-with-hint и `park-expired`; остановка Run-а снимает parked запрос.
- [ ] Unit test: уведомление уходит один раз на запрос, без текста команды.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/auto-approve-park.test.ts` (новый); часы — через параметр, `ms()` для timeout-ов.
- Прогнать `test/unit/permissions*.test.ts`, `test/unit/notify*.test.ts`.

## Где в коде

- `src/main/agent/auto-approve/park.ts` (новый)
- `src/main/agent/permissions.ts`
- `src/main/notify.ts`
- `test/unit/auto-approve-park.test.ts` (новый)
