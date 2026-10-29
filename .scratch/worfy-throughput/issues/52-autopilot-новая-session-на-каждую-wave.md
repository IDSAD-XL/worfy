# 52 — worfy Autopilot начинает каждую следующую Wave в новой Session; первая команда — `wave-brief`

Type: task
Status: open
Blocked by: 28
Source: [spec.md](../spec.md), раздел «Ответы владельца 2026-10-29», ответ Q5; Ticket
[28](28-свежий-контекст-orchestrator-а-на-wave.md), раздел «Вне скоупа» (запуск новой Session из worfy Autopilot —
отдельный Ticket).

## Что происходит

- worfy Autopilot (`src/main/autopilot/run.ts`) ведёт Waves одного Epic-а друг за другом без человека. На время
  run-а Session Orchestrator-а запускается заново без человека и продолжает свою SDK session
  (`src/main/autopilot/run.ts:4-6`). Все Wave run-а идут в одной SDK session, и контекст Orchestrator-а растёт от
  Wave к Wave.
- Ticket 28 (#941) добавил `harness/bin/wave-brief` и правило «report, brief, stop» в skill `epic-wave`: в конце
  Wave Orchestrator сохраняет Wave brief (`wave-brief.txt` в папке run-а) и останавливается; новую Session
  начинает worfy Autopilot или владелец, и её первая команда — `wave-brief <epic>`. Autopilot этого пока не
  делает: следующая Wave уходит в ту же SDK session.

## Что делаем

1. Перед каждой следующей Wave run-а Autopilot начинает новую SDK session Orchestrator-а, а не продолжает
   прежнюю. Первая Wave run-а — как сейчас.
2. Первая команда новой Session — `wave-brief <epic>`; затем prompt Wave, как его шлёт «Run wave»
   (`src/main/actions/launch.ts`).
3. Остальное поведение run-а не меняется: остановка по Limits и продолжение после сброса окна, Interrupt,
   очередь Session, журнал Autopilot.
4. Contract test на сценарии агента (`test/fixtures/agent-scripts/`): run из двух Wave — вторая идёт в новой SDK
   session, и её первый prompt содержит `wave-brief`.

Нужен ПК: для merge — если в diff `test/e2e/**`. Трогает Harness: нет (код worfy). Вердикт Windows: `pc`, если в
diff `test/e2e/**` (`scripts/windows-verdict-scope.mjs:80`); иначе runner `full`.

## Готово, когда

- [ ] Run из двух Wave в contract test-е: две разные SDK session; первый prompt второй — `wave-brief <epic>` и
      prompt Wave.
- [ ] Продолжение run-а после Limits и Interrupt — прежние test-ы зелёные без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Где в коде

- `src/main/autopilot/run.ts` — запуск Session Orchestrator-а на run (`:4-6`, `:629-632`)
- `test/contract/autopilot.test.ts`, `test/contract/autopilot-background.test.ts`,
  `test/contract/autopilot-journal.test.ts`, `test/contract/autopilot-limits.test.ts`
- `test/e2e/autopilot.spec.ts` — только если меняется то, что видно на Canvas
- Только читать: `harness/bin/wave-brief`, `harness/skills/epic-wave/SKILL.md` (раздел 5, «How to resume a wave»)

## Вне скоупа

- Сам `wave-brief` и правило «report, brief, stop» — Ticket 28.
- Бюджет Limits на Wave — Ticket 41.
- Wave, которую владелец запускает руками («Run wave») — новую Session начинает владелец.
