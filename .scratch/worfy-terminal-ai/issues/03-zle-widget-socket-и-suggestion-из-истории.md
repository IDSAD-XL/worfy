# 03 — ZLE widget и socket до main: Suggestion из истории, → / Option+→ / Esc, вставка в строку

Type: task
Status: open
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
   - Unix socket `assist.sock` в папке Ticket-а 01 (права 0700), файл 0600; путь — не длиннее 104
     байт (предел macOS, Ticket 01 выбирает папку). Стартует с первым zsh-Terminal-ом, закрывается при
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
     Suggestion не включается, сообщения main работают (spec, «Решено без владельца», пункт 8).
   - `config` выключил Suggestion — серого текста нет и из истории (там же, пункт 9).

**Не входит:** Suggestion от модели (Ticket 04), Next command (05), строка `# …` (06), Fix (07).

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-protocol.test.ts` (новый): каждое сообщение пункта 2 кодируется и разбирается обратно; текст с TAB, `\n`, `\`, кириллицей и эмодзи — без потерь.
- [ ] Contract `test/contract/terminal-ai-zle.test.ts` (новый), настоящий zsh с интеграцией Ticket-а 01, `HOME` во временной папке: после `echo worfy-zle-1` ввод `echo wo` даёт в выводе серый `rfy-zle-1` (SGR цвета 8 или 90); → — строка `echo worfy-zle-1`, Enter печатает `worfy-zle-1`; Option+→ (`ESC [1;3C`, как его шлёт xterm.js worfy) принимает одно слово; Esc — серый текст стёрт; ` echo wo` (пробел в начале) — серого текста нет.
- [ ] Тот же contract: файл socket — 0600, папка — 0700; соединение без `hello`, с чужим токеном и с токеном закрытого shell-а — закрыто; файл socket-а удалён — следующий Terminal подключается; `insert git status` заменяет строку, команда не запускается (её вывода нет, main не пишет в pty `\r`); `show` с устаревшим id не показывается; socket закрыт — история работает, в выводе нет ошибок zsh.
- [ ] Тот же contract: `env` внутри shell-а — без `WORFY_ASSIST_TOKEN` и `WORFY_ASSIST_SOCKET`; вложенный `zsh -i` — без widget-а; определённая заранее `_zsh_autosuggest_start` — свой Suggestion не включается; `config` без Suggestion — серого текста нет.
- [ ] e2e `test/e2e/terminal-ai-history.spec.ts` (новый): в Terminal Node выполнена команда с уникальной меткой, затем набран её префикс — в буфере xterm остаток команды серым; → и Enter выполняют её; Alt+ArrowRight (Playwright) принимает одно слово. Тот же Terminal во втором окне (helper `openSecondWindow`, `test/e2e/helpers.ts:228`) показывает тот же серый текст.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`, zsh владельца: Suggestion из истории — без заметной задержки; →, Option+→ и Esc работают; время скрытия по Esc — в «Итог». Снимки серого текста — `../evidence/03-suggestion-light.png` и `../evidence/03-suggestion-dark.png`: текст читается в обеих темах. Как проверить: окно worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

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

Заполняется при закрытии.
