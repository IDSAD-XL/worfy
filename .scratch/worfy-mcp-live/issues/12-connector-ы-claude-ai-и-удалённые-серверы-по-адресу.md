# 12 — Connector-ы claude.ai и удалённые серверы проходят список Profile-а по адресу

Type: task
Status: claimed 2026-11-12T22:28Z
Blocked by: 11
Source: spike Ticket 11 (`.scratch/worfy-mcp-live/spike-claudeai-connectors.md`, «Выбранный путь») и проверка PR #1844
(подтверждённые факты и пробелы: query, пустой список, сервер без адреса, scope `claudeai`)

## Что происходит

- worfy пишет каждое имя из `mcp.allowed` в policy tier записью `{ serverName }`
  (`src/main/vendors/claude/options.ts`, `allowedMcpServers`). Claude Code 2.1.322 принимает `serverName` только из
  букв, цифр, `_` и `-`: запись connector-а `claude.ai <имя>` он выбрасывает («Invalid entry was ignored»), остальной
  список действует, и разрешённый connector в Session не стартует, Restart тоже не помогает.
- `deniedMcpServers` сравнивает имена дословно: Turn off connector-а без списка работает, его не трогаем.
- Если в списке есть хоть одна запись `serverUrl`, удалённый сервер (http, sse, connector) сверяется только по адресу.
  Адрес connector-а — `config.url` из `mcpServerStatus()`; его уже получает query инвентаря
  (`src/main/vendors/claude/mcp-inventory.ts`).

## Что сделать

1. Инвентарь держит в памяти main, рядом со строками, адрес каждого удалённого сервера: `config.url` http- и
   sse-сервера любого scope и сервера со scope `claudeai`. Запись типа `claudeai-proxy` с другим scope (случай proxy)
   адреса не даёт — описать в комментарии кода и в поправке ADR-0021. Адреса не уходят в строки renderer, лог, Journal
   и Flight recorder.
2. Старт Session берёт адреса последнего ответа инвентаря. Каждый разрешённый удалённый сервер с известным адресом —
   запись `serverUrl`, все сразу; остальные имена, которые Claude Code может прочитать, — `serverName`; имя без адреса,
   которое Claude Code не прочитает, в список не идёт.
3. Адрес с query (а также fragment, имя и пароль) пишется как origin + path + `*`, без query: token не должен попасть в
   `--managed-settings`, который видит `ps` (решение по правилу владельца о соразмерной защите).
4. Пустой после фильтра список уходит как `allowedMcpServers: []`, ключ не опускается никогда (без ключа разрешено всё).
5. Удалённый сервер, адрес которого старт Session ещё не знал (добавлен после ответа инвентаря), не пропадает молча:
   инвентарь перечитывается при следующем старте, а до него строка `not-started` говорит «Found after this Session
   started: restart the Session to start it.» с Restart. Сервер, который нельзя разрешить ни по имени, ни по адресу
   (connector без `config.url`), говорит это честно и Restart не предлагает. Здесь — только main и данные строки.
6. Исправить неверный комментарий `options.ts` о том, что `allowedMcpServers` фильтрует connector-ы claude.ai по имени.
7. Поправка ADR-0021, датированная 2026-11-13: закрыт открытый пункт про connector-ы (инвентарь их перечисляет), правило
   адреса, правило query, правило пустого списка. Текст решения выше не меняется.

## Готово, когда

- [ ] Записи списка: stdio — `serverName`, удалённый сервер с адресом — `serverUrl`, query срезан до origin + path + `*`,
      пустой список — `[]`, имя без адреса, которое Claude Code не прочитает, — не в списке. Unit- и contract-тесты.
- [ ] Адреса только в main: строки, лог и Journal их не несут. Contract-тест.
- [ ] Старт Session берёт адреса инвентаря; удалённый сервер, найденный после старта, — строка `not-started` с причиной и
      Restart; connector без адреса — строка с честной причиной без Restart. Contract-тест.
- [ ] Комментарий `options.ts` исправлен; поправка ADR-0021 от 2026-11-13 дописана.
- [ ] lint, typecheck, `pnpm test` и gate fast — exit 0; CI на PR зелёный.
- [ ] (вручную) Владелец: настоящий connector claude.ai стартует в Session worfy — шаг 3 живой проверки в заметке
      spike 11; входит в приёмку, Ticket 08.

## Где в коде

- `src/main/vendors/claude/mcp-addresses.ts` — новый: адреса из ответа инвентаря, шаблон `serverUrl`, записи списка.
- `src/main/vendors/claude/options.ts` — `allowedMcpServers` из записей, `mcpAddresses`, комментарий о policy tier.
- `src/main/vendors/claude/mcp-inventory.ts` — адреса рядом со строками, `addresses()`, причина строки `not-started`.
- `src/main/vendors/claude/session.ts` — адреса при старте Session, адреса в строках `not-started`.
- `src/main/vendors/claude/query.ts` — `mcpAddresses` запроса в `sessionOptions`.
- `src/main/agent/session/types.ts` — `QueryRequest.mcpAddresses`.
- `docs/adr/0021-mcp-servers-allowlist-in-profile.md` — поправка 2026-11-13.
- `docs/features/mcp-servers.md` — список по адресу, причина строки «not started».
- `test/unit/mcp-addresses.test.ts`, `test/unit/agent-options.test.ts`, `test/contract/claude-mcp-addresses.test.ts`.

## Вне скоупа

- Вид строки в renderer (`src/renderer/session/McpChip.tsx`, `src/shared/agent/mcp-status.ts`,
  `test/e2e/session-mcp.spec.ts`, `test/unit/mcp-chip.test.tsx`) — их меняет Ticket 10. Строка «not started» уже
  показывает причину из main (`error`), отдельная правка renderer не нужна.
- Шаг после Ticket 10: строка в конце группы «A claude.ai connector missing here: add its name to MCP servers in Project
  settings (Edit profile).» (`McpChip.tsx`) говорит о вписывании имени вручную; connector, который инвентарь нашёл, уже
  в группе. Пересмотреть текст этой строки, когда Ticket 10 влит.
- Сценарий `scripts/spikes/harness-plugin/connector-name.mjs` как contract-проверка формы на настоящем Claude Code —
  не здесь: он запускает бинарник Claude Code.
