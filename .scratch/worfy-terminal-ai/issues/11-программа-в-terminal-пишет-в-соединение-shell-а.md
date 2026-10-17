# 11 — Security: программа, запущенная в Terminal-е, может писать в соединение shell-а от его имени

Type: task
Status: claimed 2026-10-17T14:15Z
Branch: worfy-terminal-ai/11
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

- [x] Test-ы пункта 1 красные на main и зелёные с правкой.
- [x] Test «переменной с токеном нет в окружении дочернего процесса» зелёный.
- [ ] Contract test-ы Terminal AI (`terminal-ai-zle`, `terminal-ai-suggest`, `terminal-ai-next-command`,
      `terminal-ai-request`, `terminal-ai-fix`) зелёные без правки ожиданий.
- [x] Замер пункта 5 — в «Итог».
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

**Первые test-ы.** На базе (`origin/main` 9d79f7e3, правка только в test-файле)
`node scripts/vitest-electron.mjs test/contract/terminal-ai-zle.test.ts` — exit 1, 7 из 42 красные:
дочерняя программа нашла `socket:14` (соединение shell-а); `ask` с id 999, который она записала во
все descriptor-ы, дошёл до main; повторного hello после команды нет; токен не открывает соединение,
пока идёт команда; закрытие соединения снимало Terminal с «подключён»; после удаления файла socket-а
команда оставляла shell без соединения; токена в переменной shell-а нет. С правкой — 44 из 44 зелёные.

**Как сделано.**

- zsh (`rc.d/10-assist.zsh`): соединение открывается в `zle-line-init` каждого prompt-а
  (`_worfy_assist_connect`: `zsocket`, перенос на descriptor выше 9, `hello <token>`, `zle -F`) и
  закрывается в `preexec` (`_worfy_assist_preexec`: `cancel` открытого ask, затем закрытие). Hook
  `preexec` — первый в `preexec_functions`: hook-и до него запускали бы свои программы с соединением.
  Первое соединение — тоже на первом prompt-е, не при чтении rc.d/: `.zlogin` пользователя
  запускается позже. Внутри команды (`vared`, `select`; `$CONTEXT` не `start`/`cont`) соединение не
  открывается.
- Токен и путь socket-а остаются в переменных shell-а `__worfy_assist_token` /
  `__worfy_assist_socket`: `typeset -g` без `-x`, а `zshrc.zsh` снимает export с каждой `__worfy_`
  переменной и под `setopt allexport`.
- main (`socket.ts`): токен многоразовый — hello принимается, когда прежнее соединение этого токена
  закрыто; при живом — отказ, как раньше. Соединение считается закрытым по концу потока (`end`), не
  по `close`: `close` приходит на оборот event loop позже, и hello следующего prompt-а успевал прийти
  раньше (под нагрузкой мутант «только `close`» — 4 отказа `in-use` на 88 hello, 3 из 4 прогонов
  красные; с правкой 0 отказов).
- Shell считается подключённым от первого hello до `revoke` (выход shell-а) или `closeSync`; пока
  идёт команда, `connected()` — true, а `push()` — false (писать некуда). `disconnected` теперь
  только при выходе shell-а. Так Command request («busy», а не «нет панели» во время команды) и Fix
  (упавшая команда не забывается при закрытии соединения в `preexec`) работают как раньше.
- Закрытое соединение снимает свой открытый ask так же, как `cancel` (main знает id последнего ask
  соединения); ответ на него не уходит ни в старое, ни в новое соединение.
- После каждого hello main шлёт `config` (`ShellLink.greet`, не менялся). zsh теперь пересчитывает
  строку и снимает открытый ask только когда набор features изменился: иначе `config` нового
  соединения отменял ask Next command сразу после prompt-а (8 contract test-ов
  `terminal-ai-next-command` были красные без этого).
- Файл socket-а удалён (macOS чистит `$TMPDIR`): раньше подключённые shell-ы держали соединение;
  теперь они подключаются заново после каждой команды, поэтому main при закрытии соединения проверяет
  файл и слушает заново, если его нет.

**Изменённые ожидания в `terminal-ai-zle.test.ts`** (старый замысел противоречит пунктам 2–3):

- «the environment of the shell has neither the token nor the socket»: было «токена нет и в
  переменной shell-а» (`token:gone`) — теперь токен в переменной shell-а, не exported (`(t)` —
  `scalar`); проверка `env` дочернего процесса — та же.
- «the connection is not on a descriptor programs use by convention»: `$__worfy_assist_fd` и
  descriptor-ы 3–9 смотрятся из widget-а на prompt-е, а не из команды — во время команды соединения
  нет.
- «the token, the nonce and the lines … in no log line»: строку-мусор shell шлёт из widget-а, не
  командой — по той же причине.
- `withAskingScript` заново шлёт `config` с `probe` после команды (`probeOn`): `config` приветствия
  называет только настоящие features.

Остальные contract test-ы Terminal AI (`terminal-ai-suggest`, `terminal-ai-next-command`,
`terminal-ai-request`, `terminal-ai-fix`, `terminal-ai-assist`) — без правок, зелёные (181 из 181
вместе с `terminal-ai-zle`).

**Мутанты** (каждый на копии файла, восстановлен из копии): не закрывать в `preexec` — 6 красных
(в том числе (а) и (б)); токен exported в `_worfy_assist_connect` — красный test окружения; второй hello
при живом соединении принят — 3 красных; без `cancel` при закрытии — красный test ask-а; без повторного
listen — красный test удалённого файла; `revoke` без `disconnected` — красный test «hello again … after every command» (его конец — выход shell-а);
`config` всегда пересчитывает строку — красный test `config`; соединение в `vared` — красный test
`vared`.

**Замер пункта 5** (100 команд, `true` и `/usr/bin/true` по очереди, `EPOCHREALTIME` вокруг функции
в zsh, load average около 8): переподключение (`zsocket` + hello + `zle -F`) — p50 0,161 ms, p95
0,238 ms, максимум 0,362 ms (101 замер, 0 неудач); закрытие в `preexec` — p50 0,091 ms, p95 0,218 ms.
Порог 20 ms не задет.

**Что осталось открытым** (не правилось, для владельца):

- Программы, которые запускает widget или `zle -F` handler на prompt-е (fzf по Ctrl+T, история через
  atuin), и подстановки `$(…)` в prompt при `zle reset-prompt`, по-прежнему получают соединение на
  descriptor-е выше 9: у zsh нет close-on-exec. Закрыты только команды строки.
- Если удалена вся папка socket-а, а не файл, shell-ы прежних Terminal-ов остаются без соединения до
  своего перезапуска: новая папка — новый путь.
- Если shell перестал переподключаться, не выйдя (`exec bash`, чужой widget заменил `zle-line-init`),
  main считает его подключённым до выхода: панель ⌘I есть, но ответу некуда идти («The shell is
  gone»).

**Круг 2 (gate round 1 — REJECTED, две находки med).**

- Находка 1: программа, которую на prompt-е запустил widget, `zle -F` handler или `zshaddhistory`
  (`sleep 8 &!`), держит копию descriptor-а. Тогда закрытие в `preexec` не давало main конца потока,
  hello следующего prompt-а получал отказ «in use», а `push()` писал в старое соединение, которое
  читала только эта программа. Исправлено новым сообщением протокола `bye`
  (`src/main/terminal-ai/protocol.ts`, след расширен оркестратором). Shell шлёт `cancel`
  открытого ask, затем `bye` и закрывает descriptor. Main на `bye` сразу освобождает токен, снимает
  открытый ask и закрывает соединение со своей стороны: умирает и копия программы. Строки после `bye`
  в том же соединении не читаются. Процесс без токена соединение не захватит: hello без живого
  токена — отказ, как раньше. Копией он может только сам прислать `bye` и тем оборвать связь до
  следующего prompt-а — то же, что он мог и раньше, прислав слишком длинную строку.
- Находка 2: связь закрывалась поздно. Порядок zsh 5.9 для строки из line editor-а:
  **zle-line-finish → zshaddhistory → preexec → preexec_functions → команда**. Теперь связь уходит в
  `zle-line-finish` (`_worfy_assist_line_finish`, при `$CONTEXT` start или cont). У строки,
  продолжающейся в PS2, связь открывается снова в `zle-line-init` следующей строки и уходит после
  последней. `preexec` остался запасным путём: для команды не из line editor-а и для случая, когда
  чужой widget занял `zle-line-finish`.
- Гонки `end` / `close` / `bye` / новый hello. `bye` лежит в старом соединении раньше, чем shell
  открывает новое, поэтому main читает его до hello. Токен освобождается синхронно, при чтении `bye`,
  и от `end` не зависит. Позднее `close` старого соединения ничего не трогает: у токена уже другое
  соединение или никакого. Без `bye` (shell убит, запись не удалась) остаётся освобождение по `end`.
  Для него теперь есть детерминированный test: main пишет больше, чем читает старое соединение,
  поэтому его `close` не приходит, а hello нового всё равно принимается.
- Новые test-ы в `terminal-ai-zle.test.ts`:
  - программа из `zshaddhistory` не находит socket — и для однострочной, и для трёхстрочной команды;
  - widget запускает фоновую программу, держащую копию: после `true` insert доходит до shell-а, а
    `ask`, который программа пишет в копию после команды, до main не доходит;
  - `bye` освобождает токен, и ask за ним не читается;
  - при занятом `zle-line-finish` закрывает `preexec`;
  - hello нового соединения до `close` старого.
- На исходниках 880656a2 test-ы `zshaddhistory`, фоновой программы и `bye` красные (3 из 48); с
  правкой — 49 из 49.
- Мутанты круга 2:
  - shell не шлёт `bye` — 2 красных;
  - main не реагирует на `bye` — 3;
  - `bye` не закрывает соединение — 2;
  - нет закрытия в `zle-line-finish` — красный test `zshaddhistory`;
  - закрытие только при `$CONTEXT` start — красный test трёхстрочной команды;
  - освобождение токена только по `close` — красный детерминированный test;
  - нет запасного `preexec` — красный test занятого `zle-line-finish`.
- Замер после круга 2 (100 команд, load average около 5): открытие связи — p50 0,099 ms, p95
  0,179 ms; закрытие с `cancel` и `bye` — p50 0,084 ms, p95 0,180 ms; 0 неудач.
- Test «the socket closed … also when it writes to the closed socket first» переименован в «… also
  when it asks with no socket to connect to»: в закрытый socket он больше не пишет.
- Что по-прежнему держит связь (вопрос владельцу, отдельный Ticket):
  - программы, которые на prompt-е запускают widget-ы и `zle -F` handler-ы (fzf по Ctrl+T, atuin);
  - подстановки `$(…)` в prompt при `zle reset-prompt`;
  - hook-и `zle-line-finish`, которые добавлены раньше worfy (из `.zshrc` пользователя).
  
  Пока идёт prompt, такие программы могут писать в соединение. После следующей строки их копия
  мертва.
