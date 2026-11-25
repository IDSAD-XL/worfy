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

Code: `src/main/assistant/core/attention-core.ts:90-114` · key lines: 91, 96, 104, 108, 113

```ts
  batch<T>(take: () => T): T {
    this.batching += 1
    try {
      return take()
    } finally {
      this.batching -= 1
      if (this.batching === 0) this.flush()
    }
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
  зовёт слушателей `subscribe`. Ошибка записи одного scope не мешает остальным, первая бросается после всех.
- Почему здесь: Ticket называет `attention-core.ts` в «Где в коде» и просит «одно сохранение на scope за tick»;
  синхронный batch вместо `queueMicrotask`/`setImmediate` выбран, чтобы запись не терялась при выходе (`will-quit`) и
  источник видел ошибку записи в том же вызове, как раньше (см. «Итог» Ticket-а).
- Без него: каждый `ingest`/`resolve`/`expect` переписывает весь файл — квадратичная работа по числу items в main
  process до интерактивного окна.
- Требование: [Что делаем, п. 2](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем), [Правка ядра](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#правка-ядра)
- Риски и пробелы test-ов: внутри batch файл на диске отстаёт от памяти до конца `take`; падение процесса посреди
  batch теряет его изменения целиком, а не частично — test-а на падение процесса нет.

## 3. Без batch всё как раньше

Code: `src/main/assistant/core/attention-core.ts:135-138` · key lines: 136

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

## 5. Предел от замеренной базы, без потолка

Code: `test/e2e/start-budget.ts:18-33` · key lines: 18, 23, 32

```ts
 * There is no ceiling in ms any more (worfy-polish 151): in 58 of those 84 jobs 6 × the reference
 * was above the former 7300 ms, so the runner's speed, not the Project against its base, set the
 * budget, and a slow runner turned the test red. The cost: a delay added to every start alike
 * raises the reference with it and is caught only by START_MS, off GitHub Actions.
 */
export const START_RATIO = 6

/**
 * The budget for an Auberge-sized start, given the median one-Ticket start `referenceMs` on the
 * same machine: START_MS, except on GitHub Actions (GITHUB_ACTIONS=true), where it is START_RATIO
 * times the reference, no less than START_MS.
 */
export function startBudget(referenceMs: number, env: Readonly<Record<string, string | undefined>>): number {
  if (env.GITHUB_ACTIONS !== 'true') return START_MS
  return Math.max(START_MS, START_RATIO * referenceMs)
}
```

- Что делает: на GitHub Actions предел — 6 × медиана трёх стартов Project-а из одного Ticket-а в том же job-е, не
  меньше 3 s; константа `RUNNER_START_CAP_MS` удалена. `START_MS` и `START_RATIO` не тронуты.
- Почему здесь: Ticket, п. 3: «предел test-а на CI зависит от замеренной на том же runner-е базы, а не от потолка»,
  например отношение `N / R` против предела из распределения 84 job-ов (1.83–5.19, медиана 3.56).
- Без него: в медленный час runner-а `N` выше 7300 ms при обычном `N / R` (красные job-ы — 2.66–5.02), и test снова
  краснеет на PR-ах, которые его не трогают.
- Требование: [Что делаем, п. 3](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем), [Предел от замеренной базы](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#предел-от-замеренной-базы)
- Риски и пробелы test-ов: задержка, одинаково добавленная к каждому старту, поднимает и `R`, и `N` — на CI её больше
  не ловит ничто, только `START_MS` вне GitHub Actions. Запас 6 над наибольшим замеренным 5.19 — 1.16.

## 6. Карантин снят

Code: `test/e2e/epic-frame.spec.ts:1110-1113` · key lines: 1113

```ts
/** One-Ticket starts behind the reference on GitHub Actions: a single start on the runner varied from 909 to 1274 ms. */
const REFERENCE_STARTS = 3

test('an Auberge-sized Project is interactive within 3 s and pans and zooms smoothly over its biggest Epic', async () => {
```

- Что делает: test снова объявлен через `test`; запись `test/quarantine/epic-frame-auberge-start-macos-ci.json`
  удалена. Строка лога test-а печатает `N / R`, чтобы распределение можно было пересчитать по job-ам.
- Почему здесь: Ticket, п. 4.
- Без него: test пропускается на macOS до 2026-12-09, потом `test/unit/quarantine.test.ts` краснеет на просроченной
  записи.
- Требование: [Что делаем, п. 4](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#что-делаем)
- Риски и пробелы test-ов: что test зелёный на runner-е, покажет только job `macos-e2e` этого PR.

## 7. Как проверено

- `node scripts/vitest-electron.mjs test/unit/assistant-*.test.ts test/contract/assistant-*.test.ts test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts test/unit/e2e-start-budget.test.ts` — exit 0, 222 test-а.
- `pnpm test:e2e test/e2e/epic-frame.spec.ts` — exit 0, 8 test-ов, Auberge-старт 908 ms при пределе 3000 ms.
- Замеры до и после — таблица в [Замер](../issues/151-замер-старта-attention-core-и-предел-auberge-от-базы.md#замер).

## Проверить себя

1. Почему batch синхронный, а не отложенная запись через `setImmediate`?
   - Ответ: запись идёт в `finally` того же вызова — она не теряется при выходе, и ошибка записи доходит до источника,
     как раньше.
   - Строки: `src/main/assistant/core/attention-core.ts:90-98`
2. Что теряет CI с удалением потолка 7300 ms?
   - Ответ: задержку, одинаково добавленную к каждому старту: она поднимает базу вместе со стартом, и ловит её только
     3 s вне CI.
   - Строки: `test/e2e/start-budget.ts:18-21`
3. Что видит слушатель `onItem` внутри batch, а что слушатель `subscribe`?
   - Ответ: `onItem` получает каждый item сразу, как он взят; `subscribe` — один раз на scope, когда `flush` записал
     файл.
   - Строки: `src/main/assistant/core/attention-core.ts:101-114`
