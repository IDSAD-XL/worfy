# 26 — Limits по Vendor-ам в панели

Type: task
Status: open
Blocked by: 21
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 8; решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); [CONTEXT.md](../../../CONTEXT.md), термин Limits

## Что происходит

- Панель Limits — `src/renderer/shell/toolbar/LimitsMeter.tsx`, полоса — `src/renderer/limits/LimitBar.tsx`,
  состояние — `src/renderer/limits/useLimits.ts`; строки — `limitBars` (`src/shared/agent/limits.ts:264`).
- После Ticket-ов 11 и 21 состояние — список окон с Vendor-ом, Codex присылает свои окна.

## Что делаем

1. Раздел на каждого Vendor-а, в которого выполнен вход: имя Vendor-а и его окна в порядке длительности; подписи —
   `label` окна.
2. Нет входа в Vendor-а — нет его раздела. Нет окон (план Codex без лимитов) — строка «No limits reported».
3. Пороги цвета — те же, что сейчас (`WORKING_FROM`, `BLOCKED_FROM`), `reached` — красный.
4. `LimitsTracker` хранит и отдаёт окна обоих Vendor-ов (`src/main/agent/limits.ts:58`).
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/26/`.

## Готово, когда

- [ ] Unit test: два Vendor-а — два раздела; Codex Pro — одно окно `weekly`; без входа в Codex — только Claude.
- [ ] e2e (фейки): после хода Codex в панели раздел Codex с окнами сценария.
- [ ] Снимки обеих тем в `evidence/26/`.
- [ ] `pnpm typecheck`, `pnpm lint`, unit test-ы Limits и e2e spec — exit 0.

## Где в коде

- `src/renderer/shell/toolbar/LimitsMeter.tsx` — `:14-30`
- `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts`
- `src/main/agent/limits.ts` — `:58`
- `test/unit/limits-meter.test.tsx`, `test/e2e/limits-vendors.spec.ts` (новый), `scripts/e2e-specs.table.json`
