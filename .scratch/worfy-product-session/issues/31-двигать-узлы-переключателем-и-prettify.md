# 31 — двигать узлы Mind map только с переключателем «Move nodes»; кнопка «Prettify» раскладывает карту заново

Type: task
Status: claimed 2026-11-09T16:58Z
Branch: worfy-product-session/31
Source: владелец 2026-11-09, дословно: «возможность перетаскивать ноды в продакт сессии нужно сделать переключалкой
сверху, по дефолту запрещено, и добавить кнопку prettify которая сама расставит диаграмму, если вдруг юзер подвигал все
и сбил расположения»; [spec.md](../spec.md)

Не платформенный Ticket (правка renderer и схемы канала `product.layout`, без путей и процессов ОС). Глубина ревью —
`medium`; снимок экрана.

## Что происходит

- Узел `mind-map.json` на Mind map двигается мышью всегда (Ticket 09): случайный drag по узлу вместо drag-а по фону
  сдвигает узел, а в «Tree» ещё и пишет его место в файл (`x`, `y`, `placed: 2`). Вернуть раскладку некуда: места
  из файла убирает только ручная правка файла.
- В «Graph» drag двигает узел до следующей раскладки и ничего не пишет (Ticket 26, `graphMoves` в
  `src/renderer/product/MindMap.tsx`); сбросить такие сдвиги можно только сменой вида.

## Что делаем

Слова UI остаются английскими (`docs/design/BRIEF.md`).

1. В строке инструментов Mind map (рядом с «Tree · Graph», «Hide rejected» и zoom) — переключатель «Move nodes» с иконкой
   руки. По умолчанию выключен: drag по узлу не двигает его и ничего не пишет, а двигает карту, как drag по фону.
   Click по узлу открывает карточку, как раньше; метка сворачивания ветки работает.
2. Переключатель включён — drag двигает узел как сейчас: в «Tree» место пишется в файл, в «Graph» — до следующей
   раскладки.
3. Кнопка «Prettify» снимает ручные места вида на экране и рисует автоматическую раскладку, потом Fit:
   - «Tree»: места узлов из `mind-map.json` (`x`, `y`, `placed`) снимаются одной записью через тот же канал, что пишет
     drag (`product.layout`, форма `{ clearPlaces: true }`), тем же писателем main (`updateMindMap`);
   - «Graph»: сбрасываются сдвиги `graphMoves`; файл не трогается.
   - Ручных мест нет — кнопка неактивна.
4. На экране только для чтения (Linked machine) оба элемента неактивны, tooltip говорит почему.

## Решено без владельца

- **Состояние «Move nodes» не запоминается.** Выключен при каждом открытии карты и при смене темы — так и читается
  «по дефолту запрещено». Смена вида «Tree · Graph» его не сбрасывает.
- **Отмены у Mind map нет** (ни Undo, ни истории правок карты). Поэтому «Prettify» в «Tree», где места в файле
  пропадают насовсем, спрашивает коротко прямо в строке инструментов: «Drop N moved places?» и кнопки «Prettify» /
  «Cancel». В «Graph» сдвиги и так живут до следующей раскладки и ничего не пишут — там без вопроса.
- **Подписи, иконки, tooltip:**
  - «Move nodes» — иконка руки и текст «Move nodes», `aria-pressed`; tooltip выключенного: «Turn on to drag nodes to
    new places. Off: a drag on a node pans the map»; включённого: «Turn off so a drag on a node pans the map».
  - «Prettify» — иконка «искры» и текст «Prettify»; tooltip: «Lay the map out again: drop the places nodes were moved
    to by hand in this view»; неактивной: «No node was moved by hand in this view».
- Пока запись main не вернулась, экран уже рисует автоматическую раскладку; отказ main возвращает места и пишет
  «Could not save the change: …», как при drag.
- Ручные места «Tree» считаются по всем узлам темы, и по скрытым «Hide rejected» или свёрнутой веткой тоже: «Prettify»
  снимает места всех узлов файла.

## Готово, когда

- [ ] Unit test-ы (`test/unit/mind-map-hand.test.tsx`): drag с выключенным «Move nodes» ничего не двигает и не пишет;
  с включённым — двигает и пишет; «Prettify» в «Tree» после подтверждения снимает места файла одной записью
  `{ clearPlaces: true }` («Cancel» не пишет ничего, отказ main возвращает места), а в «Graph» сбрасывает сдвиги без
  записи и без вопроса, и места «Tree» в файле остаются; без ручных мест «Prettify» неактивна; на экране только для
  чтения оба элемента неактивны.
  - evidence: test-run pass · `pnpm test` in gate fast exit 0; test/unit/mind-map-hand.test.tsx 20 passed, 6 mutants killed · mac - · 6635a8f3b
- [ ] Contract test `product.layout` (`test/contract/product-layout.test.ts`): `clearPlaces` снимает `x`, `y`,
  `placed` у всех узлов одной записью, остальное байт в байт; `clearPlaces` вместе с `id`, `x` или `collapsed`
  отклоняется схемой.
  - evidence: test-run pass · `pnpm test` in gate fast exit 0; test/contract/product-layout.test.ts 8 passed · mac - · 6635a8f3b
- [ ] e2e test (`test/e2e/product-session.spec.ts`): drag при выключенном «Move nodes» не пишет в файл, при
  включённом пишет; «Prettify» снимает место из файла.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` 8 passed exit 0 · mac dev · 6635a8f3b
- [ ] Снимок строки инструментов (тёмная тема) в папке вывода test-а, в репозиторий не кладётся.
- [ ] `docs/features/product-session.md` (только английская страница, ADR-0088).
  - evidence: commit pass · Mind map nodes move only with the Move nodes toggle; Prettify lays the map out again (worfy-product-session 31) · - - · 6635a8f3b
- [ ] `pnpm lint`, `pnpm typecheck`, unit test-ы Mind map и renderer Product Session, e2e
  `test/e2e/product-session.spec.ts`, gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6635a8f3b
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · 6635a8f3b

## Тесты

- `test/unit/mind-map-hand.test.tsx`, `test/unit/mind-map*.test.tsx`, `test/unit/mind-map-layout.test.ts`,
  `test/unit/product-session-panel.test.tsx`, `test/unit/node-chips.test.tsx` и остальные unit test-ы, что импортируют
  `src/renderer/product`; `test/contract/product-layout.test.ts`; `test/unit/link-access.test.ts`.
- `test/e2e/product-session.spec.ts`.

## Где в коде

- `src/renderer/product/MindMap.tsx` (переключатель, «Prettify», drag только при включённом), `src/renderer/product/mind-map.css`
- `src/shared/ipc/product.ts` (`clearPlaces` в `product.layout`), `src/main/ipc/product.ts`,
  `src/main/mcp/mind-map-server.ts` (`placesCleared`)
- `test/unit/mind-map-hand.test.tsx`, `test/contract/product-layout.test.ts`, `test/e2e/product-session.spec.ts`
- `docs/features/product-session.md`

## Итог
