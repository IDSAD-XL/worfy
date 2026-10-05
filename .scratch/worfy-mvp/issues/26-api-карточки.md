# 26 — API Карточки через postMessage: свои данные, вопрос Сессии с подтверждением, workflow только для чтения

Type: task
Status: open
Blocked by: 10, 17, 24, 25
Source: [ADR-0003](../../../docs/adr/0003-cards-as-files-canvas-via-tools.md); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md); [CONTEXT.md](../../../CONTEXT.md), «Карточка»; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md), данные Карточек

## Что делаем

Карточка общается с worfy только сообщениями `postMessage`. Node у неё нет.

- Протокол (`src/shared/cards/bridge.ts`, zod): запрос `{type: 'worfy.request', requestId, op,
  args}`, ответ `{type: 'worfy.response', requestId, ok, data | error}`. Операции:
  - `data.get` / `data.set` — собственный JSON Карточки, до 1 МБ, в
    `<папка Проекта>/card-data/<id>.json` (`src/main/cards/data.ts`);
  - `session.ask {text}` — передать текст Сессии. worfy показывает системный диалог: имя
    Карточки, текст, Сессия-получатель. Только после «Send» текст уходит Сессии, которая последней
    правила Карточку (main выводит её из событий `tool_use`, тикет 24), а если её нет —
    Оркестратору. Отказ даёт
    `{ok:false, canceled:true}`;
  - `workflow.get` и `workflow.subscribe` — снимок Проекта только для чтения: Эпики, Тикеты (номер,
    заголовок, состояние, блокеры, Волна), бейджи Gate / PR / CI. Ничего, что меняет состояние;
  - со стороны worfy к Карточке — `card.text` (видимый текст, до 100 000 символов) для поиска (31).
- `src/renderer/canvas/card-bridge.ts` принимает сообщения только от `contentWindow` своего iframe
  и с ожидаемым origin; остальное молча отбрасывает.
- `src/card-runtime/worfy-card.ts` — маленький скрипт, который протокол из 25 подставляет в
  `<head>` каждой Карточки: `window.worfy.data.get()`, `.set()`, `.ask()`, `.workflow.get()`,
  `.workflow.subscribe()` как Promise-обёртки над сообщениями. Подстановка — правка
  `src/main/cards/protocol.ts`.
- Инструкция агенту из 24 получает раздел про этот API.

## Готово, когда

- [ ] Contract test на каждую операцию: валидный запрос, невалидный, превышение 1 МБ.
- [ ] Сообщение от чужого frame или с чужим origin игнорируется (test).
- [ ] `session.ask` без подтверждения не доходит до Сессии; с подтверждением — доходит именно последней правившей Сессии (fake-агент записывает сообщение).
- [ ] `workflow.get` отдаёт Тикеты эпика `worfy-mvp`; операции записи в workflow нет ни одной (test перечисляет операции).
- [ ] Карточка-fixture, использующая `window.worfy.data`, переживает перезапуск со своими данными.

## Тесты

- `test/contract/card-bridge.test.ts` — протокол, проверки отправителя, лимиты (новый).
- `test/e2e/card-api.spec.ts` — Карточка-fixture: данные, `session.ask` с подменённым диалогом, `workflow.get` (новый).
- Сначала падающий test: сообщение с чужим origin.

## Где в коде

- `src/shared/cards/bridge.ts`
- `src/renderer/canvas/card-bridge.ts`
- `src/main/cards/data.ts`, `src/main/cards/protocol.ts`
- `src/card-runtime/worfy-card.ts`
- `src/main/mcp/agent-instructions.md` (раздел про API)
