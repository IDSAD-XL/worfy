# 26 — Доработка — свежему implementer-у с коротким брифом, а не `SendMessage` прежнему с большим контекстом

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 2, решение 9.

## Что происходит

- `REJECTED` verifier-а уходит «to the same implementer through `SendMessage`» (`harness/skills/epic-wave/SKILL.md:666-667`),
  так же — круг доработки по красному CI и по виновнику красного набора (`:839`, `:1051`).
- К этому моменту implementer обычно простаивал дольше 5 min (ревью, gate других PR): его cache subagent-а
  (TTL 5 min) умер, и первое же сообщение перезаписывает весь контекст — часто 100k+ token-ов — по 1,25 × цены
  входа. Короткий новый бриф — несколько тысяч token-ов.

## Что делаем

1. Правило skill-а: круг доработки — новый implementer (`F worktree.implementer`, та же ветка и worktree) с
   брифом: Ticket, PR, ветка, head, список находок группы «Act on», путь к отчёту verifier-а, напоминание о
   test-е на каждое новое поведение (та же фраза, что сейчас в `:668-670`).
2. Исключение: прежний implementer закончил меньше 5 min назад — можно `SendMessage` (его cache ещё жив).
   Время берётся из журнала Wave.
3. То же для кругов по красному CI и по виновнику набора.

Нужен ПК: нет. **Трогает Harness: да** — `harness/skills/epic-wave/SKILL.md`; слово владельца дано 2026-10-28
(решение 1). Вердикт Windows: не платформенный PR (текст skill-а).

## Готово, когда

- [ ] Текст skill-а в трёх местах (`:666`, `:839`, `:1051` или их новые строки) говорит «новый implementer с
      брифом», исключение 5 min и состав брифа; `harness/bin/tests/epic-wave-ship-ticket.test.sh` (или
      `skill-blocks.test.sh`) проверяет фразы — exit 0.
- [ ] Шаблон брифа доработки — блок в skill-е; test проверяет, что в нём есть строки Ticket, PR, Branch, Head,
      Findings, Verifier report.
- [ ] Shell test-ы Harness — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную, после обновления Stable copy) Первые три круга доработки — свежим агентом; число кругов и
      стоимость круга до и после — по Ticket-у 19, в «Итог».

## Где в коде

- `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate», `:666-670`; `:839`; раздел 4, `:1051`)
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Вне скоупа

- Правило implementer-а об ожидании — Ticket 25.

## Итог
