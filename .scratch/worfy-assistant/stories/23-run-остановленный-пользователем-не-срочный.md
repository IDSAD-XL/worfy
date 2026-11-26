# Code story — worfy-assistant 23: Run Autopilot-а, остановленный пользователем, не срочный: пункт несёт причину остановки

Kind: pr · Epic: worfy-assistant · Ticket: 23 · PR: - · Language: ru

## 1. Что было не так

Решение о пробуждении (Ticket 06) будило Assistant-а сразу, в любой час, на любой пункт `run-stopped`. Причина
остановки жила только в тексте пункта (`worfy-x: user-stop`), поэтому решение не могло отличить Run, который
пользователь остановил сам кнопкой Stop, от Run-а, который упал. Владелец 2026-11-26 решил: остановка пользователем
не срочная, остальные — срочные, как раньше.

- Требование: [Что происходит](../issues/23-run-остановленный-пользователем-не-срочный.md#что-происходит)

## 2. Источник кладёт причину в своё поле и называет её словами

Code: `src/main/assistant/core/sources.ts:212-246` · key lines: 212, 222, 227, 244

```ts
const stopReasonOf = (reason: string): AutopilotStopReason | null => ((AUTOPILOT_STOP_REASONS as readonly string[]).includes(reason) ? (reason as AutopilotStopReason) : null)

/**
 * One line of an Autopilot run journal: a stop, a Ticket set aside or a failure line is an item of the run. A stop
 * carries its reason in `stopReason` and names it in words; a reason this build does not know stays as the journal
 * wrote it, in the text only.
 */
export function autopilotAttention(core: Core, line: JournalEvent): void {
  if (!AUTOPILOT_ITEM_KINDS.has(line.kind)) return
  const finished = line.kind === 'run-stopped' && line.reason === 'tickets-done'
  const stopReason = line.kind === 'run-stopped' ? stopReasonOf(line.reason) : null
  const detail =
    line.kind === 'run-stopped'
      ? stopReason === null
        ? line.reason
        : AUTOPILOT_STOP_WORDS[stopReason]
      : line.kind === 'ticket-set-aside'
        ? `Ticket ${line.ticket} set aside`
        : line.kind === 'session-error'
          ? line.message
          : line.kind
  const at = Date.parse(line.at)
  core.ingest({
    source: 'autopilot',
    // One line, by its time, kind and content: two lines of one kind in one run are two events, even in one millisecond.
    id: `${line.run}@${line.at}:${line.kind}`,
    revision: createHash('sha256').update(JSON.stringify(line)).digest('hex').slice(0, 16),
    projectId: line.project,
    subject: { kind: 'run', id: line.run, label: `Autopilot · ${line.epic}` },
    kind: finished ? 'run-finished' : line.kind,
    text: clip(`${line.epic}: ${detail}`),
    ...(Number.isNaN(at) ? {} : { at }),
    ...(stopReason === null ? {} : { stopReason }),
  })
}
```

- Что делает: для строки `run-stopped` берёт причину из журнала; если она есть в `AUTOPILOT_STOP_REASONS`, событие
  получает поле `stopReason`, а текст — слова из `AUTOPILOT_STOP_WORDS` (`worfy-x: stopped by the user`). Причина,
  которой эта сборка не знает, остаётся только в тексте, как её записал журнал. `tickets-done` по-прежнему даёт вид
  `run-finished`, теперь тоже с полем.
- Почему здесь: Ticket называет `autopilotAttention` в «Где в коде»; форму поля (необязательное поле, а не свой вид
  пункта) Ticket оставил агенту — выбор в «Итог», «Решено без владельца», пункт 2.
- Без него: у пункта нет причины, которую решение о пробуждении может прочитать, кроме разбора текста.
- Требование: [Что строить, пункты 1 и 4](../issues/23-run-остановленный-пользователем-не-срочный.md#что-строить)
- Риски и пробелы test-ов: слова каждой причины не проверены test-ом по одной; test-ы смотрят `user-stop`,
  `user-force-stop`, `main-red`, `tickets-done` и незнакомую причину. Полноту списка слов держит typecheck:
  `Record<AutopilotStopReason, string>`.

## 3. Поле в пункте: старый файл читается, незнакомая причина тоже

Code: `src/shared/assistant/attention.ts:115-121` · key lines: 121

```ts
  message: sourceMessageSchema.optional(),
  /**
   * Why the Autopilot Run stopped, one of AUTOPILOT_STOP_REASONS, when the latest event glued into the item is its
   * `run-stopped` line (ticket 23). Absent in a file written before the field. Any text reads, so a reason a later
   * build added does not make the file unreadable; the wake treats a reason it does not know as urgent.
   */
  stopReason: z.string().optional(),
```

- Что делает: пункт получает необязательное поле `stopReason` — любую строку. Файл пунктов без поля читается как
  раньше; поле, которое записала более поздняя сборка с новой причиной, тоже читается.
- Почему здесь: Ticket называет `attentionItemSchema` в «Где в коде». Почему строка, а не перечисление: импорт списка
  причин из `src/shared/autopilot/cycle.ts` в эту схему дал цикл импорта (`cycle.ts` через шаблоны действий и
  обязанности приходит обратно сюда) — test-ы упали с `Cannot read properties of undefined` при загрузке модуля.
- Без него: пункт в файле терял бы причину при каждой записи; со строгим перечислением файл с новой причиной
  стал бы нечитаемым целиком.
- Требование: [Что строить, пункт 1](../issues/23-run-остановленный-пользователем-не-срочный.md#что-строить)
- Риски и пробелы test-ов: то, что старая сборка читает файл с полем, проверено схемой без поля
  (`attentionItemSchema.omit`), а не настоящей старой сборкой.

## 4. Склейка: причина принадлежит последнему событию

Code: `src/main/assistant/core/attention-core.ts:209-212` · key lines: 211, 212

```ts
      if (event.message !== undefined) glued.message = event.message
      // The reason belongs to the latest event: a stop gives it, any later line of the Run takes it away.
      if (event.stopReason !== undefined) glued.stopReason = event.stopReason
      else delete glued.stopReason
```

- Что делает: когда событие Run-а склеивается в уже открытый пункт того же Run-а за тот же день (например, Ticket
  отложен, потом Run остановлен), пункт берёт причину остановки; строка без причины её убирает.
- Почему здесь: Ticket называет `attention-core.ts` как место склейки, если поле добавляется.
- Без него: пункт `ticket-set-aside`, в который склеилась остановка пользователем, остался бы без причины и будил бы
  сразу.
- Требование: [Где в коде](../issues/23-run-остановленный-пользователем-не-срочный.md#где-в-коде)
- Риски и пробелы test-ов: ветку `delete` (строка Run-а после остановки) test не проверяет: после `run-stopped`
  журнал Run-а строк-пунктов обычно не пишет.

## 5. Решение о пробуждении: остановка пользователем не срочная

Code: `src/main/assistant/wake/planner.ts:35-43` · key lines: 40, 43

```ts
/**
 * The stops a person made (ticket 23, owner's decision 2026-11-26): Stop, Force stop, Cancel while the Run waited for
 * its Orchestrator, and a Run a restart cut off that a person discarded. The user knows of them already, so they are
 * not urgent: they go with a batch or the morning summary. Decided without the owner (ticket 23, result section).
 */
export const USER_STOP_REASONS: ReadonlySet<string> = new Set<AutopilotStopReason>(['user-stop', 'user-force-stop', 'start-cancelled', 'discarded'])

/** Whether an item wakes at once by itself: a stopped Run, unless the user stopped it. */
const urgentItem = (item: AttentionItem): boolean => URGENT_ITEM_KINDS.has(item.kind) && !USER_STOP_REASONS.has(item.stopReason ?? '')
```

- Что делает: пункт `run-stopped` с причиной из `USER_STOP_REASONS` больше не делает пробуждение срочным; он
  остаётся ждущим и идёт с пачкой в work hours или с утренней сводкой. Пункт без поля и пункт с незнакомой причиной —
  срочные, как раньше.
- Почему здесь: Ticket называет `URGENT_ITEM_KINDS` и `evaluate` в `planner.ts`. Какие причины — пользователем,
  Ticket оставил агенту: `start-cancelled` и `discarded` взяты по его рекомендации («Итог», «Решено без владельца»,
  пункт 1).
- Без него: Stop ночью будит Assistant-а и тратит пробуждение из дневного предела на то, что пользователь знает.
- Требование: [Что строить, пункты 2 и 3](../issues/23-run-остановленный-пользователем-не-срочный.md#что-строить)
- Риски и пробелы test-ов: `limits-timeout` после Cancel ожидания Limits — тоже действие пользователя, но по строке
  журнала его не отличить от истечения 24 часов, и он остаётся срочным.

## 6. Как проверено

- `pnpm test test/unit/assistant-attention-sources.test.ts test/unit/assistant-wake-planner.test.ts` — exit 1 до
  правки (6 новых test-ов красные), exit 0 после.
- `pnpm test test/unit/assistant-*.test.ts test/contract/assistant-*.test.ts test/unit/autopilot-journal*.test.ts` —
  exit 0 (381 test).
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему Run, остановленный кнопкой Stop, ночью больше не будит Assistant-а, а Run с `main-red` будит?
   - Строки: `src/main/assistant/wake/planner.ts:40-43`
   - Ответ: `urgentItem` считает срочным `run-stopped`, только если его `stopReason` не из `USER_STOP_REASONS`;
     `user-stop` там есть, `main-red` нет.
2. Что будет с пунктом, если более поздняя сборка запишет причину, которой эта сборка не знает?
   - Строки: `src/shared/assistant/attention.ts:115-121`
   - Ответ: файл читается, потому что поле — любая строка; причины нет в `USER_STOP_REASONS`, и пункт будит сразу.
3. Как остановка пользователем попадает в пункт, который уже открыт для этого Run-а?
   - Строки: `src/main/assistant/core/attention-core.ts:209-212`
   - Ответ: при склейке пункт берёт `stopReason` последнего события, так что и склеенный пункт становится несрочным.
