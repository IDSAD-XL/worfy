# 01 — Shell integration для zsh: свой ZDOTDIR worfy, OSC 633 с nonce, история пользователя, состояние Terminal-а в main

Type: task
Status: claimed — 2026-10-09
Branch: worfy-terminal-ai/01
Blocked by: —
Source: решения владельца 2026-10-09: пункт 4 (гибрид, сначала zsh; контекст через OSC 133/633, подключение как в VS Code — `ZDOTDIR` на свою временную папку, `~/.zshrc` не меняется, только в Terminal-ах worfy), пункт 3 (не спрашивать модель во время команды и на альтернативном экране, строки с пробелом в начале пропускать, OSC от программ не верить — nonce), пункт 1(a) (Suggestion сначала из истории команд) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md) — процесс Terminal AI; [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — Terminal на нескольких экранах

## Что происходит

- Shell Terminal Node-а — `env.SHELL ?? '/bin/zsh'` с `-l` в корне Project-а
  (`src/main/terminal/pty.ts:352-355`). Окружение собирает `terminalEnv` (`pty.ts:55-64`): окружение
  login shell пользователя (ADR-0007) плюс `TERM`, `COLORTERM`, `TERM_PROGRAM=worfy` (`:61`) и `LANG`.
- Main видит каждый кусок вывода в `pty.onData` (`pty.ts:367-374`) и шлёт его подписчикам, но не
  разбирает. Где кончается prompt, какая команда идёт, в какой она папке и с каким кодом кончилась,
  worfy не знает. OSC 7, 133 и 633 в `src` не обрабатываются нигде (grep).
- Replay — последние 256 КиБ вывода; `ReplayBuffer` режет поток на любом символе (`pty.ts:68-99`).
  Если граница придётся внутрь последовательности OSC, xterm нового экрана напечатает её хвост
  текстом.
- Registry Terminal Node-ов создаётся в `src/main/ipc/terminal.ts:155-160`. Тот же класс
  `TerminalRegistry` запускает `gh auth login` для «Sign in with gh»
  (`src/main/github/accounts.ts:219-224`): там процесс — не shell.
- Как это делает VS Code (https://code.visualstudio.com/docs/terminal/shell-integration, скрипты
  `shellIntegration-*.zsh` в его репозитории):
  - для zsh `ZDOTDIR` указывает на временную папку VS Code, а её `.zshenv`, `.zprofile`, `.zshrc`,
    `.zlogin` подгружают одноимённые файлы пользователя из прежнего `ZDOTDIR` или `HOME`; файлы
    папки пишутся заново при каждом запуске Terminal-а;
  - перед `.zshrc` пользователя `HISTFILE` ставится на `$USER_ZDOTDIR/.zsh_history`: иначе история
    уходит в папку VS Code;
  - zsh-скрипт печатает OSC 633 A — начало prompt-а, B — конец prompt-а, C — команда запущена,
    D;<код> — команда кончилась, E;<строка команды>;<nonce>, P;Cwd=<папка>. OSC 133 VS Code
    принимает, но сам не печатает. Nonce несут E и служебные последовательности окружения
    (`EnvSingle*`), но не A–D. Документация требует экранировать в E `\` (→ `\\`), `;` и символы с
    кодом 0x20 и ниже (→ `\xHH`); сам скрипт экранирует коды меньше 31;
  - A и B заново оборачивают `PS1` в `precmd`: `preexec` VS Code возвращает `PS1` без них;
  - `ZDOTDIR` пользователя возвращается в `.zshrc` для shell-а без login, а у login — в обёртке
    `.zlogin` до `.zlogin` пользователя;
  - nonce приходит в переменной окружения; скрипт сохраняет его в переменную shell-а и убирает из
    окружения.
- На macOS `/etc/zshrc` ставит `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history`. zsh читает его до
  `$ZDOTDIR/.zshrc`, когда `ZDOTDIR` ещё указывает на папку worfy (проверено ревью PR #202:
  `ZDOTDIR=<tmp> zsh -i -c 'print $HISTFILE'` печатает путь во временной папке). У владельца в
  `~/.zshrc` только nvm, свой `HISTFILE` он не ставит. `/etc/zshrc` идёт после `.zshenv` и
  `.zprofile`, поэтому на macOS `HISTFILE` из них не доживает и без worfy. На Linux (`/etc/zsh/zshrc`
  Debian) `HISTFILE` не задан, и значение из `.zshenv` остаётся.
- macOS чистит `$TMPDIR` (`/var/folders/…/T`): `dirhelper` раз в сутки удаляет обычные файлы, к
  которым не обращались больше 3 дней (`/System/Library/LaunchDaemons/com.apple.bsd.dirhelper.plist`).
  Чтение файла zsh-ем время доступа на APFS не обновляет (проверено ревью PR #202). Какие файлы
  `dirhelper` пропускает (папки, socket-ы), Apple не описывает.
- zsh не читает файлы внутри `app.asar`. Текстовые файлы main уже берёт из бандла через `?raw`
  (`src/main/mcp/canvas-server.ts:46`, объявление — `src/main/mcp/assets.d.ts`).
- В CI на Linux zsh ставится (`.github/workflows/ci.yml:41`): contract-test-ы с настоящим zsh идут и
  там.
- Замер вывода Ticket-а 05 Epic-а `worfy-link`: 10 МБ — 331 ms до последнего байта, p99 задержки
  event loop main 12 ms («Итог» того Ticket-а).

## Что делаем

1. **Только zsh и только Terminal Node.** У `TerminalRegistry` — опция `integration`. Ставит её только
   registry Terminal Node-ов (`src/main/ipc/terminal.ts`); у «Sign in with gh» её нет. Интеграция
   включается, когда запускаемый файл — zsh: `basename` того, что реально идёт в `spawn`
   (`env.SHELL ?? '/bin/zsh'` сейчас, выбор shell-а Ticket-а 10 `worfy-windows` потом), а не
   переменная `SHELL`. Другой shell — всё как сейчас. Веток по платформе нет: PR не платформенный
   (spec, «Соглашения», пункт «Перед каждой Wave»).
2. **Своя папка `ZDOTDIR`** — `src/main/terminal/shell-integration.ts` (новый).
   - Папка — `mkdtemp` в `os.tmpdir()`, права 0700, своя у каждого запуска worfy: dev-сборка и Stable
     copy её не делят. В ней же будет socket Ticket-а 03, поэтому путь короткий: путь socket-а —
     не длиннее 103 байт. Поле пути на macOS — 104 байта, но `zsocket` zsh 5.9 копирует не больше
     103 (проверено ревью PR #202). Не укладывается — папка в `/tmp`. При выходе worfy папка
     удаляется.
   - **При каждом старте zsh-Terminal-а** main заново пишет в неё все `*.zsh` из
     `src/main/terminal/zsh/` и её подпапок, с тем же относительным путём (glob с `?raw`); папки нет —
     создаёт заново. Запись — во временный файл и `rename`: shell, который стартует в ту же секунду,
     не прочтёт половину файла. Так `dirhelper` macOS не оставит login shell без обёрток.
   - Обёртки ложатся под именами `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`. Ticket-ы 03–06 добавляют
     свои файлы в `src/main/terminal/zsh/rc.d/` и этот файл не правят. `electron-builder.yml` не
     меняется: скрипты — текст в бандле main.
   - Окружение shell-а: `ZDOTDIR` — папка worfy; `WORFY_USER_ZDOTDIR` — прежний `ZDOTDIR`
     пользователя или `HOME`; `WORFY_SHELL_NONCE` — новое случайное значение на каждый запуск shell-а.
3. **Обёртки** — `src/main/terminal/zsh/` (новые), по образцу VS Code.
   - Каждая подгружает одноимённый файл пользователя из `WORFY_USER_ZDOTDIR`, если он есть. Файл
     пользователя может сам сменить `ZDOTDIR` — обёртка учитывает это.
   - **История.** `.zshrc` до файла пользователя: если `HISTFILE` пуст или указывает в папку worfy
     (его поставил `/etc/zshrc` macOS от `ZDOTDIR` worfy), `HISTFILE=$WORFY_USER_ZDOTDIR/.zsh_history`.
     Итог — как в zsh без worfy: на macOS — история пользователя, на Linux значение из `.zshenv` или
     `.zprofile` остаётся. Потом `.zshrc` пользователя может задать свой — он главнее. `HISTSIZE` и
     `SAVEHIST` worfy не трогает.
   - `.zshrc` после файла пользователя подключает `integration.zsh`, затем файлы `rc.d/*.zsh` по
     порядку имён.
   - `ZDOTDIR` пользователя возвращается: в `.zshrc` — у shell-а без login (`[[ ! -o login ]]`); у
     login shell-а (Terminal — всегда `-l`) — в обёртке `.zlogin`, до `.zlogin` пользователя, как в
     VS Code. Вложенный `zsh` идёт без worfy.
   - Скрипт читает `WORFY_*` в неэкспортируемые переменные и делает `unset`: программы из shell-а
     nonce не видят.
   - Файлы пользователя (`~/.zshrc` и другие) не меняются.
4. **Последовательности** — `integration.zsh` (новый), хуки `precmd` и `preexec` (`add-zsh-hook`).
   - worfy печатает OSC 633 A, B, C, D;<код>, E;<строка команды>, P;Cwd=<папка> — как VS Code, но
     **nonce — у каждой**, а не только у E: без него программа могла бы напечатать поддельный D.
   - Строка команды в E экранируется, как требует документация VS Code: `\` → `\\`, `;` → `\x3b`,
     символы с кодом 0x20 и ниже (перевод строки, BEL, ESC, пробел) → `\xHH`. Main раскодирует.
   - A и B — невидимые вставки `%{…%}` в начало и конец `PS1`. `precmd` worfy стоит последним в
     `precmd_functions` и на каждом prompt-е дописывает их, если их нет: их убирает свой `preexec`
     worfy или prompt-фреймворк, который пересобрал `PS1`. Дважды не вставляет. Prompt пользователя
     выглядит как раньше.
   - Команда с пробелом в начале — C и D без E: её текст в main не попадает.
5. **Разбор в main** — `src/main/terminal/osc.ts` (новый), чистый код над кусками вывода.
   - Последовательность может разрезаться между двумя кусками в любом месте.
   - Принимаются только OSC 633 с nonce этого shell-а. Без nonce, с чужим nonce и любые OSC 133 —
     пропуск.
   - Альтернативный экран — `CSI ? 1049 h/l`, `? 1047`, `? 47`.
   - Вывод не меняется: последовательности остаются в потоке, xterm их пропускает. `end` — как
     сейчас.
   - **Replay.** Если начало сохранённого куска попало внутрь OSC, `ReplayBuffer` срезает начало до
     конца этой последовательности (BEL или ST): новый экран не печатает её хвост с nonce.
6. **Состояние Terminal-а** — в `TerminalRegistry` (`src/main/terminal/pty.ts`), по ключу Terminal-а:
   - папка; ждёт ли shell ввода (после B); идёт ли команда (между C и D); альтернативный экран;
   - код выхода последней команды; до 20 последних команд (без начинающихся с пробела);
   - вывод последней законченной команды — от C до D, в пределах `REPLAY_LIMIT` (для Fix,
     Ticket 07).

   События: «prompt показан», «команда началась», «команда кончилась». Registry Terminal Node-ов
   отдаёт модулям Terminal AI функция, экспортируемая из `src/main/ipc/terminal.ts`.
7. **Замер.** Contract на настоящем pty повторяет замер 10 МБ Ticket-а 05 `worfy-link` с включённым
   разбором: время до последнего байта и p99 задержки event loop main. Цифры печатаются всегда, с
   `WORFY_PERF=1` проверяются.

**Не входит:** socket и ZLE widget (Ticket 03); модель (Ticket 02); bash, fish, PowerShell
(spec, «Не в этом Epic-е»).

## Готово, когда

- [x] Unit `test/unit/terminal-osc.test.ts` (новый): A, B, C, D, E, P с nonce shell-а меняют состояние; без nonce, с чужим nonce и OSC 133 — не меняют; последовательность, разрезанная между двумя кусками в каждой позиции, разбирается так же, как целая; строка команды с `;`, `\`, переводом строки и ESC раскодирована точно; альтернативный экран включается и выключается; команда без E не попадает в список; в списке не больше 20 команд; вывод команды — текст между C и D.
- [x] Unit (там же): `ReplayBuffer`, у которого граница прошла внутри OSC 633, отдаёт replay, начинающийся после конца этой последовательности.
- [x] Contract `test/contract/terminal-shell-integration.test.ts` (новый), настоящий zsh в pty, `HOME` во временной папке: `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin` пользователя подгружены (каждый ставит свою переменную, `echo` печатает все четыре); то же, когда `.zshenv` пользователя ставит `ZDOTDIR=$HOME/zdot` и остальные файлы лежат там; `.zlogin` worfy выполнился (его метка видна); SHA-256 файлов пользователя до и после — одинаковые.
- [x] Тот же contract, **история**: в `$HOME/.zsh_history` заранее есть строка — `fc -ln -1` в новом Terminal-е её видит; у пользователя `SAVEHIST=100` — команда, набранная в Terminal-е worfy, после выхода shell-а дописана в `$HOME/.zsh_history`, а в папке worfy `.zsh_history` нет; пользователь в `.zshrc` ставит `HISTFILE=$HOME/custom_hist` — команда ушла туда. `HISTFILE=$HOME/envhist` в `.zshenv` пользователя — итог как у того же zsh без worfy (запуск с тем же `HOME` без `ZDOTDIR` worfy): на `darwin` с настоящим `/etc/zshrc` — `$HOME/.zsh_history`, на Linux — `$HOME/envhist`.
- [x] Тот же contract: после `cd sub` папка в состоянии — `sub`; после `false` код выхода 1, после `true` — 0; во время `sleep 1` «идёт команда», после — нет; `printf '\e]633;D;0\a'` без nonce состояние не меняет; `env | grep WORFY_` внутри shell-а пуст; вложенный `zsh -i` последовательностей worfy не печатает.
- [x] Тот же contract: `less` на файле — «альтернативный экран» во время работы и снят после выхода; команда ` echo secret` (пробел в начале) — в списке команд её нет; `PS1`, пересобранный в своём `precmd` (как у prompt-фреймворков), всё равно даёт A и B на каждом prompt-е, без задвоения.
- [x] Тот же contract: обёртки удалены из папки worfy (как это сделал бы `dirhelper`) — следующий Terminal пишет их заново и стартует с файлами пользователя; путь socket-а будущего Ticket-а 03 в папке не длиннее 103 байт; при `TMPDIR` с длинным путём папка уходит в `/tmp`.
- [x] Тот же contract: запускаемый файл не zsh (`/bin/sh`) — в окружении нет `ZDOTDIR` worfy, последовательностей нет; registry без `integration` (как у «Sign in with gh») — тоже; `SHELL` не задан — запускается `/bin/zsh`, и интеграция есть.
- [x] Замер 10 МБ напечатан в выводе test-а; цифры и сравнение с Ticket-ом 05 `worfy-link` — в «Итог». p99 задержки event loop main не выше 100 ms (порог того Ticket-а).
- [x] `test/contract/terminal.test.ts`, `test/e2e/terminal.spec.ts`, `test/e2e/focus.spec.ts` зелёные без правки ожиданий.
- [ ] (вручную) `pnpm dev`, Terminal Node на zsh владельца: prompt такой же, как без worfy; `node -v` работает (nvm из `~/.zshrc`); стрелка вверх показывает команды из прошлых сеансов; команда, набранная в worfy, видна в `~/.zsh_history` (`tail -1 ~/.zsh_history` в Terminal.app после выхода из shell-а worfy); `shasum ~/.zshrc` до и после — одинаковый. Снимки — `../evidence/01-terminal-light.png` и `../evidence/01-terminal-dark.png`. Как проверить: окно worfy и Terminal.app.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально (команда — `rules.md` Profile-а worfy) — exit 0.

## Тесты

Сначала падающий test — unit разбора последовательности, разрезанной между двумя кусками вывода.
Потом contract на настоящем zsh: он идёт и в Linux CI (zsh там ставится). `HOME` и файлы
пользователя — во временной папке; настоящий `~/.zshrc` test не читает. На Linux `/etc/zsh/zshrc`
`HISTFILE` не задаёт, поэтому случай macOS проверяется на `darwin` с настоящим `/etc/zshrc` — в gate
full на Mac.

В «Итог» — как падал первый test, имена файлов в `src/main/terminal/zsh/`, функция, которая отдаёт
registry модулям Terminal AI, и цифры замера.

## Где в коде

- `src/main/terminal/pty.ts`
- `src/main/ipc/terminal.ts`
- `src/main/terminal/shell-integration.ts` (новый)
- `src/main/terminal/osc.ts` (новый)
- `src/main/terminal/zsh/zshenv.zsh` (новый)
- `src/main/terminal/zsh/zprofile.zsh` (новый)
- `src/main/terminal/zsh/zshrc.zsh` (новый)
- `src/main/terminal/zsh/zlogin.zsh` (новый)
- `src/main/terminal/zsh/integration.zsh` (новый)
- `src/main/terminal/zsh/assets.d.ts` (новый)
- `test/unit/terminal-osc.test.ts` (новый)
- `test/contract/terminal-shell-integration.test.ts` (новый)

Общие файлы с Ticket-ом 10 Epic-а `worfy-windows` (Terminal на PowerShell): `src/main/terminal/pty.ts`,
`src/main/ipc/terminal.ts` — spec, «Соглашения», пункт «Перед каждой Wave».

## Итог

PR #204, ветка `worfy-terminal-ai/01`.

- **Первый test.** `test/unit/terminal-osc.test.ts` упал раньше любой проверки: модуля
  `src/main/terminal/osc.ts` не было («Failed to resolve import "../../src/main/terminal/osc"»,
  0 test-ов). После `osc.ts` и правки `ReplayBuffer` — 17 из 17.
- **Файлы `src/main/terminal/zsh/`:** `zshenv.zsh`, `zprofile.zsh`, `zshrc.zsh`, `zlogin.zsh`
  (в папке worfy — `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`), `integration.zsh`, `assets.d.ts`
  (типы `import.meta.glob` Vite). Папки `rc.d/` пока нет: `.zshrc` подключает `rc.d/*.zsh`, когда
  они появятся (Ticket-ы 03–06), на верхнем уровне, как файлы пользователя.
- **Папка worfy** — `ShellIntegration` в `src/main/terminal/shell-integration.ts`: `mkdtemp`
  `worfy-XXXXXX` в `os.tmpdir()` (или `/tmp`, если путь socket-а длиннее 103 байт), один раз за
  запуск worfy; `prepare()` при каждом старте zsh-Terminal-а пишет все скрипты заново (временный
  файл и `rename`), папку создаёт заново, если её нет. Удаляется на `process.once('exit')` в
  `src/main/ipc/terminal.ts`. Для Ticket-а 03: `socketPath(dir)`, файл `SOCKET_FILE = 'assist.sock'`.
- **Включение** — опция `integration` у `TerminalRegistry` и `isZsh(<запускаемый файл>)`
  (`basename` — `zsh` или `zsh-5.9`). Её ставит только registry Terminal Node-ов; у «Sign in with
  gh» её нет. Окружение: `ZDOTDIR`, `WORFY_USER_ZDOTDIR` (только если в окружении пользователя есть
  `ZDOTDIR`; иначе скрипт берёт `HOME`), `WORFY_SHELL_NONCE` (16 случайных байт hex, новый на
  каждый shell).
- **Состояние и события.** `ShellTracker` (`osc.ts`) — папка, `awaitingInput` (после B),
  `commandRunning` (C…D), `altScreen`, `exitCode`, до 20 команд, `lastOutput` (C…D, последние
  `REPLAY_LIMIT` символов). `TerminalRegistry.shellState(key)` и `onShellEvent(listener)`; события
  `prompt` (на B), `command-started`, `command-finished`. **Registry модулям Terminal AI отдаёт
  `terminalNodeRegistry()` из `src/main/ipc/terminal.ts`.** Новых каналов IPC нет.
- **Replay.** `ReplayBuffer` следит за срезанной частью потока (`OscCutScanner`) и, если начало
  попало внутрь OSC, срезает дальше, до BEL или ST.
- **Замер 10 МБ** (`test/contract/terminal-shell-integration.test.ts`, zsh с интеграцией, один
  экран): Mac — последний байт через 321–322 ms, p99 задержки event loop main 10–11 ms; Linux CI —
  160 ms, p99 11 ms. Ticket 05 `worfy-link` без разбора: 331 ms, p99 12 ms. Разбор заметной
  нагрузки не добавил; порог 100 ms далеко.
- **Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (171 файл, 3312 test-ов);
  gate fast — «зелено»; `GATE_SCOPE=all` gate full на `ef6d3dd` — exit 0, «зелено (full)»: lint,
  typecheck, test, test:e2e, test:package (первый прогон full упал на test:package — окно
  упакованного приложения не показалось за 30 s в 10 test-ах; тот же test один — зелёный, повтор full
  — зелёный); CI PR #204 — `check` pass. Мутанты (проверка нонса в `osc.ts`, срез
  `ReplayBuffer`, сброс `HISTFILE`, перестановка precmd, возврат `ZDOTDIR` в `.zlogin`, `unset`
  переменных `WORFY_*`) — каждый роняет test.
- **Не сделано мной:** ручная проверка на zsh владельца (`pnpm dev`, nvm, стрелка вверх,
  `~/.zsh_history`, `shasum ~/.zshrc`) и снимки `01-terminal-*.png` — GUI-проверки по брифу не мои.
  Видимого изменения не ожидается: prompt тот же, A и B — невидимые вставки.

- **Доработка после ревью (раунд 1).**
  - Пока идёт файл пользователя, `ZDOTDIR` в точности такой, как без worfy: значение пользователя
    (с `export` или без) или не задан. Форма XDG `: ${ZDOTDIR:=$HOME/zdot}; export ZDOTDIR` в
    `.zshenv` читает тот же `.zshrc` и оставляет тот же `ZDOTDIR`, что zsh без worfy. Поэтому
    `WORFY_USER_ZDOTDIR` передаётся, только если `ZDOTDIR` у пользователя есть (тикет говорил «или
    `HOME`»).
  - `setopt allexport` в `.zshrc` пользователя: `.zshrc` worfy снимает `export` со всех
    переменных `__worfy_*`, nonce в `env` не попадает.
  - ESC, CAN и SUB внутри CSI обрывают её, как в xterm; ESC начинает новую последовательность.
    Вывод, кончающийся на `\e[`, больше не съедает D.
  - C1 (U+0080–U+009F) экранируются в E и P как `\xHH`; U+009C (ST) заканчивает OSC и в разборе
    main, и в срезе replay — как в xterm.js.
  - Незакрытая OSC, приходящая по символу, читается один раз: 200 000 символов — меньше секунды
    (было бы около 72 s при повторном чтении с начала, проверено мутантом).

Решено без владельца (рекомендованный вариант), подтвердить:

- *`lastOutput` — сырой вывод.* zsh печатает свою отбивку конца строки (`PROMPT_SP`: метка `%`,
  пробелы, `\r \r`) до своего `precmd`, то есть до D: она попадает в конец вывода команды. Убирать
  её (и ANSI) — дело Fix, Ticket 07.
- *Событие «prompt показан» — на B*, не на A: на B shell ждёт ввода.
- *`ZDOTDIR` пользователя возвращается как был:* не было — `unset ZDOTDIR` (VS Code ставит
  `ZDOTDIR=$HOME`).
- *Папку не удалось подготовить* (ошибка записи) — shell стартует без интеграции, с
  предупреждением в лог main, а не с ошибкой Terminal-а.
- *Папка с тем же именем, но не своя* (не каталог, чужой владелец, права шире 0700) — не
  используется: делается новая `mkdtemp`.
- *Известные расхождения с zsh без worfy, как у VS Code:* `/etc/zshrc` macOS ищет `~/.zkbd` по
  `${ZDOTDIR:-$HOME}` — в Terminal-е worfy он смотрит в папку worfy; глобальный `compinit` Ubuntu
  (`/etc/zsh/zshrc`) кладёт `.zcompdump` в папку worfy. У владельца `.zkbd` нет (в `~/.zshrc`
  только nvm) — не проверялось.
- *CI Ubuntu:* глобальный `compinit` `/etc/zsh/zshrc` на runner-е находит небезопасные папки в
  `fpath` и ждёт клавишу (и без worfy). Contract-test ставит `skip_global_compinit=1` — переключатель,
  описанный в том же файле Ubuntu.
