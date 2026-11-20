# Code story — worfy-polish 132: Метка ручного пункта `(manual)` читается рядом с меткой Profile-а `вручную` в обеих копиях разбора

Kind: pr · Epic: worfy-polish · Ticket: 132 · PR: - · Language: ru

## 1. Что было не так

Ручной пункт раздела «Готово, когда» — пункт с меткой в скобках сразу после checkbox-а. Его доказывает только строка
Evidence `owner-check`, `screenshot` или `video`. Обе копии разбора (worfy и Harness) искали две метки: метку Profile-а и
старую русскую `вручную`. Profile worfy называет метку `вручную`, то есть ту же старую, и тогда копии искали одну метку.
Метку по умолчанию `manual` не искал никто. Пункт `- [ ] (manual) …` в Ticket-е worfy считался обычным: строка
`test-run` его «доказывала», Command palette его не показывала, `ticket evidence` писал `manual: false`.

- Требование: [Что происходит](../issues/132-метка-manual-читается-рядом-с-вручную.md#что-происходит)

## 2. Одно правило меток в worfy

Code: `src/shared/workflow/doc-headings.ts:50-58` · key lines: 55, 56, 57

```ts
/**
 * The marks of a manual item to look for: the Profile's, the default `manual` and the old Russian one, without
 * repeats. The default is read whatever the Profile names, so a Ticket that writes `(manual)` is read the same in
 * every Project, and still is once the old Russian mark is no longer read.
 */
export function manualMarks(value: string): string[] {
  const given = value.trim() || DEFAULT_DOC_HEADINGS.manualMark
  return [...new Set([given, DEFAULT_DOC_HEADINGS.manualMark, OLD_DOC_HEADINGS.manualMark])]
}
```

- Что делает: возвращает метки ручного пункта: метку Profile-а (пустая — значит `manual`), `manual` и `вручную`, без
  повторов. `Set` хранит порядок вставки, поэтому метка Profile-а идёт первой.
- Почему здесь: Ticket называет `doc-headings.ts` и просит отдельную функцию для меток (п. 1 «Что делаем»). Старая
  `accepted` осталась для заголовков разделов: их Ticket не меняет.
- Без него: Profile с `вручную` не видит `(manual)`; после Ticket-а worfy-neutral 08 (уберёт старую русскую метку)
  разбор опирался бы только на метку Profile-а.
- Требование: [Что делаем, п. 1–2](../issues/132-метка-manual-читается-рядом-с-вручную.md#что-делаем)
- Риски и пробелы test-ов: метка Profile-а теперь не вытесняет `manual`. Profile с меткой `à la main` читает и
  `(manual)` — это новое поведение, test `manual-checks.test.ts` об этом исправлен. Пустая строка как метка Profile-а
  проверена только косвенно, через `docHeadings`.

## 3. Оба вызова в worfy берут правило

Code: `src/shared/workflow/evidence.ts:165-169` · key lines: 168

```ts
export function evidenceItems(markdown: string, headings: Pick<DocHeadings, 'doneSection' | 'manualMark'> = DEFAULT_DOC_HEADINGS): EvidenceItem[] {
  const pick = (value: string, fallback: string): string => value.trim() || fallback
  const done = sectionHeadings(accepted(pick(headings.doneSection, DEFAULT_DOC_HEADINGS.doneSection), OLD_DOC_HEADINGS.doneSection))
  const marks = manualMarks(headings.manualMark)
  const manual = new RegExp(`^\\((?:${marks.map(escapeRegExp).join('|')})(?:,[^)]*)?\\)`, 'u')
```

- Что делает: Chip «Evidence n/m» и матрица (через `evidenceItems`) строят шаблон ручного пункта из трёх меток.
  `manualChecks` (`src/shared/workflow/manual-checks.ts:24`) делает то же для строк ручных проверок Command palette.
- Почему здесь: Ticket называет оба вызова (`evidence.ts:168`, `manual-checks.ts:24`).
- Без него: функция из шага 2 никем не вызвана, поведение прежнее.
- Требование: [Что делаем, п. 1](../issues/132-метка-manual-читается-рядом-с-вручную.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы `evidence.test.ts` и `manual-checks.test.ts` проверяют Profile с `вручную` и с
  `manual`; оба были красными до правки.

## 4. То же правило в Harness

Code: `harness/lib/evidence.cjs:59-65` · key lines: 62, 63, 64

```js
/** The marks of a manual item: the profile's, the default `manual` and the old Russian one, without repeats. The
 * default is read whatever the profile names, so `(manual)` reads the same in every project, and still does once the
 * old Russian mark is no longer read (worfy's copy: manualMarks of src/shared/workflow/doc-headings.ts). */
function manualMarks(value) {
    const given = typeof value === "string" && value.trim() ? value.trim() : DEFAULTS.manualMark
    return [...new Set([given, DEFAULTS.manualMark, OLD_HEADINGS.manualMark])]
}
```

- Что делает: копия правила для `parseDoneSection`, которым `ticket evidence` и предупреждение `ticket done` читают
  пункты. Значение Profile-а может не быть строкой (поля нет в `profile.json`) — тогда берётся `manual`.
- Почему здесь: Ticket называет `harness/lib/evidence.cjs`; копий две, и contract test требует от них одинакового
  ответа.
- Без него: worfy видит пункт `(manual)` ручным, а `ticket evidence` — нет, и contract test расходится.
- Требование: [Что делаем, п. 1](../issues/132-метка-manual-читается-рядом-с-вручную.md#что-делаем)
- Риски и пробелы test-ов: `harness/bin/tests/ticket-evidence.test.sh` проверяет Profile с `manual_mark: "вручную"` на
  fixture-Ticket-е `ru/03-manual-marks.md`; contract test `evidence-rules-agree.test.ts` читает все fixture-Ticket-ы обеими
  копиями ещё и с меткой `вручную`. На Windows копию Harness проверяют job-ы Windows в CI.

## 5. Что сознательно не меняли

Заголовки разделов (`## Done when` рядом с `## Готово, когда`) читаются прежним правилом `accepted`: в них нет
расхождения (раздел «Вне скоупа» Ticket-а). 15 Ticket-ов с `(manual)` не переписаны: правило читает обе метки.

## 6. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0 (под временным HOME). `bash harness/bin/tests/ticket-evidence.test.sh`
— exit 0, 87 случаев. `node scripts/check-feature-docs.mjs` — exit 0. До правки четыре новых случая vitest и новый
случай shell test-а были красными.

## Проверить себя

1. Почему правило опирается на метку по умолчанию, а не только на старую русскую?
   - Ответ: старую русскую метку уберёт Ticket worfy-neutral 08; `manual` в списке есть всегда, поэтому `(manual)`
     читается и после этого, что бы ни назвал Profile.
   - Строки: `src/shared/workflow/doc-headings.ts:55-58`
2. Что изменится для Project-а, чей Profile называет свою метку, например `by hand`?
   - Ответ: кроме `(by hand)` ручными станут и `(manual)`, и `(вручную)`: метка Profile-а больше не заменяет метку по
     умолчанию, а добавляется к ней.
   - Строки: `harness/lib/evidence.cjs:62-65`
3. Почему у Harness своя функция, а не вызов worfy?
   - Ответ: правил две копии — в Harness и в worfy; их согласие проверяет contract test на общих fixture-Ticket-ах, и
     копия Harness повторяет правило worfy слово в слово.
   - Строки: `harness/lib/evidence.cjs:59-61`
