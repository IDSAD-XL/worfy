# Code story — worfy-continuity 06: Продолжение Run-а после перезапуска: тот же id, Wait дальше, Resume и Discard

Kind: pr · Epic: worfy-continuity · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После SIGKILL или выхода посреди Wave Run Autopilot-а пропадал вместе с памятью main. При следующем старте
Orchestrator-у не уходило ничего, Run history показывала старый Run «no stop in the Journal», а кнопка начинала новый
Run с новым Journal-ом. Ticket 02 уже читал состояние Run-а из Journal-а (`runCheckpoint`), Ticket 04 писал
`run-suspended` при выходе, но никто не продолжал Run.

- Требование: [Что происходит](../issues/06-продолжение-run-а.md#что-происходит)

## 2. Правило часа и cap

Code: `src/shared/autopilot/cycle.ts:324-328` · key lines: 325, 327

```ts
export function restartDecision(input: { cutAt: number; continued: readonly number[]; now: number }): 'continue' | 'cut-off' {
  if (!Number.isFinite(input.cutAt) || input.now - input.cutAt > RESTART_HOUR_MS) return 'cut-off'
  const recent = input.continued.filter((at) => input.now - at <= RESTART_HOUR_MS)
  return recent.length >= MAX_RESTART_CONTINUATIONS ? 'cut-off' : 'continue'
}
```

- Что делает: Run, оборванный больше часа назад или уже дважды продолженный сам за последний час (по строкам
  `run-continued`), сам не продолжается — ждёт Resume или Discard.
- Почему здесь: правило часа и cap записаны в Ticket-е (п. 6) и в риске 2 spec-а: продолжение, которое снова роняет
  приложение, не должно идти по кругу. Чистая функция рядом с циклом, как остальные правила Run-а.
- Без него: Run, падающий при каждом продолжении, перезапускался бы бесконечно; Run недельной давности продолжился бы
  без человека.
- Требование: [Что делаем, п. 6](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: время — по часам стены (`Date.now()` против `at` строк Journal-а); unit test
  `test/unit/autopilot-restart.test.ts` проверяет границы; переведённые часы машины test не покрывает.

## 3. Тот же Run: id, Journal, нумерация Wave, новая Session

Code: `src/main/autopilot/run.ts:2153-2173` · key lines: 2156, 2157, 2170, 2173

```ts
      run.cycle = initialCycle(checkpoint.epic, named, {
        maxContinuations: this.ceiling(),
        from: {
          wave: checkpoint.wave,
          tickets: resume,
          continued: Object.fromEntries(ladder.filter((rung) => rung.continued > 0).map((rung) => [Number(rung.ticket), rung.continued])),
          setAside: ladder.filter((rung) => rung.setAside).map((rung) => Number(rung.ticket)),
        },
      })
      run.firstWave = checkpoint.wave
      run.mode = checkpoint.mode ?? this.defaultMode()
      run.origin = await this.originOf(projectId, root)
      const startedAt = Date.parse(startedLine?.at ?? '')
      if (Number.isFinite(startedAt)) run.startedAt = startedAt
      run.resume = resume
      run.given = resume
      run.continuedFrom = { after, events: cut.events }
      run.restoredWait = checkpoint.waiting
      // The Orchestrator's session of the cut-off Wave is gone with the app: the next Wave starts a new one, with
      // wave-brief, as every Wave after a run's first does (worfy-throughput ticket 52).
      run.wavesSent = 1
```

- Что делает: продолженный Run получает цикл с номером оборванной Wave, её Ticket-ами в работе (кроме удержанных),
  лестницей продолжений; Wait из checkpoint-а; `wavesSent = 1`, чтобы следующая Wave ушла в новую Session
  Orchestrator-а с `wave-brief`. Следующая Wave получает номер оборванной + 1.
- Почему здесь: Ticket называет `continueRun(checkpoint)` в `src/main/autopilot/run.ts` и тот же цикл
  `src/shared/autopilot/cycle.ts`. Номер +1 выбран, чтобы в одном Journal-е номер Wave не повторялся: Run history
  строит отрезок Wave по ключу `wave:<n>`, и повтор номера склеил бы две Wave в одну.
- Без него: следующая Wave получила бы номер 1 второй раз или ушла бы в мёртвую SDK-сессию.
- Требование: [Что делаем, п. 1–2](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: contract test `test/contract/autopilot-faults-restart.test.ts` проверяет `wave: 2` и
  `wave-brief`; сам Run history с продолженным Run-ом здесь не проверен (файлы flight-recorder — у Ticket-а 09).

## 4. Восстановленный Wait идёт до своего until

Code: `src/main/autopilot/run.ts:2266-2275` · key lines: 2269, 2270, 2274

```ts
  private async go(run: Run, tickets: WorkflowModel['tickets']): Promise<void> {
    const wait = run.restoredWait
    run.restoredWait = null
    const until = wait === null || wait.until === null ? Number.NaN : Date.parse(wait.until)
    if (wait !== null && Number.isFinite(until) && until > this.now()) {
      this.waitRestored(run, restoredCause(wait.kind), until)
      return
    }
    await this.feed(run, { type: 'start', tickets, resume: run.resume })
  }
```

- Что делает: если при обрыве шёл Wait (Limits, Start window, budget, повтор) и его `until` ещё впереди, Run ждёт до
  него, и только потом цикл получает `start`; иначе Wave уходит сразу.
- Почему здесь: Ticket, п. 2; место — там, где Run получает Orchestrator и начинает цикл, общее для старта и
  продолжения.
- Без него: после перезапуска во время Wait Limits команда Wave ушла бы сразу и упёрлась бы в те же Limits.
- Требование: [Что делаем, п. 2](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: contract test покрывает Wait Limits на часах test-а; Wait Start window и budget идут тем же
  путём, отдельного test-а у них нет.

## 5. Ticket-ы, которые ждут человека

Code: `src/main/autopilot/held-tickets.ts:103-114` · key lines: 106, 110, 112

```ts
  const found = unknownSideEffects({ session, events: lastTurn(mainThreadEvents(parseTranscriptLines(lines))), subagents, workflow: cut.workflow })
  const wave = new Set(cut.tickets)
  const all = (): number[] => [...wave].sort((a, b) => a - b)
  if (found.session.length > 0) return all()
  const held = new Set<number>()
  for (const subagent of found.subagents) {
    const ticket = subagent.ticket
    if (ticket === null) return all()
    // A Subagent of another Ticket is no implementer of this Wave (the session may be older than the Wave).
    if (ticket.epic === cut.epic && wave.has(ticket.num)) held.add(ticket.num)
  }
  return [...held].sort((a, b) => a - b)
```

- Что делает: по транскрипту Session-а Orchestrator-а оборванной Wave и её Subagent-ов функция Ticket-а 16 находит
  внешние вызовы без результата. Ticket, чей implementer держал такой вызов, не идёт в Wave; вызов самого
  Orchestrator-а или Subagent-а без Ticket-а держит всю Wave.
- Почему здесь: Ticket, п. 3 (проверка до Wave функцией Ticket-а 16). Отдельный файл в `src/main/autopilot/`, потому
  что чтение файлов транскрипта — дело main, а `unknownSideEffects` чистая.
- Без него: `gh pr merge`, который мог уже пройти, ушёл бы ещё раз в продолженной Wave.
- Требование: [Что делаем, п. 3–4](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: читаются только транскрипты Claude Code; на Codex не удерживается ничего. Транскрипта нет —
  ничего не удержано.

## 6. Resume и Discard только с Full access

Code: `src/renderer/canvas/actions/AutopilotAction.tsx:863-877` · key lines: 863, 866

```tsx
          {!cutOff || readOnly !== null ? null : (
            <LineButtons
              enabled={!acting}
              title={null}
              buttons={(['resume', 'discard'] as const).map((how) => ({
                testId: `autopilot-${how}`,
                label: how === 'resume' ? 'Resume' : 'Discard',
                hint: how === 'resume' ? RESUME_TITLE : DISCARD_TITLE,
                run: () => {
                  setActing(true)
                  void decideCutOff(projectId, how).finally(() => setActing(false))
                },
              }))}
            />
          )}
```

- Что делает: у строки `cut off by restart · 14:05` стоят Resume и Discard; на Read only их нет. Каналы
  `autopilot.resume` и `autopilot.discard` помечены `write`, так что Linked machine с Read only не может их вызвать
  и в обход кнопок.
- Почему здесь: Ticket называет `AutopilotAction.tsx` и ADR-0066 (Resume и Discard — как Start Autopilot).
- Без него: Read only на Linked machine мог бы продолжить или отбросить чужой Run.
- Требование: [Что делаем, п. 6–7](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: `test/unit/autopilot-cut-off-line.test.tsx` проверяет кнопки, toast и Read only;
  `test/unit/link-access.test.ts` — пометку каналов. Снимок строки — в e2e, который здесь не запускался.

## 7. И6: новый Journal — только после остановки

Code: `test/autopilot-invariants.ts:296-300` · key lines: 299

```ts
export const startsAgain: Rule = (input, runs) => {
  const out: string[] = []
  runs.slice(0, -1).forEach((run) => {
    if (stoppedOf(run) === undefined) out.push(`I6: run ${run.number} has no run-stopped, yet run ${run.number + 1} began a new journal instead of continuing it`)
  })
```

- Что делает: Journal начинается, только если у предыдущего есть `run-stopped` (остановка или Discard). И4 требует
  `run-continued` с ожидаемым `after`, И8 позволяет рваной строке убитого приложения стоять прямо перед
  `run-continued`.
- Почему здесь: Ticket, п. 9.
- Без него: регресс к старому поведению — новый Run рядом с оборванным — прошёл бы все Fault scenario-и.
- Требование: [Что делаем, п. 9](../issues/06-продолжение-run-а.md#что-делаем)
- Риски и пробелы test-ов: шесть fixture-ов «убит» и «приостановлен» теперь заканчиваются до старта (без нового
  Journal-а); новые fixture-ы `continued-after-crash` и `i6-new-journal-over-cut-off` проверяют продолжение и
  нарушение И6.

## 8. Что сознательно не меняли

Замки оборванной Wave worfy не снимает. `worktree-lock` Harness-а только советует: он не блокирует, а только предупреждает
новую Session, и живёт под `~/.claude`, куда worfy не пишет (ADR-0005). e2e-замок в `/tmp` следующий запуск снимает
сам, когда ему больше 30 минут. Это описано на странице `docs/features/autopilot-faults.md`.
`src/shared/autopilot/checkpoint.ts` по брифу только читается: продолженный Run, остановленный до своей первой Wave,
не отдаёт свои Ticket-ы в `resumable` после ещё одного перезапуска.

## 9. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0, `gate fast` — exit 0. Contract `test/contract/autopilot-faults-restart.test.ts`:
шесть сценариев Ticket-а (выход, падение, Wait Limits, третий старт за час с Resume, Discard, удержанный
`gh pr merge`). e2e `test/e2e/autopilot-faults.spec.ts` написан, но локально не запускался (правило владельца
2026-11-11) — его прогонит CI.

## Проверить себя

1. Почему продолженная Wave получает номер 2, а не 1, хотя её Ticket-ы те же?
   - Ответ: номер Wave не должен повторяться в одном Journal-е; продолженный Run считает Wave дальше от оборванной.
   - Строки: `src/main/autopilot/run.ts:2156`, `src/main/autopilot/run.ts:2173`
2. Implementer 01 оборвался посреди `gh pr merge`, а сам Orchestrator ничего не вызывал. Что пойдёт в Wave?
   - Ответ: только 02 — 01 удержан для человека, потому что его Subagent привязан к 01 и держит вызов без результата.
   - Строки: `src/main/autopilot/held-tickets.ts:110`, `src/main/autopilot/held-tickets.ts:112`
3. Что видит человек с Read only на Linked machine у Run-а, оборванного третий раз за час?
   - Ответ: строку `cut off by restart · HH:MM` без кнопок Resume и Discard.
   - Строки: `src/renderer/canvas/actions/AutopilotAction.tsx:863`
