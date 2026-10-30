# Canvas

> Перевод [английской версии](../canvas.md), commit `same-pr`.

Три Feature одной плоскости. **Node и Layout** — объекты на плоскости и то, как их двигают. **Find** ищет то, что есть на
Canvas. **Вставка изображений** кладёт на него картинку. Epic frame и Done shelf описаны на отдельной странице,
[Epic frames](epic-frames.md). Термины объяснены в [Concepts](concepts.md). У содержимого Node-ов свои страницы:
[Cards](cards.md), [Terminal](terminal.md), [Browser](browser.md), [Sessions](sessions.md).

## Node и Layout

### Behaviour

Canvas — бесконечная плоскость, по одной на Project. Node — любой объект на ней. Большинство Node-ов хранит место и размер
в Layout. Epic frame, Ticket и Subagent — Derived Node-ы: их место worfy считает из workflow.

| Node | Размер по умолчанию | Минимум вручную |
| --- | --- | --- |
| Note | 220 × 120 | 120 × 64 |
| Card | 360 × 280 | 160 × 100 |
| Session | 300 × 120 | 240 × 140; запущенная вне worfy 200 × 80 |
| Terminal | 560 × 340 | 240 × 120 |
| Browser | 640 × 440 | 360 × 200 |
| HANDOFF | 360 × 320 | 240 × 120 |
| Orchestrator | 360 × 200 | 240 × 120 |
| Image | по картинке, см. [Вставка изображений](#вставка-изображений) | 48 × 48 |

Node типа, которого в этой сборке нет, остаётся в Layout вместе с данными. Он рисуется как `Unknown node: <kind>`, и его
можно двигать.

**Перемещение.** На Windows здесь и дальше вместо ⌘ читайте Ctrl.

| Жест | Что делает |
| --- | --- |
| Колёсико | Двигает Canvas |
| ⌘ + колёсико, pinch | Меняет zoom вокруг указателя |
| ⌘= и ⌘− | Меняют zoom |
| Перетаскивание с зажатым Space, перетаскивание средней кнопкой | Двигает Canvas |
| Перетаскивание по пустому месту | Выделяет Node-ы, которые накрывает |
| Двойной клик по пустой плоскости | Создаёт Note |
| Правый клик по пустой плоскости | Открывает меню Canvas |

Zoom — от 0.2 до 2.5. Фон — сетка точек с шагом 16. Node-ы за пределами экрана не рисуются. Без Project-а view говорит
«Add a project to see its canvas.» Если Layout не загрузился, сказано почему: «The canvas could not be loaded: …». Пока
Project открывается, строка внизу слева показывает, как далеко продвинулась загрузка: workflow, Epic-и N из M, история
Session-ов. На этой Machine строка появляется только через 300 мс, поэтому маленький Project открывается без неё.

**Колёсико над Node.** Решает первое подошедшее правило:

1. Внутри Node под указателем никто колёсико не принимает: его берёт Canvas.
2. Pinch или ⌘ + колёсико: Canvas меняет zoom.
3. Node не активен: Canvas двигается.
4. Node — активный Terminal: прокручивается Terminal.
5. У активного Node под указателем есть что прокручивать: прокручивается содержимое, даже в конце прокрутки.
6. Иначе: Canvas двигается.

**Активный Node.** Обычный клик по Node, который можно выделить, выделяет его и делает активным. Клик по пустой плоскости, нажатие вне Node, Esc вне
Terminal или снятие выделения это заканчивают. Card принимает мышь только пока активна. Пока идёт перетаскивание, изменение
размера или сдвиг Canvas, ни одна Card мышь не принимает.

**Меню Canvas.** В нём «New browser», «New terminal», затем «Tidy up», «Arrange by Epic» и «Re-pack». В нём работают стрелки и
Esc. В Command palette те же команды, а «New …» оттуда создаёт Node в середине Canvas.

**Selection toolbar.** Появляется рядом с выделением: сверху, справа, слева или под кнопкой Focus, там, где ничего не
закрывает, иначе там, где закрывает меньше всего. У закреплённого выделения он всегда сверху.

- **Pin или Unpin.**
- **Теги.** «Add tag» принимает до 40 символов. Enter добавляет, Esc отменяет, уход из поля отправляет, × удаляет. У тега,
  который есть только у части выделения, показано, у скольких он есть.
- **Delete.** Неактивна с tooltip «This cannot be deleted», когда из выделенного удалить нечего. Отказы видны в toolbar.
- **Show family.** При одном выделенном Node с Family камера показывает всю Family, не увеличивая zoom. Участников, скрытых
  фильтром по тегу, она пропускает. Работает и на read-only экране.

Кнопка Focus под выделением и ⌘↩ открывают выделение в focus mode.

**Клавиши.** Пока Canvas на экране, а фокус на нём или нигде и не в текстовом поле: Delete и Backspace отправляют выделение в
Trash, ⌘Z и ⇧⌘Z отменяют и возвращают, Esc без выделения сворачивает стопку done, открытую последней.

**Node-ы не перекрываются.** Node, брошенный на другой, встаёт на ближайшее свободное место с зазором 16. Выигрывает более
близкое место, затем с меньшим сдвигом по вертикали, затем то, что правее, затем то, что ниже. Пунктирная рамка показывает
место посадки во время перетаскивания. Группа двигается целиком и сохраняет расстояния внутри себя. Соседи не двигаются. При
изменении размера край останавливается за 16 до соседа. Закреплённые, скрытые, архивные и Derived Node-ы для этого правила не
препятствия.

**Прилипание.** При перетаскивании каждая ось прилипает к ближайшему в пределах 6 пикселей экрана: к линии выравнивания (левый
край, центр или правый край; верх, центр или низ Node на экране) или к равному зазору в ряду или колонке. При равенстве
выигрывает линия. Если нет ни того ни другого, ось прилипает к сетке 8. Зажатая ⌘ выключает прилипание, но Node-ы всё равно не
перекрываются. Группа двигается по сдвигу того Node, который тащат.

**Закрепление.** Закреплённый Node стоит на своём месте на экране и сохраняет размер на экране, пока Canvas двигается и меняет
zoom. Он рисуется поверх других Node-ов, возвращается внутрь, когда окно становится меньше, и не заходит в угол minimap. Его
нельзя перетащить: его открепляют, двигают и закрепляют снова. Закрепление и открепление не сдвигают его на экране.

**Теги.** Теги Node видны на полоске. `Show only tag <tag>` в Command palette скрывает все Node-ы без этого тега и линии к ним, а chip
внизу по центру говорит `Only tag <tag>` и даёт «Show all». Фильтр принадлежит окну и не сохраняется.

**Tidy up.** Укладывает все Layout Node-ы на плоскости в порядке чтения от левого верхнего угла их текущего охватывающего
прямоугольника, с зазором 24 по сетке 8. Session и её дерево Subagent-ов считаются одним прямоугольником. Размеры не меняются.
Закреплённые и скрытые Node-ы остаются на месте, Epic frame-ы не затрагиваются. Если Node-ов меньше двух или все уже на местах,
ничего не делает. Это один шаг undo. При сбое Node-ы остаются на своих местах.

**Arrange by Epic.** Двигает только Session Node-ы на плоскости без Keep. Они встают одной колонкой на 48 правее
[полосы Epic frame-ов](epic-frames.md#epic-frame), группами по Epic-ам от высоты заголовка рамки, 24 между Node-ами и 48 между
группами. Session-ы без Binding и привязанные к Epic-у на Done shelf стоят ниже под Unbound. Без полосы команда ничего не делает,
второй запуск ничего не меняет.

**Новые Node-ы.** Node, который worfy создаёт сам, например Orchestrator, HANDOFF или новая Session, встаёт в (40, 40), если этого
места не перекрывает ни один Node на плоскости, иначе под всеми Node-ами на плоскости. Новая Session с Binding встаёт правее
полосы, на высоте своего Ticket-а или заголовка своего Epic-а. Node, уже стоящий на Canvas, туда не переносится, когда Binding
появляется позже.

**Undo.** ⌘Z отменяет до 40 шагов жестов пользователя на этом экране. У каждого Project-а одна история, новый шаг очищает redo.
Групповой сдвиг или удаление — один шаг. То, что сделали агент, main или другой экран, в историю не входит. Если другой экран
успел изменить ту же сторону того же Node, шаг выбрасывается с toast «Not undone: this Node was changed on another screen» или
«Not redone: …». У текста Note свой undo внутри Note.

**Trash.** Удалить можно Card, Note, Terminal, Session Node и изображение. Заблокированные Node-ы, такие как Orchestrator и
HANDOFF, нельзя, как и Session Node с работающей Session. Удалённые Node-ы 3 дня лежат в Trash, он открывается кнопкой внизу по
центру, новые сверху, у каждого Restore. Restore возвращает Node с тем же id, на старое место, если оно свободно, иначе на ближайшее свободное. Card переносится со своими файлами
и данными, изображение — со своим файлом, если его не показывает другой Node.

**Archive.** worfy сам убирает с Canvas законченные Session Node-ы, ничего не удаляя. Правило запускается при первом чтении
Layout-а Project-а и каждые 10 минут. Оно берёт Session Node, Session которого не live, без Keep, не закреплённый и не тронутый
пользователем в пределах порога, когда выполняется одно из условий:

- Последняя запись транскрипта старше порога: Never, 6 h, 24 h (по умолчанию), 3 days или 7 days в Settings → Canvas. Never
  выключает правило.
- Включено «…and when their Ticket is done» (по умолчанию включено), и его Ticket готов, через час после последней записи.

Если транскрипт времени не сообщает, счёт идёт от последнего касания Node. Toast говорит «Archived N finished sessions» и даёт
Undo: он возвращает только эту партию и не является шагом ⌘Z. «Archive N» рядом с Trash показывает архивные Session-ы без Binding,
новые сверху, с поиском по названию, Restore на каждой строке и «Restore all from today». Session-ы с Binding находятся в истории
своего Ticket-а или Epic-а. Session, которую продолжили, возвращается. Восстановленный Node встаёт на старое место, если оно
свободно, иначе на ближайшее свободное. «Archive finished sessions now» в Command palette — один шаг ⌘Z, и пока настройка Never, берёт
порог 24 h.

**Камера.** Сдвиг и zoom сохраняются на Project и на Machine, общие для всех окон, и только если изменились.

**Minimap.** Стоит внизу справа, 200 × 150, Node-ы окрашены по типу. Перетаскивание двигает Canvas, клик ставит туда центр. View ▸
Show Minimap включает и выключает его.

#### On a Linked machine

Что разрешает Canvas её Project-а, решает уровень доступа этой Machine. При Full access перемещение и правка Node-ов работают, как
описано здесь, исключение — изображения, см. [Вставка изображений](#вставка-изображений). При Read only об этом говорит надпись
вверху по центру. Сдвиг, zoom, Find и Show family работают. Node-ы не двигаются и не имеют resize handle, действия неактивны с
tooltip, ⌘Z ничего не делает. Trash можно просмотреть, но нельзя восстановить из него, а у toast архива нет Undo.

В обоих случаях строка загрузки появляется сразу, без задержки 300 мс, а камера хранится на этой Machine, отдельно для каждого
Project-а Linked machine.

#### Windows

Ctrl заменяет ⌘. Внутри Terminal Node сочетания Ctrl с клавишей принадлежат shell-у, а не Canvas. Исключение — zoom: Ctrl+= и Ctrl+−
оттуда всё равно меняют zoom Canvas, а в плитке focus mode не делают ничего. Ctrl+_ остаётся undo shell-а.

### How it works

**main — единственный, кто пишет Layout.** Renderer и инструменты Canvas MCP посылают ему одни и те же операции: агент меняет Canvas
через инструменты, а не правкой файла ([ADR-0003](../../adr/0003-cards-as-files-canvas-via-tools.md)). Layout — собственное состояние
worfy, а не часть workflow ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).

**Правило неперекрытия лежит в общем коде**, поэтому предпросмотр перетаскивания и проверка в main дают один ответ
([ADR-0038](../../adr/0038-nodes-never-overlap.md)).

**Undo живёт в renderer, на экран.** Каждый экран отменяет только свои жесты, потому что один Project могут показывать два экрана
([ADR-0016](../../adr/0016-trash-folder-per-entry-undo-in-renderer.md),
[ADR-0053](../../adr/0053-several-screens-on-one-project.md)). Архив — не жест пользователя
([ADR-0076](../../adr/0076-auto-archive-of-finished-sessions.md)). Read only — один из уровней доступа, которые Machine даёт каждой
Linked machine ([ADR-0066](../../adr/0066-read-only-access-for-a-linked-machine.md)).

**Типы Node-ов берутся из файлов.** Каждый файл `*Node.tsx` регистрирует себя и сам задаёт свой пункт меню Canvas
([ADR-0014](../../adr/0014-canvas-menu-items-from-node-type-files.md)).

### Implementation

| Модуль | Что в нём |
| --- | --- |
| `src/shared/layout/types.ts` | Node, Layout и схема операций с ограничениями |
| `src/shared/layout/free-place.ts` | Правило неперекрытия: `NODE_GAP`, ближайший свободный сдвиг, как останавливается resize |
| `src/shared/layout/derived.ts` | Какие Node-ы на плоскости, и id Derived Node-ов |
| `src/main/layout/store.ts` | `LayoutStore`: применяет операции, отказывает, расставляет Node-ы, сохраняет `layout.json` |
| `src/main/layout/upgrade.ts` | Что чтение старого `layout.json` убирает или сдвигает, один раз |
| `src/main/layout/place.ts` | Место нового Node |
| `src/main/layout/viewports.ts` | Камера на Project и Machine, в `viewports.json` |
| `src/main/layout/trash.ts`, `src/shared/ipc/trash.ts` | Папки Trash, какие типы можно удалять, отказы, очистка при старте приложения |
| `src/main/layout/archive.ts` | Правило архива и его таймер |
| `src/main/ipc/layout.ts`, `src/shared/ipc/layout.ts` | IPC Layout-а и сохранение при выходе |
| `src/renderer/canvas/Canvas.tsx` | Поверхность React Flow, жесты и клавиши zoom |
| `src/renderer/canvas/useLayout.ts` | Хранилище Layout-а в окне, оптимистичные операции |
| `src/renderer/canvas/flow-nodes.ts` | Превращает Layout в Node-ы React Flow, сохраняет выделение и геометрию занятых Node-ов |
| `src/renderer/canvas/nodes/index.ts` | Registry типов Node-ов и неизвестный тип |
| `src/renderer/canvas/extensions.ts` | Registry overlay-ев, линий и источников Node-ов |
| `src/renderer/canvas/wheel-router.ts` | Правила колёсика над Node |
| `src/renderer/canvas/snapping.ts`, `src/renderer/canvas/NodeResizeClamp.tsx` | Прилипание и остановка resize |
| `src/renderer/canvas/pinning.ts` | Координаты закреплённого Node на экране и на плоскости, место toolbar |
| `src/renderer/canvas/history.ts` | Undo и redo |
| `src/renderer/canvas/tidy.ts`, `src/renderer/canvas/arrange-by-epic.ts` | Две команды раскладки |
| `src/renderer/canvas/overlays/` | Меню, toolbar, Trash, Archive, minimap, надпись read-only, линии прилипания |
| `src/renderer/settings/CanvasSection.tsx` | Настройки архива |

**Поток данных при перетаскивании.** React Flow сразу двигает Node. `sendLayoutOp` посылает `layout.apply`. `LayoutStore.apply`
проверяет операцию по схеме и своим правилам, расставляет Node через `settle`, поднимает revision и сохраняет после 250 мс тишины,
но не позже 1000 мс после первого изменения. Затем рассылает `layout.changed`, а `acceptLayoutState` держит самую высокую revision.
Отклонённая операция возвращает Node-ы на места из main.

**Ограничения.** Координаты — до ±10 000 000. Id Node — до 200 символов, тип — до 100. `moveMany`, `archive` и `restore` называют до
5000 Node-ов.

**Главные test-ы:**

- `test/contract/layout-store.test.ts`, `test/contract/layout-pin-tag.test.ts`: операции и отказы.
- `test/unit/free-place.test.ts`: правило неперекрытия.
- `test/unit/snapping.test.ts`, `test/e2e/snapping.spec.ts`: прилипание.
- `test/unit/wheel-router.test.ts`, `test/e2e/wheel-over-nodes.spec.ts`: колёсико.
- `test/unit/history.test.ts`, `test/e2e/trash-undo.spec.ts`: undo.
- `test/unit/tidy.test.tsx`, `test/unit/arrange-by-epic.test.ts`: команды раскладки.
- `test/contract/trash.test.ts`, `test/contract/layout-archive.test.ts`: Trash и архив.
- `test/unit/pinning.test.tsx`, `test/e2e/pin-tags.spec.ts`: закрепление и теги.
- `test/contract/viewport-store.test.ts`: камера.

## Find

### Behaviour

⌘F, пока Canvas на экране, открывает панель вверху по центру, «Find on the Canvas». Второе ⌘F возвращает в поле, выделяет его текст и
заново берёт выделение.

**Что читает:**

| Поле | Текст |
| --- | --- |
| title | Имя и заголовок Epic-а; заголовок Node или первая непустая строка его текста, до 120 символов |
| ticket | `epic/NN` и заголовок Ticket-а |
| transcript | Текст ассистента, пользователя и notice Session-ов, открытых в этом окне, включая текст в потоке |
| HANDOFF | Документ, один раз, для первого показанного HANDOFF Node, когда он прочитан |
| card | Видимый текст Card с работающей страницей, через 250 мс после движения Canvas, с повтором через 1500 мс |

Скрытые и архивные Node-ы не находятся. Card, которая не ответила, сохраняет свой последний текст.

**Запрос.** Без учёта регистра, с обрезкой и схлопыванием пробелов. Минимум два символа. Счётчик говорит «No matches», «N matches» или
«k of N», а на пределе 1000 — «1000+». Считается каждое вхождение. Если на момент последнего ⌘F были выделены Node-ы, поиск идёт только
в них и их детях, и панель об этом говорит.

**Переходы.** Enter и ⇧Enter или кнопки ↑ ↓ переходят к следующему и предыдущему совпадению по кругу. Esc или × закрывают. Совпадения
идут в порядке чтения: сверху вниз, слева направо, затем node, ticket, handoff, card, transcript. Совпадения без места идут последними.
Переход к совпадению не меняет выделение.

**Камера.** Ставит совпадение в центр за 250 мс при наименьшем из трёх: 2.5, zoom, в который оно помещается с отступом 64, и большее из
текущего zoom и 0.6. Ticket в свёрнутой рамке или сложенной стопке ставит в центр рамку. Epic на
[Done shelf](epic-frames.md#done-shelf) ставит в центр свой chip.

**Отметки.** До 200 совпавших Node-ов получают пунктирную рамку 1 px. Текущий получает сплошную 2 px. Строка под полем показывает имя
поля и текст вокруг совпадения, по 32 символа с каждой стороны. Find ничего не меняет и не сохраняет.

**Go to в Command palette.** В списке Orchestrator, Epic-и, Ticket-ы (по `07`, `7` или `epic/07`), Node-ы и ADR. Архивный или скрытый Node сначала
возвращается. Камера ждёт до 60 кадров, пока Node нарисуется. После 20 кадров она берёт рамку вокруг Node, если она есть.

#### On a Linked machine

Панель Find работает так же: она только читает. При Read only строка Go to архивного или скрытого Node неактивна с tooltip, потому что его
возвращение меняет Layout.

#### Windows

Ctrl+F открывает панель. Внутри Terminal Node Ctrl+F принадлежит shell-у.

### How it works

Ввод только ищет по индексу, который обновляется, когда меняются его источники. Запрос, который только вырос, сужает прежние совпадения.
Правило Terminal Node одно для всех сочетаний и не относится именно к Find: на Windows Ctrl с клавишей в shell-е принадлежат shell-у.

### Implementation

| Модуль | Что в нём |
| --- | --- |
| `src/renderer/find/CanvasFind.tsx` | Панель, её клавиши, рамки, источники, которые она собирает, и ожидание Node |
| `src/renderer/find/search-index.ts` | Индекс, нормализованный запрос, предел, порядок чтения и фрагмент текста |
| `src/renderer/find/canvas-requests.ts` | Запросы из Command palette |
| `src/renderer/find/node-rect.ts` | Где совпадение на плоскости, с chip-ом Epic-а на Done shelf |
| `src/renderer/canvas/overlays/CanvasFind.tsx` | Её место на Canvas |
| `src/renderer/palette/commands.ts` | Строки Go to и команды раскладки |
| `src/renderer/shortcuts/match.ts` | Правило Terminal Node |

**Главные test-ы:**

- `test/unit/search-index.test.ts`: индекс, запрос и порядок.
- `test/e2e/palette-find.spec.ts`: Find и Go to в настоящем окне.

## Вставка изображений

### Behaviour

**Вставка и перетаскивание.** ⌘V кладёт изображение из буфера обмена на Canvas, пока Canvas на экране, а фокус на нём или нигде и не в
текстовом месте. Оно встаёт под указателем, если указатель над Canvas, иначе в середине. Перетаскивание работает только на пустую плоскость:
файл, брошенный на Node, принадлежит Node, а Session берёт его вложением. Само окно брошенный файл никогда не открывает.

**Размер на Canvas.** Изображение начинает с натурального размера, уменьшенного так, чтобы длинная сторона была не больше 480, и никогда не
увеличивается. Каждая сторона не меньше 48. Первое изображение центрируется в точке, следующие идут каскадом с шагом 32. Несколько изображений
— один шаг undo. Вставленное изображение без имени файла называется в сообщениях «Pasted image».

**Что принимается.**

| Файл | Ответ |
| --- | --- |
| PNG, JPEG, GIF или WebP до 20 МБ | Принимается |
| Больше 20 МБ | `<name> is too large: images on the canvas go up to 20 MB` |
| SVG | `<name> is an SVG image, which the canvas does not take: use a PNG, JPEG, GIF or WebP` |
| Другой тип | `<name> is not a supported image: use a PNG, JPEG, GIF or WebP` |
| Сломанный заголовок | `<name> could not be read as an image` |

Тип определяется по первым байтам файла, а не по имени. Каждый отказ показывается, а остальные изображения продолжают добавляться.

**Node.** Размер меняется свободно, ширина и высота отдельно, до 48 × 48. Картинка вписана и центрирована, никогда не растянута. Фото с поворотом
в EXIF начинает с переставленными шириной и высотой, потому что ориентация не читается. Если изображение показать нельзя, на плашке написано
«Image not available» или «Image too large».

**Срок жизни.** Файл лежит в папке данных Project-а. ⌘Z вставки убирает Node и оставляет файл для ⇧⌘Z. Trash переносит файл вместе с записью, если
его не показывает другой Node. При старте приложения файл, который не показывает ни один Node, удаляется, если он старше 10 минут. Ничего не удаляется,
если Layout-у нельзя доверять: нет `layout.json`, он не разбирается или рядом лежит `layout.json.unreadable-*`.

#### On a Linked machine

Добавлять изображения нельзя при любом уровне доступа. При Read only вставка или перетаскивание показывает надпись read-only как toast. При Full access
появляется «Images can't be added to a Linked machine's canvas yet: paste or drop them on this machine's canvas». main тоже отказывает на такой вызов.
Изображения, которые уже есть на этом Canvas, показываются, без resize handle, и Delete их не трогает. Если Machine недоступна, на плашке написано
«Image not available: the Linked machine is not reachable».

#### Windows

Прежде чем протокол `worfy-image://` прочитает файл, он проходит путь и читает каждую ссылку, не переходя по ней. На ссылку, ведущую на сетевой путь,
приходит 404, потому что переход по ней обратился бы к этому хосту и передал ему учётные данные пользователя.

### How it works

**Изображения лежат в собственной папке данных worfy**, рядом с Layout, поэтому картинка на Canvas не трогает репозиторий
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)).

**Их отдаёт отдельный протокол.** Окно получает файл только по шаблону из 32 шестнадцатеричных цифр и расширения в одной известной папке, а ответ закрыт:
`default-src 'none'`, `nosniff` и `no-store`. Одна и та же форма адреса обслуживает изображения и этой Machine, и Linked machine.

### Implementation

| Модуль | Что в нём |
| --- | --- |
| `src/renderer/canvas/overlays/ImageDrop.tsx` | Вставка и перетаскивание, правила, где они работают |
| `src/renderer/canvas/image-drop.ts` | Размер на Canvas, каскад, проверка до чтения |
| `src/renderer/canvas/nodes/ImageNode.tsx`, `src/renderer/canvas/nodes/image-url.ts` | Node, его адрес и плашки |
| `src/shared/ipc/canvas-images.ts` | Ограничения, типы, сообщения, данные Node |
| `src/main/ipc/canvas-images.ts` | `canvasImage.add`, уборка при старте приложения |
| `src/main/layout/images.ts` | `storeImage` и `sweepImages` |
| `src/main/images/protocol.ts`, `src/main/images/stores.ts`, `src/shared/images.ts` | Протокол `worfy-image://` и его хранилища |
| `src/main/images/remote.ts`, `src/shared/ipc/images.ts` | Байты изображения Linked machine |
| `src/main/remote-links.ts` | Проход по ссылкам, ведущим за пределы Machine |

**Поток данных.** Вставка или перетаскивание проверяет размер, читает байты и посылает их через `canvasImage.add`. `storeImage` проверяет размер и первые
байты, читает натуральный размер из заголовка и пишет `<Project data folder>/images/<id>.<ext>`, не перезаписывая. Затем renderer создаёт Node одной
операцией `create` на изображение. Node запрашивает `worfy-image://canvas.<project label>/<file>`, а для Linked machine — с `.<machine label>` после метки.
Там байты приходят кусками через `images.file` и проверяются снова: 404, если нет файла или Machine неизвестна, 413, если слишком большой, 502, если недоступна.
Обслуживаются только GET и HEAD.

**Главные test-ы:**

- `test/unit/image-drop-overlay.test.tsx`, `test/unit/image-node.test.tsx`: вставка, перетаскивание, Node и плашки.
- `test/contract/canvas-images.test.ts`, `test/contract/image-store.test.ts`: типы, размеры, уборка.
- `test/contract/canvas-image-protocol.test.ts`, `test/contract/linked-image-protocol.test.ts`: протокол.
- `test/e2e/canvas-image.spec.ts`, `test/e2e/linked-images.spec.ts`: в настоящем окне.
