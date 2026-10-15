# 09 — Неотмеченные ручные проверки «(вручную)» всех Ticket-ов — в палитре

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат U12; `HANDOFF.md`, «Дальше»: «Ручные проверки на Stable copy
одним блоком, пока владельца нет за Mac-ом: `worfy-week` 02, 05, 08–12, 15–18, … Шаги — пункты
«(вручную)» Ticket-ов» — этот список сейчас ведётся руками; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md).

## Что происходит

- В разделе «Готово, когда» Ticket-ов пункты, которые проверяет человек, помечены `(вручную)`. На main
  `fff11ba` в `.scratch/*/issues/` 70 неотмеченных `- [ ] (вручную)` и 22 отмеченных; неотмеченные есть в
  34 файлах со `Status: done` — Ticket влит, а ручная проверка ещё впереди.
- Найти их можно только `grep`-ом или по HANDOFF, который ведётся руками и отстаёт.
- worfy уже читает markdown каждого Ticket-а: `reader.ts:270-275` берёт из него раздел «Где в коде»
  (`codeSection`, `:156`). Модель Ticket-а (`ticketSchema`, `src/shared/workflow/types.ts:53-63`) ручных
  проверок не несёт.

## Что делаем

1. **Разбор** — `src/shared/workflow/manual-checks.ts`: из markdown Ticket-а — пункты списка раздела
   `## Готово, когда`, текст которых после `[ ]` или `[x]` начинается с `(вручную)`. Результат:
   `{ text, checked }[]` в порядке файла; текст — первая строка пункта без `(вручную)`, продолжения
   строк склеены через пробел. Другие разделы не читаются.
2. **Модель.** `ticketSchema` получает `manualChecks` — необязательное поле с default `[]`: старые
   fixture-ы и Linked machine со старой версией worfy читаются как раньше. `reader.ts` заполняет его там
   же, где `codeSection`.
3. **Палитра.** Новая группа `Manual check` в `src/renderer/palette/commands.ts`: по строке на каждую
   **неотмеченную** проверку всех Epic-ов Project-а — «`<epic>` NN · <текст>». Выбор строки — как «Go to»
   Ticket-а: Canvas едет к Node-у Ticket-а (тот же `focusCanvasNode`). Строки ищутся по тексту палитрой,
   как прочие команды; пустая палитра (без запроса) группу не показывает — чтобы не забивать список.
4. **Только чтение** (ADR-0002): отметить проверку из worfy нельзя; отметка — правкой Ticket-а, как сейчас.

## Готово, когда

- [ ] Unit test-ы разбора: пункт `[ ] (вручную)` и `[x] (вручную)`; пункт без `(вручную)` не берётся;
      `(вручную)` вне раздела «Готово, когда» не берётся; пункт в несколько строк склеен; раздела нет — `[]`.
- [ ] Contract test `workflow-reader`: на fixture-Project-е с двумя Ticket-ами модель несёт их
      `manualChecks`.
- [ ] Unit test палитры: запрос «Stable» находит неотмеченную проверку с этим словом; отмеченной нет;
      выбор зовёт `focusCanvasNode` с id Node-а Ticket-а.
- [ ] На настоящем `.scratch/` worfy (временная копия, только чтение) число неотмеченных проверок в
      модели совпадает с `grep -h -- "- \[ \] (вручную)" .scratch/*/issues/*.md | wc -l`; числа — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/manual-checks.test.ts` — разбор.
- `test/contract/workflow-reader.test.ts` — поле в модели.
- `test/unit/palette-commands.test.tsx` — группа палитры.
- Сначала красный: test разбора на нынешнем коде (модуля нет).
- Мутанты: брать `(вручную)` из любого раздела; показывать отмеченные; терять продолжение строки.
  Каждый краснит свой test.

## Где в коде

- `src/shared/workflow/manual-checks.ts`
- `src/shared/workflow/types.ts`
- `src/main/workflow/reader.ts`
- `src/renderer/palette/commands.ts`
- `test/unit/manual-checks.test.ts`
- `test/unit/palette-commands.test.tsx`
- `test/contract/workflow-reader.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/palette/CommandPalette.tsx`, `src/renderer/palette/groups.ts`,
`src/renderer/find/canvas-requests.ts`, `harness/bin/epic-status`.

## Вне скоупа

- Отметка проверки из worfy (запись в Ticket) — ADR-0002.
- Бейдж «N ручных» на Node-е Ticket-а или рамке Epic-а — если владелец захочет, отдельный Ticket.
- `epic-status` Harness: поле добавляется только в модель worfy, Harness не меняется.

## Риски

- Пункты, где `(вручную)` стоит не первым словом, не попадут. Это правило формата Ticket-ов; если
  исполнитель найдёт такие в `.scratch/`, он перечисляет их в «Итог», файлы не правит.

## Итог

—
