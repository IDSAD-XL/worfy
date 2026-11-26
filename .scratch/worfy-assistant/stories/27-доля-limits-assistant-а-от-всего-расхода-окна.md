# Code story — worfy-assistant 27: Доля Limits Assistant-а считается от всего расхода окна

Kind: pr · Epic: worfy-assistant · Ticket: 27 · PR: - · Language: ru

## 1. Что было не так

Журнал расхода Assistant-а оценивает его долю окна Limits как процент окна × цена вызовов Assistant-а / (цена вызовов
Assistant-а + цена остальных ходов worfy). Цену остальных ходов должен был приносить `noteOtherTurn`, но его никто не
звал. Поэтому после первого же вызова Assistant-а оценка равнялась всему проценту окна.

- Требование: [Что происходит](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-происходит)

## 2. Observer реестра: разница с прошлым `result` процесса

Code: `src/main/agent/turn-cost.ts:54-82` · key lines: 62, 63, 76

```ts
export function turnCostObserver(note: TurnCostSink = noteTurnCost): (sessionId: string, event: AgentEvent) => void {
  // The last `result` figure of each Session's current process.
  const last = new Map<string, number>()
  return (sessionId, event) => {
    switch (event.type) {
      case 'result': {
        const before = last.get(sessionId) ?? 0
        // A smaller figure than the last one can only come from a new process, which counts from zero.
        const turn = event.costUsd < before ? event.costUsd : event.costUsd - before
        last.set(sessionId, event.costUsd)
        if (turn > 0) note(turn)
        break
      }
      case 'renamed': {
        // The Session goes on under its Vendor session's id, in the same process.
        const before = last.get(event.from)
        last.delete(event.from)
        if (before !== undefined) last.set(sessionId, before)
        break
      }
      case 'state':
        // A new process starts (`starting`), or the process is gone: the next result counts from zero.
        if (event.state === 'starting' || event.state === 'error' || event.state === 'closed') last.delete(sessionId)
        break
      default:
        break
    }
  }
}
```

- Что делает: для каждой Session помнит последнюю цифру `total_cost_usd` её процесса и отдаёт в sink только прирост.
  Новый процесс (`starting`, `error`) и меньшая цифра считаются с нуля; `renamed` переносит цифру на новый id.
- Почему здесь: Ticket требует цену хода, а не процесса (пункт 3 «Что строить»), по правилу `CostCounter`; `starting`
  и `error` добавлены, потому что Session сообщает их перед каждым новым процессом и при его смерти, а `system/init`
  Claude Code шлёт на каждый ход (`test/fixtures/sdk-messages/controls.jsonl`).
- Без него: каждый ход длинной Session-и считал бы заново все прошлые ходы её процесса.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: Session другого Vendor-а, который начнёт отдавать цену и не сообщит `starting` перед новым
  процессом, попадёт на правило меньшей цифры; сейчас Codex отдаёт 0.

## 3. Реестр приложения подключает observer при создании

Code: `src/main/agent/app-registry.ts:102-103` · key lines: 102

```ts
    registry.observe(turnCostObserver())
    exposeBrowserToolsForFakeAgent(registry)
```

- Что делает: все Session-ы реестра — Orchestrator, Session Node-ы, Session-ы Autopilot-а, Product Session — отдают
  цену ходов через один observer, с первого события.
- Почему здесь: Ticket называет `app-registry.ts` местом, где приложение собирает реестр, и предлагает один observer
  реестра (пункт 4 «Что строить»).
- Без него: Session-ы реестра — основной расход — в журнал не попадали бы.
- Требование: [Где в коде](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#где-в-коде)
- Риски и пробелы test-ов: test проверяет, что observer получает события Session-и реестра приложения; полный путь
  до `usage.json` в приложении проверен только по частям.

## 4. Запросы вне реестра: один процесс — один ход

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

## 5. Sink направляет приложение

Code: `src/main/index.ts:202-204` · key lines: 204

```ts
      // The cost of every turn worfy runs other than the Assistant's own goes to the Assistant's usage ledger, for its
      // share of the Limits windows (worfy-assistant ticket 27, src/main/agent/turn-cost.ts): before the first Session.
      setTurnCostSink((costUsd) => appAssistantUsage().noteOtherTurn(costUsd))
```

- Что делает: при старте приложения все цены идут в `noteOtherTurn` журнала Assistant-а.
- Почему здесь: решение 2 «Решено без владельца» в Ticket-е: модуль `agent` не импортирует Assistant, а test-ы без sink-а
  не пишут в настоящий журнал.
- Без него: observer и читатели работали бы впустую.
- Требование: [Что строить](../issues/27-доля-limits-assistant-а-от-всего-расхода-окна.md#что-строить)
- Риски и пробелы test-ов: сама строка `index.ts` test-ом не покрыта: старт приложения проверяет e2e, который по
  правилу владельца локально не гонялся.

## 6. Что сознательно не меняли

Session Assistant-а (`src/main/assistant/session/runner.ts`) и проверка источника
(`src/main/assistant/sources/connector-check.ts`) не тронуты: они идут мимо реестра и мимо `noteOneTurnResult`, их цену
пишет только `noteCall`. Русская страница `docs/features/ru/assistant.md` не правилась (ADR-0088).

## 7. Как проверено

Новые test-ы подключения сначала красные на прежнем коде (5 упали). После правки — зелёные; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, gate fast — exit 0.

## Проверить себя

1. Почему observer реестра обнуляет цифру на `state: starting`, хотя уже есть правило «меньшая цифра — новый процесс»?
   - Ответ: первый ход нового процесса может стоить больше всего старого процесса; тогда правило меньшей цифры
     посчитало бы только разницу и потеряло часть цены.
   - Lines: `src/main/agent/turn-cost.ts:54-82`
2. Почему one-shot, narrator и Terminal AI передают `total_cost_usd` без разницы?
   - Ответ: у каждого из них процесс Claude Code делает один ход, так что цифра процесса и есть цена хода.
   - Lines: `src/main/vendors/claude/one-shot.ts:177-179`
3. Почему ход Session Assistant-а не попадает в «остальные ходы»?
   - Ответ: она запускается не через реестр и её читатель не зовёт `noteOneTurnResult`; её цену пишет `noteCall`.
   - Lines: `src/main/agent/app-registry.ts:102-103`
