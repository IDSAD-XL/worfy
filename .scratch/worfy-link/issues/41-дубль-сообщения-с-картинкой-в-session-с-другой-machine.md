# 41 — Сообщение с картинкой показано дважды в Session, открытой с другой Machine

Type: bug
Status: claimed 2026-10-31T05:08Z
Blocked by: —
Source: владелец 2026-10-31 (Stable `640b7a4c` на Mac и ПК): одно сообщение с картинкой, отправленное в Orchestrator
Project-а Mac на самом Mac, на ПК (Session Mac через связь) показано дважды, между копиями — строка «Added by Claude
Code»; после перехода в другой Project и обратно дубль пропал. На Mac — одно. Сообщение без картинки — одно на обеих
машинах. Соединение Mac↔ПК в этот момент одно (журнал связи Mac, `lsof`). Разбор кода — scout Orchestrator-а; причина
не доказана. Ticket заведён Orchestrator-ом.

## Что происходит

- Session view склеивает `past` (транскрипт, `src/renderer/claude-home/useClaudeHome.ts`) и `live` (`agent.event`,
  `src/renderer/session/store.ts:162`) в `joinPastAndLive` (`store.ts:224`). По uuid не дедуплицирует: `identity()`
  (`store.ts:182`) знает `messageId`, `tool.id`, `toolUseId`, `taskId`; prompt-ы срезаются по тексту (`typed()`,
  `store.ts:205`), обход стоп на событии с id (`store.ts:252`) или когда кончились prompt-ы с этим текстом (`:256`).
- Картинка даёт в транскрипте за user-записью запись `isMeta: true, turnCompanion: true` («Added by Claude Code»,
  `parse.ts:116`, `Transcript.tsx:488`) — событие без id между prompt-ом и ответом.
- Гипотезы (по убыванию): (1) склейка не срезала prompt в `past` при этой последовательности и задержках чтения через
  связь; (2) эхо user-сообщения с «Attached images: …» не равно `log.echo` (`store.ts:137`) — тогда дубль был бы и на
  Mac; (3) перекрытие чтений `past`.

## Что делаем

1. Сначала воспроизвести: test, который краснеет так, как видел владелец (prompt с картинкой → companion → ответ;
   `past` и `live` в порядке и с задержками, как на удалённом view). Начать с unit `joinPastAndLive`
   (`test/unit/session-log-resume.test.tsx`), при необходимости — contract/e2e с двумя связанными worfy и fake agent.
2. Исправить причину, которую показал test, а не гипотезу. Сообщение без картинки и локальный view не меняются.

## Готово, когда

- [x] Test воспроизводит дубль (красный до правки) и зелёный после; в «Итог» — какая гипотеза подтвердилась.
- [x] Существующие test-ы склейки и эха зелёные: `test/unit/session-log-resume.test.tsx`, `test/unit/session-view.test.tsx`,
      `test/contract/transcript-parse.test.ts`.
- [ ] Пределы test-ов не подняты; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; ci-ok зелёный.
- [ ] (вручную, с владельцем) сообщение с картинкой с Mac на ПК показано один раз.

## Где в коде

- `src/renderer/session/store.ts` (`joinPastAndLive`, `identity`, `typed`, эхо `:137`)
- `src/renderer/claude-home/useClaudeHome.ts`, `src/renderer/session/SessionView.tsx:149-151` (только читать, если не нужно)
- `test/unit/session-log-resume.test.tsx`, `test/unit/session-view.test.tsx`

## Итог

Подтвердилась гипотеза 1 (склейка не срезала prompt в `past`), но причина не в картинке и не в задержках чтения.
Гипотезы 2 (эхо) и 3 (перекрытие чтений) не понадобились: test воспроизводит картину без них.

Причина. `joinPastAndLive` (`src/renderer/session/store.ts`) считал «открывающими» только prompt-ы live-событий до
первого live-события с id. Но у live-событий бывают id, которых файл транскрипта не пишет: конец фонового Bash-а,
который Claude Code принял между ходами без нового хода (`system/task_notification` → `subagent finished`; в файле от
него только записи `queue-operation`). Если такое событие пришло первым, prompt следующего хода не считался
открывающим, и обход назад от точки склейки (ответ на prompt) останавливался на нём: prompt оставался из файла и
приходил ещё раз из live. Строка «Added by Claude Code» (companion картинки) из файла стояла между ними; конец
задачи рисуется на строке своего Bash-вызова, отдельной строки между копиями нет. Получалось ровно «prompt → Added →
prompt».

Почему только на ПК и только иногда. Окно Linked machine перезагружается при открытии Project-а (и при смене
соединения), его live-события начинаются с этой минуты. Дубль нужен такой порядок: окно открылось между ходами,
затем пришёл конец фоновой задачи, затем prompt. На Mac live-события Orchestrator-а начинаются гораздо раньше, их
первые id есть в файле — склейка правильная. Переход в другой Project и обратно перезагружает окно — дубль пропадает.
В транскрипте владельца перед обоими сообщениями с картинкой (04:54:29 и 04:56:09) такие концы фоновых задач есть
(`queue-operation` с `reason: absorbed_mid_turn`), перед сообщениями без картинки — нет. Сама картинка дубль не
вызывает: без неё было бы «prompt → prompt» при том же порядке. Что окно ПК открылось именно в этот промежуток,
проверить нельзя — журнала окна ПК нет.

Правка. «Открывающие» prompt-ы — live-события до того live-события, которое файл имеет в точке склейки (все
live-события, если общих id нет). Test-ы: `test/unit/session-log-resume.test.tsx` — «shows a live prompt once when
the live events open with an event the transcript does not record» и блок «a message with an image in a window
opened from another Machine» (синтетические записи транскрипта той же формы, что у владельца, через
`parseTranscriptLines`, и SDK-сообщения через `sdkMessageToEvents` и store); оба красные до правки.

Побочный эффект правки (известный пробел, закреплён test-ом «while the file has none of the live ids, …»): пока у
файла нет ни одного id из live-событий, prompt до Resume без ответа и без прерывания склеивается с любым live prompt с
тем же текстом, а не только с первым. Он показан один раз, из live. Это временно: как только файл догонит первый
live-ход, такой prompt снова показан отдельно (test «keeps a prompt from before Resume without answer when the same
text comes live after the turn the file has»; он же красный на варианте «открывают все live prompt-ы»).

Не исправлено: если файл прочитан раньше, чем live-событие с тем же id пришло (файл «впереди» live), дубль виден
до прихода этого события; отличить такой случай от хода до Resume с тем же текстом без времени нельзя.
