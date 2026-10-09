# 0058 — Terminal AI: свой процесс Claude Code на подписке — без MCP, tools, настроек и транскриптов, один на все Terminal-ы, Haiku и Sonnet по функции
Дата: 2026-10-09. Статус: принят.

**Контекст.** Владелец решил 2026-10-09 добавить в Terminal-ы worfy помощь модели Claude:
Suggestion, Next command, Command request и Fix (термины — [CONTEXT.md](../../CONTEXT.md), раздел
«Terminal AI»; Epic `worfy-terminal-ai`, [spec](../../.scratch/worfy-terminal-ai/spec.md)). Платить —
подпиской владельца, как за Session-ы. Что есть в worfy:

- Session — процесс Claude Code через Agent SDK с конфигурацией пользователя: `settingSources` user,
  project и local, preset `claude_code`, MCP-серверы по списку Profile-а
  ([ADR-0021](0021-mcp-servers-allowlist-in-profile.md)); опции — `src/main/agent/options.ts:227-246`.
- Session-ам haiku нельзя (Ticket 07 Epic-а worfy-daily, `isSelectableModel` —
  `src/shared/agent/settings.ts:40-42`). Причина — 634 tools MCP-серверов владельца: на haiku второй
  ход падал с «Prompt is too long» (ADR-0021, «Контекст»).
- Окружение агента — без `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` (`src/main/agent/env.ts:31`;
  [ADR-0007](0007-claude-code-launch-environment.md), [ADR-0057](0057-agent-environment-on-windows.md)):
  Claude Code входит по подписке.
- Limits кормят сообщения Session-ов (`LimitsTracker.recordSdkMessage`, `src/main/agent/limits.ts:96`;
  обёртка фабрики Session-ов — `src/main/agent/app-registry.ts:94`) и файл status line.

Spike 2026-10-09 на подписке Max владельца, 34 запроса
([evidence](../../.scratch/worfy-terminal-ai/evidence/spike-задержки-2026-10-09.md)):

- Процесс с `settingSources: []`, `mcpServers: {}`, `strictMcpConfig: true`, `tools: []`,
  `persistSession: false`, `permissionMode: 'dontAsk'`, `title` и `maxTurns: 1` отвечает по подписке
  (`apiKeySource: none`) и транскриптов не пишет. Три встроенных plugin-а Claude Code грузятся и так;
  есть ли у них hooks, spike не проверял.
- Старт процесса ~0,5 с (`startup()` 462–513 ms, `prewarm()` 746 ms), RSS 210–300 MB.
- Haiku с `effort: 'low'` всё равно думает: медиана ~3,8 с, один ответ — 54 с. Без thinking — 16
  запросов (`results.jsonl`, строки 7–9 и 39–47 с `thinking: {type: 'disabled'}`, 22–26 после
  `setMaxThinkingTokens(0)`): первый текст 682–5421 ms, медиана ~1,3 с; один из 16 — дольше 5 с.
- Sonnet с `effort: 'low'`: в 8 запросах блоков thinking не было; первый токен 0,8–2,8 с, ответ
  1,4–3,8 с. Выключить thinking у Sonnet 5.5 нельзя (https://code.claude.com/docs/en/costs).
- Prompt cache Sonnet работает и между разными процессами. Haiku кэширует только запросы от 4096
  токенов (документация prompt caching); в spike-е запросы на 1066 и 1154 токена не кэшировались.
- Тёплый процесс выигрывает у холодного только старт. Streaming-Session копит историю — у Haiku без
  thinking +51–88 токенов на ход, у Sonnet и у Haiku с thinking больше, — а `rate_limit_event` шлёт
  один раз на процесс.
- Качество: на `git log --one` Haiku с системным prompt-ом worfy ответил `line-format=%h %s`, Sonnet —
  `line`. Haiku, которого просили вернуть только текст после курсора, с просьбой в системном prompt-е
  потерял пробел перед новым словом в 6 ответах из 8, с просьбой в сообщении пользователя сохранил
  его во всех 7 нужных случаях.
- SDK 0.3.289 держит процесс тёплым двумя способами. `startup()` стартует процесс с опциями вызова;
  в режиме потока у его Query есть `setModel()`, `setMaxThinkingTokens()` и
  `applyFlagSettings({effortLevel})`, а `systemPrompt` фиксирован (spike так выключил thinking).
  `prewarm()` (alpha) паркует запасной процесс до того, как известна Session: при старте
  фиксируются `settingSources`, `env`, `systemPrompt`, `mcpServers`, `hooks`, tools и plugin-ы, а
  `claim()` задаёт `cwd` Session-а (обязательно), `model`, `maxThinkingTokens`, `settings` (в том
  числе `effortLevel`), `appendSystemPrompt` и `title`. `claim()` spike не пробовал.

Правила подписки — две стороны:

- Support-статья, обновление от 2026-10-07: «You can still use the Claude Agent SDK … with your
  subscription limits» (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
  Обновление от 15 июня 2026 там же ставит на паузу объявленные ранее изменения в использовании
  Agent SDK; обновление от 7 октября добавляет, что в планы Max и Team входят ежемесячные кредиты API,
  которые покрывают Agent SDK.
- Страница legal Claude Code (https://code.claude.com/docs/en/legal-and-compliance): лимиты Pro и Max
  «assume ordinary, individual usage of Claude Code and the Agent SDK». OAuth подписки там описан как
  вход для обычного использования Claude Code и приложений Anthropic. Разработчики продуктов,
  «including those using the Agent SDK, should use API key authentication».
- Там же: конечный пользователь может входить своей подпиской в немодифицированный Claude Code, в
  том числе внутри чужого продукта. Запрещено: предлагать вход claude.ai в своих продуктах; слать
  запросы через учётные данные подписки от имени своих пользователей; собирать, хранить или
  пропускать через себя учётные данные и токены claude.ai — вход идёт через flow Anthropic. Anthropic
  может применять правила «without prior notice».

**Решение.**

1. **Terminal AI — не Session.** Запросы Terminal AI идут в отдельный процесс Claude Code через
   Agent SDK — assist-процесс.
   - При старте процесса (`prewarm()`): `settingSources: []` — без настроек, hooks, plugin-ов и
     `CLAUDE.md` пользователя и Project-а; `mcpServers: {}` и `strictMcpConfig: true`; `tools: []`,
     `permissionMode: 'dontAsk'`, `maxTurns: 1` — модель только отвечает текстом;
     `persistSession: false` — без транскрипта; общий `systemPrompt` строкой; окружение — то же, что у
     Session-ов (`agentEnv()`, без ключей API), поэтому вход по подписке.
   - При каждом запросе (`claim()`): `cwd` — пустая папка worfy в его папке данных, не Project:
     процесс общий для всех Project-ов, а Session-ой Project-а worfy считает процесс с `cwd` внутри
     Project-а (`src/main/claude-home/registry.ts`). `cwd` у `prewarm()` — только папка ожидания.
   - Hooks встроенных plugin-ов Claude Code `settingSources: []` не убирает. Есть ли они, проверяют
     Ticket-ы 02 и 09 Epic-а.

   У Terminal AI нет Node-а, Binding-а и транскрипта.
2. **Один процесс на все Terminal-ы, каждый запрос самостоятельный.** Процесс стартует с первым
   запросом Terminal AI. Дальше worfy держит один заранее прогретый запасной процесс (`prewarm()`).
   Запрос — `claim()` этого процесса с настройками функции, один ход. После ответа или отмены
   процесс закрывается, следующий сразу прогревается. Без запросов около 10 минут запасной процесс
   закрывается. `prewarm()` + `claim()`, а не `startup()` с переключением в режиме потока: все
   настройки функции — одной записью до отправки prompt-а, с отдельным отказом на каждую;
   инструкция функции — `appendSystemPrompt`, а не текст в сообщении пользователя. `startup()` —
   запасной путь, если `claim()` (alpha) подведёт вживую. Почему не одна долгая streaming-Session:
   - история не копится: запрос из Terminal-а одного Project-а не несёт команд другого, и ответ не
     зависит от прошлых запросов;
   - выигрыш долгой Session — только старт ~0,5 с, а его прячет прогрев;
   - каждый процесс шлёт `rate_limit_event`, поэтому Limits свежие после каждого запроса;
   - отмена запроса — закрытие его процесса, без остатков в общей истории;
   - Haiku не кэширует запросы короче 4096 токенов: растущая история стоила бы полную цену каждый
     ход, а Sonnet кэширует и между процессами.

   В полёте один запрос. Новый автоматический запрос отменяет автоматический. Запрос по требованию
   отменяет автоматический и сам не отменяется.

   Владелец решил: один общий тёплый процесс, запросы самостоятельные. Как этого добиться — свежий
   `claim()` прогретого процесса, а не перезапуск одной streaming-Session — выбрано в docs-PR Epic-а
   по цифрам spike-а; подтвердить у владельца.
3. **Модель — по функции**, задаётся при `claim()`.
   - Suggestion — `haiku`, `maxThinkingTokens: 0`;
   - Next command — `sonnet`, `effortLevel: 'low'`; в Settings владелец может выбрать haiku;
   - Command request и Fix — `sonnet`, `effortLevel: 'low'`;
   - у каждой функции свой `appendSystemPrompt`.

   Если поток ответа Suggestion начался с thinking или `claim()` не принял `maxThinkingTokens`
   (`option_not_applied`), запрос Suggestion отменяется: такой ответ опоздал бы.
4. **Limits.** Каждое сообщение потока assist-процесса передаётся в `appLimits().recordSdkMessage` —
   так же, как обёртка `observe` делает для Session-ов.
   - Автоматические функции (Suggestion от модели, Next command) выключаются сами, пока окно 5 часов
     занято больше чем на 80 % или у любого окна статус `allowed_warning` или `rejected`.
   - Функции по требованию (Command request, Fix) работают до `rejected`.
   - Окно, чьё время сброса прошло, не считается: ни доля, ни статус.
   - Запрос идёт в assist-процесс Machine, которой принадлежит Terminal, — и с экрана Linked
     machine-а: на её подписке и с её ограничениями (решение владельца 2026-10-09).
   - По умолчанию Terminal AI включён — все четыре функции, с этими ограничениями; всё выключается в
     Settings → «Terminal AI» (решение владельца 2026-10-09).
5. **Что уходит в модель.** Текущая строка, папка, до 20 последних команд этого Terminal-а, ветка
   git, код выхода; для Fix ещё до 50 последних строк вывода упавшей команды.
   - Переменные окружения не уходят никогда.
   - Секреты заменяются до отправки: `AKIA…`, `ghp_` и `github_pat_`, `sk-…`, `xox…`, JWT,
     `Bearer …`, `*_TOKEN=`, `PASSWORD=`, `user:pass@` в URL.
   - Запросов нет, пока идёт команда (там бывает пароль sudo или ssh) и на альтернативном экране
     (vim, less). Строка с пробелом в начале не отправляется.
   - Последовательности OSC без nonce своего shell-а worfy не принимает: их могла напечатать
     программа.
6. **Ничего не запускается само.** Ответ попадает только в строку ввода shell-а. Запускает команду
   пользователь, нажав Enter. У assist-процесса нет tools.
7. **Подписка, а не ключ API — решение владельца с риском.** Владелец решил 2026-10-09: Terminal AI
   идёт на его собственной подписке, для него одного, на его машине. worfy запускает
   немодифицированный Claude Code под входом владельца, не собирает и не хранит его токены, не ходит
   в API мимо Claude Code и не даёт вход claude.ai другим людям. Support-статья прямо разрешает Agent
   SDK на лимитах подписки. Страница legal при этом велит разработчикам продуктов на Agent SDK
   ключ API. Это не установленный факт «так можно», а принятый риск: Anthropic может применить
   правила без предупреждения. Когда у worfy появятся внешние пользователи (E4), пункт решается
   заново.

**Что меняется в прежних ADR.** Правило «Session-ам haiku нельзя» (Ticket 07 Epic-а worfy-daily,
ADR-0021) остаётся для Session-ов: assist-процесс — не Session, и причины правила у него нет, MCP-серверов
и tools нет. ADR-0021 (MCP по списку Profile-а) к assist-процессу не относится: у него серверов нет
совсем. Окружение — по ADR-0007 и ADR-0057, без изменений.

**Последствия.**

- Пока жив запасной процесс, worfy занимает ещё 210–300 MB.
- Каждый запрос и каждая отмена — новый процесс Claude Code: прогрев ~0,75 с (`prewarm()` 746 ms в
  spike-е, один замер). Запрос, пришедший во время прогрева, ждёт его — не дольше этого.
- Каждый запрос — ~440–530 входных токенов постоянной части плюс контекст. Сколько подписки стоит
  Haiku против Sonnet, Anthropic не публикует. 34 запроса spike-а не сдвинули окно 5 часов на 1 %.
- Suggestion от модели приходит через 1,5–5 с. Поэтому сначала — история команд, без модели. Ответ,
  который опоздал или уже не продолжает набранное, не показывается.
- Если псевдоним `haiku` переедет на модель, у которой thinking не выключается, Suggestion от модели
  станет редким: запросы будут отменяться по пункту 3. Sonnet 5.5 может начать думать и на
  `effortLevel: 'low'` — тогда ответы Next command, Command request и Fix станут дольше. Это увидит
  live-проверка владельца.
- Haiku ошибается чаще Sonnet. Suggestion — только серый текст; принимает его пользователь.
- test-ы подписку не тратят: при `WORFY_AGENT=fake` assist-процесс заменяет fake с ответами из файла.
- Если Anthropic изменит правила подписки для Agent SDK или применит их к worfy, Terminal AI
  выключается в Settings. Session-ы worfy зависят от тех же правил.

## Considered Options

- **Ключ API** (Anthropic API, своя оплата по токенам). Его советует страница legal для разработчиков
  продуктов на Agent SDK. Отвергнуто владельцем: отдельный счёт и секрет, который надо хранить; worfy
  сам убирает ключи API из окружения агентов (`env.ts:31`); расход не виден в Limits подписки;
  worfy — приложение одного владельца на его машине.
- **Холодный процесс на каждый запрос**, без прогрева. Отвергнуто: +0,5 с старта на каждый запрос,
  у Suggestion — прямо на пути к ответу.
- **Одна долгая streaming-Session** со всеми запросами. Отвергнуто: история растёт и смешивает
  Terminal-ы разных Project-ов, Limits приходят один раз на процесс, отмена оставляет след в истории.
- **`startup()` и переключение в режиме потока** — `setModel()`, `setMaxThinkingTokens()`,
  `applyFlagSettings({effortLevel})` до первого сообщения. Рабочий путь: spike так выключил thinking.
  Не выбран: три вызова вместо одной записи `claim()` с отказом на каждую настройку, а инструкцию
  функции пришлось бы класть в сообщение пользователя — `systemPrompt` у `startup()` фиксирован.
  Остаётся запасным, если `claim()` (alpha) подведёт.
- **Тёплый процесс на каждую модель или на каждый Terminal.** Отвергнуто: 210–300 MB на процесс.
- **Ghost text поверх xterm, как в VS Code** — renderer рисует серый текст и читает строку ввода с
  экрана. Отвергнуто для zsh: чтение с экрана ломается на right prompt, многострочном вводе и
  vi-mode; нужен приватный `_core` xterm; серый текст пришлось бы рассылать всем экранам
  ([ADR-0053](0053-several-screens-on-one-project.md)). Выбрано: серый текст рисует сам zsh (ZLE,
  `POSTDISPLAY`) — его видят все экраны. Путь VS Code остаётся для shell-ов без такого API.
- **Свой редактор строки ввода, как в Warp.** Отвергнуто: worfy подменил бы редактор строки zsh, и
  сломались бы привязки клавиш и plugin-ы пользователя.
- **Suggestion только из истории, без модели.** Отвергнуто владельцем: когда история молчит,
  спрашивается модель.
- **Выбрано:** assist-процесс без MCP, tools, настроек пользователя и транскриптов, на подписке; один
  прогретый процесс, свежий `claim()` на каждую просьбу; haiku без thinking для Suggestion, sonnet
  для остального.
