# 0058 — Terminal AI: свой процесс Claude Code на подписке — без MCP, tools, hooks и транскриптов, один на все Terminal-ы, Haiku и Sonnet по функции
Дата: 2026-10-09. Статус: принят.

**Контекст.** Владелец решил 2026-10-09 добавить в Terminal-ы worfy подсказки модели Claude:
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
- Limits кормят `rate_limit_event` Session-ов: `appLimits().observe` оборачивает их фабрику
  (`src/main/agent/app-registry.ts:94`), и файл status line.

Spike 2026-10-09 на подписке Max владельца, 34 запроса
([evidence](../../.scratch/worfy-terminal-ai/evidence/spike-задержки-2026-10-09.md)):

- Процесс с `settingSources: []`, `mcpServers: {}`, `strictMcpConfig: true`, `tools: []`,
  `persistSession: false`, `permissionMode: 'dontAsk'`, `title` и `maxTurns: 1` отвечает по подписке
  (`apiKeySource: none`) и транскриптов не пишет.
- Старт процесса ~0,5 с (`startup()` 462–513 ms, `prewarm()` 746 ms), RSS 210–300 MB.
- Haiku с `effort: 'low'` всё равно думает: медиана ~3,8 с, один ответ — 54 с. С выключенным
  thinking первый токен — ~1,3 с (950–4636 ms).
- Sonnet с `effort: 'low'` не думает: первый токен 0,8–1,4 с, ответ 1,4–1,9 с, исправление с
  пояснением — 3,8 с. Prompt cache Sonnet работает и между разными процессами.
- Тёплый процесс выигрывает у холодного только старт. Streaming-Session копит историю (+60–80
  токенов на ход), а `rate_limit_event` шлёт один раз на процесс.
- Качество: на `git log --one` Haiku ответил `line-format=%h %s`, Sonnet — `line`.

Правила подписки:

- Support-статья, обновление от 2026-10-07: «You can still use the Claude Agent SDK … with your
  subscription limits» (https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
- Страница legal Claude Code: лимиты Pro и Max «assume ordinary, individual usage of Claude Code and
  the Agent SDK» (https://code.claude.com/docs/en/legal-and-compliance).
- Там же запрещено: давать вход claude.ai в своём приложении другим людям, слать запросы через
  чужие учётные данные подписки «от имени» своих пользователей, извлекать OAuth-токены claude.ai и
  ходить с ними в API мимо Claude Code.

**Решение.**

1. **Terminal AI — не Session.** Запросы Terminal AI идут в отдельный процесс Claude Code через
   Agent SDK — assist-процесс. Его опции:
   - `settingSources: []` — без настроек, hooks, plugin-ов и `CLAUDE.md` пользователя и Project-а;
   - `mcpServers: {}` и `strictMcpConfig: true` — без MCP-серверов;
   - `tools: []`, `permissionMode: 'dontAsk'`, `maxTurns: 1` — модель только отвечает текстом;
   - `persistSession: false` — без транскрипта; `title` задан — без отдельного запроса заголовка;
   - `systemPrompt` — своя строка у каждой функции; `includePartialMessages: true`;
   - окружение — то же, что у Session-ов (`agentEnv()`, без ключей API), поэтому вход по подписке;
   - `cwd` — пустая папка worfy в его папке данных, не Project: процесс общий для всех Project-ов, а
     Session-ой Project-а worfy считает процесс с `cwd` внутри Project-а
     (`src/main/claude-home/registry.ts`).

   У Terminal AI нет Node-а, Binding-а и транскрипта.
2. **Один процесс на все Terminal-ы, каждый запрос самостоятельный.** Процесс стартует с первым
   запросом Terminal AI. Дальше worfy держит один заранее прогретый запасной процесс. Запрос — новый
   `query()` на нём, один ход. После ответа процесс закрывается, следующий прогревается в фоне.
   Без запросов около 10 минут запасной процесс закрывается. Почему так, а не одна долгая
   streaming-Session:
   - история не копится: запрос из Terminal-а одного Project-а не несёт команд другого, и ответ не
     зависит от прошлых запросов;
   - выигрыш долгой Session — только старт ~0,5 с, а его прячет прогрев;
   - каждый процесс шлёт `rate_limit_event`, поэтому Limits свежие после каждого запроса;
   - отмена запроса — закрытие его процесса, без остатков в общей истории;
   - Haiku не кэширует запросы короче ~1k токенов: растущая история стоила бы полную цену каждый
     ход, а Sonnet кэширует и между процессами.

   В полёте один запрос. Новый автоматический запрос отменяет автоматический. Запрос по требованию
   отменяет автоматический и сам не отменяется.

   Владелец решил: один общий тёплый процесс, запросы самостоятельные. Как этого добиться — свежий
   запрос на прогретом процессе, а не перезапуск одной streaming-Session — выбрано в docs-PR Epic-а
   по цифрам spike-а; подтвердить у владельца.
3. **Модель — по функции.**
   - Suggestion — `haiku` с `thinking: {type: 'disabled'}`;
   - Next command — `sonnet` с `effort: 'low'`; в Settings владелец может выбрать haiku;
   - Command request и Fix — `sonnet` с `effort: 'low'`.

   Если поток ответа Suggestion начался с thinking, запрос отменяется: такой ответ опоздал бы.
4. **Limits.** Фабрика запросов assist-процесса обёрнута `appLimits().observe`, как у Session-ов.
   - Автоматические функции (Suggestion от модели, Next command) выключаются сами, пока окно 5 часов
     занято больше чем на 80 % или у любого окна статус `allowed_warning` или `rejected`.
   - Функции по требованию (Command request, Fix) работают до `rejected`.
   - Всё выключается в Settings → «Terminal AI».
5. **Что уходит в модель.** Текущая строка, папка, до 20 последних команд этого Terminal-а, ветка
   git, код выхода; для Fix ещё до 50 последних строк вывода упавшей команды.
   - Переменные окружения не уходят никогда.
   - Секреты заменяются до отправки: `AKIA…`, `ghp_` и `github_pat_`, `sk-…`, `xox…`, JWT,
     `Bearer …`, `*_TOKEN=`, `PASSWORD=`, `user:pass@` в URL.
   - Запросов нет, пока идёт команда (между OSC 133 C и D: там бывает пароль sudo или ssh) и на
     альтернативном экране (vim, less). Строка с пробелом в начале не отправляется.
   - Последовательности OSC без nonce своего shell-а worfy не принимает: их могла напечатать
     программа.
6. **Ничего не запускается само.** Ответ попадает только в строку ввода shell-а. Запускает команду
   пользователь, нажав Enter. У assist-процесса нет tools.
7. **Подписка, а не ключ API.** worfy запускает официальный Claude Code на машине владельца под его
   же входом, для него одного. Это обычное личное использование Agent SDK по правилам выше. worfy не
   извлекает OAuth-токены, не ходит в API мимо Claude Code и не даёт вход claude.ai другим людям.
   Когда у worfy появятся внешние пользователи (E4), этот пункт решается заново.

**Что меняется в прежних ADR.** Правило «Session-ам haiku нельзя» (Ticket 07 Epic-а worfy-daily,
ADR-0021) остаётся для Session-ов: assist-процесс — не Session, и причины правила у него нет, MCP-серверов
и tools нет. ADR-0021 (MCP по списку Profile-а) к assist-процессу не относится: у него серверов нет
совсем. Окружение — по ADR-0007 и ADR-0057, без изменений.

**Последствия.**

- Пока жив запасной процесс, worfy занимает ещё 210–300 MB.
- Каждый запрос — ~400–470 входных токенов постоянной части плюс контекст. Сколько подписки стоит
  Haiku против Sonnet, Anthropic не публикует. 34 запроса spike-а не сдвинули окно 5 часов на 1 %.
- Suggestion от модели приходит через 1–5 с. Поэтому сначала — история команд, без модели. Ответ,
  который опоздал или уже не продолжает набранное, не показывается.
- Если псевдоним `haiku` переедет на модель, у которой thinking не выключается, Suggestion от модели
  станет редким: запросы будут отменяться по пункту 3. Это увидит live-проверка владельца.
- Haiku ошибается чаще Sonnet. Suggestion — только серый текст; принимает его пользователь.
- test-ы подписку не тратят: при `WORFY_AGENT=fake` assist-процесс заменяет fake с ответами из файла.
- Если Anthropic изменит правила подписки для Agent SDK, Terminal AI выключается в Settings. Session-ы
  worfy зависят от тех же правил.
- Встроенные plugin-ы Claude Code грузятся и при `settingSources: []` (spike). Их hooks не
  проверены — проверяет Ticket 02 Epic-а.

## Considered Options

- **Ключ API** (Anthropic API, своя оплата по токенам). Отвергнуто владельцем: отдельный счёт и
  секрет, который надо хранить; worfy сам убирает ключи API из окружения агентов (`env.ts:31`);
  расход не виден в Limits подписки.
- **Холодный процесс на каждый запрос**, без прогрева. Отвергнуто: +0,5 с старта на каждый запрос,
  у Suggestion — прямо на пути к ответу.
- **Одна долгая streaming-Session** со всеми запросами. Отвергнуто: история растёт и смешивает
  Terminal-ы разных Project-ов, Limits приходят один раз на процесс, отмена оставляет след в истории.
- **Тёплый процесс на каждую модель или на каждый Terminal.** Отвергнуто: 210–300 MB на процесс.
- **Ghost text поверх xterm, как в VS Code** — renderer рисует серый текст и читает строку ввода с
  экрана. Отвергнуто для zsh: чтение с экрана ломается на right prompt, многострочном вводе и
  vi-mode; нужен приватный `_core` xterm; состояние подсказки пришлось бы рассылать всем экранам
  ([ADR-0053](0053-several-screens-on-one-project.md)). Выбрано: серый текст рисует сам zsh (ZLE,
  `POSTDISPLAY`) — его видят все экраны. Путь VS Code остаётся для shell-ов без такого API.
- **Свой редактор строки ввода, как в Warp.** Отвергнуто: worfy подменил бы редактор строки zsh, и
  сломались бы привязки клавиш и plugin-ы пользователя.
- **Suggestion только из истории, без модели.** Отвергнуто владельцем: когда история молчит,
  спрашивается модель.
- **Выбрано:** assist-процесс без MCP, tools, hooks и транскриптов, на подписке; один прогретый
  процесс, свежий запрос на каждую просьбу; haiku без thinking для Suggestion, sonnet для остального.
