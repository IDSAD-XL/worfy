# 18 — Symlink внутри Project-а, который ведёт на `\\host\share\…`: отказ до `realpath`

Type: task
Status: open
Blocked by: 08, 11
Source: долг из «Итог» [Ticket-а 08](08-пути-и-папки-на-windows.md) (пути и папки на Windows), четвёртый круг ревью PR #200 на Mac — [комментарий](https://github.com/IDSAD-XL/worfy/pull/200#issuecomment-6091473304), раздел «Debt»: «отдельный Ticket worfy-windows: lstat на каждом сегменте пути или отказ ссылке, чья цель — UNC, до realpath»; решения владельца 2026-10-07: Q1 (полный порт worfy под Windows), Q24 (Windows 10 21H2+ и 11, x64) ([spec.md](../spec.md)); [ADR-0054](../../../docs/adr/0054-full-windows-port.md) «Full Windows port»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) (проверки на двух машинах) и правило «Метка needs-mac-gate» в spec.md

## Что происходит

- PR #200 влит (Ticket 08 — `done`), строки ниже перечитаны на нынешнем main.
- `resolveProjectFile` открывает файл Project-а по пути из markdown-ссылки. Путь, который сам
  записан как UNC или device-путь (`\\host\share\…`, `//host/…`, `\\?\…`, `\\.\…`), он проверяет
  по тексту и отклоняет до любого обращения к файловой системе (`src/main/ipc/shell.ts:59-61`;
  зачем — комментарий `:44-52` и второй круг ревью, `08-…md:305-310`): `realpath` такого пути
  заставляет Windows подключиться к хосту по SMB и отдать ему NTLM-хэш пользователя.
- Локальный путь эту проверку проходит: `C:\p\repo\docs\a.md` не начинается с `\\`. Дальше идёт
  `realpath` кандидата (`shell.ts:62`), и только после него проверка «внутри Project-а» (`:64`).
  Если `docs` или `a.md` — symlink на `\\host\share\…`, `realpath` идёт по ссылке и Windows может
  обратиться к хосту раньше, чем путь будет отклонён. Это та же утечка NTLM, от которой защищает
  текстовая проверка.
- Тот же порядок у файлов Card: `resolveCardFile` сначала делает `realpath` кандидата
  (`src/main/cards/protocol.ts:198`), потом проверяет, что он внутри папки Card (`:199`). До этого
  — `realpath` папки всех Card-ов и папки самой Card (`:193-194`); папка Card, которая сама ссылка,
  отклоняется только после него (`:195`). Вызывают функцию обработчик `worfy-card://` (`:284`) и
  чтение файла Card для Linked machine (`:306`).
- Когда это возможно. В Project-е: репозиторий, в котором лежит такой symlink, выписан с
  `core.symlinks=true` (долг Ticket-а 08, `08-…md:371-374`). В папке Card: ссылку должен создать агент или скрипт — git туда не пишет.
- UNC-пути — понятие Windows: текстовая проверка уже включается только там
  (`paths.sep === '\\'`, `shell.ts:60`), и новое правило нужно только там же.
- Test-ы сейчас: `test/unit/shell-resolve.test.ts` — таблица по тексту пути с подменённым
  `realpath` и `path.win32` (`:15-80`) и случаи на настоящей файловой системе (`:102`; symlink —
  только не на Windows, `:117`); `test/contract/card-protocol.test.ts` — symlink наружу, внутрь и
  папка Card как ссылка (`:106`, `:113`, `:120`). Случая «ссылка на UNC» нет нигде. У
  `resolveProjectFile` файловая система подменяется через `ResolveOptions` (`shell.ts:37-42`); у
  `resolveCardFile` подмены нет.
- Это был долг и до PR #200: коммит f95b7e7 делал то же (комментарий ревью).

## Что делаем

1. **Одна функция для обоих мест — `src/main/remote-links.ts`** (новый): «есть ли на пути от
   `base` до `candidate` ссылка, которая уводит на удалённый путь». Идёт по сегментам пути под
   `base`: `lstat` сегмента; если это ссылка (symlink или junction) — `readlink`, цель разрешается
   от папки ссылки правилами платформы. Цель с ведущим `\\` (то, что `path.win32.resolve` даёт для
   UNC и device-путей), которая по тексту не лежит внутри разрешённых папок, — отказ: дальше ни
   `lstat`, ни `realpath`. Локальная цель — обход продолжается по ней, чтобы цепочка «ссылка →
   локальная ссылка → UNC» тоже была отклонена; предел длины цепочки — 40 переходов, дальше отказ.
   Перед каждым `lstat` путь проверяется по тексту: `lstat` пути с ведущим `\\` вне разрешённых
   папок не вызывается. `lstat` и `readlink` передаются параметрами (в test-ах — подмена), правила
   путей — тоже. Не на Windows (`sep` не `\`) функция сразу отвечает «нет» и файловую систему не
   трогает.
2. **`resolveProjectFile`** зовёт её после текстовой проверки (`shell.ts:61`) и до `realpath`
   (`:62`): `base` — корень Project-а или тот worktree, под которым по тексту лежит кандидат;
   разрешённые папки — те же `folders` и `bases`, что уже есть (`:56-57`). Отказ — та же ошибка
   «outside the Project and its worktrees». Project, который сам лежит на шаре, и Project через
   подключённый диск с реальным путём UNC открывают свои файлы как раньше (test-ы `:69-79`).
3. **`resolveCardFile`** — то же перед каждым из трёх `realpath` (`protocol.ts:193`, `:194`, `:198`):
   `base` — папка всех Card-ов как записана. Ответ при отказе — `null`, как у остальных отказов.
4. **Device-путь на локальный диск в цели ссылки** (`\\?\C:\…`). Решить в Ticket-е и покрыть
   test-ом: снять префикс `\\?\` у цели с буквой диска перед проверкой либо отказать. Что выбрано и
   что возвращает `readlink` Node для symlink и junction на Windows-ПК — в «Итог».
5. **Кто делает.** Session на Windows-ПК, после Ticket-а 11 (окно, меню, уведомления и Ctrl на
   Windows). PR трогает общий код (`shell.ts`, `protocol.ts`), поэтому получает метку
   `needs-mac-gate`: вливает его Session на Mac после зелёного gate full на Mac. В разделе «Mac
   checks» описания PR — `none`: сверх gate full на Mac проверять нечего, поведение на macOS не
   меняется.

**Не входит:** другие места, где main зовёт `realpath` для пути от пользователя или агента (если при
работе найдутся — список в «Итог», правка отдельным Ticket-ом); сравнение путей через `toLowerCase`
в `isInside` (долг Ticket-а 08); запрет на symlink-и вообще — ссылка, которая остаётся внутри
Project-а или Card, работает как раньше.

## Готово, когда

- [ ] `test/unit/remote-links.test.ts` (новый, `path.win32`, подменённые `lstat` и `readlink`; идёт
  на Mac, в Linux CI и на Windows): ссылка-файл и ссылка-папка с целью `\\host\share\x`,
  `//host/share/x`, `\\?\UNC\host\share\x` — отказ, и после `readlink` этой ссылки нет ни одного
  вызова `lstat`; цепочка «ссылка → локальная ссылка → `\\host\…`» — отказ; ссылка с локальной
  целью внутри `base` и ссылка на путь внутри разрешённой шары — «нет»; цепочка длиннее 40 — отказ;
  с `path.posix` — «нет» и ни одного вызова `lstat`.
- [ ] `test/unit/shell-resolve.test.ts`, `path.win32`, подменённые `real`, `lstat`, `readlink`:
  `C:\p\repo\docs\a.md`, где `docs` — ссылка на `\\evil\share\docs`, — ошибка «outside the
  Project», подменённый `real` для кандидата не вызывался ни разу. То же для ссылки-файла `a.md` и
  для файла в worktree. Project `\\nas\team\repo` со ссылкой внутри на `\\nas\team\repo\other` —
  файл открыт. Все прежние случаи файла зелёные без правок.
- [ ] `test/contract/card-protocol.test.ts`: `resolveCardFile` с подменёнными `lstat`, `readlink` и
  правилами `path.win32` — файл Card, который ссылка на `\\evil\share\x.png`, и папка Card, которая
  ссылка на `\\evil\share\card`, дают `null`, `realpath` для них не вызывался. Прежние случаи
  (`:106`, `:113`, `:120`) зелёные без правок.
- [ ] Mutation: проверка убрана из `resolveProjectFile` — новый случай `shell-resolve.test.ts`
  красный; убрана из `resolveCardFile` — новый случай `card-protocol.test.ts` красный.
- [ ] Windows-ПК: `pnpm test test/unit/remote-links.test.ts test/unit/shell-resolve.test.ts
  test/contract/card-protocol.test.ts` — код 0. Случай на настоящей файловой системе (только
  `win32`; пропуск с причиной, если у пользователя нет права создавать symlink): в папке Project-а
  создана ссылка на `\\worfy-no-such-host\share\a.md`, `resolveProjectFile` отклоняет путь, и
  `realpath`, обёрнутый счётчиком, для кандидата не вызывался.
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код
  выхода в «Итог».
- [ ] (вручную) Windows-ПК, `pnpm dev`: в Project-е с такой ссылкой щелчок по markdown-ссылке на
  файл за ней даёт отказ; время ответа и время `node -e "fs.realpathSync(…)"` того же пути — в
  «Итог» (отказ не ждёт сеть). В Project-е со ссылкой внутрь репозитория файл открывается.
- [ ] Mac: gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

## Тесты

Сначала падающий test — `test/unit/shell-resolve.test.ts`, случай «`docs` — ссылка на
`\\evil\share\docs`: `real` для кандидата не вызывается». На main `resolveProjectFile` зовёт
`real(candidate)` сразу после текстовой проверки (`shell.ts:62`) — test красный. В «Итог» — как он
падал.

- `test/unit/remote-links.test.ts` — новый: обход сегментов на подменённой файловой системе.
- `test/unit/shell-resolve.test.ts` — ссылка на UNC в Project-е и в worktree, Project на шаре;
  случай на настоящей файловой системе Windows.
- `test/contract/card-protocol.test.ts` — файл и папка Card как ссылка на UNC.
- Test-ы с подменой идут на Mac и в Linux CI; случай с настоящей ссылкой — только на Windows-ПК.

## Где в коде

- `src/main/remote-links.ts` (новый)
- `src/main/ipc/shell.ts`
- `src/main/cards/protocol.ts`
- `test/unit/remote-links.test.ts` (новый)
- `test/unit/shell-resolve.test.ts`
- `test/contract/card-protocol.test.ts`

## Итог

Заполняется при закрытии.
