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

- [ ] Замер сделан на ПК. В «Итоге» таблица, как у junction в Ticket-е 19: что создано, `lstat`,
      `readlink`, `realpath`, `stat`, `readdir` с временем; версии Windows и Node названы.
- [ ] Для каждой из четырёх форм цели сказано: идёт Windows к host-у или нет.
- [ ] Doc-комментарий `LinkFs` называет замер symlink-а рядом с замером junction.
- [ ] Если идёт: `walkLinks` и `walkLinksSync` отвечают `'remote'`, после `readlink` нет ни одного
      вызова файловой системы. Test был красным до правки; мутант «проверка убрана» красный.
- [ ] Если идёт: на ПК `walkLinks` по настоящей ссылке из замера отвечает `'remote'`.
- [ ] Если не идёт: код не менялся, причина записана в «Итог».
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

—
