# 07 — Command request в SSH session: панель Cmd+I ставит команду в удалённую строку без Enter

Type: task
Status: open
Blocked by: 04, 06
Source: решения владельца 2026-10-18: пункты 1 (первый шаг — Fix и Command request), 4, 9 ([spec.md](../spec.md)); «Решено без владельца», пункты 3 (в SSH session — только панель Cmd+I), 7 (ответ без Enter); Command request Epic-а worfy-terminal-ai — [Ticket 06](../../worfy-terminal-ai/issues/06-command-request.md) и [Ticket 13](../../worfy-terminal-ai/issues/13-панель-cmd-i-текущая-строка-и-первая-строка-terminal-а.md)

## Что происходит

- Панель Cmd+I — `src/renderer/canvas/nodes/TerminalAiRequest.tsx`, каналы
  `src/main/ipc/terminal-ai-request.ts`, запрос — `src/main/terminal-ai/features/command-request.ts`.
- Во время `ssh host` панель видит `busy`: `terminal-ai-request.ts:49` берёт `commandRunning`
  локального shell-а. `available` требует связи zsh с socket-ом (`terminal-ai-request.ts:48`).
- После Ticket-а 13 `worfy-terminal-ai` панель шлёт модели текущую строку из буфера xterm.
- После Ticket-а 06 этого Epic-а есть `remote-context.ts`; после Ticket-а 04 — `remote-insert`.

## Что делаем

1. **Доступность** — `terminal-ai-request.ts`: в SSH session с интеграцией `available` — Remote host
   включён, Command request включён в Settings; `busy` — удалённый `commandRunning`.
2. **Запрос** — `command-request.ts`: в SSH session — контекст из `remote-context.ts`, ответ — через
   `remote-insert`, заменяет удалённую строку способом spike-а.
3. Строка `# …` + Enter в удалённом bash не перехватывается: это комментарий bash («Решено без
   владельца», пункт 3).

**Не входит:** строка `# …` на Remote host-е; Suggestion и Next command.

## Готово, когда

- [ ] Contract `test/contract/terminal-ssh-request.test.ts` (новый), настоящие zsh и bash, поддельные
  `ssh` и assist: в SSH session `terminalAi.request.state` — `available` true, `busy` false; запрос «list
  files» — в журнале fake удалённая папка, `remote` с системой и shell-ом, ветки нет; ответ — в
  удалённой строке; не запущен (нет `\r`).
- [ ] Тот же contract: удалённая команда идёт — `busy` true, запроса нет; SSH session без интеграции —
  `available` false; после выхода из SSH session — локальный Command request как раньше.
- [ ] Тот же contract: строка `# list files` + Enter в удалённом bash — запроса к модели нет.
- [ ] e2e `test/e2e/terminal-ssh-request.spec.ts` (новый), fake с ответом, поддельный `ssh`: в SSH
  session Cmd+I — панель; запрос — ответ в строке xterm; вывода команды нет до Enter test-а.
- [ ] `test/contract/terminal-ai-request.test.ts` и `test/e2e/terminal-ai-request.spec.ts` зелёные без
  правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «в SSH session `available` true, `busy` false»: сегодня `busy`
true. Потом запрос, отказы, e2e.

## Где в коде

- `src/main/terminal-ai/features/command-request.ts`
- `src/main/ipc/terminal-ai-request.ts`
- `test/contract/terminal-ssh-request.test.ts` (новый)
- `test/e2e/terminal-ssh-request.spec.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
