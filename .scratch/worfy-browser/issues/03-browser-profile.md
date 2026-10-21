# 03 — Browser profile: создать и удалить, `persist:` partition, список origin-ов, флажок «доступен Autopilot»

Type: task
Status: claimed — 2026-10-21
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
- **Default** (id `default`, partition как у ticket-а 10) создаётся при первом чтении, только когда
  файла нет. Список, который пользователь опустошил, остаётся пустым — поэтому Default можно
  по-настоящему удалить (решение 5).
- **Origin** — только `http(s)://host[:port]`, без пути, query, fragment, user и без `*` (решение 2);
  хранится в написании браузера (`new URL().origin`).
- **Каналы** `browser.profiles.list` (read), `.create`, `.update`, `.delete` (write) и событие
  `browser.profiles.changed`: `src/shared/ipc/browser.ts`, `src/main/ipc/browser.ts`. Read-only
  экран Linked machine получает отказ на запись до handler-а (ADR-0066). В
  `test/unit/link-access.test.ts` добавлены четыре канала в списки read и write — правка вне
  trail-а, согласована с координатором.
- **Удаление**: сначала profile уходит из файла (attach на его partition сразу отклоняется — список
  partition-ов читается при каждом attach, `src/main/index.ts`), потом стирается хранилище
  partition-а (`clearStorageData`, `clearCache`, `clearAuthCache`). Если стереть не вышло — ошибка
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
- Гонка: страница, ещё открытая под удаляемым profile-ем, может записать куку после стирания, пока
  renderer её не закрыл. Смягчено тем, что id не используется повторно: такой partition больше
  никто не откроет.
- Два окна одновременно пишут `data.profile` одного Node — запись одинаковая, но test-а нет.
- e2e написан после кода, красным не показан. Общий partition двух profile-ов покрыт mutant-ом 1 в
  unit и contract test-ах.
- Полный `pnpm test` и gate fast по брифу не запускались — их делает CI. Windows не запускался.
