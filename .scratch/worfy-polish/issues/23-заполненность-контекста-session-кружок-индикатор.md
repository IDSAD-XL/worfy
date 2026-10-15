# 23 — Заполненность контекста Session: кружок с процентом окна контекста

Type: task
Status: open
Blocked by: —
Source: слово владельца 2026-10-15 (через Orchestrator-а): «Заполненность контекста текущей Session —
кружок-индикатор (процент заполнения окна контекста)».

## Что происходит

worfy показывает у Session модель, effort, режим разрешений и стоимость (шапка Session view,
`src/renderer/session/SessionView.tsx:153-215`; стоимость — `:206-212`). Сколько занято окно
контекста, не видно нигде. Пользователь узнаёт о нём, только когда Claude Code делает autocompact.

**Откуда worfy может это знать** (Agent SDK 0.3.289 проекта, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`;
перечитано по файлу, не по памяти):

1. **`Query.getContextUsage({ detail: 'summary' })`** (`sdk.d.ts:3028-3038`, метод интерфейса `Query`,
   `:2846`). `'summary'` отвечает по usage последнего ответа модели и локальной оценке, без отдельных
   запросов подсчёта токенов. Ответ `SDKControlGetContextUsageResponse` (`:3949`): `totalTokens`,
   `maxTokens`, `rawMaxTokens`, `percentage` (`:3960-3963`), `model`, `autoCompactThreshold`,
   `isAutoCompactEnabled` (`:4017-4018`). Это те же числа, что у команды `/context`.
   Важно: окно, к которому считается процент, — окно autocompact, а не всё окно модели. У моделей с
   окном 1M это может быть меньшая граница, например 200K (описание `raw_max_tokens` в `SDKContextUsage`, `:3788-3791`).
2. **Usage последнего ответа модели** (input + cache read + cache creation) и окно модели из
   `result.modelUsage[<model>].contextWindow` (`ModelUsage`, `:1432-1444`; `modelUsage` у result —
   `:5689`). Считать самим. worfy сейчас берёт из result только сумму usage за ход
   (`src/shared/agent/events.ts:315-317`, `:530-535`) — это не заполненность окна.
3. **Транскрипт Session-а вне worfy** — только чтение файла; usage в строках есть, а окно модели
   (200K или 1M) из файла не узнать надёжно. Для внешних Session-ов — вне скоупа (владелец 2026-10-15: при нужде — отдельный Ticket).

Сейчас `QueryHandle` worfy (`src/main/agent/session.ts:90-102`) метода `getContextUsage` не имеет;
fake SDK (`src/main/agent/fake-query.ts`) — тоже.

## Что делаем

1. **Сначала красный contract test** на fake SDK: после `result` хода Session шлёт событие с
   заполненностью контекста (процент, токены, окно, порог autocompact). На main красный.
2. **Источник — способ 1.** `QueryHandle` получает `getContextUsage`; fake-query отвечает заданными
   числами. После каждого `result` (`session.ts:741-750`) и после события compaction main спрашивает
   `getContextUsage({ detail: 'summary' })` и шлёт новое событие Session-а (тип, например,
   `context`, в `src/shared/agent/events.ts`). Ошибка запроса — не ошибка хода: индикатор
   показывает «нет данных». Если метод отвечает дольше хода или с ошибкой на настоящем Claude Code —
   запасной способ 2, записать в «Итог».
3. **Кружок.** Кольцо, заполненное на `percentage`; цвет — как уровни полос Limits (обычный, ближе к
   порогу, у порога; токены темы, без новых цветов); подсказка: `<total> / <window> tokens ·
   autocompact at <threshold>` или `autocompact off`.
4. **Место — рекомендация:** нижняя панель поля ввода, рядом с выбором модели и effort. Это точка
   расширения: новый файл `src/renderer/session/composer/ContextMeter.tsx`, `MessageInput.tsx` не
   правится (`src/renderer/session/composer/index.ts:1-8`; выбор модели — `Pickers.tsx`, `order =
   10`). Так же место у Claude Code CLI.
   **Альтернатива:** шапка Session view рядом со стоимостью (`SessionView.tsx:206-212`) — новый
   «fact» `Context 42 %`. Владелец 2026-10-15 выбрал рекомендацию.
5. **Снимки** — 10 %, 75 %, 95 % и «нет данных», светлая и тёмная тема, —
   `.scratch/worfy-polish/evidence/23-*.png`.

## Готово, когда

- [ ] Contract test пункта 1 красный на main и зелёный с правкой; ни одного запуска настоящего Claude
      Code (fake SDK).
- [ ] Unit test кружка: процент, цвет по порогам, подсказка, «нет данных», `autocompact off`.
- [ ] Мутант «событие не шлётся после compaction» — красный test.
- [ ] (вручную) Stable copy, живой Orchestrator: процент совпадает с `/context` той же Session (до
      1 п.п.); значение и снимок — в «Итог».
- [ ] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Contract — `test/contract/agent-context-usage.test.ts` (новый), fake SDK.
- Unit — `test/unit/context-meter.test.tsx` (новый).
- Ручная сверка с `/context` — только на Stable copy (Autopilot над worfy — только там).

## Где в коде

- `src/main/agent/session.ts`
- `src/main/agent/fake-query.ts`
- `src/shared/agent/events.ts`
- `src/renderer/session/composer/ContextMeter.tsx`
- `test/contract/agent-context-usage.test.ts`
- `test/unit/context-meter.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/session/SessionView.tsx`, `src/renderer/session/MessageInput.tsx`,
`src/renderer/session/composer/index.ts`, `src/renderer/session/composer/Pickers.tsx`,
`src/renderer/limits/LimitBar.tsx`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. Если
выбрана шапка — `SessionView.tsx` дописывается в «Где в коде» при claim, а `ContextMeter.tsx` переезжает.

## Вне скоупа

- Session-ы, запущенные вне worfy, и окно Subagent-а (только чтение транскрипта) — без индикатора.
- Настройка порога autocompact — Ticket 24.
- Узлы Session на Canvas — без индикатора (если нужен и там — отдельный Ticket).

## Итог

—
