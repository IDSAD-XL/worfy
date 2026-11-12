# Spike: connector-ы claude.ai не стартуют в Session worfy (worfy-mcp-live, Ticket 11)

Дата: 2026-11-12. Проверено на SDK `@anthropic-ai/claude-agent-sdk` 0.3.322 и его Claude Code 2.1.322
(`claude-agent-sdk-darwin-arm64`, тот же номер, что в Stable 802d79536). Смещения ниже — байты в бинарнике
`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.322/.../claude` worktree-а (sha256 начинается с
`a9d237949db816a0`; у копии в Stable другой sha256 — подпись `.app` меняет файл, версия та же). Бинарник читался
только как строки (`strings`, `grep -boaF`); запускался только в sandbox без входа.

## Коротко

Причина — форма allowlist-а worfy, а не SDK. worfy пишет connector в policy tier записью
`{ serverName: "claude.ai <имя>" }`, а Claude Code принимает в `allowedMcpServers` только имена из букв, цифр, `_` и
`-`. Запись с точкой и пробелом он выбрасывает при чтении («Invalid entry was ignored»), остальной список
действует, и connector, которого больше нет в списке, отрезан. Restart отправляет тот же список — и тот же итог.
Сами connector-ы claude.ai в Session от SDK грузятся: их видит query инвентаря worfy (он и даёт строку «not
started»). Выбранный путь — разрешать удалённые серверы, connector-ы тоже, записью `serverUrl` с адресом из
инвентаря. Запасной путь — честная строка без Restart.

## Как проверено

- Чтение `sdk.mjs` и `sdk.d.ts` SDK 0.3.322 и строк бинарника Claude Code (смещения у каждого вывода).
- Чтение кода worfy: `src/main/vendors/claude/options.ts`, `mcp-inventory.ts`, `query.ts`, `mcp.ts`.
- Сценарий в sandbox: `scripts/spikes/harness-plugin/connector-name.mjs` (`node scripts/spikes/harness-plugin/connector-name.mjs`
  из корня worktree). HOME и `CLAUDE_CONFIG_DIR` во временной папке, fake `security` и `open` первыми в PATH, без
  входа, ни одного сообщения — модель не вызывается. Серверы выдуманы, удалённые смотрят на закрытые локальные
  порты, поэтому каждый кончается `failed`: важно только, есть ли сервер в `mcpServerStatus()` (отрезанного policy
  нет совсем, F:cut-status-start из spike 01). Настоящий connector в sandbox не получить — он приходит только с
  входом в claude.ai; его заменяет сервер конфигурации пользователя с именем того же вида.

Итог сценария (2026-11-12):

| Вариант `managedSettings` | Что Claude Code перечислил | stderr |
|---|---|---|
| нет | `acme-widget`, `claude.ai Acme Widget`, `claude.ai Acme Remote`, `acme-remote` | — |
| как пишет worfy: `allowManagedMcpServersOnly` + все четыре имени `serverName` | `acme-widget`, `acme-remote` | `Managed settings contain invalid entries (remaining valid policies are still enforced)`, дважды `allowedMcpServers[]: Invalid entry was ignored: failed validation` |
| только `serverName: "claude.ai Acme Remote"` | ничего | то же, один раз |
| `serverName: acme-widget` + `serverUrl` адреса `claude.ai Acme Remote` | `acme-widget`, `claude.ai Acme Remote` | — |
| `serverName: acme-remote` + `serverUrl` адреса `claude.ai Acme Remote` | `claude.ai Acme Remote` (удалённый `acme-remote` по имени уже не прошёл) | — |
| без списка, `deniedMcpServers: [{ serverName: "claude.ai Acme Remote" }]` | все, кроме `claude.ai Acme Remote` | — |

## Вопрос 1. Запускает ли Claude Code connector-ы claude.ai в Session от SDK, и при каком условии

Да. Отдельного флага SDK для connector-ов нет; Session worfy не передаёт ничего, что их выключает.

- Условия в Claude Code (одни для CLI и для SDK). Connector-ы не грузятся, если:
  `ENABLE_CLAUDEAI_MCP_SERVERS` задана ложным значением или в настройках `disableClaudeAiConnectors`
  (`jyt()`, смещение 274992648; «[claudeai-mcp] Disabled via …», 131119212); safe mode; провайдер не Anthropic —
  Bedrock, Vertex и т. п. («Disabled on third-party provider», 131119440); вход перебит API-ключом
  (`ANTHROPIC_API_KEY` или другой источник ключа: «Disabled: API-key auth precedence active», 131119511); у входа нет
  scope `user:mcp_servers` (причина `missing-scope`); конфигурацию передали флагом — `--strict-mcp-config` или
  `--bare` (причина `restricted`, 141634214); есть `managed-mcp.json` администратора — тогда connector-ы подавлены,
  пока managed settings не скажут `allowAllClaudeAiMcps: true` (261515807).
- SDK: `--strict-mcp-config` уходит в Claude Code только при `strictMcpConfig: true`
  (`if(w)B.push("--strict-mcp-config")`, `sdk.mjs:155`); `ENABLE_CLAUDEAI_MCP_SERVERS` SDK не задаёт (в `sdk.mjs` это
  имя есть только в списке переменных окружения, присваивания нет); `managedSettings` уходит флагом
  `--managed-settings` (`sdk.mjs:155`).
- worfy: Session не ставит `strictMcpConfig` — он есть только у служебных query (`narrator.ts:56`,
  `terminal-ai.ts:44`, `limits.ts:119`); `settingSources` — user, project, local (`options.ts:717`); переменных про
  connector-ы в `src/` нет.
- Живой факт владельца это подтверждает: строка «not started» появляется только у сервера, который есть в ответе
  query инвентаря (`notStartedRows`, `src/main/vendors/claude/mcp-inventory.ts:203`). Query инвентаря — тот же
  `query()` SDK с теми же настройками пользователя, но без `managedSettings` (`inventoryOptions`, `options.ts:700`).
  Значит, без списка Profile-а Claude Code в Session от SDK connector-ы перечисляет. Это закрывает открытый пункт
  ADR-0021 («перечисляет ли query инвентаря connector-ы claude.ai») и шаг 1 живой проверки spike 01: да.
- `allowManagedMcpServersOnly` сам по себе connector-ы не выключает: он только велит брать `allowedMcpServers`
  из policy tier (описание в `sdk.d.ts:7801`). Подавление «your organization manages MCP servers» — это
  `managed-mcp.json`, его worfy не пишет.

## Вопрос 2. Не отрезает ли их сам worfy

Да, отрезает — формой записи, а не выбором имени.

- worfy: имя из `mcp.allowed` Profile-а (`profileAllowlist`, `query.ts:362`) идёт в policy tier как есть:
  `allowedMcpServers: allowlist….map((serverName) => ({ serverName }))` вместе с `allowManagedMcpServersOnly: true`
  (`src/main/vendors/claude/options.ts:752`).
- Claude Code: имя connector-а — `claude.ai ${display_name}`, при совпадении названий с суффиксом ` (2)`
  (274997582). Схема записи `allowedMcpServers`: `serverName` — `/^[a-zA-Z0-9_-]+$/`, «Server name can only contain
  letters, numbers, hyphens, and underscores» (134206244). Запись, которая не прошла схему, выбрасывается одна, с
  предупреждением в stderr, остальные policy действуют («Managed settings contain invalid entries (remaining valid
  policies are still enforced)», 131884184). Имя connector-а всегда содержит точку и пробел — ни одна запись
  `serverName` его не пропускает.
- Сверка имени сама по себе точная: `serverName===e`, где `e` — ключ сервера в том виде, в каком его показывает
  `mcpServerStatus()` (`fT`, 275035444). Префикс `claude.ai ` и пробелы не расходятся с тем, что пишет worfy: запись
  просто не доживает до сверки. В `deniedMcpServers` своя схема — непустое имя без пробелов по краям, сравнение
  «verbatim» (134206875); поэтому Turn off connector-а без списка (deny по имени, `options.ts:756`) работает — строка
  «deny» в таблице выше.
- То же касается любого сервера пользователя с точкой или пробелом в имени, не только connector-ов.
- Ловушка для исправления (`fT`, 275036363): если в списке есть хоть одна запись `serverUrl`, удалённый сервер
  (http, sse, connector) сверяется только по адресу, запись `serverName` его больше не пропускает. Для stdio то же
  правило с `serverCommand` уже записано в ADR-0048, пункт 4.

## Вопрос 3. Что менять в worfy

### Выбранный путь: удалённые серверы — по адресу

Claude Code сверяет удалённый сервер по `serverUrl`, если такие записи есть, а адрес connector-а — это `url` его
конфигурации (адрес сервиса из списка connector-ов claude.ai, 274997582), и `mcpServerStatus()` отдаёт его в
`config.url` (для `claudeai-proxy`: `type`, `url`, `id`). Query инвентаря worfy этот ответ уже получает.

1. Инвентарь держит в памяти, рядом со строками, адрес каждого удалённого сервера (`config.url` при `type`
   `http`, `sse`, `claudeai-proxy`); в renderer, лог, Journal и Flight recorder адреса не уходят.
2. `sessionOptions` получает эти адреса и строит `allowedMcpServers`: каждый разрешённый удалённый сервер с
   известным адресом — `{ serverUrl: <адрес> }`, все остальные имена — `{ serverName }`. Удалённые идут по адресу
   все сразу, иначе один `serverUrl` отрежет удалённые серверы, названные по имени (строка «acme-remote» в таблице).
   Имя, которое не проходит `/^[A-Za-z0-9_-]+$/` и адреса которого инвентарь не знает, в список не идёт — Claude Code
   всё равно его выбросит.
3. Старт Session берёт последний ответ инвентаря (`McpInventory.latest`). Allow и Restart и так идут после ответа
   инвентаря, поэтому Restart строки «not started» теперь запускает connector. Первая Session Project-а, начатая до
   первого ответа инвентаря, стартует без connector-а, как сейчас, и её строка предлагает Restart — теперь он
   помогает.
4. Строка `not-started` для имени, которое Claude Code не может разрешить (точка или пробел, адреса нет), говорит
   это честно и Restart не предлагает (запасной путь ниже).

Цена: адреса connector-ов попадают в аргументы процесса Claude Code (`--managed-settings`, их видит `ps` того же
пользователя — имена там уже есть); два сервера с одним адресом разрешаются вместе; адрес сервиса может смениться —
тогда до следующего ответа инвентаря connector снова «not started». Нужна поправка к ADR-0021 (форма записи) — её
пишет Orchestrator.

Что этим не доказано: что `serverUrl` пропускает именно connector (`claudeai-proxy`). Код `fT` ведёт connector с
`scope: "claudeai"` той же веткой, что http-сервер (`Nys` → `config.url`, 275036363), и sandbox показывает её на
http-сервере с именем вида `claude.ai …`; сам connector проверит владелец, шаг 3 ниже.

### Запасной путь: честная строка

Если шаг 3 живой проверки скажет «не перечислен»: connector нельзя разрешить списком Profile-а вообще.

- Строка `not-started` для имени с точкой или пробелом: «Claude Code cannot allow a server by a name with a dot or a
  space, which every claude.ai connector has, so a Session with the Project's list never starts it.» Restart не
  предлагать: он отправит тот же список.
- Строка `not-allowed` такого connector-а не предлагает Allow (он запишет имя, которое Claude Code выбросит) —
  только тот же текст.
- Отвергнутый вариант — вместо allowlist-а deny-список всего, что инвентарь нашёл вне `mcp.allowed` (deny сравнивает
  имена дословно, строка «deny» в таблице). Цена: сервер, добавленный после ответа инвентаря, входит в Session без
  Allow, и `allowedMcpServers` пользователя снова действует — Profile перестаёт быть списком разрешённого
  (ADR-0021). Только с решением владельца.

## Предложение следующего Ticket-а (заводит Orchestrator)

«Connector claude.ai разрешается по адресу»: пункты 1–4 выбранного пути. Где в коде:
`src/main/vendors/claude/mcp-inventory.ts` (адреса удалённых серверов в памяти), `src/main/vendors/claude/options.ts`
(записи `serverUrl`, правило «все удалённые по адресу»), `src/main/vendors/claude/query.ts` и `session.ts` (адреса из
`latest()` в опции Session), строка `not-started` для имени без адреса; тесты на построение `managedSettings`, на то,
что адреса не выходят из main, и сценарий `connector-name.mjs` как contract-проверка формы. Готово, когда разрешённый
connector после Restart в строке `connected` или `needs-auth` у владельца. Исправление небольшое, но не «одна
строка»: от правила «все удалённые сразу» зависит, не потеряют ли Session-ы удалённые серверы пользователя, поэтому
отдельный Ticket с ревью, а не правка здесь.

## Живая проверка — шаги для владельца (вручную, 10 минут)

Профиль, `~/.claude/settings.json` и Project settings не меняются. Сообщений нет — модель не вызывается. Claude Code
при старте сам обновляет `~/.claude.json`, как при любой Session.

1. Обычный терминал (не внутри Claude Code и не внутри worfy), вход в Claude Code подпиской claude.ai,
   `ANTHROPIC_API_KEY` не задан. В корне любого checkout-а worfy с `node_modules` сохранить как `connector-live.mjs`:

   ```js
   import { query } from '@anthropic-ai/claude-agent-sdk'
   async function status(managedSettings) {
     let end
     const ended = new Promise((resolve) => (end = resolve))
     const prompt = { [Symbol.asyncIterator]: () => ({ next: () => ended }) }
     const q = query({ prompt, options: { cwd: process.cwd(), settingSources: ['user', 'project', 'local'], ...(managedSettings ? { managedSettings } : {}) } })
     let list = await q.mcpServerStatus()
     for (let i = 0; i < 20 && list.some((s) => s.status === 'pending'); i++) {
       await new Promise((r) => setTimeout(r, 500))
       list = await q.mcpServerStatus()
     }
     end({ done: true, value: undefined })
     q.close()
     return list
   }
   const connectors = (await status()).filter((s) => s.config?.type === 'claudeai-proxy')
   const withUrl = connectors.filter((s) => typeof s.config?.url === 'string')
   console.log(`1. connectors without a list: ${connectors.length}, with config.url: ${withUrl.length}`)
   const one = withUrl[0]
   if (one) {
     const byName = await status({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: one.name }] })
     console.log(`2. by name: ${byName.some((s) => s.name === one.name) ? 'listed' : 'not listed'}`)
     const byUrl = await status({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverUrl: one.config.url }] })
     const row = byUrl.find((s) => s.name === one.name)
     console.log(`3. by URL: ${row ? `listed, ${row.status}` : 'not listed'}`)
   }
   ```

2. `node connector-live.mjs`, затем удалить файл. Скрипт печатает только числа и слова, без имён и адресов.
3. Ожидание по чтению кода: шаг 1 — число connector-ов больше нуля, и у всех есть `config.url`; шаг 2 — `not listed`
   (сегодняшняя ошибка); шаг 3 — `listed` с любым статусом. `listed` на шаге 3 — выбранный путь; `not listed` или
   `with config.url: 0` — запасной.

Итог (заполняет владелец):

- [ ] (вручную) Шаг 1, connector-ы без списка и с `config.url`: …
- [ ] (вручную) Шаг 2, по имени: …
- [ ] (вручную) Шаг 3, по адресу: …

## Настоящие настройки не изменились

Fingerprint — `stat` (размер, mtime), содержимое не читалось. До работы и после сценария: `~/.claude/settings.json`
1014 байт, mtime 1794126046 — совпадает; `profile.json` всех четырёх Profile-ов этой Machine — размер и mtime
совпадают. `~/.claude.json`: размер 125657 до и после, mtime меняется и без сценария —
его пишут работающие Session-ы Stable (их процессы Claude Code видны в `ps`); sandbox-процесс писал в свой
`CLAUDE_CONFIG_DIR` (во временной папке появились `backups`, `plugins`, `sessions`), а в `~/.claude/projects` нет
папки с именем временной папки сценария.
