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

- [x] `test/unit/remote-links.test.ts` (новый, `path.win32`, подменённые `lstat` и `readlink`; идёт
  на Mac, в Linux CI и на Windows): ссылка-файл и ссылка-папка с целью `\\host\share\x`,
  `//host/share/x`, `\\?\UNC\host\share\x` — отказ, и после `readlink` этой ссылки нет ни одного
  вызова `lstat`; цепочка «ссылка → локальная ссылка → `\\host\…`» — отказ; ссылка с локальной
  целью внутри `base` и ссылка на путь внутри разрешённой шары — «нет»; цепочка длиннее 40 — отказ;
  с `path.posix` — «нет» и ни одного вызова `lstat`.
- [x] `test/unit/shell-resolve.test.ts`, `path.win32`, подменённые `real`, `lstat`, `readlink`:
  `C:\p\repo\docs\a.md`, где `docs` — ссылка на `\\evil\share\docs`, — ошибка «outside the
  Project», подменённый `real` для кандидата не вызывался ни разу. То же для ссылки-файла `a.md` и
  для файла в worktree. Project `\\nas\team\repo` со ссылкой внутри на `\\nas\team\repo\other` —
  файл открыт. Все прежние случаи файла зелёные без правок.
- [x] `test/contract/card-protocol.test.ts`: `resolveCardFile` с подменёнными `lstat`, `readlink` и
  правилами `path.win32` — файл Card, который ссылка на `\\evil\share\x.png`, и папка Card, которая
  ссылка на `\\evil\share\card`, дают `null`, `realpath` для них не вызывался. Прежние случаи
  (`:106`, `:113`, `:120`) зелёные без правок.
- [x] Mutation: проверка убрана из `resolveProjectFile` — новый случай `shell-resolve.test.ts`
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

Заполняет Session на Windows-ПК. Ручной пункт в `pnpm dev` заменён пробой на собранном приложении
(ниже); что не проверено — в конце.

- **Что сделано.**
  - `src/main/remote-links.ts` (новый): `leadsToRemote(candidate, allowed, { paths, links })` —
    «есть ли на пути к `candidate` ссылка, которая уводит на удалённый путь вне `allowed`». Идёт по
    сегментам: `lstat` сегмента, у ссылки — `readlink`, цель разрешается от папки ссылки. Удалённая
    цель вне `allowed` — «да», и после её `readlink` файловая система больше не спрашивается.
    Локальная цель обходится дальше (от разрешённой папки, в которой она лежит, или от корня её
    диска), так что цепочка «ссылка → локальная ссылка → шара» тоже отклоняется. Предел —
    `MAX_LINK_HOPS` = 40 ссылок, цикл в него упирается. Не на Windows — сразу «нет», без единого
    вызова. Туда же переехала `isInside` из `shell.ts`.
  - `resolveProjectFile` (`src/main/ipc/shell.ts`) зовёт её после проверки по тексту и до
    `realpath` кандидата; разрешённые папки — `folders` и `bases`, как у проверки по тексту. Отказ —
    та же ошибка «outside the Project and its worktrees».
  - `resolveCardFile` (`src/main/cards/protocol.ts`) зовёт её один раз, до первого `realpath`; обход
    смотрит папку всех Card-ов, папку Card, каждую папку пути и сам файл. Разрешённая папка —
    папка Card-ов как записана (если папка данных лежит на шаре, её файлы отдаются как раньше).
    У функции появился параметр `options` (правила путей, `lstat`/`readlink`, `realpath`, проверка
    «файл ли») — для test-ов.
- **Отступления от текста Ticket-а.**
  - У функции нет параметра `base`: начало обхода она выбирает сама — разрешённая папка, в которой
    кандидат лежит по тексту (сама эта папка тоже проверяется), а для локального пути вне всех
    разрешённых папок — корень его диска. Так закрыт и путь вне Project-а, идущий через ссылку на
    шару (`D:\other\link\a.md`): раньше он доходил до `realpath` и отклонялся после него.
  - В `resolveCardFile` — один вызов перед первым `realpath`, а не три: один обход проходит все три
    места, которые называл Ticket.
  - Трём прежним случаям `shell-resolve.test.ts`, где Project лежит на выдуманной шаре `\\nas\…`,
    передана подмена `lstat` (`NO_LINKS`); их утверждения не менялись. Без неё настоящий `lstat`
    на Windows шёл искать хост `nas`: случай занимал 2,7 с.
- **Device-путь в цели ссылки (пункт 4).** Выбрано «снять префикс»: `\\?\C:\x` читается как `C:\x`,
  `\\?\UNC\host\share` — как `\\host\share`; любой другой device-путь (`\\.\…`) считается
  удалённым. На ПК (Node 22.13.0, symlink-и создаются без прав администратора): `readlink` сам
  отдаёт цель без префикса — `\\?\UNC\h\s\a.md` → `\\h\s\a.md`, `\\?\C:\…\a.md` → `C:\…\a.md`,
  `//h/s/a.md` → `\\h\s\a.md`; относительная цель отдаётся как записана. Для symlink-а на файл,
  symlink-а на папку и junction `lstat().isSymbolicLink()` — `true`. Junction на UNC Node не
  создаёт: `symlinkSync(…, 'junction')` не бросает, но ссылки нет (`lstat` — ENOENT).
- **Как test падал до правки.** Первым написан случай `shell-resolve.test.ts` «`docs` — ссылка на
  `\\evil\share\docs`»: на main `promise resolved "'C:\p\repo\docs\a.md'" instead of rejecting`,
  подменённый `real` получал кандидата. Случай с настоящей ссылкой на main: `realpath` ушёл к
  несуществующему хосту на 1283 мс и ответил `UNKNOWN: unknown error, realpath`.
- **Мутанты:** 21 из 21 валят test-ы — 13 в `remote-links.ts`, 4 в `shell.ts`, 4 в `protocol.ts`,
  среди них названные в Ticket-е (проверка убрана из `resolveProjectFile`; убрана из
  `resolveCardFile`). Три выжили в первом прогоне и получили test-ы: ссылка ровно на корень шары
  последним сегментом (без явной проверки цели обход отвечал «нет»), шара с префиксом `\\?\UNC\`,
  Project, чья папка достигается через ссылку на собственную шару. Сортировка разрешённых папок
  по длине, которую ничто не различало, убрана.
- **Время на ПК.** `lstat` + `readlink` ссылки на `\\worfy-no-such-host\share\a.md` — 1,2 мс;
  `fs.realpathSync.native` того же пути — 1268 мс в первый раз (второй раз 2,4 мс: система помнит
  неудачный поиск хоста). В собранном приложении (Playwright `_electron`, временный spec, удалён;
  имя хоста новое на каждый запуск) `shell.openInEditor`: `link.md` — отказ «outside the Project
  and its worktrees» за 118 мс, `docs\deep\a.md` за ссылкой-папкой — 121 мс; несуществующий
  `missing.md` для сравнения — 121 мс. Отказ не ждёт сеть.
- **Windows-ПК** (Gate не запускался — он на bash, Ticket 03):
  - `pnpm install --frozen-lockfile` — 0, `pnpm lint` — 0, `pnpm typecheck` — 0, `pnpm build` — 0;
  - `pnpm test test/unit/remote-links.test.ts test/unit/shell-resolve.test.ts
    test/contract/card-protocol.test.ts` — exit **1**, не 0, как просил пункт «Готово, когда»:
    4 failed | 102 passed | 1 skipped. Оба unit-файла проходят целиком (пропущен один случай —
    symlink-псевдоним корня, он не для Windows). Четыре падения — в `card-protocol.test.ts`, блок
    «cards IPC domain» и «Card store»; на main `78fc03e` они падают так же (там пять, пятое —
    «reports a file change of a Card within a second» — плавает). Все случаи этого Ticket-а в
    файле зелёные, в том числе с настоящей ссылкой;
  - `pnpm test` — exit 1, как на main: 53 failed | 136 passed файлов, 635 failed | 3150 passed | 29
    skipped. Main `78fc03e`, прогнанный сразу после: 52 failed | 136 passed файлов, 635 failed | 3113
    passed | 29 skipped. По именам новое одно — timeout 5000 мс в `check-handoff` («counts the bytes
    and the lines of a CRLF working copy…») под нагрузкой, отдельно файл проходит (13 из 13); ушло
    одно — случай `startup-failure`, зависящий от скорости ПК. Прогон сделан до добавления случая
    Card с настоящей ссылкой; три файла Ticket-а после него перезапущены отдельно (строка выше).
- **Другие места, где main зовёт `realpath` для пути не от самого worfy** (не правились, по
  условию Ticket-а — отдельным Ticket-ом):
  - `src/main/docs/watch.ts`, `resolveDocPath`: `realpath` пути документа из renderer
    (`HANDOFF.md`, ADR) до проверки «внутри Project-а» — тот же порядок и тот же риск, что был в
    `shell.ts`;
  - `src/main/ipc/shell.ts`: `real(folder)` для папок из `git worktree list` — до всех проверок;
    их пишет git в `.git/worktrees`, не содержимое репозитория;
  - `src/main/agent/attachments.ts`: `stat`, чтение начала файла и `realpath` пути вложения,
    которое выбрал пользователь;
  - `src/main/mcp/canvas-server.ts`, `projectForCwd`: `realpathSync` для `cwd` Session;
  - папки Project-а и worktree, которые называет пользователь или git: `src/main/projects/store.ts`,
    `src/main/projects/connect.ts`, `src/main/ipc/checks.ts`, `src/main/gate/state.ts`,
    `src/main/link/caller.ts`, `src/main/autopilot/run.ts`.
- **Не проверено.**
  - Ручной пункт «щелчок по markdown-ссылке в `pnpm dev`» глазами не проходился: вместо него —
    вызов `shell.openInEditor` в собранном приложении (выше). Открытие файла за ссылкой внутрь
    репозитория в приложении не запускалось (оно открыло бы файл в программе владельца); это
    покрыто test-ом с настоящей ссылкой.
  - Настоящая шара и настоящий NTLM-обмен: все ссылки вели на хост, которого нет. Что Windows при
    `lstat` и `readlink` ссылки к хосту не обращается, видно по времени (1,2 мс), сетевой трафик
    не записывался.
  - Junction с целью UNC, созданный не Node (Node такой не создаёт).
  - Через `worfy-card://` в окне приложения файл Card за такой ссылкой не запрашивался: проверены
    `resolveCardFile` и обработчик протокола в test-е с настоящей ссылкой.
