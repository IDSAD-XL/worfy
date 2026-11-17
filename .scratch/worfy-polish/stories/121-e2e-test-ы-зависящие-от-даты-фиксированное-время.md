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
