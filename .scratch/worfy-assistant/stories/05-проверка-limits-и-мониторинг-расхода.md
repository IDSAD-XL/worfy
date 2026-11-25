# Code story — worfy-assistant 05: Проверка Limits для Assistant-а, дневной предел пробуждений и мониторинг расхода

Kind: pr · Epic: worfy-assistant · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

Assistant-а ещё нет, а будить его по spec можно только после проверки Limits и дневного предела. Проверка Limits
жила внутри Terminal AI и знала только его функции. Счёта token-ов Assistant-а и оценки его доли в окнах Limits не было
вовсе. Этот PR даёт три части, которые потом вызывают Ticket-ы 06, 10 и 11: общую проверку Limits, проверку перед
пробуждением и журнал расхода.

- Требование: [Что строить](../issues/05-проверка-limits-и-мониторинг-расхода.md#что-строить)

## 2. Проверка Limits — одна на Terminal AI и Assistant

Code: `src/main/agent/limits-gate.ts:43-59` · key lines: 45, 47, 51

```ts
function blocks(window: string, state: LimitWindowState, kind: LimitsCallKind): boolean {
  if (state.status === 'rejected') return true
  if (kind === 'on-demand') return false
  if (state.status === 'allowed_warning') return true
  return window === 'five_hour' && state.utilization !== null && state.utilization > AUTOMATIC_SHARE_LIMIT
}

/** Whether the Limits `state` let a call of `kind` go at `now` (milliseconds since the epoch). */
export function limitsCheck(state: LimitsState, kind: LimitsCallKind, now: number): LimitsVerdict {
  let verdict: LimitsVerdict = { ok: true }
  for (const [window, known] of Object.entries(state.windows)) {
    const until = inForceUntil(known, now)
    if (until === null || !blocks(window, known, kind)) continue
    if (verdict.ok || until > verdict.until) verdict = { ok: false, window, status: known.status, utilization: known.utilization, until }
  }
  return verdict
}
```

- Что делает: правила Terminal AI без изменений, но вид вызова теперь `automatic` или `on-demand`, а не функция Terminal AI.
  `src/main/terminal-ai/limits-gate.ts` стал обёрткой: автоматические функции — `automatic`, по запросу — `on-demand`.
- Почему здесь: Ticket называет проверку Terminal AI в «Где в коде» и просит её обобщить; бриф запрещает второе чтение
  Limits. Файл лёг рядом с Limits в main (`src/main/agent/`), а не в `terminal-ai/`, чтобы Assistant не зависел от
  Terminal AI.
- Без него: у Assistant-а была бы своя копия порога 80 % и TTL статуса, и правила разошлись бы при первой правке.
- Требование: [Что строить, пункт 1](../issues/05-проверка-limits-и-мониторинг-расхода.md#что-строить)
- Риски и пробелы test-ов: прежний `test/unit/terminal-ai-limits-gate.test.ts` проверяет правила через обёртку и не
  менялся; отдельного test-а на `limitsCheck` нет, его виды проверяет test Assistant-а.

## 3. Перед пробуждением: Limits, потом дневной предел

Code: `src/main/assistant/budget/wake-gate.ts:36-40` · key lines: 36, 38

```ts
  const verdict = limitsCheck(limits, urgent ? 'on-demand' : 'automatic', now)
  if (!verdict.ok) return { ...verdict, reason: 'limits' }
  if (wakesToday >= limit) return { ok: false, reason: 'daily-limit', wakes: wakesToday, limit, until: nextLocalMidnight(now) }
  return { ok: true }
}
```

- Что делает: несрочное пробуждение — `automatic` (ждёт выше 80 % 5-часового окна), срочное — `on-demand` (держит только
  `rejected`). Потом предел: при `ASSISTANT_DAILY_WAKE_LIMIT` (20) пробуждениях за местный день — отказ до местной полуночи.
- Почему здесь: spec, «Решение о пробуждении»: перед каждым автоматическим пробуждением — проверка Limits с порогом 80 % и
  дневной предел. Что срочное проходит выше 80 % и что предел считает и срочные — решено без владельца, записано в «Итог».
- Без него: Ticket 06 будил бы модель при занятом окне, и цикл пробуждений не имел бы потолка.
- Требование: [Готово, когда, пункты 1 и 2](../issues/05-проверка-limits-и-мониторинг-расхода.md#готово-когда)
- Риски и пробелы test-ов: число 20 не выведено из замера; его подтверждает владелец, настройку даёт Ticket 15.

## 4. Счёт пробуждений и вызовов — в файле данных worfy

Code: `src/main/assistant/budget/ledger.ts:63-86` · key lines: 67, 75, 81

```ts
  /** An automatic wake starts now; `id` names it for the calls of its Session. */
  noteWake(id: string, urgent: boolean): void {
    const at = this.now()
    const wake = usageWakeSchema.safeParse({ id, at, urgent })
    if (!wake.success) return console.warn(`worfy: an Assistant wake was not noted: ${z.prettifyError(wake.error)}`)
    this.write({ ...this.ledger, wakes: [...this.ledger.wakes, wake.data] }, at)
  }

  /** One call of the Assistant ended now. */
  noteCall(call: UsageCallInput): void {
    const at = this.now()
    const parsed = usageCallSchema.safeParse({ ...call, at })
    if (!parsed.success) return console.warn(`worfy: an Assistant call was not noted: ${z.prettifyError(parsed.error)}`)
    this.write({ ...this.ledger, calls: [...this.ledger.calls, parsed.data] }, at)
  }

  /** A turn of another Session worfy runs ended now, at `costUsd`; a turn that cost nothing changes nothing. */
  noteOtherTurn(costUsd: number): void {
    if (!Number.isFinite(costUsd)) return console.warn(`worfy: the cost of a turn was not noted: ${costUsd}`)
    if (costUsd <= 0) return
    const at = this.now()
    const hour = hourKey(at)
    this.write({ ...this.ledger, otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + costUsd } }, at)
  }
```

- Что делает: каждая запись сразу пишется в `<WORFY_DATA_DIR>/assistant/usage.json` и выбрасывает старше 8 суток.
  Пробуждение пишется в момент решения; вызов — с `usage` и `costUsd` события `result`; ходы других Session-ов — суммой
  по часам. Запись вне схемы (стоимость NaN, отрицательные token-ы, бесконечная стоимость хода) выбрасывается с
  предупреждением.
- Почему здесь: ADR 0005 — своё состояние worfy только в папке данных. Файл переживает перезапуск, поэтому перезапуск
  не обнуляет дневной предел. Проверку на входе попросил review PR #2197, раунд 1.
- Без него: после перезапуска счёт пробуждений начинался бы с нуля. Одна запись с NaN навсегда ломала бы журнал:
  `writeJsonFile` отказывал бы каждой следующей записи.
- Требование: [Готово, когда, пункт 3](../issues/05-проверка-limits-и-мониторинг-расхода.md#готово-когда)
- Риски и пробелы test-ов: `noteCall` и `noteOtherTurn` пока никто не вызывает — их подключают Ticket-ы 06, 10 и 11.
  Вызовы пробуждения сводка считает в день самого пробуждения (`countedAt` в `src/shared/assistant/budget.ts`).

## 5. Журнал в памяти меняется только после записи файла

Code: `src/main/assistant/budget/ledger.ts:106-110` · key lines: 108, 109

```ts

  private write(next: UsageLedger, now: number): void {
    const pruned = pruneUsage(next, now)
    writeJsonFile(this.file, usageLedgerSchema, pruned)
    this.ledger = pruned
```

- Что делает: сначала пишет файл, потом обновляет журнал в памяти. Ошибка записи бросает исключение, и в памяти от
  записи ничего не остаётся.
- Почему здесь: review PR #2197, раунд 1, пункт 1: память и файл не должны расходиться.
- Без него: при ошибке записи память и файл расходились бы, и после перезапуска счёт был бы другим.
- Требование: [Готово, когда, пункт 3](../issues/05-проверка-limits-и-мониторинг-расхода.md#готово-когда)
- Риски и пробелы test-ов: при сбое диска пробуждение не засчитывается, а `noteWake` бросает исключение — решать,
  будить ли тогда, будет Ticket 06.

## 6. Доля Assistant-а в окне Limits — оценка по стоимости

Code: `src/shared/assistant/budget.ts:198-214` · key lines: 201, 205, 207, 209

```ts
export function limitsShare(ledger: UsageLedger, windows: Readonly<Record<string, { utilization: number | null; resetsAt: number | null }>>, now: number): LimitsShareEstimate[] {
  const out: LimitsShareEstimate[] = []
  for (const [window, state] of Object.entries(windows)) {
    const minutes = claudeWindowMinutes(window)
    if (minutes === null || state.utilization === null || state.resetsAt === null || state.resetsAt * 1000 <= now) continue
    const since = state.resetsAt * 1000 - minutes * 60_000
    // Both sides from the start of the hour the window began in: the other turns are kept by the hour.
    const from = Number(hourKey(since))
    let assistant = 0
    for (const call of ledger.calls) if (call.at >= from) assistant += call.costUsd
    let other = 0
    for (const [hour, cost] of Object.entries(ledger.otherCost)) if (Number(hour) >= from) other += cost
    const all = assistant + other
    out.push({ window, estimate: true, method: 'cost-share', utilization: state.utilization, share: all > 0 ? (state.utilization * assistant) / all : 0, since })
  }
  return out
}
```

- Что делает: доля окна × часть Assistant-а в стоимости всех ходов, которые worfy видел с начала часа, в котором
  началось окно. Длину окна даёт `claudeWindowMinutes` по началу имени, поэтому `seven_day_opus` тоже получает оценку.
  Ответ всегда с `estimate: true` и `method: 'cost-share'`.
- Почему здесь: spec, «Мониторинг расхода»: доли одного вызова worfy не знает, способ оценки выбирает Ticket. Стоимость
  SDK взвешивает модель и cache, поэтому ближе к счёту окна, чем сумма token-ов. Общее начало для обеих сторон — review
  PR #2197, раунд 1: ходы других Session-ов хранятся по часам.
- Без него: экран Assistant-а (Ticket-ы 14 и 15) мог бы показать только общий процент окна.
- Требование: [Мониторинг расхода](../spec.md#мониторинг-расхода-решение-владельца)
- Риски и пробелы test-ов: Claude вне worfy не виден, оценка завышает долю. До часа ходов из прошлого окна попадает в
  обе стороны. Пока `noteOtherTurn` не подключён, доля равна доле всего окна.

## 7. Что сознательно не меняли

- Ни один вызов не подключён: Assistant-а, проверок источников и общей шины событий `result` в main ещё нет.
- Страницы Assistant-а в `docs/features` нет до Ticket-а 19; в `storage-and-diagnostics.md` добавлена только папка `assistant`.

## 8. Как проверено

- `pnpm test test/unit/assistant- test/unit/no-rmsync test/unit/limits test/contract/limits test/unit/terminal-ai test/contract/terminal-ai test/unit/check-feature-docs` — exit 0, 672 test-а.
- Раунд 1 review: по одному mutant-у на каждую правку (запись до коммита в память, без проверки вызова, без проверки
  бесконечной стоимости, верхняя граница счёта дня, точные имена окон, Assistant от `since`, вызов по своему времени) —
  каждый красный на своём test-е.
- `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему срочное пробуждение при 95 % 5-часового окна проходит, а несрочное нет?
   - Ответ: срочное идёт в проверку видом `on-demand`, его держит только `rejected`; несрочное — `automatic`, его держит доля выше 0.8.
   - Строки: `src/main/assistant/budget/wake-gate.ts:36-36`, `src/main/agent/limits-gate.ts:45-47`
2. Почему перезапуск worfy не обнуляет дневной предел?
   - Ответ: пробуждение сразу пишется в файл папки данных, и новый журнал читает его оттуда.
   - Строки: `src/main/assistant/budget/ledger.ts:64-68`
3. Что покажет оценка доли, пока ходы других Session-ов не подключены?
   - Ответ: всю долю окна: стоимость «других» равна нулю, и часть Assistant-а — единица.
   - Строки: `src/shared/assistant/budget.ts:210-211`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-assistant 05 (the Assistant's Limits check before a wake, the daily wake limit and the usage ledger with the estimated share of the Limits windows), head 38eb1eef98006c7580813597a120f0d01aa3d8da
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — FIX in round 1 (one med: one invalid entry, e.g. a NaN cost, stayed in memory and made every later note throw, so nothing reached the file and the daily limit forgot wakes after a restart; five lows); round 1 checked by the Orchestrator against the diff a854a6728..38eb1eef9 (rebased onto 23a241a7a).
>
> - What it does (no UI yet; tickets 06, 10, 11 call it): a non-urgent wake is refused while the 5-hour window is above 80 %, an urgent one only on `rejected`; at most 20 automatic wakes per local day, counted from <WORFY_DATA_DIR>/assistant/usage.json so a restart does not reset it; tokens and cost of every Assistant call by source, per day and week; the Assistant's share of each window is marked as an estimate.
> - Fixed in round 1: a note outside the schema is dropped with a warning and the in-memory ledger changes only after the write succeeds (src/main/assistant/budget/ledger.ts:63-86, 106-110); a wake stamped after now (clock moved back) still counts; window lengths come from the prefix rule of src/shared/agent/limits.ts, so seven_day_opus/sonnet get an estimate; both sides of the share count from the start hour of the window; a wake's calls count on the wake's day; the data-folder table of docs/features/storage-and-diagnostics.md (en, ru) names assistant/usage.json.
> - Evidence: reviewer 14 mutants caught in round 1 and 797 tests of limits/terminal-ai/assistant EXIT=0; round 1: 6 new tests red first, 7 mutants red, lint+typecheck EXIT=0, touched test families EXIT=0, gate fast green on the rebased branch, story-check ok.
> - Moved without a change: limitsCheck from src/main/terminal-ai/limits-gate.ts to src/main/agent/limits-gate.ts; Terminal AI keeps a wrapper, its test unchanged and green.
> - Not verified: real SDK costs (no caller yet).
>
> Decided without the owner (to confirm): daily limit 20 automatic wakes, urgent wakes count, a user's message does not; a non-urgent wake waits above 80 % of the 5-hour window; the day is the machine's time zone; the share is window share × the Assistant's part of the cost of all turns worfy saw.

Code: `src/main/assistant/budget/ledger.ts:63-86` · key lines: 63

```ts
  /** An automatic wake starts now; `id` names it for the calls of its Session. */
  noteWake(id: string, urgent: boolean): void {
    const at = this.now()
    const wake = usageWakeSchema.safeParse({ id, at, urgent })
    if (!wake.success) return console.warn(`worfy: an Assistant wake was not noted: ${z.prettifyError(wake.error)}`)
    this.write({ ...this.ledger, wakes: [...this.ledger.wakes, wake.data] }, at)
  }

  /** One call of the Assistant ended now. */
  noteCall(call: UsageCallInput): void {
    const at = this.now()
    const parsed = usageCallSchema.safeParse({ ...call, at })
    if (!parsed.success) return console.warn(`worfy: an Assistant call was not noted: ${z.prettifyError(parsed.error)}`)
    this.write({ ...this.ledger, calls: [...this.ledger.calls, parsed.data] }, at)
  }

  /** A turn of another Session worfy runs ended now, at `costUsd`; a turn that cost nothing changes nothing. */
  noteOtherTurn(costUsd: number): void {
    if (!Number.isFinite(costUsd)) return console.warn(`worfy: the cost of a turn was not noted: ${costUsd}`)
    if (costUsd <= 0) return
    const at = this.now()
    const hour = hourKey(at)
    this.write({ ...this.ledger, otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + costUsd } }, at)
  }
```
