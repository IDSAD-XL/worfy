# 39 — Подтверждение hook-ов Harness в Codex

Type: task
Status: done 2026-11-04T04:52Z
PR: #1330
Blocked by: 35, 37
Source: [spec.md](../spec.md), «Риски», п. 3; решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), риск 3; Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Hook trust»)

## Что происходит

- Codex доверяет hook-ам plugin-а по hash всей папки: после любой установки или обновления Harness его hook-и
  выключены, пока пользователь не подтвердит их в `/hooks`. app-server отдаёт hook-и методом `hooks/list`.
- Autopilot уже отказывается стартовать по причинам из `run.ts` (`selfProjectRefusal`, `:237`); отставание Harness
  показывает `src/main/autopilot/harness-drift.ts`.

## Что делаем

1. `src/main/vendors/codex/harness-hooks.ts`: подтверждены ли hook-и Harness в Codex (`hooks/list` app-server);
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

- `src/main/vendors/codex/harness-hooks.ts` (новый)
- `src/main/autopilot/run.ts` — `:237` (рядом: новая причина отказа)
- `src/main/ipc/autopilot.ts`
- `src/renderer/harness/`
- Test-ы: `test/contract/codex-harness-hooks.test.ts` (новый), `test/unit/autopilot-run.test.ts`

## Итог

- `src/main/vendors/codex/harness-hooks.ts`: `hooks/list` короткоживущего app-server-а (тот же `withCodex`, что у проверки
  аккаунта); hook-и plugin-а `worfy@worfy-harness`: все `enabled` и `trusted`/`managed`, и в списке есть каждый hook,
  который `hooks.json` Harness объявляет на событиях, известных Codex (файл читается по `sourcePath` из ответа; не
  читается — нужны хотя бы PreToolUse, Stop и SubagentStop), — `approved`; хоть один `untrusted`, `modified` или
  выключен — `not-approved`; остальное (нет ответа, ошибка, timeout, незнакомая форма или статус, hook-ов Harness нет
  вовсе, объявленного hook-а нет в списке, `errors` Codex по файлу из папки plugin-а Harness) — `unknown`, который за
  подтверждение не считается. Модуль — часть driver-а Codex: `src/main/harness/` его не импортирует, а он не
  импортирует `src/main/harness/` (id plugin-а — своя константа, test держит её равной `HARNESS_PLUGIN_ID`).
- Шов: необязательная часть driver-а `harnessHooks` (`src/main/vendors/harness-hooks.ts`, `driver.ts`); у Codex она есть,
  у Claude Code нет. `Orchestrators.unattendedRefusal` после capability `harness` (у Codex теперь `true`) спрашивает
  часть driver-а и при любом ответе, кроме `approved`, отказывает с текстом driver-а: «The Harness hooks are not approved
  in Codex. Approve them in /hooks and start again.» Имени Vendor-а в проверке нет. На старте отказ идёт через
  `unattendedRefusal` (preflight `startCheck` и `setUnattended`); перед каждой следующей Wave `run.ts` (`waveRefused`)
  спрашивает `unattendedRefusal` снова, до новой Session: при отказе Session не стартует, Run останавливается с
  `session-error` и текстом отказа в journal. Часть driver-а, которая бросает, — тоже отказ. `ipc/autopilot.ts` не
  менялся.
- Фейк app-server отвечает на `hooks/list` в любой момент сценария, из plugin-ов своего `CODEX_HOME`
  (`hooksList` в `test/fixtures/codex-app-server/hook-runner.mjs`): `untrusted` без одобрения, `trusted` после
  `approvePluginHooks`, `modified` после смены папки plugin-а. Ответ проходит JSON Schema закреплённого Codex.
- Contract test-ы: `test/contract/codex-harness-hooks.test.ts` (чтение ответа, фейк, части driver-ов) и
  `test/contract/codex-orchestrator.test.ts` (не подтверждены — Run отказан с причиной, ни одного thread/start;
  подтверждены — стартует; смена Harness после подтверждения и Harness без hook-ов — отказ; смена Harness во время
  Wave 1 — Session Wave 2 не стартует, Run остановлен с текстом отказа; часть, которая бросает, — отказ; Claude — без
  проверки).
  Подстановка `harness: true` в test-е Ticket-а 37 заменена настоящей проверкой.
- Шаг «Approve the Harness hooks in Codex» — `src/renderer/harness/CodexHooksStep.tsx`; открывает его пункт Harness
  toolbar-а (`src/renderer/shell/toolbar/HarnessStatus.tsx`). «Check again» — канал `harness.codexHooks`
  (`src/main/ipc/harness.ts`, через `vendorDriver('codex').harnessHooks`): при `approved` снимает `hooksToApprove` (`CodexHarness.hooksApproved`) и рассылает
  `harness.changed`. e2e: `test/e2e/codex-hooks-step.spec.ts`.
  Снимки: после установки [светлая](../evidence/39/39-codex-hooks-step-after-install-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-after-install-dark.png); не подтверждены
  [светлая](../evidence/39/39-codex-hooks-step-not-approved-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-not-approved-dark.png); подтверждены
  [светлая](../evidence/39/39-codex-hooks-step-approved-light.png),
  [тёмная](../evidence/39/39-codex-hooks-step-approved-dark.png).
- Проверка перед каждой Session Run-а (а не только перед стартом) — решение по ревью #1330, больше не «подтвердить».
- `docs/features/autopilot.md`: фраза Ticket-а 37 заменена — Run на Codex отказан, пока hook-и не подтверждены, и как их
  подтвердить; `docs/features/sessions.md` и `docs/features/vendors.md` говорят то же со ссылкой на этот раздел.

Решено без владельца, подтвердить:

1. Шаг — диалог поверх окна. Открывается сам в окнах, открытых в момент, когда установка или обновление в Codex
   оставили hook-и неподтверждёнными; окно, открытое позже, его само не открывает (первый статус окна только
   запоминается); после «Close» сам не открывается, но надпись «Codex: approve hooks» в toolbar-е стала кнопкой и
   открывает его снова.
2. `managed` (hook-и, которые Codex запускает по политике) считается подтверждённым; выключенный hook Harness — нет.
3. Перед следующей Wave `unknown` (например, Codex не ответил за 15 с) останавливает Run так же, как «не
   подтверждены», а не ждёт и не спрашивает снова. Текущая Wave при обновлении Harness посреди неё доходит до конца:
   проверка идёт только перед Session следующей.
4. `hooksToApprove` по-прежнему живёт только в памяти: после перезапуска worfy шаг сам не появится, но Run на Codex
   всё равно откажет с причиной, пока hook-и не подтверждены.
5. `warnings` ответа `hooks/list` не читаются: Codex предупреждает о том, что hook не выключает (timeout SessionEnd,
   урезанный до 3 с). `errors` по файлу вне папки plugin-а Harness не мешают.
