# Code story — worfy-polish 134: Health: статус «Checking…» показан один раз, на кнопке

Kind: pr · Epic: worfy-polish · Ticket: 134 · PR: - · Language: ru

## 1. Что было не так

Пока шла проверка Machine, в Settings → Health (и в диалоге First run) «Checking…» было написано дважды в одной строке:
chip-итог слева под заголовком и кнопка «Check again» справа, которая сама пишет «Checking…» со spinner-ом. Владелец
назвал это дублем статуса.

- Требование: [Что происходит](../issues/134-health-статус-checking-показан-один-раз.md#что-происходит)

## 2. Итог пуст, пока идёт проверка

Code: `src/renderer/shell/FirstRunChecks.tsx:545-545` · key lines: 545

```tsx
  const summary = checking || report === null ? '' : failed + warned + unchecked === 0 ? 'Everything is ready' : counts.filter(Boolean).join(' · ')
```

- Что делает: текст итога пустой и до первой проверки, и пока идёт любая проверка; иначе — «Everything is ready» или
  счёт строк не в OK.
- Почему здесь: Ticket называет `FirstRunChecks.tsx`; Health и диалог First run берут chip-итог из этого компонента,
  поэтому правка одна на оба места. Почему остаётся кнопка, а не chip, — запись «Решено без владельца, подтвердить» в
  «Итог» Ticket-а: кнопка — control.
- Без него: chip слева снова пишет «Checking…» рядом с кнопкой.
- Требование: [Что делаем, п. 1–2](../issues/134-health-статус-checking-показан-один-раз.md#что-делаем)
- Риски и пробелы test-ов: во время повторной проверки прошлый результат тоже не показан — это выбор Ticket-а (результат
  устарел); строка над списком на это время короче на chip.

## 3. Пустой итог — нет chip-а; вид `running` для итога больше не нужен

Code: `src/renderer/shell/FirstRunChecks.tsx:563-567` · key lines: 565, 566

```tsx
      {children({
        summary:
          summary !== '' ? (
            <Chip {...FIRST_RUN_CHIP[failed > 0 ? 'fail' : warned > 0 ? 'warn' : unchecked > 0 ? 'unknown' : 'ok']} icon={null} data-testid="first-run-summary" label={summary} />
          ) : null,
```

- Что делает: при пустом тексте часть `summary` — `null`, и раскладка (`HealthSection.tsx`, `FirstRun.tsx`) ничего не
  рисует. Вид chip-а берётся только из результата; ветка `checking ? 'running'` удалена, она стала недостижимой.
- Почему здесь: не записано сверх Ticket-а; это то же место, где chip собирался и раньше.
- Без него: ветка вида `running` осталась бы мёртвым кодом.
- Требование: [Что делаем, п. 2](../issues/134-health-статус-checking-показан-один-раз.md#что-делаем)
- Риски и пробелы test-ов: e2e ждут конца проверки через `not.toHaveText('Checking…')` на этом chip-е. Playwright
  повторяет такое ожидание, пока элемента нет, поэтому оно теперь ждёт chip с итогом; e2e файлы не менялись.

## 4. Test: во время «Check again» chip-а нет, после ответа — итог

Code: `test/unit/settings-health.test.tsx:955-966` · key lines: 958, 964, 965

```tsx
  it('"Check again": the button says "Checking…" with a spinner and is off, every row chip says "Checking…", the summary chip goes; the answer brings the labels back', async () => {
    renderApp()
    const health = await openHealth()
    expect(summaryOf(health)).toBe('3 failed · 2 warnings')
    const pending = later()
    handlers['firstRun.checks'] = () => pending.answer
    fireEvent.click(within(health).getByRole('button', { name: 'Check again' }))

    // The running check shows once, on the button: the summary chip says only a result (worfy-polish ticket 134).
    expect(summaryOf(health)).toBeNull()
    const busy = within(health).getByRole('button', { name: 'Checking…' })
    expect(isInactive(busy)).toBe(true)
```

- Что делает: до нажатия chip пишет итог, во время проверки chip-а нет, а кнопка — «Checking…»; дальше в том же test-е
  после ответа chip снова пишет «3 failed · 2 warnings». Остальные места файла, где ждали «Checking…» на chip-е (Health
  при открытии, диалог First run, общая проверка двух мест), теперь ждут `null`.
- Почему здесь: Ticket, «Готово, когда», п. 1, называет этот файл.
- Без него: возврат «Checking…» в chip ни один unit test не заметил бы.
- Требование: [Готово, когда](../issues/134-health-статус-checking-показан-один-раз.md#готово-когда)
- Риски и пробелы test-ов: jsdom не видит раскладку — вид строки проверен снимками Playwright в обеих темах вне
  репозитория.

## 5. Как проверено

`test/unit/settings-health.test.tsx` на старом коде — 7 красных, после правки — зелёный.
`pnpm test:e2e test/e2e/settings-health.spec.ts test/e2e/first-run.spec.ts` — 13 passed, exit 0. Снимки Playwright
своей сборки с fixture-данными: во время проверки слева chip-а нет, справа «Checking…»; после — chip «1 failed · 2
warnings» и «Check again».

## Проверить себя

1. Почему во время повторной проверки chip не показывает прошлый результат?
   - Ответ: прошлый результат устарел, пока идёт новая проверка; Ticket оставляет chip только для итога текущей
     проверки, а идущую проверку показывает кнопка.
   - Строки: `src/renderer/shell/FirstRunChecks.tsx:545-545`
2. Почему e2e, которые ждут `not.toHaveText('Checking…')` на chip-е, не стали проходить сразу?
   - Ответ: chip-а нет, а отрицательное ожидание Playwright на отсутствующем элементе не выполняется и повторяется, пока
     не появится chip с итогом.
   - Строки: `src/renderer/shell/FirstRunChecks.tsx:563-567`

## 6. Что нашёл review и что осталось

> VERIFIED — polish 134 (Health shows «Checking…» once), head 8b3ab410d3a490f1c4fe55970bda5345967ac22d
>
> Gate (depth medium): verifier (lens: implementer's report) VERIFIED, no findings; reviewer (lens: correctness) no defect, two low.
>
> - Verifier: files_changed = diff (6 files); FirstRunChecks.tsx:545, 563-567 as claimed (summary empty while checking or before the first report; the summary chip's `running` variant gone; Health and First run share the component); settings-health + first-run-dialog unit 56 passed; a mutant of its own (summary back during a check with a report) → 3 failed; e2e settings-health.spec.ts + first-run.spec.ts 13 passed under the e2e lock; gate fast `[gate] green (fast)`; story-check ok; the four screenshots show the claim (no chip + «⟳ Checking…» button while checking; «1 failed · 2 warnings» + Check again after), no machine/host/user names.
> - Reviewer: first check, re-check, failed and discarded checks, a check that never answers — all behave; Chip has no aria-live, so no announcement lost; Close in First run unaffected; `not.toHaveText('Checking…')` on an absent chip keeps waiting (Playwright 1.63 isNot semantics).
> - ci-ok pass on the head.
>
> Consider [low]:
> - docs/design/F-SPEC.md:153 still says the First run header summary chip shows «Checking…» (working) — align it with this decision.
> - FirstRunChecks.tsx:545 / HealthSection.tsx:28-30 — a leftover action message shifts left by the chip's width during a re-check and back after.
> - Owner question: each row chip still says «Checking…» during Check again (FirstRunChecks.tsx:182, 264); if the owner's screenshot showed the rows, that repeat remains.

Code: `docs/design/F-SPEC.md:153-153` · key lines: 153

```md
  - **Header**: the title "First run" (20px, semibold), under it one line in 12px secondary text, never wrapped (cut with an ellipsis in a narrow window): "worfy checks this Mac for itself and the Harness. Nothing changes until you confirm it." (on Windows "this PC") Right of the title, the summary chip: "Checking…" (working), "N failed · M warnings" (the fail colors when anything failed, else the warning colors), "Everything is ready" (ready). 1px border under the header.
```
