# Vendors

> Перевод [английской версии](../vendors.md), commit `same-pr`.

Один Feature. **Vendor** — производитель агента, на котором идёт [Session](sessions.md): Claude Code (Anthropic) или Codex
(OpenAI). Страница описывает, как пользователь выбирает Vendor-а и входит в него, что есть и чего нет у Session Codex и как
worfy ведёт каждого агента через одну границу. Сама Session (состояния, очередь, Resume, история) — на странице
[Sessions](sessions.md), панель Limits — на странице [Transcripts and usage](transcripts-and-usage.md). Термины объяснены в
[Concepts](concepts.md).

## Vendors

### Behaviour

**Два Vendor-а.** Claude Code обязателен: проверки первого запуска требуют входа в него ([Onboarding](onboarding.md)). Codex
необязателен. Пользователь, который не входит в Codex, нигде не видит ошибки, и сборка без Codex работает так же: Settings →
Vendors говорит, что Codex в ней нет. worfy входит в каждого Vendor-а только по его подписке: в Codex — аккаунтом ChatGPT.
API-ключ worfy не спрашивает никогда, а Codex, в который вошли по API-ключу, считается Codex-ом без входа.

**Выбор Vendor-а.** «New session» в боковой панели открывает список «New session on» со всеми Vendor-ами этой сборки: первым —
Vendor по умолчанию Project-а с пометкой `default`, за ним остальные. Vendor, в которого никто не вошёл, остаётся в списке
неактивным, и его tooltip называет причину: `Sign in to Codex in Settings → Vendors`. Выбор запускает Session на этом
Vendor-е; Esc или щелчок мимо закрывают список. При каждом открытии списка main проверяет вход в каждого Vendor-а, вход в
которого ещё не находил. Linked machine на сборке без списка сразу запускает Session на Vendor-е по умолчанию своего
Project-а. «New session» в Command palette тоже берёт Vendor по умолчанию. Vendor по умолчанию — поле «Default vendor» в
[Project settings](projects.md); пока его не выбрали — Claude Code. Orchestrator и Session, которую запускает «Ship ticket»,
всегда идут на Claude Code. В одном Project Session-ы обоих Vendor-ов живут рядом.

**Вход в Vendor-а.** В Settings → Vendors строка на каждого Vendor-а этой сборки: Claude Code с пометкой `required`, Codex —
`optional`. Строка, где вход выполнен, показывает `Signed in: <email> · <plan>`, как проверка входа при первом запуске. У
Vendor-а без входа — «Sign in to <Vendor>». Для Codex main начинает вход ChatGPT и открывает его страницу в браузере; строка
пишет «Finish the sign-in in your browser…», даёт «Cancel», а потом показывает аккаунт, которым вход закончился. Вход,
оставленный открытым, отменяется через 10 минут и при выходе из worfy. Для Claude Code строка называет команду для Terminal
Node, `claude`, и даёт «Check again». Vendor, которого в этой сборке нет, пишет `Codex is not part of this build of worfy.` и
ничего не предлагает. Проверка или вход, которые не удались, — строка в их ряду; ничего не всплывает. worfy не хранит
token-ов: каждый Vendor хранит свой вход в своей домашней папке.

**Значок Vendor-а.** Vendor показан именем рядом со своим логотипом цвета текста (звезда Claude у Claude Code, знак OpenAI у
Codex): на live Session Node перед папкой, коротко (`Claude`, `Codex`, полное имя — в tooltip); в шапке Session view после
заголовка; в первом блоке rail-а, «Vendor»; в списке Vendor-ов «New session». Панель Limits и строки «In transcripts»
показывают только логотип, имя — в tooltip. У Orchestrator-а значка нет. Сообщения агента в transcript подписаны именем
Vendor-а, `claude` или `codex`; у Orchestrator-а остаётся `orch`.

**Чат Session Codex.** Он работает как у Session Claude Code ([Sessions](sessions.md)). Сообщение, отправленное во время хода,
ждёт в очереди Session и уходит после результата хода. Interrupt отменяет открытые запросы подтверждения и останавливает ход.
Закрытие, падение и Resume ведут себя как у Claude Code; Resume продолжает тот же thread Codex. Размышления Codex видны в виде
сводки, которую даёт сам Codex.

**Model, effort и permissions Session Codex.** Три пикера под полем ввода предлагают то, что предлагает Codex.

- Model: модели, которые называет запущенный Codex; первой — «Default (<model>)», модель, которую Codex отмечает как модель
  по умолчанию. Смена действует со следующего хода.
- Effort: уровни выбранной модели, от низшего.
- Permissions: три preset-а словами Codex; описание — tooltip каждой строки.

| Preset | Описание |
| ------ | -------- |
| Read only | Codex reads files and asks before it edits a file or runs a command. |
| Auto | Codex edits files and runs commands in the project folder; it asks before anything outside it. |
| Full access | Codex edits any file and runs any command, with network access, without asking. |

Новая Session Codex переводит сохранённый выбор в термины Codex: Bypass permissions, режим по умолчанию, — это Full access;
Accept edits — Auto; Ask before tools и Plan only — Read only. Уровень effort `max` у Claude Code — значение модели по
умолчанию. Выбор сохраняется у Node, как у Claude Code.

**Запросы подтверждения Session Codex.** Codex спрашивает перед командой или правкой файлов, и в transcript появляется та же
карточка, что у Claude Code, с заголовком «Permission request». Команда показана целиком с папкой, где она идёт, `in
<folder>`; правка файлов — её файлы, по одному в строке. Ответы — варианты Codex в его порядке:

- Accept: только этот запрос.
- Accept for this Session: этот запрос и та же команда или те же файлы снова, до конца Session.
- Decline: отказ в этом запросе, ход продолжается.
- Decline and stop the turn: отказ и остановка хода.

Запрос, чью команду или файлы worfy назвать не может, не предлагает «Accept for this Session». Interrupt, закрытие Session и
падение отменяют открытый запрос.

**Slash-меню Session Codex.** «/» открывает то же меню, что у Claude Code. В нём две команды, которые выполняет app server
Codex, `/compact` и `/review`, затем включённые skills Codex, каждый со своим описанием. `/review` делает ревью
незакоммиченных изменений или следует инструкциям, набранным после команды. `/compact` и `/review` выполняются только между
ходами: отправленные во время хода, они возвращаются notice с просьбой отправить снова, когда ход закончится. Сообщение,
которое начинается с имени skill-а, вызывает этот skill. Последняя строка меню, «Not every command is listed», неактивна; её
tooltip говорит, что остальные команды Codex работают только в его собственном терминале.

**Чего у Session Codex нет.** worfy не эмулирует то, чего у Vendor-а нет. Session Codex не показывает Subagent-ов на Canvas, не
исполняет hook-и, и Harness у неё нет. Разовые запросы — черновик профиля Project и [Terminal AI](terminal.md) — идут только на
Claude Code.

**Limits по Vendor-ам.** В панели Limits на toolbar раздел на каждого Vendor-а: окна Claude Code, 5 часов и 7 дней, и, пока
выполнен вход в Codex, окна, которые сообщает его план, с подписью по длине (`5h`, `weekly`). Подробности — в
[Limits](transcripts-and-usage.md#limits).

**Session-ы Codex на Canvas.** Thread-ы Codex этого Project-а, начатые в worfy или в терминале, есть в истории Session-ов как
`worfy · Codex` или `terminal · Codex`. Thread, начатый вне worfy и изменённый за последние 10 минут, сам получает read-only
Node с transcript, прочитанным у Codex, и Resume продолжает его на live Node. Подробности — на странице
[Sessions](sessions.md).

**Tool-ы worfy в Codex.** Session Codex в Project получает те же MCP-серверы, что Session Claude Code, `worfy-canvas` (Canvas
и Cards с `worfy.ask`) и `worfy-browser`, по HTTP на `127.0.0.1` с token-ом своего процесса. Подробности — на страницах
[Cards](cards.md) и [Browser](browser.md).

**Поиск.** «In transcripts» в Command palette ищет по thread-ам Codex этого Project-а вместе с transcript-ами Claude Code
([App shell](app-shell.md)).

**Getting started.** Пока Codex есть в сборке, в панели Getting started есть необязательная ссылка «Use Codex too», которая
открывает Settings → Vendors ([Onboarding](onboarding.md)).

### How it works

- **Одна нейтральная модель.** Остальной worfy говорит только в типах worfy: события Session (`AgentEvent`), записи
  transcript, окна Limits (`LimitWindow`) и capabilities. Driver каждого Vendor-а переводит своего агента в них. Зачем:
  третий Vendor — это новый driver, а не правка всего приложения ([ADR-0094](../../adr/0094-vendor-seam.md)).
- **Capabilities, а не имена.** Интерфейс никогда не проверяет, на каком Vendor-е идёт Session. Он читает capabilities
  Vendor-а Session: флаги «да или нет» (Subagent-ы, hook-и, MCP в процессе приложения, tool-ы canvas, steer, resume, список
  прошлых Session-ов, стабильная смена модели, разовый запрос без tool-ов, полное slash-меню, Harness), откуда берутся Limits,
  preset-ы permissions и уровни effort. У каждого отсутствующего флага есть причина, которую показывает tooltip. Session, чьи
  capabilities main дать не может, считается Session Claude Code, как Node, сохранённый без Vendor-а.
- **Driver из частей.** У driver-а каждого Vendor-а одни и те же части:

  | Часть | Что даёт | Claude Code | Codex |
  | ----- | -------- | ----------- | ----- |
  | capabilities | Флаги и списки | Статические, с моделями live Session | Статические, с моделями live Session |
  | session | Старт и resume Session | Agent SDK `query()` | `thread/start`, `thread/resume`, `turn/start` |
  | account | Кто вошёл; вход | `accountInfo()` | `account/read`, `account/login/start` |
  | limits | Окна Limits | `rate_limit_event`, status line, запрос usage | `account/rateLimits/read`, `account/rateLimits/updated` |
  | history | Прошлые Session-ы и их transcript-ы | JSONL-файлы в `~/.claude/projects` | `thread/list`, `thread/read` |
  | commands | Slash-меню | `supportedCommands()` | `skills/list` и две встроенные команды |
  | mcp | MCP-серверы worfy | В процессе приложения | HTTP на `127.0.0.1` |
  | oneShot | Разовый запрос | `query()` | Отказ |

- **Agent SDK импортирует только driver Claude Code.** Больше никто в worfy его не импортирует, поэтому сообщения SDK не
  доходят ни до слоя Session, ни до renderer.
- **Codex идёт как `codex app-server`.** worfy говорит с ним JSON-RPC через stdin и stdout. У каждой Session свой процесс.
  Каждая проверка аккаунта, опрос Limits и чтение истории запускают свой короткоживущий процесс и закрывают его после ответа;
  они идут в собственной пустой папке worfy, а не в Project. Handshake называет клиента `worfy` и не просит experimental API,
  поэтому worfy не может опереться на experimental-методы: сервер в них отказывает. Каждое входящее сообщение проверяется по
  JSON Schema закреплённого Codex; не прошедшее становится событием `unknown` и строкой в log, а не падением.
- **Item-ы Codex становятся событиями worfy.** Текст по мере прихода даёт `delta`, законченное сообщение агента — `text`,
  сводка размышлений — `thinking`. Команды, правки файлов и вызовы MCP tool-ов дают `tool_use` и `tool_result`. Конец хода
  даёт `result`, расход token-ов — `context`, запрос подтверждения — `permission_request` с четырьмя ответами Codex. События
  других thread-ов процесса, например Subagent-а, не показываются.
- **Очередь — у worfy.** Session Codex держит очередь сообщений в main, как Session Claude Code. Своя очередь Codex —
  experimental-метод. Driver умеет направить сообщение в идущий ход (`turn/steer`), но Session отдаёт ему сообщение только
  между ходами.
- **Закреплённый Codex.** worfy запускает ту версию Codex, которую поставляет, и никогда не ту, что установил пользователь:
  `@openai/codex` 0.166.0, точная версия в `package.json`. Типы протокола и JSON Schema в репозитории сгенерированы этой
  версией, и lint проверяет, что они ей соответствуют. Codex — под Apache-2.0: его LICENSE и NOTICE лежат в ресурсах сборки,
  в папке `codex`.
- **Домашняя папка Codex — пользователя.** Codex хранит вход и thread-ы в `CODEX_HOME`, иначе в `.codex` в домашней папке.
  worfy только смотрит, есть ли эта папка: без неё Codex считается Codex-ом без входа, и процесс Codex не запускается ни для
  аккаунта, ни для Limits, ни для истории.

#### Windows

Бинарник — `codex.exe` из пакета платформы, x64 или arm64. Процесс запускается без shell. Папка thread-а сравнивается с корнем
Project-а с любым разделителем и без учёта регистра.

### Implementation

| Что | Где |
| --- | --- |
| Id Vendor-ов, подписи, логотипы, подсказка о входе | `src/shared/vendors/vendor.ts` |
| Capabilities и capabilities Claude Code | `src/shared/vendors/capabilities.ts` |
| Интерфейс driver-а и его частей | `src/main/vendors/driver.ts`, `src/main/vendors/session.ts`, `src/main/vendors/account.ts`, `src/main/vendors/limits.ts`, `src/main/vendors/history.ts`, `src/main/vendors/commands.ts`, `src/main/vendors/mcp.ts`, `src/main/vendors/one-shot.ts` |
| Driver Vendor-а | `src/main/vendors/registry.ts` |
| Driver Claude Code | `src/main/vendors/claude/`; перевод сообщений SDK — `src/shared/vendors/claude/events.ts` |
| Driver Codex | `src/main/vendors/codex/index.ts`, по файлу на часть: `capabilities.ts`, `session.ts`, `account.ts`, `limits.ts`, `history.ts`, `commands.ts`, `mcp.ts`, `one-shot.ts` |
| Процесс Codex, клиент JSON-RPC, проверка по схеме | `src/main/vendors/codex/launch.ts`, `src/main/vendors/codex/app-server.ts`, `src/main/vendors/codex/rpc.ts`, `src/main/vendors/codex/schema.ts` |
| Item-ы Codex в события, approval-ы | `src/main/vendors/codex/items.ts`, `src/main/vendors/codex/approvals.ts` |
| Закреплённый бинарник | `src/main/vendors/codex/binary.ts`, `electron-builder.yml`, `build/codex/` |
| Сгенерированные типы и схема протокола | `src/main/vendors/codex/protocol/`, `scripts/codex-protocol.mjs` |
| Vendor Session и «New session» | `src/main/agent/node-sessions.ts`, `src/main/agent/app-registry.ts` |
| Выбор Vendor-а и значок | `src/renderer/session/NewSessionVendor.tsx`, `src/renderer/session/VendorBadge.tsx`, `src/renderer/session/rail/VendorRail.tsx` |
| Settings → Vendors | `src/renderer/settings/VendorsSection.tsx`, `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts` |
| Пикеры, карточка подтверждения и slash-меню по capabilities | `src/renderer/session/useCapabilities.ts`, `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/SlashMenu.tsx` |
| Session-ы Codex этого Project-а | `src/main/vendors/codex/sessions-on-canvas.ts` |

**Поток данных.** «New session» с Vendor-ом уходит в main, который проверяет вход через часть account этого Vendor-а и
запускает Session на его driver-е. Session получает `AgentEvent` от SessionHandle driver-а, каким бы ни был Vendor, и
отправляет их во все окна. Renderer спрашивает `agent.capabilities` о capabilities Session и строит по ним пикеры, карточку
подтверждения и slash-меню.

**Фейк Codex.** Test-ы никогда не запускают настоящий Codex, не входят в аккаунт и не читают `~/.codex` разработчика. Под
`WORFY_CODEX=fake` driver запускает `test/fixtures/codex-app-server/fake-app-server.mjs` под исполняемым файлом самого worfy
вместо бинарника. Фейк играет сценарий из `test/fixtures/codex-scripts/` по шагам: `WORFY_CODEX_SCRIPT` называет сценарий
(по умолчанию `turn`), `WORFY_CODEX_LOG` — файл, куда фейк пишет request-ы worfy, `WORFY_CODEX_HOME` хранит его thread-ы.
`WORFY_CODEX=absent` означает сборку без Codex. Под vitest настоящий бинарник не запускается и без `WORFY_CODEX`.
`test/setup-contract.ts` и `test/e2e/launch-env.ts` выставляют `WORFY_CODEX=fake` и `CODEX_HOME` во временной папке для каждого
прогона.

**Compatibility suite.** `test/contract/codex-compat.test.ts` связывает test-ы с закреплённым Codex. Записи живого app-server в
`test/fixtures/codex-messages/` должны быть сняты с закреплённой версии, каждое записанное сообщение должно проходить её JSON
Schema, а у каждого шага сценариев фейка должны быть вид, пути ключей и типы, которые есть в записях, или исключение с
причиной. Записи снимает владелец командой `scripts/codex-capture.mjs --use-my-login`, которая запускает закреплённый Codex с
`CODEX_HOME` во временной папке; без этого флага и под CI скрипт отказывает.

**Основные test-ы.**

- Граница: `test/contract/vendor-sdk-imports.test.ts` (SDK импортирует только driver Claude Code),
  `test/contract/vendor-imports.test.ts`, `test/unit/vendor-driver-types.test.ts`, `test/contract/session-vendor-parts.test.ts`.
- Driver Codex: `test/unit/codex-capabilities.test.ts`, `test/unit/codex-items.test.ts`, `test/unit/codex-rpc.test.ts`,
  `test/unit/codex-binary.test.ts`, `test/unit/codex-in-build.test.ts`, `test/unit/codex-protocol.test.ts`,
  `test/unit/codex-limits.test.ts`, `test/unit/codex-history.test.ts`, `test/contract/codex-app-server.test.ts`,
  `test/contract/codex-session.test.ts`, `test/contract/codex-account.test.ts`, `test/contract/codex-history.test.ts`,
  `test/contract/codex-session-limits.test.ts`, `test/contract/codex-session-mcp.test.ts`, `test/contract/codex-fake.test.ts`.
- Интерфейс: `test/contract/sessions-vendor.test.ts`, `test/contract/vendors-ipc.test.ts`,
  `test/unit/settings-vendors.test.tsx`, `test/unit/vendor-badge.test.tsx`, `test/unit/permission-card.test.tsx`,
  `test/e2e/vendor-picker.spec.ts`, `test/e2e/codex-session.spec.ts` (preset-ы, slash-меню и approval на фейке),
  `test/e2e/onboarding-codex.spec.ts`, `test/e2e/limits-vendors.spec.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts`,
  `test/e2e/codex-transcript-search.spec.ts`.
