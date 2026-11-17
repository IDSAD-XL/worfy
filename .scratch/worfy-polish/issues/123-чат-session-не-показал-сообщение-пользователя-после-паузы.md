# 123 — Session view не показал сообщение пользователя, отправленное после двух часов простоя

Type: bug
Status: claimed 2026-11-17T20:31Z
PR: #1968
Blocked by: none
Source: баг-репорт владельца 2026-11-17 (скриншот Session view Orchestrator-а: после «Turn finished · 5 m 17 s»
сразу «Thinking» и ответ, вопроса пользователя нет).

Кто: агент.

## Что происходит

- Session Orchestrator-а закончила ход в 14:37 (длительность хода 322 с, в Session view «Turn finished · 5 m 17 s»). Через
  два часа, в 16:26:48, владелец отправил вопрос «для слака есть мсп нормальный?». Агент его получил и ответил.
- В Session view этого сообщения нет: после строки «Turn finished» сразу идут свёрнутый «Thinking» и ответ.
- В transcript-е Claude Code сообщение записано как обычное: запись `queue-operation` `enqueue`, затем `dequeue` через
  1 мс, затем запись `user` с `origin.kind: human`, строкой в `content` и без `isMeta`. Следом идёт отдельная запись
  `attachment` типа `deferred_tools_delta`, которая сообщение не меняет. Так записан и первый prompt Session-а, и он в
  Session view виден.

## Что известно (разбор scout-а 2026-11-17, код не запускали)

- Путь из файла в Session view сообщение не теряет: `src/shared/transcript/parse.ts:196` (`userRecord`) → `parse.ts:117`
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

## Решения владельца 2026-11-17 (grilling, «на все ок»)

1. Ticket идёт сейчас, отдельно, одним implementer-ом (`ship-ticket`), не ждёт Wave worfy-polish.
2. Исправление — правило, а не один путь: каждое сообщение, которое агент получил, видно в Session view ровно один раз.
   Это касается сообщения из очереди, сообщения после перезапуска процесса агента, того же текста ещё раз и сообщения
   после перечитывания transcript-а. На каждый путь — свой test.
3. На воспроизведение — один заход, около часа. Не воспроизвелось — исправления по догадке нет. Вмерживается только
   запись порядка событий Session-и в лог (тип события, время, id Session-и; без текста сообщений), Ticket остаётся
   открытым до следующего случая.
4. Без страховки: Session view не подставляет строку пользователя из transcript-а, когда её нет в живых событиях.
   Страховка спрятала бы причину. Вернуться к ней, только если причина так и не найдётся.
5. Глубина review — `low`. Brief требует test-ы на гонки: `prompt` раньше подписки Session view, echo SDK раньше
   своей строки, `renamed` раньше `prompt`. Каждый test краснеет на мутанте исправления.
6. Термин — Session view (`CONTEXT.md`); слово «чат» для него не используется.
7. Ручной проверки владельцем на Stable нет: хватает unit test-ов и лога из пункта 3.

## Что делаем

1. Воспроизвести: Session закончила ход, простой (или перезапуск процесса агента и окна, как бывает после долгого
   простоя), затем новое сообщение. Записать порядок событий `agent.event` (`prompt`, `renamed`, `init`, `result`).
   Не больше одного захода, около часа (решение 3).
2. Найти, где теряется строка, и исправить в `store.ts` и/или `session.ts`.
3. Test, который краснеет на сегодняшнем коде и зеленеет после исправления: Session-у после `result` и паузы приходит
   новое сообщение, строка пользователя видна в Session view ровно один раз.
4. Test-ы правила (решение 2) и гонок (решение 5).
5. Не воспроизвелось — вместо пунктов 2–4 только запись порядка событий в лог, причина в «Итог» как «не найдена», Ticket
   остаётся открытым (решение 3).

## Готово, когда

- [ ] Причина найдена и записана в «Итог» (какое событие и где терялось).
  - evidence: commit pass · worfy-polish/123: keep a message sent after a resume below the turns before it · - - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Сообщение, отправленное после простоя Session-а, видно в её Session view ровно один раз, и до ответа агента, и после
      перечитывания transcript-а.
  - evidence: test-run pass · `pnpm test test/unit/session-prompt-after-restart.test.tsx test/unit/session-resume-event-order.test.ts` exit 0 · mac - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Unit test на этот сценарий: красный на коде до исправления, зелёный после.
  - evidence: test-run pass · `pnpm test test/unit/session-prompt-after-restart.test.tsx test/unit/session-resume-event-order.test.ts` exit 0 · mac - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Ровно один раз видно и сообщение из очереди, и сообщение после перезапуска процесса агента, и то же сообщение
      после перечитывания transcript-а: по test-у на каждый путь.
  - evidence: test-run pass · `pnpm test test/unit/session-prompt-after-restart.test.tsx test/unit/session-resume-event-order.test.ts` exit 0 · mac - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Test-ы гонок: `prompt` раньше подписки Session view, echo SDK раньше своей строки, `renamed` раньше `prompt`;
      каждый краснеет на мутанте исправления.
  - evidence: test-run pass · `pnpm test test/unit/session-prompt-after-restart.test.tsx test/unit/session-resume-event-order.test.ts` exit 0 · mac - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Страховки из transcript-а нет (решение 4).
  - evidence: commit pass · worfy-polish/123: keep a message sent after a resume below the turns before it · - - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61
- [ ] Повтор prompt-а с тем же текстом во втором ходе не задваивается и не пропадает (существующие test-ы
      `test/unit/session-queued-message.test.tsx` и `test/unit/session-log-resume.test.tsx` зелёные).
  - evidence: test-run pass · `pnpm test test/unit/session-queued-message.test.tsx test/unit/session-log-resume.test.tsx` exit 0 · mac - · 22ab3c93d0da5ec299252dc5529d82fe1a979c61

## Где в коде

- `src/renderer/session/store.ts`
- `src/main/agent/session.ts`
- `test/unit/session-queued-message.test.tsx`
- `test/unit/session-log-resume.test.tsx`

## Итог

- **Причина найдена.** Сообщение не терялось, а стояло не там: выше хода, который был до паузы, вне экрана. Между ходами
  Autopilot отдал Orchestrator обратно (`Orchestrators.relaunch`, attended): старая Session закрылась (в transcript-е —
  запись `cost-state` после хода 14:37), новая запустилась с `resume` и до первого `system/init` своего процесса жила под
  временным id `pending-…` (`src/main/agent/session.ts`, конструктор). Событие `prompt` ушло под этим id, затем `renamed`
  вернул Session к id SDK-сессии — а под ним store renderer-а уже держал ходы старой Session. Ветка `renamed` в
  `acceptAgentEvent` (`src/renderer/session/store.ts`) склеивала `[...события временного id, ...события нового id]`, то
  есть считала log нового id более новым. Строка вопроса встала перед первым ходом Session; после «Turn finished» шли
  сразу Thinking и ответ.
- Порядок событий, записанный на настоящей Session с fake agent (`test/unit/session-resume-event-order.test.ts`):
  `<sdk>:prompt, <sdk>:init, <sdk>:result` (ход до перезапуска), затем `pending-…:prompt` (агент получает сообщение),
  `<sdk>:renamed, <sdk>:init, <sdk>:result`. На этом порядке store до исправления ставил строку вопроса первой, над ходом
  до перезапуска: все test-ы `test/unit/session-prompt-after-restart.test.tsx` на коде до исправления красные.
- **Исправление** (`store.ts`): у каждого log-а store есть `opened` — порядковый номер, когда store его завёл. `renamed`
  ставит первым log, заведённый раньше: обычно временного id, а у Session, запущенной заново с `resume`, — log нового id.
  Тем же правилом `echo`, очередь, settings, context, narration, MCP и `quietSince` берутся из более нового log-а (раньше
  — всегда из log-а нового id: после возврата Orchestrator-а header мог показать `bypassPermissions` запуска Autopilot-а).
  Страховки из transcript-а нет (решение 4).
- Test-ы путей (решение 2), `test/unit/session-prompt-after-restart.test.tsx`: сообщение после перезапуска процесса
  агента, сообщение из очереди новой Session, тот же текст во втором ходе, перечитывание transcript-а (файл с новым ходом
  и без него). Порядок событий main для перезапуска и очереди — `test/unit/session-resume-event-order.test.ts`.
- Test-ы гонок (решение 5), там же: `prompt` раньше подписки Session view (view
  открылся после; view ещё показывал временный id), echo SDK после `renamed` при незакрытом echo прошлого хода,
  `renamed` раньше `prompt`, settings новой Session. Мутанты исправления (log нового id всегда новее; echo и settings из
  log-а нового id; без счётчика `opened`) — каждый test краснеет хотя бы на одном.
- Echo SDK раньше строки `prompt` из main не приходит: `deliver()` шлёт `prompt` до того, как отдаёт сообщение агенту, а
  `renamed` — первое событие под новым id (это проверяет `test/unit/session-resume-event-order.test.ts`).
- `src/main/agent/session.ts` не менялся: временный id при `resume` нужен (Claude Code может назвать сессию иначе), ошибка
  была в предположении store-а.
- Страница `docs/features/sessions.md` («An id arrives late») дополнена этим правилом.
