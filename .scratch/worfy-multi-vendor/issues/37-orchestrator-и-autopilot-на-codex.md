# 37 — Orchestrator и Autopilot на Codex

Type: task
Status: open
Blocked by: 33, 35, 45
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск), «Решено без владельца», п. 5; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md))

## Что происходит

- Orchestrator — Session Claude Code (`src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`).
- Autopilot ведёт Run через unattended Session: `bypassPermissions`, отказ диалогов (`refused_dialog`,
  `src/shared/agent/events.ts:116-131`), Wave — в Session Orchestrator-а (`src/main/autopilot/run.ts`).

## Что делаем

Run на Codex начинается только с Harness, чьи гарантии доказаны parity suite (Ticket 45; решение владельца Q5).

1. Vendor Orchestrator-а — `defaultVendor` Project-а; смена Vendor-а Orchestrator-а — в Settings Project-а, вступает
   со следующего старта Orchestrator-а.
2. Unattended Session Codex: preset «Full access» (`danger-full-access` + `never`); approval, который всё же пришёл, —
   ответ `decline` и событие `refused_dialog`, как у Claude.
3. Autopilot ведёт Wave через SessionHandle Orchestrator-а любого Vendor-а; проверок имени Vendor-а в `run.ts` нет.
4. Journal: `run-started` пишет `vendor` (новое необязательное поле); без него — `claude`.

Глубина review — `high` (driver Codex в Autopilot).

## Готово, когда

- [ ] Contract test (фейк Codex): Run на Orchestrator-е Codex проходит Wave сценария; approval в unattended —
      `decline` и строка `refused-dialog` в Journal.
- [ ] Test-ы Autopilot на Claude проходят без правок ожиданий; все unit и contract test-ы модуля Autopilot — exit 0.
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`
- `src/main/vendors/codex/session.ts` — unattended
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts` — `run-started`
- Test-ы: `test/unit/autopilot-run.test.ts`, `test/contract/codex-orchestrator.test.ts` (новый)
