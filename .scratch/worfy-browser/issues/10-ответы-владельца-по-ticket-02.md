# 10 — Ответы владельца по Ticket-у 02: partition `persist:`, кнопки назад/вперёд/обновить, `target=_blank` в том же Browser

Type: task
Status: claimed 2026-10-20T12:48Z
Branch: worfy-browser/10
Blocked by: 02
Source: Ticket 02, «Открытые вопросы» 1, 2, 5 и «Итог» (PR #576 держится вариантов, которые ничего не
решают за владельца); план Wave 2 от 2026-10-20 — ответы «решено без владельца, подтвердить».
Код перечитан по main `ae547cc2`.

## Что происходит

- Partition один, временный, в памяти: `BROWSER_PARTITION = 'worfy-browser'` без `persist:`
  (`src/shared/browser/partition.ts:11`, список `BROWSER_PARTITIONS` `:14`). После перезапуска
  сохраняется только адрес, cookies и вход — нет.
- Кнопок назад, вперёд, обновить в шапке рамки нет (`src/renderer/canvas/nodes/BrowserNode.tsx`).
- Новые окна guest-страницы запрещены: `setWindowOpenHandler` — deny (`src/main/window.ts:252`), ссылка
  `target=_blank` ничего не открывает.

## Что делаем

Владелец подтвердил ответы 2026-10-20 (см. «Итог»):

1. Вопрос 1 — `persist:` partition «по умолчанию», один на Project; Ticket 03 превращает его в первый
   Browser profile.
2. Вопрос 2 — три кнопки слева от адресной строки: `goBack`, `goForward`, `reload` у `<webview>`;
   назад и вперёд неактивны, когда идти некуда.
3. Вопрос 5 — `target=_blank` и `window.open` guest-страницы открываются в том же Browser
   (`loadURL` вместо нового окна).

## Готово, когда

- [ ] Владелец подтвердил ответы 1, 2, 5 (или дал свои) — запись в «Итог».
- [ ] e2e `test/e2e/browser.spec.ts`: после перезапуска worfy cookie fixture-страницы на месте
      (вопрос 1); назад, вперёд, обновить работают и неактивны по краям истории (вопрос 2); ссылка
      `target=_blank` открывается в том же Browser, нового окна нет (вопрос 5).
- [ ] Unit `test/unit/window-options.test.ts`: у guest-страницы `setWindowOpenHandler` — deny и переход
      в той же странице.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/shared/browser/partition.ts`
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/main/window.ts` (`setWindowOpenHandler` guest-а `:252`)
- `test/e2e/browser.spec.ts`
- `test/unit/window-options.test.ts`

## Вне скоупа

- Browser profile — Ticket 03.

## Итог

**Ответы владельца — 2026-10-20**, в чате Session «Worfy продолжение»: «Согласен со всем», то есть
предложение из «Что делаем» принято как есть:

1. `persist:` partition, один на Project; Ticket 03 делает его первым Browser profile.
2. Кнопки назад, вперёд, обновить слева от адресной строки; неактивны, когда идти некуда.
3. `target=_blank` и `window.open` guest-страницы открываются в том же Browser, нового окна нет.

**Сделано** (ветка `worfy-browser/10`):

1. **Partition.** `browserPartition(projectId)` в `src/shared/browser/partition.ts` —
   `persist:worfy-browser-<hash>-default`, где `<hash>` — 8 hex-символов, которыми кончается id
   Project-а (`projectId`, `src/main/projects/store.ts`). В имени нет пробелов и имени папки, оно
   стабильно для Project-а. Ticket 03 называет partition Browser profile так же, с id profile-а на
   месте `default`, — вход, сделанный сейчас, остаётся у первого Browser profile. Данные partition-а
   лежат в userData Electron-а, то есть в папке данных worfy (`WORFY_DATA_DIR`; `app.setPath` в
   `src/main/index.ts`); e2e берут временную папку, e2e это проверяет по `session.storagePath`.
   Слой Browser-ов ставит partition активного Project-а на каждый `<webview>`.
2. **Подключение и разрешения.** `installWebPolicy(isAppUrl, browserPartitions)`: список
   разрешённых partition-ов — partition-ы Project-ов этой Machine, читаются при каждом
   `will-attach-webview` (`projectStore().list()` в `src/main/index.ts`), так что Project,
   добавленный после старта, получает свои Browser-ы. `attach-policy.ts` не менялся. Session
   partition-а получает свои обработчики разрешений (отказ) в момент, когда `<webview>` разрешено
   подключиться, — до создания страницы; и ещё раз при создании guest, как в Ticket-е 02.
3. **Кнопки.** Назад, вперёд, обновить слева от адресной строки (`BrowserNode.tsx`, иконки SVG);
   назад и вперёд неактивны, когда идти некуда (`canGoBack`/`canGoForward` `<webview>` после
   `dom-ready`, `did-navigate`, `did-navigate-in-page`), все три неактивны, пока у окна нет готовой
   страницы. Связь рамки со слоем — реестр страниц в `browser-frame.ts` (там же был
   `navigateBrowserPage`).
4. **Новые окна.** У guest-страницы свой `setWindowOpenHandler` (`browserWindowOpenHandler`,
   `src/main/window.ts`): всегда `deny`, а http(s)-адрес открывается `loadURL` в той же странице;
   `file:`, `javascript:`, `data:`, адрес Card и пустой адрес — никуда. На `<webview>` нужен
   атрибут `allowpopups`: без него Electron сам отбрасывает `window.open` и `target=_blank`, и
   обработчик main их не видит (так упал первый e2e-прогон). Окно приложения — по-прежнему только
   `deny`.
   После круга ревью страница уходит на адрес только тогда, когда referrer запроса — того же origin,
   что и страница (см. «Круг ревью 1»).

**Поправка к брифу.** `test/e2e/browser-webview-guard.spec.ts` (файл Ticket-а 09, PR #601)
импортировал `BROWSER_PARTITION`; константы больше нет, typecheck краснел (TS2724). Правка — три
строки: импорт и `const BROWSER_PARTITION = browserPartition(PROJECT)!`; использования не тронуты,
`git merge-tree` с веткой `worfy-browser/09` — без конфликтов. Orchestrator в курсе.

**Что изменилось у Browser-а.**

- Временный partition `worfy-browser` в памяти убран: `<webview>` на нём больше не подключается.
- Сессии partition-ов больше не создаются на старте (`session.fromPartition` в `installWebPolicy`),
  только при первом подключении.
- В окне Linked machine Project чужой Machine не входит в список этой Machine: его Browser
  остаётся пустой рамкой (подключение отклонено с предупреждением в консоли). По ADR-0078, п. 14,
  read-only экран и так видит только рамку, а кадры — Ticket 07.

**Проверки.** Сначала красный: unit `test/unit/window-options.test.ts` до реализации — 8 тестов
красные (`browserPartitions is not a function`, `loadURL` не вызван). После: `pnpm lint`,
`pnpm typecheck`, `pnpm test` — exit 0 (338 файлов, 7163 теста); gate fast — «[gate] зелено (fast)».
e2e (под замком `/tmp/worfy-e2e.lock`): новые тесты `browser.spec.ts` — кука после перезапуска,
кнопки назад/вперёд/обновить, `target=_blank` и `window.open` — зелёные; последний прогон на
`740dc1cf` — `browser.spec.ts`, `browser-layer.spec.ts`, `browser-webview-guard.spec.ts`: exit 0,
16 passed.

Мутанты — в отдельном worktree под scratchpad, не в ветке:

| Мутант | unit `window-options` | e2e `browser.spec.ts` |
| --- | --- | --- |
| partition снова в памяти (без `persist:`) | exit 1, 2 теста | exit 1: «the page is on a persist: partition» |
| новое окно разрешено (`allow`) | exit 1, 2 теста | exit 1: «the link opened in the same Browser» |
| «назад» активна при пустой истории | — | exit 1: `toBeDisabled` |
| обработчики разрешений не ставятся при подключении | exit 1, 1 тест | — |
| без `allowpopups` (до исправления) | — | exit 1: «the link opened in the same Browser» |

**Снимок** шапки с тремя кнопками в обеих темах (`snapshotThemes`, весь экран; пиксели страницы
проверяются `webContents.capturePage()`): [светлая](../evidence/10-browser-nav-light.png),
[тёмная](../evidence/10-browser-nav-dark.png).

**Не проверено.** Настоящий trackpad и клавиатура руками. Форма с `target=_blank` и POST
открывается как GET своего адреса (`shortcut:` в `src/main/window.ts`). Browser в окне Linked
machine — без e2e.

**Круг ревью 1** (PR #609, `8ab7b32c` → код на `3df6d35a`, head PR — этот docs-коммит поверх него). Вопрос безопасности ревью: обработчику
`setWindowOpenHandler` не сообщается, какой frame просит окно и был ли клик, поэтому iframe чужого
origin (реклама) мог вызвать `window.open` и заменить всю страницу — на partition-е с сохранённым
входом.

- `browserWindowOpenHandler` (`src/main/window.ts`) теперь отправляет страницу на адрес, только если
  origin `details.referrer.url` равен origin `contents.getURL()`. Чужой origin, пустой referrer
  (`rel="noreferrer"`, `Referrer-Policy: no-referrer`) — `deny`, переход не делается. Фильтр
  только http(s) остался. Цена: ссылка `target=_blank` с `rel="noreferrer"` на самой странице тоже
  ничего не открывает.
- Unit `test/unit/window-options.test.ts`: тот же origin (полный адрес и только origin) —
  переход; чужой origin, другая схема, другой порт, поддомен, пустой и не-URL referrer — нет.
  До правки тест красный (exit 1), после — 21/21; мутант без проверки origin (копия в scratchpad,
  `nice -n 10`) — exit 1, тест «sends the page of a Browser nowhere…» красный.
- e2e `test/e2e/browser.spec.ts`: страница `framed.html` на `127.0.0.1:<порт>` встраивает
  `popper.html` со второго origin (второй сервер на другом порту — другой origin), iframe на load
  без клика вызывает `window.open`; страница остаётся на своём адресе, окно одно. Затем
  `window.open` самой страницы без user gesture (`executeJavaScript(code, false)`) открывает
  `next.html` в том же Browser.
- **Блокирует ли Electron popup без жеста сам — нет.** У `<webview allowpopups>` в Electron 44
  `window.open` без user gesture доходит до обработчика main: так показал e2e (страница перешла по
  своему `window.open` без клика). Значит, запрос iframe-а остановила именно проверка origin.
- Прогон: `browser.spec.ts`, `browser-layer.spec.ts`, `browser-webview-guard.spec.ts` на
  `3df6d35a` — exit 0, 17 passed. `pnpm lint`, `pnpm typecheck` под `nice -n 10` — exit 0. Полный
  `pnpm test` и gate fast в этом круге не запускались по просьбе gate queue: их покрывает gate full.

**Долг** (находка low ревью, не исправлена по решению orchestrator-а): шаблон хеша в конце id
Project-а продублирован — `PROJECT_HASH` в `src/shared/browser/partition.ts:14` и `ID_HASH_SUFFIX`
в `src/main/projects/store.ts`. Свести к одному месту в `src/shared/`.
