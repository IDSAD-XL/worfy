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

## Итог

- `src/main/harness/codex-hooks-trust.ts`: `hooks/list` короткоживущего app-server-а (тот же `withCodex`, что у проверки
  аккаунта); hook-и plugin-а `worfy@worfy-harness`: все `enabled` и `trusted`/`managed` — `approved`; хоть один
  `untrusted`, `modified` или выключен — `not-approved`; остальное (нет ответа, ошибка, незнакомая форма или статус,
  hook-ов Harness нет вовсе) — `unknown`, который за подтверждение не считается.
- Шов: необязательная часть driver-а `harnessHooks` (`src/main/vendors/harness-hooks.ts`, `driver.ts`); у Codex она есть,
  у Claude Code нет. `Orchestrators.unattendedRefusal` после capability `harness` (у Codex теперь `true`) спрашивает
  часть driver-а и при любом ответе, кроме `approved`, отказывает с текстом driver-а: «The Harness hooks are not approved
  in Codex. Approve them in /hooks and start again.» Имени Vendor-а в проверке нет. `run.ts` и `ipc/autopilot.ts` по
  коду не менялись: отказ уже шёл через `unattendedRefusal` (preflight `startCheck` и `setUnattended`).
- Фейк app-server отвечает на `hooks/list` в любой момент сценария, из plugin-ов своего `CODEX_HOME`
  (`hooksList` в `test/fixtures/codex-app-server/hook-runner.mjs`): `untrusted` без одобрения, `trusted` после
  `approvePluginHooks`, `modified` после смены папки plugin-а. Ответ проходит JSON Schema закреплённого Codex.
- Contract test-ы: `test/contract/codex-hooks-trust.test.ts` (чтение ответа, фейк, части driver-ов) и
  `test/contract/codex-orchestrator.test.ts` (не подтверждены — Run отказан с причиной, ни одного thread/start;
  подтверждены — стартует; смена Harness после подтверждения и Harness без hook-ов — отказ; Claude — без проверки).
  Подстановка `harness: true` в test-е Ticket-а 37 заменена настоящей проверкой.
- Шаг «Approve the Harness hooks in Codex» — `src/renderer/harness/CodexHooksStep.tsx`; открывает его пункт Harness
  toolbar-а (`src/renderer/shell/toolbar/HarnessStatus.tsx`). «Check again» — канал `harness.codexHooks`
  (`src/main/ipc/harness.ts`): при `approved` снимает `hooksToApprove` (`CodexHarness.hooksApproved`) и рассылает
  `harness.changed`. e2e: `test/e2e/codex-hooks-step.spec.ts`.
  Снимки: после установки [светлая](../evidence/39/39-codex-hooks-step-after-install-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-after-install-dark.png); не подтверждены
  [светлая](../evidence/39/39-codex-hooks-step-not-approved-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-not-approved-dark.png); подтверждены
  [светлая](../evidence/39/39-codex-hooks-step-approved-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-approved-dark.png).
- `docs/features/autopilot.md`: фраза Ticket-а 37 заменена — Run на Codex отказан, пока hook-и не подтверждены, и как их
  подтвердить.

Решено без владельца, подтвердить:

1. Шаг — диалог поверх окна. Открывается сам, когда установка или обновление в Codex оставили hook-и неподтверждёнными
   (и в окне, открытом в это время); после «Close» сам не открывается, но надпись «Codex: approve hooks» в toolbar-е
   стала кнопкой и открывает его снова.
2. `managed` (hook-и, которые Codex запускает по политике) считается подтверждённым; выключенный hook Harness — нет.
3. Проверка идёт перед каждым стартом Run-а на Codex (preflight и `setUnattended` — два коротких app-server-а), не во
   время Run-а; обновление Harness посреди Run-а проверка не ловит.
4. `hooksToApprove` по-прежнему живёт только в памяти: после перезапуска worfy шаг сам не появится, но Run на Codex
   всё равно откажет с причиной, пока hook-и не подтверждены.
