# 18 — «Ship ticket» не считает блокер закрытым, пока его `done` только в невлитой ветке

Type: task
Status: done 2026-10-15
PR: #368
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

- [x] Test пункта 1 красный на main и зелёный с правкой.
- [x] Test пункта 5: main не запускает Session при блокере `done` только в ветке.
- [x] Мутанты на копии краснят свои test-ы: код main (только `state`); проверка `fromBranch` только
      у первого блокера; своя копия условия вместо `doneOnlyInBranch` с ошибкой (`||` вместо `&&`).
- [x] Старые test-ы `launch.test.ts`, `render-template.test.ts`, `canvas-actions.test.tsx` зелёные без
      правок их ожиданий.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

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

- Правило — в `shipTicketState` (`src/shared/actions/render-template.ts`): блокер закрыт, только если он
  `done` в checkout-е. Блокер `done` только в невлитой ветке проверяется функцией `doneOnlyInBranch` из
  `src/shared/workflow/waves.ts` — то же правило, что у Wave (Ticket 07), без своей копии условия.
  `waves.ts` не правился: `doneOnlyInBranch` уже экспортирована.
- Тип входа `tickets` — `Pick<Ticket, 'epic' | 'num' | 'state'> & Partial<Pick<Ticket, 'fromBranch'>>`, как
  `WaveTicket`: вход без поля читается как Ticket из checkout-а. Вызовы в `gates.ts` и `launch.ts` не
  менялись — они уже передают полные `Ticket` с `fromBranch`.
- Причина отказа: `blocked by 07 (done in branch worfy-polish/07, not merged)`. Обычный открытый блокер
  пишется как раньше (`blocked by 09`); несколько блокеров — через запятую в порядке «Blocked by»:
  `blocked by 09, 11 (done in branch worfy-polish/11, not merged)`.
- Test-ы (`test/unit/launch.test.ts`): в `describe('shipTicketState')` — «a blocker done only in its unmerged
  branch is not closed yet…» (ветка — неактивна; `fromBranch: null` и без поля — активна; ветка у Ticket-а
  в `work` не закрывает его) и «checks every blocker for a branch-only done, not just the first…»; в
  `describe('ActionLauncher.shipTicket')` — «refuses, and starts no Session, while a blocker is done only in
  its unmerged branch…» (отказ с той же причиной, Session и Binding не созданы; после мержа — запуск).
  На коде origin/main все три красные.
- Мутанты (на копии, восстановление через `cmp`): код origin/main — 3 test-а красные; проверка `fromBranch`
  только у первого блокера — 2 красных; своя копия условия с `||` вместо `&&` — 4 красных.
- Старые test-ы `launch.test.ts`, `render-template.test.ts`, `canvas-actions.test.tsx`, `waves.test.ts` зелёные,
  их ожидания не правились.

### Gate оркестратора (2026-10-15)

- Wave 3 Epic-а под Autopilot: Ticket-ы 14, 16, 17, 18, 19, 21, 23, 25 параллельно, затем 20 и 15 (их «Готово, когда» требует прогонов под нагрузкой). Один verifier на круг, глубина около low; UI-Ticket-ы — снимки в обеих темах. Worktree — `.claude/worktrees/pol-<NN>`.
- Gate — один круг: `VERIFIED` на `fbcc081` ([комментарий в PR #368](https://github.com/IDSAD-XL/worfy/pull/368#issuecomment-6198415851)). Verifier сам: все три вызова `shipTicketState` (кнопка на Canvas, строка палитры, запуск в main) получают полные `Ticket` с `fromBranch`; gate fast из кэша, поэтому `pnpm lint`, `pnpm typecheck`, `pnpm test` — 0 (5344 test-а); 4 файла Ticket-а — 249 passed; три своих мутанта красные; e2e `ship-ticket.spec.ts` под замком — 2 passed; CI `check` passed, CLEAN.
- Merge: `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `c9c170b`.
- Act on, Consider, Noted, Dismissed — нет.
