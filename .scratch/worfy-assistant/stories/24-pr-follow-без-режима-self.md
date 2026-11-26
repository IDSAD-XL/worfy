# Code story — worfy-assistant 24: Действие `pr-follow` не выше `ask`/`pre-approved`: режим `self` для него запрещён

Kind: pr · Epic: worfy-assistant · Ticket: 24 · PR: - · Language: ru

## 1. Что было не так

Любой из четырёх режимов (`self`, `pre-approved`, `ask`, `hand-over`) можно было выбрать для любого действия
обязанности. С `self` у `pr-follow` Assistant сам, без вопроса, запускал Session, которая чинит check-и, конфликты или
отвечает на комментарии PR. Это действие вне закрытого списка main, а ADR-0114 разрешает Assistant-у сам делать только
действия закрытого списка. Владелец 2026-11-26 решил: у `pr-follow` режима `self` не бывает; `autopilot-start` —
как есть.

- Требование: [Что происходит](../issues/24-pr-follow-без-режима-self.md#что-происходит)

## 2. Один список режимов по действию

Code: `src/shared/assistant/duties.ts:37-48` · key lines: 43, 48

```ts
export const DUTY_ACTION_ALLOWED_MODES: Readonly<Record<DutyAction, readonly DutyActionMode[]>> = Object.freeze({
  open: DUTY_ACTION_MODES,
  'wake-orchestrator': DUTY_ACTION_MODES,
  'continue-session': DUTY_ACTION_MODES,
  'fix-session': DUTY_ACTION_MODES,
  summary: DUTY_ACTION_MODES,
  'pr-follow': ['pre-approved', 'ask', 'hand-over'],
  'autopilot-start': DUTY_ACTION_MODES,
})

/** Whether `action` may have `mode` (DUTY_ACTION_ALLOWED_MODES). */
export const dutyActionModeAllowed = (action: DutyAction, mode: DutyActionMode): boolean => DUTY_ACTION_ALLOWED_MODES[action].includes(mode)
```

- Что делает: для каждого действия перечисляет режимы, которые у него могут быть: у `pr-follow` — `pre-approved`,
  `ask`, `hand-over`, у остальных — все четыре. `dutyActionModeAllowed` — единственная проверка, которую зовут три места
  отказа ниже.
- Почему здесь: пункт 1 «Что строить» называет `src/shared/assistant/duties.ts`: список читают main и будущие настройки
  (Ticket 15), чтобы экран не предлагал `self` для `pr-follow`.
- Без него: три места отказа держали бы каждое свою копию правила, и они могли бы разойтись.
- Требование: [Что строить](../issues/24-pr-follow-без-режима-self.md#что-строить)
- Риски и пробелы test-ов: test проверяет, что каждый режим по умолчанию встроенных обязанностей есть в списке; экрана,
  который читает список, ещё нет.

## 3. Отказ при выборе

Code: `src/main/assistant/duties/duties.ts:179-185` · key lines: 184

```ts
  configure(id: string, choice: DutyChoice): void {
    const definition = this.definition(id)
    for (const [action, mode] of Object.entries(choice.modes ?? {}) as [DutyAction, DutyActionMode][]) {
      if (!(action in definition.actions)) throw new Error(`The duty ${id} has no action ${action}`)
      dutyActionModeSchema.parse(mode)
      if (!dutyActionModeAllowed(action, mode)) throw new Error(`The action ${action} may not be ${mode}: it may be ${DUTY_ACTION_ALLOWED_MODES[action].join(', ')}`)
    }
```

- Что делает: `configure` с `pr-follow: self` бросает с причиной до `change()`, поэтому ни память, ни файл не меняются,
  даже если в том же выборе были другие, допустимые режимы.
- Почему здесь: пункт 2 «Что строить» — так же, как сейчас отказывает неизвестный режим.
- Без него: пользователь (или экран Ticket-а 15) мог бы снова выбрать `self`.
- Требование: [Что строить](../issues/24-pr-follow-без-режима-self.md#что-строить)
- Риски и пробелы test-ов: нет.

## 4. Отказ при чтении файла памяти

Code: `src/main/assistant/duties/memory.ts:24-31` · key lines: 27, 28

```ts
const dutyModesSchema = z.partialRecord(z.enum(DUTY_ACTIONS), dutyActionModeSchema).transform((modes) => {
  const kept: Partial<Record<DutyAction, DutyActionMode>> = {}
  for (const [action, mode] of Object.entries(modes) as [DutyAction, DutyActionMode][]) {
    if (dutyActionModeAllowed(action, mode)) kept[action] = mode
    else console.warn(`[assistant] the memory file holds ${action}: ${mode}, a mode ${action} may not have; the duty's default holds`)
  }
  return kept
})
```

- Что делает: запись режима, которого у действия быть не может, читается как не выбранная — действует режим по
  умолчанию (`ask`), в log одна строка на чтение. Остальные записи файла читаются как записаны; следующая запись
  обязанностей уже не содержит `self`.
- Почему здесь: пункт 3 «Что строить»; Ticket называет `dutyStateSchema` в `memory.ts`. Схему читают оба читателя
  файла — обязанности и первое сообщение Session Assistant-а (`readMemoryView`), так что `self` не видит и модель. Отказ
  всей схемы отложил бы файл целиком (`readJsonFile`), и пользователь потерял бы счётчики и обязательства.
- Без него: файл, записанный руками или старой сборкой, вернул бы `self` в обход `configure`.
- Требование: [Что строить](../issues/24-pr-follow-без-режима-self.md#что-строить)
- Риски и пробелы test-ов: до первой записи обязанностей строка в log повторяется на каждое чтение файла; это сознательно
  (раздел «Решено без владельца» тикета).

## 5. Отказ при действии

Code: `src/main/mcp/app-server.ts:302-307` · key lines: 302, 304, 305

```ts
  const act = async (args: AppToolArgs['action_run'] & { action: MainAction }, item: AttentionItem, mode: DutyActionMode): Promise<string> => {
    if (!dutyActionModeAllowed(args.action, mode)) {
      const reason = `The mode of ${args.action} in the duty ${item.duty} is ${mode}, which ${args.action} may not have: propose it with proposal_create and let the user decide. Nothing was done.`
      deps.journal({ at: deps.now(), action: args.action, item, mode, outcome: 'refused', text: reason })
      throw new ToolError(reason)
    }
```

- Что делает: `action_run` для `pr-follow` с режимом `self` отказывает с причиной и строкой журнала
  (`outcome: 'refused'`) до того, как main что-нибудь запустит.
- Почему здесь: пункт 4 «Что строить» — вторая защита на случай, если режим пришёл в обход `configure` и файла памяти.
  `act` — единственный путь к `prFollow` и `autopilotStart`; действия закрытого списка идут мимо него, и main проверяет
  их сам.
- Без него: подменённый `duties.look` или будущий путь режимов запустил бы `pr-follow` сам.
- Требование: [Что строить](../issues/24-pr-follow-без-режима-self.md#что-строить)
- Риски и пробелы test-ов: contract test получает `self` через подменённый `duties.look` — настоящие обязанности его
  уже не отдают.

## 6. Что сознательно не меняли

`autopilot-start` с `self` по-прежнему разрешён: он только открывает диалог Start Autopilot, и диалог и есть
подтверждение пользователя. `pre-approved` у `pr-follow` работает, как раньше. Описание tool-а `action_run` и правила
Session Assistant-а не менялись: `self` у `pr-follow` больше не появляется в `items_list`, а tool-а, меняющего режимы,
у модели нет. `auto.ts` и `modeAllows` закрытого списка сверены и не тронуты.

## 7. Как проверено

`test/unit/assistant-duties.test.ts`, `test/unit/assistant-session.test.ts` и `test/contract/worfy-app-tools.test.ts` —
новые test-ы сначала красные на прежнем коде; все test-ы `test/unit/assistant-*`, `test/contract/assistant-*` и
`worfy-app` — exit 0; `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — код выхода в отчёте PR.

## Проверить себя

1. В файле памяти у `pr-follow` записан `self`. Почему схема не отказывает файлу целиком, и с каким режимом придёт
   предложение `pr-follow`?
   - Ответ: отказ схемы отложил бы весь файл, и пропали бы счётчики, паузы и правила; поэтому отбрасывается только эта
     запись, и действует режим по умолчанию `ask`.
   - Lines: `src/main/assistant/duties/memory.ts:24-31`
2. Почему `autopilot-start` оставил все четыре режима, а `pr-follow` нет?
   - Ответ: `autopilot-start` только открывает диалог, и подтверждает пользователь; `pr-follow` сам запускает Session.
   - Lines: `src/shared/assistant/duties.ts:37-48`
3. Что увидит журнал, если `self` у `pr-follow` всё же дойдёт до `action_run`?
   - Ответ: строку `refused` с режимом `self` и причиной; main ничего не запустит.
   - Lines: `src/main/mcp/app-server.ts:302-307`
