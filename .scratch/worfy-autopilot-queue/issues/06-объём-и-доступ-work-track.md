# 06 — Что Work track показывает и кому

Type: grilling
Status: done 2026-11-05T19:15Z
Blocked by: 04
Source: [map.md](../map.md); Ticket 01, Q5

## Question

- Какие Session входят: все Session Project-а на Canvas, скрытые и архивные, Subagent-ы до какой глубины; Terminal AI и Terminal — нет?
- Пробелы: если 04 покажет, что за 30 дней не хватает (статусы Ticket-ов, ручные Wave-ы, старые логи gate) — новый журнал работы (ADR, отменяющий часть ADR-0092) или пометка «данных нет».
- Linked machine: смотрит Work track Project-а другой Machine (как Run history через `runs.*`), и с каким уровнем доступа (Read only — видит?).
- Нужна ли сводка периода (часы работы, merge, красные gate, расход Limits) — или только лента.
- Приватность: тексты ходов и Subagent-ов в ленте — только названия или и содержание.

## Решения владельца 2026-11-05

Grilling 2026-11-05, раунд 1 (владелец: «по остальному все да» — все рекомендации) и раунд 2 («1-10 согласен»).
Q — вопросы этого Ticket-а по порядку.

1. **Q1. Какие Session входят.** → Все Session Project-а на этой Machine, в том числе скрытые и архивные; Subagent-ы —
   свёрнуты под своей Session; Terminal и Terminal AI — нет.
2. **Q2. Пробелы.** → Нового журнала работы нет (ADR-0092 в силе): пробел показан пометкой «данных нет». Две правки
   Harness-а из ответа 04 — `timings.json` gate хранится 31 день, `epic-wave` пишет маркер начала и конца каждой Wave;
   `cleanupPeriodDays` Claude Code — 35 дней.
3. **Q3. Linked machine.** → В первой версии нет: Work track показывает только эту Machine.
4. **Q4. Сводка.** → Лента и одна строка сводки (часы по Epic-ам, PR merged); окончательный вид — по прототипу 05
   (принят).
5. **Q5. Приватность.** → Только названия: имя Session, имя и описание Subagent-а, Epic, Ticket, номер PR; текст ходов
   и ответов в ленту не попадает.

Итог — spec [`../../worfy-work-track/spec.md`](../../worfy-work-track/spec.md).
