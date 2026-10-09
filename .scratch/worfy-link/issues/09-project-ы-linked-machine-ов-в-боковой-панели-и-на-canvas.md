# 09 — Project-ы Linked machine-ов в боковой панели и на Canvas

Type: task
Status: claimed — 2026-10-08
Blocked by: 08
Source: решения владельца 2026-10-07: Q2 (обе машины работают одновременно, общее состояние живое, у каждого экрана своё), Q3 (с другой машины можно всё, кроме действий, которым нужен рабочий стол машины Project-а; выбор машины), Q9 (у Project ровно одна Machine; один репозиторий на двух Machine — два Project-а), Q10 (список слева — Project-ы всех Linked machine-ов по машинам с состоянием); [spec.md](../spec.md); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) — Machine, Linked machine, связь по коду, доступ выключен по умолчанию; [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — несколько экранов на одном Project-е

## Что происходит

- Renderer ходит в main через одну точку: `windowBridge()` берёт `globalThis.worfy` из preload
  (`src/renderer/ipc.ts:41-45`). Остальной код зовёт `invoke` и `subscribe` из
  `createIpcClient` (`ipc.ts:24-39`, экспорт `:47`); их импортируют 43 модуля renderer. Мост ищется
  при каждом `invoke`, но `subscribe` берёт его один раз, в момент подписки (`ipc.ts:34`).
- Project в renderer опознаётся только `projectId`. Id — `<имя папки>-<sha256(путь)[0:8]>`
  (`src/shared/ipc/projects.ts:9-10`). Значит, одна папка, добавленная в два worfy на одном Mac
  (dev-сборка и Stable copy) или на двух Mac с одинаковым путём, даёт два Project-а с одним id.
- Состояние Project-ов в renderer лежит в модульных store по `projectId` или пути и переживает смену
  Project-а: Layout с проверкой ревизии (`src/renderer/canvas/useLayout.ts:20-24`), документы
  (`src/renderer/docs/useDocs.ts:19-24`), Session-ы из `~/.claude` по корню Project-а
  (`src/renderer/claude-home/useClaudeHome.ts:73-88`) и другие. Подписки на события делаются один раз
  на модуль: `layout.changed` (`useLayout.ts:32`), `claudeHome.changed` (`useClaudeHome.ts:188`),
  `agent.event` (`src/renderer/session/store.ts:149`) и ещё 20 вызовов `subscribe` в renderer.
  Если в одном renderer перемешать два Project-а с одним id, Layout с меньшей ревизией будет молча
  отброшен (`useLayout.ts:22`).
- Активный Project — один на машину. Он хранится в main (`src/main/projects/store.ts:79`, выбор —
  `:240`), рассылается всем окнам (`src/main/ipc/projects.ts:25-34`), и 18 мест renderer берут Project
  экрана через `activeProject(useProjects())` (`src/renderer/projects/useProjects.ts:56-58`;
  `src/renderer/main.tsx:14`, `:25-26`).
- Для активного Project-а main сам открывает Orchestrator (`src/main/agent/app-orchestrators.ts:50`,
  смена активного — `:71-72`) и держит открытыми его документы для Node-а HANDOFF
  (`src/main/ipc/docs.ts:79-101`). Для другого Project-а этой машины ни того, ни другого нет.
- Список слева — только Project-ы своей машины (`src/renderer/shell/sidebar/ProjectsSection.tsx:164`);
  выбор зовёт `projects.select` (`:132-137`), toolbar показывает имя и ветку (`main.tsx:15`).
- После Ticket-ов 01–08: Machine-ы связаны по коду (01, 02), список Linked machine-ов с состоянием
  «в сети / недоступна» есть (02), main шлёт события любому клиенту из реестра (03), Session и
  Terminal переживают закрытие окна и показываются на нескольких экранах (04, 05), камера Canvas и ⌘Z
  у каждого экрана свои (06, 07).
- Ticket 08 пометил каждый канал в его объявлении: `link` — служебный канал связи; `project` —
  работа с Project-ами, Linked machine-у доступна при включённом «Linked machines can work with my
  Projects»; `desktop` — нужен рабочий стол машины Project-а, Linked machine-у нельзя; `local` —
  состояние машины экрана, Linked machine-у нельзя. Со стороны машины экрана к Project-ам Linked
  machine-а пока не подойти: нет ни списка, ни маршрута вызовов.

## Что делаем

1. **Окно показывает Project-ы одной Machine** (Q2, Q9). У окна есть своя Machine — по умолчанию
   своя машина. Выбор слева Project-а Linked machine-а M переводит окно на M и перезагружает его
   renderer с этим Project-ом. Выбор своего Project-а в окне на M возвращает окно на свою машину
   (тоже перезагрузка) и зовёт `projects.select`, как сейчас. Переход между Project-ами одной
   Machine — без перезагрузки, как сейчас. «Открыть Project <Machine, projectId>» — одна функция
   renderer: её зовут боковая панель, «Add Project» Ticket-а 11 и клик по уведомлению Ticket-а 13.

   Почему перезагрузка, а не ключ «Machine + projectId» в каждом store: модульных store и подписок
   по `projectId` и пути — десятки (раздел выше), и любой пропущенный смешает два Project-а с одним
   id. Перезагрузка даёт чистое состояние renderer на каждую Machine без правки этих модулей. Цена:
   история ⌘Z прошлой Machine теряется при переходе (она и так живёт только в памяти окна,
   ADR-0016 — корзина как папка, undo в renderer). Как окно узнаёт свою Machine при загрузке
   (параметр адреса окна или канал своей машины) — выбирает Ticket; проверка «вызов из кадра
   worfy» (`isAppUrl`, `src/main/index.ts:79`) не должна ослабнуть.
2. **Маршрут вызовов — в `windowBridge()`** (`src/renderer/ipc.ts:41`). В окне на своей машине мост
   прежний. В окне на M маршрут канала выводится из его пометки Ticket-а 08 (она стоит в объявлении
   канала, в доменном файле `src/shared/ipc/<домен>.ts`); второго списка нет:
   - `project` и `desktop` — на Machine окна. Вызов уходит в свой main одним каналом (например,
     `linked.invoke {machine, channel, input}`), main передаёт его в соединение с M. События M приходят
     в окно своим каналом (например, `linked.event {machine, channel, payload}`), и мост отдаёт их
     подписчикам канала. Каналы `desktop` M отклоняет (Ticket 08), окно показывает отказ;
   - `local` и `link` — на свою машину: `app.version`, `limits.*` (Limits — подписка Claude на машине
     экрана), `view.*` (меню View — меню машины экрана; общее или своё — вопрос Ticket-а 12),
     `notify.*` (уведомления — Ticket 13), камера Canvas Ticket-а 06 и каналы связи.

   Ticket-ы 10–12 меняют маршрут своего канала, меняя его пометку в доменном файле (например,
   `shell.openExternal` — с `desktop` на `local`), поэтому общего файла у них нет. Пометку канала
   renderer берёт из объявлений каналов (как test Ticket-а 08, через `import.meta.glob`) или из
   таблицы, собранной из них при сборке; ручного списка нет. Каналы renderer → свой main этого
   Ticket-а (вызов на M, события M) — новый домен `linked` в своих файлах, не в файлах связи
   Ticket-ов 01–02; пометка — `local`: Linked machine их не зовёт.
   Токен, сертификат и адрес Linked machine-а в renderer не попадают: renderer знает только id
   Machine и её имя.
3. **Явный вызов на Machine.** Для того, что не привязано к Machine окна (списки Project-ов Linked
   machine-ов в боковой панели, «Add Project» Ticket-а 11), `src/renderer/ipc.ts` даёт
   `invokeOn(machine, channel, input)` и `subscribeOn(machine, channel, handler)`. В main — такая же
   функция вызова канала на Linked machine-е для других модулей main (её берёт Ticket 10 для файлов
   Card).
4. **Боковая панель** (Q10, Q3). Пока Linked machine-ов нет, список прежний, без групп. Когда есть
   хоть одна — Project-ы сгруппированы по Machine: своя первой, Linked machine-ы по имени. У группы —
   имя Machine и состояние из списка Ticket-а 02: «в сети», «недоступна» («спит» добавит Ticket 14).
   Machine с выключенным доступом показывается без Project-ов, с подписью «<Machine> doesn't share
   its Projects»: при выключенном доступе Project-ов этой Machine не видно (spec.md, «Доступ»; ADR-0052
   оставил этот вопрос Ticket-ам). Выключенный доступ окно узнаёт по отказу Ticket-а 08 «access is
   off» или по состоянию связи, если Ticket 02 его отдаёт. Список и его изменения у каждой Linked machine-ы — `projects.list` и
   `projects.changed` через `invokeOn` и `subscribeOn`. Меню строки Project-а Linked machine-а («Project settings…», «Remove from list»)
   работает так же, вызовы идут на её Machine.
5. **Чей Project активен.** Выбор Project-а M в окне другой машины не меняет активный Project M
   (`store.ts:240`) — экраны самой M остаются на своём. В окне на M `activeProject()`
   (`useProjects.ts:56`) отдаёт Project, выбранный в этом окне, а список — Project-ы M. Сама M при этом
   делает для Project-а, открытого с Linked machine-а, то же, что для своего активного: открывает его
   Orchestrator (`app-orchestrators.ts:50`) и держит его документы (`docs.ts:82`), пока хоть один
   такой экран открыт. Для этого — новый канал «экран открыл Project» с пометкой `project` (имя
   выбирает Ticket); экран, исчезнувший из реестра клиентов Ticket-а 03, Project отпускает.
6. **Toolbar.** У Project-а Linked machine-а рядом с именем Project-а — имя Machine (`main.tsx:15`):
   видно, где идёт работа.
7. **Связь пропала или доступ закрыли.** Окно на M показывает над Canvas строку «<Machine> is
   unreachable» или «<Machine> stopped sharing its Projects»; вызовы отвечают `{ok:false}` с этой
   причиной, ничего не падает. M снова в сети и доступ открыт — окно перезагружается и берёт свежее
   состояние.
8. **Каналы с пометкой `desktop`** (действия, которым нужен рабочий стол машины Project-а) в окне на M
   отвечают понятным отказом. Их заменяют Ticket-ы 10 (подтверждение Card), 11 (выбор папки) и 12
   (вложение «+», ссылки, «открыть в редакторе»).

Решено в этом Ticket-е, подтвердить у владельца при ревью: окно показывает одну Machine и
перезагружается при переходе на другую (пункт 1).

**Не входит:** Card Linked machine-а (Ticket 10), «Add Project» на Linked machine (Ticket 11),
системные действия — вложение «+», ссылки, «открыть в редакторе», меню View (Ticket 12), уведомления
(Ticket 13), статус «спит» (Ticket 14), запрет второго Autopilot-а (Ticket 15).

## Готово, когда

- [ ] contract `test/contract/ipc-renderer.test.tsx`: в окне на Linked machine-е M `invoke('layout.get', …)` уходит в свой main одним каналом с M; `invoke('app.version')` и `subscribe('view.changed', …)` идут в preload своей машины; в окне на своей машине все вызовы идут в preload, как сейчас; `invokeOn(M, 'projects.list')` уходит на M из окна любой машины.
- [ ] contract: событие M доходит до подписчика канала в окне на M и не доходит до окна на своей машине; событие своей машины с пометкой `project` не доходит до окна на M.
- [ ] contract: маршрут выводится из пометки — для каждого канала из `src/shared/ipc/*.ts` маршрут в окне на M равен «на M» для `project` и `desktop` и «своя машина» для `local` и `link`; канал, объявленный в test-е с пометкой `local`, идёт на свою машину, с той же схемой и пометкой `project` — на M.
- [ ] contract: ни один канал, который слушает renderer, не отдаёт токен, сертификат или адрес Linked machine-а (проверка по схемам каналов `link.*` и `linked.*`).
- [ ] unit `test/unit/use-projects.test.tsx`: при одной Linked machine-е список сгруппирован по Machine, своя первой; без Linked machine-ов групп нет; Machine с выключенным доступом — без Project-ов и с подписью; выбор Project-а M не зовёт `projects.select`, а переводит окно на M.
- [ ] e2e `test/e2e/linked-machines.spec.ts` (локально, в gate full): два worfy A и B с разными `WORFY_DATA_DIR`, связаны (helper Ticket-а 02), у B доступ включён. Слева в A — группа B с её Project-ами и «в сети». У B доступ выключен — группа без Project-ов, с подписью. B закрыт — «недоступна».
- [ ] e2e: A открывает Project B. Canvas показывает Layout B; Node, сдвинутый в A, через 1 s на том же месте в окне B. Session с fake-агентом, начатая в A, видна живой в окне B. Ввод в Terminal в A — его вывод в окне B. Autopilot (fake-сценарий `orchestrator`) запущен и остановлен из A, состояние видно в обоих окнах.
- [ ] e2e: одна папка-fixture добавлена в A и в B. Слева — два разных Project-а. Node, сдвинутый в Project-е B из окна A, не сдвинулся в Project-е A. Активный Project в `projects.json` B не изменился. Orchestrator этого Project-а в B открыт.
- [ ] e2e: B закрыли, пока его Project открыт в A, — в A строка «unreachable», окно не упало; B запущен снова — окно A снова показывает Layout B.
- [ ] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

## Тесты

Сначала падающий test — `test/contract/ipc-renderer.test.tsx`: в окне на Linked machine-е вызов
`layout.get` уходит в свой main с id Machine. На main сейчас `windowBridge()` отдаёт только preload
своей машины — test красный. В «Итог» — как он падал.

- `test/contract/ipc-renderer.test.tsx` — маршрут вызовов и событий, маршрут из пометки.
- `test/unit/use-projects.test.tsx` — группы, подписи, выбор Project-а Linked machine-а.
- `test/e2e/linked-machines.spec.ts` — пишет Ticket 02; этот Ticket добавляет test-ы двух worfy
  выше. Helper двух связанных worfy — из Ticket-а 02, новых параметров не нужно; если нужны —
  `test/e2e/helpers.ts` добавляется в список ниже.

## Где в коде

- `src/renderer/ipc.ts`
- `src/renderer/projects/useProjects.ts`
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `src/renderer/main.tsx`
- `src/main/window.ts`
- `src/main/link/remote-calls.ts` (новый)
- `src/main/ipc/linked.ts` (новый)
- `src/shared/ipc/linked.ts` (новый)
- `src/shared/ipc/projects.ts`
- `src/main/ipc/projects.ts`
- `src/main/agent/app-orchestrators.ts`
- `src/main/ipc/docs.ts`
- `test/contract/ipc-renderer.test.tsx`
- `test/unit/use-projects.test.tsx`
- `test/e2e/linked-machines.spec.ts`
- добавлены при работе (см. «Итог»): `src/main/projects/holds.ts`, `src/main/link/service.ts`,
  `src/renderer/shell/ProjectSettings.tsx`, `test/contract/main-ipc-wiring.test.ts`,
  `test/contract/remote-calls.test.ts`, `test/contract/linked-ipc.test.ts`, `test/contract/projects-hold.test.ts`,
  `test/unit/project-holds.test.ts`
- добавлены в доработке круга 1: `src/shared/ipc/channels.ts`, `src/renderer/palette/commands.ts`,
  `src/shared/ipc/viewport.ts`, `src/main/ipc/viewport.ts`, `src/main/layout/viewports.ts`,
  `src/renderer/canvas/Canvas.tsx`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/shell/FirstRun.tsx` (тип `viewport.get`),
  `test/contract/viewport-store.test.ts`, `test/unit/canvas.test.tsx`

Модуль связи заводит Ticket 01: `src/main/link/remote-calls.ts` берёт у него соединение с Linked
machine-ом и ничего в его файлах не правит. Каналы этого Ticket-а — в своём домене `linked`, а не в
`src/shared/ipc/link.ts` Ticket-ов 01 и 02: так нет общего файла с Ticket-ом 14, который может идти в
той же Wave. Если без правки файлов связи не обойтись, они добавляются в список по «Итог» Ticket-а 01.
Пометки каналов этот Ticket не меняет — только читает (Ticket 08). Если по «Итог» Ticket-а 08 пометка
лежит не в объявлении канала, файл с ней добавляется в список. Ticket 15 может идти в той же Wave
(оба ждут 08): общих файлов с ним нет.

## Итог

Сделано в ветке `worfy-link/09`.

- **Первый test падал так.** Новые test-ы `test/contract/ipc-renderer.test.tsx` поверх `src/renderer/ipc.ts` из
  `origin/main` (27f12f6): `7 failed | 9 passed`. Главный — «sends layout.get of a window on M to its own main»:
  `expected [ [ 'layout.get', …(1) ] ] to deeply equal [ [ 'linked.invoke', { …(3) } ] ]` — вызов уходил в preload
  своей машины как `layout.get`; остальные — `renderer.invokeOn is not a function`, `routeOf is not a function`.
- **Как окно узнаёт свою Machine** — параметр адреса окна: `?machine=<id Linked machine-а>&project=<projectId>`
  (`windowMachine()`, `src/renderer/ipc.ts`). Проверка «вызов из кадра worfy» не менялась: `appUrlMatcher`
  (`src/main/ipc/index.ts`) и раньше не смотрел на query, а для dev-сервера сравнивает origin. Переход на другую
  Machine — `location.assign` (перезагрузка); Project той же Linked machine-ы — `history.replaceState` без
  перезагрузки; View ▸ Reload оставляет окно на той же Machine.
- **Маршрут.** `src/renderer/ipc.ts` загружает все `src/shared/ipc/*.ts` (`import.meta.glob`, eager) и берёт
  пометку канала из `accessOf` (`src/shared/ipc/channels.ts`); второго списка нет. В окне на M: `project` и
  `desktop` → `linked.invoke {machine, channel, input}` в свой main, события — один `linked.event` на preload,
  разбор по Machine и каналу; `local`, `link` и неизвестное имя — в preload своей машины. `invokeOn(machine | null, …)`
  и `subscribeOn(…)` — явный вызов на Machine (null — своя) из окна любой машины.
- **Каналы (новый домен `linked`, `src/shared/ipc/linked.ts`, все `local` — самая закрытая пометка: Linked
  machine их не зовёт и не слышит):** `linked.invoke`, `linked.event`, `linked.state`, `linked.changed`,
  `linked.open`. В домене `projects` — `projects.hold {screen, projectId | null}` с пометкой `project` («экран
  открыл Project»: её зовёт Linked machine).
- **Main, вызовы на Linked machine** — `src/main/link/remote-calls.ts`: `RemoteCalls` (один на link service) и
  `callOn(machine, channel, input)` для других модулей main (Ticket 10). Идут только каналы `project` и
  `desktop`; пометки, доступ и проверка путей Ticket-а 08 работают на стороне Machine Project-а, как были.
- **Две связи с одной Machine.** Обе стороны звонят друг другу, и Linked machine рассылает события по обеим:
  без отбора событие Session (`agent.event`) приходило бы в окно дважды. Вызовы идут по одной «текущей» связи,
  и в окна идут только события, пришедшие по ней. Для этого в `src/main/link/service.ts` (файл Ticket-а 01, сверх
  следа) — две добавки без смены поведения: событие `ipc-event` несёт `connection`, метод `connectionTo(id)`.
- **«Делится ли Machine Project-ами»** — служебное сообщение связи `projects-access {on}` (точка расширения
  Ticket-а 01): Machine шлёт его при каждом открытии связи и при смене переключателя. Запасной путь — отказ
  «access is off» на вызове. `epoch` Machine (в `linked.state`) меняется, когда вызовы пошли по другой связи или
  доступ снова включили: подписки, сделанные через старую связь, пропали, и окно на M перезагружается само (если
  M в сети и делится Project-ами).
- **Боковая панель.** Без Linked machine-ов — список прежний, без групп. С ними — группы: своя Machine первой,
  затем Linked machine-ы по имени; у группы имя и «Online» / «Unavailable» (как в секции Machines);
  не делится — без Project-ов, строка «<Machine> doesn't share its Projects». «Project settings…» и «Remove from
  list» строки Linked machine-а идут на её Machine (`ProjectSettings` получил `machine`). «Add project» — на своей
  машине; в окне на M после добавления окно возвращается на свою машину (Project стал активным там).
- **Активный Project.** В окне на M `activeProject(useProjects())` — Project этого окна (из адреса), список — M;
  `projects.select` не зовётся, активный Project M не меняется. Окно сообщает M, что показывает Project
  (`linked.open` → `projects.hold`, экран — id окна); main своей машины отпускает его при закрытии окна и при
  загрузке другой страницы. M держит Orchestrator и документы Project-а, пока его держит хоть один экран;
  клиент, ушедший из реестра (связь закрылась, доступ выключили), отпускает всё (`src/main/projects/holds.ts`).
- **Toolbar** — «<Project> · <Machine>»; над Canvas окна на M — строка «<Machine> is unreachable» /
  «<Machine> stopped sharing its Projects» / «<Machine> is no longer linked to this Machine».
- **Вне следа (добавлены в список):** `src/main/projects/holds.ts` (новый; держатели Project-ов, без Electron —
  его берут и `docs.ts`, и `app-orchestrators.ts`), `src/main/link/service.ts` (две добавки выше),
  `src/renderer/shell/ProjectSettings.tsx` (параметр `machine`), `test/contract/main-ipc-wiring.test.ts` (одна
  строка подмены `onAppLinkStart`, как у Ticket-а 02). Новые test-ы: `test/contract/remote-calls.test.ts`,
  `test/contract/linked-ipc.test.ts`, `test/contract/projects-hold.test.ts`, `test/unit/project-holds.test.ts`.
  `src/main/window.ts` не понадобился.
- **Снимки** (обе темы, `snapshotThemes`; в репозиторий копирует запуск с `WORFY_EVIDENCE=1`, обычный прогон —
  нет): боковая панель A с Project-ами B «в сети» — [../evidence/09-sidebar-online-light.png](../evidence/09-sidebar-online-light.png),
  [тёмная](../evidence/09-sidebar-online-dark.png); B не делится — `09-sidebar-not-shared-{light,dark}.png`; B
  закрыт — `09-sidebar-unavailable-{light,dark}.png`; Canvas Project-а B в окне A —
  [../evidence/09-canvas-of-b-light.png](../evidence/09-canvas-of-b-light.png), `09-canvas-of-b-dark.png`; B закрыт,
  строка над Canvas — `09-canvas-unreachable-{light,dark}.png`. «Спит» — Ticket 14, снимка нет. Цвета — роли
  `tokens.css` (`text-secondary`, `text-muted`, `surface-raised`, `border`, `blocked-text`, чип `ready`).

Проверки:

- `test/e2e/linked-machines.spec.ts` — `7 passed` (четыре test-а Ticket-а 02 и три этого). `GATE_SCOPE=all gate.sh full`
  на 109c079: lint, typecheck, `test:e2e`, `test:package` — прошли; `test` — красный только по timeout-ам 5 s в
  `test/contract/github-prs.test.ts` и `harness-qmd.test.ts` (известные нестабильные test-ы под нагрузкой; load
  average 5–7 от соседних прогонов). Эти файлы отдельно — exit 0 (132 test-а); CI PR 169 — check pass.
- Mutation testing в своём worktree (восстановление из копии): без отбора событий по текущей связи
  (`remote-calls.test.ts` краснеет: событие дважды); `desktop` не на M (`ipc-renderer.test.tsx`); перезагрузка без
  условия «делится» (`use-projects.test.tsx`); без подписки Orchestrator-ов и документов на держателей
  (`projects-hold.test.ts`) — все краснеют.

Решения (все — **решено без владельца, подтвердить**):

- Окно показывает одну Machine и перезагружается при переходе на другую (пункт 1); Machine окна — в адресе окна.
- Каналы `linked.*` — `local`; «экран открыл Project» — `projects.hold` (`project`), экран — id окна своей машины.
- Делится ли Linked machine Project-ами, окно узнаёт из нового служебного сообщения `projects-access` (а не только
  по отказу): иначе после включения доступа на M окну A не от кого узнать, что пора перезагрузиться.
- `linked.event` и `linked.changed` идут во все окна своей машины, отбор по Machine — в renderer.
- Группа «Unavailable» — без Project-ов (список недоступной Machine не прочитать); у своей Machine чипа нет.
- «Add project» в окне на M добавляет на своей машине и возвращает окно на неё.

Не проверено / известные ограничения:

- Два настоящих Mac в LAN — test-ы гоняют два worfy на одном Mac по 127.0.0.1.

Гейт Wave 4, круг 1: `REJECTED` (2 ревьюера — отчёт со снимками: VERIFIED с low; безопасность: 1 med) на e4d694e →
доработка (единственный круг):

1. **[med] Ответы и события Linked machine-а — по схеме канала.** В `src/shared/ipc/channels.ts` рядом с
   `declaredAccess` — таблица «имя → определение» (`definitionOf`): первое объявление имени; повторное с той же
   пометкой его не подменяет, с другой пометкой или видом — имя закрыто. `RemoteCalls` (`src/main/link/remote-calls.ts`)
   разбирает ответ схемой `output` канала (не по схеме — `{ok:false}` «<канал>: <Machine> answered outside the
   contract») и событие схемой `payload` (не по схеме — отброшено, warn с именем канала и Machine, без содержимого);
   дальше идёт уже разобранное значение. Test-ы — `test/contract/remote-calls.test.ts` («drops an event outside its
   schema…», «answers {ok:false} for an answer outside the output schema…», «definitionOf»); mutant-ы без разбора
   события, без разбора ответа и «последнее объявление побеждает» — все три краснеют.
2. **[low] Палитра** (`src/renderer/palette/commands.ts`): «Switch to project» зовёт `openProject(windowMachine(), id)`;
   в окне на M — Project M в этом окне, без `projects.select`. Test — `test/unit/use-projects.test.tsx` («the
   palette's Switch to project in a window on M…»); mutant `openProject(null, …)` краснеет.
3. **[low] Камера Canvas** — ключ «Machine + Project id»: `viewport.get` / `viewport.set` принимают `machine`
   (необязательный uuid), `viewports.json` хранит камеру Project-а M под `<id M>/<projectId>`; `prune()` чистит только
   ключи своей машины; камеры, ещё не сохранённой для Project-а M, нет (`null`) — Canvas открывается по `viewport`
   его Layout-а. `Canvas.tsx` передаёт `machine` окна. Test-ы — `test/contract/viewport-store.test.ts` (два новых),
   `test/unit/canvas.test.tsx` («asks this machine for the camera of a Linked machine's Project under that
   Machine»); mutant-ы: ключ без Machine, `prune` без исключения, Canvas без `machine` — краснеют. e2e «A opens a
   Project of B…» теперь сверяет место Node после возвращения B по Layout-у B: окно открывается на своей сохранённой
   камере, и Node может лежать вне экрана (до доработки камера Project-а M не сохранялась вовсе).
4. **[low] `test/contract/main-ipc-wiring.test.ts`** — строка `onAppLinkStart` та же, что у worfy-link/15; на момент
   доработки `origin/main` не ушёл вперёд — при rebase после 15 остаётся одна строка.
5. **[low] Сырая ошибка связи.** `RemoteCalls` заменяет слова соединения («call 63: the connection to the Linked
   machine closed», «… is not connected», «… did not answer in time») на «<канал>: <Machine> is unreachable» /
   «… did not answer in time»; секция Sessions показывает это без имени канала («The Sessions could not be read:
   Mini is unreachable», `readableReason`). Test-ы — `remote-calls.test.ts` («names the Machine when the connection
   drops…»), `use-projects.test.tsx` («the Sessions section words an unreachable Machine…»); mutant-ы краснеют.
   Send, Run wave и Ship ticket, пока M недоступна, **не отключены**: это правка `SessionNode`, действий Canvas и
   их gates вне следа; вызов и так отвечает понятной строкой. Долг.

Проверки доработки (head e50548f, `origin/main` не ушёл вперёд — 27f12f6, rebase не понадобился):
`GATE_SCOPE=all gate.sh full` — lint, typecheck, `test:e2e` (165 test-ов), `test:package` прошли; `test` красный только
по timeout-ам 5 s в contract-файлах `github-prs`, `harness-qmd` и других, что зовут внешние процессы (load average 5–7);
`github-prs.test.ts` и `harness-qmd.test.ts` отдельно — exit 0 (76 test-ов). `test/e2e/linked-machines.spec.ts
--repeat-each 3` — 21 passed. CI PR 169 на e50548f — check pass. Вёрстка не менялась — снимки прежние.

Долги (не дорабатывались, решение гейта):

- Два окна A на одном Project-е M делят на M одного клиента связи: `docs.close` / `workflow.close` одного окна
  снимают подписку и второго; подписки окна, которое перезагрузилось, живут на M до закрытия связи.
- Адрес Card от M (Card-ы Linked machine-а) — Ticket 10.
- Send, Run wave и Ship ticket не отключаются, пока M недоступна (пункт 5 выше).
