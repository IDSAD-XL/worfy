# Sessions

> Перевод [английской версии](../sessions.md), commit `4879eec7`.

Два Feature. **Session** — один разговор с агентом одного Vendor-а, Claude Code или Codex. **Subagent** — агент, которого
запустила Session. Transcript, Claude home, Memory и Limits описаны на странице [Transcripts and usage](transcripts-and-usage.md).
Термины объяснены в [Concepts](concepts.md). Выбор Vendor-а, вход в него и то, что предлагает Session на Codex, — на странице
[Vendors](vendors.md).

## Session

### Behaviour

worfy сам ведёт Session-ы и показывает те, что запущены в других местах. У каждой Session один Node на Canvas.

| Node | Как появляется | Что может пользователь |
| ---- | -------------- | ---------------------- |
| Orchestrator | Создаётся закреплённым, один на Project | Всё описанное ниже и «New Orchestrator Session». Его можно двигать, но нельзя убрать |
| Live Session Node, 340 на 220 пикселей | «New session» или Resume | Отправлять сообщения из Node или Session view |
| Read-only Session Node, 300 на 120 пикселей | Session, запущенная в терминале или Claude desktop | Читать её transcript, сделать Resume, когда она закончится |

Session, которую ведёт worfy, принадлежит приложению, а не окну. Её события идут во все окна, закрытие окна её не
останавливает, и она останавливается, когда worfy завершается. Сначала выход даёт внешним вызовам Session-ов без
результата закончиться, например `git push` или `gh pr merge`, но не дольше 60 секунд. В это время каждое окно показывает
**Quitting worfy** с этими вызовами и **Quit now**, а сообщение, отправленное Session, ждёт в её очереди. Затем каждый turn
прерывается, а процесс, который не вышел за 7.5 секунды, убивается. Restart now у Update выходит так же; выключение системы
не ждёт.

**После перезапуска.** Во время работы worfy записывает, какие Session-ы находятся в turn-е или имеют сообщения в очереди
(`live-sessions.json` в папке данных Project-а). Когда worfy снова стартует после выхода, Update, выключения системы или
crash-а, каждая такая Session продолжает сама: и Orchestrator, и Session Node, на Claude Code или Codex. Она получает одно
сообщение: что worfy перезапустился и оборвал её turn, какие Subagent-ы стали Interrupted и их Ticket-ы, и просьбу проверить,
что каждая команда уже сделала, прежде чем её повторять. Исходное сообщение повторно не отправляется. Очередь возвращается
такой, какой была, а придержанная очередь остаётся придержанной. Session view показывает строку
`worfy: restarted at 14:05 (update), sent "continue"`; «(update)» появляется только после Restart now у Update. Session,
которой владеет run Autopilot-а, остаётся run-у.

Session не продолжает сама в таких случаях:

- в её оборванном turn-е или у одного из её Interrupted Subagent-ов есть вызов, который мог подействовать снаружи и не
  имеет результата, например `git push` или `gh pr merge`;
- её оборвали больше чем за час до старта;
- worfy уже продолжил её дважды за этот час;
- её прежний процесс Claude Code ещё работает под другой программой;
- её Session Node называет не ту сессию, которую оборвал перезапуск. Тогда Continue продолжает собственную сессию Node-а,
  сообщения не шлёт и возвращает очередь придержанной.

Прежний процесс Claude Code, который остался от завершившегося worfy, сначала дожидаются, затем убивают, и только потом
Session продолжает. Session Node, который не продолжил сам, показывает chip **Interrupted by restart** с причиной в
tooltip-е и **Continue**. Continue продолжает Session и шлёт то же сообщение; Session view затем показывает
`worfy: not continued: …` с причиной, а за ней строку выше. Если вместо этого продолжить Session из History, это сообщение
и очередь пропадают. Node, который worfy не успел сохранить к своей остановке, продолжает оборванную сессию, никогда не
новую. Orchestrator, который не продолжил сам, только записывается в лог.

**Vendor.** Каждая Session работает на агенте одного Vendor-а: Claude Code или Codex. Live Node хранит свой Vendor рядом с
id Session, а Node, сохранённый до появления Vendor-ов, принадлежит Claude Code. «New session» берёт переданный ему Vendor,
иначе Vendor Project-а по умолчанию (`defaultVendor` в `settings.json` Project-а), иначе Claude Code. Start и Resume берут
Vendor Node-а. «New session» отклоняет Vendor, который эта сборка не запускает, или Vendor, в который никто не вошёл, — с
причиной и ещё до появления Node-а; для Vendor-а без входа причина — `Sign in to Codex in Settings → Vendors`. Claude Code
повторно не спрашивают, потому что проверка первого запуска уже требует входа в него. Проверка входа, которая упала или
длится больше 15 секунд, ничего не отклоняет, и тогда Session показывает собственную ошибку Vendor-а. Node, Vendor которого
эта сборка не знает, сохраняет его и отказывается стартовать. Orchestrator работает на Vendor-е Project-а по умолчанию (см.
**Orchestrator** ниже). Session, которую запускает «Ship ticket», всегда на Claude Code, какой бы ни был Vendor Project-а по
умолчанию.

**Выбор Vendor-а и вход.** «New session» в sidebar открывает список «New session on», Settings → Vendors хранит вход в
каждый Vendor, а badge показывает Vendor каждой Session: все три описаны на странице [Vendors](vendors.md).

**Product Session.** Product Session — Session вида `product`, советник Product owner-а, отдельно от Session-ов
разработки. Её запускают кнопка «Product Session» в разделе Sessions sidebar, рядом с «New session» под его заголовком, и
команда «New Product Session» в Command palette. Vendor она не предлагает: Product Session работает только на Claude Code, и
`sessions.new` отклоняет любой другой Vendor с `Product Session runs on Claude Code only`. Новая Session сразу открывается в
Session view. Её Node остаётся Session Node на Canvas, с подписью «Product Session» под заголовком, а её имя говорит
«Product Session» там, где у обычной стоит «Session» («New Product Session», пока у её Session нет id). Её экран, её
ограничения, Mind map, критик и доля принятых советов описаны на странице [Product Session](product-session.md).

Product Session в Project-е получает ещё MCP-сервер `worfy-mind-map`; обычная Session и Orchestrator — никогда. Его tools
`mind_map_read`, `mind_map_add`, `mind_map_update`, `mind_map_decide` и `mind_map_remove` читают и меняют `mind-map.json`
папки темы в папке Product Session (`docs/product/<topic>/`, в Silent mode `<Workflow folder>/product/<topic>/`). main
проверяет весь файл по его формату перед каждой записью и пишет его атомарно, по одной записи за раз на файл. Отклонённое
изменение — ошибка, которую читает агент, а файл остаётся прежним. `mind_map_decide` сохраняет прежний статус и причину
Decision в её истории; `mind_map_remove` берёт только узел без детей, который не Decision; `mind_map_add` отклоняет тему, у
которой ещё нет папки. Product Session никогда не запускает git: её tool `product_save`, Close её Node-а и архивирование её
Node-а пользователем (автоматический архив её Node не берёт) проверяют `git status` папок `docs/product/<topic>` Project-а и, если файлы там
изменились, шлют Orchestrator-у Project-а сообщение со списком изменённых файлов и просьбой сохранить их docs PR-ом. Об одних
и тех же изменениях просят один раз. Без изменений и в Silent mode ничего не шлётся; `product_save` отвечает «nothing to
save» или «Silent mode: nothing to save». Пока Autopilot ведёт Orchestrator, ничего не шлётся, и `product_save` об этом
говорит.

**Состояния.** Session находится в одном из шести состояний, показанных chip-ом.

| Состояние | Статус chip-а | Значение |
| --------- | ------------- | -------- |
| `starting` | working | Процесс запущен. Становится `idle`, когда агент отвечает на проверку при старте: Claude Code — об аккаунте, Codex — своим thread-ом |
| `idle` | ready | Ждёт сообщение |
| `busy` | working | Идёт turn |
| `needs_permission` | blocked | Turn ждёт ответа на запрос разрешения |
| `error` | blocked | Процесс умер или упал. Tooltip показывает конец его stderr |
| `closed` | done | Session закрыта |

Текст chip-а — имя состояния: `needs_permission` читается как «needs permission». Исключение — Live Session Node, чья
Session не запущена: он пишет «finished», а до первого запуска «new».

**Тихий turn.** Turn, который 10 минут идёт без признаков жизни, — тихий. Chip в шапке Session view тогда пишет
`busy · quiet N min`, где N — целые минуты с последнего признака, и счёт идёт по часам. Признак жизни — любое событие агента,
включая скрытые: hook, который стартует, идёт или кончается, и токены thinking. Тишиной не считаются и вещи, которые событий
не шлют: открытый запрос разрешения (Session тогда `needs_permission`), hook, который стартовал и не кончился, output file
живого background task-а, изменившийся за последние 10 минут, вывод gate, идущего в папке Session, и занятый e2e lock,
держатель которого работает. main смотрит раз в минуту, поэтому отметка появляется с опозданием до минуты. Следующий признак
жизни, конец turn-а или запрос разрешения снимают отметку.

Пока отметка видна, строка над полем ввода говорит `No sign of life for N min: no events, no hook, no output.`, и у неё
две кнопки. **Interrupt** — то же, что собственный Interrupt Session. **Restart** прерывает turn, ждёт выхода старого
процесса и запускает новый, который продолжает тот же разговор в той же Session, под тем же id. Новый процесс сам сообщения
не берёт, а придержанная очередь остаётся придержанной. Пока живы background task-и Session, Restart ничего не делает,
потому что закрытие процесса их бы завершило; вместо своего текста строка показывает причину: `1 background task of
this Session is still running, and a Restart would end it. Try again once it finishes.` Restart отклоняется для Session без
человека (о ней решает run Autopilot-а) и для Session, которую остановил Stop в Autopilot. Ничто не перезапускает и не
прерывает тихий turn само. На экране только для чтения обе кнопки видны и ничего не делают.

**Отправка.** Return отправляет, Shift+Return начинает новую строку. ↑ и ↓ в пустом поле ходят по истории отправленных
сообщений. Поле растёт до 200 пикселей. Пустое сообщение без вложений отклоняется. Неудачная отправка возвращает в поле
текст и chip-ы вложений. «/» в начале поля, после пробела или перевода строки открывает меню slash-команд и skills, о которых
сообщает Vendor этой Session. Меню открывается и закрывается, когда каретка входит в такое слово или выходит из него, и
закрыто, пока в поле выделен текст. Меню фильтрует всё слово, а выбранная команда заменяет только это слово: текст вокруг
остаётся. Escape закрывает меню, пока каретка не уйдёт из этого слова. Сообщение, которое начинается с имени skill, вызывает
этот skill. Меню Session на Codex описано на странице [Vendors](vendors.md).

**Черновик.** Набранный и не отправленный текст остаётся в поле как черновик. Он на месте после другого view, другой Session
в picker-е и возврата, другого Project-а и перезапуска worfy. Переносы строк сохраняются, положение каретки — нет. У каждой
Session один черновик в Session view, какой бы ни был её Vendor; у Orchestrator-а и Product Session тоже. Поле Session Node
на Canvas хранит свой. Отправка очищает черновик. Node, удалённый или взятый автоматическим архивом, уносит свои черновики,
и Undo их не возвращает. Черновики лежат в хранилище окна внутри папки данных worfy; запись — через миг после последнего
нажатия и при закрытии окна. Черновик больше ~100 kB там обрезается до этого размера; открытое окно держит его целым.

**Очередь.** Сообщение, отправленное во время turn-а, ждёт в очереди в main. Подсказка рядом с кнопкой отправки в это время
говорит «Return to queue». Сообщения идут по одному на turn, каждое после `result` предыдущего turn-а. Chip «N queued»
открывает список, где × убирает сообщение; Esc или клик в другом месте закрывает список. Interrupt или crash придерживают
очередь: заголовок списка меняется на «Held after Interrupt», и ничего не уходит до «Send queued». Пустая очередь никогда не
придерживается. Очередь не переживает свою Session, с двумя исключениями. Очередь Orchestrator-а переходит в новый процесс,
когда Autopilot его возвращает. Очередь, оборванная перезапуском worfy, возвращается вместе со своей Session (см. «После
перезапуска» выше): её тексты и файлы, но не изображения — их число называет строка notice.

**Interrupt.** Кнопка в Session view или Esc в её поле ввода работает в `busy` и `needs_permission`. Esc, который закрывает
popup поля, например slash-меню, список «N queued» или slider Effort, только закрывает popup и оставляет turn идти;
следующий Esc в поле прерывает turn. Interrupt придерживает очередь, отменяет открытые запросы разрешений и вопросы и просит
Claude Code остановить turn.

**Crash.** Session переходит в `error`. Очередь придерживается, открытые запросы отменяются, а о background task-ах
забывают. Следующее сообщение запускает новый процесс, который продолжает тот же разговор. Если старый процесс ещё работает,
новый стартует только после его выхода или после SIGKILL, который worfy шлёт ему через 7.5 секунды после сообщения;
сообщение ждёт новый процесс. Orchestrator, перезапущенный за это время, передаёт это сообщение своей новой Session вместе с
очередью.

**Закрытие.** Пользователь не может закрыть Session в `busy`: «The Session is in a turn: Interrupt it before closing».
Закрытие Session у live Session Node оставляет сам Node, и он предлагает Resume. Сообщение, отправленное такому Node, сначала
делает Resume; так же работает брошенный на него файл.

**Resume.** Продолжается только законченная Session, потому что два процесса не должны писать один transcript. Она
продолжается в папке, записанной в transcript-е, а если такой нет — в корне Project-а. У отказов такие подписи:

| Причина | Подпись |
| ------- | ------- |
| worfy ведёт её сейчас | Already open in worfy |
| Живой процесс в терминале | Still running in terminal |
| Живой процесс в Claude desktop | Still running in Claude desktop |
| Transcript не найден | No transcript of this Session |
| Её папки больше нет | Folder no longer exists |

Read-only Node становится live на месте, сохраняя id и позицию, и вырастает до минимального размера live. Архивный Node
сначала возвращается на Canvas. Закреплённому Node отказывают. Если Node нет, появляется новый.

**Sidebar и история.** Раздел Sessions в sidebar показывает live Session-ы активного Project-а, «New session» и историю. Под
«All Projects» переключателя Project-ов в sidebar следуют live Session-ы каждого другого Project-а этой Machine, каждый
Project под своим именем. Клик по такой Session сначала открывает её Project, затем саму Session (см.
[App shell](app-shell.md)). Иконка в rail считает занятые Session-ы тех Project-ов, которые показывает переключатель. Popover
истории показывает до 100 прошлых Session-ов, новые сверху, у каждой Show, Resume и источник: worfy, desktop или terminal.
Show ставит read-only Node на Canvas или переходит к Node, который у Session уже есть. Заголовок — последний custom title,
затем AI title, затем первый prompt.

**Session-ы Codex в Project-е.** Thread-ы Codex, чья папка — корень Project-а, один из его worktree или папка внутри одного
из них, тоже есть в истории, как `terminal · Codex` или `worfy · Codex`. В Windows папка сравнивается с любым разделителем и
без учёта регистра. Codex не хранит список своих работающих Session-ов, поэтому, пока Project открыт, worfy спрашивает Codex
снова каждые 30 секунд, а без домашней папки Codex не спрашивает вовсе; Codex, который не отвечает, прекращает опрос без
ошибки. Список Session-ов никогда не ждёт Codex: его thread-ы приходят с более поздним ответом, который окно запрашивает
каждые 2 секунды, пока Codex отдаёт свой первый список. Thread, запущенный вне worfy и изменившийся за последние 10 минут,
сам получает read-only Node с badge Codex и chip-ом `unknown`; более старый получает Node через Show. Его transcript читается
из Codex, а его ответы подписаны `codex`. Resume такого Node-а или его строки в истории продолжает тот же thread Codex на live
Node на его месте; для thread-а, который запустил не worfy, сначала спрашивается «This Session may be open in a terminal», с
Cancel и «Resume anyway».

**Model, effort и permission mode.** Три picker-а стоят под полем ввода, а шапка показывает текущие значения. Списки ниже —
от Claude Code; списки Session на Codex и её запросы разрешений описаны на странице [Vendors](vendors.md).

- Model: строки приходят от Claude Code. Haiku не предлагается. Сохранённый Haiku откатывается к модели и effort по
  умолчанию. «Default» означает `model` и `effortLevel` из `settings.json` пользователя, которые читаются при каждом старте
  процесса. Когда собственная модель пользователя — Haiku, Session просит Sonnet. Выбранная модель сразу видна в шапке.
- Effort: low, medium, high, xhigh, max, насколько их поддерживает модель. Slider отправляет выбор через 600 ms покоя или при
  закрытии popover.
- Permission mode: Bypass permissions (по умолчанию), Accept edits, Ask before tools, Plan only.

Выбор сохраняется для каждого Node. Повреждённое сохранённое поле откатывается к значению по умолчанию.

**Разрешения.** Вне Bypass permissions Claude Code спрашивает перед tool, и в transcript-е появляется карточка.

- Allow: только этот вызов.
- Always allow: этот tool до конца этой Session. Заодно закрывает другие открытые запросы к тому же tool. Переживает crash
  процесса, но не перезапуск worfy и не Resume. worfy никогда не пишет правило в настройки пользователя.
- Deny: отклоняет этот вызов.

Запрос отменяется по Interrupt, при закрытии Session, при crash и когда его прерывает сам Claude Code. Карточка тогда
показывает Allowed, Always allowed in this Session, Denied или Cancelled.

**Вопросы.** AskUserQuestion из Claude Code становится карточкой вопроса в любом permission mode. Она показывает по одному
вопросу, с Back и Next. Варианты — кнопки с описаниями или переключатели, когда можно выбрать несколько. «Other» принимает
слова пользователя. 1–4 выбирают вариант, Enter идёт дальше. «Submit» работает, когда на все вопросы есть ответ. «Decline»
отклоняет вызов. «Always allow» у карточки нет.

**Окно, пропустившее запрос.** Окно, открытое или перезагруженное после того, как ушёл запрос или вопрос, спрашивает у main
открытые и рисует их карточки, так что у Session в «needs permission» карточка есть всегда. Badge Node-а тогда, как и раньше,
отличает вопрос («Waits for answer») от запроса разрешения («Needs permission»). Если и у main открытого запроса нет, чат
пишет, что Session ждёт ответа, который это окно показать не может; Interrupt его отклоняет.

**Вложения.** «+», drop в любое место чата и вставленное изображение добавляют chip. В сообщении до 20 вложений.

- Изображения: PNG, JPEG, GIF и WebP, до 3.75 MB каждое.
- Файлы, выбранные через «+» внутри Project-а, идут по пути, любого размера.
- Файлы, выбранные вне Project-а, и каждый брошенный файл копируются в папку данных Project-а, до 20 MB каждый.

**Комментарии к цитатам.** В Session view можно прокомментировать текст, выделенный внутри одного ответа агента, Claude Code
или Codex. Кнопка рядом с выделением говорит «Comment ⇧⌘M»; правый клик (клик двумя пальцами на trackpad) открывает
«Comment» и «Copy»; ⇧⌘M (Ctrl+Shift+M) делает то же. При выделении через два сообщения кнопка говорит «Select inside one
message to comment». Popover показывает цитату, принимает текст и до 3 изображений (файл из «Add image», ⌘V или drop) и
сохраняет по ⌘↵; Esc в нём отменяет. Клик снаружи или Esc, нажатый вне popover, закрывает его, если в нём ничего не меняли;
если добавлен текст или изображение, он остаётся и сначала просит сохранить или отменить. Esc в поле ввода занятой Session
прерывает turn и оставляет popover как есть. Комментарий может состоять из одних изображений. Изображений в комментариях
одного сообщения не больше 10, а длинная сторона изображения уменьшается до 1568 пикселей, прежде чем main его проверит.

- Цитата получает светло-зелёный фон и зелёное подчёркивание: акцентный цвет в тёмной теме, зелёный цвет точки ready в
  светлой. При наведении на неё показывается комментарий с Edit и Delete; Delete предлагает Undo. Esc закрывает эту
  карточку, если только поле ввода занятой Session не забирает его, чтобы прервать turn.
- Новое выделение не может перекрывать ещё не отправленный комментарий: кнопка тогда говорит «Overlaps a comment · Open it».
  Вплотную к нему или поверх отправленной цитаты — может.
- Tray над полем ввода говорит «N comments on M messages», с chip-ом на каждый комментарий в порядке текста и Clear. Клик по
  chip-у прокручивает к его цитате и коротко подсвечивает её; его × убирает комментарий.
- Send отправляет одно сообщение, и поле тогда может быть пустым. Сначала идут комментарии, в том порядке, в каком они стоят
  в тексте агента: пронумерованная цитата, время её сообщения, комментарий с отступом под ней и метка `[image N]` на каждое
  изображение, затем «General:» и текст поля. Изображения комментариев — первые вложения сообщения, в том же порядке.
  Цитата длиннее 200 символов для агента обрезается посередине. Сообщение, которое начинается с `/` (команда), отклоняется,
  пока есть комментарии: отправьте его отдельно или сначала очистите комментарии. Больше 10 изображений комментариев тоже
  отклоняются при Send, как бы они ни попали в tray (в том числе через Undo удаления).
- Пока агент работает, сообщение ждёт в очереди, и его комментарии ждут вместе с ним: вне tray и с тусклой подсветкой. Они
  становятся отправленными цитатами, когда сообщение уходит агенту. Сообщение, которое пользователь убирает из очереди (× в
  списке «N queued» или на сообщении в очереди в чате Product Session), возвращает свои комментарии в tray, и notice об этом
  говорит. Очередь, которая опустела иначе (Autopilot «Start now» сохраняет её для Session человека), оставляет их ждать
  отправки сообщения. Пока они ждут, строка над полем ввода говорит «Waiting to send · N comments»; её «Back to drafts»
  возвращает их в tray, и prompt этого сообщения, который придёт позже, ничего не посчитает дважды.
- Сообщение пользователя рисует по блоку на каждую цитату: зелёная полоса, цитата, свёрнутая до трёх строк с «Show all»,
  комментарий и его изображения. Окно, которое отправило сообщение, показывает цитату целиком, а строка источника блока
  ведёт обратно к цитате. Блок читается из собственного текста сообщения, поэтому после перезапуска он такой же.
- Отправленная цитата остаётся подсвеченной, тускло, в этой Session; клик по ней прокручивает к её блоку. Она уходит из tray,
  и её больше нельзя редактировать. ↑ в поле ввода возвращает текст, набранный после комментариев, а не сами комментарии.
- Ещё не отправленные комментарии переживают другую Session, другой Project и перезапуск, как черновик поля, и уходят вместе
  со своим Node-ом, когда он покидает Canvas или архивируется. Node хранит комментарии трёх своих Session-ов, изменённых
  последними, а Session — 500 своих новейших отправленных цитат. Экран только для чтения, без поля ввода, комментариев не
  предлагает.
- Изображение комментария сохраняется в папке данных worfy в момент добавления (`attachments/images`, по sha256 его
  байтов); комментарий называет его, и байты изображений в хранилище окна не попадают. Отправка после перезапуска читает
  изображение оттуда; пропавшее отклоняется с «attach it again». Когда хранилище окна отказывается сохранить комментарии,
  notice говорит, что они остаются в этом окне до его закрытия.
- Комментарий может быть и к строкам файла diff-а — его делают в Changes. Он называет свой файл, сторону (старую или
  новую), строки и commit (или «uncommitted»), хранит текст этих строк и принимает изображения в тех же пределах. Он стоит
  в том же tray, после комментариев к сообщениям: tray тогда говорит «N comments · M on code», а его chip показывает
  `path:lines`. Send отправляет его в том же сообщении, во втором разделе после комментариев к сообщениям: «Comments on
  lines of the diff (N), worktree …, branch …:», затем на каждый комментарий `path:lines (new side, commit 9f8e7d6)`,
  строки как строки `> `, комментарий и его метки `[image N]`; изображения нумеруются сквозь оба раздела. Код длиннее
  6 строк для агента обрезается посередине с «…». Сообщение пользователя рисует по блоку на каждый комментарий к коду: его
  файл и строки, код, свёрнутый до трёх строк с «Show all», комментарий и его изображения, прочитанные из текста
  сообщения. Отправленный комментарий к коду не оставляет тусклой подсветки в transcript. Комментарии, сохранённые до
  комментариев к коду, читаются как прежде. Сохранённый комментарий, который больше не читается, отбрасывается один:
  остальные комментарии tray и ждущей отправки остаются.

**Session view.** Второй view окна, рядом с Canvas. В шапке заголовок («Orchestrator» или «Session» и Project), badge Vendor-а
у Session Node, chip состояния, Session picker, Model, Effort, Permissions, Cost, Hide tools и Interrupt. Cost показывает
значение только для Orchestrator-а: `$0.00`, с четырьмя знаками ниже доллара. У остальных Session-ов — прочерк. Chip «MCP
n/m» стоит в строке под полем ввода, сразу слева от context meter (из шапки он ушёл: там стало тесно); у Product Session его
нет. Он считает MCP-серверы Session, n подключённых из m, и открывает над собой popover с их статусом и действиями:
Reconnect, Sign in, Turn off for this Session, Allow и Allow all. Весь Feature, с подхватом сервера, добавленного во время
работы Session, и серверами, которые Project не разрешает, — на странице [MCP servers of a Session](mcp-servers.md). Шапка
Product Session ещё показывает долю принятых советов её Project-а: «Advice accepted 3 of 5 · 60%» или «No advice decided
yet», пока ничего не решено. Доля считает узлы Mind map с `advice: true` во всех темах, Decision — по её статусу, и
возражения каждого review критика в `critic/` — по их строкам `Owner decision:`; совет, который ещё ждёт решения, в долю не
входит. Возражение критика считается один раз, по его review: узел Mind map, источник которого — файл из `critic/`, не
считается, какой бы ни был его `advice`. Tooltip называет, сколько советов ждут решения, в Mind map и в review критика,
называет файлы, которые не удалось прочитать, говорит, что решение, записанное в review критика, появится после следующего
изменения темы, и что доля считает решения владельца и не мерит качество советов. main считает её из файлов по
`product.share`, а шапка спрашивает снова при каждом `product.changed` Project-а, так что `mind_map_decide` виден сразу;
изменение одного только review критика видно со следующим изменением темы или следующим открытием Session. Ничего из этого
не хранится. View показывает Session, открытую последней в этом Project-е, пока её Node на Canvas, а иначе Orchestrator.
Память об этом выборе живёт столько же, сколько окно. Session picker показывает сначала Orchestrator, затем работающие
Session-ы, затем остальные. Subagent-ов в нём нет.

**Context meter.** Кольцо под полем ввода. 100% — порог autocompact, и значение на нём останавливается. Если autocompact
выключен или порог неизвестен, показывается собственный процент Claude Code, который может превысить 100. Цвет меняется на
60% и 85%. До первого отчёта написано «no data». Tooltip: `84.2K / 200K tokens · autocompact at 167K` или с окончанием
`autocompact off`. Новое значение прокручивает свои цифры на место, как Cost в шапке и на Node Orchestrator-а. Первое
значение появляется сразу, и с Reduce motion — каждое новое тоже.

**Окно autocompact.** В Settings → Sessions три строки. Первые две — окна autocompact: Orchestrator, окно которого используют
и его Subagent-ы, и Other Sessions. Третья, «Live summary while the advisor works», — переключатель live summary у Product
Session ([Product Session](product-session.md)). Каждая — «Claude Code default» или Custom, от 100K до 1M с шагом 10K.
Значения worfy по умолчанию — 400K и 500K. Окно, которое пользователь не выбирал, уступает `autoCompactWindow` из
`settings.json`. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` в login shell перекрывает обе строки, и раздел об этом сообщает.
Работающая Session сохраняет своё окно до следующего старта.

**Context compacted.** Когда агент сжимает свой контекст, transcript показывает на этом месте среди событий turn-а строку
`Context compacted (auto) · 812K → 41K`. Слово в скобках — триггер, `auto` или `manual` (`/compact`); числа — токены до и
после, записанные так же, как их пишет Context meter. Claude Code не всегда сообщает токены после, и тогда строка кончается
первым числом. Session на Codex показывает только `Context compacted`: Codex не называет ни триггер, ни токены. Что сохраняет
summary, решает Harness: его правила сжатия идут в Claude Code через hook, а в Codex — как `compact_prompt` thread-а, который
для thread-ов, запущенных worfy, заменяет `compact_prompt` из собственного конфига Codex пользователя.

**Orchestrator.** Главная Session Project-а. Node показывает её состояние, модель, суммарную стоимость и последний status
block её ответов.

- «New Orchestrator Session» заменяет Session Orchestrator-а новой. Tooltip кнопки: «The current Session goes to the history;
  the Orchestrator starts again with a clean context.» Кнопка отклоняется в `busy` и пока работает Autopilot. Старая Session
  остаётся в истории, а стоимость начинается с нуля.
- Когда Orchestrator открывается, его сохранённая Session продолжается. Если transcript пропал, стартует новая Session.
- Orchestrator работает на «Default vendor» Project-а ([Project settings](projects.md)), а пока ничего не выбрано — на Claude
  Code. Изменение действует со следующего старта Orchestrator-а: «New Orchestrator Session» или следующий запуск worfy.
  Сохранённая Session другого Vendor-а тогда не продолжается: на новом Vendor-е стартует новая, с моделью и effort этого
  Vendor-а по умолчанию, а старая остаётся в истории. Permission mode переходит в свой аналог на новом Vendor-е: Bypass
  permissions и Full access, Accept edits и Auto, Ask before tools и Read only (Plan only становится Read only). Node хранит
  старую Session, пока новая не стартовала: если этот старт не удался, возврат к старому Vendor-у продолжает старую Session.
  Orchestrator на Codex показывает свою модель и status block с первого ответа после старта, а не из transcript-а.
- Orchestrator modes — Eco mode, Auto-approval и Auto-continue — собраны в одной кнопке под полем ввода Orchestrator-а,
  «Modes». С включённым Auto-continue worfy продолжает turn Orchestrator-а, который закончился временной ошибкой API или
  отказом Limits, а строка над полем ввода отсчитывает время до продолжения. И то и другое — на странице
  [Orchestrator modes](orchestrator-modes.md). У обычной Session нет ни того, ни другого.
- Autopilot ведёт эту Session без человека. На Codex run отклоняется, с причиной, пока hook-и Harness не одобрены в `/hooks`
  Codex; см. [Autopilot, Во время run-а](autopilot.md#во-время-run-а). Пока run идёт, permission mode принудительно Bypass
  permissions (Full access на Codex) и не сохраняется, смена режима отклоняется, а запросы разрешений и вопросы сразу
  отклоняются.
- Orchestrator, которого запускает Autopilot, — при старте run-а и для новой сессии перед каждой следующей Wave, —
  получает Epic run-а: `WORFY_EPIC` в окружении своего агента, а на Claude Code ещё строку system prompt, которая называет
  Epic и говорит запустить `wave-brief <epic>` после сжатия контекста. После сжатия контекста Harness возвращает состояние
  этого Epic-а. Строка называет только Epic: Session стартует раньше, чем run читает Ticket-ы Wave. У Orchestrator-а,
  которого открыл человек, или у «Run wave», отправленного в него вручную, своего Epic-а нет: окружение процесса фиксируется
  при его старте, и worfy не перезапускает ради этого работающий Orchestrator. Там Harness берёт Epic из ветки checkout-а.
  Известное ограничение: в очереди Epic-ов первая Wave следующего Epic-а может попасть в Session, которая вела предыдущий
  Epic, когда Orchestrator не свободен для новой сессии (turn, background task или сообщение в очереди). Эта Session хранит
  `WORFY_EPIC` и строку system prompt предыдущего Epic-а, поэтому после сжатия контекста Harness возвращает состояние
  предыдущего Epic-а, пока run не запустит новую сессию для одной из следующих Wave.

**Уведомления.** Системное уведомление уходит, когда Session заканчивает turn, просит разрешение или задаёт вопрос, а фокуса
нет ни в одном окне worfy. Session из терминала или Claude desktop уведомляет, когда её статус переходит из busy в idle. Одна
Session шлёт не больше одного уведомления за 10 секунд. Клик открывает эту Session.

#### On a Linked machine

- Session в Project-е, локальном для одной Machine, другой не видна. Linked machine запускает Claude Code и читает файлы по
  пути только внутри Project-ов Machine, к которой подключена.
- «+» там использует скрытый file input, и файл передаётся байтами.
- При read-only доступе поле ввода, picker-ы и ответы на карточках неактивны, а tooltip объясняет почему. Session view не
  открывает там Orchestrator: если его нет, показывается «No Orchestrator yet».
- Уведомление идёт и подключённым Linked machine. Каждая Machine применяет своё правило фокуса и свои 10 секунд.

#### Windows

- Claude Code — это `claude.exe`. Его окружение строится из переменных сессии Windows и registry, потому что login shell в
  Windows нет. Для tool Bash передаётся Git Bash.
- Подсказки клавиш пишут Enter и Shift+Enter. Подсказка рядом с кнопкой отправки всё равно говорит Return.

### How it works

- **Одна Session — один долгий SDK query.** Его вход — асинхронная очередь, поэтому сообщение работающей Session не
  запускает новый процесс. Interrupt и смена модели тоже идут в работающий query.
- **worfy — это view.** Session работает с настройками, `CLAUDE.md` и hook-ами самого пользователя, а своё состояние worfy
  хранит только в своей папке данных ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md),
  [ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).
- **Id приходит поздно.** Новая Session передаёт Claude Code свой uuid. Продолженная держит временный id `pending-` до
  `system/init`, а затем событие `renamed` переносит всё на настоящий id. Каналы принимают оба. Когда у настоящего id уже
  есть live-события — у Session, запущенной снова с `resume`, например у Orchestrator-а, которого возвращает Autopilot, — они
  остаются первыми, а то, что пришло под id `pending-`, идёт за ними.
- **Node Orchestrator-а хранит только id Session, её Vendor и стоимость.** Всё остальное приходит из transcript-а и
  live-событий ([ADR-0010](../../adr/0010-orchestrator-state-session-id-and-cost-only.md)). Node без Vendor-а — сессия
  Claude Code.
- **Tools и skills ограничены Profile.** Session в Project-е получает только MCP-серверы из списка её Profile, а если списка
  нет — список по умолчанию. Список идёт в Claude Code как policy tier, поэтому Subagent получает тот же набор
  ([ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md)). `worfy-canvas` передаётся, только когда список его
  называет, а `worfy-browser` — когда список называет его или `worfy-canvas`. Plugins и skills следуют той же идее через flag
  settings, чтобы сэкономить токены их описаний ([ADR-0084](../../adr/0084-session-skills-and-plugins-by-profile-list.md)).
  Как работающая Session показывает свои серверы, подхватывает новый и даёт человеку разрешить сервер вне списка — на
  странице [MCP servers of a Session](mcp-servers.md).
- **Harness идёт inline**, если на машине нет старого Harness
  ([ADR-0040](../../adr/0040-harness-delivery-local-marketplace.md),
  [ADR-0049](../../adr/0049-worfy-sessions-without-inline-plugin-on-legacy-harness.md)).
- **Процесс дожидаются.** Два процесса не должны продолжать один разговор, поэтому перезапуск начинается только после выхода
  старого процесса ([ADR-0064](../../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)). worfy ждёт 7.5 секунды
  после закрытия, шлёт SIGKILL и ждёт ещё 2 секунды. Прерванному turn-у даётся 15 секунд, прежде чем Stop в Autopilot
  закроет процесс, и столько же, прежде чем его закроет Restart тихого turn-а. Это тот же Restart, которым пользуются
  действия MCP ([MCP servers of a Session](mcp-servers.md)), только без изменения серверов.
- **Session без человека некого спросить.** Отсюда принудительный режим и отклонённые диалоги
  ([ADR-0022](../../adr/0022-unattended-session-refuses-permission-mode-change.md)). Перевод в режим без человека
  отклоняется во время turn-а, при живых background task-ах и при сообщениях в очереди, потому что перезапуск их потеряет
  ([ADR-0024](../../adr/0024-autopilot-wave-end-and-keep-awake.md),
  [ADR-0029](../../adr/0029-autopilot-waits-for-background-tasks.md)). Возврат Session ждёт конца turn-а и задач, плюс 30
  секунд после последней задачи на её turn с уведомлением. Stop в Autopilot не ждёт
  ([ADR-0050](../../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)).
- **Продолжение после перезапуска сначала читает, потом продолжает.** На вызовы без результата проверяется только
  оборванный turn: turn с последнего сообщения человека. Transcript читается до resume, потому что resume у Claude Code сам
  пишет для такого вызова результат «interrupted». Прежний процесс считается оставленным, когда его родителя нет: macOS
  отдаёт такой процесс launchd, а в Windows pid его родителя пропал или принадлежит более позднему процессу. Claude home
  называет процесс сессии; worfy его только читает. Предел в два продолжения за час останавливает цикл crash-ей.
- **Путь к бинарнику в пакете** задан явно, потому что изнутри `app.asar` ничего запустить нельзя
  ([ADR-0008](../../adr/0008-claude-code-native-binary-path.md)).

#### Windows

Окружение собирается заново так, как его собирает новый вход в систему, поэтому ничего от того, кто запустил worfy, до
Claude Code не доходит. `bash.exe` из Path может оказаться launcher-ом WSL, поэтому Git Bash ищется и передаётся в
`CLAUDE_CODE_GIT_BASH_PATH` ([ADR-0057](../../adr/0057-agent-environment-on-windows.md)). Событие `exit` у Node в Windows
может прийти на секунды позже, поэтому ожидание процесса ещё и спрашивает систему.

### Implementation

| Что | Где |
| --- | --- |
| Одна Session: состояния, отправка, Interrupt, crash | `src/main/agent/session.ts`, `src/main/agent/session/` |
| Тихий turn: правило, признаки, которые читает main, chip и строка с Interrupt и Restart | `src/shared/agent/quiet.ts`, `src/main/agent/session/quiet-signs.ts`, `src/renderer/session/SessionStateChip.tsx`, `src/renderer/session/composer/QuietTurn.tsx` |
| Registry живых Session-ов, test-агент | `src/main/agent/session/registry.ts`, `src/main/agent/app-registry.ts`, `src/main/agent/fake-query.ts` |
| Опции query, списки MCP и skills, autocompact | `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts` |
| Slash-меню Codex: skills, `/compact`, `/review` | `src/main/vendors/codex/commands.ts`, `src/main/vendors/codex/session.ts` |
| Строка «Context compacted»; Epic Wave (`WORFY_EPIC`), `compact_prompt` Codex | `src/shared/vendors/claude/events.ts`, `src/main/vendors/codex/items.ts`, `src/main/agent/orchestrator.ts`, `src/main/vendors/codex/session.ts` |
| Session-ы Codex в Project-е, в истории и на Canvas | `src/main/vendors/codex/sessions-on-canvas.ts`, `src/main/ipc/claude-home.ts`, `src/renderer/claude-home/session-nodes.ts` |
| Окружение процесса | `src/main/agent/env.ts` |
| Очередь, разрешения, сохранённые настройки | `src/main/agent/queue.ts`, `src/main/agent/permissions.ts`, `src/main/agent/session-settings.ts` |
| Правила Resume и закрытия | `src/main/agent/resume.ts` |
| Live Session Node, Orchestrator | `src/main/agent/node-sessions.ts`, `src/main/agent/orchestrator.ts` |
| Продолжение после перезапуска: запись, правила, сообщение, chip | `src/main/agent/live-sessions.ts`, `src/main/agent/continuity.ts`, `src/shared/agent/continue-plan.ts` (`restartText`), `src/renderer/canvas/nodes/SessionNode.tsx` |
| Tools Mind map и сигнал сохранения Product Session | `src/shared/product/tools.ts`, `src/main/mcp/mind-map-server.ts`, `src/main/product/save-signal.ts` |
| Доля принятых советов | `src/shared/product/share.ts`, `src/main/ipc/product.ts`, `src/renderer/session/ProductSessionPanel.tsx` |
| Вложения | `src/main/agent/attachments.ts`, `src/shared/agent/attachments.ts` |
| События, настройки и каналы | `src/shared/agent/events.ts`, `src/shared/agent/settings.ts`, `src/shared/ipc/agent.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/orchestrator.ts` |
| Handler-ы | `src/main/ipc/agent.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/orchestrator.ts`, `src/main/ipc/session-autocompact.ts` |
| Session view | `src/renderer/session/SessionView.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/navigation.ts` |
| Черновики полей ввода | `src/renderer/session/drafts.ts` |
| Комментарии к цитатам: модель и текст для агента, store, слой и bubble | `src/renderer/session/quote-comments.ts`, `src/renderer/session/quote-store.ts`, `src/renderer/session/QuoteComments.tsx`, `src/renderer/session/QuoteCommentParts.tsx`, `src/renderer/session/QuotedPrompt.tsx`, `src/renderer/session/comment-image.ts` |
| Store в renderer, соединение прошлых и live-событий | `src/renderer/session/store.ts` |
| Карточки | `src/renderer/session/PermissionCard.tsx`, `src/renderer/session/QuestionCard.tsx` |
| Элементы под полем ввода, находятся через glob | `src/renderer/session/composer/` |
| Node | `src/renderer/canvas/nodes/SessionNode.tsx`, `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/overlays/SessionNodes.tsx` |
| Настройки autocompact | `src/renderer/settings/SessionsSection.tsx`, `src/shared/settings/app-settings.ts` |
| Уведомления | `src/main/notify.ts`, `src/renderer/session/notification-target.ts` |

Модули меню Modes, Auto-continue и обратного отсчёта — на странице
[Orchestrator modes](orchestrator-modes.md#модули).

**Поток данных.** Окно вызывает `agent.send`. Handler сообщает input observer-ам, проверяет вложения и передаёт сообщение
Session, сохраняя порядок сообщений одной Session. Session передаёт его в SessionHandle своего Vendor-а, а во время turn-а —
в очередь. Driver Vendor-а превращает сообщения своего агента в `AgentEvent`-ы — общую схему, в которую разбираются и файлы
transcript-ов ([Vendors](vendors.md)). События идут всем клиентам по `agent.event`, а store в renderer хранит 5000 последних
для каждой Session. События `queue`, `settings` и `context` не строки transcript-а: store хранит только последнее из
каждого вида.

**Главные test-ы.**

- `test/contract/agent-session.test.ts`, `test/contract/agent-controls.test.ts`, `test/contract/agent-attachments.test.ts`:
  Session поверх fake-агента.
- `test/contract/orchestrator.test.ts`, `test/contract/orchestrator-relaunch.test.ts`, `test/contract/node-sessions.test.ts`,
  `test/contract/permissions.test.ts`.
- `test/contract/sessions-vendor.test.ts`: Vendor Node-а и Project-а, Claude Code на fake-агенте и Codex на fake app-server,
  и что предлагает список Vendor-ов у «New session».
- `test/contract/codex-sessions-on-canvas.test.ts`: thread-ы Codex в корне Project-а и его worktree на fake app-server,
  правило путей Windows, предел в 30 секунд и ответы `claudeHome`; `test/e2e/codex-sessions-on-canvas.spec.ts`: Session
  Codex из терминала, её transcript и Resume с вопросом.
- `test/unit/agent-queue.test.ts`, `test/unit/agent-options.test.ts`, `test/unit/resume-rule.test.ts`,
  `test/unit/session-process-exit.test.ts`.
- `test/e2e/session-view.spec.ts`, `test/e2e/session-controls.spec.ts`, `test/e2e/permissions.spec.ts`,
  `test/e2e/session-question.spec.ts`, `test/e2e/session-resume.spec.ts`, `test/e2e/own-sessions.spec.ts`,
  `test/e2e/orchestrator.spec.ts`, `test/e2e/chat-attachments.spec.ts`, `test/e2e/context-meter.spec.ts`.
- `test/unit/quote-comments.test.ts`, `test/unit/quote-store.test.tsx`, `test/unit/quote-comments-ui.test.tsx`,
  `test/contract/agent-quote-comments.test.ts`, `test/e2e/quote-comments.spec.ts`: комментарии к цитатам.

## Subagent

### Behaviour

Subagent — агент, которого Session запустила tool-ом Agent, или один агент workflow-скрипта. worfy находит их у любой
Session, где бы она ни была запущена, и показывает в двух местах. Subagent-ы Session на Codex берутся из собственных
thread-ов Codex, и transcript-а, который можно открыть, у них нет. Они показываются так же, но их статусы читаются из Codex,
как описано на странице [Vendors](vendors.md); таблица статусов и How it works ниже относятся к Claude Code.

**На Canvas.** Каждый Subagent — Node размером 260 на 84 пикселя справа от родителя, а запущенные им Subagent-ы — справа от
него. Node показывает имя, тип, модель, статус со временем работы и первую строку финального ответа. Вердикт reviewer-а
показывается как chip: первая строка его ответа, которая начинается с VERIFIED или REJECTED; жирный шрифт, знак заголовка
или backtick перед словом допускаются, блок кода между строками из трёх backtick-ов не учитывается. Предложение над этой строкой
пропускается — и в chip-е, и в показанной первой строке; слово внутри предложения или после подписи вердиктом не считается.
Завершённые и прерванные Subagent-ы родителя сворачиваются в одну строку «N done» под работающими. Клик открывает строку, и
этот выбор не сохраняется. Эти Node не сохраняются в Layout и руками не двигаются. Они двигаются вместе с Node своей
Session. Node Subagent-а, перетащенный на Ticket или рамку Epic-а, создаёт Binding и возвращается на своё место.

**В Session view.** Rail показывает их от новых к старым, с группой «Done (N)», к которой добавляется « · N interrupted».
Открытость группы хранится для каждой Session в памяти окна. Если их нет, блок пишет «No Subagents yet». Клик открывает
transcript Subagent-а только для чтения.

**Статус.**

| Статус | Когда |
| ------ | ----- |
| `running` | Конец неизвестен, и Session работает |
| `done` | Task-notification или journal его workflow сообщает о завершении, синхронный вызов вернулся или последний ответ в файле закончил turn |
| `error` | Неудачный конец или вызов, остановка пользователем или обрыв, когда закончился процесс Session или её workflow run |
| `interrupted` | Конец неизвестен, и работающий процесс Session стартовал после его последней записи |

Пока его Session работает, Subagent без конца остаётся `running`, как бы долго его файл ни стоял без изменений. Когда его
`agent-<agentId>.jsonl` не меняется 10 минут, он получает отметку `quiet 21 min` рядом с `running 52m 00s`: на его Node
отметка начинает последнюю строку, перед тем, о чём Subagent-а попросили; в rail она занимает свою строку под именем. Chip
статуса оставляет только статус и время, так что имя остаётся читаемым. Время тишины считается от более позднего из времени
изменения файла и времени его последней записи, а отметка пропадает, когда файл меняется или Subagent кончается. У
Subagent-а Session на Codex файла нет, и отметки он не получает, как и Subagent, известный только по своему вызову. Tooltip
у `interrupted` говорит, что процесс перезапустился после последней записи агента:
«it was stopped from outside, not by a failure». Время работы выглядит как `45s`, `6m 05s`, `1h 02m`.

**Workflow-скрипты.** Run workflow-скрипта — запись типа `workflow`, названная по скрипту, с его агентами внутри. Run,
продолженный под тем же id, показывается один раз, по последнему вызову.

**Hide.** «Hide» на записи скрывает её при любом статусе. Её дети занимают её место. «Hide finished» скрывает всё, что
закончилось, а «Show hidden Subagents (N)» возвращает записи Session. Rail пишет «Every Subagent is hidden», когда ничего
не осталось. Скрытые записи переживают перезапуск, до 20 000 последних на Session.

#### On a Linked machine

Ответ должен помещаться в одно сообщение link. Когда не помещается, тексты результатов и ответов обрезаются сначала до 1000
символов, затем до 200, затем до строки summary, и ответ сообщает, что он обрезан. При read-only доступе Hide не
показывается.

### How it works

- **Несколько источников, одно дерево.** В событиях Session и в файлах её папки `subagents/` может не быть того, что есть в
  другом источнике. Поэтому одна запись собирает оба, связывая их по id агента или id вызова tool. Background task Bash тоже
  шлёт уведомления, поэтому остаются только записи с вызовом Agent, файлами или типом Subagent.
- **Закрытая Session заканчивает свои Subagent-ы.** Её процесса нет, значит Subagent без конца был оборван
  ([ADR-0031](../../adr/0031-closed-session-ends-its-subagents.md)).
- **`interrupted` отличает перезапуск от сбоя.** Время старта работающего процесса сравнивается с последней записью
  Subagent-а ([ADR-0085](../../adr/0085-interrupted-subagents.md)). Когда нельзя сказать, работает ли процесс, Session
  закрытой не считается.
- **Агенты workflow** берут подпись и конец из `journal.jsonl` своего run-а
  ([ADR-0035](../../adr/0035-workflow-script-subagents-in-tree.md)).
- **Тишина — отметка, а не статус.** Файл, который стоит на месте, ничего точного о Subagent-е не говорит, поэтому он
  остаётся `running` и только получает `quiet N min`. Порог — те же 10 минут, после которых turn Session считается тихим
  (`QUIET_MARK_MS` в `src/shared/agent/quiet.ts`).

### Implementation

| Что | Где |
| --- | --- |
| Сигналы, дерево и отметка тишины (чистый код) | `src/shared/transcript/subagents.ts` |
| Чтение файлов, инкрементально | `src/main/claude-home/subagents.ts` |
| Скрытые записи, `hidden-subagents.json` в папке данных Project-а | `src/main/claude-home/hidden-subagents.ts` |
| Ответ для Linked machine | `src/main/ipc/claude-home.ts` |
| Состояние в renderer, свёртка, подписи | `src/renderer/claude-home/subagents.ts` |
| Rail | `src/renderer/session/rail/SubagentsRail.tsx` |
| Canvas | `src/renderer/canvas/sources/subagents.ts`, `src/renderer/canvas/nodes/SubagentNode.tsx` |

**Поток данных.** Renderer спрашивает `claudeHome.subagents` каждые 2 секунды, пока работает Subagent. `SubagentReader`
читает только то, что добавилось в каждый файл с прошлого вызова, отмечает, когда каждый файл Subagent-а менялся в
последний раз, добавляет `session-closed`, когда процесса Session нет, а `buildSubagentTree` строит дерево.

**Главные test-ы.** `test/unit/subagents.test.ts`, `test/contract/claude-home-subagents.test.ts`,
`test/contract/claude-home-subagents-link.test.ts`, `test/unit/subagent-trees.test.tsx`, `test/unit/subagent-nodes.test.tsx`,
`test/e2e/subagent-tree.spec.ts`.
