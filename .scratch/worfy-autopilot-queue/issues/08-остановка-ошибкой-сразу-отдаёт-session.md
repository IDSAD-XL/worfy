# 08 — Run, остановленный ошибкой, сразу отдаёт Session человеку: без перезапуска, задачи живут

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Что видит владелец», п. 6; «Как работает» → «Остановка ошибкой отдаёт Session сразу»; «Решения владельца», 7; «Решено без владельца», 5; «Риски», 1–2; [02](02-старт-при-идущей-работе.md), Q7; случай 2026-11-03 ([worfy-polish 50](../../worfy-polish/issues/50-autopilot-не-стартует-после-остановки-run-а.md))

Начинать после merge worfy-retry 05 и 14 (общие run.ts, cycle.ts, журнал; worfy-retry 04 влит 2026-11-06, PR #1468).

## Что происходит

- `end` (`src/main/autopilot/run.ts:1945`): при любой остановке, кроме `user-force-stop` и `app-quit`, живые задачи или
  идущий ход оставляют Session unattended (`linger`, `:1975-1976`, `:2030`); `release` зовёт
  `setUnattended(false)` (`:2089`), а тот при ходе или задачах только запоминает `wanted = ATTENDED`
  (`src/main/agent/orchestrator.ts:298-312`, `:307`). Перезапуск процесса убил бы задачи (ADR-0029, п. 5).
- `Session.launch` — `readonly` (`src/main/agent/session.ts:175`); смена permission mode в живом процессе уже есть через
  seam Vendor-а `setPermissionPreset` (`src/main/vendors/session.ts:106`; Claude Code —
  `src/main/vendors/claude/session.ts:251-254`; Codex — `src/main/vendors/codex/session.ts:344`, со следующего
  `turn/start`). `launchSettings` держит unattended в `bypassPermissions` (`src/main/agent/session-settings.ts:46-49`).

## Что делаем

1. **Session: смена launch на месте.** `Session.becomeAttended(settings)` — `launch` становится attended, permission
   mode — сохранённый для Node, через `setPermissionPreset`; процесс, задачи и очередь остаются. Отказ seam-а — ошибка,
   вызывающий решает.
2. **Orchestrators.** `setUnattended(false)` при ходе или задачах вместо `wanted = ATTENDED` зовёт `becomeAttended`;
   не удалось — `wanted = ATTENDED`, как сейчас.
3. **Run.** В `end` при причинах, кроме `user-stop`, `user-force-stop`, `app-quit`, — Session отдаётся сразу:
   `orchestrator-returned` с `tasks` (живые задачи) в журнале, keep-awake держится, пока задачи живы (чтобы Mac не
   уснул посреди их работы), затем отпускается. `user-stop` — как сейчас (`linger`).
4. **Строка Canvas** остановленного Run-а: `stopped: <причина> · N background tasks still run`.
5. **`## Amendments` в ADR-0029**, п. 5: остановка, кроме `user-stop`, отдаёт Session без перезапуска; задачи живут в
   Session человека; смена не удалась — прежнее поведение.

## Готово, когда

- [ ] Contract test: `turn-error` при двух живых задачах — Session attended сразу, процесс тот же (нет нового `init`
      от перезапуска), задачи в `orchestrator-returned`, их `task_notification` начинает ход в attended Session.
- [ ] Contract test: `user-stop` при живых задачах — как сейчас (unattended до конца задач).
- [ ] Contract test: Codex (fake Codex, временный `CODEX_HOME`) — следующий `turn/start` идёт с режимом Node.
- [ ] Contract test: seam отказал — `wanted = ATTENDED`, поведение как сейчас.
- [ ] `## Amendments` в ADR-0029.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.

## Тесты

- Contract `test/contract/autopilot-background.test.ts` (остановка при задачах), `test/contract/orchestrator-relaunch.test.ts`
  (смена без перезапуска); fake agent пишет `setPermissionMode` в свой лог (`src/main/agent/fake-query.ts:364-366`).
- Сначала падающий: `turn-error` при задачах — Session ожидалась attended, сейчас unattended.

## Где в коде

- `src/main/autopilot/run.ts` (`end`, `release`)
- `src/main/agent/orchestrator.ts` (`setUnattended(false)`)
- `src/main/agent/session.ts` (`launch`, `becomeAttended`), `src/main/agent/session-settings.ts`
- `test/contract/autopilot-background.test.ts`, `test/contract/orchestrator-relaunch.test.ts`
- `docs/adr/0029-autopilot-waits-for-background-tasks.md`

Только читать: `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/codex/session.ts`.
