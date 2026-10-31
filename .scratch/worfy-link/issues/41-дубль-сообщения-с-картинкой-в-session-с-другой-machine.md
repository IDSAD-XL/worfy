# 41 — Сообщение с картинкой показано дважды в Session, открытой с другой Machine

Type: bug
Status: open
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

- [ ] Test воспроизводит дубль (красный до правки) и зелёный после; в «Итог» — какая гипотеза подтвердилась.
- [ ] Существующие test-ы склейки и эха зелёные: `test/unit/session-log-resume.test.tsx`, `test/unit/session-view.test.tsx`,
      `test/contract/transcript-parse.test.ts`.
- [ ] Пределы test-ов не подняты; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; ci-ok зелёный.
- [ ] (вручную, с владельцем) сообщение с картинкой с Mac на ПК показано один раз.

## Где в коде

- `src/renderer/session/store.ts` (`joinPastAndLive`, `identity`, `typed`, эхо `:137`)
- `src/renderer/claude-home/useClaudeHome.ts`, `src/renderer/session/SessionView.tsx:149-151` (только читать, если не нужно)
- `test/unit/session-log-resume.test.tsx`, `test/unit/session-view.test.tsx`

## Итог

Заполняется при закрытии.
