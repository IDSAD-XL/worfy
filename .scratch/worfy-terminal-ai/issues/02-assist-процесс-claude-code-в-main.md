# 02 — Assist-процесс в main: тёплый Claude Code на подписке, модели по функции, Limits, redaction, Settings, fake для test-ов

Type: task
Status: done — 2026-10-10, [PR #205](https://github.com/IDSAD-XL/worfy/pull/205)
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
- SDK 0.3.289 (`sdk.d.ts` пакета) даёт два способа держать процесс тёплым.
  - `startup(options)` стартует процесс с опциями вызова; `WarmQuery.query()` вызывается один раз и
    принимает строку или поток сообщений. В режиме потока у Query есть `setModel()`,
    `setMaxThinkingTokens()` и `applyFlagSettings({effortLevel})` — до первого сообщения можно
    сменить модель, thinking и effort. `systemPrompt` фиксирован при старте. Spike так и сделал:
    `setMaxThinkingTokens(0)` на процессе `startup()` выключил thinking.
  - `prewarm()` (alpha) паркует запасной процесс до того, как известна Session. При старте
    фиксируются исполняемый файл, `settingSources`, `env`, `systemPrompt`, `mcpServers`, `hooks`,
    tools и plugin-ы; `cwd` у `prewarm()` — только папка ожидания, «never the session's folder».
    `claim()` задаёт `cwd` Session-а (обязательно), `model`, `maxThinkingTokens`, `settings`
    (например, `effortLevel`), `appendSystemPrompt`, `title` — до отправки prompt-а. Запасной
    процесс в простое — 230–260 MB.
  - Отказы `claim()`: `option_not_applied` — запрос ушёл, но без `model` или `maxThinkingTokens`;
    `settings_not_applied` — overlay `settings` отклонён, запрос не ушёл, процесс закрыт;
    `not_claimed`, `claim_failed`, `spare_exited`, `spare_closed` — запрос не ушёл.
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
     закрывается.
   - Почему `prewarm()` + `claim()`, а не `startup()`: все настройки функции — одной записью до
     отправки prompt-а, с отдельным отказом на каждую; инструкция функции — `appendSystemPrompt`, а не
     текст в сообщении пользователя; `cwd` Session-а задаётся при запросе. `startup()` с `setModel()`,
     `setMaxThinkingTokens()` и `applyFlagSettings()` в режиме потока — тоже рабочий путь (spike его
     частично проверил) и запасной: если `claim()` (alpha) подведёт вживую, Ticket переходит на него, а
     инструкция функции идёт в сообщение пользователя.
   - Запрос пришёл, пока запасной ещё прогревается, — ждёт его, не стартуя второй.
   - `option_not_applied` у `suggest` (thinking не выключился) — запрос отменяется; у остальных —
     ответ принимается, строка в лог.
   - Отказ, после которого запрос не ушёл (`settings_not_applied` — например, отклонён `effortLevel`;
     `not_claimed`, `claim_failed`, `spare_exited`, `spare_closed`): `request` и `fix` повторяются один
     раз обычным `query()` с теми же опциями — холодный старт, как советует SDK; `suggest` и `next` —
     отказ без повтора. Ждать тайм-аута при таком отказе нельзя.
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
     `agentEnv()`, ключи `API_KEY_VARS` вычищаются ещё раз; `pathToClaudeCodeExecutable` —
     `claudeExecutablePath`. `cwd` у `prewarm()` не задаётся: это только папка ожидания.
   - При `claim()`, у всех функций: `cwd` — пустая папка `<WORFY_DATA_DIR>/terminal-ai/` (риск 4
     spec-а: по `cwd` Session-а worfy решает, чья она). По функции: `suggest` — `model: 'haiku'`, `maxThinkingTokens: 0`; `next` —
     `sonnet` с `settings: {effortLevel: 'low'}`, а с настройкой «Haiku» — `haiku` с
     `maxThinkingTokens: 0`; `request` и `fix` — `sonnet`, `effortLevel: 'low'`. У каждой функции —
     свой `appendSystemPrompt` и `title`.
   - Что из этого SDK принимает на самом деле, проверяет contract на поддельном SDK; вживую —
     Ticket 09.
3. **Порог Limits** — `src/main/terminal-ai/limits-gate.ts` (новый), чистая функция от `LimitsState`,
   функции и текущего времени.
   - Окно, у которого `resetsAt` уже прошёл, не считается: ни доля, ни статус. Окно без `resetsAt` —
     `allowed_warning` и `rejected` считаются час после `receivedAt` (spec, «Решено без владельца»,
     пункт 10).
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
   - По умолчанию всё включено, модель Next command — Sonnet (решения владельца 1(b) и 8(b)).
   - Выключенная функция — отказ сервиса с причиной «off».
8. **Каналы** — `src/shared/ipc/terminal-ai.ts` и `src/main/ipc/terminal-ai.ts` (новые), все `local`
   (Settings и состояние — машины экрана, как Limits). Имена — по образцу `link.state` и
   `link.changed`:
   - `terminalAi.state` — Settings, по каждой функции `on`, `off` или `paused` (Limits, со временем
     сброса), состояние процесса (`idle`, `warm`, `busy`);
   - `terminalAi.setSettings` — изменить Settings;
   - событие `terminalAi.changed` — при смене Settings, состояния процесса, Limits (когда main шлёт окнам
     `limits.changed`) и по таймеру на время сброса окна, которое держит паузу: в этот момент `paused`
     снимается без нового запроса. Таймер — по часам, как `wallTimer` ожидания Autopilot
     (`src/main/autopilot/limits-wait.ts`): Mac мог спать.
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

- [x] Unit `test/unit/terminal-ai-options.test.ts` (новый): опции `prewarm()` — `mcpServers` `{}`, `tools` и `settingSources` пусты, `persistSession` false, `permissionMode` `dontAsk`; во входном окружении есть `ANTHROPIC_API_KEY` — в опциях его нет; опции `claim()` каждой функции — как в пункте 2 (`cwd` — папка `terminal-ai` в папке данных; `suggest` — `haiku` и `maxThinkingTokens: 0`; `next` с настройкой «Haiku» — `haiku`); у опций `prewarm()` нет `cwd` Session-а.
- [x] Unit `test/unit/terminal-ai-redact.test.ts` (новый): каждый образец пункта 6 заменён на `[redacted]`, в том числе внутри длинной строки и в URL; `git status`, `export PATH=/usr/bin`, `ls -la` не тронуты.
- [x] Unit `test/unit/terminal-ai-context.test.ts` (новый): хвост вывода — только у `fix`; команд не больше 20, строк вывода не больше 50; строки с пробелом в начале выброшены; redaction применён к каждому полю.
- [x] Unit `test/unit/terminal-ai-limits-gate.test.ts` (новый): `five_hour` 0,79 и `allowed` — можно всё; 0,81 — `suggest` и `next` нельзя, `request` и `fix` можно; `allowed_warning` у `seven_day` — автоматические нельзя; `rejected` — нельзя ничего, отказ со временем сброса; 0,9 и `rejected`, но `resetsAt` в прошлом — можно всё; `rejected` без `resetsAt` старше часа — можно; Limits пусты — можно всё.
- [x] Contract `test/contract/terminal-ai-assist.test.ts` (новый), поддельный SDK и поддельные часы: первый запрос стартует процесс; после ответа сразу прогревается следующий; запрос, пришедший во время прогрева, ждёт его и второй процесс не стартует; 10 минут без запросов — запасной закрыт; новый `suggest` отменяет `suggest` в полёте (его процесс закрыт, следующий прогревается); `fix` отменяет `next`; `next` не отменяет `fix`; тайм-аут `suggest` — отмена; поток `suggest` с thinking — отмена, поток `next` с thinking — нет; `option_not_applied` у `suggest` — отмена, у `fix` — ответ принят; `settings_not_applied` у `fix` — один повтор через `query()`, у `next` — отказ сразу, без ожидания тайм-аута; ответ `` `git status` `` — команда `git status`.
- [x] Тот же contract: `rate_limit_event` из потока запроса виден в `snapshot()` трекера Limits; при `rejected` запрос в SDK не уходит; с признаком «идёт команда» или «альтернативный экран» — тоже; выключенная в Settings функция — отказ «off»; пауза по Limits со временем сброса через минуту — через минуту (поддельные часы) `terminalAi.changed` и `on` без нового запроса.
- [x] Тот же contract: при `WORFY_AGENT=fake` ответ берётся из файла ответов, запрос записан в журнал с контекстом после redaction, SDK не импортирован; под vitest без fake настоящая фабрика бросает ошибку.
- [x] Contract: `terminalAi.setSettings` пишет `terminal-ai.json`, `terminalAi.state` читает его после перезапуска; каналы `terminalAi.*` этого Ticket-а помечены `local`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

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

- **Что сделано.** Сервис `AssistService` (`src/main/terminal-ai/assist.ts`) — один на запуск worfy,
  `request(feature, input, signal)` отвечает `{ok: true, command, model}` или
  `{ok: false, reason, until?, detail?}`. Причины отказа: `off`, `limits` (с `until` — когда пауза снимется),
  `command-running`, `alternate-screen`, `private-line`, `busy`, `cancelled`, `timeout`, `thinking`,
  `option-not-applied`, `not-claimed`, `empty`, `failed`. Процесс — `prewarm()` при первом запросе,
  `claim()` на запрос, после ответа или отмены процесс закрывается и сразу прогревается следующий;
  10 минут без запросов (`IDLE_MS`) — запасной закрыт. Опции — `options.ts`, порог Limits —
  `limits-gate.ts`, контекст и текст запроса — `src/shared/terminal-ai/context.ts`, redaction —
  `redact.ts`, Settings — `src/shared/terminal-ai/settings.ts` и `<WORFY_DATA_DIR>/terminal-ai.json`,
  каналы `terminalAi.state`, `terminalAi.setSettings`, `terminalAi.changed` — все `local`.
- **Подключение к запуску приложения без `src/main/index.ts`.** Сервис создаёт `appAssist()` при первом
  вызове канала `terminalAi.*` (модуль `src/main/ipc/terminal-ai.ts` находится сам, ADR-0006); на
  `will-quit` он закрывает запасной процесс и запрос в полёте. Пока `request()` никто не зовёт — socket
  shell-а делает Ticket 03.
- **Как падал первый test.** `test/unit/terminal-ai-limits-gate.test.ts` против заглушки, которая пускала
  всё: 5 из 8 красные, первый — `expected [ 'suggest', 'next', 'request', 'fix' ] to deeply equal
  [ 'request', 'fix' ]` (0,81 окна 5 часов пустил `suggest`).
- **Fake: переменные окружения и формат.** `WORFY_AGENT=fake` — сервис берёт `fakeAssistBackend` и SDK не
  загружает. `WORFY_TERMINAL_AI_ANSWERS` — JSON-массив, файл читается заново на каждый запрос:

  ```json
  [{"feature": "suggest", "match": "git st", "answer": "`git status`", "delayMs": 300, "thinking": true,
    "rateLimit": {"status": "allowed", "rateLimitType": "five_hour", "utilization": 0.4, "resetsAt": 1791202800}}]
  ```

  `feature` и `match` (подстрока строки ввода или слов просьбы) по желанию;
  отвечает первая подходящая запись, без неё ответ пустой (`empty`). `WORFY_TERMINAL_AI_LOG` — по строке
  JSON на запрос, при его конце: `{feature, model, context, cancelled, cold}`; `context` — после
  redaction, `cold: true` — повтор через `query()`.
- **Test не может потратить подписку.** `realBackend()` под vitest бросает до загрузки SDK; модуль SDK
  в contract test-е подменён `vi.mock`, и test проверяет, что его не загрузил никто
  (`sdkModule.loaded` = 0) и что загрузчик SDK не вызван ни с fake, ни без него.
- **Mutation testing** (свой worktree, восстановление из копии): 12 мутантов `assist.ts` — без проверки
  `VITEST`, автоматический отменяет запрос по требованию, без записи в Limits, без отмены на thinking,
  без закрытия по простою, без повтора `query()`, без таймера паузы, без порога Limits, второй
  `prewarm()` во время прогрева, `option_not_applied` у `suggest` не отменяет, `claim()` бросает
  наружу, ожидающий в очереди не уходит по отмене — каждый роняет contract test.
- **Решено без владельца, подтверждено владельцем 2026-10-12:**
  1. Окно без `resetsAt` считается час после `receivedAt` целиком — и доля, и статус, а не только
     `allowed_warning` и `rejected`: старая доля без времени сброса ничего не говорит о текущем окне.
  2. Автоматический запрос, пока летит или ждёт запрос по требованию, — отказ `busy`, а не очередь:
     Suggestion и Next command после 30 с ожидания уже не нужны.
  3. Ожидающий в очереди запрос по требованию уходит сразу, если вызывающий отменил его (`signal`).
  4. Redaction шире списка пункта 6: ещё `ASIA…`, `gho_`/`ghu_`/`ghs_`/`ghr_`, `*_KEY=`, `*SECRET*=`,
     `*PASSWD*=` в любом регистре (в том числе `password=` в query string), опции `--password`,
     `--token`, `--secret`, `--api-key` и блок PEM `PRIVATE KEY`. Поле длиннее 2000 символов обрезается.
  5. `init` SDK 0.3.289 поля hooks не несёт: строка процесса пишет `hooks: not reported by init`, а
     каждый `system/hook_started` — отдельной строкой (`hook_event` и `hook_name`, без вывода). Есть ли
     hooks у встроенных plugin-ов, по-прежнему проверяет Ticket 09.
  6. Запасной процесс, умерший в простое, просто убирается; новый стартует со следующим запросом.
     Запасной, умерший между выдачей запросу и `claim()` (`claim()` бросает), — отказ `not-claimed`:
     `request` и `fix` повторяются через `query()`, как при остальных отказах `claim()`.
  7. Подписка окна на `terminalAi.changed` — при вызове `terminalAi.state` или `terminalAi.setSettings`
     из этого окна, как `limits.open`.
  8. Ключи Settings: `enabled`, `suggestion`, `suggestionAsksModel`, `nextCommand`, `nextCommandModel`
     (`sonnet` | `haiku`), `commandRequest`, `fix`. Сломанное поле файла берёт значение по умолчанию.
  9. Тексты `systemPrompt` и `appendSystemPrompt` функций — черновые; их доводят Ticket-ы 04–07.
  10. Ответ `request` несёт модель (`model`), чтобы Ticket-ы 04–07 и 09 видели, кто ответил.
- **Не проверено вживую:** принимает ли настоящий `claim()` `maxThinkingTokens: 0` и `effortLevel`, есть
  ли hooks у встроенных plugin-ов, держит ли `query()`-повтор опцию `effort` — Ticket 09 (запросы к
  модели только у владельца).
- **Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (174 файла, 3365 test-ов). `GATE_SCOPE=all` gate full под замком `/tmp/worfy-e2e.lock` на коммите da46eb4 — exit 0, `[gate] зелено (full): lint typecheck test test:e2e test:package`. CI PR #205 (`check`) — pass.
- **Доработка после ревью, раунд 1** (комментарий PR #205 6090095036; база раунда — 34fe085 после rebase):
  1. `prewarmOptions()` ставит `includeHookEvents: true`: без него SDK шлёт `hook_started` только для
     SessionStart и Setup, и hook на UserPromptSubmit прошёл бы мимо лога. Закреплено в unit test опций и
     в contract test (строка лога на `hook_started`).
  2. Test-ы: запасной процесс умер в простое — состояние `idle`, следующий запрос стартует новый процесс;
     Fix в очереди за Fix-ом, который принёс `rejected`, — отказ `limits`, в SDK ничего; Fix, выключенный
     в Settings, пока ждал, — отказ `off`; отменённый во время прогрева Suggestion оставляет процесс в
     слоте, и тот закрывается через 10 минут простоя; `dispose()` закрывает запасной процесс, запрос в
     полёте и процесс, который достартовал после `dispose()`; окно, которое закрылось, снимает подписку.
  3. Запрос с уже отменённым `signal` ничего не стартует (новая проверка в начале `request()`); отмена во
     время чтения ветки git останавливает запрос до `claim()` — test.
  4. Redaction: `curl -u user:pass` и `--user`, `mysql -pSecret` (mysql, mysqldump, mysqladmin, mariadb),
     `Authorization: Basic|token|…`, `Basic <base64>`, npm `:_authToken=` (имя на `TOKEN` без `_`),
     `APIKEY=`/`ACCESSKEY=`, Stripe `sk_live_`/`rk_live_` (и `_test_`), Google `AIza…`. `sk-…` — только
     целый токен (не после `/`, `.`, `-`), от 16 символов после `sk-` и с цифрой: ветка
     `feature/sk-learn-upgrade-for-models` не тронута. Не тронуты и `git push -u origin main`,
     `mkdir -p`, `mysql -p` без значения, `sort -u`, `MONKEY=1`.
  5. Контекст: сначала redaction, потом обрезка до 2000 символов (на вход redaction — не больше 8000, это
     только ограничение работы: секрет на той границе всё равно за 2000-м символом). Строки хвоста
     вывода Fix режутся до 500 символов (`MAX_OUTPUT_LINE_CHARS`), тоже после redaction.
  - Mutation testing раунда: 18 мутантов (по одному на каждую новую проверку и каждый новый шаблон
    redaction) — все роняют test (`/tmp/worfy-terminal-ai-w1/impl-02/mut/run2.sh`).
  - Гонка, оставленная как есть: запасной процесс умер, а запрос взял его раньше, чем пришёл `exited`, —
    `claim()` бросает, Suggestion и Next command получают отказ `not-claimed`, Fix и Command request
    повторяются через `query()` (test «retries a Fix … spare exits between being taken and the claim»).
- **Узкий раунд после ревью, раунд 2** (комментарии PR #205 6090558481 и 6090571753; база — e356f79):
  1. `sk-…` снова закрывается после `/` и `.` (путь к файлу ключа, URL, `foo.sk-…`); слово вроде
     `feature/sk-learn-upgrade-for-models` держит проверка на цифру.
  2. Первая обрезка (до 8000 символов поля, до 2000 символов строки вывода Fix) убирает слово, которое
     она разрезала: redaction сжимает текст перед ним (длинный JWT становится `[redacted]`), и голова
     ключа `AKIAABCDEF` попадала бы в первые 2000 (500) символов. Одно слово длиннее первой обрезки
     уходит целиком.
  3. `-u`/`--user` (и `-a`/`--auth` у httpie) с `x:y` закрываются только после `curl`, `wget`, `http`,
     `https` как отдельной команды: `docker run -u 1000:1000`, `docker exec --user root:root`,
     `podman run --user=nobody:nogroup`, `sort -u a:b`, `docker run --name my-curl -u 1000:1000` не
     тронуты.
  4. `Basic <слово>` закрывается, только если слово похоже на base64-учётные данные: в нём есть цифра,
     `+`, `/` или `=`, или оно декодируется в печатное `user:password`. `Basic configuration done`,
     `Basic authentication failed`, `## Basic Requirements` не тронуты; голый `Basic dXNlcjpwYXNzd29yZA==` закрыт.
  - Mutation testing раунда: 8 мутантов (`/tmp/worfy-terminal-ai-w1/impl-02/mut/run3.sh`), все роняют
    unit test, в том числе мутант, который убирает правило `Basic`.
- **Раунд по решению владельца 2026-10-10** (комментарии PR #205 6090798859 и 6090844527; база — 2804fdb
  после rebase): пароль `-u`/`--user` (и `-a`/`--auth` у httpie) у `curl`, `wget`, `http`, `https`
  снова закрывается во всех формах. Команда может идти с путём (`/usr/bin/curl`, `./curl`, `~/bin/wget`)
  и после кавычки, обратной кавычки или `$(`. Между командой и опцией `;`, `&`, `|` внутри кавычек
  (`-H "Content-Type: a; b"`, `"https://x?a=1&b=2"`) команду не обрывают; вне кавычек обрывают. Без
  изменений остаются `docker run -u 1000:1000`, `docker exec --user root:root`,
  `podman run --user=nobody:nogroup`, `sort -u a:b`, `docker run --name my-curl -u …`,
  `URL=https://x.io/curl -u …`, а также docker после `curl … ;`, `&&`, `|` или новой строки.
  Mutation testing: 6 мутантов правила (`/tmp/worfy-terminal-ai-w1/impl-02/mut/run4.sh`) — все красные.
- **UI не менялся** (окно Settings — Ticket 08), снимков нет.

### Gate оркестратора (2026-10-10)

- Круг 1 — `REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6090095036)): нет `includeHookEvents`; три пробела в test-ах жизни запасного процесса; мелкие — отменённый запрос, `dispose()`, отписка окна, пропуски redaction, обрезка до redaction.
- Круг 2 — `REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6090558481)): доработка перестала закрывать `sk-…` после `/` и `.`; голова секрета на первой обрезке; ложные срабатывания `-u x:y` и `Basic <слово>`. Четыре находки устояли перед скептиками, high нет; Ticket блокирует 03–09 — узкий круг ([NARROW](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6090571753)).
- Узкий круг — `NARROW: REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6090798859)): правка `-u` открыла утечку пароля `curl -u` в частых формах.
- Решение владельца 2026-10-10 ([комментарий](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6090844527)): ещё один короткий круг только по утечке `curl -u`.
- Круг владельца — `VERIFIED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/205#issuecomment-6091147537)), diff `2804fdb..129c6fe`. Долги:
  - [low] `src/shared/terminal-ai/redact.ts:79` — ложное срабатывание на аргументе-пути: `docker run -w /x/curl -u 1000:1000 img` → `1000:[redacted]`.
  - [low] `redact.ts:79` — многострочный `curl … \` с `-u` на следующей строке не закрывается (было и до круга); так же `\curl -u …` и `"curl" -u …`.
  - [low] `redact.ts:79` — квадратичное время на открытой кавычке: до 30 мс на худший хвост вывода Fix; вход ограничен в `context.ts:80, 88`.
  - Из прежних кругов: голова секрета в кавычках с пробелами на первой обрезке; строка вывода Fix из одного слова длиннее 2000 символов пустая; `Basic` без паддинга и цифр с длиной не кратной 4 не закрывается; `sk-…` с цифрой в имени ветки закрывается лишний раз; Fix в очереди во время `dispose()` отвечает `failed`.
- Мерж: ветка на `0f4bf19`, `GATE_SCOPE=all gate full` — код 0 (результат из кэша Gate для того же коммита `129c6fe`, прогнанного исполнителем под замком), CI зелёный, CLEAN, влит `1fe8382`.
