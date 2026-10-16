# 28 — Заголовки Command palette — не больше 3 строк, полный текст в tooltip только у обрезанных строк

Type: task
Status: open
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

- [ ] Test-ы пункта 1 красные на main и зелёные с правкой; test-ы `palette-groups`, `palette-commands`,
      `palette-transcripts` зелёные без правки ожиданий.
- [ ] Проверка в 995 символов — 3 строки и многоточие; у короткой проверки нет `title`.
- [ ] Снимки в обеих темах — ссылки в «Итог».
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

—
