# 11 — «Add Project» на Linked machine: выбор Machine и просмотр её папок

Type: task
Status: claimed — 2026-10-09
Branch: worfy-link/11
Blocked by: 09
Source: решения владельца 2026-10-07: Q3 (с другой машины можно всё, кроме действий, которым нужен рабочий стол машины Project-а), Q9 (у Project ровно одна Machine; один репозиторий на двух Machine — два Project-а), Q10 («Add Project» — выбор Machine, затем папка через просмотр её файлов внутри worfy), Q14 (системные диалоги — в UI машины, откуда вызваны; просмотр папок машины Project-а); [spec.md](../spec.md); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) — Machine, Linked machine, «Add Project» спрашивает Machine, потом папку; [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — системные действия в UI вызвавшей машины; [Ticket 24 Epic-а worfy-harness](../../worfy-harness/issues/24-подключение-project-а.md) — подключение Project-а по шагам

## Что происходит

- Сейчас «Add project» (кнопка — `src/renderer/shell/sidebar/ProjectsSection.tsx:145`) зовёт
  `projects.pickFolder`, потом `projects.add` (`ProjectsSection.tsx:120-130`). `projects.pickFolder` —
  нативный `dialog.showOpenDialog` на окне своей машины (`src/main/ipc/projects.ts:37-47`). Диалог ОС
  показывает диски той машины, на которой открыт.
- `ProjectStore.add` делает добавленный Project активным на своей машине
  (`src/main/projects/store.ts:232`). Активный Project рассылается всем окнам этой машины
  (`src/main/ipc/projects.ts:25-34`).
- Ticket 24 Epic-а worfy-harness (E3, Harness как plugin) превращает «Add project» в диалог по шагам:
  папка → режим (Full mode или Silent mode) → проверка Harness → черновик Profile от агентской
  Session → форма → запись скриптом `harness/bin/project-connect`. Его файлы —
  `src/main/projects/connect.ts` и `src/renderer/projects/ConnectProject.tsx` (оба новые в том
  Ticket-е). Папку выбирают в шаге 1; в шаге 2 для Silent mode можно выбрать другую Workflow folder
  (папку, где лежат файлы workflow Project-а) вместо `<HARNESS_HOME>/projects/<project>/workflow/`.
  В шаге 6 worfy добавляет Project (`ProjectStore.add`) и делает его активным. Все шаги идут на
  машине, где лежит папка. Epic worfy-link начинается после закрытия E3, поэтому этот Ticket
  строится поверх итога Ticket-а 24.
- После Ticket-а 09 окно зовёт канал на любой Linked machine-е явно (`invokeOn`), а окно, открытое
  на Project-е Linked machine-а, ходит на неё само. Ticket 08 пометил `projects.pickFolder` как
  `desktop` (нужен рабочий стол машины Project-а): Linked machine-у он недоступен, а из окна на
  Linked machine-е отвечает отказом (Ticket 09). Выбрать папку на Linked machine-е пока нечем. В
  окне на Linked machine-е нативный диалог своей машины доступен через `invokeOn` со своей Machine.
- Путь в `projects.add` — просто непустая строка (`src/shared/ipc/projects.ts:43`), без требования
  `/` в начале: схема уже годится для пути Windows (Epic worfy-windows).

## Что делаем

1. **До начала — вопрос владельцу:** что видно в просмотре папок Linked machine-а — весь диск или
   только домашняя папка? Рекомендация: весь диск, старт — в домашней папке. Linked machine с
   включённым доступом и так запускает Terminal на машине Project-а (Q3), то есть видит весь диск.
   Ограничение домашней папкой не защищает, а Project-ы вне неё (например, на втором диске) становятся
   недоступны. Ticket делает по ответу.
2. **Сначала Machine** (Q10). Когда есть хоть одна Linked machine, первый шаг «Add project» — выбор
   Machine: своя первой, затем Linked machine-ы по имени. Machine не в сети или с выключенным
   доступом «Linked machines can work with my Projects» недоступна для выбора, причина — рядом
   (состояние — из Ticket-а 02, доступ — из Ticket-ов 08 и 09). Linked machine-ов нет — шага нет,
   диалог Ticket-а 24 как есть.
3. **Папка Linked machine-а — просмотр внутри worfy** (Q10, Q14). Новый компонент
   `FolderBrowser` вместо нативного диалога — в шаге 1 (папка Project-а) и в шаге 2 (своя Workflow
   folder). Для своей машины остаётся нативный диалог.
   - Новый канал `projects.browse {path: string | null}` на выбранной Machine. `null` — стартовая
     папка (по ответу на вопрос 1). Ответ: `{path, parent, folders}`; `parent` — `null` у корня;
     `folders` — `{name, path, hidden, gitRepo}`, по имени. Только папки, symlink на папку — тоже.
     `hidden` — имя с точки. `gitRepo` — внутри есть `.git` (файл или папка); git не запускается.
     Больше 2000 папок — первые 2000 и `truncated: true`.
   - Папку, которую нельзя прочитать, канал не отдаёт: `{ok:false}` с причиной, просмотр
     показывает её на месте списка.
   - Путь — в форме ОС той Machine. Renderer путей не разбирает и не склеивает: идёт только по `path`
     и `parent` из ответа. Тогда просмотр работает и с Linked machine-ой на Windows.
   - Скрытые папки по умолчанию не показаны; флажок «Show hidden folders» показывает их (Workflow
     folder по умолчанию лежит в `~/.claude/worfy-harness/`).
   - Пометка Ticket-а 08 — `project`: Linked machine-у канал доступен только при включённом
     доступе.
4. **Остальное подключение — на выбранной Machine.** Все вызовы диалога Ticket-а 24 (вид папки,
   проверка Profile и Harness, Session черновика, проверка формы, `project-connect`) идут на
   выбранную Machine через `invokeOn`. Session черновика работает на ней, с cwd в её папке; диалог
   показывает её ход, как в Ticket-е 24. Само подключение этот Ticket не правит.
5. **Project добавляется на Linked machine, а не копируется** (Q9; ADR-0052). Его папка данных,
   Profile и запись в реестре Gate — на той Machine. На своей машине ничего не появляется, кроме
   строки в группе этой Machine в боковой панели (Ticket 09).
6. **Чей Project становится активным.** Добавление с Linked machine-а не меняет активный Project
   машины Project-а: её собственные экраны остаются на своём. Признак «вызов с Linked machine-а» —
   `event.sender` handler-а: клиент соединения, а не окно Electron (Ticket 08, пункт 7). Правка — в
   `ProjectStore.add` (`store.ts:232`) и в шаге 6 подключения. Окно, из которого добавили, само
   открывает новый Project — переходит на его Machine (Ticket 09, пункт 1). Добавление со своей
   машины — как сейчас.
7. **Связь пропала посреди диалога** или доступ закрыли — диалог показывает причину. До «Connect»
   ничего не записано (правило Ticket-а 24); после «Connect» — итог `project-connect`, как в Ticket-е 24.

**Не входит:** правка самого подключения (Ticket 24 Epic-а worfy-harness); смена Machine у уже
подключённого Project-а — такой операции нет (Q9).

## Готово, когда

- [ ] contract `test/contract/projects.test.ts`: `projects.browse` на временной папке отдаёт только папки, по имени; symlink на папку — есть, файл и symlink на файл — нет; `parent`, `hidden` и `gitRepo` верны; у корня `parent` — `null`; больше 2000 папок — 2000 и `truncated: true`; папка без права чтения — `{ok:false}` с причиной; `null` — стартовая папка по ответу владельца.
- [ ] contract: `projects.add` с Linked machine-а (поддельный вызов через адаптер Ticket-а 01) не меняет `activeId` в `projects.json`; со своего окна — делает Project активным, как сейчас.
- [ ] contract: с Linked machine-а при выключенном доступе `projects.browse` — отказ; `projects.pickFolder` с Linked machine-а — отказ при любом доступе.
- [ ] unit `test/unit/folder-browser.test.tsx` (новый): вход в папку и «вверх» по `parent`; флажок скрытых папок; «Choose» отдаёт `path` из ответа как есть — путь с `\` проходит без изменений; ошибка канала — причина на месте списка.
- [ ] unit `test/unit/add-project-machine.test.tsx` (новый): без Linked machine-ов шага выбора Machine нет; Machine не в сети и Machine с выключенным доступом недоступны, причина видна; выбор своей машины открывает нативный диалог, выбор Linked machine-а — `FolderBrowser`.
- [ ] e2e `test/e2e/projects.spec.ts` (своя машина, локально в gate full) — зелёный без правки.
- [ ] e2e `test/e2e/linked-add-project.spec.ts` (новый, локально в gate full): два связанных worfy A и B, у B доступ включён. В A: «Add project» → Machine B → просмотр до папки-fixture → подключение (Profile уже есть — так, как это делает `test/e2e/projects-connect.spec.ts` Ticket-а 24). Итог: Project в группе B в боковой панели A, окно A показывает его; Project есть в `projects.json` B и нет в `projects.json` A; активный Project B не изменился; подменённый `dialog.showOpenDialog` не вызван ни в A, ни в B.
- [ ] e2e: у B доступ выключен — в шаге выбора Machine B недоступна, причина видна.
- [ ] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

## Тесты

Сначала падающий test — `test/contract/projects.test.ts`: `projects.browse` на временной папке
отдаёт её подпапки. На main сейчас такого канала нет — test красный. В «Итог» — как он падал.

- `test/contract/projects.test.ts` — `projects.browse`, активный Project при добавлении с Linked
  machine-а, отказы при выключенном доступе.
- `test/unit/folder-browser.test.tsx` — новый: просмотр папок.
- `test/unit/add-project-machine.test.tsx` — новый: шаг выбора Machine.
- `test/e2e/linked-add-project.spec.ts` — новый: подключение Project-а на Linked machine-е. Отдельный
  файл, а не `test/e2e/linked-machines.spec.ts`: Ticket-ы 10 и 12 идут в той же Wave и пишут свои
  файлы e2e.

## Где в коде

- `src/shared/ipc/projects.ts`
- `src/main/ipc/projects.ts`
- `src/main/projects/store.ts`
- `src/main/projects/browse.ts` (новый)
- `src/main/projects/connect.ts`
- `src/renderer/projects/ConnectProject.tsx`
- `src/renderer/projects/FolderBrowser.tsx` (новый)
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `test/contract/projects.test.ts`
- `test/unit/folder-browser.test.tsx` (новый)
- `test/unit/add-project-machine.test.tsx` (новый)
- `test/e2e/linked-add-project.spec.ts` (новый)
- `src/renderer/projects/GithubAccount.tsx` — шаг аккаунта на Linked machine-е (добавлен исполнителем по брифу)
- `test/unit/link-access.test.ts`, `test/contract/projects-connect.test.ts` — пометки каналов подключения сменились (добавлены исполнителем по брифу)

`src/main/projects/connect.ts` и `src/renderer/projects/ConnectProject.tsx` заводит Ticket 24 Epic-а
worfy-harness. Если по его «Итог» файлы диалога называются иначе, исполнитель правит список. Пометка
Ticket-а 08 для `projects.browse` стоит в объявлении канала (`src/shared/ipc/projects.ts`), поэтому
общего файла с Ticket-ами 10 и 12 той же Wave нет. Если e2e нужен новый параметр `launchApp`, `test/e2e/helpers.ts`
добавляется в список.

## Итог

**Решено без владельца, подтвердить:**

1. **Что видно в просмотре папок** (вопрос пункта 1) — рекомендация Ticket-а: весь диск, старт — в
   домашней папке Machine (`os.homedir()` на ней). `projects.browse` путь не ограничивает: Linked
   machine с включённым доступом и так запускает Terminal на машине Project-а.
2. **Шаг GitHub-аккаунта на Linked machine-е — только чтение.** `projects.connect.accounts` идёт на
   выбранную Machine и показывает её аккаунты gh. Кнопки «Sign in with gh» и «First-run checks…» для
   чужой Machine нет. Вместо них строка «To sign in with gh, run gh auth login on <Machine> itself,
   then Check again». Каналы входа (`projects.connect.signIn*`) остаются `local`, поэтому Linked
   machine не может открыть вход в gh на этой машине.
3. **Шаг Harness на Linked machine-е.** Если Harness Machine-ы не готов, диалог показывает причину и
   строку «The Harness is set up on <Machine> itself, in its first-run checks». Кнопки
   «First-run checks…» для чужой Machine нет: экран первого запуска — это экран своей машины.
4. **Workflow folder на Linked machine-е** выбирается тем же `FolderBrowser`. Создать в нём новую
   папку нельзя (у нативного диалога есть `createDirectory`): выбирается существующая папка.

**Пометки каналов (Ticket 08) пересмотрены осознанно.** Шаги подключения теперь идут на выбранную
Machine через `invokeOn`, поэтому `projects.connect.inspect`, `.draft`, `.stop`, `.check`, `.write`,
`.activity` и `.accounts` переведены из `local` в `project`. Это самая закрытая пометка, при которой
вызов вообще доходит до другой Machine: только при включённом доступе «Linked machines can work with
my Projects». `desktop` не подходит: он закрыт для Linked machine-а всегда. Шесть каналов входа в gh
остались `local`. `projects.browse` — новый, `project`. Это закрепляет
`test/unit/link-access.test.ts` (каналы перечислены по имени, с разделением на `project` и `local`).
Следствие: в окне, открытом на Linked machine-е, эти каналы через `invoke` маршрутизируются на неё.
Поэтому `ConnectProject` и `GithubAccount` получили явный `machine` и зовут `invokeOn(machine, …)`.

**Что сделано.**
- `src/main/projects/browse.ts` (новый) — `browseFolder`: только папки (и symlink на папку), по имени
  (`Intl.Collator('en', {numeric})`), `hidden` — имя с точки, `gitRepo` — есть `.git` (файл или
  папка), git не запускается. Больше 2000 — первые 2000 и `truncated: true`. Папка без доступа или
  отсутствующая — `{ok:false, path, parent, reason}`: `parent` в ответе позволяет уйти вверх. У корня
  `parent: null`, в том числе `C:\` (`parentOf` с `path.win32`).
- `projects.browse {path: string | null}` (`src/shared/ipc/projects.ts`, handler в
  `src/main/ipc/projects.ts`). Относительный путь — ошибка вызова.
- Активный Project. `ProjectStore.add` уже умел `keepActive` (Ticket 09). Теперь его передают и
  `projects.connect.inspect` (папка, которую Harness уже знает), и `projects.connect.write`
  (`ProjectConnector.write(root, draft, {keepActive})` → `deps.add(root, {keepActive})`). Признак —
  `isRemoteCall(event)`: `event.sender` — клиент соединения, а не окно.
- `src/renderer/shell/sidebar/ProjectsSection.tsx`. Если есть хоть одна Linked machine, «Add project»
  сначала показывает шаг выбора Machine (`MachineChoice`): своя первой, затем Linked machine-ы по
  имени. Machine не в сети, спящая, со сменившимся сертификатом или с выключенным доступом выбрать
  нельзя — причина видна под именем. Своя машина → нативный диалог, как раньше. Linked machine →
  `FolderBrowser` → `projects.connect.inspect` на ней → известная папка добавляется там; новая
  открывает `ConnectProject` с `machine`. После добавления окно открывает Project на его Machine
  (`openProject(machine, id)`). «Choose another folder…» возвращает к просмотру той же Machine.
  Без Linked machine-ов шага нет.
- `src/renderer/projects/FolderBrowser.tsx` (новый): Up по `parent`, Home, вход в папку по строке,
  флажок «Show hidden folders», пометка `git`, строка об усечении. Ошибка — причина на месте списка.
  «Choose» отдаёт `path` ответа как есть. Ответ, пришедший после более позднего клика, отбрасывается.
- `ConnectProject.tsx`: все вызовы — на `machine`, строка «On <Machine>: …», Workflow folder Linked
  machine-а выбирается через `FolderBrowser`. Если связь пропала посреди диалога, причина приходит
  тем же путём, что и любая ошибка вызова (`failureReason`).

**Сначала красный test.** `test/contract/projects.test.ts` с новыми test-ами, до объявления канала (`browse.ts` уже был, канала и handler-а ещё не было, пометки `projects.connect.*` — `local`):
7 упали, 34 прошли. Пять test-ов `projects.browse` — `Error: no handler for projects.browse`.
`projects.browse` с Linked machine-а — `expected false to deeply equal [ 'shop' ]`.
`projects.connect.inspect` с Linked machine-а — `expected false to be 'added'` (канал был `local` и
отвечал отказом). После реализации — 41 passed.

**Mutation testing.** Убран `keepActive` из handler-а `projects.connect.inspect` — падает test
«projects.connect.inspect of a folder the Harness knows adds it without switching the active Project
for a Linked machine». В `ProjectConnector.write` подставлен `keepActive: false` — падает test
«with keepActive the Project joins the list and the active Project of this Machine stays». Код
восстановлен из копии.

**Тесты.**
- contract `test/contract/projects.test.ts`: `projects.browse` (только папки, symlink, `hidden`,
  `gitRepo`, `parent`, 2000 + `truncated`, нет доступа, нет папки, `null` → домашняя папка, отказ
  на относительный путь). Через адаптер Ticket-а 01 (`createLinkIpc` + `LinkPeer`): `browse` при
  доступе вкл/выкл; `pickFolder` — отказ при любом доступе, диалог не вызван; `projects.add` и
  `projects.connect.inspect` с Linked machine-а не меняют `activeId`, со своего окна — меняют.
- contract `test/contract/projects-connect.test.ts`: `write` с `keepActive` не меняет активный Project.
- unit `test/unit/folder-browser.test.tsx` (новый, пути в форме Windows),
  `test/unit/add-project-machine.test.tsx` (новый), `test/unit/link-access.test.ts` (новые пометки).
- e2e `test/e2e/linked-add-project.spec.ts` (новый): два связанных worfy. Домашняя папка B — временная
  fixture-папка (`HOME`). Просмотр до `code/shop` → Project в `projects.json` B и нет в A, активный B —
  `beta`, окно A на `?machine=B&project=shop`, строка выделена, `dialog.showOpenDialog` не вызван ни
  в A, ни в B. С выключенным доступом B недоступна в шаге выбора Machine, причина видна.

**Снимки** (Playwright, обе темы):
[шаг Machine](../evidence/11-machine-step-light.png) ([тёмная](../evidence/11-machine-step-dark.png)),
[B с выключенным доступом](../evidence/11-machine-step-access-off-light.png) ([тёмная](../evidence/11-machine-step-access-off-dark.png)),
[FolderBrowser](../evidence/11-folder-browser-light.png) ([тёмная](../evidence/11-folder-browser-dark.png)),
[скрытые папки](../evidence/11-folder-browser-hidden-light.png) ([тёмная](../evidence/11-folder-browser-hidden-dark.png)),
[папка без доступа](../evidence/11-folder-browser-denied-light.png) ([тёмная](../evidence/11-folder-browser-denied-dark.png)).
