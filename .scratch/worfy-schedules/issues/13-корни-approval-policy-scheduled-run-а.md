# 13: Корни Approval policy для scheduled run-а

Type: task
Status: open
Blocked by: 01, 03
Source: [spec.md](../spec.md), «Ticket-ы», 13; «Решения по реализации» («Scheduled run» — «Права»); «Решения по
test-ам» (`schedule-approval-roots.test.ts`); решение владельца Q1 spec-а; разбор critic-а, возражение 3; «Волны», Wave 3

Кто: агент. Глубина ревью — `high`: меняет модуль Auto-approval другого Epic-а.

## Что происходит

- Корни Approval policy — только корни Run-а Autopilot-а: worktree-ы Ticket-ов Wave, `.scratch` Project-а, папка
  `<WORFY_DATA_DIR>/autopilot-tmp/<run>` и scratchpad Session-а (ADR-0098, пункт 3; `src/main/agent/auto-approve/roots.ts`).
  Контекст запроса строит `src/main/agent/auto-approve/run-approval.ts` — только для Run-а.
- У scheduled run-а свои корни; их разрешает Amendment ADR-0098 из Ticket-а 01 — поэтому этот Ticket после него.

## Что строить

- Корни scheduled run-а: его worktree, `<WORFY_DATA_DIR>/schedule-tmp/<run>` (TMPDIR Session-а) и scratchpad Session-а.
  Рабочая копия Project-а и `.scratch` — не корни; папка данных worfy вне `schedule-tmp/<run>` — по-прежнему hard deny.
- Открытие контекста политики для scheduled run-а (по образцу `openRunApproval`): окружение git, реальные пути корней
  на старте.
- `git push` и `gh pr create` — park, как раньше (Q1 spec-а); правила allow для push нет.
- Режим Auto-approval Project-а (Off, Shadow, On) действует как у Run-а.
- Функция, которую берёт run (Ticket 06); сам run не строится.

## Где в коде

- `src/main/agent/auto-approve/roots.ts`, `src/main/agent/auto-approve/run-approval.ts`
- `src/main/schedules/approval.ts` (новый, имя — предложение)
- `test/unit/schedule-approval-roots.test.ts` (новый)

## Test-ы

- Unit: запись в worktree run-а — allow; в рабочую копию Project-а и в `.scratch` — не allow; папка данных worfy вне
  `schedule-tmp/<run>` — hard deny; `git push` — park; Off — отказ, Shadow — запись без ответа.
- Прежние test-ы Approval policy проходят без правок.
- Сначала падающий test.

## Готово, когда

- [ ] Корни scheduled run-а — его worktree, `schedule-tmp/<run>` и scratchpad; push — park; прежние test-ы Approval
      policy не менялись.
- [ ] `schedule-approval-roots.test.ts` зелёный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
