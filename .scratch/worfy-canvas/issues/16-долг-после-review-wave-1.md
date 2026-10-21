# 16 — Долг после review Wave 1: PR #536, #537, #538, #539

Type: task
Status: claimed 2026-10-21T09:15Z
Branch: worfy-canvas/16
Blocked by: 01
Source: ревью PR [#536](https://github.com/IDSAD-XL/worfy/pull/536) (Ticket 07, правило автоархива,
круги 1–3), [#537](https://github.com/IDSAD-XL/worfy/pull/537) (Ticket 04, токены kind и minimap, круг 2),
[#538](https://github.com/IDSAD-XL/worfy/pull/538) (Ticket 03, подсветка Family, круги 1–2),
[#539](https://github.com/IDSAD-XL/worfy/pull/539) (Ticket 01, рамки Epic-ов в K колонок, круги 1–3).
Все находки — low: мерж они не держали (правило глубины ревью владельца 2026-10-12). Строки #536–#538
перечитаны по main `2af91b51`; строки #539 — по голове PR (на 2026-10-20 не влит), отсюда `Blocked by: 01`.

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом: test, которого нет, или редкий
случай, который ведёт себя не так. Один пункт — одна строка «Готово, когда». Пункты, которые уже ушли
в другие Ticket-ы:

- архивные Node-ы в Find, истории, палитре и canvas MCP — [14](14-архивные-node-ы-видны-в-find-истории-и-mcp.md);
- живые агенты при первом открытии за день — [15](15-живые-агенты-при-первом-открытии-за-день.md);
- проводка таймера архива в `src/main/index.ts` без test-а — «Готово, когда» [08](08-настройка-автоархива-и-команда.md);
- чтение всех Layout при старте и `touchedAt` при drop — заметка в [10](10-toast-с-undo-после-автоархива.md);
- формула K при рамках очень разной ширины — заметка в [13](13-elk-rectpacking-для-рамок-epic-ов.md).

Уже исправлено в своих PR и сюда не входит: подписка затемнения через `DimMarker`
(`src/renderer/canvas/NodeChrome.tsx:62`), индексы Family один раз на объект связей
(`src/renderer/canvas/family.ts:67`), поля `FamilyLinks` только для чтения (`family.ts:24-36`),
комментарии `showWith` (`src/renderer/canvas/edge-types/StepEdge.tsx:11-14`,
`src/renderer/canvas/sources/workflow-bindings.ts:62-65`), лишние перезапуски эффекта `EdgeFocus` (`links`
строится через `useMemo` от строки, `src/renderer/canvas/overlays/EdgeFocus.tsx:29`), «Re-pack» под слоем
focus mode (#539, круг 2).

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.
Пункты #539 — после его мержа, по строкам main.

## Готово, когда

- [x] **#536, Session без transcript-а не архивируется никогда.** `src/main/layout/archive.ts:101`:
      Session, у которой нет transcript-а (`last === undefined`), пропускается. Claude Code удаляет
      transcript-ы старше 30 дней, поэтому старые Session Node-ы остаются на Canvas навсегда. Решить
      правило (например, брать время из Layout — `touchedAt` или время создания Node-а) и записать его
      в ADR-0076 строкой «Amendments» или в «Итог», если правило не меняется.
- [x] **#536, Tidy up сбрасывает часы архива.** `src/main/layout/store.ts:148-168` (`touchedBy`) ставит
      `touchedAt` на `move`/`moveMany` с экраном. «Tidy up» шлёт один `moveMany`
      (`src/renderer/canvas/tidy.ts:89`), и каждый Node, который он сдвинул, считается тронутым: архив
      молчит ещё 24 h после Tidy up. Решить: операции раскладки (Tidy up, Arrange) не ставят
      `touchedAt`, или так и задумано — тогда строка в «Итог».
- [x] **#536, старая сборка на Linked machine теряет новые поля.** `src/main/link/remote-calls.ts:118-123`:
      событие, чей payload не проходит schema канала, отбрасывается с предупреждением. Старая сборка на
      Linked machine не знает операций `archive`/`keep`/`touch` и после отката версии теряет поля
      `archived`, `keep`, `touchedAt`. Проверить, пишет ли старая сборка Layout обратно без этих полей;
      если да — test на сохранение неизвестных полей или строка в «Итог», почему это приемлемо.
- [x] **#536, граница порога.** `archive.ts:130`: `idle > threshold` — Session с простоем ровно в порог
      не архивируется. Test на `idle === threshold` закрепляет это.
- [x] **#536, Binding-и до свежего списка живых.** `archive.ts:236` зовёт `bindingsNeeded(...)` до
      `await this.readLive(project)` (`:241`) — по списку живых до перечитывания. Ошибка в безопасную
      сторону (лишнее чтение Binding-ов); комментарий в коде или перестановка.
- [x] **#537, цвет по умолчанию в minimap.** `src/renderer/canvas/overlays/minimap-paint.ts:8`
      (`NODE_COLOR_DEFAULT = 'var(--text-muted)'`): `test/unit/minimap-paint.test.tsx:41-44` сравнивает
      с самой константой, поэтому смена константы test не краснит. Сравнивать с литералом, как и заливку
      Ticket-а.
- [x] **Снято ticket-ом 17 (#644): затемнения больше нет.** **#538, выбранная Session и Note под курсором.** `src/renderer/canvas/edge-focus.ts:76-84`
      (`brightOf`): выбрана Session, курсор над Note — Note остаётся ярким, потому что набор ярких
      начинается с `new Set(focused)` (`:81`), а Node под курсором входит в `focused`
      (`src/renderer/canvas/overlays/EdgeFocus.tsx:53`). Test-а на этот случай нет — закрепить.
- [x] **Снято ticket-ом 17 (#644): затемнения больше нет.** **#538, затемнение закреплённого Node-а.** `NodeChrome.tsx:77`: ветка `PinnedFrame` рисует
      затемнение — test-а нет.
- [x] **Снято ticket-ом 17 (#644): затемнения больше нет.** **#538, Reduce motion.** `src/renderer/canvas/node-chrome.css:58-60`: `prefers-reduced-motion`
      выключает переход — test-а нет (e2e с `reducedMotion: 'reduce'` или unit на класс).
- [x] **#538, Show family и фильтр по тегу.** «Show family» (`src/renderer/canvas/overlays/SelectionToolbar.tsx:271-281`)
      подгоняет вид и под Node-ы, которые скрыл фильтр по тегу (`src/renderer/find/CanvasFind.tsx:177`).
      Решить: исключать их или так и задумано.
- [x] **#539, «+ FRAME_GAP» в формуле K.** `src/renderer/canvas/epic-arrangement.ts:81`: мутант A10
      (без промежутка) выживает — для 1, 4, 11 и 30 рамок по 900 px K тот же. Test с рамками, где
      промежуток меняет K.
- [x] **#539, резерв высоты при отказе ELK.** `src/renderer/canvas/elk/client.ts:110`: мутанты M-open
      и M-folded-open выживают — test `epic-arrangement-record.test.tsx:238` сравнивает только `folded`
      Epic-а без done Ticket-ов. Сравнить `open` Epic-а с done Ticket-ом с
      `layoutEpic({ doneExpanded: true })`.
- [x] **#539, устаревший отказ ELK.** `elk/client.ts:106`: мутант без проверки `seq` в обработчике ошибки
      выживает — устаревший отказ перезаписал бы свежий ответ. Test по образцу test-а на устаревший ответ
      в `test/unit/elk-client.test.tsx`, но с отказом.
- [ ] **#539, свёрнутая рамка со старым ответом.** `src/renderer/canvas/sources/epics.ts:615`: мутант
      S4-nullsafe выживает, потому что test (`:210`) удаляет ответ свёрнутой рамки. Не удалять
      `others.e01` в этом test-е.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Unit: `test/unit/minimap-paint.test.tsx`, test-ы `edge-focus`/`NodeChrome`, `test/unit/elk-client.test.tsx`,
  `test/unit/epic-arrangement.test.ts`, `test/unit/epic-arrangement-record.test.tsx`.
- Contract: `test/contract/layout-archive.test.ts` (граница порога, Session без transcript-а).

## Где в коде

- `src/main/layout/archive.ts`, `src/main/layout/store.ts`, `src/main/link/remote-calls.ts`
- `src/renderer/canvas/overlays/minimap-paint.ts`
- `src/renderer/canvas/edge-focus.ts`, `src/renderer/canvas/NodeChrome.tsx`, `src/renderer/canvas/node-chrome.css`,
  `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/canvas/epic-arrangement.ts`, `src/renderer/canvas/elk/client.ts`, `src/renderer/canvas/sources/epics.ts`
  (файлы #539)

## Вне скоупа

- Новое поведение архива, кроме решений по пунктам выше — Ticket-ы 08–10.

## Итог

Ветка `worfy-canvas/16`. Решения — в ADR-0076, раздел «Amendments» (владелец был в отъезде и
просил не ждать).

- **Session без transcript-а** — правило изменено. Простой Session-а, чей transcript не говорит
  времени (его нет или в нём нет записи со временем), считается от `touchedAt` её Node-а
  (`src/main/layout/archive.ts`, `idleSessions`). Если нет и `touchedAt`, прогон таймера ставит его
  сам — `touch` без экрана (`sessionsWithoutClock`, `AutoArchiver.run`), — и Node уходит в архив через
  порог. «Archive finished sessions now» и «Never» часы не ставят. Время создания Node-а Layout не
  хранит, поэтому оно не взято. Test-ы: `test/unit/archive-rule.test.ts` (`is idle since its
  touchedAt`, `the clock the timer starts`), `test/contract/layout-archive.test.ts` (describe
  `review debt of Wave 1`).
- **Tidy up и Arrange by Epic** — одно правило для обоих: команды раскладки не ставят `touchedAt`.
  Их `moveMany` несёт `arrange: true` (`src/shared/layout/types.ts`), `touchedBy` в
  `src/main/layout/store.ts` его не считает касанием. Перетаскивание руками — касание, как было.
  Test-ы: contract (`a layout command's moveMany …`), `test/unit/tidy.test.tsx`,
  `test/unit/arrange-by-epic-command.test.tsx`. Остаток — после #677 (`worfy-ui` 16 правит
  `src/renderer/canvas/history.ts`): ⌘Z такой команды шлёт обратный `moveMany` без пометки
  (`inverseOf`) и считается касанием.
- **Старая сборка на Linked machine** — test не нужен. Linked machine не пишет `layout.json` чужого
  Project-а: она шлёт операции через `layout.apply` (`src/shared/ipc/layout.ts:23`), а main Machine-а
  Project-а применяет их к своему полному Node-у, поля `archived`, `keep`, `touchedAt` остаются. Старая
  сборка только не видит изменений этих полей до перечитывания (событие `layout.changed` с
  неизвестной операцией отброшено). Старая сборка на Machine Project-а не знает `arrange`: zod
  отбрасывает поле, и раскладка считается касанием, как до этого Ticket-а. Потеря полей возможна
  только при откате самой Machine-а Project-а на сборку до #536: тогда архивные Node-ы вернутся на
  Canvas, transcript-ы не тронуты — для личного приложения это приемлемо.
- **Граница порога** — test `the threshold itself is not past it` в `test/unit/archive-rule.test.ts`.
- **Binding-и до свежего списка живых** — комментарий в `AutoArchiver.read` (`archive.ts`): перестановка
  поставила бы ожидание между чтением живых и записью.
- **Цвет minimap по умолчанию** — `test/unit/minimap-paint.test.tsx` сравнивает с литералом
  `'var(--text-muted)'`.
- **Show family и фильтр по тегу** — исключать. Камера берёт только тех членов Family, которых фильтр
  оставил на экране; если не осталось никого, камера не двигается
  (`src/renderer/canvas/overlays/SelectionToolbar.tsx`, `FamilySection`; Project приходит prop-ом
  секции). Test-ы — `test/unit/show-family.test.tsx`.
- **FRAME_GAP в формуле K** — test `W counts the gap between columns` в
  `test/unit/epic-arrangement.test.ts` (10 рамок 100×400: K 5, без промежутка было бы 8).
- **Резерв высоты при отказе ELK** — test в `test/unit/elk-client.test.tsx` (`when ELK fails`):
  `open` сравнивается с `layoutEpic({ doneExpanded: true })` прямо на `requestEpicLayout`, без
  `sources/epics.ts` (его делит 19-b).
- **Устаревший отказ ELK** — test `drops a failure of a request a newer one replaced` там же.
- **Свёрнутая рамка со старым ответом (S4-nullsafe)** — не сделано, после 19-b: test живёт в
  `test/unit/epic-arrangement-record.test.tsx` над `src/renderer/canvas/sources/epics.ts`, который ветка
  `worfy-canvas/19-b` делит на части; правка сейчас дала бы конфликт.
- **Проверки.** `pnpm lint` и `pnpm typecheck` — exit 0. Test-ы затронутых файлов — exit 0. Mutation
  testing: 9 мутантов (fallback на `touchedAt`, `touch` для часов, `arrange` в `touchedBy`, `seq` в
  отказе ELK, `open` при отказе, `+ FRAME_GAP`, граница `>`, фильтр в Show family, цвет minimap) —
  все убиты. Полный `pnpm test` и gate — за Orchestrator-ом.
