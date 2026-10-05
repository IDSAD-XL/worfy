# 03 — Окно macOS с sidebar и toolbar, светлая и тёмная тема по системной настройке

Type: task
Status: done — 2026-10-05, [PR #4](https://github.com/IDSAD-XL/worfy/pull/4)
Blocked by: 01
Source: [F-SPEC.md](../../../docs/design/F-SPEC.md), разделы «Typography», «Shape», «Tokens»; макеты `docs/design/F-canvas-light.dc.html`, `F-canvas-dark.dc.html`; [BRIEF.md](../../../docs/design/BRIEF.md)

## Что делаем

Оболочка окна по выбранному дизайну F: нативная рамка macOS и плотная «графитовая» типографика
данных.

- Окно: `titleBarStyle: 'hiddenInset'`, светофор слева, unified toolbar, sidebar с эффектом
  полупрозрачности (`vibrancy: 'sidebar'`). Размер и положение окна запоминаются.
- Токены цвета из F-SPEC — CSS-переменные в `src/renderer/theme/tokens.css`. Светлые значения
  (палитра E) и тёмные (палитра Graphite) переключаются через
  `@media (prefers-color-scheme: dark)`; Electron передаёт системную настройку сам. Своего
  переключателя темы нет.
- Шрифты: системный UI-шрифт и `ui-monospace` с `tabular-nums` для всех id, путей, чисел,
  веток, моделей. Размеры 11/12/13/15/20, радиусы и сетка 4/8 px — из F-SPEC. В тёмной теме
  теней нет, только рамки 1 px.
- `AppShell.tsx`: sidebar + toolbar + основная область. Toolbar: имя Проекта и ветка (пока
  заглушки), сегментный переключатель Canvas / Session, подсказка «⌘K».
- Точки расширения: `Sidebar.tsx` собирает разделы из `src/renderer/shell/sidebar/*Section.tsx`,
  `Toolbar.tsx` — элементы из `src/renderer/shell/toolbar/*.tsx` (через `import.meta.glob`, с
  явным порядком в экспорте каждого модуля).
- Компоненты-примитивы, которые нужны всем следующим тикетам: строка списка 28 px, chip статуса
  (прямоугольник, радиус 4 px, цвет всегда с текстом или иконкой), кнопка основного действия,
  сегментный переключатель. Цвета статусов — ready, working, blocked, done — из таблицы токенов.

## Готово, когда

- [x] Окно открывается с нативным светофором и toolbar, без системной полосы заголовка.
- [x] Переключение системной темы меняет оформление без перезапуска.
- [x] Цвета фона, поверхности Узла, текста и статусов в обеих темах совпадают с F-SPEC (test сверяет вычисленные CSS-переменные со значениями из таблицы).
- [x] Контраст текста к фону ≥ 4.5:1 для text, secondary и muted в обеих темах.
- [x] Новый раздел sidebar появляется от одного нового файла `*Section.tsx` без правки `Sidebar.tsx`.
- [x] Положение и размер окна переживают перезапуск.

## Тесты

- `test/e2e/theme.spec.ts` — Playwright `emulateMedia({colorScheme})` для light и dark: значения CSS-переменных и наличие/отсутствие тени Узла (новый).
- `test/unit/contrast.test.ts` — расчёт контраста пар токенов (новый).
- Сначала падающий test: `theme.spec.ts` проверяет `--surface` = `#1B1A18` в dark до появления токенов.

## Где в коде

- `src/main/window.ts`
- `src/renderer/theme/tokens.css`, `src/renderer/theme/primitives.tsx`
- `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/Toolbar.tsx`
- `test/e2e/theme.spec.ts`

## Итог

Сделано: окно с `titleBarStyle: 'hiddenInset'`, светофором в toolbar (`trafficLightPosition` 20/19 —
по центру toolbar высотой 52 px), `vibrancy: 'sidebar'`; токены F-SPEC в `tokens.css` для обеих
тем; примитивы (строка 28 px, chip статуса, кнопка основного действия, сегментный
переключатель); `AppShell` с sidebar, toolbar и основной областью (Canvas / Session); положение
и размер окна сохраняются.

Решения, которых нет в тикете:

- **Контракт точки расширения.** Файл `src/renderer/shell/sidebar/<Имя>Section.tsx` или
  `src/renderer/shell/toolbar/<Имя>.tsx` экспортирует компонент по умолчанию и
  `export const order = <число>`; меньший `order` — выше (левее), при равенстве — по имени файла.
  Компонентом считается функция или класс, а также обёртки `memo`, `forwardRef`, `lazy` (объекты с
  `$$typeof`). Модуль без компонента или без числового `order` бросает ошибку
  (`src/renderer/shell/registry.ts`) уже при загрузке `Sidebar.tsx` / `Toolbar.tsx`: renderer не
  монтируется, краснеют все e2e-tests, а забытый экспорт не пропадает молча. Элементы toolbar
  стоят между переключателем Canvas / Session и подсказкой ⌘K.
- **Оба вида остаются смонтированными.** Неактивный вид (Canvas или Session) скрыт атрибутом
  `hidden`, а не размонтирован: иначе каждое переключение уничтожало бы экземпляр React Flow
  (тикет 05) и терминалы xterm.js (тикет 27) со всем их состоянием в памяти.
- **Кто заполняет слоты `AppShell`** (`project`, `canvas`, `session`): `src/renderer/main.tsx`,
  единственное место, где `AppShell` монтируется. В следах тикетов 04 (Проект в toolbar),
  05 (`Canvas.tsx`) и 33 (`SessionView.tsx`) этого файла нет — оркестратору: добавить
  `src/renderer/main.tsx` в «Где в коде» этих тикетов. Каждый меняет одну строку — свой prop;
  тикеты в волнах 3, 4 и 6, так что правки идут по очереди, а не параллельно. Отдельную точку
  расширения для видов не завожу: видов ровно два, оба названы в эпике, и механизм поиска файлов
  ради двух постоянных мест сложнее одной строки в `main.tsx`.
- **Состояние окна** — `<WORFY_DATA_DIR>/window-state.json` (`{"bounds": {x, y, width, height}}`),
  пишется через временный файл и rename на `resized`, `moved` и `close`; сохраняются
  `getNormalBounds()`, то есть размер без развёртывания. Сохранённое положение берётся, только
  если на каком-то из текущих дисплеев видно не меньше 120×40 px окна (монитор могли отключить);
  иначе окно открывается 1280×800 по центру. Минимальный размер окна — 800×520. Это собственное
  состояние приложения в смысле ADR 0005, отдельного ADR не требует. Чистая часть — разбор,
  запись в JSON и геометрия (`parseWindowState`, `serializeWindowState`, `initialBounds`) — лежит
  в `src/shared/window/bounds.ts` и тестируется без Electron; `src/main/window.ts` только читает и
  пишет файл и создаёт окно. Чтение и атомарная запись пока свои: общего
  `src/main/storage/json-file.ts` ещё нет (тикет 04). Оркестратору: добавить в тикет 04 пункт —
  перевести `window-state.json` на `json-file.ts`, чтобы испорченный файл откладывался как у
  остальных хранилищ, а не молча перезаписывался.
- **Полупрозрачность sidebar.** Токен `--sidebar` хранит значение из F-SPEC без изменений, а
  сам sidebar закрашен `--sidebar-translucent` (тот же цвет, непрозрачность 0.8 / 0.82), фон
  `body` и окна прозрачный — так сквозь sidebar виден нативный vibrancy.
- **Токены сверх таблицы F-SPEC**: размеры шрифта 11/12/13/15/20, радиусы 10/10/8/6/4, сетка 4/8,
  `--segment-track` и `--segment-thumb` (цвета переключателя из макетов F), тени `--shadow-node`,
  `--shadow-control`, `--shadow-primary` — в тёмной теме все `none`. Класс `.w-node-surface` —
  поверхность Узла для тикета 05.
- **Переключателя темы нет**, хотя в макетах F есть кнопка Appearance: тикет запрещает свой
  переключатель, тема всегда системная.
- **Подсказка ⌘K** — статичный элемент («Search or run… ⌘K»), не кнопка: палитра появится в
  тикете 31, кнопка без действия вводила бы в заблуждение.
- **Toolbar без Проекта** показывает «worfy» и «No project»; с Проектом (`project` в `AppShell`,
  тикет 04) — «worfy — <имя>» и «<имя> · <ветка>» моноширинным.
- **Файлы вне следа тикета**: `src/renderer/main.tsx` (монтирует `AppShell` и `tokens.css` —
  без этого оболочки не видно), `src/renderer/theme/primitives.css`,
  `src/renderer/shell/registry.ts`, `src/renderer/shell/shell.css`, `src/shared/window/bounds.ts`;
  тесты `test/unit/contrast.test.ts` (назван в разделе «Тесты»), `test/unit/window-bounds.test.ts`,
  `test/unit/shell.test.tsx`, `test/unit/shell-discovery.test.tsx`, `test/e2e/window.spec.ts`.

Проверка:

- Сначала красный `test/e2e/theme.spec.ts`: в dark `--surface` был `""` вместо `#1B1A18`
  (6 из 7 тестов файла красные), после токенов — зелёный.
- `test/e2e/window.spec.ts`: контент окна занимает всё окно (системной полосы заголовка нет),
  позиция кнопок светофора 20/19, toolbar 52 px; позиция и размер переживают перезапуск. Если
  убрать сохранение (`window.on(... remember)`), второй тест краснеет — проверено. Третий тест
  двигает и меняет размер окна (`setBounds` с анимацией, как при перетаскивании), ждёт файл и
  убивает процесс `SIGKILL` без закрытия окна: положение уже на диске. Без обработчиков
  `resized` и `moved` он краснеет — проверено.
- Новый раздел без правки `Sidebar.tsx`: `test/unit/shell-discovery.test.tsx` на время теста
  кладёт `sidebar/ZzVitestProbeSection.tsx` и `toolbar/ZzVitestProbe.tsx`, заново импортирует
  настоящие `Sidebar.tsx` и `Toolbar.tsx` (query string заставляет Vite заново развернуть
  `import.meta.glob`) и находит оба элемента в DOM; файлы удаляются после теста. Если заменить
  glob в `Sidebar.tsx` на пустой список или исказить шаблон в `Toolbar.tsx`, test краснеет —
  проверено. Порядок и проверки экспорта — `test/unit/shell.test.tsx` (`collectExtensions`).
- Контраст: `test/unit/contrast.test.ts` читает `tokens.css` и проверяет ≥ 4.5:1 для text,
  secondary и muted на bg, canvas, sidebar, toolbar, surface, surface raised, а также accent,
  текста основного действия, chip-ов статусов и терминала — в обеих темах всё проходит.
- Смена темы без перезапуска: e2e переключает `nativeTheme.themeSource` dark → light в открытом
  окне, `--surface` меняется `#1B1A18` → `#FFFFFF`.
- Скриншоты страницы в обеих темах сохраняет `theme.spec.ts` (`test-results/…/window-{light,dark}.png`).

не проверено: вид нативной рамки (светофор, vibrancy sidebar) на снимке — `screencapture`
отвечает «could not create image from rect»: у терминала нет разрешения Screen Recording, а
скриншот страницы из Playwright нативных элементов окна не содержит. Положение кнопок и
отсутствие полосы заголовка проверены через API окна (выше).

не проверено: переключение темы в «Системных настройках» macOS — менять системные настройки
автоматически нельзя; проверен тот же путь через `nativeTheme.themeSource`, который Electron
передаёт в `prefers-color-scheme` так же, как системную настройку.

Круг исправления по ревью (тесты, `test/e2e/window.spec.ts`):

- Третий тест убивал процесс `SIGKILL` и не ждал его выхода: в `finally` проверка
  `process().killed` уже была истинной, `app.close()` пропускался, и `rm(dataDir)` мог идти, пока
  вспомогательные процессы Electron ещё пишут в каталог (ENOTEMPTY/EBUSY на медленной машине).
  Теперь тест подписывается на `exit` до `kill` и ждёт его (`once(appProcess, 'exit')`), а
  `app.close()` в `finally` вызывается, только если процесс ещё жив (`exitCode` и `signalCode`
  равны `null` — тест упал до `kill`).
- Временные каталоги в `window.spec.ts` удаляются с повторами:
  `rm(..., { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })`.
- Проверка: `playwright test test/e2e/window.spec.ts --repeat-each 10` — 30 из 30 зелёные.
  Первый полный `pnpm test:e2e` в этом круге упал на `launch.spec.ts` (первый запуск приложения
  не уложился в 60 с, тест не из этого тикета); повторный полный прогон — 12 из 12 зелёные.
