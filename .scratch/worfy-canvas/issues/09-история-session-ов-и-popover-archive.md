# 09 — Archive: история Session-ов у Ticket-а и Epic-а, popover «Archive» рядом с Trash

Type: task
Status: done 2026-10-21T05:35Z
PR: #656
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

- [x] Unit `test/unit/archive-list.test.ts`: группы по Binding (к Ticket-у, к Epic-у, без Binding);
      порядок по `archived.at`; Session с Binding к Ticket-у видна и в истории его Epic-а.
- [x] Unit `test/unit/archive-popover.test.tsx`: поиск, Restore, «Restore all from today», Esc; на
      read-only экране Restore неактивен.
- [x] e2e `test/e2e/session-archive-history.spec.ts`: Session с Binding видна в истории своего Ticket-а,
      без Binding — в popover «Archive»; Show ставит Node рядом с Ticket-ом, ⌘Z убирает его обратно;
      Restore ставит Node на свободное место (без перекрытия); снимки `archive-popover` и
      `ticket-sessions` в обеих темах.
- [x] Мутант красный: Restore мимо LayoutOps.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Ветка `worfy-canvas/09`. Влит squash-ом d207756b (PR #656).

- `src/renderer/canvas/archive-list.ts` (новый): архивные Session Node-ы по Binding-у — к Ticket-у, к
  Epic-у, без Binding; новые сверху по `archived.at`; время архива в будущем ограничено текущим, чтобы
  такой Node не висел вверху списка. Overlay Archive строит список один раз на Canvas и публикует его по
  Project-у; badge Ticket-а читает только свою группу.
- Badge «N sessions» на Ticket-е с архивными Session-ами (`badges/SessionHistory.tsx`) и кнопка «N
  sessions» в шапке рамки Epic-а (`actions/EpicSessionHistory.tsx`): список с заголовком, временем конца и
  Show. В истории Epic-а — Session-ы с Binding к Epic-у и к его Ticket-ам.
- Popover «Archive N» слева от Trash (`overlays/ArchivePopover.tsx`, `archive.css`): Session-ы без
  Binding, поиск по заголовку, Restore у строки, «Restore all from today». Срока хранения нет.
- Show из истории сначала двигает Node туда, где встаёт новая Session с Binding-ом: справа от полосы
  рамок, на высоте Ticket-а; move и restore — один жест. Restore — одна операция `restore` через LayoutOps
  Canvas-а; main ставит Node на прежнее место или на ближайшее свободное (ADR-0038). Undo — общий
  `restoreInverse` из #654 (Ticket 14): архив с правилом, партией и временем и move на прежнее место.
- Restore и Show шлют `showOps` каждому Node-у (`show-ops.ts`, новый; `show-node.ts` его
  реэкспортирует): Session Node, скрытый до автоархива, возвращается видимым, а undo снова скрывает и
  архивирует его на прежнем месте.
- Session, чей Binding ещё не прочитан (ручные Binding-и, её signals, модель workflow), — pending: её нет
  ни в одном списке, «Restore all from today» её ждёт. Ошибка `bindings.get` хранится в store Binding-ов
  (`manualError`) и считается прочитанным ответом, поэтому недоступная машина не держит все архивные
  Session-ы в pending. Signals transcript-ов спрашиваются один раз на окно; неудачное чтение — снова при
  следующем изменении набора архивных.
- Popover истории и Archive закрывается, когда его список пуст; `role="dialog"`, Esc закрывает; на
  read-only экране списки видны, Show и Restore неактивны с причиной. `tsconfig.test.node.json` включает
  `archive-list.ts`.
- Test-ы: новые unit `archive-list.test.ts` (группы, порядок, Session Ticket-а в истории Epic-а, поиск,
  «today», место Show, Show и Restore через LayoutOps, undo restore, скрытые Node-ы против `LayoutStore`
  main, Session с Binding-ом только по ветке — pending до чтения модели workflow) и
  `archive-popover.test.tsx` (список, поиск, Restore, «Restore all from today», Esc, read-only, история
  Ticket-а и Epic-а с Show, закрытие при пустом списке); новый e2e `session-archive-history.spec.ts` (Show
  справа от полосы на высоте Ticket-а, ⌘Z возвращает в архив на старое место, Restore ставит Node мимо
  Note, занявшего его место; снимки `ticket-sessions` и `archive-popover` в обеих темах). Мутант «Restore
  мимо LayoutOps» (`restoreSessions` зовёт `layout.apply` напрямую) — 5 test-ов красные.
- Known limit, помечен `shortcut:` в `ArchivePopover.tsx:104`: transcript каждой архивной Session
  читается один раз на окно, чтобы узнать её Binding. Ограничение из описания PR про undo Restore из
  нескольких партий снято: после rebase на #654 undo идёт через общий `restoreInverse`.
- Круг ревью 1 (high): BLOCK на 3 medium — undo Restore терял прежнее место; transcript перечитывался при
  каждом изменении; Session-ы с Binding-ом показывались как без Binding, пока Binding не прочитан.
  Круг 2 (medium): BLOCK на 2 medium — скрытый Node оставался скрытым после Restore/Show; Session-ы
  зависали в pending при ошибке `bindings.get`. Круг 3 (medium): PASS.
- Gate full Mac (2026-10-21, bf8ec61c + PR): зелёный, 436 s.
- Долг (low из ревью) — Ticket [19](19-долг-после-review-wave-3.md).
