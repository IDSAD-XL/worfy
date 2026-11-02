# 29 — Onboarding и вход в Codex

Type: task
Status: open
Blocked by: 21, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 9, «Решено без владельца», п. 6; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); [ADR-0009](../../../docs/adr/0009-claude-code-login-check-account-info.md)

## Что происходит

- Проверки первого запуска — `src/main/ipc/first-run.ts` (вход в Claude Code обязателен); панель Getting started —
  `src/renderer/getting-started/GettingStartedPanel.tsx`.
- Раздела Vendor-ов в Settings нет (`src/renderer/settings/sections.ts`).

## Что делаем

1. Settings → Vendors (`VendorsSection.tsx`): на каждого Vendor-а — вход (email, план) или кнопка входа; у Codex —
   «Sign in to Codex» (`startLogin`, Ticket 21).
2. Getting started: необязательный шаг «Use Codex too» — только если бинарник Codex есть в сборке; пропуск ничего не
   ломает. Проверка входа в Claude Code остаётся как есть.
3. Нет входа в Codex, нет бинарника, ошибка `account/read` — Codex просто недоступен в «New session» с tooltip
   (Ticket 24); всплывающих ошибок нет.
4. Канал `vendors.*`: состояние входа каждого Vendor-а и `startLogin`.
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/29/`.

## Готово, когда

- [ ] e2e (фейк `login`): Settings → Vendors → «Sign in to Codex» → вход отмечен, Codex доступен в «New session».
- [ ] e2e (фейк `signed-out` и сборка без бинарника): ни одного toast или диалога ошибки; Codex недоступен с tooltip.
- [ ] Test-ы first-run Claude проходят без правок ожиданий.
- [ ] Снимки обеих тем в `evidence/29/`.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы first-run и e2e spec — exit 0.

## Где в коде

- `src/main/ipc/first-run.ts`
- `src/renderer/getting-started/GettingStartedPanel.tsx`
- `src/renderer/settings/VendorsSection.tsx` (новый), `src/renderer/settings/sections.ts`
- `src/main/ipc/vendors.ts`, `src/shared/ipc/vendors.ts` (новые)
- `test/e2e/onboarding-codex.spec.ts` (новый), `scripts/e2e-specs.table.json`
