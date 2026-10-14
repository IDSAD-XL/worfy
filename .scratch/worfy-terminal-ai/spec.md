# worfy-terminal-ai: Terminal AI в Terminal-ах worfy на подписке

Status: по решениям владельца 2026-10-09 (пункты 1–8 раздела «Решения владельца» решены владельцем
целиком); «Готово, когда», разбиение на Ticket-ы и раздел «Решено без владельца» — предложение этого
docs-PR, подтверждено владельцем 2026-10-09
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
набранное серым текстом, предлагает, что запустить дальше, пишет команду по просьбе словами и
исправляет упавшую. Платит подписка владельца, как за Session-ы. Ничего не запускается само:
команду запускает пользователь.

Epic готов, когда:

1. В Terminal-е на zsh серый Suggestion появляется сразу из истории команд, а если история молчит —
   от модели после паузы. → принимает его целиком, Option/Alt+→ — по словам, Esc скрывает. Его видят
   все экраны, где открыт этот Terminal. История пользователя (`~/.zsh_history`) пишется как раньше.
2. После команды на пустой строке появляется Next command. Строка `# …` + Enter и панель Cmd+I
   вставляют в строку команду по просьбе словами. После команды с ошибкой кнопка «Fix» вставляет
   исправленную. Сама ни одна команда не запускается.
3. Модель зовёт один общий процесс Claude Code на подписке — без MCP-серверов, tools, настроек
   пользователя и транскриптов; hooks встроенных plugin-ов Claude Code проверены. Его запросы видны в
   Limits. Автоматические функции выключаются сами выше 80 % окна 5 часов и при `allowed_warning` или
   `rejected`; функции по требованию работают до `rejected`.
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
  - Next command — после команды Sonnet (`effort: 'low'`) предлагает, что запустить дальше; в Settings
    можно выбрать Haiku (Ticket 05).
  - Command request — строка, которая начинается с `# `, и Enter, или панель над Terminal-ом по Cmd+I.
    Sonnet возвращает команду, она вставляется в строку (Ticket 06).
  - Fix — кнопка после команды с кодом выхода не 0. Sonnet получает команду и ~50 последних строк её
    вывода и возвращает исправленную (Ticket 07).
- **Shell integration** (решение 4, Ticket 01). worfy узнаёт границы команд, папку и код выхода из
  последовательностей OSC 633 — их печатает скрипт worfy, как скрипт VS Code
  (https://code.visualstudio.com/docs/terminal/shell-integration), но с nonce в каждой.
  - Скрипты подключаются, как в VS Code: `ZDOTDIR` shell-а указывает на временную папку worfy, а её
    `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin` подгружают одноимённые файлы пользователя.
    `~/.zshrc` не меняется.
  - `HISTFILE` — как в zsh без worfy: история пользователя (`$ZDOTDIR` пользователя или `HOME`), а не
    папка worfy, от которой его ставит `/etc/zshrc` macOS. `HISTFILE` из `.zshrc` пользователя
    главнее. Из `.zshenv` и `.zprofile` он и без worfy доживает только там, где системный zshrc его
    не задаёт (Linux): на macOS `/etc/zshrc` его перезаписывает.
  - Файлы папки пишутся заново при каждом старте Terminal-а: macOS чистит `$TMPDIR` от файлов, к
    которым не обращались три дня. Socket — в той же папке, путь не длиннее 103 байт.
  - Только zsh и только в Terminal Node-ах worfy (`TERM_PROGRAM=worfy`, `src/main/terminal/pty.ts:61`).
- **ZLE widget и socket** (решение 4, Ticket 03). ZLE — редактор строки zsh. Серый текст рисует сам
  zsh, как plugin zsh-autosuggestions: `POSTDISPLAY`, ответы асинхронно через `zle -F`. С main shell
  говорит через локальный socket (`zmodload zsh/net/socket; zsocket`): файл 0600, токен shell-а — в
  переменной окружения, которую скрипт читает и сразу убирает. Shell рисует и принимает серый текст
  сам, поэтому его видят все окна, где открыт этот shell
  ([ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md)).
- **Assist-процесс** (решение 5, Ticket 02, ADR-0058). Один процесс Claude Code через Agent SDK на все
  Terminal-ы. При старте: `settingSources: []`, без MCP, `tools: []`, `persistSession: false`. Стартует
  с первого запроса, без запросов ~10 минут выгружается. Каждый запрос самостоятельный: `claim()`
  заранее прогретого процесса (`prewarm()` SDK) с моделью и инструкцией функции, без общей истории
  (почему — ADR-0058, пункт 2). Это не Session: нет Node-а, Binding-а и транскрипта.
- **Модели** (решения 1 и 5). Suggestion — Haiku с выключенным thinking: с `effort: 'low'` Haiku
  думал до 54 с (spike). Next command, Command request и Fix — Sonnet с `effort: 'low'`: в 8 запросах
  spike-а он не думал, но выключить thinking у Sonnet 5.5 нельзя. Session-ам haiku по-прежнему нельзя
  (Ticket 07 Epic-а worfy-daily); assist-процесс — исключение, у него нет MCP-серверов и tools
  (ADR-0058).
- **Limits** (решение 2, Ticket 02). Каждое сообщение запроса assist-процесса идёт в
  `appLimits().recordSdkMessage` (`src/main/agent/limits.ts:96`) — как у Session-ов, чью фабрику
  оборачивает `appLimits().observe` (`src/main/agent/app-registry.ts:94`). Решение «можно ли спросить»
  — чистая функция от состояния Limits и времени, по образцу ожидания Autopilot
  (`src/main/autopilot/limits-wait.ts`). Автоматические функции спрашивают модель только после паузы
  и выключаются сами выше 80 % окна 5 часов и при `allowed_warning` или `rejected`; функции по
  требованию — только при `rejected`. Окно, чьё время сброса прошло, не считается.
- **Контекст и приватность** (решение 3). В модель уходят: текущая строка, папка, до 20 последних
  команд этого Terminal-а, ветка git, код выхода; хвост вывода (~50 строк) — только для Fix.
  - Переменные окружения — никогда.
  - Секреты заменяются до отправки (`src/shared/terminal-ai/redact.ts`, Ticket 02).
  - Пока идёт команда (между C и D: там пароли sudo и ssh) и на альтернативном экране (vim, less) —
    запросов нет. Пока команда идёт, ZLE не работает, так что widget не спрашивает; main проверяет
    это второй раз по состоянию Ticket-а 01.
  - Строка с пробелом в начале не уходит — соглашение `HIST_IGNORE_SPACE` zsh.
  - Последовательность OSC без nonce своего shell-а main не принимает: её могла напечатать программа.
- **Ничего не запускается само** (решение 1). Ответ попадает в строку ввода shell-а: в `BUFFER` zsh
  или серым текстом. Enter нажимает пользователь. У assist-процесса нет tools.
- **Пометки каналов IPC** — из `src/shared/ipc/channels.ts:20-34` (Ticket 08 Epic-а `worfy-link`) и
  [ADR-0052](../../docs/adr/0052-machines-and-linking.md), пункт 6: Linked machine может в Project-ах
  всё, кроме действий рабочего стола машины Project-а.
  - Settings и состояние Terminal AI (Ticket 02) — `local`: это состояние машины экрана, как Limits.
  - Command request из панели (Ticket 06) и Fix (Ticket 07) — `project`: они работают с Terminal-ом
    Project-а. С экрана Linked machine-а при включённом доступе они работают, как строка `# …`; модель
    спрашивает Machine, которой принадлежит Terminal, на своей подписке и со своими ограничениями по
    Limits (решение владельца 8(a)).
- **Settings → «Terminal AI»** (решение 2, Ticket 08). Окно Settings делает Ticket 02 Epic-а
  [worfy-ui](../worfy-ui/spec.md), общий Select для выбора модели — его Ticket 08. Ticket 08 этого Epic-а
  ждёт оба. До них переключатели хранятся (Ticket 02) и действуют, но окна для них нет. По умолчанию
  Terminal AI включён — все четыре функции (решение 8(b)).
- **test-ы без подписки** (решение 7). Unit- и contract-test-ы подставляют поддельный SDK. e2e идут с
  `WORFY_AGENT=fake` (`test/e2e/helpers.ts:139`): assist-процесс тогда — fake с ответами из файла, как
  черновик Profile-а (`src/main/ipc/projects.ts:117`). Под vitest настоящий путь бросает ошибку.
  Подписку тратит одна live-проверка владельца — Ticket 09.

## Этапы

1. **Основа** — 01, 02.
   - 01: shell integration для zsh — `ZDOTDIR` worfy, `HISTFILE` пользователя, OSC 633 с nonce,
     разбор в main: папка, код выхода, границы команд, последние команды, альтернативный экран.
   - 02: assist-процесс в main — прогрев, `claim()`, выгрузка, модели по функции, Limits, redaction,
     контекст, хранение Settings и каналы `terminalAi.*`, fake для test-ов.
2. **Shell** — 03: socket main ↔ zsh, протокол, ZLE widget, Suggestion из истории, приём →,
   Option/Alt+→, Esc.
3. **Функции и Settings** — 04, 05, 06, 07, 08.
   - 04: Suggestion от Haiku, когда история молчит.
   - 05: Next command.
   - 06: Command request — строка `# …` и панель Cmd+I.
   - 07: Fix.
   - 08: раздел «Terminal AI» окна Settings — когда влиты окно Settings и Select `worfy-ui` (его
     Ticket-ы 02 и 08).
4. **Приёмка** — 09: пять пунктов «Готово, когда», live-проверка владельца на подписке.
5. **После приёмки найдено** — 10: unit test «Paused by Limits» красный с 23:00 до 24:00 (найден
   2026-10-14, test Ticket-а 08); блокеров нет.

## Решения владельца

Решения владельца 2026-10-09. Ticket-ы ссылаются на номер пункта.

1. **Функции.**
   - (a) Suggestion во время набора — серый текст в строке: сразу из истории команд (локально, без
     модели); если история молчит — после паузы Haiku с выключенным thinking. Ответ может прийти
     через 1,5–5 с; если пользователь печатает дальше, запрос отменяется или ответ отбрасывается.
     → принимает целиком, Option/Alt+→ — по слову, Esc скрывает.
   - (b) Next command — после конца команды Sonnet (`effort: 'low'`) предлагает, что запустить
     дальше; переключатель в Settings даёт выбрать Haiku.
   - (c) Command request — строка, которая начинается с `# `, и Enter, или Cmd/Ctrl+I — маленькая
     панель над Terminal-ом. Sonnet возвращает команду, она вставляется в строку и никогда не
     запускается сама.
   - (d) Fix — кнопка «Fix» после команды с кодом выхода не 0. Sonnet получает команду и ~50
     последних строк вывода, возвращает исправленную; она вставляется и не запускается.
2. **Limits.** Автоматические функции (a) и (b) — Haiku или Sonnet в фоне и только после паузы. Они
   выключаются сами, когда окно 5 часов занято больше 80 % или статус `allowed_warning` или
   `rejected` (`LimitsTracker`, образец — `src/main/autopilot/limits-wait.ts`). Функции по
   требованию (c) и (d) доступны до `rejected`. Запросы кормят Limits worfy, как Session-ы. Всё
   выключается в Settings → «Terminal AI».
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
   Подписка, а не ключ API — решение владельца: личное использование своей подписки.
6. **Словарь** — Suggestion, Next command, Command request, Fix, Terminal AI в
   [CONTEXT.md](../../CONTEXT.md); Terminal AI — не Session агента.
7. **Порядок и проверка.** Epic идёт на Mac параллельно с Epic-ом `worfy-ui`. Ticket — на одного
   исполнителя. test-ы проверяются без расхода подписки: fake assist в unit-, contract- и e2e-test-ах;
   одна live-проверка владельца в конце.
8. **Ответы владельца на этот docs-PR** (2026-10-09).
   - (a) Панель Cmd/Ctrl+I и «Fix» работают и с экрана Linked machine-а: каналы `project`. Модель
     спрашивает Machine, которой принадлежит Terminal, — на своей подписке и со своими ограничениями
     по Limits.
   - (b) Terminal AI по умолчанию включён — все четыре функции, с ограничениями по Limits;
     выключается в Settings → «Terminal AI».

## Решено без владельца, подтверждено владельцем 2026-10-09

Выбрано в этом docs-PR, владелец подтвердил все пункты 2026-10-09:

1. **Как запросы остаются самостоятельными** — `claim()` заранее прогретого процесса; после ответа
   или отмены процесс закрывается и сразу прогревается следующий (ADR-0058, пункт 2). Не перезапуск
   одной streaming-Session. Цена — новый процесс Claude Code (~0,75 с прогрева) на каждый запрос и
   каждую отмену.
2. **Паузы и тайм-ауты** — Suggestion спрашивает модель через 600 ms без нажатий, Next command —
   через 800 ms на пустой строке после prompt-а. Ответ ждётся: Suggestion — 5 с, Next command — 8 с,
   Command request и Fix — 30 с. Ticket-ы 02, 04, 05 могут подвинуть числа по замеру; итог — в «Итог».
3. **Очередь** — в полёте один запрос; новый автоматический отменяет автоматический; запрос по
   требованию отменяет автоматический и сам не отменяется (Ticket 02).
4. **Settings хранятся на Machine**, а не в Project-е: `<WORFY_DATA_DIR>/terminal-ai.json` (Ticket 02).
5. **Ответ Command request и Fix заменяет строку целиком.** Владелец сказал «вставляется в строку»;
   для непустой строки выбрано «заменяет», а не «вставляет у курсора». Прежний текст строки уходит в
   модель как контекст; вернуть его — undo zsh (Ctrl+_).
6. **Suggestion от модели отменяется, если поток начался с thinking** или `claim()` не принял
   выключение thinking (ADR-0058, пункт 3).
7. **У пользователя уже есть zsh-autosuggestions** — свой Suggestion worfy не включает, остальные
   функции работают (Ticket 03). У владельца этого plugin-а нет.
8. **Settings «Suggestion»** выключает и Suggestion из истории, а не только модель. Отдельный
   переключатель «Ask Claude when history has nothing» выключает только модель.
9. **Ticket-ы 08 и 09 — `Status: blocked`.** 08 ждёт окно Settings `worfy-ui`: `Blocked by` держит
   только Ticket-ы своего Epic-а, поэтому ожидание записано в `Status`. 09 — шаги владельца на
   подписке, Autopilot его брать не должен (как Ticket 16 Epic-а `worfy-harness`).
10. **Устаревшие Limits.** Окно, чьё время сброса прошло, не считается. Окно без времени сброса —
    `allowed_warning` и `rejected` действуют час после получения. В момент сброса main сам
    пересчитывает состояние и шлёт `terminalAi.changed` (Ticket 02).
11. **Suggestion от модели — вся командная строка, а не хвост.** Серым показывается ответ без
    набранного. В spike-е два прогона просили вернуть только хвост: с просьбой в системном prompt-е
    Haiku потерял пробел перед новым словом в 6 ответах из 8, с просьбой в сообщении пользователя —
    сохранил во всех 7 нужных случаях.
    Вся строка снимает зависимость от формулировки prompt-а (Ticket 04).
12. **Панель Cmd+I — только у Terminal-а с интеграцией zsh.** В остальных Terminal-ах Cmd+I и Ctrl+I
    уходят в shell: в терминале Ctrl+I — это Tab. Поэтому Ticket 06 не ждёт Ticket 11 `worfy-windows`:
    Ctrl-ветка нужна, только когда Terminal AI появится на Windows.
13. **OSC 633 с nonce в каждой последовательности, OSC 133 не принимается.** У VS Code nonce несут E и
    служебные последовательности окружения, но не A–D; без nonce на D программа могла бы подделать
    конец команды (Ticket 01).

**Добавлено docs-PR `worfy-ui` (2026-10-09)** — правила порядка между Epic-ами, а не решения владельца:

- Ticket 08 ждёт не только окно Settings (Ticket 02 `worfy-ui`), но и общий Select (Ticket 08
  `worfy-ui`): им выбирается модель Next command.
- ⌘I в реестре сочетаний `src/shared/shortcuts.ts` (Ticket 11 `worfy-ui`). Решается в момент мержа:
  перед мержем Ticket 06 этого Epic-а или Ticket 11 `worfy-ui` перебазируется на свежий main; если
  другой уже там, этот вносит запись в том же PR. Кто вливается последним, тот отвечает за запись.
  Запись — только для Mac (на Windows записи нет: Ctrl+I остаётся Tab-ом оболочки), область —
  Terminal Node с интеграцией zsh, проверка в `TerminalNode.tsx` — через `matches` реестра. То же
  правило записано в Ticket-е 11 `worfy-ui`.

## Не в этом Epic-е

- **bash и fish** — позже (решение 4). В Terminal-е на другом shell-е Terminal AI не работает,
  Terminal ведёт себя как сейчас.
- **PowerShell на Windows** — позже, через предикторы PSReadLine (`ICommandPredictor`) (решение 4).
  Terminal на PowerShell делает Ticket 10 Epic-а `worfy-windows`. Там же — Ctrl+I для панели.
- **Ghost text поверх xterm, как в VS Code, и свой редактор строки, как в Warp** — отвергнуты
  (ADR-0058, Considered Options).
- **Ключ API** — отвергнут владельцем (ADR-0058, пункт 7).
- **Terminal AI внутри ssh, tmux и вложенного shell-а** — там нет скриптов worfy.
- **Terminal «Sign in with gh»** (`src/main/github/accounts.ts:219-224`) — без Terminal AI: там не
  shell.
- **Окно Settings и Select** — Ticket-ы 02 и 08 Epic-а [worfy-ui](../worfy-ui/spec.md); здесь только
  раздел «Terminal AI».

## Риски и открытые технические вопросы

1. **Thinking у моделей.** В Claude Code 2.1.289 `haiku` — это `claude-haiku-4-5-20251001`, и thinking у
   него выключается. Документация Claude Code говорит, что у моделей 5.5 thinking не выключается
   (https://code.claude.com/docs/en/costs). Переедет псевдоним — Suggestion от модели станет
   медленным, и запросы будут отменяться («Решено без владельца», пункт 6). `sonnet` — уже
   `claude-sonnet-5-5`: в spike-е он не думал на `effort: 'low'`, но гарантии нет; Next command
   держит тайм-аут 8 с. Ticket 02 пишет модель в лог; Ticket 09 проверяет вживую.
2. **Правила подписки — принятый риск.** Support-статья (2026-10-07) разрешает Agent SDK на лимитах
   подписки; объявленные ранее изменения в использовании Agent SDK там поставлены на паузу. Страница
   legal велит разработчикам продуктов на Agent SDK ключ API, и правила могут применить без предупреждения
   (ADR-0058, «Контекст» и пункт 7). Изменятся — Terminal AI выключается в Settings.
3. **Встроенные plugin-ы Claude Code** грузятся и при `settingSources: []` (evidence spike-а). Есть ли у
   них hooks на каждый запрос, не проверено — проверяют Ticket 02 (по `init`) и Ticket 09 (вживую).
4. **Assist-процесс и список Session-ов.** worfy показывает живые Session-ы по `~/.claude/sessions` и
   `cwd` (`src/main/claude-home/registry.ts`). `cwd` assist-процесса — папка worfy, не Project, поэтому
   на Canvas он не попадает. Пишет ли Claude Code с `persistSession: false` файл в `sessions/` — не
   проверено (Ticket 09).
5. **Esc в zsh** — начало последовательностей Alt. Привязка одного Esc ждёт `KEYTIMEOUT` (0,4 с по
   умолчанию), и серый текст скрывается с этой задержкой. Ticket 03 меряет. Мешает — предлагает
   другую клавишу владельцу.
6. **Option/Alt+→.** xterm.js 6.0.0 (версия worfy) шлёт `ESC [1;3C` на всех системах
   (`node_modules/@xterm/xterm/src/common/input/Keyboard.ts`, ветка правой стрелки). Widget
   привязывает ровно её; при обновлении xterm Ticket, который его обновляет, сверяет заново.
7. **Временная папка worfy.** У Unix socket на macOS поле пути — 104 байта, а `zsocket` zsh 5.9
   копирует не больше 103 (проверено ревью PR #202: Node слушает на 104 байтах, zsh не подключается).
   Поэтому путь socket-а — не длиннее 103 байт, папка — в `os.tmpdir()` (`/var/folders/…/T/`), не в
   папке данных worfy; не укладывается — `/tmp`. macOS (`dirhelper`) удаляет из `$TMPDIR` файлы, к
   которым не обращались больше трёх дней, а чтение zsh-ем время доступа не обновляет. Что именно
   `dirhelper` пропускает, Apple не описывает, поэтому Ticket 01 пишет папку и обёртки заново при
   каждом старте Terminal-а, а Ticket 03 пересоздаёт socket, если его файла нет.
8. **Нагрузка разбора вывода.** main разбирает каждый кусок вывода pty. Ticket 01 повторяет замер
   10 МБ Ticket-а 05 Epic-а `worfy-link` (там: 331 ms до последнего байта, p99 задержки event loop main
   12 ms) и сравнивает.
9. **Prompt-ы пользователя.** Prompt-фреймворки (starship, powerlevel10k) пересобирают `PS1` на каждом
   prompt-е — Ticket 01 дописывает A и B в своём `precmd`. Их собственные OSC 133 worfy не принимает.
   Конфликт обёрток `ZDOTDIR` с plugin manager-ами пользователя не проверялся: у владельца в
   `~/.zshrc` только nvm.
10. **e2e и настоящая история владельца.** e2e Terminal-а идут с настоящим `HOME`, и Suggestion из
    истории приходит и из `~/.zsh_history` владельца, а команды e2e туда дописываются. Команды в e2e
    — с уникальной меткой, чтобы история владельца не дала другой Suggestion. contract-test-ы ставят `HOME`
    во временную папку.
11. **Раздел Ticket-а 08 подключается файлом.** Окно Settings Ticket-а 02 `worfy-ui` само находит
    `src/renderer/settings/TerminalAiSection.tsx` с экспортами `order` и `title`; файлы окна Ticket 08
    не правит. Выбор модели — `Select` Ticket-а 08 `worfy-ui`.
12. **Общие файлы с другими Epic-ами** — раздел «Соглашения», пункт «Перед каждой Wave».
13. **Решения без владельца** — раздел выше; Ticket-ы делают по нему до ответа владельца.
14. **`epic-status` показывает этап `/implement` с первого дня:** Ticket-ы в `blocked` (08, 09) он
    считает работой. Работа при этом не начата.
15. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-link](../worfy-link/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух
темах, Autopilot над worfy — только на Stable copy, мерж по очереди. Отличия:

- **Кто ведёт** — Session на Mac владельца, параллельно с Epic-ом `worfy-ui` (решение 7).
- **Ticket-ы в `blocked`.** 08 — до Ticket-ов 02 и 08 `worfy-ui`: когда оба влиты, Orchestrator
  ставит 08 `Status: open`. 09 — шаги владельца: Autopilot его не берёт, `Status: open` ставит
  Orchestrator по слову владельца, когда 01–08 влиты.
- **Ветки** — `worfy-terminal-ai/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **ADR.** Номер ADR Ticket-у выдаёт Orchestrator в момент взятия: следующий свободный, по одному
  решению на файл. Принятые ADR не правятся: уточнение — новым ADR.
- **Подписку test-ы не тратят** (решение 7).
  - unit и contract — поддельный SDK, передаётся параметром;
  - e2e — `WORFY_AGENT=fake` из `launchApp`; ответы — файл `WORFY_TERMINAL_AI_ANSWERS`, который
    test пишет во временную папку; журнал запросов — `WORFY_TERMINAL_AI_LOG`. `test/e2e/helpers.ts`
    Ticket-ы этого Epic-а не правят;
  - под vitest настоящий путь бросает ошибку (Ticket 02);
  - live-проверка — только Ticket 09, владелец.
- **zsh в test-ах.** contract-test-ы с настоящим zsh идут и в Linux CI: там zsh ставится
  (`.github/workflows/ci.yml:41`). `HOME` и файлы пользователя — во временной папке. Настоящие
  `~/.zshrc` и `~/.zsh_history` contract-test-ы не трогают.
- **Файлы функций — свои.** Чтобы Ticket-ы Wave 3 не делили файлов (предложение Ticket-ов 01 и 03):
  - скрипты zsh функции — свой файл `src/main/terminal/zsh/rc.d/NN-<функция>.zsh`. Все `*.zsh` этой
    папки попадают в `ZDOTDIR` сами (glob, Ticket 01);
  - обработчик сообщения `ask` в main — свой файл `src/main/terminal-ai/features/<функция>.ts`. Их
    собирает glob Ticket-а 03, как `src/main/ipc/index.ts:62` собирает handler-ы IPC. Fix начинается
    не с `ask`, а с канала IPC, поэтому его файл — `src/main/terminal-ai/fix.ts`;
  - каналы IPC — свой домен: `src/shared/ipc/terminal-ai-<функция>.ts` и
    `src/main/ipc/terminal-ai-<функция>.ts` (ADR-0006: handler-ы подхватываются сами); имена событий —
    `<домен>.changed`, как `link.changed` и `projects.settings.changed`;
  - e2e — свой spec-файл `test/e2e/terminal-ai-<функция>.spec.ts`.
- **Пометка нового канала IPC** — по `src/shared/ipc/channels.ts:20-34`: Settings и состояние —
  `local`, работа с Terminal-ом Project-а — `project` (раздел «Как устроено»).
- **Перед каждой Wave — открытые PR других Epic-ов.** Их файлы сравниваются с «Где в коде» Ticket-ов
  Wave тем же правилом, что внутри Wave (`filesOverlap`). Ticket с общим файлом ждёт мержа того PR.
  Пересечение и отложенный Ticket — в отчёте Wave. На 2026-10-09:
  - Ticket 10 `worfy-windows` (Terminal на PowerShell; открыт, PR нет) правит
    `src/main/terminal/pty.ts` и `src/main/ipc/terminal.ts` — общие с Ticket-ом 01. Кто вливается
    вторым, перебазируется и проверяет оба поведения: zsh с интеграцией, PowerShell без неё.
    Интеграция включается по запускаемому файлу shell-а, без веток по платформе, поэтому PR этого
    Epic-а — не платформенные (ADR-0056, пункт 2). Если Ticket-у понадобится ветка по платформе —
    его PR платформенный, с gate full на Windows-ПК владельца.
  - Ticket 11 `worfy-windows` (Ctrl вместо ⌘; открыт) создаёт `src/renderer/platform.ts`. Ticket 06 его
    не правит и не ждёт: если файл к claim на main — берёт из него проверку ⌘ и подпись, иначе
    `metaKey` («Решено без владельца», пункт 12).
  - PR #200 (`worfy-windows/08`, открыт) правит `src/main/agent/env.ts`, `src/main/agent/limits.ts`,
    `src/main/agent/options.ts`, `src/shared/agent/limits.ts`, `src/main/storage/paths.ts` и
    `src/main/claude-home/registry.ts`. Ticket 02 их только читает (`agentEnv`, `appLimits`,
    `claudeExecutablePath`, тип `LimitsState`, `dataRoot`, правило `cwd` Session-а): общих файлов в
    «Где в коде» нет. 02 перечитывает их на свежем main при claim.
  - Epic [worfy-ui](../worfy-ui/spec.md): Ticket 08 ждёт его Ticket-ы 02 (окно Settings) и 08 (Select).
    Его Ticket 11 (реестр сочетаний) правит `src/renderer/canvas/nodes/TerminalNode.tsx` и
    `TerminalAiRequest.tsx`, если Ticket 06 этого Epic-а к его мержу уже в main (примечание docs-PR
    `worfy-ui` после «Решено без владельца», ⌘I в реестре): сверка перед Wave 3 и 4 (Ticket-ы 06,
    07).
  - PR #197 (Epic `worfy-review`, документы) и PR #201 (`test/e2e/epic-frame.spec.ts`) влиты; общих
    файлов с Ticket-ами этого Epic-а у них не было.
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
| 06 | `src/main/terminal-ai/features/command-request.ts`, `src/main/terminal/zsh/rc.d/40-command-request.zsh`, `src/shared/ipc/terminal-ai-request.ts`, `src/main/ipc/terminal-ai-request.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.css`, `src/renderer/canvas/nodes/TerminalAiRequest.tsx`, `src/shared/shortcuts.ts`, `test/contract/terminal-ai-request.test.ts`, `test/unit/terminal-ai-request.test.tsx`, `test/e2e/terminal-ai-request.spec.ts` | 3 |
| 07 | `src/main/terminal-ai/fix.ts`, `src/shared/terminal-ai/output-tail.ts`, `src/shared/ipc/terminal-ai-fix.ts`, `src/main/ipc/terminal-ai-fix.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `src/renderer/canvas/nodes/TerminalNode.css`, `test/unit/terminal-ai-output-tail.test.ts`, `test/unit/terminal-ai-fix-button.test.tsx`, `test/contract/terminal-ai-fix.test.ts`, `test/e2e/terminal-ai-fix.spec.ts` | 4 |
| 08 | `src/renderer/settings/TerminalAiSection.tsx`, `test/unit/terminal-ai-settings.test.tsx`, `test/e2e/terminal-ai-settings.spec.ts` | 3 |
| 09 | `.scratch/worfy-terminal-ai/spec.md`, `.scratch/worfy-terminal-ai/evidence/09-live-проверка.md` | 5 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01 и 02.** Блокеров нет. Общих файлов нет: 01 — `src/main/terminal/`,
  `src/main/ipc/terminal.ts`; 02 — новые папки `src/main/terminal-ai/` и `src/shared/terminal-ai/`,
  домен IPC `terminal-ai`.
- **Wave 2 — 03, один.** Ждёт 01 и 02.
- **Wave 3 — 04, 05, 06 и 08.** Все ждут 02 и 03. Общих файлов нет: у 04–06 свои `rc.d/*.zsh`,
  `features/*.ts` и test-ы; 06 ещё панель в `TerminalNode.tsx` и домен IPC `terminal-ai-request`; 08 —
  раздел окна Settings. 08 при этом `blocked` до Ticket-ов 02 и 08 `worfy-ui`: не влиты к Wave 3 — 08
  уходит в более позднюю Wave.
- **Wave 4 — 07, один.** Ждёт 02 и 03; по блокерам — Wave 3, сдвинут (ниже).
- **Wave 5 — 09, один.** Ждёт все остальные Ticket-ы. Лежит в `blocked`: Autopilot его не берёт,
  открывает Orchestrator по слову владельца. Отмечает пункты «Готово, когда» в этом файле.

Сдвиги из-за общих файлов:

- **07: Wave 3 → 4.** С 06 общие `src/renderer/canvas/nodes/TerminalNode.tsx` и
  `src/renderer/canvas/nodes/TerminalNode.css`.

Таблица собрана скриптом. Файлы — текст в обратных кавычках пунктов списка «Где в коде», без
пояснений в скобках. Пересечения — правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`):
совпадение пути; папка с `/` на конце пересекается с каждым файлом в ней. Внутри каждой Wave плана
общих файлов нет, каждый блокер — в Wave раньше. Файлы, которые Ticket 08 допишет при claim (риск 11),
в таблицу не вошли.
