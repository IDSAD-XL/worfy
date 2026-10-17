# 28 — Заголовки Command palette — не больше 3 строк, полный текст в tooltip только у обрезанных строк

Type: task
Status: claimed — 2026-10-17
Branch: worfy-polish/28
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен») — follow-up Ticket-а
[16](16-полный-текст-ручной-проверки-в-палитре.md) (раздел «Gate оркестратора», Consider [low]: у строки
ручной проверки нет лимита строк; tooltip на каждой строке); правило
[`worfy-daily` 11](../../worfy-daily/issues/11-заголовки-и-chip-ы-без-обрезки.md): заголовок — до 3 строк,
дальше многоточие, полный текст — в tooltip.

## Что происходит

- **Строка ручной проверки растёт без предела.** Группа `Manual check` (`WRAPPED_GROUP`,
  `src/renderer/palette/CommandPalette.tsx:152`) переносит заголовок на сколько угодно строк
  (`wrappedTitle`, `:118`; `wrappedRow`, `:117`). Проверка в 881 символ заняла 224 из 409 px списка, и
  при запросе «worfy-mvp 07» строки Go to и «Ship ticket» ушли ниже видимой части (Gate Ticket-а 16).
  Самая длинная настоящая проверка — 995 символов, около 12 строк («Итог» Ticket-а 16).
- **Tooltip на каждой строке.** Строка без состояния действия получает `title` всегда:
  `hint ?? command.title` (`:158`, `title={tooltip}` — `:180`), даже когда заголовок виден целиком.
  Правило worfy-daily 11 — полный текст в tooltip там, где текст обрезан.
- **Обычные строки** режутся в одну строку с многоточием (`styles.title`, `:112`): заголовок до 60 %
  ширины, если справа есть detail.
- Образец предела в 3 строки — заголовок Ticket-а на Canvas: `-webkit-line-clamp: 3`
  (`src/renderer/canvas/epic-frame.css:274-285`, `TICKET_TITLE_LINES` в
  `src/renderer/canvas/epic-layout.ts:22`).

## Что делаем

1. **Сначала красные test-ы** в `test/unit/palette-manual-check-row.test.tsx`: проверка в 995 символов
   занимает не больше 3 строк (высота заголовка ≤ 3 × line-height); строка, чей заголовок виден целиком,
   не имеет `title`; обрезанная — имеет `title` с полным текстом. На main первый и второй красные.
2. **Предел 3 строки** для строк с переносом (`wrappedTitle`): line clamp, дальше многоточие. Высота
   строки — по содержимому, но не больше 3 строк заголовка и отступов.
3. **Tooltip только у обрезанных.** Обрезан ли заголовок — по факту в DOM (`scrollHeight >
   clientHeight` для строк с переносом, `scrollWidth > clientWidth` для однострочных), пересчёт при
   изменении ширины окна и списка. Полный текст — в `title`.
4. **Другие tooltip-ы не меняются**: отрывок транскрипта (`hint`) у строк поиска по транскриптам,
   текст команды или причина отказа у «Ship ticket» и «Run wave» — это не полный заголовок, они
   остаются как есть.
5. **Снимки** Command palette в светлой и тёмной теме: запрос «worfy-mvp 07» с длинной проверкой —
   строки Go to и «Ship ticket» видны без прокрутки; tooltip на обрезанной строке.

## Готово, когда

- [x] Test-ы пункта 1 красные на main и зелёные с правкой; test-ы `palette-groups`, `palette-commands`,
      `palette-transcripts` зелёные без правки ожиданий.
- [x] Проверка в 995 символов — 3 строки и многоточие; у короткой проверки нет `title`.
- [x] Снимки в обеих темах — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- `test/unit/palette-manual-check-row.test.tsx` — предел строк и `title` только у обрезанных.
- Мутанты: без line clamp — красный test предела; `title` всегда — красный test короткой строки;
  `title` никогда — красный test обрезанной.

## Где в коде

- `src/renderer/palette/CommandPalette.tsx`
- `test/unit/palette-manual-check-row.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/renderer/canvas/epic-frame.css`,
`src/renderer/canvas/epic-layout.ts`, `test/unit/palette-groups.test.tsx`.

## Вне скоупа

- Порядок групп и число строк в Command palette (`SHOWN`).
- Tooltip-ы других окон worfy.

## Итог

Ветка `worfy-polish/28`. Правка — только `src/renderer/palette/CommandPalette.tsx` (`RowButton`, новый hook
`useCut`) и `test/unit/palette-manual-check-row.test.tsx`.

- **Предел 3 строки.** Заголовок строки `Manual check` — `display: -webkit-box`, `-webkit-line-clamp: 3`
  (`WRAPPED_TITLE_LINES`, как `TICKET_TITLE_LINES` у Ticket-а на Canvas), `overflow: hidden` из обычного
  заголовка; перенос (`white-space: normal`, `overflow-wrap: anywhere`) и `line-height: 18px` — как
  были. Высота строки по-прежнему `height: auto`, `minHeight: var(--row-height)`: короткая проверка —
  28 px, длинная — 62 px (3 × 18 + отступы).
- **Tooltip только у обрезанных.** `useCut` меряет заголовок в DOM: `scrollHeight > clientHeight` у
  строки с переносом, `scrollWidth > clientWidth` у однострочной. Мерит в `useLayoutEffect` и снова на
  каждом `ResizeObserver` заголовка (ширина окна, панели, появление полосы прокрутки списка) и при смене
  текста. `title` строки без состояния действия — `hint` (отрывок транскрипта), иначе полный заголовок
  только пока он обрезан, иначе `title` нет. «Ship ticket», «Run wave» и строки только для чтения —
  без изменений (текст команды или причина отказа).
- **Red на main** (новые test-ы, `CommandPalette.tsx` с main): 5 из 8 красные — предел 3 строк для
  проверки в 995 символов (`expected '' to be '-webkit-box'`), нет `title` у короткой проверки, пересчёт
  при сужении, нет `title` у «New session», `title` только у обрезанной однострочной. **Green с правкой:**
  `palette-manual-check-row`, `palette-groups`, `palette-commands`, `palette-transcripts` — 4 файла,
  46 test-ов, exit 0; ожидания трёх последних не правились. В jsdom нет раскладки: test задаёт
  заголовку размеры, какие дал бы браузер (7 px на символ, строки по line-height, видимых строк не
  больше line clamp), и подменяет `ResizeObserver`.
- **Mutation testing** (копия файла, восстановление по `cmp`), каждый мутант краснит test: без
  `-webkit-line-clamp`; без `display: -webkit-box`; `title` всегда; `title` никогда; без
  `ResizeObserver`; строка с переносом мерится по ширине, а не по высоте.
- **Снимки** (собранный renderer, Playwright `_electron`, временные данные, `snapshotThemes`; проверки
  в 995 и 42 символа, Ticket 07 с длинным заголовком): запрос «worfy-mvp 07» —
  [светлая](../evidence/28-palette-three-lines-light.png), [тёмная](../evidence/28-palette-three-lines-dark.png).
  Замер там же: длинная проверка — заголовок 54 px (3 × 18), `scrollHeight` 216, строка 62 px, `title`
  — полный текст; короткая — 18 px, `title` нет; строки Go to и «Ship ticket» видны без прокрутки
  (`scrollTop` 0); заголовок Go to обрезан (518 > 320 px) — `title` есть. Панель, суженная до 120 px,
  — короткая проверка становится обрезанной (5 строк из 3) и получает `title`; вернули ширину —
  `title` снова нет. Системный tooltip `title` на снимке страницы не рисуется: на снимке курсор над
  длинной проверкой, сам tooltip подтверждён атрибутом. Spec снимков — в scratchpad, в репозиторий не
  входит.
