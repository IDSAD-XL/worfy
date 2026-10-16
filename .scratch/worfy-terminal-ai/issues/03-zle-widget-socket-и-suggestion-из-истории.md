# 03 — ZLE widget и socket до main: Suggestion из истории, → / Option+→ / Esc, вставка в строку

Type: task
Status: done — 2026-10-14, [PR #306](https://github.com/IDSAD-XL/worfy/pull/306)
Blocked by: 01, 02
Source: решения владельца 2026-10-09: пункт 1(a) (Suggestion — серый текст, сразу из истории команд, локально и без модели; → принимает целиком, Option/Alt+→ — по слову, Esc скрывает), пункт 4 (ZLE widget как zsh-autosuggestions: `POSTDISPLAY`, асинхронно через `zle -F`, socket `zmodload zsh/net/socket; zsocket` до main, socket 0600 и nonce в окружении; shell рисует и принимает серый текст сам — его видит каждое окно), пункт 3 (строка с пробелом в начале — без модели) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), Considered Options — почему не ghost text поверх xterm; [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — один shell на нескольких экранах

## Что происходит

- После Ticket-а 01 скрипты worfy подключаются к zsh Terminal Node-а через свой `ZDOTDIR`. `.zshrc`
  worfy подгружает `rc.d/*.zsh` по порядку имён; все `*.zsh` из `src/main/terminal/zsh/` попадают в
  `ZDOTDIR` сами. У main есть состояние Terminal-а: папка, идёт ли команда, ждёт ли shell ввода,
  последние команды. Связи shell → main, кроме вывода pty, нет.
- После Ticket-а 02 у main есть assist-сервис и Settings Terminal AI (`src/main/terminal-ai/`).
- Ввод Terminal Node-а — сырые нажатия: xterm (`src/renderer/canvas/nodes/TerminalNode.tsx:86`,
  `onData` — `:132`) → `terminal.input` → pty. Что набрано в строке, worfy не знает.
- Как это делает plugin zsh-autosuggestions (https://github.com/zsh-users/zsh-autosuggestions):
  - серый текст — `POSTDISPLAY` (текст после курсора, не часть строки) и `region_highlight` с
    `fg=8`;
  - стратегия «история» — последняя команда истории, которая начинается с набранного;
  - асинхронный ответ — `zle -F <fd>`: zsh зовёт функцию, когда в fd есть данные, пока ждёт ввода;
  - принять — обёртки виджетов `forward-char` и `end-of-line`; по слову — `forward-word`.
- Пока команда работает, ZLE не активен: widget ничего не показывает и ни о чём не спрашивает.
- Один shell открыт на нескольких экранах (ADR-0053; `src/main/terminal/pty.ts`, подписчики).
  Всё, что рисует shell, приходит на все экраны в общем выводе.
- У владельца в `~/.zshrc` только nvm, zsh-autosuggestions нет.

## Что делаем

1. **Socket** — `src/main/terminal-ai/socket.ts` (новый).
   - Unix socket `assist.sock` в папке Ticket-а 01 (права 0700), файл 0600; путь — не длиннее 103
     байт: `zsocket` zsh 5.9 копирует не больше 103 байт пути (Ticket 01 выбирает папку). Стартует с первым zsh-Terminal-ом, закрывается при
     выходе worfy. Файла socket-а нет при старте очередного Terminal-а (папку чистили) — сервер слушает
     заново.
   - Каждый запуск shell-а получает свой токен: `WORFY_ASSIST_SOCKET` и `WORFY_ASSIST_TOKEN` в
     окружении (правка `src/main/terminal/shell-integration.ts`). Токен связывает соединение с
     Terminal-ом (Project и Node) и умирает с shell-ом. Скрипт убирает обе переменные из окружения,
     как nonce Ticket-а 01.
   - Соединение без верного токена в первом сообщении закрывается.
   - Токен, nonce и текст строк в лог и в ошибки не попадают.
2. **Протокол** — `src/main/terminal-ai/protocol.ts` (новый). Одно сообщение — одна строка, поля
   через TAB. Перевод строки, TAB и `\` в тексте экранируются; кодирование — только встроенными
   средствами zsh, без внешней программы на каждое сообщение.
   - shell → main: `hello <токен>`; `ask <id> <функция> <строка>`; `cancel <id>`.
   - main → shell: `show <id> <текст>` — серый текст; `insert <текст>` — заменить строку (Ticket-ы 06,
     07); `status <текст>` — короткая серая строка вместо Suggestion («asking Claude…», «Limits until
     14:20»); `config <функции>` — какие функции включены.
   - Точный список — в «Итог»: по нему пишут Ticket-ы 04–07.
3. **Маршрут в main** — `src/main/terminal-ai/shell-link.ts` (новый).
   - `push(terminal, message)` — сообщение в shell этого Terminal-а; shell не подключён — пропуск.
   - Обработчики `ask` по функции — модули `src/main/terminal-ai/features/*.ts`. Их собирает glob,
     как `src/main/ipc/index.ts:62`: Ticket-ы 04–07 добавляют свой файл и этот не правят.
   - Settings изменились (Ticket 02) — `config` всем подключённым shell-ам.
4. **Widget** — `src/main/terminal/zsh/rc.d/10-assist.zsh` (новый), по образцу zsh-autosuggestions.
   - Suggestion из истории — на каждое нажатие: последняя команда `$history`, которая начинается с
     набранного. Без процесса и без main. Серый — `POSTDISPLAY` и `region_highlight` `fg=8`.
   - → в конце строки — принять целиком. → не в конце — как обычно.
   - Option/Alt+→ — принять до конца следующего слова. xterm.js 6.0.0 (версия worfy, `package.json`)
     шлёт на Alt+→ `ESC [1;3C` на всех системах (`node_modules/@xterm/xterm/src/common/input/Keyboard.ts`,
     ветка правой стрелки; `macOptionIsMeta` в worfy не задан). Widget привязывает ровно ту
     последовательность, которую шлёт xterm worfy; Ticket сверяет её с исходником xterm той версии,
     что стоит при claim (риск 6 spec-а).
   - Esc — скрыть (риск 5 spec-а, задержка `KEYTIMEOUT`).
   - Строка с пробелом в начале — без Suggestion.
   - Соединение одно на shell, на его fd — `zle -F`. Обработчик раскладывает сообщения по функциям
     `_worfy_assist_on_<вид>`. Общие функции для `rc.d` следующих Ticket-ов: показать серый текст,
     показать `status`, послать `ask` и `cancel`. Имена — в «Итог».
   - `insert` — `BUFFER` заменяется текстом, курсор в конце, `zle -R`. Enter не нажимается.
   - socket нет или он закрылся — Suggestion из истории работают, остальное молчит; в Terminal не
     печатается ни одной ошибки.
   - У пользователя уже есть zsh-autosuggestions (функция `_zsh_autosuggest_start` определена) — свой
     Suggestion не включается, сообщения main работают (spec, «Решено без владельца», пункт 7).
   - `config` выключил Suggestion — серого текста нет и из истории (там же, пункт 8).

**Не входит:** Suggestion от модели (Ticket 04), Next command (05), строка `# …` (06), Fix (07).

## Готово, когда

- [x] Unit `test/unit/terminal-ai-protocol.test.ts` (новый): каждое сообщение пункта 2 кодируется и разбирается обратно; текст с TAB, `\n`, `\`, кириллицей и эмодзи — без потерь.
- [x] Contract `test/contract/terminal-ai-zle.test.ts` (новый), настоящий zsh с интеграцией Ticket-а 01, `HOME` во временной папке: после `echo worfy-zle-1` ввод `echo wo` даёт в выводе серый `rfy-zle-1` (SGR цвета 8 или 90); → — строка `echo worfy-zle-1`, Enter печатает `worfy-zle-1`; Option+→ (`ESC [1;3C`, как его шлёт xterm.js worfy) принимает одно слово; Esc — серый текст стёрт; ` echo wo` (пробел в начале) — серого текста нет.
- [x] Тот же contract: файл socket — 0600, папка — 0700; путь socket-а в 103 байта — zsh подключается; соединение без `hello`, с чужим токеном и с токеном закрытого shell-а — закрыто; файл socket-а удалён — следующий Terminal подключается; `insert git status` заменяет строку, команда не запускается (её вывода нет, main не пишет в pty `\r`); `show` с устаревшим id не показывается; socket закрыт — история работает, в выводе нет ошибок zsh.
- [x] Тот же contract: `env` внутри shell-а — без `WORFY_ASSIST_TOKEN` и `WORFY_ASSIST_SOCKET`; вложенный `zsh -i` — без widget-а; определённая заранее `_zsh_autosuggest_start` — свой Suggestion не включается; `config` без Suggestion — серого текста нет.
- [x] e2e `test/e2e/terminal-ai-history.spec.ts` (новый): в Terminal Node выполнена команда с уникальной меткой, затем набран её префикс — в буфере xterm остаток команды серым; → и Enter выполняют её; Alt+ArrowRight (Playwright) принимает одно слово. Тот же Terminal во втором окне (helper `openSecondWindow`, `test/e2e/helpers.ts:228`) показывает тот же серый текст.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`, zsh владельца: Suggestion из истории — без заметной задержки; →, Option+→ и Esc работают; время скрытия по Esc — в «Итог». Снимки серого текста — `../evidence/03-suggestion-light.png` и `../evidence/03-suggestion-dark.png`: текст читается в обеих темах. Как проверить: окно worfy.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «после `echo worfy-zle-1` ввод `echo wo` даёт серый остаток»:
widget-а ещё нет. Потом протокол и socket.

contract идёт на настоящем zsh и в Linux CI. e2e — с настоящим `HOME` владельца, поэтому команда в
нём с уникальной меткой: история владельца не должна дать другой Suggestion (риск 10 spec-а). В «Итог» —
как падал первый test, точный протокол, имена общих функций widget-а для Ticket-ов 04–07.

## Где в коде

- `src/main/terminal-ai/socket.ts` (новый)
- `src/main/terminal-ai/protocol.ts` (новый)
- `src/main/terminal-ai/shell-link.ts` (новый)
- `src/main/terminal/shell-integration.ts` (из Ticket-а 01)
- `src/main/terminal/zsh/rc.d/10-assist.zsh` (новый)
- `test/unit/terminal-ai-protocol.test.ts` (новый)
- `test/contract/terminal-ai-zle.test.ts` (новый)
- `test/e2e/terminal-ai-history.spec.ts` (новый)

## Итог

2026-10-14. Ветка `worfy-terminal-ai/03`.

### Как падал первый test

`test/contract/terminal-ai-zle.test.ts`, «after `echo worfy-zle-1`, typing `echo wo` shows the rest of it
in grey», до widget-а: `expected … to match /zle[%#] echo wo\x1b\[(?:90|38;5;8)mrfy-zle-1\x1b\[39m/`,
получено `"[2J[0m[27m[24m[Jzle% echo wo[K"` — строка без серого остатка. После widget-а — зелёный.

### Протокол (точный)

Одно сообщение — одна строка, в конце `\n`. Поля разделены TAB. В поле `\` → `\\`, перевод строки →
`\n`, TAB → `\t`, возврат каретки → `\r`. zsh кодирует подстановками `${field//…}`, декодирует
`${(g::)field}` — без внешних программ. Кодек main — `src/main/terminal-ai/protocol.ts`
(`encodeMessage`, `parseShellMessage`, `parseMainMessage`). Строка длиннее 64 КиБ (`MAX_LINE_BYTES`)
не отправляется и не принимается.

| Направление | Сообщение | Поля |
|---|---|---|
| shell → main | `hello <токен>` | первое сообщение соединения; иначе соединение закрывается |
| shell → main | `ask <id> <функция> <строка>` | `id` — целое ≥ 1, растёт в пределах shell-а; функция — `[a-z][a-z0-9-]*` |
| shell → main | `cancel <id>` | ответ на этот `ask` больше не нужен |
| main → shell | `show <id> <текст>` | серый Suggestion; рисуется, только если `id` — открытый `ask` |
| main → shell | `status <id> <текст>` | серая заметка, клавишами не принимается; `id` 0 — не про `ask`, рисуется всегда |
| main → shell | `insert <текст>` | строка заменяется текстом, курсор в конец; Enter не нажимается |
| main → shell | `config <функции>` | включённые функции через пробел: `history suggest next request fix` |

Отличие от наброска в «Что делаем»: `status` несёт `id` (`status <id> <текст>`), иначе запоздавшая
заметка рисуется на чужой строке. Решено без владельца, подтверждено владельцем 2026-10-16.

`config`: `history` — Suggestion из истории (`settings.enabled && settings.suggestion`), остальные —
по `featureEnabled`. Main шлёт `config` сразу после `hello` и потом только при смене набора функций.

### Что берут Ticket-ы 04–07

Скрипт функции — файл `src/main/terminal/zsh/rc.d/20-….zsh` и дальше (в `ZDOTDIR` попадает сам).
Общие функции `10-assist.zsh`, все вызываются из widget-а:

- `_worfy_assist_ask <функция> <строка>` — спросить main; `id` в `REPLY`. Прежний `ask` отменяется.
  Отказ (код 1): нет соединения, функция выключена в Settings, строка начинается с пробела.
- `_worfy_assist_cancel` — отменить открытый `ask`.
- `_worfy_assist_show <текст>` — серый Suggestion, принимается → и Alt+→.
- `_worfy_assist_status <текст>` — серая заметка, не принимается.
- `_worfy_assist_hide` — убрать серый текст.
- `_worfy_assist_enabled <функция>` — включена ли функция.
- `__worfy_assist_line_hooks` — массив имён функций; каждая зовётся, когда строка изменилась, после
  поиска в истории: `$1` = `history` (история дала Suggestion), `kept` (показанный раньше Suggestion
  ещё подходит — пользователь набирает его начало) или пусто. Для пустой строки нового prompt-а hook
  тоже зовётся (из `line-init`): Ticket 05 (Next command) спрашивает отсюда, своего `line-init` не ставит.
- Новый вид сообщения от main — функция `_worfy_assist_on_<вид>` (поля уже декодированы) и тип в
  `protocol.ts`.

В main обработчик `ask` — файл `src/main/terminal-ai/features/<имя>.ts` с `export default` типа
`ShellFeature` (`src/main/terminal-ai/shell-link.ts`): `{ feature: 'suggest', ask(ask, reply, context) }`.
`ask` — `{ terminal, id, line, signal }` (`signal` прерывается на `cancel`, новом `ask` и разрыве);
`reply` — `show(text)`, `status(text)`, `insert(text)`, после отмены возвращают `false` и ничего не
шлют; `context` — `shellState(terminal)` (Ticket 01) и `assist()` (Ticket 02). Файлы собирает
`import.meta.glob('./features/*.ts')`; `shell-link.ts` править не нужно. Послать сообщение без `ask`
(Fix, Ticket 07): `terminalShellLink().push(terminal, message)` из `src/main/ipc/terminal.ts`.
`terminal` — ключ Terminal-а в `TerminalRegistry` (Project и Node).

### Socket и токен

- `assist.sock` в папке интеграции Ticket-а 01: папка 0700, файл 0600. Слушает с первого zsh-Terminal-а,
  закрывается на `exit` процесса; файл пропал — следующий Terminal заставляет слушать заново, прежние
  соединения живут. Путь длиннее 103 байт — Terminal стартует без socket-а (warn в логе, токена в нём нет).
- Токен — 16 случайных байт на запуск shell-а, отзывается при выходе shell-а. Пока соединение с этим
  токеном живо, второе с ним же закрывается. Без `hello` за 5 с — закрывается.
- `zshenv.zsh` переносит `WORFY_ASSIST_SOCKET` и `WORFY_ASSIST_TOKEN` в переменные shell-а и убирает
  из окружения; `10-assist.zsh` удаляет и переменные. `integrationEnv` стирает унаследованные
  `WORFY_ASSIST_*`, так что не-zsh и вложенные shell-ы их не получают.
- В лог идут только имя ошибки и ключ Terminal-а: токен, nonce и текст строк — нет (test «the token,
  the nonce and the lines of the shell are in no log line and in no error»).

### Клавиши

- → — через widget `forward-char` / `vi-forward-char` (как zsh-autosuggestions): в конце строки
  принимает Suggestion, иначе прежний widget, в том числе пользовательский. Ctrl+F — то же.
- Alt+→ — `ESC [1;3C`. Сверено с исходником xterm.js 6.0.0 при claim:
  `node_modules/@xterm/xterm/src/common/input/Keyboard.ts:126-137` — правая стрелка с модификатором
  даёт `CSI 1 ; <mod+1> C`, Alt = 2, итого `ESC [1;3C`; `macOptionIsMeta` в worfy не задан. e2e жмёт
  настоящий `Alt+ArrowRight` в окне. Без Suggestion клавиша делает то, к чему была привязана, а если
  ни к чему — `forward-word`. Слово — как у `emacs-forward-word` (`WORDCHARS` пользователя).
- Esc — скрывает серый текст и отменяет `ask`, затем прежняя привязка (`vi-cmd-mode` в vi keymap).
  Время скрытия по Esc в contract-test-е, три запуска: 408, 405, 407 мс — это `KEYTIMEOUT` zsh
  (0,4 с), zsh ждёт продолжения последовательности. Меньше — только уменьшив `KEYTIMEOUT`
  пользователя; не трогал.
- Клавиша, привязанная у пользователя к строке (`bindkey -s`), а не к widget-у: привязка заменяется,
  ошибок zsh нет (test «a key the user bound to a string…»).

### Решено без владельца, подтверждено владельцем 2026-10-16 (кроме пункта 9 — Ticket 11)

1. e2e идёт с временным `HOME` и `SHELL` = zsh машины, а не с настоящим `HOME` владельца, как в
   разделе «Тесты» и риске 10 spec-а: настоящие `~/.zshrc` и `~/.zsh_history` не читаются и не
   дописываются. Метка в команде всё равно уникальна.
2. `status` с `id` (см. выше).
3. Одинокий Esc теперь привязан и в keymap `emacs`: «Esc, пауза дольше 0,4 с, клавиша» как Meta больше
   не работает (быстрый Esc+клавиша и Alt+клавиша — работают).
4. Если пользователь набирает начало показанного Suggestion-а, остаток остаётся серым; история —
   раньше ответа main.
5. С zsh-autosuggestions выключены и `history`, и `suggest` (`_worfy_assist_enabled`): два серых
   текста на одной строке не рисуются. `status` и `insert` работают.
6. Команда истории, равная набранной строке целиком, Suggestion не даёт.
7. `config` приходит, когда zsh ждёт клавишу: на первом prompt-е shell-а Suggestion из истории
   включён, пока настройки не пришли (доли секунды).
8. Пределы: 64 КиБ на строку, 256 КиБ непрочитанного в сторону shell-а — дальше `push` возвращает `false`.
9. Соединение shell-а — на descriptor-е ≥ 10 (zsocket даёт 3, widget переносит). Дочерние процессы
   его наследуют: zsh не умеет close-on-exec. Descriptor-ы 3–9 у них закрыты (test). Токен по нему не
   прочитать — он уже отправлен, — но программа, запущенная в Terminal-е, может писать в это
   соединение от имени shell-а (`ask` с любой строкой). Убрать можно так: закрывать соединение в
   `preexec` и открывать в `precmd` с многоразовым токеном — цена: токен живёт в переменной shell-а
   всё время и переподключение на каждую команду. Не сделано. **Решение владельца 2026-10-16:** не
   принято как есть — Ticket [11](11-программа-в-terminal-пишет-в-соединение-shell-а.md).

### Файлы сверх «Где в коде»

По brief-у Orchestrator-а: `src/main/terminal/pty.ts` (выдача и отзыв токена при старте и выходе
shell-а), `src/main/ipc/terminal.ts` (создание `ShellLink`, `terminalShellLink()`),
`src/main/terminal/zsh/zshenv.zsh` (переменные окружения), `test/contract/terminal-shell-integration.test.ts`
(список файлов `ZDOTDIR` теперь с `rc.d/10-assist.zsh`). Папка `src/main/terminal-ai/features/` пуста:
в git её нет, glob даёт `{}`.

### Mutation testing

30 мутантов в своём worktree (`/tmp/worfy-tai-w2/impl-03/mut/run.mjs`, файл восстанавливается из
копии): 29 убиты с первого прогона. Выжил «изменившаяся строка не отменяет `ask`» — потому что новый
`ask` сам отменяет прежний; добавлен test «a line changed into one nobody asks about gives the open
ask up too», мутант убит. Суммы шести исходных файлов после прогона совпали с копиями.

### Проверки

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (232 файла, 4907 test-ов; contract-файл
  widget-а — 36 test-ов).
- `gate.sh fast` — exit 0, `[gate] зелено (fast)`.
- `pnpm test:e2e test/e2e/terminal-ai-history.spec.ts test/e2e/terminal.spec.ts test/e2e/focus.spec.ts`
  под `/tmp/worfy-e2e.lock` — exit 0, 13 passed.
- PR #306, Linux CI (`ubuntu-latest`, zsh из `apt`): в нём есть `zsh/net/socket` и `zsh/system` —
  contract-файл widget-а идёт там целиком, ни один test не выключен. Первый run был красным на одном
  test-е, «a zsh started in the Terminal has no widget and no socket»: `/etc/zsh/zshrc` Debian на каждом
  prompt-е включает режим keypad (`ESC =`), и test не узнавал конец prompt-а вложенного zsh. Исправлен
  шаблон в test-е, скрипты shell-а не менялись; второй run (38502926758) зелёный.
- `GATE_SCOPE=all` gate full — не запускал: его запускает Orchestrator.

### Снимки

`../evidence/03-suggestion-light.png` и `../evidence/03-suggestion-dark.png` — Playwright, временный
`HOME`. На обоих Terminal Node с тёмным фоном: `e2e% echo wo` светлым, после курсора
`rfy-tai-… second third` тускло-серым. Текст читается, но контраст низкий: серый — цвет 8 палитры
xterm по умолчанию `#555753`, на фоне Terminal-а это примерно 2,3:1 в светлой теме и 2,7:1 в тёмной.
Поднять можно, задав `brightBlack` в теме xterm (`src/renderer/canvas/nodes/TerminalNode.tsx`) — файл
вне списка Ticket-а, не трогал.

### Не проверено

- (вручную) `WORFY_AGENT=fake pnpm dev` с zsh владельца — не проверено: запуск с настоящим `HOME`
  владельца агенту запрещён; задержку Suggestion-а на глаз и клавиши в настоящем окне смотрит владелец.
- zsh старше 5.9 (без `memo=` в `region_highlight`): запасная ветка есть, test-а на старом zsh нет.

### Gate оркестратора (2026-10-14)

- Wave из одного Ticket-а под Autopilot. Гейт — один круг: `VERIFIED` на `e13e540` ([комментарий в PR #306](https://github.com/IDSAD-XL/worfy/pull/306#issuecomment-6160222758)). Verifier сам: gate fast — код 0, не из кэша; `test/contract/terminal-ai-zle.test.ts` дважды — 36 из 36, нестабильных test-ов нет; e2e `test/e2e/terminal-ai-history.spec.ts` под замком — код 0; 21 свой мутант, 19 красные, два выживших — в долгах ниже; клавиши на настоящем zsh с временным `HOME` (свои widget-ы на →, Alt+→ и Esc, `bindkey -v`, свои `zle-line-init`) — работают, ошибок zsh нет; снимки в обеих темах, с включённым и выключенным Suggestion.
- Мерж: база main `b885e17`, head `e13e540`; `GATE_SCOPE=all gate full` — один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`; консоль macOS у `alexey`; CI зелёный, CLEAN; влит `ba7e4e5`.
- **На решение владельца (Consider, [med], согласовано с verifier-ом):** серый Suggestion рисуется цветом 8 (`src/main/terminal/zsh/rc.d/10-assist.zsh:80`, `fg=8` — так задано в «Что делаем», пункт 4), у xterm это `#555753`: контраст 2,30:1 в светлой теме и 2,71:1 в тёмной при требовании `docs/design/F-SPEC.md:40` ≥ 4,5:1 для текста. На снимках текст читается, но тускло. Правится вне Ticket-а: `brightBlack` в `themeOf`, `src/renderer/canvas/nodes/TerminalNode.tsx:56-62` — это меняет цвет 8 для всего вывода Terminal-а, не только Suggestion.
- Долги (Noted, все [low]):
  - клавиши привязаны независимо от Settings: при выключенном Terminal AI одинокий Esc всё равно привязан («Esc, пауза, b» печатает `b`), → и Alt+→ остаются обёртками (`10-assist.zsh:360-379`) — к пункту 3 «Решено без владельца»; вариант: привязывать Esc, только пока серый текст на экране;
  - к пункту 7 «Решено без владельца»: при настройках, задержанных на 2,5 с, выключенный Suggestion показан, и → его принимает (`10-assist.zsh:106`); в собранном приложении verifier серого текста не увидел; вариант: передавать начальный список функций в окружении рядом с токеном;
  - к пункту 9 «Решено без владельца»: программа, запущенная в Terminal-е, не только пишет в соединение shell-а, но и читает то, что main шлёт shell-у, — verifier из дочернего `/bin/sh` прочитал `insert`; токен и строки других Terminal-ов ей недоступны (`10-assist.zsh:395`). Важно для Fix (Ticket 07);
  - две ветки без test-а: отзыв токена при ошибке запуска shell-а (`src/main/terminal/pty.ts:781`) и ранний `unset` (`10-assist.zsh:37`) — мутанты выжили;
  - `insert` не несёт id запроса: ушедший до прихода `cancel` заменит строку, которую пользователь уже изменил (`src/main/terminal-ai/protocol.ts:34`) — вопрос к Ticket-ам 06 и 07;
  - у кого → привязана прямо к своему widget-у, тот принимает Suggestion только по Alt+→.
- Нарушение запрета implementer-ом, один раз: он запустил `test/e2e/palette-find.spec.ts`, а этот test открывает Terminal Node с настоящим `HOME` и zsh владельца (`launchApp` без `HOME` и `SHELL`, строка 161): zsh прочитал настоящий `~/.zshrc`, в Terminal ничего не набиралось. Этот test идёт так и в gate full; после этого Ticket-а в нём активны widget и socket. Долг вне Ticket-а: дать ему временный `HOME` и `SHELL=/bin/sh`, как в `test/e2e/terminal.spec.ts:40`.
- Для Ticket-ов 04–07: в Debian и Ubuntu `/etc/zsh/zshrc` включает режим keypad, и prompt в Linux CI оканчивается на `ESC =` — шаблон prompt-а в contract-test-ах брать как в `test/contract/terminal-ai-zle.test.ts:861`.
- не проверено: настоящий plugin zsh-autosuggestions (в test-е его заменяет пустая функция); время скрытия по Esc verifier сам не мерил (405–408 мс — из прогонов implementer-а).

Решение владельца 2026-10-16: пункты «Решено без владельца» приняты пакетом,
кроме пункта 9. Программа, запущенная в Terminal-е, может писать в соединение shell-а от его имени —
это Ticket [11](11-программа-в-terminal-пишет-в-соединение-shell-а.md). Вопрос о цвете 8 закрыт
Ticket-ом `worfy-polish` 02.
