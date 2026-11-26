# Code story — worfy-assistant 27: Доля Limits Assistant-а считается от всего расхода окна

Kind: pr · Epic: worfy-assistant · Ticket: 27 · PR: - · Language: ru

## 1. Что было не так

Журнал расхода Assistant-а оценивает его долю окна Limits как процент окна × цена вызовов Assistant-а / (цена вызовов
Assistant-а + цена остальных ходов worfy). Цену остальных ходов должен был приносить `noteOtherTurn`, но его никто не
звал. Поэтому после первого же вызова Assistant-а оценка равнялась всему проценту окна.

- Требование: [Что происходит](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-происходит)

## 2. Цена хода Session-а — прирост итога её беседы, итог хранит журнал

Code: `src/main/assistant/budget/ledger.ts:98-113` · key lines: 100, 103, 109

```ts
  noteOtherTotal(conversationId: string, totalUsd: number): void {
    if (!Number.isFinite(totalUsd)) return console.warn(`worfy: the cost of a turn was not noted: ${totalUsd}`)
    const last = this.ledger.otherTotals[conversationId]?.totalUsd
    if (totalUsd <= 0 || totalUsd === last) return
    const at = this.now()
    const turn = costSinceLast(last, totalUsd)
    const hour = hourKey(at)
    this.write(
      {
        ...this.ledger,
        otherCost: { ...this.ledger.otherCost, [hour]: (this.ledger.otherCost[hour] ?? 0) + turn },
        otherTotals: { ...this.ledger.otherTotals, [conversationId]: { totalUsd, at } },
      },
      at,
    )
  }
```

- Что делает: берёт `total_cost_usd` хода как итог беседы, пишет в «остальные ходы» только его прирост с прошлого
  итога той же беседы и запоминает новый итог в файле журнала (`otherTotals`). Итог меньше прошлого считается с нуля
  (`costSinceLast`, `src/main/agent/turn-cost.ts:38-40`).
- Почему здесь: Ticket требует цену хода, а не процесса (пункт 3 «Что строить»). Review PR #2284 (линза correctness)
  показал, что Claude Code при resume восстанавливает итог беседы из записей `cost-state` транскрипта; итог в файле
  журнала переживает новый процесс, новую Session той же беседы и перезапуск worfy — решение 3 «Решено без владельца».
- Без него: каждый relaunch, crash, Restart или перезапуск worfy считал бы всё прошлое беседы ещё раз, и доля
  Assistant-а падала бы почти до нуля.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: fake agent только изображает восстановленный итог; что Claude Code восстанавливает его,
  проверено по записям `cost-state` транскрипта, test-а на настоящем Claude Code нет. Беседа, возобновлённая после
  8 дней без ходов, считается заново.

## 3. Один observer реестра отдаёт итоги бесед

Code: `src/main/agent/turn-cost.ts:72-79` · key lines: 76, 77

```ts
export function turnCostObserver(): (sessionId: string, event: AgentEvent) => void {
  return (sessionId, event) => {
    // A Claude Session's id is its conversation's (the SDK session id) from its first init on: `renamed` brings it
    // there before the first result, and again whenever the conversation goes on under a new id.
    if (event.type === 'result' && event.costUsd > 0) tell((to) => to.conversationTotal(sessionId, event.costUsd))
    else if (event.type === 'renamed') tell((to) => to.renamed(event.from, sessionId))
  }
}
```

- Что делает: все Session-ы реестра — Orchestrator, Session Node-ы, Session-ы Autopilot-а, Product Session — отдают
  каждый `result` как итог беседы под её id, а смену id в том же процессе — как продолжение беседы. Реестр приложения
  подключает его при создании (`src/main/agent/app-registry.ts:102`).
- Почему здесь: Ticket предлагает один observer реестра (пункт 4 «Что строить») и называет `app-registry.ts` местом,
  где приложение собирает реестр.
- Без него: Session-ы реестра — основной расход — в журнал не попадали бы.
- Требование: [Где в коде](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#где-в-коде)
- Риски и пробелы test-ов: `result` до первого init (ошибка входа) придёт под временным id; его цена обычно 0.

## 4. Цена Node-а Orchestrator-а — по тому же правилу, с последним итогом в данных Node-а

Code: `src/main/agent/orchestrator.ts:112-146` · key lines: 124, 125, 141

```ts
export class CostCounter {
  private totalValue: number
  private last: number | undefined
  /** The Node's data has a cost but no last report (saved before reportedUsd): the first result is the restored total. */
  private adopt: boolean

  /**
   * `saved`: the cost kept in the Node's data; `reported`: the last total its conversation reported, kept apart
   * (reportedUsd), since the two part as soon as a process restores nothing or a Node was saved by an older build.
   */
  constructor(saved: number, reported?: number) {
    this.totalValue = saved
    this.last = reported
    this.adopt = reported === undefined && saved > 0
  }

  get total(): number {
    return this.totalValue
  }

  /** The last total the conversation reported, for the Node's data; undefined before the first result of a new one. */
  get reported(): number | undefined {
    return this.last
  }

  /** A turn's `result`; answers the new total. */
  result(costUsd: number): number {
    // shortcut: without a saved report, the first result's own turn is not added (its share of the restored total is
    // unknown); a Node saved by this build always has the report.
    if (!this.adopt) this.totalValue += costSinceLast(this.last, costUsd)
    this.adopt = false
    this.last = costUsd
    return this.totalValue
  }
}
```

- Что делает: новый процесс продолжает от последнего итога беседы, который данные Node-а хранят отдельным полем
  `reportedUsd` (`src/shared/ipc/orchestrator.ts`); прибавляется только прирост. Node без поля (сохранён старым кодом)
  берёт первый `result` после старта как восстановленный итог. `processEnded` и его вызовы при crash и relaunch убраны.
- Почему здесь: review PR #2284 нашёл тот же изъян в `CostCounter` и попросил исправить его в этом PR тем же правилом;
  второй раунд review показал, что сохранённая цена Node-а не равна итогу беседы после сбоя, — решение 3б «Решено без
  владельца».
- Без него: цена Node-а после relaunch, crash, перезапуска worfy или открытия Orchestrator-а прибавляла бы прошлое
  беседы снова, и после каждого перезапуска — ещё раз.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: у Node-а старого кода ход первого `result` после старта в цену не входит; Roll back на
  прежнюю сборку оставляет `reportedUsd` старым — решение 3б.

## 5. Запросы вне реестра: один процесс — один ход

Code: `src/main/vendors/claude/one-shot.ts:177-179` · key lines: 178

```ts
    if (!isRecord(message) || message.type !== 'result') continue
    noteOneTurnResult(message)
    if (message.subtype !== 'success' || message.structured_output === undefined) {
```

- Что делает: `readOneShot` отдаёт цену `result` как есть — в том числе ответа с ошибкой. Так же сделано у narrator-а
  (`src/main/vendors/claude/narrator.ts:110`) и у Terminal AI (`src/main/terminal-ai/assist.ts:516`).
- Почему здесь: Ticket называет `readOneShot` единственным местом чтения `result` всех one-shot, а narrator и Terminal
  AI — отдельными запросами вне реестра; у каждого процесс на один ход, поэтому разница не нужна.
- Без него: черновик профиля, Code story, narrator и Terminal AI не попадали бы в «остальные ходы».
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: если Terminal AI начнёт держать один процесс на несколько запросов, ему понадобится
  разница, как у реестра.

## 6. Sink направляет приложение

Code: `src/main/index.ts:202-204` · key lines: 204

```ts
      // The cost of every turn worfy runs other than the Assistant's own goes to the Assistant's usage ledger, for its
      // share of the Limits windows (worfy-assistant ticket 27, src/main/agent/turn-cost.ts): before the first Session.
      setTurnCostSink(ledgerTurnCostSink(appAssistantUsage))
```

- Что делает: при старте приложения все цены идут в журнал Assistant-а: цена хода — в `noteOtherTurn`, итог беседы — в `noteOtherTotal`.
- Почему здесь: решение 2 «Решено без владельца» в Ticket-е: модуль `agent` не импортирует Assistant, а test-ы без sink-а
  не пишут в настоящий журнал.
- Без него: observer и читатели работали бы впустую.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: сама строка `index.ts` test-ом не покрыта: старт приложения проверяет e2e, который по
  правилу владельца локально не гонялся.

## 7. Что сознательно не меняли

Session Assistant-а (`src/main/assistant/session/runner.ts`) и проверка источника
(`src/main/assistant/sources/connector-check.ts`) не тронуты: они идут мимо реестра и мимо `noteOneTurnResult`, их цену
пишет только `noteCall`. Русская страница `docs/features/ru/assistant.md` не правилась (ADR-0088).

## 8. Как проверено

Test-ы подключения сначала красные на коде до подключения (5 упали). После review test-ы resume сначала красные на первой версии (`CostCounter` и цена Node-а — 3 упали, журнал — нет метода). Второй раунд review: test-ы `CostCounter` через перезапуск (Node старого кода, resume без восстановленного итога) и схема данных Node-а сначала красные (4 упали). После правки — зелёные; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, gate fast — exit 0.

## Проверить себя

1. Почему последний итог беседы хранится в файле журнала, а не в памяти observer-а?
   - Ответ: Claude Code восстанавливает итог при resume, а worfy после перезапуска возобновляет беседы; итог только в
     памяти пропал бы, и первый ход после перезапуска посчитал бы всё прошлое беседы снова.
   - Lines: `src/main/assistant/budget/ledger.ts:98-113`
2. Почему one-shot, narrator и Terminal AI передают `total_cost_usd` без разницы?
   - Ответ: у каждого из них процесс Claude Code делает один ход новой беседы, так что итог и есть цена хода.
   - Lines: `src/main/vendors/claude/one-shot.ts:177-179`
3. Почему Node хранит последний итог беседы отдельно от своей цены?
   - Ответ: цена Node-а равна итогу беседы, только пока ничего не сломалось; после процесса без восстановленного итога
     или у Node-а старого кода она больше, и следующий итог считался бы с нуля при каждом перезапуске.
   - Lines: `src/main/agent/orchestrator.ts:112-146`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-assistant 27 (the Assistant's share of Limits counts only its own spending, not the whole window: the usage ledger and the Orchestrator Node count only the rise of a conversation's reported total, so a resumed conversation's past is not counted again), head 8187c767dad4e99af72b3ba655d074d87a870d75
>
> Gate (depth medium, three rounds — the cap):
> - Round 1, reviewer (lens: correctness) — FIX, one high, one med:
>   - high: the observer reset a registry Session's last total on 'starting' and 'error', but Claude Code restores total_cost_usd on resume, so a relaunch, Restart, crash + resume or a worfy restart counted the whole past again;
>   - med: docs/features/assistant.md wording.
> - Fix 802279f12:
>   - the ledger keeps the last total per conversation (usage.json otherTotals, pruned after 8 days); renames move it; a lower total counts from zero;
>   - the same flaw in the Orchestrator's CostCounter, fixed with the shared costSinceLast.
> - Round 2, narrow reviewer — FIX:
>   - high: CostCounter took the Node's saved costUsd as the last reported total. For Nodes saved by the old code, or after a resume that restored nothing, the cost grew on every restart or reopen (throwaway test: 0.075 shown where about 0.03 is right);
>   - low: the docs case «restored nothing» was wrong.
>   Checked fine: the ledger fix, rename, no fork possible (no forkSession; the registry refuses a duplicate id), old usage.json and rollback, atomic writes, a new conversation counted in full. A mutation putting a reset back on 'starting' or 'error' turned other-turn-costs red.
> - Fix 01db12c21:
>   - reportedUsd: a separate field of the Node data (src/shared/ipc/orchestrator.ts:33-39);
>   - CostCounter(saved, reported): a Node without the field takes its first result as the restored total and adds nothing for it (accepted cost: that one turn is left out of the Node's cost);
>   - new conversations and resets write reportedUsd 0;
>   - regression tests test/contract/orchestrator.test.ts:718-758, 4 red first;
>   - docs names only the 8-day case and a total restored only in part.
> - Round 3: diff read by the orchestrator (orchestrator.ts:112-146, :654, :807, :848, :977; the schema field is optional, so old data reads and an older build drops it) — closes the finding.
> Evidence: 10 touched unit+contract files exit 0; pnpm typecheck exit 0; gate fast green on 9d8998b4b (next commit evidence only); story-check exit 0.
> Not verified: e2e locally (owner rule); that the real Claude Code restores total_cost_usd on resume (no real Claude Code); the Windows part of the scope pc — the PC gate full after the Wave.
> - After round 3, CI run 45837838276 red on macos-e2e (1/2) and windows-e2e (3/4): test/e2e/orchestrator.spec.ts:204 expected the Node data without reportedUsd. Fix 8187c767d: the expectation stays exact, reportedUsd 0.03 (the fake agent's results are running totals 0.0125, 0.02, 0.03 of one process); diff read by the orchestrator. contract orchestrator exit 0, lint exit 0.

Code: `src/shared/ipc/orchestrator.ts:33-39` · key lines: 33

```ts
  costUsd: z.number().nonnegative().optional(),
  /**
   * The last running total the session's conversation reported (`total_cost_usd`, worfy-assistant ticket 27): Claude
   * Code restores it when it resumes the conversation, so the next result adds only its rise (CostCounter,
   * src/main/agent/orchestrator.ts). It equals costUsd only while nothing went wrong, so it is kept apart. Absent in a
   * Node saved before it: the first result after the start is taken as the restored total.
   */
```

Code: `test/e2e/orchestrator.spec.ts:204-204` · key lines: 204

```ts
    // conversation reported (worfy-assistant ticket 27). The fake agent's three results are running totals of one process
```
