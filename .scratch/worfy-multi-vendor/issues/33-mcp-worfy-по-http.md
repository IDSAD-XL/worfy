# 33 — MCP worfy по HTTP для Codex

Type: task
Status: done 2026-11-03T03:36Z
PR: #1265
Blocked by: 16, 20
Source: [spec.md](../spec.md), «Модель» (часть mcp), «Решения владельца» (Q1 — первый выпуск); решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть mcp); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «MCP подробнее»)

## Что происходит

- `worfy-canvas` и `worfy-browser` — SDK-серверы в процессе на каждую Session (после Ticket-а 16 — из описаний
  `src/main/vendors/mcp.ts`, SDK-сервер строит `src/main/vendors/claude/mcp.ts`).
- Codex не умеет MCP в процессе; умеет streamable HTTP (`url`, `http_headers`, `bearer_token_env_var`).
- Владелец 2026-11-02 (Q1): tool-ы worfy для Codex — в первом выпуске, до его приёмки.

## Что делаем

1. `src/main/mcp/http-server.ts` — streamable-HTTP MCP endpoint в worfy main: слушает только `127.0.0.1`,
   порт — свободный, выбирается при старте; на каждую Session — свой token, без него — 401; token живёт, пока живёт
   Session. Tool-ы, описания и вызовы — те же описания серверов (`canvas-server.ts`, `browser-server.ts`).
2. `src/main/vendors/codex/mcp.ts` (stub Ticket-а 17 заменяется) — серверы для `config` `thread/start`
   (`mcp_servers.<имя>.url` и заголовок с token-ом); token в файлы не пишется. `src/main/vendors/codex/session.ts`
   (Ticket 20) берёт их при `thread/start` и `thread/resume`.
3. Cards `worfy.ask` доходит до Session Codex по тому же пути, что у Claude (`src/main/cards/ask.ts`).
4. capabilities Codex: `canvasTools` — да; tooltip-ы недоступности Canvas и Browser у Codex уходят.

Глубина review — `high` (новый сетевой endpoint).

## Готово, когда

- [ ] Contract test: endpoint отвечает списком tool-ов Canvas с token-ом Session; без token-а или с чужим — 401;
      адрес — только `127.0.0.1`.
- [ ] Contract test на фейке: `thread/start` несёт серверы worfy; вызов tool-а Canvas через endpoint создаёт Card,
      как у Claude.
- [ ] Contract test: `worfy.ask` Card доходит до Session Codex.
- [ ] Contract test-ы tool-ов Canvas и Browser у Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/mcp/http-server.ts` (новый)
- `src/main/vendors/codex/mcp.ts` (stub Ticket-а 17), `src/main/vendors/codex/session.ts` — `thread/start`
- `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts` — экспорт описаний
- `src/main/vendors/codex/capabilities.ts`
- `test/contract/mcp-http.test.ts` (новый)

Только читать: `src/main/cards/ask.ts`, `src/main/ipc/card-api.ts`.

## Итог

- `src/main/mcp/http-server.ts` — streamable-HTTP MCP endpoint в worfy main. Слушает только `127.0.0.1`, порт свободный,
  выбирается при старте; в приложении endpoint стартует с первой Session Codex в Project-е и закрывается в `will-quit`.
  `grant(servers)` даёт Session token (32 случайных байта) и URL каждого сервера (`/mcp/<имя>`); token хранится только как
  SHA-256. Без token-а, с другой схемой, с чужим или отозванным token-ом — 401 до чтения тела; сервер выбирает token, не
  путь. Протокол — stateless часть streamable HTTP: POST с JSON-ответом (и batch), уведомление — 202, GET — 405, тело
  больше 8 MiB — 413; методы `initialize`, `ping`, `tools/list`, `tools/call`. Ничего не пишет в log, кроме текста ошибки.
- `canvas-server.ts`, `browser-server.ts` — `canvasBindingForSession` и `browserBindingForSession`: те же описания
  серверов (`canvasServer`, `browserServer`), привязанные к Project-у Session без SDK; `canvasForSession` и
  `browserForSession` Claude строятся поверх них, поведение Claude не меняется.
- `src/main/vendors/codex/mcp.ts` — часть mcp driver-а Codex: `worfy-canvas` и `worfy-browser` для Session в Project-е по
  тем же правилам, что у Claude (список MCP Profile-а, Browser — вместе с canvas, Autopilot-режим для unattended).
  В `thread/start` и `thread/resume` идут ключи `config` `mcp_servers.<имя> = {url, bearer_token_env_var: "WORFY_MCP_TOKEN"}`
  (по ключу на сервер — свои серверы пользователя не затираются) и `developerInstructions` с инструкциями серверов
  (папка Cards, Browser). Token — только в окружении процесса app-server: не в argv, не в JSON-RPC, не в файлах.
  Token живёт, пока живёт процесс: отзывается при `close()` handle-а и при выходе процесса. События handle-а
  наблюдаются: `init` даёт tool-ам id thread-а, `fileChange` в папку Card записывает Session в `lastEditor`, поэтому
  `session.ask` Card доходит до Session Codex тем же путём `src/main/cards/ask.ts`.
- capabilities Codex: `canvasTools: true`, причины недоступности нет.
- Откуда context Session для token-а — решено без владельца, подтвердить: внутри driver-а Codex (`codex/mcp.ts`), теми
  же поисками Project-а, что у Claude; нейтральный `SessionStart` (`src/main/vendors/session.ts`) не расширен.
- Проверка на настоящем Codex 0.166.0 (вне test-ов, временный `CODEX_HOME`): `thread/start` с этими `config`
  подключил оба сервера (`mcpServer/startupStatus/updated` → `ready`, `authStatus: bearerToken`, по 9 tool-ов),
  `mcpServer/tool/call` `create_card` дошёл до endpoint-а; token не найден ни в одном файле `CODEX_HOME`.
- Не сделано: папка Cards не добавлена Codex как writable root (у Claude — `additionalDirectories`): вне Full access
  запись Card-файлов идёт через approval Codex. Нужен `writableRoots` в `sandboxPolicy` `turn/start`
  (`capabilities.ts` `codexSandboxPolicy`, `session.ts` `startTurn`) — отдельный Ticket.

### Доработка, раунд 1 (замечания проверки PR #1265)

- Proxy: с `HTTP_PROXY`/`ALL_PROXY` в окружении worfy Codex слал запросы к `127.0.0.1` через proxy — token уходил proxy
  открытым текстом. Теперь окружение app-server (`directToLoopback`, `codex/mcp.ts`) получает `127.0.0.1,localhost` в
  `NO_PROXY` и `no_proxy` после записей пользователя; написание, заданное только одно, отдаёт свой список другому; любое
  другое написание (Windows читает имя без учёта регистра) тоже получает адреса. Session без серверов окружение не
  меняет. Test-ы: `test/contract/codex-session-mcp.test.ts` (окружение, которое получил fake), `test/unit/codex-mcp-app.test.ts`.
- Test-ы на остановку: `will-quit` закрывает endpoint приложения; неудачный старт повторяется следующим вызовом, вызов
  во время неудачного старта получает ту же ошибку; token отзывается, когда app-server не запустился (spawn бросает).
  Попутно `appMcpHttpEndpoint` сначала берёт `app` Electron, потом слушает порт: при сбое импорта endpoint не остаётся
  открытым без `will-quit` (test на это тоже есть).
- Autopilot для Browser profile-ей на Session Codex: unattended Session получает отказ `browser_open` для profile-я без
  отметки Autopilot (ADR-0078); `openedBy` Browser-а, открытого через endpoint, — thread Session; `appServerOptions`
  (теперь экспортирован) отдаёт `mcp: appCodexMcp`.
- Ветка 500 endpoint-а: tool с результатом, который не сериализуется (BigInt), даёт 500 и одну строку в log без token-а.
- Из «Consider»: запрос с заголовком `Origin` (так шлёт web-страница, Codex — нет) получает 403 до проверки token-а;
  комментарий над `CODEX_CAPABILITIES` исправлен; test-ы MCP Session Codex вынесены из `codex-session.test.ts` в
  `test/contract/codex-session-mcp.test.ts` (у `codex-session.test.ts` больше нет изменений этого Ticket-а). Test
  «token кончается со смертью процесса» убивает процесс fake (SIGKILL), а не роняет его preload-ом.
- Не сделано из «Consider»: `shell_environment_policy.exclude` для `WORFY_MCP_TOKEN`. Ключ `config` в `thread/start`
  задаёт значение по своему пути, поэтому список пользователя был бы, по всей видимости, заменён, а не дополнен (не
  проверено: проверить может только настоящий Codex); чтобы слить, нужно сначала прочитать config пользователя
  (`config/read`), а в схеме `Config` протокола 0.166.0 у `shell_environment_policy` нет своего типа. Это отдельная
  работа; при этом token живёт только пока живёт процесс и подходит только к `127.0.0.1` этой машины.
- Вопрос: заменяет ли `developerInstructions` в `thread/start`/`thread/resume` `developer_instructions` пользователя из
  `~/.codex/config.toml`? По протоколу 0.166.0 (`protocol/ts/v2/ThreadStartParams.ts`, `ThreadResumeParams.ts`,
  `json/v2/ThreadStartParams.json`): параметр — одна строка `string | null` без описания и без варианта «добавить»;
  в `Config` (`protocol/ts/v2/Config.ts`) `developer_instructions` — тоже одна строка `string | null`. Параметры
  `thread/start` (`model`, `sandbox`, `approvalPolicy`, …) — переопределения ключей config на thread. Ничего в схеме не
  говорит о склейке, поэтому по протоколу ожидать надо замену: свой `developer_instructions` пользователя Session в
  Project-е, вероятно, теряет. Подтвердить может только запуск настоящего Codex — его делает владелец (spec.md:442).
  Если замена подтвердится, исправление — прочитать значение пользователя через `config/read` (`ConfigReadParams.cwd`
  даёт итоговый config с учётом слоёв Project-а) и передать его перед инструкциями worfy; это отдельный Ticket.
