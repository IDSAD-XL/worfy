# 49 — Корень Project-а на Windows в двух написаниях: `C:/…` в списке Project-ов, `C:\…` в уведомлениях; сравнение через один helper, id Project-а не меняется

Type: task
Status: open
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

—
