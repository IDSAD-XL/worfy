# 08 — Project-ы Machine открыты Linked machine-ам: каналы, события, переключатель

Type: task
Status: open
Blocked by: 01, 02, 03
Source: решения владельца 2026-10-07: Q3 (с другой машины можно всё, кроме действий, которым нужен рабочий стол машины Project-а), Q4 (доступ выключен по умолчанию, только LAN, токен устройства, отзыв), Q7 (host и client — роли соединения: каждый worfy бывает и тем, и другим), Q11 (переключатель «Linked machines can work with my Projects», по умолчанию выключен); [spec.md](../spec.md); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) — Machine, Linked machine, связь по коду, доступ выключен по умолчанию

## Что происходит

- Каналы IPC объявлены в `src/shared/ipc/*.ts`: 21 доменный файл и `channels.ts`. На 4f983ef каналов
  91: 72 invoke и 19 событий (счёт по записям `IpcContract`). К началу этого Ticket-а их больше:
  Ticket-ы 01 и 02 добавляют каналы связи (`src/shared/ipc/link.ts`), Ticket 05 —
  `terminal.takeSize` и `terminal.started`, Ticket 06 — `viewport.get` и `viewport.set`. Помечаются
  все каналы, которые есть на момент работы.
- Объявление канала — `invokeChannel(name, input, output)` и `eventChannel(name, payload)`
  (`src/shared/ipc/channels.ts:36-42`). Отметки о доступе у канала нет.
- `registerIpc` регистрирует все handler-ы на любом `IpcMainLike` (`src/main/ipc/index.ts:51-53`,
  `:163-185`); зарегистрировать часть каналов нельзя (`RegisterOptions`, `:97-105`). Ticket 01 даёт
  адаптер `IpcMainLike` над соединением Linked machine-а (`src/main/link/ipc-adapter.ts` — имя из его
  плана) со своей проверкой доверия вместо `senderFrame.url` (`:130-133`). В адаптере открыт один
  канал — `link.ping`, проверка связи; на остальные он отвечает «not open to Linked machines».
  Список открытых каналов у Ticket-а 01 лежит в одном месте, и расширяет его этот Ticket. Соединение
  в реестр клиентов Ticket-а 03 тоже ставит этот Ticket.
- Действия, которым нужен рабочий стол машины Project-а:
  - `projects.pickFolder` — `dialog.showOpenDialog` (`src/main/ipc/projects.ts:37-47`);
  - `agent.attachPick` — тоже диалог (`src/main/ipc/agent.ts:100-105`, `:159-161`);
  - `cardApi.ask` — `dialog.showMessageBox` (`src/main/ipc/card-api.ts:59`, `:95-96`);
  - `shell.openInEditor` и `shell.openExternal` — `shell.openPath` и `shell.openExternal`
    (`src/main/ipc/shell.ts:57-67`).
  Окно-хозяина диалога они ищут через `BrowserWindow.fromWebContents(event.sender)`. Для отправителя-
  соединения это `null`, и диалог открылся бы без хозяина на экране машины Project-а [вывод из
  кода].
- Состояние самой машины, общее для её окон:
  - активный Project — `projects.select` (`projects.ts:60-63`), `activeId` в `projects.json`
    (`src/main/projects/store.ts:24`). Его смену слушает запуск Orchestrator-ов
    (`src/main/agent/app-orchestrators.ts`). Выбор с Linked machine-а переключил бы Project на
    экранах машины Project-а;
  - меню View ▸ Show Minimap — `view.get`, `view.changed` (`src/main/ipc/view.ts:8-20`);
  - уведомления — `notify.pending` (по `event.sender.id`, `src/main/ipc/notify.ts:8`) и событие
    `notify.open` (`src/shared/ipc/notify.ts:20-23`);
  - Limits — подписка Claude этой машины (`limits.open`, `limits.changed`);
  - версия своей сборки — `app.version`.
- Handler-ы, которые читают `event.sender` как подписчика: `workflow.ts:27-28`, `docs.ts:105-106`,
  `claude-home.ts:143-152`, `bindings.ts:37-38`, `limits.ts:15-16` (все в `src/main/ipc/`) — их
  переводит на клиента реестра Ticket 03; `terminal.ts:65-73` — Ticket 05; `agent.ts:136-139` —
  Ticket 04.
- Образец канала в test-ах, `test/contract/ipc-sample/shared/sample.ts:15-22`, тоже объявляется через
  `invokeChannel` и `eventChannel`.
- Переключатель «Linked machines can work with my Projects» хранит и показывает Ticket 02, по
  умолчанию он выключен. У каждой Machine свой переключатель: машина A работает с Project-ами B,
  только если включён переключатель B (Q7).

## Что делаем

1. **Пометка в объявлении канала** (Q3). `invokeChannel` и `eventChannel` принимают обязательный
   последний аргумент — доступ; он лежит в объекте канала. Значения:
   - `link` — служебный канал связи (`link.ping` Ticket-а 01). Linked machine-у доступен всегда,
     и при выключенном переключателе;
   - `project` — работа с Project-ами этой Machine. Linked machine-у доступно при включённом
     переключателе;
   - `desktop` — нужен рабочий стол машины Project-а. Linked machine-у недоступно; перенос в UI
     вызвавшей машины — Ticket-ы 10–12;
   - `local` — состояние машины экрана. Linked machine-у недоступно; экрану отвечает свой main
     (маршрут в renderer — Ticket 09).
   Пометка стоит в доменном файле канала, а не в общем списке: Ticket 09 продолжает её своим классом
   маршрута, Ticket-ы 10–12 меняют пометки своих каналов, и общий файл они не делят.
2. **Начальная разметка** (исполнитель сверяет каждый handler):
   - `link`: `link.ping`;
   - `desktop`: `projects.pickFolder`, `agent.attachPick`, `cardApi.ask`, `shell.openInEditor`,
     `shell.openExternal`;
   - `local`: `projects.select`, `view.get`, `view.changed`, `notify.pending`, `notify.open`,
     `limits.open`, `limits.changed`, `app.version`, остальные каналы связи Ticket-ов 01–02 (Linked
     machine не включает доступ и не связывает машины за владельца), `viewport.get` и `viewport.set`
     (Ticket 06);
   - `project`: остальные — `actions.*`, `autopilot.*`, `bindings.*`, `cards.get`, `cards.changed`,
     `cardApi.dataGet`, `cardApi.dataSet`, `layout.*`, `checks.get`, `agent.*` кроме `attachPick`,
     `projects.list`, `projects.add`, `projects.remove`, `projects.settings.*`, `projects.changed`,
     `docs.*`, `orchestrator.*`, `terminal.*`, `sessions.*`, `claudeHome.*`, `workflow.*`, `trash.*`.
3. **Новый канал без пометки не проходит.** Аргумент обязательный — `pnpm typecheck` падает. Unit
   test собирает все объекты каналов из `src/shared/ipc/*.ts` (`import.meta.glob` с `eager`) и
   проверяет, что у каждого одна из четырёх пометок: так ловится и обход типа (`as`). Сообщение
   называет канал. Образец `sample.*` тоже получает пометки.
4. **Сервер.** На адаптере Ticket-а 01 регистрируются только каналы `link` и `project`: список
   открытых каналов Ticket-а 01 заменяется пометкой, `RegisterOptions` получает фильтр каналов.
   Вызов канала `desktop`, `local` или неизвестного отвечает `{ok:false}` с текстом Ticket-а 01
   «<канал> is not open to Linked machines» до проверки zod и handler-а; handler не запускается.
   Окна своей машины (`ipcMain`) получают все каналы, как сейчас.
5. **Переключатель** (Q4, Q11).
   - Выключен — любой вызов, кроме каналов `link`, отвечает отказом «Linked machines cannot work
     with the Projects of <Machine>: access is off».
   - Включён — каналы `project` работают. Для доступа к Project-ам у соединения отдельный клиент
     реестра Ticket-а 03; соединение создаёт его при включении.
   - Выключение уничтожает этого клиента. Срабатывает его `destroyed`, и hubs (подписки main на
     файлы workflow, документов и `~/.claude`), Terminal (Ticket 05) и Session (Ticket 04) отписывают
     его сразу. Вызов, уже начатый, доходит; следующие получают отказ. Соединение остаётся: Ticket 02
     по-прежнему показывает машину в сети.
6. **События.** Клиент соединения получает только события `project`: `view.changed`, `notify.open`,
   `limits.changed` в соединение не уходят. Фильтр — в `emit` (`index.ts:195-203`) или в `send`
   клиента соединения; выбирает исполнитель.
7. **Отправитель.** Handler получает в `event.sender` клиента соединения (`send`, `id`,
   `isDestroyed`, `destroyed`; поддельный event — Ticket 01). Handler-ы, читающие `event.sender`,
   работают с ним без правки.
8. **Лог.** Отказ пишется с именем канала и Machine. Токен и код связи в лог не попадают (как в
   Ticket-е 01).

**Не входит:** UI клиента и маршрут вызовов в renderer (Ticket 09), Card Linked machine-а
(Ticket 10), «Add Project» на Linked machine (Ticket 11), системные действия на вызвавшей машине
(Ticket 12), уведомления (Ticket 13), один Autopilot на все машины (Ticket 15).

## Готово, когда

- [ ] Unit `test/unit/link-access.test.ts` (новый): у каждого канала `src/shared/ipc/*.ts` одна из пометок `link`, `project`, `desktop`, `local`; на образце канала без пометки проверка падает и называет канал.
- [ ] Канал, объявленный без пометки, роняет `pnpm typecheck`: проверено временной правкой, вывод — в «Итог».
- [ ] Contract `test/contract/ipc.test.ts`: `registerIpc` с фильтром регистрирует только каналы `link` и `project`; вызов отфильтрованного канала отвечает «not open to Linked machines», handler не вызван.
- [ ] Contract `test/contract/link-access.test.ts` (новый), две Machine над двумя папками данных на стенде `test/contract/link-bench.ts` Ticket-а 01, переключатель выключен: `projects.list` с Linked machine-а отклонён с текстом «access is off», `link.ping` отвечает.
- [ ] Тот же test, переключатель включён: `projects.list` отвечает; `layout.apply` с Linked machine-а меняет Layout машины Project-а, и Linked machine получает `layout.changed`.
- [ ] Каналы `desktop` и `local` с Linked machine-а: `projects.pickFolder` и `cardApi.ask` отклонены, подменённый `dialog` не вызван; `projects.select` отклонён, `activeId` прежний; `view.changed` машины Project-а в соединение не ушёл.
- [ ] Handler-ы с `event.sender` через соединение: `workflow.open`, `docs.open`, `claudeHome.sessions`, `bindings.get`, `terminal.open` отвечают `ok`, и соединение получает их события.
- [ ] Выключение посреди подписки: Linked machine перестаёт получать `terminal.output` открытого Terminal-а, следующий `terminal.input` отклонён, `link.ping` отвечает.
- [ ] В перехваченном `console` test-ов нет значений токена и кода связи.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально (команда — `rules.md` Profile-а worfy) — exit 0.

## Тесты

Сначала падающий unit `test/unit/link-access.test.ts`: пометок ещё нет, test перечисляет каналы и
падает на первом. Потом правка `channels.ts` и разметка доменных файлов, потом фильтр в
`registerIpc`, потом contract на двух серверах.

Contract на двух Machine — на стенде Ticket-а 01 (`test/contract/link-bench.ts`: несколько сервисов
связи над временными папками данных в одном процессе vitest). Handler-ы с диалогами — с подменой `electron`, как в существующих contract test-ах
(`vi.mock('electron', …)`, например `test/contract/shell.test.ts`). В «Итог» — как падал первый test.

## Где в коде

- `src/shared/ipc/channels.ts`
- `src/shared/ipc/actions.ts`
- `src/shared/ipc/agent.ts`
- `src/shared/ipc/app.ts`
- `src/shared/ipc/autopilot.ts`
- `src/shared/ipc/bindings.ts`
- `src/shared/ipc/card-api.ts`
- `src/shared/ipc/cards.ts`
- `src/shared/ipc/checks.ts`
- `src/shared/ipc/claude-home.ts`
- `src/shared/ipc/docs.ts`
- `src/shared/ipc/layout.ts`
- `src/shared/ipc/limits.ts`
- `src/shared/ipc/notify.ts`
- `src/shared/ipc/orchestrator.ts`
- `src/shared/ipc/projects.ts`
- `src/shared/ipc/sessions.ts`
- `src/shared/ipc/shell.ts`
- `src/shared/ipc/terminal.ts`
- `src/shared/ipc/trash.ts`
- `src/shared/ipc/view.ts`
- `src/shared/ipc/workflow.ts`
- `src/shared/ipc/link.ts`
- `src/main/ipc/index.ts`
- `src/main/link/ipc-adapter.ts`
- `src/main/link/service.ts`
- `test/contract/ipc-sample/shared/sample.ts`
- `test/contract/ipc.test.ts`
- `test/unit/link-access.test.ts` (новый)
- `test/contract/link-access.test.ts` (новый)

Имена файлов связи — из плана Ticket-а 01; если в его «Итог» они другие, исполнитель правит список.
Общий файл с Ticket-ом 01 — index.ts в src/main/ipc (вариант проверки доверия «б» Ticket-а 01). Доменные файлы, которые Ticket-ы 05–07 добавят до
этого Ticket-а (например viewport.ts Ticket-а 06), тоже получают пометку. Влитые после — ставят её
сами: без неё не соберётся.

## Итог

Заполняется при закрытии.
