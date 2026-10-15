# 08 — Файл или картинку можно бросить прямо на Узел Session-а

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат U2; «Итог»
[`worfy-mvp` 20](../../worfy-mvp/issues/20-поле-ввода-slash-и-вложения.md): «Перетаскивание на Узел не
сделано. `SessionNode.tsx` вне следа тикета; файлы принимает поле ввода Session view. Узел Сессии —
отдельная правка».

## Что происходит

- Вложения есть только в поле ввода Session view: `MessageInput.tsx` читает брошенные и вставленные
  файлы (`attachFiles`, `src/renderer/session/MessageInput.tsx:195-215`), проверяет их в main
  (`agent.attach`, `:183-189`) и показывает чипами; `agent.send` берёт `attachments`
  (`src/shared/ipc/agent.ts:43`). Обработчики `onDragOver` и `onDrop` — `:294-323`. Лимиты — в
  `src/shared/agent/attachments.ts` (картинка до 3,75 МБ, файл до 20 МБ, число вложений `MAX_ATTACHMENTS`).
- Узел живой Session-и (`data.origin: 'worfy'`) на Canvas тоже имеет поле ввода
  (`src/renderer/canvas/nodes/SessionNode.tsx:312-321`), но `send` (`:198-211`) шлёт только текст, а
  файл, брошенный на Узел, никто не принимает. Чтобы отдать Claude-у скриншот, приходится открывать
  Session view.

## Что делаем

1. **Общий код.** Чтение файлов и вызов `agent.attach` выносятся из `MessageInput.tsx` в
   `src/renderer/session/attach-files.ts` (чистая функция над `File[]` и `invoke`, без React). Поведение
   `MessageInput` не меняется.
2. **Узел живой Session-и принимает файлы.** `onDragOver` на Узле (с файлами в `dataTransfer`) —
   подсветка рамки Узла цветом акцента (токены); `onDrop` — файлы проверяются тем же `agent.attach` и
   встают чипами над полем ввода Узла. Отправка — как сейчас, Enter или кнопка: текст и вложения вместе;
   сообщение только из вложений тоже уходит (правило `agent.ts:44`).
3. Узел Session-и не из worfy (только чтение) и Узел без поля ввода файлы не принимают: курсор
   «нельзя», ничего не происходит.
4. Если Session не запущена, бросок сначала делает то же, что отправка (`ensure()` — Resume), и только
   потом `agent.attach`: вложение привязано к `sessionId`.
5. Отказы (слишком большой файл, лишние вложения) — та же строка проблемы Узла, что у отправки.
6. Бросок на Узел не двигает Node и не создаёт Binding: `nodrag`, обработчики Canvas не получают событие.

## Готово, когда

- [ ] Unit test: бросок картинки и текстового файла на Узел живой Session-и — два чипа; отправка зовёт
      `agent.send` с `attachments` из `agent.attach`.
- [ ] Unit test: Узел внешней Session-и — `agent.attach` не зовётся.
- [ ] Unit test: файл больше лимита — отказ в строке проблемы, чипа нет, `agent.attach` для него не зовётся.
- [ ] Test-ы `message-input-attach.test.tsx` зелёные без изменения ожиданий (общий код не поменял поведение).
- [ ] (вручную) Stable copy: скриншот из Finder на Узел Session-и → Enter — Claude видит картинку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/session-node-drop.test.tsx` — новый; событие `drop` с `DataTransfer` в jsdom, `invoke` — mock,
  как в `test/unit/message-input-attach.test.tsx`.
- Сначала красный: «бросок на Узел даёт чип» на нынешнем коде.
- Мутанты: `send` без `attachments`; `attachments` не очищаются после успешной отправки; бросок на
  внешний Узел зовёт `agent.attach`. Каждый краснит свой test.

## Где в коде

- `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/session/MessageInput.tsx`
- `src/renderer/session/attach-files.ts`
- `test/unit/session-node-drop.test.tsx`
- `test/unit/message-input-attach.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/agent/attachments.ts`, `src/shared/ipc/agent.ts`, `src/main/agent/attachments.ts`,
`test/unit/session-nodes.test.tsx`.

## Вне скоупа

- Бросок на Canvas вне Узла (создать Card из файла).
- Бросок на Узел Ticket-а или Terminal-а.
- Кнопка «+» (выбор файла в диалоге) и вставка картинки из буфера на Узле — только бросок.

## Итог

—
