# Code story — worfy-continuity 09: Run history и Work track: Wait `restart` с причиной, продолженный Run — один Run

Kind: pr · Epic: worfy-continuity · Ticket: 09 · PR: - · Language: ru

## 1. Что было не так

Ticket 02 ввёл строки Journal-а `run-suspended` и `run-continued`, но Flight Recorder их не читал: Run, продолженный
после перезапуска, на экране Run history не показывал, сколько он стоял и почему, а Wave, оборванная перезапуском,
тянулась до следующего `wave-started`. Причины Wait-а `restart` не было в `WAIT_CAUSES`. В Work track Wait-ов не было
вовсе: его факты — Run-ы, Wave-ы, turn-ы, Subagent-ы, PR, CI, gate и смены статуса.

- Требование: [Что происходит](../issues/09-wait-restart-в-run-history.md#что-происходит)

## 2. Span `restart` от `run-suspended` (или последней строки до падения) до `run-continued`

Code: `src/shared/flight-recorder/from-journal.ts:391-402` · key lines: 394, 395, 400

```ts
      case 'run-continued': {
        // The restart began at the line before (run-suspended, or the last one before a crash) and ended the
        // Orchestrator's turn and tasks there; the Limits, Start window, budget and retry Waits go on.
        const from = inRun[index - 1]?.at ?? at
        for (const wait of [tasks, gate, busy]) if (wait !== null) close(wait, from)
        tasks = null
        gate = null
        busy = null
        const after = text(event.after)
        close(open('restart', from, after === undefined ? [] : [after]), at)
        break
      }
```

- Что делает: на каждой `run-continued` закрывает Wait `restart` с началом в строке перед ней — это `run-suspended`, а
  после падения последняя записанная строка — и концом в `run-continued`; деталь — `after` (`quit`, `update`,
  `shutdown`, `crash`). Wait-ы фоновых задач, занятого Orchestrator-а и gate queue кончаются в начале перезапуска;
  Limits, Start window, budget и retry идут дальше.
- Почему здесь: файл и границы Span-а названы в Ticket-е; то, что Wait Limits, Start window и budget идёт дальше со своим
  сроком, записано в spec («Что видит пользователь», п. 6). Почему закрываются Wait-ы фоновых задач, занятого
  Orchestrator-а и gate queue — не записано в Ticket-е: решение этой правки (процессы Claude Code выходят при выходе
  worfy, spec п. 4), иначе Wait `background-tasks` тянулся бы через перезапуск до конца Run-а.
- Без него: продолженный Run показывает разрыв без объяснения, а `run-suspended` без продолжения и с ним выглядят
  одинаково до `run-continued`.
- Требование: [Что делаем, п. 1–3](../issues/09-wait-restart-в-run-history.md#что-делаем)
- Риски и пробелы test-ов: `run-suspended` без `run-continued` Wait-а не даёт — Run остаётся `cut-off`, как раньше
  (test). Если после падения `run-continued` пишется сразу за рваной строкой, начало — последняя целая строка. Wait
  `api-retry`, открытый при выходе, идёт дальше, как `retry` в `run-suspended.wait`; отдельного test-а на это нет.

## 3. Wave в работе обрывается там, где начался перезапуск

Code: `src/shared/flight-recorder/from-journal.ts:307-310` · key lines: 309, 310

```ts
      // Its last line: before the next wave-started, else up to run-stopped or the end of the file; a restart cuts it off where it began.
      const next = starts[n + 1]
      const restart = restarts.find((cut) => cut >= index)
      const through = Math.min(next === undefined ? events.length - 1 : next - 1, stopIndex === -1 ? events.length - 1 : stopIndex, restart ?? Infinity)
```

- Что делает: Wave без `wave-finished` видна в последний раз не позже строки, где начался перезапуск; модель обрезает
  её там как `cut-off`. Wave, которую продолженный Run довёл до `wave-finished`, этим не затронута.
- Почему здесь: не записано в Ticket-е; spec говорит, что после продолжения следующая Wave уходит в новую Session, а
  Ticket-ы оборванной Wave идут в ней как продолженные — без этой строки оборванная Wave накрывала бы весь
  перезапуск и всё до следующего `wave-started`.
- Без него: на дорожке Wave-ов оборванная Wave тянется через Wait `restart`.
- Требование: [Что делаем, п. 3](../issues/09-wait-restart-в-run-history.md#что-делаем)
- Риски и пробелы test-ов: если продолжение пошлёт Wave с тем же номером, что у оборванной, две Wave-ы делят ключ
  Span-а `wave:<n>` в модели; что пишет продолжение, решает Ticket 06, здесь это не проверено.

## 4. Подпись `restart (update)` на дорожке Wait-ов

Code: `src/renderer/flight-recorder/span-words.ts:102-106` · key lines: 104, 105

```ts
    case 'wait': {
      if (span.waitCause === null) return span.name
      const after = span.waitCause === 'restart' && span.reason !== null ? RESTART_AFTER.exec(span.reason) : null
      return after === null ? WAIT_WORDS[span.waitCause] : `${WAIT_WORDS.restart} (${after[1]})`
    }
```

- Что делает: имя Wait-а `restart` на экране — `restart (<причина>)`; Timeline добавляет к нему длительность, и подпись
  бара читается `restart (update) · 3m 00s`. Причину берёт из `reason` Span-а (`restart: update`), который строит
  `spans.ts` из детали Wait-а.
- Почему здесь: файл назван в Ticket-е; имя Span-а на экране для Timeline и панели деталей даёт `displayName`.
- Без него: бар назывался бы просто `restart`, без причины.
- Требование: [Что делаем, п. 4](../issues/09-wait-restart-в-run-history.md#что-делаем)
- Риски и пробелы test-ов: длительность пишет общий `formatDuration` (`3m 00s`), а не «3 min» из примера Ticket-а — как
  у всех баров Run history; это отличие от буквы Ticket-а.

## 5. Сервис Work track отдаёт Wait `restart` фактом Run-а

Code: `src/main/work-track/service.ts:222-226` · key lines: 223, 225

```ts
      for (const wait of journal.waits) {
        if (wait.cause !== 'restart' || wait.end === null) continue
        const title = wait.detail === undefined ? 'restart' : `restart (${wait.detail})`
        facts.push({ id: `wait:${summary.run}:${wait.id}`, kind: 'wait', start: wait.start, end: wait.end, outcome: 'ok', session: null, parent: runId, epic, source: 'journal', title })
      }
```

- Что делает: каждый Wait `restart` Journal-а становится фактом нового вида `wait` с родителем-Run-ом и именем
  `restart (<причина>)`, как в Run history.
- Почему здесь: Ticket называет только `Lanes.tsx`, но данные до него не доходили — факты Run-ов строит этот сервис из
  `from-journal.ts`; сервис, вид факта (`src/shared/work-track/facts.ts`) и `SpanPanel.tsx` добавлены к следу с
  согласия Orchestrator-а.
- Без него: Work track не показывает перезапуск вовсе.
- Требование: [Что делаем, п. 4](../issues/09-wait-restart-в-run-history.md#что-делаем)
- Риски и пробелы test-ов: другие Wait-ы (Limits, фоновые задачи) в Work track по-прежнему не попадают — Ticket их не
  просит.

## 6. Дорожка «Autopilot Runs» держит Wait

Code: `src/shared/work-track/lanes.ts:29-30` · key lines: 30

```ts
/** The lane «Autopilot Runs»: the Runs, their Waves and the Waits `restart` of a continued Run (worfy-continuity ticket 09). */
const RUNS_KINDS: ReadonlySet<WorkFactKind> = new Set<WorkFactKind>(['run', 'wave', 'wait'])
```

- Что делает: модель дорожек кладёт факт `wait` на дорожку Run-ов; `Lanes.tsx` рисует его штриховкой Wait-а с подписью.
  В часах работы и на дорожках Epic-ов его нет: вид `wait` не входит в `WORK_KINDS`.
- Почему здесь: Ticket требует тот же Wait «на дорожке Run-а»; эта дорожка собирается здесь.
- Без него: факт пришёл бы в ответ, но ни одна дорожка его не нарисовала бы.
- Требование: [Что делаем, п. 4](../issues/09-wait-restart-в-run-history.md#что-делаем)
- Риски и пробелы test-ов: на дорожке Run-ов бары не раскладываются по строкам, Wait лежит поверх бара Run-а; Wave-ы
  до и после перезапуска с ним не пересекаются, потому что оборванная Wave обрезана в его начале (шаг 3).

## 7. Что сознательно не меняли

Исход `cut-off` и строка «no stop in the Journal» в `RunHistoryView.tsx` не тронуты: они остаются за Run-ом, который так
и не продолжили, и это проверяет test. Старые Journal-ы с `run-stopped` `app-quit` читаются как остановленный Run без
Wait-а `restart`. Русские страницы `docs/features/ru/` — Ticket 14.

## 8. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0 (с `TMPDIR` без пробела и без `GIT_CONFIG_PARAMETERS` сессии).
Unit `test/unit/flight-recorder-journal.test.ts`: fixture-Journal-ы Ticket-а 02 с дописанными `run-continued` — один
Run и Span `restart` с причиной и длительностью, падение, обрезка Wave, два продолжения, Run без продолжения и старый
`app-quit`; каждый был красным до правки. Unit `test/unit/flight-recorder-view.test.tsx` и
`test/unit/flight-recorder-span-names.test.tsx` — подпись `restart (update) · 3m 00s`. Contract
`test/contract/work-track-service.test.ts` и unit `test/unit/work-track-view.test.tsx` — факт `wait` от сервиса до
дорожки Run-ов.

## Проверить себя

1. С какого момента начинается Wait `restart`, если worfy упал и `run-suspended` нет?
   - Ответ: с последней строки Journal-а перед `run-continued` — это последнее, что Run успел записать.
   - Строки: `src/shared/flight-recorder/from-journal.ts:394`
2. Почему Wait Limits не кончается на перезапуске, а Wait фоновых задач кончается?
   - Ответ: Limits ждут сброса со своим сроком и после перезапуска, а фоновые задачи жили в процессах, которые выход
     worfy завершил; поэтому закрываются только `tasks`, `gate` и `busy`.
   - Строки: `src/shared/flight-recorder/from-journal.ts:392-398`
3. Почему Run, приостановленный и не продолженный, по-прежнему говорит «no stop in the Journal»?
   - Ответ: Wait `restart` строится только на `run-continued`; без неё у Run-а нет `run-stopped`, и модель обрезает его
     как `cut-off`.
   - Строки: `src/shared/flight-recorder/from-journal.ts:391`, `src/shared/flight-recorder/from-journal.ts:400`

## 9. Что нашёл review и что осталось

> VERIFIED
> Consider: .scratch/worfy-continuity/issues/09-wait-restart-в-run-history.md — evidence lines of items 1, 2, 3, 5, 6 cite cc7daa4476f5, the pre-rebase commit (not an ancestor of the head; range-diff shows the same patch as 8e5165bd9); `evidence-check` in lint still passes (medium).
> Consider: the item «Unit test of the label» has no evidence line (`ticket evidence`: 5 of 6 verified); the test exists at test/unit/flight-recorder-view.test.tsx:269-283 (low).
> Consider: the ticket says «restart (update) · 3 min», the label is «restart (update) · 3m 00s» from the shared formatDuration — same meaning; the ticket text may follow the label (low).
> Noted: src/shared/flight-recorder/from-journal.ts:307-310 — the Wave in work now ends where the restart begins (spec.md:114-116: the next Wave goes to a new Session); a Limits Wait across a restart goes on.
> Noted: from-journal.ts:391-402 — the restart ends background-task, gate-queue and busy-Orchestrator Waits and keeps Limits/retry; only Limits has a continuation test.
> Noted: the Run history screenshot the ticket asks for was not taken (no local Electron by the owner's rule); it goes to the owner's acceptance.
> Checks: vitest flight-recorder + work-track unit/contract 592 passed, 2 skipped, EXIT=0; pnpm typecheck EXIT=0; pnpm lint EXIT=0; story-check EXIT=0.
> Review depth: low — default: the profile has no review.depth.wave
> Review tokens: 79491

Code: `test/unit/flight-recorder-view.test.tsx:269-283` · key lines: 269

```tsx
  it('names a Wait `restart` by its cause on its bar, «restart (update) · 3m 00s», and in the Waits by cause; the continued Run reads as stopped, not cut off', async () => {
    const waits = [{ id: 'restart:1', cause: 'restart' as const, start: T('10:40'), end: T('10:43'), detail: 'update', startSource: 'journal' as const, endSource: 'journal' as const }]
    const view = viewOf(smallFacts({ waits }))
    await show('p-1', [smallItem()], { [SMALL_RUN]: view })
    const bar = document.querySelector<HTMLElement>('[data-span-id="wait:restart:1"]')
    expect(bar?.title.split('\n')[0]).toBe('restart (update)')
    expect(bar?.title.split('\n')).toContain('Reason: restart: update')
    const label = rowOf('wait:restart:1').querySelector<HTMLElement>(`[data-label-for="${CSS.escape('wait:restart:1@0')}"]`)
    expect(label?.textContent).toBe(`restart (update) · ${formatDuration(3 * 60_000)}`)
    expect(label?.textContent).toBe('restart (update) · 3m 00s')
    const row = screen.getByTestId('run-history-waits').querySelector<HTMLElement>('[data-cause="restart"]')
    expect(row?.querySelector('.w-fr-total__name')?.textContent).toBe('restart')
    expect(view.timeline.spans.filter((span) => span.kind === 'run')).toHaveLength(1)
    expect(screen.getByTestId('run-history-header').textContent).not.toContain('no stop in the Journal')
  })
```

Code: `src/shared/flight-recorder/from-journal.ts:307-310` · key lines: 307

```ts
      // Its last line: before the next wave-started, else up to run-stopped or the end of the file; a restart cuts it off where it began.
      const next = starts[n + 1]
      const restart = restarts.find((cut) => cut >= index)
      const through = Math.min(next === undefined ? events.length - 1 : next - 1, stopIndex === -1 ? events.length - 1 : stopIndex, restart ?? Infinity)
```
