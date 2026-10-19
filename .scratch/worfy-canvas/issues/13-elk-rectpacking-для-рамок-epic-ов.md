# 13 — (Если понадобится) ELK `rectpacking` для рамок Epic-ов вместо K колонок

Type: task
Status: blocked 2026-10-19T15:22Z
Blocked reason: только если после Ticket-а 01 K колонок оставляют заметную пустоту при рамках очень разной ширины; решает владелец по снимку из «Итог» 01
Waits: owner
Blocked by: 01
Source: [spec.md](../spec.md), «Цель» (13 — вне условия готовности Epic-а);
[ADR-0075](../../../docs/adr/0075-epic-frames-in-columns-and-done-shelf.md), «Considered Options» (ELK
`rectpacking` отложен); исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P1, вариант 1b.
Код перечитан по main `7dab925f`.

## Что происходит

- После Ticket-а 01 рамки — полоса из K колонок шириной самой широкой рамки (ADR-0075). При рамках очень
  разной ширины узкие колонки оставляют пустоту.
- ELK уже упаковывает Node-ы для «Tidy up» в Web Worker: `rectpacking`
  (`src/renderer/canvas/elk/pack.ts:31-32`), клиент — `src/renderer/canvas/elk/client.ts`.
- Общие файлы с PR #530 (`worfy-polish/33`): `epic-layout.ts`, `test/unit/epic-layout.test.ts`.

- **Заметка ревью PR #539, круг 2 (2026-10-20).** Формула `K = max(1, round(sqrt(S × 1.6) / W))`
  (ADR-0075, пункт 3) плоха при очень разной ширине рамок. Пример ревью: 10 рамок по 700 px и одна
  в 2400 px. Ширина колонки — самая широкая рамка, а `S` считается по своим ширинам: K = 1 даёт
  полосу в 5,45 раза выше цели 16:10, K = 3 — 1,02. Дешёвый вариант до ELK: перебрать несколько K-кандидатов
  и взять K, чьё соотношение сторон ближе к 16:10 (гистерезис ADR-0075 остаётся). Если владелец выберет
  его, а не `rectpacking`, — это правка пункта 3 ADR-0075 и тоже новый ADR. Строка ADR-0075 «Ticket 13
  — только если K колонок оставит заметную пустоту» уже называет `rectpacking` поздним ответом.

## Что делаем

Только по слову владельца. Тогда:

1. Рамки полосы как прямоугольники без Edge-ей уходят в ELK `rectpacking` того же worker-а, с
   `elk.aspectRatio` 1.6 и порядком записи `epic-arrangement` в `rectpacking.desiredPosition`.
2. До ответа ELK рамки стоят по K колонкам Ticket-а 01 — синхронно; ответ ELK заменяет места (тот же
   двойной путь, что внутри рамки, ADR-0037).
3. Нужен новый ADR (меняет пункт 1 ADR-0075); номер выдаёт Orchestrator при claim.

## Готово, когда

- [ ] Unit `test/unit/epic-layout.test.ts`: рамки разной ширины упакованы плотнее K колонок (площадь
      полосы меньше); одинаковый вход — одинаковые места на двух экранах; смена статуса Ticket-а не
      переставляет ряды выше рамки.
- [ ] e2e: снимок Project-а с рамками разной ширины до и после — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Unit `test/unit/epic-layout.test.ts`.

## Где в коде

- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/canvas/elk/client.ts`
- `src/renderer/canvas/elk/pack.ts` (`:31-32`)
- `test/unit/epic-layout.test.ts`

## Вне скоупа

- Свой упаковщик рядами (`potpack`, `shelf-pack`) — отвергнут в ADR-0075.

## Итог

Заполняется при закрытии.
