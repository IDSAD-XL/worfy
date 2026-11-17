# Code story — worfy-polish 121: e2e test-ы, зависящие от даты: фиксированное время для `new-product-session` и `limits-vendors`, обход `test/e2e`

Kind: pr · Epic: worfy-polish · Ticket: 121 · PR: - · Language: ru

## 1. Что было не так

Два e2e test-а брали время fixture-а от часов машины и краснили `main` без изменения кода: автоархив снимал Session
Node `new-product-session`, а имя дня недели сброса меняло ширину секции Limits в `limits-vendors`. Часы main
процесса в e2e задать было нельзя: автоархив и Limits брали `Date.now` при создании. Обход `test/e2e` нашёл ещё
test-ы с тем же риском: Month в `work-track` (красный 1-го числа нескольких месяцев), Run history ночного Run-а
(строки «gate logs deleted» с 2026-11-18), ширина toolbar по дню недели.

- Требование: [Что происходит](../issues/121-e2e-test-ы-зависящие-от-даты-фиксированное-время.md#что-происходит)

## 2. Один источник «сейчас» для main

Code: `src/main/clock.ts:19-42` · key lines: 22, 29, 41

```ts
export function clockFrom(given: string | undefined, real: () => number = machine): () => number {
  if (given === undefined || given === '') return real
  const start = Date.parse(given)
  if (Number.isNaN(start)) throw new Error(`WORFY_NOW is not a date: ${JSON.stringify(given)}. Give an ISO date such as 2026-06-15T09:00:00.000Z, or unset it.`)
  const offset = start - real()
  return () => real() + offset
}

/** main's clock for this run: WORFY_NOW counts in a dev run only. */
export function mainClock({ packaged, env }: { packaged: boolean; env: NodeJS.ProcessEnv }): () => number {
  return clockFrom(packaged ? undefined : env.WORFY_NOW)
}

let current: () => number = machine

/** Called once by src/main/index.ts with mainClock(), before anything reads appNow(). */
export function setAppClock(clock: () => number): void {
  current = clock
}

/** Now, in ms, by main's clock. */
export function appNow(): number {
  return current()
}
```

- Что делает: часы машины, а в dev-запуске с `WORFY_NOW` — часы, которые стартуют с названного момента и идут дальше
  вместе с часами машины. Упакованный worfy.app переменную не читает; неверная дата останавливает старт.
- Почему здесь: Ticket просит один источник «сейчас» для main, который e2e задаёт до старта, — одна функция, без
  второго пути; файл назван в «Где в коде» как новый. Проверка `app.isPackaged` повторяет уже принятое правило
  `ELECTRON_RENDERER_URL` (`src/main/window.ts`): переключатель для test-ов действует только в dev-запуске.
- Без него: test задаёт дату fixture-а, но автоархив и Limits сравнивают её с сегодняшним днём, и test снова
  зависит от даты запуска.
- Требование: [Что делаем, п. 1](../issues/121-e2e-test-ы-зависящие-от-даты-фиксированное-время.md#что-делаем)
- Риски и пробелы test-ов: часы идут, а не стоят: test-у с долгими шагами «сейчас» уходит вперёд так же, как на
  часах машины. Остальной main (timer-ы, timeout-ы, время в UI) остаётся на `Date.now`, и в e2e с `WORFY_NOW` эти
  два времени расходятся; тикетные test-ы на это не опираются.

## 3. Автоархив берёт часы main, а не свои

Code: `src/main/layout/archive.ts:302-306` · key lines: 305

```ts
  private readonly now: () => number

  constructor(private readonly deps: AutoArchiveDeps) {
    this.now = deps.now ?? appNow
  }
```

- Что делает: архиватор без своих часов (как его создаёт `src/main/index.ts`, где `now: Date.now` убран) судит о
  простое Session по `appNow`. Так же по умолчанию берут `appNow` `LayoutStore` (часы `touchedAt`), `LimitsTracker`,
  `LimitsRefresher`, Codex poll (`codexLimitsPart`) и `FlightRecorder`.
- Почему здесь: Ticket называет `src/main/layout/archive.ts` и `src/main/agent/limits.ts` «только если меняется
  способ получить now»; значение по умолчанию в самом классе делает связь проверяемой unit-test-ом без запуска
  `index.ts`. `LayoutStore`, Codex poll и `FlightRecorder` в «Где в коде» не названы: первые два — второй источник
  времени тех же правил, `FlightRecorder` — ради Run history из обхода.
- Без него: `WORFY_NOW` дошёл бы до одного места, а `touchedAt` и время записи Limits оставались бы на часах
  машины.
- Требование: [Готово, когда](../issues/121-e2e-test-ы-зависящие-от-даты-фиксированное-время.md#готово-когда)
- Риски и пробелы test-ов: связь с `LimitsRefresher`, `LayoutStore` и `FlightRecorder` не покрыта unit-test-ом
  (покрыты автоархив, `LimitsTracker` и Codex poll); их проверяют e2e Run history и Limits.

## 4. Transcript `new-product-session` моложе порога относительно фиксированной даты

Code: `test/e2e/new-product-session.spec.ts:105-105` · key lines: 105

```ts
  const at = new Date(NOW - 60_000).toISOString()
```

- Что делает: записи transcript-а на минуту старше `NOW`, а main запущен с `WORFY_NOW = NOW`: автоархив видит
  простой в минуту при любом дне запуска.
- Почему здесь: Ticket называет spec и просит время записей моложе порога автоархива относительно фиксированной даты.
- Без него: через 24 h дата fixture-а уходит под порог автоархива (ADR-0076), и Node `product-1` пропадает с
  Canvas — эпизод polish 97.
- Требование: [Что делаем, п. 2](../issues/121-e2e-test-ы-зависящие-от-даты-фиксированное-время.md#что-делаем)
- Риски и пробелы test-ов: окно в этом test-е идёт по часам машины: ничего, что test проверяет, от них не зависит.

## 5. Окно на тех же часах, что main

Code: `test/e2e/helpers.ts:1275-1279` · key lines: 1276, 1277

```ts
export async function pinWindowClock(window: Page, at: number): Promise<void> {
  await window.clock.install({ time: at })
  await window.reload()
  await expect(window.getByTestId('app-shell')).toBeVisible()
}
```

- Что делает: `limits-vendors` даёт тот же момент main-у и окну (`pinWindowClock`: Playwright clock и перезагрузка окна, чтобы
  первый кадр уже читал эти часы); сброс 7-дневного окна — среда (`wednesdayReset`). Month в `work-track` —
  полдень 17-го числа в окне и в stub-е; Run history ночного Run-а — main на 2026-11-10; `toolbar` и
  `codex-hooks-step` — сброс в среду.
- Почему здесь: Ticket называет `helpers.ts`; Playwright clock окна — существующий механизм
  (`test/e2e/session-view.spec.ts`), Ticket просит взять его для renderer-а.
- Без него: renderer считал бы свежесть `limits.json` по часам машины, и данные фиксированной даты
  выглядели бы устаревшими.
- Требование: [Что делаем, п. 1](../issues/121-e2e-test-ы-зависящие-от-даты-фиксированное-время.md#что-делаем)
- Риски и пробелы test-ов: Playwright clock подменяет и timer-ы окна; время идёт само, но анимации идут на
  подменённых часах. Локальный e2e запрещён: e2e проверены только в CI.

## 6. Как проверено

`node scripts/vitest-electron.mjs test/unit/main-clock.test.ts` — сначала красный (модуля нет, затем `this.deps.now is
not a function` и `receivedAt` с часов машины), после правки exit 0. `pnpm lint`, `pnpm typecheck`, `pnpm test` —
exit 0. e2e — в CI на PR и во временном workflow со сдвинутыми вперёд часами runner-а (Evidence тикета).

## Проверить себя

1. Почему часы, заданные `WORFY_NOW`, идут дальше, а не стоят на одном моменте?
   - Ответ: смещение от часов машины прибавляется к каждому чтению, так что timer-ы и сравнения «прошло N минут»
     в main ведут себя как обычно; стоящие часы остановили бы всё, что ждёт времени.
   - Строки: `src/main/clock.ts:23-24`
2. Что сделает упакованный worfy.app, если у пользователя в окружении есть `WORFY_NOW`?
   - Ответ: ничего: `mainClock` отдаёт часы машины, когда `packaged` истинно.
   - Строки: `src/main/clock.ts:29`
3. Зачем `pinWindowClock` перезагружает окно после установки часов?
   - Ответ: renderer читает время при первом рендере (`useNow` начинает с `Date.now`); без перезагрузки первый кадр
     посчитал бы свежесть Limits по часам машины.
   - Строки: `test/e2e/helpers.ts:1276-1277`

## 7. Что нашёл review и что осталось

> VERIFIED
>
> PR #1939 (worfy-polish 121: date-dependent e2e tests get a fixed date), head 3930e29c5fb7151320d567989836b8c623c0bdf1. Round 1 of 3.
> Lens: correctness and safety of the new main-process clock (src/main/clock.ts), and test coverage.
>
> ## Must fix
>
> None. Nothing high or medium.
>
> ## Left as is (low)
>
> 1. Tests do not cover three of the six switched defaults.
>    - Where: src/main/layout/store.ts:371 (LayoutStore), src/main/agent/limits-usage.ts:86 (LimitsRefresher), src/main/flight-recorder/service.ts:269 (FlightRecorder).
>    - What happens: if any of the three goes back to `Date.now`, test/unit/main-clock.test.ts and test/unit/codex-limits.test.ts still pass (mutants m6-m8 below, exit 0).
>    - The Code story, step 3, says e2e covers them. That does not hold for LayoutStore. new-product-session pins main's clock to 2026-06-15, which is in the past. With the mutant, `touchedAt` would be written by the machine clock, so it lies in the future of main's clock. `idleSessions` (archive.ts:156) then keeps the Node, and the test still passes. I reasoned this through and did not run it, because local e2e is not allowed.
>    - FlightRecorder: the flight-recorder e2e catches a revert only once the machine date is past 2026-11-18.
>    - Fix: add one assertion per class to main-clock.test.ts. For example, a LayoutStore touch records the pinned time, and LimitsRefresher.refreshIfOlder judges age by the pinned time. Or correct the story's claim.
> 2. With WORFY_NOW set, the Limits read two clocks.
>    - Two places still stamp `receivedAt` with the machine's time: Codex's live `account/rateLimits/updated` uses `Date.now()` (src/main/vendors/codex/session.ts:361, a line outside the diff), and the status line file uses its modification time (src/main/agent/limits.ts:215).
>    - The tracker and the Codex poll now stamp with `appNow`. `mergeLimits` (src/shared/agent/limits.ts:256) keeps the update with the newer `receivedAt`. So in a run pinned to the past, those two sources always win and never look stale.
>    - No current e2e test exercises this. The ticket's summary («Итог») and the comment in clock.ts describe what stays on `Date.now` as "timers, timeouts, UI times". These two are neither.
>    - Fix: pass `appNow()` at session.ts:361, or name both in the clock.ts comment.
> 3. An invalid WORFY_NOW blocks the dev process instead of making it exit.
>    - The throw happens at the top level of src/main/index.ts:69.
>    - Per src/main/diagnostics/uncaught-stderr.ts, the stack goes to stderr and then Electron's modal error box blocks the process. An e2e launch would hang until its timeout. It does not end with an exit code.
>    - This affects dev runs only. The project has `reportStartupFailure` (src/main/startup-failure.ts) if a clean stop is wanted.
>
> ## Safety (point 1 of the brief)
>
> - WORFY_NOW is read in one place, `mainClock` (clock.ts:29), and only when `packaged` is false.
> - The only caller passes `app.isPackaged` (index.ts:69). So only unpacked runs read it: `pnpm dev`, and the `out/` bundle the e2e tests start. A packaged or Stable worfy.app ignores it, and mutant m2 shows a unit test guards this.
> - The clock is set before any reader, and readers capture the `appNow` function, not a value. So constructing objects at import time is safe.
> - The archive compares `appNow` with transcript record timestamps (registry.ts:557 `lastAt`), not file modification times. The fixture times follow WORFY_NOW, so the shift is consistent in e2e.
> - The other `Date.now` defaults are outside the ticket's rules: Trash, image sweep, process-start cache, GithubReader (FlightRecorder passes its own clock in), gate-logs (gets `now`).
>
> ## e2e dates (point 2 of the brief)
>
> - new-product-session, limits-vendors, work-track (first test), flight-recorder and flight-recorder-detail (night Run): the data and main's clock now come from a fixed date.
> - Remaining `Date.now()` / `new Date()` calls are only in parts that are left unpinned and recorded in «Итог»: the live Run (flight-recorder.spec.ts:513), the 2nd and 3rd work-track tests (:317), and the stub's offset (:116-118).
> - toolbar and codex-hooks-step only move the weekly reset to a Wednesday. The reset line shows a weekday by window kind (shared/agent/limits.ts:383), so the width is stable.
> - The daylight-saving and midnight items left in «Итог» are reasonable: GitHub runners run in UTC, and the windows are seconds wide.
>
> ## Checks
>
> - Unit tests in the worktree: `node scripts/vitest-electron.mjs run test/unit/main-clock.test.ts test/unit/codex-limits.test.ts` exit 0. The script already adds `run`, so this ran 17 files: 600 passed, 8 skipped.
> - The same two files in a /tmp copy: exit 0, 67 passed.
> - `pnpm lint` exit 0. `pnpm typecheck` exit 0. `pnpm exec playwright test --list` exit 0 (554 tests). No local e2e was run.
> - `gh pr checks 1939` exit 0. All checks pass; ci-ok run 43987987519 has headSha 3930e29c5.
> - `git diff --stat origin/main...HEAD -- .github` is empty.
> - Shifted-clock run 43986230457 (headSha 87c46a09a, an ancestor of HEAD): success. `sudo date` set the runner to Fri 2026-11-27 10:00 UTC and Tue 2026-12-01 10:00 UTC; each job ran the 7 specs, 16 passed.
> - `git diff 87c46a09a HEAD` touches only the workflow file and the ticket/story, so the code in that run equals the head code.
> - Evidence SHAs 00b7ab38f, 87c46a09a and c4c116e16 are ancestors of HEAD.
> - story-check: exit 2, with only "Ticket: 121 is not two digits" (the known 3-digit issue). 4 fragments match the head. The story's text holds, except the e2e-coverage claim in low item 1.
>
> ## Mutants (isolated /tmp copy, node_modules symlinked; the two unit files)
>
> - m1 `mainClock` ignores WORFY_NOW: caught (1 failed).
> - m2 packaged run reads WORFY_NOW: caught (1 failed).
> - m3 AutoArchiver default back to `Date.now`: caught (1 failed).
> - m4 LimitsTracker default back to `Date.now`: caught (2 failed).
> - m5 codexLimitsPart default back to `Date.now`: caught (1 failed).
> - m9 invalid date accepted: caught (1 failed).
> - m6 LimitsRefresher, m7 LayoutStore, m8 FlightRecorder defaults back to `Date.now`: survived (exit 0). See low item 1.
> - The copy has been deleted. No background processes of mine are left.

Code: `src/main/layout/store.ts:371-371` · key lines: 371

```ts
    this.now = options.now ?? appNow
```

Code: `src/main/agent/limits-usage.ts:86-86` · key lines: 86

```ts
    this.now = options.now ?? appNow
```

Code: `src/main/flight-recorder/service.ts:269-269` · key lines: 269

```ts
    this.now = options.now ?? appNow
```

Code: `src/main/vendors/codex/session.ts:361-361` · key lines: 361

```ts
    const event = codexLimitsEvent(params, Date.now())
```

Code: `src/main/agent/limits.ts:215-215` · key lines: 215

```ts
    this.record(limitUpdatesFromStatusline(value, Math.round(modified)))
```
