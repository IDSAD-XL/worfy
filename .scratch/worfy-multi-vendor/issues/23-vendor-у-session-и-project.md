# 23 — Vendor у Session и у Project

Type: task
Status: open
Blocked by: 14, 17, 18, 20, 21
Source: [spec.md](../spec.md), «Модель» (Vendor), «Решено без владельца», п. 5, 7, 8; Ticket 01 ([01-destination-vendor-масштаб.md](01-destination-vendor-масштаб.md), п. 3); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md))

## Что происходит

- Данные Node Session — `worfySessionNodeDataSchema` (`src/shared/ipc/sessions.ts:22`), вид — `sessionNodeViewSchema`
  (`:61`), «New session» — `sessions.new` (`:81`).
- Session-ы Node-ов ведёт `src/main/agent/node-sessions.ts`; реестр — `src/main/agent/app-registry.ts`.
- Настройки Project-а — `projectSettingsSchema` (`src/shared/projects/action-templates.ts:139`).

## Что делаем

1. `vendor` в данных Node Session и в её виде; нет поля — `claude`.
2. `defaultVendor` в настройках Project-а; нет поля — `claude`; сборка, которая не знает значения, читает его как
   «не выбрано» (как `terminalShell`, `:155-158`).
3. `sessions.new` принимает `vendor?`; без него — `defaultVendor` Project-а. Resume и Start берут Vendor Node-а.
4. Реестр Session-ов берёт driver по Vendor-у Session (`vendorDriver(id)`). Orchestrator — всегда `claude` в первом
   выпуске.
5. Vendor, которого нет в этой сборке или у которого нет входа, — отказ `sessions.new` с причиной, а не падение.
6. Черновик профиля Project (`src/main/projects/connect.ts`) переходит на нейтральный `vendorDriver(<vendor>).oneShot`.
   Сейчас он зовёт части driver-а Claude напрямую: `claudeOneShotQuery` (через `src/main/ipc/projects.ts`) и
   `readOneShot` (`src/main/vendors/claude/one-shot.ts`); так решено в Ticket-е 15. Решено Orchestrator-ом
   2026-11-02, подтвердить при приёмке.

## Готово, когда

- [ ] Contract test: Node без `vendor` стартует Claude; `sessions.new {vendor: 'codex'}` на фейках стартует Codex и
      сохраняет `vendor`; Resume Node Codex идёт в driver Codex.
- [ ] Contract test: `defaultVendor` Project-а действует, когда `vendor` не передан; незнакомое значение не ломает
      файл настроек.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы Session-ов и настроек Project-а — exit 0.

## Где в коде

- `src/shared/ipc/sessions.ts` — `:22`, `:61`, `:81-94`
- `src/main/ipc/sessions.ts`
- `src/main/agent/node-sessions.ts`, `src/main/agent/app-node-sessions.ts`
- `src/main/agent/app-registry.ts`
- `src/shared/projects/action-templates.ts` — `:139-160`
- `test/contract/sessions-vendor.test.ts` (новый)
