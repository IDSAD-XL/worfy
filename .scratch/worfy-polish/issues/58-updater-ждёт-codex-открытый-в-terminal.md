# 58 — Updater отказывает, пока встроенный `codex` открыт в terminal-е

Type: bug
Status: done 2026-11-04T17:07Z
PR: #1378
Blocked by:
Source: приёмка worfy-multi-vendor 32, 2026-11-04 (владелец: «да» на ticket); перезапуск Stable ждал 3 минуты процесс
`codex` владельца из terminal-а

## Что происходит

Диалог одобрения hook-ов в Codex (worfy-polish 54) даёт команду, которая запускает встроенный binary Codex из папки
Stable: `<worfy-stable.app>/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-…/bin/codex`. Пользователь
оставляет его открытым в terminal-е. `install-stable` (`scripts/install-stable.mjs`, `runningCopies` и ожидание из
worfy-polish 53) считает любой процесс с путём внутри копии работающей копией. Поэтому «Restart now» ждёт до двух
минут и отказывает, пока в terminal-е открыт Codex. Внешний скрипт перезапуска 2026-11-04 так же простоял 3 минуты на
`codex` владельца. Из текста отказа не понятно, что закрыть нужно Codex в terminal-е.

## Что делаем

1. Процесс встроенного `codex`, запущенный не worfy (его родитель — не процесс копии), не ждать молча: отказ сразу
   называет его — «Codex is open in a terminal (pid N): close it, then press Restart now again» — или, если безопасно,
   не считать его работающей копией. Выбрать одно и записать почему в «Итог»: подменять папку, из которой исполняется
   binary, на macOS и Windows — разные риски (на Windows файл занят).
2. Процессы самой worfy (дочерние Session, `codex app-server`) — как в worfy-polish 53: ждать их выхода.
3. Тост отказа показывает этот совет целиком.

Глубина review — `medium`. Платформенный: поиск процессов и родителей на macOS и Windows — Windows-часть на ПК.

## Готово, когда

- [ ] Unit test `install-stable`: `codex` из копии с чужим родителем — отказ сразу с его pid и советом (или пропуск —
      по решению п. 1); дочерний процесс копии — ожидание, как в worfy-polish 53. win32 — с поданным листингом.
  - evidence: test-run pass · `pnpm test test/unit/install-stable-update.test.ts` exit 0 · mac - · 39b8c63fe0f5c554c783238bcc972d7276101e1c
- [ ] Все unit и contract test-ы `src/main/update/` и `scripts/install-stable.mjs`, `pnpm typecheck`, `pnpm lint` —
      exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 39b8c63fe0f5c554c783238bcc972d7276101e1c

## Итог

- **Что сделано.** `scripts/install-stable.mjs`: новая `copyProcesses` делит процессы копии на процессы самой worfy и
  запущенные не worfy. Список процессов теперь с родителем: на macOS `ps -axo pid=,ppid=,command=`, на Windows
  `Get-CimInstance Win32_Process` с `ParentProcessId`. Процесс копии — свой, если он или кто-то из его предков — сама
  worfy (`--wait-pid`), главная программа копии или процесс, который был своим в списке, прочитанном до ожидания выхода
  worfy. После выхода worfy её дети теряют родителя (macOS отдаёт их launchd, ppid 1; Windows оставляет pid ушедшего
  родителя): верхний процесс копии в цепочке без живого родителя — тоже свой, его ждут, как в worfy-polish 53. Верхний
  процесс копии с живым чужим родителем (shell terminal-а) — запущен не worfy. `runningCopies` отвечает те же строки
  `pid command`, что и раньше.
- **Отказ.** Процесс, запущенный не worfy, не ждут: отказ сразу (`startedOutside`) — «Codex is open in a terminal (pid
  N): close it, then press Restart now again. Nothing was changed.» (для roll back — «press Roll back again», для ручного
  `pnpm install:stable` — «run this again»). Другая программа копии, запущенная не worfy, называется по pid и имени.
  Совет стоит в начале и помещается в три строки тоста после «worfy was not updated to <version>: ».
- **Test-ы** — `test/unit/install-stable-update.test.ts`, блок «worfy-polish ticket 58»: листинги macOS (`ps` с ppid) и
  Windows (JSON с `ParentProcessId`), поданные в `copyProcesses`; запуск script-а: terminal `codex` — отказ сразу, без
  ожидания, ничего не тронуто; `codex app-server` worfy, который выходит через 3 s после неё, — ожидание; `codex` в
  Terminal card, чей shell пережил worfy на миг, — ожидание. Страница `docs/features/updates.md` дополнена.

Решено без владельца, подтвердить:
- **П. 1 — отказ сразу, а не пропуск, на обеих системах.** Windows: файл запущенной программы занят, папку с ним не
  переименовать и не удалить — замена упала бы после сборки на шаге swap с невнятной ошибкой «busy» и могла оставить
  половину копии. macOS: папку переименовать и удалить можно (запущенный binary держит свой inode), но Codex заново
  запускает свой binary по пути (`current_exe`, например для apply_patch) и берёт файлы из своей папки; после swap этот
  путь ведёт в другую сборку, а во время swap — в пустоту. Цена отказа — пользователь закрывает Codex и жмёт ещё раз;
  цена пропуска — разное поведение на двух системах и Codex, который ломается посреди работы.
- Отказ сразу — и без `--wait-pid` (ручной `pnpm install:stable`): там отказ и раньше был сразу, теперь он называет
  Codex.
- Процесс, чей родитель неизвестен (список без ppid) или ушёл, считается своим — его ждут до предела, как раньше.
  Остаётся случай `nohup codex &` в закрытом terminal-е: такой Codex ждут 120 s, потом отказ называет его pid.
- Список «своих» читается один раз, до ожидания выхода worfy. Если он не читается, решает только цепочка родителей.
- Совпадение pid-а родителя с чужим процессом после выдачи pid-а заново (Windows) не проверяется по времени старта:
  это редкий случай, обход цепочки ограничен числом процессов.
- Windows-часть проверена unit test-ами с поданным листингом; запуск на ПК — после Wave.
