# worfy-terminal-ai: AI-подсказки в Terminal-ах worfy на подписке

Status: по решениям владельца 2026-10-09 (пункты 1–7 раздела «Решения владельца» решены владельцем
целиком); «Готово, когда», разбиение на Ticket-ы и раздел «Решено без владельца» — предложение этого
docs-PR, подтвердить
Source: [roadmap.md](../../docs/roadmap.md), раздел `worfy-terminal-ai`; [CONTEXT.md](../../CONTEXT.md),
термины Terminal AI, Suggestion, Next command, Command request, Fix; ADR этого docs-PR —
[ADR-0058](../../docs/adr/0058-terminal-ai-assist-process.md) (свой процесс Claude Code для Terminal AI);
[spike задержек 2026-10-09](evidence/spike-задержки-2026-10-09.md); ADR
[0007](../../docs/adr/0007-claude-code-launch-environment.md),
[0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md),
[0052](../../docs/adr/0052-machines-and-linking.md),
[0053](../../docs/adr/0053-several-screens-on-one-project.md),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md); Epic [worfy-link](../worfy-link/spec.md)
— формат и соглашения.
Ticket-ы: Epic `worfy-terminal-ai`, 9 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у
worfy-link (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket`
и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец работает в Terminal-е worfy, и модель Claude помогает ему набирать команды: продолжает
набранное серым текстом, предлагает следующую команду, пишет команду по просьбе словами и
исправляет упавшую. Платит подписка владельца, как за Session-ы. Ничего не запускается само:
команду запускает пользователь.

Epic готов, когда:

1. В Terminal-е на zsh серый Suggestion появляется сразу из истории команд, а если история молчит —
   от модели после паузы. → принимает его целиком, Option/Alt+→ — по словам, Esc скрывает. Его видят
   все экраны, где открыт этот Terminal.
2. После команды на пустой строке появляется Next command. Строка `# …` + Enter и панель Cmd/Ctrl+I
   вставляют в строку команду по просьбе словами. После команды с ошибкой кнопка «Fix» вставляет
   исправленную. Сама ни одна команда не запускается.
3. Модель зовёт один общий процесс Claude Code на подписке — без MCP-серверов, tools, hooks и
   транскриптов. Его запросы видны в Limits. Автоматические функции выключаются сами выше 80 % окна
   5 часов и при `allowed_warning` или `rejected`; функции по требованию работают до `rejected`.
4. В модель уходит только перечисленный контекст. Секреты заменены, переменных окружения нет.
   Запросов нет во время команды, на альтернативном экране и для строки с пробелом в начале.
   `~/.zshrc` не меняется.
5. Всё выключается в Settings → «Terminal AI». test-ы не тратят подписку, live-проверка владельца
   пройдена.

Проверку всех пяти пунктов делает Ticket 09.

## Как устроено

- **Четыре функции** (решение 1; термины — [CONTEXT.md](../../CONTEXT.md), раздел «Terminal AI»).
  - Suggestion — серый текст после курсора. Сначала из истории команд, мгновенно и без модели.
    Если история молчит — после паузы Haiku; ответ приходит через 1,5–5 с, а если пользователь
    печатает дальше, запрос отменяется или ответ отбрасывается (Ticket-ы 03, 04).
  - Next command — после команды Sonnet (`effort: 'low'`) предлагает следующую; в Settings можно
    выбрать Haiku (Ticket 05).
  - Command request — строка, которая начинается с `# `, и Enter, или панель над Terminal-ом по
    Cmd/Ctrl+I. Sonnet возвращает команду, она вставляется в строку (Ticket 06).
  - Fix — кнопка после команды с кодом выхода не 0. Sonnet получает команду и ~50 последних строк её
    вывода и возвращает исправленную (Ticket 07).
- **Shell integration** (решение 4, Ticket 01). worfy узнаёт границы команд, папку и код выхода из
  последовательностей OSC 133 и OSC 633 — так их называет VS Code
  (https://code.visualstudio.com/docs/terminal/shell-integration). Скрипты worfy подключаются, как в
  VS Code: `ZDOTDIR` shell-а указывает на временную папку worfy, а её `.zshenv`, `.zprofile`,
  `.zshrc`, `.zlogin` подгружают одноимённые файлы пользователя. `~/.zshrc` не меняется. Только zsh
  и только в Terminal Node-ах worfy (`TERM_PROGRAM=worfy`, `src/main/terminal/pty.ts:61`).
- **ZLE widget и socket** (решение 4, Ticket 03). ZLE — редактор строки zsh. Серый текст рисует сам
  zsh, как plugin zsh-autosuggestions: `POSTDISPLAY`, ответы асинхронно через `zle -F`. С main shell
  говорит через локальный socket (`zmodload zsh/net/socket; zsocket`): файл 0600, токен shell-а — в
  переменной окружения, которую скрипт читает и сразу убирает. Shell рисует и принимает серый текст
  сам, поэтому его видят все окна, где открыт этот shell
  ([ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md)).
- **Assist-процесс** (решение 5, Ticket 02, ADR-0058). Один процесс Claude Code через Agent SDK на все
  Terminal-ы. Опции: `settingSources: []`, без MCP, `tools: []`, `persistSession: false`, `title`
  задан. Стартует с первого запроса, без запросов ~10 минут выгружается. Каждый запрос
  самостоятельный: свежий `query()` на заранее прогретом процессе, без общей истории (почему — ADR-0058,
  пункт 2). Это не Session: нет Node-а, Binding-а и транскрипта.
- **Модели** (решения 1 и 5). Suggestion — Haiku с выключенным thinking: с `effort: 'low'` Haiku
  думал до 54 с (spike). Next command, Command request и Fix — Sonnet с `effort: 'low'`. Session-ам
  haiku по-прежнему нельзя (Ticket 07 Epic-а worfy-daily); assist-процесс — исключение, у него нет
  MCP-серверов и tools (ADR-0058).
- **Limits** (решение 2, Ticket 02). Запросы assist-процесса кормят Limits worfy так же, как Session-ы
  (`appLimits().observe`, `src/main/agent/app-registry.ts:94`). Решение «можно ли спросить» —
  чистая функция от состояния Limits (`LimitsTracker`, `src/main/agent/limits.ts:45`), по образцу
  ожидания Autopilot (`src/main/autopilot/limits-wait.ts`). Автоматические функции спрашивают модель
  только после паузы и выключаются сами выше 80 % окна 5 часов и при `allowed_warning` или
  `rejected`; функции по требованию — только при `rejected`.
- **Контекст и приватность** (решение 3). В модель уходят: текущая строка, папка, до 20 последних
  команд этого Terminal-а, ветка git, код выхода; хвост вывода (~50 строк) — только для Fix.
  - Переменные окружения — никогда.
  - Секреты заменяются до отправки (`src/shared/terminal-ai/redact.ts`, Ticket 02).
  - Пока идёт команда (между OSC 133 C и D: там пароли sudo и ssh) и на альтернативном экране (vim,
    less) — запросов нет. Пока команда идёт, ZLE не работает, так что widget не спрашивает; main
    проверяет это второй раз по состоянию Ticket-а 01.
  - Строка с пробелом в начале не уходит — соглашение `HIST_IGNORE_SPACE` zsh.
  - Последовательность OSC без nonce своего shell-а main не принимает: её могла напечатать программа.
- **Ничего не запускается само** (решение 1). Ответ попадает в строку ввода shell-а: в `BUFFER` zsh
  или серым текстом. Enter нажимает пользователь. У assist-процесса нет tools.
- **Каналы IPC — `local`** (решение 2, [ADR-0052](../../docs/adr/0052-machines-and-linking.md),
  пункт 6; пометки — `src/shared/ipc/channels.ts:34`). Settings, состояние, Command request из
  панели и Fix — каналы машины экрана, Linked machine-у закрыты. Окно на Project-е Linked machine-а
  панель Cmd/Ctrl+I и кнопку «Fix» не показывает. Suggestion, Next command и строку `# …` делает
  shell, поэтому они работают на любом экране, где открыт Terminal, — на Machine Project-а и по её
  подписке.
- **Settings → «Terminal AI»** (решение 2, Ticket 08). Окно Settings делает Epic `worfy-ui`. На
  2026-10-09 его spec нет ни в main, ни в открытом PR. Ticket 08 ждёт Ticket окна Settings этого
  Epic-а. До него переключатели хранятся (Ticket 02) и действуют, но окна для них нет.
- **test-ы без подписки** (решение 7). Unit- и contract-test-ы подставляют поддельную фабрику
  запросов. e2e идут с `WORFY_AGENT=fake` (`test/e2e/helpers.ts:139`): assist-процесс тогда — fake с
  ответами из файла, как черновик Profile-а (`src/main/ipc/projects.ts:117`). Под vitest настоящая
  фабрика бросает ошибку. Подписку тратит одна live-проверка владельца — Ticket 09.

## Этапы

1. **Основа** — 01, 02.
   - 01: shell integration для zsh — `ZDOTDIR` worfy, OSC 133/633 с nonce, разбор в main: папка,
     код выхода, границы команд, последние команды, альтернативный экран.
   - 02: assist-процесс в main — прогрев, выгрузка, модели по функции, Limits, redaction, контекст,
     хранение Settings и каналы `terminalAi.*`, fake для test-ов.
2. **Shell и Settings** — 03, 08.
   - 03: socket main ↔ zsh, протокол, ZLE widget, Suggestion из истории, приём →, Option/Alt+→, Esc.
   - 08: раздел «Terminal AI» окна Settings — когда окно Settings `worfy-ui` влито.
3. **Функции** — 04, 05, 06, 07.
   - 04: Suggestion от Haiku, когда история молчит.
   - 05: Next command.
   - 06: Command request — строка `# …` и панель Cmd/Ctrl+I.
   - 07: Fix.
4. **Приёмка** — 09: пять пунктов «Готово, когда», live-проверка владельца на подписке.

## Решения владельца

Решения владельца 2026-10-09. Ticket-ы ссылаются на номер пункта.

1. **Функции.**
   - (a) Suggestion во время набора — серый текст в строке: сразу из истории команд (локально, без
     модели); если история молчит — после паузы Haiku с выключенным thinking. Ответ может прийти
     через 1,5–5 с; если пользователь печатает дальше, запрос отменяется или ответ отбрасывается.
     → принимает целиком, Option/Alt+→ — по слову, Esc скрывает.
   - (b) Next command — после конца команды Sonnet (`effort: 'low'`) предлагает следующую;
     переключатель в Settings даёт выбрать Haiku.
   - (c) Command request — строка, которая начинается с `# `, и Enter, или Cmd/Ctrl+I — маленькая
     панель над Terminal-ом. Sonnet возвращает команду, она вставляется в строку и никогда не
     запускается сама.
   - (d) Fix — кнопка «Fix» после команды с кодом выхода не 0. Sonnet получает команду и ~50
     последних строк вывода, возвращает исправленную; она вставляется и не запускается.
2. **Limits.** Автоматические функции (a) и (b) — Haiku или Sonnet в фоне и только после паузы. Они
   выключаются сами, когда окно 5 часов занято больше 80 % или статус `allowed_warning` или
   `rejected` (`LimitsTracker`, образец — `src/main/autopilot/limits-wait.ts`). Функции по
   требованию (c) и (d) доступны до `rejected`. Запросы кормят Limits worfy (обёртка как
   `appLimits().observe` в `src/main/agent/app-registry.ts`). Всё выключается в Settings → «Terminal
   AI».
3. **Контекст и приватность.** Отправляются текущая строка, папка, ~20 последних команд этого
   Terminal-а, ветка git, код выхода; хвост вывода (~50 строк) — только для Fix. Переменные
   окружения — никогда. Секреты заменяются до отправки: `AKIA…`, `ghp_`/`github_pat_`, `sk-…`,
   `xox…`, JWT, `Bearer …`, `*_TOKEN=`, `PASSWORD=`, `user:pass@` в URL. Модель не спрашивается, пока
   идёт команда (между OSC 133 C и D: пароли sudo и ssh) и на альтернативном экране (vim, less).
   Строки с пробелом в начале пропускаются (соглашение `HIST_IGNORE_SPACE`). OSC, напечатанным
   программами, worfy не верит (nonce).
4. **Архитектура — гибрид, сначала zsh.** Suggestion — через ZLE widget zsh (как zsh-autosuggestions:
   `POSTDISPLAY`, асинхронно через `zle -F`, локальный socket `zmodload zsh/net/socket; zsocket` до
   main, socket 0600 и nonce в окружении). Shell рисует и принимает серый текст сам, поэтому его видит
   каждое окно с этим shell-ом (ADR-0053). Контекст (папка, код выхода, границы команд) — через shell
   integration OSC 133/633, подключённую как в VS Code: `ZDOTDIR` на свою временную папку worfy с
   обёртками `.zshenv`/`.zprofile`/`.zshrc`/`.zlogin`, которые подгружают файлы пользователя;
   `~/.zshrc` не меняется; только в Terminal-ах worfy (`TERM_PROGRAM=worfy`). bash и fish — позже;
   PowerShell на Windows — позже, через предикторы PSReadLine (`ICommandPredictor`), вне этого Epic-а.
5. **Процесс модели.** Один общий тёплый процесс Claude Code на все Terminal-ы worfy: Agent SDK на
   подписке, `settingSources: []`, без MCP, без tools, `persistSession: false`, thinking выключен у
   Haiku, `title` задан. Стартует с первого запроса, выгружается после ~10 минут простоя. Каждый
   запрос самостоятельный, без растущей истории. Это исключение из правила ADR-0021 и Ticket-а 07
   worfy-daily (Session-ам haiku нельзя, потому что 634 tools MCP переполняют его контекст) — его
   записывает новый ADR (ADR-0058) вместе с причинами «не ключ API» и отвергнутыми вариантами.
6. **Словарь** — Suggestion, Next command, Command request, Fix, Terminal AI в
   [CONTEXT.md](../../CONTEXT.md); Terminal AI — не Session агента.
7. **Порядок и проверка.** Epic идёт на Mac параллельно с Epic-ом `worfy-ui`. Ticket — на одного
   исполнителя. test-ы проверяются без расхода подписки: fake assist в unit-, contract- и e2e-test-ах;
   одна live-проверка владельца в конце.

## Решено без владельца, подтвердить

Выбрано в этом docs-PR, Ticket-ы делают так, пока владелец не скажет иначе:

1. **Как запросы остаются самостоятельными** — свежий `query()` на заранее прогретом процессе;
   после ответа процесс закрывается и прогревается следующий (ADR-0058, пункт 2). Не перезапуск одной
   streaming-Session.
2. **Паузы и тайм-ауты** — Suggestion спрашивает модель через 600 ms без нажатий, Next command —
   через 800 ms на пустой строке после prompt-а. Ответ ждётся: Suggestion — 5 с, Next command — 8 с,
   Command request и Fix — 30 с. Ticket-ы 02, 04, 05 могут подвинуть числа по замеру; итог — в «Итог».
3. **Очередь** — в полёте один запрос; новый автоматический отменяет автоматический; запрос по
   требованию отменяет автоматический и сам не отменяется (Ticket 02).
4. **По умолчанию всё включено**, Next command — на Sonnet. Settings хранятся на Machine, а не в
   Project-е: `<WORFY_DATA_DIR>/terminal-ai.json` (Ticket 02).
5. **Панель Cmd/Ctrl+I и «Fix» — только в окне своей Machine.** Это следствие каналов `local`
   (решение 2): на экране Linked machine-а их нет, а Suggestion, Next command и `# …` есть.
6. **Ответ Command request и Fix заменяет строку целиком.** Прежний текст строки уходит в модель как
   контекст; вернуть его — undo zsh (Ctrl+_).
7. **Suggestion от модели отменяется, если поток начался с thinking** (ADR-0058, пункт 3).
8. **У пользователя уже есть zsh-autosuggestions** — свой Suggestion worfy не включает, остальные
   функции работают (Ticket 03). У владельца этого plugin-а нет.
9. **Settings «Suggestion»** выключает и подсказки из истории, а не только модель. Отдельный
   переключатель «Ask Claude when history has nothing» выключает только модель.
10. **Ticket-ы 06 и 08 — `Status: blocked`** до мержа Ticket-ов других Epic-ов: 06 — до Ticket-а 11
    `worfy-windows` (`src/renderer/platform.ts`), 08 — до окна Settings `worfy-ui`. `Blocked by` держит
    только Ticket-ы своего Epic-а, поэтому ожидание записано в `Status`.

## Не в этом Epic-е

- **bash и fish** — позже (решение 4). В Terminal-е на другом shell-е Terminal AI не работает,
  Terminal ведёт себя как сейчас.
- **PowerShell на Windows** — позже, через предикторы PSReadLine (`ICommandPredictor`) (решение 4).
  Terminal на PowerShell делает Ticket 10 Epic-а `worfy-windows`.
- **Ghost text поверх xterm, как в VS Code, и свой редактор строки, как в Warp** — отвергнуты
  (ADR-0058, Considered Options).
- **Ключ API** — отвергнут (ADR-0058).
- **Панель Cmd/Ctrl+I и «Fix» на экране Linked machine-а** — нет, каналы `local`.
- **Подсказки внутри ssh, tmux и вложенного shell-а** — там нет скриптов worfy.
- **Terminal «Sign in with gh»** (`src/main/github/accounts.ts:219-224`) — без Terminal AI: там не
  shell.
- **Окно Settings** — Epic `worfy-ui`; здесь только раздел «Terminal AI».

## Риски и открытые технические вопросы

1. **Haiku и thinking.** В Claude Code 2.1.289 `haiku` — это `claude-haiku-4-5-20251001`, и thinking у
   него выключается. Документация Claude Code говорит, что у моделей 5.5 thinking не выключается
   (https://code.claude.com/docs/en/costs). Переедет псевдоним — Suggestion от модели станет
   медленным, и запросы будут отменяться (решение без владельца 7). Ticket 02 пишет в лог модель из
   `init`; Ticket 09 проверяет вживую.
2. **Правила подписки.** Сейчас Agent SDK на подписке разрешён для обычного личного использования
   (ADR-0058, «Контекст»). Правила уже менялись в 2026 году. Изменятся — Terminal AI выключается в
   Settings.
3. **Встроенные plugin-ы Claude Code** грузятся и при `settingSources: []` (evidence spike-а). Есть ли у
   них hooks на каждый запрос, не проверено — проверяет Ticket 02 по сообщению `init` и
   журналу процесса.
4. **Assist-процесс и список Session-ов.** worfy показывает живые Session-ы по `~/.claude/sessions` и
   `cwd` (`src/main/claude-home/registry.ts`). `cwd` assist-процесса — папка worfy, не Project, поэтому
   на Canvas он не попадает. Пишет ли Claude Code с `persistSession: false` файл в `sessions/` — не
   проверено (Ticket 02, Ticket 09).
5. **Esc в zsh** — начало последовательностей Alt. Привязка одного Esc ждёт `KEYTIMEOUT` (0,4 с по
   умолчанию), и серый текст скрывается с этой задержкой. Ticket 03 меряет. Мешает — предлагает
   другую клавишу владельцу.
6. **Option/Alt+→.** Что шлёт xterm.js, Ticket 03 проверяет. По чтению кода xterm.js — `ESC f` на
   macOS и `ESC [1;5C` на других системах; widget привязывает обе.
7. **Длина пути socket.** У Unix socket на macOS предел пути — 104 байта. Папка — в `os.tmpdir()`
   (`/var/folders/…/T/`), не в папке данных worfy. Ticket 01 выбирает имя, Ticket 03 проверяет длину.
8. **Нагрузка разбора вывода.** main разбирает каждый кусок вывода pty. Ticket 01 повторяет замер
   10 МБ Ticket-а 05 Epic-а `worfy-link` (там: 331 ms до последнего байта, p99 задержки event loop main
   12 ms) и сравнивает.
9. **Prompt-ы пользователя.** Если prompt (starship, powerlevel10k) сам печатает OSC 133 — без nonce worfy
   их не принимает. Конфликт обёрток `ZDOTDIR` с plugin manager-ами пользователя не проверялся: у
   владельца в `~/.zshrc` только nvm.
10. **e2e и настоящая история владельца.** e2e Terminal-а идут с настоящим `HOME`, и Suggestion из
    истории может прийти из `~/.zsh_history` владельца. Команды в e2e — с уникальной меткой.
    contract-test-ы ставят `HOME` во временную папку.
11. **Файлы Ticket-а 08 неизвестны.** Окно Settings и способ подключить раздел задаёт `worfy-ui`.
    Ticket 08 дописывает «Где в коде» при claim. От этого Wave 2 может сдвинуться.
12. **Общие файлы с другими Epic-ами** — раздел «Соглашения», пункт «Перед каждой Wave».
13. **Решения без владельца** — раздел выше; Ticket-ы делают по нему до ответа владельца.
14. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-link](../worfy-link/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух
темах, Autopilot над worfy — только на Stable copy, мерж по очереди. Отличия:

- **Кто ведёт** — Session на Mac владельца, параллельно с Epic-ом `worfy-ui` (решение 7). Ticket 09
  Autopilot не берёт: в нём live-проверка владельца.
- **Ветки** — `worfy-terminal-ai/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Номер ADR Ticket-у выдаёт Orchestrator в момент взятия: следующий свободный, по одному
  решению на файл. Принятые ADR не правятся: уточнение — новым ADR.
- **Подписку test-ы не тратят** (решение 7).
  - unit и contract — поддельная фабрика запросов, передаётся параметром;
  - e2e — `WORFY_AGENT=fake` из `launchApp`; ответы — файл `WORFY_TERMINAL_AI_ANSWERS`, который
    test пишет во временную папку; журнал запросов — `WORFY_TERMINAL_AI_LOG`. `test/e2e/helpers.ts`
    Ticket-ы этого Epic-а не правят;
  - под vitest настоящая фабрика бросает ошибку (Ticket 02);
  - live-проверка — только Ticket 09, владелец.
- **zsh в test-ах.** contract-test-ы с настоящим zsh идут и в Linux CI: там zsh ставится
  (`.github/workflows/ci.yml:41`). `HOME` и файлы пользователя — во временной папке. Настоящие
  `~/.zshrc` и `~/.zsh_history` test-ы не трогают.
- **Файлы функций — свои.** Чтобы Ticket-ы Wave 3 не делили файлов (предложение Ticket-ов 01 и 03):
  - скрипты zsh функции — свой файл `src/main/terminal/zsh/rc.d/NN-<функция>.zsh`. Все `*.zsh` этой
    папки попадают в `ZDOTDIR` сами (glob, Ticket 01);
  - обработчик функции в main — свой файл `src/main/terminal-ai/features/<функция>.ts`. Их собирает
    glob Ticket-а 03, как `src/main/ipc/index.ts:62` собирает handler-ы IPC;
  - каналы IPC — свой домен: `src/shared/ipc/terminal-ai-<функция>.ts` и
    `src/main/ipc/terminal-ai-<функция>.ts` (ADR-0006: handler-ы подхватываются сами);
  - e2e — свой spec-файл `test/e2e/terminal-ai-<функция>.spec.ts`.
- **Новый канал IPC — с пометкой `local`** (решение 2; ADR-0052, пункт 6).
- **Перед каждой Wave — открытые PR других Epic-ов.** Их файлы сравниваются с «Где в коде» Ticket-ов
  Wave тем же правилом, что внутри Wave (`filesOverlap`). Ticket с общим файлом ждёт мержа того PR.
  Пересечение и отложенный Ticket — в отчёте Wave. На 2026-10-09:
  - Ticket 10 `worfy-windows` (Terminal на PowerShell; открыт, PR нет) правит
    `src/main/terminal/pty.ts` и `src/main/ipc/terminal.ts` — общие с Ticket-ом 01. Кто вливается
    вторым, перебазируется и проверяет оба поведения: zsh с интеграцией, PowerShell без неё.
    Интеграция включается по имени shell-а, без веток по платформе, поэтому PR этого Epic-а — не
    платформенные (ADR-0056, пункт 2). Если Ticket-у понадобится ветка по платформе — его PR
    платформенный, с gate full на Windows-ПК владельца.
  - Ticket 11 `worfy-windows` (Ctrl вместо ⌘; открыт) создаёт `src/renderer/platform.ts` с
    `isPrimary`. Cmd/Ctrl+I Ticket-а 06 идёт через него, поэтому 06 — `blocked` до мержа 11.
  - PR #200 (`worfy-windows/08`, открыт) правит `src/main/agent/env.ts`, `src/main/agent/limits.ts`,
    `src/main/agent/options.ts`, `src/shared/agent/limits.ts`. Ticket 02 их только импортирует
    (`agentEnv`, `appLimits`, `claudeExecutablePath`, тип `LimitsState`): общих файлов в «Где в коде»
    нет. 02 перечитывает их на свежем main при claim.
  - Epic `worfy-ui` (spec не влит): Ticket 08 ждёт его окно Settings. Если `worfy-ui` правит
    `src/renderer/canvas/nodes/TerminalNode.tsx` или `TerminalNode.css` — сверка перед Wave 3 и 4
    (Ticket-ы 06, 07).
  - PR #197 (Epic `worfy-review`, документы) и PR #201 (`test/e2e/epic-frame.spec.ts`) с Ticket-ами
    этого Epic-а файлов не делят.
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` — локально перед
  мержем: `GATE_SCOPE=all gate.sh full` на ветке (команда — `rules.md` Profile-а worfy).
- **Ручные проверки на подписке** — только в Ticket-е 09. В остальных Ticket-ах ручные пункты идут на
  fake (`WORFY_AGENT=fake pnpm dev`).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/main/terminal/pty.ts`, `src/main/ipc/terminal.ts`, `src/main/terminal/shell-integration.ts`, `src/main/terminal/osc.ts`, `src/main/terminal/zsh/zshenv.zsh`, `src/main/terminal/zsh/zprofile.zsh`, `src/main/terminal/zsh/zshrc.zsh`, `src/main/terminal/zsh/zlogin.zsh`, `src/main/terminal/zsh/integration.zsh`, `src/main/terminal/zsh/assets.d.ts`, `test/unit/terminal-osc.test.ts`, `test/contract/terminal-shell-integration.test.ts` | 1 |
| 02 | `src/main/terminal-ai/assist.ts`, `src/main/terminal-ai/options.ts`, `src/main/terminal-ai/limits-gate.ts`, `src/main/terminal-ai/settings.ts`, `src/main/terminal-ai/git-branch.ts`, `src/main/terminal-ai/fake-backend.ts`, `src/shared/terminal-ai/context.ts`, `src/shared/terminal-ai/redact.ts`, `src/shared/terminal-ai/settings.ts`, `src/shared/ipc/terminal-ai.ts`, `src/main/ipc/terminal-ai.ts`, `test/unit/terminal-ai-options.test.ts`, `test/unit/terminal-ai-redact.test.ts`, `test/unit/terminal-ai-context.test.ts`, `test/unit/terminal-ai-limits-gate.test.ts`, `test/contract/terminal-ai-assist.test.ts` | 1 |
| 03 | `src/main/terminal-ai/socket.ts`, `src/main/terminal-ai/protocol.ts`, `src/main/terminal-ai/shell-link.ts`, `src/main/terminal/shell-integration.ts`, `src/main/terminal/zsh/rc.d/10-assist.zsh`, `test/unit/terminal-ai-protocol.test.ts`, `test/contract/terminal-ai-zle.test.ts`, `test/e2e/terminal-ai-history.spec.ts` | 2 |
| 04 | `src/main/terminal-ai/features/suggest.ts`, `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`, `test/contract/terminal-ai-suggest.test.ts`, `test/e2e/terminal-ai-suggest.spec.ts` | 3 |
| 05 | `src/main/terminal-ai/features/next-command.ts`, `src/main/terminal/zsh/rc.d/30-next-command.zsh`, `test/contract/terminal-ai-next-command.test.ts`, `test/e2e/terminal-ai-next-command.spec.ts` | 3 |
| 06 | `src/main/terminal-ai/features/command-request.ts`, `src/main/terminal/zsh/rc.d/40-command-request.zsh`, `src/shared/ipc/terminal-ai-request.ts`, `src/main/ipc/terminal-ai-request.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.css`, `src/renderer/canvas/nodes/TerminalAiRequest.tsx`, `src/renderer/platform.ts`, `test/contract/terminal-ai-request.test.ts`, `test/unit/terminal-ai-request.test.tsx`, `test/e2e/terminal-ai-request.spec.ts` | 3 |
| 07 | `src/main/terminal-ai/fix.ts`, `src/shared/terminal-ai/output-tail.ts`, `src/shared/ipc/terminal-ai-fix.ts`, `src/main/ipc/terminal-ai-fix.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.css`, `test/unit/terminal-ai-output-tail.test.ts`, `test/unit/terminal-ai-fix-button.test.tsx`, `test/contract/terminal-ai-fix.test.ts`, `test/e2e/terminal-ai-fix.spec.ts` | 4 |
| 08 | `src/renderer/settings/TerminalAiSection.tsx`, `test/unit/terminal-ai-settings.test.tsx`, `test/e2e/terminal-ai-settings.spec.ts` | 2 |
| 09 | `.scratch/worfy-terminal-ai/spec.md`, `.scratch/worfy-terminal-ai/evidence/09-live-проверка.md` | 5 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01 и 02.** Блокеров нет. Общих файлов нет: 01 — `src/main/terminal/`,
  `src/main/ipc/terminal.ts`; 02 — новые папки `src/main/terminal-ai/` и `src/shared/terminal-ai/`,
  домен IPC `terminal-ai`.
- **Wave 2 — 03 и 08.** 03 ждёт 01 и 02, 08 — 02. Общих файлов нет: 03 — socket, протокол, маршрут
  в main и widget `rc.d/10-assist.zsh`; 08 — раздел окна Settings. 08 при этом `blocked` до окна
  Settings `worfy-ui`: не влито к Wave 2 — 08 уходит в более позднюю Wave.
- **Wave 3 — 04, 05 и 06.** Все ждут 02 и 03. Общих файлов нет: у каждого свой `rc.d/*.zsh`, свой
  `features/*.ts`, свои test-ы; 06 ещё панель в `TerminalNode.tsx` и домен IPC
  `terminal-ai-request`. 06 `blocked` до Ticket-а 11 `worfy-windows`.
- **Wave 4 — 07, один.** Ждёт 02 и 03; по блокерам — Wave 3, сдвинут (ниже).
- **Wave 5 — 09, один.** Ждёт все остальные Ticket-ы. Отмечает пункты «Готово, когда» в этом файле.

Сдвиги из-за общих файлов:

- **07: Wave 3 → 4.** С 06 общие `src/renderer/canvas/nodes/TerminalNode.tsx` и
  `src/renderer/canvas/nodes/TerminalNode.css`. Если к Wave 3 Ticket 11 `worfy-windows` не влит и 06
  стоит, вычисление Wave в момент запуска возьмёт 07 раньше — это допустимо.

Таблица собрана скриптом. Файлы — текст в обратных кавычках пунктов списка «Где в коде», без
пояснений в скобках. Пересечения — правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`):
совпадение пути; папка с `/` на конце пересекается с каждым файлом в ней. Внутри каждой Wave плана
общих файлов нет, каждый блокер — в Wave раньше. Файлы, которые Ticket 08 допишет при claim (риск 11),
в таблицу не вошли.
