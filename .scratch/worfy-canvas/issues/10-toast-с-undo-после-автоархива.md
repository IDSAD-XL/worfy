# 10 — Toast «Archived N finished sessions · Undo» после партии; автоархив включён по умолчанию (24 h)

Type: task
Status: claimed 2026-10-21T11:04Z
Branch: worfy-canvas/10
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
3. **Toast** — `src/renderer/canvas/archive-toast.ts` (новый; сначала был overlay `ArchiveToast.tsx`, ревью #686): на событие — `showToast` вида
   `action` с `key` = `batch` и `projectId`: «Archived N finished sessions» и кнопка Undo. На read-only
   экране (ADR-0066) — вид `info` без кнопки.
4. **Порог по умолчанию — 24 h** (`src/shared/settings/app-settings.ts`, `sessionArchive.after`). Человек,
   который уже выбрал значение в Settings, его сохраняет.

## Готово, когда

- [x] Contract `test/contract/layout-archive.test.ts`: `restoreBatch` возвращает ровно свою партию;
      Node, тронутый после партии, не меняется; событие `layout.archived` приходит обоим окнам Project-а.
- [x] Unit `test/unit/archive-toast.test.tsx`: событие даёт один toast с Undo; на read-only экране — без
      Undo; Undo зовёт `restoreBatch` своей партии.
- [x] e2e `test/e2e/session-archive-toast.spec.ts`: таймер (ускоренный в test-е) с порогом по умолчанию
      убирает finished Session-ы фикстуры, toast показывает их число, Undo возвращает их на места; ⌘Z после
      Undo не убирает их снова; снимок toast-а в обеих темах.
- [x] Мутант красный: Undo возвращает все архивные Session-ы, а не партию.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «`restoreBatch` возвращает только свою партию».
- Contract `test/contract/layout-archive.test.ts`; unit `test/unit/archive-toast.test.tsx` (новый); e2e
  `test/e2e/session-archive-toast.spec.ts` (новый).

## Где в коде

- `src/main/layout/archive.ts` (`restoreBatch`, `onArchiveBatch`, прогон при первом чтении Layout)
- `src/main/layout/store.ts` (`onFirstRead`)
- `src/main/ipc/layout.ts` (`layout.restoreBatch`, рассылка `layout.archived`)
- `src/main/index.ts` (комментарий о старте архива)
- `src/shared/ipc/layout.ts` (`layout.restoreBatch`, `layout.archived`; `layout.changed` `:33`)
- `src/shared/layout/derived.ts` (`stillInBatch`: общий для Undo партии в main и undo архива экрана)
- `src/renderer/canvas/history.ts` (undo архива экрана через `stillInBatch`)
- `src/shared/settings/app-settings.ts`
- `src/renderer/canvas/archive-toast.ts` (новый)
- `src/renderer/main.tsx` (подписка `installArchiveToasts()` до первого render)
- `docs/adr/0076-auto-archive-of-finished-sessions.md` (Amendment 2026-10-21)
- `test/unit/archive-toast.test.tsx` (новый)
- `test/contract/layout-archive.test.ts`
- `test/e2e/session-archive-toast.spec.ts` (новый)
- `test/e2e/session-archive.spec.ts`, `test/unit/link-access.test.ts`, test-ы значения по умолчанию
  (`settings-canvas`, `archive-rule`, `main-archive-wiring`, `app-settings`)

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

Ветка `worfy-canvas/10`, PR #686. Круг 1 ревью (глубина high) — исправлен во втором коммите.

- **Событие партии.** `layout.archived` (`src/shared/ipc/layout.ts`; `project`, `read`): `projectId`,
  `batch`, `count`. Main шлёт его всем окнам после каждой партии таймера (`onArchiveBatch` в
  `src/main/layout/archive.ts`, рассылка в `src/main/ipc/layout.ts`). «Archive finished sessions now» и
  его redo события не шлют: это шаг ⌘Z экрана.
- **Undo партии.** `layout.restoreBatch` (`project`, `write`) → `restoreBatch` в `archive.ts`: один
  `restore` без экрана для Node-ов, которые ещё в архиве в этой партии (`stillInBatch`,
  `src/shared/layout/derived.ts`; тот же helper — у undo архива экрана в `src/renderer/canvas/history.ts`).
  Node, который пользователь уже вернул (и, может быть, двигал), или Node из другой партии не меняется.
  Пустая партия ничего не меняет. Restore ставит `touchedAt`, поэтому следующий прогон таймера их не
  берёт. Read-only Linked machine вызвать канал не может: он `write`.
- **Toast** — `src/renderer/canvas/archive-toast.ts`. Окно подписывается в `main.tsx` до первого render,
  поэтому партия не теряется, пока Canvas грузится или показан другой Project. Один toast на Project
  (ключ `archive:<projectId>`, с `projectId`): «Archived N finished sessions» (для одной — «session») и
  Undo; следующая партия заменяет его, и toast-ы, которые ждут закрытия, не забивают стопку. Ранние
  партии — в popover «Archive» и истории Ticket-ов. Read-only (`readOnlyNow()`, ADR-0066) проверяется на
  каждой партии: на read-only экране toast вида `info` без Undo. Отказ main на Undo — `error` toast.
  Toast закрывается сам, когда в архиве не осталось ни одного Node-а его партии (Undo в другом окне,
  Restore, resume) — по `layout.changed`.
- **Порог по умолчанию — 24 h** (`SESSION_ARCHIVE_DEFAULTS`); выбравший «Never» его сохраняет.
- **Старт.** Таймер не читает `layout.json` Project-а, который никто не открывал. Project архивируется
  в момент, когда main впервые читает его Layout (`LayoutStore.onFirstRead`, подписка в
  `AutoArchiver.start`), и дальше раз в 10 минут. Так Project, открытый при старте, архивируется при
  старте, а `no-overlap.spec.ts:182` зелёный без правки. Записано в Amendments ADR-0076 (2026-10-21).
- Текст toast-а не обещает «через час после done»: drop сбрасывает часы архива (заметка ревью #536).
- Test-ы: contract `test/contract/layout-archive.test.ts` (ровно своя партия; пустая партия; событие
  обоим окнам и его отсутствие для архива экрана; ⌘Z после Undo; метки каналов; архив при первом
  чтении без тика; остановленный архив не реагирует на чтение; непрочитанный Layout не читается); unit
  `test/unit/archive-toast.test.tsx` (10); e2e `test/e2e/session-archive-toast.spec.ts`.
  `test/e2e/session-archive.spec.ts` пишет выбор «Never» в `app-settings.json`.
- Мутанты красные: Undo возвращает все архивные Session-ы, а не партию; read-only читается один раз
  при подписке; ключ toast-а по партии (стопка); toast не закрывается после ухода партии из архива;
  нет прогона при первом чтении Layout.
- e2e под замком: `session-archive-toast`, `session-archive`, `session-archive-history`, `no-overlap`,
  `toast-placement`, `linked-read-only` — 9 passed.
- Снимки toast-а: [светлая тема](../evidence/10-archive-toast-light.png),
  [тёмная тема](../evidence/10-archive-toast-dark.png).
