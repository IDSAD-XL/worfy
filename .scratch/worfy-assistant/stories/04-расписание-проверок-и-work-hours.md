# Code story — worfy-assistant 04: Расписание проверок и work hours

Kind: pr · Epic: worfy-assistant · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Assistant-у нужно регулярно проверять Slack и Jira, у каждого источника свой интервал, а ночью часть проверок
должна спать. В main не было ни одного общего планировщика: каждая периодическая работа заводит свой таймер. Окно
старта Autopilot-а знает только целые часы и часовой пояс процесса, без дней недели и нескольких окон. Никто не
догонял проверки после сна Mac и после перезапуска.

- Требование: [Что строить](../issues/04-расписание-проверок-и-work-hours.md#что-строить)

## 2. Когда идёт проверка

Code: `src/main/assistant/schedule/scheduler.ts:195-216` · key lines: 202, 203, 213, 215

```ts
  private dueOf(kind: CheckKind, entry: Entry, now: number): number | null {
    const settings = this.options.settings()
    const check = checkSettingsOf(settings, kind)
    if (!check.enabled) return null
    const startedAt = this.readMarks()[kind]?.startedAt
    const interval = check.intervalMinutes * MINUTE_MS
    // A start in the future (the clock was moved back) plan() has already brought to now.
    const due = startedAt === undefined ? null : startedAt + Math.round(interval * (1 + entry.spread))
    const moment = Math.max(due ?? now, now)
    if (!check.sleepOutsideWorkHours) return moment
    // A check that had to wait for work hours — it fell due outside them, or never ran — goes after their
    // start by its share of the spread, so the sleeping checks do not all go at the first millisecond. The
    // window's start, not `now`, anchors it: a plan made early in the window does not cut the spread short.
    const hours = workHoursOf(settings)
    const spread = (start: number): number => {
      const later = start + Math.round(interval * ((entry.spread + SCHEDULE_JITTER) / 2))
      return inWorkHours(later, hours) ? later : start
    }
    const windowStart = workWindowStartOf(moment, hours)
    if (windowStart === null) return spread(nextWorkHoursStart(moment, hours))
    return due === null || windowStart > due ? Math.max(moment, spread(windowStart)) : moment
  }
```

- Что делает: считает следующий запуск вида проверки. Выключен — никогда. Иначе последний старт плюс интервал с
  разбросом ±10 %; срок, который уже прошёл, сжимается до «сейчас». Если вид спит вне work hours и ждал их начала,
  он идёт после начала окна с задержкой от 0 до 10 % интервала по своему жребию; задержка считается от начала окна,
  а не от «сейчас».
- Почему здесь: Ticket требует реестр с интервалом и разбросом и сон отмеченных проверок вне work hours. Задержку
  после начала work hours попросило ревью PR (первый раунд). Числа — решения без владельца, они в «Итог» Ticket-а.
- Без него: все спящие проверки шли бы в одну миллисекунду 09:00; без привязки к началу окна чужой таймер в 09:01
  срезал бы задержку; без `Math.max(due ?? now, now)` проверка, пропущенная за два дня закрытого worfy, шла бы в
  07:00.
- Требование: [Решения](../issues/04-расписание-проверок-и-work-hours.md#решения)
- Риски и пробелы test-ов: соседние окна (09–12 и 12–18) дают в 12:00 новое начало окна, и проверка, которая ждала,
  снова получит задержку; test-а на это нет.

## 3. Один запуск за раз и догоняющая проверка

Code: `src/main/assistant/schedule/scheduler.ts:268-283` · key lines: 270, 274, 279, 281

```ts
  private plan(): void {
    this.clear()
    if (!this.started || this.asleep) return
    const now = this.options.now()
    let next = Number.POSITIVE_INFINITY
    for (const [kind, entry] of this.entries) {
      if (entry.running) continue
      // The clock was moved back past the last start: from now on that start is now, so the due time
      // stops sliding with the clock.
      const startedAt = this.readMarks()[kind]?.startedAt
      if (startedAt !== undefined && startedAt > now) this.mark(kind, { startedAt: now })
      const due = this.dueOf(kind, entry, now)
      if (due === null) continue
      if (due <= now) this.launch(kind, entry)
      else next = Math.min(next, due)
    }
```

- Что делает: стартует каждый вид, чей срок наступил, кроме тех, что ещё идут, и ставит один таймер на ближайший
  срок. Пока Mac спит (`asleep`) или планировщик остановлен, ничего не стартует. После `resume()` и после старта
  worfy пропущенный срок даёт один запуск. Старт в будущем (часы перевели назад) записывается как «сейчас».
- Почему здесь: Ticket требует защиту от двойного запуска, догоняющую проверку после сна и перезапуска, и чтобы
  пока Mac спит, проверок не было.
- Без него: проверка, которая идёт дольше интервала, запускалась бы второй раз от любого плана (таймер другого вида,
  смена настроек, пробуждение); после трёх часов сна шли бы восемнадцать проверок Slack подряд; после перевода часов
  назад срок уезжал бы вместе с часами.
- Требование: [Готово, когда](../issues/04-расписание-проверок-и-work-hours.md#готово-когда)
- Риски и пробелы test-ов: сон Mac в test-е — `suspend()` и `resume()` (или события `followPower`); настоящий
  `powerMonitor` проверяется только тем, что `src/main/index.ts` передаёт его в `startCheckScheduler`.

## 4. Предел одного запуска

Code: `src/main/assistant/schedule/scheduler.ts:224-237` · key lines: 226, 229, 234, 236

```ts
    let ended = false
    const end = (succeeded: boolean): void => {
      if (ended) return
      ended = true
      this.clearTimer(limit)
      if (succeeded) this.mark(kind, { succeededAt: now })
      entry.running = false
      entry.spread = this.draw()
      this.plan()
    }
    const limit = this.setTimer(() => {
      console.warn(`[assistant] the ${kind} check did not end in ${CHECK_RUN_TIMEOUT_MS / MINUTE_MS} minutes: counted as failed`)
      end(false)
    }, CHECK_RUN_TIMEOUT_MS)
```

- Что делает: запуск кончается один раз — ответом или пределом в 10 минут, что раньше. По пределу он считается
  упавшим: вид планируется заново, `since` остаётся на последнем успехе, поздний ответ старого запуска не учитывается.
- Почему здесь: ревью PR (первый раунд) нашло, что запуск, который не кончается, держит свой вид до перезапуска
  worfy. 10 минут — решение без владельца, оно в «Итог» Ticket-а.
- Без него: зависший вызов connector-а навсегда останавливал бы проверки своего источника.
- Требование: [Готово, когда](../issues/04-расписание-проверок-и-work-hours.md#готово-когда)
- Риски и пробелы test-ов: сам вызов планировщик не прерывает; если старый запуск всё же жив, он идёт параллельно
  новому.

## 5. Work hours по стенным часам своего пояса

Code: `src/shared/assistant/schedule/work-hours.ts:109-118` · key lines: 110, 116

```ts
export function inWorkHours(moment: number, hours: WorkHours): boolean {
  const wall = wallOf(moment, zoneOf(hours))
  const minute = Math.floor((((wall % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS)
  const today = weekdayOfWall(wall)
  const yesterday = dayBefore(today)
  return hours.windows.some((window) => {
    if (window.from < window.to) return hours.days.includes(today) && window.from <= minute && minute < window.to
    return (hours.days.includes(today) && minute >= window.from) || (hours.days.includes(yesterday) && minute < window.to)
  })
}
```

- Что делает: читает стенные часы пояса work hours через `Intl` и проверяет дни и окна. Окно, у которого конец раньше
  начала, идёт через полночь и принадлежит дню, в который началось: пятница 22:00–02:00 держит субботу 01:30.
- Почему здесь: Ticket просит обобщить окно старта Autopilot-а: дни недели, несколько окон, часовой пояс.
- Без него: work hours считались бы в поясе процесса, и смена пояса Mac сдвигала бы их.
- Требование: [Что строить, п. 2](../issues/04-расписание-проверок-и-work-hours.md#что-строить)
- Риски и пробелы test-ов: test-ы берут Europe/Kyiv, America/New_York и Asia/Tokyo; пояса с переводом на 30 минут не
  проверялись.

## 6. Начало окна в ночь перевода часов

Code: `src/shared/assistant/schedule/work-hours.ts:125-139` · key lines: 127, 128, 133

```ts
function momentOfWall(wall: number, zone: string): number {
  const offsets = new Set([wallOf(wall - DAY_MS, zone) - (wall - DAY_MS), wallOf(wall, zone) - wall, wallOf(wall + DAY_MS, zone) - (wall + DAY_MS)])
  const exact = [...offsets].map((offset) => wall - offset).filter((moment) => wallOf(moment, zone) === wall)
  if (exact.length > 0) return Math.min(...exact)
  // Skipped: the jump lies between the moments the two offsets give; find it to the minute.
  const candidates = [...offsets].map((offset) => wall - offset)
  let low = Math.min(...candidates)
  let high = Math.max(...candidates)
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS
    if (wallOf(middle, zone) >= wall) high = middle
    else low = middle
  }
  return high
}
```

- Что делает: переводит стенное время пояса в момент. Время, которое бывает дважды (ночь возврата часов), даёт первый
  раз; время, которое часы пропускают, — момент перевода.
- Почему здесь: Ticket требует test-ы на смену летнего времени; правило для пропущенного и двойного часа — решение
  без владельца, оно в «Итог» Ticket-а.
- Без него: проверка, которая спит до 09:00, в ночь перевода вперёд проснулась бы в 10:00 по стенным часам.
- Требование: [Test-ы](../issues/04-расписание-проверок-и-work-hours.md#test-ы)
- Риски и пробелы test-ов: не записано

## 7. Настройки — поле настроек машины

Code: `src/shared/settings/app-settings.ts:333-335` · key lines: 335

```ts
  autoContinue: autoContinueSchema.optional(),
  /** The Assistant's work hours and checks (worfy-assistant ticket 04); absent while nothing is chosen (see checkSettingsOf). */
  assistantSchedule: assistantScheduleChoiceSchema.optional(),
```

- Что делает: кладёт work hours и выбор по каждому виду проверки в `app-settings.json` этой машины. Чтение файла по
  полям, слияние изменения и сравнение живут в `src/shared/assistant/schedule/settings.ts`; `store.ts` вызывает их
  четырьмя строками.
- Почему здесь: Ticket называет `app-settings.ts` и `store.ts` и требует каналы `local`, как у настроек Limits и Link;
  каналы `appSettings.*` уже `local`.
- Без него: Linked machine не видит настройки только потому, что они в этих каналах; свой домен IPC пришлось бы
  отдельно помечать `local`.
- Требование: [Что строить, п. 5](../issues/04-расписание-проверок-и-work-hours.md#что-строить)
- Риски и пробелы test-ов: UI настроек нет: его делает Ticket 15.

## 8. Что сознательно не меняли

22 прежних `setInterval` в main не переведены на планировщик: Ticket просит планировщик проверок источников.
Проверок Slack и Jira ещё нет: их регистрируют Ticket-ы 11–13 через `checkScheduler().register(...)`. Страница
`docs/features/` не правилась: поведения, видного пользователю, ещё нет.

## 9. Как проверено

- Новые test-ы до кода — exit 1 (`Cannot find module`), после — exit 0: `test/unit/assistant-work-hours.test.ts`,
  `test/unit/assistant-schedule-settings.test.ts`, `test/unit/assistant-check-scheduler.test.ts`,
  `test/contract/assistant-schedule-settings.test.ts`. Test-ы первого раунда ревью — сначала красные (8 из 24), потом
  зелёные.
- Мутанты в своём worktree, каждый краснит test: без проверки `asleep` в `plan()`, без `Math.max(due, now)`, без
  `entry.running` в `runNow` и в `plan()`, без предела таймера в час, без `scheduler.stop()` в `app.ts`, без записи
  будущего старта как «сейчас», без задержки после начала work hours, без её привязки к началу окна, без возврата к
  началу короткого окна, без предела запуска, без защиты от позднего ответа.
- `pnpm lint`, `pnpm typecheck`, gate fast — коды выхода в отчёте PR.

## Проверить себя

1. worfy закрыли во вторник в 17:50 после проверки Slack (интервал 30 минут, спит вне work hours 09:00–18:00) и
   открыли в четверг в 07:00. Когда пойдёт проверка и что она получит в `since`?
   Ответ: в четверг после 09:00, с задержкой от 0 до 3 минут по жребию: срок вторника прошёл, 07:00 вне work hours,
   значит — начало ближайших плюс доля разброса. `since` — старт вторничной проверки в 17:50.
   Lines: `src/main/assistant/schedule/scheduler.ts:195-216`
2. Вызов Slack завис. Что будет с проверками Slack и что получит следующая проверка в `since`?
   Ответ: через 10 минут запуск считается упавшим, Slack планируется заново по интервалу от старта зависшего запуска;
   `since` — старт последнего успешного запуска, поздний ответ зависшего ничего не меняет.
   Lines: `src/main/assistant/schedule/scheduler.ts:224-237`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-assistant 04 (one scheduler of the Assistant's checks and the work hours: days, windows, time zone, sleep outside work hours, catch-up after sleep and restart), head d7f1a65c3eac669da81a4aab45277c34c1fd36bf
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — FIX in round 1 (one med: the guard against a second start of a running check had no test; four lows); the Orchestrator added a per-run time limit; round 1 checked by the Orchestrator against the code of d7f1a65c3.
>
> - What it does (no UI yet; the Slack and Jira checks of tickets 11–13 register with it): with the defaults (Slack every 10 min, Jira every 60 min, both off, both asleep outside Mon–Fri 09:00–18:00 machine time) it sets no timer and reads or writes nothing; an enabled check runs on its interval ±10 %, never twice at once, a timer waits at most an hour so a clock change shows within the hour, after sleep or a restart an overdue check runs once with `since` from its last success, a check asleep outside work hours goes after their start by its share of the spread, a run that does not end in 10 minutes counts as failed.
> - Fixed in round 1: tests for the running guard (timers, reschedule, suspend/resume while a check hangs), the 1 h timer cap, stop(); a last start in the future is brought to now; the spread at the work-hours start; CHECK_RUN_TIMEOUT_MS = 10 min (src/main/assistant/schedule/scheduler.ts:224-237).
> - Evidence: reviewer 13 of 16 mutants caught in round 1 and 353 + 105 tests EXIT=0; round 1: 8 new tests red first, 11 mutants killed, 187 tests of the scheduler, settings and main wiring EXIT=0, lint and typecheck EXIT=0, gate fast green on d7f1a65c3, story-check ok.
> - Not verified: Electron's real powerMonitor on a real Mac sleep; a timed-out call that is still alive runs beside the next one of its kind (written in the code comment).
>
> Decided without the owner (to confirm): Slack every 10 min and Jira every 60 min, both off by default and asleep outside work hours; work hours Mon–Fri 09:00–18:00 in the machine's time zone; interval 5–1440 min; spread ±10 %; up to 4 windows a day; a check run is limited to 10 minutes.

Code: `src/main/assistant/schedule/scheduler.ts:224-237` · key lines: 224

```ts
    let ended = false
    const end = (succeeded: boolean): void => {
      if (ended) return
      ended = true
      this.clearTimer(limit)
      if (succeeded) this.mark(kind, { succeededAt: now })
      entry.running = false
      entry.spread = this.draw()
      this.plan()
    }
    const limit = this.setTimer(() => {
      console.warn(`[assistant] the ${kind} check did not end in ${CHECK_RUN_TIMEOUT_MS / MINUTE_MS} minutes: counted as failed`)
      end(false)
    }, CHECK_RUN_TIMEOUT_MS)
```
