# 81 — Перенос Project-а Full ↔ Silent

Type: task
Status: done 2026-11-10T11:33Z
PR: #1770
Branch: worfy-polish/81
Blocked by: 78
Source: решение владельца 2026-11-09, Q6: перенос — отдельный ticket, низкий приоритет, после ticket-а 78 и после
Epic-а `worfy-multi-repo-ticket`. Описание переноса вынесено из ticket-а 79 (раздел «Перенос»). Строки перечитаны по
main `964061f9a`.

**Ждёт Epic `worfy-multi-repo-ticket` целиком** (решение владельца 2026-11-09, Q6): низкий приоритет.

## Что происходит

**`mode` задаётся один раз, при подключении.** Шаг Mode диалога Add project
(`src/renderer/projects/ConnectProject.tsx`); Full для папки над несколькими репозиториями отклоняют
`src/main/projects/connect.ts:569` и `harness/bin/project-connect:598`. Workflow folder по умолчанию —
`<папка Profile-а>/workflow` (`harness/bin/project-connect:557`, :608), своя — :613; Full требует
`workflow.folder: null` (:606).

**Profile пишет только скрипт Harness-а** (ADR-0073): `harness/bin/profile-set`, с `--expect <fingerprint>` и
commit-ом в git Harness-а. `mode` и `workflow.folder` он не пишет; ticket 78 расширяет `--field` на остальные поля
Profile-а, а эти два оставляет только для показа с пометкой «Changed by moving the workflow files».

**Переноса нет.** Файлы workflow Project-а в Full mode — в репозитории (ticket-ы, `spec.md`, ADR, файл состояния), в
Silent mode — в Workflow folder вне репозитория (ADR-0042). Поменять режим подключённого Project-а можно только
удалением и новым подключением, а ticket-ы при этом переносить руками.

## Что делаем

- Действие переноса в настройках Project-а, рядом с полем `mode` формы «Edit profile» (ticket 78).
- **Full → Silent:** ticket-ы, `spec.md`, ADR и файл состояния переезжают из репозитория в Workflow folder; в
  репозитории — commit удаления этих файлов, в Workflow folder — commit добавления. `mode: silent` и
  `workflow.folder` пишутся через `profile-set` (ADR-0073), с `--expect <fingerprint>`.
- **Silent → Full:** обратный путь; `mode: full`, `workflow.folder: null` — тоже через `profile-set`. Для Project-а над
  несколькими репозиториями запрещён (ADR-0045: такой Project — всегда Silent mode).
- **Отказ до любой записи**, с причиной:
  - незакоммиченные изменения в репозитории или в Workflow folder;
  - у Project-а работает Session;
  - у ticket-ов Project-а открыты PR.
- **История git читается:** файлы переезжают целиком, по одному commit-у с каждой стороны; сообщение commit-а
  называет, куда (или откуда) переехали файлы. Сбой на середине — откат обеих сторон и Profile-а, Project остаётся в
  прежнем режиме.

## Готово, когда

- [ ] Full → Silent: файлы workflow в Workflow folder, в репозитории их нет; `bin/profile` печатает `mode: silent` и
  новый `workflow.folder`; commit в репозитории, в Workflow folder и в git Harness-а.
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · f7beec4d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · df0b954a7
  - evidence: gate pass · `gate fast` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · a62427b47
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · a62427b47
  - evidence: gate pass · `gate fast` exit 0 · mac - · a62427b47
- [ ] Silent → Full: обратный путь проходит; для Project-а над несколькими репозиториями — отказ.
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · f7beec4d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · df0b954a7
  - evidence: gate pass · `gate fast` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · a62427b47
  - evidence: gate pass · `gate fast` exit 0 · mac - · a62427b47
- [ ] Незакоммиченные изменения, работающая Session или открытый PR ticket-а — отказ с причиной; ни один файл и
  Profile не изменились.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · f7beec4d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · df0b954a7
  - evidence: gate pass · `gate fast` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/edit-profile.test.tsx` exit 0 · mac - · a62427b47
  - evidence: gate pass · `gate fast` exit 0 · mac - · a62427b47
- [ ] Сбой на середине переноса — обе стороны и Profile как до переноса.
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move.test.sh` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · f7beec4d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · f7beec4d4
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move-recover.test.sh` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/profile-move.test.ts` exit 0 · mac - · df0b954a7
  - evidence: gate pass · `gate fast` exit 0 · mac - · df0b954a7
  - evidence: test-run pass · `bash harness/bin/tests/profile-set-move-recover.test.sh` exit 0 · mac - · a62427b47
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/docs-hub-hold.test.ts` exit 0 · mac - · a62427b47
  - evidence: gate pass · `gate fast` exit 0 · mac - · a62427b47
- [ ] `docs/features/projects.md` (и перевод в `docs/features/ru/`) описывает перенос.
  - evidence: gate pass · `gate fast` exit 0 · mac - · f7beec4d4
  - evidence: commit pass · Move a Project's workflow files between Full and Silent mode (worfy-polish 81) · - - · f7beec4d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · df0b954a7
  - evidence: gate pass · `gate fast` exit 0 · mac - · a62427b47

## Тесты

- `harness/test/` — `profile-set` для `mode` и `workflow.folder` только в составе переноса; чужой fingerprint — отказ.
- contract: перенос на fixture-репозитории в обе стороны; отказы (грязное дерево, Session, открытый PR); откат при
  сбое.
- unit (jsdom): действие переноса и текст отказа.

## Где в коде

- `harness/bin/profile-set` — запись `mode` и `workflow.folder`.
- `harness/bin/project-connect:557`, :598, :606, :608, :613 — `mode` и Workflow folder при подключении (образец правил).
- `src/main/projects/connect.ts:569` — отказ Full для папки над несколькими репозиториями.
- `src/renderer/projects/ConnectProject.tsx` — шаг Mode; `src/renderer/shell/ProjectSettings.tsx` — настройки
  Project-а (форма «Edit profile» из ticket-а 78).
- `docs/features/projects.md`, `docs/features/ru/projects.md`.

## Вне скоупа

- Удаление Project-а — ticket 79.
- Правка остальных полей Profile-а — ticket 78.
- Full mode для Project-а над несколькими репозиториями (ADR-0045).

## Итог

- Перенос — режим `harness/bin/profile-set --move <full|silent> [--folder <путь>]` с `--expect <fingerprint>` полей
  `mode` и `workflow.folder` (тот, что печатает `--field mode --field workflow.folder --read`). `--field mode` и
  `--field workflow.folder` по-прежнему отказывают (exit 2): эти поля пишет только перенос. План, проверки, копия,
  commit-ы и откат — `harness/lib/workflow-move.cjs`.
- Переезжают пути, которые Profile называет относительно Workflow folder: корень ticket-ов (`tickets.root`, без него
  `.scratch`; spec-и и evidence внутри), `docs.handoff.path`, `docs.adr_dir`, `numbering.adr.dir`,
  `docs.context.path`, `lessons: "repo:<путь>"`, а также папки шаблонов `tickets.path` и `tickets.spec` до первой
  подстановки, если они вне `tickets.root`. Абсолютный путь и `~/` остаются на месте. Копируются только
  отслеживаемые git файлы; файл, который `.gitignore` принимающей стороны игнорирует, добавляется `git add -f` и
  называется в ответе (`ignored`).
- Порядок: копия на другую сторону → commit там → `git rm` и commit на исходной стороне → запись `mode` и
  `workflow.folder` → commit в git Harness home (как у `--field`: сбой этого commit-а — предупреждение, не откат).
  Сбой на любом шаге до записи Profile-а включительно возвращает обе стороны: commit исходной стороны снимается
  `reset --keep`, commit принимающей — `reset --soft`, копии удаляются по одной, по имени (папка — только когда
  опустела), git-репозиторий, созданный переносом, удаляется. Что откат не смог вернуть — `leftover` в ответе, а worfy показывает это как сбой (`failed`), не как отказ.
- Перед первым шагом перенос пишет marker `.move-in-progress.json` рядом с `profile.json` и удаляет его, когда Profile
  записан или откат прошёл целиком. Убитый `profile-set` оставляет marker: `--read` полей печатает
  `interrupted: true`, следующий `--move` сначала откатывает тот перенос (или только закрывает его, если Profile уже
  записан). Перед откатом проверяются обе стороны: HEAD на commit-е из marker-а или собственный commit переноса над
  ним, меняющий только файлы переноса; в рабочем дереве исходной стороны — только удаления переноса, принимающей — только
  его копии с тем содержимым, какое было на старом месте (`git hash-object` против blob-а из `ls-tree`). Иначе отказ:
  marker остаётся, найденное названо («has changes since», «has commits since», «is not at the commit … recorded»,
  «changes files the move did not»). Marker, который не читается, — отказ с инструкцией. Сигнал только `profile-set`
  не останавливает его между шагами; сигнал всей группе процессов останавливает и его git, и перенос откатывается.
  Пока идёт перенос, отдельный маленький процесс node обновляет owner-файл lock-а каждые 5 с (и завершается вместе с
  `profile-set` или lock-ом), чтобы долгий перенос не сочли брошенным. worfy даёт переносу 30 минут вместо 120 с.
  `gh pr list` получает то же окружение без `GIT_DIR`. Если последний подписчик ушёл во время переноса и новый `open`
  успел открыть watch документов в старом корне, отпускание переводит этот watch в новый корень.
- git переноса получает окружение вызывающего без переменных, которые указывают на другой репозиторий (список
  `git rev-parse --local-env-vars`). Раньше снимались все `GIT_*`, вместе с `GIT_CONFIG_NOSYSTEM`: на Windows CI git
  переноса читал системный `core.autocrlf=true`, откат писал CRLF, и git test-а видел файлы изменёнными (CI run
  42761768987, строка FAIL с `git status`).
- Отказы до любой записи (exit 1, причина в stderr и `{ ok: false, errors }`): уже в этом режиме; Full mode для
  Project-а над несколькими репозиториями; незакоммиченные или неотслеживаемые файлы (`--untracked-files=all`), не
  свой git-репозиторий или detached HEAD в репозитории или Workflow folder; Workflow folder внутри репозитория, в том
  числе через ссылку на пути (путь разрешается `realpath` ближайшего существующего предка), или папка, которую перенос
  создал бы либо сделал бы `git init`, внутри другого git-репозитория; файл переноса уже на новом месте; открытый PR ветки ticket-а
  (строка `Branch:` или шаблон `tickets.branch` для Epic-а) или gh не смог ответить (`$PROFILE_SET_GH` — stand-in для
  test-ов). Репозиторий без remote gh не спрашивает.
- worfy: канал `profileEdit.move` (`local`), кнопка «Move to Silent mode…» / «Move to Full mode…» под режимом в «Edit
  profile» (`src/renderer/projects/MoveWorkflow.tsx`). Отказ «a Session of the Project is at work» — до вызова скрипта,
  для Session в состоянии `starting`, `busy` или `needs_permission` с cwd внутри Project-а или его Workflow folder.
  Watch-и Ticket-ов и документов Project-а закрываются на время переноса и открываются там, где файлы теперь:
  запись layout-кеша корня сбрасывается, watch документов стартует в корне, который называет `docsSource`
  (`holdProjectWatches` в `src/main/ipc/profile-edit.ts`). `profileEdit.read` отдаёт `fixedFingerprint`,
  `interrupted` и `severalRepos`; у Silent Project-а над несколькими репозиториями кнопки «Move to Full mode…» нет.
  Подтверждение называет lessons и оба пути. После переноса нижняя строка называет игнорируемые файлы и коллекции
  qmd, которые надо пересоздать.
- Test-ы: `harness/bin/tests/profile-set-move.test.sh` (156 проверок), `harness/bin/tests/profile-set-move-recover.test.sh`
  (181 проверка: ссылка, другой репозиторий, detached HEAD, файл на новом месте, папка шаблона spec-а, игнорируемый
  файл, конфиг git вызывающего, `GIT_DIR` у gh, lock долгого переноса, kill на каждом шаге и восстановление, чужие
  изменения на каждой стороне после kill-а, сломанный marker), `test/contract/profile-move.test.ts` (в том
  числе над настоящими `WorkflowHub` и `DocsHub`), `test/unit/edit-profile.test.tsx`. Mutation check: раунд 1 —
  14 мутантов, раунд review 1 — 22 мутанта, раунд review 2 — 13 мутантов, среди них «проверка принимающей стороны выключена» и «проверка исходной стороны выключена», все убиты.

### Решено без владельца

- Переезжают и glossary, и lessons, а не только ticket-ы, spec, ADR и файл состояния: в Silent mode Profile ищет их в
  Workflow folder (`harness/profiles/README.md`, «Full mode and Silent mode»), и оставленные в репозитории они бы
  потерялись.
- «Работает Session» — Session worfy не в ожидании (`starting`, `busy`, `needs_permission`). Session в `idle`,
  включая Orchestrator, перенос не останавливает; иначе Orchestrator активного Project-а не дал бы перенести никогда.
  Сессии Claude Code вне worfy (терминал) не проверяются.
- «Незакоммиченные изменения» — весь `git status --porcelain`, включая неотслеживаемые файлы.
- Detached HEAD — отказ: commit переноса не должен попасть на ветку, которой нет.
- Commit-ы переноса — без hook-ов и подписи (`core.hooksPath=/dev/null`, `commit.gpgsign=false`), как commit-ы
  `profile-set` в Harness home; identity репозитория, при её отсутствии — `Harness <harness@localhost>`.
- Сообщение commit-а в репозитории не содержит пути Workflow folder (в пути — домашняя папка пользователя): «…into the
  project's Workflow folder (Silent mode)».
- Своя Workflow folder для Full → Silent: абсолютный путь вне репозитория; несуществующая или пустая — `git init`,
  непустая — только свой чистый git-репозиторий.
- Строку `.claude/worktrees/` в `.git/info/exclude` перенос не добавляет (её добавляет `project-connect` при
  подключении Silent): у Full-репозитория worktree-корень обычно уже в `.gitignore`.
- Коллекции qmd перенос не меняет: их пересоздание пишет в `index.yml` qmd вне Harness home, а `qmd-collections` не
  трогает коллекции, которые Profile уже называет. Точные шаги руками — в `docs/features/projects.md`: `qmd collection
  remove` двух коллекций, `profile-set --field qmd --reset`, затем `qmd-collections <name>`.
- Игнорируемые принимающей стороной файлы переносятся `git add -f`, а не отказ: иначе Project с `*.png` в
  `.gitignore` репозитория не мог бы вернуться в Full mode с картинками ADR.
- Восстановление после kill — откат, а не доведение до конца, кроме случая, когда Profile уже записан: откат
  проверяем по тем же commit-ам, а доведение требовало бы повторить шаги с неизвестной точки.
