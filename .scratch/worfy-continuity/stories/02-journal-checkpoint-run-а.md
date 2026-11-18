# Code story — worfy-continuity 02: Journal как checkpoint Run-а

Kind: pr · Epic: worfy-continuity · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

Список `resumable` — Ticket-ы, которые следующий Run Epic-а берёт в первую Wave после Force stop, — жил только в
памяти main. После перезапуска worfy он пуст, и Ticket, брошенный убитым implementer-ом, ждёт человека. В Journal-е
не было ни строки приостановки Run-а, ни строки его продолжения, и не было кода, который читает состояние Run-а
обратно из Journal-а.

- Требование: [Что происходит](../issues/02-journal-checkpoint-run-а.md#что-происходит)

## 2. Две новые строки Journal-а

Code: `src/shared/autopilot/journal.ts:660-667` · key lines: 660, 666

```ts
  event('run-suspended', {
    cause: z.enum(SUSPEND_CAUSES),
    wave: count,
    tickets: z.array(text),
    wait: z.object({ kind: z.enum(RUN_WAIT_KINDS), until: isoTime.nullable() }).nullable().catch(null),
  }),
  event('run-continued', { after: z.enum(CONTINUED_AFTER) }),
])
```

- Что делает: формат принимает `run-suspended {cause, wave, tickets, wait}` и `run-continued {after}`; `wait` другой
  формы читается как `null`, строка остаётся.
- Почему здесь: файл и форма событий названы в Ticket-е; имя `resumed` уже занято концом Wait-а Limits, поэтому новое
  имя другое.
- Без него: Ticket-ы 04 и 06 не смогли бы записать приостановку и продолжение — запись вне формата бросает.
- Требование: [Что делаем, п. 1](../issues/02-journal-checkpoint-run-а.md#что-делаем)
- Риски и пробелы test-ов: эту строку пока никто не пишет — выход всё ещё пишет `app-quit` до Ticket-а 04; сборка
  старее пропускает обе строки (test на незнакомый вид строки).

## 3. Когда Run оборван и что он оставляет

Code: `src/shared/autopilot/checkpoint.ts:188-197` · key lines: 190, 196, 197

```ts
  const last = events[events.length - 1]!
  const cutOff: RunCheckpoint['cutOff'] =
    last.kind === 'run-suspended' ? { after: last.cause, at: last.at } : stopped === null ? (suspended ?? { after: 'crash', at: last.at }) : null

  const before = options.before ?? null
  const given = before !== null && before.epic === first ? [...before.resumable] : []
  const named = start?.tickets ?? null
  const carried = named === null ? [] : given.filter((ticket) => !named.includes(ticket))
  const interrupted = stopped !== null && RESUMABLE_STOPS.has(stopped.reason) ? stopped.tickets : []
  const resumable = cutOff !== null ? [] : [...new Set([...(wave === 0 ? given : []), ...interrupted, ...carried])].sort(byNumber)
```

- Что делает: Run оборван, если его последняя строка — `run-suspended` или `run-stopped` нет вовсе; `cutOff` говорит,
  после чего продолжать (`quit`, `update`, `shutdown` или `crash`). `resumable` повторяет правило памяти
  (`resumableOf` в `run.ts`): Ticket-ы `run-stopped` после Force stop, `session-error` и нового `discarded`, плюс
  переданные от прошлого Run-а того же Epic-а — все, если Wave не уходила, и не названные, если Run шёл по названным
  Ticket-ам. Оборванный Run не оставляет ничего, пока его не продолжат или не отбросят.
- Почему здесь: Ticket называет новый чистый reader `src/shared/autopilot/checkpoint.ts` поверх `parseJournal` и
  требует признак «оборван» полем, а не догадкой вызывающего.
- Без него: после перезапуска `resumable` неоткуда взять, а Ticket 06 не знал бы, какой Run продолжать.
- Требование: [Что делаем, п. 2–5](../issues/02-journal-checkpoint-run-а.md#что-делаем)
- Риски и пробелы test-ов: цепочка «переданных» Ticket-ов читается только по журналам, которые даёт вызывающий —
  в приложении это 30 последних Run-ов Project-а; цепочка Run-ов без Wave длиннее 30 потеряет начало.

## 4. Start берёт `resumable` из Journal-а

Code: `src/main/autopilot/run.ts:1149-1160` · key lines: 1154, 1157

```ts
  private async leftOver(projectId: string): Promise<{ epic: string | null; resumable: readonly number[] } | undefined> {
    const remembered = this.last.get(projectId)
    if (this.deps.pastRuns === undefined) return remembered
    try {
      // Newest first as read; resumableAfter wants them in the order they ran.
      const left = resumableAfter([...(await this.deps.pastRuns(projectId))].reverse())
      return left === null ? undefined : { epic: left.epic, resumable: left.resumable.map(Number) }
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not read the journals for the resumable Tickets`, error)
      return remembered
    }
  }
```

- Что делает: при старте Run читает журналы Project-а (`deps.pastRuns`, в приложении — `readRecentRuns`) и берёт
  `resumable` последнего Run-а; без зависимости или при ошибке чтения — из памяти, как до Ticket-а.
- Почему здесь: Ticket указывает место — `run.ts`, где Run брал `resumable` из `last`; ADR-0050 записал, что после
  перезапуска список пуст.
- Без него: новый `Autopilot` после перезапуска не взял бы Ticket-ы, прерванные Force stop-ом, в первую Wave.
- Требование: [Что делаем, п. 4](../issues/02-journal-checkpoint-run-а.md#что-делаем)
- Риски и пробелы test-ов: состояние, которое renderer показывает до первого старта после перезапуска, по-прежнему
  несёт пустой `resumable` — Run берёт Ticket-ы, а кнопка Autopilot о них не знает.

## 5. Что сознательно не меняли

`app-quit` остаётся: выход по-прежнему останавливает Run-ы с ним, `run-suspended` пишет Ticket 04. Recovery invariants
I4 и I6 не меняются — это Ticket-ы 04 и 06; здесь `discarded` добавлен к остановкам без последнего чтения (I3) и к
остановкам человека для ожидания повтора (I4).

## 6. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0. Unit `test/unit/autopilot-checkpoint.test.ts`: шесть новых
fixture-Journal-ов и рваная последняя строка — состояние и признак «оборван». Unit в `test/unit/autopilot-run.test.ts`:
`resumable` из памяти и из Journal-а совпадают после каждой остановки. Contract `test/contract/autopilot-checkpoint.test.ts`
был красным до правки `run.ts`: после Force stop и нового `Autopilot` первая Wave назвала 01 и 02.

## Проверить себя

1. Когда Run считается оборванным, и почему его `resumable` тогда пуст?
   - Ответ: когда его последняя строка — `run-suspended` или `run-stopped` нет вовсе; такой Run ждёт продолжения или
     Discard, и только Discard (`run-stopped discarded`) делает его Ticket-ы `resumable`.
   - Строки: `src/shared/autopilot/checkpoint.ts:189-190`, `src/shared/autopilot/checkpoint.ts:197`
2. Что получает следующий Run Epic-а, если прошлый Run шёл только по Ticket-у 01, а до него Force stop оставил 01, 02, 03?
   - Ответ: 02 и 03 — переданные и не названные Ticket-ы переходят дальше (`carried`), а 01 Run взял и закрыл.
   - Строки: `src/shared/autopilot/checkpoint.ts:195`, `src/shared/autopilot/checkpoint.ts:197`

## 7. Что нашёл review и что осталось

> VERIFIED
> Consider: docs/features/autopilot-faults.md:132 and the `discarded` row near :217 [low] — they say in the present tense that Discard writes `run-stopped` with `discarded`, but nothing in src writes it yet (the Discard button is a later ticket); the `run-suspended` paragraph already says «writes neither yet». Left for the ticket that adds Discard.
> Noted: src/main/autopilot/journal.ts:230 [low, outside the diff] — readRecentRuns reads only the last 30 runs (ESTIMATE_RUNS), so a resumable list carried through more than 30 consecutive Wave-less runs would be lost; unlikely.
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 76347
> Could not verify: pnpm lint, typecheck, the full pnpm test and the gate were not run locally — ci-ok is green on the head; that renderer resumable stays empty after a restart until ticket 06 was confirmed only by reading.

Code: `docs/features/autopilot-faults.md:132-132` · key lines: 132

```md
**Discard** writes `run-stopped` with the reason `discarded` into the cut-off run's journal, with the Tickets of its Wave in work.
```

Code: `src/main/autopilot/journal.ts:230-230` · key lines: 230

```ts
export const ESTIMATE_RUNS = 30
```
