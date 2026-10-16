# 11 — Security: программа, запущенная в Terminal-е, может писать в соединение shell-а от его имени

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-16 («со всем согласен», кроме двух рисков — им Ticket-ы):
[Ticket 03](03-zle-widget-socket-и-suggestion-из-истории.md), «Итог», раздел «Решено без владельца»,
пункт 9 («Не сделано») и долг из «Gate оркестратора (2026-10-14)» «к пункту 9»; [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md).

## Что происходит

- **Соединение shell-а с main.** ZLE widget открывает Unix socket (`zsocket`), переносит соединение на
  descriptor выше 9 и шлёт `hello <token>`
  (`src/main/terminal/zsh/rc.d/10-assist.zsh:386-398`). Main принимает соединение, если токен жив и
  ещё не занят (`src/main/terminal-ai/socket.ts:10-13`, `issue` — `:120-124`, `revoke` — `:127-132`).
- **Descriptor наследуют дочерние процессы.** У zsh нет close-on-exec для descriptor-а, который он
  открыл: каждая программа, запущенная в Terminal-е, получает это соединение. Descriptor-ы 3–9 у неё
  закрыты (test `test/contract/terminal-ai-zle.test.ts:850-863`), но descriptor ≥ 10 — открыт.
- **Что может такая программа.**
  - Писать от имени shell-а: `ask <id> <feature> <line>` с любой строкой
    (`src/main/terminal-ai/protocol.ts:8-15`) — запросы к модели на подписке владельца от чужого
    процесса.
  - Читать то, что main шлёт shell-у: verifier Ticket-а 03 из дочернего `/bin/sh` прочитал `insert`.
    Токен и строки других Terminal-ов ей недоступны.
- Это важно для Fix (Ticket 07): ответ модели о команде с ошибкой идёт в то же соединение.
- Вариант из Ticket-а 03: закрывать соединение в `preexec` и открывать заново в `precmd` с
  многоразовым токеном. Цена: токен живёт в переменной shell-а всё время, переподключение на каждую
  команду.

## Что делаем

1. **Сначала красные contract test-ы** в `test/contract/terminal-ai-zle.test.ts` (fake backend, без
   настоящей модели): программа, запущенная из shell-а, (а) не находит открытого соединения с socket
   ни на одном descriptor-е; (б) запись `ask` в любой descriptor, который она унаследовала, не доходит
   до main. На main оба красные.
2. **Соединение не живёт, пока идёт команда.** `preexec` закрывает descriptor, `precmd` открывает
   соединение заново и шлёт `hello`. Токен — многоразовый для своего Terminal-а: main принимает его
   снова, когда прежнее соединение этого токена закрыто; `revoke` при выходе shell-а — как сейчас.
3. **Токен не наследуется.** Переменная с токеном — не exported (`typeset -g` без `-x`), её нет в
   окружении дочерних процессов; test это проверяет (`env` из дочернего процесса).
4. **Переподключение не теряет запросов.** `ask`, открытый до команды, отменяется (`cancel`), ответ
   main на закрытое соединение отбрасывается. Next command (Ticket 05) и Fix (Ticket 07) после команды
   работают — их contract test-ы зелёные без правки ожиданий.
5. **Цена по времени.** Замер: переподключение в `precmd` — p50 и p95 на 100 команд; значение — в
   «Итог». Если p95 больше 20 ms — строка в «Итог» и вопрос владельцу, не правка вслепую.

## Готово, когда

- [ ] Test-ы пункта 1 красные на main и зелёные с правкой.
- [ ] Test «переменной с токеном нет в окружении дочернего процесса» зелёный.
- [ ] Contract test-ы Terminal AI (`terminal-ai-zle`, `terminal-ai-suggest`, `terminal-ai-next-command`,
      `terminal-ai-request`, `terminal-ai-fix`) зелёные без правки ожиданий.
- [ ] Замер пункта 5 — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

## Тесты

- `test/contract/terminal-ai-zle.test.ts` — дочерний процесс без соединения и без токена;
  переподключение после каждой команды.
- Там же (socket проверяется через `ShellLink`, отдельного test-файла у `socket.ts` нет): повторный
  `hello` тем же токеном после закрытия соединения принят, при живом соединении — отказ.
- Мутанты: не закрывать в `preexec` — красный (а); токен exported — красный test окружения; main
  принимает второе соединение при живом первом — красный test socket-а.

## Где в коде

- `src/main/terminal/zsh/rc.d/10-assist.zsh`
- `src/main/terminal-ai/socket.ts`
- `test/contract/terminal-ai-zle.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/terminal-ai/protocol.ts`,
`src/main/terminal-ai/shell-link.ts`, `src/main/terminal/pty.ts`, `src/main/terminal/zsh/zshenv.zsh`.

## Вне скоупа

- Другие shell-ы (только zsh, ADR-0058).
- Защита от программы, которая сама подключается к socket-у: папка 0700 и файл 0600
  (`socket.ts:4-5`) — это уже есть.
- Привязка Esc независимо от Settings (долг Ticket-а 03) — отдельно.

## Итог

—
