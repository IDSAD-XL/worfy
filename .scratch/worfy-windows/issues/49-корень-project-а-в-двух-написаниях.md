# 49 — Корень Project-а на Windows в двух написаниях: `C:/…` в списке Project-ов, `C:\…` в уведомлениях; сравнение через один helper, id Project-а не меняется

Type: task
Status: done 2026-10-18T11:18Z
PR: #489
Branch: worfy-windows/49-root-two-spellings
Blocked by: —
Source: отчёт Session на Windows-ПК 2026-10-14 о `src/main/projects/store.ts` (комментарий к PR #304; срез 3d Ticket-а [14](14-gate-full-на-windows.md) — только test-ы); подозрение на дефект продукта найдено чтением кода, запуском не подтверждено. Код перечитан на Mac по main `1c1beadd`.

## Что происходит

- **Список Project-ов хранит корень так, как его печатает git.** `ProjectStore` берёт
  `git rev-parse --show-toplevel` и `--path-format=absolute --git-common-dir`
  (`src/main/projects/store.ts:223-224`), корень — папка над общей `.git` или toplevel (`:231`). На
  Windows git печатает `C:/Users/…`: прямые `/`. Из этой строки считается id Project-а —
  `<имя папки>-<sha256(путь)[0:8]>` (`projectId`, `store.ts:75-79`; вызов — `:266`). id называет папку
  данных Project-а. Настоящий Project владельца на ПК — `worfy-d5750da7` для `C:/Users/Alexey/worfy`
  (Ticket [08](08-пути-и-папки-на-windows.md), «Итог»; Ticket [12](12-сборка-nsis-и-stable-copy-на-windows.md)).
- **Уведомления о Session-ах из реестра Claude Code несут другое написание.** Окно просит
  `claudeHome.sessions` с `project.path`. Главный процесс берёт `resolve(projectRoot)`
  (`src/main/ipc/claude-home.ts:144-148`), а на Windows `path.resolve` меняет `/` на `\`: корень
  становится `C:\Users\…`. С этим корнем идёт подписка (`:155`) и чтение живых Session-ов для
  слушателей (`reportLive`, `:51-65`). Слушатель из `src/main/notify.ts:299` передаёт корень в
  `externalSessions` (`:191-205`), и уведомление «Finished its turn» уходит с `projectRoot` =
  `C:\…` (`:199`).
- **Окно сравнивает корни как строки.**
  - `notificationTarget` открывает Session из реестра, только если `project.path === note.projectRoot`
    (`src/renderer/session/notification-target.ts:42`).
  - `projectOfNote` ищет Project заметки так же (`:80`) и без совпадения берёт активный Project.
  - `NotificationTarget.tsx` ищет Project на Linked machine (другой машине, связанной с этим окном)
    тем же сравнением (`src/renderer/canvas/overlays/NotificationTarget.tsx:75`).
- **Что из этого следует — предположение.** На Windows щелчок по уведомлению о Session из реестра
  не находит её Node: `C:/…` не равно `C:\…`. На macOS и Linux написание одно, и дефекта нет.
  Запуском на ПК это не проверено.
- **Test-ы с тем же расхождением.** В «Итоге» Ticket-а 14 (срез 1) 11 падений `projects` на ПК
  названы с причиной «`C:/` против `C:\`, hash id Project-а». Session на Windows-ПК считает, что
  неправы test-ы, а не приложение. Срез 3d Ticket-а 14 правит только test-ы и закрепляет id корня
  `C:/…` одной проверкой.

## Что делаем

1. **Сначала прогон, который показывает дефект** (Session на Windows-ПК). Session `claude` из
   PowerShell в корне Project-а, ход до конца, щелчок по уведомлению «Finished its turn». В «Итог»:
   открылась ли Session; `project.path` и `note.projectRoot` из DevTools окна. Если Session
   открылась — записать, где корни приводятся к одному виду, и закрыть Ticket «не дефект».
2. **Решить, какое написание хранится**, и записать решение в «Итог». Предложение — то, что уже
   хранится: строка git `C:/…`. Её hash — id Project-а и имя папки данных; другое написание
   меняет id у каждого Project-а на Windows.
3. **Один helper сравнения корней** в `src/shared/paths.ts` (там уже `isAbsolutePath`, `:16`;
   `isWindowsAbsolutePath`, `:26`; `lastPathSegment`, `:34`). На Windows-путях он не различает `/` и
   `\`, регистр буквы диска и `\` в конце; POSIX-пути сравнивает как есть. Его зовут три места из
   «Что происходит»: `notification-target.ts:42`, `:80`, `NotificationTarget.tsx:75`.
4. **Пройти остальные сравнения корня Project-а** в `src/main` и `src/renderer` (поиск `=== root`,
   `.path ===`) и записать в «Итог», какие сравнивают значения из двух источников.
5. **Id Project-а не меняется.** `projectId` получает ту же строку, что сегодня. Проверка: корень
   `C:/Users/Alexey/worfy` даёт `worfy-d5750da7`.

## Готово, когда

- [ ] Прогон пункта 1 записан в «Итог» — до правки и после неё.
- [ ] Решение о хранимом написании записано в «Итог».
- [ ] Helper есть в `src/shared/paths.ts`, три места его зовут. Unit-test helper-а: `C:/a/b` и
      `C:\a\b`, `c:/a` и `C:/a`, `C:/a/` и `C:/a` — равны; `/a/b` и `/a/B` — не равны;
      `C:/a/b` и `C:/a/bc` — не равны.
- [ ] Test `notificationTarget` и `projectOfNote`: Project с `path` `C:/…`, заметка с `C:\…` —
      Session найдена.
- [ ] Id корня `C:/Users/Alexey/worfy` — `worfy-d5750da7`, проверкой на любой системе.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; `gate full` зелёный; Linux CI
      зелёный; ручной job «Windows tests» без новых по имени падений против main.

## Тесты

- Unit: helper в `src/shared/paths.ts` — таблица пар из «Готово, когда».
- Unit renderer: `notification-target.ts` — пары написаний; Session из реестра находится, Project
  Linked machine находится.
- Contract: `projectId` от корня `C:/…` — значение, записанное в Ticket-ах 08 и 12.
- Мутант: helper, который сравнивает как строки, — test-ы пар красные.

## Где в коде

- `src/main/projects/store.ts:75-79` (`projectId`), `:223-224`, `:231`, `:266`.
- `src/main/ipc/claude-home.ts:144-148` (`rootOf`), `:155`, `:51-65` (`reportLive`).
- `src/main/notify.ts:191-205`, `:299`.
- `src/renderer/session/notification-target.ts:36-46`, `:72-87`.
- `src/renderer/canvas/overlays/NotificationTarget.tsx:74-76`.
- `src/shared/paths.ts` — место для helper-а.

## Вне скоупа

- Смена хранимого написания и перенос папок данных Project-ов.
- Test-ы с POSIX-путями в ожиданиях — срез 3d Ticket-а 14.
- Пути внутри Project-а (файлы, Card-ы, ADR) — Ticket 08 и ADR-0054.

## Риски

- **Без прогона на ПК дефект — предположение.** Если корни где-то уже приводятся к одному виду,
  правка не нужна. Поэтому прогон идёт первым.
- **Сравнение без учёта регистра ошибочно для папок с чувствительным регистром** (на NTFS это
  можно включить для папки). Helper игнорирует регистр только у буквы диска.
- **Изменение id Project-а** «теряет» данные всех Project-ов на Windows: новая папка данных пуста.
  Проверка id из пункта 5 обязательна.

## Итог

Session на Windows-ПК, 2026-10-18, ветка `worfy-windows/49-root-two-spellings` от main `8013250`.

**Причина (по коду, строки перечитаны на этом main).** Список Project-ов хранит строку git `C:/…`
(`store.ts:223-224`, `:231`, id — `:266`). Main отвечает на `claudeHome.sessions` с
`resolve(projectRoot)` (`claude-home.ts:147-148`), на Windows это `C:\…`; с ним идут подписка (`:157`),
`reportLive` (`:53-66`), слушатель `notify.ts:316` → `externalSessions` (`:195-209`), заметка с
`projectRoot` = `C:\…` (`:203`). Окно сравнивало строками: `notification-target.ts:42`, `:80`,
`NotificationTarget.tsx:75` (теперь `:76`). Запуском дефект не подтверждён (пункт 1 ниже).

**Пункт 1 (прогон с уведомлением) — не сделан.** Нужны запуск приложения, Session `claude` и щелчок
по уведомлению, то есть окна и фокус; бриф запрещает запускать приложение и открывать окна. Остаётся
владельцу (до и после правки).

**Пункт 2 — решение:** хранится строка git `C:/…`, как сегодня. Хранимое написание не меняется,
id и папки данных Project-ов те же; к одному виду приводит только сравнение.

**Пункт 3 — сделан.** `sameProjectRoot(a, b)` в `src/shared/paths.ts`: два Windows-абсолютных пути
(`isWindowsAbsolutePath`) равны, если отличаются только `/` против `\`, регистром буквы диска или
разделителем в конце (корень диска `C:/` остаётся `C:/`); остальная часть пути — с учётом регистра.
Любые другие пути, POSIX тоже, сравниваются как есть: на macOS/Linux `/a\b` и `/a/b` — разные пути,
поведение там не меняется. Зовут три места: `notification-target.ts:43` (`notificationTarget`), `:81`
(`projectOfNote`), `NotificationTarget.tsx:76`.

**Пункт 4 — остальные сравнения корня** (поиск `=== root`, `root ===`, `.path ===`, `projectRoot ===`
в `src/main`, `src/renderer`, `src/shared`):
- Два источника, не исправлено (вне трёх мест тикета): событие `claudeHome.changed` несёт
  `projectRoot` = `C:\…` из main (`claude-home.ts:82`), а окно держит ключи по `project.path` `C:/…`:
  `useClaudeHome.ts:176` (`users.has(root)`), `binding/store.ts:132` (`signalsKey`),
  `claude-home/subagents.ts` `onChanged` (`keyOf`). На Windows push-изменения реестра, видимо,
  отбрасываются, и окно узнаёт о них только по polling (`LIVE_POLL_MS`/`SUBAGENT_POLL_MS` = 2 с, пока
  есть live Session). Запуском не проверено. Предложение — отдельный ticket: main отдаёт в событии
  корень так, как его прислало окно, или окно сравнивает через `sameProjectRoot`.
  **Поправка (ревью PR #489 на Mac, Ticket 59):** последствие здесь занижено. Пока live Session-ов нет,
  окно список не опрашивает вовсе (таймер `useClaudeHome.ts` — только при `live.length > 0`): Session,
  запущенная из PowerShell, в списке не появляется, транскрипт открытой Session не обновляется, по
  таймеру перечитывается только транскрипт Subagent-а. Разбор и правка —
  [Ticket 57](57-claudehome-changed-теряется-из-за-написания-корня.md).
- Два источника, но оба приведены `realpath` (одно написание): `agent/attachments.ts:59-63`,
  `link/caller.ts:53-54` (`realInsideProjects`, `insideProjects`), `mcp/canvas-server.ts:375-381`
  (`projectForCwd`).
- Один источник (кэш или ключ по тому же значению): `autopilot/harness-drift.ts:155`,
  `canvas/overlays/CardBridge.tsx:120`, `:159`, `canvas/sources/epics.ts:400`,
  `palette/CommandPalette.tsx:301`, `link-safe-watch.ts:362`, `notify.ts` ключ `external`
  (`:198`, `:207`; всегда resolved-корень main), `byRoot[root]` в `useClaudeHome.ts`, `usePipeline.ts`,
  `useWorkflow.ts`. Остальные совпадения поиска — проверки на `null`/`undefined`, не сравнение корней.

**Пункт 5 — сделан.** `projectId` не тронут. Contract test в `test/unit/project-store.test.ts`:
`projectId('C:/Users/Alexey/worfy')` = `worfy-d5750da7` на любой системе (для сравнения: hash
написания `C:\Users\Alexey\worfy` — `7a537a68`, то есть другая папка данных).

**Test-ы.** `test/unit/platform-paths.test.ts` — таблица пар (8 равных, 9 разных, в обе стороны),
включая пары из «Готово, когда». `test/unit/permission-card.test.tsx` — `notificationTarget` (Project
`C:/…`, заметка `C:\…` и `c:\…\` — найдена; `…\worfy-two` и `…\Worfy` — нет), `projectOfNote` для
Windows Machine, overlay в окне на Linked machine: Session из реестра в неактивном Project-е по
корню с `\` открывается вместе с `linked.open`.

**Red run** (test-ы до правки, `node scripts/vitest-electron.mjs` три файла): exit 1, 20 failed / 55
passed — 17 `sameProjectRoot is not a function`, 3 assertion (`null` вместо Session, `'beta'` вместо
`'gamma'`, окно осталось на canvas). Contract test `projectId` зелёный сразу (он закрепляет
поведение, не чинит).

**Green run на ПК:** те же три файла + `e2e-no-spawn-on-load.test.ts` + `no-rmsync.test.ts` — exit 0,
5 files, 138 passed. `pnpm lint` — exit 0. `pnpm typecheck` — exit 0. `gate.sh fast` — exit 3
(профиля Harness на ПК нет намеренно; не green и не red).

**Мутанты** (по одному, файл восстановлен байт в байт, sha256 сверен): M1 helper сравнивает строками
— killed (10 failed); M2 без снятия `/` в конце — killed (3); M3 весь путь без учёта регистра — killed
(2); M4 POSIX-пути тоже нормализуются — killed (3); M5 регистр буквы диска не приводится — killed (2);
M6 `notificationTarget` снова `===` — killed (2); M7 `projectOfNote` снова `===` — killed (1); M8
overlay снова `===` — killed (1); M9 `projectId` хэширует написание с `\` — killed (1). 9/9.

**Осталось Mac-у и владельцу.** Пункт 1 (прогон с уведомлением до и после) — владелец на ПК.
`pnpm test` полностью на Mac, `gate full`, Linux CI и ручной job «Windows tests» — Mac. Решение по
`claudeHome.changed` (пункт 4, первый список) — Mac.
