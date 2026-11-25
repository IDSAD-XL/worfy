# Code story — worfy-resource-planner 13: Rework of worfy-resource-planner 12, item 4

Kind: pr · Epic: worfy-resource-planner · Ticket: 13 · PR: - · Language: ru

## 1. Что было не так

У плана без окна `five_hour` индикатор Limits в toolbar всё равно рисовал полосу «5h · no data»: `limitBars` рисовал
оба окна всегда, а сохранённое состояние не отличало «окна нет в плане» от «данных об окне ещё нет» — в обоих случаях
ключа `five_hour` просто не было.

- Требование: [Что происходит](../issues/13-rework-12-item-4.md#что-происходит)

## 2. Окно `null` в ответе usage request — окна в плане нет

Code: `src/shared/agent/limits.ts:246-249` · key lines: 249

```ts
  // The parse succeeded with `rate_limits` an object, so the answer's own value of each window is there to look at.
  const given = (value as { rate_limits: Record<string, unknown> }).rate_limits
  return LIMIT_WINDOWS.flatMap((window): LimitUpdate[] => {
    if (given[window] === null) return [{ window, absentAt: receivedAt }]
```

- Что делает: окно, которое ответ даёт как `null`, превращается в обновление «окна нет» с временем ответа
  (`absentAt`). Окно, которого в ответе нет, и окно в форме, которую сборка не читает, ничего не говорят.
- Почему здесь: из трёх источников только ответ usage request называет окна плана (SDK типизирует каждое как
  необязательное и `null`); SDK `rate_limit_event` и status line опускают и окно без данных. Отсутствующий ключ не
  годится: при сбое usage endpoint (429) Claude Code собирает ответ из прежних заголовков и опускает окно с прошедшим
  сбросом, хотя оно в плане есть (ревью PR, раунд 1).
- Без него: состояние не знало бы, что окна нет, и полоса «no data» осталась бы навсегда.
- Требование: [Что происходит](../issues/13-rework-12-item-4.md#что-происходит)
- Риски и пробелы test-ов: на живом ответе аккаунта без `five_hour` не проверено — форма взята из типов SDK и из
  обработки ответа в самом Claude Code. Если такой аккаунт получает ключ без значения, а не `null`, полоса «no data»
  останется.

## 3. Слияние: новое слово побеждает

Code: `src/shared/agent/limits.ts:277-303` · key lines: 279, 285, 286, 287, 292, 296, 298

```ts
export function mergeLimits(state: LimitsState, updates: readonly LimitUpdate[]): LimitsState {
  let windows = state.windows
  const absentBefore = state.absent ?? {}
  let absent = absentBefore
  for (const update of updates) {
    const { window } = update
    const known = windows[window]
    const absentAt = absent[window]
    if ('absentAt' in update) {
      if ((absentAt !== undefined && absentAt >= update.absentAt) || (known !== undefined && known.receivedAt > update.absentAt)) continue
      if (known !== undefined) windows = Object.fromEntries(Object.entries(windows).filter(([id]) => id !== window))
      absent = { ...absent, [window]: update.absentAt }
      continue
    }
    if (known !== undefined && known.receivedAt > update.state.receivedAt) continue
    if (absentAt !== undefined && absentAt > update.state.receivedAt) continue
    const next = keepKnownStatus(known, keepKnownReset(known, update.state))
    if (known !== undefined && sameWindow(known, next)) continue
    windows = { ...windows, [window]: next }
    if (absentAt !== undefined) absent = Object.fromEntries(Object.entries(absent).filter(([id]) => id !== window))
  }
  if (windows === state.windows && absent === absentBefore) return state
  // The spread keeps what else the state holds: the keys of a newer build's limits.json (src/main/agent/limits.ts).
  const next: LimitsState = { ...state, windows, absent }
  if (Object.keys(absent).length === 0) delete next.absent
  return next
}
```

- Что делает: «окна нет» новее известного окна убирает его и записывает время в `absent`; более старое — пропускается.
  Данные об окне новее записи `absent` возвращают окно и снимают запись, данные старее — отбрасываются. Состояние
  считается изменённым, если изменился `windows` или `absent` (сравнение с `absentBefore`), так что «окна нет» без
  известного окна тоже записывается. Пустой `absent` из состояния убирается.
- Почему здесь: `mergeLimits` — единственное место, где одно обновление окна заменяет другое (комментарий в начале
  файла), и правило «новее заменяет старее» уже действует там для окон.
- Без него: окно, известное до того, как план его потерял, висело бы в `limits.json` с пометкой «as of» навсегда; поздно
  прочитанный файл status line возвращал бы окно, которого уже нет.
- Требование: [Готово, когда](../issues/13-rework-12-item-4.md#готово-когда)
- Риски и пробелы test-ов: каждый ответ usage request сдвигает время в `absent` и переписывает `limits.json` — так же,
  как его уже переписывает обновление `seven_day` из того же ответа.

## 4. Полосы — только для окон плана

Code: `src/shared/agent/limits.ts:396-397` · key lines: 396

```ts
  const shown = LIMIT_WINDOWS.filter((window) => state.windows[window] !== undefined || state.absent?.[window] === undefined)
  return shown.map((window): LimitBar => {
```

- Что делает: окно без данных и без записи в `absent` остаётся полосой «no data»; окно с записью в `absent` полосы не
  получает.
- Почему здесь: Ticket называет `src/shared/agent/limits.ts` и строку, где рисуются оба окна; `LimitsMeter.tsx` рисует
  то, что возвращает `limitSections`, и не меняется.
- Без него: полоса «5h · no data» у плана без `five_hour`.
- Требование: [Готово, когда](../issues/13-rework-12-item-4.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 5. Usage request не ждёт окна, которого нет

Code: `src/main/agent/limits-usage.ts:215-223` · key lines: 218, 219

```ts
  private fresh(passiveOnly: boolean, maxAgeMs: number): boolean {
    const { windows, absent } = this.options.limits.snapshot()
    const since = this.now() - maxAgeMs
    const shown = LIMIT_WINDOWS.filter((id) => windows[id] !== undefined || absent?.[id] === undefined)
    return shown.length > 0 && shown.every((id) => {
      const known = windows[id]
      return known !== undefined && known.utilization !== null && known.receivedAt > since && !(passiveOnly && known.source === 'usage')
    })
  }
```

- Что делает: свежесть считается только по окнам, которые показываются; окно из `absent` не требуется. Если отсутствуют
  все окна, свежего нет и запрос уходит.
- Почему здесь: `fresh()` решает и тик раз в 30 минут, и `refreshIfOlder` перед строкой Wave Autopilot; файл добавлен в
  след Ticket-а по ревью PR, раунд 1.
- Без него: план без `five_hour` отправлял бы usage request каждые 30 минут и перед каждой Wave, даже при свежих
  пассивных источниках.
- Требование: [Готово, когда](../issues/13-rework-12-item-4.md#готово-когда)
- Риски и пробелы test-ов: не записано

## 6. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — green. Новые test-ы в `test/unit/limits.test.ts`,
`test/unit/limits-meter.test.tsx`, `test/unit/limits-usage.test.ts` и `test/contract/limits.test.ts` были красными до
правки. `pnpm test:e2e test/e2e/limits.spec.ts` — exit 0: собранное приложение с `limits.json` без `five_hour` рисует
одну полосу 7-day, снимки в обеих темах в `.scratch/worfy-resource-planner/evidence/13/`.

## Проверить себя

1. Почему окно, которого нет в ответе usage request, не считается отсутствующим, а окно `null` — считается?
   - Ответ: при сбое usage endpoint Claude Code собирает ответ из прежних заголовков и опускает окно с прошедшим сбросом,
     хотя оно в плане есть; `null` же — явное слово ответа об окне.
   - Строки: `src/shared/agent/limits.ts:249`
2. Что будет с полосой 5-hour, если после «окна нет» придёт `rate_limit_event` с `five_hour`, полученный позже ответа?
   - Ответ: окно вернётся и запись в `absent` снимется: данные новее слова «окна нет» побеждают.
   - Строки: `src/shared/agent/limits.ts:292-296`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-resource-planner 13 (rework of resource-planner 12 item 4: the Limits meter draws only the windows of the account's plan), head a9e783cccb472a8cfd82a3de15b9ded2ab423af5
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — FIX in round 1 (one med: a window missing from the usage answer was taken for a window the plan lacks, which could hide the owner's real five_hour bar after a 429; one low: an absence that removed no known window was dropped); round 1 checked by the Orchestrator against the diff a15e4598d..a9e783ccc.
>
> - What the user sees: an account whose plan has no five_hour window gets one 7-day bar, no «5h · no data»; an account that has the window keeps its bar, also when the usage endpoint fails and Claude Code leaves the key out; a plan without the window no longer sends a usage request every 30 minutes and before every Wave line while its 7-day window is fresh.
> - Fixed in round 1: only an explicit `null` in the usage answer means absent (src/shared/agent/limits.ts:249); a missing key or `rate_limits: {}` says nothing; an absence is recorded even when no known window goes away (:279, :298); LimitsRefresher.fresh() does not wait for an absent window (src/main/agent/limits-usage.ts:215-223).
> - Evidence: three new tests red on a15e4598d, green after; limits unit + contract files 680 passed on 809cf964e; pnpm lint, typecheck EXIT=0; e2e test/e2e/limits.spec.ts whole 2/2 EXIT=0 on 809cf964e; reviewer's 132 files on the first head 3704 tests EXIT=0; screenshots of the one-bar meter in both themes.
> - Local gate fast and full pnpm test red on 809cf964e only in file-watcher contract tests (fseventsd at 102–109 % CPU, load 81) — the known Mac blocker, not this change; the merge waits for green ci-ok.
> - Not verified: a live usage answer of an account without five_hour (the rule follows the SDK typings and Claude Code's own /usage handling, written in the ticket's result section).
>
> Decided without the owner (to confirm): a newer absence removes a known window with its status and reset time; with every window absent the refresher still asks.

Code: `src/shared/agent/limits.ts:249-249` · key lines: 249

```ts
    if (given[window] === null) return [{ window, absentAt: receivedAt }]
```

Code: `src/main/agent/limits-usage.ts:215-223` · key lines: 215

```ts
  private fresh(passiveOnly: boolean, maxAgeMs: number): boolean {
    const { windows, absent } = this.options.limits.snapshot()
    const since = this.now() - maxAgeMs
    const shown = LIMIT_WINDOWS.filter((id) => windows[id] !== undefined || absent?.[id] === undefined)
    return shown.length > 0 && shown.every((id) => {
      const known = windows[id]
      return known !== undefined && known.utilization !== null && known.receivedAt > since && !(passiveOnly && known.source === 'usage')
    })
  }
```
