# Code story — worfy-resource-planner 13: Rework of worfy-resource-planner 12, item 4

Kind: pr · Epic: worfy-resource-planner · Ticket: 13 · PR: - · Language: ru

## 1. Что было не так

У плана без окна `five_hour` индикатор Limits в toolbar всё равно рисовал полосу «5h · no data»: `limitBars` рисовал
оба окна всегда, а сохранённое состояние не отличало «окна нет в плане» от «данных об окне ещё нет» — в обоих случаях
ключа `five_hour` просто не было.

- Требование: [Что происходит](../issues/13-rework-12-item-4.md#что-происходит)

## 2. Ответ usage request говорит, каких окон в плане нет

Code: `src/shared/agent/limits.ts:244-247` · key lines: 245, 247

```ts
  // The parse succeeded with `rate_limits` an object, so the answer's own value of each window is there to look at.
  const given = (value as { rate_limits: Record<string, unknown> }).rate_limits
  return LIMIT_WINDOWS.flatMap((window): LimitUpdate[] => {
    if (given[window] === null || given[window] === undefined) return [{ window, absentAt: receivedAt }]
```

- Что делает: окно, которого в `rate_limits` ответа нет или которое там `null`, даёт обновление «окна нет» с временем
  ответа (`absentAt`). Окно в форме, которую сборка не читает, таким не считается: оно может быть.
- Почему здесь: из трёх источников только ответ usage request перечисляет окна плана (SDK типизирует каждое окно как
  необязательное и `null`); SDK `rate_limit_event` и status line опускают и окно, о котором данных пока нет, поэтому по
  ним «окна нет» не отличить от «данных нет». Сам Claude Code в `/usage` тоже не рисует строку для такого окна.
- Без него: состояние не знало бы, что окна нет, и полоса «no data» осталась бы навсегда.
- Требование: [Что происходит](../issues/13-rework-12-item-4.md#что-происходит)
- Риски и пробелы test-ов: на настоящем ответе аккаунта без `five_hour` не проверено — форма взята из типов SDK
  (`five_hour?: {…} | null`); если сервер когда-нибудь пришлёт `five_hour: null` плану, у которого окно есть, полоса
  пропадёт до первых данных о нём.

## 3. Слияние: новое слово побеждает

Code: `src/shared/agent/limits.ts:275-300` · key lines: 282, 283, 284, 289, 293

```ts
export function mergeLimits(state: LimitsState, updates: readonly LimitUpdate[]): LimitsState {
  let windows = state.windows
  let absent = state.absent ?? {}
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
  if (windows === state.windows && absent === (state.absent ?? absent)) return state
  // The spread keeps what else the state holds: the keys of a newer build's limits.json (src/main/agent/limits.ts).
  const next: LimitsState = { ...state, windows, absent }
  if (Object.keys(absent).length === 0) delete next.absent
  return next
}
```

- Что делает: «окна нет» новее известного окна убирает его и записывает время в `absent`; более старое — пропускается.
  Данные об окне новее записи `absent` возвращают окно и снимают запись, данные старее — отбрасываются. Окно никогда не
  лежит в `windows` и `absent` одновременно; пустой `absent` из состояния убирается.
- Почему здесь: `mergeLimits` — единственное место, где одно обновление окна заменяет другое (комментарий в начале
  файла), и правило «новее заменяет старее» уже действует там для окон.
- Без него: окно, известное до того, как план его потерял, висело бы в `limits.json` с пометкой «as of» навсегда; поздно
  прочитанный файл status line возвращал бы окно, которого уже нет.
- Требование: [Готово, когда](../issues/13-rework-12-item-4.md#готово-когда)
- Риски и пробелы test-ов: каждый ответ usage request сдвигает время в `absent` и переписывает `limits.json` — так же,
  как его уже переписывает обновление `seven_day` из того же ответа.

## 4. Полосы — только для окон плана

Code: `src/shared/agent/limits.ts:393-394` · key lines: 393

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

## 5. Что сознательно не меняли

`LimitsRefresher.fresh()` (`src/main/agent/limits-usage.ts`) по-прежнему считает свежими данные, только когда известны
оба окна: без `five_hour` usage request уходит каждые 30 минут и перед каждой Wave Autopilot, даже если пассивные
источники свежи. Это лишний короткий процесс Claude Code, а не ожидание сброса; файла нет в следе Ticket-а.

## 6. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0. Новые test-ы в `test/unit/limits.test.ts`, `test/unit/limits-meter.test.tsx`
и `test/contract/limits.test.ts` были красными на origin/main 61111661c. `pnpm test:e2e test/e2e/limits.spec.ts` — exit 0:
собранное приложение с `limits.json` без `five_hour` рисует одну полосу 7-day, снимки в обеих темах в
`.scratch/worfy-resource-planner/evidence/13/`.

## Проверить себя

1. Почему «окна нет» берётся только из ответа usage request, а не из `rate_limit_event` или status line?
   - Ответ: только этот ответ перечисляет окна плана; два других источника опускают и окно, о котором ещё нет данных.
   - Строки: `src/shared/agent/limits.ts:244-247`
2. Что будет с полосой 5-hour, если после «окна нет» придёт `rate_limit_event` с `five_hour`, полученный позже ответа?
   - Ответ: окно вернётся и запись в `absent` снимется: данные новее слова «окна нет» побеждают.
   - Строки: `src/shared/agent/limits.ts:289-293`
