# 07 — Тексты skills для двух систем; перед Wave — открытые PR второго Epic-а

Type: task
Status: open
Blocked by: 03, 12
Source: решения владельца 2026-10-07: Q19 (скрипты Harness — на Node, команды skills — для обеих систем), Q25 (Session-ы Mac и Windows общаются через репозиторий; перед Wave — открытые PR второго Epic-а), Q12 (мерж в main по очереди); решения владельца 2026-10-08: Q30 (метка `needs-mac-gate`: PR Session Windows с общим кодом проверяет и вливает Session Mac; spec.md, «Соглашения», «Метка needs-mac-gate»), Q31 (Windows проверяет main после мержа: gate full на свежем main в начале каждой своей Wave, красный — первым делом чинит; уточняет ADR-0056, пункт 6), Q33 (раздел «Mac checks» в описании PR; Session Mac выполняет его вместе с gate full и пишет отчёт в PR; без отчёта мержа нет); spec.md, «Решения владельца», «Как работает очередь needs-mac-gate» ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node», пункт 6; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions», пункты 4–6; [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness по-английски); evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

Skills Harness — тексты, по которым агент работает. Их блоки команд агент выполняет Bash tool-ом:
на Mac это zsh, на Windows — Git Bash, то есть bash с GNU coreutils (ADR-0055).

- **Замок на главной ветке** (`harness/skills/epic-wave/SKILL.md:316-334`). Блок `:321-330` берёт
  время изменения папки замка командой BSD `stat -f %m "$L"` (`:324`). В GNU `stat` ключ `-f` —
  сведения о файловой системе, а `%m` читается как имя файла. Команда кончается ошибкой, и
  `|| continue` уходит на следующий круг без `sleep`. Цикл крутится вхолостую, а замок старше 90
  минут не снимается. На ПК в Git Bash `stat -f %m <файл>` — EXIT=1, `stat: cannot read file system
  information for '%m'` (evidence Ticket-а 01, раздел 05); сам блок не запускался.
- **Ветки за 14 дней** (`harness/skills/continuous-audit/SKILL.md:121-126`). `date -v-14d +%s`
  (`:123`) GNU `date` не знает: на ПК — `date: unknown option -- v`, EXIT=1; `date -d '-14 days'`
  работает (evidence, раздел 05). awk получает пустой порог, и фильтр по дате, похоже, пропускает
  все ветки. Блок пишет в `$TMPDIR/live-tickets.jsonl` (`:125`); в Bash tool на ПК `TMPDIR` задан —
  `/c/Users/Alexey/AppData/Local/Temp` (раздел 05).
- **Ручные проверки GUI** (`harness/skills/ship-ticket/SKILL.md:180-198`, раздел 6) — только для
  macOS: разрешения Screen Recording и Accessibility (`:181`), `screencapture` (`:186`), запуск «как
  из Finder» через `env -i` с окружением launchd вместо `open` (`:190-194`), `open -b` и проверка
  пути процесса `ps -o comm= -p <pid>` (`:194-196`). Шага для Windows нет. Ticket 12 даёт для
  Windows неподписанный установщик NSIS и Stable copy и пишет путь копии в `CONTEXT.md`.
- **agents и rules.** В `harness/agents/*.md` и `harness/hooks/rules/*.md` команд BSD и macOS нет:
  `grep -rnE 'stat -f|date -v|open -|ps -o|screencapture|osascript' harness/agents harness/hooks/rules`
  пуст. Вызовы Gate в них меняет Ticket 03.
- **Второй Epic.** Session Mac ведёт Epic `worfy-link`, Session Windows — `worfy-windows`. Прямого
  канала между ними нет; общее — только репозиторий (ADR-0056, пункт 4).
  - Раздел 1 `epic-wave` уже берёт открытые PR с их файлами:
    `gh pr list --state open --json number,headRefName,mergeStateStatus,files` (`SKILL.md:69`). Но
    ищет в них только занятые номера ADR (`:78`) и состояние мержа. Пересечение файлов Ticket
    проверяет только с Ticket-ами своей Wave и Ticket-ами в работе (`:100`, `:125-130`).
  - Раздел 4: `BEHIND` — «wait» (`:296`). Если main ушёл вперёд от мержа на другой машине, ждать
    нечего: ветка сама не обновится.
  - Замок на главной ветке — папка в scratchpad или в `git-common-dir` (`:316-334`). Он виден только
    на своей машине; Session на другой машине его не видит.
  - Session на Windows не может прогнать gate full на Mac. Владелец решил 2026-10-08 (Q30): её PR
    с общим кодом получают метку `needs-mac-gate`, их проверяет и вливает Session на Mac перед своей
    Wave (spec.md, «Соглашения», «Метка needs-mac-gate»). В тот же день — Q31 и Q33. Q31: gate
    full на Windows после rebase до мержа не повторяется; Session на Windows в начале каждой своей
    Wave гоняет gate full на свежем main, красный — первым делом чинит. Q33: Session на Windows пишет
    в описании PR раздел «Mac checks» — команды шагов на Mac сверх gate full; Session на Mac
    выполняет их вместе с gate full и пишет отчёт в PR; без отчёта мержа нет. До этого Ticket-а
    правило выполняется вручную: в skills его нет, и роль Machine нигде не записана.
  - Q32 (команда `/worfy:gate-queue`, действие «Process gate queue» в worfy, уведомление о PR,
    который ждёт больше часа) — Ticket 17. Он ждёт этот Ticket и переносит проход очереди из
    раздела 1 `epic-wave` в свою команду.
- **Ограничения test-ов.**
  - `harness/bin/tests/epic-wave-ship-ticket.test.sh` держит номера разделов (`:88-91`: `epic-wave`
    0–5, `ship-ticket` 0–11) и не пускает кириллицу вне списка (`:127-147`). Новый текст — по-английски
    (ADR-0044).
  - `harness/bin/tests/skill-blocks.test.sh` гоняет блоки `overnight-fix-loop` под bash и под zsh
    (`:42`, `:53`, `:68`, `:85`). zsh в Git Bash нет (ADR-0055), поэтому на Windows test падает на
    случаях zsh.
  - Оба test-а используют perl (`epic-wave-ship-ticket.test.sh:34`, `:145`). На Windows test-ы идут
    в Git Bash с `jq` и perl (ADR-0055, пункт 4). В Git Bash ПК perl есть, `jq` и zsh — нет
    (evidence Ticket-а 01, раздел 05).
- **`gh --jq` без внешнего `jq`** на ПК работает: `gh pr list --json number,headRefName,files --jq
  '…'` в Git Bash — EXIT=0 (evidence, раздел 19). На нём стоят блоки пункта 4.

## Что делаем

1. **Замок на главной ветке** (ADR-0055, пункт 6). Вместо `stat -f %m` — команда, одинаковая в BSD и
   GNU. Например, `find "$L" -maxdepth 0 -mmin +90` печатает путь, если папке больше 90 минут, и
   тогда `rmdir`. Комментарий `Linux: stat -c %Y` уходит.
2. **Ветки за 14 дней.** Порог — `$(( $(date +%s) - 14 * 86400 ))` вместо `date -v-14d +%s`. Файл —
   `${TMPDIR:-/tmp}/live-tickets.jsonl`.
3. **Шаг для Windows в ручных проверках GUI** (`ship-ticket`, раздел 6; новых разделов нет). Абзац
   по-английски для Windows:
   - снимки — только Playwright своей сборки, как на Mac; что Windows спрашивает при снимке экрана и
     управлении, проверить на Windows-ПК и записать в абзац;
   - запуск «как из меню Пуск», без окружения агента (`CLAUDECODE`, `CLAUDE_CODE_*`, PATH агента и
     `NoDefaultCurrentDirectoryInExePath=1`, который Claude Code задаёт своим процессам — evidence
     Ticket-а 01, раздел 20). Кандидат — `explorer.exe <путь к worfy.exe>`; выбрать и проверить на
     Windows-ПК;
   - путь процесса — `powershell -NoProfile -Command "(Get-Process -Id <pid>).Path"` вместо `ps -o
     comm= -p <pid>`: на машине могут стоять несколько сборок с одним app id;
   - для worfy: установщик и путь Stable copy на Windows — по `CONTEXT.md` (Ticket 12).
4. **Перед Wave — открытые PR других Epic-ов** (Q25, ADR-0056 пункт 5). В разделе 1 `epic-wave` —
   блок с `gh pr list --state open --json number,headRefName,files` и встроенным в `gh` фильтром
   `--jq`, без внешнего `jq`. Он печатает строки `#<N> <ветка> <файл>` для PR, чья ветка не
   подходит под шаблон `F tickets.branch` этого Epic-а. Правило в тексте:
   - файлы этих PR сравниваются с файлами Ticket-ов Wave (раздел `F tickets.trail_section`, у
     worfy — «Где в коде»);
   - Ticket с общим файлом в Wave не берётся, пока тот PR не влит. В таблице плана и в отчёте Wave —
     Ticket, файл и номер PR.

   Правило общее для любого Project-а: для одной машины оно значит «PR другой Session».
5. **Мерж по очереди между машинами** (Q12, ADR-0056 пункт 6). В разделе 4 `epic-wave`:
   - замок на главной ветке виден только своей машине; другая Session мержит сама;
   - перед мержем — `git fetch`. Если PR в состоянии `BEHIND` или база ушла вперёд после его
     проверок, ветку перебазируют на свежую базу в worktree Ticket-а, пушат и снова ждут CI
     (прежний блок ожидания CI). `BEHIND` больше не значит только «wait».
6. **Метка needs-mac-gate в Harness** (Q30, Q31, Q33, решения владельца 2026-10-08; spec.md,
   «Соглашения», «Метка needs-mac-gate»).
   - **Где задаются метка и роль Machine** — в Profile на Machine. Profile целиком лежит на Machine
     (ADR-0042), у Windows-ПК свой Profile worfy. Новые поля — в контракте
     `harness/profiles/README.md`, таблица `profile.json`, читатели — `epic-wave` и `ship-ticket`:
     - `cross_machine_gate.label` — строка, имя метки GitHub; у worfy — `needs-mac-gate`;
     - `cross_machine_gate.role` — `"request"` или `"serve"`. `request` (Windows-ПК): ставить метку
       на свои PR с общим кодом и не вливать их. `serve` (Mac): перед каждой Wave проходить
       открытые PR с меткой;
     - `cross_machine_gate.exempt` — пути, правка которых метки не требует: документы и чисто
       Windows-специфичные файлы. Путь с `/` на конце — папка, как в `filesOverlap`
       (`src/shared/workflow/waves.ts`). Читается при `request`;
     - `cross_machine_gate.check` — команда проверки ветки на Machine с `serve`. У worfy —
       `GATE_SCOPE=all` gate full под замком `/tmp/worfy-e2e.lock` (сегодня команда — в `rules.md`
       Profile-а worfy). Читается при `serve`;
     - `cross_machine_gate.checks_section` — строка, заголовок раздела описания PR с командами для
       Machine с `serve` сверх `check` (Q33); у worfy — `Mac checks`. Читается при обеих ролях:
       `request` пишет раздел, `serve` выполняет его и пишет отчёт.

     Нет поля — exit 4: у Project-а одна Machine, шаг пропускается, и skill говорит об этом словами.
     `bin/profile` проверяет поле так же, как `mode`. `role` не `request` и не `serve`, нет `label`
     или `checks_section`, `serve` без `check` — exit 1 с причиной в stderr. Угаданная роль либо
     вливает PR без gate full на Mac, либо оставляет PR без того, кто его вольёт.
   - **Значения** пишет Orchestrator в Profile каждой Machine: на Windows-ПК — `"role": "request"`,
     на Mac — `"role": "serve"`. `exempt` у worfy — документы из правила spec.md (`.scratch/`,
     `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md`); Windows-специфичный файл входит в него, только
     если на macOS его не читают ни код, ни test-ы, ни сборка. Profile не в репозитории, PR для него
     нет (ADR-0042).
   - **`ship-ticket`, раздел 8** (PR и зелёный CI). При `request` после `gh pr create` — блок: файлы
     PR (`gh pr view <N> --json files` с `--jq`) сравниваются с `exempt`. Есть файл вне `exempt` —
     `gh pr edit <N> --add-label <label>`. Блок печатает `label` или `no-label`.
   - **Раздел `checks_section` в шаблоне PR — `ship-ticket`, раздел 8** (Q33). При `label` Session
     дописывает в описание PR раздел `## <checks_section>` (`gh pr edit <N> --body-file <файл>`:
     прежнее описание и раздел). В нём — команды пунктов «Готово, когда» Ticket-а, которые идут на
     Machine с `serve` сверх `check`, у каждой — ожидаемый результат. Таких пунктов нет — строка
     `none`. Как Ticket называет такие пункты, skill берёт из Ticket-а, а не из своего текста: у
     worfy они помечены «через раздел Mac checks PR, Q33».
   - **`ship-ticket`, раздел 9** (мерж). При `request` PR с меткой эта Machine не вливает. Ticket —
     `ticket block` с причиной: ждёт Machine с `serve`, метка и номер PR.
   - **`epic-wave`, раздел 1** (Preflight), первым шагом:
     - при `serve` — открытые PR с меткой (`gh pr list --state open --label <label> --json
       number,headRefName`), по одному. Для каждого: worktree на ветке PR, rebase на свежую базу,
       `git push --force-with-lease`, `check` с кодом выхода, затем команды раздела
       `checks_section` из описания PR (`gh pr view <N> --json body` с `--jq`; раздел — до
       следующего заголовка), у каждой — код выхода (Q33). PR без раздела — красный с причиной
       «no `<checks_section>` section». Потом ожидание CI прежним блоком раздела 4;
     - **отчёт** (Q33) — `gh pr comment <N> --body-file <файл>`. Первая строка —
       `<checks_section> report: green` или `<checks_section> report: red`; дальше строка вердикта
       и код выхода `check`, каждая команда раздела с кодом выхода и хвостом вывода, при красном —
       причина. Зелёный: `check`, команды раздела и CI зелёные и отчёт в PR (`gh pr comment` — exit
       0) — `gh pr merge <N> --squash`, затем `gh pr edit <N> --remove-label <label>`. Без отчёта
       мержа нет. Красный или конфликт rebase — отчёт с причиной, метка остаётся. Конфликт только в
       файле состояния (`F docs.handoff.path`, у worfy — `HANDOFF.md`) Session решает сама: его
       решает та, что мержит (ADR-0056, «Последствия»). gate full на Machine с `request` после
       rebase до мержа не повторяется (Q31). Ticket-ы чужого Epic-а Session не берёт и их Status не
       меняет. Итог прохода — PR, вердикт, мерж или отчёт — в отчёт Wave (раздел 5);
     - при `request` — сначала gate full на свежей базе (Q31): `git fetch`, отдельный worktree
       `--detach` на `origin/<база>`, та же команда gate full, что в разделе 3. Строка вердикта и
       код выхода — в отчёт Wave. Красный — Ticket-ы Wave не раздаются: первым делом починка базы,
       в отчёте Wave — вердикт и что чинится. Правка с общим кодом идёт по тому же правилу — с
       меткой и разделом `checks_section`. Зелёный — свои PR с меткой. Влитый — Ticket закрывается
       по `ship-ticket`, раздел 11. Отчёт о красном новее последнего push — Ticket снова в работе
       (`ticket open`), ветка берётся с origin заново: её перебазировали на другой Machine.
   - **`epic-wave`, раздел 4** (мерж по правилам). При `request` PR с меткой не вливается; в отчёте
     Wave он — «ждёт Machine с `serve`».
   - **ADR** — новый файл в `docs/adr/`, имя с номером даёт ship-ticket. Он говорит, что уточняет
     ADR-0056: решения Q30–Q33, пять полей `cross_machine_gate` и отвергнутые варианты из spec.md
     (раздел «Решения владельца», пункты «gate full на Mac для PR Session Windows» и «Как работает
     очередь needs-mac-gate»). Q31 — уточнение ADR-0056, пункт 6: повтора gate full на Windows после
     rebase нет, main проверяется на Windows в начале её Wave. Q32 называет механизм, который делает
     Ticket 17. ADR-0056 не правится.
   - Новых разделов нет: test держит их номера (`epic-wave` 0–5, `ship-ticket` 0–11). Текст —
     по-английски (ADR-0044). Имя метки и роль skills берут из Profile, а не пишут в текст.
7. **Test-ы.**
   - `skill-blocks.test.sh` гоняет новые блоки, вырезанные из `SKILL.md`: замок, ветки за 14 дней и
     выбор метки из `ship-ticket`, раздел 8.
   - Случаи zsh на Windows (`uname -s` — `MINGW*` или `MSYS*`, zsh нет) пропускаются строкой
     `skip zsh: …`. На Mac и Linux отсутствие zsh — по-прежнему провал:
     `test/contract/harness-scripts.test.ts` требует zsh.
   - `epic-wave-ship-ticket.test.sh` проверяет новые куски текста.
   - `profile.test.sh` — contract test поля `cross_machine_gate`.

Не входит:

- `harness/skills/qmd/SKILL.md` (Ticket 15).
- `jq` в текстах skills остаётся: на Windows его ставят отдельно, `winget install jqlang.jq`
  (ADR-0055, «Последствия»).
- Имя Gate в skills (Ticket 03).
- Явный `node` вместо вызова по shebang в skills и agents. Он не нужен: в Git Bash shebang работает —
  в Bash tool и в hooks (evidence Ticket-а 01, разделы 13 и 19; ADR-0055, пункт 2).
- Правило «платформенный PR — после gate full на Windows-ПК» (ADR-0056, пункт 2) в текст skills не
  входит.
- Команда `/worfy:gate-queue`, действие «Process gate queue» и уведомление worfy о PR, который ждёт
  больше часа (Q32), — Ticket 17. Здесь проход очереди — блок раздела 1 `epic-wave`; Ticket 17
  переносит его в команду.

## Готово, когда

- [ ] `grep -rnE 'stat -f|date -v' harness/skills harness/agents harness/hooks/rules` — exit 1.
- [ ] `skill-blocks.test.sh`, блок замка из `epic-wave/SKILL.md`. Папка замка со временем изменения два часа назад (`touch -t`) снимается и берётся заново — вывод `LOCKED`. Свежая папка после одного круга остаётся (в test-е `sleep 30` заменён на `break`, а число кругов ограничено, чтобы холостой цикл не повесил прогон). Под bash и под zsh на Mac.
- [ ] `skill-blocks.test.sh`, блок веток за 14 дней из `continuous-audit/SKILL.md`. В репозитории test-а есть `refs/remotes/origin/old` (коммит 20 дней назад) и `origin/new` (1 день назад); `epic-status` подменён stub-ом. В `live-tickets.jsonl` — только Ticket-ы `origin/new`.
- [ ] `epic-wave-ship-ticket.test.sh`: в разделе 1 `epic-wave` есть блок с `--json number,headRefName,files` и `--jq` и правило «not dispatched until that PR is merged»; в разделе 4 — `BEHIND` с перебазированием и повторным CI; в разделе 6 `ship-ticket` — абзац Windows с `Get-Process` и способом запуска. Проверки номеров разделов и кириллицы проходят.
- [ ] `skill-blocks.test.sh`, блок выбора метки из `ship-ticket/SKILL.md`, раздел 8, `gh` подменён stub-ом. Файлы PR только из `exempt` — вывод `no-label`, `gh pr edit` не вызван. Один файл вне `exempt` — вывод `label` и вызов `gh pr edit <N> --add-label needs-mac-gate`. Путь `exempt` с `/` на конце покрывает файлы в этой папке. Под bash и под zsh на Mac.
- [ ] `epic-wave-ship-ticket.test.sh`, метка `needs-mac-gate`: в разделе 1 `epic-wave` — `cross_machine_gate`, `--label`, `--force-with-lease`, `--remove-label`, `gh pr comment` и правило «one at a time»; там же ветка `request` — закрытие влитого Ticket-а и возврат в работу после красного. В разделе 4 `epic-wave` — PR с меткой не вливается при `request`. В разделе 8 `ship-ticket` — `--add-label`, в разделе 9 — PR с меткой эта Machine не вливает. Имени `needs-mac-gate` в тексте skills нет: оно берётся из Profile. Проверки номеров разделов и кириллицы проходят.
- [ ] `epic-wave-ship-ticket.test.sh`, Q31 и Q33. В разделе 1 `epic-wave` при `serve` — `checks_section`, `report: green`, `report: red`, правило «no merge without the report» и `gh pr comment` перед `gh pr merge`; при `request` — gate full на свежей базе в отдельном worktree `--detach` до раздачи Ticket-ов и правило «fix the base first». В разделе 8 `ship-ticket` — `checks_section`, `--body-file` и `none`. Имени `Mac checks` в тексте skills нет: оно берётся из Profile. Проверки номеров разделов и кириллицы проходят.
- [ ] `skill-blocks.test.sh`, блок раздела `checks_section` из `epic-wave/SKILL.md`, раздел 1, `gh` подменён stub-ом. Описание PR с `## Mac checks` и двумя командами — блок печатает две команды; с `none` — печатает `none`; без раздела — `no-section`. Раздел кончается на следующем заголовке: команды из него не попадают. Под bash и под zsh на Mac.
- [ ] `skill-blocks.test.sh`, блок выбора метки из `ship-ticket/SKILL.md`, раздел 8: при выводе `label` вызван `gh pr edit <N> --body-file`, и файл содержит прежнее описание и `## Mac checks`; при `no-label` описание не меняется.
- [ ] Contract test Profile-а — `profile.test.sh`. Profile с `"cross_machine_gate": {"label": "needs-mac-gate", "role": "request", "exempt": [".scratch/", "docs/"], "checks_section": "Mac checks"}`: `profile --field cross_machine_gate.role` печатает `request`, `--field cross_machine_gate.label` — `needs-mac-gate`, `--field cross_machine_gate.checks_section` — `Mac checks`. Profile без поля — exit 4. `"role": "merge"`, `cross_machine_gate` без `label`, без `checks_section` и `"role": "serve"` без `check` — exit 1 и причина в stderr.
- [ ] ADR этого Ticket-а в `docs/adr/`: в заголовке или первом абзаце — «уточняет ADR-0056»; есть Q30, Q31, Q32 и Q33, пять полей `cross_machine_gate`, отвергнутые варианты; Q31 записан как уточнение ADR-0056, пункт 6 (повтора gate full на Windows после rebase нет, main проверяется в начале Wave на Windows). `git diff origin/main -- docs/adr/0056-*.md` пуст.
- [ ] `harness/profiles/README.md`: в таблице `profile.json` — строки `cross_machine_gate.label`, `cross_machine_gate.role`, `cross_machine_gate.exempt`, `cross_machine_gate.check` и `cross_machine_gate.checks_section` с типом, смыслом и читателями (`epic-wave`, `ship-ticket`); правило exit 1 для поля — под таблицей.
- [ ] `bash harness/bin/tests/skill-blocks.test.sh`, `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` и `bash harness/bin/tests/profile.test.sh` — exit 0 на Mac и в `pnpm test`.
- [ ] Те же три test-а — exit 0 в Git Bash на Windows-ПК; случаи zsh печатают `skip`.
- [ ] Живая проверка: новый блок раздела 1 в репозитории worfy для Epic-а `worfy-windows` печатает открытые PR других Epic-ов с их файлами (или ничего). Вывод — в Итог.
- [ ] Вручную: `profile --field cross_machine_gate.role` в репозитории worfy печатает `request` на Windows-ПК и `serve` на Mac (Mac — через раздел Mac checks PR, Q33); `--field cross_machine_gate.checks_section` на обеих — `Mac checks`.
- [ ] Живая проверка метки. PR этого Ticket-а идёт по правилу вручную: метку ставит Session на Windows, вливает Session на Mac. Первый PR с меткой после его мержа, когда новые тексты skills стоят на обеих Machine, идёт по новым шагам: метку ставит раздел 8 `ship-ticket` на Windows-ПК, Session на Mac в разделе 1 `epic-wave` перебазирует, проверяет и вливает его или пишет комментарий. Годится PR Ticket-а, который не ждёт 07 (обычно 14): 15 и 16 ждут 07. Если такого PR не осталось — на Windows-ПК блок раздела 8 над влитым PR этого Ticket-а печатает `label`, на Mac блок раздела 1 печатает открытые PR с меткой или ничего. Номер PR, строка `[gate]` и итог — в Итог.
- [ ] Живая проверка Q33 на том же PR с меткой: в описании PR есть раздел `## Mac checks` (команды или `none`); в PR есть отчёт Session на Mac с первой строкой `Mac checks report: green` или `Mac checks report: red`, строкой `[gate]` и кодами выхода команд раздела; мерж — позже отчёта по времени. Ссылки на описание и отчёт — в Итог.
- [ ] Живая проверка Q31: на Windows-ПК первая Wave после мержа этого Ticket-а начинается с gate full на свежем main — строка вердикта и код выхода стоят в отчёте Wave раньше раздачи Ticket-ов. Выдержка из отчёта Wave — в Итог.
- [ ] Windows-ПК, один раз: запуск по новому абзацу открывает установленный worfy, команда `Get-Process` печатает путь его `worfy.exe`. Выбранный способ запуска и вывод — в Итог.
- [ ] Mac: gate full зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).

## Тесты

Сначала — случай замка в `skill-blocks.test.sh`. Он вырезает блок из `epic-wave/SKILL.md` и гоняет
его под bash. На нынешнем main на Mac он зелёный: BSD `stat` там есть. Красным его делает запуск
в Git Bash на Windows-ПК или на Linux (CI): там `stat -f %m` кончается ошибкой, цикл крутится
вхолостую и упирается в предел кругов. В Итог — вывод красного прогона.

Блоки вырезаются из `SKILL.md` тем же способом, что в `skill-blocks.test.sh:18-21` (функция `block`
по уникальной строке блока). Проверка текста — `has`/`lacks` из `epic-wave-ship-ticket.test.sh:17-19`.

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/continuous-audit/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/bin/tests/skill-blocks.test.sh`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`
- `harness/bin/profile`
- `harness/bin/tests/profile.test.sh`
- `harness/profiles/README.md`

ADR этого Ticket-а — новый файл в `docs/adr/`, имя с номером даёт ship-ticket.

## Итог

Заполняется при закрытии.
