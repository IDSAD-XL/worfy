# 99 — e2e Linked machines: `HOME` и `chmod` test-а на Windows не действуют

Type: task
Status: done 2026-10-22T14:54Z
PR: #764
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

Два test-а красные на Windows-ПК. Оба опираются на средство POSIX, которого на Windows нет:

- `test/e2e/linked-add-project.spec.ts:160` («in A: Add project → Machine B → B's folders…»), проверка `:177`:

  ```
  Locator:  getByTestId('folder-browser').getByTestId('folder-browser-path')
  Expected: "C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-link-11-XTQKBA\\b-home"
  Received: "C:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-shell-GNEAYX\\profile"
  ```

  Test задаёт домашнюю папку машины B через `HOME: bHome` (`:129`). На Windows домашняя папка — `USERPROFILE`, а его
  `launchEnv` переносит во временный профиль запуска (`windowsProfileEnv`, Ticket 84). Приложение показывает этот
  профиль. Дальше в том же test-е `chmodSync(join(bHome, 'locked'), 0o000)` (`:121`) на Windows папку не закрывает.
- `test/e2e/linked-machines.spec.ts:370` («Settings → Machines in the smallest window: a refusal of main…»),
  проверка `:403`:

  ```
  Locator: getByRole('dialog', { name: 'Settings' }).getByTestId('settings-machines-error')
  Expected: visible
  Error: element(s) not found
  ```

  Test делает папку `link` «только для чтения» через `chmodSync(linkDir, 0o555)` и ждёт отказ main при записи
  `link/settings.json`. На Windows `chmod` у папки не запрещает запись в неё: снимок страницы после сбоя
  показывает переключатель «Linked machines can work with my Projects» включённым — запись прошла, отказа нет.
  В «Итог» Ticket-а 84 этот test уже записан среди падающих и на helper-ах main; Ticket-а на него не было.

Причины прочитаны по коду и по снимку страницы (`error-context.md` упавшего test-а); правкой не подтверждены.

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/linked-add-project.spec.ts --grep-invert @packaged
pnpm build && pnpm exec playwright test test/e2e/linked-machines.spec.ts --grep-invert @packaged
```

Оба красные в полном прогоне `pnpm test:e2e` и при повторе своего файла одного (2 из 2 — стойко).
`linked-add-project.spec.ts`: 1 красный из 2, `linked-machines.spec.ts`: 1 из 9.

## Что делаем

1. Домашняя папка машины B на Windows — через `USERPROFILE` (и `HOMEDRIVE` + `HOMEPATH`) этого запуска, а не
   `HOME`; переменные spec-а побеждают значения `launchEnv` (`test/e2e/launch-env.ts`).
2. Папка, которую B не может прочитать, и папка, куда main не может писать: на Windows — запрет через ACL
   (`icacls … /deny`) с возвратом прав в `finally`, или другой способ вызвать тот же отказ; способ — в «Итог».
   Если честного способа нет, проверка отказа на win32 пропускается с комментарием о причине, остальные проверки
   test-а идут.
3. Профиль и папки владельца не трогаются: всё — во временных папках test-а.

## Готово, когда

- [ ] На ПК оба spec-а из «Воспроизведения» — код 0.
- [ ] На Mac оба spec-а — код 0.

## Где в коде

- `test/e2e/linked-add-project.spec.ts`
- `test/e2e/linked-machines.spec.ts`
- `test/e2e/launch-env.ts`

## Итог

Ветка `worfy-windows/99`. Правка только в двух spec-ах; `launch-env.ts` и `src/` не менялись (переменные
spec-а и так побеждают значения `launchEnv`).

- `linked-add-project.spec.ts`: домашняя папка B на Windows — весь профиль запуска в `b-home`
  (`windowsProfileEnv(bHome)`: `USERPROFILE`, `HOMEDRIVE` + `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`), `HOME` остаётся.
  В списке `b-home` на Windows есть `AppData`, как в любой домашней папке Windows: процесс B создал пустую
  `%USERPROFILE%\AppData\Roaming` и при `APPDATA` в другой папке (замер на ПК 2026-10-22), поэтому ожидаемый список
  на win32 — с `AppData`. Папка `locked`: на Windows — запрет ACL `icacls locked /deny <DOMAIN>\<user>:(RD)`
  (readdir падает с EPERM, приложение пишет «No permission to read …»), возврат — `icacls /remove:d` в `finally`.
  Третья причина красного, найденная после первых двух: id Project-а хеширует корень так, как его пишет git
  (`projectId`, `src/main/projects/store.ts`, `C:/…` на Windows), а test хешировал `C:\…`; теперь test берёт
  корень у `git rev-parse --show-toplevel`.
- `linked-machines.spec.ts`: папка `link` «только для чтения» на Windows — `icacls link /deny <user>:(WD,AD)`
  (создать файл в ней нельзя, EPERM), возврат — `icacls /remove:d`. Код в сообщении main на Windows — `EPERM`,
  на macOS и Linux — `EACCES`.
- Проверка на ПК: до правки (main `b6f597ad`) — 2 красных из 11, код 1; после — 11 из 11 зелёные в 4 прогонах,
  код 0. Мутант «запрет ACL не ставится» — оба test-а красные. Всё во временных папках test-ов; файлы истории
  владельца не изменились.
- На Mac не проверено: ветка off-Windows та же, что была (`chmod` 0o000 / 0o555, `EACCES`); новый только расчёт id
  через `git rev-parse` (на macOS он даёт тот же realpath).
