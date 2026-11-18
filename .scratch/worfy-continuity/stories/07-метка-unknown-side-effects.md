# Code story — worfy-continuity 07: Unknown side effects: метка Ticket-а, toast с «Checked, include», строка Journal-а

Kind: pr · Epic: worfy-continuity · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 06 продолженный Run не берёт в Wave Ticket, чей implementer оборвался посреди внешнего вызова
(`git push`, `gh pr merge`) без результата: такой Ticket остаётся в `work` и ждёт человека. Но человек не видел, какой
Ticket удержан и почему, и не мог вернуть его одной кнопкой. Координатор выхода Ticket-а 04 ждал только вызовов
верхнего уровня Session-ов, вызовы Subagent-ов он не видел.

- Требование: [Что происходит](../issues/07-метка-unknown-side-effects.md#что-происходит)

## 2. Строка Journal-а ставит метку, «Checked, include» её снимает

Code: `src/shared/autopilot/checkpoint.ts:203-209` · key lines: 204, 205, 208

```ts
      case 'unknown-side-effects':
        marks.set(keyOf(event.epic, event.ticket), { epic: event.epic, ticket: event.ticket, actions: [...event.actions] })
        included.delete(keyOf(event.epic, event.ticket))
        break
      case 'side-effects-checked':
        if (marks.delete(keyOf(event.epic, event.ticket))) included.set(keyOf(event.epic, event.ticket), { epic: event.epic, ticket: event.ticket })
        break
```

- Что делает: Checkpoint читает две новые строки Journal-а: `unknown-side-effects` ставит метку Ticket-у (с вызовами), `side-effects-checked` снимает её и записывает Ticket во «включённые», пока его не унесёт следующая `wave-started`.
- Почему здесь: Ticket называет строку `unknown-side-effects {ticket, actions}` в `src/shared/autopilot/journal.ts` и требует, чтобы checkpoint Ticket-а 02 её читал (п. 3 «Что делаем»).
- Без него: после перезапуска метка терялась бы: состояние Run-а восстанавливается только из Journal-а.
- Требование: [Что делаем, п. 3](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы `test/unit/autopilot-checkpoint.test.ts`, describe «runCheckpoint and Unknown side effects». Порядок строк вне одного Journal-а (два Run-а одного Epic-а) покрыт только через `before.marks`.

## 3. Помеченный Ticket не бывает resumable

Code: `src/shared/autopilot/checkpoint.ts:223-226` · key lines: 223, 226

```ts
  const marked = new Set([...marks.values()].filter((mark) => mark.epic === epic).map((mark) => mark.ticket))
  const giveBack = [...included.values()].filter((each) => each.epic === epic).map((each) => each.ticket)
  const resumable =
    cutOff !== null ? [] : [...new Set([...(wave === 0 ? given : []), ...interrupted, ...carried, ...giveBack])].filter((ticket) => !marked.has(ticket)).sort(byNumber)
```

- Что делает: Помеченные Ticket-ы Epic-а вычитаются из `resumable`, что бы ни назвал `run-stopped`; включённые «Checked, include» добавляются.
- Почему здесь: правило Q4 (а) spec-а: Ticket с вызовом без результата не продолжается сам; Ticket записывает его в п. 4 «Что делаем».
- Без него: Force stop или следующий Run взяли бы помеченный Ticket обратно, и `gh pr merge` мог бы пройти второй раз.
- Требование: [Что делаем, п. 4](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: тот же unit test; contract test `test/contract/autopilot-faults-restart.test.ts` проверяет `resumable: [2]` после Force stop.

## 4. Продолженный Run: метки, затем Wave без помеченных

Code: `src/main/autopilot/run.ts:2189-2195` · key lines: 2190, 2191, 2195

```ts
      // The marks the journal holds stay; a Ticket the cut-off Wave holds now gets its own (worfy-continuity ticket 07).
      const added = await this.freshMarks(projectId, root, cut, model)
      const marks = [...marksOf(checkpoint), ...added]
      const marked = new Set(marks.filter((mark) => mark.epic === checkpoint.epic).map((mark) => mark.ticket))
      // A Ticket given back by Checked, include that no Wave carried yet goes along as the cut-off Wave's do.
      const included = checkpoint.included.filter((each) => each.epic === checkpoint.epic).map((each) => Number(each.ticket))
      const resume = [...new Set([...inWork.filter((num) => !marked.has(num)), ...included])]
```

- Что делает: При продолжении Run-а удержанные Ticket-ы (heldTickets Ticket-а 06) получают метку; продолженная Wave берёт оборванные Ticket-ы без помеченных и добавляет включённые.
- Почему здесь: файл назван в Ticket-е; Ticket 06 уже решал здесь, что продолжать.
- Без него: удержанный Ticket не попал бы в Wave, но и метки с вызовом у него бы не было: человек не знал бы, что проверять.
- Требование: [Что делаем, п. 1](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: contract test «git push held without a result» (item 1); второй обрыв продолженного Run-а держит старую метку и не пишет второй строки — contract test «a second quit of a continued Run keeps the mark of the first»; Ticket, возвращённый «Checked, include» до нового обрыва, не помечается снова за тот же вызов — contract test «a Ticket given back by Checked, include before its Run was cut off again». Сами строки `unknown-side-effects` пишутся после `run-continued` (строка 2237 того же файла).

## 5. Discard тоже ставит метку, до `run-stopped`

Code: `src/main/autopilot/run.ts:2072-2083` · key lines: 2077, 2083

```ts
    // A Ticket of the cut-off Wave with an external call without a result is no more resumable after a Discard than
    // after a continuation (worfy-continuity ticket 07): it is marked first.
    let added: SideEffectsMark[] = []
    try {
      const root = this.deps.projectRoot(projectId)
      added = await this.freshMarks(projectId, root, cut, await this.deps.workflow(root))
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not read the workflow for the external calls of the discarded Run; no Ticket is held`, error)
    }
    try {
      const journal = await this.reopen(checkpoint.run)
      for (const mark of added) await journal.append({ kind: 'unknown-side-effects', ticket: ticketNumber(mark.ticket), actions: [...mark.actions] }, mark.epic)
```

- Что делает: Discard оборванного Run-а читает те же удержанные вызовы, что и продолжение, и пишет строки `unknown-side-effects` перед `run-stopped` `discarded`; помеченный Ticket вычитается из `resumable` состояния.
- Почему здесь: not recorded.
- Без него: Discard обходил бы защиту: следующий Run взял бы Ticket с полупрошедшим `gh pr merge` и запустил бы его снова.
- Требование: [Что делаем, п. 1](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: contract test «Discard of a Run whose implementer held gh pr merge without a result» (`test/contract/autopilot-faults-restart.test.ts`) проверяет строку, `resumable: [2]`, Wave следующего Run-а без 01, метку в его состоянии и «Checked, include» через канал `autopilot.include`. Ошибка чтения workflow при Discard не держит ни одного Ticket-а (как в Ticket-е 06) и test-ом не покрыта.

## 6. Метка переживает перезапуск приложения

Code: `src/main/autopilot/run.ts:2038-2041` · key lines: 2041

```ts
    const [newest, ...older] = runs
    const checkpoint = newest === undefined ? null : runCheckpoint(newest, { before: resumableAfter([...older].reverse()) })
    if (newest === undefined || checkpoint === null) return this.state(projectId)
    if (checkpoint.cutOff === null) return this.rememberMarks(projectId, checkpoint)
```

- Что делает: При старте приложения не оборванный последний Run (он остановлен) отдаёт свои открытые метки в состояние Project-а: метка на Ticket-е, toast и «Checked, include» снова есть.
- Почему здесь: not recorded.
- Без него: после перезапуска метка оставалась бы только в Journal-е: Ticket не resumable, но человек не видит, почему, и не может вернуть его кнопкой.
- Требование: [Что делаем, п. 4](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: contract test «after a restart of the app the stopped Run keeps its mark». Переход метки в следующий Run того же Epic-а (`leftOver` и `run.marks`) — contract test про Discard; инвариант I10 в `test/autopilot-invariants.ts` проверяет каждый сценарий: помеченный Ticket не входит ни в одну `wave-started` до своего `side-effects-checked`.

## 7. «Checked, include» в идущем Run-е

Code: `src/main/autopilot/run.ts:2340-2357` · key lines: 2346, 2352, 2353, 2354

```ts
  async includeChecked(projectId: string, epic: string, ticket: number): Promise<AutopilotState> {
    const named = (mark: SideEffectsMark): boolean => mark.epic === epic && mark.ticket === ticket
    const run = this.runs.get(projectId)
    if (run !== undefined) {
      if (!run.marks.some(named) || run.journal === null) return this.state(projectId)
      try {
        await run.journal.append({ kind: 'side-effects-checked', ticket: ticketNumber(ticket) }, epic)
      } catch (error) {
        run.message = `Could not include Ticket ${ticketNumber(ticket)}: ${messageOf(error)}`
        this.publish(projectId)
        return this.state(projectId)
      }
      run.marks = run.marks.filter((mark) => !named(mark))
      if (epic === run.epic) {
        if (run.running) await run.enqueue(() => this.feed(run, { type: 'include', ticket }))
        else run.givenBack = [...new Set([...run.givenBack, ticket])]
      }
      this.publish(projectId)
```

- Что делает: Строка `side-effects-checked` пишется в Journal Run-а, метка уходит. Идущий Run передаёт циклу событие `include`, остановленный запоминает Ticket в `givenBack`.
- Почему здесь: not recorded.
- Без него: кнопка снимала бы метку только на экране: после перезапуска она вернулась бы, а Wave Ticket не взяла бы.
- Требование: [Что делаем, п. 4](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: contract test «Checked, include while the continued Run goes on» (item 2). Ветка с ошибкой записи Journal-а покрыта только unit test-ом renderer-а (тост ошибки), не contract test-ом.

## 8. Цикл: включённый Ticket идёт как продолженный

Code: `src/shared/autopilot/cycle.ts:466-469` · key lines: 466

```ts
  const next = [...new Set([...readyNums(state, tickets), ...resumedTickets(tickets, state.epic, resumeOf(state, state.included ?? []))])].sort((a, b) => a - b)
  if (next.length === 0) return nothingReady(state, tickets, [finished])
  if (sameSet(next, state.tickets)) return ladder(state, state.tickets, 'no-progress', [finished])
  return { state: { ...state, phase: 'sending' }, effects: [finished, { kind: 'send-wave' }] }
```

- Что делает: Следующая Wave собирается из готовых Ticket-ов и продолженных; включённые «Checked, include» Ticket-ы в `work` идут вместе с продолженными.
- Почему здесь: координатор разрешил правку `cycle.ts`: событие `include`, поле включённых, готовность в evaluate(); reducer остаётся чистым.
- Без него: Ticket в `work` не «готов» (readyNums берёт только open), и идущий Run остановился бы с `no-ready-wave`, не взяв его.
- Требование: [Что делаем, п. 4](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы `test/unit/autopilot-cycle.test.ts`, describe «Checked, include …»; без include — `no-ready-wave`, как раньше.

## 9. Выход ждёт вызовы Subagent-ов

Code: `src/main/quit-grace.ts:324-328` · key lines: 326, 328

```ts
  private async grace(): Promise<void> {
    // Without a reader of the Subagents nothing is awaited: Quit now right after the quit still finds the wait.
    let subagents = this.deps.subagentCalls === undefined ? [] : await this.subagentCalls()
    // A shutdown or Quit now that came during the read ends the grace before its wait began.
    if (this.shutdownNow || this.quitAsked || (this.deps.calls.open().length === 0 && subagents.length === 0)) return
```

- Что делает: Перед ожиданием координатор читает вызовы Subagent-ов без результата (unknownSideEffects Ticket-а 16 над их транскриптами) и ждёт, пока есть свои или их; дальше перечитывает каждые SUBAGENT_LOOK_MS.
- Почему здесь: Ticket называет `src/main/quit-grace.ts` и функцию Ticket-а 16 (п. 5 «Что делаем»).
- Без него: выход обрывал бы implementer-а посреди `gh pr merge`, и после перезапуска Ticket получал бы метку там, где вызов мог успеть закончиться.
- Требование: [Что делаем, п. 5](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: contract test `test/contract/autopilot-faults-quit.test.ts` (item 3), не дольше 60 с часов test-а. Читаются только файлы Subagent-ов с mtime не раньше старта приложения. Пути файлов строит `node:path`: unit test `subagentOpenCalls on Windows` проверяет их и с разделителем Windows (`path.win32`).

## 10. Toast — один раз на метку

Code: `src/renderer/autopilot/unknown-side-effects.ts:87-93` · key lines: 89, 90, 91

```ts
export function toastNewMarks(projectId: string, marks: readonly SideEffectsMark[]): void {
  for (const mark of marks) {
    if (toasted.has(markKey(projectId, mark))) continue
    toasted.add(markKey(projectId, mark))
    showSideEffectsToast(projectId, mark)
  }
}
```

- Что делает: Окно показывает toast с «Checked, include» один раз на метку; клик по метке на Ticket-е показывает его снова.
- Почему здесь: новый модуль разрешён координатором: правило eslint `react-refresh/only-export-components` не даёт экспортировать hook-и из `AutopilotAction.tsx`.
- Без него: toast всплывал бы при каждом обновлении состояния Run-а.
- Требование: [Что делаем, п. 2](../issues/07-метка-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: unit test `test/unit/autopilot-unknown-side-effects.test.tsx`; e2e в `test/e2e/autopilot-faults.spec.ts` локально не запускался (правило владельца 2026-11-11), его прогонит CI.

## 11. Что сознательно не меняли

`src/renderer/canvas/nodes/EpicFrameNode.tsx` не менялся: метка стоит на карточке Ticket-а внутри рамки Epic-а
(`TicketNode.tsx`), рамка сама ничего не рисует. Перевод страницы и термин CONTEXT.md — Ticket 14. Снимок экрана
метки и toast-а не делался: он уходит в приёмку владельцем (Ticket 15).

## 12. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0, `gate fast` — exit 0. Contract test-ы
`test/contract/autopilot-faults-restart.test.ts` и `test/contract/autopilot-faults-quit.test.ts`, unit test-ы
checkpoint-а, цикла, held-tickets, quit-grace, карточки Ticket-а и store-а меток. Каждый новый test сначала был красным. Во втором раунде каждый новый test краснел на своём мутанте (Discard без вычитания, без строки, без чтения вызовов; `rememberMarks` без действия; новый Run без меток; продолжение без меток Journal-а; повторная метка возвращённого Ticket-а; Subagent без Ticket-а ничего не держит; канал `autopilot.include` без `includeChecked`; I10 без проверки), contract-файлы restart и quit прошли 10 раз подряд.

## Проверить себя

1. Implementer 01 оборвался посреди `gh pr merge`, человек нажал Force stop. Почему следующий Run не берёт 01?
   - Ответ: метка открыта в Journal-е, а checkpoint вычитает помеченные Ticket-ы из `resumable`, пока нет `side-effects-checked`.
   - Строки: `src/shared/autopilot/checkpoint.ts:223`, `src/shared/autopilot/checkpoint.ts:226`
2. Человек нажал «Checked, include», пока Run идёт. Почему следующая Wave берёт Ticket, хотя он в `work`, а не open?
   - Ответ: цикл получает `include`, и evaluate() добавляет включённые Ticket-ы к продолженным, а не к готовым.
   - Строки: `src/main/autopilot/run.ts:2354`, `src/shared/autopilot/cycle.ts:466`
3. Quit now нажат, пока координатор ещё читает транскрипты Subagent-ов. Что не даёт выходу зависнуть?
   - Ответ: после чтения grace проверяет `quitAsked` и выходит, не начав ожидания.
   - Строки: `src/main/quit-grace.ts:328`
