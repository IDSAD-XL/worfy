# 34 — Symlink с целью в виде NT-пути (`\Device\Mup\host\share`) считается локальным

Type: task
Status: claimed 2026-10-18T08:37Z
Branch: worfy-windows/34-nt-path-symlink
Blocked by: —
Source: первый круг ревью PR #274 на Mac, 2026-10-13 ([комментарий в PR #274](https://github.com/IDSAD-XL/worfy/pull/274#issuecomment-6137826085), раздел «Low», пункт «Older than this PR, own tickets»); замеры junction в «Итоге» [Ticket-а 19](19-leadstoremote-в-docs-cards-и-workflow.md). Первый шаг — замер на Windows-ПК.

## Что происходит

- **Зачем проверка.** На Windows вызов по symlink-у на `\\host\share\…` (`realpath`, `stat`,
  `readdir`, `fs.watch`) подключает систему к host-у по SMB с учётными данными пользователя.
  Поэтому worfy сначала читает путь по сегментам через `lstat` и `readlink` — это `walkLinks`
  (`src/main/remote-links.ts:174`) — и не идёт по ссылке, которая ведёт с машины.
- **Что код отвечает сегодня.** Цель ссылки приводит к абсолютному виду `absolute()`
  (`remote-links.ts:132-143`, вызов — `:268`). Префиксы `\??\`, `\?\` и `\.\` она знает
  (`:135-139`). Цель `\Device\Mup\evil\share` под них не подходит. Строка `:140` читает её как
  путь от корня диска, на котором лежит ссылка: `C:\Device\Mup\evil\share`. Обход делает
  `lstat C:\Device` и отвечает `'local'`.
- **Это смоделировано, не измерено.** Ревью запускало обход на Mac: правила `path.win32`,
  подменённые `lstat` и `readlink`. Ответ `'local'` дали четыре цели: `\Device\Mup\evil\share\e`,
  `\DosDevices\UNC\evil\share`, `\GLOBAL??\UNC\evil\share`, `\Device\LanmanRedirector\evil\share`.
- **Чего не знаем.** Идёт ли Windows по такому symlink-у к host-у. По находке ревью: `readlink`
  Node отдаёт сохранённое имя как есть и не говорит, какая это ссылка. Относительная — Windows
  остаётся на диске. Абсолютная — Windows пошла бы в сетевой redirector. На Windows не проверялось.
- **Что измерено рядом** (Ticket 19: ПК владельца, Windows 11 26200, Node 22.13.0). *Junction* с
  целью `\Device\Mup\host\share`: `lstat` отвечает ENOENT за 0,3 ms, host не ищется. *Symlink* с
  такой целью не измеряли.
- **Кто может создать такую ссылку** (по находке, не проверялось). `CreateSymbolicLinkW` сохраняет
  `\x` как относительную ссылку: git и архиватор абсолютную форму не создадут. Нужен прямой вызов
  записи reparse point, то есть код, который уже работает на машине.
- **Где это важно.** `walkLinks` стоит перед чтением файлов Project-а, HANDOFF, ADR, Card-ов и
  Ticket-ов (Ticket-ы 18 и 19) и перед watcher-ами, корзиной, MCP-сервером холста и выбором папки
  (Ticket 20). PR #274 перевёл watcher-ы на Windows на модуль `src/main/link-safe-watch.ts`. Он
  повторяет неудавшуюся проверку корня каждые 2 s, и то же ограничение встречается при каждом
  повторе (прочитано во втором круге ревью, не запускалось).
- **Старше PR #274:** эта строка `absolute()` — со времён Ticket-а 18.

## Что делаем

1. **Замер на Windows-ПК — до любой правки.**
   - Создать symlink прямой записью reparse point с целью `\Device\Mup\worfy-no-such-host\share`,
     в двух видах: абсолютная ссылка и относительная. В Ticket-е 19 так создавали junction
     (`FSCTL_SET_REPARSE_POINT`).
   - Измерить время `lstat`, `readlink`, `realpath`, `stat`, `readdir` Node по ссылке. Host в цели
     не существует, его поиск занимает около секунды: в Ticket-е 19 `realpath` по symlink-у на
     `\\host\share\a.md` шёл 1268 ms. Ответ за доли миллисекунды значит, что host не искали.
   - Записать, что вернул `readlink`: текст цели как сохранён или изменённый.
   - Повторить для `\DosDevices\UNC\…`, `\GLOBAL??\UNC\…` и `\Device\LanmanRedirector\…`.
   - Мерить под Node 24.21.0 из Electron 44.5.1 (под ним работает main process) и под системным
     Node: замеры Ticket-а 19 шли под Node 22.13.0.
2. **Записать результат** таблицей в «Итог» и строкой в doc-комментарий `LinkFs`
   (`remote-links.ts:22-33`): там уже записаны замеры junction.
3. **Если Windows идёт к host-у.** Обход отвечает `'remote'` на цель от корня диска, первое имя
   которой — `Device`, `DosDevices`, `GLOBAL??` или `??` (предложение находки). Место правки —
   `absolute()`: её `null` обход читает как `'remote'` (`:269`). Сначала падающий test.
4. **Если не идёт.** Код не меняется; замер записан.

## Готово, когда

- [x] Замер сделан на ПК. В «Итоге» таблица, как у junction в Ticket-е 19: что создано, `lstat`,
      `readlink`, `realpath`, `stat`, `readdir` с временем; версии Windows и Node названы.
- [x] Для каждой из четырёх форм цели сказано: идёт Windows к host-у или нет.
- [x] Doc-комментарий `LinkFs` называет замер symlink-а рядом с замером junction.
- [x] Если идёт: `walkLinks` и `walkLinksSync` отвечают `'remote'`, после `readlink` нет ни одного
      вызова файловой системы. Test был красным до правки; мутант «проверка убрана» красный.
- [x] Если идёт: на ПК `walkLinks` по настоящей ссылке из замера отвечает `'remote'`.
- [ ] Если не идёт: код не менялся, причина записана в «Итог». — Неприменимо: Windows идёт к host-у.
- [ ] `gate full` зелёный на Mac.

## Тесты

- Если правка нужна — сначала падающий test в `test/unit/remote-links.test.ts`: правила
  `path.win32`, подменённые `lstat` и `readlink`, цель `\Device\Mup\evil\share\e`. Ожидание —
  `'remote'` и ни одного `lstat` после `readlink`. Сегодня обход делает `lstat C:\Device` и
  отвечает `'local'` (модель ревью).
- Второй случай — относительная ссылка `\Device\x` на папку этого же диска (см. «Риски»).
- Test-ы с подменой идут на Mac, в Linux CI и на Windows. Настоящая ссылка — только на ПК.

## Где в коде

- `src/main/remote-links.ts` — `absolute()` (`:132-143`), обход `steps()` (`:231-276`),
  doc-комментарий `LinkFs` (`:22-33`).
- `test/unit/remote-links.test.ts`.
- «Итог» Ticket-а 19, таблица «Junction на ПК», — образец замера.

## Вне скоупа

- Junction с сетевой целью: Ticket 19 измерил, что Windows по нему к host-у не идёт.
- Ссылка, подменённая между обходом и следующим вызовом, — записанный долг Ticket-ов 18, 19 и 20.
- Цель ссылки на подключённом сетевом диске (`Z:\…`) и retry без роста паузы —
  [Ticket 33](33-остатки-ревью-pr-274.md).
- Junction на том по GUID, который Node читает как папку, —
  [Ticket 35](35-removetree-и-junction-на-том-по-guid.md).

## Риски

- **Локальная ссылка с тем же текстом цели.** Папка `C:\Device` или `C:\DosDevices` может лежать
  на диске пользователя, и относительная ссылка `\Device\…` на неё — локальная. Правило из
  пункта 3 откажет и ей. Замер должен показать, отличает ли ответ `readlink` одну от другой.
- **Права.** Обычный symlink на Windows требует Developer Mode или запуска от администратора; на
  ПК владельца Developer Mode включён (Ticket 20). Хватит ли этого для прямой записи reparse
  point, покажет замер.
- **Одна машина.** Замеры Ticket-а 19 — Windows 11 26200; на Windows 10 21H2 не проверялось.

## Итог

Заполняет Session на Windows-ПК, 2026-10-18.

- **Причина.** `absolute()` в `src/main/remote-links.ts` читала цель `\Device\Mup\host\share` как
  путь от корня диска (`C:\Device\…`), обход делал `lstat C:\Device`, получал «нет» и отвечал
  `'local'`. Замер показал: абсолютный symlink с такой целью Windows проходит до host-а.
- **Замер на ПК.** Windows 11 Pro 26200; Node 24.21.0 из Electron 44.5.1 и системный Node 24.21.0
  (не 22.13.0, как в Ticket-е 19: на ПК сейчас стоит 24.21.0). Без прав администратора, Developer
  Mode включён, `SeCreateSymbolicLinkPrivilege` у пользователя нет. Symlink (папка) записан прямым
  `FSCTL_SET_REPARSE_POINT` (тег `IO_REPARSE_TAG_SYMLINK`, флаг `SYMLINK_FLAG_RELATIVE` 0 или 1):
  запись прошла, ошибки прав не было. Host `worfy-no-such-host-<n>` у каждой ссылки свой, у
  каждого вызова, который идёт по ссылке, своя ссылка — кэш поиска не скрывает время. Под обоими
  Node числа совпали (±10 ms), в таблице — системный.

  | Что создано (цель после `\<форма>\worfy-no-such-host-N\share`) | `lstat` | `readlink` | `realpath` | `stat` | `readdir` |
  | --- | --- | --- | --- | --- | --- |
  | `\Device\Mup`, абсолютная | symlink, 0,2–0,6 ms | текст как сохранён, 0,1 ms | UNKNOWN, 1269 ms | UNKNOWN, 1263 ms | UNKNOWN, 1270 ms |
  | `\Device\Mup`, относительная | symlink, 0,3 ms | тот же текст, 0,1 ms | ENOENT, 0,2 ms | ENOENT, 0,2 ms | ENOENT, 0,1 ms |
  | `\DosDevices\UNC`, абсолютная | symlink, 0,2 ms | как сохранён | UNKNOWN, 1269 ms | UNKNOWN, 1265 ms | UNKNOWN, 1262 ms |
  | `\DosDevices\UNC`, относительная | symlink | тот же текст | ENOENT, 0,2 ms | ENOENT, 0,2 ms | ENOENT, 0,3 ms |
  | `\GLOBAL??\UNC`, абсолютная | symlink, 0,2 ms | как сохранён | UNKNOWN, 1266 ms | UNKNOWN, 1271 ms | UNKNOWN, 1269 ms |
  | `\GLOBAL??\UNC`, относительная | symlink | тот же текст | ENOENT, 0,2 ms | ENOENT, 0,2 ms | ENOENT, 0,1 ms |
  | `\Device\LanmanRedirector`, абсолютная | symlink, 0,2 ms | как сохранён | ECONNRESET, 1267 ms | ECONNRESET, 1270 ms | ECONNRESET, 1269 ms |
  | `\Device\LanmanRedirector`, относительная | symlink | тот же текст | ENOENT, 0,2 ms | ENOENT, 0,2 ms | ENOENT, 0,1 ms |
  | относительная `\Users\…\real` (папка этого диска) | symlink | тот же текст | `C:\Users\…\real`, 0,2 ms | папка | `["x.md"]` |
  | для сравнения: `fs.symlinkSync('\\host\share')` | symlink | `\\host\share\` | UNKNOWN, 1256 ms | UNKNOWN, 1267 ms | UNKNOWN, 1266 ms |

  - **Итог по формам.** Все четыре абсолютные формы Windows ведёт к host-у: время то же, что у
    symlink-а на `\\host\share` (~1,26 s). Все четыре относительные остаются на диске ссылки:
    ENOENT за доли миллисекунды, host не ищется. `fs.realpathSync` (JS) — так же: 1253–1267 ms у
    абсолютных, ~1 ms у относительных.
  - **`readlink` их не различает.** Он отдаёт сохранённый текст как есть, одинаковый у абсолютной
    и относительной ссылки. Поэтому правило отказывает и относительной ссылке `\Device\…` на папку
    `C:\Device\…` (риск из раздела «Риски»; test это закрепляет).
  - **Дополнительно** (только системный Node, только абсолютные, `realpath`): `\device\mup\…` и
    `\global??\unc\…` в нижнем регистре — 1268 и 1267 ms; `\Sessions\0\DosDevices\<logon>\Global\UNC\…`
    и `\Sessions\0\DosDevices\<logon>\UNC\…` — 1264 и 1256 ms (каталог DosDevices сеанса уходит в
    `\GLOBAL??`); `\SystemRoot` — `C:\Windows`, 0,3 ms.
- **Что изменено.**
  - `absolute()` возвращает `null` (обход читает это как `'remote'`) для пути от корня NT-namespace,
    первое имя которого `Device`, `DosDevices`, `GLOBAL??` или `Sessions`, в любом регистре и с
    любым разделителем (`NT_ROOT`). `??` уже отклонялся раньше. `Sessions` добавлен к списку
    находки по замеру выше.
  - Проверка стоит в `absolute()`, поэтому она действует и на сам путь-кандидат, и на разрешённые
    папки: кандидат `\Device\…` — `'remote'`, такая разрешённая папка отбрасывается.
  - Doc-комментарий `absolute()` и doc-комментарий `LinkFs` (замер symlink-а рядом с замером
    junction).
  - Test-ы: `test/unit/remote-links.test.ts`, новый `describe` «a link target written from the
    root of the NT namespace»: 10 целей × `walkLinks` и `walkLinksSync`, ожидание `'remote'` и ни
    одного вызова после `readlink`; второй test — относительная `\Device\x` тоже `'remote'`, а
    `\Users\…`, `\Devices\x`, `\DeviceMup\x`, `\GLOBAL\x`, `\Session\x`, `Device\Mup\x`,
    `C:\Device\Mup\x` — `'local'` и обходятся по диску. У `fakeLinks` появился `linksSync`.
- **Красный прогон до правки.** `node scripts/vitest-electron.mjs test/unit/remote-links.test.ts` —
  exit 1, 11 упало, 49 прошло: `expected [ 'local', 'local' ] to deeply equal [ 'remote', 'remote' ]`.
- **Мутанты** (по одному, файл восстановлен байт в байт, хеш сверен; test-файлы `remote-links` и
  `remote-guards`): все 8 красные. M1 «проверка убрана» — 11 упало; M2 без `/i` — 9; M3 без
  `sessions` — 2; M4 без границы после имени — 1; M5 только `\` — 1; M6 `global` без `??` — 3;
  M7 без `dosdevices` — 1; M8 проверка по пути после `resolve` — 11.
- **На ПК после правки.** Тот же замер по настоящим ссылкам: `walkLinks` и `walkLinksSync`
  отвечают `'remote'` на все 8 ссылок с NT-целью, под обоими Node; вызовы — `lstat` папки,
  `lstat` ссылки, `readlink`, и больше ничего. Относительная `\Users\…` — `'local'`.
- **Проверки на ПК** (gh убран из PATH; Harness-профиля на ПК нет, gate не запускался):
  - `node scripts/vitest-electron.mjs` по `remote-links`, `remote-guards`, `link-safe-watch`,
    `shell-resolve`, `card-protocol`, `docs-remote-links`, `workflow-remote-links`,
    `windows-tests-workflow`, `e2e-no-spawn-on-load`, `no-rmsync` — exit 0, 10 файлов, 377 прошло,
    1 пропущен.
  - `pnpm lint` и `pnpm typecheck` — exit 1 до запуска скриптов: проверка зависимостей pnpm хотела
    переустановить `node_modules` и остановилась без TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
    Те же команды скриптов напрямую из `node_modules/.bin` (`eslint .`, `check-handoff`,
    `check-lessons`; четыре `tsc --noEmit`) — exit 0 и exit 0.
- **Осталось.** `gate full` на Mac. Real-link test в наборе нет: ссылку пишет только прямой
  reparse-вызов, это замер на ПК, а не test для CI.

### Fix round 2 (ревью round 1 PR #488, comment 6248133138), 2026-10-18

- **HIGH: список имён обходится.** Правило round 1 отклоняло цель по списку имён
  (`Device|DosDevices|GLOBAL??|Sessions`). Его обходили: `\SystemRoot\Temp\evil` (Windows
  доразрешает в `C:\Windows\Temp\evil` шагом, который Node не показывает, а тот сам может быть
  ссылкой на шару), `\ArcName\…`, `\RPC Control\…`, `\BaseNamedObjects\…`, `\Silos\…`, и Unicode
  case-folds `\Devıce` (dotless i), `\Seſſions` (long s) — `/i` без `/u` их не ловит.
- **Правка (выбор ревью, мой вопрос b).** Список имён убран. Теперь только для цели ссылки
  (`from !== null`) отклоняется любой путь с корнем без буквы диска: один разделитель `\` или `/`,
  затем имя, не шара и не диск (`ROOTED_NO_DRIVE = /^[\\/](?![\\/])/`). Путь-кандидат и разрешённые
  папки (`from === null`) читаются как раньше: имя с корнем без буквы там — папка диска
  (`\Device\…` → `C:\Device\…`, local).
- **Префиксы по-прежнему как были.** `\\?\`, `\\.\`, `\??\`, `\\?\UNC\`, `\\?\GLOBALROOT\…` проходят
  до нового правила тем же путём, что и в round 1: `\??\UNC\…`, `\??\GLOBALROOT\…`, `\?\…` — `null`
  (remote) в блоке device-prefix; `\\?\UNC\…` и `\\.\…` после `resolve` дают ведущий `\\` (remote);
  `\\?\C:\…` и `\??\C:\…` снимают префикс и дают локальный диск. Все пять форм закреплены test-ом
  «the device prefixes a link target can carry are read as before».
- **Замер (2): относительная цель, климбящая выше корня тома.** Symlink с целью
  `..\..\..\..\..\..\..\..\Mup\worfy-no-such-host-climb\share` из папки глубины 3. Windows
  срезает лишние `..` на корне диска: `realpath`, `stat`, `readdir` — ENOENT за 0,2–0,3 ms под
  обоими Node (системный 24.21.0 и Electron 44.5.1), host не ищется (поиск занял бы ~1 s).
  `path.win32.resolve` даёт `C:\…\Mup\…` (local). Цель относительная, без ведущего разделителя, —
  `walkLinks` её обходит и отвечает `'local'`. Угрозы нет.
- **Замер (1): второй hop `\SystemRoot\Temp\<x>` → ссылка на шару — ПРОПУЩЕН.** В
  `C:\Windows\Temp` писать нельзя: пробная запись ответила «Отказано в доступе», и это системная
  папка, а мои правила ограничивают меня своими temp-папками. На код это не влияет: цель
  `\SystemRoot\…` — корень без буквы диска, новое правило отклоняет её как `'remote'` ещё до
  любого обращения к файловой системе (test `\SystemRoot\Temp\evil` → remote).
- **Красный прогон до правки (на 92cb438).** `remote-links.test.ts` — exit 1, 9 упало, 61 прошло:
  семь форм обхода и Unicode (`\SystemRoot`, `\ArcName`, `\RPC Control`, `\BaseNamedObjects`,
  `\Silos`, `\Devıce`, `\Seſſions`) ждут remote, а код round 1 даёт local; test кандидата
  `\Device\…` и выброшенной разрешённой папки ждёт local, а код даёт remote.
- **Мутанты нового правила** (по одному, файл восстановлен байт в байт, хеш сверен; `remote-links` и
  `remote-guards`): все 5 красные. M1 правило убрано — 18 упало; M2 снят guard `from !== null`
  (правило бьёт и по кандидату, и по папкам) — 1 (ловит test кандидата/папки, тот самый выживавший
  мутант); M3 guard инвертирован — 19; M4 убран lookahead (`\\host` тоже матчится) — 9; M5 вместо
  `null` возвращается путь — 18.
- **Проверки на ПК round 2** (gh убран из PATH; gate не запускался — профиля на ПК нет):
  - `node scripts/vitest-electron.mjs` по `remote-links`, `remote-guards`, `link-safe-watch`,
    `e2e-no-spawn-on-load`, `no-rmsync` — exit 0, 5 файлов, 198 прошло.
  - `pnpm lint` — exit 0; `pnpm typecheck` — exit 0 (с `CI=true`: без него pnpm хотел
    переустановить `node_modules` и падал без TTY, как в round 1).
- **Осталось round 2.** `gate full` на Mac. Замер (1) — на владельце/Mac или на ПК с доступом к
  `C:\Windows\Temp`.
