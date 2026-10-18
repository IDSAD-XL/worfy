# 02 — Обёртка `ssh` в локальном zsh: имя Remote host-а через `ssh -G`, начало и конец SSH session в main

Type: task
Status: open
Blocked by: 01
Source: решение владельца 2026-10-18, пункт 8 (функция-обёртка `ssh`; `ssh host ls` и невключённые Remote host-ы — обычный `ssh` без изменений) ([spec.md](../spec.md)); допущение 2 (имя через `ssh -G`), «Решено без владельца», пункт 1 (ключ — `hostname`); риски 8, 9

## Что происходит

- В локальной интеграции zsh нет ничего про ssh. `grep -rnwi ssh src` находит только разбор
  адресов git (`src/main/github/accounts.ts`, `src/main/autopilot/origin.ts`).
- Скрипты функций лежат в `src/main/terminal/zsh/rc.d/NN-*.zsh` и попадают в `ZDOTDIR` сами (glob).
  Заняты номера 10, 20, 30, 40.
- `signal` в `src/main/terminal/osc.ts:340-362` принимает у `P` только `Cwd=`.
- Для main SSH session сегодня — одна идущая команда: после локального C до локального D.
- Замеры и выбор способа — `evidence/01-spike-ssh.md` Ticket-а 01.

## Что делаем

1. **Функция `ssh`** — `src/main/terminal/zsh/rc.d/50-ssh.zsh` (новый).
   - Разбирает ключи `ssh`. Ключи с аргументом: `-B -b -c -D -E -e -F -I -i -J -L -l -m -O -o -P -p
     -Q -R -S -W -w`.
   - Интерактивный вход — есть адрес, нет удалённой команды, нет `-N -W -O -G -V -T -f -n -s`,
     stdin — терминал. Неизвестный ключ — не интерактивный вход.
   - Не интерактивный вход — `command ssh "$@"` с теми же аргументами, без печати.
   - Интерактивный вход — `command ssh -G` с теми же ключами и адресом. Ключ Remote host-а — поле
     `hostname`, в нижнем регистре. `ssh -G` упал — обычный `ssh`, без печати.
   - Перед запуском `ssh` — OSC 633 `P;SshHost=<имя>` с локальным nonce. В этом Ticket-е запуск
     всегда обычный: внедрения ещё нет (Ticket 04).
2. **Разбор** — `osc.ts`: `P;SshHost=` с локальным nonce, экранирование как у `Cwd=`.
3. **SSH session в main** — `src/main/terminal/ssh-session.ts` (новый). Начало — `SshHost` после
   локального C. Конец — локальный D. Событие оболочки `ssh-session-started {host}` и
   `ssh-session-ended` для подписчиков `onShellEvent` (баннер, Ticket 05).
4. **Поддельный `ssh` для test-ов** — `test/contract/ssh-harness.ts` (новый). Программа первой в
   `PATH`: пишет свои аргументы в журнал; на `-G` печатает `hostname` по таблице test-а; иначе
   исполняет удалённую команду через `sh -c` с `HOME` во временной папке.

**Не входит:** внедрение интеграции (Ticket 04), список Remote host-ов (Ticket 03), баннер
(Ticket 05).

## Готово, когда

- [ ] Unit `test/unit/terminal-osc-ssh.test.ts` (новый): `P;SshHost=srv` со своим nonce после C —
  событие `ssh-session-started` с `srv`; с чужим nonce и без C — ничего; D — `ssh-session-ended`;
  экранированное имя раскрывается.
- [ ] Contract `test/contract/terminal-ssh-wrapper.test.ts` (новый), настоящий zsh, поддельный `ssh`:
  `ssh srv` — в журнале `-G srv` и потом `srv`; main получил `ssh-session-started` с именем из `-G`.
- [ ] Тот же contract: alias `a` и полное имя `srv.example.com` с одним `hostname` — одно имя.
- [ ] Тот же contract: `ssh srv ls`, `ssh -N srv`, `ssh -W h:22 srv`, `ssh -G srv`, `ssh -V`,
  `ssh --unknown srv`, `echo | ssh srv` — аргументы в журнале байт в байт как набраны, вызова `-G`
  нет, события нет.
- [ ] Тот же contract: `ssh -G` вернул ошибку — `ssh srv` всё равно запущен с теми же аргументами.
- [ ] Тот же contract: `command ssh srv` и `\ssh srv` обходят обёртку; у пользователя в `.zshrc`
  своя функция `ssh` — работает его функция.
- [ ] Тот же contract: время `ssh -G` и разбора в обёртке — в журнале test-а; число — в «Итог».
- [ ] (вручную) `~/.zshrc` владельца — нет ли своего `ssh` (только чтение); вывод — в «Итог».
- [ ] `test/contract/terminal-shell-integration.test.ts` зелёный без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

Сначала падающий test — unit «`P;SshHost=srv` → `ssh-session-started`»: разбора ещё нет. Потом
contract обёртки с поддельным `ssh`. Серверы владельца не нужны.

## Где в коде

- `src/main/terminal/zsh/rc.d/50-ssh.zsh` (новый)
- `src/main/terminal/osc.ts`
- `src/main/terminal/ssh-session.ts` (новый)
- `test/unit/terminal-osc-ssh.test.ts` (новый)
- `test/contract/ssh-harness.ts` (новый)
- `test/contract/terminal-ssh-wrapper.test.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
