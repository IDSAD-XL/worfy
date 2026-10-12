# 18 — Право «только чтение» для Linked machine до связи с чужой машиной

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-12; `.scratch/worfy-link/issues/08-доступ-linked-machine-к-project-ам.md:278`

## Что происходит

- Machine — компьютер с worfy, на котором лежит Project. Linked machine — другой компьютер с worfy,
  связанный с этим по коду.
- У каждой Machine есть переключатель «Linked machines can work with my Projects». По умолчанию он
  выключен. Он хранится как `projectsAccess: boolean` в файле `link/settings.json`
  (`src/main/link/settings.ts:17`; значение по умолчанию — `:29`).
- Каждый канал IPC (вызов или событие между экраном и main-процессом worfy) несёт пометку доступа:
  `link`, `project`, `desktop` или `local` (`src/shared/ipc/channels.ts:34-35`). Linked machine-у
  открыты только `link` и `project` (`LINKED_MACHINE_ACCESS`, `channels.ts:38`).
- Переключатель включён — Linked machine может вызвать любой канал `project`. Это пункт 6 ADR-0052
  (решение о Machine и связывании): в Project-ах можно всё, кроме каналов `desktop`. `desktop` — это
  действия, которым нужен рабочий стол машины Project-а: системный диалог, оболочка ОС.
- Среди каналов `project` есть те, что исполняют код на машине Project-а:
  - `terminal.open` и `terminal.input` — shell в Terminal;
  - `agent.start`, `agent.send`, `agent.configure` — Session Claude Code. Режим разрешений по
    умолчанию — `bypassPermissions`, то есть без запросов разрешений (`src/shared/agent/settings.ts:33`);
  - `agent.permission` — ответ на запрос разрешения;
  - `projects.add` — добавить Project-ом любую папку git-репозитория этой машины;
  - `autopilot.start` — запустить Autopilot (режим, в котором worfy сам ведёт Ticket-ы без человека).
- Права «только чтение» нет. Сейчас каналов 146: `project` — 95, `local` — 47, `desktop` — 3,
  `link` — 1. Подсчёт — по объявлениям `invokeChannel` и `eventChannel` в `src/shared/ipc/*.ts` на
  main `25efbbe`.
- Владелец 2026-10-12 подтвердил такой доступ для своих машин. Для связи с чужой машиной он требует
  право «только чтение» отдельным Ticket-ом. Запись — «Итог» Ticket-а 08 этого Epic-а (доступ Linked
  machine к Project-ам), строки 276–278.
- Вопрос владельцу об этом стоял в `HANDOFF.md`: строка 20 на commit `3dc7bd1`. После ответа его
  убрал commit `25efbbe` (PR #249). В текущем `HANDOFF.md` этой записи нет.

## Вопросы владельцу до начала

Задаются при claim — когда исполнитель берёт Ticket в работу. Рядом — предложение по умолчанию. Этот
Ticket вопросы не решает: код начинается после ответов.

1. Уровень доступа один на все Linked machine-ы этой Machine или свой у каждой Linked machine?
   Сейчас переключатель один на Machine. С одним уровнем нельзя дать своей машине всё, а чужой —
   только чтение. Предложение: свой уровень у каждой Linked machine; у новой связи — «выключен».
2. Входит ли в «чтение» содержимое Session-ов и Terminal-ов: транскрипты (`claudeHome.transcript`),
   события Session (`agent.event`), вывод Terminal (`terminal.output`), тексты уведомлений? В них
   бывают секреты. Предложение: транскрипты, события Session и уведомления — да; вывод Terminal — нет.
3. Входят ли в «чтение» каналы, которые ради чтения запускают на машине Project-а `git` и `gh` от её
   учётной записи GitHub (`checks.get`, `checks.repos`; `src/main/ipc/checks.ts:5-6`)? Предложение: да,
   они ничего не пишут.
4. Что видит пользователь Linked machine-а с правом «только чтение»: действия записи скрыты, выключены
   или остаются и отвечают отказом? Предложение: в этом Ticket-е — отказ с понятным текстом; скрытие
   действий на экране — отдельный Ticket.
5. Понижение уровня с «всё» до «только чтение» не останавливает то, что Linked machine запустила
   раньше (Session-ы, Autopilot, очередь сообщений)? Так владелец решил 2026-10-12 для выключения
   доступа («Итог» Ticket-а 08, строки 266–268). Предложение: то же правило.

## Что делаем

Наименьший дизайн. Он уточняется ответами на вопросы выше.

1. **Второй уровень переключателя.** Доступ получает три значения: выключен, только чтение, всё.
   - `projectsAccess` в `link/settings.json` перестаёт быть boolean. Старый файл читается: `true` —
     «всё», `false` — «выключен». По умолчанию — «выключен», как сейчас (`settings.ts:29`). Файл не
     читается — тоже «выключен» (`settings.ts:42-43`).
   - Те же три значения несут канал `link.setAccess` (`src/shared/ipc/link.ts:162`), состояние связи
     (`link.ts:129`) и сообщение `projects-access` другой машине (`src/main/link/remote-calls.ts:40`).
     Сейчас везде boolean.
   - Как хранить уровень у каждой Linked machine (вопрос 1) — за исполнителем.
2. **Какие каналы считаются чтением.** Каждый канал `project` получает второй признак: чтение или
   запись.
   - Признак обязателен в объявлении канала, как пометка доступа Ticket-а 08: канал без него не
     проходит `pnpm typecheck` (`channels.ts:99-107`). Форма признака — за исполнителем.
   - Правило: канал «чтение» не меняет файлы и состояние Project-а, не запускает и не останавливает
     процессы и ничего не шлёт в Session или Terminal. Подписка на события и отписка — чтение.
   - Кандидаты в «чтение» подобраны по именам каналов. Исполнитель сверяет handler каждого:
     `actions.launches`, `agent.list`, `agent.commands`, `agent.controls`, `agent.models`,
     `autopilot.state`, `bindings.get`, `bindings.signals`, `cardApi.dataGet`, `cards.get`,
     `cards.file`, `checks.get`, `checks.repos`, `claudeHome.sessions`, `claudeHome.live`,
     `claudeHome.close`, `claudeHome.transcript`, `claudeHome.subagents`,
     `claudeHome.subagentTranscript`, `docs.open`, `docs.close`, `docs.read`, `layout.get`,
     `orchestrator.view`, `projects.list`, `projects.settings.get`, `projects.settings.defaults`,
     `sessions.resumable`, `sessions.views`, `terminal.shells`, `trash.list`, `workflow.open`,
     `workflow.close` — 33 из 77 вызовов `project`.
   - Остальные 44 вызова `project` — запись. Четыре из них по имени похожи на чтение, но чтением не
     являются: `orchestrator.open` (запускает Session Orchestrator-а, если её нет), `terminal.open`
     (запускает shell, если он не запущен), `projects.browse` (читает папки всего диска машины для
     «Add project»), `projects.connect.inspect` (уже подключённую папку сразу добавляет в список
     Project-ов).
   - 18 событий `project` (`agent.event`, `layout.changed`, `terminal.output` и другие) — чтение,
     кроме тех, что исключит ответ на вопрос 2.
3. **Что отвечает отклонённый вызов.** Проверка — в `LinkIpcAdapter.call`
   (`src/main/link/ipc-adapter.ts:199-219`), после двух нынешних отказов: «access is off» (`:208-211`)
   и «not open to Linked machines» (`:212-215`).
   - Уровень «только чтение» и канал записи — ответ `{ok: false, error}` с новым текстом. Предложение
     текста: «Linked machines can only view the Projects of <Machine>: access is read-only».
   - Отказ приходит до разбора входа по схеме zod и до handler-а. Handler не запускается.
   - Отказ пишется в лог с именем канала и Machine, без входа вызова (`LinkPeer.refused`, `:174-177`).
   - Экран Linked machine-а узнаёт уровень из сообщения `projects-access`, а не разбором текста
     отказа. Сейчас отказ «access is off» распознаётся по тексту (`remote-calls.ts:49`).
4. **Клиент соединения.** Сейчас `LinkPeer.setAccess` (`ipc-adapter.ts:144-158`) создаёт клиента
   `project` при включении и уничтожает при выключении. Его зовёт сервис связи
   (`src/main/link/service.ts:191`, `:556`).
   - При уровнях «только чтение» и «всё» клиент есть.
   - Смена уровня уничтожает клиента и создаёт нового. Подписки старого клиента снимаются, экран
     подписывается заново. Вызов, уже начатый, доходит; следующий проверяется по новому уровню.
   - События, исключённые ответом на вопрос 2, клиент с правом «только чтение» не отправляет
     (`LinkSender.send`, `ipc-adapter.ts:91-97`).
5. **Остальные места, где читается `projectsAccess`.** Исполнитель проходит каждое и записывает
   поведение при «только чтение» в «Итог»: запрет сна машины (`src/main/link/keep-awake.ts:54-55`),
   уведомления Linked machine-ам (`src/main/link/notes.ts:59`), handler `link.setAccess`
   (`src/main/ipc/link.ts:268-270`).
6. **Экран этой Machine.** Переключатель в боковой панели
   (`src/renderer/shell/sidebar/MachinesSection.tsx:200`, `src/renderer/machines/useMachines.ts:63`)
   получает три положения. Тексты и вид — в `docs/design/F-SPEC.md` (описание экранов worfy).
7. **Новый ADR.** Право «только чтение» уточняет пункт 6 ADR-0052. Номер ADR выдаёт Orchestrator
   (главная Session Project-а, она раздаёт номера) при claim. «Итог» Ticket-а 08 (`:269`) уже просит
   ADR, который уточняет тот же пункт; это может быть один ADR.

Не входит: скрытие действий записи на экране Linked machine-а (вопрос 4), права по отдельным
Project-ам, доступ из интернета.

## Готово, когда

- [ ] Ответы владельца на вопросы 1–5 записаны в этот Ticket до начала кода.
- [ ] Unit `test/unit/link-access.test.ts`: у каждого канала `project` есть признак «чтение» или
      «запись». Список каналов «чтение» записан в test-е поимённо: новый канал `project` без решения
      роняет test, сообщение называет канал.
- [ ] Канал `project`, объявленный без признака, роняет `pnpm typecheck`. Проверено временной правкой,
      вывод — в «Итог».
- [ ] Contract `test/contract/link-access.test.ts`, две Machine на стенде `test/contract/link-bench.ts`,
      уровень «только чтение»: `projects.list` и `layout.get` отвечают.
- [ ] Тот же test, тот же уровень: `layout.apply`, `terminal.open`, `agent.start`, `agent.permission`,
      `projects.add`, `autopilot.start` отклонены с новым текстом. Handler не вызван. Layout
      (расположение Node-ов на Canvas) и список Project-ов машины Project-а прежние. Ни один процесс
      не запущен.
- [ ] Тот же test: отказ есть в логе с именем канала и Machine; входа вызова в логе нет.
- [ ] Тот же test: событие `layout.changed` приходит Linked machine-у с правом «только чтение».
      События, исключённые ответом на вопрос 2, не приходят.
- [ ] Понижение «всё» → «только чтение» посреди работы: следующий вызов записи отклонён, `link.ping`
      отвечает.
- [ ] Старый `link/settings.json` с `projectsAccess: true` читается как «всё», с `false` — как
      «выключен». Нечитаемый файл — «выключен».
- [ ] Уровни «выключен» и «всё» ведут себя как до этого Ticket-а: test-ы Ticket-а 08 зелёные, в них
      меняется только форма значения.
- [ ] Test-ы краснеют на мутантах (намеренно испорченных копиях кода): проверка уровня в адаптере
      убрана; канал записи помечен чтением.
- [ ] Новый ADR принят. `docs/design/F-SPEC.md` и `.scratch/worfy-link/spec.md`, раздел «Доступ»,
      приведены к решению.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. `GATE_SCOPE=all gate.sh full` (полный прогон
      проверок проекта, включая e2e) — зелёный.

## Тесты

Сначала падающий contract test в `test/contract/link-access.test.ts`: уровень «только чтение», а
`layout.apply` с Linked machine-а меняет Layout машины Project-а. В «Итог» — как test падал.

Стенд — `test/contract/link-bench.ts`: несколько сервисов связи над временными папками данных в одном
процессе vitest. Handler-ы с диалогами и процессами идут с подменой `electron`, как в test-ах
Ticket-а 08.

## Где в коде

- `src/shared/ipc/channels.ts` — пометка доступа и новый признак «чтение или запись».
- `src/shared/ipc/*.ts` — объявления каналов `project` во всех доменных файлах.
- `src/main/link/ipc-adapter.ts` — проверка уровня, текст отказа, клиент соединения.
- `src/main/link/settings.ts` — хранение уровня и чтение старого файла.
- `src/shared/ipc/link.ts`, `src/main/ipc/link.ts` — канал `link.setAccess` и состояние связи.
- `src/main/link/remote-calls.ts` — сообщение `projects-access`.
- `src/main/link/service.ts`, `src/main/link/keep-awake.ts`, `src/main/link/notes.ts` — места, где
  читается `projectsAccess`.
- `src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/machines/useMachines.ts` —
  переключатель на экране.
- `test/unit/link-access.test.ts`, `test/contract/link-access.test.ts`, `test/contract/ipc.test.ts`.
- `docs/adr/` — новый ADR; `docs/design/F-SPEC.md`; `.scratch/worfy-link/spec.md`.

## Итог
