# Code story — worfy-polish 129: Flaky test «gh hangs the whole Run» на Windows: вторая гонка последнего чтения PR после 124

Kind: pr · Epic: worfy-polish · Ticket: 129 · PR: - · Language: ru

## 1. Что было не так

Push run 44471611202 на `main` eb669a653 (#2030) упал в job-е `windows (2/3) / full-suite`: contract test «gh hangs
the whole Run» не дождался последнего чтения PR (`Error: timed out waiting for the last read of the PRs`). #2030
Autopilot не трогает, и тот же файл зелёный на том же коде в четырёх следующих run-ах — это flaky test, а не ошибка
#2030. Красный `main` останавливает merge PR с кодом, поэтому test уходит в карантин на Windows, а причину ищет
этот Ticket.

- Требование: [Что происходит](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-происходит)

## 2. Запись карантина: только win32, на 14 дней, с владельцем

Code: `test/quarantine/autopilot-faults-gh-hangs-whole-run.json:2-12` · key lines: 2, 7, 8, 10, 12

```json
  "kind": "quarantine",
  "runner": "vitest",
  "file": "test/contract/autopilot-faults-github.test.ts",
  "test": "Autopilot faults on the GitHub side (worfy-faults ticket 04) > gh hangs the whole Run: the Waves go on, no narrow-round, the stop waits END_READ_MS at most, and no hung gh is left",
  "reason": "Red main: push run 44471611202 on main eb669a653 (#2030, which does not touch Autopilot), job windows (2/3) / full-suite: test/contract/autopilot-faults-github.test.ts:161 failed with \"Error: timed out waiting for the last read of the PRs\". The same file passed in windows (2/3) with the same code in runs 44550103039 (job 135651372486), 44547578992, 44535810835 and 44535483050, so it is flaky. This is a second race after the fix of worfy-polish 124 (PR #1985), still in the wait for the last read of the PRs on a slow Windows runner; the cause is not established yet. No limit is raised.",
  "platforms": [
    "win32"
  ],
  "owner": "worfy-polish 129",
  "since": "2026-11-19",
  "until": "2026-12-03"
```

- Что делает: на Windows test пропускается до 2026-12-03 включительно, строка на stderr и `::warning` в CI называют
  владельца и дату; на Mac и Linux test идёт как раньше. Полное имя — `describe > it`, как его печатает vitest.
- Почему здесь: правила карантина — шапка `test/quarantine.ts`: запись в `test/quarantine/<id>.json`, срок не
  дальше 14 дней от `since`, у записи — Ticket-владелец.
- Без него: `ci-ok` на `main` и на PR красный, пока на Windows runner-е выпадает эта гонка.
- Требование: [Что происходит](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-происходит)
- Риски и пробелы test-ов: пока запись есть, сценарий «gh висит весь Run» на Windows не проверен; на Mac и Linux он
  проверяется. После `until` запись перестаёт действовать, и `test/unit/quarantine.test.ts` краснеет над ней.

## 3. Test объявлен через `quarantined`, тело не тронуто

Code: `test/contract/autopilot-faults-github.test.ts:162-162` · key lines: 162

```ts
  quarantined('autopilot-faults-gh-hangs-whole-run')('gh hangs the whole Run: the Waves go on, no narrow-round, the stop waits END_READ_MS at most, and no hung gh is left', async () => {
```

- Что делает: `quarantined('<id>')` вместо `it`: helper читает запись и пропускает test только там, где она
  действует; имя и тело test-а прежние.
- Почему здесь: Ticket называет этот файл; без пометки в самом test-е запись ничего не пропускает.
- Без него: запись есть, а test на Windows всё равно запускается и краснит job.
- Требование: [Что делаем, п. 3](../issues/129-flaky-gh-висит-на-windows-вторая-гонка-последнего-чтения-pr.md#что-делаем)
- Риски и пробелы test-ов: имя в записи должно совпасть с полным именем test-а (`describe > it`); если не совпадёт,
  helper ничего не пропустит, и на Windows test пойдёт как раньше. Это проверит только Windows job этого PR: на Mac
  запись не действует.

## 4. Как проверено

- `pnpm vitest run test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts test/unit/e2e-no-spawn-on-load.test.ts test/contract/ci-scope-e2e.test.ts` — exit 0.
- `pnpm vitest run test/contract/autopilot-faults-github.test.ts` на Mac — exit 0, 5 test-ов прошли (на darwin
  запись не действует).
- gate fast (lint, typecheck, test) — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему #2030 не откатили, хотя push run на нём красный?
   - Ответ: test flaky: тот же файл зелёный в `windows (2/3)` на том же коде в четырёх следующих run-ах, а #2030
     Autopilot не трогает.
   - Строки: `test/quarantine/autopilot-faults-gh-hangs-whole-run.json:6-6`
2. Запускается ли этот test на Mac, пока запись есть?
   - Ответ: да: `platforms` — только `win32`, на darwin helper запускает test под его именем.
   - Строки: `test/quarantine/autopilot-faults-gh-hangs-whole-run.json:7-9`
