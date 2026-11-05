# 16 — MCP-серверы и Terminal AI через driver Claude; contract test строгий

Type: task
Status: done 2026-11-02T16:38Z
PR: #1248
Blocked by: 12, 14, 15
Source: [spec.md](../spec.md), «Модель» (части mcp и oneShot), «Решено без владельца», п. 2, «Готово, когда»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- MCP-серверы `worfy-canvas` и `worfy-browser` строит SDK (`createSdkMcpServer`, `tool`):
  `src/main/mcp/canvas-server.ts:317-324`, `src/main/mcp/browser-server.ts:425-432`.
- Terminal AI грузит SDK сам (`src/main/terminal-ai/assist.ts:34`, `:70-105`), опции —
  `src/main/terminal-ai/options.ts:15`, фейк — `fake-backend.ts:21`.
- Опции и путь к бинарнику Claude — `src/main/agent/options.ts` (типы SDK `:77`, `claudeExecutablePath` `:103`,
  ветки по `win32`); запуск — `sdkQueryFactory` (`src/main/agent/app-registry.ts:92-166`, SDK `:98`).
- После Ticket-ов 14 и 15 других импортов SDK вне `src/main/vendors/claude/` не остаётся.

## Что делаем

1. `src/main/vendors/mcp.ts` — описание сервера worfy в типах worfy: имя, tool-ы (имя, описание, zod-форма,
   вызов). `canvas-server.ts` и `browser-server.ts` отдают такое описание; SDK-сервер из него строит
   `src/main/vendors/claude/mcp.ts`. Tool-ы, описания и вызовы не меняются.
2. Terminal AI: загрузка SDK, `claim` запасного процесса и опции переезжают в
   `src/main/vendors/claude/terminal-ai.ts`; `assist.ts` зовёт driver Claude. Terminal AI остаётся только на Claude
   (решение 07, «позже»).
3. Перенос: `src/main/agent/options.ts` → `src/main/vendors/claude/options.ts`, `sdkQueryFactory` →
   `src/main/vendors/claude/query.ts`; импорты обновляются (`src/main/ipc/harness.ts`, `src/main/ipc/projects.ts`,
   `src/main/mcp/*`, `src/main/terminal-ai/options.ts`, `test/contract/agent-autocompact.test.ts`,
   `test/contract/claude-process-stub.ts`, `test/contract/harness-install.test.ts`,
   `test/contract/orchestrator-relaunch.test.ts`, `test/contract/projects-connect.test.ts`,
   `test/unit/agent-executable.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/agent-query-factory.test.ts`;
   динамический импорт `sdkQueryFactory` из `app-registry` — `test/contract/browser-tools.test.ts:1084` и
   `test/contract/workflow-profile.test.ts:507`).
   Реэкспортов на старых путях нет.
   Туда же, в `src/main/vendors/claude/query.ts`, переезжает `queryFactoryFromEnv`
   (`src/main/agent/app-registry.ts:171-189`): так кончается циклический импорт `app-registry.ts` →
   `vendors/registry.ts` → `claude/index.ts` → `claude/session.ts` → `app-registry.ts` (долг Ticket-а 13). Импорты
   обновляются: `src/main/vendors/claude/session.ts:6`, `src/main/ipc/first-run.ts`,
   `test/unit/vendor-driver-types.test.ts`, `test/unit/agent-query-factory.test.ts`,
   `test/contract/plan-preset.test.ts`. Решено Orchestrator-ом 2026-11-02 по поручению владельца, подтверждено владельцем 2026-11-05.
   Третья копия правила «Claude вошёл» — с Ticket-а 14 в `src/main/vendors/claude/session.ts:327` — заменяется
   вызовом `claudeSignedIn` (`src/main/vendors/claude/account.ts:16`, Ticket 15, п. 6).
4. Список исключений `test/contract/vendor-sdk-imports.test.ts` пуст; исключение, которое уже не импортирует SDK,
   теперь — красный test. С Ticket-а 15 SDK не импортируют `src/main/ipc/first-run.ts`, `src/main/ipc/projects.ts`,
   `src/main/projects/connect.ts`, `src/main/agent/limits-usage.ts` — их исключения уходят первыми.

Глубина review — `high` (граница). Платформенный: `src/main/terminal-ai/**` и перенос кода с ветками по платформе
(`options.ts`).

## Готово, когда

- [ ] Contract test-ы tool-ов Canvas и Browser и test-ы Terminal AI проходят без правок ожиданий.
- [ ] `test/contract/vendor-sdk-imports.test.ts` строгий и зелёный; SDK импортирует только `src/main/vendors/claude/`.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы модулей `src/main/mcp` и `src/main/terminal-ai` — exit 0.

## Где в коде

- `src/main/vendors/mcp.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/terminal-ai.ts` (файлы Ticket-а 13)
- `src/main/agent/options.ts` → `src/main/vendors/claude/options.ts`; `src/main/agent/app-registry.ts` — `:92-166`
  (`sdkQueryFactory`) и `:171-189` (`queryFactoryFromEnv`) → `src/main/vendors/claude/query.ts`; импорты — список в п. 3
- `src/main/vendors/claude/session.ts` — `:6` (импорт `queryFactoryFromEnv`) и правило входа, если Ticket 14 перенёс
  его сюда; `src/main/agent/session.ts` — `:636` (правило входа, если осталось здесь)
- `src/main/ipc/first-run.ts` (импорт `queryFactoryFromEnv`)
- Test-ы импорта `queryFactoryFromEnv`: `test/unit/vendor-driver-types.test.ts`, `test/contract/plan-preset.test.ts`
- `src/main/mcp/canvas-server.ts` — `:317-324`; `src/main/mcp/browser-server.ts` — `:425-432`
- `src/main/terminal-ai/assist.ts` — `:34`, `:70-105`, `:464-473`
- `src/main/terminal-ai/options.ts` — `:15`, `:66-113`; `src/main/terminal-ai/fake-backend.ts` — `:21`
- `test/contract/vendor-sdk-imports.test.ts`
- Test-ы: `test/contract/canvas-tools.test.ts`, `test/contract/terminal-ai-assist.test.ts`

## Итог

PR #1248. Ревью — комментарии PR #1248: раунд 1 (глубина high) — REJECTED, одна находка med; раунд 2 (medium) —
VERIFIED.

- Раунд 1, med (исправлено): перенос `queryFactoryFromEnv` не кончал цикл импорта, а переносил его — `query.ts`
  статически импортировал `sharedRegistry` из `agent/app-registry`. В раунде 2 подключение Browser tools фейкового
  агента переехало в `sharedRegistry()` (`src/main/agent/app-registry.ts`), `claude/session.ts` импортирует `./query`
  статически, новый `test/contract/vendor-imports.test.ts` краснеет на любой импорт `app-registry` из
  `src/main/vendors/`. Решено implementer-ом вместо параметра у `queryFactoryFromEnv` (у driver-а нет доступа к
  реестру без глобального setter-а); подтверждено владельцем 2026-11-05.
- Отклонение от текста п. 3 (принято ревью): экспортируемые интерфейсы `vendors/claude/options.ts` построены на типах
  worfy (`ClaudeMcpServer`, `ClaudeOutputFormat`, `ClaudeSettingSource`), иначе правило «тип SDK не выходит из
  driver-а» было бы нарушено.
- Изменение поведения: под `WORFY_AGENT=fake` Browser tools подключаются один раз при создании реестра Session-ов, а
  проверка первого запуска их больше не выставляет; `query.ts` грузится вместе с driver-ом.
- Долг (low): `test/contract/vendor-imports.test.ts:94` — ветка `.js` → `.ts` не проверена (mutant выживает).
- Долг (low): `src/main/mcp/browser-server.ts:466` — `import('../ipc/autopilot')` доходит до `app-registry` в момент
  вызова; цепочки `import()` вне `vendors/` test не прослеживает.
- Consider (low): `AssistProcessOptions = Readonly<Record<string, unknown>>` (`src/main/terminal-ai/assist.ts`,
  `src/main/vendors/claude/terminal-ai.ts`) — нетипизированная граница, `coldQueryOptions` приводит её к опциям SDK
  без проверки; лечится брендированным типом, который делает только driver.
- Consider (low): `ClaudeMcpServer` можно собрать руками, `sdkServerConfig` приводит его к типу SDK
  (`src/main/vendors/claude/mcp.ts`); тот же бренд.
- Consider (low): `sdkTypesLeaving` в `test/contract/vendor-sdk-imports.test.ts` (Ticket 12) не ловит
  `export type X = ReturnType<typeof prewarmOptions>` внутри driver-а — тип SDK `Options` выходит наружу, test зелёный.
- Принято: 21 выживший mutant low, которые выживают и на main (опции Terminal AI `stderr`, `maxThinkingTokens`,
  разделитель prompt-а; описания tool-ов Browser не читает ни один test; ветки fake-агента в `query.ts`); устаревшие
  пути в комментариях `src/main/ipc/agent.ts:5-6`, `src/main/workflow/profile.ts:40`,
  `test/e2e/packaged.spec.ts:464,517`, `scripts/spikes/harness-plugin/probe.ts:92`; перевод `docs/features/ru/` отстаёт
  (ADR-0088).
- Вердикт Windows: job `windows / full-suite` в `ci-ok` зелёный; scope `pc` — gate full на ПК после Wave (ADR-0086).
