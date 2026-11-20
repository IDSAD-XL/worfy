# 131 — epic-wave: Ticket, который Orchestrator остановил ради решения владельца, сразу `blocked --waits owner`

Type: bug
Status: claimed 2026-11-20T11:02Z
Blocked by: none
Source: решение владельца 2026-11-20 («со всем согласен»). Случай 2026-11-20: worfy-changes-view 03 ждал владельца
по issue #1513 (метка `pc-main-red`) и оставался `claimed`; Autopilot послал 2 continuation-а и потом поставил его
`blocked` с причиной «stuck: claimed after 2 continuations».

Кто: агент. Глубина review — `medium`. Это правка текста skill-а Harness-а — платформенный PR (ADR-0056): вердикт
Windows — job-ы Windows в CI.

## Что происходит

- Autopilot (автоматический запуск Wave-ов в worfy) считает застрявшими Ticket-ы Wave-а в состоянии `work`, то есть
  `claimed` (`src/shared/autopilot/cycle.ts:344`), и шлёт Orchestrator-у continuation — сообщение «продолжай». После
  предела continuation-ов он просит отложить Ticket. Ticket в `blocked` застрявшим не считается.
- Skill epic-wave не говорит, что делать с Ticket-ом, который Orchestrator сам остановил до решения владельца. Раздел
  2 («Questions for the owner do not stop the wave») описывает только развилку, которую Orchestrator решает сам по
  рекомендации. Ticket, которому нужен ответ владельца, остаётся `claimed`, и Autopilot тратит на него continuation-ы.
- `ticket block <epic> <NN> "<reason>" --waits owner` пишет `Status: blocked`, `Blocked reason:` и `Waits: owner`
  (`bin/TICKETS.md`); Autopilot показывает такой Ticket как ждущий владельца.

## Что делаем

1. В `harness/skills/epic-wave/SKILL.md` (раздел 2 или место, где Wave оставляет Ticket ждать человека): Ticket,
   который Orchestrator остановил ради решения владельца, сразу получает
   `ticket block <epic> <NN> "<reason>" --waits owner`, а не остаётся `claimed`. Причина называет вопрос и то, чего
   он ждёт (например, issue). Строка в списке state file «что ждёт владельца» и строка `blocked` в отчёте Wave-а —
   как у других блокировок.
2. Отделить от случаев, где Ticket законно остаётся `claimed`: `human-review` и `awaiting-merge` (PR открыт, ждёт
   людей, раздел про Pipeline) — их правило не меняется.
3. Ответ владельца получен — `ticket claim` снова, и Ticket идёт дальше.
4. Text contract test skill-а — `harness/bin/tests/epic-wave-ship-ticket.test.sh` (проверки `has`/`lacks` по
   тексту SKILL.md): добавить проверку, что текст требует `ticket block … --waits owner` для Ticket-а, остановленного
   ради решения владельца. Mutant — убрать фразу из SKILL.md — красный.
5. Eval: у skill-а есть eval-ы `harness/evals/epic-wave-tickets` и `harness/evals/epic-wave-old-form`, но в них нет
   Bash и нет случая с вопросом владельцу. Новый случай (Ticket, которому нужен ответ владельца; grader: Ticket
   `blocked` с `Waits: owner`, не `claimed`) — добавить, если scaffold может его поставить без настоящего GitHub;
   иначе причина в «Итог». Платный eval — по правилу eval-ов: сначала `--dry-run`, потолок на вызов.

## Готово, когда

- [ ] SKILL.md epic-wave требует `ticket block … --waits owner` сразу для Ticket-а, остановленного ради решения
      владельца; правило `human-review` / `awaiting-merge` не изменилось.
- [ ] Проверка в `epic-wave-ship-ticket.test.sh` зелёная, mutant (фраза убрана) — красный; весь файл — exit 0.
- [ ] Eval-случай добавлен и прогнан (exit code и счёт в «Итог»), или в «Итог» записано, почему его нет.
- [ ] Job-ы Windows CI на PR зелёные (платформенный PR).

## Где в коде

- `harness/skills/epic-wave/SKILL.md`: раздел 2 «Dispatch», абзац «Questions for the owner do not stop the wave»;
  Pipeline-стадии `human-review` / `awaiting-merge`.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`.
- `harness/evals/epic-wave-tickets/` — образец eval-случая.
- `src/shared/autopilot/cycle.ts` — только читать: какие Ticket-ы Autopilot считает застрявшими.
