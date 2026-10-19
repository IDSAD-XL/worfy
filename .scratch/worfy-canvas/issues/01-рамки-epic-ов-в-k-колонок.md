# 01 — Рамки Epic-ов в K колонок: постоянный порядок, гистерезис K, команда «Re-pack»

Type: task
Status: claimed 2026-10-19T16:37Z
Branch: worfy-canvas/01
Blocked by: —
Source: [spec.md](../spec.md), решения владельца 1 и 2;
[ADR-0075](../../../docs/adr/0075-epic-frames-in-columns-and-done-shelf.md) (рамки — полоса из K колонок;
меняет пункт 1 ADR-0032), пункты 1–4 и 6; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P1, вариант 1a.
Код перечитан по main `7dab925f`.

## Что происходит

- `stackFrames` (`src/renderer/canvas/epic-layout.ts:412`) кладёт все рамки одной колонкой с общим `x`,
  от `y = 0`, с промежутком `FRAME_GAP = 48` (`epic-layout.ts:39`).
- `frameColumnX` (`epic-layout.ts:375`) ищет `x` полосы шириной самой широкой рамки и высотой всей стопки
  с запасом на открытую стопку done (ADR-0032, пункты 1, 2).
- Вызов — `src/renderer/canvas/sources/epics.ts:440`. Порядок рамок — порядок модели workflow, от
  активности не зависит.
- У Project-а CanvasForAI 11 рамок — колонка около трёх высот экрана.
- Общие файлы с PR #530 (`worfy-polish/33`): `epic-layout.ts`, `test/unit/epic-layout.test.ts`. Ждать его
  мержа.

## Что делаем

1. **Чистые функции раскладки** — `src/renderer/canvas/epic-arrangement.ts` (новый):
   - `columnsFor(frames, previous)` — K по ADR-0075, пункт 3: без прошлого K
     `max(1, round(sqrt(S × 1.6) / W))`; с прошлым K — он же, пока соотношение сторон полосы отличается от
     16:10 не больше чем на 30 %.
   - `orderFor(epics, activity, previous)` — ADR-0075, пункт 4: сначала Epic-и с работой (claimed Ticket,
     живой агент с Binding, идёт Autopilot), потом остальные по имени; новый Epic — в конец; исчезнувший —
     выпадает.
   - Размер окна, камера и время в аргументы не входят.
2. **`stackFrames` раскладывает полосу из K колонок.** Рамка `i` порядка — в колонку `i mod K`. Ширина
   колонки — самая широкая рамка полосы, промежуток — `FRAME_GAP`. `frameColumnX` получает ширину и высоту
   всей полосы; правило поиска кандидатов прежнее.
3. **Запись `epic-arrangement`** (ADR-0075, пункт 6). Невидимый Node Layout-а: id `epic-arrangement`,
   1×1, `locked`, `data: { order, columns, at }`. Вид `epic-arrangement` добавляется в
   `SOURCE_NODE_KINDS` (`src/shared/layout/derived.ts:30`) — он не на плоскости. `sources/epics.ts`:
   - читает запись и считает раскладку от неё;
   - на экране с правом записи пишет запись, когда меняется K и когда порядок посчитан в другой
     календарный день; эти операции — мимо ⌘Z (ADR-0016);
   - на read-only экране (ADR-0066) не пишет ничего.
4. **Команда «Re-pack»** — в палитре команд (`src/renderer/palette/commands.ts`, рядом с «Tidy up»,
   `:158`) и в меню Canvas (`src/renderer/canvas/overlays/CanvasMenu.tsx`, под «Tidy up», `:130`).
   Пересчитывает порядок «активные сначала» и K без гистерезиса; одна операция Layout — один шаг ⌘Z. На
   read-only экране недоступна, как «Tidy up».
5. Смещения пользователя (`epic:<epic>`, `epics.ts:7-14`) не меняются: они по-прежнему от автоматического
   места рамки.

## Готово, когда

- [x] Unit `test/unit/epic-arrangement.test.ts`: K для 1, 4, 11 и 30 рамок; гистерезис — K не меняется,
      пока соотношение сторон в пределах 30 %, и меняется за ними; `orderFor` — активные сначала, новый
      Epic в конце, исчезнувший выпадает; одинаковый вход — одинаковый выход (функции чистые).
- [x] Unit `test/unit/epic-layout.test.ts`: рамка `i` — в колонке `i mod K`; рост одной рамки сдвигает
      только рамки ниже в той же колонке; полоса из K колонок обходит Node-ы на плоскости, как колонка
      ADR-0032; результат не зависит от размера окна (функция его не получает).
- [x] Unit `test/unit/palette-commands.test.tsx` и `test/unit/canvas-menu.test.tsx`: «Re-pack» есть, на
      read-only экране — неактивна с подсказкой, как «Tidy up».
- [x] e2e `test/e2e/epic-columns.spec.ts`: фикстура из 11 Epic-ов — при «fit» полоса не выше 1,5 высоты
      окна; два окна одного Project-а разного размера показывают рамки на одних местах; «Re-pack» и ⌘Z
      возвращают прежнюю раскладку; снимок `epic-columns` в обеих темах.
- [x] e2e `test/e2e/ship-ticket.spec.ts:331` зелёный без правки: «Ship ticket» ставит Session справа от
      всей полосы, на высоте Ticket-а.
- [x] Мутанты красные: рамка — в самую короткую колонку вместо `i mod K`; без гистерезиса; запись
      `epic-arrangement` шагом ⌘Z.
- [ ] Снимок Project-а CanvasForAI (вручную, на Stable copy) — в «Итог»: по нему владелец решает судьбу
      Ticket-а 13.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающие: unit `epic-arrangement.test.ts` и `epic-layout.test.ts` на `i mod K`.
- Unit `test/unit/epic-arrangement.test.ts` (новый), `test/unit/epic-layout.test.ts`,
  `test/unit/palette-commands.test.tsx`, `test/unit/canvas-menu.test.tsx`.
- e2e `test/e2e/epic-columns.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/epic-layout.ts` (`FRAME_GAP` `:39`, `frameColumnX` `:375`, `stackFrames` `:412`)
- `src/renderer/canvas/epic-arrangement.ts` (новый)
- `src/renderer/canvas/sources/epics.ts` (формат Node-а `:7-14`, вызов `stackFrames` `:440`)
- `src/shared/layout/derived.ts` (`SOURCE_NODE_KINDS` `:30`, `onThePlane` `:38`)
- `src/renderer/palette/commands.ts` («Tidy up» `:158`)
- `src/renderer/canvas/overlays/CanvasMenu.tsx` («Tidy up» `:130`)
- `test/unit/epic-layout.test.ts`
- `test/unit/epic-arrangement.test.ts` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/unit/canvas-menu.test.tsx`
- `test/e2e/epic-columns.spec.ts` (новый)

## Вне скоупа

- Полка готовых Epic-ов — Ticket 02.
- ELK `rectpacking` для рамок — Ticket 13, по решению владельца.
- Раскладка Ticket-ов внутри рамки (ELK, ADR-0037) не меняется.

## Итог

Ветка `worfy-canvas/01`. Решение — [ADR-0075](../../../docs/adr/0075-epic-frames-in-columns-and-done-shelf.md), пункты 1–4 и 6.

- Рамки стоят полосой из K колонок: рамка `i` порядка — в колонке `i mod K`, ширина колонки — самая
  широкая рамка, между колонками и рамками `FRAME_GAP` (`stackFrames`, `src/renderer/canvas/epic-layout.ts`).
  `frameColumnX` ищет место для всей полосы. K = 1 — прежняя колонка ADR-0032.
- Чистые функции — `src/renderer/canvas/epic-arrangement.ts`: `columnsFor` (K по формуле, не больше
  числа рамок; гистерезис 30 % от 16:10), `orderFor` (активные сначала, потом по имени — по коду
  символа, не по локали; с прошлым порядком — он же, новый Epic в конец по имени, исчезнувший
  выпадает), `arrange`, `repack`, `readArrangement`, `sameDay`. Размера окна, камеры и часов в
  аргументах нет.
- Запись `epic-arrangement` (Node Layout-а 1×1, `locked`, `data: { order, columns, at }`): вид — в
  `SOURCE_NODE_KINDS`, источник рамок владеет им, на Canvas не рисуется. Экран с правом записи пишет её
  мимо ⌘Z: один раз за открытие Canvas-а Project-а, если записи нет или `at` — другой календарный день
  (порядок «активные сначала», K заново), и когда гистерезис меняет K. Read-only экран не пишет; без
  записи все экраны рисуют по имени и K без гистерезиса.
- Активность Epic-а: `work`-Ticket из модели workflow, живой агент с Binding (по anchor-ам Binding-ов
  на Canvas), Autopilot из `autopilot.state`.
- «Re-pack» — в палитре команд после «Tidy up» и в меню Canvas под «Tidy up»: одна операция
  `patchData` через LayoutOps Canvas-а — один шаг ⌘Z. Палитра просит Canvas через запрос, его
  выполняет меню Canvas (оно внутри LayoutOps). На read-only экране неактивна с подсказкой.
- Тесты: unit `test/unit/epic-arrangement.test.ts`, `test/unit/epic-arrangement-record.test.tsx` (новые),
  `test/unit/epic-layout.test.ts`, `test/unit/palette-commands.test.tsx`, `test/unit/canvas-menu.test.tsx`;
  e2e `test/e2e/epic-columns.spec.ts` (новый, 3 test-а); `test/e2e/ship-ticket.spec.ts:331` зелёный без правки.
- Мутанты красные: «в самую короткую колонку» (5 unit test-ов `epic-layout`), «без гистерезиса»
  (2 unit test-а), «автоматическая запись шагом ⌘Z» (unit `epic-arrangement-record` и e2e «first opening»).
- Снимки `epic-columns` (11 Epic-ов, K = 3): [светлая](../evidence/01-epic-columns-light.png),
  [тёмная](../evidence/01-epic-columns-dark.png).
- Снимок Project-а CanvasForAI — **не на Stable copy**: собранное приложение этой ветки во временной
  папке данных, `epic-status` — снимок вывода настоящего `epic-status --json` по main (15 Epic-ов,
  354 Ticket-а): [светлая](../evidence/01-canvasforai-light.png), [тёмная](../evidence/01-canvasforai-dark.png).
  K = 4. Рамки очень разной ширины и высоты: worfy-terminal-ssh шириной во много колонок Ticket-ов
  задаёт ширину всех колонок, worfy-harness — одна высокая колонка. Пустоты в полосе заметны —
  материал для решения владельца по Ticket-у 13 (ELK `rectpacking`). Снимок на Stable copy остаётся
  владельцу.
