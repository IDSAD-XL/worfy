# 01 — Card читает workflow без вопроса и шлёт данные на любой https: оставить или сузить

Type: grilling
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Находки», находка security-1; [ADR-0015](../../../docs/adr/0015-card-api-window-worfy-postmessage.md)

## Question

Card — HTML, который пишет агент или приносит пользователь. Сейчас любая Card без вопроса получает снимок workflow
своего Project-а и может отправить его на любой https-хост. Оставляем так или сужаем?

Что есть на коммите аудита `b9abc6a7d`:

- `src/shared/cards/bridge.ts:28`: в `CARD_OPS` есть `workflow.get` и `workflow.subscribe`.
- `src/renderer/canvas/card-bridge.ts:115-120` отвечает на них снимком без диалога. Диалог есть только у `session.ask`.
- Снимок (`workflowSnapshot` в `src/shared/cards/bridge.ts`) содержит Epic-и, заголовки и состояния Ticket-ов,
  результат gate, номер, состояние и URL PR, состояние CI.
- `src/main/cards/protocol.ts:57-59`: CSP Card разрешает `img-src https:` и `connect-src https:`.

Атакующий — злонамеренная Card. Её может написать prompt-injected агент через Card MCP (`create_card`), даже если у
него нет shell и сети; или пользователь откроет чужой HTML как Card. Он получает метаданные приватного проекта: имена
Epic-ов и Ticket-ов, адреса PR. Файлов, секретов и IPC он не получает.

Каждая половина решена отдельно: ADR-0015 — чтение workflow без вопроса; `worfy-mvp/25` — `fetch('https://…')`
разрешён. Вместе их не взвешивали.

Варианты:

- **а.** Оставить. Записать в ADR-0015 (Amendment) и в `docs/features/cards.md`, что Card может отправить снимок
  workflow на любой https.
- **б.** Сузить сеть. `connect-src` и `img-src` — только `'self'` и `data:` или список origin-ов из манифеста Card.
  Сужать только `connect-src` бесполезно: `img-src https:` и так отправляет данные GET-запросом.
- **в.** Разрешение на Card. `workflow.get` и `workflow.subscribe` — только после одного подтверждения пользователя на
  эту Card (как у `session.ask`, но один раз), сеть как сейчас.

Рекомендация: **в** — она закрывает путь и не ломает Card, которые берут данные из сети.

## Answer

—

## Готово, когда

- [ ] Владелец выбрал вариант. Выбор записан в ADR-0015 как Amendment или в новом ADR.
- [ ] Для вариантов б и в заведён Ticket `Type: task` с test-ом: Card без разрешения не получает снимок (в) или
      запрос на чужой https блокирует CSP (б).

## Где в коде

- `src/shared/cards/bridge.ts` — `CARD_OPS`, `workflowSnapshot`.
- `src/renderer/canvas/card-bridge.ts` — ответ на `workflow.get` и `workflow.subscribe`.
- `src/main/cards/protocol.ts` — `CARD_CSP`.
- `docs/adr/0015-card-api-window-worfy-postmessage.md` — решение о чтении workflow.
