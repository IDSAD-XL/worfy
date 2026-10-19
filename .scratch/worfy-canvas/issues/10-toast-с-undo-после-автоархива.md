# 10 — Toast «Archived N finished sessions · Undo» после партии; автоархив включён по умолчанию (24 h)

Type: task
Status: blocked 2026-10-19T15:22Z
Blocked reason: ждёт мержа worfy-ui 16 (внутренние toast-ы: одно хранилище и один компонент)
Waits: agent
Blocked by: 07, 08, 09, 14
Source: [spec.md](../spec.md), решение владельца 6;
[ADR-0076](../../../docs/adr/0076-auto-archive-of-finished-sessions.md) (автоархив законченных Session-ов),
пункты 7, 8 и 10; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P2, «Undo»;
[worfy-ui 16](../../worfy-ui/issues/16-внутренние-toast-ы.md). Код перечитан по main `7dab925f`.

## Что происходит

- Компонента toast-а в renderer нет; его заводит `worfy-ui` 16 (`src/renderer/toast/toasts.ts`,
  `showToast`, вид `action` с кнопками, `projectId`).
- Таймер архива (Ticket 07) пишет партии мимо ⌘Z; порог по умолчанию — «Never» (Ticket 08), чтобы
  Session-ы не пропадали молча (ADR-0076, пункт 10).
- Main сообщает окнам об изменении Layout событием `layout.changed` (`src/shared/ipc/layout.ts:33`).

## Что делаем

1. **Событие партии.** Main после каждой партии таймера шлёт окнам Project-а событие
   `layout.archived` (`src/shared/ipc/layout.ts`; `project`, `read`): `batch`, число Session-ов.
2. **Undo партии.** Операция `restoreBatch` (`batch`) в main (`src/main/layout/archive.ts`): возвращает
   ровно Node-ы этой партии, которые ещё в архиве; мимо ⌘Z. Node, который пользователь уже вернул или
   двигал, не трогается.
3. **Toast** — `src/renderer/canvas/overlays/ArchiveToast.tsx` (новый): на событие — `showToast` вида
   `action` с `key` = `batch` и `projectId`: «Archived N finished sessions» и кнопка Undo. На read-only
   экране (ADR-0066) — вид `info` без кнопки.
4. **Порог по умолчанию — 24 h** (`src/shared/settings/app-settings.ts`, `sessionArchive.after`). Человек,
   который уже выбрал значение в Settings, его сохраняет.

## Готово, когда

- [ ] Contract `test/contract/layout-archive.test.ts`: `restoreBatch` возвращает ровно свою партию;
      Node, тронутый после партии, не меняется; событие `layout.archived` приходит обоим окнам Project-а.
- [ ] Unit `test/unit/archive-toast.test.tsx`: событие даёт один toast с Undo; на read-only экране — без
      Undo; Undo зовёт `restoreBatch` своей партии.
- [ ] e2e `test/e2e/session-archive-toast.spec.ts`: таймер (ускоренный в test-е) с порогом по умолчанию
      убирает finished Session-ы фикстуры, toast показывает их число, Undo возвращает их на места; ⌘Z после
      Undo не убирает их снова; снимок toast-а в обеих темах.
- [ ] Мутант красный: Undo возвращает все архивные Session-ы, а не партию.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «`restoreBatch` возвращает только свою партию».
- Contract `test/contract/layout-archive.test.ts`; unit `test/unit/archive-toast.test.tsx` (новый); e2e
  `test/e2e/session-archive-toast.spec.ts` (новый).

## Где в коде

- `src/main/layout/archive.ts`
- `src/shared/ipc/layout.ts` (`layout.changed` `:33`)
- `src/shared/settings/app-settings.ts`
- `src/renderer/canvas/overlays/ArchiveToast.tsx` (новый)
- `test/unit/archive-toast.test.tsx` (новый)
- `test/contract/layout-archive.test.ts`
- `test/e2e/session-archive-toast.spec.ts` (новый)

Только чтение: `src/renderer/toast/toasts.ts` (`worfy-ui` 16).

## Заметки ревью PR #536 (2026-10-20)

- **Старт читает каждый Layout — `test/e2e/no-overlap.spec.ts:182` снова упадёт.** Таймер архива
  (`src/main/layout/archive.ts`) при старте и раз в 10 минут проходит все Project-ы. Пока порог
  «Never», `run()` идёт веткой `store.peek` (`:226-231`) и Layout не читает. Когда этот Ticket ставит
  24 h по умолчанию, ветка с `store.get` (`:236`, `:243`) читает Layout каждого Project-а ещё до
  открытия окон. Исправление наложений при первом чтении Layout тогда проходит до того, как test
  подключил слушателя console, и `no-overlap.spec.ts:182` (ждёт строку `moved Node B` при ленивом
  первом чтении Project-а BETA по клику) краснеет. Сделать одно из двух: архив Project-а — только
  при первом чтении его Layout (`store.peek` для непрочитанных), либо test не зависит от ленивого
  первого чтения.
- **Drop сбрасывает часы архива.** `touchedAt` ставится на каждой операции пользователя над Node-ом
  (ADR-0076, пункт 2; `src/main/layout/store.ts:148-168`). Session, привязанная к done Ticket-у,
  которую пользователь перетащил, уходит в архив через 24 h, а не через 1 h. Так задумано; в тексте
  toast-а и в «Итог» не обещать «через час после done».
- **До этого Ticket-а — [14](14-архивные-node-ы-видны-в-find-истории-и-mcp.md):** архивные Node-ы не
  должны всплывать в Find, истории Session, разделе Sessions, палитре и canvas MCP, когда архив
  включён по умолчанию.

## Вне скоупа

- Предупреждение до архива (как Destalinator) — Undo после действия вместо подтверждения (ADR-0076).

## Итог

Заполняется при закрытии.
