# 04 — Граница Product Session и разработки

Type: grilling
Status: done 2026-11-07T16:30Z
Blocked by: 03
Source: [map.md](../map.md), ответ 03 (требование владельца: продуктовый режим отделён от режима разработчика)

## Question

Как назвать продуктовый режим и где проходит его граница с разработкой: какие у него правила, что ему можно делать, откуда он запускается, где лежат его документы и кто что читает?

## Answer

Владелец 2026-11-07: «Да» на Q1–Q4.

- Q1: термин — **Product Session**, а не «режим». Слово «режим» уже занято шесть раз: Run mode, Full mode, Silent mode, Eco mode, Orchestrator modes, Shadow mode. Термин заведён в `CONTEXT.md`.
- Q2: четыре границы:
  - свои правила для продуктового мышления — без Ticket-ов, gate и merge;
  - Product Session не меняет код, не запускает Autopilot и не берёт Ticket-ы; пишет только продуктовые документы и черновики Epic-ов;
  - свой вход — «New Product Session» рядом с обычным;
  - своё место в Project-е — `docs/product/`: vision, гипотезы, разборы критика, отклонённые идеи с причинами.
- Q3: Product Session пишет черновик spec с пометкой «черновик советника»; владелец его принимает, дальше обычный путь — Ticket-ы, Wave-ы, Autopilot.
- Q4: Product Session читает всё о разработке — roadmap, spec-и, Ticket-ы, PR, падения CI. Обычные Session и Orchestrator читают `docs/product/`. Каждая сторона пишет только своё.
