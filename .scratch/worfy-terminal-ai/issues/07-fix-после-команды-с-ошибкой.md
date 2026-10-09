# 07 — Fix: кнопка после команды с ошибкой, Sonnet вставляет исправленную команду, не запуская её

Type: task
Status: open
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(d) (кнопка «Fix» после команды с кодом выхода не 0; Sonnet получает команду и ~50 последних строк вывода, возвращает исправленную; она вставляется и не запускается), пункт 2 (функция по требованию доступна до `rejected`), пункт 3 (хвост вывода — только для Fix; redaction до отправки) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункты 5–6; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34`, [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6

## Что происходит

- После Ticket-а 01 main хранит для каждого Terminal-а последнюю законченную команду: строку (OSC 633
  E), код выхода (OSC 633 D) и вывод от C до D в пределах `REPLAY_LIMIT` — с escape-последовательностями
  цвета и курсора, как его печатала программа.
- После Ticket-а 03 main заменяет строку shell-а сообщением `insert`.
- После Ticket-а 02 у main есть `request('fix', …)`: Sonnet с `effort: 'low'`, тайм-аут 30 с, отказ
  только при `rejected`; хвост вывода разрешён только у `fix`.
- Шапка Terminal Node-а — `src/renderer/canvas/nodes/TerminalNode.tsx:241-263`: заголовок, имя shell-а,
  после выхода shell-а — `exit N` и Restart (`:249-256`), кнопка закрытия. О кодах выхода отдельных
  команд renderer не знает.
- Рассылка событий всем окнам — реестр клиентов Ticket-а 03 Epic-а `worfy-link`
  (`src/main/clients.ts`, `src/main/broadcast.ts`).
- Spike 2026-10-09: на ошибку TS2307 (нет модуля `axios`) Sonnet ответил `npm install axios`, на отказ
  push (на remote есть чужие коммиты) — `git pull --rebase`; ответ с пояснением — до 3,8 с.
- Ticket 06 правит те же `TerminalNode.tsx` и `TerminalNode.css` — поэтому этот Ticket в Wave после
  него (spec, «Волны»).

## Что делаем

1. **Когда кнопка есть.** `available` — последняя команда кончилась с кодом не 0, новая не началась,
   у команды есть текст (не начиналась с пробела), zsh Terminal-а подключён к socket-у, Fix включён в
   Settings. Каналы — по образцу `projects.settings.get` и `projects.settings.changed`:
   - `terminalAi.fix.state {projectId, nodeId}` → `{available}` — при монтировании Node-а;
   - событие `terminalAi.fix.changed {projectId, nodeId, available}`;
   - `terminalAi.fix.run {projectId, nodeId}` — запрос.

   Файлы — `src/shared/ipc/terminal-ai-fix.ts`, `src/main/ipc/terminal-ai-fix.ts` (новые). Пометка —
   `project`, как у Command request (Ticket 06): Fix работает с Terminal-ом Project-а, рабочий стол ему
   не нужен; с экрана Linked machine-а при включённом доступе кнопка работает и тратит подписку
   Machine Project-а (решение владельца 8(a)).
2. **Кнопка** — в шапке Terminal Node-а, рядом с заголовком: «Fix».
   - Нажатие — `terminalAi.fix.run`, на кнопке «Fixing…».
   - Ответ — строка shell-а заменена исправленной командой, кнопка прячется до следующей ошибки.
   - Отказ (Limits, «Terminal is busy») — короткий текст в шапке на несколько секунд.
3. **Хвост вывода** — `src/shared/terminal-ai/output-tail.ts` (новый): вывод команды без
   escape-последовательностей (CSI, OSC, `\r` перезаписи строки прогресса), последние 50 строк.
4. **Запрос** — `src/main/terminal-ai/fix.ts` (новый). Не в `features/`: Fix начинается с канала IPC,
   а не с сообщения `ask` shell-а, и glob Ticket-а 03 его не собирает. Строка команды, код выхода, папка, ветка, хвост
   вывода → `request('fix', …)` → `insert` в shell. Shell не ждёт ввода — отказ «Terminal is busy».
   Redaction — в контексте Ticket-а 02, в том числе для хвоста вывода.

**Не входит:** автоматический Fix без нажатия; Fix команды внутри
ssh или вложенного shell-а (там нет скриптов worfy).

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-output-tail.test.ts` (новый): цвета, движения курсора и OSC убраны; строка прогресса с `\r` — последнее её состояние; 120 строк → последние 50; пустой вывод — пустой хвост.
- [ ] Contract `test/contract/terminal-ai-fix.test.ts` (новый), настоящий zsh, assist — поддельный: `ls /nonexistent-worfy` → `terminalAi.fix.state` и событие `terminalAi.fix.changed` — `available` true; `terminalAi.fix.run` → в журнале команда `ls /nonexistent-worfy`, код выхода не 0, хвост с «No such file», модель `sonnet`; строка shell-а — ответ fake; команда не запущена (main не писал в pty `\r`).
- [ ] Тот же contract: команда печатает `ghp_…` и падает — в журнале `[redacted]`; началась новая команда — `available` false; команда с пробелом в начале упала — `available` false; Fix выключен в Settings — false; Terminal на `/bin/sh` — false; каналы помечены `project`; Limits `rejected` — отказ со временем сброса, запроса нет.
- [ ] Unit (jsdom) `test/unit/terminal-ai-fix-button.test.tsx` (новый): `available` — кнопка «Fix» в шапке; нажатие — «Fixing…» и вызов канала; отказ — текст; событие `terminalAi.fix.changed` с `available` false прячет кнопку.
- [ ] e2e `test/e2e/terminal-ai-fix.spec.ts` (новый), fake с ответом: команда с ошибкой в Terminal Node — кнопка «Fix»; нажатие — в строке xterm ответ fake; вывода исправленной команды нет, пока test не нажал Enter; после Enter кнопка пропала.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: кнопка «Fix» в шапке Terminal-а в светлой и тёмной теме — `../evidence/07-fix-light.png`, `../evidence/07-fix-dark.png`. Как проверить: окно worfy.
- [ ] `test/e2e/terminal.spec.ts` и `test/e2e/focus.spec.ts` зелёные без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «`ls /nonexistent-worfy` → `available` true»: каналов ещё нет.
Потом хвост вывода, кнопка, e2e. Assist поддельный. В «Итог» — как падал первый test.

## Где в коде

- `src/main/terminal-ai/fix.ts` (новый)
- `src/shared/terminal-ai/output-tail.ts` (новый)
- `src/shared/ipc/terminal-ai-fix.ts` (новый)
- `src/main/ipc/terminal-ai-fix.ts` (новый)
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `test/unit/terminal-ai-output-tail.test.ts` (новый)
- `test/unit/terminal-ai-fix-button.test.tsx` (новый)
- `test/contract/terminal-ai-fix.test.ts` (новый)
- `test/e2e/terminal-ai-fix.spec.ts` (новый)

## Итог

Заполняется при закрытии.
