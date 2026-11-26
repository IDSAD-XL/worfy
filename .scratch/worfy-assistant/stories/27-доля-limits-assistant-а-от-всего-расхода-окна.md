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

## 4. Цена Node-а Orchestrator-а — по тому же правилу

Code: `src/main/agent/orchestrator.ts:112-132` · key lines: 118, 119, 128

```ts
export class CostCounter {
  private totalValue: number
  private last: number | undefined

  /** `saved`: the cost kept in the Node's data, the last total its conversation reported. */
  constructor(saved: number) {
    this.totalValue = saved
    this.last = saved > 0 ? saved : undefined
  }

  get total(): number {
    return this.totalValue
  }

  /** A turn's `result`; answers the new total. */
  result(costUsd: number): number {
    this.totalValue += costSinceLast(this.last, costUsd)
    this.last = costUsd
    return this.totalValue
  }
}
```

- Что делает: сохранённая цена Node-а — последний итог беседы; результат возобновлённого процесса прибавляет только
  прирост. `processEnded` и его вызовы при crash и relaunch убраны.
- Почему здесь: review PR #2284 нашёл тот же изъян в `CostCounter` и попросил исправить его в этом PR тем же правилом.
- Без него: цена Node-а после relaunch, crash или перезапуска worfy прибавляла бы всё прошлое беседы ещё раз.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: сохранённая цена, в которой уже были процессы без восстановленного итога, больше итога
  беседы; следующий итог тогда считается с нуля (решение 3б «Решено без владельца»).

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

Test-ы подключения сначала красные на коде до подключения (5 упали). После review test-ы resume сначала красные на первой версии (`CostCounter` и цена Node-а — 3 упали, журнал — нет метода). После правки — зелёные; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, gate fast — exit 0.

## Проверить себя

1. Почему последний итог беседы хранится в файле журнала, а не в памяти observer-а?
   - Ответ: Claude Code восстанавливает итог при resume, а worfy после перезапуска возобновляет беседы; итог только в
     памяти пропал бы, и первый ход после перезапуска посчитал бы всё прошлое беседы снова.
   - Lines: `src/main/assistant/budget/ledger.ts:98-113`
2. Почему one-shot, narrator и Terminal AI передают `total_cost_usd` без разницы?
   - Ответ: у каждого из них процесс Claude Code делает один ход новой беседы, так что итог и есть цена хода.
   - Lines: `src/main/vendors/claude/one-shot.ts:177-179`
3. Что считает журнал, если итог беседы после resume меньше прошлого?
   - Ответ: весь новый итог, с нуля: процесс ничего не восстановил, и прошлый итог к нему не относится.
   - Lines: `src/main/agent/orchestrator.ts:112-132`
