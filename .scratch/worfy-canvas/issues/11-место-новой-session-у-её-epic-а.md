# 11 — Место новой Session с Binding — справа от полосы рамок, на высоте её Ticket-а или Epic-а

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), решение владельца 9 (Session-ы не двигаются сами — только место новой и
команда); исследование [2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md),
P4, вариант 4b, шаг 1. Код перечитан по main `7dab925f`.

## Что происходит

- «Ship ticket» ставит новую Session справа от колонки рамок на высоте Ticket-а: renderer считает точку
  (`shipTicketSpot`, `src/renderer/canvas/actions/TicketActions.tsx:34`, вызов `:73`), main ставит Node
  первым свободным местом вниз от неё (`placeDownFrom`, `src/main/layout/place.ts:31`).
- Внешняя Session встаёт под последним Session Node (`nextPlace`,
  `src/renderer/claude-home/session-nodes.ts:200`; план — `planSessionNodes`, `:229`), даже если её
  Binding уже известен (claim, `/epic-wave`, ветка; `src/shared/binding/resolve.ts:1-20`).
- После Ticket-а 01 рамки — полоса из K колонок (ADR-0075).

## Что делаем

1. **Функция места** — `src/renderer/canvas/session-spot.ts` (новый): `sessionSpot(binding, frames,
   strip)` → точка справа от полосы рамок (не справа от одной рамки: внутри полосы справа стоит соседняя
   колонка, и Node там увёл бы всю полосу, ADR-0032) на высоте:
   - Ticket-а — для Binding к Ticket-у;
   - шапки рамки Epic-а — для Binding к Epic-у.

   Нет Binding-а или рамка Epic-а на Done shelf — `undefined`.
2. **«Ship ticket»** зовёт `sessionSpot` вместо своей `shipTicketSpot` — поведение то же.
3. **Внешняя Session.** `planSessionNodes` для новой Session с Binding в момент создания Node-а ставит его в
   первое свободное место от `sessionSpot` (`freePlace`, ADR-0038); без Binding — по-старому (`nextPlace`).
4. **Уже стоящий Node не двигается**, когда Binding появляется позже (по ветке — не сразу): решение 9.

## Готово, когда

- [ ] Unit `test/unit/session-spot.test.ts`: точка для Binding к Ticket-у и к Epic-у; справа от всей
      полосы при K = 3; Epic на Done shelf и Session без Binding — `undefined`.
- [ ] Unit `test/unit/session-nodes.test.tsx`: новая внешняя Session с Binding встаёт у своего Epic-а, без
      Binding — под последним Session Node; Node, получивший Binding позже, не двигается.
- [ ] e2e `test/e2e/ship-ticket.spec.ts:331` («Ship ticket puts the Session right of the Epic frames'
      column, by its Ticket») зелёный без правки.
- [ ] Мутант красный: точка справа от рамки, а не от полосы.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `session-spot.test.ts` на точку справа от полосы.
- Unit `test/unit/session-spot.test.ts` (новый), `test/unit/session-nodes.test.tsx`.

## Где в коде

- `src/renderer/canvas/session-spot.ts` (новый)
- `src/renderer/canvas/actions/TicketActions.tsx` (`shipTicketSpot` `:34`, вызов `:73`)
- `src/renderer/claude-home/session-nodes.ts` (`nextPlace` `:200`, `planSessionNodes` `:229`)
- `src/renderer/canvas/overlays/SessionNodes.tsx`
- `test/unit/session-spot.test.ts` (новый)
- `test/unit/session-nodes.test.tsx`

Только чтение: `src/main/layout/place.ts` (`placeDownFrom` `:31`), `src/shared/layout/free-place.ts`.

## Вне скоупа

- Перестановка уже стоящих Session-ов — Ticket 12, только по команде.

## Итог

Заполняется при закрытии.
