# 13 — Terminal: выделение мышью при масштабе и размер pty после focus mode

Type: task
Status: done 2026-10-06
PR: #49
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C; Ticket-ы 27 и 28 worfy-mvp (Terminal, focus mode)

## Что делаем

Две ошибки Terminal Node-а.

**1. Выделение мышью уезжает при масштабе Canvas ≠ 100%.** xterm живёт внутри CSS
`transform: scale`. xterm.js считает координаты мыши без учёта transform — это известная проблема
xterm.js. В `src/renderer/canvas/nodes/TerminalNode.tsx` её никто не обрабатывает.

**2. Ширина pty остаётся шириной плитки после выхода из focus mode.** Вывод из кода, не
воспроизведён:

- focus mode (`src/renderer/focus/FocusMode.tsx:95-98`) рисует второй TerminalNode с тем же `nodeId`
  в плитке, а Canvas держит свою копию смонтированной;
- оба шлют `terminal.resize` (`TerminalNode.tsx:106-108`), и побеждает последний;
- после выхода размер коробки Canvas-копии не изменился, поэтому ResizeObserver (`:112-116`) не
  срабатывает, и pty остаётся с размером плитки.

**Первый шаг — воспроизвести обе ошибки e2e-ом.** Итог — в «Итог».

**Правки:**

- **(1)** Перевести координаты мыши с учётом масштаба Canvas. Или выбрать другой способ, найденный
  при воспроизведении, — например, рисовать Terminal без transform. Выбор — в «Итог».
- **(2)** Вариант первый: при выходе из focus mode Canvas-копия явно подгоняет размер (fit) и шлёт
  `terminal.resize`. Вариант второй: Canvas-копия не монтируется под слоем focus mode.
- Шапка `TerminalNode.tsx` описывает attach/detach, но не два одновременных view одного shell. Если
  правка меняет это устройство — ADR (номер с 0022).

## Готово, когда

- [x] При масштабе 50% и 150% выделение мышью от символа A до символа B выделяет ровно A…B: e2e читает выделение xterm.
- [x] После входа в focus mode и выхода `stty size` в Terminal равен размеру Canvas-копии (cols × rows по `fittedSize`, `:46-51`).
- [x] Ввод и вывод в Terminal после focus mode работают: существующий `terminal.spec.ts` зелёный.
- [x] Снимки Terminal на Canvas и в focus mode в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/terminal.spec.ts` — выделение при масштабе.
- `test/e2e/focus.spec.ts` — `stty size` после выхода из focus mode.
- Сначала падающий test: после выхода из focus mode `stty size` равен размеру плитки.

## Где в коде

- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/focus/FocusMode.tsx`
- `test/e2e/terminal.spec.ts`
- `test/e2e/focus.spec.ts`

## Итог

Сделано в ветке `worfy-daily/13`. ADR не заводился (решение брифа волны); устройство «два view одного shell» описано в шапке `TerminalNode.tsx`.

- **Воспроизведение до правки.** Новые e2e были красными на `origin/main`: при масштабе 50% протяжка мышью от `A` до `J` выделяла `-MacB` (кусок приглашения shell строкой выше), при 150% — пустую строку; после выхода из focus mode `stty size` давал 48×172 (размер плитки) вместо 21×74 (размер Canvas-копии). Вывод тикета о причине второй ошибки подтвердился.
- **(1) Масштаб.** Выбран перевод координат мыши, а не отрисовка Terminal без transform: React Flow рисует все Node-ы внутри одного `transform: scale`, вынести один Node из него — значит рисовать его отдельным слоем и самим следить за pan и zoom. xterm.js 6 считает клетку как `(clientX − rect.left) / cssCellWidth`, где `rect` — масштабированная коробка `.xterm-screen`, а ширина клетки — без масштаба. `unscaleMouse` в `TerminalNode.tsx` слушает mouse-события на `window` в фазе capture (раньше всех слушателей xterm.js) и подменяет у события `clientX`/`clientY` собственным свойством: `left + (clientX − left) / scale`. Подменяются события над терминалом и движения и отпускание после нажатия в нём (выделение тянется за пределы терминала). При масштабе 1 события не трогаются. Внутренний API xterm.js (`_core._mouseService`) не используется.
- **(2) Размер pty.** Выбран вариант «последний смонтированный view задаёт размер»: модульный список view-ов каждого shell в порядке монтирования; `terminal.resize` шлёт только последний; когда он размонтируется, предыдущий подгоняет себя (fit) и шлёт свой размер. Так после выхода из focus mode Canvas-копия возвращает pty свой размер, а пока focus mode открыт, изменение коробки Canvas-копии (например, `layout.apply resize` от инструмента) не перебивает размер плитки. Canvas-копия под слоем по-прежнему смонтирована: вывод и состояние не теряются. `FocusMode.tsx` не менялся.
- **Тесты.** `test/e2e/terminal.spec.ts` — два теста «at Canvas zoom 50% / 150% a mouse drag … selects exactly those characters»: выделение читается из события `copy` с собственным `DataTransfer` (системный буфер обмена не трогается). `test/e2e/focus.spec.ts` — «a Terminal in focus mode gets the size of its tile, and after leaving focus mode the pty has the size of the Canvas Node again»: `stty size` на Canvas, в плитке и снова на Canvas, затем ввод и вывод на Canvas-копии.
- **Круг доработки (REJECTED по PR #49).** (а) С двумя Terminal Node-ами у каждого был свой слушатель на `window`, и событие пересчитывал первый терминал под курсором, а не тот, где началось нажатие: протяжка из A над B выделяла чужие строки. Теперь один слушатель на все терминалы (`src/renderer/canvas/nodes/terminal-mouse.ts`): пока длится нажатие, начавшееся над терминалом, его события пересчитываются только для этого терминала. Нажатие кончается на `mouseup`, на движении без нажатых кнопок (отпустили вне окна) и на следующем `mousedown`. Список view-ов вынесен в `terminal-views.ts`. Тесты — jsdom `test/unit/terminal-mouse.test.tsx` (два терминала с разными rect-ами, масштаб 0.5) и `test/unit/terminal-views.test.tsx`; e2e — «a drag that began in one terminal and goes over another selects in the first» и продолжение focus-test: Canvas Node меняет размер при открытом focus mode, pty сохраняет размер плитки, после выхода — новый размер Canvas Node. Каждое поведение проверено мутантом (8 мутантов на unit-тесты, 2 на e2e — все красные).
- **Снимки.** Тот же focus-test снимает окно в светлой и тёмной теме (`emulateMedia`) на Canvas и в focus mode и проверяет вычисленные цвета терминала по таблице F-SPEC: фон `#1D1D1F` / `#0B0A09`, текст `#E5E5EA` / `#ECE8E1`. Четыре снимка просмотрены глазами: структура одинакова, меняются только цвета.
- **Снимки проверяющего** (после круга доработки, две Terminal Node-ы при масштабе 50%, протяжка из одной над другой): [13-two-terminals-50-drag-light.png](../evidence/13-two-terminals-50-drag-light.png), [13-two-terminals-50-drag-dark.png](../evidence/13-two-terminals-50-drag-dark.png).

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M4 второго круга ручных проверок). Режим А: свой экземпляр
бинарника Stable copy из 5060858 (CDP на порту 9352), папка данных и Project — во временной папке со
своим git-репозиторием; репозиторий CanvasForAI не открывался.

- Terminal создан правым щелчком мыши ОС (CGEvent) по пустому Canvas → «New terminal». В нём
  выполнено `echo ABCDEFGHIJ`.
- Протяжка мышью ОС (CGEvent: нажатие, 12 шагов перетаскивания, отпускание) от 1/4 клетки A до 3/4
  клетки J, координаты — по `Range` символов строки xterm. Копирование — ⌘C.
- В буфере ровно «ABCDEFGHIJ» (10 байт) при масштабе 0.482 (4×⌘−), 0.5, 1.493 (6×⌘=) и 1.5.
  Ровно 0.5 и 1.5 клавишами недостижимы: ⌘−/⌘= меняют масштаб в 1.2 раза (0.833, 0.694, 0.579,
  0.482), поэтому они заданы через `layout.apply setViewport` с перезагрузкой. Контрольная протяжка
  по слову «echo» при 1.5 дала ровно «echo». На всех снимках подсвечено только ABCDEFGHIJ.
- Наблюдение, не воспроизвелось: в первой попытке первый щелчок в только что созданный Terminal не
  дал ему focus (`activeElement` остался `body`). Набранный текст в shell не попал, а Canvas сдвинулся
  на (−194, +364) при zoom 1. Лога событий в тот момент не было. Со вторым новым Terminal первый
  щелчок сразу дал focus в xterm.
- Не проверено, за владельцем: трекпад — касание, перетаскивание тремя пальцами, force click.
- Вердикт: проверено мышью ОС; трекпад — за владельцем.
- Снимки (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M4-menu.png`,
  `M4-48.png`, `M4-50.png`, `M4-149.png`, `M4-150.png` и увеличенные `-zoom` к каждому.

### Долги из HANDOFF (2026-10-08)

- [low] `src/renderer/canvas/nodes/TerminalNode.tsx:171` — проверка `isLastView` после `terminal.open` без
  test-а.
- [low] Restart в focus mode оставляет копию на Canvas в состоянии «exited» (так было и до Ticket-а).
