# 13 — Интерфейс driver-а, capabilities и driver Claude

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (Vendor, Driver, Capabilities), «Windows», «Соглашения»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), п. 1–2; [ADR-0008](../../../docs/adr/0008-claude-code-native-binary-path.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Граница агента — `QueryFactory` / `QueryHandle` (`src/main/agent/session/types.ts:39-91`), методы — методы `Query`
  SDK.
- Запуск Claude Code — `sdkQueryFactory` (`src/main/agent/app-registry.ts:92-166`, SDK `:98`, `query()` `:164`),
  переключатель фейка `WORFY_AGENT=fake` (`:170-190`), фейк — `src/main/agent/fake-query.ts:650`.
- Опции и путь к бинарнику — `src/main/agent/options.ts` (типы SDK `:77`, `claudeExecutablePath` `:103`,
  `bundledClaudeBinary` `:117`; ветки по `win32`).

## Что делаем

Чистый refactor: поведение Claude не меняется.

1. `src/shared/vendors/vendor.ts` — `VendorId` (`claude`, `codex`), подписи Vendor-ов для интерфейса.
2. `src/shared/vendors/capabilities.ts` — схема capabilities (флаги `subagents`, `hooks`, `inProcessMcp`, `steer`,
   `resume`, `limitWindows`, `slashCommands`, `canvasTools`; списки `permissionPresets`, `effortLevels`; причины
   `unsupported`) и статические capabilities Claude из нынешнего кода (`PERMISSION_MODES` и `EFFORT_LEVELS`,
   `src/shared/agent/settings.ts:8`, `:13`).
3. `src/main/vendors/driver.ts` — интерфейс `VendorDriver` из частей; типы каждой части — в своём файле
   (`session.ts`, `account.ts`, `limits.ts`, `history.ts`, `one-shot.ts`, `mcp.ts`), сначала с нынешними формами,
   их уточнят Ticket-ы 14–16.
4. `src/main/vendors/registry.ts` — `vendorDriver(id)`; пока только `claude`.
5. Перенос в `src/main/vendors/claude/`: `query.ts` (из `app-registry.ts:92-166`), `options.ts` (весь
   `src/main/agent/options.ts`), `fake-query.ts`. `src/main/vendors/claude/index.ts` собирает driver Claude из
   нынешних функций. Импорты по проекту обновляются; реэкспортов на старых путях нет.
6. `SessionRegistry` получает фабрику из `vendorDriver('claude')`, а не из `queryFactoryFromEnv` напрямую.

Глубина review — `high` (граница). Платформенный: переносится код с ветками по платформе (`options.ts`).

## Готово, когда

- [ ] Все существующие test-ы проходят без правок ожиданий; поправлены только пути import.
- [ ] `WORFY_AGENT=fake` работает как раньше (contract test-ы Session и e2e на фейке зелёные).
- [ ] Unit test: capabilities Claude — четыре permission presets и пять уровней effort в нынешнем порядке.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/shared/vendors/vendor.ts`, `src/shared/vendors/capabilities.ts` (новые)
- `src/main/vendors/driver.ts`, `registry.ts`, `session.ts`, `account.ts`, `limits.ts`, `history.ts`,
  `one-shot.ts`, `mcp.ts` (новые)
- `src/main/vendors/claude/index.ts`, `query.ts`, `options.ts`, `fake-query.ts` (новые, перенос)
- `src/main/agent/app-registry.ts` — `:92-190`
- `src/main/agent/options.ts` — весь файл (переезжает)
- `src/main/agent/fake-query.ts` — весь файл (переезжает)
- `src/main/agent/session/registry.ts` — `:11-18`
- Test-ы: `test/unit/capabilities.test.ts` (новый) и импорты в test-ах, которые зовут перенесённые модули
