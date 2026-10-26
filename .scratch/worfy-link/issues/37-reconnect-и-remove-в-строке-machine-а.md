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
3. **Сторона host-а.** Строка client-а, который отключился, — «Offline» и «Waiting for <name> to connect», с
   «Remove», без «Reconnect» (состояние — из Ticket-а 36, пункт 7).
4. **Settings → Machines**: у каждой Linked machine-а — «Remove».
5. **Command palette**: «Reconnect machine…» и «Remove machine…» — выбор Machine-а, затем то же действие, что у
   кнопки. «Reconnect machine…» предлагает только Machine-ы без связи, у которых Reconnect есть (пункт 3).
6. **«Revoke» → «Remove» везде в UI**: меню, tooltip «Certificate changed» (`:83`), тексты Settings. Remove
   спрашивает подтверждение: что машина забудется на обеих сторонах и связать её снова можно только новым кодом.
   Имя канала IPC `link.revoke` не меняется.
7. **Подсказка про Windows firewall** из Ticket-а 36 (пункт 8) — текстом в строке Machine-а.

## Готово, когда

- [ ] Unit test секции: строка без связи — кнопки «Reconnect» и «Remove»; строка host-а с отключённым client-ом —
      «Offline», «Waiting for <name> to connect», «Remove», без «Reconnect»; подсказка firewall видна, когда main
      её отдаёт.
- [ ] Unit test: «Remove» спрашивает подтверждение; «Cancel» ничего не вызывает; слова «Revoke» в UI нет.
- [ ] Unit test Command palette: «Reconnect machine…» и «Remove machine…» вызывают `link.reconnect` и
      `link.revoke` для выбранной Machine-а.
- [ ] e2e (своим spec-файлом, `test/e2e/linked-reconnect.spec.ts`): Remove из строки без связи — машины нет в
      списке на обеих сторонах после следующего набора; «Reconnect» набирает сразу, без паузы повторов.
- [ ] e2e: «Change address…» с верным адресом — связь восстановлена, с чужим — отказ текстом в окне.
- [ ] Снимки UI в светлой и тёмной темах (строка без связи, строка host-а, Settings → Machines, окно
      «Change address…») — смотрит reviewer.

## Где в коде

- `src/renderer/shell/sidebar/MachinesSection.tsx` — кнопки, меню, состояния, переименование.
- `src/renderer/settings/MachinesSection.tsx` — «Remove».
- `src/renderer/machines/useMachines.ts` — `reconnectMachine`, `setMachineAddress`.
- `src/renderer/machines/ChangeAddressDialog.tsx` (новый).
- `src/renderer/palette/commands.ts` — две команды.
- `test/unit/machines-section.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/e2e/linked-reconnect.spec.ts`.
