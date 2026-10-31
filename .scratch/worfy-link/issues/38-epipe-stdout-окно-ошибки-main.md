# 38 — Закрытый stdout роняет main в окно «A JavaScript error occurred in the main process»

Type: bug
Status: claimed 2026-10-31T02:05Z
Blocked by: —
Source: находка ПК 2026-10-31 при замене Stable на 773915d8 (через мост): старая Stable 408b25c7 не вышла сама —
main показал модальное окно «A JavaScript error occurred in the main process», `Error: write EPIPE`, из
`console.log` в `LinkService`; после OK все процессы закончились без kill. Свидетельство на ПК —
`evidence/stable-close-2026-10-31-epipe.txt` в рабочей папке ПК. Ticket заведён Orchestrator-ом: окно блокирует выход
приложения, а значит и замену Stable (`install-stable` ждёт выхода; Epic `worfy-update`, Ticket 02), и может
появиться на любом событии link — link 31 проверяет именно их.

## Что происходит

- `src/main/link/service.ts:1173-1174` пишет `console.log` на каждом `connected` и `disconnected` Machine-а.
- Если stdout приложения — pipe, чей читатель ушёл (worfy запущен из shell-а или скрипта, который закончился),
  запись даёт `EPIPE`. В `src/main` нет обработчика ошибок `process.stdout` / `process.stderr`: ошибка
  потока становится uncaught exception, и Electron показывает модальное окно, которое держит main-поток
  (`src/main/diagnostics/uncaught-stderr.ts`, заголовок файла, это описывает).
- Это не только про link: любой `console.*` в main после ухода читателя pipe-а делает то же самое.

## Что делаем

1. В main при старте — обработчик `error` у `process.stdout` и `process.stderr`: коды закрытого потока — `EPIPE`,
   `EOF`, `ERR_STREAM_DESTROYED`, `EIO` (закрытый TTY) — глотаются: писать больше некуда, приложение работает дальше;
   прочие коды по-прежнему бросаются (решение Orchestrator-а 2026-10-31: ошибка записи в stdout/stderr не стоит
   модального окна, а listener без `EIO` сделал бы его хуже — раньше первую ошибку записи глотал Console).
2. Место — рядом с `reportUncaughtToStderr` (`src/main/diagnostics/`), подключение там же, где он.
3. Журнал worfy (`log-file.ts`) продолжает получать строки: глотается только запись в закрытый поток.

## Готово, когда

- [ ] Contract test: дочерний процесс Electron-as-Node (или node) с этим обработчиком, stdout — pipe, читатель закрыт до
      записи; `console.log` не роняет процесс: exit code 0 и строка «после записи» в файле. Сначала красный: без
      обработчика процесс падает с `EPIPE`.
- [ ] Unit test: другая ошибка потока не глотается.
- [ ] Пределы test-ов не подняты (правило владельца, `rules.md`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; ci-ok зелёный.

## Тесты

- Contract `test/contract/stdout-epipe.test.ts` (новый); unit — рядом с test-ами `uncaught-stderr`.

## Где в коде

- `src/main/diagnostics/` (новый модуль или рядом с `uncaught-stderr.ts`), точка подключения `reportUncaughtToStderr`
- test-ы выше

Только читать: `src/main/link/service.ts`.

## Итог

- Сделано: `src/main/diagnostics/closed-stdio.ts` — `ignoreClosedStdio()` ставит один обработчик `error` на
  `process.stdout` и `process.stderr`; ошибка с кодом `EPIPE`, `EOF`, `ERR_STREAM_DESTROYED` или `EIO` глотается,
  любая другая бросается дальше и остаётся uncaught exception, как без обработчика. Обработчик не зависит от вида потока
  (pipe, socket, консоль). Подключён в `src/main/index.ts` сразу после `reportUncaughtToStderr()`.
- Коды Windows по исходнику libuv `src/win/error.c`: запись с `ERROR_BROKEN_PIPE` и `ERROR_NO_DATA` даёт `EPIPE`
  (`uv_translate_write_sys_error`), `ERROR_PIPE_NOT_CONNECTED` — `EPIPE`; `ERROR_BROKEN_PIPE` вне пути записи —
  `EOF`. `ENOTCONN` не добавлен: источника, что закрытая консоль даёт его, не нашлось.
- `EIO` (закрытый TTY) глотается тоже. По POSIX `write()` он бывает и при живом потоке: orphaned фоновая группа
  процессов пишет в управляющий терминал при `TOSTOP`, физическая ошибка ввода-вывода файла, куда перенаправлен
  stdout. Строка тогда теряется, приложение работает дальше.
- Факты с ПК (2026-10-31, через мост): обе Stable запущены PowerShell-ом сессии ПК через
  `Start-Process -FilePath $exe -WorkingDirectory …`, без перенаправления; родитель потом закончился. stdin, stdout и
  stderr новой копии — хэндлы Windows console (`\Device\ConDrv`), не pipe и не файл. Стек старой копии 408b25c7:
  `console.log` → `LinkService.<anonymous>` (`out/main/index.js:19058:64`) → `Socket._write` → `Error: write EPIPE`.
- Замер на Mac (node 24.19): первая неудачная запись `console.log` в pipe без читателя не роняет процесс — Console
  сам глотает ошибку своей записи, поток закрывается; роняет следующая запись. Contract test поэтому пишет три строки.
- Не проверено: случай ПК — Windows console, у которой ушёл владелец. Contract test `test/contract/stdout-epipe.test.ts`
  закрывает читателя pipe-а и этот случай не воспроизводит; сделать мёртвую консоль в CI не удалось. Покрытие этого
  случая держится на том, что стек ПК показывает тот же `Socket._write` → `EPIPE`, а обработчик смотрит только на код
  ошибки.
