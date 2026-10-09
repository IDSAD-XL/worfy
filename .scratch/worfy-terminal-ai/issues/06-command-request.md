# 06 — Command request: строка `# …` + Enter и панель Cmd/Ctrl+I вставляют команду, не запуская её

Type: task
Status: blocked — ждёт Ticket 11 Epic-а worfy-windows (`src/renderer/platform.ts` с `isPrimary`: Cmd/Ctrl+I идёт через него)
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(c) (строка, которая начинается с `# `, и Enter, или Cmd/Ctrl+I — маленькая панель над Terminal-ом; Sonnet возвращает команду, она вставляется в строку и никогда не запускается сама), пункт 2 (функция по требованию доступна до `rejected`), пункт 3 (контекст, redaction) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 6 — ничего не запускается само; [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 — каналы `local`; Ticket 11 Epic-а worfy-windows ([11](../../worfy-windows/issues/11-окно-меню-уведомления-и-ctrl-на-windows.md)) — Ctrl вместо ⌘

## Что происходит

- После Ticket-а 03 main умеет заменить строку shell-а: `insert <текст>` — widget ставит `BUFFER`,
  курсор в конец, Enter не нажимает. `status <текст>` показывает короткую серую строку.
- После Ticket-а 02 у main есть `request('request', …)`: Sonnet с `effort: 'low'`, тайм-аут 30 с,
  отказ только при `rejected`.
- Без `setopt INTERACTIVE_COMMENTS` zsh на строку `# найди файлы` отвечает «command not found: #»;
  с ним — молча пропускает.
- Terminal Node: xterm создаётся в `src/renderer/canvas/nodes/TerminalNode.tsx:86`, шапка — `:241-263`,
  экран — `:270`. Cmd+I и Ctrl+I сейчас нигде в worfy не заняты (grep `src`).
- Сочетания в renderer слушают `metaKey` (Ticket 11 `worfy-windows`, «Что происходит»). Ticket 11
  `worfy-windows` (открыт) создаёт `src/renderer/platform.ts`: `isPrimary(event)` — ⌘ на Mac, Ctrl на
  Windows — и подписи сочетаний.
- Окно на Project-е Linked machine-а шлёт каналы `project` на Machine окна, а `local` — на свою
  (`src/renderer/ipc.ts:141-146`, Ticket 09 Epic-а `worfy-link`). Каналы Terminal AI — `local`
  (решение 2): с экрана Linked machine-а панель до shell-а не дотянется.
- Spike 2026-10-09: Sonnet по описанию словами — `find . -type f -size +100M -mtime -7`,
  `lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill`; ответ 1,4–1,9 с.

## Что делаем

1. **Строка `# …`** — `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый), обёртка
   `accept-line`.
   - Строка начинается с `# ` (решётка и пробел) — не исполняется: `ask <id> request <текст>`, серым
     `status` «asking Claude…».
   - Ответ — `insert <команда>`: строка заменяется командой, курсор в конце. Enter нажимает
     пользователь.
   - Любое нажатие до ответа — `cancel <id>`, строка остаётся `# …`.
   - Отказ — серым `status` с причиной («Limits reached until 14:20», «Terminal AI is off»).
   - Строка `# …` в историю zsh не попадает. Без `# ` в начале — `accept-line` как обычно.
2. **Панель Cmd/Ctrl+I** — `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый).
   - Terminal в фокусе, `isPrimary(event)` и `I` — xterm клавишу не получает
     (`attachCustomKeyEventHandler` в `TerminalNode.tsx`), над экраном Terminal-а открывается панель:
     поле, Enter — запрос, Esc — закрыть.
   - Запрос — канал `terminalAi.request {projectId, nodeId, text}` (`local`):
     `src/shared/ipc/terminal-ai-request.ts`, `src/main/ipc/terminal-ai-request.ts` (новые). Main
     зовёт assist и шлёт `insert` в shell этого Terminal-а.
   - Ответ пришёл — панель закрывается, фокус возвращается в Terminal.
   - Shell не ждёт ввода (идёт команда) — панель пишет «Terminal is busy» и не шлёт. Отказ по Limits
     — текст в панели.
   - Подпись сочетания — `⌘I` на Mac, `Ctrl+I` на Windows — из `src/renderer/platform.ts`.
   - Окно на Project-е Linked machine-а — панели нет, Cmd/Ctrl+I уходит в shell, как сейчас (spec,
     «Решено без владельца», пункт 5).
3. **Обработчик** — `src/main/terminal-ai/features/command-request.ts` (новый): `ask request` из shell-а
   и вызов из канала. Контекст: текст просьбы, текущая строка (если не пустая), папка, ветка, код
   выхода, последние 20 команд. Ответ заменяет строку целиком (spec, «Решено без владельца»,
   пункт 6).

**Не входит:** запуск команды — никогда; Fix (Ticket 07).

## Готово, когда

- [ ] Contract `test/contract/terminal-ai-request.test.ts` (новый), настоящий zsh, assist — поддельный: `# list big files` + Enter — строка стала ответом fake (`find . -size +100M`), команда не запущена (файла-метки, который она создала бы, нет; main не писал в pty `\r`); в журнале — функция `request`, модель `sonnet`, текст просьбы.
- [ ] Тот же contract: нажатие до ответа — `cancel`, строка осталась `# list big files`; `#comment` без пробела — обычный `accept-line`; в `history` строки `# list big files` нет; Limits `rejected` — серым причина со временем сброса, запроса нет; Limits 0,9 окна 5 часов — запрос уходит (функция по требованию).
- [ ] Unit (jsdom) `test/unit/terminal-ai-request.test.tsx` (новый): система `darwin` — ⌘I в Terminal открывает панель, Ctrl+I — нет (уходит в xterm); система `win32` — Ctrl+I открывает; Esc закрывает; «Terminal is busy», когда shell не ждёт ввода; окно на Project-е Linked machine-а — панель не открывается.
- [ ] Contract: `terminalAi.request` помечен `local`; запрос к Terminal-у, которого нет, — ошибка без запроса к assist.
- [ ] e2e `test/e2e/terminal-ai-request.spec.ts` (новый), fake с ответом: `Meta+I` в Terminal Node — панель, текст, Enter — в строке xterm ответ fake, панель закрыта; вывода команды нет, пока test не нажал Enter.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: панель Cmd+I над Terminal-ом в светлой и тёмной теме — `../evidence/06-request-panel-light.png`, `../evidence/06-request-panel-dark.png`. Как проверить: окно worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «`# list big files` + Enter вставляет ответ и ничего не запускает»:
сейчас zsh пытается исполнить `#`. Потом unit панели на `darwin` и `win32` (система — параметром,
как в Ticket-е 11 `worfy-windows`), потом e2e. В «Итог» — как падал первый test.

## Где в коде

- `src/main/terminal-ai/features/command-request.ts` (новый)
- `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый)
- `src/shared/ipc/terminal-ai-request.ts` (новый)
- `src/main/ipc/terminal-ai-request.ts` (новый)
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый)
- `src/renderer/platform.ts` (из Ticket-а 11 worfy-windows)
- `test/contract/terminal-ai-request.test.ts` (новый)
- `test/unit/terminal-ai-request.test.tsx` (новый)
- `test/e2e/terminal-ai-request.spec.ts` (новый)

Как окно узнаёт, что показывает Project Linked machine-а, — «Итог» Ticket-а 09 Epic-а `worfy-link`.

## Итог

Заполняется при закрытии.
