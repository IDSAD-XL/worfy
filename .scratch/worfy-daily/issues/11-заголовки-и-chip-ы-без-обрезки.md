# 11 — Заголовки и chip-ы без обрезки

Type: task
Status: open
Blocked by: 10
Source: [spec.md](../spec.md), тема C; [F-SPEC.md](../../../docs/design/F-SPEC.md), макеты `docs/design/F-canvas-*.dc.html`; Ticket-ы 11 и 17 worfy-mvp

## Что делаем

**Что обрезается сейчас:**

- **Заголовок Ticket-а** — `-webkit-line-clamp: 2` в `src/renderer/canvas/epic-frame.css:250-258`.
  Строка meta — `nowrap` и ellipsis (`:259-266`).
- **Заголовок рамки** — `.w-epic__title`, `nowrap` и ellipsis (`:55-64`).
- **Стопка «33 done»** — `src/renderer/canvas/nodes/EpicFrameNode.tsx:97-107`. Её размер
  `TICKET_WIDTH × DONE_STACK_HEIGHT` задан в `layoutEpic` (`epic-layout.ts:190`).
- **Имя Epic в sidebar** («audi…») — `src/renderer/shell/sidebar/EpicsSection.tsx:33` и `:64-66`.
  Там показано только `epic.epic` с ellipsis, полное имя — лишь в атрибуте `title`.
- **Chip CI** — `src/renderer/canvas/badges/ChecksBadges.tsx:57`. В `checks-badges.css:4-26`
  обрезка заложена намеренно, а полный список — в tooltip.

Размеры: `TICKET_HEIGHT = 104`, `TICKET_WIDTH = 204`, `DONE_STACK_HEIGHT = 120`
(`src/renderer/canvas/epic-layout.ts:12-21`).

**Первый шаг — воспроизвести.** Снять снимки на Auction и на worfy, в светлой и тёмной теме.
Записать, какие заголовки и chip-ы обрезаны и где. Сверить с F-SPEC и макетами. Список и снимки
идут в «Итог».

**Правки:**

- **Заголовок Ticket-а** читается целиком или до предела из F-SPEC, а полный текст есть в tooltip.
  Если меняются `TICKET_HEIGHT` или `TICKET_WIDTH`, сдвигается геометрия рамок и готовой Wave.
  Offset-ы относительно авто-места сохраняются, но вид меняется. Числа в `epic-layout.test.ts`
  нужно обновить.
- **Стопка done** — число и подпись не обрезаны.
- **Sidebar** — имя Epic читается целиком: перенос строки или ширина — по F-SPEC.
- **Chip CI** виден на Ticket-е шириной 204 px, даже если рядом PR и Gate. Остальные chip-ы можно
  обрезать, как задумано, а CI — нельзя.

**Что известно из ручных проверок 2026-10-06, ночь** (номера Ticket-ов — `worfy-mvp`):

- на Auction заголовок Ticket-а виден одной строкой без многоточия: высота `.w-ticket__title` 21 px
  при `scrollHeight` 34 (Ticket 10);
- подпись «as of» полос Limits в toolbar налезает на соседнюю и уходит под «v0.0.0» и поле поиска:
  ширина 104 px и `nowrap` (`src/renderer/limits/LimitBar.tsx:58` и `:67`, Ticket 22);
- длинное имя Project-а в toolbar не обрезается и выталкивает за край окна переключатель
  Canvas/Session, Limits и поиск (`src/renderer/shell/Toolbar.tsx:68`, `src/renderer/shell/shell.css:86-91`,
  Ticket 09).

## Готово, когда

- [ ] В «Итог» — список обрезаний до правки, со снимками.
- [ ] На фикстуре с длинными названиями (заголовок Ticket-а — 120 символов) у заголовка Ticket-а, заголовка рамки, стопки done и имени Epic в sidebar нет скрытого переполнения, или полный текст есть в `title`. e2e проверяет `scrollWidth ≤ clientWidth` и `scrollHeight ≤ clientHeight`.
- [ ] Chip CI виден на Ticket-е при PR, Gate и CI сразу: e2e проверяет, что boundingBox chip-а CI внутри boundingBox Ticket-а.
- [ ] Снимки в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/epic-frame.spec.ts` — переполнение заголовков на фикстуре с длинными названиями.
- `test/e2e/checks-badges.spec.ts` — chip CI внутри Ticket-а.
- `test/unit/epic-layout.test.ts` — числа геометрии, если меняются размеры.
- Сначала падающий test: e2e на заголовок Ticket-а длиной 120 символов находит скрытое переполнение.

## Где в коде

- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/epic-frame.css`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/renderer/canvas/badges/checks-badges.css`
- `src/renderer/shell/sidebar/EpicsSection.tsx`
- `test/unit/epic-layout.test.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/checks-badges.spec.ts`
