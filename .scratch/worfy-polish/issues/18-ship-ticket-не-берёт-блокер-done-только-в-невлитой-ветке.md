# 18 — «Ship ticket» не считает блокер закрытым, пока его `done` только в невлитой ветке

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-15 по «Итог» Ticket-а
[07](07-wave-не-берёт-блокер-done-только-в-невлитой-ветке.md) («Не сделано здесь: «Ship ticket»
(`shipTicketState`, `src/shared/actions/render-template.ts:128`) по-прежнему считает блокер закрытым
по одному `state === 'done'` — кандидат в следующий Ticket») и его Gate (раздел «Gate оркестратора
(2026-10-15)», Noted, подтверждено verifier-ом); [ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md).

## Что происходит

У Ticket-а в работе свой worktree и своя ветка. Когда агент ставит в ветке `Status: done`, worfy
показывает Ticket как `done` с полем `fromBranch` — именем ветки (ADR-0033). Код блокера при этом ещё
не в main.

- **Wave это уже учитывает** (Ticket 07). Блокер закрыт, только если `state === 'done'` и
  `fromBranch` пуст (`closed`, `src/shared/workflow/waves.ts:55`). Признак «`done` только в ветке» —
  экспортированная функция `doneOnlyInBranch` (`waves.ts:58`).
- **«Ship ticket» — нет.** `shipTicketState` (`src/shared/actions/render-template.ts:123-133`)
  считает блокер открытым, только если его `state` не `done` (`:128`). Поле `fromBranch` она не
  видит: тип `tickets` — `Pick<Ticket, 'epic' | 'num' | 'state'>` (`:123`).
- **Где это видно.** Одна функция решает за все места:
  - кнопка на Ticket-е Canvas и строка палитры — `useShipTicketState`
    (`src/renderer/canvas/actions/gates.ts:41-48`; палитра — `src/renderer/palette/CommandPalette.tsx:185`);
  - запуск в main — `shipTicket` (`src/main/actions/launch.ts:151`).
- **Итог.** Если блокер `done` только в невлитой ветке, «Ship ticket» активна. Новая Session
  стартует от main без кода блокера — тот же дефект, что Ticket 07 закрыл для Wave.

## Что делаем

1. **Сначала красный unit test** в `test/unit/launch.test.ts` (блок `describe('shipTicketState')`,
   `:30`): блокер 07 `done` с `fromBranch: 'worfy-polish/07'` — «Ship ticket» неактивна, причина
   называет блокер; тот же блокер с `fromBranch: null` — активна. На main первый случай красный.
2. **Одно правило с Wave.** `shipTicketState` проверяет блокер через `doneOnlyInBranch`
   (`waves.ts:58`), а не своей копией условия. Если удобнее экспортировать `closed` из `waves.ts` —
   дописать `src/shared/workflow/waves.ts` в «Где в коде» при claim.
3. **Тип входа.** `tickets` берёт `fromBranch` необязательным полем, как `WaveTicket`
   (`waves.ts:50-52`): вход без поля читается как Ticket из checkout.
4. **Причина отказа** называет ветку, например: `blocked by 07 (done in branch worfy-polish/07, not
   merged)`. Точный текст выбирает исполнитель; test фиксирует его.
5. **Main отказывает так же.** Test на `shipTicket` в main (`launch.ts`): с таким блокером запуск
   отклонён с той же причиной, Session не создана.

## Готово, когда

- [ ] Test пункта 1 красный на main и зелёный с правкой.
- [ ] Test пункта 5: main не запускает Session при блокере `done` только в ветке.
- [ ] Мутанты на копии краснят свои test-ы: код main (только `state`); проверка `fromBranch` только
      у первого блокера; своя копия условия вместо `doneOnlyInBranch` с ошибкой (`||` вместо `&&`).
- [ ] Старые test-ы `launch.test.ts`, `render-template.test.ts`, `canvas-actions.test.tsx` зелёные без
      правок их ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/launch.test.ts` — `shipTicketState` и `shipTicket` в main.
- e2e `ship-ticket.spec.ts` — без изменений, зелёный в gate full.

## Где в коде

- `src/shared/actions/render-template.ts`
- `test/unit/launch.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/workflow/waves.ts`, `src/renderer/canvas/actions/gates.ts`, `src/main/actions/launch.ts`,
`src/renderer/palette/CommandPalette.tsx`, `test/unit/waves.test.ts`, `test/e2e/ship-ticket.spec.ts`,
`docs/adr/0033-autopilot-names-wave-tickets.md`.

## Вне скоупа

- Показ Status-а на Canvas и `branchOverrides` — не меняются (ADR-0033).
- Кнопка «Ship ticket» на самом Ticket-е в работе или `done` (`hasShipTicket`, `gates.ts:19-21`).
- Номера Wave на Card-ах — их сделал Ticket 07.

## Итог

—
