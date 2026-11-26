# Code story — worfy-polish 151: Замер старта attention core на Project-е из 155 Ticket-ов и предел Auberge-test-а от замеренной базы

Kind: pr · Epic: worfy-polish · Ticket: 151 · PR: - · Language: ru

## 1. Что было не так

E2e test старта большого Project-а (`test/e2e/epic-frame.spec.ts`) стоял в карантине с Ticket-а 150: на macOS runner-е
он краснел против потолка 7300 ms, который решал предел в 58 из 84 job-ов. Вторая возможная причина не была замерена:
attention core Assistant-а при первом чтении workflow переписывал свой файл на каждый item. Замер на Mac владельца:
Project e2e test-а — 682 Ticket-а, 96 из них `blocked`; ядро делало 96 записей `assistant-items.json` с проверкой zod,
51 ms (медиана) из 825 ms старта, 6 %.

- Требование: [Что происходит](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-происходит), [Замер](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#замер)

## 2. Одна запись на scope за batch

Code: `src/main/assistant/core/attention-core.ts:91-126` · key lines: 92, 102, 105, 108, 116, 125

```ts
  batch<T>(take: () => T): T {
    this.batching += 1
    let result: T
    try {
      result = take()
    } catch (error) {
      this.batching -= 1
      if (this.batching === 0) {
        try {
          this.flush()
        } catch (writeError) {
          ;(this.options.log ?? ((message, cause) => console.warn(message, cause)))('[assistant] the attention core could not write a batch whose source failed', writeError)
        }
      }
      throw error
    }
    this.batching -= 1
    if (this.batching === 0) this.flush()
    return result
  }

  /** Writes every scope a batch changed; a scope whose write fails costs only itself, and the first failure is thrown after the rest. */
  private flush(): void {
    let failure: { error: unknown } | undefined
    for (const scope of [...this.dirty]) {
      this.dirty.delete(scope)
      const file = this.scopes.get(scope)
      if (file === undefined) continue
      try {
        this.write(scope, file)
      } catch (error) {
        failure ??= { error }
      }
    }
    if (failure !== undefined) throw failure.error
  }
```

- Что делает: `batch(take)` поднимает счётчик; пока он больше нуля, `save` и запись нового scope в `load` только
  помечают scope в `dirty`. Когда внешний batch кончается, `flush` пишет каждый помеченный scope один раз и один раз
  зовёт слушателей `subscribe`. Ошибка записи одного scope не мешает остальным, первая бросается после всех. Если
  бросил сам источник, его ошибка идёт дальше, а ошибка записи после неё — в log.
- Почему здесь: Ticket называет `attention-core.ts` в «Где в коде» и просит «одно сохранение на scope за tick»;
  синхронный batch вместо `queueMicrotask`/`setImmediate` выбран, чтобы запись не терялась при выходе (`will-quit`) и
  источник видел ошибку записи в том же вызове, как раньше (см. «Итог» Ticket-а).
- Без него: каждый `ingest`/`resolve`/`expect` переписывает весь файл — квадратичная работа по числу items в main
  process до интерактивного окна.
- Требование: [Что делаем, п. 2](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем), [Правка ядра](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#правка-ядра)
- Риски и пробелы test-ов: внутри batch файл на диске отстаёт от памяти до конца `take`; падение процесса посреди
  batch теряет его изменения целиком, а не частично — test-а на падение процесса нет.

## 3. Без batch всё как раньше

Code: `src/main/assistant/core/attention-core.ts:147-150` · key lines: 148

```ts
  private save(scope: string | null, file: AttentionFile): void {
    if (this.batching > 0) this.dirty.add(scope)
    else this.write(scope, file)
  }
```

- Что делает: `save` откладывает запись, только пока идёт batch; вне batch каждое изменение пишется сразу, как до
  правки.
- Почему здесь: not recorded — выбор сохранить прежнее поведение для одиночных событий (Session, `mark`, `tick`)
  сделан в этом PR, Ticket его не называет.
- Без него: пришлось бы звать batch в каждом месте, которое меняет items, иначе одиночное событие не попало бы на диск.
- Требование: [Что делаем, п. 2](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем)
- Риски и пробелы test-ов: test «without a batch each change is written at once, as before» в
  `test/unit/assistant-attention-core.test.ts`.

## 4. Источники отдают чтение одним batch

Code: `src/main/assistant/core/sources.ts:132-135` · key lines: 134

```ts
export function workflowAttention(core: Core, projectId: string, read: WorkflowModel | WorkflowDelta): void {
  // One write of the Project's file for the whole read, not one per Ticket (worfy-polish 151).
  core.batch(() => takeWorkflowRead(core, projectId, read))
}
```

- Что делает: `workflowAttention` (и так же PR inbox, Health check report, Limits) отдаёт все события одного чтения
  внутри `core.batch`.
- Почему здесь: Ticket называет `sources.ts` в «Где в коде»; это источники, которые за один вызов отдают много
  событий. Сессии (`sessionAttention`) отдают по одному событию.
- Без него: batch есть, но первое чтение Project-а по-прежнему пишет файл 96 раз.
- Требование: [Что делаем, п. 2](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем)
- Риски и пробелы test-ов: догон Autopilot journal при старте (`install.ts`) идёт без batch — файл вне «Где в коде», и
  строк с items там единицы. После правки замер e2e: 1 запись, 9 ms вместо 51.

## 5. Что сознательно не меняли

Предел старта (`test/e2e/start-budget.ts`, потолок `RUNNER_START_CAP_MS` = 7300 ms), его unit test, карантин
`test/quarantine/epic-frame-auberge-start-macos-ci.json` до 2026-12-09 и метка `quarantined(...)` в
`test/e2e/epic-frame.spec.ts` — как на `main`: владелец 2026-11-26 выбрал вариант (б). Причина медленного старта на
runner-е не найдена; её поиск — отдельный Ticket.

- Требование: [Решено без владельца → решение владельца](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#решено-без-владельца--решение-владельца)

## 6. Как проверено

- `node scripts/vitest-electron.mjs test/unit/assistant-*.test.ts test/contract/assistant-*.test.ts` — exit 0; мутант,
  который откладывает `onItem` до конца batch, роняет test «N changes of one scope in a batch…».
- Замеры до и после — таблица в [Замер](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#замер): unit-уровень (vitest без окна) и локальные e2e с временными
  timing marks, сделанные до запрета локальных e2e.

## Проверить себя

1. Почему batch синхронный, а не отложенная запись через `setImmediate`?
   - Ответ: запись идёт в конце того же вызова `batch` — она не теряется при выходе, и ошибка записи доходит до
     источника, как раньше.
   - Строки: `src/main/assistant/core/attention-core.ts:91-109`
2. Что видит слушатель `onItem` внутри batch, а что слушатель `subscribe`?
   - Ответ: `onItem` получает каждый item сразу, как он взят; `subscribe` — один раз на scope, когда `flush` записал
     файл.
   - Строки: `src/main/assistant/core/attention-core.ts:113-126`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 151 (attention core writes each scope once per batch: one write instead of 96 on an Auberge-sized start), head a83568506508bb56bf2e0fae2ed8d0aed740ed66
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — part A (batch) MERGE with 4 lows, fixed on f07fe8392 and checked by the Orchestrator; part B (removing the 7300 ms start ceiling) went to the owner.
>
> - Owner 2026-11-26, variant (б): merge only the core fix; the start budget, RUNNER_START_CAP_MS 7300, the quarantine of the macOS e2e «Auberge-sized Project interactive in 3 s» until 2026-12-09 and its quarantined() label stay exactly as on main; the cause of the slow start goes to a separate ticket.
> - Round 2 checked by the Orchestrator: the branch diff against origin/main touches only the core, its two unit tests, the ticket and its story; the core and test patch is byte-identical to f07fe8392 after the rebase; 318 tests of the assistant, start budget and quarantine EXIT=0; gate fast green on 12a56ca92 (head adds one Evidence line); story-check ok.
> - Not verified: the Auberge e2e itself (quarantined); items 3 and 4 of the ticket are not done by the owner's choice and move to the cause ticket.
> - Noted: src/main/assistant/core/install.ts:89-97 — the Autopilot journal catch-up still ingests per line outside a batch.

Code: `src/main/assistant/core/install.ts:89-97` · key lines: 89

```ts
  for (const project of sources.projects()) {
    sources.journal.recent(project.id).then(
      guard('the Autopilot journal', (runs: JournalEvent[][]) => {
        const from = core.catchUpFrom(project.id)
        for (const line of runs.flat()) if (Date.parse(line.at) >= from) autopilotAttention(core, line)
      }),
      (error: unknown) => log(`[assistant] ${project.id}: the Autopilot journal could not be read`, error),
    )
  }
```
