# 02 — Assist-процесс в main: тёплый Claude Code на подписке, модели по функции, Limits, redaction, Settings, fake для test-ов

Type: task
Status: open
Blocked by: —
Source: решения владельца 2026-10-09: пункт 5 (один общий тёплый процесс Claude Code на все Terminal-ы: Agent SDK на подписке, `settingSources: []`, без MCP и tools, `persistSession: false`, без thinking у Haiku, `title`; старт с первого запроса, выгрузка после ~10 минут простоя; каждый запрос самостоятельный), пункт 2 (Limits: автоматические функции выключаются сами выше 80 % окна 5 часов и при `allowed_warning`/`rejected`, по требованию — до `rejected`; запросы кормят Limits; всё выключается в Settings), пункт 3 (что уходит в модель, redaction), пункт 7 (test-ы без расхода подписки) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md) — свой процесс Claude Code для Terminal AI; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34` (Ticket 08 Epic-а worfy-link); [evidence spike-а](../evidence/spike-задержки-2026-10-09.md)

## Что происходит

- Session-ы — процессы Claude Code через `@anthropic-ai/claude-agent-sdk` 0.3.289. Опции —
  `sessionOptions` (`src/main/agent/options.ts:227-246`): `settingSources` user, project и local,
  preset `claude_code`, MCP-серверы по Profile-у (ADR-0021). Путь к бинарнику Claude Code —
  `claudeExecutablePath` (`options.ts:71`, ADR-0008).
- Session-ам haiku нельзя: `isSelectableModel` (`src/shared/agent/settings.ts:40-42`),
  `USER_MODEL_FALLBACK` (`src/main/agent/session.ts:153`). Assist-процесс — исключение (ADR-0058).
- Окружение агента — `agentEnv()` (`src/main/agent/env.ts:457`), без `ANTHROPIC_API_KEY` и
  `ANTHROPIC_AUTH_TOKEN` (`env.ts:31`): Claude Code входит по подписке.
- Разовый вызов модели уже есть — черновик Profile-а (`src/main/ipc/projects.ts:93-109`). При
  `WORFY_AGENT=fake` он идёт в fake (`projects.ts:117`); `launchApp` ставит `WORFY_AGENT=fake`
  каждому e2e (`test/e2e/helpers.ts:139`).
- Limits — `LimitsTracker` (`src/main/agent/limits.ts:45`): `snapshot()` (`:65`), `recordSdkMessage`
  (`:96`), общий экземпляр — `appLimits()` (`:225`). `observe(factory)` (`:104`) оборачивает
  фабрику Session-ов — `QueryFactory` с `QueryRequest` (`src/main/agent/app-registry.ts:94`); к
  запросу assist-процесса она не подходит. Внутри она зовёт `observeMessages`
  (`src/main/mcp/canvas-server.ts:292`) и `recordSdkMessage` на каждое сообщение.
- У окна Limits есть доля, `resetsAt`, `status` (`allowed`, `allowed_warning`, `rejected`) и
  `receivedAt` (`src/shared/agent/limits.ts:24-33`). Состояние переживает перезапуск worfy, а статус
  окна держится, пока не придёт новый. Ожидание Autopilot предупреждает: `rejected`, оставшийся от
  прошлого хода, может относиться к окну, которое не блокирует (`src/main/autopilot/limits-wait.ts:13-16`).
- SDK 0.3.289 (`sdk.d.ts` пакета): у `startup()` все опции фиксируются при старте процесса. У
  `prewarm()` при старте фиксируются исполняемый файл, `settingSources`, `env`, `systemPrompt`,
  `mcpServers`, `hooks`, tools и plugin-ы. `claim()` запасного процесса задаёт `model`,
  `maxThinkingTokens`, `settings` (например, `effortLevel`), `appendSystemPrompt`, `title`. Отказ
  `option_not_applied` значит: запрос уже ушёл, но без `model` или `maxThinkingTokens`. Запасной
  процесс в простое — 230–260 MB (документация `prewarm()`).
- Spike 2026-10-09 ([evidence](../evidence/spike-задержки-2026-10-09.md)) проверил опции
  assist-процесса на подписке Max владельца. Старт ~0,5 с, `prewarm()` — 746 ms, RSS 210–300 MB. Haiku
  с `effort: 'low'` думает (до 54 с); с `thinking: {type: 'disabled'}` или `setMaxThinkingTokens(0)` —
  нет. Без системного prompt-а Haiku отвечает в обратных кавычках. `rate_limit_event` — один на
  процесс. В `init` при `settingSources: []` — три встроенных plugin-а Claude Code; есть ли у них
  hooks, не проверено. `claim()` spike не пробовал: запасной процесс только запускался и закрывался.
- Пометки доступа каналов IPC — `src/shared/ipc/channels.ts:20-34`: `local` — состояние машины
  экрана (Limits, настройки связи), Linked machine-у закрыт; `project` — работа с Project-ами этой
  Machine.
- PR #200 (`worfy-windows/08`, открыт на 2026-10-09) правит `src/main/agent/env.ts`,
  `src/main/agent/limits.ts`, `src/main/agent/options.ts`, `src/shared/agent/limits.ts`,
  `src/main/storage/paths.ts` (сигнатура `dataRoot`) и `src/main/claude-home/registry.ts`. Этот
  Ticket их только читает.

## Что делаем

1. **Сервис** — `src/main/terminal-ai/assist.ts` (новый), один на запуск worfy.
   - `request(feature, context, signal)` → команда или отказ с причиной. `feature` — `suggest`,
     `next`, `request`, `fix`.
   - Процесс — по ADR-0058, пункт 2: запасной процесс `prewarm()`; запрос — `claim()` с
     настройками функции (пункт 2 ниже). Первый запрос стартует процесс. После ответа или отмены
     процесс закрывается, сразу прогревается следующий. 10 минут без запросов — запасной
     закрывается. `startup()` не годится: у него опции функции задать нельзя.
   - Запрос пришёл, пока запасной ещё прогревается, — ждёт его, не стартуя второй.
   - `option_not_applied` у `suggest` (thinking не выключился) — запрос отменяется; у остальных —
     ответ принимается, строка в лог.
   - В полёте один запрос. Новый `suggest` или `next` отменяет `suggest` и `next` в полёте. `request` и
     `fix` отменяют автоматический и сами не отменяются; следующий запрос по требованию ждёт.
   - Тайм-ауты: `suggest` — 5 с, `next` — 8 с, `request` и `fix` — 30 с (spec, «Решено без
     владельца», пункт 2).
   - `suggest`: поток начался с thinking — запрос отменяется (ADR-0058, пункт 3). У `next` на Sonnet —
     только тайм-аут 8 с: у Sonnet 5.5 thinking не выключается, в spike-е его не было.
   - Ответ — одна строка: обратные кавычки, блок кода и пояснения после первой строки срезаются.
   - Одна строка в лог при старте каждого процесса: версия Claude Code, `apiKeySource`, имена
     plugin-ов и hooks из `init`, если `init` их сообщает. При запросе — модель. Ни текста
     запросов, ни ответов, ни контекста в логе нет.
2. **Опции** — `src/main/terminal-ai/options.ts` (новый), чистые функции.
   - При `prewarm()`: `settingSources: []`, `mcpServers: {}`, `strictMcpConfig: true`, `tools: []`,
     `permissionMode: 'dontAsk'`, `maxTurns: 1`, `persistSession: false`, `includePartialMessages:
     true`, общий `systemPrompt` строкой (вернуть только команду, без кавычек и пояснений); `env` —
     `agentEnv()`, ключи `API_KEY_VARS` вычищаются ещё раз; `cwd` — пустая папка
     `<WORFY_DATA_DIR>/terminal-ai/` (риск 4 spec-а); `pathToClaudeCodeExecutable` —
     `claudeExecutablePath`.
   - При `claim()`, по функции: `suggest` — `model: 'haiku'`, `maxThinkingTokens: 0`; `next` —
     `sonnet` с `settings: {effortLevel: 'low'}`, а с настройкой «Haiku» — `haiku` с
     `maxThinkingTokens: 0`; `request` и `fix` — `sonnet`, `effortLevel: 'low'`. У каждой функции —
     свой `appendSystemPrompt` и `title`.
   - Что из этого SDK принимает на самом деле, проверяет contract на поддельном SDK; вживую —
     Ticket 09.
3. **Порог Limits** — `src/main/terminal-ai/limits-gate.ts` (новый), чистая функция от `LimitsState`,
   функции и текущего времени.
   - Окно, у которого `resetsAt` уже прошёл, не считается: ни доля, ни статус. Окно без `resetsAt` —
     `allowed_warning` и `rejected` считаются час после `receivedAt` (spec, «Решено без владельца»,
     пункт 11).
   - `suggest` и `next` — нельзя, если доля окна `five_hour` больше 0,8 или у любого действующего окна
     `allowed_warning` или `rejected`.
   - `request` и `fix` — нельзя только при `rejected` действующего окна.
   - Отказ несёт причину и время сброса. Limits неизвестны — можно.
4. **Limits кормятся** каждым сообщением запроса: сервис передаёт каждое сообщение потока в
   `appLimits().recordSdkMessage` — как `observe` делает для Session-ов. `rate_limit_event` каждого
   процесса попадает в Limits и в `LimitsMeter` toolbar-а.
5. **Контекст** — `src/shared/terminal-ai/context.ts` (новый): тип и сборка текста запроса.
   - Поля: строка ввода, папка, до 20 последних команд, ветка git, код выхода последней команды;
     хвост вывода (до 50 строк) — только у `fix`. Поля для переменных окружения в типе нет.
   - Строка и команды с пробелом в начале выбрасываются.
   - В контексте — признаки «идёт команда» и «альтернативный экран». С любым из них сервис запрос не
     шлёт (пункт 3 решений владельца; данные дают Ticket-ы 01 и 03).
   - Ветка — `git branch --show-current` в папке Terminal-а, тайм-аут 1 с
     (`src/main/terminal-ai/git-branch.ts`, новый).
6. **Redaction** — `src/shared/terminal-ai/redact.ts` (новый). Каждое поле — до сборки текста.
   Заменяются на `[redacted]`: `AKIA…`, `ghp_…` и `github_pat_…`, `sk-…`, `xox…`, JWT
   (`eyJ….….…`), `Bearer …`, значение `*_TOKEN=…`, `PASSWORD=…`, пароль в `user:pass@` URL.
7. **Settings** — схема и значения по умолчанию в `src/shared/terminal-ai/settings.ts` (новый),
   хранение — `<WORFY_DATA_DIR>/terminal-ai.json` (`src/main/terminal-ai/settings.ts`, новый).
   - Переключатели: «Terminal AI» (всё); «Suggestion»; «Ask Claude when history has nothing»;
     «Next command» и его модель (Sonnet или Haiku); «Command request»; «Fix».
   - По умолчанию всё включено, модель Next command — Sonnet (решение владельца 1(b); включено по
     умолчанию — spec, «Решено без владельца», пункт 4).
   - Выключенная функция — отказ сервиса с причиной «off».
8. **Каналы** — `src/shared/ipc/terminal-ai.ts` и `src/main/ipc/terminal-ai.ts` (новые), все `local`
   (Settings и состояние — машины экрана, как Limits). Имена — по образцу `link.state` и
   `link.changed`:
   - `terminalAi.state` — Settings, по каждой функции `on`, `off` или `paused` (Limits, со временем
     сброса), состояние процесса (`idle`, `warm`, `busy`);
   - `terminalAi.setSettings` — изменить Settings;
   - событие `terminalAi.changed`.
9. **Fake** — `src/main/terminal-ai/fake-backend.ts` (новый).
   - При `WORFY_AGENT=fake` сервис SDK не импортирует. Ответы — из JSON-файла
     `WORFY_TERMINAL_AI_ANSWERS`: функция, подстрока строки ввода или просьбы, ответ, задержка, по
     желанию — поддельный `rate_limit_event`.
   - Каждый запрос — строка JSON в `WORFY_TERMINAL_AI_LOG`: функция, модель, контекст после
     redaction, отмена.
   - Под vitest (`process.env.VITEST`) без fake настоящая фабрика бросает ошибку: test не может
     потратить подписку.

**Не входит:** socket и shell (Ticket 03); функции (04–07); окно Settings (08).

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-options.test.ts` (новый): опции `prewarm()` — `mcpServers` `{}`, `tools` и `settingSources` пусты, `persistSession` false, `permissionMode` `dontAsk`; во входном окружении есть `ANTHROPIC_API_KEY` — в опциях его нет; опции `claim()` каждой функции — как в пункте 2 (`suggest` — `haiku` и `maxThinkingTokens: 0`; `next` с настройкой «Haiku» — `haiku`).
- [ ] Unit `test/unit/terminal-ai-redact.test.ts` (новый): каждый образец пункта 6 заменён на `[redacted]`, в том числе внутри длинной строки и в URL; `git status`, `export PATH=/usr/bin`, `ls -la` не тронуты.
- [ ] Unit `test/unit/terminal-ai-context.test.ts` (новый): хвост вывода — только у `fix`; команд не больше 20, строк вывода не больше 50; строки с пробелом в начале выброшены; redaction применён к каждому полю.
- [ ] Unit `test/unit/terminal-ai-limits-gate.test.ts` (новый): `five_hour` 0,79 и `allowed` — можно всё; 0,81 — `suggest` и `next` нельзя, `request` и `fix` можно; `allowed_warning` у `seven_day` — автоматические нельзя; `rejected` — нельзя ничего, отказ со временем сброса; 0,9 и `rejected`, но `resetsAt` в прошлом — можно всё; `rejected` без `resetsAt` старше часа — можно; Limits пусты — можно всё.
- [ ] Contract `test/contract/terminal-ai-assist.test.ts` (новый), поддельный SDK и поддельные часы: первый запрос стартует процесс; после ответа сразу прогревается следующий; запрос, пришедший во время прогрева, ждёт его и второй процесс не стартует; 10 минут без запросов — запасной закрыт; новый `suggest` отменяет `suggest` в полёте (его процесс закрыт, следующий прогревается); `fix` отменяет `next`; `next` не отменяет `fix`; тайм-аут `suggest` — отмена; поток `suggest` с thinking — отмена, поток `next` с thinking — нет; `option_not_applied` у `suggest` — отмена, у `fix` — ответ принят; ответ `` `git status` `` — команда `git status`.
- [ ] Тот же contract: `rate_limit_event` из потока запроса виден в `snapshot()` трекера Limits; при `rejected` запрос в SDK не уходит; с признаком «идёт команда» или «альтернативный экран» — тоже; выключенная в Settings функция — отказ «off».
- [ ] Тот же contract: при `WORFY_AGENT=fake` ответ берётся из файла ответов, запрос записан в журнал с контекстом после redaction, SDK не импортирован; под vitest без fake настоящая фабрика бросает ошибку.
- [ ] Contract: `terminalAi.setSettings` пишет `terminal-ai.json`, `terminalAi.state` читает его после перезапуска; каналы `terminalAi.*` этого Ticket-а помечены `local`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — unit Limits: 0,81 окна 5 часов не пускает `suggest`. Потом redaction,
контекст, опции, сервис на поддельном SDK.

Настоящий Claude Code в test-ах не запускается: SDK передаётся параметром, а под vitest настоящий
путь бросает. Принимает ли настоящий `claim()` `maxThinkingTokens: 0` и `effortLevel`, есть ли hooks у
встроенных plugin-ов — вживую проверяет Ticket 09. В «Итог» — как падал первый test, формат файла
ответов fake и имена переменных окружения.

## Где в коде

- `src/main/terminal-ai/assist.ts` (новый)
- `src/main/terminal-ai/options.ts` (новый)
- `src/main/terminal-ai/limits-gate.ts` (новый)
- `src/main/terminal-ai/settings.ts` (новый)
- `src/main/terminal-ai/git-branch.ts` (новый)
- `src/main/terminal-ai/fake-backend.ts` (новый)
- `src/shared/terminal-ai/context.ts` (новый)
- `src/shared/terminal-ai/redact.ts` (новый)
- `src/shared/terminal-ai/settings.ts` (новый)
- `src/shared/ipc/terminal-ai.ts` (новый)
- `src/main/ipc/terminal-ai.ts` (новый)
- `test/unit/terminal-ai-options.test.ts` (новый)
- `test/unit/terminal-ai-redact.test.ts` (новый)
- `test/unit/terminal-ai-context.test.ts` (новый)
- `test/unit/terminal-ai-limits-gate.test.ts` (новый)
- `test/contract/terminal-ai-assist.test.ts` (новый)

Только чтение: `src/main/agent/env.ts`, `src/main/agent/limits.ts`, `src/main/agent/options.ts`,
`src/shared/agent/limits.ts`, `src/main/storage/paths.ts`, `src/main/claude-home/registry.ts` — их
правит открытый PR #200; перечитать на свежем main при claim.

## Итог

Заполняется при закрытии.
