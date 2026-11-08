# Product Session

> Перевод [английской версии](../product-session.md), commit `same-pr`.

Product Session — Session, которая не пишет код, а советует Product owner-у: предлагает, спорит с планом, пишет черновики
Epic-ов и записывает разговор на Mind map. Решает человек. На странице три раздела: Product Session описывает саму Session и
её ограничения, Mind map — живую схему её разговора, а «Критик, идеи и доля принятых советов» — агентов и подсчёт вокруг
неё. Термины объяснены в [Concepts](concepts.md); общее для всех Session — на странице [Sessions](sessions.md).

## Product Session

### Behaviour

**Зачем она.** Product Session советует Product owner-у — человеку, который один ведёт продукт. Она раскладывает
продуктовый вопрос на карту, задаёт владельцу вопросы по одному, ищет факты, делает одноразовый прототип, пишет черновики
Epic-ов и спорит: за каждым её возражением стоит факт. Какие Epic-и есть и в каком порядке они идут, решает владелец:
Product Session предлагает и никогда не ставит Epic в очередь. Аналитики продукта нет, поэтому она говорит об этом, а не
угадывает, как пользуются функцией.

**Как открыть.** «New Product Session» — строка раздела Sessions в sidebar над списком и команда Command palette. Ни одна
из них не предлагает Vendor: Product Session работает только на Claude Code, другой Vendor отклоняется с текстом
`Product Session runs on Claude Code only`. Новая Session сразу открывается в Session view. Её Node остаётся Session Node
на Canvas, с меткой «Product Session» под заголовком. На read-only экране Linked machine вход неактивен.

**Модель.** Product Session всегда работает на сильнейшей модели, `opus`, и стартует с самым высоким effort. В её строке
ввода нет выбора модели, а смена модели отклоняется. Eco mode до неё не доходит, и в её строке ввода нет меню Modes: оно
есть только у Orchestrator-а.

**Экран.** Session view у Product Session построен так, как его рисует прототип владельца. В шапке — «Product Session»,
тема Mind map (пока темы нет — имя Project-а), Vendor, состояние, переключатель Session, доля принятых советов (см.
последний раздел) и Interrupt. Model, Effort, Permissions, Cost и «Hide tools» в ней нет. Тело — три части рядом:

| Часть | Что в ней |
|---|---|
| Mind map, слева | Mind map темы, над которой работает советник (следующий раздел) |
| Чат, справа | Разговор с советником и строка ввода |
| Полоса агентов, у правого края | Значок с числом Subagent-ов Session, скрытые не считаются |

- Разделитель между Mind map и чатом стоит на 60 / 40. Он двигается мышью, клавишами ← и → шагом 5 %, Home и End — до
  краёв. Двойной click возвращает 60 / 40. Каждой стороне остаётся не меньше 10 %.
- Доля одна на Machine. Она сохраняется в app settings, когда кончается перетаскивание или нажатие клавиши, поэтому её
  видят все окна и следующий запуск worfy.
- Click по полосе агентов открывает поверх чата блоки rail обычной Session; Escape или «›» их закрывают. Блока Binding
  нет: Product Session не привязана ни к Ticket-у, ни к Epic-у.

**Чат.** Заголовок — «Conversation with the advisor», рядом Vendor; в чате только разговор:

- Сообщения владельца — пузыри у правого края, над ними «You» и время. Ответы советника — пузыри у левого края, над
  ними «Advisor» и время. Чипы узлов Mind map стоят под сообщением, к которому они относятся.
- Упавший ход показывает свою ошибку, прерванный — «Interrupted», ошибка Session тоже видна. Запросы разрешений и вопросы
  советника с вариантами — карточки в чате, как у любой Session.
- Thinking, вызовы tool-ов и их вывод (и упавший вызов), Subagent-ы, hook-и, notice Claude Code и добавленные им
  сообщения, «Turn finished» и slash-команды не показываются. Полный журнал — во Flight Recorder.
- Пока идёт ход, в конце чата стоит «Advisor is thinking». Переключателя деталей нет.
- Поиск (⌘F) ищет только в том, что показывает чат, и только в прочитанных сообщениях: часть файла transcript-а за
  «Load earlier» не ищется, и строка поиска тогда пишет «Earlier messages not loaded».
- В строке ввода — текст, Send, Interrupt во время хода и прикрепление файла или картинки. Pickers, context meter, чипа
  очереди и подсказок нет. Сообщение, отправленное во время хода, по-прежнему ждёт в очереди.

**Чего она не делает.** Product Session не меняет код, не берёт Ticket-ы, не запускает Autopilot и не меняет репозиторий через git. Это
держат три слоя, все — для Claude Code:

| Слой | Что отклоняет |
|---|---|
| Hook PreToolUse | `Edit`, `MultiEdit`, `Write` и `NotebookEdit` вне папки Product Session; в `Bash` и `PowerShell` — Ticket CLI `bin/ticket`, `git add`, `commit`, `push`, `merge`, `rebase` и `reset`, `gh pr create` и `gh pr merge`, `pnpm` и `npm` |
| Canvas server | `autopilot_start`, с текстом «A Product Session does not start Autopilot: it advises and drafts Epics. Ask the Orchestrator of the Project to run the Epic.» |
| Правила Session | Те же границы словами и те, которых hook не видит |

- Каждый отказ несёт причину, которую читает агент. Hook отказывает в любом режиме разрешений, и в `bypassPermissions`.
- Папка Product Session — `docs/product/` Project-а в Full mode и `<Workflow folder>/product/` в Silent mode. Если её
  не удалось найти, отклоняется любая запись файла.
- Команда shell читается так, как её читает shell: слова в кавычках — одно слово (`grep "pnpm"` ищет,
  `git -C "a b" commit` коммитит), а `$(…)`, backticks, `bash -c` и `eval` тоже читаются как команды. Читающие команды,
  например `git log`, `gh pr view` и `epic-status`, проходят. Это не sandbox: команда, которая пишет способом, неизвестным
  hook-у, проходит, и эту границу называют только правила.

**Её правила.** На старте Product Session получает правила Harness `product` и общие правила, но не правила
Orchestrator-а. Они задают процесс: карта темы — `worfy:wayfinder`, вопросы — `worfy:grilling`, факты — `worfy:research`
(заметка ложится в папку темы), прототип — `worfy:prototype`, одним HTML-файлом или планом в Markdown в папке темы,
черновик Epic-а — `worfy:to-spec` в `drafts/<epic>.md` темы, с первой строкой под заголовком `Advisor draft`. Черновик
принимает владелец, потом его переносит Orchestrator.

**Сохранение.** Файлы Product Session — новые или изменённые файлы в рабочем дереве Project-а, пока их кто-то не
закоммитит, а сама Product Session этого не делает никогда. Сигнал сохранения дают три события: владелец говорит
«сохранить» и агент зовёт `product_save`, пользователь закрывает Node, или Node уходит в архив, руками или автоматически.

| Случай | Что происходит | Ответ `product_save` |
|---|---|---|
| Full mode, файлы под `docs/product/` изменились | Orchestrator Project-а получает сообщение: изменённые файлы, их темы и просьба сохранить ровно эти файлы обычным docs PR, не трогая другие изменения. Занятый Orchestrator получает его после своего хода | `Asked the Orchestrator to save …` со списком файлов |
| Те же файлы с тем же содержимым уже просили сохранить | Повторно ничего не уходит | `The Orchestrator was already asked to save these changes; nothing new to save.` |
| Изменений нет | Ничего не уходит | `nothing to save` |
| Silent mode | Ничего не уходит: папка вне git | `Silent mode: nothing to save` |
| Autopilot ведёт Orchestrator | Ничего не уходит | `Autopilot runs the Orchestrator now: nothing was sent. …` |

### How it works

**Вид Session, а не новый Node.** Product Session — Session Node, в данных которого `kind: 'product'`. Node остаётся
Session Node, поэтому Canvas, Layout и sidebar обращаются с ним как с любым другим. Каждый старт Node — Start, Resume или
после перезапуска — читает вид из Node и запускает Session с ним. Node вида, который эта сборка не знает, хранит свой вид и
отказывается стартовать.

**Ограничения идут вместе с видом.** Вид доходит до driver-а Claude Code. Там он добавляет guard в PreToolUse,
`WORFY_SESSION_KIND=product` в окружение Claude Code, Mind map server и canvas server без запуска Autopilot. Hook правил
Harness читает эту переменную: с ней печатаются правила `product`, а правила `orchestrator` — нет. Guard при сомнении
отказывает: вход, который он не может прочитать, папка, которую он не может найти, или его собственная ошибка — отказ.

**Запись файла проверяется дважды.** Цель должна лежать ниже папки Product Session и в написанном виде (`..` свёрнуты, тот
же регистр), и там, куда она ведёт на самом деле (пройдены все ссылки и junction-ы). На Windows отклоняется и имя, которое
система переписывает перед открытием файла (`x.`, `x:stream`, короткое имя `PRODUC~1`). Папка и её устройство — в
[ADR-0101](../../adr/0101-product-session-folder-and-mind-map.md).

**Сохранение без git.** main делает одно чтение, `git status --porcelain=v2` для `docs/product` в корне Project-а, и
ничего не коммитит. Он помнит по Project-у отпечаток файлов, о которых спрашивал в последний раз, — путь и содержимое, —
поэтому одни и те же изменения дают одно сообщение. Для одного Project-а сигналы идут по одному.

### Implementation

| Модуль | Что в нём |
|---|---|
| `src/shared/ipc/sessions.ts` | Вид `product`, единственный Vendor Product Session и текст отказа |
| `src/main/agent/node-sessions.ts` | «New session» с видом, вид на каждом старте, сигнал сохранения при Close и архиве |
| `src/main/agent/session-settings.ts` | Модель `opus` и самый высокий effort, отказ в другой модели |
| `src/main/agent/product-guard.ts` | `productToolDecision`: правила файлов и shell у Product Session |
| `src/main/vendors/claude/options.ts` | Hook PreToolUse с guard-ом, `WORFY_SESSION_KIND`, Mind map server |
| `src/main/vendors/claude/query.ts` | Папка Product Session Project-а, Mind map server только для Product Session |
| `src/main/mcp/canvas-server.ts` | Отказ `autopilot_start` в Product Session |
| `src/main/product/save-signal.ts` | `SaveSignal`: чтение `git status`, сообщение Orchestrator-у, ответы |
| `src/shared/product/paths.ts` | `productFolder` и имена в папке темы |
| `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/palette/commands.ts` | Два входа «New Product Session» |
| `src/renderer/session/SessionView.tsx`, `src/renderer/session/ProductSessionPanel.tsx` | Шапка, тело, заголовок чата и полоса агентов |
| `src/renderer/session/product-session.ts` | `shownInProductChat`: какие строки показывает чат; какие пункты строки ввода убраны |
| `src/renderer/session/Transcript.tsx`, `src/renderer/session/session.css` | Чат пузырями и «Advisor is thinking» |
| `src/renderer/session/MessageInput.tsx`, `src/renderer/session/transcript-find.ts` | Строка ввода в одну линию, поиск по показанным строкам |
| `src/renderer/session/SplitDivider.tsx` | Разделитель |
| `src/shared/settings/app-settings.ts` | Сохранённая доля, `productSession.split` |
| `harness/hooks/rules/product.md`, `harness/hooks/inject-rules.mjs` | Правила Product Session и их выбор по переменной |

**Главные test-ы:**

- `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts`: вид на каждом старте и отказ в Vendor-е.
- `test/unit/product-guard.test.ts`, `test/unit/agent-options.test.ts`: правила файлов и shell, hook и окружение.
- `test/contract/canvas-tools.test.ts`: `autopilot_start` в Product Session, папка Product Session по режиму.
- `test/contract/product-save-signal.test.ts`: сигнал сохранения и его ответы, в том числе при Close и архиве.
- `test/unit/product-transcript.test.tsx`, `test/unit/session-view.test.tsx`: какие строки чат показывает и прячет,
  пузыри, «Advisor is thinking», поиск, шапка и строка ввода против обычной Session.
- `test/unit/product-session-panel.test.tsx`, `test/unit/session-node-product.test.tsx`: экран, разделитель, полоса и
  Node.
- `test/e2e/new-product-session.spec.ts`: вход из Command palette в работающем приложении.

## Mind map

### Behaviour

**Тема — это папка.** Один продуктовый вопрос — одна тема, в своей папке внутри папки Product Session:

```text
docs/product/
  onboarding-flow/          тема
    map.md                  карта темы, её пишет worfy:wayfinder
    issues/01-pricing.md    Ticket-ы карты: крупные узлы Mind map
    mind-map.json           мелкие узлы, их места и свёрнутые ветки
    drafts/<epic>.md        черновики Epic-ов
  critic/                   разборы критика; это не тема
```

Имя темы — одно имя папки из букв, цифр, `.`, `_` и `-`, не длиннее 80 символов. Оно не бывает `critic` и не бывает
именем устройства Windows вроде `CON`.

**Узлы.** Корень — тема, крупные узлы — Ticket-ы её карты. Каждый узел `mind-map.json` — одного из четырёх видов, и к
нему ведёт стрелка от узла, из которого он вырос:

| Вид | Знак | Форма | Что нужно |
|---|---|---|---|
| Idea | ✦ | Капсула | Текст |
| Question | ? | Шестиугольник, пунктирный контур | Текст |
| Decision | ✓ принято, ✕ отклонено | Прямоугольник | Статус и причина |
| Objection | ! | Скошенный прямоугольник | Источник: факт, на котором оно стоит, — путь, Ticket, PR или URL |

Отклонённое Decision остаётся на карте, зачёркнутым, серым и бледным, с пунктирным контуром. От Decision, которое
отменило более раннее, к нему идёт красная пунктирная стрелка «Replaces». Легенда под картой показывает форму каждого
вида и обе стрелки.

**Какая тема на экране.** Product Session не привязана к теме. Пока Session view открыт, Mind map следует за темой
Project-а, файлы которой менялись последними; следует вживую только в этом окне. Последняя тема запоминается по Node на
этой Machine и показывается снова, когда Session открывают ещё раз. До этого на месте карты текст «The
Mind map appears once the advisor adds its first node». Если тему не удалось прочитать, там «Could not read the Mind
map:» и причина.

**Как смотреть.**

- В панели инструментов — переключатель вида «Tree · Graph», «Hide rejected», «−» (уменьшить), процент zoom, «+»
  (увеличить) и «Fit». Колесо мыши меняет zoom от 10 % до 250 %, перетаскивание фона двигает карту.
- По умолчанию «Tree»: сверху вниз, текст 15 px. «Graph» идёт слева направо, текст 12 px. Вид запоминается по теме на этой
  Machine.
- «Hide rejected» прячет отклонённые Decision и ветки под ними, пока карта открыта. Файл не меняется.
- Легенду можно свернуть.
- Click по узлу открывает его карточку: вид и статус, текст, Reason, Source, History (прежние статусы Decision), Grew
  from (ссылка на карточку родителя) и Message («Show in the chat»). Карточка Ticket-а карты показывает его Status и файл.
  Карточка узла `mind-map.json` говорит «To change this node, ask the advisor in the chat.»
- Tab переходит между узлами, Enter или Space открывают карточку, Escape её закрывает.

**Руками.** Владелец только двигает узлы и сворачивает ветки; что говорит узел, решает советник, и в карточке нет поля для
ввода.

- Узел `mind-map.json` можно перетащить; тему и Ticket-ы карты — нельзя. Новое место сохраняется в файле.
- Метка сворачивания у узла с детьми, или ← и → на узле, сворачивают и разворачивают его ветку. Свёрнутая метка
  показывает, сколько узлов она прячет. Сворачивание сохраняется в файле.
- Если изменение не удалось сохранить, карта пишет «Could not save the change:» и причину.

**Чипы в чате.** Под последним ответом советника в ходе каждый узел, который записали вызовы `mind_map_add`,
`mind_map_update` или `mind_map_decide` этого хода, получает чип, один на узел. Ход без ответа показывает чипы под
сообщением владельца, с которого он начался; ход, ни одна строка которого не видна (загруженная часть начинается в его
вызовах tool-ов), показывает их под следующим сообщением или в конце чата. Click по чипу выделяет узел на Mind map и показывает его. Скрытый узел
сначала становится видимым: «Hide rejected» выключается, свёрнутые ветки над ним разворачиваются. Наведение на чип или
фокус на нём подсвечивают его узел; наведение на сообщение подсвечивает узлы всех его чипов. «Show in the chat» в
карточке прокручивает чат к сообщению с чипом узла.

**Вживую.** Изменение файлов темы перерисовывает Mind map без перезагрузки: вызов tool-а, правка руками, запись другого
агента. Файл, который не прошёл проверку формата, не показывается пустым: строка над картой называет файл и каждую ошибку
с id её узла. Корень и Ticket-ы карты видны, а узлы файла — нет, пока его не исправят.

#### На Linked machine

На read-only экране карту можно смотреть, но узлы не двигаются и ветки не сворачиваются. Чип, чей узел внутри свёрнутой
ветки, выделяет свёрнутый узел над ним, и заметка объясняет почему.

### How it works

**Tools агента.** MCP server `worfy-mind-map` получает только Product Session; обычная Session и Orchestrator — никогда.
Только через него агент меняет Mind map:

| Tool | Что делает |
|---|---|
| `mind_map_read` | Список тем или одна тема: Ticket-ы её карты, узлы и ошибки формата |
| `mind_map_add` | Добавляет узел в тему, у которой уже есть папка; Decision — со статусом и причиной, Objection — с источником |
| `mind_map_update` | Меняет текст, вид, источник или `advice` узла; Decision узел становится только через `mind_map_decide` |
| `mind_map_decide` | Делает узел Decision, `accepted` или `rejected` с причиной; прежние статус и причина уходят в его историю |
| `mind_map_remove` | Убирает узел, добавленный по ошибке: только без детей и никогда не Decision |
| `product_save` | Сигнал сохранения из первого раздела |

Отклонённый вызов ничего не меняет, а его ошибка — результат, который читает агент. Новая тема начинается с её `map.md`,
который агент пишет через `Write`.

**Одна проверка, один писатель.** Одна функция проверяет весь файл: поля узла, два узла с одним id, родителя, который не
узел и не Ticket карты (`ticket:02`), цикл, `replaces` не у Decision, Decision без статуса или причины, Objection без
источника. Tools зовут её до записи, экран — при чтении. main — единственный писатель `mind-map.json`: tools и
перетаскивание и сворачивание владельца идут через одного писателя. Он пишет по одному изменению на файл, атомарно, и
никогда не перезаписывает файл, который уже не проходит проверку. На Windows, пока другой процесс держит файл открытым, он
повторяет попытку секунду, а потом пишет в сам файл на месте.

**Откуда узел.** Узел хранит в `message` id сообщения чата, вызов tool-а из которого его записал, если это сообщение
известно. Чипы берутся из самого transcript: каждый вызов `mind_map_add`, `mind_map_update` и `mind_map_decide` отвечает
узлом в том виде, в каком он записан. Для чипов ничего нового не хранится.

**Живая перерисовка.** Слежение за документами Project-а следит и за папками тем и читает тему через 50 мс после её
последнего события; экран получает `product.changed`. Слежение описано на странице [Projects](projects.md).

**Раскладка.** Mind map рисует React Flow. Раскладывает ELK в Web Worker окна: `mrtree` для «Tree» и `layered` для
«Graph»; пока ELK не ответил, рисует быстрая раскладка дерева. Узел с `x` и `y` в файле стоит там, где сказано в файле.

### Implementation

| Модуль | Что в нём |
|---|---|
| `src/shared/product/mind-map.ts` | Формат `mind-map.json` и `checkMindMap` |
| `src/shared/product/tools.ts` | Tools `worfy-mind-map`: имена, формы аргументов, описания |
| `src/main/mcp/mind-map-server.ts` | Server, `MindMapWriter` и сообщение каждого вызова |
| `src/main/mcp/agent-instructions-mind-map.md` | Что агенту говорят о Mind map |
| `src/main/product/topic.ts` | `readTopic`: карта, её Ticket-ы и узлы темы |
| `src/main/docs/watch.ts` | Слежение за папками тем |
| `src/shared/ipc/product.ts`, `src/main/ipc/product.ts` | `product.topic`, `product.changed`, `product.layout` и `product.share` |
| `src/renderer/product/useMindMap.ts` | Одна тема, которую окно держит свежей |
| `src/renderer/product/MindMap.tsx`, `src/renderer/product/mind-map-layout.ts` | Карта, карточка, перетаскивание и сворачивание, раскладка |
| `src/renderer/product/NodeChips.tsx`, `src/renderer/product/node-chips.ts`, `src/renderer/session/Transcript.tsx` | Чипы под сообщением, подсветка на Mind map |

**Главные test-ы:**

- `test/unit/product-mind-map.test.ts`, `test/unit/product-topic.test.ts`: формат и чтение темы.
- `test/contract/mind-map-tools.test.ts`: каждый tool, его отказы и писатель.
- `test/contract/product-watch.test.ts`, `test/unit/product-use-mind-map.test.tsx`: перерисовка после изменения.
- `test/unit/mind-map-view.test.tsx`, `test/unit/mind-map-layout.test.ts`: виды, «Hide rejected», карточка и раскладка.
- `test/unit/mind-map-hand.test.tsx`, `test/unit/node-chips.test.tsx`, `test/contract/product-layout.test.ts`:
  перетаскивание, сворачивание, их запись в файл и чипы.
- `test/e2e/product-session.spec.ts`: в работающем приложении узел, который добавил советник, появляется без
  перезагрузки вместе с чипом, а перетащенный узел сохраняет место после перезапуска. Сворачивание проверяют только
  unit test-ы.

## Критик, идеи и доля принятых советов

### Behaviour

**Критик.** Subagent `worfy:critic` ищет возражения к spec-у или плану, а не причины согласиться. Он получает путь к
плану и никогда — вердикт его автора; перед приёмкой spec-а он получает ещё путь к roadmap проекта, если он есть, и
строки `epic-status` проекта. Он пишет один файл разбора, `critic/<epic>-<YYYY-MM-DD>.md` в папке Product Session,
и отвечает одной строкой: путь и вердикт. В разборе:

- вердикт: `Keep`, `Reorder`, `Split` или `Defer`, с причиной;
- не больше трёх возражений, у каждого строка `Fact:`, которую читатель может проверить по ссылке, строка `Judgement:` с
  выводом критика и пустая строка `Owner decision:`;
- одна альтернатива, даже при `Keep`;
- чего критик не может знать.

Product Session зовёт критика, когда владелец об этом просит.

**Перед приёмкой spec-а.** Orchestrator запускает критика, прежде чем просить владельца принять `spec.md` нового Epic-а. Он
добавляет в шапку spec-а строку со ссылкой на разбор. Её метка — слово «Critic» на языке документов проекта
(`language.docs` Profile-а), поэтому она не всегда английская. Владельцу он показывает вердикт и возражения одной таблицей.
Для каждого возражения, на которое владелец ответил, он заполняет `Owner decision: accepted — <reason>` или
`Owner decision: rejected — <reason>`. Возражение без ответа остаётся пустым и ждёт. Владелец может принять spec вопреки
критику: тогда это обычный принятый spec, и worfy его не проверяет и не блокирует.

**Идеи.** Когда владелец просит идей или спрашивает «что дальше», skill `worfy:product-ideas` даёт от трёх до пяти идей. У
каждой поля `For whom:`, `Why now:` (с фактом), `Cost:` в Ticket-ах и `How we will know it worked:`, и хотя бы одна идея
идёт против roadmap, со строкой `Against the roadmap:`. В Product Session каждая идея становится узлом Mind map с
`advice: true`; в другом месте, без tools Mind map, идеи остаются в ответе.

**Доля принятых советов.** Шапка Product Session показывает, какую часть советов владелец принял в этом Project-е,
например «Advice accepted 3 of 5 · 60%», или «No advice decided yet». Советы, которые ждут решения, в долю не входят.
Tooltip сообщает:

- сколько советов ждёт, в Mind map и в разборах критика;
- файлы, которые не удалось прочитать;
- что решение, записанное в разборе критика, появится после следующего изменения темы;
- что доля считает решения владельца и не мерит, насколько хороши советы.

### How it works

**Что считается.** Два вида советов во всей папке Product Session Project-а:

- каждый узел Mind map с `advice: true`: Decision — по статусу, любой другой узел — как ждущий;
- каждое возражение каждого разбора критика — по строке `Owner decision:`.

Возражение из разбора критика, вынесенное на Mind map, имеет источником файл разбора и считается один раз — по разбору.
Доля считается при каждом запросе и нигде не хранится. Шапка спрашивает заново при каждом `product.changed` Project-а,
поэтому `mind_map_decide` виден сразу. Изменение одного только разбора `product.changed` не присылает, поэтому оно
появляется со следующим изменением темы или со следующим открытием Session.

**Зачем отдельный критик.** Риск — советник, который легко соглашается, поэтому возражения даёт агент, который получает
план без вердикта автора и за каждым возражением обязан назвать факт. Метки разбора остаются английскими на любом языке,
потому что их читают tools: доля читает строки `Owner decision:`.

### Implementation

| Модуль | Что в нём |
|---|---|
| `harness/agents/critic.md` | Критик, его файл разбора и «Before a spec is accepted» |
| `harness/hooks/rules/orchestrator.md` | Правило Orchestrator-а: критик перед приёмкой spec-а |
| `harness/skills/product-ideas/SKILL.md` | Skill идей |
| `src/shared/product/share.ts` | Подсчёт принятых советов |
| `src/main/ipc/product.ts` | `product.share`: чтение тем и разборов |
| `src/renderer/session/ProductSessionPanel.tsx` | `AcceptedAdvice`, число в шапке и его tooltip |

**Главные test-ы:**

- `test/unit/product-share.test.ts`: подсчёт, возражения критика считаются один раз, пропущенные файлы.
- `test/unit/product-session-panel.test.tsx`: число в шапке и его tooltip.
- `harness/evals/critic-verdict/` и `harness/evals/product-ideas/`: случаи eval критика и skill-а идей. Запуск через
  `scripts/eval-harness.mjs` зовёт настоящий Claude Code; CI их не запускает.
