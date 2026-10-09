# worfy-ui: интерфейс и настройки

Status: по решениям владельца 2026-10-09 (девять пунктов раздела «Решения владельца»); выбор этого
docs-PR сверх них помечен «подтвердить», «Готово, когда» — предложение docs-PR, подтвердить
Source: просьбы владельца по интерфейсу 2026-10-09; [roadmap.md](../../docs/roadmap.md), раздел
«worfy-ui — интерфейс и настройки»; [CONTEXT.md](../../CONTEXT.md), термин Settings; ADR
[0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние worfy — в его папке данных),
[0052](../../docs/adr/0052-machines-and-linking.md), пункт 6 (пометка доступа у каждого канала IPC),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) (Session-ы на Mac и Windows,
платформенный PR); Epic [worfy-link](../worfy-link/spec.md) — формат и соглашения; Epic
[worfy-windows](../worfy-windows/spec.md) — Ticket 11 (Ctrl вместо ⌘ на Windows); Epic
`worfy-terminal-ai` (PR #202, не влит) — раздел Settings → «Terminal AI».
Ticket-ы: Epic `worfy-ui`, 12 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у worfy-link
и worfy-windows (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец работает в worfy каждый день и просит поправить то, что мешает: настройки самого worfy
разбросаны или их нет, интерфейс нельзя увеличить, боковая панель не сворачивается и не растёт с
окном, режим фокуса прячет её, выпадающие списки — системные, а сочетания клавиш нигде не
перечислены. Epic даёт worfy окно Settings и собирает в нём то, что относится к приложению, а не к
Project-у.

Epic готов, когда (предложение docs-PR, подтвердить):

1. Окно Settings открывается по Cmd/Ctrl+, и пунктом «Settings…» в меню. В нём разделы General,
   Health, Shortcuts и Machines; раздел другого Epic-а подключается своим файлом.
2. Масштаб интерфейса 80–150 % — ползунок в Settings → General и View ▸ Bigger / Smaller / Actual
   size (⌥⌘= / ⌥⌘− / ⌥⌘0, на Windows Ctrl+Alt). ⌘= и ⌘− по-прежнему масштабируют Canvas. Масштаб
   переживает перезапуск.
3. Каждая секция боковой панели сворачивается и помнит это между запусками. Списки растут с окном
   (от 3 до 15 строк). Machines свёрнута по умолчанию, у её заголовка — точка состояния;
   переключатели Machines — в Settings → Machines.
4. Режим фокуса оставляет боковую панель. Cmd/Ctrl+B прячет и показывает её везде; видимость
   помнится отдельно для обычного вида и для режима фокуса.
5. В палитре «Search or run…» — группы с заголовками. В composer-е effort — ползунок, Model и
   Permission mode — стилизованные списки; native `<select>` в renderer нет.
6. Окно Keyboard shortcuts (Cmd/Ctrl+/, «?», палитра, Settings → Shortcuts) показывает сочетания
   из одного реестра, с подписями своей системы.

Проверку всех пунктов делает Ticket 12. Подписи с Ctrl на Windows приходят из Ticket-а 11 Epic-а
worfy-windows; проверка на Windows — после приёмки того Epic-а.

## Как устроено

- **Настройки приложения** (Ticket 01). Новый файл `app-settings.json` в папке данных worfy —
  `dataRoot()` (`src/main/storage/paths.ts:30-34`), через `src/main/storage/json-file.ts` (схема
  zod, атомарная запись, нечитаемый файл откладывается). Схема сразу держит все поля Epic-а:
  `interfaceScale`, `sidebar.collapsed`, `sidebar.visible.normal` и `sidebar.visible.focus`. Тогда
  Ticket-ы 03, 04 и 10 файл схемы не правят и не делят. Каналы `appSettings.get`, `appSettings.set`
  и событие `appSettings.changed` помечены `local` (`src/shared/ipc/channels.ts:30-31`). Образец —
  домен `view` (`src/shared/ipc/view.ts`, `src/main/ipc/view.ts`), только с записью на диск.
  Renderer держит состояние zustand-store-ом с ревизией, как `useMachines`
  (`src/renderer/machines/useMachines.ts:20-23`). localStorage не используется (ADR-0005).
- **Переключатели Machines остаются там, где хранятся** — в `link/settings.json`
  (`src/main/link/settings.ts:1-8`). Settings → Machines зовёт те же каналы `link.setAccess` и
  `link.setKeepAwake` (`src/renderer/machines/useMachines.ts:63-64`). Переносится только UI.
- **Окно Settings** (Ticket 02). Модальный диалог внутри окна worfy, вид — как у First run
  (`docs/design/F-SPEC.md:101`). Слева список разделов, справа раздел. Раздел — файл
  `src/renderer/settings/<Name>Section.tsx` с компонентом по умолчанию, `order` и `title`. Окно
  находит файлы через `import.meta.glob`, как боковая панель (`src/renderer/shell/Sidebar.tsx:3-6`).
  Порядок: General 10, Health 20 (Ticket 06), Shortcuts 30 (Ticket 11), Machines 40 (Ticket 05);
  разделы других Epic-ов — от 50. Так Ticket 08 Epic-а `worfy-terminal-ai` добавляет
  `src/renderer/settings/TerminalAiSection.tsx`, не трогая окно. Общие элементы разделов —
  `SettingRow` и `SettingSwitch` (`src/renderer/settings/controls.tsx`).
- **Меню → окно.** Пункт меню, которому нужен renderer, шлёт окну в фокусе событие `menu.command`
  (новый домен `src/shared/ipc/menu.ts`, канал `local`): `settings` (Ticket 02), `toggleSidebar`
  (Ticket 10), `shortcuts` (Ticket 11). Ускоритель меню (`CmdOrCtrl+…`) Electron сам переводит в
  Ctrl на Windows.
- **Масштаб** (Ticket 03). Zoom всего окна — `webContents.setZoomFactor`, от 0.8 до 1.5 шагом 0.1.
  Растёт всё сразу: текст, Canvas, Terminal (его `fontSize: 12` задан в
  `src/renderer/canvas/nodes/TerminalNode.tsx:88`), Card-ы. Роли View `resetZoom`, `zoomIn`,
  `zoomOut` (`src/main/menu.ts:23-25`) уступают пунктам Bigger, Smaller и Actual size с Alt.
  ⌘= и ⌘− остаются масштабом Canvas (`src/renderer/canvas/Canvas.tsx:433-448`).
- **Боковая панель** (Ticket-ы 04 и 05). Общая рамка секции `src/renderer/shell/SidebarSection.tsx`:
  заголовок со стрелкой сворачивает секцию, свёрнутость — в `sidebar.collapsed`. Списки
  прокручиваются сами: от 3 до 15 строк по 28 px (`--row-height`,
  `src/renderer/theme/tokens.css:31`). Свободная высота делится между развёрнутыми секциями; когда
  её не хватает, прокручивается колонка целиком. Сейчас прокручивается только колонка
  (`src/renderer/shell/shell.css:25-32`), а свой предел есть лишь у списка ADR — 240 px
  (`src/renderer/shell/sidebar/AdrSection.tsx:18`).
- **Точка Machines** (Ticket 05). Считается в renderer из `useMachines()` без нового канала:
  зелёная с пульсацией — есть Linked machine `online` без `certificateChanged`; янтарная —
  `certificateChanged`; нет — никого в сети. Цвет не стоит один (`src/renderer/theme/primitives.tsx:40`):
  у точки есть `aria-label` и подсказка.
- **Режим фокуса** (Ticket 10). Слой уходит из `document.body` (`src/renderer/focus/FocusMode.tsx:320`,
  `:383`) внутрь `.w-shell__main`; `inert` получают только toolbar и вид, не боковая панель.
  Видимость панели — `sidebar.visible.normal` или `sidebar.visible.focus`, по тому, открыт ли
  режим фокуса.
- **Select** (Ticket-ы 08 и 09). Один компонент `src/renderer/theme/Select.tsx` — кнопка и список по
  образцу WAI-ARIA «select-only combobox»: стрелки, Enter, Esc, набор букв, ARIA. Он заменяет все
  пять native `<select>` в renderer: `src/renderer/projects/ConnectProject.tsx:634`,
  `src/renderer/harness/MigrationForm.tsx:212`, три в `src/renderer/session/composer/Pickers.tsx`
  (`:69`, `:85`, `:104`). Effort в composer-е — ползунок по уровням выбранной модели.
- **Палитра** (Ticket 07). Группы — после ранжирования: `rankItems` сортирует по весу
  (`src/renderer/find/search-index.ts:77-86`), и строки одной группы при вводе расходятся. Группа
  стоит по своей лучшей строке, внутри группы — порядок по весу.
- **Сочетания клавиш** (Ticket 11). Реестр `src/shared/shortcuts.ts` — один список для
  обработчиков renderer, подписей, ускорителей меню и окна Keyboard shortcuts. Проверка события и
  подпись своей системы — через `src/renderer/platform.ts` Ticket-а 11 worfy-windows.
- **Окно на Project-е Linked machine-а** показывает Settings своей Machine: каналы `local` идут на
  свою машину (`src/renderer/ipc.ts:5-11`).
- **ADR не заводится.** Признаки ADR — решение трудно отменить, оно неожиданно и в нём был настоящий
  выбор. Здесь их нет вместе:
  - файл `app-settings.json` и каналы `local` идут по принятым ADR-0005 и ADR-0052 (пункт 6);
  - перенос переключателей, свёрнутые секции, точка, группы палитры, Select — UI, отменяются без
    переноса данных;
  - zoom окна против размеров по токенам — настоящий выбор, но его сделал владелец (решение 3), и
    отмена — замена одного модуля main;
  - реестр сочетаний — устройство кода.

  Если Ticket при claim найдёт решение с такими признаками, номер ADR выдаёт Orchestrator.

## Этапы

1. **Основа** — 01, 02.
   - 01: `app-settings.json`, каналы `appSettings.*`, store в renderer.
   - 02: окно Settings, разделы по файлам, раздел General с версией, «Settings…» в меню (Cmd/Ctrl+,)
     и в палитре, домен `menu`.
2. **Масштаб** — 03: ползунок в General, View ▸ Bigger / Smaller / Actual size, zoom окна.
3. **Боковая панель** — 04, 05.
   - 04: рамка секции, свёрнутость, высота по окну.
   - 05: точка Machines, Machines свёрнута по умолчанию, переключатели — в Settings → Machines,
     правка e2e и шагов приёмки `worfy-link`.
4. **Health** — 06: проверки First run в Settings → Health.
5. **Палитра и списки** — 07, 08, 09.
   - 07: группы с заголовками в палитре.
   - 08: общий Select вместо native `<select>` вне composer-а.
   - 09: composer — effort-ползунок, Model и Permission mode на Select.
6. **Режим фокуса** — 10: боковая панель в режиме фокуса, Cmd/Ctrl+B, видимость помнится.
7. **Сочетания** — 11: реестр и окно Keyboard shortcuts. Ждёт Ticket 11 worfy-windows.
8. **Приёмка** — 12.

## Решения владельца

Просьбы владельца по интерфейсу 2026-10-09, все девять решены им самим. Номер — как здесь; Ticket-ы
ссылаются на него («решение 4»).

1. **Боковая панель и Machines.** Каждая секция сворачивается, свёрнутость помнится между
   запусками. Machines свёрнута по умолчанию. Рядом с «Machines» — зелёная точка с лёгкой
   пульсацией, когда хотя бы одна Linked machine в сети (`state` — `online`, без
   `certificateChanged`); нет никого — точки нет; изменился сертификат — статичная янтарная точка.
   У точки подсказка и `aria-label`; `prefers-reduced-motion` убирает пульсацию. Два переключателя
   уходят в Settings → Machines, в секции остаются список машин и «Link a machine…» (Ticket-ы 04,
   05).
2. **Settings** — модальный диалог внутри приложения, открывается по Cmd/Ctrl+, и пунктом меню
   «Settings…». Слева разделы, справа содержимое: General (масштаб), Health (проверки First run;
   First run при первом запуске остаётся), Shortcuts (решение 7), Machines (два переключателя).
   Разделы других Epic-ов (Terminal AI, PR #202) подключаются. Настройки приложения — новый файл в
   папке данных worfy, каналы `local`, образец — `view.*` и `json-file` (Ticket-ы 01, 02, 05, 06).
3. **Масштаб интерфейса** — zoom всего UI 80–150 % (zoom `webContents`), ползунок в Settings →
   General, View ▸ «Bigger / Smaller / Actual size» на ⌥⌘= / ⌥⌘− / ⌥⌘0 (Ctrl+Alt на Windows);
   ⌘= / ⌘− остаются масштабом Canvas; масштаб помнится (Ticket 03).
4. **Composer.** Effort — ползунок, как в приложении Claude Code, с уровнями выбранной модели. Model
   и Permission mode — стилизованные списки. Один общий компонент Select/Menu (стрелки, Enter, Esc,
   набор букв, ARIA) заменяет каждый native `<select>` в renderer. Макет —
   `docs/design/F-session-dark.dc.html:177-179` (Ticket-ы 08, 09).
5. **Палитра «Search or run…»** — разделители с именами групп между группами; группировка после
   ранжирования: группы по своей лучшей строке, строки внутри — по весу (Ticket 07).
6. **Ctrl на Windows** — остаётся в Ticket-е 11 worfy-windows, здесь не повторяется; зависимость
   записана (Ticket 11 этого Epic-а — `blocked` до его мержа).
7. **Окно сочетаний клавиш.** Центральный реестр сочетаний — один источник для подписей обработчиков
   и для окна. Окно с подписями своей системы открывают Cmd/Ctrl+/, «?» вне текстового поля, пункт
   палитры «Keyboard shortcuts» и Settings → Shortcuts. Ticket реестра ждёт Ticket 11 worfy-windows:
   оба правят одни и те же обработчики (Ticket 11).
8. **Режим фокуса оставляет боковую панель**: слой — внутри `.w-shell__main`. Cmd/Ctrl+B
   переключает панель везде; кнопка — в полосе режима фокуса и в toolbar. Видимость помнится
   отдельно для обычного вида и для режима фокуса (Ticket 10).
9. **Списки боковой панели растут с окном**: делят свободную высоту, у каждого минимум около 3
   строк и максимум около 15; короткий список занимает только свою высоту (Ticket 04).

Решено в этом docs-PR, подтвердить у владельца (Ticket-ы повторяют пункт у себя):

- «Готово, когда» Epic-а — шесть пунктов раздела «Цель».
- «Settings…» на Windows — первый пункт меню File; на macOS — в меню приложения после «About»
  (Ticket 02).
- Раздел General до ползунка масштаба показывает версию worfy (`app.version`); «Settings…» есть и в
  палитре, группа View (Ticket 02).
- Янтарная точка важнее зелёной, когда есть и машина в сети, и машина со сменённым сертификатом;
  тексты подсказки (Ticket 05).
- Пункт палитры «First-run checks» по-прежнему открывает диалог First run, а не Settings → Health
  (Ticket 06).
- Свои меню worfy (меню Canvas, меню Autopilot, контекстные меню Projects и Machines, меню Binding,
  Slash-меню) на Select не переводятся (Ticket 08).
- Ползунок effort — в поповере кнопки «Effort», с отметкой «default» слева от уровней модели
  (Ticket 09). Ползунки масштаба и effort — native `<input type="range">`, общего Slider нет
  (Ticket-ы 03, 09).
- Cmd/Ctrl+B и Cmd/Ctrl+/ — ускорители пунктов меню View ▸ «Toggle Sidebar» и Help ▸ «Keyboard
  Shortcuts», а не обработчики в renderer (Ticket-ы 10, 11).
- Режим фокуса закрывается, когда боковая панель или палитра меняют главную область: Session,
  другой Project, переход к Node-у на Canvas (Ticket 10).

## Не в этом Epic-е

- **Ctrl вместо ⌘ на Windows** — Ticket 11 worfy-windows (решение 6).
- **Раздел Settings → «Terminal AI»** — Ticket 08 Epic-а `worfy-terminal-ai` (PR #202).
- **Новые проверки Health** — Ticket-ы 13 и 15 worfy-windows; Health показывает то, что проверяет
  First run.
- **Свои меню worfy на общем Select** — отдельный Ticket, если владелец захочет.
- **Смена сочетаний клавиш пользователем.**
- **Размер текста по токенам** вместо zoom окна — владелец выбрал zoom (решение 3).
- **Синхронизация Settings между Machine-ами** — ADR-0005: будущее решение.
- **Перестановка и ширина секций боковой панели.**

## Пересечения с другими Epic-ами

Сверка — по правилу раздела «Соглашения», пункт «Перед каждой Wave — открытые PR других Epic-ов».
Общий файл держит Ticket до мержа чужого PR. Здесь — что известно на 2026-10-09 (`gh pr list`,
Status Ticket-ов).

- **worfy-windows 11** (Ctrl вместо ⌘; `open`, ведёт Session на Windows). Его «Где в коде» делит с
  этим Epic-ом:
  - `src/main/menu.ts` и `test/contract/view-menu.test.ts` — Ticket-ы 02, 03, 10, 11;
  - `src/main/window.ts` и `src/renderer/focus/FocusMode.tsx` — Ticket 03; `FocusMode.tsx`,
    `src/renderer/focus/focus.css`, `src/renderer/canvas/overlays/FocusEntry.tsx` — Ticket 10;
  - `src/renderer/shell/shell.css` — Ticket-ы 04 и 10;
  - `src/renderer/palette/CommandPalette.tsx` — Ticket 07;
  - все его обработчики клавиш — Ticket 11.

  Порядок. Ticket 11 этого Epic-а — `Status: blocked` до мержа worfy-windows 11. Остальные идут по
  сверке: открыт его PR — Ticket с общим файлом ждёт мержа; PR нет — Ticket идёт, а worfy-windows 11
  берёт свежий main при claim. После Ticket-а 03 в View нет ролей `zoomIn` и `zoomOut`: пункт 4
  worfy-windows 11 («отнимают ли ускорители меню Ctrl+= у страницы») для масштаба отпадает,
  остаются Ctrl+Z и Ctrl+C. Новые сочетания этого Epic-а — ускорители меню `CmdOrCtrl+…`; Ctrl на
  Windows они получают без worfy-windows 11.
- **worfy-windows 13 и 15** (первый запуск на Windows, qmd; `open`). Общий файл —
  `docs/design/F-SPEC.md` с Ticket-ом 12. Окно First run в renderer они не меняют: их новые проверки
  сами попадают в Settings → Health (Ticket 06).
- **worfy-windows 14** (test-ы на Windows; `open`): `test/e2e/helpers.ts` — с Ticket-ом 05,
  `test/e2e/focus.spec.ts` — с Ticket-ом 10.
- **worfy-windows 17** (очередь gate на Mac; `open`): `src/renderer/palette/commands.ts` и
  `test/unit/palette-commands.test.tsx` — с Ticket-ом 02, `src/renderer/palette/CommandPalette.tsx` —
  с Ticket-ом 07, `src/renderer/shell/sidebar/ProjectsSection.tsx` — с Ticket-ом 04,
  `test/unit/shell.test.tsx` — с Ticket-ом 10; `commands.ts` и `CommandPalette.tsx` — с Ticket-ом 11.
- **PR #200** (worfy-windows 08, пути и папки на Windows; открыт). С «Где в коде» этого Epic-а общих
  файлов нет: его `src/main/index.ts` этот Epic не правит.
- **worfy-link 16** (приёмка; `open`). Его `test/e2e/linked-machines.spec.ts` правит Ticket 05; он же
  правит шаги приёмки, которые смотрят переключатели и список Machines
  (`.scratch/worfy-link/issues/16-приёмка-epic-а-worfy-link.md:37-38`, `:55`, `:60`, `:76`).
  Приёмка `worfy-link` идёт с владельцем; если она в работе — Ticket 05 ждёт её конца.
- **PR #202** (Epic `worfy-terminal-ai`, документы). Его Ticket 08 (раздел Settings → «Terminal AI»)
  ждёт окно Settings — это Ticket 02 «Окно Settings» этого Epic-а; файл раздела
  `src/renderer/settings/TerminalAiSection.tsx` подхватывается окном без его правки, переключатели —
  `SettingSwitch` из `src/renderer/settings/controls.tsx`. Его Ticket 06 вводит Cmd/Ctrl+I в Terminal
  Node: кто вливается вторым — он или Ticket 11 этого Epic-а, — тот вносит Cmd/Ctrl+I в реестр.
  `test/e2e/helpers.ts` его Ticket-ы не правят.
- **PR #197** (Epic `worfy-review`, документы) и **PR #202** правят `HANDOFF.md`,
  `docs/roadmap.md`, а #202 ещё и `CONTEXT.md` — как и этот docs-PR. Конфликт решает тот, кто
  вливается вторым; содержание разделов не пересекается.

## Риски и открытые технические вопросы

1. **Ускорители меню в e2e не нажать.** Playwright шлёт клавиши в страницу, а не в меню Electron.
   e2e зовут пункт меню по id (`Menu.getApplicationMenu()?.getMenuItemById(…)`, как
   `test/e2e/pin-tags.spec.ts:101`). Сами Cmd/Ctrl+, ⌥⌘=, Cmd/Ctrl+B, Cmd/Ctrl+/ проверяет человек —
   ручные пункты Ticket-ов и Ticket 12.
2. **Масштаб может помнить сам Chromium.** userData Electron — папка данных worfy
   (`src/main/index.ts:27`), и Chromium хранит там масштаб по origin. Ticket 03 проверяет, что после
   перезапуска масштаб берётся из `app-settings.json`, и ставит его при каждой загрузке страницы.
3. **150 % в маленьком окне.** Наименьшее окно — 800×520 (`src/shared/window/bounds.ts:17`); при
   150 % страница видит 533×347 CSS px. Ticket 03 снимает Canvas и Settings на этом размере;
   наименьший размер окна не меняется.
4. **Ctrl+Alt на Windows — это AltGr.** На части раскладок (например, немецкой) AltGr+0 печатает
   «}». Отнимет ли ускоритель `CmdOrCtrl+Alt+0` этот символ у поля ввода — не проверено. Проверка —
   Windows-часть Ticket-а 12.
5. **Ctrl+B и Ctrl+/ в Terminal на Windows.** Это клавиши оболочки (Ctrl+B — префикс tmux). Отдаёт
   ли их xterm ускорителю меню — не проверено; тот же вопрос worfy-windows 11 решает для Ctrl+Z и
   Ctrl+C (его «Что делаем», пункт 4). Ответ — из «Итог» worfy-windows 11; если меню их отнимает,
   Ticket 11 этого Epic-а ставит этим пунктам на Windows `registerAccelerator: false` и ловит
   клавиши в renderer.
6. **e2e `worfy-link` зависят от переключателей в боковой панели**: семь файлов, список — Ticket 05.
   Переносить переключатели и править e2e — один Ticket, чтобы main не краснел между ними.
7. **Режим фокуса внутри главной области.** Слой перестаёт закрывать всё окно; e2e это проверяет
   (`test/e2e/focus.spec.ts:117-122`). Клик в боковой панели при открытом режиме фокуса — новое
   состояние; правило — Ticket 10 (подтвердить).
8. **Ticket 11 ждёт другую Session.** worfy-windows 11 ведёт Session на Windows-ПК. Пока он не влит,
   Ticket 11 и приёмка 12 стоят; остальные Ticket-ы Epic-а от него не зависят.
9. **Платформенные PR** (ADR-0056, пункт 2). `src/main/menu.ts` ветвится по системе
   (`src/main/menu.ts:13`), поэтому PR Ticket-ов 02, 03, 10 и 11 — платформенные. После
   worfy-windows 11 к ним добавятся PR, которые правят правила `html[data-platform]` в `shell.css` и
   `focus.css` или зовут `src/renderer/platform.ts`, — 04, 10, 11. Перед мержем — gate full на
   Windows-ПК (раздел «Соглашения»).
10. **Файлы, которые Ticket-ы допишут при claim.** Ticket 10 находит, где палитра просит показать
    Node (`useCanvasRequests`, `src/renderer/find/canvas-requests.ts:71`), — только читает. Фикстуры
    e2e с длинными списками (Ticket 04) — по образцу соседних spec-файлов. От этого план Wave-ов
    может сдвинуться.
11. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave). Ticket-ы 11 и 12 стоят в `blocked`: вычисление Wave в worfy их не
    берёт, пока Status не станет `open` (`src/shared/workflow/waves.ts:158-178`).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-link](../worfy-link/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух
темах, Autopilot над worfy — только на Stable copy, мерж по очереди, метка needs-mac-gate. Отличия:

- **Начало** — сразу; E3 и приёмки других Epic-ов не ждёт. Идёт на Mac параллельно с
  `worfy-terminal-ai`.
- **Кто ведёт** — Session на Mac владельца. Ticket-ы `worfy-windows` ведёт Session на Windows-ПК;
  о ней Session на Mac знает только из репозитория: Status Ticket-ов, открытые PR, main,
  `HANDOFF.md` (ADR-0056, пункт 4).
- **Ветки** — `worfy-ui/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **Перед каждой Wave — открытые PR других Epic-ов** (`worfy-windows`, `worfy-terminal-ai`,
  `worfy-link`): их файлы сравниваются с «Где в коде» Ticket-ов Wave тем же правилом, что внутри
  Wave (`filesOverlap`, `src/shared/workflow/waves.ts:145`). Ticket с общим файлом ждёт мержа того
  PR; пересечение и отложенный Ticket — в отчёте Wave. Известные пересечения — раздел «Пересечения
  с другими Epic-ами».
- **Платформенный PR** (ADR-0056, пункт 2; риск 9). Перед мержем — gate full на Windows-ПК
  владельца. Session на Mac просит его комментарием в PR; Session на Windows отвечает там же:
  строка вердикта Gate и код выхода. «Не удалось проверить» — не зелено.
- **ADR** — не ждётся (раздел «Как устроено»). Номер, если понадобится, выдаёт Orchestrator при
  взятии.
- **Новый канал IPC — `local`** (ADR-0052, пункт 6): настройки и события меню — состояние машины
  экрана.
- **Состояние — в папке данных worfy** (ADR-0005), через `src/main/storage/json-file.ts`;
  localStorage и sessionStorage не используются.
- **Сочетания до реестра.** До Ticket-а 11 новое сочетание — ускоритель пункта меню (`CmdOrCtrl+…`)
  в `src/main/menu.ts`. Обработчик в renderer, если без него нельзя, проверяет модификатор как
  соседние: `isPrimary` из `src/renderer/platform.ts`, если файл уже в main при claim, иначе
  `metaKey`. Ticket 11 переводит их на реестр.
- **Пункты меню в e2e** — по id (риск 1). Каждый новый пункт меню получает id, экспортируемый из
  `src/main/menu.ts`, как `MINIMAP_MENU_ITEM_ID` (`src/main/menu.ts:8-9`).
- **Снимки UI** — `snapshotThemes` (`test/e2e/snapshots.ts:36`) на окне, запущенном `launchApp`
  (`test/e2e/helpers.ts:120`), с временной папкой данных. Живую Stable copy и окно владельца не
  снимают.
- **e2e — в своих spec-файлах.** Прежний spec-файл меняет только Ticket, у которого он в «Где в
  коде».
- **`docs/design/F-SPEC.md` правит только Ticket 12**: разделы Settings, секции боковой панели,
  Select и Keyboard shortcuts — по «Итог» Ticket-ов. Ticket-ы 02–11 описывают вид у себя и не делят
  этот файл.
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` — локально перед
  мержем: `GATE_SCOPE=all gate.sh full` на ветке (команда — `rules.md` Profile-а worfy).
- **Язык.** Документы — русские; термины и названия действий UI («Settings…», «Bigger», «Toggle
  Sidebar») — английские, как на экране (CONTEXT.md, ADR-0017, `docs/design/BRIEF.md`).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/shared/settings/app-settings.ts`, `src/shared/ipc/app-settings.ts`, `src/main/settings/store.ts`, `src/main/ipc/app-settings.ts`, `src/renderer/settings/useAppSettings.ts`, `test/contract/app-settings.test.ts`, `test/unit/use-app-settings.test.tsx` | 1 |
| 02 | `src/shared/ipc/menu.ts`, `src/main/menu.ts`, `src/renderer/settings/SettingsDialog.tsx`, `src/renderer/settings/settings-window.ts`, `src/renderer/settings/sections.ts`, `src/renderer/settings/controls.tsx`, `src/renderer/settings/settings.css`, `src/renderer/settings/GeneralSection.tsx`, `src/renderer/shell/AppShell.tsx`, `src/renderer/palette/commands.ts`, `test/unit/settings-dialog.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/contract/view-menu.test.ts`, `test/e2e/settings.spec.ts` | 1 |
| 03 | `src/main/settings/interface-scale.ts`, `src/main/window.ts`, `src/main/menu.ts`, `src/renderer/settings/GeneralSection.tsx`, `src/renderer/focus/FocusMode.tsx`, `test/unit/interface-scale.test.ts`, `test/contract/view-menu.test.ts`, `test/e2e/interface-scale.spec.ts` | 2 |
| 04 | `src/renderer/shell/SidebarSection.tsx`, `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/shell.css`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/shell/sidebar/EpicsSection.tsx`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/shell/sidebar/AdrSection.tsx`, `test/unit/sidebar-section.test.tsx`, `test/e2e/sidebar-sections.spec.ts` | 2 |
| 05 | `src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/machines/machines-dot.ts`, `src/renderer/machines/machines.css`, `src/renderer/settings/MachinesSection.tsx`, `test/unit/machines-dot.test.ts`, `test/unit/machines-section.test.tsx`, `test/e2e/helpers.ts`, `test/e2e/linked-machines.spec.ts`, `test/e2e/linked-sleep.spec.ts`, `test/e2e/linked-add-project.spec.ts`, `test/e2e/linked-cards.spec.ts`, `test/e2e/linked-notify.spec.ts`, `test/e2e/linked-system-actions.spec.ts`, `.scratch/worfy-link/issues/16-приёмка-epic-а-worfy-link.md` | 3 |
| 06 | `src/renderer/shell/FirstRun.tsx`, `src/renderer/shell/FirstRunChecks.tsx`, `src/renderer/settings/HealthSection.tsx`, `test/unit/settings-health.test.tsx`, `test/e2e/settings-health.spec.ts` | 2 |
| 07 | `src/renderer/palette/CommandPalette.tsx`, `src/renderer/palette/groups.ts`, `test/unit/palette-groups.test.tsx`, `test/e2e/palette-groups.spec.ts` | 1 |
| 08 | `src/renderer/theme/Select.tsx`, `src/renderer/theme/select.css`, `src/renderer/projects/ConnectProject.tsx`, `src/renderer/harness/MigrationForm.tsx`, `test/unit/select.test.tsx`, `test/unit/harness-migration-form.test.tsx`, `test/e2e/select.spec.ts` | 1 |
| 09 | `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/session.css`, `test/unit/session-view.test.tsx`, `test/unit/effort-slider.test.tsx`, `test/e2e/own-sessions.spec.ts`, `test/e2e/permissions.spec.ts`, `test/e2e/session-controls.spec.ts` | 2 |
| 10 | `src/renderer/focus/FocusMode.tsx`, `src/renderer/focus/focus.css`, `src/renderer/focus/focus-state.ts`, `src/renderer/canvas/overlays/FocusEntry.tsx`, `src/renderer/canvas/sources/epics.ts`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Toolbar.tsx`, `src/renderer/shell/shell.css`, `src/renderer/shell/sidebar-visibility.ts`, `src/shared/ipc/menu.ts`, `src/main/menu.ts`, `test/unit/focus-mode.test.tsx`, `test/unit/shell.test.tsx`, `test/contract/view-menu.test.ts`, `test/e2e/focus.spec.ts`, `test/e2e/focus-sidebar.spec.ts` | 3 |
| 11 | `src/shared/shortcuts.ts`, `src/renderer/shortcuts/match.ts`, `src/renderer/shortcuts/ShortcutsOverlay.tsx`, `src/renderer/shortcuts/shortcuts.css`, `src/renderer/settings/ShortcutsSection.tsx`, `src/shared/ipc/menu.ts`, `src/main/menu.ts`, `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Toolbar.tsx`, `src/renderer/palette/CommandPalette.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/find/CanvasFind.tsx`, `src/renderer/canvas/overlays/FocusEntry.tsx`, `src/renderer/canvas/overlays/SelectionToolbar.tsx`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/focus/FocusMode.tsx`, `src/renderer/session/MessageInput.tsx`, `src/renderer/session/SlashMenu.tsx`, `test/unit/shortcuts.test.ts`, `test/unit/shortcuts-overlay.test.tsx`, `test/contract/view-menu.test.ts`, `test/e2e/shortcuts.spec.ts` | 4 |
| 12 | `test/e2e/worfy-ui-acceptance.spec.ts`, `docs/design/F-SPEC.md`, `.scratch/worfy-ui/spec.md` | 5 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave. Ticket-ы 11 и 12
в плане считаются открытыми: 11 — после мержа worfy-windows 11, 12 — когда владелец за Mac-ом.

- **Wave 1 — 01, 02, 07 и 08.** Блокеров нет. Общих файлов нет: 01 — настройки приложения
  (`src/shared/settings/`, `src/main/settings/store.ts`, домен `appSettings`); 02 — окно Settings,
  `src/main/menu.ts`, домен `menu`, `AppShell.tsx`, `commands.ts`; 07 — `CommandPalette.tsx`; 08 —
  `Select` и формы Profile-а.
- **Wave 2 — 03, 04, 06 и 09.** 03 ждёт 01 и 02; 04 — 01; 06 — 02; 09 — 08. Общих файлов нет: 03 —
  zoom окна, `src/main/window.ts`, `src/main/menu.ts`, `GeneralSection.tsx`, `FocusMode.tsx`; 04 —
  рамка и пять секций боковой панели, `shell.css`; 06 — `FirstRun.tsx` и раздел Health; 09 —
  composer. 10 по блокерам тоже здесь — сдвинут (ниже).
- **Wave 3 — 05 и 10.** 05 ждёт 02 и 04; 10 — 01 и 02. Общих файлов нет: 05 — Machines в боковой
  панели и в Settings, e2e `worfy-link`, шаги приёмки `worfy-link` 16; 10 — режим фокуса,
  `AppShell.tsx`, `Toolbar.tsx`, `shell.css`, `src/main/menu.ts`.
- **Wave 4 — 11, один.** Ждёт 02, 03 и 10, а по Status — мерж Ticket-а 11 worfy-windows.
- **Wave 5 — 12, один.** Ждёт все остальные Ticket-ы; в нём шаги владельца, Autopilot его не берёт.

Сдвиги из-за общих файлов:

- **10: Wave 2 → 3.** С 03 общие `src/main/menu.ts`, `src/renderer/focus/FocusMode.tsx` и
  `test/contract/view-menu.test.ts`; с 04 — `src/renderer/shell/shell.css`. Блокеров у 10 в Wave 2
  нет: если эти файлы не заняты, вычисление Wave в момент запуска может взять 10 раньше 03 — это
  допустимо, тогда 03 идёт после него.

Таблица собрана скриптом из списков «Где в коде» Ticket-ов — тем же разбором, что `codeSection`
(`src/main/workflow/reader.ts:141`): текст в обратных кавычках пунктов списка, без пометки «(новый)».
Пересечения — правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`). Внутри каждой Wave
плана общих файлов нет, каждый блокер — в Wave раньше. Файлы открытых Ticket-ов и PR других
Epic-ов в план не входят: их сверяют перед каждой Wave (раздел «Пересечения с другими Epic-ами»).
