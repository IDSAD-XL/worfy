# worfy-onboarding: Getting started и Demo project

Status: утверждён владельцем 2026-10-26: пункты 1–9 раздела «Решения владельца», Р1–Р14 раздела
«Решено без владельца» и тексты интерфейса раздела «Тексты (черновик)». Ticket-ы раздаются после
закрытия `worfy-link`.
Source: решения владельца 2026-10-26; [CONTEXT.md](../../CONTEXT.md), термины Getting started и Demo
project; [roadmap.md](../../docs/roadmap.md), раздел «E4 — Для других людей» (связь ниже, roadmap этот
Epic не правит); [ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy — вид над
workflow), [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние worfy),
[ADR-0045](../../docs/adr/0045-one-ticket-one-repository.md) (`workflow.finish`),
[ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) (проверка Windows),
[ADR-0067](../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (Pipeline и отметки
агентов), [ADR-0071](../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (вердикт
Windows с runner-а GitHub).
Ticket-ы: Epic `worfy-onboarding`, 12 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-link (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket`
и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Разработчик, который уже работает с Claude Code, ставит worfy и понимает, как им пользоваться, проведя
один Ticket Demo project через Orchestrator, ревью, которое находит проблему, круг доработки и merge.
Getting started ведёт его шесть шагов и ничего не блокирует: пропустить можно в любой момент, свой
Project подключается как раньше.

Epic готов, когда:

1. Новый пользователь (свежая папка данных worfy, Project-ов нет) видит в First run страницу трёх
   понятий, потом проверки, потом кнопку «Start Getting started». Раздел Getting started стоит первым
   в боковой панели, его шесть шагов отмечаются сами, по мере того как сделаны.
2. Одна кнопка создаёт Demo project: локальный git-репозиторий в домашней папке, без GitHub, Full
   mode, `workflow.finish` `local-green`, свой Profile `worfy-demo` на установленном Harness. Его Ticket
   проходит через Orchestrator до merge с настоящими агентами. Pipeline показывает Stage-ы, у каждого
   Stage — своя подсказка, круг доработки виден. Если ревью ничего не нашло — Getting started говорит
   об этом и показывает записанный пример REJECTED и доработки.
3. Существующий пользователь (хотя бы один Project на момент обновления) не получает раздел сам: один
   раз видит уведомление в углу «New: Getting started…» с «Open» и «Not now». После «Not now» или
   закрытия оно не появляется. Нигде нет модального окна, которое заставляет пройти Getting started.
4. Экран Done предлагает «Connect your own project» и «Remove the demo project». Удаление спрашивает
   подтверждение и убирает папку, Profile и запись gate registry. Сам по себе Demo project не
   удаляется. Command palette «Getting started» открывает раздел снова в любой момент.
5. Всё это одинаково на macOS и на Windows; Demo project никогда не виден Linked machine-у.

Проверку всех пяти пунктов делает Ticket 12 вместе с владельцем: новый пользователь macOS и Windows-ПК
владельца.

## Как устроено

- **Состояние Getting started** — свой файл worfy `getting-started.json` в папке данных (`dataRoot()`,
  `src/main/storage/paths.ts:35`; правило ADR-0005, как `first-run.json`, `src/main/ipc/first-run.ts:157`).
  В нём: виден ли раздел, отмеченные шаги со временем, Demo project (id, путь, имя Profile), показано
  ли уведомление существующему пользователю, был ли круг доработки. Отмеченный шаг не снимается. Файл
  ведёт main (Ticket 06); renderer получает снимок и изменения по своему домену IPC `gettingStarted`
  (новый, `src/shared/ipc/getting-started.ts`; каналы — `local`: состояние этой машины).
- **Шаги отмечаются в main** (Ticket 06), а не в окне: ревью может идти, пока окно на другом
  Project-е или закрыто.
  1. Check your setup — последний отчёт First run без `fail` среди проверок, нужных Demo project
     (Р2 ниже).
  2. Open the demo project — Demo project создан и стоит в списке Project-ов.
  3. Meet the Orchestrator — первый ход Orchestrator-а Demo project закончился.
  4. Ship the ticket — Ticket demo впервые прошёл Stage Implementing (по снимку `StageHub`,
     `src/main/workflow/stages.ts:336`).
  5. See the review — Stage Agent review пройден: после круга доработки, или без него — тогда шаг
     показывает «this time the review found nothing» и пример.
  6. Merge — Status Ticket-а demo `done`.
- **Demo project** (Ticket-ы 04, 05). Шаблон файлов — модуль TypeScript в main (`src/main/getting-started/demo-template.ts`),
  не ресурс сборки: упаковка (`electron-builder.yml`) не меняется. Содержимое:
  - todo CLI на JavaScript без зависимостей: `package.json` без `dependencies`, `bin/todo.js`,
    `src/todo.js`, задачи в `todo.json` текущей папки;
  - test-ы на встроенном `node:test`, без `npm install`: `test/fast/` (add, list) и `test/full/`
    (поведение `done <n>`, в том числе уже сделанная задача и номер вне списка);
  - Epic `todo` в `.scratch/todo/` (Full mode: Workflow folder — корень репозитория), `spec.md` и один
    Ticket `issues/01-done-command.md`: «add `done <n>` that marks a task done»;
  - Profile `worfy-demo`: Full mode, `workflow.finish` `local-green`, `github.account` null, свой
    `workflow.pipeline` без CI (Р1), gate registry — fast script `test:fast` (`node --test test/fast/*.test.js`),
    full script `test` (`node --test`): gate registry называет script-ы `package.json`, а не команды.
  Fast gate исполнителя запускает только `test/fast/`; полная проверка ревьюера — всё. Поэтому крайний
  случай `done` почти наверняка находит ревью, и круг доработки виден.
- **Создание** (Ticket 05) — канал `gettingStarted.createDemo`, без агентской Session черновика:
  папка в домашней папке → файлы шаблона → `git init`, первый commit автором из `git config` →
  `bin/project-connect` установленного Harness с готовым черновиком и `--no-qmd` (Ticket 03) →
  `ProjectStore.add` с пометкой `localOnly` (Ticket 11) → Demo project активный → Session-настройки
  Orchestrator-а «дешевле» (Р5). Ошибка на любом шаге откатывает сделанное и пишет причину в шаг 2.
- **Отметки агентов без GitHub** (Ticket-ы 01, 02). Сегодня в Full mode отметка `review` — commit
  status на GitHub (`harness/bin/ticket:699-700`, `markGitHub` `:704`), а без `origin` команда падает
  («has no origin», `:723`). worfy в Full mode читает отметки только из PR (`marksOf`,
  `src/main/workflow/stages.ts:201-204`). Без PR Stage-ы Implementing и Agent review у Demo project не
  сдвинутся, круга доработки не видно. Решение (Р1): в Full mode с `workflow.finish` `local-green` и без
  `origin` отметки идут в тот же файл, что в Silent mode
  (`<HARNESS_HOME>/runs/<profile>/marks/<epic>-<NN>.json`), и worfy читает их оттуда.
- **Раздел в боковой панели** (Ticket 07) — `src/renderer/shell/sidebar/GettingStartedSection.tsx`,
  `order` меньше 10, то есть выше Projects (`ProjectsSection.tsx:20`; порядок —
  `src/renderer/shell/registry.ts:38-51`). Пропуск скрывает раздел; Command palette «Getting started»
  (`src/renderer/palette/commands.ts`, рядом с «First-run checks», `:288-299`) открывает снова.
  «Connect your own project» открывает тот же «Add project», что «+» Projects
  (`ProjectsSection.tsx:401`, `:447`).
- **Вход** (Ticket 08). First run (`src/renderer/shell/FirstRun.tsx`) при первом открытии без отметки
  показывает страницу трёх понятий, «Next» — к проверкам. В нижней строке проверок — «Start Getting
  started». Существующему пользователю — уведомление action toast (`showToast`,
  `src/renderer/toast/toasts.ts:131`), не модальное окно.
- **Подсказки Stage-й и стоимость** (Ticket 09). Подсказка — строка под текущим шагом и один toast
  `info` на подсказку, только когда Ticket demo входит в свой Stage. Переключатель «дешевле / дороже»
  меняет модель и effort Orchestrator-а Demo project (`SessionSettingsStore`,
  `src/main/agent/session-settings.ts:64`).
- **Done и удаление** (Ticket 10) — экран в разделе после шага 6; удаление через подтверждение,
  закрывает Session-ы и Terminal-ы Demo project, потом удаляет.
- **Linked machine** (Ticket 11). Проверки вызовов Linked machine-а — `insideProjects` и
  `projectRootOf` (`src/main/link/caller.ts:101-127`), список — `projects.list`
  (`src/main/ipc/projects.ts:230`) и рассылка `projects.changed` (`:200-207`); все вызовы связи идут
  через `call` адаптера (`src/main/link/ipc-adapter.ts:220`). Project с `localOnly` из них выпадает
  для вызова не из окна этой Machine.

## Этапы

1. **Основа без UI** — 01, 02, 03, 04, 11.
   - 01: Harness — отметки агентов в файл при Full mode без GitHub; skills читают их оттуда.
   - 02: worfy — Stage-ы по этому файлу.
   - 03: Harness — `project-connect --remove <name>` и `--no-qmd`.
   - 04: шаблон Demo project и его Profile.
   - 11: пометка `localOnly` и фильтр для Linked machine-а.
2. **Demo project в main** — 05: создание.
3. **Ход Getting started** — 06: состояние и шаги, которые отмечаются сами.
4. **UI** — 07: раздел и команда Command palette; 08: First run и уведомление; 09: подсказки,
   переключатель стоимости, пример доработки; 10: Done и удаление.
5. **Приёмка** — 12: с владельцем, новый пользователь macOS и Windows-ПК.

## Решения владельца

Session проектирования 2026-10-26. Номера — как у владельца; Ticket-ы ссылаются на них.

1. **Для кого и зачем.** Разработчики, которые уже работают с Claude Code. Пользователь понимает
   worfy, проведя один Ticket Demo project через Orchestrator, ревью, которое находит проблему, круг
   доработки и merge.
2. **Getting started** — раздел в самом верху боковой панели, шесть шагов, которые отмечаются сами:
   Check your setup (First run зелёный) → Open the demo project (одна кнопка создаёт его) → Meet the
   Orchestrator (в demo уже есть один Epic и один Ticket) → Ship the ticket (исполнитель работает,
   Pipeline показывает Stage-ы) → See the review (ревьюер находит проблему, исполнитель исправляет) →
   Merge (Ticket done). Ниже — необязательный «Connect your own project», в «готово» не входит.
   Пропуск в любой момент; ничего не блокирует; свой Project подключается и в обход. Команда Command
   palette «Getting started» открывает раздел снова.
3. **Существующих пользователей не заставляют добавлять Project.** Если при обновлении есть хотя бы
   один Project, список сам не открывается; вместо этого — одно немодальное уведомление в углу «New:
   Getting started — a guided demo of worfy. Open · Not now», после «Not now» или закрытия больше не
   показывается. Новым пользователям диалог First run заканчивается кнопкой «Start Getting started».
   Модальных окон нет нигде.
4. **First run получает первую страницу** с тремя понятиями: Project + Harness (правила, по которым
   агенты работают в этом Project-е), Orchestrator (Session, которая раздаёт Ticket-ы агентам и
   мержит), Canvas (где всё это видно). «Next» ведёт к существующим проверкам. Остальные понятия —
   короткие подсказки, когда Ticket demo доходит до своего Stage («Implementer started in its own
   worktree», «The reviewer found a problem — this is the rework round»).
5. **Demo project** — локальный git-репозиторий, который worfy создаёт сам в домашней папке
   пользователя (например `~/worfy-demo`; на Windows никогда не в `%TEMP%`), без GitHub,
   `workflow.finish` `local-green`, Full mode, свой Profile `worfy-demo` на установленном plugin Harness.
   Агенты работают по-настоящему и тратят токены. Содержимое — маленький todo CLI на JavaScript без
   зависимостей с test-ами на встроенном `node:test` (без `npm install`). Ticket: «add `done <n>` that
   marks a task done». Очевидный крайний случай (задача уже сделана, номер вне списка) покрыт test-ом,
   который запускает только полная проверка ревьюера, а не fast gate исполнителя: ревью почти наверняка
   кончается REJECTED и показывает круг доработки. Запасной путь: если ревью ничего не нашло, Getting
   started говорит «this time the review found nothing» и показывает записанный пример REJECTED и
   доработки.
6. **Стоимость.** По умолчанию demo идёт в режиме подешевле (Sonnet, effort medium), переключатель — на
   Opus. Цен нигде нет — только «a bit cheaper» / «a bit more expensive».
7. **После Merge** — экран «Done» с «Connect your own project» и «Remove the demo project». Удаление
   спрашивает подтверждение и убирает папку, Profile и запись registry. Сам по себе demo не удаляется.
8. **macOS и Windows — одинаково.** Платформенная часть проверяется на Windows-ПК владельца по
   ADR-0056. Demo project только локальный и никогда не предлагается Linked machine-у.
9. **Когда.** Epic пишется сейчас, его Ticket-ы раздаются после закрытия Epic-а worfy-link (слово
   владельца; исключение из правила «новых Epic-ов нет, пока не закрыты worfy-windows и
   worfy-browser»). Onboarding стоит рядом с E4 roadmap (установщик для других людей): E4 даёт
   подписанную сборку, этот Epic — первый час работы в ней. roadmap этот Epic не правит.

## Решено без владельца

Каждый пункт — «решено без владельца, подтверждено владельцем 2026-10-26». Ticket делает по пункту, пока владелец не сказал
иначе; ответ владельца правит пункт здесь и «Что делаем» Ticket-а.

- **Р1. Отметки и Pipeline без GitHub** (Ticket-ы 01, 02, 04) — решено без владельца, подтверждено владельцем 2026-10-26.
  В Full mode с `workflow.finish` `local-green` и без `origin` `bin/ticket mark` пишет файл отметок
  Silent mode, skills и worfy читают его. Pipeline Demo project: Queued, Implementing, Agent review,
  Gate & merge, Done — без CI (Stage CI проходит только с открытым PR,
  `src/shared/workflow/pipeline.ts:237-238`) и без Closing. Иначе пришлось бы перевести demo в Silent
  mode, а это против пункта 5.
- **Р2. «First run зелёный» для шага 1** (Ticket 06) — решено без владельца, подтверждено владельцем 2026-10-26. Нет `fail`
  среди проверок, без которых demo не пройдёт: `claude-login`, `git`, `git-identity`, `node`, `jq`,
  `harness`, `harness-dependencies`, `harness-scripts`; на Windows ещё `windows`, `arch`, `powershell`,
  `git-bash` (список — `src/main/first-run/checks.ts:302-323`). `gh`, `gh-auth`, `qmd*`,
  `legacy-harness`, `claude-version`, `limits` шаг не держат: demo без GitHub и без qmd. `warn` не мешает.
- **Р3. Когда отмечаются шаги 3–5** (Ticket 06) — решено без владельца, подтверждено владельцем 2026-10-26. Как в разделе «Как
  устроено». Шаг 5 отмечается и без REJECTED: тогда в нём запасной путь пункта 5.
- **Р4. Ход Ticket-а запускает Orchestrator, а не кнопка «Ship ticket»** (Ticket-ы 07, 09) — решено без
  владельца, подтверждено владельцем 2026-10-26. Шаг 3 открывает Orchestrator Demo project и кладёт в поле ввода готовый
  вопрос; шаг 4 кладёт туда `/worfy:ship-ticket todo 01`. Отправляет пользователь сам. Так виден
  Orchestrator как Session, и Subagent-ы implementer и reviewer берут его модель (`model: inherit`,
  `harness/agents/implementer.md:4`, `harness/agents/reviewer.md:5`).
- **Р5. Режимы стоимости** (Ticket-ы 05, 09) — решено без владельца, подтверждено владельцем 2026-10-26. «Cheaper» — Sonnet,
  effort medium у Orchestrator-а Demo project; «More expensive» — Opus, effort по умолчанию модели.
  effort Subagent-ов задаёт их определение (`effort: high`, `implementer.md:5`, `reviewer.md:6`); plugin
  ради demo не меняется. Переключатель действует со следующего хода и только на Demo project.
- **Р6. Папка Demo project** (Ticket 05) — решено без владельца, подтверждено владельцем 2026-10-26. `<домашняя папка>/worfy-demo`
  (`os.homedir()`; на Windows `C:\Users\<имя>\worfy-demo`). Папка занята не нашим demo → `worfy-demo-2`,
  `-3`… Путь внутри `os.tmpdir()` (на Windows `%TEMP%`) отклоняется всегда. Пользователь папку не
  выбирает.
- **Р7. Новый и существующий пользователь** (Ticket 06) — решено без владельца, подтверждено владельцем 2026-10-26. Решается
  один раз, когда main впервые читает состояние и файла `getting-started.json` нет: в списке Project-ов
  есть хотя бы один → существующий (раздел скрыт, уведомление один раз), нет → новый (раздел виден).
  Потом не пересчитывается.
- **Р8. Страница трёх понятий** (Ticket 08) — решено без владельца, подтверждено владельцем 2026-10-26. Только когда First run
  открылся сам и отметки `first-run.json` нет. Из Command palette «First-run checks» — сразу проверки.
- **Р9. «Start Getting started»** (Ticket 08) — решено без владельца, подтверждено владельцем 2026-10-26. В нижней строке
  проверок рядом с «Close», у нового пользователя (Р7), пока шаг 6 не отмечен. Нажатие закрывает First run
  (отметка пишется, как при «Close») и показывает раздел с фокусом на нём.
- **Р10. Подсказки Stage-й** (Ticket 09) — решено без владельца, подтверждено владельцем 2026-10-26. Строка под текущим шагом
  раздела и один toast `info` на подсказку, с `projectId` Demo project (toast виден, только пока demo
  активен).
  Подсказка «Epic и Ticket» (шаг 3) — после ответа Orchestrator-а: шаг 3 отмечен, шаг 4 ещё нет, Ticket
  в Queued (решено без владельца, onboarding 09, подтвердить). Причина — высота раздела: показанная
  сразу после создания demo, подсказка вместе с переключателем стоимости не помещается в раздел окна
  высотой 1000 px. Цена — кто пропустил шаг 3, эту подсказку не увидит.
- **Р11. Записанный пример доработки** (Ticket 09) — решено без владельца, подтверждено владельцем 2026-10-26. Короткий текст,
  вшитый в приложение: вердикт ревьюера REJECTED с находкой про уже сделанную задачу, правка
  исполнителя и повторный вердикт. Раскрывается в шаге 5 кнопкой «Show an example». Не снимок экрана:
  текст не стареет вместе с UI.
- **Р12. Что убирает удаление** (Ticket 10) — решено без владельца, подтверждено владельцем 2026-10-26. Подтверждение —
  нативный диалог «Confirm» / «Cancel», как у действий First run (`src/main/ipc/first-run.ts:118-131`).
  Сначала закрываются Session-ы и Terminal-ы Demo project, потом удаляются: папка, Profile и записи
  gate registry (`project-connect --remove worfy-demo`), строка в списке Project-ов и папка данных
  worfy этого Project-а (`ProjectStore.dataDir`, `src/main/projects/store.ts:130`). Транскрипты Claude
  Code в `~/.claude/projects/` остаются: это данные Claude Code, не worfy.
- **Р13. Profile без Session черновика** (Ticket-ы 04, 05) — решено без владельца, подтверждено владельцем 2026-10-26. Черновик
  Profile `worfy-demo` — готовый шаблон worfy, его проверяет `project-connect --check`. До шага 4 demo
  не тратит токенов. qmd для demo не подключается (`--no-qmd`).
- **Р14. Имена в demo** — решено без владельца, подтверждено владельцем 2026-10-26. Epic `todo`, Ticket
  `01-done-command`, ветка `todo/01`, Profile `worfy-demo`.

## Тексты (черновик)

Все тексты интерфейса — английские. Здесь — на утверждение владельцу одним местом; Ticket-ы берут их
отсюда и не придумывают своих.

**First run, страница трёх понятий** (Ticket 08)

- Заголовок: «Welcome to worfy»
- Строка под ним: «worfy runs Claude Code agents on your projects and shows their work. Three things to know:»
- **Project + Harness** — «A Project is a repository you work on. The Harness is the set of rules the
  agents follow in this Project: how to check a change, how to review it, when to merge.»
- **Orchestrator** — «The Orchestrator is the main Claude Code Session of a Project. It hands tickets
  to agents, collects their reviews and merges the work.»
- **Canvas** — «The Canvas is where it all shows: epics, tickets, Sessions and their progress, side by side.»
- Внизу: «Everything else is explained when you meet it.» Кнопка: «Next»
- Кнопка в нижней строке проверок: «Start Getting started»

**Раздел Getting started** (Ticket 07)

- Заголовок раздела: «Getting started»; строка: «A guided demo: one ticket from start to merge.»
- 1 — «Check your setup» — «Make sure Claude Code, git, node and the Harness are ready.» Кнопка, пока не
  отмечен: «Open checks»
- 2 — «Open the demo project» — «worfy creates a small todo app in your home folder. No GitHub needed.»
  Кнопка: «Create demo project». Ошибка: «Could not create the demo project: <reason>»
- 3 — «Meet the Orchestrator» — «Ask the project's main Session what is planned.» Кнопка: «Open the
  Orchestrator». Готовый вопрос в поле ввода: «What is planned in this project?»
- 4 — «Ship the ticket» — «An implementer agent adds `done <n>`. The Pipeline shows each Stage.»
  Кнопка: «Ship the ticket». Готовое сообщение: «/worfy:ship-ticket todo 01»
- 5 — «See the review» — «A reviewer checks the work. If it finds a problem, the implementer fixes it.»
- 6 — «Merge» — «The Orchestrator merges the ticket into main.»
- Ниже, отдельно: «Connect your own project» — «Add a repository you work on. Not part of the demo.»
  Кнопка: «Connect…»
- Ссылка внизу: «Skip». Строка после пропуска (toast `info`): «Getting started is hidden. Reopen it
  from the Command palette: Getting started.»
- Строка о стоимости под шагом 2: «The agents work for real and use your Claude Code usage.»

**Создание Demo project** (Ticket 05; черновик, onboarding 05)

Строки хода (`gettingStarted.createProgress`), по порядку:

- «Creating the folder»
- «Writing the files»
- «Making the first commit»
- «Connecting the project to the Harness»
- «Adding the project»
- «Opening the Orchestrator»

Причины отказа (`reason` ответа; в шаге 2 — после «Could not create the demo project: »):

- Папка во временной: «The home folder <home> is inside the temporary folder <temp>, which the system
  cleans: worfy does not put the demo project there.»
- Нет автора git: «git does not know the commit author (<user.name and user.email> not set). Set your name
  and email once: git config --global user.name "Your Name" && git config --global user.email "you@example.com"»
- git не ответил: «git config failed: <последняя строка stderr>»
- git не запускается: «git could not be run: <ошибка>. Install git, then try again.»
- Все имена заняты: «<home>/worfy-demo and 99 folders after it are taken.»
- Скрипт Harness не запускается: «The Harness could not be run: <ошибка>. Check the Harness in the
  first-run checks (Command palette: First-run checks).»
- Старый Harness (exit 2): «Update the Harness first: this Harness's project-connect does not know
  --no-qmd. Open the first-run checks (Command palette: First-run checks) and update the Harness plugin
  there.»
- Имя занято чужим Profile-ем: «The Harness already has a Profile named worfy-demo that this demo did not
  create (<сообщение project-connect>). worfy leaves it as it is: remove or rename it, then try again.»
- Другой отказ project-connect: «The Harness refused the demo project: <сообщения через "; ">»
- Profile прежнего demo, чья папка удалена, не снимается: «The Profile <имя> of the earlier demo, whose
  folder <path> is gone, could not be removed: <сообщения>»
- Шаг git упал: «git <команда> failed: <последняя строка вывода>»
- Без текста ошибки: «the demo project could not be created»
- Откат не всё вернул — к причине добавляется «. Not undone: <список через "; ">.», элементы: «the Project
  stays in the list (<ошибка>)», «the Profile <имя> stays (<ошибка>)», «the folder <path> stays (<ошибка>)»

**Переключатель стоимости** (Ticket 09)

- Подпись: «Demo agents»
- «Sonnet — a bit cheaper» (по умолчанию)
- «Opus — a bit more expensive»
- Живая Session не приняла смену (черновик, onboarding 09): «Saved for the next start of the
  Orchestrator; its running Session kept its settings: <ошибка>»

**Подсказки Stage-й** (Ticket 09)

- Шаг 3, Epic и Ticket: «An Epic is a goal; a Ticket is one piece of work in it. Both are files in the
  project, under .scratch/.»
- Implementing: «Implementer started in its own worktree — a separate checkout, so main stays untouched.»
- Agent review: «The reviewer started. It reads the change and runs the project's checks itself.»
- Implementing после отметки `review` `failure`: «The reviewer found a problem — this is the rework
  round. The implementer fixes it on the same branch.»
- Gate & merge: «Review passed. The Orchestrator runs the Gate — the project's full checks — and merges.»
- Done: «Merged. The ticket is done.»
- Запасной путь шага 5: «This time the review found nothing.» Кнопка: «Show an example»
- Подписи для screen reader в раскрытом примере (черновик, onboarding 09): список — «Example of a rework
  round», diff правки — «The implementer's fix»

**Уведомление в углу** (Ticket 08)

- «New: Getting started — a guided demo of worfy.» Кнопки: «Open», «Not now»

**Command palette** (Ticket 07)

- «Getting started» — подпись «A guided demo of worfy»

**Экран Done** (Ticket 10)

- Заголовок: «Done — the ticket is merged»
- Текст: «You took one ticket from the Orchestrator through review to main. That is the whole loop.»
- Кнопки: «Connect your own project», «Remove the demo project»
- Подтверждение (нативный диалог): заголовок «Remove the demo project?»; текст «worfy closes the
  demo's Sessions, then deletes the folder <path>, and its worfy settings. This cannot be
  undone.»; кнопки «Confirm», «Cancel»
- После удаления: «The demo project was removed.»

## Не в этом Epic-е

- **Подпись, нотаризация, установщик для других людей** — E4 roadmap.
- **Тур по интерфейсу** (подсветка элементов, стрелки) — нет: понятия объясняют страница First run и
  подсказки Stage-й.
- **Demo project на Linked machine-е** — никогда (пункт 8).
- **Второй Ticket или Epic в demo**, Autopilot на demo — нет.
- **Цены и подсчёт токенов в Getting started** — нет (пункт 6).
- **Изменения plugin Harness ради стоимости demo** (effort Subagent-ов) — нет (Р5).
- **Правка roadmap.md** — нет (пункт 9).

## Риски и открытые технические вопросы

1. **Исполнитель может сам запустить полную проверку** и исправить крайний случай до ревью. Тогда
   REJECTED не будет — для этого запасной путь пункта 5. Ticket 04 держит Ticket demo без слов о
   крайнем случае и `test/full/` вне fast gate; acceptance (Ticket 12) записывает, как часто так вышло.
2. **Старый Harness у пользователя.** Отметки без GitHub (01) и `--remove` / `--no-qmd` (03) работают с
   установленным plugin, только если он не старше этих Ticket-ов. Создание demo (05) проверяет
   поддержку и при старом Harness просит обновить его тем же действием, что First run (строка
   `harness`), а не падает на середине.
3. **Git identity.** Первый commit demo делается автором из `git config`. Без него шаг 1 не зелёный
   (`git-identity`, Р2), и создание отвечает той же причиной.
4. **Windows.** Удаление папки, где ещё открыт файл (Terminal, процесс `node --test`, git), даёт
   `EBUSY`/`EPERM`. Ticket 10 закрывает Session-ы и Terminal-ы до удаления и повторяет удаление с
   паузой; что осталось — называет. Пути — только через `node:path` и `os.homedir()`.
5. **Платформенные PR** (ADR-0056, пункт 2; ADR-0071). Ticket-ы 01 и 03 меняют скрипты Harness, 05 и
   10 — работу с файлами и путями, у которой есть отличия Windows. Их PR мержатся после вердикта
   Windows. 12 — приёмка на Windows-ПК.
6. **Ход demo стоит токенов** пользователя; ошибка в Getting started, которая перезапускает ход,
   тратит их зря. Getting started не отправляет сообщений агентам сам (Р4).
7. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
   (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-link](../worfy-link/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, ручные пункты «(вручную)», снимки UI в двух темах, Autopilot над worfy — только на
Stable copy. Отличия:

- **Начало** — после закрытия Epic-а worfy-link (пункт 9). Раньше Ticket-ы не берутся.
- **Ветки** — `worfy-onboarding/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **Тексты** — только из раздела «Тексты (черновик)». Нужен новый текст — он сначала добавляется в
  этот раздел тем же PR, с пометкой «черновик».
- **Без токенов в test-ах.** unit, contract и e2e идут с `WORFY_AGENT=fake`; ход Ticket-а demo в e2e
  изображается записью Status и файла отметок, а не агентами. Настоящий ход — только в Ticket-е 12.
- **e2e Getting started** — в своих spec-файлах `test/e2e/getting-started*.spec.ts`. Раздел сам не
  открывается в чужих e2e: переменная `WORFY_GETTING_STARTED_AUTO=0` по умолчанию в
  `test/e2e/launch-env.ts` (рядом с `WORFY_FIRST_RUN_AUTO`, `:93`), её добавляет Ticket 06.
- **Платформенный PR** — 01, 03, 05, 10: пункт «Готово, когда» с вердиктом Windows (ADR-0056, пункт 2;
  ADR-0071 для PR без окон и e2e).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/bin/ticket`, `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/bin/tests/ticket-mark.test.sh` | 1 |
| 02 | `src/main/workflow/stages.ts`, `src/main/workflow/profile.ts`, `test/contract/workflow-stages.test.ts` | 1 |
| 03 | `harness/bin/project-connect`, `harness/bin/tests/project-connect.test.sh` | 1 |
| 04 | `src/main/getting-started/demo-template.ts`, `test/unit/demo-template.test.ts` | 1 |
| 11 | `src/main/projects/store.ts`, `src/main/link/caller.ts`, `src/main/link/ipc-adapter.ts`, `src/main/ipc/projects.ts`, `test/contract/projects.test.ts`, `test/unit/link-caller-local-only.test.ts` | 1 |
| 05 | `src/main/getting-started/demo.ts`, `src/main/getting-started/state.ts`, `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`, `test/contract/getting-started-demo.test.ts` | 2 |
| 06 | `src/main/getting-started/state.ts`, `src/main/getting-started/progress.ts`, `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`, `src/main/ipc/first-run.ts`, `test/unit/getting-started-progress.test.ts`, `test/contract/getting-started-state.test.ts`, `test/e2e/launch-env.ts` | 3 |
| 07 | `src/renderer/shell/sidebar/GettingStartedSection.tsx`, `src/renderer/getting-started/store.ts`, `src/renderer/projects/add-project.ts`, `src/renderer/session/pending-input.ts`, `src/renderer/session/MessageInput.tsx`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/palette/commands.ts`, `test/unit/getting-started-section.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/getting-started.spec.ts` | 4 |
| 08 | `src/renderer/shell/FirstRun.tsx`, `src/renderer/shell/FirstRunConcepts.tsx`, `src/renderer/shell/first-run-store.ts`, `src/shared/ipc/first-run.ts`, `src/main/ipc/first-run.ts`, `src/renderer/getting-started/notice.ts`, `src/renderer/main.tsx`, `test/unit/first-run-concepts.test.tsx`, `test/unit/getting-started-notice.test.ts`, `test/e2e/first-run.spec.ts`, `test/e2e/getting-started-entry.spec.ts` | 5 |
| 09 | `src/renderer/getting-started/hints.ts`, `src/renderer/getting-started/ReviewExample.tsx`, `src/renderer/getting-started/CostSwitch.tsx`, `src/renderer/shell/sidebar/GettingStartedSection.tsx`, `src/main/getting-started/demo.ts`, `src/main/getting-started/state.ts`, `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`, `test/unit/getting-started-hints.test.ts`, `test/contract/getting-started-cost.test.ts`, `test/e2e/getting-started-hints.spec.ts` | 5 |
| 10 | `src/main/getting-started/remove.ts`, `src/main/getting-started/demo.ts`, `src/main/getting-started/state.ts`, `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`, `src/renderer/getting-started/DoneScreen.tsx`, `src/renderer/shell/sidebar/GettingStartedSection.tsx`, `test/contract/getting-started-remove.test.ts`, `test/e2e/getting-started-done.spec.ts` | 6 |
| 12 | `.scratch/worfy-onboarding/spec.md` | 7 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 02, 03, 04 и 11.** Блокеров нет. Общих файлов нет: 01 и 03 — разные скрипты Harness
  и их test-ы; 02 — чтение отметок в main; 04 — новый модуль шаблона; 11 — список Project-ов и
  проверки вызовов Linked machine-а. 02 строится по формату файла отметок, который уже есть у Silent
  mode (`src/main/workflow/marks.ts`), поэтому 01 его не держит.
- **Wave 2 — 05, один.** Ждёт 03 (`--no-qmd`), 04 (шаблон) и 11 (`localOnly`).
- **Wave 3 — 06, один.** Ждёт 02 (Stage-ы demo) и 05 (запись о Demo project).
- **Wave 4 — 07, один.** Ждёт 06.
- **Wave 5 — 08 и 09.** Оба ждут 07. Общих файлов нет: 08 — First run и уведомление; 09 — подсказки,
  стоимость и пример. 08 зовёт открытие раздела из store Ticket-а 07 и его не правит.
- **Wave 6 — 10, один.** Ждёт 03, 05 и 07; по блокерам — Wave 5, сдвинут: с 09 общие
  `GettingStartedSection.tsx`, `src/main/getting-started/demo.ts` и файлы домена `gettingStarted`.
- **Wave 7 — 12, один.** Ждёт все остальные Ticket-ы. Отмечает пункты «Готово, когда» в этом файле.

Таблица собрана руками по «Где в коде» Ticket-ов, без пометки «(новый)». Файлы, которые Ticket-ы
допишут при claim, в таблицу не вошли.
