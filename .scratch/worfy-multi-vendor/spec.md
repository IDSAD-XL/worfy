# worfy-multi-vendor: Session-ы на Claude Code и на Codex

Status: ждёт приёмки владельца. Решения 06–09 принял Orchestrator по поручению владельца 2026-11-02 («да, можешь
работать над этим эпиком полностью на автопилоте»); владелец подтверждает их при приёмке (Ticket 32).
Source: карта [map.md](map.md) и решения 01–09 этой папки (01 — слово владельца; 02–05 — research с источниками;
06–09 — решения Orchestrator-а); [CONTEXT.md](../../CONTEXT.md), термины Vendor, Session, Subagent, Orchestrator,
Limits, Harness, Autopilot, Run, Wave; [ADR-0094](../../docs/adr/0094-vendor-seam.md) (граница Vendor-а — решение
этого Epic-а); [ADR-0008](../../docs/adr/0008-claude-code-native-binary-path.md) (поставка бинарника),
[ADR-0009](../../docs/adr/0009-claude-code-login-check-account-info.md) (worfy не держит ключей),
[ADR-0040](../../docs/adr/0040-harness-delivery-local-marketplace.md) (установка Harness).
Ticket-ы: Epic `worfy-multi-vendor`, 33 Ticket-а, нумерация с `11` (01–10 — Ticket-ы-решения карты в этой же папке;
10 — третий Vendor на бумаге, пишется отдельно и Ticket-ы этого spec не блокирует). Шапка — `Type:` / `Status:` /
`Blocked by:` / `Source:`, как у worfy-flight-recorder.

## Цель и что видит пользователь

Сейчас worfy ведёт только Claude Code. После Epic-а у Session есть Vendor: Claude Code (Anthropic) или Codex
(OpenAI, вход по подписке ChatGPT). Третий Vendor добавляется новой реализацией границы, а не правкой всего
приложения (Ticket 01).

**Первый выпуск — чат Session на Codex (решение 07):**

1. «New session» на Canvas и в rail-е спрашивает Vendor-а: Claude Code или Codex. У Project есть Vendor по
   умолчанию (Settings Project-а); пока его не выбрали — Claude Code. В одном Project живут Session-ы обоих Vendor-ов.
2. Node Session, rail и шапка Session view показывают значок и имя Vendor-а. Вместо подписи `claude` у сообщений
   агента — имя Vendor-а.
3. Чат Codex работает как чат Claude: очередь сообщений; сообщение во время хода уходит в ход (steer), если Vendor
   это умеет; Interrupt; Resume.
4. Пикеры Model и effort — из списка Vendor-а. Permission — presets словами Vendor-а: у Codex «Read only», «Auto»,
   «Full access»; у Claude — четыре нынешних режима.
5. Codex спрашивает разрешение на команду или правку файлов — worfy показывает тот же диалог подтверждения, варианты
   ответа даёт Codex.
6. Slash-меню — skills Codex и его встроенные команды.
7. Session-ы Codex Project-а — и начатые в worfy, и начатые в терминале (по `cwd`) — видны Node-ами на Canvas с
   транскриптом; их можно продолжить.
8. Limits — раздел на каждого Vendor-а, в которого выполнен вход: у Claude 5 часов и 7 дней, у Codex окна его плана.
9. Onboarding находит Codex и предлагает войти — необязательно. Пользователь без Codex ошибки не видит.
10. Поиск по транскриптам находит и Session-ы Codex.
11. Что Codex не умеет, показано недоступным с tooltip причины («Codex does not support …»). Скрыто только то, что для
    Vendor-а не имеет смысла. worfy ничего не эмулирует.

**Второй выпуск:** tool-ы Canvas, Cards `worfy.ask` и Browser для Codex (MCP worfy по HTTP); Node-ы Subagent-ов
Codex; Harness на Codex; Autopilot и Wave-ы на Orchestrator-е Codex с budget Limits; Flight Recorder по Run-ам
Codex; Binding.

**Позже, отдельными решениями после Epic-а:** Terminal AI на Codex; смешанные Vendor-ы по ролям агентов; Link ко
второй Machine с Codex. **Никогда:** всё, что требует API-ключа.

## Модель

Граница — ADR-0094. Остальной worfy говорит только в типах worfy; каждый Vendor переводится в них своим driver-ом.

**Vendor.** `VendorId` — `claude` или `codex` (`src/shared/vendors/vendor.ts`, Ticket 13). Сохранённые данные без
поля Vendor-а читаются как `claude`: все нынешние Session-ы, Node-ы и Project-ы — Claude Code.

**Driver** (`src/main/vendors/<id>/`, интерфейс — `src/main/vendors/driver.ts`; Ticket 13). Каждая часть — свой
файл типов в `src/main/vendors/`, чтобы Ticket-ы разных частей не правили один файл.

| Часть | Что даёт | Claude | Codex |
|---|---|---|---|
| capabilities | флаги и списки, которые читает интерфейс | статические, из нынешнего кода | статические + по версии и ответу `initialize` |
| session | `start(opts)`, `resume(id)` → SessionHandle | Agent SDK `query()` | `thread/start`, `thread/resume`, `turn/*` |
| account | `check()`, `startLogin()` | `accountInfo()` | `account/read`, `account/login/start` |
| limits | `read()` → `LimitWindow[]` + события | `rate_limit_event`, statusline, проба `usage` | `account/rateLimits/read`, `account/rateLimits/updated` |
| history | `list(cwd)`, `read(id)` → записи транскрипта | JSONL `~/.claude/projects` | `thread/list`, `thread/read` |
| commands | строки slash-меню | `supportedCommands()`, `system/init` | `skills/list` + встроенные |
| mcp | как tool-ы worfy доходят до агента | SDK-сервер в процессе | HTTP endpoint на localhost (второй выпуск) |
| oneShot | разовый запрос | `query()` черновика, Terminal AI, пробы | первому выпуску не нужен |

**Capabilities** (`src/shared/vendors/capabilities.ts` — в shared, потому что их читает renderer). Флаги:
`subagents`, `hooks`, `inProcessMcp`, `steer`, `resume`, `limitWindows`, `slashCommands`, `canvasTools`; списки:
`permissionPresets` (`{id, label, description}`), `effortLevels`. Интерфейс не знает имён Vendor-ов: Pickers,
диалог подтверждения, slash-меню и Limits берут всё отсюда. Недоступное — с причиной `unsupported: {flag: reason}`
для tooltip.

**SessionHandle** (`src/main/vendors/session.ts`). `send(message)`, `interrupt()`, `close()`, `setModel()`,
`setEffort()`, `setPermissionPreset()`, `events: AsyncIterable<AgentEvent>`. Сообщение — `{text, attachments}` в
типах worfy, а не `SDKUserMessage`.

**Нейтральные события.** Модель — нынешний `AgentEvent` (`src/shared/agent/events.ts:67`). Меняется:

- `permission_request` (`events.ts:91`) получает `options: {id, label, kind}[]` от Vendor-а вместо постоянного набора
  `allow` / `always_allow` / `deny` (`events.ts:54`); у Claude это те же три варианта, у Codex — `accept`,
  `acceptForSession`, `decline`, `cancel`. `subject` — что спрашивают: tool (Claude), команда или правка файлов
  (Codex).
- `rate_limit` (`events.ts:234`) заменяется на `limits` со списком `LimitWindow` (Ticket 11).
- `unknown.sdkType` остаётся как «тип сообщения Vendor-а».
- Перевод сообщений SDK (`sdkMessageToEvents`, `events.ts:290-685`) уходит из модели в
  `src/shared/vendors/claude/events.ts` (Ticket 14): чистый модуль без импорта SDK, в shared — потому что разбор
  транскриптов Claude (`src/shared/transcript/parse.ts`) зовёт его helper-ы. Item-ы Codex → события — в driver Codex
  (Ticket 20).

Соответствие Codex → `AgentEvent` (Ticket 20): `item/agentMessage/delta` → `delta`; `agentMessage` → `text`;
`reasoning` (summary) → `thinking`; `commandExecution`, `fileChange`, `mcpToolCall` → `tool_use` / `tool_result`;
`turn/completed` → `result`; `error` → `result` с ошибкой; `thread/tokenUsage/updated` → `context`;
`item/*/requestApproval` → `permission_request`.

**LimitWindow** (`src/shared/agent/limits.ts`, Ticket 11): `{vendor, id, label, usedPercent, windowMinutes,
resetsAt}` по решению 06; рядом, как сейчас, — `receivedAt`, `source` и `reached` (см. «Решено без владельца», п. 3).
Claude: `five_hour` (300 минут) и `seven_day` (10080 минут), и прочие окна, которые присылает SDK
(`seven_day_opus`). Codex: `primary` и `secondary` с длительностью из ответа; подпись по длительности, как у TUI
Codex: `5h`, `daily`, `weekly`, `monthly`.

**History.** Записи транскрипта — `TranscriptEntry` (`src/shared/transcript/parse.ts:38`): событие `AgentEvent` плюс
uuid, время, Subagent ли. Claude читает свои JSONL как сейчас (`src/main/claude-home/*`). Codex отдаёт те же записи
из `thread/read {includeTurns}`; rollout-файлы worfy не читает (Ticket 05).

## Codex: бинарник и совместимость

- **Закреплённая версия.** `@openai/codex` в `package.json` с точной версией (сейчас stable — 0.166.0; Ticket 17
  берёт последнюю stable на момент claim). Платформенные пакеты распаковываются из `app.asar`, как у Claude
  (`electron-builder.yml:43-52`). Путь — `codexExecutablePath(runtime)` рядом с `claudeExecutablePath`
  (`src/main/agent/options.ts:103`). LICENSE и NOTICE Codex (Apache-2.0) — в ресурсах сборки.
- **Сгенерированные типы.** `scripts/codex-protocol.mjs` запускает `codex app-server generate-ts` закреплённой
  версии и кладёт вывод в `src/main/vendors/codex/protocol/` с файлом версии. `pnpm lint` проверяет, что версия
  типов равна версии в `package.json`.
- **Без experimental.** `initialize` без `capabilities.experimentalApi`: сервер отвергает experimental-методы, и
  worfy на них незаметно не опирается (Ticket 02). Очередь сообщений — своя (`src/main/agent/queue.ts`), а не
  `thread/queue/*`.
- **Compatibility suite** (Ticket 30), по образцу `test/contract/sdk-compat.test.ts` для Claude: сценарии фейка
  проходят проверку по сгенерированным типам; записи живого Codex (`test/fixtures/codex-messages/`, снимает владелец
  скриптом `scripts/codex-capture.mjs` при приёмке) — тоже; смена версии без новых записей — красный test.
  Порядок смены версии — в Ticket-е 30.
- **Процесс на Session.** Один `codex app-server` на Session, `CODEX_HOME` — пользователя, кроме test-ов.
  `clientInfo.name` = `worfy`: по `originator` worfy узнаёт свои thread-ы (Ticket 05).

## Фейк и test-ы

Test-ы никогда не запускают настоящий Codex и не входят ни в какой аккаунт.

- **Фейк app-server** (Ticket 18): `test/fixtures/codex-app-server/fake-app-server.mjs` — Node-скрипт, который
  говорит JSON-RPC по stdio, как app-server. Сценарии — `test/fixtures/codex-scripts/<имя>.jsonl` (ответы,
  notification-ы и server→client request-ы по шагам), как `test/fixtures/agent-scripts/` у фейка Claude.
- **Переключатель** — `WORFY_CODEX=fake` (как `WORFY_AGENT=fake`, `src/main/agent/app-registry.ts:171`):
  driver Codex запускает фейк через `process.execPath` вместо бинарника. `WORFY_CODEX_SCRIPT` — сценарий,
  `WORFY_CODEX_LOG` — файл, куда фейк пишет request-ы worfy для проверок, `WORFY_CODEX_HOME` — папка с thread-ами
  фейка для `thread/list` / `thread/read`.
- **Состояния аккаунта в фейке:** вход по ChatGPT с планом Plus и Pro (одно недельное окно), без входа, вход
  завершён после `account/login/start`; Limits с одним и с двумя окнами; `usageLimitExceeded` с исчерпанным окном и
  без него.
- **Защита.** Unit, contract и e2e test-ы идут с `WORFY_CODEX=fake` и `CODEX_HOME` во временной папке; contract test
  (Ticket 18) проверяет, что под test-ами driver не запускает бинарник `@openai/codex` и ничего не пишет вне
  временной папки.
- Claude в тех же test-ах — как сейчас, `WORFY_AGENT=fake`.

## Windows

- **Codex на Windows — native**, в PowerShell, без WSL. npm-пакеты есть для `win32-x64` и `win32-arm64`, бинарник —
  `codex.exe` (Ticket 02). Путь строится разделителями платформы runtime, как `claudeExecutablePath`.
- **Sandbox Codex на Windows:** рекомендован `mxc`; запасные — `elevated` (один раз нужна настройка с правами
  администратора, UAC) и `unelevated`. worfy не выбирает sandbox сам: Codex берёт свою настройку, а его сообщение о
  настройке worfy показывает как есть. Доступен ли `mxc` на ПК владельца — проверяет приёмка (Ticket 32).
- **Пути.** `CODEX_HOME` по умолчанию — `%USERPROFILE%\.codex`. `cwd` Session сравнивается с корнем Project-а без
  учёта регистра и с одним разделителем — `isInsidePath` (`src/main/claude-home/registry.ts:80`).
- **Процесс.** app-server стартует без shell; остановка ждёт выхода процесса, как у Claude Code
  (`ClaudeCodeProcess`, `src/main/agent/session/types.ts:30`).
- **Harness на Codex.** Hook-и Harness стартуют через `node` (ADR-0055) — работают и под Codex на Windows. Пути
  установки — `%USERPROFILE%\.codex\…`.
- **Платформенные Ticket-ы** (ADR-0056, п. 2; ADR-0071): код с ветками по платформе, упаковка, скрипты Harness —
  вердикт Windows до merge. Это Ticket-ы 13, 16, 17, 19, 27, 35, 36; в их файлах — пометка «Платформенный».

## Решено без владельца

1. **Второй выпуск начинается после приёмки первого.** Ticket-ы второго выпуска, которым иначе ничего не мешает,
   заблокированы Ticket-ом 32: владелец подтверждает решения 06–09 при этой приёмке, и второй выпуск строится уже на
   подтверждённом.
2. **Contract test импорта SDK** (Ticket 12) сначала идёт со списком нынешних файлов-исключений; Ticket-ы 14 и 15
   его не правят; Ticket 16 опустошает список и делает test строгим.
3. **`LimitWindow` хранит ещё `reached`** (`true`, `false` или `null` — не сказано): отказ по лимиту. Решение 06
   называет шесть полей, но код читает `status === 'rejected'` у Claude (`src/shared/autopilot/resume-at.ts:74`,
   `budget.ts:181`, `src/main/autopilot/limits-wait.ts:121`, `src/main/terminal-ai/limits-gate.ts:41`), а у Codex
   то же значит `rateLimitReachedType`. Без поля Autopilot перестал бы видеть отказ.
4. **Journal не меняет формат в первом выпуске.** Run-ы первого выпуска — только на Claude, строка `limits` Journal
   остаётся `{five_hour, seven_day}` (`src/shared/autopilot/journal.ts:351`). Окна Codex в Journal — Ticket 38.
5. **Orchestrator в первом выпуске — Claude Code.** Выбор Vendor-а у Orchestrator-а — Ticket 37.
6. **Первый выпуск требует Claude Code для first-run, черновика профиля Project и Terminal AI**: `oneShot` Codex
   нужен им только вместе с Terminal AI на Codex, а это «позже». Пользователь только с Codex — вне Epic-а.
7. **Codex виден в интерфейсе с Ticket-а 24.** До него driver Codex есть, но выбрать его негде; Wave-ы 2–3 ничего
   не меняют для пользователя.
8. **Vendor по умолчанию Project-а** — поле `defaultVendor` в `<Project data folder>/settings.json`
   (`projectSettingsSchema`, `src/shared/projects/action-templates.ts:139`); нет поля — `claude`.
9. **Предупреждение при Resume Session, начатой в терминале.** Живая ли она, по Codex не узнать (Ticket 05, «Чего не
   знаем»): Resume такой Session спрашивает подтверждение «This Session may be open in a terminal».
10. **Тексты интерфейса — английские** (`scripts/check-cyrillic.mjs`); presets Codex — «Read only», «Auto», «Full
    access», как в решении 07.

## Ticket-ы

UI — снимки в обеих темах в `.scratch/worfy-multi-vendor/evidence/<NN>/`. Test-ы — внутри Ticket-ов. Платформенный
PR (ADR-0056, ADR-0071) — вердикт Windows до merge. Review `high` — граница и driver Codex.

**Первый выпуск.**

- **11 — LimitWindow: Limits — список окон Vendor-а.** Чистый refactor, Claude ведёт себя так же. Blocked by: —.
  Review `high`. Не UI (меняются только типы под LimitsMeter).
- **12 — Contract test: SDK Claude только в `src/main/vendors/claude/`.** Со списком нынешних исключений.
  Blocked by: —. Не UI.
- **13 — Интерфейс driver-а, capabilities и driver Claude.** Типы частей, реестр Vendor-ов, перенос файлов, которые
  запускают Claude Code, в `src/main/vendors/claude/`. Чистый refactor. Blocked by: —. Review `high`. Платформенный.
- **14 — Session поверх SessionHandle.** Слой Session получает `AgentEvent` от driver-а; перевод SDK и
  `canUseTool` → `permission_request` с вариантами Vendor-а — в driver Claude. Blocked by: 13. Review `high`.
- **15 — account, limits и oneShot Claude через driver.** first-run, Plan, черновик профиля Project, проба Limits.
  Blocked by: 11, 13. Review `high`.
- **16 — MCP-серверы и Terminal AI через driver Claude; contract test строгий.** Blocked by: 12, 14, 15.
  Review `high`. Платформенный.
- **17 — Бинарник Codex, типы протокола и capabilities Codex.** Blocked by: 13. Review `high`. Платформенный.
- **18 — Фейк app-server Codex (`WORFY_CODEX=fake`).** Blocked by: 17. Не UI.
- **19 — Клиент app-server.** JSON-RPC по stdio, процесс на Session, ошибки и время ожидания. Blocked by: 17, 18.
  Review `high`. Платформенный.
- **20 — SessionHandle Codex.** Thread-ы, ходы, steer, interrupt, resume, Model, effort, presets, approval-ы,
  события. Blocked by: 14, 19. Review `high`.
- **21 — Account и Limits Codex.** Вход по ChatGPT, план, окна, `usageLimitExceeded`. Blocked by: 11, 15, 19.
  Review `high`.
- **22 — History и slash-команды Codex.** `thread/list`, `thread/read`, `skills/list`, встроенные. Blocked by: 20.
  Review `high`.
- **23 — Vendor у Session и у Project.** Данные, IPC, выбор driver-а в реестре Session-ов. Blocked by: 14. Не UI.
- **24 — Выбор Vendor-а и значок.** «New session», Vendor по умолчанию в Settings Project-а, значок на Node, в
  rail-е и шапке. Blocked by: 17, 23. UI.
- **25 — Пикеры, диалог подтверждения и slash-меню по capabilities.** Недоступное — с причиной. Blocked by: 22, 24.
  UI.
- **26 — Limits по Vendor-ам в панели.** Blocked by: 21. UI.
- **27 — Session-ы Codex на Canvas.** Начатые в worfy и в терминале, Node с транскриптом, Resume. Blocked by: 22,
  23. UI. Платформенный.
- **28 — Поиск по транскриптам Codex.** Blocked by: 22. UI (результаты поиска).
- **29 — Onboarding и вход в Codex.** Найти Codex, войти — необязательно; Settings → Vendors. Blocked by: 21, 24. UI.
- **30 — Compatibility suite Codex и скрипт записи.** Blocked by: 22. Не UI.
- **31 — Документация первого выпуска.** Blocked by: 25, 26, 27, 28, 29, 30. Не UI.
- **32 — Приёмка первого выпуска с владельцем.** Mac Stable с настоящим входом в Codex; Windows-ПК. Blocked by:
  11–31. UI (снимки владельцу).

**Второй выпуск** (после приёмки первого, «Решено без владельца», п. 1).

- **33 — MCP worfy по HTTP для Codex.** Tool-ы Canvas и Browser, Cards `worfy.ask`; localhost, token на Session.
  Blocked by: 32. Review `high`.
- **34 — Subagent-ы Codex на Canvas.** Дерево thread-ов по `parent_thread_id`. Blocked by: 32. UI.
- **35 — Install Harness в Codex.** Локальный marketplace, TOML агентов, проверка версии. Blocked by: 32.
  Платформенный.
- **36 — Hook-и Harness под Codex.** Gate на `Stop`, отказ правок reviewer и scout по `agent_type` (пробуем test-ом).
  Blocked by: 35. Платформенный.
- **37 — Orchestrator и Autopilot на Codex.** Vendor у Orchestrator-а, unattended для Codex, Run через
  SessionHandle. Blocked by: 33, 35. Review `high`.
- **38 — Budget, прогноз и остановка по Limits Vendor-а.** Autopilot и Resource Planner; Journal с окнами Codex.
  Blocked by: 37. Review `high`.
- **39 — Подтверждение hook-ов Harness в Codex.** Шаг после установки и обновления; отказ preflight Autopilot.
  Blocked by: 35, 37. UI.
- **40 — Flight Recorder по Run-ам Codex.** Blocked by: 34, 37. Не UI.
- **41 — Binding для Session-ов Codex.** Blocked by: 32. Не UI.
- **42 — Документация второго выпуска.** Blocked by: 33–41. Не UI.
- **43 — Финальная приёмка с владельцем.** Ночной Run на Orchestrator-е Codex на Mac Stable с настоящим входом.
  Blocked by: 33–42. UI (снимки владельцу).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов нет. Таблица — план. Wave,
которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 11 | `src/shared/agent/limits.ts`, `src/main/agent/limits.ts`, `src/shared/agent/events.ts`, `src/shared/autopilot/budget.ts`, `src/shared/autopilot/forecast-lines.ts`, `src/shared/autopilot/limits-estimate.ts`, `src/shared/autopilot/resume-at.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`, `src/main/terminal-ai/limits-gate.ts`, `src/renderer/shell/toolbar/LimitsMeter.tsx`, `test/unit/limits.test.ts`, `test/contract/limits.test.ts` | 1 |
| 12 | `test/contract/vendor-sdk-imports.test.ts` | 1 |
| 13 | `src/shared/vendors/vendor.ts`, `src/shared/vendors/capabilities.ts`, `src/main/vendors/driver.ts`, `src/main/vendors/registry.ts`, `src/main/vendors/claude/index.ts`, `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/fake-query.ts`, `src/main/agent/app-registry.ts`, `src/main/agent/options.ts`, `src/main/agent/fake-query.ts` | 1 |
| 14 | `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/shared/vendors/claude/events.ts`, `src/shared/transcript/parse.ts`, `src/main/agent/session.ts`, `src/main/agent/session/run.ts`, `src/main/agent/session/types.ts`, `src/main/agent/session/registry.ts`, `src/main/agent/session/input-queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/attachments.ts`, `src/shared/agent/events.ts`, `src/renderer/session/PermissionCard.tsx`, `test/contract/agent-session.test.ts`, `test/contract/permissions.test.ts` | 2 |
| 15 | `src/main/vendors/account.ts`, `src/main/vendors/limits.ts`, `src/main/vendors/one-shot.ts`, `src/main/vendors/claude/account.ts`, `src/main/vendors/claude/limits.ts`, `src/main/vendors/claude/one-shot.ts`, `src/main/ipc/first-run.ts`, `src/main/ipc/plan-preset.ts`, `src/main/ipc/projects.ts`, `src/main/projects/connect.ts`, `src/main/agent/limits-usage.ts` | 2 |
| 17 | `package.json`, `pnpm-lock.yaml`, `electron-builder.yml`, `scripts/codex-protocol.mjs`, `src/main/vendors/codex/`, `src/main/vendors/registry.ts`, `test/unit/codex-binary.test.ts` | 2 |
| 16 | `src/main/vendors/mcp.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/terminal-ai.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts`, `src/main/terminal-ai/assist.ts`, `src/main/terminal-ai/options.ts`, `src/main/terminal-ai/fake-backend.ts`, `test/contract/vendor-sdk-imports.test.ts` | 3 |
| 18 | `test/fixtures/codex-app-server/fake-app-server.mjs`, `test/fixtures/codex-scripts/`, `src/main/vendors/codex/launch.ts`, `test/contract/codex-fake.test.ts` | 3 |
| 23 | `src/shared/ipc/sessions.ts`, `src/main/ipc/sessions.ts`, `src/main/agent/node-sessions.ts`, `src/main/agent/app-node-sessions.ts`, `src/main/agent/app-registry.ts`, `src/shared/projects/action-templates.ts`, `test/contract/sessions-vendor.test.ts` | 3 |
| 19 | `src/main/vendors/codex/app-server.ts`, `src/main/vendors/codex/rpc.ts`, `test/unit/codex-rpc.test.ts`, `test/contract/codex-app-server.test.ts` | 4 |
| 24 | `src/renderer/session/SessionView.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/session/rail/`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/session/VendorBadge.tsx`, `src/renderer/session/NewSessionVendor.tsx`, `src/renderer/settings/SessionsSection.tsx`, `test/unit/session-view.test.tsx`, `test/e2e/vendor-picker.spec.ts`, `scripts/e2e-specs.table.json` | 4 |
| 20 | `src/main/vendors/codex/session.ts`, `src/main/vendors/codex/items.ts`, `src/main/vendors/codex/approvals.ts`, `test/unit/codex-items.test.ts`, `test/contract/codex-session.test.ts` | 5 |
| 21 | `src/main/vendors/codex/account.ts`, `src/main/vendors/codex/limits.ts`, `src/main/agent/limits-usage.ts`, `test/unit/codex-limits.test.ts`, `test/contract/codex-account.test.ts` | 5 |
| 22 | `src/main/vendors/codex/history.ts`, `src/main/vendors/codex/commands.ts`, `test/unit/codex-history.test.ts`, `test/contract/codex-history.test.ts` | 6 |
| 26 | `src/renderer/shell/toolbar/LimitsMeter.tsx`, `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts`, `src/main/agent/limits.ts`, `test/unit/limits-meter.test.tsx`, `test/e2e/limits-vendors.spec.ts`, `scripts/e2e-specs.table.json` | 6 |
| 29 | `src/main/ipc/first-run.ts`, `src/renderer/getting-started/GettingStartedPanel.tsx`, `src/renderer/settings/VendorsSection.tsx`, `src/renderer/settings/sections.ts`, `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts`, `test/e2e/onboarding-codex.spec.ts`, `scripts/e2e-specs.table.json` | 6 |
| 25 | `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/SlashMenu.tsx`, `src/main/agent/commands.ts`, `test/unit/pickers-captions.test.tsx`, `test/unit/permission-card.test.tsx`, `test/e2e/codex-session.spec.ts`, `scripts/e2e-specs.table.json` | 7 |
| 27 | `src/main/vendors/codex/sessions-on-canvas.ts`, `src/main/ipc/claude-home.ts`, `src/shared/ipc/claude-home.ts`, `src/renderer/claude-home/session-nodes.ts`, `src/renderer/claude-home/useClaudeHome.ts`, `test/contract/codex-sessions-on-canvas.test.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts`, `scripts/e2e-specs.table.json` | 7 |
| 30 | `test/contract/codex-compat.test.ts`, `scripts/codex-capture.mjs`, `test/fixtures/codex-messages/` | 7 |
| 28 | `src/main/claude-home/search.ts`, `src/main/ipc/claude-home.ts`, `test/contract/claude-home-search.test.ts` | 8 |
| 31 | `docs/features/vendors.md`, `docs/features/ru/vendors.md`, `docs/features/sessions.md`, `docs/features/transcripts-and-usage.md`, `docs/features/onboarding.md`, `docs/features/README.md`, `docs/features/ru/README.md` | 9 |
| 32 | `.scratch/worfy-multi-vendor/spec.md` | 10 |
| 33 | `src/main/mcp/http-server.ts`, `src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/capabilities.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts`, `test/contract/mcp-http.test.ts` | 11 |
| 34 | `src/main/vendors/codex/subagents.ts`, `src/renderer/claude-home/subagents.ts`, `test/contract/codex-subagents.test.ts` | 11 |
| 35 | `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts`, `src/main/harness/install.ts`, `src/main/ipc/harness.ts`, `test/contract/harness-codex-install.test.ts` | 11 |
| 41 | `src/main/vendors/codex/binding.ts`, `src/main/claude-home/binding-signals.ts`, `test/contract/codex-binding.test.ts` | 11 |
| 36 | `harness/hooks/stop.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/hooks.json`, `harness/hooks/tests/`, `harness/README.md` | 12 |
| 37 | `src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`, `src/main/vendors/codex/session.ts`, `src/main/autopilot/run.ts`, `src/shared/autopilot/journal.ts`, `test/unit/autopilot-run.test.ts`, `test/contract/codex-orchestrator.test.ts` | 12 |
| 38 | `src/shared/autopilot/budget.ts`, `src/shared/autopilot/resume-at.ts`, `src/shared/autopilot/limits-estimate.ts`, `src/shared/autopilot/forecast.ts`, `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts`, `src/main/autopilot/limits-wait.ts`, `test/unit/autopilot-budget.test.ts`, `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits.test.ts` | 13 |
| 39 | `src/main/harness/codex-hooks-trust.ts`, `src/main/autopilot/run.ts`, `src/main/ipc/autopilot.ts`, `src/renderer/harness/`, `test/contract/codex-hooks-trust.test.ts`, `test/unit/autopilot-run.test.ts` | 14 |
| 40 | `src/main/flight-recorder/transcripts.ts`, `src/shared/flight-recorder/from-transcript.ts`, `test/contract/flight-recorder-transcripts.test.ts` | 13 |
| 42 | `docs/features/vendors.md`, `docs/features/ru/vendors.md`, `docs/features/harness.md`, `docs/features/autopilot.md`, `docs/features/flight-recorder.md` | 15 |
| 43 | `.scratch/worfy-multi-vendor/spec.md` | 16 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave. Исключение — `scripts/e2e-specs.table.json`: в него Ticket-ы
только дописывают строку своего нового e2e spec, общим файлом он не считается, конфликт строк решает Orchestrator при
merge.

- **Wave 1 — 11, 12, 13.** Чистые refactor-ы: поведение Claude не меняется, их можно вести на Autopilot. 11 —
  модель Limits; 12 — новый test; 13 — интерфейс и перенос файлов запуска Claude Code. Общий файл возможен только в
  строках import (13 переносит `options.ts`; 11 его не правит) — конфликт решает Orchestrator при merge.
- **Wave 2 — 14, 15, 17.** 14 и 15 ждут 13 (15 — ещё 11), 17 — 13. Типы частей разнесены по файлам
  (`session.ts` у 14; `account.ts`, `limits.ts`, `one-shot.ts` у 15), реестр правит только 17. Тоже refactor для
  Claude (14, 15) и новый код, который пользователь не видит (17).
- **Wave 3 — 16, 18, 23.** 16 ждёт 12, 14, 15; 18 — 17; 23 — 14.
- **Wave 4 — 19, 24.** 19 ждёт 17, 18; 24 — 17, 23. С 24 Codex виден в интерфейсе.
- **Wave 5 — 20, 21.** 20 ждёт 14, 19; 21 — 11, 15, 19.
- **Wave 6 — 22, 26, 29.** 22 ждёт 20; 26 — 21; 29 — 21, 24.
- **Wave 7 — 25, 27, 30.** 25 ждёт 22, 24; 27 — 22, 23; 30 — 22.
- **Wave 8 — 28.** Ждёт 22; общий с 27 файл `src/main/ipc/claude-home.ts`.
- **Wave 9 — 31.** Документация.
- **Wave 10 — 32.** Владелец: приёмка первого выпуска.
- **Wave 11 — 33, 34, 35, 41.** Все ждут 32.
- **Wave 12 — 36, 37.** 36 ждёт 35; 37 — 33, 35.
- **Wave 13 — 38, 40.** 38 ждёт 37; 40 — 34, 37.
- **Wave 14 — 39.** Ждёт 35, 37; общий с 38 файл `src/main/autopilot/run.ts` (новая причина отказа на старте Run).
- **Wave 15 — 42.** Документация.
- **Wave 16 — 43.** Владелец: финальная приёмка.

## Не в этом Epic-е

- API-ключи любого Vendor-а (Ticket 01, п. 8; map.md, Out of scope).
- Реализация третьего Vendor-а: Ticket 10 проверяет его на бумаге.
- Terminal AI на Codex, смешанные Vendor-ы по ролям агентов, Link ко второй Machine с Codex (решение 07).
- Продолжить Run на другом Vendor-е, когда окно кончилось: сначала нужны смешанные Vendor-ы по ролям (решение 09).
- worfy только с Codex, без Claude Code («Решено без владельца», п. 6).
- Общий процесс app-server на все Session-ы (ADR-0094, Considered Options).
- Эмуляция того, чего Vendor не умеет (решение 07).
- MCP worfy вне процесса для Claude: Claude оставляет SDK-сервер в процессе (решение 06).
- Cloud tasks Codex и Session-ы desktop-приложения Codex как отдельный вид: worfy видит их, только если они лежат в
  `thread/list` по `cwd` Project-а.
- Topic Guide о Vendor-ах — отчёт об отставании Guide поймает его сам.

## Риски

1. **Условия OpenAI** (ADR-0094, риск 1): не разрешают и не запрещают стороннему desktop-приложению вести Codex по
   подписке. Проверить заново перед публичным выпуском; Ticket 43 называет это владельцу.
2. **app-server experimental** (ADR-0094, риск 2). Закреплённая версия, сгенерированные типы, без experimental,
   compatibility suite (Ticket 30). Смена версии — отдельным PR с новыми записями.
3. **Доверие к hook-ам по hash папки** (ADR-0094, риск 3): каждое обновление Harness выключает его hook-и в Codex.
   Ticket 39: шаг подтверждения и отказ preflight.
4. **Refactor Session (Ticket 14) задевает каждую Session Claude.** Защита — нынешние contract и e2e test-ы на
   `WORFY_AGENT=fake` и `test/contract/sdk-compat.test.ts` идут без правок ожиданий; review `high`.
5. **Limits Codex без абсолютного размера.** Только проценты, целые (`usedPercent: i32`), набор окон по плану
   (Ticket 03). Прогноз — с широкой неопределённостью до накопления данных (решение 09).
6. **Тот же код `usageLimitExceeded` у `QuotaExceeded` и `UsageNotIncluded`** — без исчерпанного окна Run
   останавливается, а не ждёт (решение 09; Ticket 21 и 38).
7. **Размер сборки** растёт на бинарник Codex платформы. Ticket 17 записывает рост в PR.
8. **Sandbox Codex на Windows** (`mxc` или `elevated` с UAC) — проверка на ПК при приёмке (Ticket 32).
9. **Session Codex из терминала может быть открыта** — признака «жива» нет; Resume с подтверждением («Решено без
   владельца», п. 9).
10. **Reasoning Codex** при подписке, возможно, только summary — блок мыслей короче, чем у Claude. Видно на
    приёмке.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-multi-vendor/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина review — `high` для границы и driver-а
  Codex: 11, 13–17, 19–22, 33, 37, 38. Остальные — по общему правилу.
- Сначала падающий test. Без токенов и без входа: unit, contract и e2e — с `WORFY_AGENT=fake` и `WORFY_CODEX=fake`,
  `CODEX_HOME` и `WORFY_CLAUDE_HOME` — временные папки. Настоящий Codex запускает только владелец при приёмке.
- Refactor-Ticket-ы (11–16) не меняют ожиданий существующих test-ов: test, который пришлось поправить, назван в PR с
  причиной.
- Типы протокола Codex берутся только из `src/main/vendors/codex/protocol/` (сгенерированы); руками их не пишут.
- Ни один файл вне `src/main/vendors/<id>/` не проверяет имя Vendor-а; интерфейс читает capabilities.
- Новый e2e spec — строка в `scripts/e2e-specs.table.json`.
- Снимки UI — обе темы, в `.scratch/worfy-multi-vendor/evidence/<NN>/`; сравнения по пикселям нет.
- Тексты интерфейса — английские; в Russian-документах — термины латиницей.

## Готово, когда

- [ ] SDK Claude импортирует только `src/main/vendors/claude/`; contract test строгий, без исключений (16).
- [ ] Session Claude ведёт себя как до Epic-а: существующие test-ы прошли без правок ожиданий (11–16).
- [ ] Session на Codex: выбор Vendor-а, очередь и steer, Interrupt, Resume, пикеры, presets, диалог подтверждения,
      slash-меню (20–25).
- [ ] Session-ы Codex Project-а, начатые в worfy и в терминале, — Node-ы с транскриптом; поиск их находит (27, 28).
- [ ] Limits — раздел на каждого Vendor-а со входом; термин в `CONTEXT.md` переопределён (11, 26).
- [ ] Onboarding предлагает Codex необязательно; без Codex ошибок нет (29).
- [ ] Бинарник Codex закреплён, типы сгенерированы, compatibility suite зелёный; test-ы не запускают настоящий Codex
      (17, 18, 30).
- [ ] Приёмка первого выпуска владельцем на Mac Stable с настоящим входом в Codex и на Windows-ПК (32).
- [ ] Второй выпуск: tool-ы worfy для Codex по HTTP, Subagent-ы, Harness, Autopilot с budget, Flight Recorder,
      Binding (33–41).
- [ ] Финальная приёмка владельцем на Mac Stable с настоящим входом в Codex: ночной Run на Orchestrator-е Codex (43).
