# Terminal

> Перевод [английской версии](../terminal.md), commit `same-pr`.

Два Feature. **Terminal** — Node с интерактивным shell-ом пользователя. **Terminal AI** — помощь модели Claude в строке
ввода этого shell-а. Термины объяснены в [Concepts](concepts.md).

## Terminal

### Behaviour

Terminal — это Node на Canvas с настоящим shell-ом внутри. Он для пользователя: агенты им не пользуются.

**Создание и закрытие.** «New terminal» в контекстном меню Canvas создаёт Node. Размер по умолчанию — 560 на 340 пикселей.
Shell стартует в корневой папке Project-а, на macOS с окружением login shell-а пользователя. Другую папку для старта выбрать
нельзя, и у каждого Node-а ровно один shell. Кнопка закрытия в заголовке или любой другой способ убрать Node с Canvas завершает
shell. У заблокированного Node-а кнопки закрытия нет.

**Какой shell.** На macOS это `$SHELL -l` или `/bin/zsh -l`, если переменная не задана. Заголовок показывает имя файла
shell-а, например `zsh`.

**Shell живёт дольше своего view.** Shell продолжает работать, когда Node уходит из поля зрения, когда Canvas скрыт за
Session view и когда окно перезагружается. Следующий view перерисовывает вывод, который сохранил main: последние 256 КБ, с
теми размерами терминала, при которых вывод пришёл. Сам view хранит 5000 строк scrollback.

Shell завершается в таких случаях:

- Node уходит из Layout любым путём.
- Project уходит из списка.
- Закрывается последнее окно или соединение, которое открыло shell.
- worfy завершается. Выход ждёт, пока завершатся все shell-ы, но не больше 3 секунд.

После перезапуска worfy Node запускает новый shell в той же папке. Старого вывода уже нет.

**Состояния.** Заголовок показывает такие состояния:

- У shell-а, который запускается или работает, отметки о выходе нет.
- Shell, который вышел сам, остаётся завершённым, в том числе после перезагрузки окна. Заголовок показывает `exit <код>` и
  кнопку Restart, последний вывод остаётся на экране. Новый shell не запустится, пока пользователь не нажмёт Restart.
- Shell, который не смог запуститься, показывает «The terminal could not start» с причиной.

**Один shell на нескольких экранах.** Один shell могут открыть несколько окон и Linked machine с доступом на запись. Каждый
из них получает весь вывод и может печатать. Размер у shell-а один: размер экрана, который последним печатал или кликал в
нём. Изменение размера view на другом экране только запоминается, пока этот экран не начнёт печатать или не кликнет. Restart
на одном экране запускает новый shell для всех.

Focus mode показывает тот же shell во втором view того же окна. Размер задаёт view, смонтированный последним, а выход из
focus mode возвращает shell-у размер Node-а на Canvas.

Linked machine с доступом только на чтение Terminal не получает. Заместитель в Node-е сообщает, что вывод с ней не
разделяется. Запустить shell она не может, и вывод не покидает Machine.

**Ввод и Canvas.** Размер терминала ограничен: 20–500 колонок и 5–300 строк. Выделение мышью попадает на нужные символы при
любом масштабе Canvas, а перетаскивание, начатое в одном Terminal-е, остаётся в нём. Колесо над Terminal-ом двигает Canvas,
пока Node не активен, то есть пока на нём не кликнули и он не остался выделенным. В активном Terminal-е колесо идёт в
xterm.js, эмулятор терминала во view. Pinch и ⌘ + колесо всегда масштабируют Canvas. Esc внутри Terminal-а принадлежит shell-у
и не снимает выделение с Node-а.

Цвета следуют светлому или тёмному оформлению системы, новый терминал для этого не нужен.

**Набранная команда.** Проверки First run могут открыть Terminal с `gh auth login` для входа в GitHub. main печатает команду
в новый shell после его первого вывода или после секунды тишины. Принимаются только команды из фиксированного списка, в
списке одна эта команда, а при подключении к уже работающему shell-у ничего не печатается.

#### Windows

- Shell — PowerShell: `pwsh.exe` из Path, в том числе установленный через MSIX, иначе Windows PowerShell. `cmd.exe` не
  используется никогда, `$SHELL` не читается.
- Login shell не читается, потому что на Windows его нет. Shell стартует с окружением, собранным из переменных сессии Windows и
  registry.
- В «Project settings…» есть поле «Terminal shell» с PowerShell и Git Bash. Выбор действует на следующий shell: Restart или
  новый Node. Если Git Bash не найден, поле об этом говорит, и запускается PowerShell. Настройки, которые не удалось прочитать,
  тоже дают PowerShell.
- Внутри Terminal-а сочетания worfy с Ctrl не срабатывают, поэтому Ctrl+K, Ctrl+F и Ctrl+C доходят до shell-а. Исключение —
  масштаб Canvas: Ctrl+= и Ctrl+- по-прежнему масштабируют, и только Ctrl+\_ остаётся за shell-ом. На macOS ничего не
  уступается, потому что сочетания worfy идут на ⌘.
- Закрытие Node-а завершает все процессы под shell-ом, в том числе запущенный через `Start-Process` и запущенный двумя
  уровнями ниже, а затем сам shell. Git Bash сначала получает SIGHUP, поэтому bash записывает историю.
- Выход из worfy ждёт не больше 6 секунд.
- Вывод, который приходит после выхода shell-а, отбрасывается. На macOS он сохраняется и показывается.

### How it works

- **Shell принадлежит main, view его только рисует.** Поэтому shell переживает перемонтирование, и поэтому один shell могут
  показывать несколько экранов ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)). Renderer называет Project и
  Node, но никогда папку или программу: main запускает shell только для Node-а вида `terminal` из Layout этого Project-а.
- **У вывода есть счётчик длины.** Каждый кусок несёт `end`, длину всего вывода на этот момент. Ответ на открытие несёт `end`
  своего replay, поэтому view отбрасывает то, что у него уже есть.
- **Окружение** — то же, что и у Session-ов, на macOS это окружение login shell-а
  ([ADR-0007](../../adr/0007-claude-code-launch-environment.md)), плюс `TERM`, `COLORTERM`, `TERM_PROGRAM=worfy` и `PWD`, а на
  macOS ещё `LANG`, если он не задан.
- **На вопросы программы к терминалу отвечают один раз.** Программы спрашивают у терминала позицию курсора, атрибуты
  устройства, режим или настройку и ждут ответа. View смонтирован не всегда, а два view ответили бы дважды. Поэтому main
  следит за выводом на собственном headless-экране и отвечает на эти запросы сам. Такие же ответы от view отбрасываются. Запрос
  цвета остаётся за view, потому что ответ зависит от их темы: main пропускает первый ответ, а если view не смонтирован, такой
  запрос остаётся без ответа.
- **Поток вывода не может остановить main.** Headless-экраны разбирают вывод в worker thread-ах. Когда экран слишком отстаёт,
  main приостанавливает вывод этого shell-а, пока экран не догонит.
- **Shell integration, только для zsh.** У zsh, запущенного для Terminal Node, `ZDOTDIR` указывает на временную папку worfy.
  Файлы в ней читают собственные startup-файлы пользователя, не меняя их, а затем загружают скрипт worfy. Скрипт печатает
  последовательности OSC 633, формат shell integration из VS Code, которые сообщают, где prompt, какая команда идёт, в какой
  папке и чем закончилась. В отличие от VS Code, каждая последовательность несёт nonce, которого программы в shell-е не знают,
  поэтому они не могут подделать конец команды. У строки, начатой с пробела, текст команды не передаётся. История остаётся в файле
  пользователя, а zsh, запущенный внутри Terminal-а, работает без worfy. Остальные shell-ы идут без integration.

#### Windows

Shell идёт на консоли из пакета node-pty, а не на консоли системы
([ADR-0063](../../adr/0063-windows-shells-run-on-the-node-pty-console.md)). При старте shell-а эта консоль запрашивает атрибуты
устройства. main отвечает один раз и убирает запрос из вывода до того, как вывод сохранён или отправлен на экран. PowerShell
после resize рисует свою строку в абсолютных позициях, поэтому новый view пишет сохранённый вывод с resize-ами на их местах. У
Windows нет групп процессов и SIGHUP, поэтому закрытие запускает helper, который завершает всё под shell-ом, а затем закрывает
pseudo-console. Если shell не сообщил о выходе за 5 секунд, Terminal закрывается без этого сообщения. Почему PowerShell по
умолчанию: [ADR-0054](../../adr/0054-full-windows-port.md).

На Windows нет login shell-а, у которого можно спросить окружение, поэтому worfy собирает его так же, как новый вход в систему:
постоянные переменные машины и пользователя из registry поверх короткого списка переменных, которые Windows задаёт для сессии
([ADR-0057](../../adr/0057-agent-environment-on-windows.md)). Больше ничего от процесса, запустившего worfy, до shell-а не доходит.

### Implementation

| Что | Где |
|---|---|
| IPC-контракт домена `terminal` | `src/shared/ipc/terminal.ts` |
| Handler-ы и то, что завершает shell (Layout, Project-ы, выход) | `src/main/ipc/terminal.ts` |
| Registry shell-ов: старт, подписчики, размер, закрытие | `src/main/terminal/pty.ts` |
| Окружение, общее с Session-ами | `src/main/agent/env.ts` |
| node-pty на Windows и helper, завершающий процессы | `src/main/terminal/windows-pty.ts` |
| Сохранённый вывод и его размеры | `src/main/terminal/replay-buffer.ts` |
| Ответы на запросы программы | `src/main/terminal/cursor-answers.ts`, `src/shared/terminal/cursor-answer.ts` |
| Собственный запрос консоли на Windows | `src/main/terminal/console-request.ts` |
| Чтение OSC 633 и alternate screen | `src/main/terminal/osc.ts` |
| Папка `ZDOTDIR` worfy | `src/main/terminal/shell-integration.ts` |
| Скрипты zsh | `src/main/terminal/zsh` |
| Node: xterm.js, статус, заголовок | `src/renderer/canvas/nodes/TerminalNode.tsx` |
| Запись replay; два view; мышь при масштабе; alternate screen | `src/renderer/canvas/nodes/terminal-replay.ts`, `src/renderer/canvas/nodes/terminal-views.ts`, `src/renderer/canvas/nodes/terminal-mouse.ts`, `src/renderer/canvas/nodes/terminal-alt-buffer.ts` |
| Отличие набора от ответа терминала | `src/renderer/canvas/nodes/terminal-user-input.ts` |
| Заместитель для доступа только на чтение | `src/renderer/canvas/ReadOnlyTerminal.tsx` |
| Настройка shell-а в Project-е | `src/renderer/shell/ProjectSettings.tsx`, `src/shared/projects/action-templates.ts` |
| Клавиши shell-а на Windows | `src/renderer/platform.ts`, `src/renderer/shortcuts/match.ts`, `src/shared/shortcuts.ts` |

**Поток данных.** Node вызывает `terminal.open` со своим Project-ом, id Node-а и размером. `TerminalRegistry` запускает shell или
подключает вызвавшего как подписчика и отвечает replay, `end` и размерами. Дальше каждый кусок от node-pty registry добавляет в
`ReplayBuffer`, отправляет как `terminal.output` каждому подписчику, передаёт в `ShellTracker` для zsh с integration, а затем
отправляет на headless-экран. Набор и вставка идут обратно по `terminal.input`, клик — по `terminal.takeSize`. Ответ xterm.js
программе идёт по `terminal.input` с пометкой `reply`, и размер он не забирает.

Диалог «Sign in with gh» на шаге аккаунта использует тот же класс registry с самим `gh` в качестве процесса, без shell-а и без
integration. Этот registry находится в `src/main/github/accounts.ts`, диалог — в `src/renderer/projects/GithubAccount.tsx`, а его
handler-ы и экземпляр registry — в `src/main/ipc/projects.ts`.

**Главные test-ы.**

- `test/e2e/terminal.spec.ts`: весь Feature в приложении, в том числе несколько окон, масштаб, перезапуск и собранное приложение.
- `test/contract/terminal.test.ts`: каналы на настоящем pty, правило размера и связь с Layout, Project-ами и выходом.
- `test/contract/terminal-shell-integration.test.ts`: startup-файлы, история, nonce, отсутствие integration в других местах.
- `test/contract/terminal-cursor.test.ts`, `test/unit/terminal-replies.test.tsx`: ответы программам, запросы цвета, большие потоки вывода.
- `test/unit/terminal-osc.test.ts`, `test/unit/terminal-replay.test.ts`: разбор последовательностей и replay.
- `test/contract/link-access.test.ts`, `test/e2e/linked-read-only.spec.ts`: доступ Linked machine.
- Windows: `test/contract/terminal-windows.test.ts`, `test/contract/terminal-git-bash-close.test.ts`,
  `test/unit/terminal-shell.test.ts`, `test/unit/terminal-console.test.ts`, `test/unit/console-request.test.ts`,
  `test/unit/terminal-git-bash-close.test.ts`.

## Terminal AI

### Behaviour

Terminal AI предлагает текст для строки ввода Terminal-а с zsh. Команду он никогда не запускает: Enter остаётся за пользователем.
У него четыре функции, у каждой свой переключатель в Settings. В вывод Terminal-а он никогда не печатает: серый текст рисует
редактор строки zsh.

**Suggestion.** Серый текст после курсора, продолжающий строку. Источника два:

- **История команд.** При каждом изменении строки zsh ищет последнюю команду, которая начинается с набранного текста. Процесс
  не запускается, worfy не спрашивается. Тот же серый текст виден на каждом экране этого shell-а.
- **Модель.** Если в истории ничего нет и строка не меняется 600 мс, спрашивается модель. Её ответ показывается, только если
  начинается с набранного. Набор отменяет вопрос, а опоздавший ответ не показывается.

Модель не спрашивают о пустой строке, о строке с пробелом в начале, о строке, начатой с `# `, о строке, которую вставил worfy, и о
строке, взятой из Suggestion, пока пользователь её не изменит.

| Клавиша | Действие |
|---|---|
| → в конце строки | Берёт весь Suggestion. В другом месте строки двигает курсор, как обычно. |
| Alt+→ | Берёт одно слово. Без Suggestion двигает на слово вперёд. |
| Esc | Скрывает серый текст до изменения строки, затем делает то, что Esc делал раньше (в раскладке vi выходит из режима вставки). |

Если набрать начало серого текста, остаток остаётся серым. Если у пользователя загружен zsh-autosuggestions, worfy не рисует
свой Suggestion и не спрашивает модель. Остальные функции работают как обычно.

**Next command.** На первом prompt-е после команды, пока строка пуста, модель серым предлагает следующую команду после паузы в
800 мс. Набор во время паузы или до ответа отменяет вопрос. → берёт ответ. Enter на пустой строке ничего не запускает, потому что
серый текст не часть строки. Ничего не спрашивается на первом prompt-е shell-а, после пустой строки или Ctrl+C, после команды,
начатой с пробела, и на prompt-е, где в строке уже есть текст.

**Command request.** Просьба словами, ответ — команда в строке ввода. Попросить можно двумя способами:

- Набрать `# ` и слова и нажать Enter. Строка не запускается и в историю не попадает. Появляется серое «asking Claude…», а
  любая клавиша до ответа отменяет запрос и оставляет строку. `#comment` без пробела и `# ` без слов — обычные строки.
- На экране macOS нажать ⌘I в Terminal-е. Под первой строкой экрана открывается панель. Enter спрашивает. Когда команда оказалась в
  строке, панель закрывается и фокус возвращается в терминал. Esc закрывает панель, и фокус возвращается так же. При отказе, в занятом
  Terminal-е или с пустым полем панель остаётся открытой и фокус остаётся в её поле. Панель отправляет ещё и строку, набранную в
  shell-е, прочитав её с экрана. Когда панель недоступна (нет zsh, подключённого к Terminal AI, или Command request выключен), ⌘I
  остаётся у xterm.js и shell не получает ничего. Ctrl+I доходит до shell-а всегда: в терминале это Tab.

Отказ — короткая заметка в строке или в панели. Fix показывает те же тексты в своём toast-е:

| Заметка | Причина |
|---|---|
| Limits reached until 14:20 | Limits отвергают запрос. Другой день называется. |
| Terminal AI is off | Функция выключена в Settings. |
| Terminal is busy | Идёт команда, или полноэкранная программа занимает Terminal. |
| Claude did not answer in time | Истекли 30 секунд. |
| Claude had no command for that | Ответ оказался пустым. |
| Claude could not answer | Любой другой сбой. |
| The shell is not ready yet | Shell ещё не сообщил свою папку. |

**Fix.** После команды с exit code не 0 в заголовке Node-а появляется кнопка Fix, пока zsh подключён к Terminal AI и Fix включён в
Settings. Она остаётся, пока не начнётся новая команда. Команда, начатая с пробела, кнопку не вызывает. Нажатие запрашивает
исправленную команду и ставит её в строку. Фокус возвращается в терминал, так что Enter её запускает, а кнопка исчезает на всех
экранах. Пока идёт запрос, на кнопке написано «Fixing…». Отказ показывается в error toast-е с именем Terminal-а, пока его не
закроют или пока кнопку не нажмут снова.

**Settings.** Раздел «Terminal AI» относится к Machine, поэтому действует на все её Project-ы.

| Переключатель | По умолчанию | Примечание |
|---|---|---|
| Terminal AI | вкл. | Все функции. Строки под ним пишут «Off while Terminal AI is off.» |
| Suggestion | вкл. | Выключает и Suggestion из истории. |
| Ask Claude when history has nothing | вкл. | Только модель за Suggestion. |
| Next command | вкл. | |
| Next command model | Sonnet | Sonnet или Haiku. |
| Command request | вкл. | |
| Fix | вкл. | |

Изменение сразу доходит до работающих shell-ов: выключенный Suggestion убирает серый текст из уже работающего zsh.

**Limits.** О каждом запросе узнаёт счётчик Limits. Terminal AI останавливается сам и снова включается без нового запроса, когда
окно сбрасывается:

- Suggestion и Next command останавливаются, пока окно 5 часов занято больше чем на 80 % или у любого действующего окна статус
  `allowed_warning` или `rejected`. Останавливаются они молча, а Suggestion из истории продолжает работать.
- Command request и Fix останавливаются только на `rejected`.

Окно, время сброса которого прошло, не считается, а неизвестные Limits пропускают всё. Строка в Settings показывает
«Paused by Limits until 14:20» для остановленной функции.

**Что получает модель.**

- Строку, папку, до 20 последних команд этого Terminal-а, ветку git и exit code последней команды.
- Для Command request ещё и слова. Для Fix до 50 последних строк вывода упавшей команды.
- Никогда не получает переменные окружения, а вывод — только для Fix.

Каждое поле обрезается, а секреты известных форм заменяются на `[redacted]`: token-ы и ключи, пароли в опциях и URL, значения
переменных, имя которых говорит о секрете, блоки приватных ключей. Строка или команда с пробелом в начале в контекст не попадает.
Пока идёт команда (то, что набирается в это время, может быть паролем) или полноэкранная программа занимает Terminal, ничего не
отправляется. Log называет каждый старт процесса, а также функцию и модель каждого запроса. Слов, строки, контекста и ответа в нём
никогда нет.

**Linked machine.** Настройки и состояние локальны для каждой Machine, Linked machine до них не дотягивается. С экрана Linked
machine с доступом на запись Fix работает на любой системе, а панель только на экране macOS, потому что ⌘I — это клавиша экрана.
Модель спрашивает Machine этого Terminal-а, на своей подписке и в своих Limits.

#### Windows

Terminal, Machine которого работает на Windows, никогда не бывает zsh, поэтому ни одна функция в нём не работает. Раздел Settings всё
равно показан, с пояснением «Works in zsh Terminals.» С экрана Windows в Terminal-е Mac-а работают Suggestion, Next command, строка
`# ` и Fix. Не работает только панель, потому что сочетание ⌘I есть только на macOS.

### How it works

- **Это не Session.** Запросы идут в отдельный процесс Claude Code через Agent SDK. У него нет настроек пользователя и Project-а,
  MCP-серверов, tools и транскрипта, и он делает один ход, так что модель может ответить только текстом. Вход — по подписке, без
  ключей API. Каждый запрос идёт в пустой папке внутри папки данных worfy, потому что процесс с папкой внутри Project-а worfy
  считает Session-ом этого Project-а. Причины: [ADR-0058](../../adr/0058-terminal-ai-assist-process.md).
- **Один процесс на все Terminal-ы, один запрос на процесс.** Первый запрос запускает запасной процесс. Запрос занимает его на один
  ход, затем процесс закрывается и сразу стартует следующий запасной. Запасной процесс без запросов 10 минут закрывается. Запрос не
  несёт истории, поэтому в запросе одного Project-а нет команд другого.
- **Один запрос в полёте.** Suggestion и Next command автоматические: новый автоматический запрос отменяет автоматический. Command
  request и Fix идут по требованию: они отменяют автоматический и автоматическим не отменяются. Второй запрос по требованию ждёт, а
  автоматический в это время получает отказ.

| Функция | Модель | Предел времени |
|---|---|---|
| Suggestion | Haiku, без thinking | 5 с |
| Next command | Sonnet при low effort или Haiku по Settings | 8 с |
| Command request | Sonnet при low effort | 30 с |
| Fix | Sonnet при low effort | 30 с |

- **Suggestion, который опоздал бы, отбрасывается.** Запрос заканчивается, когда модель начинает думать или когда процесс не смог
  применить настройку, выключающую thinking.
- **Процесс отказал.** Если процесс отказал в запросе до отправки prompt-а, Command request и Fix пробуют ещё раз через новый
  процесс, а Suggestion и Next command сдаются.
- **Ответ — одна команда.** Берётся его первая строка, без backticks, блока кода и prompt-а `$ `.
- **Клиент — сам shell.** Строку редактирует zsh, поэтому main её не видит. Widget-ы zsh отправляют её в main через Unix socket, по
  сообщению на строку, а main отвечает текстом для показа или строкой для вставки. Серый текст zsh рисует сам, и Terminal AI ничего
  не пишет в pty. Fix и панель начинаются с IPC-канала, а не с сообщения shell-а, и заканчиваются такой же вставкой. Строку меняет
  только `insert`, и Enter никто не нажимает.
- **Связь существует только пока редактируется строка.** zsh не может закрыть дескриптор для программ, которые запускает. Поэтому перед
  командой shell говорит `bye` и закрывает соединение, а на следующем prompt-е снова говорит `hello`. main тоже закрывает свою сторону.
  То же самое происходит вокруг функций, которые написал не worfy и которые идут в prompt-е, например widget-а пользователя. Открытый
  вопрос затем отправляется заново с тем же id, а main всё это время держит его открытым.
- **Доступ к socket.** Файл с правами 0600 лежит в папке 0700. Каждый shell получает свой token, и соединение без живого и неиспользуемого
  token-а закрывается. Token лежит в неэкспортированной переменной shell-а, поэтому ни одна программа его не видит.
- **Без socket** shell всё равно запускается, а Suggestion из истории продолжает работать.

### Implementation

| Что | Где |
|---|---|
| Модель: процесс, очередь, отказы | `src/main/terminal-ai/assist.ts` |
| Что идёт в SDK | `src/main/terminal-ai/options.ts` |
| Правило Limits | `src/main/terminal-ai/limits-gate.ts` |
| Файл настроек, `terminal-ai.json` в папке данных | `src/main/terminal-ai/settings.ts`, `src/shared/terminal-ai/settings.ts` |
| Контекст, redaction, хвост вывода | `src/shared/terminal-ai/context.ts`, `src/shared/terminal-ai/redact.ts`, `src/shared/terminal-ai/output-tail.ts` |
| Состояние shell-а в запрос | `src/main/terminal-ai/input.ts` |
| Ветка git: из `HEAD` и только потом от git | `src/main/terminal-ai/git-branch.ts` |
| Socket и его token-ы | `src/main/terminal-ai/socket.ts` |
| Сообщения | `src/main/terminal-ai/protocol.ts` |
| Передача вопроса функции | `src/main/terminal-ai/shell-link.ts` |
| Handler-ы Suggestion, Next command, Command request | `src/main/terminal-ai/features` |
| Fix | `src/main/terminal-ai/fix.ts`, `src/main/ipc/terminal-ai-fix.ts`, `src/shared/ipc/terminal-ai-fix.ts` |
| Панель ⌘I | `src/renderer/canvas/nodes/TerminalAiRequest.tsx`, `src/main/ipc/terminal-ai-request.ts`, `src/shared/ipc/terminal-ai-request.ts` |
| Чтение набранной строки с экрана | `src/renderer/canvas/nodes/terminal-line.ts` |
| Раздел Settings | `src/renderer/settings/TerminalAiSection.tsx`, `src/renderer/settings/useTerminalAi.ts`, `src/main/ipc/terminal-ai.ts`, `src/shared/ipc/terminal-ai.ts` |
| Связь и серый текст в zsh | `src/main/terminal/zsh/rc.d/10-assist.zsh` |
| Suggestion, Next command и Command request в zsh | `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`, `src/main/terminal/zsh/rc.d/30-next-command.zsh`, `src/main/terminal/zsh/rc.d/40-command-request.zsh` |
| Fake backend для test-ов | `src/main/terminal-ai/fake-backend.ts` |

Новая функция, о которой спрашивает shell, добавляет свой переключатель в настройках, свой предел времени, prompt и title в
`src/main/terminal-ai/options.ts`, модуль в `src/main/terminal-ai/features` и скрипт в `src/main/terminal/zsh/rc.d`. Модуль и скрипт
находятся через glob, поэтому `ShellLink` и startup-файлы не меняются.

**Поток данных Suggestion от модели.** `20-suggest-ai.zsh` ждёт паузу и отправляет `ask <id> suggest <line>`. `ShellLink` передаёт его
handler-у `suggest`, который строит input из `ShellState` и вызывает `AssistService.request`. Сервис проверяет отказы, берёт запасной
процесс, находит ветку, выполняет `prepareContext` и занимает процесс. Ответ возвращается как `show <id> <text>`, и `10-assist.zsh` рисует
его, если этот вопрос ещё открыт.

**Поток данных Fix.** `FailedCommands` хранит упавшую команду каждого Terminal-а по событиям shell-а. `terminalAi.fix.state` и
`terminalAi.fix.changed` сообщают Node-у, есть ли кнопка. `terminalAi.fix.run` вызывает `runFix`, и ответ идёт в shell как `insert`. Ответ,
пришедший после старта новой команды, отбрасывается.

**Каналы.** `terminalAi.state`, `terminalAi.setSettings` и `terminalAi.changed` — `local`. Каналы `terminalAi.fix.*` и
`terminalAi.request*` — `project`, поэтому работают с Terminal-ом Project-а.

**Test-ы без Claude.** С `WORFY_AGENT=fake` приложение берёт файловый fake и не загружает SDK. Под vitest настоящий backend бросает ошибку
до загрузки SDK, поэтому test никогда не тратит подписку.

**Главные test-ы.**

- `test/contract/terminal-ai-assist.test.ts`: процесс, очередь, timeout-ы, отказы, Limits и каналы.
- `test/contract/terminal-ai-zle.test.ts`, `test/contract/terminal-ai-zle-prompt.test.ts`: zsh на настоящем shell-е: клавиши, socket, связь
  вокруг команд и widget-ов, отсутствие утечек.
- `test/contract/terminal-ai-suggest.test.ts`, `test/contract/terminal-ai-next-command.test.ts`,
  `test/contract/terminal-ai-request.test.ts`, `test/contract/terminal-ai-fix.test.ts`: каждая функция на настоящем zsh.
- `test/contract/terminal-ai-git-branch.test.ts`: ветка.
- `test/unit/terminal-ai-limits-gate.test.ts`, `test/unit/terminal-ai-options.test.ts`, `test/unit/terminal-ai-context.test.ts`,
  `test/unit/terminal-ai-redact.test.ts`, `test/unit/terminal-ai-protocol.test.ts`: чистые правила.
- `test/unit/terminal-ai-settings.test.tsx`, `test/unit/terminal-ai-request.test.tsx`, `test/unit/terminal-ai-fix-button.test.tsx`: интерфейс.
- `test/e2e/terminal-ai-history.spec.ts`, `test/e2e/terminal-ai-suggest.spec.ts`, `test/e2e/terminal-ai-next-command.spec.ts`,
  `test/e2e/terminal-ai-request.spec.ts`, `test/e2e/terminal-ai-fix.spec.ts`, `test/e2e/terminal-ai-settings.spec.ts`: функции в приложении, на
  fake backend. На Windows они пропускаются, кроме случаев, где разделу Settings zsh не нужен.
