# 10 — Уведомление «ждёт тебя» доходит до Linked machine

Type: task
Status: open
Blocked by: —
Source: follow-up Ticket-а 06 (PR #501); решение владельца 2026-10-19, Q-c: #501 влит как есть, это — отдельный
Ticket, приоритет low.

## Что происходит

- Уведомление «`<epic> NN` ждёт тебя» показывает только Machine, на которой лежит Project: Ticket Project-а на
  Windows-ПК виден уведомлением только на ПК, на Mac — нет.
- Уведомления Session-ов уходят и на Linked machines: `Notifier.notify` показывает заметку у себя и шлёт её
  в `link` (`src/main/notify.ts:272-275`, `this.link?.send(note)`). Уведомления Ticket-ов идут мимо `link`:
  `installWaitsNotifications(…, new NoteDisplay<TicketNote>(…))` без него (`src/main/notify.ts:461`).
- Сообщение связи `note` описывает только Session: `sessionId` — обязательная строка
  (`src/main/link/notes.ts:27-37`), а у `TicketNote` `sessionId: null` и есть `ticket` (`src/main/notify.ts:84-90`).

## Что делаем

1. Сообщение связи для заметки Ticket-а: вариант `note` с `ticket` (`epic`, `num`) и `projectRoot` или своё
   сообщение; проверка zod на приёме, пределы длины — как у `note`.
2. Machine Project-а шлёт заметку Ticket-а на Linked machines по тем же правилам, что заметку Session
   (доступ, `isConnected`; ADR-0066 — read-only доступ получает заметки).
3. Linked machine показывает её с именем Machine-отправителя. Что открывает клик (вкладка Pipeline удалённого
   Project-а или окно worfy) — решить при работе по тому, что Linked machine уже показывает для Project-а другой
   Machine, и записать в «Итог».

## Готово, когда

- [ ] `pnpm test test/unit/notify.test.ts` — exit 0: переход в `Waits: owner` — одна заметка у себя и одна
      отправка в stub `link`; приём заметки Ticket-а — показ с именем Machine.
- [ ] `pnpm test test/unit/link-notify.test.ts` — exit 0: заметка Ticket-а проходит проверку сообщения,
      заметка без `ticket` и без `sessionId` — отказ.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Mac и ПК связаны: `ticket block <epic> <NN> "приёмка" --waits owner` на ПК — уведомление на Mac.

## Тесты

Сначала падающие случаи в `test/unit/notify.test.ts` (stub `NoteLink`) и в `test/unit/link-notify.test.ts`.

## Где в коде

- `src/main/notify.ts`
- `src/main/link/notes.ts`
- `src/main/workflow/waits-notify.ts`
- `test/unit/notify.test.ts`
- `test/unit/link-notify.test.ts`

## Итог

Заполняется при закрытии.
