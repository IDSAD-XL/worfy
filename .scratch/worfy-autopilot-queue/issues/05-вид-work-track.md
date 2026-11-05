# 05 — Как выглядит Work track

Type: prototype
Status: done 2026-11-05T19:15Z
Blocked by: 04
Source: [map.md](../map.md); Ticket 01, Q5–Q6

## Question

Какой вид ленты позволяет «отследить всю работу» за день, неделю, две недели и месяц?

- Где: пункт в Runs (`src/renderer/shell/Toolbar.tsx:63-73`) рядом со списком Run-ов — вкладка, первый пункт списка, отдельный вид.
- Ось и масштаб: период 1 д / 7 д / 14 д / 1 мес и сдвиг по датам; что видно на месяце, а что только при приближении.
- Дорожки (lane): по Session (Orchestrator, мост, другие), по Epic-ам, по виду работы (Run, ручные ходы, PR/CI, gate) — или их смена.
- Плотность: месяц работы — тысячи ходов и Subagent-ов; сводка (часы работы в день, число merge, красные gate) или все Span-ы.
- Клик: открыть Run в Run history, PR, Session, Ticket.
- Пробелы данных («данных нет» — Q4 Ticket-а 01).

Прототип — грубый: Card на Canvas или HTML с выдуманными данными из ответа 04; владелец реагирует на него.

## Решения владельца 2026-11-05

Прототип — Card `card-dcf3918a` (`~/Library/Application Support/worfy/CanvasForAI-a2cd477b/cards/card-dcf3918a/index.html`,
HTML с выдуманными данными по ответу 04). Владелец: «прототип глянул, подходит»; вопросы Q1–Q7 к прототипу — «да».

1. **Q1. Где.** → Переключатель «Run history | Work track» во вкладке Runs (`src/renderer/shell/Toolbar.tsx:63-73`).
2. **Q2. Ось и масштаб.** → Period: Day / Week / Month, по умолчанию Week, сдвиг ‹ ›. Month — клетки дней, закрашенные
   по часам работы; щелчок по дню открывает Day.
3. **Q3. Дорожки.** → По умолчанию «by Session», сверху дорожка «Autopilot Runs»; Subagent-ы свёрнуты под своей Session;
   «by Epic» — переключателем. Run-ы gate — своя дорожка «Gate runs».
4. **Q4. Плотность.** → Density: compact по умолчанию, comfortable — переключателем. Сводка периода — одна строка: часы по
   Epic-ам без двойного счёта параллельной работы, PR merged, Autopilot Runs, пробелы «no data».
5. **Q5. Щелчок.** → Щелчок по Span-у открывает боковую панель со ссылками и кнопками Open Session / Open Run / Open PR.
6. **Q6. Пробелы данных.** → Штриховка «no data» с подсказкой: какой источник и почему (срок транскриптов, срок логов gate).
7. **Q7. Прототип в целом.** → Принят как вид Work track.

Итог — spec [`../../worfy-work-track/spec.md`](../../worfy-work-track/spec.md).
