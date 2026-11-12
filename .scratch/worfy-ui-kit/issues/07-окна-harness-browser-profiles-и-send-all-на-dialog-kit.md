# 07 — Окна Harness, Browser profiles, Send all и Image overlay на Dialog kit

Type: task
Status: claimed 2026-11-12T17:12Z
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
4. Формы, которые открываются из Settings → Pipeline, — «Move old Harness…» (`harness/MigrationForm.tsx:44`) и
   «Approve hooks» (`harness/CodexHooksStep.tsx:23`), обе на z-index 100, — встают на шкалу выше окна kit
   (`LAYERS.dialog`, 110), как форма раздела Health (`settings/HealthSection.tsx:15`). Сейчас они под окном Settings, и
   guard клавиш (`theme/kit/Dialog.tsx`, функция `above`, строгое `>`) считает их слоем ниже: клавиши в них
   гасятся, Esc закрывает Settings. Так было и до Ticket 04 (Settings на 110). Test: форма поверх открытого Settings
   получает свои клавиши, Esc закрывает форму, а не Settings.
5. Esc меню после drop binding-а (`canvas/overlays/BindingDrop.tsx:196-204`: capture-listener `keydown` на window,
   `preventDefault`) под открытым окном kit. Сценарий: меню открыто, «?» открывает Keyboard shortcuts (или ⌘, —
   Settings); первый Esc закрывает меню под окном, окно закрывается только вторым. До Ticket 04 так вёл себя только
   Settings; Keyboard shortcuts и Guide брали Esc первыми. Исправление: listener меню пропускает клавишу, у которой
   target внутри окна kit (`[data-kit-dialog]`, `KIT_DIALOG_ATTRIBUTE`). Test: меню открыто, окно kit открыто, Esc в
   окне закрывает окно, меню остаётся.

## Готово, когда

- [ ] Unit test-ы окон: при открытии фокус в окне; Tab не уходит из окна; после закрытия фокус на кнопке, которая окно
      открыла.
  - evidence: test-run pass · `pnpm test` on test/unit harness-migration-form, codex-hooks-step, browser-profiles-window, draft-thread, chat-attachments (82 files of the touched modules) exit 0 · mac - · c19a05162c6f5a2d1b2ca71862f7a91da5d6eb45
  - evidence: test-run pass · `pnpm test` on the unit tests of the touched modules (87 files) after the rebase on ui-kit 06 exit 0 · mac - · 1e1478e8e41360a6b2fa0e030603508892e267cd
- [ ] Существующие unit test-ы и e2e `harness-migrate.spec.ts`, `codex-hooks-step.spec.ts`, `browser-profile.spec.ts`,
      `pr-inbox.spec.ts`, `chat-attachments.spec.ts` зелёные без правок ролей и `data-testid`.
- [ ] Своих focus trap и backdrop в этих пяти окнах нет.
  - evidence: commit pass · Harness forms, Browser profiles, Send all and the full-size image on the kit's Dialog (worfy-ui-kit 07) · - - · c19a05162c6f5a2d1b2ca71862f7a91da5d6eb45
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · c19a05162c6f5a2d1b2ca71862f7a91da5d6eb45
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1e1478e8e41360a6b2fa0e030603508892e267cd

## Где в коде

- `src/renderer/harness/MigrationForm.tsx`
- `src/renderer/harness/CodexHooksStep.tsx`
- `src/renderer/browser/BrowserProfiles.tsx`
- `src/renderer/pr-inbox/DraftThread.tsx`
- `src/renderer/session/MessageAttachments.tsx`
- `src/renderer/session/session.css`
- `src/renderer/canvas/overlays/BindingDrop.tsx`
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
