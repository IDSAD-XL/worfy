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

- [ ] `resolveDocPath`, `path.win32`, подменённые `realpath`, `lstat`, `readlink`: путь
      `\\evil\share\HANDOFF.md` и `//evil/share/x` — отказ, `realpath` не вызван ни разу; `docs` или
      файл ADR — ссылка на `\\evil\share\…` — отказ, `realpath` кандидата не вызван, после `readlink`
      этой ссылки нет вызовов `lstat`; обычный HANDOFF и ADR — как раньше; Project на своей шаре — читается.
- [ ] `readDocs`: `HANDOFF.md` — ссылка на шару → `handoff: null`; `docs/adr` — ссылка на шару →
      пустой список и ни одного `readdir` по ней; один ADR — ссылка на шару → его нет в списке,
      остальные есть.
- [ ] Заголовок Card: `index.html` или папка Card — ссылка на шару → `title: null`, файл по
      ссылке не открыт.
- [ ] `enrichSnapshot`: `spec.md` или файл Ticket-а — ссылка на шару → как нечитаемый, `readFile` по
      ссылке не вызван; остальные Epic-и и Ticket-ы читаются.
- [ ] С `path.posix` во всех четырёх местах — прежнее поведение и ни одного вызова `lstat` от
      проверки.
- [ ] Windows-ПК, настоящая файловая система: случай с настоящей ссылкой (как в Ticket-е 18) хотя бы
      для `resolveDocPath`; команда и вывод — в «Итог».
- [ ] Каждый новый test краснеет на мутанте, который убирает проверку в своём месте.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Windows-ПК — без новых падений относительно main;
      gate full на Mac зелёный (общий код: проверяет и вливает Session на Mac).

Перенесено из второго круга ревью PR #228
([комментарий](https://github.com/IDSAD-XL/worfy/pull/228#issuecomment-6099170268), раздел «Carried
into Ticket 19»). Всё — в `src/main/remote-links.ts` и `test/unit/remote-links.test.ts`, если не
сказано иное:

- [ ] Отказ при настоящих ошибках системы: `lstat` из `node:fs/promises` подменён и отклоняет
      путь-метку с EACCES, EPERM, ELOOP, ENOTDIR — `nodeLinks.isLink` отклоняет, а `leadsToRemote`
      (`path.win32`, без подменённых `links`) отвечает «да». Сейчас ловится только путь с NUL.
- [ ] NT-префикс с прямыми слэшами (`/??/GLOBALROOT/…`, `\??/…`) — удалённый; `\??\c:\…` со
      строчной буквой диска — локальный путь.
- [ ] Фильтр разрешённых папок: папка в NT-форме или «сервер без шары» в разрешённые не попадает.
- [ ] Своё сообщение для отказа «не удалось проверить» (ошибка чтения, петля, 41-я ссылка) вместо
      «outside the Project and its worktrees»: в `resolveProjectFile` (`src/main/ipc/shell.ts`) и в
      местах этого Ticket-а, где отказ — ошибка с текстом.
- [ ] Doc-комментарий к разбору цели: libuv снимает `\??\` перед буквой диска и переписывает
      `\??\UNC\` в `\\` у любого symlink-а; как записано возвращаются только остальные NT-формы.
- [ ] Doc-комментарий к `LinkFs` («ни один вызов не идёт по ссылке»): `lstat` libuv на Windows
      переоткрывает reparse point, который не symlink, уже без `FILE_FLAG_OPEN_REPARSE_POINT`.
      Проверить junction на Windows-ПК, если получится; что увидено — в «Итог».
- [ ] Заметка рядом с TOCTOU: `..` в целях NT-namespace и `\\?\` — `path.win32` схлопывает `..` у
      корня диска, Windows в этих пространствах имён — нет.
- [ ] `isInside` и ведущие обратные слэши: `path.win32.relative` их отбрасывает, и UNC-путь, у
      которого имя сервера совпадает с диском разрешённой папки, может считаться внутренним
      (старше PR #228). Test и правка, либо строка в «Итог» с причиной, почему не правится.
- [ ] [Ticket 18](18-symlink-на-unc-до-realpath.md), «Не проверено»: строка про junction уточнена
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
