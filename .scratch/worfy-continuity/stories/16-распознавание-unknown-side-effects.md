# Code story — worfy-continuity 16: Unknown side effects: распознавание внешних вызовов без результата

Kind: pr · Epic: worfy-continuity · Ticket: 16 · PR: - · Language: ru

## 1. Что было не так

Auto-continue уже отказывает в повторе, если у turn-а есть внешний вызов без `tool_result`, но видит только вызовы
верхнего уровня одной живой Session. После перезапуска worfy некому сказать, оборвался ли посреди `gh pr merge`
implementer — Subagent, чьи вызовы лежат в его собственном транскрипте. Продолжение после перезапуска (Ticket-ы 05 и
06) повторило бы такую команду без проверки.

- Требование: [Что происходит](../issues/16-распознавание-unknown-side-effects.md#что-происходит)

## 2. Одна функция на Session и на каждый Interrupted Subagent

Code: `src/shared/agent/unknown-side-effects.ts:67-79` · key lines: 70, 71, 73, 78

```ts
export function unknownSideEffects({ session, events, subagents, workflow }: UnknownSideEffectsInput): UnknownSideEffects {
  const found: SubagentSideEffects[] = []
  for (const subagent of subagents) {
    const calls = inFlight(subagentEvents(subagent.lines))
    if (calls.length > 0) found.push({ agentId: subagent.agentId, ticket: ticketOf(subagent, workflow), calls })
  }
  return { nodeId: session.nodeId, session: inFlight(events), subagents: found }
}

/** The calls externalActions reports that have no result: the ones retryDecision refuses as `in-flight`. */
function inFlight(events: readonly AgentEvent[]): ExternalAction[] {
  return externalActions(events).filter((action) => !action.done)
}
```

- Что делает: для событий Session и для транскрипта каждого Interrupted Subagent-а берёт вызовы, которые
  `externalActions` считает внешними или неклассифицированными, и оставляет те, у которых нет `tool_result`. Subagent
  без таких вызовов в ответ не попадает; Node Session берётся из её записи `live-sessions.json`.
- Почему здесь: Ticket называет новый файл `src/shared/agent/unknown-side-effects.ts` и требует одну классификацию с
  `externalActions` и отказом `in-flight`, без второй копии. Классификацию выносить не понадобилось: в собственном
  транскрипте Subagent-а у вызовов нет `parentToolUseId`, и `externalActions` считает их как есть, поэтому
  `continue-plan.ts` не тронут.
- Без него: Ticket-ы 05 и 06 не знали бы, какой Session или Ticket оставить человеку.
- Требование: [Что делаем, пункты 1, 3 и 4](../issues/16-распознавание-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: функция считает каждый вызов без результата во всех событиях, которые ей дали; оставить
  только оборванный turn — дело вызывающего (Ticket 05). Вызов, чья строка `tool_use` сама оборвана на середине, не
  прочитать: его функция не увидит.

## 3. Транскрипт Subagent-а читается целиком, рваная строка пропускается

Code: `src/shared/agent/unknown-side-effects.ts:86-88` · key lines: 87

```ts
function subagentEvents(lines: readonly string[]): AgentEvent[] {
  return parseTranscriptLines(lines).map((entry) => entry.event)
}
```

- Что делает: разбирает строки `agent-<id>.jsonl` в события, не отбрасывая записи с `isSidechain`; строка, которая
  не JSON, даёт событие `unknown` и ничего не роняет.
- Почему здесь: в файле Subagent-а все записи помечены `isSidechain`; reader транскрипта Session
  (`mainThreadEvents`) такие записи выбрасывает, и вызовы Subagent-а пропали бы.
- Без него: implementer, оборванный посреди `gh pr merge`, выглядел бы чистым.
- Требование: [Готово, когда, пункт 3](../issues/16-распознавание-unknown-side-effects.md#готово-когда)
- Риски и пробелы test-ов: если оборвана строка с `tool_result`, вызов считается без результата — это безопасная
  сторона: человек посмотрит лишний раз.

## 4. Ticket Subagent-а — по его Binding-у

Code: `src/shared/agent/unknown-side-effects.ts:91-95` · key lines: 92, 93, 94

```ts
function ticketOf(subagent: InterruptedSubagent, workflow: BindingWorkflow | undefined): TicketRef | null {
  const signals = extendSignals(emptySignalState(), subagent.lines, { subagent: true }).signals
  const binding = resolveBinding({ manual: subagent.manual, launch: subagent.launch, signals, subagent: true }, workflow)
  return binding?.target.kind === 'ticket' ? { epic: binding.target.epic, num: binding.target.num } : null
}
```

- Что делает: собирает сигналы Binding-а из транскрипта Subagent-а (`ticket claim`, путь Ticket-а в его задаче,
  `/ship-ticket`) и разрешает Binding теми же правилами, что renderer, с ручным и launch Binding-ом из
  `bindings.json`, если вызывающий их передал. Binding к Epic-у и отсутствие Binding-а дают Ticket `null`.
- Почему здесь: Ticket требует пары «Ticket — вызовы» по Binding-у (`src/shared/binding/resolve.ts`); порядок правил
  — `BINDING_RULES`, его функция не меняет.
- Без него: вызовы нашлись бы, но Ticket-ы 06 и 07 не знали бы, какой Ticket не брать в продолженную Wave и где
  ставить метку.
- Требование: [Что делаем, пункт 2](../issues/16-распознавание-unknown-side-effects.md#что-делаем)
- Риски и пробелы test-ов: Binding Subagent-а-Codex не проверен: у Codex-Subagent-ов нет файлов транскрипта.

## 5. Что сознательно не меняли

- `src/shared/agent/continue-plan.ts`: `externalActions` и `retryDecision` не тронуты; Ticket 04 импортирует их
  параллельно.
- Решений функция не принимает и ничего не пишет: продолжение — Ticket-ы 05 и 06, метка и toast — Ticket 07.
  Документация не меняется: поведения, видного человеку, нет.

## 6. Как проверено

- `pnpm test test/unit/unknown-side-effects.test.ts` — exit 0 (80 test-ов, из них 66 — таблица вызовов из
  `test/unit/continue-plan.test.ts`, прочитанных и как события Session, и как строки транскрипта Subagent-а).
- 18 мутантов, на каждом краснеет хотя бы один test: без фильтра `done` и с обратным фильтром, отбрасывание записей
  `isSidechain`, `subagent: false` в сигналах и в Binding-е, без workflow, без ручного и без launch Binding-а, Epic
  как Ticket, Subagent без вызовов в ответе, пустые и все вызовы Session, чужой `nodeId`, обратный порядок, потерянная
  последняя строка; в `continue-plan.ts` — `push` не внешний, Agent без своей ветки, `Read` внешний.
- `pnpm lint` и `pnpm typecheck` — exit 0. Полный `pnpm test` и gate fast на этом Mac красные (exit 1 и 2) на test-ах
  file watcher-ов и временных папок вне этого модуля: такие же test-ы красные и на `origin/main` при `fseventsd` на
  100 % CPU. Итог по полному набору — `ci-ok` на head PR.

## Проверить себя

1. Почему для транскрипта Subagent-а нельзя взять `mainThreadEvents`, как для Session?
   - Строки: `src/shared/agent/unknown-side-effects.ts:87`
   - Ответ: в файле Subagent-а каждая запись помечена `isSidechain`, а `mainThreadEvents` такие записи выбрасывает —
     вызовы Subagent-а пропали бы.
2. Что будет с вызовом `git push`, если оборвана строка с его `tool_result`?
   - Строки: `src/shared/agent/unknown-side-effects.ts:78`
   - Ответ: результат не прочитан, `done` ложно, и вызов попадает в ответ как вызов без результата — человек
     проверит его, worfy сам не повторит.
3. Какой Ticket получит Subagent, привязанный вручную к Epic-у, хотя в его задаче путь Ticket-а 16?
   - Строки: `src/shared/agent/unknown-side-effects.ts:93-94`
   - Ответ: никакой (`null`): ручной Binding сильнее пути в задаче, а Binding к Epic-у Ticket-а не называет.
