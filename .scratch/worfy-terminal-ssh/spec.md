# worfy-terminal-ssh: Terminal AI внутри SSH session

Status: по решениям владельца 2026-10-18 (пункты 1–9 раздела «Решения владельца»); «Готово, когда»,
разбиение на Ticket-ы, «Допущения» и «Решено без владельца» — предложение этого docs-PR, ждёт
подтверждения владельца
Source: [CONTEXT.md](../../CONTEXT.md), термины Terminal, Terminal AI, Fix, Command request, SSH
session, Remote host; Epic [worfy-terminal-ai](../worfy-terminal-ai/spec.md) — формат, соглашения и
устройство локальной интеграции; ADR [0005](../../docs/adr/0005-worfy-own-state-inventory.md)
(собственное состояние worfy на Machine), [0052](../../docs/adr/0052-machines-and-linking.md),
[0053](../../docs/adr/0053-several-screens-on-one-project.md),
[0058](../../docs/adr/0058-terminal-ai-assist-process.md); ssh kitten терминала kitty — образец
обёртки (https://sw.kovidgoyal.net/kitty/kittens/ssh/).
Ticket-ы: Epic `worfy-terminal-ssh`, 10 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-terminal-ai (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец заходит из Terminal-а worfy по `ssh` на свой сервер. Сегодня Terminal AI там молчит: для
локального zsh вся SSH session — одна долгая команда. После этого Epic-а на Remote host-е, который
владелец включил, работают Fix и Command request. На Remote host ничего не пишется. Без включения
всё как сегодня: в модель ничего не уходит.

Epic готов, когда:

1. В Terminal-е на zsh `ssh host` для включённого Remote host-а открывает на нём bash с интеграцией
   worfy. На диске Remote host-а не появляется ни одного файла. В его историю попадают только
   набранные команды. Запросы пароля, ключа и подтверждение ключа хоста идут как без worfy.
2. `ssh host ls`, `ssh -N …` и `ssh` к невключённому Remote host-у запускают обычный `ssh` с теми же
   аргументами, что набрал пользователь.
3. При входе на Remote host, которого нет в списке, в шапке Terminal-а появляется баннер
   «Включить Terminal AI для `host`?» с кнопками «Включить» и «Не спрашивать для этого хоста».
   «Включить» действует со следующего входа, переподключаться сразу не нужно.
4. В SSH session на включённом Remote host-е кнопка «Fix» после упавшей команды и панель Command
   request ставят команду в строку удалённого shell-а и не запускают её.
5. В модель ничего не уходит: Remote host не включён; для него выключена отправка; идёт удалённая
   команда; открыт альтернативный экран. Секреты заменены, как локально. Список Remote host-ов и
   оба переключателя — в Settings → «Terminal AI».
6. На Remote host-е с zsh всё то же работает. Restricted shell интеграции не получает. test-ы не
   ходят на серверы владельца и не тратят подписку. live-проверка владельца пройдена.

Проверку всех шести пунктов делает Ticket 10.

## Как сегодня устроено

Факты перечитаны по main `1ef87f84`.

- **Локальная интеграция — только zsh.** worfy подключает свои скрипты через `ZDOTDIR` на свою
  временную папку (`src/main/terminal/zsh/`). Интеграцию получает только zsh: проверка `isZsh`
  (`src/main/terminal/shell-integration.ts:64`). Окружение такого shell-а собирает
  `integrationEnv` (`shell-integration.ts:102-112`): `ZDOTDIR`, nonce, socket и токен Terminal AI.
- **Канал shell → worfy — OSC 633 с nonce.** Скрипт печатает A, B, C, D, E, P, и nonce shell-а —
  последний параметр каждой последовательности (`src/main/terminal/zsh/integration.zsh:20-25`).
  Разбор — `signal` в `src/main/terminal/osc.ts:340-362`: без своего nonce последовательность не
  принимается. OSC 133 не принимается (`osc.ts:15`). OSC 7 не разбирается: `signal` берёт только
  тела `633;` (`osc.ts:342`). Состояние shell-а — `ShellState` (`osc.ts:65`).
- **Модель зовёт main.** Запросы идут из main process (`src/main/terminal-ai/assist.ts`). zsh
  говорит с main через локальный Unix socket (`src/main/terminal/zsh/rc.d/10-assist.zsh`). На время
  команды zsh закрывает эту связь (`10-assist.zsh:15-17`, Ticket 11 `worfy-terminal-ai`).
- **Контекст запроса** — `src/shared/terminal-ai/context.ts`: строка, папка, последние команды,
  ветка git, код выхода, хвост вывода для Fix.
- **Во время `ssh host` запросы отказываются.** Для локального shell-а `ssh` — одна идущая команда:
  - `assist.ts:375` — отказ `command-running`;
  - `src/main/terminal-ai/fix.ts:93` — Fix отвечает «Terminal is busy»;
  - `src/main/ipc/terminal-ai-request.ts:49` — панель Command request видит `busy`.
- **Ветка git берётся с локального диска** (`src/main/terminal-ai/git-branch.ts:14`). Для папки на
  Remote host-е она была бы неверной.
- **ssh worfy не распознаёт нигде.** `grep -rnwi ssh src` находит только разбор адресов git
  (`src/main/github/accounts.ts`, `src/main/autopilot/origin.ts`) и комментарии.

## Как устроено

- **Обёртка `ssh`** (решение 8, Ticket-ы 02 и 04). Это функция zsh `ssh` в локальной интеграции
  worfy, новый файл `src/main/terminal/zsh/rc.d/50-ssh.zsh`.
  - Обёртка разбирает аргументы. Интерактивный вход без удалённой команды на включённый Remote
    host — это `ssh -t host <команда запуска bash с интеграцией>`. Интеграция передаётся
    аргументом в base64, как в ssh kitten терминала kitty.
  - Всё остальное — обычный `ssh` с теми же аргументами: `ssh host ls`, `-N`, `-W`, `-O`, `-G`,
    `-V`, неизвестный ключ, stdin не терминал, Remote host не включён.
  - Никакой скрипт не печатается в открытую сессию: он мог бы попасть в запрос пароля.
- **Имя Remote host-а** (Ticket 02). Обёртка спрашивает локальный `ssh -G` с теми же ключами и
  адресом. Он печатает итоговые настройки и никуда не подключается. Ключ Remote host-а — поле
  `hostname` его вывода. Так alias и полное имя из `~/.ssh/config` — один Remote host.
- **Начало и конец SSH session** (Ticket 02). Перед запуском `ssh` обёртка печатает OSC 633 с nonce
  локального shell-а: «SSH session началась, Remote host такой-то». Конец — локальный D после выхода
  `ssh`. Так main знает про SSH session и для Remote host-а без интеграции: это нужно баннеру.
- **Интеграция на Remote host-е** (решения 2, 5, 7; Ticket 04).
  - Удалённый bash печатает те же OSC 633: границы команд, код выхода, папка. Nonce у каждой SSH
    session свой; обёртка сообщает его main той же последовательностью с локальным nonce.
  - Скрипт живёт только в памяти этого shell-а. На диск Remote host-а ничего не пишется.
  - bash сначала, zsh потом (Ticket 09). Restricted shell интеграции не получает: SSH session идёт
    как обычный `ssh`.
  - Удалённых последовательностей нет (ForceCommand на сервере, другой shell, обрыв) — main ведёт
    себя как сегодня: идёт команда, в модель ничего не уходит.
- **Слой SSH session в main** (Ticket 04). У Terminal-а два слоя состояния: локальный zsh и удалённый
  shell. Удалённые папка, команды и код выхода не меняют локальные. Fix и Command request в SSH
  session читают удалённый слой.
- **Список Remote host-ов** (решения 2 и 4, Ticket 03). Он хранится в собственном состоянии worfy на
  Machine (ADR-0005): файл `<WORFY_DATA_DIR>/terminal-ai-hosts.json`. У каждого Remote host-а —
  флаг «Terminal AI включён», переключатель отправки данных в модель и отметка «Не спрашивать».
  Список виден в Settings → «Terminal AI».
- **Баннер при подключении** (решение 3, Ticket 05). Он появляется в шапке Terminal-а, когда
  началась SSH session к Remote host-у, которого нет в списке. «Включить» вносит Remote host с
  флагом, и следующий вход идёт с интеграцией. Текущая SSH session остаётся как есть.
- **Fix и Command request** (решение 1, Ticket-ы 06 и 07). Работают по удалённому слою. Ответ
  попадает в строку удалённого shell-а без Enter. Как именно — решает spike (Ticket 01).
- **Что уходит в модель** (решения 4 и 9). Тот же уровень, что локально: правила `context.ts`,
  секреты заменены. Пока идёт удалённая команда (между удалёнными C и D), ничего не уходит: там
  пароли `sudo`. До первого удалённого prompt-а тоже: там запрос пароля самого `ssh`.
- **Пометки каналов IPC.** Список Remote host-ов и баннер — `local`: это состояние Machine, как
  Settings. Fix и Command request остаются `project`, как в `worfy-terminal-ai`.

## Этапы

1. **Spike** — 01: обёртка и OSC 633 через SSH на одном из серверов владельца.
2. **Основа** — 02, 03.
   - 02: обёртка `ssh`, имя через `ssh -G`, начало и конец SSH session в main. Поведение `ssh` не
     меняется.
   - 03: список Remote host-ов в состоянии worfy и раздел в Settings.
3. **Интеграция и баннер** — 04, 05.
   - 04: bash на Remote host-е с интеграцией, слой SSH session в main, вставка ответа в удалённую
     строку.
   - 05: баннер при подключении.
4. **Функции** — 06, 07, 08.
   - 06: Fix в SSH session.
   - 07: Command request в SSH session.
   - 08: переключатель отправки для Remote host-а.
5. **zsh** — 09: zsh на Remote host-е.
6. **Приёмка** — 10: шесть пунктов «Готово, когда», live-проверка владельца.

## Решения владельца

Решения владельца 2026-10-18. Ticket-ы ссылаются на номер пункта.

1. **Первый шаг — Fix и Command request.** Suggestion (серый текст) и Next command на Remote
   host-е — не в первом шаге этого Epic-а. Им нужен канал от удалённого shell-а к worfy
   (проброшенный Unix socket). Решение — позже.
2. **Интеграция живёт только в памяти.** На Remote host-е она есть только в памяти этого shell-а,
   на диск ничего не пишется. Она работает только на Remote host-ах, которые включил владелец. Без
   включения в SSH session в модель ничего не уходит — как сегодня.
3. **Предложение включить — при подключении.** Маленький баннер в шапке Terminal-а:
   «Включить Terminal AI для `host`?», кнопки «Включить» и «Не спрашивать для этого хоста».
   Включение действует со следующего входа. Принудительного переподключения нет.
4. **Данные для модели.** Тот же уровень, что локально: правила `context.ts`, секреты заменены.
   Плюс переключатель на каждом Remote host-е: он выключает отправку для этого Remote host-а.
5. **Удалённые shell-ы.** Сначала bash, потом zsh. Restricted shell интеграции не получает.
6. **Отдельный Epic.** В spec `worfy-terminal-ai` ssh исключён («Не в этом Epic-е»). Эта строка
   теперь ссылается на этот Epic.
7. **Канал — только OSC 633 с nonce в потоке терминала**: начало и конец команды, код выхода,
   папка, как у локального zsh. Socket в этом Epic-е не пробрасывается.
8. **Внедрение — функция-обёртка `ssh` в локальной интеграции zsh.** Для включённого Remote host-а
   и интерактивного входа без удалённой команды она запускает `ssh -t host <команда, которая
   запускает bash с интеграцией, переданной аргументом в base64>` — как ssh kitten терминала kitty.
   `ssh host ls` и невключённые Remote host-ы идут в обычный `ssh` без изменений. Скрипт никогда не
   печатается в открытую сессию: он мог бы попасть в запрос пароля.
9. **Пароли.** Пока на Remote host-е идёт команда, в модель ничего не уходит — то же правило, что
   локально.

## Допущения

Добавлены Orchestrator-ом при постановке Epic-а. Это факты устройства и рамки, а не выбор
вариантов.

1. **Где живёт список.** Список Remote host-ов и их флаги — собственное состояние worfy на Machine
   (ADR-0005). Он показан в Settings, раздел «Terminal AI». В репозиторий Project-а и в Profile он
   не попадает.
2. **Как узнаётся Remote host.** По имени из команды `ssh`, которое локально раскрывает `ssh -G`
   без подключения. Alias и полное имя из `~/.ssh/config` — один Remote host.
3. **Не в этом Epic-е:** tmux, вложенные shell-ы, Suggestion и Next command на Remote host-е.
4. **Открытый риск для spike-а:** nonce виден в списке процессов (`ps`) Remote host-а другим его
   пользователям.

## Решено без владельца, ждёт подтверждения

Выбрано в этом docs-PR. Ticket-ы делают по нему, пока владелец не ответил.

1. **Ключ Remote host-а — поле `hostname` вывода `ssh -G`, в нижнем регистре.** Пользователь и порт
   Remote host не делят: `root@srv` и `deploy@srv` — один Remote host.
2. **Ветка git в SSH session не отправляется.** `git-branch.ts` читает локальный диск, и для
   удалённой папки ответ неверный. Вместо ветки модель получает: команда идёт на Remote host-е,
   его система (`uname -s`) и shell. Имя Remote host-а в модель не уходит: внутренние имена серверов
   бывают чувствительными.
3. **Command request в SSH session — только панель Cmd+I.** Строка `# …` + Enter в удалённом bash —
   просто комментарий, его выполнит bash. Ловить её — привязка клавиши в удалённом shell-е; это
   позже, вместе с Suggestion.
4. **Баннер и список — каналы `local`.** Баннер виден только на экранах Machine, которой принадлежит
   Terminal. С экрана Linked machine-а баннера нет: включение меняет состояние чужой Machine.
5. **Отметка «Не спрашивать» снимается в Settings.** Там же Remote host удаляется из списка целиком.
6. **Отправка по умолчанию включена.** Remote host, включённый кнопкой «Включить», отправляет данные
   в модель, пока владелец не выключит переключатель (решение 4).
7. **Ответ в удалённой строке без Enter.** worfy пишет в pty ответ только когда удалённый shell ждёт
   ввода (удалённый B после последнего D) и никогда не пишет `\r` и `\n`. Способ — bracketed paste
   или привязка readline интеграции — выбирает spike (Ticket 01).

## Не в этом Epic-е

- **Suggestion и Next command на Remote host-е** — решение 1. Им нужен проброшенный socket.
- **Проброс Unix socket-а** (`ssh -R`) — решение 7.
- **tmux, screen, вложенный shell, `ssh` изнутри SSH session** — допущение 3. Для worfy это идущая
  удалённая команда: в модель ничего не уходит.
- **fish, tcsh и другие shell-ы Remote host-а** — решение 5. SSH session идёт как обычный `ssh`.
- **SSH из PowerShell на Windows** — локальная интеграция есть только у zsh.
- **Запись скриптов на Remote host**, как делает kitty (`~/.local/share/kitty-ssh-kitten`) —
  отвергнута решением 2.
- **Ввод скрипта в открытую сессию** — отвергнут решением 8.
- **`mosh`, `et` и другие программы входа** — обёртка только у `ssh`.

## Риски и открытые технические вопросы

1. **Nonce в `ps`** (допущение 4). Команда запуска с nonce видна в `ps` Remote host-а другим его
   пользователям и в `ps` Mac-а. Программа, знающая nonce, может подделать конец команды. Spike
   меряет, что видно, и сравнивает варианты: nonce в аргументе; nonce, который удалённая интеграция
   создаёт сама и сообщает один раз; переменная окружения через `SendEnv` (нужен `AcceptEnv` на
   сервере). Отдельно — `write` и `wall` другого пользователя в терминал владельца при `mesg y`.
2. **Login shell Remote host-а исполняет команду запуска.** sshd запускает её через shell
   пользователя (`$SHELL -c`). У sh, bash, dash и zsh синтаксис один. fish и tcsh могут её не
   понять — spike проверяет, что SSH session тогда хотя бы открывается как обычная.
3. **Файлы входа пользователя.** Обычный `ssh host` даёт login shell: bash читает `~/.bash_profile`,
   `~/.bash_login` или `~/.profile`. bash с интеграцией должен прочитать те же файлы и в том же
   порядке, как скрипт VS Code для bash. Ticket 04 проверяет это contract-test-ом.
4. **base64 на Remote host-е.** `base64 -d` (GNU), `base64 -D` (старый macOS), `openssl base64 -d`.
   Spike выбирает цепочку запасных вариантов. Нет ни одного — обычный вход.
5. **Длина команды.** Скрипт интеграции в base64 — несколько КиБ. Предел `ARG_MAX` и длины строки
   sshd spike меряет.
6. **Restricted shell.** Запуск `bash` из rbash снимает ограничения — это известный способ обхода.
   Интеграция не должна им становиться: команда запуска проверяет ограничения и в restricted shell
   запускает login shell пользователя без интеграции.
7. **Гонка Enter и вставки ответа.** Пользователь нажал Enter, удалённый C ещё не дошёл, worfy
   пишет ответ — он попадает в запущенную программу. Ни `\r`, ни `\n` worfy не пишет, поэтому
   ничего не запустится и не отправится. Но текст может попасть в запрос пароля. Ticket 04 меряет
   окно гонки.
8. **Своя функция или alias `ssh` у пользователя.** Alias zsh раскрывается раньше функции. У
   пользователя есть свой `ssh` — обёртки worfy нет, SSH session идёт как сегодня. Ticket 02
   проверяет `~/.zshrc` владельца, только читая его.
9. **Задержка входа.** `ssh -G` и сборка команды запуска добавляют время до prompt-а. Spike меряет
   против обычного `ssh`. Предложение этого docs-PR — не больше 100 ms сверху; число подтверждает
   spike.
10. **zsh без файлов на диске.** У zsh нет `--rcfile`, его интеграция приходит через `ZDOTDIR` —
    папку с файлами. Как запустить zsh на Remote host-е без файлов на диске — открытый вопрос
    Ticket-а 09. Папка в tmpfs (`$XDG_RUNTIME_DIR`, `/dev/shm`) — тоже запись; нужна ли она — слово
    владельца.
11. **`epic-status` показывает этап `/implement` с первого дня:** Ticket 10 в `blocked` он считает
    работой.
12. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-terminal-ai](../worfy-terminal-ai/spec.md), раздел «Соглашения для Ticket-ов этого
Epic-а»: сначала падающий test, виды test-ов, ручные пункты «(вручную)», снимки UI в двух темах,
файлы функций — свои. Отличия:

- **Ветки** — `worfy-terminal-ssh/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **test-ы не ходят на серверы владельца.** В contract-test-ах `ssh` — поддельная программа первой в
  `PATH` (`test/contract/ssh-harness.ts`, Ticket 02). Она записывает свои аргументы и исполняет
  удалённую команду локально через `sh -c` с `HOME` во временной папке. Так «Remote host» — это
  временная папка, и test видит каждый файл, который туда записан.
- **Настоящий `sshd`** — только в spike-е и, если spike так решит, в одном contract-test-е: `sshd`
  на `127.0.0.1` от имени того же пользователя, со своими ключами во временной папке. Системные
  настройки (Remote Login macOS) не меняются.
- **Серверы владельца** — только spike (Ticket 01) и приёмка (Ticket 10), и только по слову
  владельца в чате.
- **Подписку test-ы не тратят** — fake assist, как в `worfy-terminal-ai`.
- **Перед каждой Wave — открытые PR Epic-а `worfy-terminal-ai`.** Его Ticket 09 (приёмка) правит
  только свой spec; общие файлы `osc.ts`, `fix.ts`, `TerminalNode.tsx` сверяются при claim.
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. bash и zsh в Linux CI есть. e2e и
  `.app` — локально перед мержем.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает
skill `epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `.scratch/worfy-terminal-ssh/evidence/01-spike-ssh.md`, `.scratch/worfy-terminal-ssh/evidence/spike/` | 1 |
| 02 | `src/main/terminal/zsh/rc.d/50-ssh.zsh`, `src/main/terminal/osc.ts`, `src/main/terminal/ssh-session.ts`, `test/unit/terminal-osc-ssh.test.ts`, `test/contract/ssh-harness.ts`, `test/contract/terminal-ssh-wrapper.test.ts` | 2 |
| 03 | `src/shared/terminal-ai/hosts.ts`, `src/main/terminal-ai/hosts.ts`, `src/shared/ipc/terminal-ai-hosts.ts`, `src/main/ipc/terminal-ai-hosts.ts`, `src/renderer/settings/TerminalAiHosts.tsx`, `src/renderer/settings/TerminalAiSection.tsx`, `test/unit/terminal-ai-hosts.test.ts`, `test/unit/terminal-ai-hosts-section.test.tsx`, `test/e2e/terminal-ai-hosts.spec.ts` | 2 |
| 04 | `src/main/terminal/bash/integration.bash`, `src/main/terminal/ssh-bootstrap.ts`, `src/main/terminal/zsh/rc.d/50-ssh.zsh`, `src/main/terminal/osc.ts`, `src/main/terminal/ssh-session.ts`, `src/main/terminal/shell-integration.ts`, `src/main/terminal/remote-insert.ts`, `test/unit/terminal-ssh-bootstrap.test.ts`, `test/unit/terminal-osc-ssh.test.ts`, `test/contract/terminal-ssh-bash.test.ts` | 3 |
| 05 | `src/main/terminal-ai/ssh-offer.ts`, `src/shared/ipc/terminal-ai-ssh-offer.ts`, `src/main/ipc/terminal-ai-ssh-offer.ts`, `src/renderer/canvas/nodes/TerminalSshBanner.tsx`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.css`, `test/unit/terminal-ssh-banner.test.tsx`, `test/contract/terminal-ai-ssh-offer.test.ts`, `test/e2e/terminal-ssh-banner.spec.ts` | 3 |
| 06 | `src/main/terminal-ai/remote-context.ts`, `src/shared/terminal-ai/context.ts`, `src/main/terminal-ai/assist.ts`, `src/main/terminal-ai/fix.ts`, `src/main/ipc/terminal-ai-fix.ts`, `test/unit/terminal-ai-remote-context.test.ts`, `test/contract/terminal-ssh-fix.test.ts`, `test/e2e/terminal-ssh-fix.spec.ts` | 4 |
| 07 | `src/main/terminal-ai/features/command-request.ts`, `src/main/ipc/terminal-ai-request.ts`, `test/contract/terminal-ssh-request.test.ts`, `test/e2e/terminal-ssh-request.spec.ts` | 5 |
| 08 | `src/main/terminal-ai/remote-context.ts`, `src/renderer/settings/TerminalAiHosts.tsx`, `test/unit/terminal-ai-remote-context.test.ts`, `test/unit/terminal-ai-hosts-section.test.tsx`, `test/contract/terminal-ssh-send-off.test.ts` | 6 |
| 09 | `src/main/terminal/ssh-bootstrap.ts`, `src/main/terminal/zsh/remote.zsh`, `src/main/terminal/shell-integration.ts`, `test/unit/terminal-ssh-bootstrap.test.ts`, `test/contract/terminal-ssh-zsh.test.ts` | 6 |
| 10 | `.scratch/worfy-terminal-ssh/spec.md`, `.scratch/worfy-terminal-ssh/evidence/10-live-проверка.md` | 7 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, один.** Spike: остальные Ticket-ы опираются на его замеры.
- **Wave 2 — 02 и 03.** Оба ждут 01. Общих файлов нет: 02 — обёртка и разбор OSC, 03 — хранение,
  каналы и Settings.
- **Wave 3 — 04 и 05.** Оба ждут 02 и 03. Общих файлов нет: 04 — `src/main/terminal/`, 05 — баннер и
  его каналы.
- **Wave 4 — 06, один.** Ждёт 04.
- **Wave 5 — 07, один.** Ждёт 04 и 06: берёт контекст SSH session из `remote-context.ts` Ticket-а 06.
- **Wave 6 — 08 и 09.** 08 ждёт 03, 06 и 07; 09 ждёт 04, 06 и 07. Общих файлов нет.
- **Wave 7 — 10, один.** Ждёт все остальные Ticket-ы. Лежит в `blocked`: Autopilot его не берёт.

Сдвигов из-за общих файлов нет: Ticket-ы с общими файлами (02 и 04, 04 и 09, 06 и 08, 03 и 08)
связаны через `Blocked by` и уже стоят в разных Wave.
