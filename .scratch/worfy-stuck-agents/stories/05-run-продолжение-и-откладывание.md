# Code story — worfy-stuck-agents 05: Run: продолжение застрявшего Ticket-а, откладывание и остановка `main-red`

Kind: pr · Epic: worfy-stuck-agents · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 01 цикл Autopilot (`src/shared/autopilot/cycle.ts`) умеет лестницу: эффект `continue-tickets`,
эффект `set-aside` и остановку `main-red`. Но `run.ts` звал `initialCycle` без потолка (по умолчанию 0), поэтому Run
по-прежнему останавливался на первом застрявшем Ticket-е с `wave-unfinished` или `no-progress`. Маркер красного main,
который пишет `land` (Ticket 02), Run не читал. Этот PR даёт Run-у потолок 2 и исполняет оба эффекта: продолжение уходит
как следующая Wave с Ticket-ом как `resumable`, просьба отложить — как сообщение Orchestrator-у, а красный main
останавливает Run с `main-red`.

- Требование: [Что происходит](../issues/05-run-продолжение-и-откладывание.md#что-происходит)

## 2. Тексты лестницы — только факты worfy

Code: `src/shared/autopilot/continuation.ts:40-49` · key lines: 43, 46, 48

```ts
export function setAsideText(input: { epic: string; tickets: readonly number[]; attempts: number; cause: ContinuationCause; ticketTool?: string }): string {
  const { epic, attempts, cause } = input
  const nums = input.tickets.map(ticketNumber)
  const what = cause === 'wave-unfinished' ? 'stayed claimed' : 'came back as the same wave'
  const short = cause === 'wave-unfinished' ? 'claimed' : 'same wave'
  const tool = toolWord(input.ticketTool ?? 'ticket')
  const commands = nums.map((num) => `${tool} block ${epic} ${num} "stuck: ${short} after ${attempts} continuations" --waits owner`)
  const who = `${nums.length === 1 ? 'Ticket' : 'Tickets'} ${nums.join(', ')}`
  return `${who} ${what} after ${attempts} continuations. Run: ${commands.join('; ')}. Then end the turn.`
}
```

- Что делает: строит сообщение `set-aside` — по одной команде `ticket block <epic> <NN> "stuck: …" --waits owner` на
  Ticket и просьбу закончить ход. Рядом в том же модуле `continuationLine` строит строку над Wave
  (`Continuation 1 of 2 for ticket 05: still claimed 10 min after the turn ended.`). Входы — только номера, попытки,
  причина, минуты и путь к `ticket`; поля для `lastText` нет.
- Почему здесь: новый чистый модуль назван в Ticket-е («Что делаем», пункт 2); почему отдельный модуль, а не код в
  `run.ts`, — не записано.
- Без него: Run нечего было бы послать Orchestrator-у; `Waits: owner` — то, что пускает очередь к следующему Epic-у
  (`epic-queue.ts`).
- Требование: [Что делаем, пункт 2](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: путь к `ticket` из Harness-а quoted, только если в нём пробел или кавычка; Harness
  внутри `.app` с пробелом в имени проверен unit test-ом, настоящий путь установленного worfy — нет.

## 3. Продолжение: строки Journal и следующая Wave

Code: `src/main/autopilot/run.ts:2192-2202` · key lines: 2193, 2197, 2200, 2201

```ts
  private async continueTickets(run: Run, effect: Extract<CycleEffect, { kind: 'continue-tickets' }>): Promise<void> {
    if (await this.mainIsRed(run)) {
      await this.feed(run, { type: 'main-red' })
      return
    }
    for (const each of effect.tickets) await this.write(run, { kind: 'ticket-continued', ticket: ticketNumber(each.num), attempt: each.attempt, of: effect.of, cause: effect.cause })
    const nums = effect.tickets.map((each) => each.num)
    run.continuation = { tickets: nums, attempt: Math.max(...effect.tickets.map((each) => each.attempt)), of: effect.of, cause: effect.cause }
    run.resume = [...new Set([...run.resume, ...nums])]
    await this.sendWave(run)
  }
```

- Что делает: сначала читает маркер `main-red`; есть — событие `main-red` циклу, и Run останавливается (окно `asked`
  ещё открыто). Иначе пишет `ticket-continued` на каждый Ticket, запоминает продолжение для status line и строки над
  Wave и кладёт Ticket-ы в `run.resume` — тот же путь, каким первая Wave после Force stop подхватывает Ticket-ы в работе
  (`runWaveState`). Потолок 2 приходит из `ceiling()` в `initialCycle(..., { maxContinuations })` при старте Run-а и
  при переходе к следующему Epic-у очереди.
- Почему здесь: Ticket, «Что делаем», пункт 3: `continue-tickets` через `runWaveState` с Ticket-ами как `resumable`,
  чтение маркера перед эффектом.
- Без него: цикл просил бы продолжение, а Run молчал бы — фаза `sending` без отправленной Wave.
- Требование: [Что делаем, пункты 1 и 3](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: Wave, которую продолжают, не получает `wave-finished` — цикл его не шлёт на
  `settle-timeout`. В Run history она видна открытой до `wave-started` продолжения, как Wave перед Force stop, и не
  входит в `actual.waves`. Чтение маркера, которое бросает, считается «не красный»: Ticket идёт по лестнице дальше.

## 4. Строка продолжения не ломает slash command

Code: `src/shared/autopilot/continuation.ts:56-58` · key lines: 57

```ts
export function waveWithContinuation(text: string, line: string): string {
  return text.trimStart().startsWith('/') ? `${text}\n\n${line}` : `${line}\n\n${text}`
}
```

- Что делает: `sendWave` в `run.ts` строит строку `continuationLine` только когда `asked` цикла — продолжение, и
  передаёт её в `autopilotWave`; `launch.ts` склеивает её с командой Wave этой функцией. Команда `/worfy:epic-wave …`
  остаётся первой строкой, строка продолжения идёт после пустой строки, как аргумент skill-а.
- Почему здесь: Ticket просит строку продолжения «первой»; если поставить её перед `/worfy:epic-wave`, Claude Code не
  развернёт skill. Так же `waveBriefText` в `launch.ts` кладёт brief после команды. Это отступление от буквы Ticket-а,
  выбранное implementer-ом.
- Без него: либо skill не развернулся бы, либо Orchestrator не узнал бы, что это продолжение.
- Требование: [Что делаем, пункт 3](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: что Claude Code разворачивает skill с такой строкой после команды, проверено только по
  образцу `waveBriefText`; настоящий Claude Code в test-ах не запускается.

## 5. Просьба отложить и отказ отправки

Code: `src/main/autopilot/run.ts:2211-2231` · key lines: 2216, 2218, 2221, 2225, 2228

```ts
  private async setAside(run: Run, effect: Extract<CycleEffect, { kind: 'set-aside' }>): Promise<void> {
    if (await this.mainIsRed(run)) {
      await this.feed(run, { type: 'main-red' })
      return
    }
    for (const num of effect.tickets) await this.write(run, { kind: 'ticket-set-aside', ticket: ticketNumber(num), cause: effect.cause, attempts: effect.attempts })
    const tool = this.deps.ticketTool?.()
    const text = setAsideText({ epic: run.epic, tickets: effect.tickets, attempts: effect.attempts, cause: effect.cause, ...(tool === undefined ? {} : { ticketTool: tool }) })
    const session = run.session
    if (session === null || session.state === 'closed') {
      await this.feed(run, { type: 'session-closed' })
      return
    }
    try {
      session.send(text)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not ask the Orchestrator to set Tickets aside`, error)
      run.message = `Could not ask the Orchestrator to set Tickets aside: ${messageOf(error)}`
      await this.feed(run, { type: 'session-error', message: run.message })
    }
  }
```

- Что делает: тот же маркер `main-red` первым; потом `ticket-set-aside` в Journal и сообщение в ту же Session
  Orchestrator-а. Ход кончается как любой ход Wave — свежим чтением workflow: Ticket `blocked` с `Waits: owner` даёт
  `waits-owner` и следующий Epic очереди, Ticket всё ещё в работе — прежнюю остановку. Путь к `ticket` даёт
  `src/main/ipc/autopilot.ts` из `binDir` Harness-а.
- Почему здесь: Ticket, «Что делаем», пункт 3; review Ticket-а 01 записал, что в фазе `turn` цикл не слушает
  `send-failed`, поэтому отказ отправки идёт как `session-error` или `session-closed`.
- Без него: Run ждал бы конца хода, который не начался.
- Требование: [Что делаем, пункт 3](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: ветки `session-closed` и брошенного `send` отдельным test-ом не покрыты.

## 6. Fake Orchestrator пишет `blocked` сам

Code: `test/contract/autopilot-faults-setup.ts:448-455` · key lines: 451, 453

```ts
  // The fake Orchestrator carries out a set-aside message (`setAside: 'block'`): the `ticket block` it names.
  registry.observe((_sessionId, event) => {
    if (event.type !== 'prompt' || options.setAside !== 'block') return
    for (const match of event.text.matchAll(/\bticket block (\S+) (\d+) "([^"]*)" --waits (\w+)/gu)) {
      if (match[1] !== EPIC) continue
      setStatus(Number(match[2]), 'blocked 2026-11-05T10:00Z', { reason: match[3]!, waits: match[4]! })
    }
  })
```

- Что делает: в Fault scenarios Orchestrator — скрипт; по сообщению `set-aside` он пишет в файл Ticket-а `blocked`,
  `Blocked reason:` и `Waits:` — ровно то, что пишет настоящий `ticket block`. `setAside: 'ignore'` (сценарий 3) не
  делает ничего. `faultRun()` получил ещё `mainRed` (маркер в папке состояния gate-а) и `secondEpic` (второй Epic очереди).
- Почему здесь: ADR-0002 — worfy статус Ticket-а не пишет; Ticket, «Вне скоупа»: только fake Orchestrator пишет
  `blocked`. Файл `autopilot-faults-setup.ts` в Ticket-е не назван — `faultRun()` живёт там.
- Без него: сценарий 2 не мог бы показать, что очередь идёт ко второму Epic-у.
- Требование: [Готово, когда](../issues/05-run-продолжение-и-откладывание.md#готово-когда)
- Риски и пробелы test-ов: regex берёт `Waits` одним словом — `--waits owner.` в конце фразы иначе давал `owner.`
  (так test и был красным, пока regex не поправили).

## 7. Инвариант И9

Code: `test/autopilot-invariants.ts:289-305` · key lines: 294, 296, 301

```ts
export const ladderBounded: Rule = (_input, runs) =>
  runs.flatMap((run) => {
    const out: string[] = []
    const continued = new Map<string, number>()
    // A Run over a queue may meet the same number in two Epics: a Ticket is its Epic and number.
    for (const event of run.events) if (event.kind === 'ticket-continued') continued.set(`${event.epic}/${event.ticket}`, (continued.get(`${event.epic}/${event.ticket}`) ?? 0) + 1)
    for (const [ticket, count] of [...continued].sort(([a], [b]) => a.localeCompare(b)))
      if (count > MAX_CONTINUATIONS) out.push(`I9: ticket ${ticket} in run ${run.number}: ${count} ticket-continued, at most ${MAX_CONTINUATIONS}`)
    const stopped = stoppedOf(run)
    run.events.forEach((event, index) => {
      if (event.kind !== 'ticket-set-aside') return
      const blocked = run.events.slice(index + 1).some((later) => later.kind === 'ticket-status' && later.epic === event.epic && later.ticket === event.ticket && later.state === 'blocked')
      if (blocked || stopped === undefined || stopped.reason === event.cause) return
      out.push(`I9: ticket ${event.epic}/${event.ticket} in run ${run.number}: set aside, not blocked after it, and the run stopped with ${stopped.reason}, not ${event.cause}`)
    })
    return out
  })
```

- Что делает: по Journal каждого Run-а — не больше двух `ticket-continued` на Ticket (Ticket — это Epic и номер), а
  после `ticket-set-aside` либо `ticket-status` `blocked`, либо `run-stopped` с той же причиной. Run без `run-stopped`
  (приложение убили) вторую половину не проверяет.
- Почему здесь: Ticket, «Что делаем», пункт 6; правило в общем списке `RECOVERY_RULES`, его проверяют все Fault
  scenarios.
- Без него: лестница без потолка или отложенный Ticket, после которого Run ушёл дальше, не ловились бы ни одним
  общим правилом.
- Требование: [Что делаем, пункт 6](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: остановка `main-red` после `ticket-set-aside` нарушила бы И9; Run так не делает (маркер
  читается до строки `ticket-set-aside`), но отдельного правила на это нет.

## 8. Status line во время продолжения

Code: `src/shared/ipc/autopilot.ts:337-338` · key lines: 338

```ts
    const continuing = state.continuing
    if (continuing !== undefined) return `Wave ${state.wave} · ${continuingText({ ...continuing, tickets: continuing.tickets.map(ticketNumber) })}`
```

- Что делает: `Wave 4 · continuing 05 (1 of 2)`. Поле `continuing` снимка Run-а есть, пока Run идёт, продолжение
  отправлено (`asked` снят) и Wave не кончилась; `wave-finished` и Wave без продолжения его снимают. Фоновые задачи
  важнее: при них строка прежняя.
- Почему здесь: Ticket называет `AutopilotAction.tsx`, но тот лишь показывает `autopilotStatusLine`; сама строка
  строится в `src/shared/ipc/autopilot.ts`, поэтому правка там, а `AutopilotAction.tsx` не менялся.
- Без него: пользователь видел бы `running` и не знал, что Ticket застрял.
- Требование: [Что делаем, пункт 4](../issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: component test проверяет строку по снимку; живой Run в окне не проверялся.

## 9. Что сознательно не меняли

- `src/shared/autopilot/cycle.ts`, `src/main/gate/state.ts` — только читались (Ticket-ы 01 и 02).
- `background-stalled` и `turn-hung` — вне Epic-а и Ticket 09.
- `docs/features/ru/` — Ticket 10.
- Старые contract test-ы о других вещах (`autopilot.test.ts`, `autopilot-queue.test.ts`,
  `autopilot-background.test.ts`) получили `maxContinuations: 0`: они проверяют прежнюю остановку, не лестницу.
  `autopilot-faults-process.test.ts` о Ticket-е, оставшемся `claimed`, теперь ждёт продолжение.

## 10. Как проверено

- `node scripts/vitest-electron.mjs test/contract/autopilot-faults-ladder.test.ts` — сценарии 1–5, exit 0.
- `node scripts/vitest-electron.mjs test/contract/autopilot-faults-codex.test.ts` — сценарий 2 на fake Codex, exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` в окружении Session Autopilot — exit 1: 125 test-ов в 18 файлах вне
  этого PR (`install-stable-update`, `terminal-ai-*`, `auto-approve-*`, `harness-migrate*` и другие) падают на
  `TMPDIR` с пробелом (`Application Support`) и на `safe.bareRepository=explicit` из `GIT_CONFIG_PARAMETERS`. Те же
  18 файлов с `TMPDIR` без пробела — 17 зелёных; последний зелёный и без `GIT_CONFIG_PARAMETERS`.
- gate fast с `TMPDIR` без пробела и без `GIT_CONFIG_PARAMETERS` — exit 0, `[gate] green (fast)` (lint, typecheck,
  весь `pnpm test`); тот же gate в окружении Session — exit 2 на тех же 125 test-ах.

## Проверить себя

1. Почему строка продолжения стоит после команды Wave, а не перед ней, как просит Ticket?
   - Строки: `src/shared/autopilot/continuation.ts:56-58`
   - Ответ: текст перед `/worfy:epic-wave` не даст Claude Code развернуть skill; после команды строка идёт как её
     аргумент.
2. Что остановит Run, если маркер красного main появился, пока Run ждёт после хода Wave?
   - Строки: `src/main/autopilot/run.ts:2193-2196`
   - Ответ: маркер читается только когда цикл просит продолжение или `set-aside`; тогда `main-red` уходит циклу, пока
     `asked` открыт, и Run останавливается с `main-red`, ничего не продолжив.
3. Как Ticket, отложенный в первом Epic-е очереди, пускает Run ко второму, если worfy статус не пишет?
   - Строки: `src/shared/autopilot/continuation.ts:46-48`
   - Ответ: сообщение просит Orchestrator выполнить `ticket block … --waits owner`; свежее чтение после хода видит
     Ticket с `Waits: owner`, и Epic кончается `waits-owner`.
