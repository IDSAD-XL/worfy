# 171 — Время у сообщений во вкладке Chat панели Assistant

Type: polish
Status: open
Blocked by: None — can start immediately
Source: просьба владельца 2026-11-28 со screenshot-ом панели Assistant (вкладки Waits / Summary / Journal / Chat): во
вкладке Chat у сообщений нет времени. Слова владельца: «добавь время сообщений у ассистента».

Кто: агент. Глубина review — `medium`. Не платформенный PR.

## Что происходит

- Время у каждого сообщения уже есть в данных. В `conversationMessageSchema` есть поле `at: z.number()`
  (`src/shared/assistant/window.ts:128-140`, поле — строка 130). Хранится оно в `<WORFY_DATA_DIR>/assistant/window.json`
  (`src/main/assistant/window/store.ts:1`, `:58`), последние 200 сообщений (`CONVERSATION_KEEP`, строка 11).
- Откуда берётся `at`:
  - сообщение пользователя и ожидающий ответ получают время отправки (`send`, `src/main/assistant/window/view.ts:731-732`);
  - когда ответ приходит, `at` ответа заменяется временем ответа (`answer`, `view.ts:747-751`);
  - сообщения wake-ов (morning, batch, urgent) и знакомства получают время записи (`noteAssistantMessage`,
    `view.ts:769-770`).
- Компонент `Chat` (`src/renderer/assistant/AssistantPanel.tsx:345-389`) поле `at` не показывает. Сообщение пользователя —
  bubble справа (строки 354-358). Сообщение Assistant-а — avatar, bubble и like/dislike (строки 363-381). Пока ответ
  пишется, вместо текста — три точки.
- Chat Session время показывает:
  - `rowTime` (`src/renderer/session/Transcript.tsx:192-201`): `HH:MM` в 24 h по местному времени. Для другого дня
    перед временем стоит дата (`Oct 4`, а для другого года — `Dec 31 '25`). Tooltip — полное время с секундами
    `YYYY-MM-DD HH:MM:SS`;
  - `RowTime` рисует `<time dateTime=… title=…>` (строки 216-226);
  - `useToday` перечитывает «сегодня» в полночь (строки 167-183);
  - в chat Product Session время стоит в строке над bubble: «You · 13:52 · #3» (`Message`, строки 262-276).
- В других вкладках Assistant-а время даёт свой `shortTime` (`src/renderer/assistant/format.ts:6-11`). Для сегодня он
  берёт `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`: при локали en-US это 12 h («04:56 AM»). Для
  другого дня — только день недели. В chat этот формат не брать: он расходится с chat Session и не даёт дату.

## Что строить

1. `rowTime`, `useToday` и `RowTime` перенести из `Transcript.tsx` в общий модуль renderer-а (например,
   `src/renderer/session/row-time.tsx`). Transcript импортирует их оттуда, его поведение не меняется.
2. В `Chat` (`AssistantPanel.tsx`) у каждого сообщения — время через `RowTime`. Оно стоит под bubble, мелким
   muted-текстом (`--text-muted`, 11 px, `tabular-nums`), с той стороны, где bubble: у пользователя справа, у
   Assistant-а слева, после avatar-а. Tooltip — полное время, как в chat Session.
3. Время — и у сообщений пользователя, и у сообщений Assistant-а. Их рисует один компонент `Chat`, данные одни
   (`at`), а chat Session показывает время у обеих сторон. Так видно, сколько ответ шёл.
4. У ожидающего ответа (`state: 'pending'`, три точки) времени нет: его `at` — время отправки, а не ответа. У ответа
   с `state: 'failed'` время есть.
5. «Сегодня» для chat — свой `useToday`. Default `NowContext` в Transcript — 0, его в Assistant не брать.
6. `shortTime` в Waits, Summary и Journal не менять.
7. `docs/features/assistant.md` (абзац **Chat**, строки 151-155) и `docs/features/ru/assistant.md` — одна
   фраза: у каждого сообщения — время, у сообщений другого дня — дата, полное время — в tooltip-е.

## Где в коде

- `src/renderer/assistant/AssistantPanel.tsx:345-389` — `Chat`.
- `src/renderer/assistant/assistant.css:717-746` — `.w-asst-message` и `.w-asst-bubble`; рядом — класс строки времени.
- `src/renderer/session/Transcript.tsx:167-226` — `NowContext`, `useToday`, `rowTime`, `useRowTime`, `RowTime` (перенос).
- `src/renderer/session/session.css:1239-1249` — `.w-tr__time`, `.w-tr__date` (как образец вида).
- `src/shared/assistant/window.ts:128-140`, `src/main/assistant/window/view.ts:731-732`, `:747-751`, `:769-770` — для
  сверки, не менять.
- `docs/features/assistant.md` и `docs/features/ru/assistant.md`.

## Test-ы

- `test/unit/assistant-panel.test.tsx` (там уже есть сообщения с `at: NOW`, строки 294 и 343). Новые проверки:
  - у сообщения пользователя и у ответа Assistant-а есть время `HH:MM` в 24 h;
  - у сообщения другого дня время идёт с датой;
  - tooltip — полное время `YYYY-MM-DD HH:MM:SS`;
  - у `pending` времени нет, у `failed` есть.
  Test-ы красные до правки.
- Перенос не ломает время в Transcript: `test/unit/session-view.test.tsx` и `test/unit/product-transcript.test.tsx`
  (они проверяют `transcript-time`, `transcript-clock`, `transcript-date`) — зелёные без правок.
- E2e не нужен.

## Готово, когда

- [ ] Во вкладке Chat у каждого сообщения пользователя и Assistant-а — время, у сообщения другого дня — с датой, полное
      время в tooltip-е; у ожидающего ответа времени нет. Формат тот же, что в chat Session (общий модуль).
- [ ] Unit test-ы в `test/unit/assistant-panel.test.tsx` красные до правки; test-ы Transcript зелёные без правок.
- [ ] `docs/features/assistant.md` и `docs/features/ru/assistant.md` говорят о времени сообщений.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
- [ ] (вручную) Сделай: в Stable worfy открой панель Assistant → Chat, напиши Assistant-у и дождись ответа → Должно
      быть: под обоими сообщениями — время в 24 h, под ответом — время ответа; у вчерашних сообщений — дата; наведение
      на время показывает полное время.
  - needs: mac stable
