# 01 — Destination, единица истории, хранение и id

Type: grilling
Status: done 2026-10-31T22:15Z
Blocked by: —
Source: [map.md](../map.md)

## Question

Чем заканчивается карта, историю чего записываем, где она живёт и чем связываются источники?

## Answer

Владелец 2026-11-01: «со всем согласен» на Q1–Q9.

- Q1: финиш карты — принятый `spec.md` Epic-а `worfy-flight-recorder` с Ticket-ами и Wave-ами; код начинается после приёмки spec.
- Q2: единица истории в v1 — один Run (запуск Autopilot над Epic). Ручная работа Orchestrator-а — в «Not yet specified».
- Q3: в `CONTEXT.md` заведён термин **Run** — ровно то, что Journal называет run; Wave внутри Run — событие `wave-started`/`wave-finished` с номером. Отдельного `waveId` нет.
- Q4: шкала вычисляется при открытии, как Stage (ADR-0002); своего индекса spans нет. Дыры закрываются в самих источниках: Journal получает недостающие события Run, gate — короткую историю verdict-ов.
- Q5: ключ связи — run id Journal. Session id и agent id попадают в Journal при раздаче Ticket-а; PR и commit-ы связываются по ветке Ticket-а и sha. В commit-ы и PR ничего не штампуется.
- Q6: форма v1 — экран в worfy: шкала по дорожкам Run → Wave → Ticket → Stage или агент, с отметками повторов, ожиданий и блокировок и ссылками на commit, PR и gate verdict. Точный вид — prototype-Ticket.
- Q7: Run записан на той Machine, где шёл; gate на другой Machine — внешняя точка «ждали с … по …».
- Q8: аналитика по многим Run — вне карты; модель spans — фиксированный набор видов, у каждого начало, конец и причина, чтобы сводки были возможны.
- Q9: разбор Journal из `scripts/critical-path.mjs` становится общим модулем; скрипт — тонкая обёртка. Двух разборов не будет.

Добавлено владельцем в том же ответе: после остановки Autopilot предлагать посмотреть историю Run; Autopilot из чата — такой же Run, как кнопкой. Пример вида — waterfall APM-tracing (описан в `map.md`), только как ориентир.
