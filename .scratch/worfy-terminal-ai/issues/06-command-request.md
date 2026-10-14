# 06 — Command request: строка `# …` + Enter и панель Cmd+I вставляют команду, не запуская её

Type: task
Status: claimed — 2026-10-14
Branch: worfy-terminal-ai/06
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(c) (строка, которая начинается с `# `, и Enter, или Cmd/Ctrl+I — маленькая панель над Terminal-ом; Sonnet возвращает команду, она вставляется в строку и никогда не запускается сама), пункт 2 (функция по требованию доступна до `rejected`), пункт 3 (контекст, redaction), пункт 4 (сначала zsh) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 6 — ничего не запускается само; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34`, [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6

## Что происходит

- После Ticket-а 03 main умеет заменить строку shell-а: `insert <текст>` — widget ставит `BUFFER`,
  курсор в конец, Enter не нажимает. `status <текст>` показывает короткую серую строку. Это работает
  только у Terminal-а, чей zsh подключился к socket-у: у другого shell-а (bash, PowerShell на Windows)
  вставлять некуда.
- После Ticket-а 02 у main есть `request('request', …)`: Sonnet с `effort: 'low'`, тайм-аут 30 с,
  отказ только при `rejected`.
- Без `setopt INTERACTIVE_COMMENTS` zsh на строку `# найди файлы` отвечает «command not found: #»;
  с ним — молча пропускает.
- Terminal Node: xterm создаётся в `src/renderer/canvas/nodes/TerminalNode.tsx:86`, шапка — `:241-263`,
  экран — `:270`. Cmd+I и Ctrl+I сейчас нигде в worfy не заняты (grep `src`). В терминале Ctrl+I — это
  Tab: отнимать его у shell-а нельзя.
- Сочетания в renderer слушают `metaKey`. Ticket 11 `worfy-windows` (открыт) создаёт
  `src/renderer/platform.ts` с `isPrimary(event)` — ⌘ на Mac, Ctrl на Windows — и подписями сочетаний.
  Terminal AI в этом Epic-е работает только с zsh, на Windows его нет, поэтому Ctrl-ветка панели
  сейчас не нужна.
- Пометки доступа (`src/shared/ipc/channels.ts:20-34`): `project` — работа с Project-ами этой
  Machine, Linked machine-у открыт при включённом доступе; `local` — состояние машины экрана. По
  ADR-0052, пункт 6, Linked machine может в Project-ах всё, кроме действий рабочего стола машины
  Project-а. Окно на Project-е Linked machine-а шлёт каналы `project` на Machine окна
  (`src/renderer/ipc.ts:141-146`).
- Spike 2026-10-09: Sonnet по описанию словами — `find . -type f -size +100M -mtime -7`,
  `lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill`; ответ 1,4–1,9 с.

## Что делаем

1. **Строка `# …`** — `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый), обёртка
   `accept-line`.
   - Строка начинается с `# ` (решётка и пробел) — не исполняется: `ask <id> request <текст>`, серым
     `status` «asking Claude…».
   - Ответ — `insert <команда>`: строка заменяется командой, курсор в конце (spec, «Решено без
     владельца», пункт 5). Enter нажимает пользователь.
   - Любое нажатие до ответа — `cancel <id>`, строка остаётся `# …`.
   - Отказ — серым `status` с причиной («Limits reached until 14:20», «Terminal AI is off»).
   - Строка `# …` в историю zsh не попадает. Без `# ` в начале — `accept-line` как обычно.
2. **Где есть панель.** Только у Terminal-а, чей zsh подключён к socket-у Ticket-а 03 (spec, «Решено
   без владельца», пункт 12). Состояние — канал `terminalAi.request.state {projectId, nodeId}` →
   `{available, busy}` и событие `terminalAi.request.changed`: `available` — zsh подключён и Command
   request включён в Settings, `busy` — идёт команда. В остальных Terminal-ах Cmd+I и Ctrl+I уходят в
   shell, как сейчас.
3. **Панель Cmd+I** — `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый).
   - Terminal в фокусе, `available`, нажато ⌘I без Ctrl — xterm клавишу не получает
     (`attachCustomKeyEventHandler` в `TerminalNode.tsx`), над экраном Terminal-а открывается панель:
     поле, Enter — запрос, Esc — закрыть. Если к claim `src/renderer/platform.ts` Ticket-а 11
     `worfy-windows` уже на main — проверка и подпись `⌘I` берутся из него; иначе — `metaKey`, как у
     остальных сочетаний renderer.
   - Запрос — канал `terminalAi.request {projectId, nodeId, text}`. Main зовёт assist и шлёт
     `insert` в shell этого Terminal-а.
   - Ответ пришёл — панель закрывается, фокус возвращается в Terminal.
   - `busy` — панель пишет «Terminal is busy» и не шлёт. Отказ по Limits — текст в панели.
   - **Реестр сочетаний** `src/shared/shortcuts.ts` — Ticket 11 Epic-а
     [worfy-ui](../../worfy-ui/issues/11-реестр-сочетаний-и-окно-keyboard-shortcuts.md). Решается в
     момент мержа: перед мержем этот Ticket перебазируется на свежий main; если Ticket 11 `worfy-ui`
     уже там, этот вносит ⌘I в реестр в том же PR. Кто вливается последним, тот отвечает за запись.
     Запись — только для Mac (на Windows записи нет — Ctrl+I остаётся Tab-ом оболочки), область —
     Terminal Node с интеграцией zsh; проверка в `TerminalNode.tsx` — через `matches` реестра
     (`src/renderer/shortcuts/match.ts`). То же правило — в Ticket-е 11 `worfy-ui` (spec, примечание
     docs-PR `worfy-ui` после «Решено без владельца»).
4. **Каналы** — `src/shared/ipc/terminal-ai-request.ts`, `src/main/ipc/terminal-ai-request.ts`
   (новые), пометка `project`: панель работает с Terminal-ом Project-а, рабочий стол ей не нужен. С
   экрана Linked machine-а при включённом доступе она работает так же, как строка `# …`, и тратит
   подписку Machine Project-а (решение владельца 8(a)).
5. **Обработчик** — `src/main/terminal-ai/features/command-request.ts` (новый): `ask request` из shell-а
   и вызов из канала. Контекст: текст просьбы, текущая строка (если не пустая), папка, ветка, код
   выхода, последние 20 команд.

**Не входит:** запуск команды — никогда; Fix (Ticket 07); Ctrl+I на Windows — вместе с Terminal AI для
PowerShell, позже.

## Готово, когда

- [ ] Contract `test/contract/terminal-ai-request.test.ts` (новый), настоящий zsh, assist — поддельный: `# list big files` + Enter — строка стала ответом fake (`find . -size +100M`), команда не запущена (файла-метки, который она создала бы, нет; main не писал в pty `\r`); в журнале — функция `request`, модель `sonnet`, текст просьбы.
- [ ] Тот же contract: нажатие до ответа — `cancel`, строка осталась `# list big files`; `#comment` без пробела — обычный `accept-line`; в `history` строки `# list big files` нет; Limits `rejected` — серым причина со временем сброса, запроса нет; Limits 0,9 окна 5 часов — запрос уходит (функция по требованию).
- [ ] Тот же contract: `terminalAi.request.state` — `available` у zsh с интеграцией, не `available` у Terminal-а на `/bin/sh` и при выключенном Command request; `busy` во время `sleep 1`; `terminalAi.request` к Terminal-у без интеграции — ошибка без запроса к assist; каналы помечены `project`.
- [ ] Unit (jsdom) `test/unit/terminal-ai-request.test.tsx` (новый): `available` — ⌘I в Terminal открывает панель, Ctrl+I — нет (уходит в xterm); не `available` — ⌘I уходит в xterm, панели нет; Esc закрывает; `busy` — «Terminal is busy».
- [ ] e2e `test/e2e/terminal-ai-request.spec.ts` (новый), fake с ответом: `Meta+I` в Terminal Node — панель, текст, Enter — в строке xterm ответ fake, панель закрыта; вывода команды нет, пока test не нажал Enter.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: панель Cmd+I над Terminal-ом в светлой и тёмной теме — `../evidence/06-request-panel-light.png`, `../evidence/06-request-panel-dark.png`. Как проверить: окно worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «`# list big files` + Enter вставляет ответ и ничего не запускает»:
сейчас zsh пытается исполнить `#`. Потом состояние панели, unit панели, e2e. В «Итог» — как падал
первый test и откуда взята проверка ⌘ (`platform.ts` или `metaKey`).

## Где в коде

- `src/main/terminal-ai/features/command-request.ts` (новый)
- `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый)
- `src/shared/ipc/terminal-ai-request.ts` (новый)
- `src/main/ipc/terminal-ai-request.ts` (новый)
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый)
- `src/shared/shortcuts.ts` (только если к мержу Ticket 11 worfy-ui уже в main: запись ⌘I)
- `test/contract/terminal-ai-request.test.ts` (новый)
- `test/unit/terminal-ai-request.test.tsx` (новый)
- `test/e2e/terminal-ai-request.spec.ts` (новый)

Только чтение: `src/renderer/platform.ts` Ticket-а 11 `worfy-windows` и `src/renderer/shortcuts/match.ts`
Ticket-а 11 `worfy-ui`, если они к claim влиты.

## Итог

Заполняется при закрытии.
