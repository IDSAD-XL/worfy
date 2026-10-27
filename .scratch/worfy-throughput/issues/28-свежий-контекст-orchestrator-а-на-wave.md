# 28 — Свежий контекст Orchestrator-а на каждую Wave: `bin/wave-brief` и остановка в конце Wave

Type: task
Status: open
Blocked by: 27
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 4, решение 13;
аналитика 2026-10-27: Orchestrator — 21 % расхода,
около 295k token-ов контекста на вызов.

## Что происходит

- Session Orchestrator-а ведёт Wave за Wave-ой в одном контексте: в нём отчёты агентов, логи, решения прошлых
  Wave. Каждый следующий вызов модели читает их снова.
- Раздел «How to resume a wave» skill-а `epic-wave` (`:1400`) описывает, как продолжить после обрыва, но не
  требует начинать Wave с чистого контекста; брифа для новой Session нет — он собирается из `epic-status`,
  PR, журнала Wave и state file-ов руками.
- Модель не может сама выполнить `/clear`: новую Session начинает Autopilot, владелец или bridge.

## Что делаем

1. `harness/bin/wave-brief <epic>`: печатает до ~3k token-ов — что влито в последней Wave (PR, SHA), какие
   Ticket-ы ждут и чего (`Waits:`, метки `check/*`), открытые PR Epic-а с head и метками, последний
   `LAND=` из state file `land`, следующая Wave по `epic-status`, путь к журналу. Только чтение.
2. Skill `epic-wave`, раздел 5 «Report»: в конце Wave — отчёт, `wave-brief` в журнал Wave и остановка
   (решение владельца 2026-10-28, решение 13: «бриф и стоп»). Orchestrator сам следующую Wave не начинает:
   новую Session начинает worfy Autopilot или владелец, и её первая команда — `wave-brief`. Merge внутри Wave —
   только через `land` в фоне (Ticket 27).
3. `harness/hooks/rules/orchestrator.md`: вывод `land` и агентов читать сводкой (одна строка на PR), лог — по
   ссылке, не в контекст.

Нужен ПК: нет. **Трогает Harness: да** — новый `harness/bin/wave-brief`, skill `epic-wave`,
`harness/hooks/rules/orchestrator.md`; слово владельца дано 2026-10-28 (решение 1). Вердикт Windows: runner
`full` (скрипт Harness).

## Готово, когда

- [ ] `harness/bin/tests/wave-brief.test.sh` на фикстуре Epic-а (Ticket-ы в разных Status, state file `land`)
      — вывод содержит влитые PR, ждущие Ticket-ы с причиной и следующую Wave; без state file — строка «land не
      запускался», код 0; неизвестный Epic — код 1.
- [ ] Вывод `wave-brief` на фикстуре меньше 12 000 байт (test проверяет).
- [ ] Тексты skill-а и `orchestrator.md` — фразы об остановке в конце Wave и о чтении сводкой;
      `skill-blocks.test.sh` / `agents-text.test.sh` — exit 0.
- [ ] Shell test-ы Harness — exit 0; вердикт Windows — runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную) Две Wave-ы в свежих Session-ах; средний контекст на вызов Orchestrator-а до и после — по
      Ticket-у 19, в «Итог».

## Где в коде

- `harness/bin/wave-brief`, `harness/bin/tests/wave-brief.test.sh` — новые
- `harness/skills/epic-wave/SKILL.md` — раздел 5 «Report» (`:1352`), «How to resume a wave» (`:1400`)
- `harness/hooks/rules/orchestrator.md`
- Только читать: `harness/bin/epic-status`, `harness/bin/land` (Ticket 27)

## Вне скоупа

- Запуск новой Session из worfy Autopilot — если Autopilot сейчас ведёт несколько Wave в одной Session, это
  отдельный Ticket по итогу этого (проверить при claim).

## Итог
