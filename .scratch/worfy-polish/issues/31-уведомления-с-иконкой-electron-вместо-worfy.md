# 31 — Системные уведомления приходят с иконкой Electron вместо знака worfy

Type: task
Status: done 2026-10-17T14:07Z
PR: #425
Blocked by: —
Source: замечание владельца 2026-10-17 («вылазит дефолт иконка электрона, а должна ворфи»), во время
grilling-а о Pipeline; [worfy-daily 31](../../worfy-daily/issues/31-иконка-приложения.md), «Итог».

## Что происходит

- На macOS иконка слева в уведомлении — иконка bundle-а, который его показал. `Notification` в
  `src/main/notify.ts` (`new Notification`, около `:287`) своей иконки не задаёт, и это верно: опция
  `icon` добавила бы вторую картинку справа, а не заменила бы левую (worfy-daily 31, «Итог»).
- Stable copy (`~/Applications/worfy-stable.app`): `CFBundleIdentifier` = `dev.worfy.app`,
  `CFBundleIconFile` = `icon.icns`, файл на месте (проверено 2026-10-17). Её уведомления должны
  идти со знаком worfy.
- Dev-сборка и e2e запускают `node_modules/electron/dist/Electron.app` (`com.github.Electron`,
  `electron.icns`): их уведомления идут с иконкой Electron. worfy-daily 31 оставил это как есть.
- Какой процесс показал уведомление, которое видел владелец, не установлено. Кандидаты: dev-сборка
  или e2e-прогон агента (Autopilot гоняет e2e во время Wave), либо Stable copy со старой иконкой в
  кэше Notification Center (иконка в Stable copy появилась позже, чем первые уведомления от
  `dev.worfy.app`).

## Что делаем

1. Установить источник: по журналу Notification Center или повтором — уведомление от Stable copy и
   от `pnpm dev`, снимок каждого. Записать в «Итог», какой bundle показал иконку Electron.
2. Stable copy с иконкой Electron — найти и устранить причину (кэш иконок, порядок установки,
   `lsregister`), без ручных шагов у пользователя после `pnpm install:stable`.
3. Dev-сборка и e2e: уведомления не должны выглядеть как от «Electron». Варианты — свой bundle
   для dev с именем и иконкой worfy (например, копия Electron.app с заменёнными `Info.plist` и icns
   в `node_modules/.cache`), или e2e без системных уведомлений. Выбор и причина — в «Итог».

## Где в коде

- `scripts/dev-bundle.ts` (новый) — bundle `pnpm dev` на macOS: копия Electron.app с именем worfy,
  bundle id `dev.worfy.dev` и `build/icon.icns`.
- `electron.vite.config.ts` — команда `serve` (`pnpm dev`) направляет electron-vite в этот bundle
  через `ELECTRON_EXEC_PATH`.
- `tsconfig.node.json`, `tsconfig.test.node.json` — `scripts/dev-bundle.ts` в списке файлов.
- `scripts/install-stable.mjs` — после установки регистрирует копию в Launch Services.
- `src/main/notify.ts`, `src/main/dock-icon.ts` — только комментарии.
- `test/unit/dev-bundle.test.ts` (новый), `test/unit/dev-bundle-config.test.ts` (новый),
  `test/unit/e2e-notifications.test.ts` (новый), `test/unit/install-stable.test.ts`,
  `test/unit/install-stable-functions.test.ts`, `test/unit/install-stable-harness.ts`.
- `test/e2e/packaged.spec.ts` — `runScript` ставит `WORFY_STABLE_LSREGISTER=/usr/bin/true`.

Только читать: `src/main/quiet-windows.ts`, `playwright.config.ts`, `test/e2e/linked-notify.spec.ts`.

## Готово, когда

- [ ] Уведомление Stable copy — со знаком worfy: снимок в `evidence/31-*.png`.
  не проверено: шаг оркестратора после install:stable (снимок баннера — см. «Итог», «Что не проверено»).
- [ ] Уведомление `pnpm dev` — со знаком worfy и именем worfy, или в «Итог» названа причина, почему нет.
  не проверено: сам баннер не снят (см. «Итог»); bundle `pnpm dev`, его имя и иконка в Launch Services — проверены.
- [x] e2e-прогон не показывает системных уведомлений с иконкой Electron.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Linux CI зелёный (PR #425, job `check`).

## Итог

### 1. Источник иконки Electron

Notification Center берёт имя и иконку уведомления у bundle-а процесса, по его bundle id, через
Launch Services. Журнал Notification Center прочитать нельзя: папка
`~/Library/Group Containers/group.com.apple.usernoted` закрыта без Full Disk Access
(«Operation not permitted»). Поэтому источник установлен по Launch Services (`lsregister -dump`
только читает; Stable copy не регистрировалась и не трогалась) и по истории репозитория:

- **Сегодня Launch Services отдаёт за `dev.worfy.app` саму Stable copy со знаком worfy.**
  `NSWorkspace.urlForApplication(withBundleIdentifier:)` — тот же вопрос, который задаёт
  Notification Center, — и иконка найденного bundle-а: [снимок](../evidence/31-icons-by-bundle-id.png)
  (`dev.worfy.app` → `~/Applications/worfy-stable.app`, знак worfy; `dev.worfy.dev` → новый dev
  bundle, знак worfy; `com.github.Electron` → `Electron.app`, иконка Electron). Это рендер иконки
  bundle-а, а не снимок баннера.
- **Ранние копии `dev.worfy.app` несли иконку Electron.** В базе Launch Services 105 записей
  `dev.worfy.app` с `Contents/Resources/electron.icns` (2026-10-05 … 2026-10-06, версия 0.0.0) — до
  `build/icon.icns` (#62, 2026-10-06 20:42). Разрешение на уведомления `dev.worfy.app` получило
  2026-10-06, ещё с такой иконкой. Одна такая копия лежит до сих пор:
  `~/worfy-cleanup-2026-10-06/dist-main-checkout/mac-arm64/worfy.app` (`dev.worfy.app`,
  `electron.icns`, перерегистрирована 2026-10-10). Если Stable copy показывает иконку Electron —
  это кэш Notification Center от тех копий, а не сама Stable copy.
- **Уведомления с именем «Electron» и его иконкой показывает `com.github.Electron`** —
  `node_modules/electron/dist/Electron.app`: `pnpm dev` и e2e. Тихие окна без системных
  уведомлений в e2e появились только с ae6c1210 (#360, 2026-10-16 02:19). Четыре worktree на
  базе старше него показывают их и сейчас, если в них гонять e2e: `11`,
  `karpaty-wiki-indexing-43cc37`, `test-654d80`, `workflow-integration-topics-4dac05`.

Какой процесс показал именно то уведомление, которое видел владелец, точно не установлено (журнал
закрыт). Самые вероятные — e2e или `pnpm dev` из `Electron.app` (имя «Electron», иконка Electron);
Stable copy — только через кэш Notification Center.

### 2. Stable copy

`scripts/install-stable.mjs` после установки на macOS ставит копии время изменения «сейчас» (ditto
сохраняет время сборки — проверено) и регистрирует её: `lsregister -f <копия>`. Так Launch Services
и кэши иконок, которые узнают bundle по времени, читают иконку новой копии без ручных шагов после
`pnpm install:stable`. Отказ `lsregister` — строка-предупреждение, установка не падает. Программу
можно подменить переменной `WORFY_STABLE_LSREGISTER` — её ставят unit test-ы: их stand-in build не
app, и test не меняет базу Launch Services машины. Блок `test/e2e/packaged.spec.ts` со stand-in app
(он идёт в каждом `pnpm test:e2e` на Mac) тоже ставит `WORFY_STABLE_LSREGISTER=/usr/bin/true` в
`runScript`: иначе каждый прогон оставлял бы в Launch Services запись удалённой временной копии.
Блоки `@packaged` (`install()`, gate full) регистрируют настоящую собранную копию — её запуск в
них и так её регистрирует.

Это **платформенный PR** (ADR-0056, packaging): merge ждёт Windows-ПК. На Windows и Linux шаг не
выполняется (`registerCommand` → `null`).

Влит на gate full Mac 2026-10-17 (решение владельца: batch CI, ADR-0068).

Что нужно владельцу, если после `pnpm install:stable` с этим PR баннер Stable copy всё ещё с
иконкой Electron (агенту запрещено: `sudo`, `killall`, чистка кэшей):
1. Убрать старую копию с иконкой Electron:
   `lsregister -u ~/worfy-cleanup-2026-10-06/dist-main-checkout/mac-arm64/worfy.app`, затем удалить
   папку `~/worfy-cleanup-2026-10-06` (путь `lsregister` —
   `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister`).
2. Сбросить кэш Notification Center: выйти из системы и войти снова (или `killall usernoted
   NotificationCenter`).

### 3. `pnpm dev` и e2e

**Выбор: свой bundle для `pnpm dev`, e2e — без системных уведомлений.** Решено без владельца,
подтвердить.

- `scripts/dev-bundle.ts`: на macOS при `pnpm dev` (команда electron-vite `serve`) делается
  `node_modules/.cache/worfy-dev/worfy.app` — клон (`cp -cR`, APFS) `Electron.app` с
  `Info.plist`, где `CFBundleName` и `CFBundleDisplayName` = `worfy`, `CFBundleIdentifier` =
  `dev.worfy.dev`, `CFBundleIconFile` = `worfy.icns` (копия `build/icon.icns`). Исполняемый файл
  остаётся `Electron`: иначе `app.isPackaged` станет `true` и dev-сборка возьмёт пути packaged
  (`src/main/storage/paths.ts`). bundle регистрируется в Launch Services и пересобирается, только
  когда меняется `Info.plist` Electron (новая версия) или иконка. `electron.vite.config.ts`
  ставит `ELECTRON_EXEC_PATH` на его исполняемый файл, если переменная ещё не задана.
- Почему не правка `package.json` `dev` (вариант карты scout-а): обёртка-скрипт вокруг
  `electron-vite dev` должна была бы пересылать сигналы и код выхода; config electron-vite уже
  загружается до запуска Electron, и одной строки в нём хватает.
- bundle id `dev.worfy.dev`, а не `dev.worfy.app`: иначе macOS считает dev-сборку и Stable copy одним
  app, и клик по уведомлению или `open -b` открывает не ту.
- Цена: для macOS это новый app — первый `pnpm dev` один раз спросит разрешение на уведомления (и,
  при включённом firewall, на входящие соединения link-сервера). Ответ — шаг владельца.
- Off macOS, без `build/icon.icns` или при ошибке копии — предупреждение `[worfy] …` и запуск
  `Electron.app` как раньше: `pnpm dev` на Windows и Linux не меняется.
- Проверено на этом Mac: `pnpm dev` этого worktree (тихие окна, временные `WORFY_DATA_DIR` и
  `WORFY_CLAUDE_HOME`, fake agent, под `/tmp/worfy-e2e.lock`) запустил main из
  `node_modules/.cache/worfy-dev/worfy.app/Contents/MacOS/Electron` (`ps -o comm=`); Launch Services
  после этого: `name: worfy`, `displayName: worfy`, `identifier: dev.worfy.dev`,
  `icons: Contents/Resources/worfy.icns`.
- e2e: `playwright.config.ts` включает тихие окна (`WORFY_QUIET_WINDOWS ??= '1'`), в них
  `src/main/notify.ts` не показывает системных уведомлений; единственный spec с выключенными тихими
  окнами (`test/e2e/linked-notify.spec.ts`) подменяет `Notification.prototype.show`. Новый
  `test/unit/e2e-notifications.test.ts` держит все три условия. e2e по-прежнему запускает
  `Electron.app` (а не dev bundle): уведомлений он не показывает, а копия на каждый прогон не нужна.

### Test-ы

- `test/unit/dev-bundle.test.ts` (новый, 17): `Info.plist` — четыре ключа worfy, `CFBundleExecutable`
  и версия Electron на месте, недостающий ключ дописывается, XML-экранирование и `$`, отказ без
  `dict`, настоящий `Info.plist` Electron проходит `plutil -lint` (только macOS); bundle — делается,
  регистрируется, не трогает `Electron.app`, переиспользуется без копии, пересобирается при новой
  иконке, новом Electron и потерянном файле; off macOS не делается; без иконки и при сбое копии —
  предупреждение, старый bundle цел, недоделанная копия уходит со следующим запуском; отказ
  Launch Services — предупреждение; `ELECTRON_EXEC_PATH` — ставится, заданный не трогается, без
  bundle не ставится.
- `test/unit/install-stable-functions.test.ts`: `registerCommand` — `lsregister -f` на macOS,
  `WORFY_STABLE_LSREGISTER` вместо него, на Windows и Linux — нет шага.
- `test/unit/install-stable.test.ts` (macOS): каждая установка регистрирует копию со временем
  установки; отказ Launch Services — строка в выводе, копия и `worfy-stable.json` на месте.
- `test/unit/dev-bundle-config.test.ts` (новый, 2): `electron.vite.config.ts` зовёт dev bundle
  только для `serve`, build — нет (recorder вместо `useDevBundle`); в `dev-bundle.test.ts` — тот же
  config без подмены off macOS (на Linux CI): `ELECTRON_EXEC_PATH` не ставится ни для `serve`, ни
  для `build`.
- `test/unit/e2e-notifications.test.ts` (новый, 4): spec, который выключает тихие окна любым
  написанием (`'0'`, `''`, другое слово, переменная, `delete`), обязан подменять
  `Notification.prototype.show`; отдельный test — таблица написаний.

Мутанты (на копиях в scratchpad, восстановлены, `cmp`): `install-stable.mjs` — без вызова
`lsregister`, без `utimesSync`, шаг на Linux — красные 2, 1, 1 test-а; `dev-bundle.ts` — без
сравнения иконки, без регистрации, bundle на Linux, без `CFBundleIdentifier`, перезапись заданного
`ELECTRON_EXEC_PATH`, без удаления недоделанной копии, `undefined` в переменной — красные все;
`playwright.config.ts` с `??= '0'` — красный 1; `electron.vite.config.ts` с `|| command === 'build'`,
без условия, с `'build'` вместо `'serve'` — красные 1, 1, 2; лишний spec с
`WORFY_QUIET_WINDOWS: 'off'` без подмены — красный 1.

### Что не проверено

- **Снимки баннеров** Stable copy и `pnpm dev`. Процесс агента — потомок Stable copy
  (`worfy-stable.app/Contents/MacOS/worfy` → `claude` → shell); у неё нет Screen Recording
  (`CGPreflightScreenCaptureAccess()` = `false`), а `screencapture` вызвал бы системный запрос — он
  запрещён брифом, а выдача права перезапускает Stable copy. Playwright системный баннер не снимает.
  Уведомление от нового `dev.worfy.dev` к тому же сначала спрашивает разрешение. Нужен шаг
  владельца или оркестратора: `pnpm dev` → дождаться уведомления (окно без фокуса) → снимок.
- Сбросит ли `lsregister -f` и новое время копии кэш Notification Center для `dev.worfy.app` без
  выхода из системы — не проверено: Stable copy трогать запрещено.

