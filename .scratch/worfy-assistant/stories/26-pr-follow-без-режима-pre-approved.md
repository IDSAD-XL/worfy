# Code story — worfy-assistant 26: Действие `pr-follow` только `ask` или `hand-over`: режим `pre-approved` для него тоже запрещён

Kind: pr · Epic: worfy-assistant · Ticket: 26 · PR: - · Language: ru

## 1. Что было не так

Ticket 24 запретил `self` для `pr-follow` — действия, которое запускает Session над PR пользователя («Fix checks»,
«Resolve conflicts», «Address comments»). Но `pre-approved` остался, а `action_run` сервера `worfy-app` запускает
действие при `pre-approved` так же, как при `self`. Значит, Assistant по-прежнему мог сам, без вопроса, запустить
Session над PR. Владелец 2026-11-26 решил: у `pr-follow` остаются только `ask` и `hand-over`.

- Требование: [Что происходит](../issues/26-pr-follow-без-режима-pre-approved.md#что-происходит)

## 2. Список режимов: у `pr-follow` только `ask` и `hand-over`

Code: `src/shared/assistant/duties.ts:30-47` · key lines: 33, 34, 45

```ts
/**
 * The modes each action may have (worfy-assistant tickets 24 and 26, the owner's decisions of 2026-11-26; ADR-0114,
 * point 4: the Assistant does by itself only the actions of the closed list). `pr-follow` starts a Session that works on
 * a PR, outside the closed list: only `ask` or `hand-over`. `pre-approved` would start it with no question exactly as
 * `self` does, so it is refused too (ticket 26), and `action_run` has no `pr-follow` at all.
 * `autopilot-start` keeps all four: it only opens the Start Autopilot dialog, and the dialog is the user's confirmation.
 * main refuses any other mode (Duties.configure, the memory file, a proposed change of the settings and its Apply); the
 * settings offer only these.
 */
export const DUTY_ACTION_ALLOWED_MODES: Readonly<Record<DutyAction, readonly DutyActionMode[]>> = Object.freeze({
  open: DUTY_ACTION_MODES,
  'wake-orchestrator': DUTY_ACTION_MODES,
  'continue-session': DUTY_ACTION_MODES,
  'fix-session': DUTY_ACTION_MODES,
  summary: DUTY_ACTION_MODES,
  'pr-follow': ['ask', 'hand-over'],
  'autopilot-start': DUTY_ACTION_MODES,
})
```

- Что делает: убирает `pre-approved` из режимов `pr-follow`. Этот список читают все места отказа Ticket-а 24:
  `Duties.configure` (выбор), схема файла памяти (чтение, в том числе первое сообщение Session Assistant-а), экран
  обязанностей Settings (main отдаёт ему `allowed` из списка) и проверка карточки «было → станет».
- Почему здесь: пункт 1 «Что строить» называет `DUTY_ACTION_ALLOWED_MODES`; один список вместо копий правила — решение
  Ticket-а 24.
- Без него: `pre-approved` у `pr-follow` и дальше запускал бы Session над PR без вопроса.
- Требование: [Что строить](../issues/26-pr-follow-без-режима-pre-approved.md#что-строить)
- Риски и пробелы test-ов: экран Settings проверен test-ом рендера с `allowed`, который main отдаёт из этого списка
  (test панели), — сам рендер список не читает.

## 3. Карточка «было → станет» и Apply отказывают тем же списком

Code: `src/main/assistant/settings/panel.ts:90-92` · key lines: 91, 92

```ts
export function applySettingsChange(change: SettingsChange, deps: ApplyDeps): void {
  const problems = dutyChangeProblems(change, deps.duties.look([], { countShown: false }).duties)
  if (problems.length > 0) throw new Error(`The change cannot apply: ${problems.join('; ')}`)
```

- Что делает: Apply карточки сначала спрашивает `dutyChangeProblems`, а та отказывает режиму, которого нет в списке
  (`src/shared/assistant/settings-change.ts:157`). Та же функция отказывает `proposal_create` с таким `change`. Код не
  менялся: после шага 2 `pr-follow: pre-approved` стал для неё запрещённым режимом.
- Почему здесь: пункт 5 «Что строить» просит сверить карточку Ticket-а 15 и путь Apply; бриф называет
  `settings-change.ts` и Apply.
- Без него: карточка, созданная до этого Ticket-а, на Apply поставила бы `pre-approved`; на деле `Duties.configure` всё
  равно бы бросил, но уже после того, как часть настроек приложения записана.
- Требование: [Что строить](../issues/26-pr-follow-без-режима-pre-approved.md#что-строить)
- Риски и пробелы test-ов: нет.

## 4. `action_run` больше не знает `pr-follow`

Code: `src/shared/assistant/app-tools.ts:18-24` · key lines: 23

```ts
 * The actions `action_run` does: the closed list of main (ticket 08) and one of main's functions that checks for
 * itself — autopilot-start only opens the Start Autopilot dialog. Every other action — pr-follow (its mode is only ask
 * or hand-over, ticket 26), a reply to a PR, a Session with the Assistant's text — the Assistant proposes, and the user
 * does.
 */
export const APP_ACTIONS = ['wake-orchestrator', 'continue-session', 'autopilot-start'] as const
export type AppAction = (typeof APP_ACTIONS)[number]
```

- Что делает: `action_run` принимает только эти три действия, аргумента `follow` у него больше нет. Вызов с
  `pr-follow` — отказ схемы при любом режиме; ветка `pr-follow` в `act`, `prOf` и зависимость `prFollow` сервера
  `worfy-app` ушли.
- Почему здесь: раздел «Решения» тикета оставляет выбор агенту — оставить `pr-follow` в `APP_ACTIONS` с одним отказом
  или убрать. После шага 2 `action_run` отказывает `ask` и `hand-over` раньше `act`, так что ветка запуска стала бы
  кодом, до которого не дойти. Решение и цена — в «Решено без владельца» тикета.
- Без него: в `worfy-app` осталась бы ветка запуска Session над PR, которую не проверить test-ом и которая заработала бы
  снова от одной правки списка.
- Требование: [Решения](../issues/26-pr-follow-без-режима-pre-approved.md#решения)
- Риски и пробелы test-ов: test-ы отказа launcher-а при идущем Autopilot через `action_run` ушли вместе с веткой;
  строку журнала и «журнал не записан — ответ остаётся» теперь проверяет `autopilot-start`.

## 5. Проверка режима в `act` осталась

Code: `src/main/mcp/app-server.ts:348-353` · key lines: 349

```ts
  const act = async (args: AppToolArgs['action_run'] & { action: MainAction }, item: AttentionItem, mode: DutyActionMode): Promise<string> => {
    if (!dutyActionModeAllowed(args.action, mode)) {
      const reason = `The mode of ${args.action} in the duty ${item.duty} is ${mode}, which ${args.action} may not have: propose it with proposal_create and let the user decide. Nothing was done.`
      deps.journal({ at: deps.now(), action: args.action, item, mode, outcome: 'refused', text: reason })
      throw new ToolError(reason)
    }
```

- Что делает: отказывает режиму, пришедшему в обход `configure` и файла памяти, для любого действия `action_run`.
- Почему здесь: проверка из Ticket-а 24; оставлена, потому что общая для списка, а не для `pr-follow`.
- Без него: сужение списка режимов для `autopilot-start` не дошло бы до `action_run`.
- Требование: не записано
- Риски и пробелы test-ов: сегодня не срабатывает — у оставшихся действий `action_run` разрешены все четыре режима, и
  test-а на неё нет.

## 6. Что сознательно не меняли

`autopilot-start` — все четыре режима, как было: он только открывает диалог Start Autopilot (решение владельца,
первый раунд, Q2). ADR не менялся. `src/main/assistant/actions/auto.ts` сверен: main сам делает только действия
закрытого списка, `pr-follow` в нём нет. Схема IPC `assistant.configureDuty` режимы не сужает — это делает
`Duties.configure`.

## 7. Как проверено

Новые test-ы сначала красные на прежнем коде (9 упали). После правки: все test-ы `test/unit/assistant-*`,
`test/contract/assistant-*`, `test/contract/worfy-app-tools`, `test/unit/settings-*`, `test/contract/app-settings` —
exit 0 (769 test-ов); `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему запрет `pre-approved` для `pr-follow` не требует правок в экране Settings и в проверке карточки «было → станет»?
   - Ответ: оба читают один список режимов: экран получает `allowed` из него, карточку и Apply проверяет
     `dutyChangeProblems` через `dutyActionModeAllowed`.
   - Lines: `src/shared/assistant/duties.ts:30-47`, `src/main/assistant/settings/panel.ts:90-92`
2. Почему `pr-follow` убран из `APP_ACTIONS`, а не оставлен с отказом в `act`?
   - Ответ: при `ask` и `hand-over` `action_run` отказывает раньше `act`, так что ветка запуска `pr-follow` стала бы
     недостижимой и непроверяемой.
   - Lines: `src/shared/assistant/app-tools.ts:18-24`
3. Что будет с карточкой «было → станет», которую Assistant создал до этого Ticket-а с `pr-follow: pre-approved`?
   - Ответ: Apply откажет с причиной до любой записи, ничего не изменится.
   - Lines: `src/main/assistant/settings/panel.ts:90-92`
