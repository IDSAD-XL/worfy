# 13 — Интерфейс driver-а, capabilities и driver Claude

Type: task
Status: done 2026-11-02T09:56Z
PR: #1237
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (Vendor, Driver, Capabilities), «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); Ticket 10 ([10-третий-vendor-на-бумаге.md](10-третий-vendor-на-бумаге.md), «Какие правки нужны границе»); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), п. 1–2

## Что происходит

- Граница агента — `QueryFactory` / `QueryHandle` (`src/main/agent/session/types.ts:39-91`), методы — методы `Query`
  SDK. Запуск Claude Code — `sdkQueryFactory` (`src/main/agent/app-registry.ts:92-166`), выбор фейка —
  `queryFactoryFromEnv` (`:170-190`); реестр Session-ов берёт фабрику в конструкторе
  (`src/main/agent/session/registry.ts:11-18`).
- Типов Vendor-а, capabilities и driver-а нет.

## Что делаем

Чистый refactor: поведение Claude не меняется, файлы не переезжают (перенос `options.ts` и `sdkQueryFactory` —
Ticket 16). Задача Ticket-а — создать все файлы, которые потом правят параллельные Ticket-ы, чтобы они не правили
общих.

1. `src/shared/vendors/vendor.ts` — `VendorId` (`claude`, `codex`), текстовые подписи Vendor-ов.
2. `src/shared/vendors/capabilities.ts` — схема capabilities: флаги `subagents`, `hooks`, `inProcessMcp`,
   `canvasTools`, `steer`, `resume`, `historyList`, `modelSwitchStable`, `oneShotToolFree`, `commandsComplete`,
   `harness`; `limitSource` — `windows`, `errorOnly` или `none`; списки `permissionPresets` (`{id, label,
   description}`), `effortLevels`; причины недоступности `unsupported`. Статические capabilities Claude — из
   нынешнего кода (`PERMISSION_MODES`, `EFFORT_LEVELS`, `src/shared/agent/settings.ts:8`, `:13`).
3. Типы частей, каждая в своём файле `src/main/vendors/`: `session.ts`, `account.ts`, `limits.ts`, `history.ts`,
   `commands.ts`, `one-shot.ts`, `mcp.ts`; `driver.ts` собирает их в `VendorDriver`. Формы по Ticket-у 10:
   - `account.check()` → список подключений `{provider, signedIn, email, plan}` (у Claude и Codex — одно);
   - `account.startLogin()` → `{kind: 'url', url}`, `{kind: 'vendorOpensBrowser'}` или `{kind: 'terminal',
     command}`;
   - `limits.read()` → `LimitWindow[]` (Ticket 11; процент и время сброса могут быть `null`, у окна может быть
     `provider`), отказ лимита — событие `limit_reached`;
   - `oneShot(prompt, opts)` — `opts` может дать read-only tool-ы и structured output (черновик профиля Project).
4. `src/main/vendors/registry.ts` — `vendorDriver(id)`; пока только `claude`.
5. `src/main/vendors/claude/index.ts` и файлы частей `claude/session.ts`, `account.ts`, `limits.ts`, `one-shot.ts`,
   `mcp.ts`, `terminal-ai.ts`, `history.ts`, `commands.ts` — тонкие обёртки над нынешними функциями
   (`queryFactoryFromEnv`, `accountInfo`, Limits probe (`usage`), черновик, `createSdkMcpServer`, Terminal AI, registry
   транскриптов, `commands.ts`). Ticket-ы 14, 15, 16 правят только свои файлы частей, `index.ts` — нет.
6. `SessionRegistry` получает фабрику через `vendorDriver('claude')`.

Глубина review — `high` (граница).

## Готово, когда

- [ ] Все существующие test-ы проходят без правок.
- [ ] Unit test: capabilities Claude — четыре permission presets и пять уровней effort в нынешнем порядке,
      `limitSource: 'windows'`.
- [ ] Unit test (типы): `startLogin` принимает три вида результата; `check` — список подключений.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/shared/vendors/vendor.ts`, `src/shared/vendors/capabilities.ts` (новые)
- `src/main/vendors/driver.ts`, `registry.ts`, `session.ts`, `account.ts`, `limits.ts`, `history.ts`,
  `commands.ts`, `one-shot.ts`, `mcp.ts` (новые)
- `src/main/vendors/claude/index.ts`, `session.ts`, `account.ts`, `limits.ts`, `one-shot.ts`, `mcp.ts`,
  `terminal-ai.ts`, `history.ts`, `commands.ts` (новые)
- `src/main/agent/session/registry.ts` — `:11-18`
- `src/main/agent/app-registry.ts` — место создания `SessionRegistry`
- Test-ы: `test/unit/capabilities.test.ts`, `test/unit/vendor-driver-types.test.ts` (новые)

## Итог

PR #1237, merge `897c4969`. Поведение Claude не изменилось; файлы частей driver-а созданы, как в «Что делаем».

Каким интерфейс стал после раунда 1 ревью:

- `commands.list(session)` → `SlashCommand[]` (`src/main/vendors/commands.ts`): строки slash-меню — у живой Session,
  а не у Vendor-а вообще.
- `OneShotOptions.onActivity` (`src/main/vendors/one-shot.ts`) — текст о ходе разового запроса, как его сейчас
  показывает черновик профиля Project.
- `HistorySession.origin` — `worfy`, `external` или `null` (`src/main/vendors/history.ts`).
- `account.startLogin()` → `LoginAttempt {start, completed, cancel}` (`src/main/vendors/account.ts`): `start` — как
  начинается вход (три вида из «Что делаем», п. 3), `completed` — подключения после входа, `cancel()` — отмена.
- `capabilities(session?)` (`src/main/vendors/driver.ts`): у capabilities есть список `models[]`; Vendor, который
  знает модели только от живой Session, отдаёт их при `session`. У Claude — `supportedModels()` живого query.
- history Claude подключена к registry `claude-home` (`src/main/vendors/claude/history.ts`, `ClaudeHomeRegistry`
  грузится при вызове).
- `limits.read` и `oneShot` Claude не подключены до Ticket-а 15: отказ `PartNotWired`
  (`src/main/vendors/claude/limits.ts`, `one-shot.ts`).

Отличие от spec-а: `history.read(id, cwd)` вместо `read(id)` — Claude хранит транскрипты в папке Project-а, и
`transcriptPath` ищет файл по корню Project-а; Codex может `cwd` не читать (spec, «Решено без владельца», п. 13).
ADR-0094 не правится. Решено Orchestrator-ом 2026-11-02 по поручению владельца, подтвердить при приёмке.

Долг:

- Циклический импорт `src/main/agent/app-registry.ts` → `src/main/vendors/registry.ts` → `claude/index.ts` →
  `claude/session.ts` → `app-registry.ts` (`queryFactoryFromEnv`). Сегодня безопасен: driver собирается при первом
  вызове, части читаются при вызове, а не при загрузке модулей (`src/main/vendors/claude/index.ts`,
  `src/main/vendors/registry.ts:9`). Цикл снимает Ticket 16: `queryFactoryFromEnv` переезжает в
  `src/main/vendors/claude/`.
- Нет test-а на `claudeHistory.read` с `cwd` вне Project-а (папки, которой нет среди Project-ов registry).
- Функция capabilities Claude лежит в `claude/index.ts`, а не в своём файле части; позже её может перенести в
  `claude/capabilities.ts` отдельный Ticket.
