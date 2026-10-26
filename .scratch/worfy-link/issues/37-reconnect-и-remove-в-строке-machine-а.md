# 37 — «Reconnect», «Remove» и «Change address…» видны в строке Machine-а без связи; «Revoke» → «Remove»

Type: task
Status: open
Blocked by: 36
Source: баг владельца 2026-10-26 и его решения того же дня (приняты все): после потери связи Mac и Windows-ПК
владелец не нашёл, как подключиться заново и как убрать машину. Main-часть — Ticket 36. Ticket берётся сразу
после 36, до Ticket-а 30; приёмку 31 (Mac и ПК через Tailscale) держит. Строки — по main `2a01111c`.

Не платформенный PR: только renderer, веток по платформе нет. Подсказку про Windows firewall решает main
(Ticket 36), UI только показывает её текст.

## Что происходит

- Секция «Machines» в боковой панели свёрнута по умолчанию (`src/renderer/shell/sidebar/MachinesSection.tsx:162`).
  Состояния строки — «Online», «Sleeping», «Unavailable», «Certificate changed» (`:71-78`). У недоступной машины
  tooltip «… cannot be reached; worfy keeps trying» (`:88`).
- Убрать машину можно только пунктом «Revoke» в меню по правому клику на строке (`:130-131`). Видимой кнопки нет.
  Подтверждения тоже нет: пункт сразу вызывает `link.revoke` (`:180-184`, `src/renderer/machines/useMachines.ts:75`).
- Settings → Machines (`src/renderer/settings/MachinesSection.tsx:75`) перечисляет Linked machine-ы с уровнем
  доступа, но убрать машину там нельзя.
- Команд Command palette для Machine-ов нет (`src/renderer/palette/commands.ts`). Подключиться заново руками
  нельзя нигде.
- Remove работает и без связи (Ticket 36, раздел «Что происходит»).

## Что делаем

1. **Строка Machine-а без связи** показывает видимые кнопки «Reconnect» (`link.reconnect`, Ticket 36) и «Remove».
   Во время набора «Reconnect» неактивна и говорит, что worfy подключается.
2. **«Change address…»** — в меню строки и в строке без связи. Окно с полем IP или имени (и порта); сохраняет
   через `link.setAddress` (Ticket 36). Отказ main (другой сертификат, нет ответа) — текстом в окне, адрес не
   меняется.
3. **Обе стороны одинаковы** (решение владельца 2026-10-26, Q9'). Любая Linked machine без связи — «Offline»
   с «Reconnect» и «Remove», на какой бы стороне ни нажимали. Подписи «Waiting for … to connect» нет.
4. **Settings → Machines**: у каждой Linked machine-а — «Remove».
5. **Command palette**: «Reconnect machine…» и «Remove machine…» — выбор Machine-а, затем то же действие, что у
   кнопки. «Reconnect machine…» предлагает только Machine-ы без связи.
6. **«Revoke» → «Remove» везде в UI**: меню, tooltip «Certificate changed» (`:83`), тексты Settings. Remove
   спрашивает подтверждение: что машина забудется на обеих сторонах и связать её снова можно только новым кодом.
   Имя канала IPC `link.revoke` не меняется.
7. **Подсказка про Windows firewall** из Ticket-а 36 (пункт 8) — текстом в строке Machine-а.
8. **«Link a machine» показывает уже связанные машины** (владелец 2026-10-26, Q14). Сейчас окно их молча
   выбрасывает из списка (`src/main/link/discovery.ts:9-10`), и владелец, связав ПК с Mac, решил, что Mac не
   может связаться с ПК «как host». Такая машина стоит в списке с меткой «Already linked», без кнопки привязки, со
   строкой: «One link works both ways. To open <name>'s Projects here, turn on "Linked machines can work with my
   Projects" on <name>.»
9. **Доступ в обе стороны в строке машины** (владелец 2026-10-26, Q15) — в боковой панели и в Settings →
   Machines: «Shares its Projects with you» / «Doesn't share its Projects» и «Can work with your Projects» /
   «Can't see your Projects». Первая строка — только когда состояние доступа другой стороны известно по связи;
   если его нет в `link.state`, Ticket добавляет его туда.

## Готово, когда

- [ ] Unit test секции: строка без связи — кнопки «Reconnect» и «Remove»; статус
      «Offline»; подсказка firewall видна, когда main
      её отдаёт.
- [ ] Unit test: «Remove» спрашивает подтверждение; «Cancel» ничего не вызывает; слова «Revoke» в UI нет.
- [ ] Unit test Command palette: «Reconnect machine…» и «Remove machine…» вызывают `link.reconnect` и
      `link.revoke` для выбранной Machine-а.
- [ ] e2e (своим spec-файлом, `test/e2e/linked-reconnect.spec.ts`): Remove из строки без связи — машины нет в
      списке на обеих сторонах после следующего набора; «Reconnect» набирает сразу, без паузы повторов.
- [ ] e2e: «Change address…» с верным адресом — связь восстановлена, с чужим — отказ текстом в окне.
- [ ] Unit test: «Link a machine» показывает уже связанную машину с «Already linked», без кнопки привязки, со
      строкой про одну связь в обе стороны.
- [ ] Unit test: строка машины показывает обе строки доступа и меняет их, когда доступ включают или выключают на
      любой стороне.
- [ ] Снимки UI в светлой и тёмной темах (строка без связи, строки доступа, Settings → Machines, окно
      «Change address…», «Link a machine» с уже связанной машиной) — смотрит reviewer.

## Где в коде

- `src/renderer/shell/sidebar/MachinesSection.tsx` — кнопки, меню, состояния, переименование.
- `src/renderer/settings/MachinesSection.tsx` — «Remove».
- `src/renderer/machines/useMachines.ts` — `reconnectMachine`, `setMachineAddress`.
- `src/renderer/machines/ChangeAddressDialog.tsx` (новый).
- `src/renderer/palette/commands.ts` — две команды.
- `src/renderer/machines/LinkMachineDialog.tsx`, `src/main/link/discovery.ts:9-10` — уже связанные в списке.
- `src/shared/ipc/link.ts`, `src/main/link/service.ts` — доступ другой стороны в `link.state`, если его там нет.
- `test/unit/machines-section.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/linked-reconnect.spec.ts`.
