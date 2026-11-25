# Code story — worfy-polish 143: Windows exception трёх contract test-ов, красных на PR #2194

Kind: pr · Epic: worfy-polish · Ticket: 143 · PR: - · Language: ru

## 1. Что было не так

CI run 45598235951 PR #2194 (правило архива и кнопка Archive у Session Node) красный только в job-е
`windows (1/3) / full-suite` на трёх contract test-ах: двух test-ах `endDescendants` Terminal-а на Windows и test-е
Autopilot «the silence of a background implementer after the turn stays background-stalled, not turn-hung». PR не
трогает ни `src/main/terminal`, ни `src/main/autopilot`. По CI run-ам 2026-11-23…25 оба test-а Terminal-а
прошли в 43 из 44 job-ов Windows, test Autopilot на Windows красный с первой попытки в 10 из 26 job-ов (8 прошли на
повторе), на Linux и macOS — ни разу. Это flaky test-ы под нагрузкой, а правило проекта для test-а, красного только
на Windows, — Windows exception или починка; ручной повтор job-а — не путь к merge.

- Требование: [Что происходит](../issues/143-windows-exception-трёх-contract-test-ов.md#что-происходит)

## 2. Запись Windows exception

Code: `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json:7-12` · key lines: 8, 10, 11, 12

```json
  "platforms": [
    "win32"
  ],
  "owner": "worfy-windows 117",
  "since": "2026-11-25",
  "until": "2027-01-09"
```

- Что делает: пропускает test только на `win32` и только в блокирующих run-ах (`pnpm test`, gate, CI), до
  2027-01-09; имя test-а и строка на stderr говорят «windows exception: worfy-windows 117». Поле `reason` выше этих
  строк хранит evidence: run-ы и job-ы красных, FLAKY и зелёных job-ов и гипотезу причины. Две другие записи —
  `terminal-windows-end-descendants-under-shell.json` и `terminal-windows-end-descendants-pid-reused.json` —
  того же вида.
- Почему здесь: Ticket называет три файла записей; `platforms` ровно `["win32"]`, owner ровно `worfy-windows 117`
  и срок до 45 дней от `since` требует `parseEntry` в `test/quarantine.ts` (решение владельца Q9 2026-10-31).
- Без него: каждый PR с кодом ловит эти flaky test-ы в job-е Windows, и `ci-ok` красный без вины PR.
- Требование: [Что делаем, п. 1](../issues/143-windows-exception-трёх-contract-test-ов.md#что-делаем)
- Риски и пробелы test-ов: пока запись действует, CI на Windows эти test-ы не гоняет, и настоящая поломка
  `endDescendants` или таймера `background-stalled` на Windows до 2027-01-09 пройдёт незамеченной; на Linux и
  macOS test Autopilot по-прежнему идёт. Гипотезы причины в `reason` не проверены.

## 3. Метка у test-ов Terminal-а

Code: `test/contract/terminal-windows.test.ts:287-287` · key lines: 287

```ts
  quarantined('terminal-windows-end-descendants-under-shell')('endDescendants ends what is under the shell and leaves the shell', async (context) => {
```

- Что делает: объявляет test через `quarantined('<id>')` вместо `it`; helper находит запись по id и пропускает
  test только там, где она действует. Тело test-а не изменилось. Так же помечен test на строке 299.
- Почему здесь: `test/unit/quarantine.test.ts` краснеет на записи без метки `quarantined('<id>')` у названного
  test-а; Ticket называет строки 287 и 299.
- Без него: запись есть, а test идёт как раньше.
- Требование: [Что делаем, п. 2](../issues/143-windows-exception-трёх-contract-test-ов.md#что-делаем)
- Риски и пробелы test-ов: эти test-ы и так идут только на Windows (`describe.runIf(WINDOWS)`); на Mac пропуск не
  проверить, его проверяет только job Windows CI.

## 4. Метка у test-а Autopilot

Code: `test/contract/autopilot-faults-ladder.test.ts:369-369` · key lines: 369

```ts
  quarantined('autopilot-faults-background-stalled-not-turn-hung')('the silence of a background implementer after the turn stays background-stalled, not turn-hung', async () => {
```

- Что делает: то же для test-а Autopilot; `quarantined` импортирован из `../quarantine` (строка 35).
- Почему здесь: Ticket называет строки 35 и 369.
- Без него: test краснеет на Windows примерно в каждом третьем job-е с первой попытки.
- Требование: [Что делаем, п. 2](../issues/143-windows-exception-трёх-contract-test-ов.md#что-делаем)
- Риски и пробелы test-ов: на Mac test идёт и зелёный; на Windows его не гоняет никто, пока запись действует.

## 5. Что сознательно не меняли

- Timeout-ы и пределы: ни `DESCENDANTS_TIMEOUT_MS` = 3000 в `src/main/terminal/windows-pty.ts`, ни предел ожидания
  `until` в test-е Autopilot (правило владельца: timeout-ы по одному не поднимают).
- Код продукта: `src/` не тронут. Починка test-а Autopilot (ждать, пока run поставит timer `background-stalled`) и
  поведение `endDescendants` под нагрузкой — в разделе «Вне скоупа» Ticket-а.

## 6. Как проверено

- CI run-ы 2026-11-23T21:14Z…2026-11-25T11:51Z: `gh run list` workflow `CI` (119 run-ов), log каждого job-а
  `windows (N/3) / full-suite` (305), `linux-tests` и `macos-tests` просмотрен на строки этих test-ов; таблица —
  в Ticket-е.
- `node scripts/vitest-electron.mjs test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts
  test/contract/gate-failures-report.test.ts test/contract/autopilot-faults-ladder.test.ts
  test/contract/terminal-windows.test.ts` — exit 0 (64 passed, 14 skipped).

## Проверить себя

1. Почему для этих test-ов — Windows exception, а не quarantine?
   Ответ: они красные только на Windows; у такого test-а своя запись — `"kind": "windows-exception"`, только
   `win32`, owner `worfy-windows 117`, срок до 45 дней, — а лимит quarantine (15 записей, 14 дней) остаётся для
   flaky test-ов на любой платформе.
   Строки: `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json:7-12`
2. Почему метка в файле test-а нужна вместе с записью?
   Ответ: пропускает test helper `quarantined('<id>')`, которым test объявлен; без него запись ничего не делает, и
   `test/unit/quarantine.test.ts` красный.
   Строки: `test/contract/terminal-windows.test.ts:287-287`
