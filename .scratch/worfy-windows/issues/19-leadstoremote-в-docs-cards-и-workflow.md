# 19 — Ссылка на `\\host\share\…` в HANDOFF, ADR, Card-ах и Ticket-ах: та же проверка `leadsToRemote` до обращения к файлу

Type: task
Status: open
Blocked by: 18
Source: решение владельца 2026-10-10; первый круг ревью PR #228 (Ticket [18](18-symlink-на-unc-до-realpath.md)) на Mac — [комментарий](https://github.com/IDSAD-XL/worfy/pull/228#issuecomment-6098109819), раздел «Same class, outside this PR — a separate ticket». Делает Session на Windows-ПК сразу после 18; дальше по порядку — 12, 10.

## Что происходит

Ticket 18 закрывает утечку NTLM-хэша через symlink для двух мест: файл Project-а по ссылке из
markdown (`src/main/ipc/shell.ts`) и файл Card (`src/main/cards/protocol.ts`). Если сегмент пути —
symlink на `\\host\share\…`, обращение к файлу по этой ссылке (`realpath`, `readFile`, `readdir`)
заставляет Windows подключиться к хосту по SMB и отдать ему хэш пользователя раньше, чем путь будет
отклонён. Ticket 18 вводит `leadsToRemote` (`src/main/remote-links.ts`): обход сегментов через
`lstat` и `readlink`, отказ до любого обращения по ссылке. Тот же класс остался ещё в трёх местах —
строки по main `d2a4eb4`, сверить при claim (после мержа PR #228):

- **`resolveDocPath`** (`src/main/docs/watch.ts:44-46`): `realpath` корня и `realpath` пути, который
  пришёл из renderer-а, идут до проверки «внутри Project-а». Текстовой проверки пути нет вовсе:
  путь `\\evil\share\HANDOFF.md` из renderer-а попадает в `realpath` напрямую.
- **`readDocs`** (`watch.ts:86-104`, вызов при старте наблюдения — `:149`): при открытии Project-а,
  без клика, читает `HANDOFF.md` и каждый файл ADR через `readDoc` и делает `readdir` папки ADR
  (`:91`) — по ссылкам. Достаточно открыть Project, в репозитории которого `HANDOFF.md`,
  `docs/adr` или файл ADR — symlink на шару.
- **Заголовок Card** (`src/main/cards/store.ts:134`, `readTitle` на `:47`): открывает (`open`) и
  читает `index.html` в папке Card по ссылке, без проверки границ.
- **Тексты Ticket-ов и spec** (`src/main/workflow/reader.ts:183` — `readText`, вызовы на `:194` и
  `:214` в `enrichSnapshot`): `readFile` файлов `<epic>/spec.md` и Ticket-ов из папки Ticket-ов
  (`.scratch` Project-а или Workflow folder в Silent mode) по ссылке, без проверки границ.

Когда это возможно — как в Ticket-е 18: репозиторий с таким symlink выписан с
`core.symlinks=true`; в папку Card ссылку должен положить агент или скрипт. UNC-пути — понятие
Windows: правило включается только там (`paths.sep === '\\'`), на Mac и Linux поведение не меняется.

## Что делаем

Переиспользуем `leadsToRemote` из Ticket-а 18, новой логики обхода не пишем.

1. **`resolveDocPath`.** До любого обращения к файловой системе: путь, записанный как UNC или
   device-путь, отклоняется по тексту (то же правило, что в `shell.ts`); затем
   `leadsToRemote(кандидат, [корень Project-а])` — «да» значит отказ с той же ошибкой, что и для
   пути вне Project-а. Корень Project-а на шаре (его собственная шара) остаётся разрешённым, как в 18.
2. **`readDocs`.** `HANDOFF.md`, папка ADR и каждый файл ADR проходят ту же проверку до `readdir` и
   чтения; файл или папка, которые ведут на шару, пропускаются так же, как нечитаемые (HANDOFF —
   `null`, ADR нет в списке), наблюдение не падает.
3. **Заголовок Card.** Перед `readTitle` — `leadsToRemote(путь index.html, [папка Card-ов])`; «да» —
   заголовок `null`, как у Card без файла.
4. **Ticket-ы и spec.** Перед `readText` в `enrichSnapshot` — `leadsToRemote(путь, [папка
   Ticket-ов])`; «да» — как нечитаемый файл (`null`).
5. Файловая система в новых test-ах подменяется так же, как в Ticket-е 18 (`RemoteLinkOptions`);
   где у функции нет шва для подмены — добавить его параметром по образцу `ResolveOptions`.

## Готово, когда

- [x] `resolveDocPath`, `path.win32`, подменённые `realpath`, `lstat`, `readlink`: путь
      `\\evil\share\HANDOFF.md` и `//evil/share/x` — отказ, `realpath` не вызван ни разу; `docs` или
      файл ADR — ссылка на `\\evil\share\…` — отказ, `realpath` кандидата не вызван, после `readlink`
      этой ссылки нет вызовов `lstat`; обычный HANDOFF и ADR — как раньше; Project на своей шаре — читается.
- [x] `readDocs`: `HANDOFF.md` — ссылка на шару → `handoff: null`; `docs/adr` — ссылка на шару →
      пустой список и ни одного `readdir` по ней; один ADR — ссылка на шару → его нет в списке,
      остальные есть.
- [x] Заголовок Card: `index.html` или папка Card — ссылка на шару → `title: null`, файл по
      ссылке не открыт.
- [x] `enrichSnapshot`: `spec.md` или файл Ticket-а — ссылка на шару → как нечитаемый, `readFile` по
      ссылке не вызван; остальные Epic-и и Ticket-ы читаются.
- [x] С `path.posix` во всех четырёх местах — прежнее поведение и ни одного вызова `lstat` от
      проверки.
- [x] Windows-ПК, настоящая файловая система: случай с настоящей ссылкой (как в Ticket-е 18) хотя бы
      для `resolveDocPath`; команда и вывод — в «Итог».
- [x] Каждый новый test краснеет на мутанте, который убирает проверку в своём месте.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Windows-ПК — без новых падений относительно main;
      gate full на Mac зелёный (общий код: проверяет и вливает Session на Mac).

Перенесено из второго круга ревью PR #228
([комментарий](https://github.com/IDSAD-XL/worfy/pull/228#issuecomment-6099170268), раздел «Carried
into Ticket 19»). Всё — в `src/main/remote-links.ts` и `test/unit/remote-links.test.ts`, если не
сказано иное:

- [x] Отказ при настоящих ошибках системы: `lstat` из `node:fs/promises` подменён и отклоняет
      путь-метку с EACCES, EPERM, ELOOP, ENOTDIR — `nodeLinks.isLink` отклоняет, а `leadsToRemote`
      (`path.win32`, без подменённых `links`) отвечает «да». Сейчас ловится только путь с NUL.
- [x] NT-префикс с прямыми слэшами (`/??/GLOBALROOT/…`, `\??/…`) — удалённый; `\??\c:\…` со
      строчной буквой диска — локальный путь.
- [x] Фильтр разрешённых папок: папка в NT-форме или «сервер без шары» в разрешённые не попадает.
- [x] Своё сообщение для отказа «не удалось проверить» (ошибка чтения, петля, 41-я ссылка) вместо
      «outside the Project and its worktrees»: в `resolveProjectFile` (`src/main/ipc/shell.ts`) и в
      местах этого Ticket-а, где отказ — ошибка с текстом.
- [x] Doc-комментарий к разбору цели: libuv снимает `\??\` перед буквой диска и переписывает
      `\??\UNC\` в `\\` у любого symlink-а; как записано возвращаются только остальные NT-формы.
- [x] Doc-комментарий к `LinkFs` («ни один вызов не идёт по ссылке»): `lstat` libuv на Windows
      переоткрывает reparse point, который не symlink, уже без `FILE_FLAG_OPEN_REPARSE_POINT`.
      Проверить junction на Windows-ПК, если получится; что увидено — в «Итог».
- [x] Заметка рядом с TOCTOU: `..` в целях NT-namespace и `\\?\` — `path.win32` схлопывает `..` у
      корня диска, Windows в этих пространствах имён — нет.
- [x] `isInside` и ведущие обратные слэши: `path.win32.relative` их отбрасывает, и UNC-путь, у
      которого имя сервера совпадает с диском разрешённой папки, может считаться внутренним
      (старше PR #228). Test и правка, либо строка в «Итог» с причиной, почему не правится.
- [x] [Ticket 18](18-symlink-на-unc-до-realpath.md), «Не проверено»: строка про junction уточнена
      по тому, что показала проверка на ПК.

## Тесты

Сначала падающий test: `resolveDocPath` с путём `\\evil\share\HANDOFF.md` — «`realpath` не вызван».
На main он красный: `realpath(lexical)` идёт сразу (`watch.ts:46`). В «Итог» — как он падал.

- Test-ы с подменой (`path.win32`) идут на Mac, в Linux CI и на Windows; случай с настоящей ссылкой
  — только на Windows-ПК.

## Где в коде

- `src/main/docs/watch.ts`
- `src/main/cards/store.ts`
- `src/main/workflow/reader.ts`
- `src/main/remote-links.ts` (из Ticket-а 18; правится, только если не хватает шва)
- `test/unit/docs-adr-order.test.ts`
- `test/contract/docs.test.ts`
- `test/contract/card-api.test.ts`
- `test/contract/workflow-reader.test.ts`
- `test/unit/remote-links.test.ts`

## Вне скоупа

- `src/main/ipc/shell.ts` и `src/main/cards/protocol.ts` — Ticket 18.
- Гонка между обходом и чтением (ссылку подменили между `lstat` и `readFile`) — долг из того же
  комментария ревью, вне модели угроз выписанного репозитория.
- Другие места чтения файлов Project-а, не названные в «Что происходит»: если при работе найдётся
  ещё одно того же класса — строкой в «Итог», не в этот PR.

## Риски

- `readDocs` идёт при открытии каждого Project-а и на каждое изменение наблюдаемых файлов: обход
  через `lstat` добавляет вызовы на каждый ADR. На Mac и Linux их нет вовсе (правило только для
  Windows); на Windows — измерить на Project-е worfy (около 60 ADR) и записать в «Итог».
- `src/main/workflow/reader.ts` и `src/main/docs/watch.ts` — общий код, который читают и другие
  Epic-и: перед claim сверить открытые PR по этим файлам.

## Итог

Заполняет Session на Windows-ПК. Что не проверено — в конце.

- **Что сделано.**
  - **HANDOFF и ADR** (`src/main/docs/watch.ts`).
    - `resolveDocPath`: UNC- или device-путь вне корня отклоняется по тексту, до любого обращения к
      файловой системе. Для остальных путей до `realpath` кандидата идёт обход ссылок
      (`walkLinks`); разрешённые папки — корень как записан и его реальный путь.
    - `readDocs`: папка ADR проверяется до `readdir`; HANDOFF и каждый ADR читаются через
      `resolveDocPath`. Что ведёт на шару — пропускается как нечитаемое, наблюдение не падает.
    - Шов для test-ов — `DocOptions`: правила путей, `lstat`/`readlink`, вызовы, которые идут по
      ссылке (`realpath`, `readdir`, `stat`, `readFile`).
  - **Заголовок Card** (`src/main/cards/store.ts`, `CardStore.info`): обход до `stat` папки Card и
    до `open` файла `index.html`; разрешённая папка — папка Card-ов. Шов — три новых поля
    `CardStoreOptions`.
  - **Ticket-ы и spec** (`src/main/workflow/reader.ts`, `enrichSnapshot`): обход до `readFile`
    файла `spec.md` и файла Ticket-а и до `readdir` папки `issues`; разрешённая папка — папка
    Ticket-ов. Шов — четвёртый параметр `EnrichOptions`.
  - **`src/main/remote-links.ts`.** Обход теперь называет причину: `walkLinks` отвечает `'local'`,
    `'remote'` или `'unchecked'`; `leadsToRemote` — его форма «да/нет» для мест, где отказ без
    текста. `isInside` под правилами Windows не считает UNC-путь лежащим внутри папки диска.
  - **`src/main/ipc/shell.ts`.** Отказ «не удалось проверить» получил свои слова (пункт 4 ниже).
- **Отступления от текста Ticket-а.**
  - **`resolveDocPath` и абсолютный UNC-путь.** Project открыт через подключённый диск или
    локальную ссылку, его реальная папка — на шаре. Абсолютный путь в эту реальную папку
    (`\\nas\team\repo\HANDOFF.md`) раньше читался, теперь отклоняется по тексту: до `realpath` корня
    реальный путь неизвестен, а пункт «Готово, когда» требует не вызывать `realpath` ни разу.
    Renderer передаёт относительные пути (`HANDOFF.md`, `docs/adr/…`) — для них ничего не
    изменилось, в том числе у такого Project-а (test «reached through a link to its own share»).
  - **Card, чья папка ведёт на шару, — `exists: false`**, а не только `title: null`: `stat` папки
    идёт по ссылке, без него узнать «есть ли Card» нельзя. Card, у которой на шару ведёт только
    `index.html`, — `exists: true`, `title: null`.
  - **`readdir` папки `issues` тоже за проверкой.** Ticket называл только `readText`, но это тот
    же вызов по ссылке в той же функции.
  - **Файлы test-ов.** Новые: `test/unit/docs-remote-links.test.ts` и
    `test/unit/workflow-remote-links.test.ts`. Случаи Card — в
    `test/contract/card-protocol.test.ts`: `CardStore` проверяется там, в `card-api.test.ts` его
    нет. `docs-adr-order.test.ts`, `docs.test.ts`, `card-api.test.ts` и `workflow-reader.test.ts`
    не правились.
- **Как test падал до правки.** Первый test Ticket-а — «refuses a UNC or device path by its text:
  Node is asked nothing at all, realpath included» (`docs-remote-links.test.ts`). На main (Windows)
  он красный за 1276 мс: `realpath` Node получил `\\worfy-no-such-host\share\HANDOFF.md`,
  `\\worfy-no-such-host\share\x`, `\\?\UNC\worfy-no-such-host\share\HANDOFF.md` и `\\.\pipe\x` —
  каждый после `realpath` корня. Случаи с настоящей ссылкой до правки: Card — 1287 мс, Ticket-ы —
  1282 мс (система искала хост).
- **Девять пунктов из второго круга ревью PR #228.**
  1. **Настоящие ошибки `lstat`.** Подменённый `lstat` из `node:fs/promises` отклоняет путь-метку
     с EACCES, EPERM, ELOOP, ENOTDIR: `nodeLinks.isLink` отклоняет с тем же кодом, `leadsToRemote`
     отвечает «да», `walkLinks` — `'unchecked'`.
  2. **NT-префикс с прямыми слэшами** (`/??/GLOBALROOT/…`, `\??/GLOBALROOT/…`, `/?/…`) — удалённый;
     `\??\c:\…` со строчной буквой — локальный путь. Пины, код не менялся.
  3. **Фильтр разрешённых папок.** Папка в NT-форме и «сервер без шары» среди разрешённых ничего
     не разрешают и ничего не ломают: ответ и вызовы те же, что без них.
  4. **Своё сообщение.** `<путь> cannot be checked: a link on the way to it cannot be read, or the
     links do not end` — в `resolveProjectFile` и в `resolveDocPath`. В заголовке Card и в чтении
     Ticket-ов отказ без текста (`null`), там различать нечего.
  5. **Doc-комментарий к разбору цели** — про то, что libuv снимает `\??\` перед буквой диска и
     переписывает `\??\UNC\` в `\\`.
  6. **Doc-комментарий к `LinkFs` и junction на ПК** — следующий пункт списка.
  7. **`..` в целях `\\?\C:\…` и `\??\C:\…`** — заметка в шапке `remote-links.ts`, рядом с TOCTOU.
  8. **`isInside` и ведущие обратные слэши** — исправлено. `path.win32.relative('C:\p\repo',
     '\\C:\p\repo\x')` отвечает `x`: сервер `C:`, шара `p` читались как диск. Теперь под правилами
     Windows UNC-путь не лежит внутри папки диска и наоборот. Test `isInside` и test обхода с
     кандидатом `\\C:\p\repo\x` до правки были красными. Правка действует и на проверку по тексту
     в `shell.ts`.
  9. **Строка про junction в «Не проверено» Ticket-а 18** уточнена.
- **Junction на ПК (пункт 6).** Windows 11 26200, Node 22.13.0, без прав администратора. Хост в
  целях не существует; время показывает, искала ли его система (поиск занимает около секунды).

  | Что создано | `lstat` Node | `readlink` | `realpath`, `stat`, `readdir` |
  | --- | --- | --- | --- |
  | junction на папку диска (`mklink /J`) | ссылка, 0,3 мс | цель | идут по ссылке |
  | junction на том по GUID (`mklink /J … \\?\Volume{…}\`) | **папка, не ссылка** | EINVAL | идут: `realpath` → `C:\` |
  | junction на `\\host\share` (`mklink /J`) | не создаётся: «требуется локальный том» | | |
  | junction с целью `\??\UNC\host\share` (`FSCTL_SET_REPARSE_POINT`) | ENOENT, 0,3 мс | EINVAL | ENOENT, 0,1–0,2 мс |
  | то же с целью `\??\GLOBALROOT\Device\Mup\host\share` | ENOENT, 0,3 мс | EINVAL | ENOENT, 0,1 мс |
  | то же с целью `\Device\Mup\host\share` | ENOENT, 0,3 мс | EINVAL | ENOENT, 0,1 мс |
  | symlink на `\\host\share\a.md`, для сравнения | ссылка | цель | `realpath` — 1268 мс |

  - Находка ревью подтверждена: `lstat` Node идёт по reparse point, который не может прочитать
    как ссылку. Junction на том по GUID он называет обычной папкой.
  - До хоста так не дойти: junction с сетевой целью Windows не проходит вовсе. Все вызовы
    отвечают ENOENT за доли миллисекунды, хост не ищется. Для обхода такой junction — «сегмента
    нет», ответ `'local'`; `realpath` вызывающего получает тот же ENOENT.
  - Это записано в doc-комментарии к `LinkFs`.
- **Мутанты.** 95, по одному; у каждого идут test-файлы его места, у `remote-links.ts` — все
  пять файлов Ticket-а. 94 валят test-ы: 47 из 48 в `remote-links.ts` (35 из них — мутанты
  Ticket-а 18 на нынешнем коде), 10 из 10 в `shell.ts`, 2 из 2 в `protocol.ts`, 20 из 20 в
  `watch.ts`, 7 из 7 в `store.ts`, 8 из 8 в `reader.ts`. В каждом из четырёх мест этого Ticket-а
  есть мутант «проверка убрана», и он красный.
  - Выживает один, равнозначный, тот же, что в Ticket-е 18: проверка текста пути прямо перед
    `lstat` в цикле обхода — удалённый путь до неё не доходит.
  - В первом прогоне выжил ещё один: ветка `readDocs` для корня, у которого не получился
    `realpath`. Она убрана правкой кода: у такого корня папка ADR больше не спрашивается вовсе, и
    test это закрепляет.
- **Время на ПК** (репозиторий worfy, медиана повторных вызовов, три прогона):
  - `readDocs`, 55 ADR и HANDOFF: 11,3 мс → 17,4 мс. Вызывается при открытии Project-а и на каждое
    изменение наблюдаемых файлов;
  - `enrichSnapshot`, 9 Epic-ов и 178 Ticket-ов: 17,8 мс → 38 мс. Snapshot собран из списка
    файлов: `epic-status` — bash-скрипт, на ПК не запускается. В приложении перед
    `enrichSnapshot` идёт запуск этого скрипта;
  - прибавка — по одному `lstat` на каждый сегмент пути от разрешённой папки для каждого файла.
    Кэша между файлами нет: правило риска из Ticket-а просило измерить, а не ускорить.
- **Windows-ПК** (Gate не запускался — он на bash, Ticket 03):
  - `pnpm install --frozen-lockfile` — 0, `pnpm lint` — 0, `pnpm typecheck` — 0, `pnpm build` — 0;
  - `pnpm test test/unit/remote-links.test.ts test/unit/shell-resolve.test.ts
    test/unit/docs-remote-links.test.ts test/unit/workflow-remote-links.test.ts` — exit 0:
    101 passed | 1 skipped. Пропущен один случай — symlink-псевдоним корня из Ticket-а 08, он не
    для Windows. Случаи с настоящими ссылками на `\\worfy-no-such-host\share\…` прошли, не
    пропущены: документы — «reads none of them through the link: realpath, readdir, stat and
    readFile of Node are asked about no such path», Ticket-ы — «reads and lists none of them
    through the link…»;
  - `pnpm test test/contract/card-protocol.test.ts` — exit 1: 74 passed | 5 failed. Девять случаев
    этого Ticket-а зелёные, в том числе с настоящими ссылками. Пять падений — четыре в «cards IPC
    domain» и «reports a file change of a Card within a second» — те же, что на main;
  - `pnpm test` — exit 1, как на main: 55 failed | 140 passed файлов, 663 failed | 3287 passed | 31
    skipped. Main `11ca93c`, прогнанный сразу после: 53 failed | 140 passed файлов, 661 failed |
    3234 passed | 31 skipped. По именам новых два, оба — `Test timed out in 5000ms` под нагрузкой:
    первый test `test/unit/canvas.test.tsx` и test `test/unit/shell-discovery.test.tsx`. Отдельно
    оба файла проходят: 40 из 40. Ушедших нет.
- **Другие места того же класса** (не правились — по условию Ticket-а строкой сюда):
  - `src/main/cards/store.ts`, `watchProject`: chokidar следит за папкой Card-ов с
    `followSymlinks` по умолчанию, то есть идёт по ссылкам внутри неё;
  - `src/main/docs/watch.ts`, `DocsWatcher.watch`: `fs.watch(root, { recursive: true })`. Идёт ли
    он на Windows по ссылке-папке внутри Project-а, не проверялось;
  - скрипт `epic-status` Harness сам читает файлы Ticket-ов — это не код worfy;
  - остальной список — в «Итог» [Ticket-а 18](18-symlink-на-unc-до-realpath.md).
- **Долги.** Обход и следующий за ним вызов (`realpath`, `readFile`, `open`, `readdir`) — два
  отдельных шага: ссылку, подменённую между ними, обход не видит. Как в Ticket-е 18.
- **Не проверено.**
  - Настоящая шара и настоящий NTLM-обмен: все ссылки вели на хост, которого нет; сетевой трафик
    не записывался.
  - В окне приложения ничего не открывалось: ни Project с такими ссылками, ни Card. Проверены
    функции — на подменённой файловой системе и на настоящих ссылках.
  - Reparse point-ы других видов (файлы OneDrive, ссылки WSL, псевдонимы приложений): `lstat`
    Node идёт и по ним, куда — не проверялось.
  - Junction с сетевой целью — на одной машине (Windows 11 26200). На Windows 10 21H2 не
    проверялось.
  - `test/contract/docs.test.ts` на Windows падает целиком и на main (22 из 22: «call rejected, it
    came from an untrusted frame», в test-е путь macOS). Случаи этого Ticket-а для документов
    поэтому лежат в отдельном unit-файле.
  - Gate на Windows и на Mac — см. пункты «Готово, когда».
