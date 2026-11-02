# 39 — Подтверждение hook-ов Harness в Codex

Type: task
Status: open
Blocked by: 35, 37
Source: [spec.md](../spec.md), «Риски», п. 3; решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), риск 3; Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Hook trust»)

## Что происходит

- Codex доверяет hook-ам plugin-а по hash всей папки: после любой установки или обновления Harness его hook-и
  выключены, пока пользователь не подтвердит их в `/hooks`. app-server отдаёт hook-и методом `hooks/list`.
- Autopilot уже отказывается стартовать по причинам из `run.ts` (`selfProjectRefusal`, `:237`); отставание Harness
  показывает `src/main/autopilot/harness-drift.ts`.

## Что делаем

1. `src/main/harness/codex-hooks-trust.ts`: подтверждены ли hook-и Harness в Codex (`hooks/list` app-server);
   незнакомый ответ — «не известно», не «подтверждены».
2. Шаг «Approve the Harness hooks in Codex» после каждой установки и обновления Harness в Codex: что открыть
   (`/hooks` в Codex) и кнопка «Check again».
3. Preflight Autopilot: Run на Orchestrator-е Codex не стартует, пока hook-и не подтверждены, — отказ с причиной
   «The Harness hooks are not approved in Codex. Approve them in /hooks and start again.»; Run на Claude это не
   касается.
4. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/39/`.

## Готово, когда

- [ ] Contract test (фейк): hook-и не подтверждены — Run на Codex отказан с причиной; подтверждены — стартует; Run
      на Claude — без проверки.
- [ ] Шаг виден после установки (снимки обеих тем).
- [ ] Все unit и contract test-ы модуля Autopilot, `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/main/harness/codex-hooks-trust.ts` (новый)
- `src/main/autopilot/run.ts` — `:237` (рядом: новая причина отказа)
- `src/main/ipc/autopilot.ts`
- `src/renderer/harness/`
- Test-ы: `test/contract/codex-hooks-trust.test.ts` (новый), `test/unit/autopilot-run.test.ts`
