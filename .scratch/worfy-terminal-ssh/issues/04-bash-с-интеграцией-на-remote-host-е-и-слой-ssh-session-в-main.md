# 04 — bash с интеграцией на Remote host-е: команда запуска в base64, слой SSH session в main, вставка ответа в удалённую строку

Type: task
Status: open
Blocked by: 02, 03
Source: решения владельца 2026-10-18: пункты 2 (только память, только включённые Remote host-ы), 5 (bash первым, restricted shell без интеграции), 7 (OSC 633 с nonce), 8 (`ssh -t host <команда с интеграцией в base64>`, никакого ввода в открытую сессию), 9 (пароли) ([spec.md](../spec.md)); «Решено без владельца», пункт 7; риски 1–7 spec-а; `evidence/01-spike-ssh.md` Ticket-а 01

## Что происходит

- После Ticket-а 02 обёртка `ssh` распознаёт интерактивный вход, знает имя Remote host-а и сообщает
  main начало SSH session. Запуск пока всегда обычный.
- После Ticket-а 03 main знает список Remote host-ов с флагом «Terminal AI включён».
- Файлы временной папки worfy Terminal-а пишутся заново при каждом старте
  (`src/main/terminal/shell-integration.ts`).
- `ShellState` (`src/main/terminal/osc.ts:65`) — одно состояние на Terminal: локальный zsh.

## Что делаем

1. **Удалённый скрипт** — `src/main/terminal/bash/integration.bash` (новый). Печатает A, B, C, D, E и
   `P;Cwd=` с nonce SSH session, как `integration.zsh`. Строка с пробелом в начале — без E. Читает
   файлы входа пользователя, как login bash: `/etc/profile`, потом первый из `~/.bash_profile`,
   `~/.bash_login`, `~/.profile`. `HISTFILE` не трогает. Сообщает `P;System=<uname -s>` один раз.
2. **Команда запуска** — `src/main/terminal/ssh-bootstrap.ts` (новый). Строка POSIX sh по выбору
   spike-а: декодирует скрипт из base64-аргумента и запускает bash без файла на диске. Restricted
   shell, нет bash, нет base64 — `exec` login shell-а пользователя без интеграции.
3. **Список для обёртки.** main пишет в временную папку worfy Terminal-а файл с именами включённых
   Remote host-ов (0600) и команду запуска. Переписывает его на `terminalAi.hosts.changed`. Socket
   не годится: на время команды связь zsh с main закрыта (`10-assist.zsh:15-17`).
4. **Обёртка** — `rc.d/50-ssh.zsh`: для включённого Remote host-а создаёт nonce SSH session, сообщает
   его main (`P;SshNonce=` с локальным nonce) и запускает `ssh -t <аргументы> '<команда запуска>'`.
   Способ передачи nonce — по spike-у (риск 1).
5. **Слой SSH session** — `osc.ts`, `ssh-session.ts`: удалённое состояние Terminal-а —
   `commandRunning`, `awaitingInput`, папка, последние команды, последняя команда с кодом выхода и
   выводом, альтернативный экран. Принимается только с nonce SSH session. Локальные папка и команды
   не меняются. Локальный D сбрасывает слой (выход и обрыв связи).
6. **Вставка ответа** — `src/main/terminal/remote-insert.ts` (новый): пишет текст в pty способом
   spike-а. Только если удалённый слой `awaitingInput` и не `commandRunning`. Байтов `\r` и `\n` нет
   никогда: такой текст — отказ.

**Не входит:** Fix и Command request (Ticket-ы 06, 07); zsh на Remote host-е (Ticket 09).

## Готово, когда

- [ ] Unit `test/unit/terminal-ssh-bootstrap.test.ts` (новый): команда запуска — одна строка POSIX
  sh (`sh -n` без ошибок); скрипт в ней — base64 без переводов строк; длина — в пределе spike-а.
- [ ] Unit `test/unit/terminal-osc-ssh.test.ts`: удалённые A–E с nonce SSH session меняют удалённый
  слой, а локальные папка и команды прежние; с локальным nonce или чужим — не принимаются; локальный
  D сбрасывает слой.
- [ ] Contract `test/contract/terminal-ssh-bash.test.ts` (новый), настоящие zsh и bash, поддельный
  `ssh` из Ticket-а 02: включённый Remote host — удалённый prompt, `cd /tmp; false` — в удалённом
  слое папка `/tmp`, код выхода 1; локальная папка не изменилась.
- [ ] Тот же contract: временный «HOME Remote host-а» после SSH session — новых файлов нет, кроме
  `.bash_history`; в ней только набранные команды; файлов в `TMPDIR` test-а не появилось.
- [ ] Тот же contract: `~/.bash_profile` и `~/.profile` пользователя прочитаны в порядке login bash
  (метки в журнале test-а).
- [ ] Тот же contract: невключённый Remote host — `ssh` запущен с аргументами как набраны, без
  команды запуска.
- [ ] Тот же contract: login shell — rbash — интеграции нет, удалённых последовательностей нет, вход
  открылся; нет `base64` — то же.
- [ ] Тот же contract: пока удалённая команда идёт (`read -s` как запрос пароля), `remote-insert`
  отказывает и main ничего не пишет в pty; текст с `\n` — отказ всегда.
- [ ] Тот же contract: Remote host включён во время SSH session — текущая не меняется, следующий вход
  — с интеграцией.
- [ ] `test/contract/terminal-ssh-wrapper.test.ts` и `test/contract/terminal-shell-integration.test.ts`
  зелёные без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

Сначала падающий test — contract «включённый Remote host → удалённый prompt и папка `/tmp` в
удалённом слое»: команды запуска ещё нет. Потом unit разбора, вставка, крайние случаи.

## Где в коде

- `src/main/terminal/bash/integration.bash` (новый)
- `src/main/terminal/ssh-bootstrap.ts` (новый)
- `src/main/terminal/zsh/rc.d/50-ssh.zsh`
- `src/main/terminal/osc.ts`
- `src/main/terminal/ssh-session.ts`
- `src/main/terminal/shell-integration.ts`
- `src/main/terminal/remote-insert.ts` (новый)
- `test/unit/terminal-ssh-bootstrap.test.ts` (новый)
- `test/unit/terminal-osc-ssh.test.ts`
- `test/contract/terminal-ssh-bash.test.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
