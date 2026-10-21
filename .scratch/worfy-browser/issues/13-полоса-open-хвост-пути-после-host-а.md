# 13 — Полоса «Open»: хвост пути стоит после последней строки host-а, а не рядом с первой

Type: task
Status: claimed 2026-10-21T15:51Z
Blocked by: 12, 03
Source: review PR #630 (Ticket 12), снимок
`.scratch/worfy-browser/evidence/12-browser-open-bar-long-narrow-light.png`, 2026-10-21.

## Что происходит

- В узкой рамке длинный host переносится на несколько строк. Хвост пути при этом выровнен по
  baseline первой строки (`align-items: baseline` у `.w-browser-frame__open-url`,
  `src/renderer/canvas/nodes/BrowserNode.css`).
- Поэтому первая строка полосы читается как цельный адрес:
  `http://bank.e /…b/bank.example.com/login`. Настоящий домен (`…evil.invalid`) стоит только на
  последней строке. Host виден целиком, как требует Ticket 12, но глаз читает верхнюю строку.

## Что делаем

1. Хвост пути (и голова, если она есть) идёт сразу после последней строки host-а. Это может быть
   inline-текст вместо flex-колонок или выравнивание по последней строке. Способ — выбор
   исполнителя.
2. Host остаётся целиком. Обрезается только путь, как в Ticket-е 12.

## Готово, когда

- [ ] e2e на рамке 400 px: вертикальная позиция хвоста пути не выше последней строки host-а.
- [ ] Mutant «старое выравнивание по baseline» даёт exit 1.
- [ ] Снимки узкой рамки в обеих темах обновлены.

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `test/e2e/browser.spec.ts`

## Вне скоупа

- Подпись «The page wants to open» вылезает за полосу в рамке уже примерно 200 px (`flex: none`,
  `nowrap`). Так было и до Ticket-а 12. Если чинить, то отдельно.

## Итог
