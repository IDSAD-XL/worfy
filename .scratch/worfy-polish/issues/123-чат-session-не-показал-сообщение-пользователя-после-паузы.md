# 123 — Чат Session-а не показал сообщение пользователя, отправленное после двух часов простоя

Type: bug
Status: open
Blocked by: none
Source: баг-репорт владельца 2026-11-17 (скриншот чата Session-а Orchestrator-а: после «Turn finished · 5 m 17 s»
сразу «Thinking» и ответ, вопроса пользователя нет).

Кто: агент.

## Что происходит

- Session Orchestrator-а закончила ход в 14:37 (длительность хода 322 с, в чате «Turn finished · 5 m 17 s»). Через
  два часа, в 16:26:48, владелец отправил вопрос «для слака есть мсп нормальный?». Агент его получил и ответил.
- В чате Session-а этого сообщения нет: после строки «Turn finished» сразу идут свёрнутый «Thinking» и ответ.
- В transcript-е Claude Code сообщение записано как обычное: запись `queue-operation` `enqueue`, затем `dequeue` через
  1 мс, затем запись `user` с `origin.kind: human`, строкой в `content` и без `isMeta`. Следом идёт отдельная запись
  `attachment` типа `deferred_tools_delta`, которая сообщение не меняет. Так записан и первый prompt Session-а, и он в
  чате виден.

## Что известно (разбор scout-а 2026-11-17, код не запускали)

- Путь из файла в чат сообщение не теряет: `src/shared/transcript/parse.ts:196` (`userRecord`) → `parse.ts:117`
  (`notice` `kind: 'user'`) → `src/renderer/session/fold.ts:116-118` (строка prompt; отбрасывается только
  `INTERRUPT_NOTICE`).
- Строку «Turn finished» (`ResultRow`, `src/renderer/session/Transcript.tsx:447-472`) рисует только live событие
  `result`. Значит, в live log были `result` первого хода и `thinking` и ответ второго, а события `prompt` второго хода
  не было.
- Live путь: `send()` (`src/main/agent/session.ts:456`) → `deliver()` (`session.ts:947`) шлёт `{type: 'prompt'}`, а при
  состоянии `error` или `run === null` перед этим запускает `begin()` (`session.ts:948`). Renderer добавляет строку в
  `acceptAgentEvent`, case `'prompt'` (`src/renderer/session/store.ts:173-179`), и ставит `echo`; SDK-echo того же
  текста отбрасывается (`store.ts:181`).
- Чат Session-а склеивает файл и live log функцией `joinPastAndLive` (`store.ts:328`).

## Подозрения (не подтверждены)

1. Событие `prompt` ушло в renderer раньше, чем после простоя восстановилась подписка на события Session-а, или раньше
   `renamed`/`init` нового запуска (`begin()` в `deliver()`). Тогда ветка `renamed` в `acceptAgentEvent`
   (`store.ts:125-154`) могла не найти старый log и выйти рано.
2. Гонка `echo` (`store.ts:181`): SDK-echo пришёл раньше локального `prompt`, или локального не было вовсе.
3. `joinPastAndLive` (`store.ts:328-367`) после простоя выбрал `start` так, что строка prompt из файла не попала в
   результат, а в live её не было.

## Что делаем

1. Воспроизвести: Session закончила ход, простой (или перезапуск процесса агента и окна, как бывает после долгого
   простоя), затем новое сообщение. Записать порядок событий `agent.event` (`prompt`, `renamed`, `init`, `result`).
2. Найти, где теряется строка, и исправить в `store.ts` и/или `session.ts`.
3. Test, который краснеет на сегодняшнем коде и зеленеет после исправления: Session-у после `result` и паузы приходит
   новое сообщение, строка пользователя видна в чате ровно один раз.

## Готово, когда

- [ ] Причина найдена и записана в «Итог» (какое событие и где терялось).
- [ ] Сообщение, отправленное после простоя Session-а, видно в её чате ровно один раз, и до ответа агента, и после
      перечитывания transcript-а.
- [ ] Unit test на этот сценарий: красный на коде до исправления, зелёный после.
- [ ] Повтор prompt-а с тем же текстом во втором ходе не задваивается и не пропадает (существующие test-ы
      `test/unit/session-queued-message.test.tsx` и `test/unit/session-log-resume.test.tsx` зелёные).

## Где в коде

- `src/renderer/session/store.ts`
- `src/main/agent/session.ts`
- `test/unit/session-queued-message.test.tsx`
- `test/unit/session-log-resume.test.tsx`
