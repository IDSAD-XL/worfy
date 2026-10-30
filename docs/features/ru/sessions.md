# Sessions

> Перевод [английской версии](../sessions.md), commit `same-pr`.

Два Feature. **Session** — один разговор с Claude Code. **Subagent** — агент, которого запустила Session. Transcript, Claude home, Memory и
Limits описаны на странице [Transcripts and usage](transcripts-and-usage.md). Термины объяснены в [Concepts](concepts.md).

## Session

### Behaviour

worfy сам ведёт Session и показывает те, что запущены в других местах. У каждой Session один Node на Canvas.

| Node | Как появляется | Что может пользователь |
| ---- | -------------- | ---------------------- |
| Orchestrator | Создаётся закреплённым, один на Project | Всё описанное ниже и «New conversation». Его можно двигать, но нельзя убрать |
| Live Session Node, 340 на 220 пикселей | «New session» или Resume | Отправлять сообщения из Node или Session view |
| Read-only Session Node, 300 на 120 пикселей | Session, запущенная в терминале или Claude desktop | Читать её transcript, сделать Resume, когда она закончится |

Session, которую ведёт worfy, принадлежит приложению, а не окну. Её события идут во все окна, закрытие окна её не останавливает, и она
останавливается, когда worfy завершается.

**Состояния.** Session находится в одном из шести состояний, показанных chip-ом.

| Состояние | Статус chip-а | Значение |
| --------- | ------------- | -------- |
| `starting` | working | Процесс запущен. Становится `idle`, когда Claude Code отвечает об аккаунте |
| `idle` | ready | Ждёт сообщение |
| `busy` | working | Идёт turn |
| `needs_permission` | blocked | Turn ждёт ответа на запрос разрешения |
| `error` | blocked | Процесс умер или упал. Tooltip показывает конец его stderr |
| `closed` | done | Session закрыта |

Текст chip-а — имя состояния: `needs_permission` читается как «needs permission».

**Отправка.** Return отправляет, Shift+Return начинает новую строку. ↑ и ↓ в пустом поле ходят по истории отправленных сообщений. Поле
растёт до 200 пикселей. Пустое сообщение без вложений отклоняется. Неудачная отправка возвращает в поле текст и chip-ы вложений. «/»
открывает меню slash-команд и skills, о которых Claude Code сообщает для этой Session.

**Очередь.** Сообщение, отправленное во время turn, ждёт в очереди в main. Подсказка рядом с кнопкой отправки в это время говорит «Return to queue».
Сообщения идут по одному на turn, каждое после `result` предыдущего turn. Chip «N queued» открывает список, где × убирает сообщение. Interrupt
или crash придерживают очередь: заголовок списка меняется на «Held after Interrupt», и ничего не уходит до «Send queued». Пустая очередь никогда не
придерживается. Очередь не переживает свою Session. Исключение — Orchestrator: его очередь переходит в новый процесс, когда Autopilot его возвращает.

**Interrupt.** Кнопка в Session view или Esc в её поле ввода работает в `busy` и `needs_permission`. Interrupt придерживает очередь, отменяет
открытые запросы разрешений и вопросы и просит Claude Code остановить turn.

**Crash.** Session переходит в `error`. Очередь придерживается, открытые запросы отменяются, а о фоновых задачах забывают. Следующее
сообщение запускает новый процесс, который продолжает тот же разговор.

**Закрытие.** Пользователь не может закрыть Session в `busy`: «The Session is in a turn: Interrupt it before closing». Закрытие Session у live Session Node
оставляет сам Node, и он предлагает Resume. Сообщение, отправленное такому Node, сначала делает Resume; так же работает брошенный на него
файл.

**Resume.** Продолжается только законченная Session, потому что два процесса не должны писать один transcript. Она продолжается в папке,
записанной в transcript-е, а если такой нет — в корне Project. У отказов такие подписи:

| Причина | Подпись |
| ------- | ------- |
| worfy ведёт её сейчас | Already open in worfy |
| Живой процесс в терминале | Still running in terminal |
| Живой процесс в Claude desktop | Still running in Claude desktop |
| Transcript не найден | No transcript of this Session |
| Её папки больше нет | Folder no longer exists |

Read-only Node становится live на месте, сохраняя id и позицию, и вырастает до минимального размера live. Архивный Node сначала возвращается
на Canvas. Закреплённому Node отказывают. Если Node нет, появляется новый.

**Sidebar и история.** Раздел Sessions в sidebar показывает live Session Project-а, «New session» и историю. Popover истории показывает до 100
прошлых Session, новые сверху, у каждой Show, Resume и источник: worfy, desktop или terminal. Show ставит read-only Node на Canvas или
переходит к Node, который у Session уже есть. Заголовок — последний custom title, затем AI title, затем первый prompt.

**Model, effort и permission mode.** Три picker-а стоят под полем ввода, а шапка показывает текущие значения.

- Model: строки приходят от Claude Code. Haiku не предлагается. Сохранённый Haiku откатывается к модели и effort по умолчанию. «Default»
  означает `model` и `effortLevel` из `settings.json` пользователя, которые читаются при каждом старте процесса. Когда собственная модель
  пользователя — Haiku, Session просит Sonnet. Выбранная модель сразу видна в шапке.
- Effort: low, medium, high, xhigh, max, насколько их поддерживает модель. Slider отправляет выбор через 600 ms покоя или при закрытии
  popover.
- Permission mode: Bypass permissions (по умолчанию), Accept edits, Ask before tools, Plan only.

Выбор сохраняется для каждого Node. Повреждённое сохранённое поле откатывается к значению по умолчанию.

**Разрешения.** Вне Bypass permissions Claude Code спрашивает перед tool, и в transcript-е появляется карточка.

- Allow: только этот вызов.
- Always allow: этот tool до конца этой Session. Заодно закрывает другие открытые запросы к тому же tool. Переживает crash процесса, но не
  перезапуск worfy и не Resume. worfy никогда не пишет правило в настройки пользователя.
- Deny: отклоняет этот вызов.

Запрос отменяется по Interrupt, при закрытии Session, при crash и когда его прерывает сам Claude Code. Карточка показывает Allowed, Always
allowed in this Session, Denied или Cancelled.

**Вопросы.** AskUserQuestion из Claude Code становится карточкой вопроса в любом permission mode. Она показывает по одному вопросу, с Back и
Next. Варианты — кнопки с описаниями или переключатели, когда можно выбрать несколько. «Other» принимает слова пользователя. 1–4 выбирают
вариант, Enter идёт дальше. «Submit» работает, когда на все вопросы есть ответ. «Decline» отклоняет вызов. «Always allow» у карточки нет.

**Вложения.** «+», drop в любое место чата и вставленное изображение добавляют chip. В сообщении до 20 вложений.

- Изображения: PNG, JPEG, GIF и WebP, до 3.75 MB каждое.
- Файлы, выбранные через «+» внутри Project, идут по пути, любого размера.
- Файлы, выбранные вне Project, и каждый брошенный файл копируются в папку данных Project, до 20 MB каждый.

**Session view.** Второй view окна, рядом с Canvas. В шапке заголовок («Orchestrator» или «Session» и Project), chip состояния, Session picker,
Model, Effort, Permissions, Cost, Hide tools и Interrupt. Cost показывает значение только для Orchestrator: `$0.00`, с четырьмя знаками ниже
доллара. У остальных Session — прочерк. View показывает Session, открытую последней в этом Project, пока её Node на Canvas, а иначе
Orchestrator. Память об этом выборе живёт столько же, сколько окно. Session picker показывает сначала Orchestrator, затем работающие Session,
затем остальные. Subagent-ов в нём нет.

**Context meter.** Кольцо под полем ввода. 100% — порог autocompact, и значение на нём останавливается. Если autocompact выключен или порог
неизвестен, показывается собственный процент Claude Code, который может превысить 100. Цвет меняется на 60% и 85%. До первого отчёта написано
«no data». Tooltip: `84.2K / 200K tokens · autocompact at 167K` или с окончанием `autocompact off`.

**Окно autocompact.** В Settings → Sessions две строки: Orchestrator, окно которого используют и его Subagent-ы, и Other Sessions. Каждая —
«Claude Code default» или Custom, от 100K до 1M с шагом 10K. Значения worfy по умолчанию — 400K и 500K. Окно, которое пользователь не выбирал,
уступает `autoCompactWindow` из `settings.json`. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` в login shell перекрывает обе строки, и раздел об этом
сообщает. Работающая Session сохраняет своё окно до следующего старта.

**Orchestrator.** Главная Session Project-а. Node показывает её состояние, модель, суммарную стоимость и последний status block её ответов.

- «New conversation» отклоняется в `busy` и пока работает Autopilot. Старый разговор остаётся в истории, а стоимость начинается с нуля.
- Когда Orchestrator открывается, его сохранённая Session продолжается. Если transcript пропал, стартует новая Session.
- Eco mode, переключатель под полем ввода Orchestrator, пишет `workflow.agents` в Profile Project-а. Действует со следующего Ticket-а.
- Autopilot ведёт эту Session без человека. См. [Autopilot](autopilot.md). В это время permission mode принудительно Bypass permissions и не
  сохраняется, смена режима отклоняется, а запросы разрешений и вопросы сразу отклоняются.

**Уведомления.** Системное уведомление уходит, когда Session заканчивает turn, просит разрешение или задаёт вопрос, а фокуса нет ни в одном окне
worfy. Session из терминала или Claude desktop уведомляет, когда её статус переходит из busy в idle. Одна Session шлёт не больше одного
уведомления за 10 секунд. Клик открывает эту Session.

#### On a Linked machine

- Session в Project, локальном для одной Machine, другой не видна. Linked machine запускает Claude Code и читает файлы по пути только внутри
  Project-ов Machine, к которой подключена.
- «+» там использует скрытый file input, и файл передаётся байтами.
- При read-only доступе поле ввода, picker-ы и ответы на карточках неактивны, а tooltip объясняет почему. Session view не открывает там
  Orchestrator: если его нет, показывается «No Orchestrator yet».
- Eco mode пишет «Eco mode is set in worfy on the Machine of the Project».
- Уведомление идёт и подключённым Linked machine. Каждая Machine применяет своё правило фокуса и свои 10 секунд.

#### Windows

- Claude Code — это `claude.exe`. Его окружение строится из переменных сессии Windows и registry, потому что login shell в Windows нет. Для tool
  Bash передаётся Git Bash.
- Подсказки клавиш пишут Enter и Shift+Enter. Подсказка рядом с кнопкой отправки всё равно говорит Return.

### How it works

- **Одна Session — один долгий SDK query.** Его вход — асинхронная очередь, поэтому сообщение работающей Session не запускает новый процесс.
  Interrupt и смена модели тоже идут в работающий query.
- **worfy — это view.** Session работает с настройками, `CLAUDE.md` и hook-ами самого пользователя, а своё состояние worfy хранит только в своей
  папке данных ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Id приходит поздно.** Новая Session передаёт Claude Code свой uuid. Продолженная держит временный id `pending-` до `system/init`, а затем
  событие `renamed` переносит всё на настоящий id. Каналы принимают оба.
- **Node Orchestrator-а хранит только id Session и стоимость.** Всё остальное приходит из transcript-а и live-событий
  ([ADR-0010](../../adr/0010-orchestrator-state-session-id-and-cost-only.md)).
- **Tools и skills ограничены Profile.** Session в Project получает только MCP-серверы из списка её Profile, а если списка нет — список по умолчанию. Список идёт
  в Claude Code как policy tier, поэтому Subagent получает тот же набор ([ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md)). `worfy-canvas`
  передаётся, только когда список его называет, а `worfy-browser` — когда список называет его или `worfy-canvas`. Plugins и skills следуют той же идее через flag settings, чтобы сэкономить токены их описаний
  ([ADR-0084](../../adr/0084-session-skills-and-plugins-by-profile-list.md)).
- **Harness идёт inline**, если на машине нет старого Harness ([ADR-0040](../../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0049](../../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)).
- **Процесс дожидаются.** Два процесса не должны продолжать один разговор, поэтому перезапуск начинается только после выхода старого процесса
  ([ADR-0064](../../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)). worfy ждёт 7.5 секунды после закрытия, шлёт SIGKILL и ждёт ещё
  2 секунды. Прерванному turn даётся 15 секунд, прежде чем Stop в Autopilot закроет процесс.
- **Session без человека некого спросить.** Отсюда принудительный режим и отклонённые диалоги
  ([ADR-0022](../../adr/0022-unattended-session-refuses-permission-mode-change.md)). Перевод в режим без человека отклоняется во время turn, при живых
  фоновых задачах и при сообщениях в очереди, потому что перезапуск их потеряет ([ADR-0024](../../adr/0024-autopilot-wave-end-and-keep-awake.md),
  [ADR-0029](../../adr/0029-autopilot-waits-for-background-tasks.md)). Возврат Session ждёт конца turn и задач, плюс 30 секунд после последней задачи
  на её turn с уведомлением. Stop в Autopilot не ждёт ([ADR-0050](../../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)).
- **Путь к бинарнику в пакете** задан явно, потому что изнутри `app.asar` ничего запустить нельзя
  ([ADR-0008](../../adr/0008-claude-code-native-binary-path.md)).

#### Windows

Окружение собирается заново так, как его собирает новый вход в систему, поэтому ничего от того, кто запустил worfy, до Claude Code не доходит.
`bash.exe` из Path может оказаться launcher-ом WSL, поэтому Git Bash ищется и передаётся в `CLAUDE_CODE_GIT_BASH_PATH`
([ADR-0057](../../adr/0057-agent-environment-on-windows.md)). Событие `exit` у Node в Windows может прийти на секунды позже, поэтому ожидание
процесса ещё и спрашивает систему.

### Implementation

| Что | Где |
| --- | --- |
| Одна Session: состояния, отправка, Interrupt, crash | `src/main/agent/session.ts`, `src/main/agent/session/` |
| Registry живых Session, test-агент | `src/main/agent/session/registry.ts`, `src/main/agent/app-registry.ts`, `src/main/agent/fake-query.ts` |
| Опции query, списки MCP и skills, autocompact | `src/main/agent/options.ts` |
| Окружение процесса | `src/main/agent/env.ts` |
| Очередь, разрешения, сохранённые настройки | `src/main/agent/queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/session-settings.ts` |
| Правила Resume и закрытия | `src/main/agent/resume.ts` |
| Live Session Node, Orchestrator | `src/main/agent/node-sessions.ts`, `src/main/agent/orchestrator.ts` |
| Вложения | `src/main/agent/attachments.ts`, `src/shared/agent/attachments.ts` |
| События, настройки и каналы | `src/shared/agent/events.ts`, `src/shared/agent/settings.ts`, `src/shared/ipc/agent.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/orchestrator.ts` |
| Handler-ы | `src/main/ipc/agent.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/orchestrator.ts`, `src/main/ipc/session-autocompact.ts` |
| Session view | `src/renderer/session/SessionView.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/navigation.ts` |
| Store в renderer, соединение прошлых и live-событий | `src/renderer/session/store.ts` |
| Карточки | `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/QuestionCard.tsx` |
| Элементы под полем ввода, находятся через glob | `src/renderer/session/composer/` |
| Node | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Настройки autocompact | `src/renderer/settings/SessionsSection.tsx`, `src/shared/settings/app-settings.ts` |
| Уведомления | `src/main/notify.ts`, `src/renderer/session/notification-target.ts` |

**Поток данных.** Окно вызывает `agent.send`. Handler сообщает input observer-ам, проверяет вложения и передаёт сообщение Session, сохраняя порядок
сообщений одной Session. Session кладёт его во вход query, а во время turn — в очередь. Каждое сообщение SDK становится `AgentEvent` в общей схеме, в
которую разбираются и файлы transcript-ов. События идут всем клиентам по `agent.event`, а store в renderer хранит 5000 последних для каждой Session.
События `queue`, `settings` и `context` не строки transcript-а: store хранит только последнее из каждого вида.

**Главные test-ы.**

- `test/contract/agent-session.test.ts`, `test/contract/agent-controls.test.ts`, `test/contract/agent-attachments.test.ts`: Session поверх fake-агента.
- `test/contract/orchestrator.test.ts`, `test/contract/orchestrator-relaunch.test.ts`, `test/contract/node-sessions.test.ts`,
  `test/contract/permissions.test.ts`.
- `test/unit/agent-queue.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/resume-rule.test.ts`, `test/unit/session-process-exit.test.ts`.
- `test/e2e/session-view.spec.ts`, `test/e2e/session-controls.spec.ts`, `test/e2e/permissions.spec.ts`, `test/e2e/session-question.spec.ts`,
  `test/e2e/session-resume.spec.ts`, `test/e2e/own-sessions.spec.ts`, `test/e2e/orchestrator.spec.ts`, `test/e2e/chat-attachments.spec.ts`,
  `test/e2e/context-meter.spec.ts`.

## Subagent

### Behaviour

Subagent — агент, которого Session запустила tool-ом Agent, или один агент workflow-скрипта. worfy находит их у любой Session, где бы она ни была
запущена, и показывает в двух местах.

**На Canvas.** Каждый Subagent — Node размером 260 на 84 пикселя справа от родителя, а запущенные им Subagent-ы — справа от него. Node показывает имя,
тип, модель, статус со временем работы и первую строку финального ответа. VERIFIED или REJECTED от reviewer-а показывается как chip. Завершённые и
прерванные Subagent-ы родителя сворачиваются в одну строку «N done» под работающими. Клик открывает строку, и этот выбор не сохраняется. Эти Node не
сохраняются в Layout и руками не двигаются. Они двигаются вместе с Node своей Session. Node Subagent-а, перетащенный на Ticket или рамку Epic-а,
создаёт Binding и возвращается на своё место.

**В Session view.** Rail показывает их от новых к старым, с группой «Done (N)», к которой добавляется « · N interrupted». Открытость группы хранится для
каждой Session в памяти окна. Если их нет, блок пишет «No Subagents yet». Клик открывает transcript Subagent-а только для чтения.

**Статус.**

| Статус | Когда |
| ------ | ----- |
| `running` | Конец неизвестен, и Session работает |
| `done` | Task-notification или журнал workflow сообщает о завершении, синхронный вызов вернулся или последний ответ в файле закончил turn |
| `error` | Неудачный конец или вызов, остановка пользователем или обрыв, когда закончился процесс Session или её workflow run |
| `interrupted` | Конец неизвестен, и работающий процесс Session стартовал после его последней записи |

Пока его Session работает, Subagent без конца остаётся `running`, как бы долго его файл ни стоял без изменений. Tooltip у `interrupted` говорит, что процесс
перезапустился после последней записи агента: «it was stopped from outside, not by a failure». Время работы выглядит как `45s`, `6m 05s`, `1h 02m`.

**Workflow-скрипты.** Run workflow-скрипта — запись типа `workflow`, названная по скрипту, с его агентами внутри. Run, продолженный под тем же id,
показывается один раз, по последнему вызову.

**Hide.** «Hide» на записи скрывает её при любом статусе. Её дети занимают её место. «Hide finished» скрывает всё, что закончилось, а «Show hidden
Subagents (N)» возвращает записи Session. Rail пишет «Every Subagent is hidden», когда ничего не осталось. Скрытые записи переживают перезапуск, до 20 000
последних на Session.

#### On a Linked machine

Ответ должен помещаться в одно сообщение link. Когда не помещается, тексты результатов и ответов обрезаются сначала до 1000 символов, затем до 200, затем
до строки summary, и ответ сообщает, что он обрезан. При read-only доступе Hide не показывается.

### How it works

- **Несколько источников, одно дерево.** В событиях Session и файлах её папки `subagents/` может не быть того, что есть в другом источнике. Поэтому одна
  запись собирает оба, связывая их по id агента или id вызова tool. Фоновая задача Bash тоже шлёт уведомления, поэтому остаются только записи с вызовом
  Agent, файлами или типом Subagent.
- **Закрытая Session заканчивает свои Subagent-ы.** Её процесса нет, значит Subagent без конца был оборван
  ([ADR-0031](../../adr/0031-closed-session-ends-its-subagents.md)).
- **`interrupted` отличает перезапуск от сбоя.** Время старта работающего процесса сравнивается с последней записью Subagent-а
  ([ADR-0085](../../adr/0085-interrupted-subagents.md)). Когда нельзя сказать, работает ли процесс, Session закрытой не считается.
- **Агенты workflow** берут подпись и конец из `journal.jsonl` своего run ([ADR-0035](../../adr/0035-workflow-script-subagents-in-tree.md)).

### Implementation

| Что | Где |
| --- | --- |
| Сигналы и дерево (чистый код) | `src/shared/transcript/subagents.ts` |
| Чтение файлов, инкрементально | `src/main/claude-home/subagents.ts` |
| Скрытые записи, `hidden-subagents.json` в папке данных Project | `src/main/claude-home/hidden-subagents.ts` |
| Ответ для Linked machine | `src/main/ipc/claude-home.ts` |
| Состояние в renderer, свёртка, подписи | `src/renderer/claude-home/subagents.ts` |
| Rail | `src/renderer/session/rail/SubagentsRail.tsx` |
| Canvas | `src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/nodes/SubagentNode.tsx` |

**Поток данных.** Renderer спрашивает `claudeHome.subagents` каждые 2 секунды, пока работает Subagent. `SubagentReader` читает только то, что добавилось в
каждый файл с прошлого вызова, добавляет `session-closed`, когда процесса Session нет, а `buildSubagentTree` строит дерево.

**Главные test-ы.** `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`, `test/contract/claude-home-subagents-link.test.ts`,
`test/unit/subagent-trees.test.tsx`, `test/unit/subagent-nodes.test.tsx`, `test/e2e/subagent-tree.spec.ts`.
