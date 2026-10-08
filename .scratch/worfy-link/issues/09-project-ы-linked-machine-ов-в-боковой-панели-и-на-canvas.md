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

Модуль связи заводит Ticket 01: `src/main/link/remote-calls.ts` берёт у него соединение с Linked
machine-ом и ничего в его файлах не правит. Каналы этого Ticket-а — в своём домене `linked`, а не в
`src/shared/ipc/link.ts` Ticket-ов 01 и 02: так нет общего файла с Ticket-ом 14, который может идти в
той же Wave. Если без правки файлов связи не обойтись, они добавляются в список по «Итог» Ticket-а 01.
Пометки каналов этот Ticket не меняет — только читает (Ticket 08). Если по «Итог» Ticket-а 08 пометка
лежит не в объявлении канала, файл с ней добавляется в список. Ticket 15 может идти в той же Wave
(оба ждут 08): общих файлов с ним нет.

## Итог

Заполняется при закрытии.
