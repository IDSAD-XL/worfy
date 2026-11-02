# worfy-multi-vendor: Session-ы на Claude Code и на Codex

Status: ждёт приёмки владельца. Решения 06–09 принял Orchestrator по поручению владельца 2026-11-02 («да, можешь
работать над этим эпиком полностью на автопилоте»). Владелец 2026-11-02 ответил на вопросы Q1–Q11 к spec (раздел
«Решения владельца»); остальное он подтверждает при приёмке первого выпуска (Ticket 32).
Source: карта [map.md](map.md) и решения 01–10 этой папки (01 — слово владельца; 02–05 и 10 — research с
источниками; 06–09 — решения Orchestrator-а); [CONTEXT.md](../../CONTEXT.md), термины Vendor, Session, Subagent,
Orchestrator, Limits, Harness, Autopilot, Run, Wave; [ADR-0094](../../docs/adr/0094-vendor-seam.md) (граница
Vendor-а — решение этого Epic-а); [ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние — вне
репозитория), [ADR-0008](../../docs/adr/0008-claude-code-native-binary-path.md) (поставка бинарника),
[ADR-0009](../../docs/adr/0009-claude-code-login-check-account-info.md) (worfy не держит ключей),
[ADR-0040](../../docs/adr/0040-harness-delivery-local-marketplace.md) (установка Harness).
Ticket-ы: Epic `worfy-multi-vendor`, 35 Ticket-ов, нумерация с `11` (01–10 — Ticket-ы-решения карты в этой же
папке). Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`, как у worfy-flight-recorder.

## Цель и что видит пользователь

Сейчас worfy ведёт только Claude Code. После Epic-а у Session есть Vendor: Claude Code (Anthropic) или Codex
(OpenAI, вход по подписке ChatGPT). Третий Vendor добавляется новой реализацией границы, а не правкой всего
приложения (Ticket 01); Ticket 10 проверил это на Gemini CLI и OpenCode.

**Первый выпуск — чат Session на Codex (решение 07; владелец, Q1):**

1. «New session» на Canvas и в rail-е спрашивает Vendor-а: Claude Code или Codex. У Project есть Vendor по
   умолчанию (Settings Project-а); пока его не выбрали — Claude Code (владелец, Q7). В одном Project живут Session-ы
   обоих Vendor-ов.
2. Node Session, rail и шапка Session view показывают текстовую подпись Vendor-а с нейтральным значком, без
   логотипов (владелец, Q10). Вместо подписи `claude` у сообщений агента — имя Vendor-а.
3. Чат Codex работает как чат Claude: очередь сообщений; сообщение во время хода уходит в ход (steer), если Vendor
   это умеет; Interrupt; Resume.
4. Пикеры Model и effort — из списка Vendor-а. Permission — presets словами Vendor-а: у Codex «Read only», «Auto»,
   «Full access»; у Claude — четыре нынешних режима.
5. Codex спрашивает разрешение на команду или правку файлов — worfy показывает тот же диалог подтверждения, варианты
   ответа даёт Codex.
6. Slash-меню — skills Codex и его встроенные команды.
7. Session-ы Codex Project-а — и начатые в worfy, и начатые в терминале (по `cwd`) — видны Node-ами на Canvas с
   транскриптом; их можно продолжить.
8. Tool-ы worfy у Codex: Canvas, Cards `worfy.ask`, Browser — через MCP по HTTP (владелец, Q1).
9. Limits — раздел на каждого Vendor-а, в которого выполнен вход: у Claude 5 часов и 7 дней, у Codex окна его плана
   (у Plus — 5 часов, недельное — если OpenAI его присылает).
10. Onboarding находит Codex и предлагает войти — необязательно (владелец, Q7). Пользователь без Codex ошибки не
    видит.
11. Поиск по транскриптам находит и Session-ы Codex.
12. Функции интерфейса, которых у Codex действительно нет (например, plan mode), показаны недоступными с tooltip
    причины («Codex does not support …»; владелец, Q2). Скрыто только то, что для Vendor-а не имеет смысла. worfy
    ничего не эмулирует.

**Второй выпуск:** Node-ы Subagent-ов Codex; Harness на Codex с теми же гарантиями workflow, что на Claude
(владелец, Q5); Autopilot и Wave-ы на Orchestrator-е Codex с budget Limits; Flight Recorder по Run-ам Codex;
Binding. До него Harness в Codex не установлен: capability `harness` у Codex — нет, skills workflow в Session Codex
нет.

**Позже, отдельными решениями после Epic-а:** Terminal AI на Codex; смешанные Vendor-ы по ролям агентов; Link ко
второй Machine с Codex. **Никогда:** всё, что требует API-ключа.

## Решения владельца

Владелец 2026-11-02 ответил на вопросы Q1–Q11 к spec (цитаты — его слова).

- **Q1. MCP worfy в первом выпуске** — «думаю стоит сразу это сделать». `worfy-canvas`, Cards `worfy.ask` и
  `worfy-browser` для Codex по HTTP — до приёмки первого выпуска (Ticket 33).
- **Q2. Недоступное — недоступным с причиной в tooltip** — «ок». Только для функций интерфейса, которых у Codex
  действительно нет.
- **Q3. worfy поставляет свой закреплённый бинарник Codex** — «ок» (Ticket 17).
- **Q4. Hook-и Harness подтверждаются в Codex заново после каждого обновления; Autopilot отказывает, пока они не
  подтверждены** — «ок, допустим» (Ticket 39).
- **Q5. Reviewer Codex «только советует», пока не доказано** — отклонено: «нужен полный функционал неизменный от
  выбора вендора что бы сохранить поведение ворфи». Гарантии workflow на Codex — те же, что на Claude: read-only
  reviewer и scout, gate до конца Ticket-а, guard-ы Bash и записи, verdict-ы review. Чего нет у Codex, держат
  Harness или worfy; каждую гарантию доказывает parity suite на фейке app-server (раздел «Гарантии workflow на
  Codex»; Ticket-ы 36, 44, 45).
- **Q6. Условия OpenAI** — «да»: работаем сейчас, проверяем заново перед публичным выпуском.
- **Q7. Claude Code — Vendor по умолчанию; Codex в onboarding необязателен** — «ок».
- **Q8. План владельца** — «у меня плюс, самый дешевый за 20». ChatGPT Plus: окно 5 часов, недельное может
  действовать. Приёмки идут на Plus.
- **Q9. Первый выпуск принимается на Mac, ПК — в приёмке второго** — «ок» (Ticket-ы 32 и 43).
- **Q10. Без логотипов Vendor-ов, текстовая подпись с нейтральным значком** — «ок» (Ticket 24).
- **Q11. Wave-ы 1–2 начинаются на Autopilot сразу после merge spec-а** — «ок».

## Модель

Граница — ADR-0094. Остальной worfy говорит только в типах worfy; каждый Vendor переводится в них своим driver-ом.

**Vendor.** `VendorId` — `claude` или `codex` (`src/shared/vendors/vendor.ts`, Ticket 13). Сохранённые данные без
поля Vendor-а читаются как `claude`: все нынешние Session-ы, Node-ы и Project-ы — Claude Code.

**Driver** (`src/main/vendors/<id>/`, интерфейс — `src/main/vendors/driver.ts`; Ticket 13). Типы каждой части — свой
файл в `src/main/vendors/`. Ticket 13 создаёт `claude/index.ts` и файлы частей Claude, Ticket 17 — `codex/index.ts` и
stub-и частей Codex; дальше каждый Ticket правит только файл своей части.

| Часть | Что даёт | Claude | Codex |
|---|---|---|---|
| capabilities | флаги и списки, которые читает интерфейс | статические, из нынешнего кода | статические + по версии и ответу `initialize` |
| session | `start(opts)`, `resume(id)` → SessionHandle | Agent SDK `query()` | `thread/start`, `thread/resume`, `turn/*` |
| account | `check()` → подключения; `startLogin()` | `accountInfo()` | `account/read`, `account/login/start` |
| limits | `read()` → `LimitWindow[]` + события | `rate_limit_event`, statusline, Limits probe `usage` | `account/rateLimits/read`, `account/rateLimits/updated` |
| history | `list(cwd)`, `read(id)` → записи транскрипта | JSONL `~/.claude/projects` | `thread/list`, `thread/read` |
| commands | строки slash-меню | `supportedCommands()`, `system/init` | `skills/list` + встроенные |
| mcp | как tool-ы worfy доходят до агента | SDK-сервер в процессе | HTTP endpoint на `127.0.0.1` |
| oneShot | разовый запрос | `query()` черновика (read-only tool-ы, structured output), Terminal AI, Limits probe | первому выпуску не нужен |

**Capabilities** (`src/shared/vendors/capabilities.ts` — в shared, потому что их читает renderer). Флаги:
`subagents`, `hooks`, `inProcessMcp`, `canvasTools`, `steer`, `resume`, `historyList`, `modelSwitchStable`,
`oneShotToolFree`, `commandsComplete`, `harness`; `limitSource` — `windows`, `errorOnly` или `none` (Ticket 10);
списки `permissionPresets` (`{id, label, description}`), `effortLevels`. Интерфейс не знает имён Vendor-ов: Pickers,
диалог подтверждения, slash-меню и Limits берут всё отсюда. Недоступное — с причиной `unsupported: {flag: reason}`
для tooltip.

**Account** (Ticket 10). `check()` — список подключений `{provider, signedIn, email, plan}`; у Claude и Codex —
одно. `startLogin()` — `{kind: 'url', url}` (Codex), `{kind: 'vendorOpensBrowser'}` или `{kind: 'terminal',
command}`.

**SessionHandle** (`src/main/vendors/session.ts`). `send(message)`, `interrupt()`, `close()`, `setModel()`,
`setEffort()`, `setPermissionPreset()`, `events: AsyncIterable<AgentEvent>`. Сообщение — `{text, attachments}` в
типах worfy, а не `SDKUserMessage`.

**Нейтральные события.** Модель — нынешний `AgentEvent` (`src/shared/agent/events.ts:67`). Меняется:

- `permission_request` (`events.ts:91`) получает `options: {id, label, kind}[]` от Vendor-а вместо постоянного набора
  `allow` / `always_allow` / `deny` (`events.ts:54`); у Claude это те же три варианта, у Codex — `accept`,
  `acceptForSession`, `decline`, `cancel`. `subject` — что спрашивают: tool (Claude), команда или правка файлов
  (Codex). Канал ответа `agent.permission` (`src/shared/ipc/agent.ts:108-114`) принимает id варианта (Ticket 14).
- `rate_limit` (`events.ts:234`) заменяется на `limits` (список `LimitWindow`) и `limit_reached` (`windowId`,
  `resetsAt`, `reason`: `window` или `quota`) — Ticket 11.
- `unknown.sdkType` остаётся как «тип сообщения Vendor-а».
- Перевод сообщений SDK (`sdkMessageToEvents`, `events.ts:290-685`) уходит из модели в
  `src/shared/vendors/claude/events.ts` (Ticket 14): чистый модуль без импорта SDK, в shared — потому что разбор
  транскриптов Claude (`src/shared/transcript/parse.ts`) зовёт его helper-ы. Item-ы Codex → события — в driver Codex
  (Ticket 20).

Соответствие Codex → `AgentEvent` (Ticket 20): `item/agentMessage/delta` → `delta`; `agentMessage` → `text`;
`reasoning` (summary) → `thinking`; `commandExecution`, `fileChange`, `mcpToolCall` → `tool_use` / `tool_result`;
`turn/completed` → `result`; `error` → `result` с ошибкой; `thread/tokenUsage/updated` → `context`;
`item/*/requestApproval` → `permission_request`; `usageLimitExceeded` → `limit_reached`.

**LimitWindow** (`src/shared/agent/limits.ts`, Ticket 11): `{vendor, provider?, id, label, usedPercent,
windowMinutes, resetsAt, state}`; `usedPercent`, `windowMinutes` и `resetsAt` могут быть `null`; `state` — `ok`,
`warning`, `reached` или `null`; рядом — `receivedAt` и `source`. Claude: `five_hour` (300 минут), `seven_day` (10080),
прочие окна SDK; `allowed` → `ok`, `allowed_warning` → `warning`, `rejected` → `reached`. Codex: `primary` и
`secondary` с длительностью из ответа; подпись по длительности, как у TUI Codex: `5h`, `daily`, `weekly`, `monthly`.
Хранимое состояние Claude (`LimitsState`, `limits.json`) не меняется: `LimitWindow` — вид поверх него
(`limitWindows(vendor, state)`). Панель переходит на этот вид в Ticket-е 26, budget и прогноз — в Ticket-е 38.

**History.** Записи транскрипта — `TranscriptEntry` (`src/shared/transcript/parse.ts:38`): событие `AgentEvent` плюс
uuid, время, Subagent ли. Claude читает свои JSONL как сейчас (`src/main/claude-home/*`). Codex отдаёт те же записи
из `thread/read {includeTurns}`; rollout-файлы worfy не читает (Ticket 05).

## Codex: бинарник и совместимость

- **Закреплённая версия** (владелец, Q3). `@openai/codex` в `package.json` с точной версией (сейчас stable —
  0.166.0; Ticket 17 берёт последнюю stable на момент claim). Платформенные пакеты распаковываются из `app.asar`, как
  у Claude (`electron-builder.yml:43-52`). Путь — `codexExecutablePath(runtime)` рядом с `claudeExecutablePath`
  (`src/main/agent/options.ts:103`). LICENSE и NOTICE Codex (Apache-2.0) — в ресурсах сборки.
- **Сгенерированные типы и схемы.** `scripts/codex-protocol.mjs` запускает закреплённый Codex:
  `codex app-server generate-ts` и `codex app-server generate-json-schema` (команда есть в `rust-v0.166.0`,
  `codex-rs/cli/src/main.rs:647`, `:735`), без `--experimental`. Вывод — `src/main/vendors/codex/protocol/ts/` и
  `protocol/json/` с файлом `VERSION`; `pnpm lint` сверяет `VERSION` с `package.json`. Входящие сообщения во время
  работы проверяет `ajv` по этим JSON Schema (Ticket 19); сценарии фейка и записи — тоже (Ticket-ы 18, 30). Схем
  руками нет.
- **Без experimental.** `initialize` без `capabilities.experimentalApi`: сервер отвергает experimental-методы, и
  worfy на них незаметно не опирается (Ticket 02). Очередь сообщений — своя (`src/main/agent/queue.ts`), а не
  `thread/queue/*`.
- **Compatibility suite** (Ticket 30), по образцу `test/contract/sdk-compat.test.ts`: записи живого Codex
  (`test/fixtures/codex-messages/`, manifest с версией) обязательны — без них и при другой версии test красный;
  записи и сценарии фейка проходят JSON Schema; фейк играет только виды из записей. Записи снимает владелец одной
  командой `scripts/codex-capture.mjs --use-my-login` на Plus; поднятая версия Codex без новых записей — красный
  test.
- **Процесс на Session.** Один `codex app-server` на Session, `CODEX_HOME` — пользователя, кроме test-ов.
  `clientInfo.name` = `worfy`: по `originator` worfy узнаёт свои thread-ы (Ticket 05).

## Фейк и test-ы

Test-ы никогда не запускают настоящий Codex, не входят ни в какой аккаунт и не читают `~/.codex` разработчика.

- **Фейк app-server** (Ticket 18): `test/fixtures/codex-app-server/fake-app-server.mjs` — Node-скрипт, который
  говорит JSON-RPC по stdio, как app-server. Сценарии — `test/fixtures/codex-scripts/<имя>.jsonl` (ответы,
  notification-ы и server→client request-ы по шагам), как `test/fixtures/agent-scripts/` у фейка Claude.
- **Переключатель** — `WORFY_CODEX=fake` (как `WORFY_AGENT=fake`, `src/main/agent/app-registry.ts:171`): driver
  Codex запускает фейк через `process.execPath` вместо бинарника. `WORFY_CODEX_SCRIPT` — сценарий,
  `WORFY_CODEX_LOG` — файл, куда фейк пишет request-ы worfy, `WORFY_CODEX_HOME` — thread-ы фейка.
- **Изоляция всех test-ов** (Ticket 18): `test/setup-contract.ts` и `test/e2e/launch-env.ts` выставляют
  `WORFY_CODEX=fake` и `CODEX_HOME` во временной папке, как сейчас `WORFY_CLAUDE_HOME`
  (`test/setup-contract.ts:98-103`, `test/e2e/launch-env.ts:84-85`); contract test проверяет, что под test-ами
  бинарник `@openai/codex` не запускается.
- **Состояния аккаунта в фейке:** вход по ChatGPT с планом Plus (окно `5h` и недельное) и Pro (одно недельное), без
  входа, вход после `account/login/start`; `usageLimitExceeded` с исчерпанным окном и без него.
- **Hook-и в фейке** (Ticket 44): фейк исполняет hook-и установленного plugin-а по правилам Codex закреплённой
  версии и эмулирует sandbox `read-only` thread-а (правка файла и запись на диск — отказ); поля входа hook-ов
  сверяются с записями Ticket-а 30. На нём идёт parity suite (Ticket 45).
- Claude в тех же test-ах — как сейчас, `WORFY_AGENT=fake`; hook-ов фейк Claude не исполняет.

## Гарантии workflow на Codex

Владелец, Q5: поведение worfy не зависит от выбора Vendor-а. Подробно — ADR-0094, п. 6.

| Гарантия | Claude | Codex | Ticket |
|---|---|---|---|
| gate до конца работы | `TaskCompleted`, `TeammateIdle`, `Stop` | `Stop` и `SubagentStop` блокируют конец хода, пока gate красный | 36 |
| read-only reviewer и scout | список `tools` агента без `Edit` / `Write`; `Bash` есть | `PreToolUse` отказывает в `apply_patch` по `agent_type`, shell разрешён; запасной путь — отдельный thread Codex с sandbox `read-only` | 36 |
| guard Bash и записи | `guard.mjs` | тот же `guard.mjs` с matcher-ами Codex; ввод в открытую exec Session запрещён агентам Harness | 36 |
| verdict-ы review | `bin/` и `gh` | те же; `GH_TOKEN` — env процесса app-server | 36 |
| правила в начале Session и Subagent-а | `SessionStart`, `SubagentStart` | те же события | 36 |
| учёт Session | `SessionEnd` | `SessionEnd` не дольше 3 s | 36 |
| skills | plugin и зависимость `mattpocock-skills` | тот же plugin и зависимость отдельным plugin-ом | 35 |
| hook-и включены | всегда | только после подтверждения в `/hooks`; без него Run на Codex не стартует | 39 |

Паритет — ровно те гарантии, что у Claude сейчас, не строже. Доказательство — parity suite (Ticket 45): сценарии
идут на фейке app-server с hook-ами (Ticket 44) и сверяются с таблицей гарантий; каждая строка таблицы называет test,
который доказывает ту же гарантию у Claude (test-ы hook-ов Harness), или новый test стороны Claude, если такого нет.
Фейк Claude hook-и не исполняет и не меняется. Autopilot на Codex (Ticket 37) ждёт этот suite. Живой Codex проверяет приёмка (Ticket 43).

## Windows

- **Codex на Windows — native**, в PowerShell, без WSL. npm-пакеты есть для `win32-x64` и `win32-arm64`, бинарник —
  `codex.exe` (Ticket 02). Путь строится разделителями платформы runtime, как `claudeExecutablePath`.
- **Sandbox Codex на Windows:** рекомендован `mxc`; запасные — `elevated` (один раз нужна настройка с правами
  администратора, UAC) и `unelevated`. worfy не выбирает sandbox сам: Codex берёт свою настройку, а его сообщение о
  настройке worfy показывает как есть. Доступен ли `mxc` на ПК владельца — проверяет приёмка второго выпуска
  (владелец, Q9; Ticket 43).
- **Пути.** `CODEX_HOME` по умолчанию — `%USERPROFILE%\.codex`. `cwd` Session сравнивается с корнем Project-а без
  учёта регистра и с одним разделителем — `isInsidePath` (`src/main/claude-home/registry.ts:80`).
- **Процесс.** app-server стартует без shell; остановка ждёт выхода процесса, как у Claude Code
  (`ClaudeCodeProcess`, `src/main/agent/session/types.ts:30`).
- **Harness на Codex.** Hook-и Harness стартуют через `node` (ADR-0055) — работают и под Codex на Windows. Агенты —
  `%USERPROFILE%\.codex\agents\worfy-*.toml`.
- **Платформенные Ticket-ы** (ADR-0056, п. 2; ADR-0071): код с ветками по платформе, упаковка, скрипты Harness —
  вердикт Windows до merge. Это Ticket-ы 16, 17, 18, 19, 22, 27, 35, 36, 44, 45; в их файлах — пометка
  «Платформенный».

## Решено без владельца

1. **Второй выпуск начинается после приёмки первого.** Ticket-ы второго выпуска, которым иначе ничего не мешает,
   заблокированы Ticket-ом 32: владелец подтверждает решения 06–09 при этой приёмке.
2. **Contract test импорта SDK** (Ticket 12) сначала идёт со списком нынешних файлов-исключений; Ticket-ы 14 и 15
   его не правят; Ticket 16 переносит оставшиеся файлы, опустошает список и делает test строгим.
3. **Хранимое состояние Limits Claude в первых Wave-ах не меняется.** `LimitWindow` — вид поверх него: так Wave 1
   не меняет поведения Claude (порог Terminal AI, budget, Journal остаются как есть), а читатели переходят на вид в
   своих Ticket-ах (26, 38). Поле `state` вместо флага отказа держит и `allowed_warning` Claude.
4. **Journal не меняет формат в первом выпуске.** Run-ы первого выпуска — только на Claude, строка `limits` Journal
   остаётся `{five_hour, seven_day}` (`src/shared/autopilot/journal.ts:351`). Окна Codex в Journal — Ticket 38.
5. **Orchestrator в первом выпуске — Claude Code.** Выбор Vendor-а у Orchestrator-а — Ticket 37.
6. **Первый выпуск требует Claude Code для first-run, черновика профиля Project и Terminal AI**: `oneShot` Codex
   нужен им только вместе с Terminal AI на Codex, а это «позже». Пользователь только с Codex — вне Epic-а.
7. **Codex виден в интерфейсе с Ticket-а 24.** До него driver Codex есть, но выбрать его негде; Wave-ы 1–6 ничего
   не меняют для пользователя.
8. **Vendor по умолчанию Project-а** — поле `defaultVendor` в `<Project data folder>/settings.json`
   (`projectSettingsSchema`, `src/shared/projects/action-templates.ts:139`); нет поля — `claude`.
9. **Предупреждение при Resume Session, начатой в терминале.** Живая ли она, по Codex не узнать (Ticket 05, «Чего не
   знаем»): Resume такой Session спрашивает подтверждение «This Session may be open in a terminal».
10. **Тексты интерфейса — английские** (`scripts/check-cyrillic.mjs`); presets Codex — «Read only», «Auto», «Full
    access», как в решении 07.
11. **Файлы частей driver-ов создаются заранее** (Ticket-ы 13 и 17): параллельные Ticket-ы одной Wave правят разные
    файлы частей и не трогают `index.ts`.
12. **TOML агентов — только в `~/.codex/agents/`, с префиксом `worfy-`** (review PR #1234): worfy не пишет своё
    состояние в репозиторий Project-а (ADR-0005).

## Ticket-ы

UI — снимки в обеих темах в `.scratch/worfy-multi-vendor/evidence/<NN>/`. Test-ы — внутри Ticket-ов. Платформенный
PR (ADR-0056, ADR-0071) — вердикт Windows до merge.

**Первый выпуск.**

- **11 — LimitWindow: нейтральная модель Limits и события `limits` / `limit_reached`.** Чистый refactor.
  Blocked by: —. Не UI.
- **12 — Contract test: SDK Claude только в `src/main/vendors/claude/`.** Со списком исключений и запретом
  реэкспорта типов SDK. Blocked by: —. Не UI.
- **13 — Интерфейс driver-а, capabilities и driver Claude.** Типы частей (с правками Ticket-а 10), реестр, файлы
  частей Claude — обёртки. Чистый refactor, без переноса файлов. Blocked by: —.
- **14 — Session поверх SessionHandle.** Слой Session получает `AgentEvent` от driver-а; перевод SDK и
  `canUseTool` → `permission_request` с вариантами Vendor-а — в driver Claude. Blocked by: 11, 13.
- **15 — account, limits и oneShot Claude через driver.** first-run, Plan, черновик профиля Project, Limits probe.
  Blocked by: 11, 13.
- **16 — MCP-серверы, Terminal AI и перенос `options.ts`; contract test строгий.** Blocked by: 12, 14, 15.
  Платформенный.
- **17 — Бинарник Codex, типы и JSON Schema протокола, capabilities и stub-и частей Codex.** Blocked by: 13.
  Платформенный.
- **18 — Фейк app-server Codex (`WORFY_CODEX=fake`) и изоляция test-ов.** Blocked by: 17. Платформенный.
- **19 — Клиент app-server.** JSON-RPC по stdio с проверкой `ajv`, процесс на Session. Blocked by: 17, 18.
  Платформенный.
- **20 — SessionHandle Codex.** Blocked by: 14, 19.
- **21 — Account и Limits Codex.** Blocked by: 11, 15, 19.
- **22 — History и slash-команды Codex.** Blocked by: 20. Платформенный.
- **23 — Vendor у Session и у Project.** Blocked by: 14, 17, 18, 20, 21. Не UI.
- **24 — Выбор Vendor-а и подпись.** Blocked by: 17, 18, 20, 21, 23. UI.
- **25 — Пикеры, диалог подтверждения и slash-меню по capabilities.** Blocked by: 22, 24. UI.
- **26 — Limits по Vendor-ам в панели.** Blocked by: 21. UI.
- **27 — Session-ы Codex на Canvas.** Blocked by: 22, 23, 24. UI. Платформенный.
- **28 — Поиск по транскриптам Codex.** Blocked by: 22, 24. UI.
- **29 — Onboarding и вход в Codex.** Blocked by: 21, 24. UI.
- **30 — Compatibility suite Codex и скрипт записи.** Записи снимает владелец. Blocked by: 22. Не UI.
- **31 — Документация первого выпуска.** Blocked by: 25, 26, 27, 28, 29, 30, 33. Не UI.
- **32 — Приёмка первого выпуска с владельцем.** Mac Stable, настоящий вход в Codex на Plus. Blocked by: 11–31, 33.
- **33 — MCP worfy по HTTP для Codex.** Tool-ы Canvas и Browser, Cards `worfy.ask`; `127.0.0.1`, token на Session.
  Blocked by: 16, 20.

**Второй выпуск** (после приёмки первого, «Решено без владельца», п. 1).

- **34 — Subagent-ы Codex на Canvas.** Blocked by: 32. UI.
- **35 — Install Harness в Codex.** Локальный marketplace, `mattpocock-skills`, TOML `worfy-*` в `~/.codex/agents`,
  проверка версии. Blocked by: 32. Платформенный.
- **36 — Гарантии Harness под Codex.** Gate на `Stop` / `SubagentStop`, read-only reviewer и scout, guard-ы,
  `SessionEnd` ≤ 3 s. Blocked by: 35, 44. Платформенный.
- **37 — Orchestrator и Autopilot на Codex.** Blocked by: 33, 35, 45.
- **38 — Budget, прогноз и остановка по Limits Vendor-а.** Blocked by: 37.
- **39 — Подтверждение hook-ов Harness в Codex.** Шаг после установки и обновления; отказ preflight Autopilot.
  Blocked by: 35, 37. UI.
- **40 — Flight Recorder по Run-ам Codex.** Blocked by: 34, 37. Не UI.
- **41 — Binding для Session-ов Codex.** Blocked by: 32. Не UI.
- **42 — Документация второго выпуска.** Blocked by: 34–41, 44, 45. Не UI.
- **43 — Финальная приёмка с владельцем.** Mac Stable на Plus, затем Windows-ПК. Blocked by: 34–42, 44, 45.
- **44 — Фейк app-server исполняет hook-и по правилам Codex.** Blocked by: 32. Платформенный.
- **45 — Parity suite гарантий workflow.** Blocked by: 35, 36, 44. Платформенный.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов нет. Таблица — план. Wave,
которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 11 | `src/shared/agent/limits.ts`, `src/shared/agent/events.ts`, `src/main/agent/limits.ts`, `test/unit/limits.test.ts`, `test/contract/limits.test.ts`, `test/contract/agent-events.test.ts` | 1 |
| 12 | `test/contract/vendor-sdk-imports.test.ts` | 1 |
| 13 | `src/shared/vendors/vendor.ts`, `src/shared/vendors/capabilities.ts`, `src/main/vendors/driver.ts`, `src/main/vendors/registry.ts`, `src/main/vendors/session.ts`, `src/main/vendors/account.ts`, `src/main/vendors/limits.ts`, `src/main/vendors/history.ts`, `src/main/vendors/commands.ts`, `src/main/vendors/one-shot.ts`, `src/main/vendors/mcp.ts`, `src/main/vendors/claude/`, `src/main/agent/session/registry.ts`, `src/main/agent/app-registry.ts`, `test/unit/capabilities.test.ts`, `test/unit/vendor-driver-types.test.ts` | 1 |
| 14 | `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/shared/vendors/claude/events.ts`, `src/shared/transcript/parse.ts`, `src/main/agent/session.ts`, `src/main/agent/session/run.ts`, `src/main/agent/session/types.ts`, `src/main/agent/session/input-queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/attachments.ts`, `src/shared/agent/events.ts`, `src/shared/ipc/agent.ts`, `src/main/ipc/agent.ts`, `src/renderer/session/PermissionCard.tsx`, `test/contract/agent-session.test.ts`, `test/contract/permissions.test.ts` | 2 |
| 15 | `src/main/vendors/claude/account.ts`, `src/main/vendors/claude/limits.ts`, `src/main/vendors/claude/one-shot.ts`, `src/main/ipc/first-run.ts`, `src/main/ipc/plan-preset.ts`, `src/main/ipc/projects.ts`, `src/main/projects/connect.ts`, `src/main/agent/limits-usage.ts`, `test/contract/claude-one-shot.test.ts` | 2 |
| 17 | `package.json`, `pnpm-lock.yaml`, `electron-builder.yml`, `scripts/codex-protocol.mjs`, `src/main/vendors/codex/`, `src/main/vendors/registry.ts`, `test/unit/codex-binary.test.ts` | 2 |
| 16 | `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/terminal-ai.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts`, `src/main/agent/options.ts`, `src/main/agent/app-registry.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts`, `src/main/terminal-ai/assist.ts`, `src/main/terminal-ai/options.ts`, `src/main/terminal-ai/fake-backend.ts`, `src/main/ipc/harness.ts`, `src/main/ipc/projects.ts`, `test/contract/vendor-sdk-imports.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/agent-query-factory.test.ts`, `test/contract/browser-tools.test.ts`, `test/contract/workflow-profile.test.ts` | 3 |
| 18 | `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/fixtures/codex-scripts/`, `src/main/vendors/codex/launch.ts`, `test/setup-contract.ts`, `test/e2e/launch-env.ts`, `test/contract/codex-fake.test.ts` | 3 |
| 19 | `src/main/vendors/codex/app-server.ts`, `src/main/vendors/codex/rpc.ts`, `test/unit/codex-rpc.test.ts`, `test/contract/codex-app-server.test.ts` | 4 |
| 20 | `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/items.ts`, `src/main/vendors/codex/approvals.ts`, `test/unit/codex-items.test.ts`, `test/contract/codex-session.test.ts` | 5 |
| 21 | `src/main/vendors/codex/account.ts`, `src/main/vendors/codex/limits.ts`, `src/main/agent/limits-usage.ts`, `src/main/agent/limits.ts`, `test/unit/codex-limits.test.ts`, `test/contract/codex-account.test.ts` | 5 |
| 22 | `src/main/vendors/codex/history.ts`, `src/main/vendors/codex/commands.ts`, `test/unit/codex-history.test.ts`, `test/contract/codex-history.test.ts` | 6 |
| 23 | `src/shared/ipc/sessions.ts`, `src/main/ipc/sessions.ts`, `src/main/agent/node-sessions.ts`, `src/main/agent/app-node-sessions.ts`, `src/main/agent/app-registry.ts`, `src/shared/projects/action-templates.ts`, `test/contract/sessions-vendor.test.ts` | 6 |
| 26 | `src/renderer/shell/toolbar/LimitsMeter.tsx`, `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts`, `src/main/agent/limits.ts`, `test/unit/limits-meter.test.tsx`, `test/e2e/limits-vendors.spec.ts`, `scripts/e2e-specs.table.json` | 6 |
| 33 | `src/main/mcp/http-server.ts`, `src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/capabilities.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts`, `test/contract/mcp-http.test.ts` | 6 |
| 24 | `src/renderer/session/SessionView.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/rail/`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/session/VendorBadge.tsx`, `src/renderer/session/NewSessionVendor.tsx`, `src/renderer/settings/SessionsSection.tsx`, `test/unit/session-view.test.tsx`, `test/e2e/vendor-picker.spec.ts`, `scripts/e2e-specs.table.json` | 7 |
| 30 | `test/contract/codex-compat.test.ts`, `scripts/codex-capture.mjs`, `test/fixtures/codex-messages/` | 7 |
| 25 | `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/SlashMenu.tsx`, `src/main/agent/commands.ts`, `test/unit/pickers-captions.test.tsx`, `test/unit/permission-card.test.tsx`, `test/e2e/codex-session.spec.ts`, `scripts/e2e-specs.table.json` | 8 |
| 27 | `src/main/vendors/codex/sessions-on-canvas.ts`, `src/main/ipc/claude-home.ts`, `src/shared/ipc/claude-home.ts`, `src/renderer/claude-home/session-nodes.ts`, `src/renderer/claude-home/useClaudeHome.ts`, `test/contract/codex-sessions-on-canvas.test.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts`, `scripts/e2e-specs.table.json` | 8 |
| 29 | `src/main/ipc/first-run.ts`, `src/renderer/getting-started/GettingStartedPanel.tsx`, `src/renderer/settings/VendorsSection.tsx`, `src/renderer/settings/sections.ts`, `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts`, `test/e2e/onboarding-codex.spec.ts`, `scripts/e2e-specs.table.json` | 8 |
| 28 | `src/main/claude-home/search.ts`, `src/main/ipc/claude-home.ts`, `src/renderer/palette/CommandPalette.tsx`, `test/contract/claude-home-search.test.ts`, `test/unit/palette-commands.test.tsx` | 9 |
| 31 | `docs/features/vendors.md`, `docs/features/ru/vendors.md`, `docs/features/sessions.md`, `docs/features/transcripts-and-usage.md`, `docs/features/onboarding.md`, `docs/features/README.md`, `docs/features/ru/README.md` | 10 |
| 32 | `.scratch/worfy-multi-vendor/spec.md` | 11 |
| 34 | `src/main/vendors/codex/subagents.ts`, `src/renderer/claude-home/subagents.ts`, `test/contract/codex-subagents.test.ts` | 12 |
| 35 | `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts`, `src/main/harness/install.ts`, `src/main/ipc/harness.ts`, `test/contract/harness-codex-install.test.ts` | 12 |
| 41 | `src/main/vendors/codex/binding.ts`, `src/main/claude-home/binding-signals.ts`, `test/contract/codex-binding.test.ts` | 12 |
| 44 | `test/fixtures/codex-app-server/hook-runner.mjs`, `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/contract/codex-fake-hooks.test.ts` | 12 |
| 36 | `harness/hooks/stop.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/session-end.mjs`, `harness/hooks/hooks.json`, `harness/hooks/tests/`, `harness/README.md` | 13 |
| 45 | `test/contract/codex-parity.test.ts`, `harness/hooks/tests/`, `harness/bin/tests/` | 14 |
| 37 | `src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`, `src/main/vendors/codex/session.ts`, `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `test/unit/autopilot-run.test.ts`, `test/contract/codex-orchestrator.test.ts` | 15 |
| 38 | `src/shared/autopilot/budget.ts`, `src/shared/autopilot/resume-at.ts`, `src/shared/autopilot/limits-estimate.ts`, `src/shared/autopilot/forecast.ts`, `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`, `test/unit/autopilot-budget.test.ts`, `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits.test.ts` | 16 |
| 40 | `src/main/flight-recorder/transcripts.ts`, `src/shared/flight-recorder/from-transcript.ts`, `test/contract/flight-recorder-transcripts.test.ts` | 16 |
| 39 | `src/main/harness/codex-hooks-trust.ts`, `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`, `src/renderer/harness/`, `test/contract/codex-hooks-trust.test.ts`, `test/unit/autopilot-run.test.ts` | 17 |
| 42 | `docs/features/vendors.md`, `docs/features/ru/vendors.md`, `docs/features/harness.md`, `docs/features/autopilot.md`, `docs/features/flight-recorder.md` | 18 |
| 43 | `.scratch/worfy-multi-vendor/spec.md` | 19 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave. Исключение — `scripts/e2e-specs.table.json`: в него Ticket-ы
только дописывают строку своего нового e2e spec, общим файлом он не считается, конфликт строк решает Orchestrator при
merge.

- **Wave 1 — 11, 12, 13.** Чистые refactor-ы: поведение Claude не меняется, существующие test-ы — без правок (кроме
  формы события в `agent-events.test.ts`, Ticket 11). Файлы не переезжают; общих файлов нет. Начинается на
  Autopilot сразу после merge spec-а (владелец, Q11).
- **Wave 2 — 14, 15, 17.** 14 и 15 ждут 11 и 13 и правят разные файлы частей Claude (`claude/session.ts` и
  `claude/account.ts`, `limits.ts`, `one-shot.ts`); `claude/index.ts` не трогают. 14 и 15 — refactor для Claude
  (существующие test-ы без правок ожиданий, кроме названных в Ticket-ах); 17 — новый код, который пользователь не
  видит.
- **Wave 3 — 16, 18.** 16 ждёт 12, 14, 15; 18 — 17.
- **Wave 4 — 19.** Ждёт 17, 18.
- **Wave 5 — 20, 21.** 20 ждёт 14, 19; 21 — 11, 15, 19. Каждый правит свои stub-и частей Codex, `codex/index.ts` —
  никто.
- **Wave 6 — 22, 23, 26, 33.** 22 ждёт 20; 23 — 14, 17, 18, 20, 21; 26 — 21; 33 — 16, 20. `codex/session.ts` в этой
  Wave правит только 33.
- **Wave 7 — 24, 30.** 24 ждёт 17, 18, 20, 21, 23; 30 — 22. С 24 Codex виден в интерфейсе.
- **Wave 8 — 25, 27, 29.** 25 ждёт 22, 24; 27 — 22, 23, 24; 29 — 21, 24.
- **Wave 9 — 28.** Ждёт 22, 24; общий с 27 файл `src/main/ipc/claude-home.ts`.
- **Wave 10 — 31.** Документация.
- **Wave 11 — 32.** Владелец: приёмка первого выпуска.
- **Wave 12 — 34, 35, 41, 44.** Все ждут 32.
- **Wave 13 — 36.** Ждёт 35, 44.
- **Wave 14 — 45.** Ждёт 35, 36, 44.
- **Wave 15 — 37.** Ждёт 33, 35, 45.
- **Wave 16 — 38, 40.** 38 ждёт 37; 40 — 34, 37.
- **Wave 17 — 39.** Ждёт 35, 37; общий с 38 файл `src/main/autopilot/run.ts` (новая причина отказа на старте Run).
- **Wave 18 — 42.** Документация.
- **Wave 19 — 43.** Владелец: финальная приёмка.

## Не в этом Epic-е

- API-ключи любого Vendor-а (Ticket 01, п. 8; map.md, Out of scope).
- Реализация третьего Vendor-а: Ticket 10 проверил его на бумаге; правки границы, которые он потребовал, — в этом
  Epic-е (Ticket 13), driver на ACP — нет.
- Terminal AI на Codex, смешанные Vendor-ы по ролям агентов, Link ко второй Machine с Codex (решение 07).
- Продолжить Run на другом Vendor-е, когда окно кончилось: сначала нужны смешанные Vendor-ы по ролям (решение 09).
- worfy только с Codex, без Claude Code («Решено без владельца», п. 6).
- Общий процесс app-server на все Session-ы (ADR-0094, Considered Options).
- Эмуляция функций интерфейса, которых у Vendor-а нет (решение 07; владелец, Q2).
- MCP worfy вне процесса для Claude: Claude оставляет SDK-сервер в процессе (решение 06).
- Cloud tasks Codex и Session-ы desktop-приложения Codex как отдельный вид: worfy видит их, только если они лежат в
  `thread/list` по `cwd` Project-а.
- Topic Guide о Vendor-ах — отчёт об отставании Guide поймает его сам.

## Риски

1. **Условия OpenAI** (ADR-0094, риск 1): не разрешают и не запрещают стороннему desktop-приложению вести Codex по
   подписке. Работаем сейчас, проверяем заново перед публичным выпуском (владелец, Q6); Ticket 43 называет это.
2. **app-server experimental** (ADR-0094, риск 2). Закреплённая версия, сгенерированные типы и JSON Schema, без
   experimental, compatibility suite с записями (Ticket 30). Смена версии — отдельным PR с новыми записями.
3. **Доверие к hook-ам по hash папки** (ADR-0094, риск 3; владелец, Q4): каждое обновление Harness выключает его
   hook-и в Codex. Ticket 39: шаг подтверждения и отказ preflight.
4. **Refactor Session (Ticket 14) задевает каждую Session Claude.** Защита — нынешние contract и e2e test-ы на
   `WORFY_AGENT=fake` и `test/contract/sdk-compat.test.ts` без правок ожиданий; review `high`.
5. **Гарантии workflow на Codex держатся hook-ами, а фейк повторяет hook-и Codex по исходникам.** Расхождение с
   живым Codex ловят записи входа hook-ов (Ticket 30) и приёмка (Ticket 43). Если `agent_type` не приходит в
   `PreToolUse`, read-only идёт запасным путём (Ticket 36).
6. **Limits Codex без абсолютного размера.** Только проценты, целые (`usedPercent: i32`), набор окон по плану
   (Ticket 03). Прогноз — с широкой неопределённостью до накопления данных (решение 09).
7. **Тот же код `usageLimitExceeded` у `QuotaExceeded` и `UsageNotIncluded`** — без исчерпанного окна Run
   останавливается, а не ждёт (решение 09; `limit_reached` с `reason: 'quota'`; Ticket-ы 21 и 38).
8. **Размер сборки** растёт на бинарник Codex платформы. Ticket 17 записывает рост в PR.
9. **Sandbox Codex на Windows** (`mxc` или `elevated` с UAC) — проверка на ПК при приёмке второго выпуска
   (Ticket 43).
10. **Session Codex из терминала может быть открыта** — признака «жива» нет; Resume с подтверждением («Решено без
    владельца», п. 9).
11. **Reasoning Codex** при подписке, возможно, только summary — блок мыслей короче, чем у Claude. Видно на
    приёмке.
12. **Записи compatibility suite требуют владельца** (Ticket 30): PR Ticket-а ждёт одной его команды.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-multi-vendor/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина review — `high` для границы, driver-а
  Codex и гарантий workflow: 11, 13–17, 19–22, 33, 36, 37, 38, 45. Остальные — по общему правилу.
- Сначала падающий test. Без токенов и без входа: unit, contract и e2e — с `WORFY_AGENT=fake` и `WORFY_CODEX=fake`,
  `CODEX_HOME` и `WORFY_CLAUDE_HOME` — временные папки. Настоящий Codex запускает только владелец — при записи
  compatibility suite и при приёмке.
- Refactor-Ticket-ы (11–16) не меняют ожиданий существующих test-ов: test, который пришлось поправить, назван в PR с
  причиной.
- Типы и схемы протокола Codex берутся только из `src/main/vendors/codex/protocol/` (сгенерированы); руками их не
  пишут.
- Ни один файл вне `src/main/vendors/<id>/` не проверяет имя Vendor-а; интерфейс читает capabilities.
- Новый e2e spec — строка в `scripts/e2e-specs.table.json`.
- Снимки UI — обе темы, в `.scratch/worfy-multi-vendor/evidence/<NN>/`; сравнения по пикселям нет.
- Тексты интерфейса — английские; в Russian-документах — термины латиницей.

## Готово, когда

- [ ] SDK Claude импортирует только `src/main/vendors/claude/`; contract test строгий, без исключений (16).
- [ ] Session Claude ведёт себя как до Epic-а: существующие test-ы прошли без правок ожиданий (11–16).
- [ ] Session на Codex: выбор Vendor-а, очередь и steer, Interrupt, Resume, пикеры, presets, диалог подтверждения,
      slash-меню (20–25).
- [ ] Tool-ы worfy у Codex по HTTP: Canvas, Cards `worfy.ask`, Browser (33).
- [ ] Session-ы Codex Project-а, начатые в worfy и в терминале, — Node-ы с транскриптом; поиск их находит (27, 28).
- [ ] Limits — раздел на каждого Vendor-а со входом; термин в `CONTEXT.md` переопределён (11, 26).
- [ ] Onboarding предлагает Codex необязательно; без Codex ошибок нет (29).
- [ ] Бинарник Codex закреплён, типы и схемы сгенерированы, compatibility suite с записями зелёный; test-ы не
      запускают настоящий Codex (17, 18, 30).
- [ ] Приёмка первого выпуска владельцем на Mac Stable с настоящим входом в Codex на Plus (32).
- [ ] Второй выпуск: Subagent-ы, Harness с теми же гарантиями workflow (parity suite зелёный), Autopilot с budget,
      Flight Recorder, Binding (34–41, 44, 45).
- [ ] Финальная приёмка владельцем: Mac Stable на Plus — ночной Run на Orchestrator-е Codex и гарантии workflow;
      Windows-ПК — Codex native (43).
