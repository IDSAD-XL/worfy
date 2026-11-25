# Code story — worfy-assistant 04: Расписание проверок и work hours

Kind: pr · Epic: worfy-assistant · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Assistant-у нужно регулярно проверять Slack и Jira, у каждого источника свой интервал, а ночью часть проверок
должна спать. В main не было ни одного общего планировщика: каждая периодическая работа заводит свой таймер. Окно
старта Autopilot-а знает только целые часы и часовой пояс процесса, без дней недели и нескольких окон. Никто не
догонял проверки после сна Mac и после перезапуска.

- Требование: [Что строить](../issues/04-расписание-проверок-и-work-hours.md#что-строить)

## 2. Когда идёт проверка

Code: `src/main/assistant/schedule/scheduler.ts:186-196` · key lines: 191, 192, 195

```ts
  private dueOf(kind: CheckKind, entry: Entry, now: number): number | null {
    const settings = this.options.settings()
    const check = checkSettingsOf(settings, kind)
    if (!check.enabled) return null
    const startedAt = this.readMarks()[kind]?.startedAt
    const due = startedAt === undefined ? now : startedAt + Math.round(check.intervalMinutes * MINUTE_MS * (1 + entry.spread))
    const moment = Math.max(due, now)
    if (!check.sleepOutsideWorkHours) return moment
    const hours = workHoursOf(settings)
    return inWorkHours(moment, hours) ? moment : nextWorkHoursStart(moment, hours)
  }
```

- Что делает: считает следующий запуск вида проверки: выключен — никогда; иначе последний старт плюс интервал с
  разбросом ±10 %; если вид спит вне work hours и момент вне них — начало следующих work hours. Срок, который уже
  прошёл, сжимается до «сейчас».
- Почему здесь: Ticket требует реестр с интервалом и разбросом и сон отмеченных проверок вне work hours. Число
  ±10 % — решение без владельца, оно в «Итог» Ticket-а.
- Без него: без `Math.max(due, now)` проверка, которую пропустили за два дня закрытого worfy, пошла бы сразу в 07:00:
  начало вчерашних work hours уже в прошлом.
- Требование: [Решения](../issues/04-расписание-проверок-и-work-hours.md#решения)
- Риски и пробелы test-ов: часы — vitest fake timers; настоящий `setTimeout` после долгого сна не проверяется, его
  заменяет `suspend()` и `resume()`.

## 3. Один запуск за раз и догоняющая проверка

Code: `src/main/assistant/schedule/scheduler.ts:228-238` · key lines: 230, 234, 237

```ts
  private plan(): void {
    this.clear()
    if (!this.started || this.asleep) return
    const now = this.options.now()
    let next = Number.POSITIVE_INFINITY
    for (const [kind, entry] of this.entries) {
      if (entry.running) continue
      const due = this.dueOf(kind, entry, now)
      if (due === null) continue
      if (due <= now) this.launch(kind, entry)
      else next = Math.min(next, due)
```

- Что делает: стартует каждый вид, чей срок наступил, кроме тех, что ещё идут, и ставит один таймер на ближайший
  срок. Пока Mac спит (`asleep`) или планировщик остановлен, ничего не стартует. После `resume()` и после старта
  worfy пропущенный срок даёт один запуск, а не по одному на каждый пропущенный интервал.
- Почему здесь: Ticket требует защиту от двойного запуска, догоняющую проверку после сна и перезапуска, и чтобы
  пока Mac спит, проверок не было.
- Без него: проверка, которая идёт дольше интервала, запускалась бы второй раз; после трёх часов сна шли бы
  восемнадцать проверок Slack подряд.
- Требование: [Готово, когда](../issues/04-расписание-проверок-и-work-hours.md#готово-когда)
- Риски и пробелы test-ов: сон Mac в test-е — `suspend()` и `resume()` (или события `followPower`); настоящий
  `powerMonitor` проверяется только тем, что `src/main/index.ts` передаёт его в `startCheckScheduler`.

## 4. Work hours по стенным часам своего пояса

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

## 5. Начало окна в ночь перевода часов

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

## 6. Настройки — поле настроек машины

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

## 7. Что сознательно не меняли

22 прежних `setInterval` в main не переведены на планировщик: Ticket просит планировщик проверок источников.
Проверок Slack и Jira ещё нет: их регистрируют Ticket-ы 11–13 через `checkScheduler().register(...)`. Страница
`docs/features/` не правилась: поведения, видного пользователю, ещё нет.

## 8. Как проверено

- Новые test-ы до кода — exit 1 (`Cannot find module`), после — exit 0: `test/unit/assistant-work-hours.test.ts`,
  `test/unit/assistant-schedule-settings.test.ts`, `test/unit/assistant-check-scheduler.test.ts`,
  `test/contract/assistant-schedule-settings.test.ts`.
- Мутанты в своём worktree: убрать проверку `asleep` в `plan()`, убрать `Math.max(due, now)`, убрать `entry.running`
  в `runNow` — каждый краснит test планировщика.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — коды выхода в отчёте PR.

## Проверить себя

1. worfy закрыли во вторник в 17:50 после проверки Slack (интервал 30 минут, спит вне work hours 09:00–18:00) и
   открыли в четверг в 07:00. Когда пойдёт проверка и что она получит в `since`?
   Ответ: в четверг в 09:00, не сразу: срок вторника сжимается до «сейчас», 07:00 вне work hours, значит — начало
   ближайших. `since` — старт вторничной проверки в 17:50.
   Lines: `src/main/assistant/schedule/scheduler.ts:186-196`
2. Mac проспал три часа, интервал Slack — 10 минут. Сколько проверок пойдёт после пробуждения и почему?
   Ответ: одна: `plan()` стартует вид, чей срок прошёл, один раз, и следующий срок считается от этого старта.
   Lines: `src/main/assistant/schedule/scheduler.ts:228-238`
