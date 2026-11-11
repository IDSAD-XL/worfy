# 07 — Окна Harness, Browser profiles, Send all и Image overlay на Dialog kit

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 07 и уточнение про Image overlay под таблицей; «Решения по реализации»
(остальные модальные окна); истории 1, 2, 9; заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`,
раздел 1.1

## Что происходит

- Move the old Harness — `harness/MigrationForm.tsx` и Approve Harness hooks in Codex — `harness/CodexHooksStep.tsx`:
  фокус в окно не ставится вовсе, focus trap нет. CodexHooksStep слушает Esc на window.
- Browser profiles — `browser/BrowserProfiles.tsx`: focus trap нет, возврата нет; гасит все pointer-события.
- Send all (ответы в PR) — `pr-inbox/DraftThread.tsx:466-520`: focus trap нет, возврата нет.
- Image overlay (картинка во весь экран) — `session/MessageAttachments.tsx:76-110`: focus trap нет. Черновик Epic-а не
  назвал это окно ни в одной пачке; оно здесь, чтобы все 19 модальных окон перешли на kit.

## Что делаем

1. Пять окон переходят на Dialog kit (Ticket 04): роль и имя прежние, focus trap, возврат фокуса, слой из шкалы.
2. Свои backdrop, Esc, listener на window и inline `zIndex` удаляются; z-index Image overlay из `session/session.css`
   уходит.
3. Inline confirm «Delete profile» в Browser profiles (`role="alertdialog"`) остаётся inline.

## Готово, когда

- [ ] Unit test-ы окон: при открытии фокус в окне; Tab не уходит из окна; после закрытия фокус на кнопке, которая окно
      открыла.
- [ ] Существующие unit test-ы и e2e `harness-migrate.spec.ts`, `codex-hooks-step.spec.ts`, `browser-profile.spec.ts`,
      `pr-inbox.spec.ts`, `chat-attachments.spec.ts` зелёные без правок ролей и `data-testid`.
- [ ] Своих focus trap и backdrop в этих пяти окнах нет.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/renderer/harness/MigrationForm.tsx`
- `src/renderer/harness/CodexHooksStep.tsx`
- `src/renderer/browser/BrowserProfiles.tsx`
- `src/renderer/pr-inbox/DraftThread.tsx`
- `src/renderer/session/MessageAttachments.tsx`
- `src/renderer/session/session.css`
- `test/unit/harness-migration-form.test.tsx`
- `test/unit/codex-hooks-step.test.tsx`
- `test/unit/browser-profiles-window.test.tsx`
- `test/unit/draft-thread.test.tsx`
- `test/e2e/harness-migrate.spec.ts`
- `test/e2e/codex-hooks-step.spec.ts`
- `test/e2e/browser-profile.spec.ts`
- `test/e2e/pr-inbox.spec.ts`
- `test/e2e/chat-attachments.spec.ts`

## Вне скоупа

- 4 inline confirm внутри панелей, включая «Delete profile»: остаются inline (spec, «Не в этом Epic-е»).
