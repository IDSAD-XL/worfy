# 03 — Модель spans

Type: grilling
Status: open
Blocked by: 01
Source: [map.md](../map.md), решения 01 (Q4, Q6, Q8)

## Question

Из каких видов span состоит шкала Run и как они вкладываются друг в друга? Кандидаты: Run, Wave, Ticket, Stage Ticket-а, Session и Subagent агента, CI run, запуск gate, ожидание (Limits, сон Machine, другая Machine, человек), круг доработки после REJECTED, повторный запуск implementer-а. Что отличает ожидание от блокировки и от повтора? Какие поля обязательны у каждого вида (начало, конец, исход, причина, ссылки на commit, PR, verdict)? Что делать со span без конца — Run оборвался, агент не отчитался?
