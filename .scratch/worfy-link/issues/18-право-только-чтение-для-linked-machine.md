# 18 — Право «только чтение» для Linked machine до связи с чужой машиной

Type: task
Status: done — 2026-10-16, [PR #399](https://github.com/IDSAD-XL/worfy/pull/399)
Branch: worfy-link/18
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

**Владелец ответил 2026-10-13 — по всем пяти пунктам как в предложении:**
1. Свой уровень у каждой Linked machine; у новой связи — «выключен». Общий переключатель остаётся
   как «выключить всем».
2. В «чтение» входят транскрипты, события Session и уведомления; вывод Terminal — нет. В Ticket-е
   и в UI сказать прямо: «только чтение» всё равно означает доверие, транскрипт может показать
   секрет.
3. `checks.get` и `checks.repos` входят в «чтение»: они ничего не пишут.
4. В этом Ticket-е — отказ с понятным текстом. Скрытие действий записи на экране — отдельный
   Ticket; завести его, когда этот будет взят в работу.
5. Понижение уровня не останавливает запущенное раньше — то же правило, что в ADR-0060.

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

- [x] Ответы владельца на вопросы 1–5 записаны в этот Ticket до начала кода.
- [x] Unit `test/unit/link-access.test.ts`: у каждого канала `project` есть признак «чтение» или
      «запись». Список каналов «чтение» записан в test-е поимённо: новый канал `project` без решения
      роняет test, сообщение называет канал.
- [x] Канал `project`, объявленный без признака, роняет `pnpm typecheck`. Проверено временной правкой,
      вывод — в «Итог».
- [x] Contract `test/contract/link-access.test.ts`, две Machine на стенде `test/contract/link-bench.ts`,
      уровень «только чтение»: `projects.list` и `layout.get` отвечают.
- [x] Тот же test, тот же уровень: `layout.apply`, `terminal.open`, `agent.start`, `agent.permission`,
      `projects.add`, `autopilot.start` отклонены с новым текстом. Handler не вызван. Layout
      (расположение Node-ов на Canvas) и список Project-ов машины Project-а прежние. Ни один процесс
      не запущен.
- [x] Тот же test: отказ есть в логе с именем канала и Machine; входа вызова в логе нет.
- [x] Тот же test: событие `layout.changed` приходит Linked machine-у с правом «только чтение».
      События, исключённые ответом на вопрос 2, не приходят.
- [x] Понижение «всё» → «только чтение» посреди работы: следующий вызов записи отклонён, `link.ping`
      отвечает.
- [x] Старый `link/settings.json` с `projectsAccess: true` читается как «всё», с `false` — как
      «выключен». Нечитаемый файл — «выключен».
- [x] Уровни «выключен» и «всё» ведут себя как до этого Ticket-а: test-ы Ticket-а 08 зелёные, в них
      меняется только форма значения.
- [x] Test-ы краснеют на мутантах (намеренно испорченных копиях кода): проверка уровня в адаптере
      убрана; канал записи помечен чтением.
- [x] Новый ADR принят. `docs/design/F-SPEC.md` и `.scratch/worfy-link/spec.md`, раздел «Доступ»,
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
- `src/renderer/settings/MachinesSection.tsx`, `src/renderer/settings/controls.tsx`,
  `src/renderer/machines/useMachines.ts` — переключатель на экране (Settings → Machines; его перенёс
  `worfy-ui` 05, PR #296, из `src/renderer/shell/sidebar/MachinesSection.tsx`).
- `test/unit/machines-section.test.tsx`, e2e spec Settings → Machines — снимки уровней.
- `.scratch/worfy-link/issues/25-*.md` — новый Ticket: скрытие действий записи (ответ 4).
- `test/unit/link-access.test.ts`, `test/contract/link-access.test.ts`, `test/contract/ipc.test.ts`.
- `src/shared/ipc/linked.ts` — `readOnly` в состоянии Linked machine-ов (экран узнаёт уровень).
- Test-ы, где меняется только форма значения (`setAccess(true)` → уровень `all`, файл версии 2, пометка
  `read`/`write` у test-каналов): `test/contract/{remote-calls,link-connections,projects,app-settings,ipc-renderer}.test.ts(x)`,
  `test/contract/ipc-sample/shared/sample.ts`, `test/unit/{link-power,link-notify,use-projects,add-project-machine,markdown}.test.ts(x)`,
  `test/e2e/helpers.ts` (`setProjectsAccess` даёт Full access связанным Machine-ам), `test/e2e/linked-machines.spec.ts`.
- `docs/adr/` — новый ADR; `docs/design/F-SPEC.md`; `.scratch/worfy-link/spec.md`.

## Итог

**Сделано (PR #399, ветка `worfy-link/18`).** Уровень доступа у каждой Linked machine (Off / Read only /
Full access), пометка `read`/`write` у каждого канала `project`, отказ записи при Read only, ADR-0066,
Ticket 25 (скрытие действий записи), F-SPEC «Settings → Machines», spec.md «Доступ».

Как устроено:
- `link/settings.json` версии 2: `{version: 2, projectsAccess, machines: {<id>: "read"|"all"}, keepAwake}`.
  `projectsAccess` — общий переключатель («выключить всем», ответ 1), он остался boolean; уровень Machine
  без записи — Off. `LinkSettings.levelOf(id)` = Off, пока переключатель выключен. Новая связь и повторное
  связывание той же Machine — Off (`commitLink`); отзыв стирает уровень (`forget`).
- Файл версии 1: `true` — Full access каждой Machine, связанной в момент чтения, `false` — никому;
  файл сразу переписывается версией 2 (иначе Machine, связанная позже, при следующем запуске получила бы
  Full access). Нечитаемый файл — выключено. Test-ы — `test/contract/link-connections.test.ts`,
  describe «the access level of each Linked machine».
- Пометка: `invokeChannel`/`eventChannel` с перегрузками — для `'project'` пятый (четвёртый у событий)
  аргумент `ChannelUse` обязателен, у других пометок его нет. Канал, объявленный дважды с разными
  пометками `read`/`write`, закрыт, как при двух пометках доступа.
- Отказ: `LinkIpcAdapter.call`, после «access is off» и «not open»: «Linked machines can only view the
  Projects of <Machine>: access is read-only», до разбора входа zod, handler не вызывается; лог —
  `"<канал>" from Machine <id> (<имя>) refused: access is read-only`.
- `LinkPeer.setAccess(level)`: Off — клиента нет; смена Read only ↔ Full access — старый клиент уничтожен,
  создан новый. Клиент Read only не пересылает события `write` (`terminal.output`).
- Сообщение `projects-access`: `{on, level}`. Сборка до Ticket-а 18 шлёт только `on` — читается как Full
  access / Off; старая сборка игнорирует `level` (схема `z.object` без strict). Уровень на стороне
  Linked machine-а — `readOnly` в `linked.state`; смена Read only ↔ Full access меняет `epoch`, экран
  загружает Machine заново.
- Новый канал `link.setMachineAccess` (`local`) задаёт уровень одной Machine; `link.setAccess` остался
  переключателем. В состоянии связи у каждой Linked machine — `access`.

Каналы (сверены handler-ы, scout-агент + чтение мест-исключений): `read` — 36 вызовов и 19 событий,
`write` — 47 вызовов и `terminal.output`; списки поимённо — `test/unit/link-access.test.ts`. На main сейчас
`project`: 83 вызова и 20 событий (в Ticket-е — 77 на `25efbbe`). Отличия от кандидатов Ticket-а:
- добавлены в `read`: `claudeHome.search`, `terminalAi.fix.state`, `terminalAi.request.state` (их не было
  в списке кандидатов; только читают и подписывают);
- `docs.open` оставлен `read`, хотя при первом открытии наблюдателя main синхронизирует Node HANDOFF с
  файлом (`syncHandoffNode`, `src/main/ipc/docs.ts`) — это запись main-а о собственном файле, как для
  своего активного Project-а, а не правка вызывающего. **Решено без владельца, подтвердить.**
- `layout.get` (однократный перевод старого layout), `actions.launches` (чистка закрытых в памяти),
  `autopilot.state` (кэш в памяти, читающий git), `cards.get` (наблюдатель Card) — `read` по той же
  причине. **Решено без владельца, подтвердить.**
- `projects.connect.accounts` и `projects.connect.check` — `write`: шаги «Add project», запускают `gh` и
  скрипт Harness, а «Add project» — запись целиком. **Решено без владельца, подтвердить.**
- `agent.attach` (копирует файлы), `projects.hold`, `terminal.takeSize`, `terminalAi.request.cancel`,
  `cardApi.askPrepare` — `write`.
- `terminalAi.fix.changed`, `terminalAi.request.changed` — `read`: в них только флаги `available`/`busy`,
  не текст Terminal.

Пункт 5 — остальные места, где читается доступ, при Read only:
- запрет сна (`keep-awake.ts`): держится, пока подключена Linked machine с Read only или Full access
  (test — `test/unit/link-power.test.ts`, «a Linked machine with read-only access counts…»);
- уведомления (`notes.ts`): уходят Read only и Full access, не Off (`test/unit/link-notify.test.ts`);
- handler `link.setAccess`: только переключатель; уровень — `link.setMachineAccess`, оба `local`
  (с Linked machine — «not open», test в contract `link-access`).

Красный test первым: порядок нарушен — инфраструктура пометок писалась раньше test-а. Красный показан на
мутанте «проверка уровня в адаптере убрана» (`if (false && sender.readOnly …)` в `ipc-adapter.ts`):
`refuses the write calls…` упал так — `layout.apply: expected { ok: true, value: { layout: … } } to deeply
equal { ok: false, error: 'Linked machines can only view the Projects of beta: access is read-only' }`, то
есть Linked machine с Read only изменила Layout машины Project-а. Всего 5 test-ов красные (contract
`link-access` и `remote-calls`).

Мутанты (копии в scratchpad, восстановление `cp` + `cmp`):
- проверка уровня в адаптере убрана — 5 красных (выше);
- `layout.apply` помечен `read` — 5 красных: unit «the read calls are exactly the ones named» и «the write
  calls…», contract «refuses the write calls…», «logs a refusal…», «a call that already runs…»;
- фильтр событий клиента Read only убран — красный «a read-only project client passes on read events only»;
- клиент не пересоздаётся при смене уровня — 3 красных (понижение посреди работы, `remote-calls` epoch).

Typecheck без признака (временная правка `layoutGet` → `'project')`), `tsc --noEmit -p tsconfig.node.json`,
EXIT=2:
`src/shared/ipc/layout.ts(16,98): error TS2345: Argument of type '"project"' is not assignable to parameter
of type '"link" | "desktop" | "local"'.`

Понижение посреди работы (contract): Terminal, открытый окном B и A, — после Read only A не получает
вывод, `terminal.input` от A — отказ, `link.ping` и `projects.list` отвечают. Terminal, открытый только с
Linked machine, при понижении закрывается — исключение ADR-0060, пункт 4 (у test-а сначала было так и
упало: `started: true` при повторном открытии; test переписан на Terminal, который держит окно B).

Снимки (Playwright `page.screenshot()` в e2e `linked-machines.spec.ts`, под замком `/tmp/worfy-e2e.lock`,
`WORFY_EVIDENCE=1`), каждый просмотрен:
- [18-settings-machines-read-only-light](../evidence/18-settings-machines-read-only-light.png),
  [dark](../evidence/18-settings-machines-read-only-dark.png): Settings → Machines на B; переключатель
  включён; строка Linked machine (имя «Alexeys-MacBook-Pro (dev)» — обе копии на одном Mac) с Select
  «Read only» справа, под именем три строки подсказки, включая «Read only still means trust: a Session
  transcript can show a secret»; ниже keep-awake. Текст читается в обеих темах, Select выровнен по правому
  краю, как переключатели; в тёмной теме акцент — зелёный.
- [18-settings-machines-full-access-light](../evidence/18-settings-machines-full-access-light.png),
  [dark](../evidence/18-settings-machines-full-access-dark.png): та же строка с «Full access», подсказка
  в одну строку «Works with your Projects as you do: Sessions, Terminal, Autopilot».
Вид неактивной строки (переключатель выключен) проверен в unit и e2e (`data-disabled`, `disabled`,
tooltip), снимком не снят.

Решено без владельца, подтвердить:
- Подписи уровней в UI — «Off», «Read only», «Full access»; подсказки — как в F-SPEC.
- Уровень хранится в `link/settings.json`, а не в записи Linked machine (`linked.json`).
- Повторное связывание той же Machine сбрасывает её уровень в Off.
- Файл версии 1 с `false` не даёт уровней никому: после включения переключателя каждой Machine уровень
  выбирают заново.
- `link.setAccess` не несёт три значения (как предполагал пункт 1 «Что делаем»): с ответом 1 он остался
  переключателем «выключить всем», уровень Machine — отдельный канал `link.setMachineAccess`.
- В «Готово, когда» нет проверки событий `agent.event` и уведомлений при Read only через стенд двух Machine:
  уведомления проверены в `link-notify`, `agent.event` — unit-проверкой клиента (`LinkSender`).

Проверки: `pnpm lint && pnpm typecheck && pnpm test` — EXIT=0 (264 файла, 5570 test-ов); e2e
`linked-machines.spec.ts` — 9 passed; e2e `linked-sleep`, `linked-notify`, `linked-add-project`,
`linked-cards`, `linked-system-actions`, `linked-autopilot` (пользуются `setProjectsAccess`) — 10 passed.
`GATE_SCOPE=all gate full` — не проверено: шаг оркестратора перед merge.

**Ревью и merge** (PR #399, VERIFIED в первом круге, depth low). Verifier сверил все 36 вызовов `read` с handler-ами; обхода проверки уровня нет.
- Noted: служебная запись Layout у `docs.open` и `layout.get` при пометке `read` — решено без владельца, подтвердить (выше).
- Не проверено: принимает ли сборка до этого Ticket-а новое поле `level` в сообщении `projects-access`.
- Merge: первый gate full красный только на двух timeout `test/contract/workflow-reader.test.ts` (flaky под нагрузкой, `worfy-polish` 30; файл отдельно — 45/45), второй зелёный; `01479c7d`.
