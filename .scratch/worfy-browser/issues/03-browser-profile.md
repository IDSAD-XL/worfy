# 03 — Browser profile: создать и удалить, `persist:` partition, список origin-ов, флажок «доступен Autopilot»

Type: task
Status: done 2026-10-21T15:51Z
PR: #691
Blocked by: 02, 10, 11, 12
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 5
(Browser profile — у Project-а, на Machine; вход и создание — только пользователь; список origin-ов;
один Browser profile — в нескольких Browser-ах), пункт 3 (`partition="persist:…"`), пункт 10 (флажок
«доступен Autopilot»); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) (состояние worfy —
на Machine, не в репозитории). Термин Browser profile — `CONTEXT.md`. Код перечитан по main `dd6b0afb`.

## Что происходит

- Данные Project-а на Machine лежат в его папке: `ProjectStore.dataDir(id)`
  (`src/main/projects/store.ts:130`); так её берёт Layout (`src/main/layout/store.ts:400`).
- После Ticket-а 02 Browser открывается на одном partition-е (вопрос 1 Ticket-а 02), а
  `src/main/browser/attach-policy.ts` сверяет partition со списком.
- Каналы IPC объявляются с доступом и видом `read` или `write`
  (`src/shared/ipc/channels.ts:52`); всё, что не `read`, read-only экрану Linked machine закрыто
  (ADR-0066).

## Что делаем

1. **Хранилище** — `src/main/browser/profiles.ts` (новый): файл Browser profile-ов в папке данных
   Project-а. Запись: id, имя (роль: «admin», «moderator», «user»), список origin-ов, флажок
   «доступен Autopilot». В репозитории Project-а следов нет (ADR-0005).
2. **Partition** — `persist:worfy-browser-<hash>-<id Browser profile>`, где `<hash>` — 8 hex из id
   Project-а, как ввёл Ticket 10 (`src/shared/browser/partition.ts`; id Project-а целиком нельзя —
   в нём имя папки). Свой для каждого Browser profile, один для всех Browser-ов под ним — куки общие
   (ADR-0078, п. 5). id Browser profile — только `[a-z0-9-]`: Electron делает из имени partition-а
   папку. Первый Browser profile имеет id `default`, чтобы вход, сделанный после Ticket-а 10, не
   пропал (вопрос 5).
3. **Создать и удалить** — только пользователь, только из UI; у Session такого действия нет.
   Удаление стирает хранилище partition-а (куки и данные сайтов).
4. **Список origin-ов** — `scheme://host:port`, например `http://localhost:3000`,
   `https://staging.example.com`; пустой список допустим. Здесь список только хранится и
   редактируется; переходы Session по нему проверяет Ticket 04.
5. **Флажок «доступен Autopilot»** — по умолчанию выключен. Здесь только хранится; читает Ticket 08.
6. **Открыть Browser под Browser profile.** «New browser» спрашивает Browser profile; в шапке
   рамки — имя Browser profile. id Browser profile — в `data` Node-а. Browser без Browser profile
   не открывается.
7. **`will-attach-webview`** разрешает только partition-ы Browser profile-ов своего Project-а.
   На `session` каждого `persist:` partition-а, когда она создаётся, ставятся свои
   `setPermissionRequestHandler` и `setPermissionCheckHandler` с отказом по умолчанию, как в
   Ticket-е 02: обработчик `session.defaultSession` (`src/main/window.ts:222`) на неё не действует.
8. **Вход в аккаунт** — пользователь сам, руками в Browser. worfy ничего не вводит и паролей не
   хранит.
9. **Каналы** — `src/shared/ipc/browser.ts` (файл есть с Ticket-а 11): список Browser profile-ов — `read` (read-only
   экран показывает имя, ADR-0078, п. 14), создать, изменить, удалить — `write`.

## Готово, когда

- [x] Unit `test/unit/browser-profiles.test.ts`: имя partition-а из id Project-а и id Browser
      profile; разбор и проверка origin-а (схема, host, порт; путь отклонён; `*` — по вопросу 2);
      флажок по умолчанию выключен.
- [x] Contract `test/contract/browser-profiles.test.ts`: создать, изменить, удалить во временной
      папке данных; файл не в репозитории Project-а; удаление стирает хранилище partition-а;
      read-only экран читает список и получает отказ на создание.
- [x] Unit `test/unit/webview-attach-policy.test.ts`: partition чужого Project-а и удалённого
      Browser profile отклонён.
- [x] Contract `test/contract/browser-profiles.test.ts`: у `session` нового `persist:` partition-а
      стоят свои обработчики разрешений; запрос разрешения от guest-страницы — отказ, проверка —
      `false`; у partition-а двух Browser profile-ов — у каждого свой обработчик.
- [x] e2e `test/e2e/browser-profile.spec.ts`: создать «admin», открыть два Browser-а под ним,
      fixture-страница ставит куку в одном — второй её видит; Browser под другим Browser profile —
      нет; после перезапуска worfy кука на месте; снимок `browser-profile` в обеих темах.
- [x] Мутант красный: два Browser profile-а на одном partition-е.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: e2e «кука одного Browser profile не видна под другим».
- Unit `test/unit/browser-profiles.test.ts` (новый), `test/unit/webview-attach-policy.test.ts`;
  contract `test/contract/browser-profiles.test.ts` (новый); e2e `test/e2e/browser-profile.spec.ts`
  (новый).

## Где в коде

- `src/main/browser/profiles.ts` (новый)
- `src/main/browser/attach-policy.ts`
- `src/shared/ipc/browser.ts` (есть с Ticket-а 11: событие `browser.openRequest`; дописать каналы)
- `src/shared/browser/partition.ts` (`browserPartition`, `browserPartitions`)
- `src/main/window.ts` (`installWebPolicy`, `guardBrowserSession`), `src/main/index.ts` (список
  partition-ов для `installWebPolicy`)
- `src/renderer/canvas/nodes/browser-frame.ts` (id Browser profile в `data` Node-а)
- `src/main/ipc/browser.ts` (новый; регистрация — как остальные в `registerIpc`,
  `src/main/ipc/index.ts:172`)
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/browser/BrowserProfiles.tsx` (новый; место в UI — вопрос 1)
- `test/unit/browser-profiles.test.ts` (новый)
- `test/unit/webview-attach-policy.test.ts`
- `test/contract/browser-profiles.test.ts` (новый)
- `test/e2e/browser-profile.spec.ts` (новый)

Только чтение: `src/main/projects/store.ts` (`dataDir` `:130`), `src/shared/ipc/channels.ts` (`:52`).

## Вне скоупа

- Проверка переходов Session по списку origin-ов — Ticket 04.
- Autopilot по флажку — Ticket 08.
- Вход и создание Browser profile с экрана Linked machine — после Ticket-а 07 (кадры и ввод).

## Открытые вопросы (решены 2026-10-21, см. «Решения владельца»)

1. **Где пользователь управляет Browser profile-ами** (решено, см. ниже). ADR не говорит. Варианты: «Project settings…»
   (Browser profile принадлежит Project-у; Settings — настройки worfy на Machine, `CONTEXT.md`),
   меню Browser Node, отдельная панель.
2. **Поддомены в списке origin-ов** (`https://*.example.com`). ADR приводит только точные origin-ы.
   Предложение: только точные; решает владелец.
3. **Удаление Browser profile, под которым открыты Browser-ы:** закрыть их или отказать в удалении —
   ADR не решает.
4. **Переименование Browser profile** — разрешено ли (partition от id, не от имени) — ADR не
   говорит. Предложение: да.
5. **Browser profile `default`** (добавлен после Ticket-ов 10 и 11). Ticket 10 открывает все Browser-ы
   Project-а на partition-е `…-default`. Как он называется, создаётся ли сам при первом открытии,
   можно ли его удалить. Предложение: создаётся сам при первом чтении пустого списка с именем
   «Default», переименовать и удалить можно, как любой другой.

## Решения владельца — 2026-10-21

Владелец ответил «согласен со всеми» в чате Session «Worfy продолжение», то есть принял все пять
предложений:

1. **Управление** — окно «Browser profiles…». Оно открывается из имени Browser profile в шапке
   рамки Browser-а. В окне: создать, переименовать, удалить, список origin-ов, флажок «доступен
   Autopilot».
2. **Origin-ы** — только точные `scheme://host:port`, без `*` и поддоменов.
3. **Удаление Browser profile, под которым есть Browser-ы на Canvas**, разрешено после
   подтверждения, где названо, сколько Browser-ов его используют. Эти Browser-ы показывают пустую
   рамку с кнопкой «Choose a profile».
4. **Переименование** разрешено. Partition называется по id, не по имени, поэтому куки остаются.
5. **«Default»**: Browser profile с id `default` и именем «Default» создаётся сам при первом
   чтении пустого списка. Так вход, сделанный после Ticket-а 10, остаётся у него. Его можно
   переименовать и удалить, как любой другой. «New browser» спрашивает Browser profile, только
   когда их больше одного.

Пункт 6 «Что делаем» («Browser без Browser profile не открывается») читать вместе с решениями 3
и 5. Browser с удалённым Browser profile — пустая рамка с «Choose a profile». Новый Browser при
одном Browser profile открывается под ним без вопроса.

## Итог

**Сделано** в ветке `worfy-browser/03` (PR — в шапке ticket-а после `ticket done`). Всё из «Что
делаем» и пункты «Готово, когда», кроме полного `pnpm test`: его по брифу запускать нельзя, его
делает CI.

- **Хранение.** `browser-profiles.json` в папке данных Project-а на этой Machine
  (`ProjectStore.dataDir`), не в репозитории: `src/main/browser/profiles.ts`. Запись — `{id, name,
  origins, autopilot}`, схемы и разбор origin-а — `src/shared/browser/profiles.ts` (новый файл вне
  trail-а: схему читают и main, и renderer).
- **Partition** — `persist:worfy-browser-<hash Project-а>-<id profile-а>`
  (`src/shared/browser/partition.ts`). Он назван по id, поэтому переименование сохраняет логины
  (решение 4). Id нового profile-а — slug имени и 6 случайных hex-цифр: partition удалённого
  profile-а никогда не достаётся новому, даже с тем же именем.
- **Default** (id `default`, partition как у ticket-а 10) есть у Project-а, пока у него нет файла.
  Чтение файла не пишет (круг ревью 1): файл появляется при первом create, update или delete.
  Список, который пользователь опустошил, остаётся пустым — поэтому Default можно по-настоящему
  удалить (решение 5).
- **Origin** — только `http(s)://host[:port]`, без пути, query, fragment, user и без `*` (решение 2);
  хранится в написании браузера (`new URL().origin`).
- **Каналы** `browser.profiles.list` (read), `.create`, `.update`, `.delete` (write) и событие
  `browser.profiles.changed`: `src/shared/ipc/browser.ts`, `src/main/ipc/browser.ts`. Read-only
  экран Linked machine получает отказ на запись до handler-а (ADR-0066). В
  `test/unit/link-access.test.ts` добавлены четыре канала в списки read и write — правка вне
  trail-а, согласована с координатором.
- **Удаление**: сначала profile уходит из файла (attach на его partition сразу отклоняется — список
  partition-ов читается при каждом attach, `src/main/index.ts`), потом закрываются страницы
  `<webview>`, ещё открытые на этом partition-е, и только затем стирается его хранилище
  (`clearStorageData`, `clearCache`, `clearAuthCache`). Если стереть не вышло — ошибка
  с причиной; profile к этому моменту уже удалён.
- **`src/main/window.ts` не менялся** (его правит открытый PR #683). `guardBrowserSession` уже ставит
  обработчики разрешений на session каждого partition-а при attach; contract test это доказывает
  через `installWebPolicy` для двух profile-ов.
- **Окно «Browser profiles…»** (`src/renderer/browser/BrowserProfiles.tsx`) открывается по имени
  profile-а в шапке Browser-а: создать, переименовать, удалить, origin-ы, флажок «Available to
  Autopilot». Удаление спрашивает подтверждение и называет, сколько Browser-ов на Canvas его
  используют (решение 3). Список profile-ов в renderer — `src/renderer/browser/profiles.ts` (новый
  файл вне trail-а), стили — `BrowserNode.css` (вне trail-а).

**Как Browser получает profile — правило и почему.** «New browser» спрашивает profile в самой рамке,
а не диалогом при создании: файлы создания Node (`CanvasMenu.tsx`, `CanvasFind.tsx`,
`test/unit/canvas-menu.test.tsx`) правит открытый PR #682 другого эпика, их трогать нельзя. Node
по-прежнему создаётся с `data: {}` (проверено в обоих местах создания и в `browser.spec.ts`).
Правило — чистая функция `browserProfileChoice` (`src/renderer/canvas/nodes/browser-frame.ts`):

1. У Node есть `data.profile` — берётся он; если такого profile-а нет — рамка «Choose a profile» с
   текстом «профиль удалён».
2. Нет `data.profile`, но есть web-адрес в `data.url` — это Browser, открытый до profile-ов: берётся
   `default`, пока он есть; иначе рамка спрашивает. Старый Node отличается от нового именно адресом:
   «New browser» адреса не ставит. Пустой адрес и адрес не http(s) считаются «нет адреса».
3. Новый Browser: profile ровно один — берётся он; больше одного или ни одного — рамка «Choose a
   profile».

Выбранный в пунктах 2 и 3 profile слой Browser-ов записывает в `data.profile` через `patchData`
(не шаг ⌘Z). На read-only экране запись не делается.

**Проверки** (каждый файл отдельно, под `nice -n 10`):

| Команда | exit code |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| unit `browser-profiles`, `browser-profile-choice`, `webview-attach-policy`, `link-access`, `window-options`, `canvas-menu`, `browser-open-bar`, `main-ipc-wiring`, `startup-failure`, `linked-read-only` | 0 каждый |
| contract `browser-profiles`, `link-access` | 0 каждый |
| e2e четыре Browser spec-а: первый запуск 20 passed, 3 failed — все три «Electron failed to install correctly» при старте (параллельные worker-ы одновременно распаковывали Electron в свежем worktree) | 1 |
| e2e повтор трёх упавших | 0 |
| e2e `test/e2e/browser-profile.spec.ts` с `WORFY_EVIDENCE_DIR`, финальный (2 passed) | 0 |

**Mutant-ы** (в отдельном detached worktree, все красные):

1. Два profile-а на одном partition-е (id profile-а выброшен из имени partition-а): unit
   `browser-profiles` exit 1, contract `browser-profiles` exit 1.
2. Удаление не стирает хранилище: contract exit 1.
3. Проверка attach не смотрит на profile-ы (только `default`): contract exit 1.
4. Убрано правило старых Browser-ов (пункт 2): `browser-profile-choice` exit 1.
5. `browser.profiles.create` помечен `read`: contract exit 1 (test read-only экрана), unit
   `link-access` exit 1.

**Снимки** в обеих темах: [светлая](../evidence/03-browser-profile-light.png),
[тёмная](../evidence/03-browser-profile-dark.png) — окно «Browser profiles…» с двумя profile-ами,
рядом Browser под Default и два Browser-а удалённого profile-а с «Choose a profile».

**Не проверено:**

- UI на read-only экране e2e не проходит; отказ на запись проверен contract test-ом на каналах.
- Закрытие страниц перед стиранием проверено contract test-ом на mock-е Electron (порядок «close,
  потом storage»), а не настоящим Electron. Страница, которая не закрылась за 2 секунды, не держит
  стирание: оно идёт дальше. Новая страница на этом partition-е открыться уже не может — attach
  отклонён с момента записи файла.
- Два окна одновременно пишут `data.profile` одного Node — запись одинаковая, но test-а нет.
- e2e написан после кода, красным не показан. Общий partition двух profile-ов покрыт mutant-ом 1 в
  unit и contract test-ах.
- Полный `pnpm test` и gate fast по брифу не запускались — их делает CI. Windows не запускался.

### Круг ревью 1

Ревью PR #691 (глубина high, 4 линзы): две находки med и девять low. Исправлено всё в коммите
«reading the list writes no file…» той же ветки.

- **med 1 — чтение писало файл.** `list()` для Project-а без файла отдаёт Default и ничего не
  пишет, как `ids()`: `browser.profiles.list` — read-канал, а read-only Linked machine не должна
  создавать файл на Machine владельца (ADR-0066). Contract test read-only экрана теперь проверяет,
  что после чтения файла нет; первый test канала — что файл появляется только при create.
- **med 2 — число Browser-ов в подтверждении удаления.** Подсчёт вынесен в чистую функцию
  `browserProfileUsage` (`src/renderer/canvas/nodes/browser-frame.ts`). Unit tests: несколько
  Browser-ов одного profile-а; старый Node только с `data.url`; новый Node при одном и при
  нескольких profile-ах; Node удалённого profile-а; loading.
- **low 3 — запрос полосы «Open» у страницы, ушедшей из слоя.** Код уже снимал его: cleanup
  страницы в `BrowserLayer.tsx` вызывает функцию, которую вернул `registerBrowserPage`, а она
  вызывает `dismissBrowserOpenRequest` (`browser-frame.ts`). Посылка находки неверна, кода не
  добавлено. Добавлен unit test: страница снята — полосы нет; страница нарисована снова под другим
  profile-ем — полосы нет.
- **low 4** — перед стиранием закрываются guest-страницы этого partition-а (`webContents.close()`,
  ожидание `destroyed` до 2 секунд).
- **low 5** — схема файла отклоняет два profile-а с одним id.
- **low 6** — `LEGACY_PROFILE` заменён на `DEFAULT_BROWSER_PROFILE`.
- **low 7** — разбор списка origin-ов один для main и renderer: `readOrigins` в
  `src/shared/browser/profiles.ts`, с удалением дублей.
- **low 8** — тексты: кавычки `"…"` вместо «ёлочек» в UI и ошибке main; «Browser profile» вместо
  голого «profile» в подсказке origin-ов, в подтверждении удаления и в поле нового profile-а.
- **low 9** — окно при открытии берёт фокус, Escape закрывает его сразу.
- **low 10** — tests main: rename в занятое имя (в любом регистре) отклонён; update только имени
  сохраняет origin-ы и флажок; `browser.profiles.changed` уходит после create, update и delete
  (и после неудачного стирания), не уходит после чтения и отклонённого create; нечитаемый файл
  при attach — отложен в сторону, Project снова на Default, другой Project не задет; Project,
  чью папку данных не прочитать, без partition-ов.
- **low 11** — e2e до удаления проверяет, что кука `kept` есть в session.
- Комментарий `browserProfileChoice` ссылается на этот «Итог» и PR #682 как причину выбора
  profile-а в рамке.

| Команда | exit code |
|---|---|
| `pnpm lint` | 0 |
| `pnpm typecheck` | 0 |
| unit `browser-profiles`, `browser-profile-choice`, `browser-open-bar`, `link-access`, `webview-attach-policy` | 0 каждый |
| contract `browser-profiles` | 0 |
| e2e `test/e2e/browser-profile.spec.ts` с `WORFY_EVIDENCE_DIR` (2 passed; снимки обновлены — новые тексты окна) | 0 |

Mutant-ы круга (в отдельном detached worktree, все красные):

| Mutant | Красный test | exit code |
|---|---|---|
| r1: чтение снова пишет Default в файл | contract `browser-profiles` (4 tests) | 1 |
| r2a: каждый используемый profile считается за 1 Browser | unit `browser-profile-choice` | 1 |
| r2b: считается только `data.profile`, записанный в Node | unit `browser-profile-choice` (2 tests) | 1 |
| r3: снятая страница не убирает запрос полосы «Open» | unit `browser-open-bar` | 1 |


**Круг ревью 2 и merge.** Второй круг review, глубина medium, head `f47b38d0`: VERIFIED, находок high
и med нет.
- Пункты круга 1 закрыты.
- Mutant-ы m1–m10 на изменённых строках дают exit 1.
- Удаление закрывает только страницы `webview` на partition-е удаляемого Browser profile. Это
  проверено скриптом на Electron 44.5.1.

Gate full зелёный на main `21406782`, merge — `4a0f0ea3` (gate queue Session «Worfy продолжение»).
Долги low перенесены в Ticket 14.
