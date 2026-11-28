# Scheduled tasks, которые пользователь описывает в чате Assistant-а

- **Дата:** 2026-11-28
- **Статус:** исследование, не решение. Ticket-ов не заводит. Spec и Epic — дело Product Session.
- **Вопрос владельца (2026-11-28).** «ресерч scheduled задач с возможностью описать её в чате, ассистент предлагает,
  пользователь принимает либо просит что-то поменять, далее должна быть возможность поменять уже принятые подобные
  задачи».
- **Ответ коротко.**
  - **Так уже делают все крупные продукты.** Создание словами в чате есть у Claude (Code `/schedule`, Desktop, Cowork),
    ChatGPT, Gemini, Cursor, GitHub Copilot и Devin (раздел 1). Карточку с полями, которую пользователь принимает
    кнопкой, документируют Cowork («Review the task name, schedule, and instructions Claude proposes, then click
    "Schedule."») и Devin («Generate with Devin» → проверить → Create automation). ChatGPT и Gemini просто подтверждают
    задачу ответом в чате.
  - **Править принятую задачу везде можно двумя путями: словами в чате и в списке «Scheduled».** В списке — Run now,
    Pause/Resume, Edit, Delete и история. Claude Code Desktop не даёт Claude удалить задачу: «To delete a task, use the
    **Delete** button».
  - **Локальные задачи у всех живут только пока приложение открыто и машина не спит.** Claude Code Desktop: «If your
    computer sleeps through a scheduled time, the run is skipped», потом один catch-up run. Задачи, которые идут при
    закрытом ноутбуке, у всех облачные.
  - **У worfy уже есть почти все части.** Планировщик с work hours, jitter, догоном после сна и метками в файле
    (`CheckScheduler`). Карточки предложений Assistant-а, которые принимает пользователь (`ProposalBook`). Окно Prepare с
    точным текстом Session. Проверка Limits перед автоматическим вызовом (порог 80 %). Approval policy для Session без
    человека (ADR-0098). Нет самой сущности scheduled task, календарного правила повтора и списка задач (раздел 2).
  - **Главное препятствие — не код, а правила.** Граница 3 ADR-0114 требует щелчка пользователя перед каждой Session с
    текстом Assistant-а. ADR-0100 и roadmap запрещают Epic-и, которые worfy ставит в очередь сам. Scheduled task
    стартует без щелчка, поэтому нужно решение владельца: считать ли принятие карточки этим щелчком (раздел 4).
  - **Рекомендация:** локальный планировщик в main на основе `CheckScheduler`, правило повтора — подмножество RRULE
    с часовым поясом, одна карточка предложения, список «Scheduled» в разделе Assistant-а, правка из чата — только
    через карточку «до → после» (раздел 3.8).
- **Как проверено.** Документация вендоров прочитана 2026-11-28 через WebFetch. Страницы Claude Code
  (`desktop-scheduled-tasks`, `routines`), статьи Cowork и ChatGPT Tasks и страницы Microsoft и Electron я читал сам;
  фразы в кавычках сверены с полным текстом страницы. Страницы Codex, Gemini, Cursor, GitHub, Devin и Microsoft 365
  Copilot читал отдельный агент. WebFetch пересказывает страницу малой моделью, поэтому кавычки в этих строках могут
  расходиться с оригиналом в словах; числа стоит перепроверить по ссылке перед spec-ом. Код worfy — `origin/main`
  `c66e7215a`, каждая строка `file:line` перечитана. Приложение не запускалось. Платных вызовов и входов в аккаунты не
  было. Прежнее исследование темы proactive-runtime
  ([research-anthropic-модели-цена-и-правила.md](../product/proactive-runtime/research-anthropic-модели-цена-и-правила.md),
  раздел 4; [research-проактивные-агенты-у-конкурентов.md](../product/proactive-runtime/research-проактивные-агенты-у-конкурентов.md))
  здесь не повторяется, только дополняется.

## 1. Как это сделано у других (первоисточники)

### 1.1 Сводная таблица

| Продукт | Создание словами | Подтверждение | Правка после | Правило повтора | Где идёт; сон машины | Лимиты |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code, cloud scheduled tasks (раньше routines) [cc-routines] | `/schedule daily PR review at 9am`; на web — «Create with Claude» | диалог: «Claude asks follow-up questions about the schedule, repositories, and prompt before saving»; для разового — «confirms the absolute timestamp before saving» | web: on/off, Edit, Run now, Delete; CLI: `/schedule list`, `/schedule update`, `/schedule run` | пресеты hourly/daily/weekly; Custom — cron, 5 полей в UTC, или с `CRON_TZ=`; минимум 1 час | облако Anthropic, свежий clone; ноутбук может быть закрыт | 100 scheduled runs в час на аккаунт; расход — из subscription, как у интерактивной Session |
| Claude Code Desktop, local scheduled tasks [cc-desktop] | «set up a daily code review that runs every morning at 9am» в любой Session | форма Create (Name, instructions, folder, preset, permission mode, model) | страница Scheduled: Run now, Active/Paused, Edit, History, Always allowed, Delete. Claude: list, create, edit, pause — но не delete | Hourly, Daily, Weekdays, Weekly, Manual, Custom (cron в local time); форма — не чаще раза в час, Claude — до 1 минуты | своя машина; «only run while the desktop app is running and your computer is awake» | не документированы |
| Claude Code `/loop` и Cron tools [cc-loop] | `/loop 5m check the deploy`, «remind me at 3pm» | Claude «confirms the cadence and job ID» | `CronList`, `CronDelete`, просьба словами | cron, local time; self-paced режим без интервала | только пока Session открыта и простаивает; пропуски не догоняются | 50 задач на Session; повторяющаяся задача сама удаляется через 30 дней |
| Claude Cowork [cowork] | «Describe the task and how often it should run» в любом разговоре | Claude показывает «proposed name, schedule, and instructions», пользователь нажимает **Schedule** | sidebar Scheduled: Edit (instructions, cadence, approval mode), Pause/Resume/Delete, Run on demand | hourly, daily, weekly, weekdays, manually | облако, «run on their cadence even when your computer is asleep»; с выбранной папкой — только пока компьютер не спит и Desktop открыт | не документированы |
| ChatGPT Tasks [chatgpt-tasks] | «Let me know when my package is delivered» | «ChatGPT confirms it in the conversation» | заголовок задачи в чате → task panel: edit, pause, delete; страница Scheduled | Free — не чаще раза в день; платные — раз в час и точное время | сервер OpenAI | активных задач: 3 (Free, Go), 5 (Plus), 10 (Business, Edu), 15 (Pro, Enterprise) |
| OpenAI Codex / ChatGPT scheduled tasks [codex-sched] | «create and update scheduled tasks from a ChatGPT or Codex chat» | не описано | страница Scheduled — «inbox» с пометкой непрочитанного | Desktop: custom schedule и RRULE | Desktop с локальными файлами: «Keep the computer on and the app running»; web — без компьютера | не документированы |
| Google Gemini [gemini-actions], [gemini-tasks] | промпт с «когда и как часто»; tasks — в треде или Live | краткое описание расписания в ответе | в чате (правка действует на будущие запуски) или Scheduled: Save, Pause/Resume, Delete | словами; tasks: once, hourly, daily, weekly, monthly, yearly; пояс фиксируется по месту создания | облако, «keep working even if your device is turned off» | scheduled actions — 10 активных; tasks — 50 (Pro, Ultra), не больше 15 одновременно |
| Cursor Automations [cursor-auto] | `/automate`: «describe the workflow you want in plain language» | не описано | admins: on/off, delete («Deleting an automation is permanent») | пресеты или cron; «will not start before the indicated time» | облако, cloud agent | не документированы; оплата по API pricing |
| GitHub Copilot cloud agent automations [gh-copilot-auto] | «Create with agent» | ручная форма с полями | edit, disable/re-enable, delete, revision history, Run now | hourly, daily, weekly | облако, один repo | от 30 AI credits на run |
| GitHub Actions `on: schedule` [gh-actions] | — | — | правка YAML | POSIX cron, UTC или `timezone:`; минимум раз в 5 минут | облако; в public repo выключается через 60 дней без активности | задержки «during periods of high loads» |
| Devin Automations [devin-auto] | «Generate with Devin»; Devin Bot в чате; «Schedule Devin» из Session | сгенерированная конфигурация «for you to review», кнопка Create automation | переключатель вкл/выкл с сохранением конфигурации | пресеты, «каждые N», сырой RRULE `FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0`; пояс на каждое расписание | облако | по умолчанию 50 runs в час; spend limit на Session |

### 1.2 Что важно из подробностей

- **Карточка с полями до сохранения.** Cowork показывает имя, расписание и инструкции и ждёт **Schedule** [cowork].
  Devin даёт проверить сгенерированную конфигурацию [devin-auto]. `/schedule` вместо карточки задаёт уточняющие вопросы
  и подтверждает абсолютное время разовой задачи [cc-routines]. Ни один вендор не документирует, какие поля карточки
  можно править прямо в ней до принятия.
- **Prompt задачи должен быть самодостаточным.** Cloud scheduled task: prompt «must be self-contained and explicit about
  what to do and what success looks like» [cc-routines]. Для worfy это довод показывать в карточке точный текст будущей
  Session, как уже делает окно Prepare.
- **Пропуски после сна.** Claude Code Desktop при старте приложения и при пробуждении смотрит пропуски за 7 дней и
  запускает «exactly one catch-up run for the most recently missed time and discards anything older»; «Desktop shows a
  notification when a catch-up run starts» [cc-desktop]. Документация сама предупреждает: задача на 9:00 может пойти в
  23:00 — и советует писать ограничение прямо в prompt. `/loop` пропуски не догоняет [cc-loop]. Copilot CLI отправляет
  пропущенный prompt «as soon as you reopen the session» [gh-copilot-cli].
- **Удаление словами.** Claude Code Desktop разрешает Claude list, create, edit, pause, но удаление — только кнопкой
  [cc-desktop]. Задача может менять сама себя tool-ом `update_scheduled_task`, и каждый такой вызов пользователь
  одобряет [cc-desktop].
- **Права задачи без человека.** Cloud scheduled task идёт в auto mode: классификатор пропускает или блокирует действия;
  run останавливается и ждёт человека на ask rule и после повторных блокировок [cc-routines]. Local task Desktop берёт
  permission mode, заданный в задаче; советуют один раз нажать Run now и ответить «always allow» на запросы [cc-desktop].
  Codex: задачи «run unattended and use your default sandbox settings» [codex-sched].
- **Задача сама выключается.** ChatGPT: «A task may pause if it is inactive, requires additional action, or its
  associated chat is archived or deleted» [chatgpt-tasks]. Cloud scheduled task без GitHub-подключения пропускает
  runs до 72 часов, потом выключается [cc-routines]. GitHub Actions выключает расписание public repo через 60 дней без
  активности [gh-actions].
- **Jitter.** Claude Code Desktop сдвигает каждую задачу на «a small delay of a few minutes», детерминированно
  [cc-desktop]. `/loop` — до половины интервала, не больше 30 минут [cc-loop]. Cloud: запуск ровно в начале часа «can
  start several minutes late», советуют 9:07 [cc-routines].
- **Уведомления о результате.** ChatGPT: Push, Email или оба [chatgpt-tasks]. Codex: Scheduled как inbox с пометкой
  непрочитанного [codex-sched]. Devin: email Always / On failure / On success и канал Slack [devin-auto]. Cowork: push
  на телефон, когда задача кончилась или ждёт ответа [cowork-mobile]. Для cloud scheduled tasks Claude Code отдельного
  канала уведомлений на странице нет [cc-routines].
- **Формат правила повтора.** RRULE (RFC 5545) — у Codex Desktop и Devin [codex-sched], [devin-auto]. Cron — у Claude
  Code, Cursor, GitHub Actions [cc-routines], [cursor-auto], [gh-actions]. Только пресеты — у Copilot cloud agent и
  Cowork [gh-copilot-auto], [cowork]. Пояс у cron Claude Code cloud — UTC без `CRON_TZ=` [cc-routines]; у Desktop —
  local time [cc-desktop]; у Gemini tasks — по месту создания, при поездке не меняется [gemini-tasks].

### 1.3 Чем ОС помогает локальному приложению

- **macOS launchd.** «Unlike cron which skips job invocations when the computer is asleep, launchd will start the job
  the next time the computer wakes up. If multiple intervals transpire before the computer is woken, those events will
  be coalesced into one event upon wake from sleep» (`man launchd.plist`, ключ `StartCalendarInterval`, macOS этой
  машины). Будить Mac launchd не умеет. Будит `pmset schedule wake`, но «pmset must be run as root in order to modify
  any settings» (`man pmset`).
- **Windows Task Scheduler.** `WakeToRun`: «the Task Scheduler will wake the computer when it is time to run the task»
  [ms-wake]. `StartWhenAvailable`: задачу «can start … at any time after its scheduled time has passed», с задержкой по
  умолчанию 10 минут [ms-start].
- **Electron.** `powerMonitor` даёт события `suspend` и `resume` [el-power]. `app.setLoginItemSettings({ openAtLogin })`
  есть на macOS и Windows [el-app].

## 2. Что уже есть в worfy (код `origin/main` `c66e7215a`)

Сущности scheduled task в коде нет: `cron`, `rrule` и `schedule` в `package.json` не встречаются.

### 2.1 Assistant: предложения, которые принимает пользователь

- `src/main/assistant/proposals/book.ts:43` — `class ProposalBook`; хранилище — файл памяти Assistant-а
  (`memoryProposalStore`, `book.ts:104`; `appProposals`, `book.ts:115`).
- `src/shared/assistant/proposals.ts:32` — `assistantProposalSchema`. Поле `prepare` (`proposals.ts:38`) — это
  `preparedSessionSchema` (`proposals.ts:29`): `{ projectId, text }`, точный текст будущей Session. Поля расписания,
  Vendor-а и модели в схеме нет.
- `src/renderer/assistant/PrepareDialog.tsx:1` — окно Prepare: точный текст до старта, пользователь может его править,
  Session стартует только по Start. Старт — `startPrepared` (`src/renderer/assistant/useAssistant.ts:162`), IPC-канал
  `assistant.start` (`src/shared/ipc/assistant.ts:65`).
- Карточка «до → после» для настроек: `src/shared/assistant/settings-change.ts`; Apply делает
  `applySettingsChange` (`src/main/assistant/window/app.ts:96`). Это готовый образец карточки правки.
- Tools MCP-сервера `worfy-app`: `src/shared/assistant/app-tools.ts:57` и дальше; `proposal_create` (`:75`) принимает
  `title`, `why`, `item`, `prepare`, `change`; `action_run` (`:78`).
- Режимы действий обязанности: `self | pre-approved | ask | hand-over` (`src/shared/assistant/duties.ts:16`). Для `ask`
  сервер отвечает «propose it with proposal_create and let the user decide» (`src/main/mcp/app-server.ts:674`).
- Закрытый список действий — `['wake-orchestrator', 'continue-session']` (`src/shared/assistant/actions.ts:17`).

### 2.2 Правила, которые scheduled task задевает

- **Граница 3 ADR-0114:** «Session с текстом, который написал Assistant, стартует только по щелчку пользователя, и
  пользователь видит этот текст до старта» (`docs/adr/0114-assistant-app-session.md:77–78`).
- **ADR-0100 и roadmap.** Run Autopilot-а принимает готовый список Epic-ов «и не выбирает Epic-и сам»
  (`docs/adr/0100-run-epic-queue.md:44–46`). В «Не в направлении» roadmap: «Epic-и, которые worfy выбирает или ставит
  в очередь сам»; 2026-11-20 оттуда убран «советник по расписанию», и «ADR-0100 не меняется: очередь Epic-ов Run-а
  задаёт человек» (`docs/roadmap.md:438–443`).
- **Session без человека не стартует Autopilot.** `src/main/autopilot/chat-confirm.ts:316` бросает `UNATTENDED_MESSAGE`
  (`:76`: «No one is at this Session to confirm a start of Autopilot…»). Диалог старта ждёт человека 10 минут
  (`CONFIRM_WAIT_MS`, `:67`).
- **Approval policy unattended Session** — ADR-0098; в коде `unattendedCanUseTool`
  (`src/main/vendors/claude/session.ts:24`), флаг `unattended` у Session (`src/main/vendors/session.ts:117`).
- **Harness без человека:** вопрос пользователю и часть shell-команд отклоняются
  (`harness/hooks/rules/common.md:86`). Scheduled Session пишет prompt, которому это должно быть известно.

### 2.3 Планировщики и таймеры

- `src/main/assistant/schedule/scheduler.ts:156` — `CheckScheduler`, единственный планировщик проверок источников.
  Интервал, jitter ±10 % (`:44`), таймер не дольше часа и перепланирование, чтобы поймать смену часов и пояса (`:47`),
  таймаут run 10 минут (`:54`), backoff после 3 неудач подряд (`:59`), один run вида за раз. Пропущенное время (сон,
  закрытый worfy) даёт **один** run сразу, ему передаётся `since` (шапка файла, строки 10–13). `followPower`
  (`:414`) останавливает таймер на `suspend` и планирует заново на `resume`. Метки запусков — в файле папки данных.
  Ограничение: планировщик знает только интервалы (от 5 минут до суток,
  `src/shared/assistant/schedule/settings.ts:26`) и три вида проверок (`settings.ts:22`), не «в 9:00 по будням».
- Work hours: дни недели, до 4 окон, IANA-пояс (`src/shared/assistant/schedule/work-hours.ts:15`, `:24`, `:47`).
- Start window Autopilot-а: два часа по стенным часам, переход через полночь, учёт смены летнего времени
  (`src/shared/autopilot/run-mode.ts:1–20`, ADR-0093). Ночной Run Epic-а уже закрыт этим окном.
- Тик ядра внимания — раз в минуту (`src/main/assistant/core/install.ts:22`). В `src/main` 26 вызовов `setInterval`, у
  каждой периодической работы свой таймер.

### 2.4 Limits и расход

- `src/main/agent/limits-gate.ts:20` — `AUTOMATIC_SHARE_LIMIT = 0.8`; вид вызова `'automatic' | 'on-demand'` (`:23`).
- `src/shared/assistant/budget.ts:26` — `ASSISTANT_DAILY_WAKE_LIMIT = 20`; проверка перед пробуждением —
  `src/main/assistant/budget/wake-gate.ts`.
- Ожидание сброса Limits по стенным часам, Mac, проспавший сброс, продолжает при пробуждении —
  `src/main/autopilot/limits-wait.ts` (шапка), ADR-0097.

### 2.5 Сон, окно, автозапуск

- `src/main/index.ts:348–349`: `window-all-closed` → `if (process.platform !== 'darwin') app.quit()`. На Windows
  закрытое окно завершает worfy, и scheduled task не пойдёт. На macOS worfy живёт без окон.
- Keep-awake: `src/main/autopilot/power.ts` (на время Run), `src/main/link/keep-awake.ts:4`
  (`prevent-app-suspension`, пока подключены Linked machines). Будить машину worfy не умеет.
- Login item, tray и badge в `src` не найдены (искал `setLoginItemSettings|openAtLogin|new Tray|setBadge`).

### 2.6 Хранение и уведомления

- Настройки машины — `app-settings.json` (`src/main/settings/store.ts`) через `src/main/storage/json-file.ts`: zod,
  запись через временный файл и rename, нечитаемый файл переименовывается. Версий схемы нет; инвентарь — ADR-0005.
- Системные уведомления — `src/main/notify.ts`; свои уведомления Assistant-а — `src/main/assistant/window/notices.ts`
  (только срочное, только в work hours, только когда окно не в фокусе).
- Результаты Run-ов — Run History (ADR-0092) и Journal Autopilot-а (`src/main/autopilot/journal.ts`).

### 2.7 Harness

- `harness/skills/overnight-fix-loop/SKILL.md:3–4` — ночной прогон по модулям, «Manual invocation only … or `claude -p`;
  asks the user no questions», `disable-model-invocation: true`. Это пример prompt-а, который рассчитан на run без
  человека, и кандидат в первые scheduled tasks.

## 3. Варианты устройства для worfy

### 3.1 Где живёт планировщик

| Вариант | Плюсы | Минусы |
| --- | --- | --- |
| **А. Планировщик в main** (обобщить `CheckScheduler`) | Один код для Mac и Windows. Уже есть догон после сна, jitter, backoff, метки в файле, test-ы с ненастоящими часами. Session стартует тем же путём, что Session с Canvas: видна, её можно остановить | Задача идёт, только пока worfy открыт и машина не спит. На Windows закрытое окно завершает worfy (`index.ts:348`) |
| **Б. launchd / Task Scheduler** запускает worfy или helper | launchd догоняет пропуск при пробуждении (`man launchd.plist`); Windows `WakeToRun` будит машину [ms-wake] | Две платформенные реализации, установка и удаление agent-ов ОС, права. Будить Mac без root нельзя (`man pmset`). Запуск worfy «из ОС» спорит с единственным экземпляром (`requestSingleInstanceLock`, `index.ts:96`) |
| **В. Cloud scheduled tasks Claude Code** | Идёт при закрытом ноутбуке [cc-routines] | Свежий clone вместо worktree и Canvas; результат не на Canvas worfy; только Claude; research preview; нужен вход claude.ai; расход того же subscription [cc-routines]. Codex web задачи тоже не видят локальную папку [codex-sched] |

Рекомендация — **А**. Б — позже, как отдельная опция «будить машину» на Windows, если владелец попросит. В — не
дублировать: worfy может открыть страницу cloud scheduled tasks ссылкой.

### 3.2 Одна карточка предложения

Поля, которые нужны по прецедентам (Cowork, Devin, Desktop) и по worfy:

- **Название** и **что делать** — точный текст Session (как `prepare.text`), который пользователь видит и правит.
- **Где** — Project, папка или новый worktree; Vendor (Claude Code или Codex) и модель.
- **Когда** — правило повтора словами («по будням в 9:07») плюс **ближайшие три запуска** конкретными датами в поясе
  пользователя. Это то, что делает `/schedule` для разовой задачи: «confirms the absolute timestamp» [cc-routines].
- **Пределы** — максимальная длительность run-а; что делать, если Limits выше 80 %; сколько runs в день.
- **Права** — режим Auto-approval Session без человека (ADR-0098) и что задача не может (стартовать Autopilot,
  спросить пользователя).
- **Пропуск после сна** — догнать один раз в пределах N часов или пропустить.
- Кнопки: **Accept**, **Change** (ответ словами в чат; Assistant пишет новую версию карточки), правка полей прямо в
  карточке.

### 3.3 Правило повтора

| Формат | Плюсы | Минусы |
| --- | --- | --- |
| Только пресеты (hourly, daily, weekdays, weekly) | Просто показать и проверить; так у Cowork и Copilot [cowork], [gh-copilot-auto] | «Каждый второй вторник», «1-го числа» не выразить |
| cron | Знаком разработчикам; Claude Code, Cursor, GitHub [cc-routines], [cursor-auto], [gh-actions] | Нет конца (`COUNT`, `UNTIL`), пояс — отдельная договорённость (UTC у cloud, local у Desktop), читается плохо |
| Подмножество RRULE + IANA-пояс | Есть конец и разовая задача; пояс — часть правила; так у Codex Desktop и Devin [codex-sched], [devin-auto]; стандарт RFC 5545 [rfc5545] | Нужен свой разборщик подмножества или зависимость |

Рекомендация: хранить подмножество RRULE (`FREQ` = HOURLY/DAILY/WEEKLY/MONTHLY, `INTERVAL`, `BYDAY`, `BYMONTHDAY`,
`BYHOUR`, `BYMINUTE`, `COUNT`, `UNTIL`) и IANA-пояс; в UI — пресеты и фраза; модель переводит фразу в поля, main
проверяет поля zod-ом и сам считает ближайшие запуски. Модель не считает даты: их считает main, как Start window
считает часы (`run-mode.ts`).

### 3.4 Правка принятых задач: чат и список

- **Список «Scheduled»** в разделе Assistant-а в rail: название, Project, следующий запуск, последний результат,
  Pause/Resume, Run now, Edit, Delete, история с причинами пропусков (как у Desktop [cc-desktop]).
- **Из чата** Assistant только предлагает: новая карточка «до → после» по образцу `settings-change.ts`. Принимает
  пользователь. Удаление из чата — тоже карточкой; прямого удаления у модели нет (по образцу Desktop [cc-desktop]).
- **Без Assistant-а.** Assistant по умолчанию выключен (spec worfy-assistant, решение 10). Список и ручная форма
  должны работать и без него.

### 3.5 Пропуски после сна и закрытого worfy

- По образцу `CheckScheduler` и Desktop: при старте worfy и на `resume` — один catch-up run за последний пропуск, если
  он не старше окна догона задачи; старше — строка «пропущено: Mac спал» в истории. Уведомление при catch-up run
  [cc-desktop].
- Run, который ещё идёт, не стартует второй раз (так уже в `CheckScheduler`; у Desktop — причина пропуска «the previous
  run was still in progress» [cc-desktop]).
- Keep-awake только на время самого run-а (как `autopilot/power.ts`), не между запусками.

### 3.6 Limits

- Перед каждым run-ом — `limitsCheck` вида `'automatic'` с порогом 80 % (`limits-gate.ts:20`). Выше порога — отложить до
  сброса в пределах окна догона, иначе пропустить со строкой в истории.
- Дневной предел runs на машину, по образцу `ASSISTANT_DAILY_WAKE_LIMIT`. У Claude cloud — 100 runs в час на аккаунт
  [cc-routines]; у Devin — 50 в час [devin-auto]; для одной машины worfy нужен предел намного меньше.
- Расход scheduled task — это работа пользователя, а не Assistant-а: не смешивать его с долей Limits Assistant-а
  (Ticket 27 worfy-assistant).

### 3.7 Что задача может делать без человека

- Session стартует как unattended и отвечает на запросы разрешений по Auto-approval (ADR-0098). Вопрос пользователю не
  задаётся; `autopilot_start` из неё отклоняется (`chat-confirm.ts:316`).
- Ход, который упёрся в запрос, который никто не одобрил, — run «ждёт вас»: пункт в журнале ядра внимания и уведомление.
  Так делают cloud scheduled tasks: run останавливается и ждёт человека [cc-routines].
- Три неудачи подряд — задача на паузе с причиной (как backoff `CheckScheduler` и пауза задач ChatGPT
  [chatgpt-tasks]).
- Наружу — только то, что разрешают правила Project-а; публикация в PR по-прежнему только щелчком Send (ADR-0105).

### 3.8 Рекомендованное устройство (кратко)

1. Сущность `ScheduledTask` в main: карточка → принятая задача в JSON-файле папки данных (zod, `json-file.ts`).
2. Планировщик — обобщённый `CheckScheduler`: календарное правило (подмножество RRULE + IANA-пояс), jitter, один
   catch-up run, `followPower`, один run за раз, backoff и пауза.
3. Run — новая Session на Canvas Project-а с точным принятым текстом, unattended, с Auto-approval Project-а; перед
   стартом — проверка Limits 80 % и дневной предел.
4. Assistant получает tools `schedule_propose`, `schedules_list`, `schedule_change_propose`; принимает и удаляет только
   пользователь.
5. Список «Scheduled» в разделе Assistant-а и результат каждого run-а пунктом журнала с уведомлением Assistant-а.

## 4. Вопросы владельцу

1. **Принятие карточки — это щелчок границы 3 ADR-0114 для каждого будущего run-а?** Рекомендую: да, пока текст
   задачи не изменился; любое изменение текста — новая карточка и новое принятие. Нужна дата-Amendment ADR-0114.
2. **Может ли scheduled task стартовать Run Autopilot-а Epic-а?** Рекомендую: не в первой версии. Ночной Run уже
   покрыт Start window (ADR-0093), а ADR-0100 и `chat-confirm.ts:316` остаются как есть.
3. **Где идёт задача?** Рекомендую: только локально, когда worfy открыт и машина не спит; в UI сказано это прямо.
   Cloud scheduled tasks Claude не встраивать.
4. **Пропуск после сна или закрытого worfy?** Рекомендую: один catch-up run за последний пропуск, если он не старше 6
   часов (настраивается в задаче); старше — пропуск со строкой в истории и уведомлением.
5. **Windows: закрытое окно завершает worfy.** Рекомендую: настройка «оставаться в фоне, пока есть активные scheduled
   tasks», выключена по умолчанию; login item — отдельная настройка, тоже выключена.
6. **Минимальный интервал и число задач?** Рекомендую: не чаще раза в час (как Claude cloud и платный ChatGPT
   [cc-routines], [chatgpt-tasks]), не больше 20 активных задач на машину, run не дольше 2 часов.
7. **Нужен ли включённый Assistant?** Рекомендую: нет. Список и ручная форма работают всегда; создание словами — через
   Assistant.
8. **Codex?** Рекомендую: да для Session задачи, раз worfy уже ведёт Session-ы Codex; Session самого Assistant-а
   остаётся на Claude Code (spec worfy-assistant, «Не в этом Epic-е»).
9. **Удаление словами.** Рекомендую: только через карточку с кнопкой Delete, как у Claude Code Desktop [cc-desktop].

## Источники

Все страницы прочитаны 2026-11-28.

- [cc-routines]: https://code.claude.com/docs/en/routines — «Create from the CLI», «Schedule a one-off run», «Edit and
  control scheduled tasks», «Permission prompts during a run», «Usage and limits».
- [cc-desktop]: https://code.claude.com/docs/en/desktop-scheduled-tasks — «Compare scheduling options», «Schedule
  options», «How scheduled tasks run», «Missed runs», «Permissions for scheduled tasks», «Manage scheduled tasks».
- [cc-loop]: https://code.claude.com/docs/en/scheduled-tasks — «Manage session-scoped scheduled tasks», «Jitter»,
  «Recurring task expiry», «Limitations».
- [cowork]: https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- [cowork-mobile]: https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile
- [chatgpt-tasks]: https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt
- [codex-sched]: https://learn.chatgpt.com/docs/automations?surface=app (адрес
  `developers.openai.com/codex/app/automations` отдаёт 308 redirect сюда)
- [gemini-actions]: https://support.google.com/gemini/answer/16316416
- [gemini-tasks]: https://support.google.com/gemini/answer/17094710
- [cursor-auto]: https://cursor.com/docs/cloud-agent/automations, https://cursor.com/help/ai-features/automations
- [gh-actions]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- [gh-copilot-auto]: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations,
  https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/
- [gh-copilot-cli]: https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/schedule-prompts
- [devin-auto]: https://docs.devin.ai/product-guides/automations, https://docs.devin.ai/product-guides/scheduled-sessions
- [ms-wake]: https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-waketorun
- [ms-start]: https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable
- [el-power]: https://www.electronjs.org/docs/latest/api/power-monitor
- [el-app]: https://www.electronjs.org/docs/latest/api/app — `app.setLoginItemSettings`
- [rfc5545]: https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10 — Recurrence Rule
- `man launchd.plist` (`StartCalendarInterval`) и `man pmset` — macOS на машине, где писалась заметка.
