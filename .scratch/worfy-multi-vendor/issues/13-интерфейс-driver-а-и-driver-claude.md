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
