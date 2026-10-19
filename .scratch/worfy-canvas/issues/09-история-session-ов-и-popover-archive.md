# 09 — Archive: история Session-ов у Ticket-а и Epic-а, popover «Archive» рядом с Trash

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), решение владельца 5;
[ADR-0076](../../../docs/adr/0076-auto-archive-of-finished-sessions.md) (автоархив законченных Session-ов),
пункты 5 и 6; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P2, варианты
2b и 2c. Термин Archive — `CONTEXT.md`. Код перечитан по main `7dab925f`.

## Что происходит

- Архивный Node не на Canvas (Ticket 07), и найти его негде.
- Слоты на Node-ах workflow (`src/renderer/canvas/badges/index.ts:1-12`): `badges` у Ticket-а и Session,
  `actions` у Ticket-а и Epic frame-а; модуль слота — один файл, Node-ы не правятся. Subject — `:18-21`.
  Epic frame рисует только `actions` (`src/renderer/canvas/nodes/EpicFrameNode.tsx:104`).
- Popover Trash — образец: `src/renderer/canvas/overlays/TrashPopover.tsx:1-4`, `order = 30` (`:13`).
- Binding Session-а — `src/shared/binding/resolve.ts`; в renderer — `src/renderer/binding/store.ts`.

## Что делаем

1. **Список** — `src/renderer/canvas/archive-list.ts` (новый): архивные Session Node-ы Project-а по Binding-у
   — к Ticket-у, к Epic-у, без Binding; внутри — по `archived.at`, новые сверху.
2. **История у Ticket-а** — badge «N sessions» (`src/renderer/canvas/badges/SessionHistory.tsx`, новый),
   когда у Ticket-а есть архивные Session-ы. Клик — список с заголовком, временем конца и кнопкой Show.
3. **История у Epic-а** — кнопка «N sessions» в шапке рамки (`src/renderer/canvas/actions/EpicSessionHistory.tsx`,
   новый): Session-ы с Binding к Epic-у и к его Ticket-ам.
4. **Popover «Archive»** — `src/renderer/canvas/overlays/ArchivePopover.tsx` (новый, рядом с Trash): кнопка
   «Archive N»; список Session-ов без Binding по дате; поиск по заголовку; Restore у строки и «Restore all
   from today». Срока хранения нет.
5. **Show и Restore** — одна операция `restore` через LayoutOps renderer-а, шаг ⌘Z. Show из истории
   Ticket-а ставит Node рядом с Ticket-ом; Restore — на прежнее место или на ближайшее свободное (main,
   `freePlace`, ADR-0038). На read-only экране кнопки неактивны, список виден.
6. Доступность: badge и кнопки — `<button>` с `aria-label`; popover — `role="dialog"`, Esc закрывает.

## Готово, когда

- [ ] Unit `test/unit/archive-list.test.ts`: группы по Binding (к Ticket-у, к Epic-у, без Binding);
      порядок по `archived.at`; Session с Binding к Ticket-у видна и в истории его Epic-а.
- [ ] Unit `test/unit/archive-popover.test.tsx`: поиск, Restore, «Restore all from today», Esc; на
      read-only экране Restore неактивен.
- [ ] e2e `test/e2e/session-archive-history.spec.ts`: Session с Binding видна в истории своего Ticket-а,
      без Binding — в popover «Archive»; Show ставит Node рядом с Ticket-ом, ⌘Z убирает его обратно;
      Restore ставит Node на свободное место (без перекрытия); снимки `archive-popover` и
      `ticket-sessions` в обеих темах.
- [ ] Мутант красный: Restore мимо LayoutOps.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `archive-list.test.ts` на группы по Binding.
- Unit `test/unit/archive-list.test.ts` (новый), `test/unit/archive-popover.test.tsx` (новый); e2e
  `test/e2e/session-archive-history.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/archive-list.ts` (новый)
- `src/renderer/canvas/badges/SessionHistory.tsx` (новый)
- `src/renderer/canvas/actions/EpicSessionHistory.tsx` (новый)
- `src/renderer/canvas/overlays/ArchivePopover.tsx` (новый)
- `src/renderer/canvas/overlays/archive.css` (новый)
- `test/unit/archive-list.test.ts` (новый)
- `test/unit/archive-popover.test.tsx` (новый)
- `test/e2e/session-archive-history.spec.ts` (новый)

Только чтение: `src/renderer/canvas/badges/index.ts`, `src/renderer/canvas/overlays/TrashPopover.tsx`,
`src/renderer/binding/store.ts`.

## Вне скоупа

- Toast после партии — Ticket 10.
- Удаление из архива. Убрать навсегда — Remove на возвращённом Node-е (Trash, ADR-0016).

## Итог

Заполняется при закрытии.
