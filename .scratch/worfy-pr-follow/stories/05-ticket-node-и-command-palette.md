# Code story — worfy-pr-follow 05: Ticket Node и Command palette — кнопка по первой причине PR с меню ▾ и строки palette

Kind: pr · Epic: worfy-pr-follow · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

На Ticket Node были видны badge открытых нитей и флаг rework, но щелчок по badge только открывал Pull requests.
Действия Fix checks, Resolve conflicts и Address comments из Ticket-а 01 (канал `actions.prFollow`, hook
`usePrFollowState`) не стояли ни на Ticket Node, ни в Command palette.

- Требование: [Что происходит](../issues/05-ticket-node-и-command-palette.md#что-происходит)

## 2. Какие действия есть у Ticket-а — одна чистая функция

Code: `src/renderer/canvas/actions/pr-follow-choices.ts:28-38` · key lines: 30, 33, 38

```ts
export function prFollowChoices(snapshot: PrInboxSnapshot | undefined, ticket: Pick<Ticket, 'epic' | 'num'>, tickets: readonly Ticket[]): PrFollowChoice[] {
  if (snapshot === undefined) return []
  const pulls = reviewsOfTicket(snapshot, ticket, tickets)?.pulls ?? []
  return pulls.flatMap((pull) => {
    const row = findRow(snapshot, pull)?.row
    return row === undefined ? [] : prFollowReasons(row, snapshot.viewer).map((action) => ({ row, action }))
  })
}

/** «Fix checks owner/web#118»: the action and its PR, as a palette row and an item of a Ticket over several PRs say it. */
export const prFollowTitle = ({ row, action }: PrFollowChoice): string => `${ACTION_LABELS[action]} ${row.repo}#${row.number}`
```

- Что делает: берёт PR-ы Ticket-а из snapshot PR inbox так же, как их считает badge нитей (`reviewsOfTicket`: строки
  `PR:` Ticket-а, иначе его ветка). Для каждого PR даёт причины в порядке `prFollowReasons` Ticket-а 01: Resolve
  conflicts, Fix checks, Address comments. Snapshot нет или PR inbox выключен — пусто.
- Почему здесь: решение spec-а — причины Ticket Node берёт из PR inbox, а не из Pipeline: кнопке нужны repo, номер и
  head PR-а. Файла нет в списке Ticket-а: Orchestrator разрешил его, потому что slot `.tsx` может экспортировать только
  компоненты (lint `react-refresh/only-export-components`), а импорт palette из slot-а давал бы цикл импорта.
- Без него: кнопка и строки palette считали бы список действий каждая по-своему и могли разойтись.
- Требование: [Что делаем, пункты 1 и 2](../issues/05-ticket-node-и-command-palette.md#что-делаем)
- Риски и пробелы test-ов: порядок PR-ов Ticket-а с несколькими repository — порядок групп PR inbox, а не строк `Repo:`
  Ticket-а, как у «Open PR».

## 3. Кнопка по первой причине и ▾ с остальными

Code: `src/renderer/canvas/actions/PrFollow.tsx:39-94` · key lines: 45, 55, 56, 62, 71, 82

```tsx
function Collect(props: Collected): ReactElement {
  return props.states.length === props.choices.length ? props.draw(props.states) : <CollectOne {...props} />
}

function CollectOne({ projectId, choices, states, draw }: Collected): ReactElement {
  const choice = choices[states.length]!
  const state = usePrFollowState(projectId, choice.row, choice.action)
  return <Collect projectId={projectId} choices={choices} states={[...states, state]} draw={draw} />
}

const titleOf = (state: ActionState): string => (state.enabled ? state.text : state.reason)

function TicketPrFollow({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const { snapshot } = usePrInbox(projectId)
  const { model } = useWorkflow(root)
  const store = useCanvasStore()
  const choices = prFollowChoices(snapshot, ticket, model?.tickets ?? [ticket])
  if (choices.length === 0) return null
  const several = new Set(choices.map(({ row }) => `${row.repo}#${row.number}`)).size > 1

  const run = ({ row, action }: PrFollowChoice) => async (): Promise<string | undefined> => {
    const { frames, strip } = store ? spotInputs(store.getState().nodeLookup.values()) : { frames: [], strip: undefined }
    const near = sessionSpot({ kind: 'ticket', epic: ticket.epic, num: ticket.num }, frames, strip)
    const result = await invoke('actions.prFollow', { projectId, repo: row.repo, pr: row.number, action, ...(near ? { near } : {}) })
    return result.ok ? undefined : failureReason('actions.prFollow', result.error)
  }

  const draw = (states: readonly ActionState[]): ReactElement => {
    const [first, ...rest] = choices
    const state = states[0]!
    return (
      <>
        <ActionButton label={ACTION_LABELS[first!.action]} testId="action-pr-follow" enabled={state.enabled} title={titleOf(state)} run={run(first!)} />
        {rest.length > 0 ? (
          <ActionMenu
            label="More pull request actions"
            text="▾"
            title="Other actions on the Ticket's pull requests"
            testId="action-pr-follow-more"
            menuLabel="Pull request actions"
            items={rest.map((choice, index) => {
              const each = states[index + 1]!
              return {
                label: several ? prFollowTitle(choice) : ACTION_LABELS[choice.action],
                title: titleOf(each),
                testId: `action-pr-follow-item-${choice.action}-${choice.row.repo}#${choice.row.number}`,
                disabled: !each.enabled,
                run: run(choice),
              }
            })}
          />
        ) : null}
      </>
    )
  }
  return <Collect projectId={projectId} choices={choices} states={[]} draw={draw} />
```

- Что делает: состояние каждого действия берёт только у `usePrFollowState` — по компоненту на действие, чтобы число
  вызовов hook-а в компоненте не менялось. Первое действие — кнопка, остальные — пункты меню ▾ (`ActionMenu`, как у
  «Open PR»). У Ticket-а с PR в нескольких repository пункт называет свой PR. Щелчок шлёт `actions.prFollow` с `near`
  справа от колонки рамок на высоте Ticket-а, как Ship ticket. Отказ main показывает tooltip кнопки или ▾.
- Почему здесь: Ticket называет новый slot `src/renderer/canvas/actions/PrFollow.tsx`; slot-ы добавляются по файлу.
- Без него: на Ticket Node не было бы действий над его PR.
- Требование: [Что делаем, пункты 1–4](../issues/05-ticket-node-и-command-palette.md#что-делаем)
- Риски и пробелы test-ов: на кнопке стоит первая причина, даже когда она неактивна, а следующая активна. Ширину ряда
  действий на карточке 240 px проверяет только e2e (`ticketCardCuts`), локально он не запускался.

## 4. Строки palette из того же списка

Code: `src/renderer/palette/commands.ts:351-371` · key lines: 354, 363, 366

```ts
  for (const ticket of model.tickets) {
    // Only what the Ticket's button and its «▾» offer (canvas/actions/PrFollow.tsx).
    const ref = `${ticket.epic}/${nn(ticket.num)}`
    for (const choice of prFollowChoices(prInbox, ticket, model.tickets)) {
      const { row, action } = choice
      const title = prFollowTitle(choice)
      commands.push({
        id: `pr-follow:${action}:${row.repo}#${row.number}`,
        group: 'Action',
        title,
        detail: `${ref} — ${ticket.title}`,
        keys: [title.toLowerCase(), `${title.toLowerCase()} ${ref}`],
        gate: { kind: 'pr-follow', projectId, row, action },
        readOnly: hint,
        run: async () => {
          const result = await invoke('actions.prFollow', { projectId, repo: row.repo, pr: row.number, action })
          return result.ok ? undefined : failureReason('actions.prFollow', result.error)
        },
      })
    }
  }
```

- Что делает: строка на каждое действие, которое предлагает кнопка Ticket-а, с заголовком «Fix checks owner/web#118» и
  Ticket-ом в detail. На read-only экране строка несёт подсказку, как Ship ticket. Из palette `near` не уходит: Node
  встаёт там, где любая новая.
- Почему здесь: Ticket называет `buildCommands` и `CommandGate` в `src/renderer/palette/commands.ts`.
- Без него: palette не знала бы этих действий.
- Требование: [Что делаем, пункт 5](../issues/05-ticket-node-и-command-palette.md#что-делаем)
- Риски и пробелы test-ов: PR, у которого нет Ticket-а, строки в palette не получает — его действия только в Pull
  requests (Ticket 04).

## 5. Строка palette спрашивает тот же hook

Code: `src/renderer/palette/CommandPalette.tsx:260-271` · key lines: 261, 269

```tsx
function PrFollowRow({ gate, ...props }: RowProps & { gate: Extract<CommandGate, { kind: 'pr-follow' }> }) {
  return <RowButton {...props} state={usePrFollowState(gate.projectId, gate.row, gate.action)} />
}

function CommandRow(props: RowProps) {
  const { gate, readOnly } = props.command
  // Before the gate: on a read-only screen the action cannot run whatever its own state is.
  if (readOnly !== undefined) return <RowButton {...props} state={{ enabled: false, reason: readOnly }} />
  if (gate === undefined) return <RowButton {...props} state={null} />
  if (gate.kind === 'pr-follow') return <PrFollowRow {...props} gate={gate} />
  return gate.kind === 'ship-ticket' ? <ShipTicketRow {...props} gate={gate} /> : <RunWaveRow {...props} gate={gate} />
}
```

- Что делает: неактивная строка серая и с причиной, активная показывает текст в tooltip — из `usePrFollowState`,
  как кнопка.
- Почему здесь: Ticket называет `CommandPalette.tsx:251-264`, где стоят ветки Ship ticket и Run wave.
- Без него: строка и кнопка могли бы показать разные причины отказа.
- Требование: [Что делаем, пункт 5](../issues/05-ticket-node-и-command-palette.md#что-делаем)
- Риски и пробелы test-ов: not recorded.

## 6. Что сознательно не меняли

- `src/renderer/canvas/actions/gates.ts` и `src/renderer/canvas/badges/review-threads.ts` — только читаются, как велит
  Ticket.
- Высоту карточки (`ticket-card.ts`) не меняли: ряд действий уже имеет свою строку.
- Перевод страниц в `docs/features/ru/` — Ticket 06.

## 7. Как проверено

- `pnpm test test/unit/canvas-actions.test.tsx test/unit/pr-follow-choices.test.tsx` — exit 0.
- `pnpm test test/unit/palette-commands.test.tsx` — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — green.
- E2e `test/e2e/pr-follow-ticket.spec.ts` локально не запускался (правило владельца): его проверяет CI.

## Проверить себя

1. Ticket с PR в конфликте, но шаблон Resolve conflicts пуст, а Fix checks задан. Что на кнопке?
   - Строки: `src/renderer/canvas/actions/PrFollow.tsx:66-71`
   - Ответ: Resolve conflicts, неактивная, с подсказкой задать шаблон; Fix checks — активный пункт меню ▾.
2. Почему состояния собираются цепочкой компонентов, а не циклом вызовов hook-а?
   - Строки: `src/renderer/canvas/actions/PrFollow.tsx:39-47`
   - Ответ: число действий меняется со snapshot-ом, а число вызовов hook-а в одном компоненте меняться не может.
3. Project с `"prInbox": false` — что видит palette?
   - Строки: `src/renderer/canvas/actions/pr-follow-choices.ts:28-35`
   - Ответ: ничего: `reviewsOfTicket` пуст при выключенном PR inbox, значит нет ни кнопки, ни строк.
