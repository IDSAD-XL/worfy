# App shell

> Перевод [английской версии](../app-shell.md), commit `same-pr`.

То, что окружает Canvas в каждом окне и на каждом Project-е. Пять Feature: **Command palette**, **Shortcuts**, **Menu**,
**Settings** и **Theme**. У шестого, [Notifications](notifications.md), своя страница. Термины объяснены в
[Concepts](concepts.md).

## Command palette

### Behaviour

Одно поле над окном, которое находит команды и объекты Project-а. Его открывает поле «Search or run…» в toolbar и ⌘K (Ctrl+K на
Windows). Панель шириной 560 пикселей и высотой не больше 440.

Ввод ранжирует строки. ↑ и ↓ ходят по всем строкам через группы и заворачивают по кругу, а указатель над строкой выбирает её.
Enter или клик запускает выбранную строку. Esc или нажатие вне панели закрывает Command palette.

Команда, которая сработала, закрывает Command palette. Команда, которая не сработала, оставляет её открытой с причиной внизу, до
следующего ввода или выбора. Пока команда выполняется, другой выбор ничего не делает.

**Группы.**

| Группа | Строки |
|---|---|
| Action | New session; «New …» на каждый пункт меню Canvas; Tidy up; Arrange by Epic; Re-pack; Archive finished sessions now; Process gate queue; Run wave `<epic>`; Ship ticket `<epic>/<NN>`; Reconnect machine…; Remove machine…; Update worfy |
| View | Switch to Canvas; Switch to Session; First-run checks; Getting started; Settings…; Keyboard shortcuts; Show only tag `<tag>`; Show all Nodes |
| Project | Switch to project `<name>` на каждый другой Project |
| Go to | Orchestrator; каждый Epic, Ticket и ADR; каждый Node из Layout, кроме тех, что worfy рисует из workflow, и binding anchor-ов |
| Manual check | Каждая неотмеченная ручная проверка Ticket-а. Эти строки появляются только после ввода |
| In transcripts | Session-ы Project-а, в разговоре которых есть запрос |

Некоторые строки есть только в некоторых состояниях:

- Process gate queue: только на Machine, которой Profile даёт роль `serve` в cross-machine gate. В её подробностях число
  ждущих PR и возраст самого старого.
- Run wave и Ship ticket: только там, где у Epic frame или Ticket-а есть эта кнопка.
- Reconnect machine…: только для Linked machine, которая не online или у которой сменился сертификат. Remove machine…: для
  каждой Linked machine. Имя Machine стоит в подробностях строки.
- Show all Nodes: только пока включён фильтр по тегу.
- Update worfy: только там, где Update включён, с Project-ом и без. Перезапускает в собранный Update, собирает Available
  update или проверяет, есть ли он; подробности строки говорят, что именно: см. [Updates](updates.md).

Строка «Go to» показывает Canvas и центрирует его на Node-е. Архивный или скрытый Node сначала возвращается. Ticket в свёрнутом
frame центрирует этот frame. Строка ADR открывает этот ADR только для чтения и не двигает Canvas. При скрытом sidebar ADR откроется, когда sidebar покажут. Строка Orchestrator открывает
Session view и запускает Orchestrator, если он не работает. Строка Manual check ведёт к своему Ticket-у и ничего не отмечает.
Выбор строки «In transcripts» открывает эту Session в Session view.

**Ранжирование.** Точный ключ бьёт любой заголовок, например номер Ticket-а (`07`, `7`, `worfy-mvp/07`) или номер ADR. Дальше по
порядку: начало заголовка, начало слова в заголовке, любое место заголовка, подробности, все слова запроса и символы запроса по
порядку с пропусками. Показано не больше 50 строк команд, до остальных доводит более длинный запрос. Группа стоит там, где стоит
её лучшая строка. С пустым полем в Project-е группы идут так: Action, View, Project, Go to.

**Неактивные строки.** Run wave или Ship ticket, которые сейчас нельзя запустить, остаются в списке серыми, с причиной рядом с
заголовком и в tooltip. Это та же причина, что показывает кнопка. Клик или Enter на такой строке ничего не делает.

**Длинные заголовки.** На строке без собственного состояния у обрезанного заголовка весь текст есть в tooltip. Строка Manual check
переносит заголовок максимум на 3 строки и затем обрезает. Tooltip строки «In transcripts» — весь её фрагмент.

**In transcripts.** Поиск начинается через 250 мс после последней клавиши, для запроса от 3 до 200 символов. Регистр не важен. Он
охватывает каждую Session, которую Claude Code записал для Project-а, где бы она ни была начата: в worfy, в терминале или в Claude
Desktop. Читаются сообщения пользователя и ответы Claude, но не вызовы инструментов, их вывод, thinking, hook-и и записи
Subagent-ов.

Приходит не больше 20 Session-ов, сначала новые, у каждой фрагмент до 120 символов вокруг совпадения. Один поиск читает не больше
200 транскриптов и 64 МиБ. Когда предел оставляет часть непрочитанной, группа пишет «Older transcripts were not searched». Ещё она
пишет «Searching…» и «Could not search the transcripts: …». Эти строки идут сверх 50 строк команд, под ними.

**Без Project-а** в Command palette есть строки View, Project и строки машин, а поиска по транскриптам нет.

#### Windows

Внутри Terminal клавиша Ctrl+K принадлежит shell-у, и Command palette не открывается. См. [Shortcuts](#shortcuts).

#### On a Linked machine

На экране только для чтения строки, которые изменили бы Project, неактивны с подсказкой «… gives this Machine read-only access». Это
New session, New …, Tidy up, Arrange by Epic, Re-pack, Archive finished sessions now, Process gate queue, Run wave и Ship ticket, а
также строка Go to архивного или скрытого Node-а. Виды, перемещение Canvas и переключение Project-ов остаются активными. Строка
Orchestrator только показывает Orchestrator и не запускает его.

Строки машин остаются активными: они касаются связи этой Machine, а не Project-а. Поиск по транскриптам идёт на Machine Project-а.

### How it works

- **У Command palette нет своего списка.** Команды строятся из того, что окно уже знает: модель workflow, Layout, Session-ы, ADR,
  Project-ы. Тип Node-а, который экспортирует `createLabel`, получает строку «New …» так же, как пункт меню Canvas
  ([ADR-0014](../../adr/0014-canvas-menu-items-from-node-type-files.md)).
- **Команда только просит.** Она идёт теми же запросами к Canvas и теми же вызовами IPC, что и кнопка, которую заменяет. Активны ли
  Run wave и Ship ticket, решает код этих кнопок, и main проверяет снова, прежде чем что-то запустить. Здесь ничто не пишет статус
  Ticket-а или файл Project-а ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Команды ранжируются в renderer, транскрипты ищутся в main.** Ранжирование — чистая функция, которая работает при каждом нажатии.
  Поиск по транскриптам идёт в main и держит текст транскрипта в памяти по размеру и времени изменения файла. Ответ на старый запрос
  отбрасывается, когда приходит.

### Implementation

| Что | Где |
|---|---|
| Поле, панель, клавиши, поиск по транскриптам | `src/renderer/palette/CommandPalette.tsx` |
| Построение команд из состояния окна | `src/renderer/palette/commands.ts` |
| Группировка ранжированных строк | `src/renderer/palette/groups.ts` |
| Ранжирование (`rankItems`), общее с поиском по Canvas | `src/renderer/find/search-index.ts` |
| Что делает Run wave и Ship ticket активными | `src/renderer/canvas/actions/gates.ts`, `src/shared/actions/render-template.ts` |
| Что запускают Run wave, Ship ticket и Process gate queue | `src/main/actions/launch.ts`, `src/main/ipc/actions.ts` |
| Поиск по транскриптам и его пределы | `src/main/claude-home/search.ts`, `src/shared/ipc/claude-home.ts` |

Главные test-ы: `test/unit/palette-commands.test.tsx`, `test/unit/palette-groups.test.tsx`, `test/unit/palette-transcripts.test.tsx`,
`test/unit/palette-manual-check-row.test.tsx`, `test/contract/claude-home-search.test.ts`, `test/e2e/palette-find.spec.ts`,
`test/e2e/palette-groups.spec.ts`.

## Shortcuts

### Behaviour

Каждый shortcut из списка ниже записан в одном registry в коде, и пользователь не может их менять. На Windows основная клавиша — Ctrl,
там, где на macOS ⌘.

| Группа | Действие | macOS | Windows |
|---|---|---|---|
| Window | Search or run a command | ⌘K | Ctrl+K |
| Window | Settings | ⌘, | Ctrl+, |
| Window | Hide or show the sidebar | ⌘B | Ctrl+B |
| Window | Keyboard shortcuts | ⌘/ | Ctrl+/ |
| Window | Keyboard shortcuts, вне текстового поля | ? | ? |
| Window | Bigger, Smaller, Actual size интерфейса | ⌥⌘=, ⌥⌘-, ⌥⌘0 | Ctrl+Alt+=, Ctrl+Alt+-, Ctrl+Alt+0 |
| Canvas | Zoom in, Zoom out | ⌘=, ⌘- | Ctrl+=, Ctrl+- |
| Canvas | Undo, Redo | ⌘Z, ⇧⌘Z | Ctrl+Z, Ctrl+Shift+Z |
| Canvas | Move the selection to the trash | ⌫ или Delete | Backspace или Delete |
| Canvas | Drag without snapping | ⌘ + drag | Ctrl + drag |
| Focus mode | Open the selection in focus mode | ⌘↩ | Ctrl+Enter |
| Focus mode | Leave focus mode | Esc | Esc |
| Find | Find on the Canvas или in the Session | ⌘F | Ctrl+F |
| Find | Next match, Previous match | Enter, ⇧Enter | Enter, Shift+Enter |
| Find | Close the find bar | Esc | Esc |
| Session | Back to what started the Subagent | ⌘[ | Ctrl+[ |
| Session | Send the message, New line | ⏎, ⇧⏎ | Enter, Shift+Enter |
| Session | Interrupt the turn | Esc | Esc |
| Session | Earlier and later messages | ↑↓ | ↑↓ |
| Session | Choose the slash command | ⏎ | Enter |
| Terminal | Command request (zsh с Terminal AI) | ⌘I | нет |

Клавиши zoom отзываются ещё на `+` и `_`.

**Окно Keyboard shortcuts** показывает эти записи в группах выше, с клавишами так, как их пишет эта система. Оно открывается из
Help ▸ Keyboard Shortcuts, по ⌘/, по `?` вне текстового поля и вне Terminal, и из Command palette. Esc, Close или нажатие на фон закрывает
его, и фокус возвращается туда, где был. Пока оно открыто, ни одна клавиша не доходит до приложения за ним, кроме accelerator-ов
меню приложения. Settings → Shortcuts показывает тот же список. При открытых Settings запрос открыть shortcuts показывает этот
раздел, а открытие Settings поверх окна закрывает окно.

**Раскладки клавиатуры.** Латинская буква читается с колпачка клавиши, поэтому shortcut следует за буквой на QWERTZ, AZERTY, Dvorak и
BÉPO. В раскладке другого алфавита буква берётся по месту клавиши: кириллическая буква на клавише K — это K. `[` у Back тоже читается
по месту, когда в раскладке там буква. Для прочей пунктуации Shift не считается, потому что он только выбирает символ: `?` работает
там, куда его ставит раскладка. Нажатие с зажатым другим модификатором не совпадает ни с одной записью: это Ctrl на macOS и клавиша
Windows на Windows.

#### Windows

- Внутри Terminal запись с Ctrl не совпадает, поэтому Ctrl+K и Ctrl+F доходят до shell-а. Исключение — zoom Canvas: Ctrl+= и Ctrl+-
  по-прежнему меняют масштаб, и только Ctrl+\_ остаётся у shell-а. См. [Terminal](terminal.md).
- AltGr вводит символ и никогда не shortcut, хотя приходит как Ctrl+Alt. Ctrl+Alt, нажатые двумя клавишами, — это сочетание.
- Меню показывает Ctrl+/, но не забирает его. Его ловит страница, вне Terminal, где он остаётся у shell-а. При открытых Settings
  клавиша ничего не делает. Ctrl+B остаётся у shell-а сам по себе: xterm.js его отменяет, а меню получает только нажатия, которые страница не отменила.
- У ⌘I здесь нет записи, потому что Ctrl+I — это Tab shell-а.

### How it works

- **Один список для всего, что говорит о клавише.** Обработчики renderer-а, подписи рядом с кнопками, accelerator-ы меню приложения и
  окно Keyboard shortcuts читают один registry, поэтому клавиша и написанное о ней не могут разойтись. Запись составлена без системы:
  `primary` — это ⌘ на macOS и Ctrl в остальных.
- **Места не конфликтуют.** У записи есть scope, например `app`, `canvas` или `terminal`. Две записи одного scope никогда не делят
  клавиши, и ни одна запись не делит клавиши с записью `app`. Это проверяет test.
- **Правило Terminal одно.** На Windows клавиши shell-а делят Ctrl с клавишами worfy, поэтому запись с основной клавишей уступает
  нажатие внутри терминала. Запись называет в `shellKeeps` клавиши, которые оставляет за собой shell, остальные остаются за
  записью. Без `shellKeeps` shell оставляет за собой все. На macOS клавиши shell-а на Ctrl, а worfy на ⌘, поэтому там ничего не
  уступается.
- **Система берётся из user agent**, без канала IPC: `src/renderer/main.tsx` пишет её на `<html>` как `data-platform`, и там её читают
  стили и `currentPlatform`.

### Implementation

| Что | Где |
|---|---|
| Registry и accelerator записи | `src/shared/shortcuts.ts` |
| Сопоставление нажатия, подпись, текстовые поля и Terminal Node | `src/renderer/shortcuts/match.ts` |
| Система, основная клавиша, клавиша нажатия, запись сочетания | `src/renderer/platform.ts` |
| Окно и список | `src/renderer/shortcuts/ShortcutsOverlay.tsx`, `src/renderer/settings/ShortcutsSection.tsx` |
| Его состояние и модальный guard на `window` | `src/renderer/shortcuts/shortcuts-window.ts` |

Главные test-ы: `test/unit/shortcuts.test.tsx`, `test/unit/shortcuts-overlay.test.tsx`, `test/unit/platform-shortcuts.test.tsx`,
`test/unit/platform-keys.test.ts`, `test/e2e/shortcuts.spec.ts`.

## Menu

### Behaviour

Меню приложения построено на меню Electron по умолчанию, плюс собственные пункты worfy.

| Меню | Пункты |
|---|---|
| Меню приложения, названо по приложению (macOS) | About; Settings…; Services; Hide, Hide Others, Show All; Quit |
| File | macOS: по умолчанию Electron. Windows: Settings…; Quit |
| Edit | По умолчанию Electron |
| View | Reload; Force Reload; Toggle Developer Tools; Actual size; Bigger; Smaller; Toggle Full Screen; Toggle Sidebar; Show Minimap |
| Window | По умолчанию Electron |
| Help | Keyboard Shortcuts; на macOS ещё системное поле поиска |

- **Settings…** (⌘,) открывает окно [Settings](#settings) того окна, для которого выбран пункт.
- **Bigger и Smaller** меняют масштаб интерфейса Machine на десятую, от 80 % до 150 %, а **Actual size** ставит 100 %, во всех окнах.
  Они стоят там, где пункты zoom у Electron, и не меняют масштаб одного окна. Их клавиши содержат ⌥ (Alt), потому что ⌘= и ⌘- меняют масштаб Canvas.
  Bigger отключён на 150 %, Smaller на 80 %, также когда масштаб изменён в Settings.
- **Toggle Sidebar** (⌘B) скрывает или показывает sidebar, где бы ни был фокус. Единственное исключение — внутри Terminal на Windows,
  см. ниже. У обычного вида и focus mode отдельные ответы, и переключатель меняет ответ того, что сейчас показывает окно, для которого
  выбран пункт. Оба ответа — настройки Machine: все окна в этом режиме следуют за ними, и ответы переживают перезапуск. Кнопка в toolbar
  и в панели focus mode делает то же.
- **Show Minimap** — это флажок, сначала включён. Он действует на все окна и живёт, пока worfy не выйдет.
- Команда, выбранная сразу после появления окна, выполняется, а не теряется. Она ждёт страницу до 10 секунд, и ждать могут до 8 команд
  на окно. Перезагрузка страницы отбрасывает то, что ждало.

#### Windows

Окно с собственной рамкой системы, а меню под её заголовком. Меню приложения нет, поэтому Settings… лежит в File. Внутри Terminal
Ctrl+B остаётся у shell-а: см. [Shortcuts](#shortcuts).

#### On a Linked machine

Меню принадлежит Machine, чей экран его показывает. Его команды никогда не идут на Linked machine, а окно, показывающее Project с Linked
machine, открывает Settings своей Machine.

### How it works

Установка меню заменяет меню по умолчанию целиком, поэтому его роли выписаны явно, а меню приложения и File выписаны по пунктам.
Каждый accelerator берётся из registry [Shortcuts](#shortcuts). Accelerator принадлежит меню, а не обработчику клавиш страницы, поэтому
⌘B работает, где бы ни был фокус.

Пункт, которому нужен renderer окна, посылает ему `menu.command`: окну, для которого выбран пункт, иначе окну в фокусе, иначе никому.
Окно может быть на экране раньше, чем React смонтирован. Поэтому main посылает команду только после того, как страница сказала через
`menu.ready`, что следует за этой командой, а до тех пор держит её. Порядок сохраняется внутри одной команды, но не между командами.

Состояние minimap хранится в памяти main и не является настройкой.

### Implementation

| Что | Где |
|---|---|
| Шаблон и его установка | `src/main/menu.ts` |
| Удержание и доставка `menu.command` | `src/main/ipc/menu.ts`, `src/shared/ipc/menu.ts` |
| Следование за командой на странице | `src/renderer/menu-command.ts` |
| Состояние Show Minimap | `src/main/ipc/view.ts`, `src/shared/ipc/view.ts` |
| Шаги масштаба | `src/main/settings/interface-scale.ts` |
| Toggle Sidebar на странице | `src/renderer/shell/sidebar-visibility.ts` |

Главные test-ы: `test/contract/view-menu.test.ts`, `test/unit/menu-command.test.tsx`, `test/e2e/focus-sidebar.spec.ts`.

## Settings

### Behaviour

Settings — это настройки самого worfy на этой Machine. Окно открывается из «Settings…» меню приложения (⌘,) и из Command palette. Оно модальное,
с разделами в колонке слева. Esc или Close закрывает его, и фокус возвращается туда, где был. ↑ и ↓ ходят по разделам, а Tab идёт по
кругу по элементам окна. Пока оно открыто, ⌘K, ⌘F и ⌘↩ ничего не делают.

| Раздел | Что в нём |
|---|---|
| General | Interface scale; Memory in the toolbar; Version; Updates там, где Update включён: см. [Updates](updates.md) |
| Health | Проверки First run с их действиями и «Check again». Открытие раздела запускает проверку |
| Shortcuts | Список окна Keyboard shortcuts |
| Machines | Переключатели связи и уровень доступа каждой Linked machine: см. [Link](link.md) |
| Terminal AI | Переключатели и модели Terminal AI: см. [Terminal](terminal.md) |
| Sessions | Окно autocompact для Session-ов |
| Canvas | Автоматический архив завершённых Session-ов |
| Browser | Когда Live Browser засыпает |
| Autopilot | Run mode по умолчанию, Start window и дневной бюджет Limits: см. [Run planning](run-planning.md#settings--autopilot) |
| Plan | План, под которым вошёл Claude Code, и для Pro готовый набор с кнопкой Apply |
| Pipeline | Pipeline активного Project-а: см. [Workflow](workflow.md) |

Изменение сразу доходит до всех окон Machine. Когда main не может его сохранить, раздел говорит об этом с причиной, и настройка остаётся
прежней. Большинство разделов пишет «Not saved: …».

**Значения и значения по умолчанию.**

| Настройка | Значения | По умолчанию |
|---|---|---|
| Interface scale | 80–150 % с шагом 10 % | 100 % |
| Memory in the toolbar | вкл., выкл. | вкл. |
| Sessions: Orchestrator | 100K–1M токенов с шагом 10K, или Claude Code default | 400K |
| Sessions: Other Sessions | 100K–1M токенов с шагом 10K, или Claude Code default | 500K |
| Archive finished sessions after | Never, 6 h, 24 h, 3 days, 7 days | 24 h |
| …and when their Ticket is done | вкл., выкл. | вкл. |
| Live browsers at once | 1, 2, 3, 4, 5, 6, 8, 10 | 3 |
| Sleep when off screen after | 10 с, 30 с, 1, 2, 5, 10 мин | 30 с |
| Sleep when unused after | 1, 2, 5, 10, 15, 30 мин, 1 ч | 5 мин |
| Readable from zoom | 25, 30, 40, 50, 60, 75 % | 40 % |
| Daily budget of the Limits | вкл., выкл. | выкл. |
| Reserve for your own work | 0, 5, 10, 15, 20, 25, 30, 40, 50 % недели | 15 % |

- **Interface scale.** Масштабируется всё окно: текст, Canvas, Terminal, Card-ы. Пока ползунок тянут, меняется только значение рядом с
  ним. Масштаб применяется, когда ползунок отпущен или клавиша сделала шаг. View ▸ Bigger, Smaller и Actual size меняют ту же настройку.
- **Memory in the toolbar** показывает, сколько памяти занимают собственные процессы worfy. Сессии Terminal не считаются. Main замеряет
  память, только пока настройка включена.
- **Sessions.** Поле принимает тысячи токенов, а введённое значение приводится к диапазону и шагу. Строка под каждой ролью называет,
  откуда окно: Custom, Claude Code default, файл настроек Claude Code или worfy default. Окно применяется после перезапуска Session, и
  worfy сам ни одну не перезапускает. Когда login shell задаёт `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, раздел говорит, что она важнее обеих
  настроек.
- **Canvas.** Завершённая Session уходит с Canvas через это время после последнего сообщения, и ничего не удаляется. Session завершённого
  Ticket-а уходит через час после последнего сообщения, пока включён второй переключатель.
- **Autopilot.** Резерв отключён, пока выключен бюджет.
- **Plan.** Max и планы, которых worfy не знает, предложения не получают. Без клика по Apply ничего не пишется.
- Значение, заданное вручную вне предложенного списка, но в пределах, показывается как есть. Это касается значений Browser и резерва.

У sidebar есть ещё две настройки того же рода и нет строки в этом окне: какие разделы свёрнуты и показан ли sidebar (отдельно для
обычного вида и focus mode).

Настроек Project-а, например его Terminal shell, здесь нет. Они в «Project settings…»: см. [Projects](projects.md).

#### On a Linked machine

Окно, показывающее Project с Linked machine, читает и пишет настройки своей Machine, а Linked machine до них никогда не дотягивается.
Pipeline показывает Pipeline той Machine только для чтения и говорит, где его править. Plan говорит, что план и его настройки применяются
в worfy на Machine Project-а.

### How it works

- **Settings — собственное состояние worfy** ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Они не попадают ни в репозиторий,
  ни в Profile. Два раздела — исключение: Pipeline и набор Plan меняют Profile, и main делает это через `bin/profile-set` из Harness.
- **Большинство разделов делит один файл**, `app-settings.json` в папке данных. Terminal AI хранит `terminal-ai.json`, а Machines хранит
  `link/settings.json`.
- **Чтение прощает, запись строгая.** Без файла действуют значения по умолчанию. Файл, который нельзя разобрать или в котором поле
  неверного типа, откладывается как `app-settings.json.unreadable-<time>`, и действуют значения по умолчанию. Отсутствующее поле получает
  значение по умолчанию, неизвестное отбрасывается, а масштаб или окно autocompact вне диапазона приводятся к нему. Порог архива, которого
  эта версия не знает, или значение Browser или Autopilot вне пределов читаются как не выбранные, а остальной файл остаётся.
- **Выбор переживает значения по умолчанию.** `sessionArchive`, `browserSleep` и `autopilotBudget` хранят только поля, которые выбрал
  человек, поэтому поздняя смена значения по умолчанию их не трогает. Не выбранное окно autocompact уступает `autoCompactWindow` из
  `~/.claude/settings.json`: тогда worfy ничего не передаёт. Иначе worfy передаёт своё значение по умолчанию.
- **Каждое окно держит самое новое состояние.** Настройками владеет main, и изменение, которое ничего не меняет, ничего не пишет. Любое
  другое увеличивает `revision` и идёт во все окна как `appSettings.changed`. Renderer держит состояние с наибольшей revision, потому что
  ответ и событие могут прийти в любом порядке.
- **Настройка читается, когда нужна.** Main читает окно autocompact при каждом старте Claude Code у Session, настройки архива при каждом
  run-е архива, настройки сна при каждой проверке правил, а бюджет перед каждой Wave.
- **Полосы вокруг кнопок окна сохраняют размер.** Масштаб увеличивает всё окно, но кнопки окна macOS остаются на месте в пикселях окна.
  Поэтому `--toolbar-height` равен 52 пикселям окна при любом масштабе, а содержимое внутри всё равно масштабируется. Каждая загрузка
  страницы получает масштаб снова, потому что Chromium хранит свой zoom на origin.

### Implementation

| Что | Где |
|---|---|
| Схема, пределы, значения по умолчанию, откуда окно | `src/shared/settings/app-settings.ts` |
| Хранилище и чтение файла | `src/main/settings/store.ts`, `src/main/storage/json-file.ts` |
| Каналы `appSettings`, все `local` | `src/shared/ipc/app-settings.ts`, `src/main/ipc/app-settings.ts` |
| Масштаб как zoom каждого окна | `src/main/settings/interface-scale.ts` |
| Копия настроек в renderer | `src/renderer/settings/useAppSettings.ts` |
| Окно и его модальный guard | `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/settings/settings-window.ts` |
| Список разделов | `src/renderer/settings/sections.ts` |
| Масштаб на `<html>` | `src/renderer/settings/interface-scale.ts` |

Раздел — это один файл `src/renderer/settings/<Name>Section.tsx`, который экспортирует компонент по умолчанию, `order` и `title`.
Достаточно добавить файл: окно находит его через `import.meta.glob`, а файл без этих экспортов останавливает renderer с указанием своего
пути. Строки используют `src/renderer/settings/controls.tsx`.

Главные test-ы: `test/contract/app-settings.test.ts`, `test/unit/use-app-settings.test.tsx`, `test/unit/settings-dialog.test.tsx`,
`test/unit/interface-scale.test.tsx`, `test/e2e/settings.spec.ts`, `test/e2e/interface-scale.spec.ts`. У каждого раздела свой test, например
`test/unit/settings-sessions.test.tsx`.

## Theme

### Behaviour

Настройки темы в worfy нет. Окно следует светлому или тёмному оформлению системы и меняется сразу, включая работающий Terminal.

- У светлой палитры бледно-серый фон и синий основной цвет (`#0071e3`). У тёмной, с названием Graphite, тёплый тёмный фон и лаймовый
  основной цвет (`#c8f25a`).
- У Terminal тёмный фон в обеих.
- В светлой мягкие многослойные тени. В тёмной теней нет, только рамки в 1 пиксель.
- У Orchestrator, Session и Epic есть свой цвет для полосы заголовка, иконки вида и minimap. У Subagent цвет его Session, только контуром.
  Эти цвета никогда не используются для текста статуса.
- Элемент, на который действует клик, показывает курсор-указатель, вуаль под указателем и кольцо акцентного цвета при фокусе с клавиатуры.
  Неактивный элемент ничего из этого не показывает, и у него курсор «not allowed».

#### macOS

Заголовка окна нет. Кнопки окна стоят внутри toolbar, а sidebar полупрозрачный, сквозь него видна vibrancy системы.

#### Windows

Собственная рамка системы с заголовком, непрозрачные страница и sidebar. Пока страница не отрисована, окно показывает цвет фона той темы,
которая была в системе при создании окна.

### How it works

Оформление системы выбирает набор token-ов через `prefers-color-scheme`. Общие блоки берут цвета только из token-ов, поэтому им не нужен код на
каждую тему. Terminal передаёт цвета token-ов в xterm.js как параметры и передаёт их снова при смене схемы. Дизайн — вариант F
([docs/design/F-SPEC.md](../../design/F-SPEC.md)), а цвета по виду Node-а — [ADR-0077](../../adr/0077-node-kind-tokens.md).

Token-ы проверяются test-ами: каждый цвет по таблице спецификации дизайна и каждая пара текста и фона на контраст не меньше 4.5:1, в том числе
на фоне под указателем. Тёмные тени — прозрачная нулевая тень, а не `none`, потому что правила кладут их в списки через запятую, а `none` в
списке заставляет браузер отбросить всё объявление.

### Implementation

| Что | Где |
|---|---|
| Token-ы обеих тем и правила для элементов управления | `src/renderer/theme/tokens.css` |
| Общие блоки | `src/renderer/theme/primitives.tsx`, `src/renderer/theme/primitives.css` |
| Общий список вместо нативного | `src/renderer/theme/Select.tsx`, `src/renderer/theme/select.css` |
| Рамка окна по системе | `src/main/window-frame.ts`, `src/main/window.ts` |
| Непрозрачная страница вне macOS | `src/renderer/shell/shell.css` |
| Цвета Terminal | `src/renderer/canvas/nodes/TerminalNode.tsx` |

Главные test-ы: `test/e2e/theme.spec.ts`, `test/e2e/theme-shadows.spec.ts`, `test/e2e/controls.spec.ts`, `test/unit/contrast.test.ts`,
`test/unit/kind-tokens.test.ts`, `test/unit/shadow-tokens.test.ts`, `test/unit/terminal-theme.test.tsx`, `test/unit/window-options.test.ts`.
