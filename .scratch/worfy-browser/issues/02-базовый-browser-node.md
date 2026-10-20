# 02 — Базовый Browser Node: пункт меню Canvas, адресная строка, `webviewTag` с проверкой `will-attach-webview`

Type: task
Status: claimed 2026-10-20T02:20Z
Branch: worfy-browser/02
Blocked by: 01
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 3
(хост — `<webview>`, проверка `will-attach-webview`), пункт 2 (термин Browser), «Последствия»
(поверхность атаки; e2e-тест на обновление Electron; нейтральный цвет);
[ADR-0077](../../../docs/adr/0077-node-kind-tokens.md), пункт 2 (новый тип Node-а — нейтральный).
Код перечитан по main `dd6b0afb`.

## Что происходит

- Тип Node-а — один файл `src/renderer/canvas/nodes/<Type>Node.tsx`; реестр находит их сам
  (`import.meta.glob`, `src/renderer/canvas/nodes/index.ts:86`). Образец — Terminal:
  `src/renderer/canvas/nodes/TerminalNode.tsx:70-74` (`kind`, `defaultWidth`, `defaultHeight`,
  `createLabel`).
- Пункт меню Canvas появляется у файла, который экспортирует `createLabel`
  (`src/renderer/canvas/overlays/create-items.ts:17-22`); меню — `src/renderer/canvas/overlays/CanvasMenu.tsx:22`.
- `kind` в Layout-е — открытая строка (`nodeKindSchema`, `src/shared/layout/types.ts:28`): новый тип
  схему не меняет.
- `installWebPolicy` (`src/main/window.ts:214`) на каждом webContents ставит `will-frame-navigate`
  (только переходы, разрешённые для окна и Card) и запрет новых окон. Guest-страница `<webview>` —
  тоже webContents: под этой политикой она не уйдёт ни на один сайт.
- После Ticket-а 01 (PR #556, вердикт «go») есть рамка `BrowserNode.tsx` без пункта меню
  (`kind`, `defaultWidth` 640, `defaultHeight` 440), геометрия и URL рамки —
  `src/renderer/canvas/nodes/browser-frame.ts` (`browserPageRect`, `browserUrl`), стили рамки и слоя —
  `src/renderer/canvas/nodes/BrowserNode.css`, слой `src/renderer/canvas/overlays/BrowserLayer.tsx`.
  `webviewTag` и `hardenWebview` (`src/main/window.ts`) включаются только при
  `WORFY_BROWSER_PROTOTYPE=1` (`browserPrototype()`).
- Что показал прототип и что из этого следует здесь:
  - Слой лежит под всеми Node-ами, тело рамки — окно на страницу. Обёртка React Flow у Browser
    Node-а получает `pointer-events: none !important` (`BrowserNode.css:44`): клики по телу идут в
    страницу, рамку выбирают и тащат за шапку.
  - Колесо над страницей по умолчанию прокручивает страницу, Canvas стоит на месте (вопрос 3).
  - `page.screenshot()` Playwright (CDP) теряет последний CSS px `<webview>` справа и снизу;
    `snapshotThemes` (`test/e2e/snapshots.ts:36`) снимает именно так. Пиксели страницы прототип
    меряет через `webContents.capturePage()`; снимок `browser-node` этого Ticket-а — тоже.
  - Нажатие, начатое вне рамки Browser, не отводит страницу с пути мыши: маркер нажатия ставит
    только `useFramesStepAsideWhilePressed` Card (`src/renderer/canvas/nodes/CardNode.tsx:103`), и только
    пока на Canvas есть Card. Browser нужен такой же маркер, иначе drag другого Node-а над страницей
    уходит в `<webview>`.
  - Не мерились в Ticket-е 01: два Browser-а друг на друге (страницы перекрываются по id, а не по
    выбору) и Browser внутри полупрозрачного Epic frame — проверить здесь.

## Что делаем

1. **`webviewTag: true`** в `webPreferences` (`src/main/window.ts:84`), флаг прототипа снимается.
2. **Проверка подключения** — `src/main/browser/attach-policy.ts` (новый), чистая функция от
   `webPreferences` и `params` события `will-attach-webview` и списка разрешённых partition-ов.
   Разрешено только: без preload, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
   partition — из списка. Иначе `preventDefault()`. Вызов — в `installWebPolicy` рядом с
   `web-contents-created` (`window.ts:215`).
3. **Политика guest-страницы.** Для webContents типа `webview` `will-frame-navigate` окна не
   действует: Browser ходит по сайтам. Новые окна guest-страницы по-прежнему запрещены. Разрешения
   (камера, уведомления, геолокация, буфер обмена) guest-странице не выдаются. Сегодня обработчик
   разрешений стоит только на `session.defaultSession` (`window.ts:222`, `grantsPermission`
   `:204`), а у partition-а Browser-а своя `session`, и без обработчика Electron разрешает всё.
   Поэтому на каждую `session` partition-а Browser-а, когда она создаётся, ставятся свои
   `setPermissionRequestHandler` и `setPermissionCheckHandler`: отказ по умолчанию.
4. **Пункт меню** — `createLabel = 'New browser'` в `BrowserNode.tsx`. Новый Browser открывает
   пустую страницу.
5. **Адресная строка** в шапке рамки: ввод URL и Enter — переход; строка показывает текущий URL
   страницы. URL пишется в `data` Node-а (`patchData`, `types.ts:138`) мимо ⌘Z: это не жест над
   Node-ом. После перезапуска Browser открывает сохранённый URL.
6. **Цвет** — нейтральный: без `minimapColor` и без ролей `kind-*` (`docs/design/F-SPEC.md:46`).
7. **e2e-тест обновления Electron** — отдельный spec-файл: `<webview>` подключается, переходит на
   fixture-страницу, рисуется в слое, а подключение с preload отклоняется. Как он связан с
   обновлением Electron — открытый вопрос 4.
8. **Нажатие вне рамки** (добавлено по итогу Ticket-а 01). Пока на Canvas зажата мышь — drag
   другого Node-а, pan, resize, — страница Browser не принимает мышь, даже если нажатие началось вне
   рамки и на Canvas нет Card. Маркер нажатия ставится для Browser так же, как
   `useFramesStepAsideWhilePressed` у Card (`CardNode.tsx:103`).

## Готово, когда

- [x] Unit `test/unit/webview-attach-policy.test.ts`: отклонено с preload, с `nodeIntegration`,
      без `contextIsolation`, с partition вне списка, с `partition` пустым; разрешено — без preload
      и с partition из списка.
- [x] Unit `test/unit/window-options.test.ts`: `webviewTag` включён; guest-страница типа `webview`
      проходит мимо `will-frame-navigate` окна, окно и Card — нет; `setWindowOpenHandler` у
      guest-страницы — deny.
- [x] Unit `test/unit/window-options.test.ts`: у `session` partition-а Browser-а стоят свои
      `setPermissionRequestHandler` и `setPermissionCheckHandler`; запрос разрешения (камера,
      уведомления) от guest-страницы — отказ, проверка разрешения — `false`.
- [x] e2e `test/e2e/browser-webview-guard.spec.ts`: fixture-страница в Browser запрашивает
      уведомления — получает отказ (`Notification.requestPermission()` — `denied`).
- [x] Unit `test/unit/canvas-menu.test.tsx`: пункт «New browser» есть и создаёт Node `kind: 'browser'`.
- [x] e2e `test/e2e/browser.spec.ts`: «New browser» из меню Canvas, ввод URL локальной
      fixture-страницы, страница видна; после перезапуска worfy тот же URL; два окна одного
      Project-а (ADR-0053) видят один Node; снимок `browser-node` в обеих темах.
- [x] e2e `test/e2e/browser-webview-guard.spec.ts`: `<webview>` с preload, вставленный в DOM окна,
      не подключается; правильный — подключается и рисуется.
- [x] e2e `test/e2e/browser.spec.ts`: на Canvas без Card Note тащат мышью через страницу Browser —
      Note доходит до точки отпускания, страница не получила ни одного `mousemove`.
- [x] Мутанты красные: проверка preload снята; partition не сверяется со списком; guest-страница под
      политикой окна; обработчик разрешений на `session` partition-а Browser-а не ставится.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `webview-attach-policy.test.ts` на preload.
- Unit `test/unit/webview-attach-policy.test.ts` (новый), `test/unit/window-options.test.ts`,
  `test/unit/canvas-menu.test.tsx`; e2e `test/e2e/browser.spec.ts` (новый),
  `test/e2e/browser-webview-guard.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/browser-frame.ts`
- `src/renderer/canvas/nodes/BrowserNode.css` (вместо `src/renderer/canvas/browser.css` первого плана:
  стили рамки уже здесь после Ticket-а 01)
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/canvas/nodes/CardNode.tsx` (`useFramesStepAsideWhilePressed` `:103` — маркер нажатия
  выносится в общий hook для Card и Browser; пункт 8)
- `src/main/window.ts` (`webPreferences` `:84`, `grantsPermission` `:204`, `installWebPolicy` `:214`,
  обработчик разрешений `:222`)
- `src/main/browser/attach-policy.ts` (новый)
- `test/unit/webview-attach-policy.test.ts` (новый)
- `test/unit/window-options.test.ts`
- `test/unit/canvas-menu.test.tsx`
- `test/e2e/browser.spec.ts` (новый)
- `test/e2e/browser-webview-guard.spec.ts` (новый)

Только чтение: `src/renderer/canvas/nodes/index.ts` (`:86`), `src/renderer/canvas/overlays/create-items.ts`
(`:17-22`), `src/shared/layout/types.ts` (`nodeKindSchema` `:28`, `patchData` `:138`).

## Вне скоупа

- Browser profile, выбор Browser profile при открытии — Ticket 03. Здесь partition один (см. вопрос 1).
- MCP server и управление Session-ой — Ticket 04.
- Сон и предел Live — Ticket 05.

## Открытые вопросы

1. **Partition до Browser profile-ов.** ADR-0078, п. 3 разрешает только partition-ы Browser
   profile-ов, а они появляются в Ticket-е 03. Что использует Browser здесь — один временный
   partition Project-а без `persist:` или сразу `persist:` «по умолчанию», который Ticket 03
   превращает в первый Browser profile, — ADR не решает. Решает владелец до claim.
2. **Кнопки адресной строки.** ADR называет только адресную строку. Назад, вперёд, обновить — да или
   нет — решает владелец.
3. **Колесо мыши над страницей** — прокрутка страницы или pan Canvas (вопрос 3 Ticket-а 01).
4. **Где записано правило «при обновлении Electron гонять `browser-webview-guard.spec.ts`»** — только
   в этом Ticket-е или в gate (отдельный прогон при смене `electron` в `package.json:58`). ADR
   говорит «отдельным e2e-тестом», механизм не задаёт.
5. **Ссылка с `target=_blank`** на странице: запрещена, открывается в том же Browser или в новом
   Browser — ADR не решает. Предложение: в том же Browser.

**План Wave 2 (2026-10-20, оркестратор `worfy-browser`): ответы — решено без владельца, подтвердить.**
Ночь шла без владельца; Ticket не берётся в работу, пока владелец не подтвердил или не поменял ответы.

1. `persist:` partition «по умолчанию» (один на Project); Ticket 03 превращает его в первый Browser
   profile. Так acceptance «после перезапуска тот же URL» не теряет вход на сайт, и Ticket 03 не
   переносит данные из временного partition-а.
2. Да: назад, вперёд, обновить — три кнопки слева от адресной строки. У `<webview>` это готовые
   вызовы (`goBack`, `goForward`, `reload`), а без них после первой ссылки страница — тупик.
3. Колесо над телом рамки прокручивает страницу — так `<webview>` делает по умолчанию, прототип это
   измерил (прокрутка 400 px, Canvas на месте). Pan Canvas — колесом над шапкой рамки и вне рамки.
4. Отдельного механизма не нужно: gate full гоняет весь `test:e2e`, значит
   `browser-webview-guard.spec.ts` идёт в каждом gate full, и в PR со сменой `electron` тоже. Правило
   записывается одной строкой в «Итог».
5. В том же Browser.

## Итог

**PR и ответы владельца.** Сделано в PR (ветка `worfy-browser/02`) — всё из «Что делаем» и все пункты
«Готово, когда»; ответы на вопросы 1, 2, 5 владелец ещё не подтвердил, поэтому PR держится
вариантов, которые ничего не решают за него:

- сделано в PR: `webviewTag: true` во всех окнах, флаг `WORFY_BROWSER_PROTOTYPE` и `hardenWebview`
  сняты; чистая проверка `src/main/browser/attach-policy.ts` (`webviewAttachRefusal`, список
  partition-ов — параметр) в `will-attach-webview` каждого webContents (`installWebPolicy`); guest
  типа `webview` вне `will-frame-navigate` окна, новые окна — deny; свои
  `setPermissionRequestHandler` (отказ) и `setPermissionCheckHandler` (`false`) на `session`
  partition-а Browser-а — при `installWebPolicy` (`session.fromPartition`) и ещё раз при создании
  каждого guest (`guardBrowserSession`, `defaultSession` не трогается), так что partition-ы
  Ticket-а 03 получат их без новой строки; пункт меню «New browser»; адресная строка (Enter —
  `loadURL` страницы и `patchData` мимо ⌘Z, адрес, до которого страница дошла сама, —
  `did-navigate` → `data.url`, после перезапуска Browser открывает его); общий hook маркера нажатия
  `src/renderer/canvas/nodes/frames-step-aside.ts` для Card и слоя Browser-ов.
- ждёт ответов владельца:
  - вопрос 1 — partition один, временный, в памяти: `BROWSER_PARTITION = 'worfy-browser'` без
    `persist:` (`src/shared/browser/partition.ts`, комментарий о том, что ответ может сменить его на
    `persist:`). После перезапуска сохраняется только адрес, cookies и вход — нет;
  - вопрос 2 — кнопок назад, вперёд, обновить нет;
  - вопрос 3 — колесо по умолчанию (страница прокручивается, Canvas стоит), нового кода нет;
  - вопрос 5 — новые окна guest-страницы по-прежнему запрещены (`target=_blank` ничего не открывает).
- вопрос 4: `test/e2e/browser-webview-guard.spec.ts` входит в весь `test:e2e`, значит идёт в каждом
  gate full, в том числе в PR со сменой `electron` в `package.json`; отдельного механизма нет.

**Поправка к «Что происходит».** `will-frame-navigate` окна не держал guest-страницу «ни на одном
сайте»: `allowFrameNavigation` отказывает только адресам Card (`worfy-card:`), главный frame уходит
на любой http(s). Снятие правила окна для guest меняет только переходы на адрес Card; у partition-а
Browser-а нет обработчика протокола Card, такая страница не загрузится. Unit-тест закрепляет именно
это различие.

**Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — «[gate] зелено (fast)».
e2e (под замком `/tmp/worfy-e2e.lock`): `browser.spec.ts` 2/2, `browser-webview-guard.spec.ts` 2/2,
`browser-layer.spec.ts` 9/9 без флага. Сначала красный — unit `webview-attach-policy.test.ts` (модуля
не было).

Мутанты — в отдельном worktree под scratchpad, не в ветке:

| Мутант | unit (`webview-attach-policy`, `window-options`, `web-policy`) | e2e |
| --- | --- | --- |
| проверка preload снята | exit 1, 2 теста красные | `browser-webview-guard` exit 1: страница с preload подключилась |
| partition не сверяется со списком | exit 1, 4 теста | — |
| guest под `will-frame-navigate` окна | exit 1, 1 тест | — |
| обработчик разрешений на `session` Browser-а не ставится | exit 1, 2 теста | `browser-webview-guard` exit 1: `Notification.requestPermission()` — `granted` |
| маркер нажатия не снимает мышь со страницы (правило CSS убрано) | — | `browser.spec.ts` exit 1: Note не дошла до точки отпускания |

**Снимок `browser-node`** в обеих темах (`snapshotThemes`, весь экран): [светлая](../evidence/02-browser-node-light.png),
[тёмная](../evidence/02-browser-node-dark.png). Это screenshot через CDP: у страницы справа и снизу нет
последнего CSS px (розовой линии) — артефакт снимка, найденный в Ticket-е 01; то, что страница
рисуется в рамке, `browser.spec.ts` проверяет по `webContents.capturePage()`.

**Что изменилось у соседей.** Маркер нажатия `PRESSED_ATTRIBUTE` и `useFramesStepAsideWhilePressed`
переехали из `CardNode.tsx` в `frames-step-aside.ts` без изменения поведения Card. `openSecondWindow`
(`test/e2e/helpers.ts`) создаёт окно с `webviewTag: true`, как `src/main/window.ts`. Mock-и
`electron` в `test/contract/web-policy.test.ts` и `test/contract/startup-failure.test.ts` получили
`session.fromPartition` и `getType`.

**Не проверено.** Два Browser-а друг на друге и Browser внутри Epic frame (вопрос из Ticket-а 01) — не
мерились. Второе окно того же Project-а показывает новый адрес в строке, но его страница остаётся,
где была (`shortcut:` в `BrowserLayer.tsx`). Настоящий trackpad и ввод с клавиатуры руками — нет.
