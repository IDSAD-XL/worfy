# Transcripts and usage

> Перевод [английской версии](../transcripts-and-usage.md), commit `same-pr`.

Четыре Feature вокруг [Session](sessions.md). **Transcript** — запись Session на экране. **Claude home** — то, что worfy читает
из собственной папки Claude Code. **Memory** — объём памяти собственных процессов worfy, а не память Claude. **Limits** — два окна
подписки в toolbar. Термины объяснены в [Concepts](concepts.md).

## Transcript

### Behaviour

**Строки.** Prompt, текст Claude как markdown (streaming, пока он приходит), свёрнутый thinking, вызовы tools в одну строку с галочкой
или ошибкой, Subagent, hook, который что-то сказал, notice, result и error. Строка показывает время: `HH:MM`, дату для другого дня
(`Oct 4`) и год для другого года (`Dec 31 '25`). Полное время — в tooltip.

**Длинный Transcript.** Он открывается на последних 4 MB файла, а «Load earlier» добавляет более старые окна спереди. До 150 строк
рисуются все. Дальше рисуются только строки в зоне видимости и 1000 пикселей вокруг них, не больше 250. Renderer хранит 5000
последних live-событий Session.

**Прошлое и live.** View Session с transcript-ом показывает сначала файл, а за ним live-события, причём ни один turn не повторяется
дважды.

**Hide tools.** Кнопка в шапке сворачивает вызовы tools в одну строку «N tools». Упавший вызов и вызов, запускающий Subagent, остаются
на виду. Выбор хранится для каждой Session в local storage окна и следует за Session на её новый id.

**Find.** ⌘F открывает панель поиска над Transcript-ом. Запросу нужно 2 символа, регистр не учитывается. Поиск идёт по сообщениям
пользователя, тексту Claude, thinking, имени tool и одной строке о нём, описанию Subagent-а, имени и выводу hook-а, notice и error.
Весь вход и результат tool не ищутся. Считается текст, который показывает строка, поэтому вывод hook-а и добавленный notice считаются
по первым 20 000 символам. Совпадения считаются от самых старых, как «1 of M», до 20 000. Подсвечено не больше 5000. Часть файла, ещё
не загруженная, тоже считается.

**Поиск по Project.** «In transcripts» в Command palette принимает от 3 до 200 символов. Он охватывает только сообщения пользователя
и ответы Claude и отвечает максимум 20 совпадениями со snippet-ом в 120 символов, в пределах 200 файлов и 64 MB. Выбор совпадения
открывает Session.

**Read-only view.** Session, запущенная в другом месте, открывается в том же view с пометкой «Read-only: started in terminal» или
«Read-only: started in Claude desktop». Transcript Subagent-а открывается как «Read-only: Subagent transcript». Без файла view пишет
«No transcript of this Session yet». Пока открыт transcript Subagent-а, стрелка назад или ⌘[ ведёт к тому, кто его запустил.

#### Windows

Панель поиска открывается по Ctrl+F, а назад — по Ctrl+[.

### How it works

- **Одна схема для live и файла.** Разобранные строки transcript-а и live-события — одни и те же `AgentEvent`, поэтому оба рисуются
  одним fold и одним набором строк. Неизвестная запись становится событием `unknown`, а parser не бросает исключений: формат
  принадлежит Claude Code.
- **Файл — это запись.** Ничего из store в renderer не сохраняется
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)).
- **Где в файле начинается live.** Сообщения, вызовы tools и задачи несут id, которые есть в обоих источниках. Live-часть начинается
  с первого общего id и идёт назад по prompt-ам, которыми открываются live-события.
- **Хвост безопасно перечитывать.** Курсор движется только за целые строки и несёт идентичность файла, поэтому обрезанный или
  заменённый файл даёт `reset`.

### Implementation

| Что | Где |
| --- | --- |
| Разбор записей | `src/shared/transcript/parse.ts` |
| Чтение файла от курсора | `src/main/claude-home/tail.ts` |
| Fold, строки, окно отрисовки | `src/renderer/session/fold.ts`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/rows/` |
| Find | `src/shared/transcript/find.ts`, `src/main/claude-home/transcript-find.ts`, `src/renderer/session/transcript-find.ts`, `src/renderer/session/SessionFind.tsx` |
| Hide tools | `src/renderer/session/transcript-view.ts`, `src/renderer/session/HideToolsButton.tsx` |
| Поиск по Project | `src/main/claude-home/search.ts`, `src/renderer/palette/CommandPalette.tsx` |
| Read-only view | `src/renderer/session/ExternalSessionPanel.tsx` |
| Загрузка файла и слежение за ним | `src/renderer/claude-home/useClaudeHome.ts` |

**Поток данных.** Renderer просит у `claudeHome.transcript` последнее окно. Main читает строки, разбирает их и отвечает событиями и
курсором. Следующие чтения продолжают от курсора, а «Load earlier» читает назад от начала загруженного. `joinPastAndLive` соединяет
события файла с live-событиями, а `foldTranscript` превращает их в строки.

**Главные test-ы.** `test/contract/transcript-parse.test.ts`, `test/contract/transcript-find.test.ts`,
`test/unit/transcript-find.test.ts`, `test/unit/transcript-hide-tools.test.tsx`, `test/unit/session-find.test.tsx`,
`test/contract/session-history-tail.test.tsx`, `test/e2e/session-history-tail.spec.ts`, `test/e2e/external-session.spec.ts`.

## Claude home

### Behaviour

Claude home — собственная папка Claude Code, `~/.claude`. worfy читает её, а этот Feature ничего туда не пишет. Для Project она даёт
worfy три вещи: live Session, прошлые Session и их transcript-ы.

**Live Session** — запись в registry Session-ов Claude Code, процесс которой работает и время старта которой совпадает, поэтому
повторно использованный id процесса не считается. Её статус — idle, busy или unknown. Session, запущенная вне worfy, получает read-only Node
при старте, рядом со своим Ticket-ом или Epic-ом, если её Binding уже известен. Node остаётся, в статусе finished, и после ухода
процесса. Node, который убрал пользователь, в этом запуске приложения не возвращается. Session, которую ведёт сам worfy, такого Node
не получает.

**Прошлая Session** — файл transcript-а, который записал Claude Code.

**Какие Session относятся к Project.** Session относится к Project, когда её рабочая директория — корень Project, один из его worktree
или папка внутри них. Само имя папки ничего не доказывает. Session, рабочую директорию которой прочитать нельзя, считается только для
локального вызова и только в папке с точным именем.

**Слежение за изменениями.** Список обновляется при изменении файлов. Пока Session живая, worfy переспрашивает каждые 2 секунды: процесс
может умереть, не удалив свой файл.

#### On a Linked machine

Вызов Linked machine судится строго: неизвестная рабочая директория не считается, а корень должен быть Project или его worktree.

#### Windows

- Пути сравниваются без учёта регистра.
- Время старта процесса приходит от скрипта PowerShell, запросы собираются в batch по 25 ms и кешируются на 30 секунд.

### How it works

- **Только чтение — это решение.** Это файлы Claude Code, а своё состояние worfy хранит в своей папке данных
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md), [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Где что лежит.** Live Session — `sessions/<pid>.json`, прошлая — `projects/<folder>/<id>.jsonl`. Имя папки выводится из рабочей
  директории: символы, кроме букв и цифр, становятся `-`, а имя длиннее 200 символов обрезается с добавлением hash.
- **Файл читается с обоих концов.** Строке истории нужны начало и конец: по 64 KB, начало растёт до 1 MB при необходимости. Одновременно
  читается не больше 16 файлов, а результат кешируется в памяти по размеру и времени изменения. Рабочая директория ищется в пределах
  32 MB или 1000 строк.
- **Слежение с debounce.** За папками следят на два уровня вглубь, об изменениях сообщается через 150 ms, а registry ещё и опрашивается
  каждые 250 ms. Новая папка получает ещё один листинг через 1 секунду: иначе файл, записанный до старта слежения, теряется.

### Implementation

| Что | Где |
| --- | --- |
| Live и прошлые Session, слежение, проверка процессов | `src/main/claude-home/registry.ts` |
| Модель и effort пользователя | `src/main/claude-home/user-model.ts` |
| Путь к папке, `WORFY_CLAUDE_HOME` в test-ах | `src/main/storage/paths.ts` |
| Handler-ы и подписки, один watcher на клиента и Project | `src/main/ipc/claude-home.ts` |
| Каналы | `src/shared/ipc/claude-home.ts` |
| Renderer | `src/renderer/claude-home/useClaudeHome.ts` |
| Read-only Node | `src/renderer/claude-home/session-nodes.ts`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Раздел sidebar, popover истории | `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/session/HistoryPopover.tsx` |

**Поток данных.** `claudeHome.sessions` отвечает списками и подписывает клиента на `claudeHome.changed` для этого Project. Watcher также
передаёт live Session в `liveSessionListeners`: так `src/main/notify.ts` видит, что Session перешла в idle.

**Главные test-ы.** `test/contract/claude-home-registry.test.ts`, `test/contract/claude-home-registry-missed-event.test.ts`,
`test/contract/claude-home-isolation.test.ts`, `test/contract/claude-home-process-starts.test.ts`,
`test/contract/claude-home-link-root.test.ts`, `test/contract/claude-home-search.test.ts`.

## Memory

### Behaviour

Toolbar показывает, сколько памяти используют собственные процессы worfy: вторая строка колонки Harness, после версии приложения. Текст
— `412 MB` ниже 1024 MB и `1.3 GB` выше, а до первого замера `…`. Tooltip называет Feature и раскладывает сумму:
`Main … · Windows … · GPU … · Other …`. Terminal-сессии не считаются. «Memory in the toolbar» в Settings → General выключает показатель
во всех окнах. По умолчанию он включён.

#### On a Linked machine

Показатель всегда относится к Machine, на которой работает окно.

### How it works

Ничего не читается, пока никто не смотрит: таймер работает, только когда у окна показатель открыт и настройка включена. Окно, открывшее
остановленный sampler, сразу получает замер. Reload сбрасывает открытия старой страницы, потому что она не присылает close.

### Implementation

| Что | Где |
| --- | --- |
| Sampler, каждые 5 секунд через `app.getAppMetrics()` | `src/main/diagnostics/memory.ts` |
| Сумма и форматы | `src/shared/memory.ts` |
| Handler-ы, каналы | `src/main/ipc/memory.ts`, `src/shared/ipc/memory.ts` |
| Показатель | `src/renderer/memory/AppMemory.tsx`, `src/renderer/memory/useAppMemory.ts`, `src/renderer/shell/toolbar/HarnessStatus.tsx` |
| Настройка | `src/renderer/settings/GeneralSection.tsx`, `src/shared/settings/app-settings.ts` |

**Главные test-ы.** `test/unit/memory.test.ts`, `test/contract/memory.test.ts`, `test/contract/memory-app.test.ts`,
`test/unit/app-memory.test.tsx`, `test/e2e/memory.spec.ts`.

## Limits

### Behaviour

Toolbar показывает «Limits» с двумя полосами, 5-hour и 7-day, одними и теми же для всех Project. Session view их не повторяет. Пока данных
нет, написано «no data yet». Окно без данных пишет «no data».

- **Значение:** использованная доля, `62%`. Без доли — статус словами: allowed, near limit, limit reached.
- **Сброс:** `resets 14:20` для окна 5-hour и `resets Thu 09:00` для окна 7-day.
- **Цвет:** меняется на 60% и 85%. Статус near limit тоже даёт первый цвет, а rejected — второй.
- **Старые данные:** старше часа полоса тускнеет, а её tooltip заканчивается на `as of 13:05`.

### How it works

- **Три источника.** `rate_limit_event` SDK от любой Session. `rate_limits`, которые Claude Code передаёт команде status line: их копирует
  в файл небольшой скрипт, который worfy ставит перед собственной командой пользователя. И usage-запрос SDK.
- **Сначала пассивные источники.** Usage-запрос идёт не чаще чем раз в 30 минут и пропускается, пока пассивные источники свежие. Он не
  тратит токенов: его процесс не хранит session и не имеет настроек, MCP-серверов, tools и API-ключей
  ([ADR-0058](../../adr/0058-terminal-ai-assist-process.md)). Timeout — 30 секунд. Autopilot может попросить значение посвежее.
- **Status line требует согласия.** `statusLine` пользователя в `settings.json` меняется только через миграцию Harness
  ([ADR-0040](../../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0047](../../adr/0047-harness-lessons-by-pr-early-owner-switch.md)). Status line пользователя сохраняет свой вывод и exit code.
- **Одно правило слияния.** Более новое обновление заменяет старое того же окна. Обновление без времени сброса сохраняет известный сброс,
  пока тот впереди, а обновление без статуса сохраняет известный статус в пределах того же окна: сбросы не дальше часа друг от друга.

#### Windows

Когда папка данных исчезает, Windows без конца шлёт события watch. Поэтому watch закрывается при первом таком событии, а файл по-прежнему
проверяется опросом раз в секунду.

### Implementation

| Что | Где |
| --- | --- |
| Чтение источников, слияние, полосы (чистый код) | `src/shared/agent/limits.ts` |
| Tracker, `limits.json` в папке данных, слежение за файлом status line | `src/main/agent/limits.ts` |
| Usage-запрос | `src/main/agent/limits-usage.ts` |
| Скрипт за status line | `scripts/statusline-bridge.sh`, `scripts/statusline-bridge.mjs` |
| Handler-ы, каналы | `src/main/ipc/limits.ts`, `src/shared/ipc/limits.ts` |
| Полосы | `src/renderer/shell/toolbar/LimitsMeter.tsx`, `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts` |

**Поток данных.** Каждый источник передаёт обновления по окнам в `LimitsTracker`, который их сливает, сохраняет состояние и сообщает
подписчикам. Окно открывает `limits.open`, а затем получает `limits.changed` с новым состоянием целиком. Окно перерисовывается каждые
60 секунд, чтобы полоса устаревала и без нового значения.

**Главные test-ы.** `test/unit/limits.test.ts`, `test/unit/limits-usage.test.ts`, `test/contract/limits.test.ts`,
`test/contract/limits-watch-root.test.ts`, `test/unit/limits-meter.test.tsx`, `test/e2e/limits.spec.ts`.
