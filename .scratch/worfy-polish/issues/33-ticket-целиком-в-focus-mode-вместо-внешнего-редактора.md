# 33 — Ticket целиком в focus mode, а не во внешнем редакторе

Type: task
Status: claimed 2026-10-19T13:52Z
Branch: worfy-polish/33
Blocked by: —
Source: слово владельца 2026-10-19: Ticket открывается во внешнем редакторе, а должен открываться
внутри приложения как отрисованный markdown; в focus mode Ticket раскрывается на весь экран, но
показывает только заголовок и статус, тело пустое — это и есть место для всего Ticket-а. Решения
1–6 ниже — Orchestrator-а 2026-10-19, по карте scout-а на main `e61cb1fe`.

## Что происходит

- Единственный способ открыть Ticket — двойной клик по карточке:
  `src/renderer/canvas/nodes/TicketNode.tsx:134-143` (`onDoubleClick` на `:156`) зовёт
  `shell.openInEditor` с путём из `ticketFile(root, ticket)`. В окне на Linked machine вместо
  редактора — подсказка «File is on <Machine>» (`useFileElsewhere`, `:135-139`).
- `ticketFile()` (`src/renderer/canvas/epic-layout.ts:482`) жёстко пишет
  `<root>/.scratch/<epic>/issues`. В Silent mode Ticket-ы лежат в `ticketsRoot` Workflow folder
  (`src/main/workflow/folder.ts:60`, `:140`) — путь неверный.
- Focus mode (`src/renderer/focus/FocusMode.tsx:168-171`) рисует в плитке тот же компонент
  `TicketNode` (`tileProps`, `:87-103`): номер, заголовок, Stage, блокеры — и пустое место.
  `TicketNodeData` (`src/renderer/canvas/sources/epics.ts:68-77`) текста файла не несёт.
- Отрисовщик markdown один: `src/renderer/markdown/Markdown.tsx` (ссылки — `links.ts`: https —
  `shell.openExternal`, относительные — `shell.openInEditor` от `baseDir`). Им пользуются
  Transcript, HandoffNode, AdrSection.
- `docs.read` / `docs.open` (`src/main/docs/watch.ts`, `src/main/ipc/docs.ts`) пускают только
  HANDOFF.md и `docs/adr/NNNN-*.md` (предел 1 MB). Файлы Ticket-ов main уже читает сам
  (`src/main/workflow/reader.ts`, `enrichSnapshot`), и workflow watcher уже видит их изменения — но
  delta (`diffModels`, `src/shared/workflow/types.ts:134`) не несёт правку тела, если не изменились
  статус, «Где в коде» или ручные проверки.

## Решения (Orchestrator, 2026-10-19)

1. Двойной клик по карточке Ticket-а открывает focus mode на этом Ticket-е, а не редактор — тем же
   путём, что кнопка Focus (`FocusEntry.tsx`).
2. В focus mode (и только в плитке) Ticket показывает весь свой файл через `<Markdown>`, под
   прежней шапкой (номер, заголовок, Stage, блокеры). `baseDir` — папка Ticket-а: относительные
   ссылки открывают нужные файлы. Карточка на Canvas остаётся компактной, как сейчас: не читает
   текст и не рисуется заново (test `epic-node-memo`).
3. «Open in editor» остаётся: кнопка в шапке Ticket-а в focus mode. Контекстного меню у карточки
   нет, поэтому другого места для неё нет. На Linked machine, где файл на другой машине, — прежняя
   подсказка «File is on <Machine>».
4. Текст — новым каналом main: `tickets.read({ projectId, epic, num, slug })` → `{ path, text }`
   или ошибка. Путь main берёт из layout Project-а (`ticketsRoot` — Silent mode работает), файл
   ищет так же, как `enrichSnapshot` (по номеру и slug), и держит внутри корня Project-а,
   `ticketsRoot` и Workflow folder тем же guard-ом, что `shell.openInEditor`
   (`resolveProjectFile`); предел 1 MB, как у docs. Канал `project`, `read`: из окна на Linked
   machine он сам уходит на машину Project-а, как `workflow.open` и `docs.read`.
5. Живое обновление: когда файл Ticket-а меняется, плитка читает текст заново по delta workflow
   для этого Ticket-а. Нового watcher-а нет.
6. Путь для редактора — из ответа main, а не из `ticketFile()`; `ticketFile()` удаляется.

## Что делаем

1. `tickets.read`: канал в `src/shared/ipc/tickets.ts`, handler в `src/main/ipc/tickets.ts`.
2. Workflow model: у Ticket-а необязательное поле `version` — hash текста его файла
   (`enrichSnapshot`). Тогда правка тела — это delta для Ticket-а, и плитка читает текст заново.
   Поле необязательное: model от старого worfy на Linked machine остаётся валидной.
3. Focus mode: context «плитка focus mode» (`src/renderer/focus/focus-tile.ts`), его ставит
   `FocusMode.tsx`; `requestFocus(ids)` в `focus-state.ts`, его выполняет `FocusEntry.tsx`.
4. `TicketNode`: двойной клик на Canvas → `requestFocus`; в плитке — кнопка «Open in editor» в
   шапке и тело (`TicketBody.tsx`, текст — `useTicketText` из `ticket-text.ts`), полный заголовок
   без обрезки.

## Где в коде

- `src/shared/ipc/tickets.ts` (новый) — канал `tickets.read`.
- `src/main/ipc/tickets.ts` (новый) — handler и `readTicketFile`.
- `src/main/workflow/reader.ts` — `version` у Ticket-а, `issueKey` экспортируется.
- `src/shared/workflow/types.ts` — поле `version` в `ticketSchema`.
- `src/renderer/focus/focus-tile.ts` (новый), `src/renderer/focus/focus-state.ts`,
  `src/renderer/focus/FocusMode.tsx`, `src/renderer/focus/focus.css`.
- `src/renderer/canvas/overlays/FocusEntry.tsx` — выполняет `requestFocus`.
- `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/nodes/TicketBody.tsx` (новый),
  `src/renderer/canvas/nodes/ticket-text.ts` (новый: чтение текста, `useTicketText`),
  `src/renderer/canvas/epic-frame.css`.
- `src/renderer/canvas/epic-layout.ts` — `ticketFile()` удаляется; `test/unit/epic-layout.test.ts`.
- `test/unit/ticket-focus.test.tsx` (новый), `test/contract/tickets-read.test.ts` (новый),
  `test/contract/workflow-reader.test.ts`, `test/unit/link-access.test.ts` (`tickets.read` в списке
  `read`), `test/e2e/ticket-focus.spec.ts` (новый), `test/e2e/linked-system-actions.spec.ts`.

Только читать: `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/links.ts`,
`src/main/ipc/shell.ts`, `src/main/docs/watch.ts`.

## Готово, когда

- [ ] Двойной клик по карточке Ticket-а открывает focus mode на нём; плитка показывает весь файл
  как markdown под шапкой; e2e `test/e2e/ticket-focus.spec.ts`.
- [ ] Правка файла Ticket-а видна в плитке без повторного открытия (unit и e2e).
- [ ] Относительная ссылка в теле открывается от папки Ticket-а (unit).
- [ ] «Open in editor» в шапке плитки открывает файл по пути из main; на Linked machine — подсказка
  «File is on <Machine>» (`test/e2e/linked-system-actions.spec.ts`).
- [ ] `tickets.read`: путь вне Project-а отказан, Silent `ticketsRoot` читается, файл больше 1 MB
  отказан (contract `test/contract/tickets-read.test.ts`).
- [ ] Карточка на Canvas не читает текст и не рисуется заново от смены места (unit).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; затронутые e2e — exit 0.

## Итог

### Как сделано

- **`tickets.read`** (`src/shared/ipc/tickets.ts`, `src/main/ipc/tickets.ts`). Вход —
  `{ projectId, epic, num, slug }`; имя Epic-а проверяет schema (одна папка, не `.` и не `..`, без
  разделителей). main берёт layout Project-а (`projectLayouts()`), папку
  `<ticketsRoot>/<epic>/issues` и файл пропускает через `resolveProjectFile` из
  `src/main/ipc/shell.ts` (сам файл не менялся) с местами «корень Project-а, `ticketsRoot`, Workflow
  folder»; файл ищет среди записей папки по ключу `issueKey` ридера — slug никогда не становится
  частью пути. Предел — `DOC_SIZE_MAX` docs (1 MB). Layout с `failed` — отказ с причиной
  `layoutFailure`. Ответ — `{ path, text }`, `path` — настоящий абсолютный путь.
  Worktree-папки в места не входят: Ticket читается только из `ticketsRoot`, а ссылка из него в
  worktree — не случай этого Ticket-а.
- **Живое обновление.** Workflow watcher и раньше перечитывал Project при правке файла Ticket-а, но
  `diffModels` не видел правку тела. У Ticket-а теперь необязательное поле `version` — hash текста
  (`versionOf` docs), его ставит `enrichSnapshot`. Правка тела — delta для одного Ticket-а; плитка
  читает текст заново, когда `version` сменилась. Нового watcher-а нет. Цена: правка тела Ticket-а
  теперь рисует заново его карточку на Canvas (одну, не все).
- **Focus mode.** `requestFocus(ids)` в `focus-state.ts`; `FocusEntry.tsx` подписан и открывает
  focus mode пресетом Even над этими Node-ами, как кнопка Focus над выделением. Запрос, сделанный
  до того, как Canvas появился, не выполняется. `FocusMode.tsx` оборачивает Node каждой плитки в
  `FocusTileContext` (`focus-tile.ts`).
- **TicketNode.** На Canvas: двойной клик → `requestFocus([id])`, файл не читается, тела и кнопки
  нет (memo-test `epic-node-memo` зелёный). В плитке: заголовок без обрезки, «Open in editor» в
  конце строки с номером и Stage, под шапкой и слотами — тело `TicketBody.tsx` (`<Markdown>` с
  `baseDir` = папка файла). Ошибка чтения — строка с причиной; уже показанный текст остаётся.
  Двойной клик в плитке ничего не делает.
- **«Open in editor»** берёт путь из ответа `tickets.read`; пока файл не прочитан, кнопка
  неактивна. На Linked machine — прежняя подсказка «File is on <Machine>» на месте строки блокеров.
  Контекстного меню у карточки нет, другого входа в редактор с Canvas больше нет: путь — двойной
  клик → focus mode → кнопка.
- `ticketFile()` из `epic-layout.ts` удалён: путь с жёстким `.scratch` больше не нужен.
- **Linked machine.** `tickets.read` — канал `project`, `read`: из окна A на Project машины B он
  уходит на B, как `workflow.open` и `docs.read`; доступ «Read only» его пропускает
  (`test/unit/link-access.test.ts`). e2e `linked-system-actions.spec.ts` проверяет, что тело Ticket-а
  B читается в окне A.

### Test-ы

- `test/contract/tickets-read.test.ts` (новый, 18): Full mode по номеру и slug (`07-other` рядом не
  мешает), `007` = 7, Silent `ticketsRoot` в Workflow folder вне репозитория (копия в репозитории не
  читается), ссылка-файл наружу и ссылка-папка `issues` наружу — отказ, ссылка внутрь Project-а —
  читается, пять плохих имён Epic-а, slug с `../` — «does not exist», нет Ticket-а и нет Epic-а,
  1 MB + 1 байт — отказ, ровно 1 MB — читается, папка вместо файла, `failed` layout, чужой
  `projectId`, метки канала (`project`, `read`).
- `test/contract/workflow-reader.test.ts`: `version` в ключах Ticket-а; новый test — правка только
  тела меняет `version` этого Ticket-а и даёт delta ровно с ним.
- `test/unit/ticket-focus.test.tsx` (новый, 16): тело как markdown под шапкой, вызов `tickets.read`;
  относительные ссылки от папки файла; новое чтение на новую `version` и не на новое место; ошибка
  оставляет старый текст; первая ошибка — причина и неактивная кнопка; «Open in editor» по пути из
  main; Linked machine — подсказка без вызова редактора; двойной клик в плитке ничего не просит;
  карточка на Canvas не читает файл; двойной клик на Canvas — `requestFocus` с id Node-а;
  `FocusEntry` выполняет запрос и рисует Ticket с телом; `folderOf` для POSIX и Windows.
- `test/unit/link-access.test.ts`: `tickets.read` в списке `read`.
- `test/unit/epic-layout.test.ts`: проверки `ticketFile()` убраны вместе с функцией.
- e2e `test/e2e/ticket-focus.spec.ts` (новый): двойной клик → focus mode, тело, «Open in editor» и
  ссылка `../spec.md` открывают нужные файлы (recorder вместо `shell.openPath`), дописанный в файл
  «## Итог» появляется в открытой плитке, Esc возвращает компактную карточку.
- e2e `test/e2e/linked-system-actions.spec.ts`: двойной клик в окне A → тело Ticket-а B, «Open in
  editor» → «File is on <B>», ни одна машина редактор не открыла; B теперь запускается со своим
  временным HOME и `/bin/sh` (иначе под временным HOME прогона stand-in `epic-status` не находит
  node).

Мутанты (по одному, файл восстановлен из копии, `cmp`): без `ticketsRoot`/Workflow folder в местах
guard-а, без предела размера, поиск только по номеру, `failed` layout не отказан, без `version` в
model, карточка на Canvas читает файл, двойной клик в плитке снова просит focus mode, путь редактора
не из main, без подсказки Linked machine, ссылки не от папки Ticket-а, без перечитывания на новую
`version`, ошибка стирает старый текст, `FocusEntry` не выполняет запрос, плитка без context — все
14 красные.

### Что не проверено и ограничения

- **Silent mode: «Open in editor» и относительные ссылки тела.** `shell.openInEditor` пускает только
  корень Project-а и его worktree-ы (`resolveProjectFile` в `src/main/ipc/shell.ts`, по брифу не
  менялся), а файл Silent Ticket-а лежит в Workflow folder вне репозитория — открыть его в редакторе
  main откажет («outside the Project and its worktrees»), ошибка уходит в console. Тело Silent
  Ticket-а читается и показывается. Кандидат в следующий Ticket: Workflow folder в местах
  `shell.openInEditor`.
- **Ticket из невлитой ветки** (`fromBranch`): тело — файл checkout-а (или Workflow folder), не
  версия из worktree-ветки; статус в шапке — из ветки, как раньше.
- **Linked machine со старым worfy:** без канала `tickets.read` тело покажет ошибку чтения; шапка и
  подсказка редактора работают.
- Ручная проверка в Stable copy не делалась.
